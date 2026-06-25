import { describe, it, expect } from "vitest";
import { warningKey, evaluateSafetyGate } from "../fb-quality-gate";
import type { SafetyWarning } from "@/types";

const w = (over: Partial<SafetyWarning>): SafetyWarning => ({
  id: crypto.randomUUID(),
  type: "MISSING_INTERLOCK",
  artifact_name: "EM_X",
  description: "x",
  line: 12,
  acknowledged: false,
  ...over,
});

describe("warningKey", () => {
  it("is independent of the random id", () => {
    const a = w({ id: "id-a", type: "UNSAFE_MOTOR", line: 7 });
    const b = w({ id: "id-b", type: "UNSAFE_MOTOR", line: 7 });
    expect(warningKey(a)).toBe(warningKey(b));
  });

  it("encodes type and line", () => {
    expect(warningKey(w({ type: "ARRAY_OOB", line: 30 }))).toBe(
      "ARRAY_OOB:30"
    );
    expect(warningKey(w({ type: "ARRAY_OOB", line: null }))).toBe("ARRAY_OOB:?");
  });
});

describe("evaluateSafetyGate", () => {
  it("passes a clean FB", () => {
    const r = evaluateSafetyGate(
      "EM_Clean",
      "FB",
      "FUNCTION_BLOCK EM_Clean\nEND_FUNCTION_BLOCK",
      []
    );
    expect(r.warnings).toEqual([]);
    expect(r.blocked).toBe(false);
  });

  it("blocks when a warning is unacknowledged and unblocks once its key is acknowledged", () => {
    const scl = [
      "FUNCTION_BLOCK EM_Pump",
      "BEGIN",
      "VAR Input : Motor_Pump; END_VAR",
      "VAR Output : BOOL; END_VAR",
      "Motor_Pump.Run := TRUE;",
      "END_FUNCTION_BLOCK",
    ].join("\n");
    const open = evaluateSafetyGate("EM_Pump", "FB", scl, []);
    expect(open.warnings.length).toBeGreaterThan(0);
    expect(open.blocked).toBe(true);

    const keys = open.warnings.map(warningKey);
    const closed = evaluateSafetyGate("EM_Pump", "FB", scl, keys);
    expect(closed.warnings.length).toBe(open.warnings.length);
    expect(closed.blocked).toBe(false);
  });
});
