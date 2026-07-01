import { describe, it, expect } from "vitest";
import {
  CommandBranchSchema,
  CommandBehaviorV2Schema,
  EquipmentModuleContractSchema,
} from "@/types/spec-contract-v2";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "9b2e4c6a-8f3d-4a1b-b2c7-1e5f7a9d0c3e";

describe("CommandBranchSchema", () => {
  it("parses a command branch with a when-condition and holds", () => {
    const res = CommandBranchSchema.safeParse({
      branch_id: "drive_fwd",
      label: "Drive Forward",
      when: [{ tag: "cmd_fwd", operator: "=", value: true }],
      control_modules: [{ tag: "motor_fwd", description: "Motor forward", state: "on" }],
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty when array", () => {
    const res = CommandBranchSchema.safeParse({
      branch_id: "x", label: "X", when: [], control_modules: [],
    });
    expect(res.success).toBe(false);
  });
});

describe("CommandBehaviorV2Schema", () => {
  it("defaults branches and default_hold to empty arrays", () => {
    const res = CommandBehaviorV2Schema.parse({});
    expect(res.branches).toEqual([]);
    expect(res.default_hold).toEqual([]);
  });
});

describe("EquipmentModuleContract command_behavior", () => {
  const base = {
    equipment_module_id: UUID_A,
    unit_id: UUID_B,
    states: [],
    transitions: [],
    static_states: {},
    sequential_states: {},
  };

  it("is optional — a contract without it parses to undefined (backward-compat)", () => {
    const res = EquipmentModuleContractSchema.parse(base);
    expect(res.command_behavior).toBeUndefined();
  });

  it("round-trips command_behavior keyed by execute", () => {
    const res = EquipmentModuleContractSchema.safeParse({
      ...base,
      command_behavior: {
        execute: {
          branches: [{
            branch_id: "drive_fwd",
            label: "Drive Forward",
            when: [{ tag: "cmd_fwd", operator: "=", value: true }],
            control_modules: [{ tag: "motor_fwd", description: "", state: "on" }],
          }],
          default_hold: [{ tag: "motor_fwd", description: "", state: "off" }],
        },
      },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.command_behavior?.execute.branches[0].branch_id).toBe("drive_fwd");
    }
  });
});
