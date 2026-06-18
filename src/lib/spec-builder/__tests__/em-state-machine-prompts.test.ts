import { describe, expect, it } from "vitest";
import { buildEmStateMachineInterviewPrompt } from "@/lib/spec-builder/em-state-machine-prompts";
import type { EquipmentModuleConfig, UnitConfig } from "@/types/spec-builder";
import type { OperatorMode } from "@/types/spec-contract-v2";

const unit: UnitConfig = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false, equipment_modules: [],
} as unknown as UnitConfig;

const em: EquipmentModuleConfig = {
  equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
  control_modules: [
    { control_module_id: "d1", control_module_name: "Drive M01", control_module_class: "motor", is_safety: false, description: "",
      io_signals: [
        { tag: "CAR_M01_CMD", signal_type: "DO", io_address: "Q0.0", description: "Run fwd" },
        { tag: "CAR_M01_FB", signal_type: "DI", io_address: "I0.0", description: "Running" },
      ] },
  ],
} as unknown as EquipmentModuleConfig;

const modes: OperatorMode[] = [
  { mode_id: "auto", name: "Auto", is_default: true },
  { mode_id: "manual", name: "Manual", is_default: false },
];

describe("buildEmStateMachineInterviewPrompt", () => {
  it("includes the EM identity, the machine modes, and the EM's IO", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toContain("Carriage Drive");
    expect(p).toContain("em1");
    expect(p).toContain("auto");
    expect(p).toContain("manual");
    expect(p).toContain("CAR_M01_CMD");
  });

  it("instructs the model to emit EmStateV2[] + EmTransitionV2[] and to mark one safe state", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toMatch(/is_safe_state/);
    expect(p).toMatch(/allowed_modes/);
    expect(p).toMatch(/transitions/i);
    expect(p).toMatch(/"kind": ?"command"|completion/);
  });

  it("renders customer-spec source sections when provided", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, [
      { heading: "Carriage", body: "Driven by a pendant, forward and reverse.", order_index: 0 },
    ]);
    expect(p).toContain("Carriage");
    expect(p).toContain("pendant");
  });
});
