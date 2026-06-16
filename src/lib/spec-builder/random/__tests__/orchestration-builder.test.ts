// src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts
import { describe, expect, it } from "vitest";
import { UnitProcedureSequenceSchema } from "@/types/spec-contract-v2";
import { buildOrchestrations, type OrchestrationInput } from "../orchestration-builder";

const SUB_A = "00000000-0000-0000-0000-0000000000a1";
const ASM_A1 = "00000000-0000-0000-0000-0000000000b1";
const ASM_A2 = "00000000-0000-0000-0000-0000000000b2";
const ASM_A3 = "00000000-0000-0000-0000-0000000000b3";
const SUB_B = "00000000-0000-0000-0000-0000000000a2";
const ASM_B1 = "00000000-0000-0000-0000-0000000000c1";

const inputs: OrchestrationInput[] = [
  {
    unit_id: SUB_A,
    equipment_modules: [
      { equipment_module_id: ASM_A1, first_device_run_tag: "CV01_M01_FB_RUN" },
      { equipment_module_id: ASM_A2, first_device_run_tag: "LFT01_M01_FB_RUN" },
      { equipment_module_id: ASM_A3, first_device_run_tag: "OUT01_M01_FB_RUN" },
    ],
  },
  { unit_id: SUB_B, equipment_modules: [{ equipment_module_id: ASM_B1, first_device_run_tag: "X_FB_RUN" }] },
];

describe("buildOrchestrations", () => {
  it("emits one entry per unit", () => {
    const out = buildOrchestrations(inputs);
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("emits a UnitProcedureSequence for each sequential state per unit", () => {
    const out = buildOrchestrations(inputs);
    const a = out[SUB_A];
    expect(Object.keys(a).sort()).toEqual(["3", "6", "7"]); // STARTING, EXECUTE, STOPPING
  });

  it("multi-equipment_module units get an interlock per adjacent pair", () => {
    const out = buildOrchestrations(inputs);
    const a3 = out[SUB_A]["3"];
    expect(a3.inter_equipment_module_interlocks).toHaveLength(2);
    expect(a3.inter_equipment_module_interlocks[0].source_equipment_module).toBe(ASM_A1);
    expect(a3.inter_equipment_module_interlocks[0].target_equipment_module).toBe(ASM_A2);
    expect(a3.inter_equipment_module_interlocks[1].source_equipment_module).toBe(ASM_A2);
    expect(a3.inter_equipment_module_interlocks[1].target_equipment_module).toBe(ASM_A3);
  });

  it("single-equipment_module units get no interlocks", () => {
    const out = buildOrchestrations(inputs);
    expect(out[SUB_B]["3"].inter_equipment_module_interlocks).toHaveLength(0);
  });

  it("every sequential state has exactly one shared permissive", () => {
    const out = buildOrchestrations(inputs);
    for (const [, states] of Object.entries(out)) {
      for (const seq of Object.values(states)) {
        expect(seq.shared_permissives).toHaveLength(1);
      }
    }
  });

  it("every produced UnitProcedureSequence passes Zod", () => {
    const out = buildOrchestrations(inputs);
    for (const states of Object.values(out)) {
      for (const seq of Object.values(states)) {
        expect(() => UnitProcedureSequenceSchema.parse(seq)).not.toThrow();
      }
    }
  });

  it("interlock effect is 'enable' targeting STARTING (state_id 3)", () => {
    const out = buildOrchestrations(inputs);
    const il = out[SUB_A]["3"].inter_equipment_module_interlocks[0];
    expect(il.effect).toBe("enable");
    expect(il.effect_target?.state_id).toBe(3);
  });
});
