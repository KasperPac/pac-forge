import { describe, expect, it } from "vitest";
import { applyStructuredInterlocks } from "../apply-structured-interlocks";
import type { ProposedInterlock } from "../types";
import type { SubsystemStateSequence } from "@/types/spec-contract-v2";

const SUB_ID = "00000000-0000-0000-0000-000000000bbb";

function makeOrch(interlockIds: string[]): Record<string, Record<string, SubsystemStateSequence>> {
  return {
    [SUB_ID]: {
      "execute": {
        assembly_order: ["CV01", "LFT01"],
        shared_permissives: [],
        inter_assembly_interlocks: interlockIds.map((id) => ({
          interlock_id: id,
          source_assembly: "CV01",
          source_condition: { kind: "tag_equals", tag: "X", value: true },
          target_assembly: "LFT01",
          effect: "hold",
          prose: "legacy prose",
        })),
        notes: null,
      } as never,
    },
  };
}

const baseProposed: ProposedInterlock = {
  interlock_id: "il-1",
  source_assembly: "CV01",
  target_assembly: "LFT01",
  original_prose_condition: "CV01 is running",
  original_prose_effect: "hold the lift",
  effect: "block_transition",
  source_condition: { kind: "tag_equals", tag: "CV01.RUNNING", value: true },
  confidence: 0.95,
  reasoning: "exact tag match",
};

describe("applyStructuredInterlocks", () => {
  it("replaces an interlock's effect and source_condition with the proposal's", () => {
    const orch = makeOrch(["il-1"]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    const il = out[SUB_ID]["execute"].inter_assembly_interlocks[0];
    expect(il.effect).toBe("block_transition");
    expect(il.source_condition).toEqual({
      kind: "tag_equals",
      tag: "CV01.RUNNING",
      value: true,
    });
  });

  it("preserves prose for DOCX rendering", () => {
    const orch = makeOrch(["il-1"]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    expect(out[SUB_ID]["execute"].inter_assembly_interlocks[0].prose).toBe(
      "legacy prose",
    );
  });

  it("leaves interlocks without a matching proposal unchanged", () => {
    const orch = makeOrch(["il-1", "il-2"]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    const il2 = out[SUB_ID]["execute"].inter_assembly_interlocks.find(
      (i) => i.interlock_id === "il-2",
    );
    expect(il2?.effect).toBe("hold");        // unchanged from original
  });

  it("handles orchestrations with no interlocks", () => {
    const orch = makeOrch([]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    expect(out[SUB_ID]["execute"].inter_assembly_interlocks).toEqual([]);
  });
});
