/**
 * Stage A of the per-EM co-author interview (hybrid state model): author
 * the equipment module's OWN state machine using the FIXED PackML vocabulary —
 * which of the 17 PackML states this EM implements, their mode gating, and the
 * transitions between them — BEFORE the per-state behaviour interview (Stage B,
 * fds-prompts.ts).
 *
 * SP-3b reframe: state_id values are PackML slugs (packml-states.ts), NOT
 * invented EM-local slugs. Manual/command-driven motions (Drive Fwd/Rev) are
 * behaviour performed while in "execute" and are captured in Stage B as
 * command_behavior — they are NOT states here.
 */
import type {
  EquipmentModuleConfig,
  UnitConfig,
} from "@/types/spec-builder";
import type { OperatorMode } from "@/types/spec-contract-v2";
import { PACKML_STATES } from "./packml-states";
import type { SourceSection } from "./source-section-select";

export function buildEmStateMachineInterviewPrompt(
  equipmentModule: EquipmentModuleConfig,
  unit: UnitConfig,
  modes: OperatorMode[],
  sourceSections: SourceSection[] = [],
): string {
  const deviceList = equipmentModule.control_modules
    .map((d) => {
      const sigs = d.io_signals.map((s) => `${s.tag} (${s.signal_type})`).join(", ");
      return `  - ${d.control_module_name} (${d.control_module_class}${d.is_safety ? ", SAFETY" : ""}): ${sigs}`;
    })
    .join("\n");

  const modeList = modes
    .map((m) => `  - ${m.mode_id} (${m.name}${m.is_default ? ", default" : ""})`)
    .join("\n");

  // The fixed PackML vocabulary — generated from the canonical data so it can
  // never drift from defaultEmStates() / the FB-side declaration (SP-2).
  const packmlMenu = PACKML_STATES
    .map((s) => `  - ${s.slug} (${s.name}) — ${s.state_pattern}`)
    .join("\n");

  const grounded = sourceSections.length > 0;

  const sourceContext = !grounded
    ? ""
    : `\n## Customer Specification Context\nTreat the following as the source of intent for this equipment module's behavior.\n\n` +
      sourceSections.map((s) => `### ${s.heading || "(untitled)"}\n${s.body}`).join("\n\n") +
      "\n";

  // Ground-then-refine: when the module has bound customer-spec requirements,
  // the model drafts its understanding FIRST and then refines, instead of
  // interrogating the engineer cold. With no bound context it falls back to the
  // cold field-by-field interview.
  const taskFraming = grounded
    ? `The Customer Specification Context above is the source of truth for how this module behaves. Work in two phases:

PHASE 1 — GROUND (your FIRST reply): Read the spec and PROPOSE which of the PackML states below this module implements, plus the transitions between them. In concise prose, list the states you selected (PackML slug + why the spec calls for it), the mode gating, and the key transitions, citing the spec text that justifies each. Where the spec is silent on a required field, state your assumption explicitly and tag it "(assumption — confirm)". End PHASE 1 with the JSON block for your full draft, followed by a short bullet list of the specific points you most need the engineer to confirm or correct.

PHASE 2 — REFINE (every reply after the engineer responds): Ask ONE focused confirming or refining question per turn, anchored to your current draft. Only ask about points the spec left open or that the engineer flagged — do NOT re-interrogate fields the spec already answered. Re-emit the updated JSON block whenever an answer changes the machine.`
    : `Interview the engineer to determine which PackML states below this module implements and the transitions between them. One question per turn.`;

  return `You are a senior automation engineer co-authoring the STATE MACHINE for Equipment Module "${equipmentModule.equipment_module_name}" (equipment_module_id: "${equipmentModule.equipment_module_id}") within unit "${unit.unit_name}" (unit_id: "${unit.unit_id}").

Per ISA-88, the state machine belongs to the EQUIPMENT MODULE. Every EM implements the standard PackML state machine (ISA-TR88.00.02). This module runs INDEPENDENTLY of other modules — do not assume the whole machine moves in lockstep.

# IMMUTABLE IDENTIFIERS (echo verbatim)
- equipment_module_id: ${equipmentModule.equipment_module_id}
- unit_id: ${unit.unit_id}
${sourceContext}
# MACHINE MODES (states are gated by these; states have NO modes of their own)
${modeList}

# THIS MODULE'S DEVICES + IO
${deviceList}

# PACKML STATE VOCABULARY (fixed — choose state_id ONLY from these slugs)
Every EM state is a PackML state. Select the subset this module actually implements
(a lean module may implement only a few, e.g. stopped / idle / execute / aborted).
Never invent a slug and never rename these.
${packmlMenu}

# YOUR TASK
${taskFraming}

# WHAT A COMPLETE STATE MACHINE MUST SPECIFY (both phases)
1. The list of states. Each state_id MUST be a PackML slug from the vocabulary above; use its canonical name and kind. For each state also give allowed_modes (which machine modes the state is valid in — empty means all modes) and whether it is the single safe state (is_safe_state). The safe state is ALWAYS "aborted".
2. The transitions. For each: from_state_id, to_state_id (both PackML slugs), a trigger (either {kind:"command", expr: <permissive on an operator/HMI tag>} for a commanded transition, or {kind:"completion"} when a sequential state finishes), and an optional permissive guard (array of {tag, operator, value}); a guard may reference OTHER modules' tags for inter-module interlocks.
   - A command trigger's \`expr\` is a SINGLE condition {tag, operator, value} — never an array, never an OR-group, never a \`trigger_logic\` field.
   - To express "ANY OF these faults → aborting" (the universal fault fan-in), emit ONE separate transition per fault tag: same from_state_id/to_state_id/guard, each with its own single-condition trigger and a unique transition_id (e.g. "<from>_to_aborting__cm1_fault", "<from>_to_aborting__cm2_therm"). The parallel transitions together ARE the OR.

# MANUAL / COMMAND-DRIVEN MOTIONS ARE NOT STATES
Motions an operator commands (e.g. "Drive Forward", "Jog Reverse") are BEHAVIOUR performed while the module is in the "execute" state, driven by command inputs — they are NOT states. Do NOT create a state for a motion. Model the module as being in "execute" while it runs; the specific commanded motions are captured later, in the behaviour interview (Stage B). This module's lifecycle is the PackML states only.

# HARD RULES
- Every state_id is a PackML slug from the vocabulary above. Never invent or rename a slug.
- EXACTLY ONE state has is_safe_state = true, and it MUST be "aborted" (the PackML fault-landing state a safety gate forces this module into).
- allowed_modes gates a state to specific machine modes (empty = all modes).
- kind comes from the vocabulary: static = a waiting/held state; sequential = an acting state that runs to completion.

# RESPONSE FORMAT
When you have a concrete proposal, end your message with ONE fenced JSON block holding { "states": EmStateV2[], "transitions": EmTransitionV2[] }:

\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "idle", "name": "Idle", "kind": "static", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "execute", "name": "Execute", "kind": "sequential", "allowed_modes": ["auto"], "is_safe_state": false },
    { "state_id": "aborting", "name": "Aborting", "kind": "sequential", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "aborted", "name": "Aborted", "kind": "static", "allowed_modes": [], "is_safe_state": true }
  ],
  "transitions": [
    {
      "transition_id": "idle_to_execute",
      "from_state_id": "idle",
      "to_state_id": "execute",
      "trigger": { "kind": "command", "expr": { "tag": "CAR_CMD_START", "operator": "=", "value": true } },
      "guard": [ { "tag": "CAR_READY", "operator": "=", "value": true } ]
    },
    {
      "transition_id": "execute_done",
      "from_state_id": "execute",
      "to_state_id": "idle",
      "trigger": { "kind": "completion" },
      "guard": []
    },
    {
      "transition_id": "execute_to_aborting__vsd1_trip",
      "from_state_id": "execute",
      "to_state_id": "aborting",
      "trigger": { "kind": "command", "expr": { "tag": "VSD1_CB_Trip", "operator": "=", "value": true } },
      "guard": []
    },
    {
      "transition_id": "execute_to_aborting__cm1_therm",
      "from_state_id": "execute",
      "to_state_id": "aborting",
      "trigger": { "kind": "command", "expr": { "tag": "CM1_Therm", "operator": "=", "value": true } },
      "guard": []
    },
    {
      "transition_id": "aborting_to_aborted",
      "from_state_id": "aborting",
      "to_state_id": "aborted",
      "trigger": { "kind": "completion" },
      "guard": []
    }
  ]
}
\`\`\`

(The two \`*_to_aborting__*\` transitions above show the fault fan-in: ONE single-condition transition per fault tag — together they mean "VSD1_CB_Trip OR CM1_Therm → aborting". Never collapse them into an array expr. Faults land in "aborting", which completes to the "aborted" safe state.)

Only include a JSON block when you have an update to persist. Keep prose concise — the engineer is an expert.`;
}

export function buildEmStateMachineOpeningMessage(
  equipmentModule: EquipmentModuleConfig,
  sourceSections: SourceSection[] = [],
): string {
  if (sourceSections.length > 0) {
    return `Generate the opening message for the state-machine interview of equipment module "${equipmentModule.equipment_module_name}". The customer specification context for this module is in your system prompt. Execute PHASE 1 (GROUND): read it, then PROPOSE which PackML states this module implements and the transitions between them (marking "aborted" as the safe state), citing the spec, flagging any gaps as assumptions, and ending with the JSON block plus the specific points you need the engineer to confirm. Lead with your proposal; do NOT ask a cold open-ended question.`;
  }
  return `Generate the opening message for the state-machine interview of equipment module "${equipmentModule.equipment_module_name}". Ask, in 2-3 sentences ending with a clear question, which PackML lifecycle states this module needs (e.g. stopped, idle, execute, aborted) and confirm that "aborted" is its safe state.`;
}
