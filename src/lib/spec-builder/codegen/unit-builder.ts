// src/lib/spec-builder/codegen/unit-builder.ts
//
// G2 unit-FB writer — pure IR builder (no React/IO), mirroring the
// em-builder/em-writer split. Turns a unit's G0-9 `unit_coordination` into a
// resolved intermediate representation the unit-writer lowers to SCL.
// Design: Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md
import { UNIT_PACKML_STATES } from "@/types/spec-contract-v2";
import type {
  OperatorMode,
  UnitCoordinationV1,
  UnitPackMLState,
} from "@/types/spec-contract-v2";
import { emCommandForState, type EmCommand } from "../unit-coordination";

/** A member EM of the unit, with its EM-local PackML slug → dispatch index map. */
export interface UnitMemberEm {
  emId: string;
  /** SCL identifier stem for `EM_<name>_DB` references (already sclIdent-ed by caller). */
  emName: string;
  /** EM-local states in dispatch order: slug → index (for em_aggregate guards). */
  states: { slug: string; index: number }[];
}

/** The command the unit asserts to one member EM while in a given unit state. */
export interface UnitEmCommandIr {
  emId: string;
  command: EmCommand;
}

/** One declared unit state, resolved to its canonical-order Cur_St index. */
export interface UnitStateIr {
  stateId: UnitPackMLState;
  /** Dispatch index for `Cur_St`, sequential in canonical UNIT_PACKML_STATES order. */
  index: number;
  allowedModes: string[];
  modeChangeAllowed: boolean;
  /** Command asserted to each member EM in this state (canonical map + per-EM overrides). */
  commands: UnitEmCommandIr[];
}

/** Inputs to the unit IR builder. */
export interface UnitBuildInput {
  unitId: string;
  unitName: string;
  coord: UnitCoordinationV1;
  /** Member EMs in hierarchy (declaration) order. */
  members: UnitMemberEm[];
  /** Declared operator modes (for Cur_Mode mask guards). */
  modes: OperatorMode[];
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
export function buildUnitSequence(input: UnitBuildInput): UnitSequenceIr {
  const { unitId, unitName, coord, members } = input;
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
      commands: members.map((m) => ({
        emId: m.emId,
        command: emCommandForState(coord, s.state_id, m.emId),
      })),
    }));

  return { unitId, unitName, states, warnings };
}
