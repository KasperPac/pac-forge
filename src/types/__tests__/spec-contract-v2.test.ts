import { describe, expect, it } from "vitest";
import { collectGateIds, validateAxes } from "@/lib/spec-builder/axis-model";
import { validateDriveModels } from "@/lib/spec-builder/drive-model";
import { validateIoSignals } from "@/lib/spec-builder/io-signal-model";
import { validateSignalRouting } from "@/lib/spec-builder/signal-routing";
import {
  AnalogScalingSchema,
  AxisV1Schema,
  ConfigParameterSchema,
  ControlModuleV2Schema,
  DriveModelV1Schema,
  EngineeringDataV1Schema,
  IoSignalV2Schema,
  ExpressionSchema,
  MaintenanceV1Schema,
  ModeKindSchema,
  OperatorModeSchema,
  ProjectSectionContentSchema,
  ProjectSectionTypeSchema,
  SequentialStateV2Schema,
  SignalRoutingV1Schema,
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

describe("EngineeringDataV1.io_conditioning_defaults (G0-2)", () => {
  it("parses blanket defaults and stays optional", () => {
    expect(EngineeringDataV1Schema.parse({}).io_conditioning_defaults).toBeUndefined();
    const parsed = EngineeringDataV1Schema.parse({
      io_conditioning_defaults: { di_debounce_ms: 10, ai_filter_ms: 100 },
    });
    expect(parsed.io_conditioning_defaults?.di_debounce_ms).toBe(10);
    expect(parsed.drives).toEqual([]); // G0-1 default untouched
  });

  it("rejects negative defaults", () => {
    expect(() =>
      EngineeringDataV1Schema.parse({
        io_conditioning_defaults: { di_debounce_ms: -5 },
      }),
    ).toThrow();
  });
});

describe("IoSignalV2 per-signal model (G0-2)", () => {
  const baseSig = {
    tag: "CM1_Therm",
    signal_type: "DI",
    io_address: "%I1.1",
    description: "Motor 1 thermistor",
    source: "wired",
  };

  it("parses a signal without any G0-2 field (back-compat)", () => {
    const parsed = IoSignalV2Schema.parse(baseSig);
    expect(parsed.polarity).toBeUndefined();
    expect(parsed.conditioning).toBeUndefined();
    expect(parsed.scaling).toBeUndefined();
  });

  it("parses an N/C fail-safe digital input with conditioning", () => {
    const parsed = IoSignalV2Schema.parse({
      ...baseSig,
      polarity: "nc",
      conditioning: { off_delay_ms: 5000 },
    });
    expect(parsed.polarity).toBe("nc");
    expect(parsed.conditioning?.off_delay_ms).toBe(5000);
  });

  it("parses an analog signal with raw↔EU scaling (inverted EU allowed)", () => {
    const parsed = IoSignalV2Schema.parse({
      ...baseSig,
      tag: "PT01",
      signal_type: "AI",
      scaling: {
        raw: { min: 4, max: 20, unit: "mA" },
        eu: { min: 10, max: 0, unit: "bar" },
      },
    });
    expect(parsed.scaling?.eu.unit).toBe("bar");
  });

  it("rejects unknown polarity and empty eu unit", () => {
    expect(() =>
      IoSignalV2Schema.parse({ ...baseSig, polarity: "inverted" }),
    ).toThrow();
    expect(() =>
      AnalogScalingSchema.parse({
        raw: { min: 4, max: 20, unit: "mA" },
        eu: { min: 0, max: 100, unit: "" },
      }),
    ).toThrow();
  });

  it("rejects negative conditioning delays", () => {
    expect(() =>
      IoSignalV2Schema.parse({ ...baseSig, conditioning: { on_delay_ms: -1 } }),
    ).toThrow();
  });
});

describe("SignalRoutingV1 (G0-3)", () => {
  const row = {
    row_id: "r1",
    target: { equipment_module_id: "em_drive", pin: "ilk_Fwd_Fast" },
    source: { kind: "io_tag", tag: "Fwd_Fast" },
    gates: [
      { kind: "named_gate", gate_id: "fwd_fast_ok" },
      { kind: "em_status", equipment_module_id: "em_ind", member: "permit_travel" },
    ],
  };

  it("parses a full routing model and applies defaults", () => {
    const parsed = SignalRoutingV1Schema.parse({
      safety_healthy: { gate_ids: ["estop"] },
      routing_rows: [row],
      two_detent: [{ jog_row_id: "r2", fast_row_id: "r1" }],
      command_routing: { policy: "walk_to_execute_stop_on_unhealthy" },
      first_out: { enabled: false },
    });
    expect(parsed.safety_healthy?.exclude_maintenance).toBe(true);
    expect(parsed.two_detent[0].fallback).toBe(true);
    expect(parsed.command_routing?.seq_test_release).toBe(true);
    expect(parsed.routing_rows[0].gates).toHaveLength(2);
  });

  it("defaults arrays and rejects unknown source kind", () => {
    const parsed = SignalRoutingV1Schema.parse({});
    expect(parsed.routing_rows).toEqual([]);
    expect(parsed.two_detent).toEqual([]);
    expect(() =>
      SignalRoutingV1Schema.parse({
        routing_rows: [{ ...row, source: { kind: "plc_tag", tag: "X" } }],
      }),
    ).toThrow();
  });

  it("UnitCoordinationV1 accepts optional signal_routing (back-compat)", () => {
    const coord = {
      unit_id: "u1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
    };
    expect(UnitCoordinationV1Schema.parse(coord).signal_routing).toBeUndefined();
    const withRouting = UnitCoordinationV1Schema.parse({
      ...coord,
      signal_routing: { routing_rows: [row] },
    });
    expect(withRouting.signal_routing?.routing_rows[0].row_id).toBe("r1");
  });

  it("rejects empty safety_healthy.gate_ids", () => {
    expect(() =>
      SignalRoutingV1Schema.parse({ safety_healthy: { gate_ids: [] } }),
    ).toThrow();
  });
});

describe("G0-1 golden fixture — HRE Carriage Drive", () => {
  it("expresses everything MAP_Carriage_Drive.scl hand-authored", () => {
    const cmId = "00000000-0000-4000-8000-000000000c01";
    const drive = DriveModelV1Schema.parse({
      family: "sinamics_g120",
      telegram: 1,
      speed_ref: { unit: "percent_ref_speed", signed: true },
      enable_policy: "enable_on_nonzero_ref",
    });
    const engineering = EngineeringDataV1Schema.parse({
      drives: [
        {
          control_module_id: cmId,
          hw_id_stw: 322,
          hw_id_zsw: 322,
          ref_speed_rpm: 1500.0,
          config_axis: 0x003f,
        },
      ],
    });
    const { errors, warnings } = validateDriveModels({
      control_modules: [
        { control_module_id: cmId, control_module_name: "Carriage_Drive_VSD", drive },
      ],
      engineering,
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    // the writer's %→rpm factor is derivable: 1500 / 100 = 15.0
    expect((engineering.drives[0].ref_speed_rpm ?? 0) / 100).toBe(15.0);
  });
});

describe("Maintenance config model (G0-5)", () => {
  it("parses overridable outputs with wire_check_only default", () => {
    const m = MaintenanceV1Schema.parse({
      overridable_outputs: [
        { tag: "Travel_Horn" },
        { tag: "CM1_Run", wire_check_only: true },
      ],
    });
    expect(m.overridable_outputs[0].wire_check_only).toBe(false);
    expect(m.overridable_outputs[1].wire_check_only).toBe(true);
    expect(MaintenanceV1Schema.parse({}).overridable_outputs).toEqual([]);
  });

  it("SpecContractV2 accepts an optional maintenance key (back-compat)", () => {
    const c = baseContract();
    expect(SpecContractV2Schema.parse(c).maintenance).toBeUndefined();
    const withMaint = SpecContractV2Schema.parse({
      ...c,
      maintenance: { overridable_outputs: [{ tag: "Horn" }] },
    });
    expect(withMaint.maintenance?.overridable_outputs).toHaveLength(1);
  });

  it("AxisV1 accepts an optional preset capability", () => {
    const rot = AxisV1Schema.parse({
      axis_id: "rotator",
      kind: "rotary",
      encoder_tag: "Rotator_Encoder_Pos",
      counts_per_rev: { db_member: "k" },
      home_windows: [{ center_deg10: 0, band_deg10: 20 }],
      preset: { blocked_while_em_execute: "em_rot_drive" },
    });
    expect(rot.preset?.blocked_while_em_execute).toBe("em_rot_drive");
  });

  it("EngineeringDataV1 carries encoder_presets with empty default", () => {
    expect(EngineeringDataV1Schema.parse({}).encoder_presets).toEqual([]);
    const parsed = EngineeringDataV1Schema.parse({
      encoder_presets: [
        {
          unit_id: "u1",
          axis_id: "rotator",
          ctrl_address: "%QB70",
          value_address: "%QD71",
          status_address: "%IB78",
        },
      ],
    });
    expect(parsed.encoder_presets[0].ctrl_address).toBe("%QB70");
  });
});

describe("EngineeringDataV1.commissioning_pack (G0-7)", () => {
  it("parses a filled pack and applies row defaults", () => {
    const parsed = EngineeringDataV1Schema.parse({
      commissioning_pack: {
        drive_checklist: [
          { drive_name: "VSD1", parameter: "p2000", value: "1500.0 rpm" },
        ],
        network_plan: [
          { device_name: "plc1", ip_address: "192.168.0.1", role: "PLC" },
        ],
        tag_table: [{ tag: "EStop_Healthy", address: "%I0.0" }],
        panel_accounts: [{ username: "operator1", role: "Operator" }],
        time_sync: { ntp_servers: ["192.168.0.250"], timezone: "Australia/Brisbane" },
      },
    });
    const pack = parsed.commissioning_pack;
    expect(pack?.drive_checklist[0].verified).toBe(false);
    expect(pack?.network_plan[0].set_on_site).toBe(false);
    expect(pack?.time_sync?.ntp_servers).toHaveLength(1);
  });

  it("defaults all section arrays and stays optional (back-compat)", () => {
    expect(EngineeringDataV1Schema.parse({}).commissioning_pack).toBeUndefined();
    const pack = EngineeringDataV1Schema.parse({ commissioning_pack: {} })
      .commissioning_pack;
    expect(pack?.drive_checklist).toEqual([]);
    expect(pack?.tag_table).toEqual([]);
    expect(pack?.panel_accounts).toEqual([]);
  });

  it("panel_accounts has no password field — secrets are stripped", () => {
    const pack = EngineeringDataV1Schema.parse({
      commissioning_pack: {
        panel_accounts: [
          { username: "eng1", role: "Engineer", password: "hunter2" },
        ],
      },
    }).commissioning_pack;
    expect(pack?.panel_accounts[0]).toEqual({ username: "eng1", role: "Engineer" });
  });
});

describe("AxisV1 + axis_constants (G0-4)", () => {
  const rail = {
    axis_id: "rail",
    kind: "linear",
    encoder_tag: "Carriage_Encoder_Pos",
    eu_unit: "mm",
    scale: { db_member: "mm_per_rev_x10" },
    length: { db_member: "rail_length_mm", operator_settable: true },
    end_margin: { db_member: "end_margin_mm", default: 500 },
    ramp_zone: { db_member: "ramp_zone_mm", default: 2000 },
    gates: { fwd_ok: "fwd_ok", fwd_fast_ok: "fwd_fast_ok" },
  };
  const rotator = {
    axis_id: "rotator",
    kind: "rotary",
    encoder_tag: "Rotator_Encoder_Pos",
    counts_per_rev: { db_member: "rot_counts_per_360", default: 0 },
    preset_offset: 500000,
    home_windows: [
      { center_deg10: 0, band_deg10: 20 },
      { center_deg10: 1800, band_deg10: 20 },
    ],
    gates: { at_home: "rot_at_home" },
  };

  it("parses linear + rotary axes with defaults", () => {
    const lin = AxisV1Schema.parse(rail);
    expect(lin.kind).toBe("linear");
    if (lin.kind === "linear") {
      expect(lin.scale.retain).toBe(true);
      expect(lin.scale.operator_settable).toBe(false);
      expect(lin.unconfigured_open).toBe(true);
    }
    const rot = AxisV1Schema.parse(rotator);
    if (rot.kind === "rotary") {
      expect(rot.home_windows).toHaveLength(2);
      expect(rot.preset_offset).toBe(500000);
    }
  });

  it("rejects unknown axis kind and empty home_windows", () => {
    expect(() => AxisV1Schema.parse({ ...rail, kind: "belt" })).toThrow();
    expect(() => AxisV1Schema.parse({ ...rotator, home_windows: [] })).toThrow();
  });

  it("UnitCoordinationV1 accepts optional axes (back-compat)", () => {
    const coord = {
      unit_id: "u1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
    };
    expect(UnitCoordinationV1Schema.parse(coord).axes).toBeUndefined();
    expect(
      UnitCoordinationV1Schema.parse({ ...coord, axes: [rail] }).axes,
    ).toHaveLength(1);
  });

  it("EngineeringDataV1 carries axis_constants with empty default", () => {
    expect(EngineeringDataV1Schema.parse({}).axis_constants).toEqual([]);
    const parsed = EngineeringDataV1Schema.parse({
      axis_constants: [
        { unit_id: "u1", axis_id: "rotator", values: { rot_counts_per_360: 40960 } },
      ],
    });
    expect(parsed.axis_constants[0].values.rot_counts_per_360).toBe(40960);
  });
});

// Shared HRE routing fixture (UC_Carriage.scl) — used by the G0-3 golden
// fixture and re-validated against the G0-4 axis gate registry (join proof).
function buildHreRouting() {
  const gate = (gate_id: string) => ({ kind: "named_gate" as const, gate_id });
  const permit = {
    kind: "em_status" as const,
    equipment_module_id: "em_travel_ind",
    member: "permit_travel",
  };
  const io = (tag: string) => ({ kind: "io_tag" as const, tag });
  return SignalRoutingV1Schema.parse({
      safety_healthy: { gate_ids: ["estop_healthy", "sr1_healthy"] },
      routing_rows: [
        {
          row_id: "fwd_fast",
          target: { equipment_module_id: "em_drive", pin: "ilk_Fwd_Fast_Carriage" },
          source: io("Fwd_Fast_Carriage"),
          gates: [gate("rot_at_home"), gate("fwd_fast_ok"), permit],
        },
        {
          row_id: "fwd",
          target: { equipment_module_id: "em_drive", pin: "ilk_Fwd_Carriage" },
          source: io("Fwd_Carriage"),
          gates: [gate("fwd_ok"), permit],
        },
        {
          row_id: "rev_fast",
          target: { equipment_module_id: "em_drive", pin: "ilk_Rev_Fast_Carriage" },
          source: io("Rev_Fast_Carriage"),
          gates: [gate("rot_at_home"), gate("rev_fast_ok"), permit],
        },
        {
          row_id: "rev",
          target: { equipment_module_id: "em_drive", pin: "ilk_Rev_Carriage" },
          source: io("Rev_Carriage"),
          gates: [gate("rev_ok"), permit],
        },
        {
          row_id: "limit_drive",
          target: { equipment_module_id: "em_drive", pin: "ilk_Long_Limit_Stop" },
          source: io("Long_Limit_Stop"),
        },
        {
          row_id: "limit_lim",
          target: { equipment_module_id: "em_limits", pin: "ilk_CM_Sensor_LS1" },
          source: io("Long_Limit_Stop"),
        },
      ],
      two_detent: [
        { jog_row_id: "fwd", fast_row_id: "fwd_fast" },
        { jog_row_id: "rev", fast_row_id: "rev_fast" },
      ],
      command_routing: { policy: "walk_to_execute_stop_on_unhealthy" },
      first_out: { enabled: false },
    });
}

const HRE_MEMBER_EMS = new Set([
  "em_drive",
  "em_limits",
  "em_travel_ind",
  "em_brake",
  "em_pendant",
]);

describe("G0-3 golden fixture — HRE Carriage unit routing", () => {
  it("expresses the UC_Carriage.scl routing table", () => {
    const routing = buildHreRouting();
    const issues = validateSignalRouting(
      { unit_id: "carriage", signal_routing: routing },
      {
        memberEmIds: HRE_MEMBER_EMS,
        safetyGateIds: new Set(["estop_healthy", "sr1_healthy"]),
      },
    );
    expect(issues).toEqual([]);
    // Long_Limit_Stop legitimately fans to two different EM pins
    expect(
      routing.routing_rows.filter(
        (r) => r.source.kind === "io_tag" && r.source.tag === "Long_Limit_Stop",
      ),
    ).toHaveLength(2);
  });
});

describe("G0-4 golden fixture — HRE axes + joined G0-3 routing", () => {
  const railAxis = {
    axis_id: "rail",
    kind: "linear",
    encoder_tag: "Carriage_Encoder_Pos",
    eu_unit: "mm",
    scale: { db_member: "mm_per_rev_x10", description: "fixed physics, set once" },
    length: { db_member: "rail_length_mm", operator_settable: true },
    end_margin: { db_member: "end_margin_mm", default: 500 },
    ramp_zone: { db_member: "ramp_zone_mm", default: 2000 },
    gates: {
      fwd_ok: "fwd_ok",
      fwd_fast_ok: "fwd_fast_ok",
      rev_ok: "rev_ok",
      rev_fast_ok: "rev_fast_ok",
    },
  };
  const rotatorAxis = {
    axis_id: "rotator",
    kind: "rotary",
    encoder_tag: "Rotator_Encoder_Pos",
    counts_per_rev: { db_member: "rot_counts_per_360", default: 0 },
    preset_offset: 500000,
    home_windows: [
      { center_deg10: 0, band_deg10: 20 },
      { center_deg10: 1800, band_deg10: 20 },
    ],
    gates: { at_home: "rot_at_home" },
  };

  it("HRE axes validate and their registry satisfies the G0-3 routing table", () => {
    const axes = [AxisV1Schema.parse(railAxis), AxisV1Schema.parse(rotatorAxis)];
    expect(validateAxes({ unit_id: "carriage", axes })).toEqual([]);
    const registry = collectGateIds(axes);
    expect(registry).toEqual(
      new Set(["fwd_ok", "fwd_fast_ok", "rev_ok", "rev_fast_ok", "rot_at_home"]),
    );
    // Re-validate the G0-3 golden routing WITH the registry — the join proof.
    const issues = validateSignalRouting(
      { unit_id: "carriage", signal_routing: buildHreRouting() },
      {
        memberEmIds: HRE_MEMBER_EMS,
        safetyGateIds: new Set(["estop_healthy", "sr1_healthy"]),
        namedGateIds: registry,
      },
    );
    expect(issues).toEqual([]);
  });
});

describe("G0-2 golden fixture — HRE N/C inputs + generic analog", () => {
  it("expresses the MAP-layer signal treatment hand-authored on HRE", () => {
    const signals = [
      { tag: "CM1_Therm", io_address: "%I1.1" },
      { tag: "VSD1_CB_Trip", io_address: "%I0.4" },
      { tag: "BR1_Fault", io_address: "%I0.3" },
    ].map((s) =>
      IoSignalV2Schema.parse({
        ...s,
        signal_type: "DI",
        description: "N/C fail-safe input",
        source: "wired",
        polarity: "nc",
      }),
    );
    const analog = IoSignalV2Schema.parse({
      tag: "PT01",
      signal_type: "AI",
      io_address: "%IW96",
      description: "Pressure transmitter",
      source: "wired",
      scaling: {
        raw: { min: 4, max: 20, unit: "mA" },
        eu: { min: 0, max: 10, unit: "bar" },
      },
    });
    const out = validateIoSignals([
      {
        control_module_id: "00000000-0000-4000-8000-000000000c02",
        control_module_name: "Carriage_Drive_VSD",
        io_signals: [...signals, analog],
      },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});
