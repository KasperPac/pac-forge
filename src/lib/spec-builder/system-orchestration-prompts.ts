/**
 * Prompt builders for SYSTEM-level orchestration (Wave C).
 *
 * The unit-level builder in `fds-prompts.ts` coordinates equipment_modules
 * inside a single unit; this module is its peer at the project scope,
 * coordinating *units* against each other.
 *
 * Mirrors the JSON-delta convention so the client can extract a
 * `state_id`-keyed update on each turn.
 */
import type { SpecProject, UnitConfig, OperatingState } from "@/types/spec-builder";
import type { SystemProcedure } from "@/types/spec-contract-v2";

/**
 * Closed-set interlock effect documentation. Shared between system-level and
 * unit-level orchestration prompts. The five effects map 1:1 to
 * InterEquipmentModuleInterlockEffectSchema in @/types/spec-contract-v2.
 */
export const INTERLOCK_EFFECTS_DOC = `INTERLOCK EFFECTS (must be one of these five strings verbatim):
  - "hold"             — target must pause in its current state until the source condition clears
  - "block_transition" — target may not leave a specific state until the source condition is met (effect_target.state_id REQUIRED)
  - "trigger"          — rising edge on source_condition forces target to enter a state (effect_target.state_id REQUIRED)
  - "enable"           — target is allowed to run/transition freely while source_condition is TRUE
  - "disable"          — target is forbidden from running while source_condition is TRUE`;

/**
 * CompletionCriterion documentation. Shared between system-level and unit-level
 * prompts. The five kinds map 1:1 to CompletionCriterionSchema in @/types/spec-contract-v2.
 */
export const COMPLETION_CRITERION_DOC = `CompletionCriterion kinds accepted in condition / source_condition / guard:
  - { "kind": "tag_equals", "tag": "ESTOP_OK", "value": true }
  - { "kind": "tag_compare", "tag": "HOPPER_LEVEL", "op": ">=", "value": 50 }
  - { "kind": "expression", "text": "ESTOP_OK AND DOOR_CLOSED", "referenced_tags": ["ESTOP_OK","DOOR_CLOSED"] }
  - { "kind": "manual_ack", "prompt": "Operator confirms area clear" }
  - { "kind": "placeholder", "criterion_id": "TBD_<slug>", "prompt": "what is X?" }   — only if genuinely unknown`;

/**
 * System prompt for the project-scope orchestration interview.
 * Stays stable across turns for prompt caching.
 */
