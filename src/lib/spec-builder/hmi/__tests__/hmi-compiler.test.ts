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

describe("buildHmiIr — discrete alarms (G7-2)", () => {
  function alarmFixture(): SpecContractV2 {
    const c = fixture();
    c.alarms = [
      { id: "a1", tier_id: "critical", control_module_id: null, equipment_module_id: "em1", unit_id: "u1",
        tag: "Belt_FAULT", description: "Belt drive fault", action: "Stop" },
      { id: "a2", tier_id: "critical", control_module_id: null, equipment_module_id: null, unit_id: null,
        tag: "EStop_Healthy", description: "Emergency stop active", action: "E-stop" },
      { id: "a3", tier_id: "warning", control_module_id: null, equipment_module_id: null, unit_id: null,
        tag: "Belt_Therm", description: "Thermistor overtemperature", action: "Stop" },
    ] as SpecContractV2["alarms"];
    c.safety_gates = [
      { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_Healthy", operator: "=", value: true }], scope: "all" },
    ] as SpecContractV2["safety_gates"];
    // Belt_Therm is an N/C fail-safe wired DI on a CM
    c.hierarchy.units[0].equipment_modules[0].control_modules = [
      {
        control_module_id: "cm1", control_module_name: "M1", control_module_class: "motor",
        is_safety: false, description: "",
        io_signals: [
          { tag: "Belt_Therm", signal_type: "DI", io_address: "I0.0", description: "", source: "wired", polarity: "nc" },
          { tag: "Belt_FAULT", signal_type: "DI", io_address: "I0.1", description: "", source: "wired" },
        ],
      },
    ] as SpecContractV2["hierarchy"]["units"][0]["equipment_modules"][0]["control_modules"];
    return c;
  }

  it("maps contract alarms to discrete defs with tier-derived classes and default trigger 1", () => {
    const ir = buildHmiIr(alarmFixture());
    const a = ir.alarms.find((x) => x.tag === "Belt_FAULT")!;
    expect(a).toMatchObject({ triggerValue: 1, className: "Fault", text: "Belt drive fault" });
  });

  it("inverts the trigger for healthy-signal tags referenced by safety gates", () => {
    const ir = buildHmiIr(alarmFixture());
    const a = ir.alarms.find((x) => x.tag === "EStop_Healthy")!;
    expect(a.triggerValue).toBe(0); // healthy = TRUE → alarm when 0
    expect(a.className).toBe("Fault");
  });

  it("inverts the trigger for N/C fail-safe wired inputs", () => {
    const ir = buildHmiIr(alarmFixture());
    const a = ir.alarms.find((x) => x.tag === "Belt_Therm")!;
    expect(a.triggerValue).toBe(0); // N/C: healthy reads TRUE at the terminal
    expect(a.className).toBe("Warning");
  });

  it("derives a drive-fault alarm per detected drive bound to the telegram DB Error", () => {
    const c = alarmFixture();
    c.hierarchy.units[0].equipment_modules[0].control_modules[0].drive = {
      family: "sinamics_g120", telegram: 1,
      speed_ref: { unit: "percent_ref_speed", signed: false },
      enable_policy: "enable_on_nonzero_ref",
    };
    const ir = buildHmiIr(c);
    const a = ir.alarms.find((x) => x.tag === "SINA_SPEED_M1_DB.Error")!;
    expect(a).toMatchObject({ triggerValue: 1, className: "Fault" });
    expect(a.text).toContain("M1");
  });
});

describe("buildHmiIr — setpoints (G7-3) + tag binding (G7-4)", () => {
  function setpointFixture(): SpecContractV2 {
    const c = fixture();
    // EM contract with a symbolic setpoint hold → sp_ pin via the command seam
    c.equipment_modules.em1.static_states = {
      execute: [{ tag: "Belt_Speed_Ref", description: "speed", state: "RUN_SPEED" }],
    } as SpecContractV2["equipment_modules"]["em1"]["static_states"];
    c.hierarchy.units[0].equipment_modules[0].control_modules = [
      {
        control_module_id: "cm1", control_module_name: "M1", control_module_class: "motor",
        is_safety: false, description: "",
        io_signals: [
          { tag: "Belt_Speed_Ref", signal_type: "AO", io_address: "QW100", description: "", source: "wired" },
        ],
      },
    ] as SpecContractV2["hierarchy"]["units"][0]["equipment_modules"][0]["control_modules"];
    c.unit_coordination!.u1.axes = [
      { axis_id: "travel", kind: "linear", encoder_tag: "Enc", eu_unit: "mm",
        scale: { db_member: "scale_x10", retain: true, operator_settable: false },
        length: { db_member: "length_mm", retain: true, operator_settable: true,
          access: { required_level: 2, limits: { min: 0, max: 100000 } } },
        end_margin: { db_member: "end_margin_mm", default: 500, retain: true, operator_settable: false },
        ramp_zone: { db_member: "ramp_zone_mm", default: 2000, retain: true, operator_settable: false },
        gates: {}, unconfigured_open: true },
    ] as NonNullable<SpecContractV2["unit_coordination"]>["u1"]["axes"];
    return c;
  }

  it("derives setpoint fields from the EM command seam sp_ pins", () => {
    const ir = buildHmiIr(setpointFixture());
    const f = ir.setpoints.find((s) => s.tag.includes("_CMD.sp_"))!;
    expect(f).toBeDefined();
    expect(f.tag).toBe("Belt_Drive_CMD.sp_RUN_SPEED");
    expect(f.group).toBe("Belt Drive");
  });

  it("derives operator-settable CFG members with their G0-10 access levels and limits", () => {
    const ir = buildHmiIr(setpointFixture());
    const f = ir.setpoints.find((s) => s.tag === "CFG_Infeed_Unit.length_mm")!;
    expect(f.requiredLevel).toBe(2);
    expect(f.limits).toEqual({ min: 0, max: 100000 });
    // non-operator-settable members are NOT setpoint fields
    expect(ir.setpoints.find((s) => s.tag.endsWith("scale_x10"))).toBeUndefined();
  });

  it("collects every referenced binding as a deduped HMI tag with dots mapped to underscores", () => {
    const ir = buildHmiIr(setpointFixture());
    const t = ir.tags.find((x) => x.plcTag === "EM_Belt_Drive_DB.state")!;
    expect(t.name).toBe("EM_Belt_Drive_DB_state");
    const names = ir.tags.map((x) => x.plcTag);
    expect(new Set(names).size).toBe(names.length); // deduped
  });
});
