/**
 * AI-powered foreign DOCX ingest.
 *
 * This is a port of `src/hooks/use-forge-spec-analysis.ts` (still live; Wave 5
 * will delete it) restructured as a pure async function that returns a
 * SpecContractV2-shaped draft plus any schema warnings.
 *
 * Differences from the legacy hook:
 *  - No React — callable from anywhere (hooks or pure code).
 *  - System prompt demands SpecContractV2 JSON, not the legacy SpecAnalysis.
 *  - Post-processing mints UUIDs where missing, normalises signal directions
 *    via `convertSignalDirection`, and runs a lenient Zod validation that
 *    turns issues into Warning[] instead of throwing.
 *
 * The function deliberately does NOT persist anything — the caller decides
 * whether to park the result for engineer confirmation or write a draft.
 */
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import mammoth from "mammoth";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";
import {
  SpecContractV2Schema,
  type SpecContractV2,
} from "@/types/spec-contract-v2";
import type { Warning } from "@/lib/spec-builder/docx-ingest";

const AI_INGEST_MAX_TOKENS = 65536;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an industrial automation spec-analysis agent. The user uploads a
functional specification document for a machine or production line. Your job
is to extract the machine hierarchy, operating states, alarms, and device IO
into the strict SpecContractV2 shape defined below.

The four-level hierarchy is NON-NEGOTIABLE:
  System (the machine) → Subsystem (functional station) → Assembly (group of
  devices working together) → Device (single physical thing with IO signals).
Only devices have IO. Only assemblies appear in process sequences. If the
spec is ambiguous, err towards describing the real physical decomposition —
never invent devices or assemblies that are not grounded in the text.

Return a single JSON object matching this TypeScript shape (derived from
Zod schema SpecContractV2Schema):

interface SpecContractV2 {
  schema_version: 2;
  project: {
    id: string;                      // may be empty — caller mints UUID
    doc_code: string;
    title: string;
    client_name: string;
    project_number: string | null;
    plc_model: string | null;
    hmi_type: string | null;
    comms_protocol: string | null;
    safety_classification: string | null;
    fault_philosophy: string | null;
    design_principles: string[];
    scope_exclusions: string[];
  };
  hierarchy: {
    subsystems: Array<{
      subsystem_id: string;           // UUID — mint a new one
      subsystem_name: string;
      equipment_type: string;
      description: string;
      excluded: boolean;
      assemblies: Array<{
        assembly_id: string;          // UUID
        assembly_name: string;
        description: string;
        devices: Array<{
          device_id: string;          // UUID
          device_name: string;
          device_class: string;
          is_safety: boolean;
          description: string;
          io_signals: Array<{
            tag: string;
            signal_type: "DI" | "DO" | "AI" | "AO" | "internal";
            io_address: string;       // may be empty if unknown
            description: string;
            source: "wired" | "network_telegram";
          }>;
        }>;
      }>;
    }>;
  };
  states: Array<{
    state_id: string;                 // e.g. "ST01"
    state_name: string;
    description: string;
    state_pattern: "static" | "sequential";
  }>;
  alarm_tiers: Array<{ tier_id: string; tier_name: string; description: string }>;
  assemblies: Record<string, {
    assembly_id: string;
    subsystem_id: string;
    static_states: Record<string, Array<{ tag: string; description: string; state: string }>>;
    sequential_states: Record<string, {
      permissives: string[];
      steps: Array<{
        step: number;
        action: string;
        completion_criteria: Array<
          | { kind: "tag_equals"; tag: string; value: string | number | boolean; within_ms?: number; on_fail?: { fault_code: string; severity: "warning" | "fault" } }
          | { kind: "tag_compare"; tag: string; op: "<"|"<="|">"|">="|"=="; value: number; within_ms?: number; on_fail?: { fault_code: string; severity: "warning" | "fault" } }
          | { kind: "expression"; text: string; referenced_tags: string[]; within_ms?: number; on_fail?: { fault_code: string; severity: "warning" | "fault" } }
          | { kind: "manual_ack"; prompt: string }
        >;
        completion_criteria_text: string;
        on_fail?: { fault_code: string; severity: "warning" | "fault" };
      }>;
      notes: string | null;
    }>;
  }>;
  orchestrations: Record<string, Record<string, {
    assembly_order: string[];
    shared_permissives: string[];
    inter_assembly_interlocks: Array<{ source_assembly: string; source_condition: string; target_assembly: string; effect: string }>;
    notes: string | null;
  }>>;
  alarms: Array<{
    id: string;
    tier_id: string;
    device_id: string | null;
    assembly_id: string | null;
    subsystem_id: string | null;
    tag: string;
    description: string;
    action: string;
    setpoint?: string;
    delay?: string;
  }>;
  io_list: unknown[];   // may be empty — forge derives
  faults: unknown[];    // may be empty — forge derives
  sections: Record<string, never>;   // return {}; sections are generated later
}

