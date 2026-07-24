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

  it("reorders authored states to match orderStates()'s BFS-from-safe-state output (not authored order)", () => {
    // Authored order is Execute, Idle, Faulted — but orderStates() starts at
    // the safe state (Idle) and walks transitions breadth-first, so the
    // generated .state CASE selector assigns Idle index 0, not Execute.
    const reorderedContract = {
      hierarchy: {
        units: [
          { unit_id: "u1", unit_name: "Line", excluded: false,
            equipment_modules: [{ equipment_module_id: "em1", equipment_module_name: "Drive", control_modules: [] }] },
        ],
      },
      equipment_modules: {
        em1: {
          states: [
            { state_id: "s_exec", name: "Execute", kind: "active" },
            { state_id: "s_idle", name: "Idle", kind: "idle", is_safe_state: true },
            { state_id: "s_flt", name: "Faulted", kind: "fault" },
          ],
          transitions: [
            { transition_id: "t1", from_state_id: "s_idle", to_state_id: "s_exec", trigger: {}, guard: [] },
            { transition_id: "t2", from_state_id: "s_exec", to_state_id: "s_flt", trigger: {}, guard: [] },
          ],
        },
      },
    } as unknown as SpecContractV2;

    const { ems } = buildEms(reorderedContract);
    expect(ems).toHaveLength(1);
    // orderStates() starts BFS at the safe state (Idle), not the authored-first
    // state (Execute) — proving buildEms reorders rather than passing authored
    // order straight through.
    expect(ems[0].states.map((s) => s.name)).toEqual(["Idle", "Execute", "Faulted"]);
    expect(ems[0].states[0].name).toBe("Idle");
    expect(ems[0].states[0].index).toBe(0);
  });
});
