import { useCallback, useRef } from "react";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import type { ProcessQaMessage } from "@/stores/process-builder-store";
import { buildProcessQaPrompt } from "@/lib/process-qa-prompt";
import type { PipelineStepResult } from "@/lib/pipeline";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import { useUpdateProcessBuilderSession } from "@/hooks/use-process-builder-session";
import type {
  Project,
  Agent,
  DesignProfile,
  AgentKnowledgeDoc,
  FbTemplate,
  IoRecommendation,
  FbRecommendation,
  ProcessLinkageMatrix,
  ProcessSequence,
  ProcessStep,
  ProcessAction,
  ProcessPermissive,
  SafetyCondition,
  TransitionCondition,
  TransitionSubCondition,
  FbWire,
} from "@/types";

// ---------------------------------------------------------------------------
// Legacy parsers (backward compat with old PM instructions)
// ---------------------------------------------------------------------------

/** Parse [IO_RECOMMENDATION]...[/IO_RECOMMENDATION] blocks from PM response. */
function parseIoRecommendations(text: string): IoRecommendation[] {
  const recs: IoRecommendation[] = [];
  const regex = /\[IO_RECOMMENDATION\]([\s\S]*?)\[\/IO_RECOMMENDATION\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const mlfb = block.match(/mlfb:\s*(.+)/i)?.[1]?.trim() ?? "";
    const rack = parseInt(block.match(/rack:\s*(\d+)/i)?.[1] ?? "0", 10);
    const slot = parseInt(block.match(/slot:\s*(\d+)/i)?.[1] ?? "0", 10);
    const description = block.match(/description:\s*(.+)/i)?.[1]?.trim() ?? "";
    if (mlfb) {
      recs.push({ mlfb, rack, slot, description, confirmed: false });
    }
  }
  return recs;
}

/** Parse [FB_RECOMMENDATION]...[/FB_RECOMMENDATION] blocks from PM response. */
function parseFbRecommendations(text: string): FbRecommendation[] {
  const recs: FbRecommendation[] = [];
  const regex = /\[FB_RECOMMENDATION\]([\s\S]*?)\[\/FB_RECOMMENDATION\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const deviceType = block.match(/deviceType:\s*(.+)/i)?.[1]?.trim() ?? "";
    const templateName = block.match(/templateName:\s*(.+)/i)?.[1]?.trim() ?? "";
    const templateIdRaw = block.match(/templateId:\s*(.+)/i)?.[1]?.trim() ?? "null";
    const templateId = templateIdRaw === "null" ? null : templateIdRaw;
    const instanceCount = parseInt(block.match(/instanceCount:\s*(\d+)/i)?.[1] ?? "1", 10);
    if (deviceType) {
      recs.push({ deviceType, templateId, templateName, instanceCount, confirmed: false });
    }
  }
  return recs;
}

// ---------------------------------------------------------------------------
// New matrix parser
// ---------------------------------------------------------------------------

/** Parse [PROCESS_MATRIX]...[/PROCESS_MATRIX] JSON from PM response. */
// ---------------------------------------------------------------------------
// Helper: convert PM's alternative "instances + ioTags" schema to deviceLinkage
// The PM sometimes produces a richer format with `instances`, `ioTags`,
// `functionBlocks`, `globalDBs`, `ob1CallSequence` instead of the expected
// `deviceLinkage`, `globalData`, `processSteps`.
// ---------------------------------------------------------------------------

type RawObj = Record<string, unknown>;
type RawArr = Array<RawObj>;

