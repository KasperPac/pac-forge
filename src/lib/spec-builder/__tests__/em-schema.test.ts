import { describe, expect, it } from "vitest";
import {
  EmStateV2Schema,
  EmTransitionV2Schema,
  SafetyGateV2Schema,
  EquipmentModuleContractSchema,
  SpecContractV2Schema,
} from "@/types/spec-contract-v2";

describe("EmStateV2Schema", () => {
  it("parses a minimal static state and defaults allowed_modes/is_safe_state", () => {
    const s = EmStateV2Schema.parse({ state_id: "idle", name: "Idle", kind: "static" });
    expect(s.allowed_modes).toEqual([]);
    expect(s.is_safe_state).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(() => EmStateV2Schema.parse({ state_id: "x", name: "X", kind: "bogus" })).toThrow();
  });
});

describe("EmTransitionV2Schema", () => {
  it("parses a command-triggered transition with a permissive guard", () => {
    const t = EmTransitionV2Schema.parse({
      transition_id: "t1",
      from_state_id: "stopped",
      to_state_id: "running",
      trigger: { kind: "command", expr: { tag: "HMI_Start", operator: "=", value: true } },
    });
    expect(t.guard).toEqual([]);
  });

  it("parses a completion-triggered transition", () => {
    const t = EmTransitionV2Schema.parse({
      transition_id: "t2",
      from_state_id: "starting",
      to_state_id: "execute",
      trigger: { kind: "completion" },
      guard: [{ tag: "Other_EM_Idle", operator: "=", value: true }],
    });
    expect(t.trigger.kind).toBe("completion");
    expect(t.guard).toHaveLength(1);
  });
});

describe("SafetyGateV2Schema", () => {
  it("parses scope 'all' and an array condition", () => {
    const g = SafetyGateV2Schema.parse({
      gate_id: "estop", name: "E-Stop",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
      scope: "all",
    });
    expect(g.scope).toBe("all");
  });

  it("parses scope as an equipment-module id list", () => {
    const g = SafetyGateV2Schema.parse({
      gate_id: "sr1", name: "Zone 1",
      condition: [{ tag: "SR1_Healthy", operator: "=", value: false }],
      scope: ["em-a", "em-b"],
    });
    expect(g.scope).toEqual(["em-a", "em-b"]);
  });
});

describe("EquipmentModuleContractSchema — states/transitions", () => {
  it("defaults states and transitions to empty arrays when absent", () => {
    const c = EquipmentModuleContractSchema.parse({
      equipment_module_id: "00000000-0000-4000-8000-000000000001",
      unit_id: "00000000-0000-4000-8000-000000000002",
      static_states: {},
      sequential_states: {},
    });
    expect(c.states).toEqual([]);
    expect(c.transitions).toEqual([]);
  });
});

describe("SpecContractV2Schema — safety_gates", () => {
  it("accepts a contract with safety_gates absent (defaults to [])", () => {
    const base = minimalContract();
    const c = SpecContractV2Schema.parse(base);
    expect(c.safety_gates).toEqual([]);
  });
});

function minimalContract() {
  return {
    schema_version: 3,
    project: {
      id: "00000000-0000-4000-8000-0000000000aa",
      doc_code: "D", title: "T", client_name: "C",
      project_number: null, plc_model: null, hmi_type: null,
      comms_protocol: null, safety_classification: null, fault_philosophy: null,
      design_principles: [], scope_exclusions: [],
    },
    hierarchy: { units: [] },
    states: [],
    alarm_tiers: [],
    equipment_modules: {},
    unit_procedures: {},
    alarms: [],
    io_list: [],
    faults: [],
    sections: {
      document_control: [],
      system_overview: [],
      control_philosophy: [],
      functional_description: [],
      io_list: [],
      alarm_specification: [],
      hmi_specification: [],
      interfaces: [],
      testing_fat: [],
      audit_report: [],
      introduction: [],
      equipment_description: [],
      functional_state: [],
      alarm_table: [],
      settings_table: [],
    },
  };
}
