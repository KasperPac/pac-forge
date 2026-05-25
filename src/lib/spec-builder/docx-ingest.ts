/**
 * DOCX ingest dispatcher.
 *
 * Given a File (a .docx blob), decide whether the document is our own
 * sentinel-bearing export (deterministic path) or a foreign spec (AI path).
 *
 * Deterministic path:
 *   1. Unzip the .docx (jszip).
 *   2. Parse word/document.xml with fast-xml-parser.
 *   3. Walk tables with their preceding paragraph as the caption.
 *   4. Hand parsed tables to the sub-parsers. Any failure throws — we do
 *      NOT silently fall back to AI parsing.
 *
 * AI path:
 *   1. Extract raw text with mammoth.
 *   2. Call the AI ingest module (`ai-ingest.ts`).
 *   3. Return the AI-produced draft (possibly with validation warnings).
 *
 * Output shape:
 *   { kind: "deterministic" | "ai" | "error", ... }
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import mammoth from "mammoth";
import type {
  AssemblyContract,
  SpecContractV2,
} from "@/types/spec-contract-v2";
import {
  hasHierarchySentinel,
  parseRevisionSentinel,
} from "@/lib/spec-builder/docx-ingest-sentinels";
import {
  parseHierarchyTable,
  DocxIngestError,
} from "@/lib/spec-builder/docx-ingest-hierarchy";
import { parseStateTables } from "@/lib/spec-builder/docx-ingest-states";
import { parseAlarmTable } from "@/lib/spec-builder/docx-ingest-alarms";
import {
  parseAppendixTables,
  applyCriteriaOverrides,
} from "@/lib/spec-builder/docx-ingest-appendix";
import { aiIngestDocx } from "@/lib/spec-builder/ai-ingest";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Warning {
  path: string;
  message: string;
}

export type IngestResult =
  | {
      kind: "deterministic";
      draft: SpecContractV2;
      parentRevisionId?: string;
      warnings: Warning[];
    }
  | {
      kind: "ai";
      draft: SpecContractV2;
      warnings: Warning[];
    }
  | {
      kind: "error";
      message: string;
      diagnostics: string[];
    };

export interface ParsedDocxTable {
  /** The paragraph of text immediately preceding this table — may be empty. */
  caption: string;
  /** First row (header) as cell text. */
  headers: string[];
  /** Remaining rows (body) as cell text arrays. */
  rows: string[][];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function ingestDocx(file: File): Promise<IngestResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    // Cheap pre-filter: extract raw text first to look for sentinels
    let rawText = "";
    try {
      const extract = await mammoth.extractRawText({ arrayBuffer });
      rawText = extract.value ?? "";
    } catch (e) {
      return {
        kind: "error",
        message: "Failed to read DOCX with mammoth",
        diagnostics: [String(e)],
      };
    }

    const deterministic = hasHierarchySentinel(rawText);

    if (!deterministic) {
      // AI path — extract text (already done) and hand off.
      const abort = new AbortController();
      try {
        const { draft, warnings } = await aiIngestDocx(file, abort.signal);
        return { kind: "ai", draft, warnings };
      } catch (e) {
        return {
          kind: "error",
          message: `AI ingest failed: ${e instanceof Error ? e.message : String(e)}`,
          diagnostics: [],
        };
      }
    }

    // Deterministic path
    const tables = await extractTablesFromDocx(arrayBuffer);
    const warnings: Warning[] = [];

    const hierarchyResult = parseHierarchyTable(tables);
    const stateResult = parseStateTables(tables);
    const alarms = parseAlarmTable(tables);
    const appendix = parseAppendixTables(tables);

    const sequentialStates = applyCriteriaOverrides(
      stateResult.sequentialByAssembly,
      appendix.criteriaOverrides,
    );

    const sentinel = parseRevisionSentinel(rawText);
    if (sentinel && appendix.revisionCrossCheck) {
      if (
        sentinel.revisionId !== appendix.revisionCrossCheck.revisionId ||
        sentinel.revisionNumber !== appendix.revisionCrossCheck.revisionNumber
      ) {
        warnings.push({
          path: "revision",
          message: `Revision sentinel and appendix marker disagree — using sentinel`,
        });
      }
    }

    // Merge state data into AssemblyContracts keyed by assembly_id.
    const assemblies: Record<string, AssemblyContract> = {};
    for (const sub of hierarchyResult.hierarchy.subsystems) {
      for (const asy of sub.assemblies) {
        assemblies[asy.assembly_id] = {
          assembly_id: asy.assembly_id,
          subsystem_id: sub.subsystem_id,
          static_states: stateResult.staticByAssembly[asy.assembly_id] ?? {},
          sequential_states: sequentialStates[asy.assembly_id] ?? {},
        };
      }
    }

    const draft: SpecContractV2 = {
      schema_version: 2,
      // Legacy V1 docx ingest produces drafts that have not gone through Phase 2
      // confirmation; mark unconfirmed (Task 10).
      confirmation_status: "unconfirmed",
      project: {
        id: "",
        doc_code: "",
        title: "",
        client_name: "",
        project_number: null,
        plc_model: null,
        hmi_type: null,
        comms_protocol: null,
        safety_classification: null,
        fault_philosophy: null,
        design_principles: [],
        scope_exclusions: [],
      },
      hierarchy: hierarchyResult.hierarchy,
      states: [],
      alarm_tiers: [],
      assemblies,
      orchestrations: {},
      alarms,
      io_list: [],
      faults: [],
      sections: {} as SpecContractV2["sections"],
    };

    return {
      kind: "deterministic",
      draft,
      parentRevisionId: sentinel?.revisionId,
      warnings,
    };
  } catch (e) {
    if (e instanceof DocxIngestError) {
      return {
        kind: "error",
        message: e.message,
        diagnostics: e.diagnostics,
      };
    }
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
      diagnostics: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Table extraction from word/document.xml
// ---------------------------------------------------------------------------

/**
 * Extract all tables from the DOCX, pairing each with the paragraph that
 * immediately precedes it (the "caption"). fast-xml-parser is configured to
 * preserve element order so we can scan body children linearly.
 */
export async function extractTablesFromDocx(
  arrayBuffer: ArrayBuffer,
): Promise<ParsedDocxTable[]> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docEntry = zip.file("word/document.xml");
  if (!docEntry) {
    throw new DocxIngestError("DOCX missing word/document.xml");
  }
  const xml = await docEntry.async("string");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
  });
  const parsed = parser.parse(xml) as unknown[];

  // Root is `[{ "w:document": [...] }]` in preserveOrder mode.
  const docRoot = findFirstNamed(parsed, "w:document");
  const body = docRoot ? findFirstNamed(getChildren(docRoot), "w:body") : null;
  if (!body) {
    throw new DocxIngestError("DOCX document.xml has no <w:body>");
  }

  const bodyChildren = getChildren(body);
  const tables: ParsedDocxTable[] = [];
  let lastParagraphText = "";

  for (const node of bodyChildren) {
    const name = tagName(node);
    if (!name) continue;

    if (name === "w:p") {
      const text = collectText(node);
      if (text.trim().length > 0) {
        lastParagraphText = text;
      }
      continue;
    }

    if (name === "w:tbl") {
      const rows = extractRowsFromTable(node);
      if (rows.length > 0) {
        const [headers, ...body] = rows;
        tables.push({
          caption: lastParagraphText,
          headers,
          rows: body,
        });
      }
      // Captions are one-shot — reset after consuming.
      lastParagraphText = "";
      continue;
    }
  }

  return tables;
}

