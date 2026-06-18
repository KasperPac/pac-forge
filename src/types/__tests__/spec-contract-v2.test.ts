import { describe, expect, it } from "vitest";
import {
  ConfigParameterSchema,
  ExpressionSchema,
  InterEquipmentModuleInterlockSchema,
  OperatingStateV2Schema,
  OperatorModeSchema,
  ProjectSectionContentSchema,
  ProjectSectionTypeSchema,
  SequentialStateV2Schema,
  SpecContractV2Schema,
  UnitProcedureSequenceSchema,
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

describe("OperatingStateV2Schema PackML extensions", () => {
  it("accepts a legacy string state_id (shim window)", () => {
    const state = {
      state_id: "ST03",
      state_name: "Execute",
      description: "Running",
      state_pattern: "sequential",
    };
    expect(() => OperatingStateV2Schema.parse(state)).not.toThrow();
  });

  it("accepts a PackML numeric state_id with packml_id", () => {
    const state = {
      state_id: 6,
      packml_id: 6,
      display_name: "Execute",
      description: "Running",
      state_pattern: "sequential",
    };
    expect(() => OperatingStateV2Schema.parse(state)).not.toThrow();
  });

  it("accepts a custom state with custom_name and state_id > 100", () => {
    const state = {
      state_id: 101,
      custom_name: "Lubrication cycle",
      display_name: "Lubrication cycle",
      description: "Site-specific",
      state_pattern: "static",
    };
    expect(() => OperatingStateV2Schema.parse(state)).not.toThrow();
  });

  it("rejects packml_id outside 1..17", () => {
    const state = {
      state_id: 99,
      packml_id: 99,
      display_name: "Bad",
      description: "x",
      state_pattern: "static",
    };
    expect(() => OperatingStateV2Schema.parse(state)).toThrow();
  });
});

describe("InterEquipmentModuleInterlockSchema structured shape", () => {
  it("accepts a structured interlock with closed-set effect and CompletionCriterion source", () => {
    const interlock = {
      interlock_id: "il-1",
      source_equipment_module: "CV01",
      source_condition: {
        kind: "tag_equals",
        tag: "CV01.RUNNING",
        value: true,
      },
      target_equipment_module: "LFT01",
      effect: "hold",
      prose: "Hold lift until conveyor is running",
    };
    expect(() => InterEquipmentModuleInterlockSchema.parse(interlock)).not.toThrow();
  });

  it("accepts effect_target for targeted effects", () => {
    const interlock = {
      interlock_id: "il-2",
      source_equipment_module: "CV01",
      source_condition: {
        kind: "tag_equals",
        tag: "CV01.FAULT",
        value: true,
      },
      target_equipment_module: "LFT01",
      effect: "block_transition",
      effect_target: { equipment_module: "LFT01", state_id: 5 },
      prose: "Block lift execute on conveyor fault",
    };
    expect(() => InterEquipmentModuleInterlockSchema.parse(interlock)).not.toThrow();
  });

  it("rejects effect outside the closed enum", () => {
    const interlock = {
      interlock_id: "il-3",
      source_equipment_module: "A",
      source_condition: { kind: "tag_equals", tag: "T", value: true },
      target_equipment_module: "B",
      effect: "wave-hands",
      prose: "x",
    };
    expect(() => InterEquipmentModuleInterlockSchema.parse(interlock)).toThrow();
  });

  it("rejects prose source_condition (the old shape)", () => {
    const interlock = {
      interlock_id: "il-4",
      source_equipment_module: "A",
      source_condition: "CV01 is running",
      target_equipment_module: "B",
      effect: "hold",
      prose: "x",
    };
    expect(() => InterEquipmentModuleInterlockSchema.parse(interlock)).toThrow();
  });
});

describe("UnitProcedureSequenceSchema structured shared_permissives", () => {
  it("accepts SharedPermissive[] structured shape", () => {
    const seq = {
      equipment_module_order: ["CV01", "LFT01"],
      shared_permissives: [
        {
          permissive_id: "p1",
          condition: { kind: "tag_equals", tag: "ESTOP_01", value: false },
          prose: "E-stop not active",
        },
      ],
      inter_equipment_module_interlocks: [],
      notes: null,
    };
    expect(() => UnitProcedureSequenceSchema.parse(seq)).not.toThrow();
  });

  it("rejects prose string[] shared_permissives (the old shape)", () => {
    const seq = {
      equipment_module_order: ["CV01"],
      shared_permissives: ["ESTOP_01 = TRUE"],
      inter_equipment_module_interlocks: [],
      notes: null,
    };
    expect(() => UnitProcedureSequenceSchema.parse(seq)).toThrow();
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

describe("SpecContractV2Schema new top-level fields", () => {
  // Minimal valid contract scaffolding — uses ACTUAL existing schema shape:
  //   top-level key `project` (not `header`), schema_version:2 literal,
  //   system_orchestration nullable, scope_exclusions on header, etc.
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
      unit_procedures: {},
      system_orchestration: null,
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
