import type {
  EquipmentModuleV2, EquipmentModuleContract, IoSignalV2,
  PhaseStep, CompletionCriterion,
} from "@/types/spec-contract-v2";
import { orderStates } from "./step-order";
import { sclIdent, isActiveCommand, staticEntries } from "./sa-builder";
import { serializeAdvance } from "./serialize-condition";
import { serializeCompletionGuard, isUnevaluable } from "./serialize-completion";
import type { EmPin, EmSeqState, EmSeqStep, EmSequence } from "./types";

const INPUT_TYPES = new Set<string>(["DI", "AI"]);
const OUTPUT_TYPES = new Set<string>(["DO", "AO"]);
const ANALOG_TYPES = new Set<string>(["AI", "AO"]);
const CMD_PINS = ["cmd_start", "cmd_stop", "cmd_hold", "cmd_reset"];

/** Pick legacy action prose, else the first structured action's prose. */
function stepProse(s: PhaseStep): string {
  if (s.action && s.action.trim()) return s.action.trim();
  const a = s.actions?.[0];
  return a?.prose?.trim() || `Step ${s.step}`;
}

/** Criteria that advance past a step: first single-transition guard, else the
 *  legacy completion criteria. */
function stepCriteria(s: PhaseStep): CompletionCriterion[] {
  const single = s.transitions?.find((t) => t.kind === "single");
  if (single && single.guard.length) return single.guard;
  return s.completion_criteria ?? [];
}

/**
 * Lower a hierarchy EM (for IO) plus its state-machine contract into the
 * EmSequence IR consumed by em-writer. Pure, deterministic, never throws —
 * structural problems are reported via `warnings`. Generic across machine
 * types: no device names or sequences are special-cased.
 */
export function buildEmSequence(
  em: EquipmentModuleV2,
  contract: EquipmentModuleContract,
): EmSequence {
  const warnings: string[] = [];

  // classify own IO
  const io: IoSignalV2[] = em.control_modules.flatMap((c) => c.io_signals);
  const ownInput = new Map<string, IoSignalV2>();
  const ownOutput = new Map<string, IoSignalV2>();
  for (const s of io) {
    if (INPUT_TYPES.has(s.signal_type)) ownInput.set(s.tag, s);
    else if (OUTPUT_TYPES.has(s.signal_type)) ownOutput.set(s.tag, s);
  }

  // pin registries (insertion-ordered)
  const sensors = new Map<string, EmPin>();
  const actuators = new Map<string, EmPin>();
  const interlocks = new Map<string, string>();

  const sensorPin = (tag: string): string => {
    const name = `fb_${sclIdent(tag)}`;
    if (!sensors.has(name)) {
      const sig = ownInput.get(tag);
      sensors.set(name, {
        name, tag,
        scl_type: sig && ANALOG_TYPES.has(sig.signal_type) ? "Int" : "Bool",
        address: sig?.io_address ?? "",
      });
    }
    return name;
  };
  const actuatorPin = (tag: string): string => {
    const name = `cmd_${sclIdent(tag)}`;
    if (!actuators.has(name)) {
      const sig = ownOutput.get(tag);
      actuators.set(name, {
        name, tag,
        scl_type: sig && ANALOG_TYPES.has(sig.signal_type) ? "Int" : "Bool",
        address: sig?.io_address ?? "",
      });
    }
    return name;
  };
  const interlockPin = (tag: string): string => {
    const name = `ilk_${sclIdent(tag)}`;
    if (!interlocks.has(name)) interlocks.set(name, tag);
    return name;
  };

  /** Map a referenced tag to its FB-local `#pin`. Own inputs → `#fb_`, own
   *  outputs → `#cmd_`, everything else is a coordination input `#ilk_`. */
  const pinRef = (tag: string): string => {
    if (ownInput.has(tag)) return `#${sensorPin(tag)}`;
    if (ownOutput.has(tag)) return `#${actuatorPin(tag)}`;
    return `#${interlockPin(tag)}`;
  };

  // order states; first is home/safe
  const ordered = orderStates(contract.states, contract.transitions);
  const indexOf = new Map<string, number>();
  ordered.forEach((s, i) => indexOf.set(s.state_id, i));

  const states: EmSeqState[] = ordered.map((st, index) => {
    const staticCommands = staticEntries(contract.static_states[st.state_id]).map((e) => ({
      pin: actuatorPin(e.tag),
      active: isActiveCommand(e.state),
    }));

    const steps: EmSeqStep[] = [];
    if (st.kind === "sequential") {
      const seq = contract.sequential_states[st.state_id];
      const sorted = [...(seq?.steps ?? [])].sort((a, b) => a.step - b.step);
      if (sorted.some((ps) => ps.transitions?.some((t) => t.kind === "parallel"))) {
        warnings.push(`EM ${em.equipment_module_name}: state ${st.state_id} has parallel branches — collapsed to a linear sequence`);
      }
      sorted.forEach((ps, i) => {
        const criteria = stepCriteria(ps);
        const manual = criteria.some(isUnevaluable);
        if (manual) {
          warnings.push(`EM ${em.equipment_module_name}: step ${st.state_id}.${i + 1} has a manual/placeholder completion — will not auto-advance`);
        }
        steps.push({
          step: i + 1,
          fillId: `${st.state_id}.${i + 1}`,
          actionProse: stepProse(ps),
          advance: serializeCompletionGuard(criteria, pinRef),
          manual,
        });
      });
    }

    return { stateId: st.state_id, name: st.name, index, kind: st.kind, isSafe: st.is_safe_state, staticCommands, steps, exits: [] };
  });

  for (const t of contract.transitions) {
    const from = indexOf.get(t.from_state_id);
    const to = indexOf.get(t.to_state_id);
    if (from === undefined || to === undefined) {
      warnings.push(`EM ${em.equipment_module_name}: transition ${t.transition_id} targets an unknown state — skipped`);
      continue;
    }
    states[from].exits.push({
      toIndex: to,
      condition: serializeAdvance(t.trigger, t.guard, pinRef),
      viaCompletion: t.trigger.kind === "completion",
    });
  }

  return {
    emId: em.equipment_module_id,
    emName: em.equipment_module_name,
    sclName: sclIdent(em.equipment_module_name),
    states,
    cmdPins: [...CMD_PINS],
    interlockPins: [...interlocks.keys()],
    sensors: [...sensors.values()],
    actuators: [...actuators.values()],
    warnings,
  };
}
