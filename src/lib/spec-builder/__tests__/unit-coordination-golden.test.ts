import { describe, it, expect } from "vitest";
import {
  UnitCoordinationV1Schema,
  UNIT_PACKML_STATES,
} from "@/types/spec-contract-v2";
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";
import {
  emCommandForState,
  isModeChangeLegal,
  validateUnitCoordination,
} from "@/lib/spec-builder/unit-coordination";
import type { ModeChangeSpecView } from "@/lib/spec-builder/unit-coordination";

// HRE-shaped golden fixture (Segment Wagon–like machine). Fixture-only —
// the model under test is generic across machine types.
const EM_DRIVE = "11111111-1111-4111-8111-111111111111";
const EM_BRAKE = "22222222-2222-4222-8222-222222222222";

const MODES = [
  { mode_id: "production", name: "Production", is_default: true, kind: "production" as const },
  { mode_id: "maintenance", name: "Maintenance", is_default: false, kind: "maintenance" as const },
  { mode_id: "seq_test", name: "Sequence Test", is_default: false, kind: "engineering" as const },
];

const CARRIAGE_UNIT: UnitCoordinationV1 = UnitCoordinationV1Schema.parse({
  unit_id: "carriage_unit",
  states: [
    { state_id: "stopped", mode_change_allowed: true },
    { state_id: "resetting" },
    { state_id: "idle", mode_change_allowed: true },
    { state_id: "starting", allowed_modes: ["production"] },
    { state_id: "execute", allowed_modes: ["production"] },
    { state_id: "holding", allowed_modes: ["production"] },
    { state_id: "held", allowed_modes: ["production"] },
    { state_id: "unholding", allowed_modes: ["production"] },
    { state_id: "stopping" },
    { state_id: "aborting" },
    { state_id: "aborted", mode_change_allowed: true },
    { state_id: "clearing" },
  ],
  transitions: [
    { transition_id: "t_reset", from_state_id: "stopped", to_state_id: "resetting",
      trigger: { type: "command", command: "reset" } },
    { transition_id: "t_reset_done", from_state_id: "resetting", to_state_id: "idle",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    { transition_id: "t_start", from_state_id: "idle", to_state_id: "starting",
      trigger: { type: "command", command: "start" }, allowed_modes: ["production"] },
    { transition_id: "t_started", from_state_id: "starting", to_state_id: "execute",
      trigger: { type: "em_aggregate", em_scope: [EM_DRIVE], em_state: "driving" } },
    { transition_id: "t_hold", from_state_id: "execute", to_state_id: "holding",
      trigger: { type: "command", command: "hold" } },
    { transition_id: "t_held", from_state_id: "holding", to_state_id: "held",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    { transition_id: "t_unhold", from_state_id: "held", to_state_id: "unholding",
      trigger: { type: "command", command: "unhold" } },
    { transition_id: "t_unheld", from_state_id: "unholding", to_state_id: "execute",
      trigger: { type: "em_aggregate", em_scope: [EM_DRIVE], em_state: "driving" } },
    { transition_id: "t_stop", from_state_id: "execute", to_state_id: "stopping",
      trigger: { type: "command", command: "stop" } },
    { transition_id: "t_stopped", from_state_id: "stopping", to_state_id: "stopped",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    // Safety-gate violation maps to the aborting transition (design: no
    // duplication of the safety model — the gate condition drives this).
    { transition_id: "t_abort", from_state_id: "execute", to_state_id: "aborting",
      trigger: { type: "condition", expr: [{ tag: "SAFETY_OK", operator: "=", value: false }] } },
    { transition_id: "t_aborted", from_state_id: "aborting", to_state_id: "aborted",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    { transition_id: "t_clear", from_state_id: "aborted", to_state_id: "clearing",
      trigger: { type: "command", command: "clear" } },
    { transition_id: "t_cleared", from_state_id: "clearing", to_state_id: "stopped",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
  ],
  // Maintenance semantics: while held, keep the brake EM commanded to STOP
  // rather than HOLD (hand-written UC behavior).
  em_command_overrides: {
    held: [{ equipment_module_id: EM_BRAKE, command: "STOP" }],
  },
});

const SPEC: ModeChangeSpecView = {
  modes: MODES,
  unit_coordination: { carriage_unit: CARRIAGE_UNIT },
  equipment_modules: {
    [EM_DRIVE]: {
      unit_id: "carriage_unit",
      states: [
        { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "driving", name: "Driving", kind: "sequential", allowed_modes: ["production"], is_safe_state: false },
      ],
    },
    [EM_BRAKE]: {
      unit_id: "carriage_unit",
      states: [
        { state_id: "applied", name: "Applied", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "released", name: "Released", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
    },
  },
};

describe("G0-9 golden: HRE-shaped unit coordination", () => {
  it("parses and passes all structural validation", () => {
    const issues = validateUnitCoordination(CARRIAGE_UNIT, {
      modes: MODES,
      memberEmIds: new Set([EM_DRIVE, EM_BRAKE]),
    });
    expect(issues).toEqual([]);
  });

  it("every fixture state is canonical PackML", () => {
    for (const s of CARRIAGE_UNIT.states) {
      expect(UNIT_PACKML_STATES).toContain(s.state_id);
    }
  });

  it("canonical command map drives the EMs through a production cycle", () => {
    expect(emCommandForState(CARRIAGE_UNIT, "resetting", EM_DRIVE)).toBe("RESET");
    expect(emCommandForState(CARRIAGE_UNIT, "execute", EM_DRIVE)).toBe("START");
    expect(emCommandForState(CARRIAGE_UNIT, "stopping", EM_DRIVE)).toBe("STOP");
    expect(emCommandForState(CARRIAGE_UNIT, "aborting", EM_BRAKE)).toBe("ABORT");
    expect(emCommandForState(CARRIAGE_UNIT, "idle", EM_DRIVE)).toBe("NONE");
  });

  it("held-state brake override wins over the canonical HOLD", () => {
    expect(emCommandForState(CARRIAGE_UNIT, "held", EM_BRAKE)).toBe("STOP");
    expect(emCommandForState(CARRIAGE_UNIT, "held", EM_DRIVE)).toBe("HOLD");
  });

  it("mode change to maintenance is legal when stopped with EMs safe", () => {
    const v = isModeChangeLegal(SPEC, "carriage_unit", "maintenance", "stopped", {
      [EM_DRIVE]: "stopped",
      [EM_BRAKE]: "applied",
    });
    expect(v).toEqual({ legal: true, reasons: [] });
  });

  it("mode change is refused mid-execute (state gate + drive EM mask)", () => {
    const v = isModeChangeLegal(SPEC, "carriage_unit", "maintenance", "execute", {
      [EM_DRIVE]: "driving",
      [EM_BRAKE]: "released",
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("seq_test (engineering kind) behaves as a normal mode in the legality rule", () => {
    // engineering semantics (release command pins, no HMI exposure) are
    // writer-side (G2/G7); the schema/legality layer treats it uniformly.
    const v = isModeChangeLegal(SPEC, "carriage_unit", "seq_test", "idle", {
      [EM_DRIVE]: "stopped",
      [EM_BRAKE]: "applied",
    });
    expect(v.legal).toBe(true);
  });
});
