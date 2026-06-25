import type {
  SpecContractV2,
  EmStateV2,
  EmTransitionV2,
} from "@/types/spec-contract-v2";

/** The EMs under one Unit, for the EM-layer list grouping. */
export interface CodeBuilderUnitGroup {
  unitId: string;
  unitName: string;
  emIds: string[];
}

/** State-machine data for one EM, for the State Diagram tab. */
export interface CodeBuilderEmInfo {
  emId: string;
  emName: string;
  states: EmStateV2[];
  transitions: EmTransitionV2[];
}

/** Everything the EM-layer UI needs that lives in the contract rather than the
 *  generated artifacts: which Unit owns each EM, and each EM's state machine.
 *  Pure, deterministic, generic across machine types. */
export interface CodeBuilderEmUiModel {
  unitGroups: CodeBuilderUnitGroup[];
  emById: Record<string, CodeBuilderEmInfo>;
}

export function buildEmUiModel(contract: SpecContractV2): CodeBuilderEmUiModel {
  const unitGroups: CodeBuilderUnitGroup[] = [];
  const emById: Record<string, CodeBuilderEmInfo> = {};

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    const emIds: string[] = [];
    for (const em of unit.equipment_modules) {
      emIds.push(em.equipment_module_id);
      const c = contract.equipment_modules[em.equipment_module_id];
      emById[em.equipment_module_id] = {
        emId: em.equipment_module_id,
        emName: em.equipment_module_name,
        states: c?.states ?? [],
        transitions: c?.transitions ?? [],
      };
    }
    unitGroups.push({ unitId: unit.unit_id, unitName: unit.unit_name, emIds });
  }

  return { unitGroups, emById };
}
