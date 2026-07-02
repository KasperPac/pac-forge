import { describe, expect, it, vi, beforeEach } from "vitest";

const writeCalls: Array<{ table: string; op: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => ({ eq: () => { writeCalls.push({ table, op: "update", payload }); return Promise.resolve({ data: null, error: null }); } }),
      upsert: (payload: unknown) => { writeCalls.push({ table, op: "upsert", payload }); return Promise.resolve({ data: null, error: null }); },
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      insert: (payload: unknown) => { writeCalls.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
    }),
  },
}));

import {
  writeSpecContract,
  upgradeEquipmentModuleContracts,
  buildUpgradeContext,
  normalizeGranularity,
} from "../contract";

describe("writeSpecContract — hybrid state model persistence", () => {
  beforeEach(() => { writeCalls.length = 0; });

  it("routes safety_gates to spec_projects.safety_gates", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      safety_gates: [
        { gate_id: "estop", name: "E-Stop", condition: [{ tag: "E", operator: "=", value: false }], scope: "all" },
      ],
    });
    const p = writeCalls.find((c) => c.table === "spec_projects" && c.op === "update");
    expect(p?.payload).toMatchObject({ safety_gates: expect.any(Array) });
  });

  it("persists em_states/em_transitions on the fds_operation_sessions upsert", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      equipment_modules: {
        em1: {
          equipment_module_id: "00000000-0000-4000-8000-000000000001",
          unit_id: "00000000-0000-4000-8000-000000000002",
          states: [{ state_id: "safe", name: "Safe", kind: "static", allowed_modes: [], is_safe_state: true }],
          transitions: [],
          static_states: {},
          sequential_states: {},
        },
      },
    });
    const s = writeCalls.find((c) => c.table === "fds_operation_sessions" && c.op === "upsert");
    expect(s?.payload).toMatchObject({ em_states: expect.any(Array), em_transitions: expect.any(Array) });
  });
});

describe("command_behavior persistence (SP-3c)", () => {
  beforeEach(() => { writeCalls.length = 0; });

  const CB = {
    execute: {
      branches: [
        { branch_id: "drive_fwd", label: "Drive Forward",
          when: [{ tag: "CAR_CMD_FWD", operator: "=", value: true }],
          control_modules: [{ tag: "CAR_M01_FWD", description: "", state: "on" }] },
      ],
      default_hold: [{ tag: "CAR_M01_FWD", description: "", state: "off" }],
    },
  };

  it("upgradeEquipmentModuleContracts passes command_behavior through to the contract", () => {
    const ctx = buildUpgradeContext({});
    const out = upgradeEquipmentModuleContracts(
      [{ equipment_module_id: "em1", unit_id: "u1", static_states_v2: {}, sequential_states: {}, em_states: [], em_transitions: [], command_behavior: CB }],
      ctx,
    );
    expect(out.em1.command_behavior).toEqual(CB);
  });

  it("upgradeEquipmentModuleContracts yields undefined when the row has none (backward-compat)", () => {
    const ctx = buildUpgradeContext({});
    const out = upgradeEquipmentModuleContracts(
      [{ equipment_module_id: "em1", unit_id: "u1", static_states_v2: {}, sequential_states: {}, em_states: [], em_transitions: [] }],
      ctx,
    );
    expect(out.em1.command_behavior).toBeUndefined();
  });

  it("writeSpecContract persists command_behavior on the fds_operation_sessions upsert", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      equipment_modules: {
        em1: {
          equipment_module_id: "00000000-0000-4000-8000-000000000001",
          unit_id: "00000000-0000-4000-8000-000000000002",
          states: [
            { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
            { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
          ],
          transitions: [], static_states: {}, sequential_states: {},
          command_behavior: CB,
        },
      },
    });
    const s = writeCalls.find((c) => c.table === "fds_operation_sessions" && c.op === "upsert");
    expect(s?.payload).toMatchObject({ command_behavior: { execute: expect.any(Object) } });
  });
});

describe("normalizeGranularity (SP-3d — legacy section granularity at contract load)", () => {
  it("maps the legacy DB default 'assembly_state' to equipment_module_state", () => {
    expect(normalizeGranularity("assembly_state")).toBe("equipment_module_state");
  });

  it("maps legacy 'subsystem' to the contract's 'unit'", () => {
    expect(normalizeGranularity("subsystem")).toBe("unit");
  });

  it("passes contract-native 'unit' through unchanged", () => {
    expect(normalizeGranularity("unit")).toBe("unit");
  });

  it("passes contract-native 'project' through unchanged", () => {
    expect(normalizeGranularity("project")).toBe("project");
  });

  it("falls back to equipment_module_state for null/undefined/unknown", () => {
    expect(normalizeGranularity(null)).toBe("equipment_module_state");
    expect(normalizeGranularity(undefined)).toBe("equipment_module_state");
    expect(normalizeGranularity("something_unexpected")).toBe("equipment_module_state");
  });
});
