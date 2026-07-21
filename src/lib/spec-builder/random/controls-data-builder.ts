/**
 * G0-16 W3 — controls-data seeding for the random FDS builder. Random specs
 * exercise every G1–G5 deterministic writer end-to-end: drive models on
 * conveyor CMs (tier 1 + tier-2 commissioning entry), fail-safe polarity on
 * safety DIs, S7 ADC scaling on AIs, per-unit PackML coordination with
 * safety-healthy aggregation and EM-aggregate transitions, a linear axis when
 * a position transmitter exists, and maintenance overridable outputs. All
 * values are generic (platform physics / canonical patterns) — user-editable
 * in the Controls Data panel afterwards.
 */
import type {
  AnalogScaling,
  DriveModelV1,
  DriveEngineeringEntry,
  EngineeringDataV1,
  IoPolarity,
  LinearAxis,
  MaintenanceV1,
  SafetyGateV2,
  UnitCoordinationV1,
} from "@/types/spec-contract-v2";
import {
  EM_LOCAL_ABORTED,
  EM_LOCAL_COMPLETE,
  EM_LOCAL_EXECUTE,
} from "./state-machine";

// Shapes shared with assemble.ts (structural — no import cycle).
interface SeedIoSignal {
  tag: string;
  kind: "DI" | "DO" | "AI" | "AO";
}
interface SeedDevice {
  control_module_id: string;
  control_module_class: string;
  is_safety: boolean;
  io_signals: SeedIoSignal[];
}
interface SeedUnit {
  unit_id: string;
  unit_name: string;
  equipment_modules: { control_modules: SeedDevice[] }[];
}

/** CM classes modeled as VSD-controlled in random specs. */
const DRIVE_CLASSES = new Set(["conveyor"]);

/** Tier-1 drive model for drive-class CMs (golden-master defaults). */
export function driveForClass(cls: string): DriveModelV1 | undefined {
  if (!DRIVE_CLASSES.has(cls)) return undefined;
  return {
    family: "sinamics_g120",
    telegram: 1,
    speed_ref: { unit: "percent_ref_speed", signed: false },
    enable_policy: "enable_on_nonzero_ref",
  };
}

/** Safety devices and drive fault contacts are N/C fail-safe wired — the
 *  MAP writer inverts so the EM sees TRUE = abnormal. */
export function polarityFor(
  dev: { is_safety: boolean },
  kind: string,
  suffix: string,
): IoPolarity | undefined {
  if (kind !== "DI") return undefined;
  return dev.is_safety || suffix === "FAULT" ? "nc" : undefined;
}

/** S7 ADC platform default: 4–20 mA ≙ 5530–27648 counts, rendered 0–100 %. */
export function scalingFor(kind: string): AnalogScaling | undefined {
  if (kind !== "AI") return undefined;
  return {
    raw: { min: 5530, max: 27648, unit: "counts" },
    eu: { min: 0, max: 100, unit: "%" },
  };
}

/** Tier-2 commissioning entries for every drive-class CM. HW ids stay
 *  unrecorded on purpose — the writer's TODO-not-guess path is part of the
 *  fixture. RefSpeed 1500 rpm = generic 4-pole 50 Hz. */
export function buildEngineeringDrives(units: SeedUnit[]): DriveEngineeringEntry[] {
  return units.flatMap((u) =>
    u.equipment_modules.flatMap((em) =>
      em.control_modules
        .filter((cm) => DRIVE_CLASSES.has(cm.control_module_class))
        .map((cm) => ({
          control_module_id: cm.control_module_id,
          ref_speed_rpm: 1500,
          config_axis: 0x003f,
        })),
    ),
  );
}

export function buildEngineering(units: SeedUnit[]): EngineeringDataV1 | undefined {
  const drives = buildEngineeringDrives(units);
  if (!drives.length) return undefined;
  return {
    drives,
    axis_constants: [],
    encoder_presets: [],
    fb_assignments: [],
    upstream_endpoints: [],
  };
}

