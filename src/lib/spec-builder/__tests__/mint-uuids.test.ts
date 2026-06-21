import { describe, it, expect } from "vitest";
import { mintHierarchyUuids, mintUnitConfigUuids, isUuid } from "@/lib/spec-builder/mint-uuids";
import type { Hierarchy } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

const UUID = "00000000-0000-4000-8000-000000000001";

function hier(): Hierarchy {
  return {
    units: [{
      unit_id: "UNGROUPED", unit_name: "Segment Wagon", equipment_type: "Other",
      description: "", excluded: false,
      equipment_modules: [{
        equipment_module_id: "Carriage Drive", equipment_module_name: "Carriage Drive", description: "",
        control_modules: [{
          control_module_id: "CM1", control_module_name: "CM1", control_module_class: "motor",
          is_safety: false, description: "",
          io_signals: [{ tag: "CM1_Run", signal_type: "DI", io_address: "%I0.0", description: "run", source: "wired" }],
        }],
      }],
    }],
  } as unknown as Hierarchy;
}

describe("mintHierarchyUuids", () => {
  it("replaces non-UUID ids with UUIDs and keeps names + IO", () => {
    const out = mintHierarchyUuids(hier());
    const u = out.units[0];
    expect(isUuid(u.unit_id)).toBe(true);
    expect(u.unit_name).toBe("Segment Wagon");
    const em = u.equipment_modules[0];
    expect(isUuid(em.equipment_module_id)).toBe(true);
    expect(em.equipment_module_name).toBe("Carriage Drive");
    const cm = em.control_modules[0];
    expect(isUuid(cm.control_module_id)).toBe(true);
    expect(cm.io_signals[0].tag).toBe("CM1_Run");
  });

  it("leaves already-valid UUID ids untouched (idempotent on UUIDs)", () => {
    const h = hier();
    h.units[0].unit_id = UUID;
    const out = mintHierarchyUuids(h);
    expect(out.units[0].unit_id).toBe(UUID);
  });
});

function unitConfig(): UnitConfig[] {
  return [{
    unit_id: "UNGROUPED", unit_name: "Segment Wagon", equipment_type: "Other",
    description: "", excluded: false,
    equipment_modules: [{
      equipment_module_id: "Carriage Drive", equipment_module_name: "Carriage Drive", description: "",
      control_modules: [{
        control_module_id: "M01", control_module_name: "CM_Motor_M01", control_module_class: "motor",
        is_safety: false, description: "drive motor",
        io_signals: [{ tag: "M01_Run", signal_type: "DI", io_address: "%I0.0", description: "run" }],
      }],
    }],
  }] as unknown as UnitConfig[];
}

describe("mintUnitConfigUuids", () => {
  it("replaces non-UUID ids with UUIDs and preserves names, io, and other fields", () => {
    const out = mintUnitConfigUuids(unitConfig());
    const u = out[0];
    expect(isUuid(u.unit_id)).toBe(true);
    expect(u.unit_name).toBe("Segment Wagon");
    expect(u.equipment_type).toBe("Other");
    expect(u.excluded).toBe(false);
    const em = u.equipment_modules[0];
    expect(isUuid(em.equipment_module_id)).toBe(true);
    expect(em.equipment_module_name).toBe("Carriage Drive");
    const cm = em.control_modules[0];
    expect(isUuid(cm.control_module_id)).toBe(true);
    expect(cm.control_module_name).toBe("CM_Motor_M01");
    expect(cm.control_module_class).toBe("motor");
    expect(cm.io_signals[0].tag).toBe("M01_Run");
  });

  it("leaves already-valid UUID ids untouched (idempotent on UUIDs)", () => {
    const units = unitConfig();
    units[0].equipment_modules[0].equipment_module_id = UUID;
    const out = mintUnitConfigUuids(units);
    expect(out[0].equipment_modules[0].equipment_module_id).toBe(UUID);
  });
});