// ---------------------------------------------------------------------------
// fast-xml-parser (preserveOrder) shape helpers
// ---------------------------------------------------------------------------

// In preserveOrder mode, each node is an object like `{ "w:p": [...children] }`
// with an optional ":@": { ...attrs } sibling key.

function tagName(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const keys = Object.keys(node).filter((k) => k !== ":@");
  return keys[0] ?? null;
}

function getChildren(node: unknown): unknown[] {
  if (typeof node !== "object" || node === null) return [];
  const name = tagName(node);
  if (!name) return [];
  const val = (node as Record<string, unknown>)[name];
  return Array.isArray(val) ? val : [];
}

function findFirstNamed(list: unknown[], name: string): unknown | null {
  for (const node of list) {
    if (tagName(node) === name) return node;
  }
  return null;
}

/** Collect concatenated text from a paragraph or any subtree. */
function collectText(node: unknown): string {
  const name = tagName(node);
  if (name === "w:t") {
    // Text leaf — children is [{ "#text": "..." }]
    const kids = getChildren(node);
    const textNode = kids.find((k) => tagName(k) === "#text");
    if (textNode) {
      const val = (textNode as Record<string, unknown>)["#text"];
      return typeof val === "string" ? val : String(val ?? "");
    }
    return "";
  }
  const kids = getChildren(node);
  return kids.map((k) => collectText(k)).join("");
}

/** Extract rows (each a string[] of cell text) from a <w:tbl>. */
function extractRowsFromTable(tableNode: unknown): string[][] {
  const rows: string[][] = [];
  for (const child of getChildren(tableNode)) {
    if (tagName(child) !== "w:tr") continue;
    const cells: string[] = [];
    for (const cell of getChildren(child)) {
      if (tagName(cell) !== "w:tc") continue;
      cells.push(collectText(cell));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}
