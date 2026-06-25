import { describe, it, expect } from "vitest";
import type { CompletionCriterion } from "@/types/spec-contract-v2";
import {
  serializeCompletion, serializeCompletionGuard, isUnevaluable,
} from "../serialize-completion";

describe("serializeCompletion", () => {
  it("lowers tag_equals with boolean and pin mapping", () => {
    const c: CompletionCriterion = { kind: "tag_equals", tag: "brake_open", value: true };
    expect(serializeCompletion(c, (t) => `#fb_${t}`)).toBe("#fb_brake_open = TRUE");
  });
  it("lowers tag_equals with numeric and string literals", () => {
    expect(serializeCompletion({ kind: "tag_equals", tag: "pos", value: 5 })).toBe("pos = 5");
    expect(serializeCompletion({ kind: "tag_equals", tag: "mode", value: "AUTO" })).toBe("mode = AUTO");
  });
  it("maps tag_compare == to SCL =", () => {
    const c: CompletionCriterion = { kind: "tag_compare", tag: "speed", op: "==", value: 100 };
    expect(serializeCompletion(c)).toBe("speed = 100");
  });
  it("passes tag_compare numeric operators through", () => {
    expect(serializeCompletion({ kind: "tag_compare", tag: "p", op: ">=", value: 3 })).toBe("p >= 3");
  });
  it("wraps expression text in parens", () => {
    const c: CompletionCriterion = { kind: "expression", text: "a AND b", referenced_tags: ["a", "b"] };
    expect(serializeCompletion(c)).toBe("(a AND b)");
  });
  it("renders unevaluable criteria as FALSE", () => {
    expect(serializeCompletion({ kind: "manual_ack", prompt: "ok?" })).toBe("FALSE");
    expect(serializeCompletion({ kind: "placeholder", criterion_id: "x", prompt: "tbd" })).toBe("FALSE");
  });
});

describe("isUnevaluable", () => {
  it("flags manual_ack and placeholder only", () => {
    expect(isUnevaluable({ kind: "manual_ack", prompt: "p" })).toBe(true);
    expect(isUnevaluable({ kind: "placeholder", criterion_id: "x", prompt: "p" })).toBe(true);
    expect(isUnevaluable({ kind: "tag_equals", tag: "t", value: true })).toBe(false);
  });
});

describe("serializeCompletionGuard", () => {
  it("returns TRUE for an empty guard", () => {
    expect(serializeCompletionGuard([])).toBe("TRUE");
  });
  it("AND-joins parenthesised terms with pin mapping", () => {
    const cs: CompletionCriterion[] = [
      { kind: "tag_equals", tag: "a", value: true },
      { kind: "tag_compare", tag: "b", op: ">", value: 2 },
    ];
    expect(serializeCompletionGuard(cs, (t) => `#fb_${t}`))
      .toBe("(#fb_a = TRUE) AND (#fb_b > 2)");
  });
});
