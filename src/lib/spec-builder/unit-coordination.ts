/**
 * G0-9 unit-coordination semantics — pure helpers, no React/IO.
 * Single source of truth shared by patch validation (contract.ts), the
 * future G2 unit-FB writer, and UI display. Generic across machine types.
 * Design: Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md
 */
import type { UnitCoordinationV1, UnitPackMLState } from "@/types/spec-contract-v2";

export type EmCommand =
  | "CLEAR"
  | "RESET"
  | "START"
  | "STOP"
  | "HOLD"
  | "ABORT"
  | "NONE";

/**
 * Canonical unit-state → member-EM command map. `NONE` means the unit FB
 * asserts nothing; the EM stays where it is (hold last). Safety gates keep
 * their existing force-to-safe role and additionally map to the unit's
 * `aborting` transition — no duplication of the safety model here.
 */
export const CANONICAL_EM_COMMAND_MAP: Record<UnitPackMLState, EmCommand> = {
  idle: "NONE",
  starting: "START",
  execute: "START",
  completing: "NONE",
  complete: "NONE",
  resetting: "RESET",
  holding: "HOLD",
  held: "HOLD",
  unholding: "NONE",
  suspending: "NONE",
  suspended: "NONE",
  unsuspending: "NONE",
  stopping: "STOP",
  stopped: "STOP",
  aborting: "ABORT",
  aborted: "ABORT",
  clearing: "CLEAR",
};

/**
 * Command the unit asserts to one member EM while in `unitState`:
 * per-EM override when one exists for that state, else the canonical map.
 */
export function emCommandForState(
  coord: UnitCoordinationV1,
  unitState: UnitPackMLState,
  equipmentModuleId: string,
): EmCommand {
  const override = coord.em_command_overrides?.[unitState]?.find(
    (o) => o.equipment_module_id === equipmentModuleId,
  );
  return override?.command ?? CANONICAL_EM_COMMAND_MAP[unitState];
}