/** First two DO tags become commissioning-overridable outputs (G3 layer). */
export function buildMaintenance(units: SeedUnit[]): MaintenanceV1 | undefined {
  const doTags = units.flatMap((u) =>
    u.equipment_modules.flatMap((em) =>
      em.control_modules.flatMap((cm) =>
        cm.io_signals.filter((s) => s.kind === "DO").map((s) => s.tag),
      ),
    ),
  );
  if (!doTags.length) return undefined;
  return {
    overridable_outputs: doTags.slice(0, 2).map((tag) => ({ tag, wire_check_only: false })),
  };
}

/** A linear axis when the unit carries a position transmitter — its AI is the
 *  envelope encoder. Gate ids are unit-scoped so the registry stays unique. */
function axisForUnit(unit: SeedUnit, unitIndex: number): LinearAxis | undefined {
  const encoder = unit.equipment_modules
    .flatMap((em) => em.control_modules)
    .filter((cm) => cm.control_module_class === "transmitter")
    .flatMap((cm) => cm.io_signals)
    .find((s) => s.kind === "AI");
  if (!encoder) return undefined;
  const gid = (role: string) => `u${unitIndex + 1}_${role}`;
  return {
    axis_id: "travel",
    kind: "linear",
    encoder_tag: encoder.tag,
    eu_unit: "mm",
    scale: { db_member: "scale_x10", retain: true, operator_settable: false },
    length: { db_member: "length_mm", default: 0, retain: true, operator_settable: true },
    end_margin: { db_member: "end_margin_mm", default: 500, retain: true, operator_settable: false },
    ramp_zone: { db_member: "ramp_zone_mm", default: 2000, retain: true, operator_settable: false },
    gates: {
      fwd_ok: gid("fwd_ok"),
      fwd_fast_ok: gid("fwd_fast_ok"),
      rev_ok: gid("rev_ok"),
      rev_fast_ok: gid("rev_fast_ok"),
    },
    unconfigured_open: true,
  };
}

/** Canonical per-unit PackML coordination: resting-state mode changes,
 *  command + EM-aggregate transitions matching the EM-local state machine,
 *  safety-healthy over every machine gate, v1 command routing. */
export function buildUnitCoordination(
  units: SeedUnit[],
  gates: SafetyGateV2[],
): Record<string, UnitCoordinationV1> {
  const out: Record<string, UnitCoordinationV1> = {};
  units.forEach((unit, ui) => {
    const axis = axisForUnit(unit, ui);
    out[unit.unit_id] = {
      unit_id: unit.unit_id,
      states: (
        [
          ["idle", true],
          ["starting", false],
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
      transitions: [
        {
          transition_id: `${unit.unit_id}_t_start`,
          from_state_id: "idle",
          to_state_id: "starting",
          trigger: { type: "command", command: "start" },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: `${unit.unit_id}_t_started`,
          from_state_id: "starting",
          to_state_id: "execute",
          trigger: { type: "em_aggregate", em_scope: "all", em_state: EM_LOCAL_EXECUTE },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: `${unit.unit_id}_t_stop`,
          from_state_id: "execute",
          to_state_id: "stopping",
          trigger: { type: "command", command: "stop" },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: `${unit.unit_id}_t_stopped`,
          from_state_id: "stopping",
          to_state_id: "stopped",
          trigger: { type: "em_aggregate", em_scope: "all", em_state: EM_LOCAL_COMPLETE },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: `${unit.unit_id}_t_reset`,
          from_state_id: "stopped",
          to_state_id: "idle",
          trigger: { type: "command", command: "reset" },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: `${unit.unit_id}_t_aborted`,
          from_state_id: "aborting",
          to_state_id: "aborted",
          trigger: { type: "em_aggregate", em_scope: "all", em_state: EM_LOCAL_ABORTED },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: `${unit.unit_id}_t_clear`,
          from_state_id: "aborted",
          to_state_id: "idle",
          trigger: { type: "command", command: "clear" },
          guard: [],
          allowed_modes: [],
        },
      ],
      signal_routing: {
        ...(gates.length
          ? {
              safety_healthy: {
                gate_ids: gates.map((g) => g.gate_id),
                exclude_maintenance: true,
              },
            }
          : {}),
        routing_rows: [],
        two_detent: [],
        command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
      },
      ...(axis ? { axes: [axis] } : {}),
    };
  });
  return out;
}
