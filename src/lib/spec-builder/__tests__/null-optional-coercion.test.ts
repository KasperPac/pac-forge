import { describe, expect, it } from "vitest";
import {
  CompletionCriterionSchema,
  MonitorV2Schema,
  PhaseStepSchema,
  TransitionV2Schema,
} from "@/types/spec-contract-v2";

/**
 * Regression: AI authors routinely emit an explicit `"on_fail": null` (and
 * `"within_ms": null`, `"fault_ref": null`, `"on_timeout": null`) for "no
 * value" on optional fields. A plain `.optional()` rejects explicit null, which
 * poisoned Stage-B validation for every project. `nullableOptional` must coerce
 * null → undefined so the value validates AND the parsed output stays clean
 * (never null), with no downstream consumer changes.
 */
describe("nullableOptional — explicit null on optional fault/timer fields", () => {
  it("accepts null on_fail/within_ms on a completion criterion and coerces to undefined", () => {
    const parsed = CompletionCriterionSchema.safeParse({
      kind: "tag_equals",
      tag: "CAR_POS_AT_STOP_FWD",
      value: true,
      within_ms: null,
      on_fail: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("on_fail", null);
      // null is coerced away — the field reads as undefined.
      expect((parsed.data as { on_fail?: unknown }).on_fail).toBeUndefined();
      expect((parsed.data as { within_ms?: unknown }).within_ms).toBeUndefined();
    }
  });

  it("still accepts a real on_fail object", () => {
    const parsed = CompletionCriterionSchema.safeParse({
      kind: "expression",
      text: "T_DECEL.Q",
      referenced_tags: ["T_DECEL"],
      within_ms: 3000,
      on_fail: { fault_code: "F_CM_DECEL_DWELL", severity: "warning" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { on_fail?: unknown }).on_fail).toEqual({
        fault_code: "F_CM_DECEL_DWELL",
        severity: "warning",
      });
    }
  });

  it("accepts null on_fail on a single transition", () => {
    const parsed = TransitionV2Schema.safeParse({
      transition_id: "t1",
      kind: "single",
      target_step_id: "",
      guard: [],
      priority: 0,
      is_default: true,
      on_fail: null,
      notes: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts null fault_ref on a monitor", () => {
    const parsed = MonitorV2Schema.safeParse({
      monitor_id: "m1",
      condition: { kind: "tag_equals", tag: "X", value: true },
      effect: "alarm",
      fault_ref: null,
      auto_clear: true,
      priority: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts null on_fail/on_timeout on a phase step", () => {
    const parsed = PhaseStepSchema.safeParse({
      step: 10,
      action: "Command zero speed reference",
      completion_criteria: [],
      completion_criteria_text: "",
      on_fail: null,
      on_timeout: null,
    });
    expect(parsed.success).toBe(true);
  });
});
