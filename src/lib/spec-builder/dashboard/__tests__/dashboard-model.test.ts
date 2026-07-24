import { describe, it, expect } from "vitest";
import { buildDashboardModel } from "@/lib/spec-builder/dashboard/dashboard-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";

const contract = {
  hierarchy: {
    units: [
      { unit_id: "u1", unit_name: "Line", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em1", equipment_module_name: "Drive",
            control_modules: [
              { control_module_id: "cm1", control_module_name: "Motor", control_module_class: "motor",
                is_safety: false, description: "",
                io_signals: [
                  { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "Run", source: "wired" },
                  { tag: "M01_Fbk", signal_type: "DI", io_address: "I0.0", description: "Running feedback", source: "wired" },
                ] },
            ] },
        ] },
    ],
  },
  equipment_modules: {},
  alarms: [],
  faults: [
    { fault_code: "F01", description: "Motor overload trip", triggered_by_tag: "M01_Trip",
      severity: "fault", affected_control_modules: ["cm1"], action_text: "stop" },
  ],
  io_list: [],
} as unknown as SpecContractV2;
const compile = { artifacts: [], warnings: [] } as unknown as CodegenResult;

describe("buildDashboardModel", () => {
  const model = buildDashboardModel({
    contract, compile,
    project: { name: "Test Machine", specId: "s1", revision: 3, generatedNote: "generated 2026-07-24" },
  });

  it("collects a fault into alarms with severity→class + hi trigger", () => {
    expect(model.alarms.map((a) => a.tag)).toContain("M01_Trip");
    expect(model.alarms[0]).toMatchObject({ trigger: "hi", class: "Fault" });
  });

  it("builds a command→feedback sim rule for the motor", () => {
    expect(model.simRules).toHaveLength(1);
    expect(model.simRules[0]).toMatchObject({ triggerTag: "M01_Run", responseTag: "M01_Fbk", delayMs: 500 });
  });

  it("readTags is the deduped union of device + em + alarm tags", () => {
    const ids = model.readTags.map((t) => t.id);
    expect(ids).toContain("M01_Run");
    expect(ids).toContain("M01_Trip");
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("carries the project block through unchanged", () => {
    expect(model.project.name).toBe("Test Machine");
    expect(model.project.revision).toBe(3);
  });
});
