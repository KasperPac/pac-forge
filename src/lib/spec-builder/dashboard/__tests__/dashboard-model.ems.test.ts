import { describe, it, expect } from "vitest";
import { buildEms } from "@/lib/spec-builder/dashboard/dashboard-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const contract = {
  hierarchy: {
    units: [
      { unit_id: "u1", unit_name: "Line", excluded: false,
        equipment_modules: [{ equipment_module_id: "em1", equipment_module_name: "Drive", control_modules: [] }] },
    ],
  },
  equipment_modules: {
    em1: {
      states: [
        { state_id: "s0", name: "Idle", kind: "idle" },
        { state_id: "s1", name: "Execute", kind: "active" },
      ],
      transitions: [{ transition_id: "t1", from_state_id: "s0", to_state_id: "s1", trigger: {}, guard: [] }],
    },
  },
} as unknown as SpecContractV2;

describe("buildEms", () => {
  it("emits an EM with an ordered state list, a state tag, and name-mapped transitions", () => {
    const { ems } = buildEms(contract);
    expect(ems).toHaveLength(1);
    expect(ems[0].stateTag).toBe("EM_Drive_DB.state");
    expect(ems[0].unit).toBe("Line");
    expect(ems[0].states.map((s) => s.name)).toEqual(["Idle", "Execute"]);
    expect(ems[0].states[0].index).toBe(0);
    expect(ems[0].transitions[0]).toMatchObject({ from: "Idle", to: "Execute" });
  });
});
