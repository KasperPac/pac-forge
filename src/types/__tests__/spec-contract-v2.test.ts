import { describe, expect, it } from "vitest";
import {
  ConfigParameterSchema,
  ControlModuleV2Schema,
  DriveModelV1Schema,
  EngineeringDataV1Schema,
  ExpressionSchema,
  ModeKindSchema,
  OperatorModeSchema,
  ProjectSectionContentSchema,
  ProjectSectionTypeSchema,
  SequentialStateV2Schema,
  SpecContractV2Schema,
  UNIT_PACKML_STATES,
  UnitCoordinationV1Schema,
} from "../spec-contract-v2";

describe("OperatorModeSchema", () => {
  it("accepts a valid default mode", () => {
    const mode = {
      mode_id: "auto",
      name: "Auto",
      description: "Fully automatic",
      is_default: true,
    };
    expect(() => OperatorModeSchema.parse(mode)).not.toThrow();
  });

  it("accepts a non-default mode without description", () => {
    const mode = { mode_id: "manual", name: "Manual", is_default: false };
    expect(() => OperatorModeSchema.parse(mode)).not.toThrow();
  });

  it("rejects empty mode_id", () => {
    const mode = { mode_id: "", name: "X", is_default: true };
    expect(() => OperatorModeSchema.parse(mode)).toThrow();
  });

  it("rejects missing is_default", () => {
    const mode = { mode_id: "auto", name: "Auto" };
    expect(() => OperatorModeSchema.parse(mode)).toThrow();
  });
});

