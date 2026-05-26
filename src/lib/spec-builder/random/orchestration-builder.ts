// src/lib/spec-builder/random/orchestration-builder.ts
/**
 * Builds the orchestrations slot of SpecContractPatch from resolved
 * subsystem/assembly inputs. Applies two canonical rules:
 *   - One SharedPermissive per subsystem per sequential state.
 *   - One InterAssemblyInterlock per adjacent assembly pair (none for
 *     single-assembly subsystems).
 */
import {
  SubsystemStateSequenceSchema,
  type SubsystemStateSequence,
  type SharedPermissive,
  type InterAssemblyInterlock,
} from "@/types/spec-contract-v2";
import { SEQUENTIAL_STATE_IDS, STATE_ID_STARTING } from "./state-machine";

export interface OrchestrationAssemblyInput {
  assembly_id: string;
  /** First device's run-feedback tag — used as the interlock source condition. */
  first_device_run_tag: string;
}

export interface OrchestrationInput {
  subsystem_id: string;
  assemblies: OrchestrationAssemblyInput[];
}

function buildSharedPermissive(subsystemId: string): SharedPermissive {
  return {
    permissive_id: `perm-${subsystemId}-estop`,
    condition: {
      kind: "tag_equals",
      tag: `E_STOP_CLEAR_${subsystemId.slice(0, 8)}`,
      value: true,
    },
    source_subsystem: subsystemId,
    prose: "Subsystem E-stop circuit clear",
  };
}

function buildInterlocks(input: OrchestrationInput): InterAssemblyInterlock[] {
  const out: InterAssemblyInterlock[] = [];
  for (let i = 0; i < input.assemblies.length - 1; i++) {
    const src = input.assemblies[i];
    const tgt = input.assemblies[i + 1];
    out.push({
      interlock_id: `il-${input.subsystem_id.slice(0, 8)}-${i}`,
      source_assembly: src.assembly_id,
      source_condition: {
        kind: "tag_equals",
        tag: src.first_device_run_tag,
        value: true,
      },
      target_assembly: tgt.assembly_id,
      effect: "enable",
      effect_target: { assembly: tgt.assembly_id, state_id: STATE_ID_STARTING },
      prose: `Upstream assembly running permits downstream STARTING`,
    });
  }
  return out;
}

export function buildOrchestrations(
  inputs: OrchestrationInput[],
): Record<string, Record<string, SubsystemStateSequence>> {
  const out: Record<string, Record<string, SubsystemStateSequence>> = {};
  for (const input of inputs) {
    const interlocks = buildInterlocks(input);
    const sharedPermissive = buildSharedPermissive(input.subsystem_id);

    const states: Record<string, SubsystemStateSequence> = {};
    for (const stateId of SEQUENTIAL_STATE_IDS) {
      const seq: SubsystemStateSequence = {
        assembly_order: input.assemblies.map((a) => a.assembly_id),
        shared_permissives: [sharedPermissive],
        inter_assembly_interlocks: interlocks,
        notes: null,
      };
      const parsed = SubsystemStateSequenceSchema.safeParse(seq);
      if (!parsed.success) {
        throw new Error(
          `orchestration-builder: subsystem ${input.subsystem_id} state ${stateId} failed Zod parse:\n${parsed.error.message}`,
        );
      }
      states[String(stateId)] = parsed.data;
    }
    out[input.subsystem_id] = states;
  }
  return out;
}