RULES:
- Signal types: always canonical IEC. Use "DO" (never "DQ"), "AO" (never "AQ").
- Mint RFC 4122 v4 UUIDs for every subsystem_id, assembly_id, device_id.
- If the document hints at a "system" or line that contains multiple stations,
  each station is a subsystem. A conveyor with motor + sensors is ONE assembly.
- "excluded": true only if the spec explicitly excludes the subsystem from scope.
- Return ONLY the JSON object. No markdown fences, no prose, no trailing text.
`;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function aiIngestDocx(
  file: File,
  abortSignal: AbortSignal,
): Promise<{ draft: SpecContractV2; warnings: Warning[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const extract = await mammoth.extractRawText({ arrayBuffer });
  const specText = extract.value ?? "";
  if (!specText.trim()) {
    throw new Error("DOCX is empty or unreadable");
  }

  const userMessage = `Extract the SpecContractV2 structure from the following functional spec.
Return a single JSON object conforming to the schema in the system prompt.

--- BEGIN SPEC ---
${specText}
--- END SPEC ---`;

  const content = await streamFromEdgeFunction(
    {
      system_prompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      stream: true,
    },
    abortSignal,
    () => {},
    AI_INGEST_MAX_TOKENS,
    {
      prompt_name: "spec-ai-ingest-v2",
      agent_role: "spec_analysis",
      pipeline_step: "spec_ingest",
    },
  );

  let cleaned = content.trim();
  cleaned = cleaned.replace(/^[\s\S]*?```json\s*/i, "");
  cleaned = cleaned.replace(/```[\s\S]*$/, "");
  cleaned = cleaned.trim();
  if (!cleaned.startsWith("{")) {
    const start = cleaned.indexOf("{");
    if (start >= 0) cleaned = cleaned.slice(start);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `AI spec ingest returned invalid JSON: ${cleaned.slice(0, 200)}… (${e})`,
    );
  }

  const postProcessed = postProcess(parsed);

  // Wave D — remap temporary step IDs to real UUIDs + fix transition refs.
  const remapWarnings = remapSequenceStepIds(postProcessed);

  const validation = SpecContractV2Schema.safeParse(postProcessed);

  if (validation.success) {
    return { draft: validation.data, warnings: remapWarnings };
  }

  // Lenient: still return the best-effort draft plus the issues as warnings.
  const warnings: Warning[] = validation.error.issues.map((z) => ({
    path: z.path.join("."),
    message: z.message,
  }));
  return {
    draft: postProcessed as SpecContractV2,
    warnings: [...remapWarnings, ...warnings],
  };
}

// ---------------------------------------------------------------------------
// Wave D — SFC step-ID remap.
//
// The AI often emits temporary string IDs like "s1"/"s2" rather than real
// UUIDs. Walk every assembly.sequential_states.steps[] and, if the step_id
// does not look like a UUID, mint one via crypto.randomUUID() and record
// the mapping. Then fix every transition.target_step_id(s) that points at
// a remapped ID. Transitions that reference an unknown temp ID are dropped
// and reported as a warning.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function remapSequenceStepIds(root: Record<string, unknown>): Warning[] {
  const warnings: Warning[] = [];
  const assemblies = root.assemblies as Record<string, unknown> | undefined;
  if (!assemblies || typeof assemblies !== "object") return warnings;

  let remappedCount = 0;

  for (const [asyId, asyVal] of Object.entries(assemblies)) {
    if (!asyVal || typeof asyVal !== "object") continue;
    const asy = asyVal as Record<string, unknown>;
    const seqStates = asy.sequential_states;
    if (!seqStates || typeof seqStates !== "object") continue;

    for (const [stateId, stateVal] of Object.entries(
      seqStates as Record<string, unknown>,
    )) {
      if (!stateVal || typeof stateVal !== "object") continue;
      const state = stateVal as Record<string, unknown>;
      const steps = state.steps;
      if (!Array.isArray(steps)) continue;

      const mapping = new Map<string, string>();

      // Pass 1: mint UUIDs for any non-UUID step_id.
      for (const step of steps) {
        if (!step || typeof step !== "object") continue;
        const s = step as Record<string, unknown>;
        const current = typeof s.step_id === "string" ? s.step_id : "";
        if (current && UUID_RE.test(current)) continue;
        const minted = randomUuid();
        if (current) mapping.set(current, minted);
        s.step_id = minted;
        remappedCount++;
      }

      // Pass 2: rewrite transition targets.
      for (const step of steps) {
        if (!step || typeof step !== "object") continue;
        const s = step as Record<string, unknown>;
        const transitions = s.transitions;
        if (!Array.isArray(transitions)) continue;
        const surviving: unknown[] = [];
        for (const tr of transitions) {
          if (!tr || typeof tr !== "object") continue;
          const t = tr as Record<string, unknown>;
          let drop = false;

          if (t.kind === "single" && typeof t.target_step_id === "string") {
            const before = t.target_step_id;
            if (mapping.has(before)) {
              t.target_step_id = mapping.get(before)!;
            } else if (!UUID_RE.test(before)) {
              warnings.push({
                path: `assemblies.${asyId}.sequential_states.${stateId}.step[${(s.step_id as string) ?? "?"}].transition`,
                message: `AI referenced unknown step id "${before}" — transition dropped`,
              });
              drop = true;
            }
          }

          if (t.kind === "parallel" && Array.isArray(t.target_step_ids)) {
            const remapped: string[] = [];
            for (const tid of t.target_step_ids as unknown[]) {
              if (typeof tid !== "string") continue;
              if (mapping.has(tid)) remapped.push(mapping.get(tid)!);
              else if (UUID_RE.test(tid)) remapped.push(tid);
              else {
                warnings.push({
                  path: `assemblies.${asyId}.sequential_states.${stateId}.step[${(s.step_id as string) ?? "?"}].transition.parallel`,
                  message: `AI referenced unknown step id "${tid}" — dropped from parallel split`,
                });
              }
            }
            if (remapped.length < 2) {
              warnings.push({
                path: `assemblies.${asyId}.sequential_states.${stateId}.step[${(s.step_id as string) ?? "?"}].transition`,
                message: `parallel split collapsed below 2 targets after remap — transition dropped`,
              });
              drop = true;
            } else {
              t.target_step_ids = remapped;
            }
          }

          if (!drop) surviving.push(t);
        }
        s.transitions = surviving;
      }
    }
  }

  if (remappedCount > 0) {
    warnings.unshift({
      path: "assemblies",
      message: `AI assigned ${remappedCount} step IDs`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Post-processing: mint UUIDs, normalise signal directions, fill defaults
// ---------------------------------------------------------------------------

function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Extremely lightweight fallback — should never hit in a Vite/browser env.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function ensureUuid(v: unknown): string {
  if (typeof v === "string" && /^[0-9a-f-]{32,}$/i.test(v)) return v;
  return randomUuid();
}

function postProcess(raw: unknown): Record<string, unknown> {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // Hierarchy UUID + signal normalisation
  const hierarchy = (obj.hierarchy as Record<string, unknown>) ?? {};
  const subsystems = Array.isArray(hierarchy.subsystems) ? hierarchy.subsystems : [];
  const normalisedSubs = subsystems.map((s) => {
    const sub = s as Record<string, unknown>;
    const assemblies = Array.isArray(sub.assemblies) ? sub.assemblies : [];
    return {
      ...sub,
      subsystem_id: ensureUuid(sub.subsystem_id),
      subsystem_name: String(sub.subsystem_name ?? ""),
      equipment_type: String(sub.equipment_type ?? "Other"),
      description: String(sub.description ?? ""),
      excluded: Boolean(sub.excluded),
      assemblies: assemblies.map((a) => {
        const asy = a as Record<string, unknown>;
        const devices = Array.isArray(asy.devices) ? asy.devices : [];
        return {
          ...asy,
          assembly_id: ensureUuid(asy.assembly_id),
          assembly_name: String(asy.assembly_name ?? ""),
          description: String(asy.description ?? ""),
          devices: devices.map((d) => {
            const dev = d as Record<string, unknown>;
            const signals = Array.isArray(dev.io_signals) ? dev.io_signals : [];
            return {
              ...dev,
              device_id: ensureUuid(dev.device_id),
              device_name: String(dev.device_name ?? ""),
              device_class: String(dev.device_class ?? "other"),
              is_safety: Boolean(dev.is_safety),
              description: String(dev.description ?? ""),
              io_signals: signals.map((sig) => {
                const s = sig as Record<string, unknown>;
                return {
                  tag: String(s.tag ?? ""),
                  signal_type: convertSignalDirection(String(s.signal_type ?? "")),
                  io_address: String(s.io_address ?? ""),
                  description: String(s.description ?? ""),
                  source:
                    s.source === "network_telegram"
                      ? "network_telegram"
                      : "wired",
                };
              }),
            };
          }),
        };
      }),
    };
  });

  return {
    schema_version: 2,
    project: obj.project ?? {
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
    hierarchy: { subsystems: normalisedSubs },
    states: Array.isArray(obj.states) ? obj.states : [],
    alarm_tiers: Array.isArray(obj.alarm_tiers) ? obj.alarm_tiers : [],
    assemblies:
      obj.assemblies && typeof obj.assemblies === "object" ? obj.assemblies : {},
    orchestrations:
      obj.orchestrations && typeof obj.orchestrations === "object"
        ? obj.orchestrations
        : {},
    alarms: Array.isArray(obj.alarms) ? obj.alarms : [],
    io_list: Array.isArray(obj.io_list) ? obj.io_list : [],
    faults: Array.isArray(obj.faults) ? obj.faults : [],
    sections:
      obj.sections && typeof obj.sections === "object" ? obj.sections : {},
  };
}
