import { describe, expect, it } from "vitest";
import {
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

  it("SEQUENTIAL_STATE_IDS lists STARTING / EXECUTE / STOPPING", () => {
    expect(SEQUENTIAL_STATE_IDS).toEqual([
      STATE_ID_STARTING,
      STATE_ID_EXECUTE,
      STATE_ID_STOPPING,
    ]);
  });
});
