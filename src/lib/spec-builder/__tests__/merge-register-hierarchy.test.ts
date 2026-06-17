import { describe, it, expect } from "vitest";
import { mergeRegisterIntoHierarchy } from "@/lib/spec-builder/merge-register-hierarchy";
import type { UnitConfig, InstrumentTag } from "@/types/spec-builder";

function tag(t: string, unit: string, control_module: string, addr: string, dir: string): InstrumentTag {
  return {
    tag: t, device_type: "", description: t, signal_type: dir, io_address: addr,
    control_module_class: "motor", signal_direction: dir as InstrumentTag["signal_direction"],
    unit_prefix: unit, is_safety: false, process_cell: "", unit,
    equipment_module: "", control_module,
  };
}

const units: UnitConfig[] = [{
  unit_id: "Infeed", unit_name: "Infeed", equipment_type: "Conveyor", description: "", excluded: false,
  equipment_modules: [{
    equipment_module_id: "CV01", equipment_module_name: "Conveyor CV01", description: "",
    control_modules: [{
      control_module_id: "M1", control_module_name: "Drive M1", control_module_class: "motor",
      description: "", is_safety: false,
      io_signals: [{ tag: "CV01_M1_CMD", signal_type: "DO", io_address: "", description: "run" }],
    }],
  }],
}];

describe("mergeRegisterIntoHierarchy", () => {
  it("fills IO address on a matched control module from the register", () => {
    const tags = [tag("CV01_M1_CMD", "Infeed", "M1", "%Q0.0", "DO")];
    const { units: out, report } = mergeRegisterIntoHierarchy(units, tags);
    const sig = out[0].equipment_modules[0].control_modules[0].io_signals.find((s) => s.tag === "CV01_M1_CMD")!;
    expect(sig.io_address).toBe("%Q0.0");
    expect(report.matched).toBe(1);
  });

  it("places an unmatched register device under an Unassigned EM in its unit", () => {
    const tags = [tag("LFT01_M9_CMD", "Infeed", "M9", "%Q9.0", "DO")];
    const { units: out, report } = mergeRegisterIntoHierarchy(units, tags);
    const unassigned = out[0].equipment_modules.find((e) => e.equipment_module_id === "Unassigned");
    expect(unassigned).toBeTruthy();
    expect(report.addedUnassigned).toBe(1);
  });

  it("flags spec control modules that received no register IO", () => {
    const { report } = mergeRegisterIntoHierarchy(units, []);
    expect(report.specModulesWithoutIo).toContain("M1");
  });

  it("is idempotent", () => {
    const tags = [tag("CV01_M1_CMD", "Infeed", "M1", "%Q0.0", "DO")];
    const once = mergeRegisterIntoHierarchy(units, tags).units;
    const twice = mergeRegisterIntoHierarchy(once, tags).units;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
