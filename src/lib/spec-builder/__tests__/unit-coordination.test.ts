import { describe, it, expect } from "vitest";
import {
  CANONICAL_EM_COMMAND_MAP,
  emCommandForState,
} from "@/lib/spec-builder/unit-coordination";
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";
import { UNIT_PACKML_STATES, UnitCoordinationV1Schema } from "@/types/spec-contract-v2";

const EM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeCoord(overrides?: UnitCoordinationV1["em_command_overrides"]): UnitCoordinationV1 {
  return UnitCoordinationV1Schema.parse({
    unit_id: "unit_1",
    states: [{ state_id: "idle" }, { state_id: "execute" }, { state_id: "stopped" }],
    transitions: [],
    em_command_overrides: overrides,
  });
}

describe("CANONICAL_EM_COMMAND_MAP", () => {
  it("covers every canonical PackML state", () => {
    for (const s of UNIT_PACKML_STATES) {
      expect(CANONICAL_EM_COMMAND_MAP[s]).toBeDefined();
    }
  });

  it("matches the design table", () => {
    expect(CANONICAL_EM_COMMAND_MAP.clearing).toBe("CLEAR");
    expect(CANONICAL_EM_COMMAND_MAP.resetting).toBe("RESET");
    expect(CANONICAL_EM_COMMAND_MAP.starting).toBe("START");
    expect(CANONICAL_EM_COMMAND_MAP.execute).toBe("START");
    expect(CANONICAL_EM_COMMAND_MAP.stopping).toBe("STOP");
    expect(CANONICAL_EM_COMMAND_MAP.stopped).toBe("STOP");
    expect(CANONICAL_EM_COMMAND_MAP.holding).toBe("HOLD");
    expect(CANONICAL_EM_COMMAND_MAP.held).toBe("HOLD");
    expect(CANONICAL_EM_COMMAND_MAP.aborting).toBe("ABORT");
    expect(CANONICAL_EM_COMMAND_MAP.aborted).toBe("ABORT");
    // idle / complete / all remaining acting states hold last (NONE)
    expect(CANONICAL_EM_COMMAND_MAP.idle).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.complete).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.completing).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.unholding).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.suspending).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.suspended).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.unsuspending).toBe("NONE");
  });
});

describe("emCommandForState", () => {
  it("falls back to the canonical map when no override exists", () => {
    expect(emCommandForState(makeCoord(), "execute", EM_A)).toBe("START");
    expect(emCommandForState(makeCoord(), "aborting", EM_A)).toBe("ABORT");
  });

  it("applies a per-EM override for the matching state only", () => {
    const coord = makeCoord({
      execute: [{ equipment_module_id: EM_A, command: "NONE" }],
    });
    expect(emCommandForState(coord, "execute", EM_A)).toBe("NONE");
    expect(emCommandForState(coord, "execute", EM_B)).toBe("START"); // other EM: canonical
    expect(emCommandForState(coord, "starting", EM_A)).toBe("START"); // other state: canonical
  });
});
