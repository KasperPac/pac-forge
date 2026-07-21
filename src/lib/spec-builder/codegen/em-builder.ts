import type {
  EquipmentModuleV2, EquipmentModuleContract, IoSignalV2,
  PhaseStep, CompletionCriterion, ControlModuleStateEntry,
  EngineeringDataV1,
} from "@/types/spec-contract-v2";
import { detectDrives } from "./drive-detect";
import { orderStates } from "./step-order";
import { packmlStateBySlug } from "../packml-states";
import { sclIdent, isActiveCommand, staticEntries } from "./sa-builder";
import { serializeAdvance, serializeGuard } from "./serialize-condition";
import { serializeCompletionGuard, isUnevaluable } from "./serialize-completion";
import type { EmPin, EmSeqState, EmSeqStep, EmSequence, EmCommandBranch } from "./types";

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
  engineering?: EngineeringDataV1,
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
        polarity: sig?.polarity, // G0-2 → G1-4 inversion
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

  // symbolic setpoint pins (Int inputs), deduped per EM in insertion order
  const setpoints = new Map<string, string>();

  /** Lower one hold entry {tag, state} to a pin assignment. Bool pins use the
   *  active-token table; Int pins take signed numeric literals directly and
   *  route symbolic names through a generated sp_ input pin. */
  const holdAssign = (entry: ControlModuleStateEntry): { pin: string; value: string } => {
    if (!ownOutput.has(entry.tag)) {
      warnings.push(`EM ${em.equipment_module_name}: state hold references tag ${entry.tag} which is not an output of this EM`);
    }
    const pin = actuatorPin(entry.tag);
    if (actuators.get(pin)?.scl_type === "Int") {
      const raw = entry.state.trim();
      if (/^[+-]?\d+$/.test(raw)) return { pin, value: String(parseInt(raw, 10)) };
      const sp = `sp_${sclIdent(raw)}`;
      const prior = setpoints.get(sp);
      if (prior === undefined) {
        setpoints.set(sp, raw);
      } else if (prior !== raw) {
        // distinct raw names sanitize to the same identifier — first wins
        warnings.push(`EM ${em.equipment_module_name}: setpoint name collision — "${raw}" and "${prior}" both map to ${sp}`);
      }
      return { pin, value: `#${sp}` };
    }
    return { pin, value: isActiveCommand(entry.state) ? "TRUE" : "FALSE" };
  };

  /** Inactive value for a pin: FALSE for Bool, 0 for Int. */
  const inactiveValue = (pin: string): string =>
    actuators.get(pin)?.scl_type === "Int" ? "0" : "FALSE";

  // order states; first is home/safe
  const ordered = orderStates(contract.states, contract.transitions);
  const indexOf = new Map<string, number>();
  ordered.forEach((s, i) => indexOf.set(s.state_id, i));

  const states: EmSeqState[] = ordered.map((st, index) => {
    // PackML slugs own their pattern; the authored kind is only trusted for
    // legacy non-PackML slugs (pre-SP-3b specs).
    const canonical = packmlStateBySlug(st.state_id);
    const kind = canonical?.state_pattern ?? st.kind;
    if (canonical && st.kind !== canonical.state_pattern) {
      warnings.push(
        `EM ${em.equipment_module_name}: state ${st.state_id} authored as "${st.kind}" but PackML ${canonical.name} is "${canonical.state_pattern}" — using "${canonical.state_pattern}"`,
      );
    }

    // typed like command holds so non-Bool pins keep their values (an Int
    // speed-ref hold must emit `:= 0`, never `:= FALSE`)
    const staticCommands = staticEntries(contract.static_states[st.state_id]).map(holdAssign);

    // Command-conditional states (primarily "execute") lower branches instead
    // of steps — authoring enforces steps XOR command_behavior per state.
    const behavior = contract.command_behavior?.[st.state_id];
    const hasCommand = !!behavior && (behavior.branches.length > 0 || behavior.default_hold.length > 0);

    // Steps are lowered from the data, not the kind, so a mis-authored kind
    // never drops authored behavior.
    const seqSteps = contract.sequential_states[st.state_id]?.steps ?? [];
    const steps: EmSeqStep[] = [];
    if (hasCommand && seqSteps.length) {
      // tolerate legacy/hand-edited contracts that carry both — command
      // branches win, steps are dropped
      warnings.push(`EM ${em.equipment_module_name}: state ${st.state_id} has both steps and command_behavior — command branches win`);
    } else if (seqSteps.length) {
      const sorted = [...seqSteps].sort((a, b) => a.step - b.step);
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

    let commandBranches: EmCommandBranch[] = [];
    let commandDefaults: { pin: string; value: string }[] = [];
    if (hasCommand) {
      commandBranches = behavior.branches.map((b) => ({
        label: b.label,
        condition: serializeGuard(b.when, pinRef),
        holds: b.control_modules.map(holdAssign),
      }));
      // anti-latch union: every pin any branch touches defaults to inactive,
      // then default_hold entries override (and add their own pins)
      const defaults = new Map<string, string>();
      for (const b of commandBranches) {
        for (const h of b.holds) if (!defaults.has(h.pin)) defaults.set(h.pin, inactiveValue(h.pin));
      }
      for (const e of behavior.default_hold) {
        const h = holdAssign(e);
        defaults.set(h.pin, h.value);
      }
      commandDefaults = [...defaults.entries()].map(([pin, value]) => ({ pin, value }));
    }

    return {
      stateId: st.state_id, name: st.name, index, kind, isSafe: st.is_safe_state,
      staticCommands, steps, commandBranches, commandDefaults, exits: [],
    };
  });

  for (const t of contract.transitions) {
    const from = indexOf.get(t.from_state_id);
    const to = indexOf.get(t.to_state_id);
    if (from === undefined || to === undefined) {
      warnings.push(`EM ${em.equipment_module_name}: transition ${t.transition_id} targets an unknown state — skipped`);
      continue;
    }
    const src = states[from];
    if (
      t.trigger.kind === "completion" &&
      (src.commandBranches.length > 0 || src.commandDefaults.length > 0)
    ) {
      // command-driven states hold; they never set #done, so a completion
      // gate out of one is dead code. Emit the exit anyway (warn-don't-throw).
      warnings.push(
        `EM ${em.equipment_module_name}: completion transition ${t.transition_id} leaves command-driven state ${t.from_state_id} but that state never completes — the transition can never fire`,
      );
    }
    src.exits.push({
      toIndex: to,
      condition: serializeAdvance(t.trigger, t.guard, pinRef),
      viaCompletion: t.trigger.kind === "completion",
    });
  }

  if (setpoints.size) {
    warnings.push(
      `EM ${em.equipment_module_name}: setpoint pins ${[...setpoints.keys()].join(", ")} — set commissioning values in ${sclIdent(em.equipment_module_name)}_CMD`,
    );
  }

  // G1-1: detect drive CMs (G0-1 model + tier-2 join); their warnings
  // surface alongside the EM's own.
  const drives = detectDrives(em, engineering);
  for (const d of drives) warnings.push(...d.warnings);

  // G1-2: the telegram FB owns a drive's analog speed signals, so state
  // logic typically never references them — force their pins into existence
  // here or the emission cannot resolve a speed-ref/feedback pin.
  for (const d of drives) {
    const cm = em.control_modules.find((c) => c.control_module_id === d.control_module_id);
    for (const s of cm?.io_signals ?? []) {
      if (s.signal_type === "AO") actuatorPin(s.tag);
      else if (s.signal_type === "AI") sensorPin(s.tag);
    }
  }

  return {
    emId: em.equipment_module_id,
    emName: em.equipment_module_name,
    sclName: sclIdent(em.equipment_module_name),
    states,
    cmdPins: [...CMD_PINS],
    setpointPins: [...setpoints.keys()],
    interlockPins: [...interlocks.keys()],
    sensors: [...sensors.values()],
    actuators: [...actuators.values()],
    drives,
    warnings,
  };
}
