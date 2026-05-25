import { describe, expect, it } from "vitest";
import {
  ConfigParameterSchema,
  ExpressionSchema,
  InterAssemblyInterlockSchema,
  OperatingStateV2Schema,
  OperatorModeSchema,
  SequentialStateV2Schema,
  SubsystemStateSequenceSchema,
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

describe("InterAssemblyInterlockSchema structured shape", () => {
  it("accepts a structured interlock with closed-set effect and CompletionCriterion source", () => {
    const interlock = {
      interlock_id: "il-1",
      source_assembly: "CV01",
      source_condition: {
        kind: "tag_equals",
        tag: "CV01.RUNNING",
        value: true,
      },
      target_assembly: "LFT01",
      effect: "hold",
      prose: "Hold lift until conveyor is running",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).not.toThrow();
  });

  it("accepts effect_target for targeted effects", () => {
    const interlock = {
      interlock_id: "il-2",
      source_assembly: "CV01",
      source_condition: {
        kind: "tag_equals",
        tag: "CV01.FAULT",
        value: true,
      },
      target_assembly: "LFT01",
      effect: "block_transition",
      effect_target: { assembly: "LFT01", state_id: 5 },
      prose: "Block lift execute on conveyor fault",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).not.toThrow();
  });

  it("rejects effect outside the closed enum", () => {
    const interlock = {
      interlock_id: "il-3",
      source_assembly: "A",
      source_condition: { kind: "tag_equals", tag: "T", value: true },
      target_assembly: "B",
      effect: "wave-hands",
      prose: "x",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).toThrow();
  });

  it("rejects prose source_condition (the old shape)", () => {
    const interlock = {
      interlock_id: "il-4",
      source_assembly: "A",
      source_condition: "CV01 is running",
      target_assembly: "B",
      effect: "hold",
      prose: "x",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).toThrow();
  });
});

describe("SubsystemStateSequenceSchema structured shared_permissives", () => {
  it("accepts SharedPermissive[] structured shape", () => {
    const seq = {
      assembly_order: ["CV01", "LFT01"],
      shared_permissives: [
        {
          permissive_id: "p1",
          condition: { kind: "tag_equals", tag: "ESTOP_01", value: false },
          prose: "E-stop not active",
        },
      ],
      inter_assembly_interlocks: [],
      notes: null,
    };
    expect(() => SubsystemStateSequenceSchema.parse(seq)).not.toThrow();
  });

  it("rejects prose string[] shared_permissives (the old shape)", () => {
    const seq = {
      assembly_order: ["CV01"],
      shared_permissives: ["ESTOP_01 = TRUE"],
      inter_assembly_interlocks: [],
      notes: null,
    };
    expect(() => SubsystemStateSequenceSchema.parse(seq)).toThrow();
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
