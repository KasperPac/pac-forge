import { describe, expect, it } from "vitest";
import { buildFdsInterviewSystemPrompt } from "@/lib/spec-builder/fds-prompts";
import type { EquipmentModuleConfig, UnitConfig, InstrumentTag } from "@/types/spec-builder";
import type { EmStateV2 } from "@/types/spec-contract-v2";

const unit = { unit_id: "u1", unit_name: "U", equipment_type: "Other" } as unknown as UnitConfig;
const em = {
  equipment_module_id: "em1", equipment_module_name: "Drive",
  control_modules: [{ control_module_id: "d1", control_module_name: "M01", control_module_class: "motor", is_safety: false,
    io_signals: [{ tag: "M01_CMD", signal_type: "DO", io_address: "Q0.0", description: "" }] }],
} as unknown as EquipmentModuleConfig;
const tags: InstrumentTag[] = [{ tag: "M01_CMD", signal_direction: "DO", description: "" } as unknown as InstrumentTag];

const emStates: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: "auto_cycle", name: "Auto Cycle", kind: "sequential", allowed_modes: ["auto"], is_safe_state: false },
];

describe("buildFdsInterviewSystemPrompt — EM-local states", () => {
  it("lists the EM's own sequential states by their EM-local string ids", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toContain("auto_cycle");
    expect(p).toContain("Auto Cycle");
    expect(p).not.toContain("PackML 1..17");
  });
});
