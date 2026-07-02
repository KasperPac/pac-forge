import { describe, it, expect } from "vitest";
import { buildFdsInterviewSystemPrompt } from "@/lib/spec-builder/fds-prompts";
import type { EquipmentModuleConfig, UnitConfig, InstrumentTag } from "@/types/spec-builder";
import type { EmStateV2 } from "@/types/spec-contract-v2";

const unit = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false, equipment_modules: [],
} as unknown as UnitConfig;

const em = {
  equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
  control_modules: [
    { control_module_id: "d1", control_module_name: "Drive M01", control_module_class: "motor", is_safety: false, description: "",
      io_signals: [
        { tag: "CAR_M01_FWD", signal_type: "DO", io_address: "Q0.0", description: "Fwd" },
        { tag: "CAR_CMD_FWD", signal_type: "DI", io_address: "I0.0", description: "Pendant fwd" },
      ] },
  ],
} as unknown as EquipmentModuleConfig;

const tags = [
  { tag: "CAR_M01_FWD", description: "Fwd", signal_direction: "DO" },
  { tag: "CAR_CMD_FWD", description: "Pendant fwd", signal_direction: "DI" },
] as unknown as InstrumentTag[];

const emStates: EmStateV2[] = [
  { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
  { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
];

const CB = {
  execute: {
    branches: [{ branch_id: "drive_fwd", label: "Drive Forward", when: [{ tag: "CAR_CMD_FWD", operator: "=" as const, value: true }], control_modules: [] }],
    default_hold: [],
  },
};

describe("buildFdsInterviewSystemPrompt — command_behavior (SP-3c)", () => {
  it("asks the nature question before permissives/steps", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toMatch(/0\.\s+\*\*Nature\*\*/);
    expect(p).toContain("COMMAND-DRIVEN");
  });

  it("documents the command_behavior response shape with a worked example", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toContain("# COMMAND-DRIVEN STATES");
    expect(p).toContain('"command_behavior"');
    expect(p).toContain('"default_hold"');
    expect(p).toContain('"drive_fwd"');
  });

  it("forbids mixing steps and command_behavior for one state", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toMatch(/BOTH "steps" and "command_behavior"/);
  });

  it("renders an authored command state as completed with its branch count", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, [], CB);
    expect(p).toContain("Command-driven — 1 branch(es) authored");
    expect(p).toMatch(/- execute\s+\(Execute\)\s+— command-driven, 1 branch\(es\) authored/);
  });

  it("does not annotate unauthored states", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).not.toContain("command-driven, ");
  });
});
