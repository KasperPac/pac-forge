import { describe, it, expect } from "vitest";
import { registerToHierarchy } from "@/lib/spec-builder/register-to-hierarchy";
import { isUuid } from "@/lib/spec-builder/mint-uuids";
import type { InstrumentTag } from "@/types/spec-builder";

function tag(t: string, em: string): InstrumentTag {
  return {
    tag: t, device_type: "", description: t, signal_type: "DI", io_address: "%I0.0",
    control_module_class: "motor", signal_direction: "DI", unit_prefix: "", is_safety: false,
    process_cell: "", unit: "", equipment_module: em, control_module: "",
  };
}

describe("registerToHierarchy", () => {
  it("builds real EMs/CMs from tags with minted UUIDs and source-tagged IO", () => {
    const tags = [
      tag("CM1_Run", "Carriage Drive"),
      tag("CM1_Fault", "Carriage Drive"),
      tag("VSD1_Speed_Ref", "Carriage Drive"),
    ];
    const h = registerToHierarchy(tags);
    const em = h.units[0].equipment_modules.find((e) => e.equipment_module_name === "Carriage Drive")!;
    expect(em).toBeTruthy();
    expect(isUuid(em.equipment_module_id)).toBe(true);
    const cmIds = em.control_modules.map((c) => c.control_module_id);
    expect(cmIds.every(isUuid)).toBe(true);
    const allSignals = em.control_modules.flatMap((c) => c.io_signals);
    expect(allSignals.every((s) => s.source === "wired")).toBe(true);
    expect(allSignals.map((s) => s.tag)).toContain("CM1_Run");
  });

  it("returns an empty hierarchy for no tags", () => {
    expect(registerToHierarchy([]).units).toHaveLength(0);
  });

  it("keeps same-prefix control modules in separate equipment modules", () => {
    // Carriage_Brake_* and Rot_Brake_* both derive the prefix "Brake" — they
    // must not collide across their distinct equipment modules.
    const tags = [
      tag("Carriage_Brake_Fault", "Carriage Brake"),
      tag("Carriage_Brake_Open", "Carriage Brake"),
      tag("Rot_Brake_Fault", "Rotator Brake"),
      tag("Rot_Brake_Open", "Rotator Brake"),
    ];
    const h = registerToHierarchy(tags);
    const emNames = h.units[0].equipment_modules.map((e) => e.equipment_module_name).sort();
    expect(emNames).toEqual(["Carriage Brake", "Rotator Brake"]);
  });
});
