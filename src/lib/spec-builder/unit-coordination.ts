/**
 * G0-9 unit-coordination semantics — pure helpers, no React/IO.
 * Single source of truth shared by patch validation (contract.ts), the
 * future G2 unit-FB writer, and UI display. Generic across machine types.
 * Design: Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md
 */
import type {
  EmStateV2,
  OperatorMode,
  UnitCoordinationV1,
  UnitPackMLState,
} from "@/types/spec-contract-v2";

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

/**
 * Structural subset of SpecContractV2 needed for the legality rule — a full
 * contract is directly assignable. Keeps tests and non-contract callers light.
 */
export interface ModeChangeSpecView {
  modes?: OperatorMode[];
  unit_coordination?: Record<string, UnitCoordinationV1>;
  equipment_modules: Record<string, { unit_id: string; states: EmStateV2[] }>;
}

export interface ModeChangeVerdict {
  legal: boolean;
  reasons: string[];
}

/**
 * G0-9 mode-change legality (v1, strict). Validation gate, not coercion —
 * a grant never forces a state change. Request granted iff:
 *  (a) the unit's current state has mode_change_allowed, and
 *  (b) every member EM with a known current state is in an EM state whose
 *      allowed_modes includes the target mode (empty mask = always legal), and
 *  (c) the current unit state itself is in the target mode's mask
 *      (empty = all modes) — a legal switch must not strand the unit in a
 *      masked-out state.
 * Member EMs absent from `emCurrentStates` are skipped (caller supplies as
 * much runtime state as it has). All violations are collected into `reasons`.
 */
export function isModeChangeLegal(
  spec: ModeChangeSpecView,
  unitId: string,
  targetModeId: string,
  currentUnitState: UnitPackMLState,
  emCurrentStates: Record<string, string>,
): ModeChangeVerdict {
  const reasons: string[] = [];

  const coord = spec.unit_coordination?.[unitId];
  if (!coord) reasons.push(`unit ${unitId} has no unit_coordination entry`);
  if (!spec.modes?.some((m) => m.mode_id === targetModeId)) {
    reasons.push(`target mode ${targetModeId} is not a declared mode`);
  }
  if (reasons.length > 0) return { legal: false, reasons };

  const unitState = coord!.states.find((s) => s.state_id === currentUnitState);
  if (!unitState) {
    reasons.push(
      `unit ${unitId} state ${currentUnitState} is not declared in its coordination`,
    );
    return { legal: false, reasons };
  }

  // (a) state gate
  if (!unitState.mode_change_allowed) {
    reasons.push(
      `unit ${unitId} state ${currentUnitState} has mode_change_allowed=false`,
    );
  }

  // (c) the unit state must remain active in the target mode
  if (
    unitState.allowed_modes.length > 0 &&
    !unitState.allowed_modes.includes(targetModeId)
  ) {
    reasons.push(
      `unit ${unitId} state ${currentUnitState} is not in mode ${targetModeId}'s mask`,
    );
  }

  // (b) every member EM with known runtime state must allow the target mode
  for (const [emId, em] of Object.entries(spec.equipment_modules)) {
    if (em.unit_id !== unitId) continue;
    const currentEmStateId = emCurrentStates[emId];
    if (currentEmStateId === undefined) continue;
    const emState = em.states.find((s) => s.state_id === currentEmStateId);
    if (!emState) {
      reasons.push(
        `equipment_module ${emId} reports unknown state ${currentEmStateId}`,
      );
      continue;
    }
    if (
      emState.allowed_modes.length > 0 &&
      !emState.allowed_modes.includes(targetModeId)
    ) {
      reasons.push(
        `equipment_module ${emId} is in state ${currentEmStateId}, whose allowed_modes excludes ${targetModeId}`,
      );
    }
  }

  return { legal: reasons.length === 0, reasons };
}

/**
 * Structural invariants over one unit's coordination (design §Validation).
 * Context-dependent checks are skipped when their context is absent —
 * callers pass whatever the patch carries (same convention as the
 * safety-gates validator in contract.ts). Rule 3 (exactly one default
 * mode) already lives in validateSpecContractPatch.
 */
export function validateUnitCoordination(
  coord: UnitCoordinationV1,
  ctx: { modes?: OperatorMode[]; memberEmIds?: Set<string> },
): string[] {
  const issues: string[] = [];
  const where = `unit_coordination[${coord.unit_id}]`;

  // Rule 1 — unique state ids; transitions reference declared states.
  const stateIds = coord.states.map((s) => s.state_id);
  const declared = new Set(stateIds);
  const dupStates = stateIds.filter((id, i) => stateIds.indexOf(id) !== i);
  if (dupStates.length > 0) {
    issues.push(`${where}: duplicate state_id(s): ${[...new Set(dupStates)].join(", ")}`);
  }
  const seenTransitions = new Set<string>();
  for (const t of coord.transitions) {
    if (seenTransitions.has(t.transition_id)) {
      issues.push(`${where}: duplicate transition_id ${t.transition_id}`);
    }
    seenTransitions.add(t.transition_id);
    for (const ref of [t.from_state_id, t.to_state_id]) {
      if (!declared.has(ref)) {
        issues.push(
          `${where}: transition ${t.transition_id} references undeclared state ${ref}`,
        );
      }
    }
  }

  // Rules 2 + 4 — need the mode list.
  if (ctx.modes) {
    for (const mode of ctx.modes) {
      const inMask = coord.states.filter(
        (s) => s.allowed_modes.length === 0 || s.allowed_modes.includes(mode.mode_id),
      );
      if (inMask.length === 0) {
        issues.push(
          `${where}: mode ${mode.mode_id} has no allowed unit state (empty machine)`,
        );
      } else if (!inMask.some((s) => s.mode_change_allowed)) {
        issues.push(
          `${where}: mode ${mode.mode_id} has no state with mode_change_allowed=true in its mask (cannot leave the mode)`,
        );
      }
    }
  }

  // Rule 5 — overrides must reference member EMs of this unit.
  if (ctx.memberEmIds && coord.em_command_overrides) {
    for (const [stateId, overrides] of Object.entries(coord.em_command_overrides)) {
      for (const o of overrides ?? []) {
        if (!ctx.memberEmIds.has(o.equipment_module_id)) {
          issues.push(
            `${where}: em_command_overrides[${stateId}] references equipment_module ${o.equipment_module_id} which is not a member of this unit`,
          );
        }
      }
    }
  }

  return issues;
}
