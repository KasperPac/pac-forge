import { useState, useCallback } from "react";
import { callStreamingCollect } from "@/hooks/use-generation";
// Wave 5: dialect helper reserved for signal-type emission at this site.
import { toSiemens } from "@/lib/spec-builder/dialect";
void toSiemens;
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildProcessSclPrompt,
  buildProcessSclUserMessage,
  buildProcessLadPrompt,
  generateOb1Main,
  deviceTypeToFcName,
  getDeviceCallOrder,
  type ProcessGenContext,
  type FaultEntry,
} from "@/lib/forge-prompts";
import { loadPlatformRules } from "@/lib/platform-rules";
import { parseGeneralRules, parseProcessRules } from "@/lib/design-profile-schemas";
import type {
  ForgeSession,
  ForgeArtifact,
  ForgeDeviceEntry,
  SpecAnalysis,
  SpecAnalysisProcessSequence,
} from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { PatternCandidate, Instruction } from "@/types";
import type { ProcessLinkageMatrix, ProcessSequence, SequenceRow } from "@/types/forge-matrix";
import type { AgentKnowledgeDoc } from "@/types";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { PROCESS_CODE_CATEGORIES } from "@/hooks/use-instructions";
import { lookupInstructions } from "@/lib/instruction-lookup";
import { getRelevantReferenceSections, formatReferenceSections } from "@/lib/reference-lookup";
import {
  buildDeterministicFaultDb,
  buildOperandTypeMap,
  compileDeterministicFaultArtifact,
  compileDeterministicProcessArtifact,
} from "@/lib/forge-process-compiler";
import { validateLadProgram } from "@/lib/lad-validator";

const PROCESS_GEN_MAX_TOKENS = 16384;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract INTERFACE sections from SCL device artifacts for use as FB context. */
function extractFbInterfaces(deviceArtifacts: ForgeArtifact[]): string {
  const interfaces: string[] = [];

  for (const artifact of deviceArtifacts) {
    if (artifact.language !== "SCL" || artifact.type !== "FB") continue;

    // Extract only VAR_INPUT and VAR_OUTPUT (skip VAR_IN_OUT, VAR, VAR_TEMP to save space)
    const interfaceRe =
      /(VAR_INPUT[\s\S]*?END_VAR|VAR_OUTPUT[\s\S]*?END_VAR)/gi;
    const matches = artifact.content.match(interfaceRe);
    if (matches) {
      interfaces.push(
        `// ${artifact.name}\n${matches.join("\n")}`,
      );
    }
  }

  const result = interfaces.length > 0
    ? interfaces.join("\n\n")
    : "(no device FB interfaces available)";

  // Cap total interface text to prevent prompt bloat with many devices
  if (result.length > 6000) {
    return result.slice(0, 6000) + "\n// ... (truncated — see Device Wiring Reference for field names)";
  }
  return result;
}

/**
 * Scan all process FC/FB artifacts for "DbName".fieldName references,
 * then add any missing fields to the corresponding DB artifacts.
 * This ensures the DBs have every field that the compiled logic references.
 */
/**
 * Reconcile DB fields: scan process FCs for DB.field references, find missing
 * fields in the DB artifacts, and add them. If a device DB needs updating,
 * clone it into the process artifacts array so the updated version gets uploaded.
 */
function reconcileProcessDbFields(processArtifacts: ForgeArtifact[], deviceArtifacts: ForgeArtifact[] = []): void {
  // Build map of DB artifacts from both pools
  const dbArtifacts = new Map<string, ForgeArtifact>();
  for (const a of [...processArtifacts, ...deviceArtifacts]) {
    if (a.type === "DB") {
      dbArtifacts.set(a.name, a);
      if (a.name.startsWith("DB_")) dbArtifacts.set(a.name.slice(3), a);
    }
  }
  if (dbArtifacts.size === 0) return;

  // Only scan process FCs/FBs for references
  const artifacts = processArtifacts;

  // Collect all DB.fieldName references from FC/FB/OB artifacts.
  // Matches both quoted ("DB_Name".field) and unquoted (DB_Name.field) formats —
  // the compiler produces quoted, but LAD JSON operands store unquoted.
  const referencedFields = new Map<string, Set<string>>(); // dbArtifactName → field names
  const dbFieldRefRe = /"?([A-Za-z_][A-Za-z0-9_]*)"?\.([A-Za-z_]\w*)/g;

  for (const a of artifacts) {
    if (a.type === "DB") continue;
    let m: RegExpExecArray | null;
    dbFieldRefRe.lastIndex = 0;
    while ((m = dbFieldRefRe.exec(a.content)) !== null) {
      const dbName = m[1];
      const fieldName = m[2];
      // Skip array access patterns (S[0], A[10]) — these are array elements, not fields to add
      if (/^[SA]$/.test(fieldName)) continue;
      // Skip non-DB identifiers (FB instance names, keywords, etc.)
      const dbArtifact = dbArtifacts.get(dbName);
      if (!dbArtifact) continue;
      const canonicalName = dbArtifact.name;
      if (!referencedFields.has(canonicalName)) referencedFields.set(canonicalName, new Set());
      referencedFields.get(canonicalName)!.add(fieldName);
    }
  }

  // For each DB, find missing fields and add them.
  // If the DB is from deviceArtifacts (not in processArtifacts), clone it into
  // processArtifacts so the updated version gets uploaded with the process code.
  for (const [dbName, refFields] of referencedFields) {
    // Find the DB in any pool
    let dbArtifact = processArtifacts.find(a => a.type === "DB" && a.name === dbName);
    let cloned = false;
    if (!dbArtifact) {
      // DB is from device artifacts — clone it into process artifacts
      const deviceDb = deviceArtifacts.find(a => a.type === "DB" && a.name === dbName);
      if (!deviceDb) continue;
      dbArtifact = { ...deviceDb, id: crypto.randomUUID(), stage: "process" as const };
      cloned = true;
    }

    const existingFields = new Set(parseDbFields(dbArtifact.content).map(f => f.name));
    const missing = [...refFields].filter(f => !existingFields.has(f));
    if (missing.length === 0) {
      // Even if no missing fields, if it was cloned we need to add it so it gets re-uploaded
      // (the process FCs reference it, so it must be in the upload set)
      continue;
    }

    // Infer data types from field names
    const newFieldLines = missing.map(fieldName => {
      const lower = fieldName.toLowerCase();
      let dataType = "Bool";
      if (/direction|mode|count|code|step|index|number/i.test(lower)) dataType = "Int";
      else if (/speed|temp|level|setpoint|value|rate/i.test(lower)) dataType = "Real";
      else if (/dly|delay|time|duration|timeout/i.test(lower)) dataType = "Time";
      return `    ${fieldName} : ${dataType};`;
    });

    // Insert before END_VAR
    const endVarIdx = dbArtifact.content.indexOf("END_VAR");
    if (endVarIdx === -1) continue;

    dbArtifact.content =
      dbArtifact.content.slice(0, endVarIdx) +
      newFieldLines.join("\n") + "\n  " +
      dbArtifact.content.slice(endVarIdx).trimStart();

    if (cloned) {
      processArtifacts.push(dbArtifact);
    }

    console.log(`[forge:process] Reconciled ${dbName}: added ${missing.length} missing field(s) [${missing.join(", ")}]${cloned ? " (cloned from device artifacts)" : ""}`);
  }
}

