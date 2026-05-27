// src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts
import { describe, expect, it } from "vitest";
import { MonitorV2Schema, type MonitorV2 } from "@/types/spec-contract-v2";
import {
  createDefaultMonitor,
  summariseMonitor,
  validateMonitor,
} from "../monitor-helpers";

describe("createDefaultMonitor", () => {
  it("returns a MonitorV2Schema.parse()-passing object", () => {
    const m = createDefaultMonitor();
    expect(() => MonitorV2Schema.parse(m)).not.toThrow();
  });

  it("defaults to tag_equals + fault effect", () => {
    const m = createDefaultMonitor();
    expect(m.condition.kind).toBe("tag_equals");
    expect(m.effect).toBe("fault");
    expect(m.fault_ref?.fault_code).toBe("F_NEW");
    expect(m.auto_clear).toBe(false);
    expect(m.priority).toBe(0);
  });

  it("assigns a unique monitor_id each call", () => {
    const a = createDefaultMonitor();
    const b = createDefaultMonitor();
    expect(a.monitor_id).not.toBe(b.monitor_id);
  });
});

describe("summariseMonitor", () => {
  const base: MonitorV2 = {
    monitor_id: "m1",
    condition: { kind: "tag_equals", tag: "E_STOP_PB", value: false },
    effect: "fault",
    fault_ref: { fault_code: "F_ESTOP", severity: "fault" },
    auto_clear: false,
    priority: 0,
  };

  it("summarises tag_equals + fault", () => {
    expect(summariseMonitor(base)).toBe("E_STOP_PB = false → fault F_ESTOP");
  });

  it("summarises tag_compare + alarm", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_compare", tag: "TEMP", op: ">", value: 90 },
        effect: "alarm",
        fault_ref: { fault_code: "A_HIGH_TEMP", severity: "warning" },
      }),
    ).toBe("TEMP > 90 → alarm A_HIGH_TEMP");
  });

  it("summarises hold (no fault_ref)", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_equals", tag: "DOOR_OPEN", value: true },
        effect: "hold",
        fault_ref: undefined,
      }),
    ).toBe("DOOR_OPEN = true → hold");
  });

  it("summarises branch_to with target_step_id", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_equals", tag: "RETRY_FLAG", value: true },
        effect: "branch_to",
        target_step_id: "s-3-2",
        fault_ref: undefined,
      }),
    ).toBe("RETRY_FLAG = true → branch to s-3-2");
  });

  it("summarises expression", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: {
          kind: "expression",
          text: "PUMP_RUN AND NOT FILL_OK",
          referenced_tags: ["PUMP_RUN", "FILL_OK"],
        },
      }),
    ).toBe("PUMP_RUN AND NOT FILL_OK → fault F_ESTOP");
  });

  it("includes within_ms in summary when set", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_equals", tag: "FB_RUN", value: false, within_ms: 5000 },
      }),
    ).toBe("FB_RUN = false (5000ms) → fault F_ESTOP");
  });
});

describe("validateMonitor", () => {
  const base: MonitorV2 = {
    monitor_id: "m1",
    condition: { kind: "tag_equals", tag: "X", value: true },
    effect: "fault",
    fault_ref: { fault_code: "F_X", severity: "fault" },
    auto_clear: false,
    priority: 0,
  };

  it("returns ok=true for a well-formed monitor", () => {
    expect(validateMonitor(base)).toEqual({ ok: true });
  });

  it("rejects blank tag in tag_equals condition", () => {
    const result = validateMonitor({ ...base, condition: { kind: "tag_equals", tag: "", value: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /tag/i.test(e))).toBe(true);
  });

  it("rejects fault effect without fault_ref", () => {
    const result = validateMonitor({ ...base, fault_ref: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /fault_ref/i.test(e))).toBe(true);
  });

  it("rejects alarm effect without fault_ref", () => {
    const result = validateMonitor({ ...base, effect: "alarm", fault_ref: undefined });
    expect(result.ok).toBe(false);
  });

  it("rejects branch_to effect without target_step_id", () => {
    const result = validateMonitor({ ...base, effect: "branch_to", fault_ref: undefined, target_step_id: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /target_step_id/i.test(e))).toBe(true);
  });

  it("rejects blank fault_code", () => {
    const result = validateMonitor({ ...base, fault_ref: { fault_code: "", severity: "fault" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /fault_code/i.test(e))).toBe(true);
  });

  it("accepts hold effect without fault_ref or target_step_id", () => {
    const result = validateMonitor({
      ...base,
      effect: "hold",
      fault_ref: undefined,
    });
    expect(result.ok).toBe(true);
  });
});
