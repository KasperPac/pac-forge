/**
 * Prompt builders for SYSTEM-level orchestration (Wave C).
 *
 * The subsystem-level builder in `fds-prompts.ts` coordinates assemblies
 * inside a single subsystem; this module is its peer at the project scope,
 * coordinating *subsystems* against each other.
 *
 * Mirrors the JSON-delta convention so the client can extract a
 * `state_id`-keyed update on each turn.
 */
import type { SpecProject, SubsystemConfig, OperatingState } from "@/types/spec-builder";
import type { SystemOrchestration } from "@/types/spec-contract-v2";

/**
 * System prompt for the project-scope orchestration interview.
 * Stays stable across turns for prompt caching.
 */
export function buildFdsSystemOrchestrationSystemPrompt(
  spec: SpecProject,
  subsystems: SubsystemConfig[],
  states: OperatingState[],
  existing: SystemOrchestration | null,
): string {
  const active = subsystems.filter((s) => !s.excluded);
  const subsystemList = active
    .map(
      (s) =>
        `  - ${s.subsystem_name} (subsystem_id: "${s.subsystem_id}", equipment_type: ${s.equipment_type}, assemblies: ${s.assemblies.length})`,
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
          return `  ${name}: ${seq.subsystem_order.length} subsystems ordered, ${seq.shared_permissives.length} shared permissives, ${seq.inter_subsystem_interlocks.length} interlocks`;
        })
        .join("\n")
    : "  (none yet)";

  return `You are a senior automation engineer defining SYSTEM-LEVEL orchestration for functional specification "${spec.doc_code} — ${spec.title}". Individual subsystem behaviour (including inter-assembly interlocks inside each subsystem) is already defined. Your job is to capture how the SUBSYSTEMS coordinate with each other across the machine.

IMMUTABLE IDENTIFIERS — ECHO BACK VERBATIM. DO NOT MUTATE.
- spec_project_id: ${spec.id}
- Every subsystem is referenced by its exact subsystem_id from the list below. Never use an assembly_id, a device_id, or a human name.
- Every sequential state is referenced by its exact state_id. Never invent new state_ids or reuse state names as IDs.

SCOPE (NON-NEGOTIABLE):
- You operate on SUBSYSTEMS ONLY. Never emit an interlock whose source or target is an assembly, device, or tag group — those live inside the subsystem-level orchestration layer.
- Interlocks flow from one subsystem to another based on that subsystem's own aggregate state (e.g. "Dryer subsystem has reached Running").

SUBSYSTEMS IN THIS SPEC:
${subsystemList}

SEQUENTIAL STATES: ${sequentialStateList}

INTERLOCK EFFECTS (must be one of these five strings verbatim):
  - "hold"             — target subsystem must pause in its current state until the source condition clears
  - "block_transition" — target subsystem may not leave a specific state until the source condition is met (effect_target.state_id REQUIRED)
  - "trigger"          — rising edge on source_condition forces target subsystem to enter a state (effect_target.state_id REQUIRED)
  - "enable"           — target subsystem is allowed to run/transition freely while source_condition is TRUE
  - "disable"          — target subsystem is forbidden from running while source_condition is TRUE

SHARED PERMISSIVE SHAPE:
Each shared_permissive is a structured object:
{
  "permissive_id": "<stable slug, e.g. SP_ESTOP_OK>",
  "condition": <CompletionCriterion — see below>,
  "source_subsystem": "<optional subsystem_id that owns the signal>",
  "prose": "<one-line natural language>"
}

CompletionCriterion kinds accepted in condition / source_condition:
  - { "kind": "tag_equals", "tag": "ESTOP_OK", "value": true }
  - { "kind": "tag_compare", "tag": "HOPPER_LEVEL", "op": ">=", "value": 50 }
  - { "kind": "expression", "text": "ESTOP_OK AND DOOR_CLOSED", "referenced_tags": ["ESTOP_OK","DOOR_CLOSED"] }
  - { "kind": "manual_ack", "prompt": "Operator confirms area clear" }
  - { "kind": "placeholder", "criterion_id": "TBD_<slug>", "prompt": "what is X?" }   — only if genuinely unknown

EXISTING STATE SEQUENCES:
${existingSummary}

RESPONSE FORMAT:
When you propose updates for a state, emit a fenced JSON block at the END of your message. Every subsystem_id, target_subsystem_id, source_subsystem_id MUST come from the SUBSYSTEMS list above — if the user references an assembly (e.g. "LFT01"), ask which subsystem owns it rather than guessing.

\`\`\`json
{
  "state_id": "${firstSequentialStateId}",
  "subsystem_order": ["<subsystem_id_1>", "<subsystem_id_2>"],
  "shared_permissives": [
    {
      "permissive_id": "SP_SAFETY_OK",
      "condition": { "kind": "tag_equals", "tag": "ESTOP_OK", "value": true },
      "source_subsystem": "<subsystem_id>",
      "prose": "E-Stop chain is healthy across the machine"
    }
  ],
  "inter_subsystem_interlocks": [
    {
      "interlock_id": "IL_INFEED_HOLDS_DRYER",
      "source_subsystem_id": "<subsystem_id_of_infeed>",
      "source_condition": { "kind": "tag_equals", "tag": "INFEED_STARVED", "value": true },
      "target_subsystem_id": "<subsystem_id_of_dryer>",
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
export function buildFdsSystemOrchestrationOpeningMessage(
  subsystems: SubsystemConfig[],
  firstSequentialState: OperatingState,
): string {
  const names = subsystems
    .filter((s) => !s.excluded)
    .map((s) => s.subsystem_name)
    .join(", ");
  return `Generate the opening message for a system-level orchestration interview. The machine has ${subsystems.filter((s) => !s.excluded).length} active subsystems: ${names}.

Ask about the "${firstSequentialState.state_name}" state. Focus on two things: (1) in what order do the subsystems come up, and (2) what shared permissives or inter-subsystem holds exist at this state. 2–3 sentences, end with a clear question. Do not include a JSON block yet.`;
}

/**
 * Reject deltas that reference unknown subsystem ids. Returns a list of
 * human-readable reasons; empty array = valid.
 */
export function validateSystemOrchestrationDelta(
  delta: Record<string, unknown>,
  subsystems: SubsystemConfig[],
  states: OperatingState[],
): string[] {
  const errs: string[] = [];
  const subIds = new Set(subsystems.map((s) => s.subsystem_id));
  const stateIds = new Set(states.map((s) => s.state_id));

  const stateId = delta.state_id;
  if (typeof stateId !== "string" || !stateIds.has(stateId)) {
    errs.push(
      `state_id "${String(stateId)}" is not one of the confirmed state_ids`,
    );
  }
  const order = delta.subsystem_order;
  if (Array.isArray(order)) {
    for (const id of order) {
      if (typeof id !== "string" || !subIds.has(id)) {
        errs.push(`subsystem_order contains unknown subsystem_id "${String(id)}"`);
      }
    }
  }
  const interlocks = delta.inter_subsystem_interlocks;
  if (Array.isArray(interlocks)) {
    for (const il of interlocks as Array<Record<string, unknown>>) {
      const src = il.source_subsystem_id;
      const tgt = il.target_subsystem_id;
      if (typeof src !== "string" || !subIds.has(src)) {
        errs.push(`interlock source_subsystem_id "${String(src)}" is not a known subsystem`);
      }
      if (typeof tgt !== "string" || !subIds.has(tgt)) {
        errs.push(`interlock target_subsystem_id "${String(tgt)}" is not a known subsystem`);
      }
    }
  }
  return errs;
}