/** Parse fields from an SCL VAR block */
function parseDbFields(content: string): Array<{ name: string; dataType: string }> {
  const fields: Array<{ name: string; dataType: string }> = [];
  const re = /^\s+(\w+)\s*:\s*(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    fields.push({ name: m[1], dataType: m[2] });
  }
  return fields;
}

/** Parse FB interface fields (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT) */
function parseFbInterface(content: string): Array<{ name: string; dataType: string; dir: string }> {
  const fields: Array<{ name: string; dataType: string; dir: string }> = [];
  const secRe = /(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT)([\s\S]*?)END_VAR/gi;
  let secMatch: RegExpExecArray | null;
  while ((secMatch = secRe.exec(content)) !== null) {
    const dir = secMatch[1].toUpperCase() === "VAR_INPUT" ? "in" : secMatch[1].toUpperCase() === "VAR_OUTPUT" ? "out" : "inout";
    const fieldRe = /^\s+(\w+)\s*:\s*(\w+)/gm;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(secMatch[2])) !== null) {
      fields.push({ name: fm[1], dataType: fm[2], dir });
    }
  }
  return fields;
}

/**
 * Build a map from wiring DB names (may lack prefix) → actual import names.
 * Reads DATA_BLOCK declarations from SCL content as canonical names.
 */
function buildDbNameMap(deviceArtifacts: ForgeArtifact[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of deviceArtifacts.filter(x => x.type === "DB")) {
    const declMatch = a.content.match(/DATA_BLOCK\s+"([^"]+)"/i);
    const importName = declMatch?.[1] ?? a.name;

    map.set(a.name.toLowerCase(), importName);
    map.set(importName.toLowerCase(), importName);
    if (importName.startsWith("DB_")) {
      map.set(importName.slice(3).toLowerCase(), importName);
    }
    if (a.name.startsWith("DB_")) {
      map.set(a.name.slice(3).toLowerCase(), importName);
    }
    if (!importName.startsWith("DB_")) {
      map.set(`db_${importName}`.toLowerCase(), importName);
    }
    if (!a.name.startsWith("DB_")) {
      map.set(`db_${a.name}`.toLowerCase(), importName);
    }
  }
  return map;
}

/**
 * Build a filtered tag dictionary for a specific sequence.
 * Only includes tags for devices used in this sequence + project-wide DBs (faults, step/action).
 * Uses linkage matrix wiring to map devices → global DB fields.
 */
function buildFilteredTagDictionary(
  deviceArtifacts: ForgeArtifact[],
  matrix: ProcessLinkageMatrix | null,
  sequenceDeviceNames: string[],
  stepActionDbName: string | undefined,
  faultEntries: FaultEntry[],
): string {
  const lines: string[] = [];
  // Wave 5: device identity should come from contract device_id, not a
  // lowercased name substring match. `sequenceDeviceNames` is still a name
  // list until the matrix refactor threads device_ids through; the caller
  // pre-filters so this local match is bounded.
  const deviceNamesLower = new Set(sequenceDeviceNames.map(n => n.toLowerCase()));

  // Collect relevant global DB fields from wiring
  const relevantGlobalFields = new Map<string, Set<string>>(); // dbName → field names

  if (matrix?.deviceLinkage) {
    for (const device of matrix.deviceLinkage) {
      // Check if this device is used by the sequence
      const devNameLower = (device.name ?? "").toLowerCase();
      const devTagLower = (device.instanceDbName ?? "").replace(/^Inst/i, "").toLowerCase();
      const isRelevant = deviceNamesLower.has(devNameLower) ||
        [...deviceNamesLower].some(n => devNameLower.includes(n) || n.includes(devNameLower) || devTagLower.includes(n));

      if (!isRelevant && deviceNamesLower.size > 0) continue;

      // Instance DB fields
      if (device.instanceDbName) {
        const fb = deviceArtifacts.find(a => a.type === "FB" && a.name === device.fbName);
        if (fb) {
          const fields = parseFbInterface(fb.content);
          for (const f of fields) {
            lines.push(`"${device.instanceDbName}".${f.name}:${f.dataType}(${f.dir})`);
          }
        }
      }

      // Global DB fields from wiring — EXCLUDE Inputs/Outputs (internal to device layer)
      for (const wire of (device.wiring ?? [])) {
        if (wire.connectedTo && wire.wireType === "global") {
          const dotIdx = wire.connectedTo.indexOf(".");
          if (dotIdx > 0) {
            const dbName = wire.connectedTo.slice(0, dotIdx);
            // Skip Inputs/Outputs DBs — process code must not access these
            if (/^(Inputs|Outputs|DB_Inputs|DB_Outputs)$/i.test(dbName)) continue;
            const fieldName = wire.connectedTo.slice(dotIdx + 1);
            if (!relevantGlobalFields.has(dbName)) relevantGlobalFields.set(dbName, new Set());
            relevantGlobalFields.get(dbName)!.add(fieldName);
          }
        }
      }
    }
  }

  const dbNameLookup = buildDbNameMap(deviceArtifacts);

  // Add relevant global DB fields — resolve to actual artifact name
  for (const [wiringDbName, fieldNames] of relevantGlobalFields) {
    const actualName = dbNameLookup.get(wiringDbName.toLowerCase()) ?? wiringDbName;
    const dbArtifact = deviceArtifacts.find(a => a.type === "DB" && a.name === actualName);
    if (dbArtifact) {
      const allFields = parseDbFields(dbArtifact.content);
      for (const f of allFields) {
        if (fieldNames.has(f.name)) {
          lines.push(`"${actualName}".${f.name}:${f.dataType}`);
        }
      }
    } else {
      // No artifact found — use the wiring name as-is
      for (const fn of fieldNames) {
        lines.push(`"${actualName}".${fn}:Bool`);
      }
    }
  }

  // EXCLUDE Inputs/Outputs DBs — process code must NEVER access these directly.
  // They are internal to IO Linking FC and device call FCs.
  // Process code reads device state from Instance DBs (e.g. "InstM01".fwdrun)
  // and writes commands via ProcessCommands DB (e.g. "ProcessCommands".m01CmdFwd).

  // Step/Action DB
  if (stepActionDbName) {
    lines.push(`"${stepActionDbName}".S[n]:Bool (step bits)`);
    lines.push(`"${stepActionDbName}".A[n]:Bool (action bits)`);
  }

  // Fault DB (always project-wide)
  if (faultEntries.length > 0) {
    for (const f of faultEntries) {
      lines.push(`"DB_FaultData".${f.tag}:Bool`);
    }
    lines.push(`"DB_FaultData".faultActive:Bool`);
    lines.push(`"DB_FaultData".faultReset:Bool`);
  }

  if (lines.length === 0) return "";

  // Deduplicate
  const unique = [...new Set(lines)];

  return `## VALID TAGS — Use ONLY these references. Do NOT invent tag names.
NEVER reference "Inputs", "Outputs", "DB_Inputs", or "DB_Outputs" — those are internal to the IO Linking FC.
Process code reads device state from Instance DBs and writes commands via ProcessCommands.
${unique.join("\n")}`;
}

