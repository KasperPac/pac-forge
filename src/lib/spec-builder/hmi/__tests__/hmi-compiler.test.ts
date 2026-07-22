// src/lib/spec-builder/hmi/__tests__/hmi-compiler.test.ts
//
// G7 W1 — text lists (G7-1) + alarm classes (G7-6). The text lists MUST match
// the em-builder dispatch order exactly: both call the same orderStates.
import { describe, expect, it } from "vitest";
import { buildHmiIr } from "../hmi-compiler";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

function fixture(): SpecContractV2 {
  const emStates = [
    { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
    { state_id: "execute", name: "Execute", kind: "static", allowed_modes: [], is_safe_state: false },
    { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: false },
  ];
  const emTransitions = [
    { transition_id: "t1", from_state_id: "idle", to_state_id: "execute",
      trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } }, guard: [] },
    { transition_id: "t2", from_state_id: "execute", to_state_id: "idle",
      trigger: { kind: "command", expr: { tag: "cmd_stop", operator: "=", value: true } }, guard: [] },
  ];
  return {
    schema_version: 3,
    project: {},
    hierarchy: {
      units: [
        {
          unit_id: "u1", unit_name: "Infeed Unit", equipment_type: "cell", description: "", excluded: false,
          equipment_modules: [
            { equipment_module_id: "em1", equipment_module_name: "Belt Drive", description: "", control_modules: [] },
            { equipment_module_id: "em2", equipment_module_name: "No Contract EM", description: "", control_modules: [] },
          ],
        },
      ],
    },
    equipment_modules: {
      em1: {
        equipment_module_id: "em1", unit_id: "u1",
        states: emStates, transitions: emTransitions,
        static_states: {}, sequential_states: {},
      },
    },
    unit_coordination: {
      u1: {
        unit_id: "u1",
        states: [
          { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
          { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
          { state_id: "aborted", allowed_modes: [], mode_change_allowed: true },
        ],
        transitions: [],
      },
    },
    alarm_tiers: [
      { tier_id: "critical", tier_name: "Critical", description: "" },
      { tier_id: "warning", tier_name: "Warning", description: "" },
    ],
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

describe("buildHmiIr — text lists (G7-1)", () => {
  it("emits one list per contracted EM matching the em-builder dispatch order, bound to the EM DB state", () => {
    const ir = buildHmiIr(fixture());
    const list = ir.textLists.find((l) => l.name === "Belt_Drive_States")!;
    expect(list).toBeDefined();
    expect(list.stateTag).toBe("EM_Belt_Drive_DB.state");

    const c = fixture().equipment_modules.em1;
    const expected = orderStates(c.states, c.transitions).map((s, i) => ({ index: i, text: s.name }));
    expect(list.entries).toEqual(expected);
  });

  it("emits no list for an EM without a state-machine contract", () => {
    const ir = buildHmiIr(fixture());
    expect(ir.textLists.find((l) => l.name.startsWith("No_Contract"))).toBeUndefined();
  });

  it("emits a unit list over the declared coordination states in canonical order, bound to UN Cur_St", () => {
    const ir = buildHmiIr(fixture());
    const list = ir.textLists.find((l) => l.name === "Infeed_Unit_States")!;
    expect(list.stateTag).toBe("UN_Infeed_Unit.Cur_St");
    // canonical UNIT_PACKML_STATES order: idle < execute < aborted
    expect(list.entries.map((e) => e.text)).toEqual(["Idle", "Execute", "Aborted"]);
    expect(list.entries.map((e) => e.index)).toEqual([0, 1, 2]);
  });
});

describe("buildHmiIr — alarm classes (G7-6)", () => {
  it("maps critical/fault-ish tiers to an acknowledging Fault class and the rest to Warning", () => {
    const ir = buildHmiIr(fixture());
    expect(ir.alarmClasses).toEqual([
      { name: "Fault", acknowledgement: true },
      { name: "Warning", acknowledgement: false },
    ]);
  });

  it("dedupes classes when multiple tiers map to the same class", () => {
    const c = fixture();
    c.alarm_tiers = [
      { tier_id: "critical", tier_name: "Critical", description: "" },
      { tier_id: "fault", tier_name: "Machine Fault", description: "" },
    ] as SpecContractV2["alarm_tiers"];
    const ir = buildHmiIr(c);
    expect(ir.alarmClasses).toEqual([{ name: "Fault", acknowledgement: true }]);
  });
});
