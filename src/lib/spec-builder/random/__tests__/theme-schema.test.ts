import { describe, expect, it } from "vitest";
import { RandomFdsThemeSchema } from "../theme-schema";

describe("RandomFdsThemeSchema", () => {
  const valid = {
    title: "Random Lift Station",
    system_description: "A two-station lift system.",
    plc_model: "S7-1500 / CPU 1516-3 PN/DP",
    hmi_type: "TP1200 Comfort",
    fault_philosophy: "Fault → controlled stop → operator reset",
    design_principles: ["Fail-safe defaults", "Operator-driven reset"],
    machine_theme: "vertical lift",
    safety_classification: null,
    units: [
      {
        unit_name: "Infeed",
        equipment_type: "Conveyor",
        description: "Belt conveyor that feeds parts onto the lift.",
        equipment_modules: [
          {
            equipment_module_name: "Conveyor CV01",
            description: "Single drive belt conveyor.",
            control_modules: [
              { control_module_name: "Drive Motor M01", control_module_class: "motor", description: "1.5 kW belt drive", is_safety: false },
              { control_module_name: "Part-Present Sensor PS01", control_module_class: "sensor_position", description: "Photoelectric, part detect", is_safety: false },
            ],
          },
        ],
      },
    ],
  };

  it("accepts a well-formed theme", () => {
    expect(() => RandomFdsThemeSchema.parse(valid)).not.toThrow();
  });

  it("rejects a theme missing title", () => {
    const rest = structuredClone(valid) as Partial<typeof valid>;
    delete rest.title;
    expect(() => RandomFdsThemeSchema.parse(rest)).toThrow();
  });

  it("rejects a device with an unknown control_module_class", () => {
    const bad = structuredClone(valid);
    bad.units[0].equipment_modules[0].control_modules[0].control_module_class = "wormhole_drive";
    expect(() => RandomFdsThemeSchema.parse(bad)).toThrow();
  });

  it("rejects a unit with zero equipment_modules", () => {
    const bad = structuredClone(valid);
    bad.units[0].equipment_modules = [];
    expect(() => RandomFdsThemeSchema.parse(bad)).toThrow();
  });
});