describe("ConfigParameterSchema", () => {
  it("accepts a parameter with discrete enum values", () => {
    const param = {
      parameter_id: "battery_chemistry",
      name: "Battery chemistry",
      allowed_values: ["LFP", "NMC"],
      default: "LFP",
      description: "Cathode material selection",
    };
    expect(() => ConfigParameterSchema.parse(param)).not.toThrow();
  });

  it("rejects when default is not in allowed_values", () => {
    const param = {
      parameter_id: "x",
      name: "X",
      allowed_values: ["A", "B"],
      default: "C",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow(/default/i);
  });

  it("rejects empty allowed_values", () => {
    const param = {
      parameter_id: "x",
      name: "X",
      allowed_values: [],
      default: "C",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow();
  });

  it("rejects empty parameter_id", () => {
    const param = {
      parameter_id: "",
      name: "X",
      allowed_values: ["A"],
      default: "A",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow();
  });
});

describe("ExpressionSchema parameter_ref variant", () => {
  it("accepts a parameter_ref expression", () => {
    const expr = { kind: "parameter_ref", parameter_id: "battery_chemistry" };
    expect(() => ExpressionSchema.parse(expr)).not.toThrow();
  });

  it("rejects parameter_ref without parameter_id", () => {
    const expr = { kind: "parameter_ref" };
    expect(() => ExpressionSchema.parse(expr)).toThrow();
  });

  it("rejects empty parameter_id", () => {
    const expr = { kind: "parameter_ref", parameter_id: "" };
    expect(() => ExpressionSchema.parse(expr)).toThrow();
  });
});

describe("SequentialStateV2Schema override_kind", () => {
  const baseRow = {
    permissives: [],
    steps: [],
    notes: null,
  };

  it("accepts override_kind: override with steps", () => {
    const row = { ...baseRow, override_kind: "override" };
    expect(() => SequentialStateV2Schema.parse(row)).not.toThrow();
  });

  it("accepts override_kind: inherit with empty content", () => {
    const row = { ...baseRow, override_kind: "inherit" };
    expect(() => SequentialStateV2Schema.parse(row)).not.toThrow();
  });

  it("accepts override_kind: suppressed with empty content", () => {
    const row = { ...baseRow, override_kind: "suppressed" };
    expect(() => SequentialStateV2Schema.parse(row)).not.toThrow();
  });

  it("accepts omitted override_kind (defaults to override for legacy reads)", () => {
    expect(() => SequentialStateV2Schema.parse(baseRow)).not.toThrow();
  });

  it("rejects override_kind outside the enum", () => {
    const row = { ...baseRow, override_kind: "ignore" };
    expect(() => SequentialStateV2Schema.parse(row)).toThrow();
  });
});

describe("ProjectSectionTypeSchema", () => {
  it("accepts the six project-level section types", () => {
    [
      "document_control",
      "system_overview",
      "control_philosophy",
      "interfaces",
      "testing_fat",
      "hmi_specification",
    ].forEach((t) => {
      expect(() => ProjectSectionTypeSchema.parse(t)).not.toThrow();
    });
  });

  it("rejects per-equipment-module-state section types", () => {
    expect(() => ProjectSectionTypeSchema.parse("functional_description")).toThrow();
  });
});

describe("ProjectSectionContentSchema", () => {
  it("accepts a content row with markdown + json", () => {
    const content = {
      content_markdown: "## Overview\nLine 1",
      content_json: { paragraphs: ["Line 1"] },
    };
    expect(() => ProjectSectionContentSchema.parse(content)).not.toThrow();
  });

  it("accepts markdown-only content", () => {
    const content = { content_markdown: "Plain text" };
    expect(() => ProjectSectionContentSchema.parse(content)).not.toThrow();
  });

  it("rejects an empty content shape", () => {
    expect(() => ProjectSectionContentSchema.parse({})).toThrow();
  });
});

// Minimal valid contract scaffolding — uses ACTUAL existing schema shape:
//   top-level key `project` (not `header`), schema_version:2 literal,
//   system_orchestration nullable, scope_exclusions on header, etc.
// Module-scoped so it can be reused across describe blocks (see G0-9 tests).
function baseContract() {
  return {
    schema_version: 3,
    project: {
      id: "00000000-0000-0000-0000-000000000000",
      doc_code: "PAC-EFD-001",
      title: "Test",
      client_name: "Test Client",
      project_number: null,
      plc_model: null,
      hmi_type: null,
      comms_protocol: null,
      safety_classification: null,
      fault_philosophy: null,
      design_principles: [],
      scope_exclusions: [],
    },
    hierarchy: { units: [] },
    states: [],
    alarm_tiers: [],
    equipment_modules: {},
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

describe("SpecContractV2Schema new top-level fields", () => {
  it("accepts a contract with no modes / params / overrides (legacy default)", () => {
    expect(() => SpecContractV2Schema.parse(baseContract())).not.toThrow();
  });

  it("accepts a contract with modes populated", () => {
    const c = baseContract();
    (c as Record<string, unknown>).modes = [
      { mode_id: "auto", name: "Auto", is_default: true },
    ];
    expect(() => SpecContractV2Schema.parse(c)).not.toThrow();
  });

  it("accepts a contract with configuration_parameters", () => {
    const c = baseContract();
    (c as Record<string, unknown>).configuration_parameters = [
      {
        parameter_id: "x",
        name: "X",
        allowed_values: ["A", "B"],
        default: "A",
      },
    ];
    expect(() => SpecContractV2Schema.parse(c)).not.toThrow();
  });

  it("accepts a contract with section_overrides", () => {
    const c = baseContract();
    (c as Record<string, unknown>).section_overrides = {
      system_overview: { content_markdown: "Hello" },
    };
    expect(() => SpecContractV2Schema.parse(c)).not.toThrow();
  });

  it("rejects confirmation_status outside the closed set", () => {
    const c = baseContract();
    (c as Record<string, unknown>).confirmation_status = "halfway";
    expect(() => SpecContractV2Schema.parse(c)).toThrow();
  });
});

describe("OperatorMode.kind (G0-9)", () => {
  it("defaults kind to 'custom' so pre-G0-9 stored contracts parse unchanged", () => {
    const parsed = OperatorModeSchema.parse({
      mode_id: "auto",
      name: "Auto",
      is_default: true,
    });
    expect(parsed.kind).toBe("custom");
  });

  it("accepts each semantic kind", () => {
    for (const kind of ["production", "maintenance", "manual", "engineering", "custom"]) {
      const parsed = OperatorModeSchema.parse({
        mode_id: "m",
        name: "M",
        is_default: false,
        kind,
      });
      expect(parsed.kind).toBe(kind);
    }
  });

  it("rejects unknown kinds", () => {
    const res = OperatorModeSchema.safeParse({
      mode_id: "m",
      name: "M",
      is_default: false,
      kind: "turbo",
    });
    expect(res.success).toBe(false);
  });

  it("ModeKindSchema exposes exactly the five kinds", () => {
    expect(ModeKindSchema.options).toEqual([
      "production",
      "maintenance",
      "manual",
      "engineering",
      "custom",
    ]);
  });
});

describe("UnitCoordinationV1 (G0-9)", () => {
  const minimalCoord = {
    unit_id: "unit_1",
    states: [{ state_id: "idle" }, { state_id: "execute" }, { state_id: "stopped" }],
    transitions: [
      {
        transition_id: "t_start",
        from_state_id: "idle",
        to_state_id: "execute",
        trigger: { type: "command", command: "start" },
      },
    ],
  };

  it("parses a minimal coordination with defaults applied", () => {
    const parsed = UnitCoordinationV1Schema.parse(minimalCoord);
    expect(parsed.states[0]).toEqual({
      state_id: "idle",
      allowed_modes: [],
      mode_change_allowed: false,
    });
    expect(parsed.transitions[0].guard).toEqual([]);
    expect(parsed.transitions[0].allowed_modes).toEqual([]);
    expect(parsed.em_command_overrides).toBeUndefined();
  });

  it("rejects state_ids outside the canonical PackML set", () => {
    const res = UnitCoordinationV1Schema.safeParse({
      ...minimalCoord,
      states: [{ state_id: "warp_speed" }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts all three trigger types", () => {
    const triggers = [
      { type: "command", command: "abort" },
      { type: "condition", expr: [{ tag: "X", operator: "=", value: true }] },
      { type: "em_aggregate", em_scope: "all", em_state: "idle" },
    ];
    for (const trigger of triggers) {
      const res = UnitCoordinationV1Schema.safeParse({
        ...minimalCoord,
        transitions: [
          { transition_id: "t", from_state_id: "idle", to_state_id: "stopped", trigger },
        ],
      });
      expect(res.success).toBe(true);
    }
  });

  it("rejects a condition trigger with an empty expr", () => {
    const res = UnitCoordinationV1Schema.safeParse({
      ...minimalCoord,
      transitions: [
        {
          transition_id: "t",
          from_state_id: "idle",
          to_state_id: "stopped",
          trigger: { type: "condition", expr: [] },
        },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("parses sparse em_command_overrides and tolerates explicit null (AI-authored JSON)", () => {
    const emId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const parsed = UnitCoordinationV1Schema.parse({
      ...minimalCoord,
      em_command_overrides: {
        stopped: [{ equipment_module_id: emId, command: "NONE" }],
      },
    });
    expect(parsed.em_command_overrides?.stopped?.[0].command).toBe("NONE");
    const nulled = UnitCoordinationV1Schema.parse({
      ...minimalCoord,
      em_command_overrides: null,
    });
    expect(nulled.em_command_overrides).toBeUndefined();
  });

  it("UNIT_PACKML_STATES is the 17-state canonical set", () => {
    expect(UNIT_PACKML_STATES).toHaveLength(17);
    expect(UNIT_PACKML_STATES).toContain("unsuspending");
  });

  it("SpecContractV2Schema accepts an absent unit_coordination (additive wave)", () => {
    const c = baseContract();
    const parsed = SpecContractV2Schema.parse(c);
    expect(parsed.unit_coordination).toBeUndefined();

    const withCoord = { ...c, unit_coordination: { unit_1: minimalCoord } };
    const parsedWithCoord = SpecContractV2Schema.parse(withCoord);
    expect(parsedWithCoord.unit_coordination?.unit_1.unit_id).toBe("unit_1");
  });
});

describe("DriveModelV1 (G0-1)", () => {
  const goldenDrive = {
    family: "sinamics_g120",
    telegram: 1,
    speed_ref: { unit: "percent_ref_speed", signed: true },
    enable_policy: "enable_on_nonzero_ref",
  };

  it("parses the golden-master drive model", () => {
    expect(DriveModelV1Schema.parse(goldenDrive)).toEqual(goldenDrive);
  });

  it("telegram is optional (assembly/vendor-profile families)", () => {
    const abb = { ...goldenDrive, family: "abb_acs880" } as Record<string, unknown>;
    delete abb.telegram;
    expect(DriveModelV1Schema.parse(abb).telegram).toBeUndefined();
  });

  it("rejects unknown enable_policy", () => {
    expect(() =>
      DriveModelV1Schema.parse({ ...goldenDrive, enable_policy: "always_on" }),
    ).toThrow();
  });

  it("ControlModuleV2 accepts an optional drive key and parses without one", () => {
    const cm = {
      control_module_id: "00000000-0000-4000-8000-000000000001",
      control_module_name: "VSD1",
      control_module_class: "drive",
      is_safety: false,
      description: "Rail motors VSD",
      io_signals: [],
    };
    expect(ControlModuleV2Schema.parse(cm).drive).toBeUndefined();
    expect(ControlModuleV2Schema.parse({ ...cm, drive: goldenDrive }).drive).toEqual(
      goldenDrive,
    );
  });
});

describe("EngineeringDataV1 (G0-1)", () => {
  it("applies the 16#003F config_axis default and parses half-filled entries", () => {
    const parsed = EngineeringDataV1Schema.parse({
      drives: [{ control_module_id: "00000000-0000-4000-8000-000000000001" }],
    });
    expect(parsed.drives[0].config_axis).toBe(0x003f);
    expect(parsed.drives[0].ref_speed_rpm).toBeUndefined();
  });

  it("defaults drives to an empty array", () => {
    expect(EngineeringDataV1Schema.parse({}).drives).toEqual([]);
  });

  it("parses the golden-master engineering entry", () => {
    const entry = {
      control_module_id: "00000000-0000-4000-8000-000000000001",
      hw_id_stw: 322,
      hw_id_zsw: 322,
      ref_speed_rpm: 1500.0,
      config_axis: 0x003f,
    };
    expect(EngineeringDataV1Schema.parse({ drives: [entry] }).drives[0]).toEqual(entry);
  });

  it("rejects negative ref_speed_rpm", () => {
    expect(() =>
      EngineeringDataV1Schema.parse({
        drives: [
          {
            control_module_id: "00000000-0000-4000-8000-000000000001",
            ref_speed_rpm: -1500,
          },
        ],
      }),
    ).toThrow();
  });

  it("SpecContractV2Schema accepts an absent engineering key (additive wave)", () => {
    const c = baseContract();
    expect(SpecContractV2Schema.parse(c).engineering).toBeUndefined();
    const withEng = { ...c, engineering: { drives: [] } };
    expect(SpecContractV2Schema.parse(withEng).engineering?.drives).toEqual([]);
  });
});
