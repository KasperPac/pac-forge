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
    subsystems: [
      {
        subsystem_name: "Infeed",
        equipment_type: "Conveyor",
        description: "Belt conveyor that feeds parts onto the lift.",
        assemblies: [
          {
            assembly_name: "Conveyor CV01",
            description: "Single drive belt conveyor.",
            devices: [
              { device_name: "Drive Motor M01", device_class: "motor", description: "1.5 kW belt drive", is_safety: false },
              { device_name: "Part-Present Sensor PS01", device_class: "sensor_position", description: "Photoelectric, part detect", is_safety: false },
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
    const { title: _omit, ...rest } = valid;
    expect(() => RandomFdsThemeSchema.parse(rest)).toThrow();
  });

  it("rejects a device with an unknown device_class", () => {
    const bad = structuredClone(valid);
    bad.subsystems[0].assemblies[0].devices[0].device_class = "wormhole_drive";
    expect(() => RandomFdsThemeSchema.parse(bad)).toThrow();
  });

  it("rejects a subsystem with zero assemblies", () => {
    const bad = structuredClone(valid);
    bad.subsystems[0].assemblies = [];
    expect(() => RandomFdsThemeSchema.parse(bad)).toThrow();
  });
});
