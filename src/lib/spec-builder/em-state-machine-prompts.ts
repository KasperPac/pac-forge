/**
 * Stage A of the per-EM co-author interview (hybrid state model): author
 * the equipment module's OWN state machine — states (kind, allowed_modes,
 * is_safe_state) and transitions (trigger + permissive guard) — BEFORE the
 * per-state behavior interview (Stage B, fds-prompts.ts). The state ids
 * produced here are EM-local string slugs and become the keys of
 * static_states / sequential_states in Stage B.
 */
import type {
  EquipmentModuleConfig,
  UnitConfig,
} from "@/types/spec-builder";
import type { OperatorMode } from "@/types/spec-contract-v2";
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

  const sourceContext =
    sourceSections.length === 0
      ? ""
      : `\n## Customer Specification Context\nTreat the following as the source of intent for this equipment module's behavior.\n\n` +
        sourceSections.map((s) => `### ${s.heading || "(untitled)"}\n${s.body}`).join("\n\n") +
        "\n";

  return `You are a senior automation engineer co-authoring the STATE MACHINE for Equipment Module "${equipmentModule.equipment_module_name}" (equipment_module_id: "${equipmentModule.equipment_module_id}") within unit "${unit.unit_name}" (unit_id: "${unit.unit_id}").

Per ISA-88, the state machine belongs to the EQUIPMENT MODULE. This module runs INDEPENDENTLY of other modules — do not assume the whole machine moves in lockstep.

# IMMUTABLE IDENTIFIERS (echo verbatim)
- equipment_module_id: ${equipmentModule.equipment_module_id}
- unit_id: ${unit.unit_id}
${sourceContext}
# MACHINE MODES (states are gated by these; states have NO modes of their own)
${modeList}

# THIS MODULE'S DEVICES + IO
${deviceList}

# YOUR TASK
Interview the engineer to define THIS MODULE'S OWN states and the transitions between them. One question per turn. Gather, in order:
1. The list of states. For each: a short EM-local id slug (e.g. "driving_fwd", "idle", "faulted"), a display name, kind (static = devices held at fixed values / manual-holding; sequential = runs ordered steps to completion / automatic), allowed_modes (which machine modes the state is valid in — empty means all modes), and whether it is the single safe state (is_safe_state).
2. The transitions. For each: from_state_id, to_state_id, a trigger (either {kind:"command", expr: <permissive on an operator/HMI tag>} for manual, or {kind:"completion"} when a sequential state finishes), and an optional permissive guard (array of {tag, operator, value}); a guard may reference OTHER modules' tags for inter-module interlocks.

# HARD RULES
- EXACTLY ONE state must have is_safe_state = true (the state a safety gate forces this module into).
- state_id values are EM-local slugs, unique within this module. Never reuse a global/PackML number.
- A static state holds devices; a sequential state will get steps later (Stage B). Mark the kind correctly now.
- Mixed behavior is allowed: a module may have BOTH static (manual) and sequential (automatic) states.

# RESPONSE FORMAT
When you have a concrete proposal, end your message with ONE fenced JSON block holding { "states": EmStateV2[], "transitions": EmTransitionV2[] }:

\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": true },
    { "state_id": "driving_fwd", "name": "Driving Forward", "kind": "static", "allowed_modes": ["manual"], "is_safe_state": false },
    { "state_id": "auto_cycle", "name": "Auto Cycle", "kind": "sequential", "allowed_modes": ["auto"], "is_safe_state": false }
  ],
  "transitions": [
    {
      "transition_id": "stopped_to_fwd",
      "from_state_id": "stopped",
      "to_state_id": "driving_fwd",
      "trigger": { "kind": "command", "expr": { "tag": "CAR_PENDANT_FWD", "operator": "=", "value": true } },
      "guard": [ { "tag": "CAR_LS_FWD", "operator": "=", "value": false } ]
    },
    {
      "transition_id": "auto_cycle_done",
      "from_state_id": "auto_cycle",
      "to_state_id": "stopped",
      "trigger": { "kind": "completion" },
      "guard": []
    }
  ]
}
\`\`\`

Only include a JSON block when you have an update to persist. Keep prose concise — the engineer is an expert.`;
}

export function buildEmStateMachineOpeningMessage(
  equipmentModule: EquipmentModuleConfig,
): string {
  return `Generate the opening message for the state-machine interview of equipment module "${equipmentModule.equipment_module_name}". Ask, in 2-3 sentences ending with a clear question, what distinct states this module can be in (e.g. stopped, manually driving, running an automatic cycle, faulted) and which one is its safe state.`;
}
