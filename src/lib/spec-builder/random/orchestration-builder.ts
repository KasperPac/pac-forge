// src/lib/spec-builder/random/orchestration-builder.ts
/**
 * Builds the unit_procedures slot of SpecContractPatch from resolved
 * unit/equipment_module inputs. Applies two canonical rules:
 *   - One SharedPermissive per unit per sequential state.
 *   - One InterEquipmentModuleInterlock per adjacent equipment_module pair (none for
 *     single-equipment_module units).
 */
import {
  UnitProcedureSequenceSchema,
  type UnitProcedureSequence,
  type SharedPermissive,
  type InterEquipmentModuleInterlock,
} from "@/types/spec-contract-v2";
import { SEQUENTIAL_STATE_IDS, STATE_ID_STARTING } from "./state-machine";

export interface OrchestrationAssemblyInput {
  equipment_module_id: string;
  /** First device's run-feedback tag — used as the interlock source condition. */
  first_device_run_tag: string;
}

export interface OrchestrationInput {
  unit_id: string;
  equipment_modules: OrchestrationAssemblyInput[];
}

function buildSharedPermissive(unitId: string): SharedPermissive {
  return {
    permissive_id: `perm-${unitId}-estop`,
    condition: {
      kind: "tag_equals",
      tag: `E_STOP_CLEAR_${unitId.slice(0, 8)}`,
      value: true,
    },
    source_unit: unitId,
    prose: "Unit E-stop circuit clear",
  };
}

function buildInterlocks(input: OrchestrationInput): InterEquipmentModuleInterlock[] {
  const out: InterEquipmentModuleInterlock[] = [];
  for (let i = 0; i < input.equipment_modules.length - 1; i++) {
    const src = input.equipment_modules[i];
    const tgt = input.equipment_modules[i + 1];
    out.push({
      interlock_id: `il-${input.unit_id.slice(0, 8)}-${i}`,
      source_equipment_module: src.equipment_module_id,
      source_condition: {
        kind: "tag_equals",
        tag: src.first_device_run_tag,
        value: true,
      },
      target_equipment_module: tgt.equipment_module_id,
      effect: "enable",
      effect_target: { equipment_module: tgt.equipment_module_id, state_id: STATE_ID_STARTING },
      prose: `Upstream equipment_module running permits downstream STARTING`,
    });
  }
  return out;
}

export function buildOrchestrations(
  inputs: OrchestrationInput[],
): Record<string, Record<string, UnitProcedureSequence>> {
  const out: Record<string, Record<string, UnitProcedureSequence>> = {};
  for (const input of inputs) {
    const interlocks = buildInterlocks(input);
    const sharedPermissive = buildSharedPermissive(input.unit_id);

    const states: Record<string, UnitProcedureSequence> = {};
    for (const stateId of SEQUENTIAL_STATE_IDS) {
      const seq: UnitProcedureSequence = {
        equipment_module_order: input.equipment_modules.map((a) => a.equipment_module_id),
        shared_permissives: [sharedPermissive],
        inter_equipment_module_interlocks: interlocks,
        notes: null,
      };
      const parsed = UnitProcedureSequenceSchema.safeParse(seq);
      if (!parsed.success) {
        throw new Error(
          `orchestration-builder: unit ${input.unit_id} state ${stateId} failed Zod parse:\n${parsed.error.message}`,
        );
      }
      states[String(stateId)] = parsed.data;
    }
    out[input.unit_id] = states;
  }
  return out;
}
