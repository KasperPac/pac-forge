import { describe, it, expect } from "vitest";
import { serializeCondition, serializeGuard, serializeAdvance } from "../serialize-condition";
import type { PermissiveCondition, EmTrigger } from "@/types/spec-contract-v2";

const cond = (tag: string, operator: PermissiveCondition["operator"], value: PermissiveCondition["value"]): PermissiveCondition => ({ tag, operator, value });

describe("serializeCondition", () => {
  it("renders boolean permissives as tag = TRUE/FALSE", () => {
    expect(serializeCondition(cond("Brake_Open", "=", true))).toBe("Brake_Open = TRUE");
    expect(serializeCondition(cond("E_Stop", "=", false))).toBe("E_Stop = FALSE");
  });
  it("renders numeric permissives with SCL operators", () => {
    expect(serializeCondition(cond("Level", ">=", 5))).toBe("Level >= 5");
    expect(serializeCondition(cond("Count", "!=", 0))).toBe("Count <> 0");
  });
  it("renders edge values as bare tag / NOT tag", () => {
    expect(serializeCondition(cond("Start_PB", "=", "P_TRIG"))).toBe("Start_PB");
    expect(serializeCondition(cond("Stop_PB", "=", "N_TRIG"))).toBe("NOT Stop_PB");
  });
});

describe("serializeGuard", () => {
  it("returns TRUE for an empty guard", () => {
    expect(serializeGuard([])).toBe("TRUE");
  });
  it("AND-joins multiple terms with parens", () => {
    expect(serializeGuard([cond("A", "=", true), cond("B", "=", false)]))
      .toBe("(A = TRUE) AND (B = FALSE)");
  });
});

describe("serializeAdvance", () => {
  it("ANDs a command trigger with its guard", () => {
    const t: EmTrigger = { kind: "command", expr: cond("CMD_GO", "=", true) };
    expect(serializeAdvance(t, [cond("LS", "=", false)]))
      .toBe("(CMD_GO = TRUE) AND (LS = FALSE)");
  });
  it("yields the guard alone for a completion trigger", () => {
    const t: EmTrigger = { kind: "completion" };
    expect(serializeAdvance(t, [cond("Done", "=", true)])).toBe("(Done = TRUE)");
  });
  it("returns just the trigger when the guard is empty", () => {
    const t: EmTrigger = { kind: "command", expr: cond("CMD_GO", "=", true) };
    expect(serializeAdvance(t, [])).toBe("(CMD_GO = TRUE)");
  });
});
