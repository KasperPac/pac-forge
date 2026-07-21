// src/lib/spec-builder/unit-coordination-seed.ts
//
// G0-16: generic starter coordination for a unit — the canonical minimum
// PackML state set (mode changes legal in the resting states per the schema
// hint), safety-healthy over every declared machine gate, and the evidenced
// v1 command-routing policy. Pure; consumed by the Controls Data panel.
import type { LinearAxis, RotaryAxis, SafetyGateV2, UnitCoordinationV1 } from "@/types/spec-contract-v2";

export function seedCoordination(unitId: string, gates: SafetyGateV2[]): UnitCoordinationV1 {
  return {
    unit_id: unitId,
    states: (
      [
        ["idle", true],
        ["execute", false],
        ["stopping", false],
        ["stopped", true],
        ["aborting", false],
        ["aborted", true],
      ] as const
    ).map(([state_id, mode_change_allowed]) => ({
      state_id,
      allowed_modes: [],
      mode_change_allowed,
    })),
    transitions: [],
    signal_routing: {
      ...(gates.length
        ? { safety_healthy: { gate_ids: gates.map((g) => g.gate_id), exclude_maintenance: true } }
        : {}),
      routing_rows: [],
      two_detent: [],
      command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
    },
  };
}

/** Generic linear-axis starter: schema-documented defaults (end margin 500,
 *  ramp zone 2000, growing operator-set length, unconfigured-open policy). */
export function seedLinearAxis(axisId: string): LinearAxis {
  return {
    axis_id: axisId,
    kind: "linear",
    encoder_tag: "",
    eu_unit: "mm",
    scale: { db_member: "scale_x10", retain: true, operator_settable: false, description: "EU per encoder rev x10 (fixed physics, set once)" },
    length: { db_member: "length_mm", default: 0, retain: true, operator_settable: true, description: "Operational envelope length (operator-set; may grow in service)" },
    end_margin: { db_member: "end_margin_mm", default: 500, retain: true, operator_settable: false, description: "Soft limit from either end (hard limit stays wired)" },
    ramp_zone: { db_member: "ramp_zone_mm", default: 2000, retain: true, operator_settable: false, description: "Fast falls back to jog inside this distance from the ends" },
    gates: {},
    unconfigured_open: true,
  };
}

/** Generic rotary-axis starter: uncalibrated (raw = direct 0.1 deg), one
 *  home window at 0 deg +/- 2.0 deg. */
export function seedRotaryAxis(axisId: string): RotaryAxis {
  return {
    axis_id: axisId,
    kind: "rotary",
    encoder_tag: "",
    counts_per_rev: { db_member: "counts_per_360", default: 0, retain: true, operator_settable: false, description: "Raw counts per full 360 deg turn; 0 = uncalibrated (raw is direct 0.1 deg)" },
    preset_offset: 0,
    home_windows: [{ center_deg10: 0, band_deg10: 20 }],
    gates: {},
  };
}

let idCounter = 0;
/** Collision-safe id for authored rows/transitions (opaque to React Compiler
 *  purity analysis — ids are minted in event handlers, never during render). */
export function freshAuthoredId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}
