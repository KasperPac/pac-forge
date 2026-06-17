import type { Hierarchy, SpecContractV2 } from "@/types/spec-contract-v2";
import type { MappingResponse } from "@/lib/spec-builder/register-mapping";

export interface EmRequirement {
  equipment_module_id: string;
  requirements: string;
}

/**
 * Combine the deterministic register hierarchy with the model mapping into a
 * SpecContractV2 draft. Structure is never altered by the model — only
 * unit_name, states, faults, process_model come from the mapping. Per-EM
 * requirements are returned separately for storage in spec_source_sections
 * (keyed by equipment_module_id).
 */
export function assembleContractFromRegister(
  hierarchy: Hierarchy,
  mapping: MappingResponse,
  header: { title: string },
): { contract: SpecContractV2; emRequirements: EmRequirement[] } {
  const units = hierarchy.units.map((u) => ({
    ...u,
    unit_name: mapping.unit_name?.trim() ? mapping.unit_name : u.unit_name,
  }));

  const contract = {
    schema_version: 3,
    project: {
      id: crypto.randomUUID(),
      doc_code: "",
      title: header.title,
      client_name: "",
      project_number: null,
      plc_model: null,
      hmi_type: null,
      comms_protocol: null,
      safety_classification: null,
      fault_philosophy: null,
      design_principles: [],
      scope_exclusions: [],
    },
    hierarchy: { units },
    states: mapping.states,
    alarm_tiers: [],
    faults: mapping.faults,
    process_model: mapping.process_model,
  } as unknown as SpecContractV2;

  const emRequirements = mapping.modules.map((m) => ({
    equipment_module_id: m.equipment_module_id,
    requirements: m.source_requirements,
  }));

  return { contract, emRequirements };
}
