/**
 * Builds V2 EquipmentModuleContract records (static + sequential states) per
 * equipment_module from resolved hierarchy + device IO. Each produced contract
 * is Zod-validated before return so a builder bug fails loudly here
 * rather than silently at insert time.
 */
import {
  EquipmentModuleContractSchema,
  type EquipmentModuleContract,
  type CompletionCriterion,
  type SequentialStateV2,
  type StaticStateV2,
  type PhaseStep,
  type TransitionV2,
  type ActionV2,
} from "@/types/spec-contract-v2";
import type { IoSignalKind } from "./io-allocator";
import type { RandomFdsControlModuleClass } from "./theme-schema";
import { DEVICE_TEMPLATES, type StateKey } from "./device-templates";
import {
  STATE_ID_IDLE,
  STATE_ID_STARTING,
  STATE_ID_EXECUTE,
  STATE_ID_STOPPING,
  STATE_ID_COMPLETE,
  STATE_ID_E_STOP,
} from "./state-machine";

export interface ResolvedIoSignal {
  tag: string;
  suffix: string;
  kind: IoSignalKind;
  io_address: string;
  description: string;
}

export interface ResolvedDevice {
  control_module_id: string;
  control_module_name: string;
  control_module_class: RandomFdsControlModuleClass;
  description: string;
  is_safety: boolean;
  /** Short tag prefix derived from equipment_module + device names, e.g. "CV01_M01". */
  tag_prefix: string;
  io_signals: ResolvedIoSignal[];
}

export interface ResolvedAssembly {
  equipment_module_id: string;
  equipment_module_name: string;
  unit_id: string;
  control_modules: ResolvedDevice[];
}

const STATE_KEY_TO_ID: Record<StateKey, number> = {
  STARTING: STATE_ID_STARTING,
  EXECUTE: STATE_ID_EXECUTE,
  STOPPING: STATE_ID_STOPPING,
};

function findIo(device: ResolvedDevice, suffix: string): ResolvedIoSignal | undefined {
  return device.io_signals.find((s) => s.suffix === suffix);
}

function buildSteps(equipment_module: ResolvedAssembly, stateKey: StateKey): PhaseStep[] {
  // For each device, append its step templates to the equipment_module's step list.
  // Step numbers are 1-based within the state. step_id = "<state>-<n>".
  const stateId = STATE_KEY_TO_ID[stateKey];
  const branchId = `b-${equipment_module.equipment_module_id}-${stateId}-main`;

  const collected: Array<{
    deviceTagPrefix: string;
    deviceName: string;
    template: ReturnType<typeof DEVICE_TEMPLATES.motor.stepTemplates.STARTING.at>;
    device: ResolvedDevice;
  }> = [];
  for (const dev of equipment_module.control_modules) {
    const tpl = DEVICE_TEMPLATES[dev.control_module_class];
    for (const step of tpl.stepTemplates[stateKey]) {
      collected.push({ deviceTagPrefix: dev.tag_prefix, deviceName: dev.control_module_name, template: step, device: dev });
    }
  }

  const built: PhaseStep[] = collected.map((c, idx) => {
    if (!c.template) throw new Error("step template missing");
    const tpl = c.template;
    const stepNumber = idx + 1;
    const stepId = `s-${stateId}-${stepNumber}`;

    // Resolve the completion criterion suffix → real tag
    const compIo = findIo(c.device, tpl.completion.suffix);
    if (!compIo) {
      throw new Error(
        `sequence-builder: device ${c.deviceTagPrefix} missing IO slot ${tpl.completion.suffix} for state ${stateKey}`,
      );
    }
    const criterion: CompletionCriterion = {
      kind: "tag_equals",
      tag: compIo.tag,
      value: tpl.completion.value,
      within_ms: tpl.completion.within_ms,
      on_fail: {
        fault_code: `F_${c.deviceTagPrefix}_TIMEOUT`,
        severity: "fault",
      },
    };

    // Resolve action prose (replace {SUFFIX} placeholders)
    const actionText = tpl.action.replace(/\{([A-Z_]+)\}/g, (_, suf: string) => {
      const io = findIo(c.device, suf);
      return io ? io.tag : `{${suf}}`;
    });

    // Build a single ActionV2 (manual_prose flavour — keeps the AI out of action structure)
    const action: ActionV2 = {
      kind: "manual_prose",
      action_id: `a-${stateId}-${stepNumber}-1`,
      text: actionText,
      referenced_tags: tpl.referencedSuffixes
        .map((s) => findIo(c.device, s)?.tag)
        .filter((t): t is string => Boolean(t)),
      prose: actionText,
    };

    return {
      // v2 SFC fields
      step_id: stepId,
      branch_id: branchId,
      name: `${c.deviceName}: ${tpl.name}`,
      actions: [action],
      monitors: [],
      transitions: [], // filled below
      // v1 legacy fields (still required by the schema during the shim window)
      step: stepNumber,
      action: actionText,
      completion_criteria: [criterion],
      completion_criteria_text: `${compIo.tag} = ${tpl.completion.value} within ${tpl.completion.within_ms}ms, else fault — ${c.deviceName} ${tpl.name.toLowerCase()} timeout`,
      on_fail: criterion.on_fail,
    };
  });

  // Wire transitions: every step except the last has a single default
  // transition to the next step.
  for (let i = 0; i < built.length - 1; i++) {
    const trans: TransitionV2 = {
      transition_id: `t-${stateId}-${i + 1}-to-${i + 2}`,
      kind: "single",
      target_step_id: built[i + 1].step_id!,
      guard: [],
      priority: 0,
      is_default: true,
      notes: null,
    };
    built[i].transitions = [trans];
  }

  return built;
}

function buildSequentialState(
  equipment_module: ResolvedAssembly,
  stateKey: StateKey,
): SequentialStateV2 {
  return {
    override_kind: "override",
    permissives: [],
    steps: buildSteps(equipment_module, stateKey),
    branches: [],
    state_monitors: [],
    sequence_model_version: 2,
    notes: null,
  };
}

function emptyStatic(): StaticStateV2 {
  return { override_kind: "override", control_modules: [], notes: null };
}

export function buildEquipmentModuleContracts(
  equipment_modules: ResolvedAssembly[],
): Record<string, EquipmentModuleContract> {
  const out: Record<string, EquipmentModuleContract> = {};
  for (const asm of equipment_modules) {
    const contract: EquipmentModuleContract = {
      equipment_module_id: asm.equipment_module_id,
      unit_id: asm.unit_id,
      static_states: {
        [String(STATE_ID_IDLE)]: emptyStatic(),
        [String(STATE_ID_COMPLETE)]: emptyStatic(),
        [String(STATE_ID_E_STOP)]: emptyStatic(),
      },
      sequential_states: {
        [String(STATE_ID_STARTING)]: buildSequentialState(asm, "STARTING"),
        [String(STATE_ID_EXECUTE)]: buildSequentialState(asm, "EXECUTE"),
        [String(STATE_ID_STOPPING)]: buildSequentialState(asm, "STOPPING"),
      },
    };
    // Belt-and-braces — fail loudly here, not at insert time.
    const parsed = EquipmentModuleContractSchema.safeParse(contract);
    if (!parsed.success) {
      throw new Error(
        `sequence-builder: equipment_module ${asm.equipment_module_id} contract failed Zod parse:\n${parsed.error.message}`,
      );
    }
    out[asm.equipment_module_id] = parsed.data;
  }
  return out;
}
