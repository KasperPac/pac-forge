import { describe, expect, it } from "vitest";
import { OperatingStateV2Schema } from "@/types/spec-contract-v2";
import {
  CANONICAL_STATES,
  STATE_ID_IDLE,
  STATE_ID_STARTING,
  STATE_ID_EXECUTE,
  STATE_ID_STOPPING,
  STATE_ID_COMPLETE,
  STATE_ID_E_STOP,
  SEQUENTIAL_STATE_IDS,
} from "../state-machine";

describe("canonical state machine", () => {
  it("exposes PackML-numeric state ids", () => {
    expect(STATE_ID_IDLE).toBe(4);
    expect(STATE_ID_STARTING).toBe(3);
    expect(STATE_ID_EXECUTE).toBe(6);
    expect(STATE_ID_STOPPING).toBe(7);
    expect(STATE_ID_COMPLETE).toBe(17);
    expect(STATE_ID_E_STOP).toBe(9);
  });

  it("CANONICAL_STATES contains exactly 6 entries", () => {
    expect(CANONICAL_STATES).toHaveLength(6);
  });

  it("every canonical state passes OperatingStateV2Schema", () => {
    for (const s of CANONICAL_STATES) {
      expect(() => OperatingStateV2Schema.parse(s)).not.toThrow();
    }
  });

  it("every numeric state_id satisfies packml_id === state_id", () => {
    for (const s of CANONICAL_STATES) {
      expect(typeof s.state_id).toBe("number");
      expect(s.packml_id).toBe(s.state_id);
    }
  });

  it("SEQUENTIAL_STATE_IDS lists STARTING / EXECUTE / STOPPING", () => {
    expect(SEQUENTIAL_STATE_IDS).toEqual([
      STATE_ID_STARTING,
      STATE_ID_EXECUTE,
      STATE_ID_STOPPING,
    ]);
  });

  it("CANONICAL_STATES has 3 sequential and 3 static states", () => {
    const seq = CANONICAL_STATES.filter((s) => s.state_pattern === "sequential");
    const stat = CANONICAL_STATES.filter((s) => s.state_pattern === "static");
    expect(seq).toHaveLength(3);
    expect(stat).toHaveLength(3);
  });
});
