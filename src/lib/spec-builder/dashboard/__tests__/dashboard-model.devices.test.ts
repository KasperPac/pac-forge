import { describe, it, expect } from "vitest";
import { buildDevices } from "@/lib/spec-builder/dashboard/dashboard-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";

// Minimal fixture in the REAL contract shape: one motor CM under a unit/EM.
const contract = {
  hierarchy: {
    units: [
      {
        unit_id: "u1", unit_name: "Line", excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "em1", equipment_module_name: "Drive",
            control_modules: [
              {
                control_module_id: "cm1", control_module_name: "Conveyor Motor",
                control_module_class: "motor", is_safety: false, description: "",
                io_signals: [
                  { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "Run output", source: "wired" },
                  { tag: "M01_Fbk", signal_type: "DI", io_address: "I0.0", description: "Run feedback", source: "wired" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  equipment_modules: {}, alarms: [], faults: [], io_list: [],
} as unknown as SpecContractV2;

const compile = {
  artifacts: [
    { name: "EM_Drive_DB", type: "DB", filename: "EM_Drive_DB.db", content: "",
      dependencies: [], folder: "Devices", layer: "em", ownerId: "cm1" },
  ],
  warnings: [],
} as unknown as CodegenResult;

describe("buildDevices", () => {
  it("emits one device with typed signals, a command, and its instance DB", () => {
    const { devices, warnings } = buildDevices(contract, compile);
    expect(devices).toHaveLength(1);
    const d = devices[0];
    expect(d.name).toBe("Conveyor Motor");
    expect(d.deviceType).toBe("motor");
    expect(d.instanceDb).toBe("EM_Drive_DB");
    // DI/DO signals become live-read tags with a Bool type
    expect(d.signals.map((s) => s.id)).toContain("M01_Fbk");
    expect(d.signals.every((s) => s.type === "Bool")).toBe(true);
    // a DO signal is drivable as a momentary command
    expect(d.commands.map((c) => c.tag)).toContain("M01_Run");
    expect(warnings).toEqual([]);
  });
});