/** Parse SCL fenced blocks from Claude response as process-stage artifacts. */
function parseSclArtifacts(rawContent: string): ForgeArtifact[] {
  const artifacts: ForgeArtifact[] = [];
  const blockRe = /```scl\s+\[(\w+):([^\]]+)\]\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(rawContent)) !== null) {
    const [, blockType, blockName, code] = match;
    const type = blockType.toUpperCase() as ForgeArtifact["type"];
    artifacts.push({
      id: crypto.randomUUID(),
      name: blockName.trim(),
      type,
      language: "SCL",
      content: code.trim(),
      approved: false,
      stage: "process",
      destination_folder:
        type === "OB" ? "Program blocks" : "Program blocks/Forge/Process",
      dependencies: [],
      compile_after_import: true,
    });
  }

  return artifacts;
}

/**
 * Normalize AI-generated LAD JSON to match the LadNode type definition.
 * The AI generates parallel nodes as { type: "parallel", nodes: [...] }
 * but our type expects { type: "parallel", branches: [...] }.
 * Also ensures parallel nodes have an `id` field.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLadJson(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) return obj.map(normalizeLadJson);

  const result = { ...obj };

  // Top-level program normalization: field name variants
  if (result.networks && !result.rungs) {
    result.rungs = result.networks;
    delete result.networks;
  }
  if (result.blockName && !result.name) {
    result.name = result.blockName;
    delete result.blockName;
  }

  // Rung-level normalization: networkId → id
  if (result.networkId && !result.id) {
    result.id = result.networkId;
    delete result.networkId;
  }

  // Convert parallel nodes: "nodes" containing series chains → "branches"
  if (result.type === "parallel" && Array.isArray(result.nodes) && !result.branches) {
    result.branches = result.nodes.map(normalizeLadJson);
    delete result.nodes;
  }
  // Ensure all parallel nodes have an id (needed for React keys in LAD canvas)
  if (result.type === "parallel" && !result.id) {
    result.id = `par_${crypto.randomUUID().slice(0, 8)}`;
  }

  // Normalize element types — map AI hallucinations to valid LadElementType values
  if (result.type === "element" && result.element?.type) {
    const LAD_TYPE_MAP: Record<string, string> = {
      CONTACT: "NO_CONTACT",
      NO_CONTACT_NORMALLY_OPEN: "NO_CONTACT",
      NORMALLY_OPEN: "NO_CONTACT",
      NC_CONTACT_NORMALLY_CLOSED: "NC_CONTACT",
      NORMALLY_CLOSED: "NC_CONTACT",
      COIL: "OUTPUT_COIL",
      OUTPUT: "OUTPUT_COIL",
      RISING_EDGE: "R_TRIG",
      FALLING_EDGE: "F_TRIG",
      TIMER_ON: "TON",
      TIMER_OFF: "TOF",
      COUNT_UP: "CTU",
      COUNT_DOWN: "CTD",
      COMPARE: "CMP",
      EQ: "CMP",
      NE: "CMP",
      GT: "CMP",
      LT: "CMP",
      GE: "CMP",
      LE: "CMP",
    };
    const mapped = LAD_TYPE_MAP[result.element.type];
    if (mapped) {
      console.warn(`[forge-process] Normalized LAD element type: ${result.element.type} → ${mapped}`);
      result.element.type = mapped;
    }
  }

  // Recurse into all object properties
  for (const key of Object.keys(result)) {
    if (typeof result[key] === "object" && result[key] !== null) {
      result[key] = normalizeLadJson(result[key]);
    }
  }

  return result;
}

/** Parse LadProgram JSON response as process-stage artifact. */
function parseLadArtifact(rawContent: string, name: string): ForgeArtifact | null {
  // Strategy 1: Find the outermost { ... } block — most reliable for large JSON
  const braceStart = rawContent.indexOf("{");
  const braceEnd = rawContent.lastIndexOf("}");
  let jsonStr = "";

  if (braceStart >= 0 && braceEnd > braceStart) {
    jsonStr = rawContent.slice(braceStart, braceEnd + 1);
  } else {
    // Strategy 2: Try stripping markdown fences
    jsonStr = rawContent
      .trim()
      .replace(/^[\s\S]*?```json\s*\n/i, "")
      .replace(/```[\s\S]*$/, "")
      .trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const normalized = normalizeLadJson(parsed);
    // Use the AI's block name if available, otherwise sanitize the input name
    const blockName = (normalized.name ?? name).replace(/\s+/g, "_");
    return {
      id: crypto.randomUUID(),
      name: blockName,
      type: "FC",
      language: "LAD",
      content: JSON.stringify(normalized),
      approved: false,
      stage: "process",
      destination_folder: "Program blocks/Forge/Process",
      dependencies: [],
      compile_after_import: true,
    };
  } catch (err) {
    console.error(`[forge-process] JSON parse error for ${name}:`, err instanceof Error ? err.message : err);
    console.log(`[forge-process] JSON candidate (first 200 / last 200):`, jsonStr.slice(0, 200), "...", jsonStr.slice(-200));
    return null;
  }
}

/**
 * Convert engineer-reviewed SequenceRow[] into a structured steps section for the
 * process code generation prompt. Groups rows by step number, rendering branches
 * as explicit alternatives and fault_exits as error paths.
 */
function buildStepsSectionFromRows(rows: SequenceRow[]): string {
  // Group by step number, preserving order
  const stepMap = new Map<number, SequenceRow[]>();
  for (const row of rows) {
    if (!stepMap.has(row.step)) stepMap.set(row.step, []);
    stepMap.get(row.step)!.push(row);
  }

  const lines: string[] = [];

  for (const [stepNum, stepRows] of stepMap) {
    const actionRows = stepRows.filter(r => r.type !== "fault_exit");
    const faultRows = stepRows.filter(r => r.type === "fault_exit");
    const isBranched = actionRows.some(r => r.branch !== null);

    if (isBranched) {
      lines.push(`  Step ${stepNum}: [BRANCH]`);
      for (const row of actionRows) {
        const label = row.branch ? `${stepNum}${row.branch}` : String(stepNum);
        const out = row.output ? ` → ${row.output}` : "";
        const next = row.next === "FAULT" ? "→ FAULT" : row.next === "IDLE" ? "→ IDLE" : `→ Step ${row.next}`;
        lines.push(`    Branch ${label}: IF ${row.condition} THEN ${row.action}${out} [${next}]`);
      }
    } else {
      const row = actionRows[0];
      if (row) {
        const out = row.output ? ` → ${row.output}` : "";
        const next = row.next === "FAULT" ? "→ FAULT" : row.next === "IDLE" ? "→ IDLE" : `→ Step ${row.next}`;
        const typeTag = row.type === "monitor" ? " [MONITOR — wait for condition]" : "";
        lines.push(`  Step ${stepNum}${typeTag}: IF ${row.condition} THEN ${row.action}${out} [${next}]`);
      }
    }

    for (const fault of faultRows) {
      lines.push(`    FAULT EXIT: IF ${fault.condition} → go to FAULT state (${fault.action})`);
    }
  }

  return lines.join("\n");
}

/**
 * Defensive: split any row whose condition contains OR / || into separate
 * branch rows so the deterministic compiler doesn't reject them.
 */
function splitOrConditions(seq: ProcessSequence): ProcessSequence {
  const OR_RE = /\s+OR\s+|\|\|/i;
  if (!seq.rows?.length) return seq;

  let changed = false;
  const out: SequenceRow[] = [];

  for (const row of seq.rows) {
    if (!OR_RE.test(row.condition)) {
      out.push(row);
      continue;
    }
    changed = true;
    const parts = row.condition.split(OR_RE).map((s) => s.trim()).filter(Boolean);
    const existingBranches = seq.rows
      .filter((r) => r.step === row.step && r.branch)
      .map((r) => r.branch!);
    let nextLetter = "a".charCodeAt(0);
    if (existingBranches.length) {
      nextLetter = Math.max(...existingBranches.map((b) => b.charCodeAt(0))) + 1;
    }
    for (const part of parts) {
      out.push({ ...row, condition: part, branch: String.fromCharCode(nextLetter), type: "branch" });
      nextLetter++;
    }
    console.warn(`[forge:process] Auto-split OR condition at ${seq.name} step ${row.step}`);
  }

  return changed ? { ...seq, rows: out } : seq;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ForgeProcessGenerateProgress {
  current: number;
  total: number;
  currentSequence: string;
}

export function useForgeProcessGenerate() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ForgeProcessGenerateProgress>({
    current: 0,
    total: 0,
    currentSequence: "",
  });
  const [error, setError] = useState<string | null>(null);

  const generateSequence = useCallback(
    async (
      sequence: SpecAnalysisProcessSequence,
      session: ForgeSession,
      profile: DesignProfile,
      patterns: PatternCandidate[],
      matrixSequence?: ProcessSequence,
      faultSpec?: FaultEntry[],
      stepActionDbName?: string,
      filteredTags?: string,
      agentKnowledgeDocs?: AgentKnowledgeDoc[],
    ): Promise<ForgeArtifact[]> => {
      const abort = new AbortController();
      // Session language (wizard project setup) overrides profile default
      const isLad = (session.process_code_language ?? profile.process_code_language) === "LAD";
      let processSchema = null;
      try {
        if (profile.process_rules && typeof profile.process_rules === "string") {
          processSchema = parseProcessRules(profile.process_rules);
        }
      } catch { /* ignore */ }

      if (matrixSequence?.rows?.length && processSchema?.step_action_db?.enabled && stepActionDbName) {
        const safeSequence = splitOrConditions(matrixSequence);
        const operandTypes = buildOperandTypeMap((session.device_artifacts as ForgeArtifact[]) ?? []);
        const result = compileDeterministicProcessArtifact({
          sequence: safeSequence,
          blockName: matrixSequence.name,
          dbName: stepActionDbName,
          stepArrayName: processSchema.step_action_db.step_array_name || "S",
          actionArrayName: processSchema.step_action_db.action_array_name || "A",
          language: isLad ? "LAD" : "SCL",
          operandTypes,
        });
        if (result.diagnostics.length > 0) {
          console.log(`[process-gen] Compiler diagnostics for ${matrixSequence.name}:`,
            result.diagnostics.map((d) => `[${d.severity}] ${d.category}: ${d.title}`));
        }
        return [result.artifact];
      }

      const devices = (session.device_list as ForgeDeviceEntry[]) ?? [];

      // Fetch instruction library for LAD generation via two-pass AI lookup (non-fatal)
      let ladInstructions: Instruction[] | undefined;
      if (isLad) {
        try {
          const seqNames = matrix?.processSequences?.map((s) => `${s.name}: ${s.description}`).join("\n") ?? "";
          ladInstructions = await lookupInstructions(
            `Generate LAD process sequence FCs for:\n${seqNames}`,
            "LAD",
            undefined,
            PROCESS_CODE_CATEGORIES,
          );
        } catch { /* non-fatal */ }
      }
      const deviceArtifacts = (session.device_artifacts as ForgeArtifact[]) ?? [];
      const fbInterfaces = extractFbInterfaces(deviceArtifacts);
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;
      const validDbNames = new Set(
        deviceArtifacts
          .filter((artifact) => artifact.type === "DB")
          .map((artifact) => {
            const declMatch = artifact.content.match(/DATA_BLOCK\s+"([^"]+)"/i);
            return declMatch?.[1] ?? artifact.name;
          }),
      );
      if (stepActionDbName) validDbNames.add(stepActionDbName);
      if ((faultSpec?.length ?? 0) > 0) validDbNames.add("DB_FaultData");

      const globalDbArtifacts = deviceArtifacts
        .filter(a => a.type === "DB" && !a.name.startsWith(parseGeneralRules(profile.general_rules).naming.instance_db_prefix || "Inst") && a.name !== "Inputs" && a.name !== "Outputs");
      // Only include ProcessCommands and HmiData — these are what process code reads/writes.
      // Skip Configuration and other DBs to save prompt space.
      const relevantDbs = globalDbArtifacts.filter(a =>
        /ProcessCommands|HmiData/i.test(a.name),
      );
      const globalDbSchemas = (relevantDbs.length > 0 ? relevantDbs : globalDbArtifacts.slice(0, 2))
        .map(a => a.content)
        .join("\n\n");

      // Reference library lookup — context from sequence description + device types
      let refSectionsText = "";
      try {
        const seqDesc = `Process sequence: ${sequence.name}\n${(sequence.steps ?? []).map(s => s.action).join("\n")}`;
        const refSections = await getRelevantReferenceSections(
          seqDesc, "generation_request", "SIEMENS_TIA", abort.signal, 15,
        );
        refSectionsText = formatReferenceSections(refSections, isLad ? "LAD" : "SCL");
      } catch { /* reference lookup is best-effort */ }

      // Format agent knowledge docs
      const knowledgeText = agentKnowledgeDocs?.length
        ? agentKnowledgeDocs.map(d => `### ${d.title}\n${d.content}`).join("\n\n---\n\n")
        : "";

      const processRules = loadPlatformRules("forge_process");
      console.log(`[forge-process] Context sizes: platformRules=${(processRules.length/1024).toFixed(1)}KB, fbInterfaces=${(fbInterfaces.length/1024).toFixed(1)}KB, globalDbSchemas=${(globalDbSchemas.length/1024).toFixed(1)}KB, patterns=${patterns.length} items, profile.general_rules=${((profile.general_rules ?? "").length/1024).toFixed(1)}KB, profile.process_rules=${(JSON.stringify(profile.process_rules ?? "").length/1024).toFixed(1)}KB, refSections=${(refSectionsText.length/1024).toFixed(1)}KB, agentKnowledge=${(knowledgeText.length/1024).toFixed(1)}KB`);

      const context: ProcessGenContext = {
        profile,
        platformRules: loadPlatformRules("forge_process"),
        patterns,
        deviceFbInterfaces: fbInterfaces,
        specAnalysis: session.spec_analysis as SpecAnalysis | undefined,
        linkageMatrix: matrix ?? undefined,
        globalDbSchemas: globalDbSchemas || undefined,
        dbNameMap: buildDbNameMap(deviceArtifacts),
        referenceSections: refSectionsText || undefined,
        agentKnowledgeDocs: knowledgeText || undefined,
        instructions: ladInstructions,
      };

      let systemPrompt: string;
      let userMessage: string;

      if (isLad) {
        systemPrompt = buildProcessLadPrompt(context, promptSections);
        if (matrixSequence) {
          const stepsText = matrixSequence.rows?.length
            ? buildStepsSectionFromRows(matrixSequence.rows)
            : (matrixSequence.steps ?? []).map(s => `Step ${s.stepNumber}: ${(s.actions ?? []).map(a => a.description).join(", ")}`).join("\n");
          const faultDbRef = (faultSpec ?? []).length > 0
            ? `\n\n**Fault handling is in a SEPARATE Fault FC — do NOT include fault detection/latching rungs.**\nThe sequence should read "DB_FaultData".faultActive to halt on fault, but NOT write to DB_FaultData.\nFault tags: ${(faultSpec ?? []).map((f: FaultEntry) => `"DB_FaultData".${f.tag}`).join(", ")}`
            : "";
          const dbNameRef = stepActionDbName
            ? `\n\n**Step/Action DB name: "${stepActionDbName}"**\nUse EXACTLY this name for all step and action references: "${stepActionDbName}".S[n] and "${stepActionDbName}".A[n].\nDo NOT abbreviate or rename the DB.`
            : "";
          userMessage = `Generate the LAD JSON (LadProgram format) for: ${matrixSequence.name}

${matrixSequence.description}

Steps:
${stepsText}${faultDbRef}${dbNameRef}

${filteredTags || ""}

IMPORTANT: Output ONLY the raw JSON object with "name", "blockType", "variables", and "rungs" arrays. Do NOT output SCL code. Do NOT mix formats. Use ONLY the tags listed in VALID TAGS above.`;
        } else {
          userMessage = `Generate the LAD JSON (LadProgram format) for: ${sequence.name}

Steps:
${(sequence.steps ?? []).map((s) => `Step ${s.step_number}: ${s.action} → Done when: ${s.completion_criteria}`).join("\n")}

IMPORTANT: Output ONLY the raw JSON object with "name", "blockType", "variables", and "rungs" arrays. Do NOT output SCL code.`;
        }
      } else {
        systemPrompt = buildProcessSclPrompt(context, promptSections);
        // Use matrix sequence if available — it has richer structured data
        if (matrixSequence) {
          const permissives = (matrixSequence.permissives ?? []).length > 0
            ? `\n**Permissives (must be true before starting):**\n${(matrixSequence.permissives ?? []).map(p => `  - ${p.description ?? ""}${p.deviceName ? ` (${p.deviceName})` : ""}${!p.polarity ? " [active LOW — check for FALSE]" : ""}`).join("\n")}`
            : "";
          const safety = (matrixSequence.safetyConditions ?? []).length > 0
            ? `\n**Safety Conditions (halt to safe state if violated):**\n${(matrixSequence.safetyConditions ?? []).map(s => `  - ${s.description ?? ""}${s.deviceName ? ` (${s.deviceName})` : ""}${!s.polarity ? " [active LOW — halt when FALSE]" : ""}`).join("\n")}`
            : "";

          let stepsSection: string;

          if (matrixSequence.rows && matrixSequence.rows.length > 0) {
            // Preferred path: use engineer-reviewed SequenceRow[] format
            stepsSection = buildStepsSectionFromRows(matrixSequence.rows);
          } else {
            // Fallback: legacy ProcessStep[] format
            stepsSection = (matrixSequence.steps ?? []).map(s => {
              const actions = (s.actions ?? []).map(a => `    Action: ${a.description ?? ""}${a.deviceName ? ` [${a.deviceName}]` : ""}`).join("\n");
              const conditions = (s.transition?.conditions ?? []).map(c => `      - ${c.description ?? ""}${c.deviceName ? ` [${c.deviceName}]` : ""}`).join("\n");
              return `  Step ${s.stepNumber ?? "?"}:\n${actions || "    (no actions)"}\n    Done when (${s.transition?.combinator ?? "AND"}):\n${conditions || "      (no conditions)"}`;
            }).join("\n");
          }

          userMessage = `Generate the SCL process FB/FC for this sequence:

**Sequence name:** ${matrixSequence.name}
**Description:** ${matrixSequence.description}
${permissives}${safety}

**Steps (engineer-confirmed from Matrix Review):**
${stepsSection}

Generate a complete, compile-ready FB (or FC if purely stateless) using the code structure pattern defined in the system prompt.
Output MUST use the tagged fenced block format: \`\`\`scl [FB:${matrixSequence.name}] ... \`\`\``;
        } else {
          userMessage = buildProcessSclUserMessage(sequence, devices);
        }
      }

      // Cap system prompt — strip large sections if over limit, preserve output format
      const MAX_SYSTEM_CHARS = 40 * 1024;
      if (systemPrompt.length > MAX_SYSTEM_CHARS) {
        // Preserve the output format section (last ~1KB) — without it, parsing fails
        const outputFormatIdx = systemPrompt.lastIndexOf("## Output Format");
        const tail = outputFormatIdx > 0 ? systemPrompt.slice(outputFormatIdx) : "";
        let head = outputFormatIdx > 0 ? systemPrompt.slice(0, outputFormatIdx) : systemPrompt;

        // Drop sections by priority: Platform Rules > Global DB Schemas > Device FB Interfaces
        const sectionsToStrip = ["## Platform Rules", "## Global DB Schemas", "## Device FB Interfaces"];
        for (const section of sectionsToStrip) {
          if (head.length + tail.length <= MAX_SYSTEM_CHARS) break;
          const idx = head.indexOf(section);
          if (idx > 0) {
            const nextSection = head.indexOf("\n## ", idx + 20);
            if (nextSection > 0) {
              head = head.slice(0, idx) + head.slice(nextSection);
            }
          }
        }

        systemPrompt = head.length + tail.length <= MAX_SYSTEM_CHARS
          ? head + tail
          : head.slice(0, MAX_SYSTEM_CHARS - tail.length - 100) + "\n\n" + tail;
      }

      console.log(`[forge-process] Prompt size: system=${(systemPrompt.length / 1024).toFixed(1)}KB, user=${(userMessage.length / 1024).toFixed(1)}KB, total=${((systemPrompt.length + userMessage.length) / 1024).toFixed(1)}KB`);

      // LAD JSON is very verbose — needs more tokens than SCL
      const maxTokens = isLad ? 32768 : PROCESS_GEN_MAX_TOKENS;

      const { content } = await validateAndCall(
        callStreamingCollect,
        systemPrompt,
        [{ role: "user", content: userMessage }],
        abort.signal,
        maxTokens,
        isLad ? "process_lad" : "process_scl",
        !!profile,
        { prompt_name: "forge-process-generate", agent_role: isLad ? "process_lad" : "process_scl", pipeline_step: "process_generate" },
      );

      if (isLad) {
        console.log(`[forge-process] LAD response (first 500 chars):`, content.slice(0, 500));
        const artifact = parseLadArtifact(content, sequence.name);
        if (artifact) {
          const parsedProgram = JSON.parse(artifact.content);
          const validation = validateLadProgram(parsedProgram, {
            validDbNames: [...validDbNames],
            allowedElementTypes: (ladInstructions ?? []).map((instruction) => instruction.element_type),
          });
          const blockingIssues = validation.issues.filter((issue) => issue.severity === "error");
          if (blockingIssues.length > 0) {
            throw new Error(
              `Generated LAD failed validation:\n${blockingIssues.slice(0, 6).map((issue) => `- ${issue.message}`).join("\n")}`,
            );
          }
          return [artifact];
        }
        console.warn(`[forge-process] LAD parse failed for ${sequence.name} — response length: ${content.length}`);
        // AI didn't produce valid JSON — fall through to SCL parsing as fallback
      }

      const parsed = parseSclArtifacts(content);
      if (parsed.length > 0) return parsed;

      // Fallback 1: AI didn't use the [TYPE:Name] tag — extract any fenced SCL block (with closing fence)
      const fallbackRe = /```(?:scl)?\s*\n([\s\S]*?)```/gi;
      const fallbackMatch = fallbackRe.exec(content);
      if (fallbackMatch) {
        const code = fallbackMatch[1].trim();
        if (code.length > 50) {
          const isFb = /\bFUNCTION_BLOCK\b/i.test(code);
          return [{
            id: crypto.randomUUID(),
            name: (matrixSequence?.name ?? sequence.name).replace(/\s+/g, "_"),
            type: isFb ? "FB" : "FC" as ForgeArtifact["type"],
            language: "SCL",
            content: code,
            approved: false,
            stage: "process",
            destination_folder: "Program blocks/Forge/Process",
            dependencies: [],
            compile_after_import: true,
          }];
        }
      }

      // Fallback 2: truncated response — opening fence exists but no closing fence
      const truncatedMatch = /```(?:scl)?\s*(?:\[[^\]]+\])?\s*\n([\s\S]+)$/i.exec(content);
      if (truncatedMatch) {
        const code = truncatedMatch[1].trim();
        if (code.length > 50) {
          const isFb = /\bFUNCTION_BLOCK\b/i.test(code);
          return [{
            id: crypto.randomUUID(),
            name: (matrixSequence?.name ?? sequence.name).replace(/\s+/g, "_"),
            type: isFb ? "FB" : "FC" as ForgeArtifact["type"],
            language: "SCL",
            content: code,
            approved: false,
            stage: "process",
            destination_folder: "Program blocks/Forge/Process",
            dependencies: [],
            compile_after_import: true,
          }];
        }
      }

      // Fallback 3: no fences at all — if the response looks like raw SCL, capture it
      if (/\bFUNCTION_BLOCK\b|\bFUNCTION\b/i.test(content) && content.trim().length > 50) {
        const isFb = /\bFUNCTION_BLOCK\b/i.test(content);
        return [{
          id: crypto.randomUUID(),
          name: (matrixSequence?.name ?? sequence.name).replace(/\s+/g, "_"),
          type: isFb ? "FB" : "FC" as ForgeArtifact["type"],
          language: "SCL",
          content: content.trim(),
          approved: false,
          stage: "process",
          destination_folder: "Program blocks/Forge/Process",
          dependencies: [],
          compile_after_import: true,
        }];
      }

      return [];
    },
    [],
  );

  const generateAll = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile,
      patterns: PatternCandidate[],
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);

      const specAnalysis = session.spec_analysis as SpecAnalysis | null;
      const specSequences = specAnalysis?.process_sequences ?? [];
      const devices = (session.device_list as ForgeDeviceEntry[]) ?? [];
      const matrix = session.linkage_matrix as ProcessLinkageMatrix | null;
      const matrixSequences = matrix?.processSequences ?? [];
      const faultMatrix = matrix?.faultMatrix ?? [];

      // Matrix sequences are engineer-confirmed (Matrix Review step) — always prefer them.
      // Fall back to spec analysis sequences only if the matrix has none.
      const useMatrixAsPrimary = matrixSequences.length > 0;

      // Total = sequences + OB1 Main (deterministic, no AI step)
      const totalSteps = (useMatrixAsPrimary ? matrixSequences.length : specSequences.length) + 1;
      setProgress({ current: 0, total: totalSteps, currentSequence: "" });

      const allArtifacts: ForgeArtifact[] = [];
      console.log(`[forge-process] Loaded ${faultMatrix.length} deterministic faults from linkage matrix`);
      /*

      // Derive fault spec from matrix — clean fault categories, not raw text dumps.
      // Each fault is a distinct failure mode with a short tag name.
      if (false) {
        let fc = 1;
        const add = (tag: string, desc: string, source: string) => {
          if (derivedFaults.some(f => f.tag === tag)) return; // deduplicate
          derivedFaults.push({ code: `F${String(fc++).padStart(3, "0")}`, tag, description: desc, source });
        };

        // 1. System-level faults (always present)
        add("faultEStop", "E-Stop activated", "System");

        // 2. Device-derived faults
        for (const d of devices) {
          const isMotor = /motor|vfd|dol/i.test(d.device_type);
          if (isMotor) {
            add("faultOverload", "Motor overload tripped", "Device");
            add("faultRunFeedbackTimeout", "Run feedback timeout — motor did not confirm run", "Device");
            add("faultStopFeedbackTimeout", "Stop feedback timeout — welded contactor suspected", "Device");
            break; // one set of motor faults covers all motors
          }
        }

        // 3. Sequence-derived faults — scan safety conditions for unique fault types
        for (const seq of (useMatrixAsPrimary ? matrixSequences : [])) {
          for (const sc of (seq.safetyConditions ?? [])) {
            const desc = sc.description.trim();
            // Skip if already covered by system/device faults
            if (/e.?stop/i.test(desc)) continue;
            if (/overload/i.test(desc)) continue;
            // Derive a clean tag from the device name or short description
            const shortName = (sc.deviceName ?? desc.slice(0, 20)).replace(/[^A-Za-z0-9]/g, "");
            add(`fault${shortName}`, desc, seq.name);
          }
        }

        // 4. Permissive failure (if any sequence has permissives)
        const hasPermissives = (useMatrixAsPrimary ? matrixSequences : []).some(s => (s.permissives ?? []).length > 0);
        if (hasPermissives) {
          add("faultPermissiveFail", "Permissive condition failed during run", "System");
        }

        console.log(`[forge-process] Derived ${derivedFaults.length} faults:`, derivedFaults.map(f => `${f.code}=${f.tag}`).join(", "));
      }

      // Parse process rules early — needed to derive DB names before generation
      */
      let processSchema = null;
      try {
        if (profile.process_rules && typeof profile.process_rules === "string") {
          processSchema = parseProcessRules(profile.process_rules);
        }
      } catch { /* ignore */ }

      // Pre-compute step/action DB names so AI uses exact names
      const stepActionDbNames = new Map<string, string>();
      if (processSchema?.step_action_db?.enabled) {
        const pattern = processSchema.step_action_db.db_name_pattern || "STEPS_ACTIONS_{SECTION}_DB";
        const allSeqs = useMatrixAsPrimary ? matrixSequences : specSequences;
        for (const seq of allSeqs) {
          const seqName = ('name' in seq ? seq.name : (seq as SpecAnalysisProcessSequence).name)
            .replace(/[^A-Za-z0-9_\s]/g, "").replace(/\s+/g, "_").toUpperCase();
          stepActionDbNames.set(seq.name ?? seqName, pattern.replace("{SECTION}", seqName));
        }
      }

      const devArtifacts = (session.device_artifacts as ForgeArtifact[]) ?? [];

      try {
        // Step 1: Generate all sequence FBs/FCs
        if (useMatrixAsPrimary) {
          // Primary path: drive generation from matrix sequences (engineer-confirmed structure)
          for (let i = 0; i < matrixSequences.length; i++) {
            const matrixSeq = matrixSequences[i];
            setProgress({
              current: i + 1,
              total: totalSteps,
              currentSequence: matrixSeq.name,
            });
            // Find matching spec sequence for any extra context (e.g. high-level description)
            const specSeq = specSequences.find(s =>
              s.name === matrixSeq.name || matrixSeq.name.toLowerCase().includes((s.name ?? "").slice(0, 15).toLowerCase()),
            );
            // Build a minimal SpecAnalysisProcessSequence stub from the matrix sequence if no spec match
            const seqStub: SpecAnalysisProcessSequence = specSeq ?? {
              name: matrixSeq.name,
              subsystem: matrixSeq.description ?? "",
              permissives: [],
              steps: (matrixSeq.steps ?? []).map(s => ({
                step_number: s.stepNumber ?? 0,
                action: (s.actions ?? []).map(a => a.description ?? "").join("; "),
                completion_criteria: (s.transition?.conditions ?? []).map(c => c.description ?? "").join("; "),
              })),
            };
            // Collect device names from matrix rows for this sequence
            const seqDeviceNames = [...new Set((matrixSeq.rows ?? []).flatMap(r => r.devices ?? []))];
            const seqTags = buildFilteredTagDictionary(devArtifacts, matrix, seqDeviceNames, stepActionDbNames.get(matrixSeq.name), []);
            console.log(`[forge-process] Tags for ${matrixSeq.name}: ${seqDeviceNames.length} devices, ${(seqTags.length / 1024).toFixed(1)}KB`);
            const artifacts = await generateSequence(seqStub, session, profile, patterns, matrixSeq, [], stepActionDbNames.get(matrixSeq.name), seqTags);
            allArtifacts.push(...artifacts);
          }
        } else {
          // Fallback path: spec analysis sequences (no engineer-confirmed matrix)
          for (let i = 0; i < specSequences.length; i++) {
            const seq = specSequences[i];
            setProgress({
              current: i + 1,
              total: totalSteps,
              currentSequence: seq.name,
            });
            // Fallback path — no device filtering, include all
            const fallbackTags = buildFilteredTagDictionary(devArtifacts, matrix, [], stepActionDbNames.get(seq.name), []);
            const artifacts = await generateSequence(seq, session, profile, patterns, undefined, [], stepActionDbNames.get(seq.name), fallbackTags);
            allArtifacts.push(...artifacts);
          }
        }

        // Step 1b: Generate step/action DBs if pattern enabled (deterministic — no AI call)
        if (processSchema?.step_action_db?.enabled) {
          const { step_array_name, action_array_name } = processSchema.step_action_db;
          const S = step_array_name || "S";
          const A = action_array_name || "A";

          // Create step/action DBs using pre-computed names
          console.log("[forge-process] stepActionDbNames:", JSON.stringify([...stepActionDbNames]));
          console.log("[forge-process] allArtifacts (LAD FC/FB):", allArtifacts.filter(a => a.language === "LAD" && (a.type === "FC" || a.type === "FB")).map(a => a.name));
          for (const [seqName, dbName] of stepActionDbNames) {
            // Find the matching LAD artifact to scan for max step index
            const normalize = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
            const artifact = allArtifacts.find(a =>
              a.language === "LAD" && (a.type === "FC" || a.type === "FB") &&
              (a.name === seqName || normalize(a.name) === normalize(seqName)),
            );
            if (!artifact) {
              console.warn(`[forge-process] No LAD artifact found for sequence "${seqName}" (normalized: ${normalize(seqName)})`);
              continue;
            }
            console.log(`[forge-process] Generating DB "${dbName}" from artifact "${artifact.name}"`);


            // Scan the JSON content for highest step/action index
            const content = artifact.content;
            const stepRe = new RegExp(`${S.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]`, "g");
            const actionRe = new RegExp(`${A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]`, "g");
            let maxStep = 0;
            let match: RegExpExecArray | null;
            while ((match = stepRe.exec(content)) !== null) maxStep = Math.max(maxStep, parseInt(match[1], 10));
            while ((match = actionRe.exec(content)) !== null) maxStep = Math.max(maxStep, parseInt(match[1], 10));

            const arraySize = maxStep + 1;

            // Scan for timer instances (instStepTimer_N) referenced in the LAD JSON
            const timerRe = /instStepTimer_(\d+)/g;
            const timerSteps = new Set<number>();
            let tm: RegExpExecArray | null;
            while ((tm = timerRe.exec(content)) !== null) timerSteps.add(parseInt(tm[1], 10));

            const timerDecls = [...timerSteps].sort((a, b) => a - b)
              .map(n => `    instStepTimer_${n} : TON;   // Timeout timer for step ${n}`)
              .join("\n");

            const dbCode = `DATA_BLOCK "${dbName}"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

  VAR
    ${S} : Array[0..${arraySize - 1}] of Bool;   // Step activation bits
    ${A} : Array[0..${arraySize - 1}] of Bool;   // Action activation bits
${timerDecls ? timerDecls + "\n" : ""}  END_VAR

BEGIN

END_DATA_BLOCK`;

            allArtifacts.push({
              id: crypto.randomUUID(),
              name: dbName,
              type: "DB",
              language: "SCL",
              content: dbCode,
              approved: false,
              stage: "process",
              destination_folder: "Program blocks/Forge/Process",
              dependencies: [],
              compile_after_import: false,
              deterministic: true,
            });
          }
        }

        // Step 1c: Generate Fault DB + Fault FC
        const hasDeterministicFaults = processSchema?.step_action_db?.enabled && faultMatrix.length > 0;
        if (hasDeterministicFaults) {
          setProgress({
            current: (useMatrixAsPrimary ? matrixSequences.length : specSequences.length) + 1,
            total: totalSteps + 1,
            currentSequence: "Fault Handler",
          });

          allArtifacts.push(buildDeterministicFaultDb(faultMatrix));
          const devArtifactsForTypes = (session.device_artifacts as ForgeArtifact[]) ?? [];
          const faultArtifact = compileDeterministicFaultArtifact({
            faults: faultMatrix,
            language: session.process_code_language ?? profile.process_code_language ?? "SCL",
            operandTypes: buildOperandTypeMap(devArtifactsForTypes),
          });
          if (faultArtifact) {
            allArtifacts.push(faultArtifact);
          }
        }

        // Step 1d: Log missing DB references (for diagnostics — compile will catch real issues)
        {
          const ladArtifacts = allArtifacts.filter(a => a.language === "LAD");
          const existingDbNames = new Set(
            [...allArtifacts, ...((session.device_artifacts as ForgeArtifact[]) ?? [])]
              .filter(a => a.type === "DB")
              .map(a => a.name),
          );

          const referencedDbs = new Set<string>();
          for (const artifact of ladArtifacts) {
            const refRe = /"?([A-Za-z_]\w*)"?\.[A-Za-z_]\w*/g;
            let m: RegExpExecArray | null;
            while ((m = refRe.exec(artifact.content)) !== null) {
              const dbName = m[1];
              if (/^(inst|stat|temp|Inst|type|TON|TOF|CTU|CTD)/.test(dbName)) continue;
              if (/^[SA]$/.test(dbName)) continue;
              referencedDbs.add(dbName);
            }
          }

          const missingDbs = [...referencedDbs].filter(db =>
            !existingDbNames.has(db) && !existingDbNames.has(`DB_${db}`) && !existingDbNames.has(db.replace(/^DB_/, "")),
          );
          if (missingDbs.length > 0) {
            console.warn(`[forge-process] Referenced DBs not found in artifacts: ${missingDbs.join(", ")}. These must exist in the TIA project or be created in the device code step.`);
          }
        }

        // Step 2: Generate OB1 Main (deterministic — no AI call)
        setProgress({
          current: (useMatrixAsPrimary ? matrixSequences.length : specSequences.length) + 1 + (hasDeterministicFaults ? 1 : 0),
          total: totalSteps + (hasDeterministicFaults ? 1 : 0),
          currentSequence: "OB1 Main",
        });

        // Derive device call FC names from device list in correct call order
        const generalRules = parseGeneralRules(profile.general_rules);
        const fcPrefix = generalRules.naming.fc_prefix || profile.naming_prefix || "";
        const ioLinkingFcName = fcPrefix ? `${fcPrefix}IoLinking` : "IoLinking";

        const uniqueDeviceTypes = [
          ...new Set(devices.map((d) => d.device_type)),
        ].sort((a, b) => getDeviceCallOrder(a) - getDeviceCallOrder(b));
        const deviceCallFcNames = uniqueDeviceTypes.map((dt) =>
          deviceTypeToFcName(dt, fcPrefix || undefined),
        );

        // Sequence FBs/FCs generated in Step 1 — call them directly from Main
        // Replace spaces with underscores — TIA doesn't allow spaces in block names
        const sequenceFcNames = allArtifacts
          .filter((a) => a.type === "FC" || a.type === "FB")
          .map((a) => a.name.replace(/\s+/g, "_"));

        const typeConvertFcName = fcPrefix ? `${fcPrefix}TypeConvert` : "FC_TypeConvert";
        const ob1Code = generateOb1Main(deviceCallFcNames, sequenceFcNames, ioLinkingFcName, typeConvertFcName);
        allArtifacts.push({
          id: crypto.randomUUID(),
          name: "Main",
          type: "OB",
          language: "SCL",
          content: ob1Code,
          approved: false,
          stage: "process",
          destination_folder: "Program blocks",
          dependencies: [],
          compile_after_import: true,
          deterministic: true,
        });

        // Final reconciliation: scan all process FCs for DB.field references
        // and add any missing fields to the corresponding DB artifacts.
        // Include device artifacts so device-step DBs (DB_ProcessState, etc.) get updated too.
        reconcileProcessDbFields(allArtifacts, devArtifacts);

        return allArtifacts;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [generateSequence],
  );

  return { generateAll, generateSequence, loading, progress, error };
}