/** Classify a wiring source value into a wire type. */
function classifyWireSource(source: string, ioTagNames: Set<string>, instanceNames: Set<string>): "fb" | "io" | "global" | "constant" {
  if (ioTagNames.has(source)) return "io";
  const dotIdx = source.indexOf(".");
  if (dotIdx > 0) {
    const prefix = source.substring(0, dotIdx);
    if (instanceNames.has(prefix)) return "fb";
    return "global";
  }
  // Constant patterns: T#, numbers, booleans
  if (/^(T#|t#|\d|TRUE|FALSE|true|false|16#)/i.test(source)) return "constant";
  // Fallback: if it looks like a tag name, treat as IO
  if (/^(tag_|di_|dq_|ai_|aq_)/i.test(source)) return "io";
  return "io";
}

function convertAlternativeSchema(raw: RawObj): {
  control_modules: RawArr;
  globalData: RawArr;
  processSteps: RawArr;
} {
  // Collect instance entries from any key the PM might use
  const instances = [
    ...((raw.instances ?? []) as RawArr),
    ...((raw.instanceDBs ?? raw.instanceDbs ?? raw.instance_dbs ?? []) as RawArr),
  ];
  const ioTags = (raw.ioTags ?? raw.io_tags ?? []) as RawArr;
  const ioTagNames = new Set(ioTags.map((t) => (t.tagName ?? t.tag_name ?? "") as string));

  // Collect all instance names for FB wire classification
  const instanceNames = new Set(instances.map((inst) =>
    (inst.instanceName ?? inst.dbName ?? inst.name ?? "") as string
  ));

  const callingFCs = (raw.callingFCs ?? raw.calling_fcs ?? raw.functionControls ?? []) as RawArr;

  // Build wiring per instance from callingFCs inputs/outputs
  const wiringByInstance = new Map<string, RawArr>();
  for (const fc of callingFCs) {
    const calls = (fc.calls ?? []) as RawArr;
    for (const call of calls) {
      const instName = (call.instance ?? call.instanceName ?? "") as string;
      if (!instName) continue;
      if (!wiringByInstance.has(instName)) wiringByInstance.set(instName, []);
      const wires = wiringByInstance.get(instName)!;
      // Inputs
      if (call.inputs && typeof call.inputs === "object") {
        for (const [param, val] of Object.entries(call.inputs as Record<string, unknown>)) {
          const source = String(val ?? "");
          wires.push({
            param,
            direction: "in",
            source,
            type: classifyWireSource(source, ioTagNames, instanceNames),
          });
        }
      }
      // Outputs
      if (call.outputs && typeof call.outputs === "object") {
        for (const [param, val] of Object.entries(call.outputs as Record<string, unknown>)) {
          const source = String(val ?? "");
          wires.push({
            param,
            direction: "out",
            source,
            type: classifyWireSource(source, ioTagNames, instanceNames),
          });
        }
      }
    }
  }

  // If no instances exist, fall back to functionBlocks as device types
  const fbList = (raw.functionBlocks ?? raw.function_blocks ?? []) as RawArr;

  // Convert instances → deviceLinkage entries
  let control_modules: RawArr;
  if (instances.length > 0) {
    control_modules = instances.map((inst) => {
      const instName = (inst.instanceName ?? inst.dbName ?? inst.name ?? "") as string;
      const fbName = (inst.fbName ?? inst.instanceOf ?? inst.fb ?? "") as string;
      const wires = wiringByInstance.get(instName) ?? [];

      // If no wiring from callingFCs, convert ioTags assigned to this instance as IO wires
      if (wires.length === 0) {
        const deviceRef = (inst.deviceRef ?? "") as string;
        for (const tag of ioTags) {
          const tagName = (tag.tagName ?? tag.tag_name ?? "") as string;
          const tagDevRef = (tag.deviceRef ?? "") as string;
          if (tagDevRef === deviceRef && deviceRef) {
            const sigType = (tag.type ?? tag.ioType ?? tag.signalType ?? "DI") as string;
            wires.push({
              param: tagName,
              direction: sigType === "DI" || sigType === "AI" ? "in" : "out",
              source: tagName,
              type: "io",
            });
          }
        }
      }

      return {
        name: instName,
        deviceType: fbName,
        description: (inst.description ?? `Instance of ${fbName}`) as string,
        wiring: wires,
        fbName,
        fbTemplateName: (inst.template ?? inst.templateId ?? null) as string | null,
        fbTemplateId: null,
        instanceDbName: instName,
        interlocks: [],
      };
    });
  } else if (fbList.length > 0) {
    // No instances — use functionBlocks as device types
    control_modules = fbList.map((fb) => ({
      name: fb.blockName ?? fb.name ?? "",
      deviceType: fb.blockType ?? "FB",
      description: (fb.description ?? "") as string,
      wiring: [],
      fbName: fb.blockName ?? fb.name ?? "",
      fbTemplateName: fb.templateId ?? fb.template ?? null,
      fbTemplateId: null,
      instanceDbName: "",
      interlocks: [],
    }));
  } else {
    control_modules = [];
  }

  // Convert globalDBs → globalData
  const globalDBs = (raw.globalDBs ?? raw.globalDbs ?? raw.global_dbs ?? []) as RawArr;
  const globalData: RawArr = globalDBs.map((gdb) => ({
    dbName: gdb.dbName ?? gdb.name ?? "",
    purpose: gdb.description ?? gdb.purpose ?? "",
    fields: ((gdb.variables ?? gdb.fields ?? []) as RawArr).map((v) => ({
      fieldName: v.name ?? v.fieldName ?? "",
      dataType: v.dataType ?? v.type ?? "",
      description: v.description ?? "",
    })),
  }));

  // Convert ob1CallSequence or callingFCs → processSteps
  const callSeq = (raw.ob1CallSequence ?? raw.callSequence ?? raw.call_sequence ?? []) as RawArr;
  let processSteps: RawArr;
  if (callSeq.length > 0) {
    processSteps = callSeq.map((cs, i) => ({
      stepNumber: cs.order ?? i + 1,
      action: `Call ${cs.block ?? cs.name ?? ""}`,
      completionCriteria: (cs.description ?? "") as string,
      control_modulesInvolved: ((cs.calls ?? []) as string[]),
      notes: "",
    }));
  } else if (callingFCs.length > 0) {
    // Use callingFCs as process steps
    processSteps = callingFCs.map((fc, i) => ({
      stepNumber: i + 1,
      action: `Call ${(fc.fcName ?? fc.name ?? "") as string}`,
      completionCriteria: (fc.description ?? "") as string,
      control_modulesInvolved: ((fc.calls ?? []) as RawArr).map((c) => (c.instance ?? c.name ?? "") as string),
      notes: "",
    }));
  } else {
    processSteps = [];
  }

  return { control_modules, globalData, processSteps };
}

/** Parse a single transition condition from raw PM data. */
function parseTransitionCondition(raw: unknown): TransitionCondition {
  if (!raw || typeof raw !== "object") {
    // Plain string fallback — split on " AND " / " OR " if present
    const str = typeof raw === "string" ? raw : "";
    if (!str) return { combinator: "AND", conditions: [] };
    const andParts = str.split(/\s+AND\s+/i);
    const orParts = str.split(/\s+OR\s+/i);
    if (orParts.length > 1 && orParts.length >= andParts.length) {
      return {
        combinator: "OR",
        conditions: orParts.map((p) => ({ id: crypto.randomUUID(), description: p.trim(), deviceName: null })),
      };
    }
    if (andParts.length > 1) {
      return {
        combinator: "AND",
        conditions: andParts.map((p) => ({ id: crypto.randomUUID(), description: p.trim(), deviceName: null })),
      };
    }
    return {
      combinator: "AND",
      conditions: [{ id: crypto.randomUUID(), description: str, deviceName: null }],
    };
  }
  const obj = raw as RawObj;
  const combinator = ((obj.combinator ?? "AND") as string).toUpperCase() === "OR" ? "OR" as const : "AND" as const;
  const rawConds = (obj.conditions ?? obj.condition ?? []) as unknown;
  // Handle single condition string instead of array
  if (typeof rawConds === "string") {
    return parseTransitionCondition(rawConds);
  }
  const condArr = (Array.isArray(rawConds) ? rawConds : []) as unknown[];
  const conditions: TransitionSubCondition[] = condArr.map((c) => {
    if (typeof c === "string") {
      return { id: crypto.randomUUID(), description: c, deviceName: null };
    }
    const co = c as RawObj;
    return {
      id: (co.id as string) ?? crypto.randomUUID(),
      description: (co.description ?? co.condition ?? co.name ?? "") as string,
      deviceName: (co.deviceName ?? co.control_module_name ?? co.device ?? null) as string | null,
    };
  });
  return { combinator, conditions };
}

/** Parse actions array from raw PM data. Handles both object and string items. */
function parseActions(raw: unknown): ProcessAction[] {
  if (!raw || !Array.isArray(raw)) return [];
  return (raw as unknown[]).map((a) => {
    // PM sometimes outputs actions as plain strings
    if (typeof a === "string") {
      return { id: crypto.randomUUID(), description: a, deviceName: null };
    }
    const obj = a as RawObj;
    return {
      id: (obj.id as string) ?? crypto.randomUUID(),
      description: (obj.description ?? obj.action ?? obj.name ?? "") as string,
      deviceName: (obj.deviceName ?? obj.control_module_name ?? obj.device ?? null) as string | null,
    };
  });
}

/** Parse permissives from raw PM data. Handles both object and string items. */
function parsePermissives(raw: unknown): ProcessPermissive[] {
  if (!raw || !Array.isArray(raw)) return [];
  return (raw as unknown[]).map((p) => {
    if (typeof p === "string") {
      // Infer polarity: "X is not active" / "X inactive" → false
      const inactive = /\bnot\b|inactive|\boff\b/i.test(p);
      return { id: crypto.randomUUID(), description: p, deviceName: null, polarity: !inactive };
    }
    const obj = p as RawObj;
    return {
      id: (obj.id as string) ?? crypto.randomUUID(),
      description: (obj.description ?? obj.condition ?? obj.name ?? "") as string,
      deviceName: (obj.deviceName ?? obj.control_module_name ?? obj.device ?? null) as string | null,
      polarity: (obj.polarity ?? true) as boolean,
    };
  });
}

/** Parse safety conditions from raw PM data. Handles both object and string items. */
function parseSafetyConditions(raw: unknown): SafetyCondition[] {
  if (!raw || !Array.isArray(raw)) return [];
  return (raw as unknown[]).map((sc) => {
    if (typeof sc === "string") {
      return { id: crypto.randomUUID(), description: sc, deviceName: null, polarity: true };
    }
    const obj = sc as RawObj;
    return {
      id: (obj.id as string) ?? crypto.randomUUID(),
      description: (obj.description ?? obj.condition ?? obj.name ?? "") as string,
      deviceName: (obj.deviceName ?? obj.control_module_name ?? obj.device ?? null) as string | null,
      polarity: (obj.polarity ?? true) as boolean,
    };
  });
}

/** Parse a step with backward compat from flat action/completionCriteria. */
function parseStep(ps: RawObj): ProcessStep {
  // Structured transition: { combinator, conditions[] }
  const transition = ps.transition
    ? parseTransitionCondition(ps.transition)
    : parseTransitionCondition(ps.transitionCondition ?? ps.completionCriteria ?? ps.completion_criteria ?? ps.criteria ?? "");

  // Structured actions array — fallback from single "action" string
  let actions: ProcessAction[];
  if (ps.actions && Array.isArray(ps.actions)) {
    actions = parseActions(ps.actions);
  } else {
    const singleAction = (ps.action ?? ps.description ?? "") as string;
    actions = singleAction ? [{ id: crypto.randomUUID(), description: singleAction, deviceName: null }] : [];
  }

  return {
    id: ((ps.id ?? ps.stepId ?? ps.step_id) as string) ?? crypto.randomUUID(),
    stepNumber: (ps.stepNumber ?? ps.step_number ?? ps.stepId ?? ps.step_id ?? ps.step ?? ps.order ?? 0) as number,
    transition,
    actions,
    control_modulesInvolved: (ps.control_modulesInvolved ?? ps.control_modules_involved ?? ps.control_modules ?? ps.calls ?? []) as string[],
    notes: (ps.notes ?? ps.note ?? ps.desc ?? ps.description ?? "") as string,
  };
}

/** Wrap flat processSteps into a single "Main Sequence". */
function wrapFlatStepsIntoSequence(rawSteps: RawArr): ProcessSequence[] {
  if (rawSteps.length === 0) return [];
  return [{
    id: crypto.randomUUID(),
    name: "Main Sequence",
    description: "",
    permissives: [],
    safetyConditions: [],
    steps: rawSteps.map(parseStep),
  }];
}

/** Parse processSequences from raw PM data. */
function parseSequences(raw: RawArr): ProcessSequence[] {
  return raw.map((sq) => ({
    id: ((sq.id ?? sq.sequenceId ?? sq.sequence_id) as string) ?? crypto.randomUUID(),
    name: (sq.name ?? sq.sequenceId ?? sq.sequence_id ?? "Unnamed Sequence") as string,
    description: (sq.description ?? sq.desc ?? "") as string,
    permissives: parsePermissives(sq.permissives),
    safetyConditions: parseSafetyConditions(sq.safetyConditions ?? sq.safety_conditions ?? sq.safety),
    steps: ((sq.steps ?? []) as RawArr).map(parseStep),
  }));
}

/**
 * Attempt to repair truncated JSON (PM hit token limit mid-response).
 * Closes any open strings, arrays, and objects.
 */
function repairTruncatedJson(json: string): string {
  // Already valid?
  try { JSON.parse(json); return json; } catch { /* continue */ }

  let s = json.trimEnd();
  // Remove trailing comma
  s = s.replace(/,\s*$/, "");
  // Close any unterminated string
  const quoteCount = (s.match(/(?<!\\)"/g) ?? []).length;
  if (quoteCount % 2 !== 0) s += '"';
  // Count open brackets
  let braces = 0, brackets = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && (i === 0 || s[i - 1] !== "\\")) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  // Remove trailing comma again after potential quote fix
  s = s.replace(/,\s*$/, "");
  while (brackets > 0) { s += "]"; brackets--; }
  while (braces > 0) { s += "}"; braces--; }
  return s;
}

/**
 * Extract JSON from text. Tries multiple strategies:
 * 1. [PROCESS_MATRIX] tags
 * 2. ```json code fences containing matrix-like JSON
 * 3. First large JSON object in the text
 */
function extractMatrixJson(text: string): string | null {
  // Strategy 1: [PROCESS_MATRIX] tags
  const tagMatch = /\[PROCESS_MATRIX\]\s*([\s\S]*?)(?:\s*\[\/PROCESS_MATRIX\]|$)/.exec(text);
  if (tagMatch) {
    let jsonStr = tagMatch[1].trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    return jsonStr;
  }

  // Strategy 2: ```json code fence with matrix-like content
  const fenceMatch = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i.exec(text);
  if (fenceMatch) {
    const candidate = fenceMatch[1].trim();
    // Check it looks like a matrix (has deviceLinkage or instances or similar)
    if (/deviceLinkage|device_linkage|instances|instanceDBs|instanceDbs|functionBlocks/i.test(candidate)) {
      return candidate;
    }
  }

  // Strategy 3: Find a large JSON object that looks like a matrix
  // Look for { at beginning of line followed by matrix-like keys
  const rawMatch = /(\{[\s\S]*"(?:deviceLinkage|device_linkage|version|instances|instanceDBs)"[\s\S]*\})/.exec(text);
  if (rawMatch) {
    return rawMatch[1];
  }

  return null;
}

export function parseProcessMatrix(text: string): ProcessLinkageMatrix | null {
  const jsonStr = extractMatrixJson(text);
  if (!jsonStr) return null;

  try {
    // Try parsing as-is first, then attempt repair if truncated
    let raw: RawObj;
    try {
      raw = JSON.parse(jsonStr) as RawObj;
    } catch {
      const repaired = repairTruncatedJson(jsonStr);
      raw = JSON.parse(repaired) as RawObj;
    }

    // Try canonical keys first, then common alternatives (PM uses many variations)
    let control_modules = (raw.deviceLinkage ?? raw.control_modules ?? raw.device_linkage ?? raw.deviceList ?? raw.equipment ?? []) as RawArr;

    // globalData can be an array (correct) or an object with sub-keys like { dbs: [...], internalTags: [...] }
    const rawGlobalData = raw.globalData ?? raw.global_data ?? raw.globalDataBlocks ?? raw.globalDBs ?? raw.globalDbs ?? raw.global_dbs ?? [];
    let globalData: RawArr;
    if (Array.isArray(rawGlobalData)) {
      globalData = rawGlobalData as RawArr;
    } else if (typeof rawGlobalData === "object" && rawGlobalData !== null) {
      // PM used object format — convert dbs[] + internalTags[] into globalData entries
      const gdObj = rawGlobalData as RawObj;
      const dbs = (gdObj.dbs ?? gdObj.datablocks ?? []) as RawArr;
      const internalTags = (gdObj.internalTags ?? gdObj.internal_tags ?? gdObj.tags ?? []) as RawArr;
      globalData = dbs.map((db) => ({
        dbName: db.db ?? db.dbName ?? db.name ?? "",
        purpose: db.desc ?? db.description ?? db.purpose ?? "",
        fields: ((db.fields ?? db.variables ?? []) as RawArr),
      }));
      // If there are internalTags, add them as fields in a "ProcessData" DB
      if (internalTags.length > 0) {
        globalData.push({
          dbName: "ProcessData",
          purpose: "Internal process tags",
          fields: internalTags.map((t) => ({
            fieldName: (t.tag ?? t.name ?? t.tagName ?? "") as string,
            dataType: (t.type ?? t.dataType ?? "Bool") as string,
            description: (t.desc ?? t.description ?? "") as string,
          })),
        } as unknown as RawObj);
      }
      // If there are ioTags, add them as fields in an "IOTags" DB
      const ioTags = (gdObj.ioTags ?? gdObj.io_tags ?? []) as RawArr;
      if (ioTags.length > 0) {
        globalData.push({
          dbName: "IOTags",
          purpose: "IO tag definitions",
          fields: ioTags.map((t) => ({
            fieldName: (t.tag ?? t.name ?? t.tagName ?? "") as string,
            dataType: (t.type ?? t.dataType ?? "Bool") as string,
            description: `${(t.desc ?? t.description ?? "") as string} [${(t.address ?? "") as string}]`.trim(),
          })),
        } as unknown as RawObj);
      }
      // If there's a configDB, add it as a global DB entry
      const configDB = gdObj.configDB ?? gdObj.config_db ?? gdObj.configuration;
      if (configDB && typeof configDB === "object") {
        const cfg = configDB as RawObj;
        const entries = (cfg.entries ?? cfg.fields ?? cfg.variables ?? []) as RawArr;
        globalData.push({
          dbName: (cfg.block ?? cfg.name ?? cfg.dbName ?? "Configuration") as string,
          purpose: (cfg.purpose ?? cfg.description ?? "Configuration parameters") as string,
          fields: entries.map((e) => ({
            fieldName: (e.tag ?? e.name ?? e.fieldName ?? "") as string,
            dataType: (e.type ?? e.dataType ?? "TIME") as string,
            description: (e.value ?? e.desc ?? e.description ?? "") as string,
          })),
        } as unknown as RawObj);
      }
    } else {
      globalData = [];
    }

    // Parse process sequences (new format) or fall back to flat steps
    const rawSequences = (raw.processSequences ?? raw.process_sequences ?? raw.sequences ?? []) as RawArr;
    const rawSteps = (raw.processSteps ?? raw.process_steps ?? raw.steps ?? raw.sequence ?? raw.processFlow ?? raw.process_flow ?? []) as RawArr;

    // Fallback: PM used alternative schema (instances/instanceDBs, ioTags, functionBlocks, etc.)
    let fallbackSteps: RawArr = [];
    if (control_modules.length === 0 && (raw.instances || raw.instanceDBs || raw.instanceDbs || raw.instance_dbs || raw.functionBlocks || raw.function_blocks || raw.callingFCs || raw.calling_fcs)) {
      const converted = convertAlternativeSchema(raw);
      control_modules = converted.control_modules;
      // Also pull globalData from alternative schema if not already present
      if (globalData.length === 0) globalData = converted.globalData;
      fallbackSteps = converted.processSteps;
    }

    // Determine sequences
    let processSequences: ProcessSequence[];
    if (rawSequences.length > 0) {
      processSequences = parseSequences(rawSequences);
    } else if (rawSteps.length > 0) {
      processSequences = wrapFlatStepsIntoSequence(rawSteps);
    } else if (fallbackSteps.length > 0) {
      processSequences = wrapFlatStepsIntoSequence(fallbackSteps);
    } else {
      processSequences = [];
    }

    // Hydrate with UUIDs where missing
    const matrix: ProcessLinkageMatrix = {
      version: Number(raw.version) || 1,
      deviceLinkage: control_modules.map((d) => {
        const rawWiring = (d.wiring ?? []) as RawArr;
        const ioSigs = (d.ioSignals ?? d.io_signals ?? d.signals ?? d.io ?? []) as RawArr;
        const ilocks = (d.interlocks ?? d.interlock ?? []) as RawArr;

        // Parse wiring from new format — handle many PM key variations
        let wiring: FbWire[] = rawWiring.map((w) => {
          // Resolve connectedTo from whichever key the PM used
          const connectedTo = (w.source ?? w.connectedTo ?? w.connected_to ?? w.tag ?? w.tagName
            ?? w.ioTag ?? w.io_tag ?? w.internalTag ?? w.internal_tag ?? w.hmiTag ?? w.hmi_tag
            ?? w.value ?? "") as string;

          // Infer wire type from which key was actually present
          let wireType = (w.type ?? w.wireType ?? w.wire_type ?? "") as string;
          if (!wireType) {
            if (w.ioTag || w.io_tag) wireType = "io";
            else if (w.internalTag || w.internal_tag) wireType = "fb";
            else if (w.hmiTag || w.hmi_tag) wireType = "global";
            else if (w.value !== undefined && !w.source && !w.connectedTo) wireType = "constant";
            else wireType = "io";
          }

          // Normalize direction case ("IN"→"in", "OUT"→"out")
          const rawDir = ((w.direction ?? w.dir ?? "in") as string).toLowerCase();

          return {
            id: (w.id as string) ?? crypto.randomUUID(),
            paramName: (w.param ?? w.paramName ?? w.parameter ?? w.fbPin ?? w.pin ?? w.name ?? "") as string,
            direction: (rawDir === "out" ? "out" : "in") as "in" | "out",
            connectedTo,
            wireType: wireType as "fb" | "io" | "global" | "constant",
            dataType: ((w.dataType ?? w.data_type) as string | undefined) ?? undefined,
          };
        });

        // Backward compat: convert old ioSignals → wiring if no wiring present
        if (wiring.length === 0 && ioSigs.length > 0) {
          wiring = ioSigs.map((s) => {
            const sigType = (s.signalType ?? s.signal_type ?? s.type ?? "DI") as string;
            return {
              id: (s.id as string) ?? crypto.randomUUID(),
              paramName: (s.tagName ?? s.tag_name ?? s.tag ?? "") as string,
              direction: (sigType === "DI" || sigType === "AI" ? "in" : "out") as "in" | "out",
              connectedTo: (s.tagName ?? s.tag_name ?? s.tag ?? "") as string,
              wireType: "io" as const,
              dataType: sigType === "AI" || sigType === "AQ" ? "Real" : "Bool",
            };
          });
        }

        // Resolve template/FB name — PM uses many key variations
        const templateOrFb = (d.template ?? d.fbTemplateName ?? d.fb_template_name ?? d.templateName ?? null) as string | null;
        const fbName = (d.fbName ?? d.fb_name ?? d.fb ?? d.instanceOf ?? d.blockName ?? templateOrFb ?? "") as string;

        return {
          id: (d.id as string) ?? crypto.randomUUID(),
          name: (d.name ?? d.label ?? d.deviceName ?? d.control_module_name ?? d.deviceId ?? d.control_module_id ?? d.instanceName ?? d.instance ?? "") as string,
          deviceType: (d.deviceType ?? d.device_type ?? d.type ?? d.category ?? templateOrFb ?? "") as string,
          description: (d.description ?? d.desc ?? d.purpose ?? "") as string,
          wiring,
          fbName,
          fbTemplateName: templateOrFb,
          fbTemplateId: (d.fbTemplateId ?? d.fb_template_id ?? d.templateId ?? null) as string | null,
          instanceDbName: (d.instanceDbName ?? d.instance_db_name ?? d.instanceDb ?? d.instance_db ?? d.instanceDB ?? d.instance ?? d.dbName ?? d.db ?? "") as string,
          interlocks: ilocks.map((il) => ({
            id: (il.id as string) ?? crypto.randomUUID(),
            targetDeviceName: (il.targetDeviceName ?? il.target_control_module_name ?? il.target ?? "") as string,
            condition: (il.condition ?? "") as string,
            direction: (il.direction ?? "requires") as "requires" | "blocks" | "follows",
          })),
        };
      }),
      globalData: globalData.map((gd) => ({
        id: (gd.id as string) ?? crypto.randomUUID(),
        dbName: (gd.dbName ?? gd.db_name ?? gd.name ?? "") as string,
        purpose: (gd.purpose ?? gd.description ?? "") as string,
        fields: ((gd.fields ?? gd.variables ?? []) as RawArr).map((f) => ({
          id: (f.id as string) ?? crypto.randomUUID(),
          fieldName: (f.fieldName ?? f.field_name ?? f.name ?? "") as string,
          dataType: (f.dataType ?? f.data_type ?? f.type ?? "") as string,
          description: (f.description ?? f.desc ?? "") as string,
        })),
      })),
      processSequences,
      notes: Array.isArray(raw.notes) ? (raw.notes as string[]).join("\n") : ((raw.notes as string) ?? ""),
      generatedAt: new Date().toISOString(),
      lastReviewedAt: null,
      reviewStatus: "draft",
    };

    return matrix;
  } catch {
    return null;
  }
}

export interface ProcessQaSendInput {
  userMessage: string;
  project: Project;
  pmAgent: Agent;
  sessionId: string;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  fbTemplates?: FbTemplate[];
  promptSections?: Record<string, string>;
  pipelineSteps?: PipelineStepResult[];
}

export function useProcessQa() {
  const store = useProcessBuilderStore;
  const abortRef = useRef<AbortController | null>(null);
  const updateSession = useUpdateProcessBuilderSession();

  const sendMessage = useCallback(
    async (input: ProcessQaSendInput) => {
      const { userMessage, project, pmAgent, sessionId, knowledgeDocs, designProfile, fbTemplates, promptSections, pipelineSteps } = input;

      store.getState().clearStreaming();

      // Add user message
      const userMsg: ProcessQaMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      };
      store.getState().addQaMessage(userMsg);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // Build conversation history from existing messages
        const existingMessages = store.getState().qaMessages;
        const conversationHistory = existingMessages
          .filter((m) => m.id !== userMsg.id)
          .map((m) => ({
            role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: m.content,
          }));

        const { systemPrompt, messages: promptMessages } = buildProcessQaPrompt({
          project,
          pmAgent,
          knowledgeDocs,
          designProfile,
          fbTemplates,
          promptSections,
          conversationHistory,
          userMessage,
          pipelineSteps,
        });

        const fullContent = await streamFromEdgeFunction(
          {
            system_prompt: systemPrompt,
            messages: promptMessages,
            stream: true,
            max_tokens: 32768,
          },
          abort.signal,
          (chunk) => {
            const current = store.getState().streamingContent;
            store.setState({ streamingContent: (current ?? "") + chunk });
          },
        );

        // Add PM response to history
        const pmMsg: ProcessQaMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullContent,
          timestamp: new Date().toISOString(),
        };
        store.getState().addQaMessage(pmMsg);
        store.getState().clearStreaming();

        // Parse Process Linkage Matrix from PM response (new format)
        const matrix = parseProcessMatrix(fullContent);
        if (matrix) {
          store.getState().setLinkageMatrix(matrix);
        }

        // Fallback: parse legacy IO/FB recommendation blocks (backward compat)
        const ioRecs = parseIoRecommendations(fullContent);
        if (ioRecs.length > 0) {
          const existing = store.getState().ioRecommendations;
          store.getState().setIoRecommendations([...existing, ...ioRecs]);
        }

        const fbRecs = parseFbRecommendations(fullContent);
        if (fbRecs.length > 0) {
          const existing = store.getState().fbRecommendations;
          store.getState().setFbRecommendations([...existing, ...fbRecs]);
        }

        // Auto-save to Supabase
        const state = store.getState();
        updateSession.mutate({
          sessionId,
          updates: {
            qa_answers: state.qaAnswers,
            io_recommendations: state.ioRecommendations,
            fb_recommendations: state.fbRecommendations,
            linkage_matrix: state.linkageMatrix,
          },
        });
      } catch (err) {
        store.getState().clearStreaming();

        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        // Add error message to chat
        const errMsg: ProcessQaMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString(),
        };
        store.getState().addQaMessage(errMsg);
      }
    },
    [store, updateSession],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    store.getState().clearStreaming();
  }, [store]);

  return { sendMessage, cancel };
}