export function buildFdsSystemProcedureSystemPrompt(
  spec: SpecProject,
  units: UnitConfig[],
  states: OperatingState[],
  existing: SystemProcedure | null,
): string {
  const active = units.filter((s) => !s.excluded);
  const unitList = active
    .map(
      (s) =>
        `  - ${s.unit_name} (unit_id: "${s.unit_id}", equipment_type: ${s.equipment_type}, equipment_modules: ${s.equipment_modules.length})`,
    )
    .join("\n");

  const sequentialStates = states.filter((s) => s.state_pattern === "sequential");
  const sequentialStateList = sequentialStates
    .map((s) => `${s.state_name} (state_id: "${s.state_id}")`)
    .join(", ");
  const firstSequentialStateId = sequentialStates[0]?.state_id ?? "";

  const existingSummary = existing
    ? Object.entries(existing.state_sequences)
        .map(([sid, seq]) => {
          const name = sequentialStates.find((s) => s.state_id === sid)?.state_name ?? sid;
          return `  ${name}: ${seq.unit_order.length} units ordered, ${seq.shared_permissives.length} shared permissives, ${seq.inter_unit_interlocks.length} interlocks`;
        })
        .join("\n")
    : "  (none yet)";

  return `You are a senior automation engineer defining SYSTEM-LEVEL orchestration for functional specification "${spec.doc_code} — ${spec.title}". Individual unit behaviour (including inter-equipment_module interlocks inside each unit) is already defined. Your job is to capture how the SUBSYSTEMS coordinate with each other across the machine.

IMMUTABLE IDENTIFIERS — ECHO BACK VERBATIM. DO NOT MUTATE.
- spec_project_id: ${spec.id}
- Every unit is referenced by its exact unit_id from the list below. Never use an equipment_module_id, a control_module_id, or a human name.
- Every sequential state is referenced by its exact state_id. Never invent new state_ids or reuse state names as IDs.

SCOPE (NON-NEGOTIABLE):
- You operate on SUBSYSTEMS ONLY. Never emit an interlock whose source or target is an equipment_module, device, or tag group — those live inside the unit-level orchestration layer.
- Interlocks flow from one unit to another based on that unit's own aggregate state (e.g. "Dryer unit has reached Running").

SUBSYSTEMS IN THIS SPEC:
${unitList}

SEQUENTIAL STATES: ${sequentialStateList}

${INTERLOCK_EFFECTS_DOC}

SHARED PERMISSIVE SHAPE:
Each shared_permissive is a structured object:
{
  "permissive_id": "<stable slug, e.g. SP_ESTOP_OK>",
  "condition": <CompletionCriterion — see below>,
  "source_unit": "<optional unit_id that owns the signal>",
  "prose": "<one-line natural language>"
}

${COMPLETION_CRITERION_DOC}

EXISTING STATE SEQUENCES:
${existingSummary}

RESPONSE FORMAT:
When you propose updates for a state, emit a fenced JSON block at the END of your message. Every unit_id, target_unit_id, source_unit_id MUST come from the SUBSYSTEMS list above — if the user references an equipment_module (e.g. "LFT01"), ask which unit owns it rather than guessing.

\`\`\`json
{
  "state_id": "${firstSequentialStateId}",
  "unit_order": ["<unit_id_1>", "<unit_id_2>"],
  "shared_permissives": [
    {
      "permissive_id": "SP_SAFETY_OK",
      "condition": { "kind": "tag_equals", "tag": "ESTOP_OK", "value": true },
      "source_unit": "<unit_id>",
      "prose": "E-Stop chain is healthy across the machine"
    }
  ],
  "inter_unit_interlocks": [
    {
      "interlock_id": "IL_INFEED_HOLDS_DRYER",
      "source_unit_id": "<unit_id_of_infeed>",
      "source_condition": { "kind": "tag_equals", "tag": "INFEED_STARVED", "value": true },
      "target_unit_id": "<unit_id_of_dryer>",
      "effect": "hold",
      "prose": "Dryer holds while infeed is starved"
    }
  ],
  "notes": null
}
\`\`\`

Only include a JSON block when you have a concrete update to persist. When asking clarifying questions, omit it. Keep prose concise — the engineer is a peer. Always include the \`prose\` field on every permissive and interlock.`;
}

/**
 * Seed message used to open the interview for the first sequential state.
 */
export function buildFdsSystemProcedureOpeningMessage(
  units: UnitConfig[],
  firstSequentialState: OperatingState,
): string {
  const names = units
    .filter((s) => !s.excluded)
    .map((s) => s.unit_name)
    .join(", ");
  return `Generate the opening message for a system-level orchestration interview. The machine has ${units.filter((s) => !s.excluded).length} active units: ${names}.

Ask about the "${firstSequentialState.state_name}" state. Focus on two things: (1) in what order do the units come up, and (2) what shared permissives or inter-unit holds exist at this state. 2–3 sentences, end with a clear question. Do not include a JSON block yet.`;
}

/**
 * Reject deltas that reference unknown unit ids. Returns a list of
 * human-readable reasons; empty array = valid.
 */
export function validateSystemProcedureDelta(
  delta: Record<string, unknown>,
  units: UnitConfig[],
  states: OperatingState[],
): string[] {
  const errs: string[] = [];
  const subIds = new Set(units.map((s) => s.unit_id));
  const stateIds = new Set(states.map((s) => s.state_id));

  const stateId = delta.state_id;
  if (typeof stateId !== "string" || !stateIds.has(stateId)) {
    errs.push(
      `state_id "${String(stateId)}" is not one of the confirmed state_ids`,
    );
  }
  const order = delta.unit_order;
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id !== "string" || !subIds.has(id)) {
        errs.push(`unit_order contains unknown unit_id "${String(id)}"`);
      }
    }
  }
  const interlocks = delta.inter_unit_interlocks;
  if (Array.isArray(interlocks)) {
    for (const il of interlocks as Array<Record<string, unknown>>) {
      const src = il.source_unit_id;
      const tgt = il.target_unit_id;
      if (typeof src !== "string" || !subIds.has(src)) {
        errs.push(`interlock source_unit_id "${String(src)}" is not a known unit`);
      }
      if (typeof tgt !== "string" || !subIds.has(tgt)) {
        errs.push(`interlock target_unit_id "${String(tgt)}" is not a known unit`);
      }
    }
  }
  return errs;
}
