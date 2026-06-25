import { describe, it, expect } from "vitest";
import { buildEmUiModel } from "@/lib/spec-builder/code-builder-em-ui-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

function fixture(): SpecContractV2 {
  return {
    hierarchy: {
      units: [
        {
          unit_id: "u1",
          unit_name: "Carriage Unit",
          excluded: false,
          equipment_type: "test",
          description: "test",
          equipment_modules: [
            {
              equipment_module_id: "em1",
              equipment_module_name: "Carriage",
              control_modules: [],
            },
            {
              equipment_module_id: "em2",
              equipment_module_name: "Clamp",
              control_modules: [],
            },
          ],
        },
        {
          unit_id: "u2",
          unit_name: "Excluded Unit",
          excluded: true,
          equipment_type: "test",
          description: "test",
          equipment_modules: [
            {
              equipment_module_id: "em3",
              equipment_module_name: "Ghost",
              control_modules: [],
            },
          ],
        },
      ],
    },
    equipment_modules: {
      em1: {
        equipment_module_id: "em1",
        unit_id: "u1",
        states: [
          {
            state_id: "idle",
            name: "Idle",
            kind: "static",
            allowed_modes: [],
            is_safe_state: true,
          },
          {
            state_id: "active",
            name: "Active",
            kind: "static",
            allowed_modes: [],
            is_safe_state: false,
          },
        ],
        transitions: [
          {
            transition_id: "t1",
            from_state_id: "idle",
            to_state_id: "active",
            trigger: {
              kind: "command",
              expr: { tag: "start_cmd", operator: "=", value: true },
            },
            guard: [{ tag: "enable", operator: "=", value: true }],
          },
        ],
        static_states: {},
        sequential_states: {},
      },
      // em2 intentionally absent → must yield empty arrays
    },
  } as unknown as SpecContractV2;
}

describe("buildEmUiModel", () => {
  it("groups EMs by their non-excluded Unit in declared order", () => {
    const m = buildEmUiModel(fixture());
    expect(m.unitGroups).toHaveLength(1);
    expect(m.unitGroups[0]).toMatchObject({
      unitId: "u1",
      unitName: "Carriage Unit",
      emIds: ["em1", "em2"],
    });
  });

  it("maps every EM to its state machine, empty when no contract entry", () => {
    const m = buildEmUiModel(fixture());
    expect(m.emById.em1.emName).toBe("Carriage");
    expect(m.emById.em1.states).toHaveLength(2);
    expect(m.emById.em1.transitions).toHaveLength(1);
    expect(m.emById.em2.states).toEqual([]);
    expect(m.emById.em2.transitions).toEqual([]);
  });

  it("skips excluded units and their EMs", () => {
    const m = buildEmUiModel(fixture());
    expect(m.emById.em3).toBeUndefined();
    expect(m.unitGroups.find((g) => g.unitId === "u2")).toBeUndefined();
  });
});
