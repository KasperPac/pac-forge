import { describe, expect, it, vi, beforeEach } from "vitest";

const callMock = vi.fn();

vi.mock("@/hooks/use-generation", () => ({
  callNonStreaming: (...args: unknown[]) => callMock(...args),
}));

import { classifyInterlocks } from "../interlock-classifier";

const rawInterlocks = [
  {
    interlock_id: "il-1",
    source_assembly: "CV01",
    target_assembly: "LFT01",
    prose_source_condition: "CV01 is running",
    prose_effect: "hold the lift",
  },
  {
    interlock_id: "il-2",
    source_assembly: "CV01",
    target_assembly: "LFT01",
    prose_source_condition: "CV01 has faulted",
    prose_effect: "block lift execute",
  },
];

describe("classifyInterlocks", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("returns ClassifiedInterlock[] when the AI response is valid", async () => {
    callMock.mockResolvedValueOnce({
      content: JSON.stringify({
        rows: [
          {
            interlock_id: "il-1",
            effect: "hold",
            source_condition: { kind: "tag_equals", tag: "CV01.RUNNING", value: true },
            confidence: 0.95,
            reasoning: "exact match",
          },
          {
            interlock_id: "il-2",
            effect: "block_transition",
            source_condition: { kind: "tag_equals", tag: "CV01.FAULT", value: true },
            confidence: 0.9,
            reasoning: "fault-driven block",
          },
        ],
      }),
      usage: null,
    });

    const out = await classifyInterlocks(rawInterlocks);

    expect(out).toHaveLength(2);
    expect(out[0].interlock_id).toBe("il-1");
    expect(out[0].effect).toBe("hold");
    expect(out[1].effect).toBe("block_transition");
  });

  it("returns placeholder fallback when the AI returns invalid JSON", async () => {
    callMock.mockResolvedValueOnce({ content: "not json at all", usage: null });
    const out = await classifyInterlocks(rawInterlocks);
    expect(out).toHaveLength(2);
    expect(out[0].effect).toBe("hold");
    expect(out[0].source_condition).toEqual({
      kind: "placeholder",
      criterion_id: "placeholder-il-1",
      prompt: "CV01 is running",
    });
    expect(out[0].confidence).toBe(0);
    expect(out[0].reasoning).toMatch(/fallback|classifier|invalid/i);
  });

  it("returns placeholder fallback when the AI call throws", async () => {
    callMock.mockRejectedValueOnce(new Error("Edge Function timed out"));
    const out = await classifyInterlocks(rawInterlocks);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.confidence === 0)).toBe(true);
  });

  it("preserves the original interlock_id, source_assembly, target_assembly", async () => {
    callMock.mockResolvedValueOnce({ content: "garbage", usage: null });
    const out = await classifyInterlocks(rawInterlocks);
    expect(out[0].interlock_id).toBe("il-1");
    expect(out[0].source_assembly).toBe("CV01");
    expect(out[0].target_assembly).toBe("LFT01");
  });

  it("returns [] for empty input without calling the AI", async () => {
    const out = await classifyInterlocks([]);
    expect(out).toEqual([]);
    expect(callMock).not.toHaveBeenCalled();
  });
});
