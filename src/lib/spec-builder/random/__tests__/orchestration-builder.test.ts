// src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts
import { describe, expect, it } from "vitest";
import { SubsystemStateSequenceSchema } from "@/types/spec-contract-v2";
import { buildOrchestrations, type OrchestrationInput } from "../orchestration-builder";

const SUB_A = "00000000-0000-0000-0000-0000000000a1";
const ASM_A1 = "00000000-0000-0000-0000-0000000000b1";
const ASM_A2 = "00000000-0000-0000-0000-0000000000b2";
const ASM_A3 = "00000000-0000-0000-0000-0000000000b3";
const SUB_B = "00000000-0000-0000-0000-0000000000a2";
const ASM_B1 = "00000000-0000-0000-0000-0000000000c1";

const inputs: OrchestrationInput[] = [
  {
    subsystem_id: SUB_A,
    assemblies: [
      { assembly_id: ASM_A1, first_device_run_tag: "CV01_M01_FB_RUN" },
      { assembly_id: ASM_A2, first_device_run_tag: "LFT01_M01_FB_RUN" },
      { assembly_id: ASM_A3, first_device_run_tag: "OUT01_M01_FB_RUN" },
    ],
  },
  { subsystem_id: SUB_B, assemblies: [{ assembly_id: ASM_B1, first_device_run_tag: "X_FB_RUN" }] },
];

describe("buildOrchestrations", () => {
  it("emits one entry per subsystem", () => {
    const out = buildOrchestrations(inputs);
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("emits a SubsystemStateSequence for each sequential state per subsystem", () => {
    const out = buildOrchestrations(inputs);
    const a = out[SUB_A];
    expect(Object.keys(a).sort()).toEqual(["3", "6", "7"]); // STARTING, EXECUTE, STOPPING
  });

  it("multi-assembly subsystems get an interlock per adjacent pair", () => {
    const out = buildOrchestrations(inputs);
    const a3 = out[SUB_A]["3"];
    expect(a3.inter_assembly_interlocks).toHaveLength(2);
    expect(a3.inter_assembly_interlocks[0].source_assembly).toBe(ASM_A1);
    expect(a3.inter_assembly_interlocks[0].target_assembly).toBe(ASM_A2);
    expect(a3.inter_assembly_interlocks[1].source_assembly).toBe(ASM_A2);
    expect(a3.inter_assembly_interlocks[1].target_assembly).toBe(ASM_A3);
  });

  it("single-assembly subsystems get no interlocks", () => {
    const out = buildOrchestrations(inputs);
    expect(out[SUB_B]["3"].inter_assembly_interlocks).toHaveLength(0);
  });

  it("every sequential state has exactly one shared permissive", () => {
    const out = buildOrchestrations(inputs);
    for (const [, states] of Object.entries(out)) {
      for (const seq of Object.values(states)) {
        expect(seq.shared_permissives).toHaveLength(1);
      }
    }
  });

  it("every produced SubsystemStateSequence passes Zod", () => {
    const out = buildOrchestrations(inputs);
    for (const states of Object.values(out)) {
      for (const seq of Object.values(states)) {
        expect(() => SubsystemStateSequenceSchema.parse(seq)).not.toThrow();
      }
    }
  });

  it("interlock effect is 'enable' targeting STARTING (state_id 3)", () => {
    const out = buildOrchestrations(inputs);
    const il = out[SUB_A]["3"].inter_assembly_interlocks[0];
    expect(il.effect).toBe("enable");
    expect(il.effect_target?.state_id).toBe(3);
  });
});
