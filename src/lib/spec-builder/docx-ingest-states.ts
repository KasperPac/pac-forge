/**
 * Deterministic parser: per-equipment_module operating-state tables.
 *
 * Each state table carries a caption of the form:
 *   "Operating State: {name} (pac-forge:state:{stateId})"
 * and is associated with an equipment_module via an enclosing caption or an adjacent
 * "pac-forge:equipment_module:{uuid}" sentinel. The static/sequential pattern is
 * detected by header shape:
 *   Static     → [Tag, Description, State]
 *   Sequential → [Step, Action, Completion Criteria, On Fail]
 */
import type {
  CompletionCriterion,
  ControlModuleStateEntry,
  FaultRef,
  SequentialStateV2,
  PhaseStep,
} from "@/types/spec-contract-v2";
import type { ParsedDocxTable } from "@/lib/spec-builder/docx-ingest";
import { DocxIngestError } from "@/lib/spec-builder/docx-ingest-hierarchy";
import {
  parseAssemblySentinel,
  parseStateSentinel,
} from "@/lib/spec-builder/docx-ingest-sentinels";

const STATIC_HEADERS = ["Tag", "Description", "State"] as const;
const SEQUENTIAL_HEADERS = [
  "Step",
  "Action",
  "Completion Criteria",
  "On Fail",
] as const;

function headersMatch(headers: string[], target: readonly string[]): boolean {
  if (headers.length < target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (headers[i]?.trim() !== target[i]) return false;
  }
  return true;
}

function parseOnFail(text: string): FaultRef | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  // Accept "CODE[:severity]" — severity defaults to fault.
  const [rawCode, rawSeverity] = trimmed.split(":").map((p) => p.trim());
  if (!rawCode) return undefined;
  const severity =
    rawSeverity?.toLowerCase() === "warning" ? "warning" : "fault";
  return { fault_code: rawCode, severity };
}

function parseStaticRows(table: ParsedDocxTable): ControlModuleStateEntry[] {
  if (!headersMatch(table.headers, STATIC_HEADERS)) {
    throw new DocxIngestError(
      `Static state table headers must be ${STATIC_HEADERS.join(" | ")}`,
      [`Caption: ${table.caption}`, `Got: ${table.headers.join(" | ")}`],
    );
  }
  return table.rows
    .map((r) => ({
      tag: (r[0] ?? "").trim(),
      description: (r[1] ?? "").trim(),
      state: (r[2] ?? "").trim(),
    }))
    .filter((e) => e.tag.length > 0);
}

function parseSequentialRows(table: ParsedDocxTable): PhaseStep[] {
  if (!headersMatch(table.headers, SEQUENTIAL_HEADERS)) {
    throw new DocxIngestError(
      `Sequential state table headers must be ${SEQUENTIAL_HEADERS.join(" | ")}`,
      [`Caption: ${table.caption}`, `Got: ${table.headers.join(" | ")}`],
    );
  }
  return table.rows.map((r, idx) => {
    const rawStep = (r[0] ?? "").trim();
    const stepNum = Number(rawStep);
    if (!Number.isFinite(stepNum) || stepNum <= 0) {
      throw new DocxIngestError(
        `Sequential step number invalid at row ${idx + 1}: "${rawStep}"`,
      );
    }
    const criteriaText = (r[2] ?? "").trim();
    // Fallback criterion — an expression with the raw text. The appendix
    // parser may replace this with a structured CompletionCriterion.
    const fallback: CompletionCriterion = {
      kind: "expression",
      text: criteriaText,
      referenced_tags: [],
    };
    return {
      step: stepNum,
      action: (r[1] ?? "").trim(),
      completion_criteria: criteriaText ? [fallback] : [],
      completion_criteria_text: criteriaText,
      on_fail: parseOnFail(r[3] ?? ""),
    };
  });
}

export interface ParsedAssemblyStates {
  /** equipment_module_id → state_id → static state rows */
  staticByEquipmentModule: Record<string, Record<string, ControlModuleStateEntry[]>>;
  /** equipment_module_id → state_id → sequential state shape */
  sequentialByEquipmentModule: Record<string, Record<string, SequentialStateV2>>;
}

/**
 * Walks all tables with a state sentinel. Uses the most recently seen
 * equipment_module sentinel to associate a state with an equipment_module. If no equipment_module
 * sentinel is present in any prior caption the parser throws.
 */
export function parseStateTables(
  tables: ParsedDocxTable[],
): ParsedAssemblyStates {
  const staticByEquipmentModule: Record<string, Record<string, ControlModuleStateEntry[]>> = {};
  const sequentialByEquipmentModule: Record<string, Record<string, SequentialStateV2>> = {};

  let currentEquipmentModuleId: string | null = null;

  for (const table of tables) {
    const equipment_moduleMarker = parseAssemblySentinel(table.caption);
    if (equipment_moduleMarker) currentEquipmentModuleId = equipment_moduleMarker.equipment_moduleId;

    const stateMarker = parseStateSentinel(table.caption);
    if (!stateMarker) continue;

    if (!currentEquipmentModuleId) {
      throw new DocxIngestError(
        `State table "${table.caption}" not scoped to an equipment_module — no pac-forge:equipment_module sentinel seen before it`,
      );
    }

    const isStatic = headersMatch(table.headers, STATIC_HEADERS);
    const isSequential = headersMatch(table.headers, SEQUENTIAL_HEADERS);
    if (!isStatic && !isSequential) {
      throw new DocxIngestError(
        `State table headers unrecognised`,
        [`Caption: ${table.caption}`, `Headers: ${table.headers.join(" | ")}`],
      );
    }

    if (isStatic) {
      const rows = parseStaticRows(table);
      (staticByEquipmentModule[currentEquipmentModuleId] ??= {})[stateMarker.stateId] = rows;
    } else {
      const steps = parseSequentialRows(table);
      (sequentialByEquipmentModule[currentEquipmentModuleId] ??= {})[stateMarker.stateId] = {
        permissives: [],
        steps,
        notes: null,
      };
    }
  }

  return { staticByEquipmentModule, sequentialByEquipmentModule };
}
