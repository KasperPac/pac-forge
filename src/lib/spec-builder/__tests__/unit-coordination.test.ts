import { describe, it, expect } from "vitest";
import {
  CANONICAL_EM_COMMAND_MAP,
  emCommandForState,
  isModeChangeLegal,
} from "@/lib/spec-builder/unit-coordination";
import type { ModeChangeSpecView } from "@/lib/spec-builder/unit-coordination";
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

function makeSpec(): ModeChangeSpecView {
  return {
    modes: [
      { mode_id: "production", name: "Production", is_default: true, kind: "production" },
      { mode_id: "maintenance", name: "Maintenance", is_default: false, kind: "maintenance" },
      { mode_id: "eng", name: "Engineering", is_default: false, kind: "engineering" },
    ],
    unit_coordination: {
      unit_1: UnitCoordinationV1Schema.parse({
        unit_id: "unit_1",
        states: [
          { state_id: "stopped", mode_change_allowed: true },
          { state_id: "execute", allowed_modes: ["production"] },
          { state_id: "idle", mode_change_allowed: true },
        ],
        transitions: [],
      }),
    },
    equipment_modules: {
      [EM_A]: {
        unit_id: "unit_1",
        states: [
          // empty mask = legal in all modes
          { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
          // production-only state
          { state_id: "running", name: "Running", kind: "sequential", allowed_modes: ["production"], is_safe_state: false },
        ],
      },
      [EM_B]: {
        unit_id: "other_unit", // not a member — must be ignored
        states: [],
      },
    },
  };
}

describe("isModeChangeLegal", () => {
  it("grants when state gate open and all member EM masks allow the target", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {
      [EM_A]: "stopped",
    });
    expect(v).toEqual({ legal: true, reasons: [] });
  });

  it("(a) rejects when the current unit state has mode_change_allowed=false", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "production", "execute", {
      [EM_A]: "stopped",
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/mode_change_allowed/);
  });

  it("(b) rejects when a member EM is in a state whose mask excludes the target", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {
      [EM_A]: "running", // allowed_modes: ["production"]
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.join(" ")).toContain(EM_A);
  });

  it("(b) empty EM mask means always legal (engineering-mode case)", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "eng", "stopped", {
      [EM_A]: "stopped",
    });
    expect(v.legal).toBe(true);
  });

  it("(b) skips member EMs with no runtime state provided", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {});
    expect(v.legal).toBe(true);
  });

  it("(b) rejects an EM state id not declared on the EM", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {
      [EM_A]: "ghost_state",
    });
    expect(v.legal).toBe(false);
  });

  it("(c) rejects when the current unit state is masked out of the target mode", () => {
    // execute is production-only; even if it allowed mode changes, switching
    // to maintenance while in execute would strand the unit.
    const spec = makeSpec();
    spec.unit_coordination!.unit_1.states = spec.unit_coordination!.unit_1.states.map((s) =>
      s.state_id === "execute" ? { ...s, mode_change_allowed: true } : s,
    );
    const v = isModeChangeLegal(spec, "unit_1", "maintenance", "execute", {
      [EM_A]: "stopped",
    });
    expect(v.legal).toBe(false);
  });

  it("rejects unknown unit / unknown target mode with reasons", () => {
    expect(isModeChangeLegal(makeSpec(), "nope", "production", "stopped", {}).legal).toBe(false);
    expect(isModeChangeLegal(makeSpec(), "unit_1", "nope", "stopped", {}).legal).toBe(false);
  });

  it("collects ALL violated clauses, not just the first", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "execute", {
      [EM_A]: "running",
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2); // (a)+(c) on unit state, (b) on EM
  });
});
