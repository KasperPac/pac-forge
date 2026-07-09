// src/lib/spec-builder/codegen/unit-builder.ts
//
// G2 unit-FB writer — pure IR builder (no React/IO), mirroring the
// em-builder/em-writer split. Turns a unit's G0-9 `unit_coordination` into a
// resolved intermediate representation the unit-writer lowers to SCL.
// Design: Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md
import { UNIT_PACKML_STATES } from "@/types/spec-contract-v2";
import type { UnitCoordinationV1, UnitPackMLState } from "@/types/spec-contract-v2";

/** One declared unit state, resolved to its canonical-order Cur_St index. */
export interface UnitStateIr {
  stateId: UnitPackMLState;
  /** Dispatch index for `Cur_St`, sequential in canonical UNIT_PACKML_STATES order. */
  index: number;
  allowedModes: string[];
  modeChangeAllowed: boolean;
}

/** Resolved IR for one unit coordinator. Grows per G2 TDD cycle. */
export interface UnitSequenceIr {
  unitId: string;
  unitName: string;
  states: UnitStateIr[];
  warnings: string[];
}

/**
 * Build the resolved IR for one unit. `Cur_St` indexes the unit's declared
 * states ordered per the canonical `UNIT_PACKML_STATES` order (G0-9 PackTags
 * rule; G7-1 text lists share this order) — never authoring order.
 */
export function buildUnitSequence(
  unitId: string,
  unitName: string,
  coord: UnitCoordinationV1,
): UnitSequenceIr {
  const warnings: string[] = [];

  const states: UnitStateIr[] = [...coord.states]
    .sort(
      (a, b) =>
        UNIT_PACKML_STATES.indexOf(a.state_id) -
        UNIT_PACKML_STATES.indexOf(b.state_id),
    )
    .map((s, index) => ({
      stateId: s.state_id,
      index,
      allowedModes: s.allowed_modes,
      modeChangeAllowed: s.mode_change_allowed,
    }));

  return { unitId, unitName, states, warnings };
}
