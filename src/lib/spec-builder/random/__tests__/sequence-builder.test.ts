// src/lib/spec-builder/random/__tests__/sequence-builder.test.ts
import { describe, expect, it } from "vitest";
import { EquipmentModuleContractSchema, PhaseStepSchema } from "@/types/spec-contract-v2";
import { buildEquipmentModuleContracts, type ResolvedAssembly, type ResolvedDevice } from "../sequence-builder";
import {
  EM_LOCAL_STARTING,
  EM_LOCAL_IDLE,
  EM_LOCAL_COMPLETE,
  EM_LOCAL_ESTOP,
} from "../state-machine";

function dev(id: string, name: string, deviceClass: string, prefix: string): ResolvedDevice {
  return {
    control_module_id: id,
    control_module_name: name,
    control_module_class: deviceClass as ResolvedDevice["control_module_class"],
    description: "",
    is_safety: false,
    tag_prefix: prefix,
    io_signals: [
      { tag: `${prefix}_CMD`, suffix: "CMD", kind: "DO", io_address: "%Q0.0", description: "" },
      { tag: `${prefix}_FB_RUN`, suffix: "FB_RUN", kind: "DI", io_address: "%I0.0", description: "" },
      { tag: `${prefix}_FAULT`, suffix: "FAULT", kind: "DI", io_address: "%I0.1", description: "" },
    ],
  };
}

function asm(id: string, name: string, control_modules: ResolvedDevice[]): ResolvedAssembly {
  return { equipment_module_id: id, equipment_module_name: name, unit_id: "11111111-1111-4111-8111-1111111111ff", control_modules };
}

describe("buildEquipmentModuleContracts", () => {
  const aId = "11111111-1111-4111-8111-111111111001";
  const inputs: ResolvedAssembly[] = [
    asm(aId, "CV01", [dev("11111111-1111-4111-8111-111111111aaa", "M01", "motor", "CV01_M01")]),
  ];

  it("produces an EquipmentModuleContract per equipment_module that passes Zod", () => {
    const out = buildEquipmentModuleContracts(inputs);
    expect(out[aId]).toBeDefined();
    expect(() => EquipmentModuleContractSchema.parse(out[aId])).not.toThrow();
  });

  it("STARTING sequence contains a step that targets the motor's FB_RUN tag with tag_equals=true", () => {
    const out = buildEquipmentModuleContracts(inputs);
    const starting = out[aId].sequential_states[EM_LOCAL_STARTING]; // STATE_ID_STARTING
    expect(starting).toBeDefined();
    expect(starting.steps.length).toBeGreaterThan(0);
    const step = starting.steps[0];
    expect(step.completion_criteria.length).toBeGreaterThan(0);
    const crit = step.completion_criteria[0];
    expect(crit.kind).toBe("tag_equals");
    if (crit.kind === "tag_equals") {
      expect(crit.tag).toBe("CV01_M01_FB_RUN");
      expect(crit.value).toBe(true);
    }
  });

  it("every step has both v1 and v2 fields populated", () => {
    const out = buildEquipmentModuleContracts(inputs);
    const starting = out[aId].sequential_states[EM_LOCAL_STARTING];
    for (const step of starting.steps) {
      expect(step.step).toBeTypeOf("number");
      expect(step.action).toBeTypeOf("string");
      expect(step.completion_criteria_text).toBeTypeOf("string");
      expect(step.step_id).toBeTypeOf("string");
      expect(step.branch_id).toBeTypeOf("string");
      expect(Array.isArray(step.actions)).toBe(true);
      expect(Array.isArray(step.transitions)).toBe(true);
      expect(() => PhaseStepSchema.parse(step)).not.toThrow();
    }
  });

  it("non-terminal steps have a single transition with is_default=true to the next step_id", () => {
    const twoDevices: ResolvedAssembly[] = [
      asm(aId, "CV01", [
        dev("11111111-1111-4111-8111-111111111aaa", "M01", "motor", "CV01_M01"),
        dev("11111111-1111-4111-8111-111111111bbb", "M02", "motor", "CV01_M02"),
      ]),
    ];
    const out = buildEquipmentModuleContracts(twoDevices);
    const steps = out[aId].sequential_states[EM_LOCAL_STARTING].steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);
    const first = steps[0];
    expect(first.transitions).toHaveLength(1);
    const t = first.transitions![0];
    expect(t.kind).toBe("single");
    expect(t.is_default).toBe(true);
    if (t.kind === "single") expect(t.target_step_id).toBe(steps[1].step_id);
  });

  it("the last step in a sequence has no transitions", () => {
    const out = buildEquipmentModuleContracts(inputs);
    const steps = out[aId].sequential_states[EM_LOCAL_STARTING].steps;
    const last = steps[steps.length - 1];
    expect(last.transitions ?? []).toHaveLength(0);
  });

  it("static states IDLE / COMPLETE / E_STOP exist with empty control_modules arrays (StaticStateV2 shape)", () => {
    const out = buildEquipmentModuleContracts(inputs);
    for (const k of [EM_LOCAL_IDLE, EM_LOCAL_COMPLETE, EM_LOCAL_ESTOP]) {
      const s = out[aId].static_states[k];
      expect(s).toBeDefined();
      // StaticStateV2 shape, not bare ControlModuleStateEntry[]
      expect(Array.isArray(s)).toBe(false);
      if (!Array.isArray(s)) expect(s.control_modules).toEqual([]);
    }
  });
});
