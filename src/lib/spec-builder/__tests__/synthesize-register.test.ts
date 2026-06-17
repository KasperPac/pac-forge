import { describe, it, expect } from "vitest";
import { synthesizeRegisterFromContract } from "@/lib/spec-builder/synthesize-register";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const contract = {
  hierarchy: {
    units: [{
      unit_id: "u1", unit_name: "Infeed", equipment_type: "Conveyor",
      description: "", excluded: false,
      equipment_modules: [{
        equipment_module_id: "em1", equipment_module_name: "Conveyor CV01", description: "",
        control_modules: [{
          control_module_id: "cm1", control_module_name: "Drive M1",
          control_module_class: "motor", is_safety: false, description: "",
          io_signals: [
            { tag: "CV01_M1_CMD", signal_type: "DO", io_address: "%Q0.0", description: "run", source: "wired" },
            { tag: "CV01_M1_FB",  signal_type: "DI", io_address: "%I0.0", description: "fb",  source: "wired" },
          ],
        }],
      }],
    }],
  },
} as unknown as SpecContractV2;

describe("synthesizeRegisterFromContract", () => {
  it("flattens io_signals into InstrumentTag[] with ISA-88 fields", () => {
    const { tags } = synthesizeRegisterFromContract(contract);
    expect(tags).toHaveLength(2);
    const cmd = tags.find((t) => t.tag === "CV01_M1_CMD")!;
    expect(cmd.unit).toBe("Infeed");
    expect(cmd.equipment_module).toBe("Conveyor CV01");
    expect(cmd.control_module).toBe("Drive M1");
    expect(cmd.signal_direction).toBe("DO");
    expect(cmd.control_module_class).toBe("motor");
    expect(cmd.io_address).toBe("%Q0.0");
  });

  it("builds a unit summary grouped by unit", () => {
    const { units } = synthesizeRegisterFromContract(contract);
    expect(units).toHaveLength(1);
    expect(units[0].unit_name).toBe("Infeed");
  });

  it("returns empty for a contract with no io_signals", () => {
    const empty = { hierarchy: { units: [] } } as unknown as SpecContractV2;
    const { tags, units } = synthesizeRegisterFromContract(empty);
    expect(tags).toHaveLength(0);
    expect(units).toHaveLength(0);
  });
});
