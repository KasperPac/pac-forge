/**
 * Builds V2 AssemblyContract records (static + sequential states) per
 * assembly from resolved hierarchy + device IO. Each produced contract
 * is Zod-validated before return so a builder bug fails loudly here
 * rather than silently at insert time.
 */
import {
  AssemblyContractSchema,
  type AssemblyContract,
  type CompletionCriterion,
  type SequentialStateV2,
  type StaticStateV2,
  type StepV2,
  type TransitionV2,
  type ActionV2,
} from "@/types/spec-contract-v2";
import type { IoSignalKind } from "./io-allocator";
import type { RandomFdsDeviceClass } from "./theme-schema";
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
  device_id: string;
  device_name: string;
  device_class: RandomFdsDeviceClass;
  description: string;
  is_safety: boolean;
  /** Short tag prefix derived from assembly + device names, e.g. "CV01_M01". */
  tag_prefix: string;
  io_signals: ResolvedIoSignal[];
}

export interface ResolvedAssembly {
  assembly_id: string;
  assembly_name: string;
  subsystem_id: string;
  devices: ResolvedDevice[];
}

const STATE_KEY_TO_ID: Record<StateKey, number> = {
  STARTING: STATE_ID_STARTING,
  EXECUTE: STATE_ID_EXECUTE,
  STOPPING: STATE_ID_STOPPING,
};

function findIo(device: ResolvedDevice, suffix: string): ResolvedIoSignal | undefined {
  return device.io_signals.find((s) => s.suffix === suffix);
}

function buildSteps(assembly: ResolvedAssembly, stateKey: StateKey): StepV2[] {
  // For each device, append its step templates to the assembly's step list.
  // Step numbers are 1-based within the state. step_id = "<state>-<n>".
  const stateId = STATE_KEY_TO_ID[stateKey];
  const branchId = `b-${assembly.assembly_id}-${stateId}-main`;

  const collected: Array<{
    deviceTagPrefix: string;
    deviceName: string;
    template: ReturnType<typeof DEVICE_TEMPLATES.motor.stepTemplates.STARTING.at>;
    device: ResolvedDevice;
  }> = [];
  for (const dev of assembly.devices) {
    const tpl = DEVICE_TEMPLATES[dev.device_class];
    for (const step of tpl.stepTemplates[stateKey]) {
      collected.push({ deviceTagPrefix: dev.tag_prefix, deviceName: dev.device_name, template: step, device: dev });
    }
  }

  const built: StepV2[] = collected.map((c, idx) => {
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
  assembly: ResolvedAssembly,
  stateKey: StateKey,
): SequentialStateV2 {
  return {
    override_kind: "override",
    permissives: [],
    steps: buildSteps(assembly, stateKey),
    branches: [],
    state_monitors: [],
    sequence_model_version: 2,
    notes: null,
  };
}

function emptyStatic(): StaticStateV2 {
  return { override_kind: "override", devices: [], notes: null };
}

export function buildAssemblyContracts(
  assemblies: ResolvedAssembly[],
): Record<string, AssemblyContract> {
  const out: Record<string, AssemblyContract> = {};
  for (const asm of assemblies) {
    const contract: AssemblyContract = {
      assembly_id: asm.assembly_id,
      subsystem_id: asm.subsystem_id,
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
    const parsed = AssemblyContractSchema.safeParse(contract);
    if (!parsed.success) {
      throw new Error(
        `sequence-builder: assembly ${asm.assembly_id} contract failed Zod parse:\n${parsed.error.message}`,
      );
    }
    out[asm.assembly_id] = parsed.data;
  }
  return out;
}
