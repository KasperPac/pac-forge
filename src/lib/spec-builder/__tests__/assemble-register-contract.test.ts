import { describe, it, expect } from "vitest";
import { assembleContractFromRegister } from "@/lib/spec-builder/assemble-register-contract";
import type { Hierarchy } from "@/types/spec-contract-v2";
import type { MappingResponse } from "@/lib/spec-builder/register-mapping";

const hierarchy = {
  units: [{
    unit_id: "u1", unit_name: "UNGROUPED", equipment_type: "Other", description: "", excluded: false,
    equipment_modules: [{
      equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
      control_modules: [],
    }],
  }],
} as unknown as Hierarchy;

const mapping: MappingResponse = {
  unit_name: "Segment Wagon",
  modules: [{ equipment_module_id: "em1", source_requirements: "Driven by 4 Demag wheels..." }],
  faults: [], process_model: null,
};

describe("assembleContractFromRegister", () => {
  it("applies unit_name and returns per-EM requirements bound by id", () => {
    const { contract, emRequirements } = assembleContractFromRegister(hierarchy, mapping, { title: "Herrenknecht" });
    expect(contract.schema_version).toBe(3);
    expect(contract.hierarchy.units[0].unit_name).toBe("Segment Wagon");
    expect(emRequirements).toEqual([{ equipment_module_id: "em1", requirements: "Driven by 4 Demag wheels..." }]);
  });

  it("keeps the register unit_name when the mapping omits one", () => {
    const { contract } = assembleContractFromRegister(hierarchy, { ...mapping, unit_name: undefined }, { title: "X" });
    expect(contract.hierarchy.units[0].unit_name).toBe("UNGROUPED");
  });
});
