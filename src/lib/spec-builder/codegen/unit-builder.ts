// src/lib/spec-builder/codegen/unit-builder.ts
//
// G2 unit-FB writer — pure IR builder (no React/IO), mirroring the
// em-builder/em-writer split. Turns a unit's G0-9 `unit_coordination` into a
// resolved intermediate representation the unit-writer lowers to SCL.
// Design: Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md
import { UNIT_PACKML_STATES } from "@/types/spec-contract-v2";
import type {
  OperatorMode,
  PermissiveCondition,
  SafetyGateV2,
  UnitCoordinationV1,
  UnitPackMLState,
} from "@/types/spec-contract-v2";
import { emCommandForState, type EmCommand } from "../unit-coordination";
import { serializeGuard } from "./serialize-condition";

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

/**
 * A unit transition trigger resolved against member EMs and the mode set.
 * - `command`  → a PackML command-word constant fires the transition.
 * - `condition`→ serialized permissive expression against global tags.
 * - `em_aggregate` → AND of `"EM_<x>_DB".state = <idx>` comparisons; when a
 *   member EM lacks the referenced slug the whole guard renders FALSE
 *   (`alwaysFalse`) rather than silently true.
 */
export type ResolvedTriggerIr =
  | { kind: "command"; command: string }
  | { kind: "condition"; expr: PermissiveCondition[] }
  | {
      kind: "em_aggregate";
      comparisons: { emName: string; stateIndex: number }[];
      alwaysFalse: boolean;
    };

/** One resolved unit-SM transition. */
export interface UnitTransitionIr {
  transitionId: string;
  fromIndex: number;
  toIndex: number;
  trigger: ResolvedTriggerIr;
  /** Extra permissive conditions AND'd onto the trigger (empty = none). */
  guard: PermissiveCondition[];
  /** Cur_Mode indices in which this transition is enabled (empty = all modes). */
  modeMask: number[];
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
  /** Machine safety gates — resolves signal_routing.safety_healthy (G2-2). */
  safetyGates?: SafetyGateV2[];
}

/** Resolved IR for one unit coordinator. Grows per G2 TDD cycle. */
export interface UnitSequenceIr {
  unitId: string;
  unitName: string;
  /** Member EMs in declaration order (drives EM_St[] and command assertion). */
  members: { emId: string; emName: string }[];
  states: UnitStateIr[];
  transitions: UnitTransitionIr[];
  /** G2-2: the serialized `#ok` term (AND of referenced safety gates). */
  safetyHealthy?: { expr: string; excludeMaintenance: boolean };
  /** G2-2: command-routing policy flags from signal_routing (G0-3). */
  commandRouting?: { seqTestRelease: boolean };
  warnings: string[];
}

/**
 * Build the resolved IR for one unit. `Cur_St` indexes the unit's declared
 * states ordered per the canonical `UNIT_PACKML_STATES` order (G0-9 PackTags
 * rule; G7-1 text lists share this order) — never authoring order.
 */
export function buildUnitSequence(input: UnitBuildInput): UnitSequenceIr {
  const { unitId, unitName, coord, members, modes, safetyGates } = input;
  const warnings: string[] = [];
  const modeIndex = new Map(modes.map((m, i) => [m.mode_id, i]));

  // G2-2: resolve the safety-healthy term against the machine safety gates.
  const sh = coord.signal_routing?.safety_healthy;
  let safetyHealthy: UnitSequenceIr["safetyHealthy"];
  if (sh) {
    const conditions: PermissiveCondition[] = [];
    let missing = false;
    for (const gid of sh.gate_ids) {
      const gate = safetyGates?.find((g) => g.gate_id === gid);
      if (!gate) {
        missing = true;
        warnings.push(
          `unit ${unitName}: safety_healthy references gate "${gid}" not found in safety_gates — #ok renders FALSE`,
        );
        continue;
      }
      conditions.push(...gate.condition);
    }
    safetyHealthy = {
      expr: missing ? "FALSE" : serializeGuard(conditions, (t) => `"${t}"`),
      excludeMaintenance: sh.exclude_maintenance,
    };
  }

  const cr = coord.signal_routing?.command_routing;
  const commandRouting = cr ? { seqTestRelease: cr.seq_test_release } : undefined;

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

  const indexByState = new Map(states.map((s) => [s.stateId, s.index]));

  const transitions: UnitTransitionIr[] = coord.transitions.map((t) => ({
    transitionId: t.transition_id,
    fromIndex: indexByState.get(t.from_state_id) ?? -1,
    toIndex: indexByState.get(t.to_state_id) ?? -1,
    trigger: resolveTrigger(t.trigger, t.transition_id, unitName, members, warnings),
    guard: t.guard,
    modeMask: t.allowed_modes
      .map((id) => modeIndex.get(id))
      .filter((n): n is number => n !== undefined),
  }));

  return {
    unitId,
    unitName,
    members: members.map((m) => ({ emId: m.emId, emName: m.emName })),
    states,
    transitions,
    safetyHealthy,
    commandRouting,
    warnings,
  };
}

/** Resolve one transition trigger against the member EMs (pure; may push warnings). */
function resolveTrigger(
  trigger: UnitCoordinationV1["transitions"][number]["trigger"],
  transitionId: string,
  unitName: string,
  members: UnitMemberEm[],
  warnings: string[],
): ResolvedTriggerIr {
  switch (trigger.type) {
    case "command":
      return { kind: "command", command: trigger.command };
    case "condition":
      return { kind: "condition", expr: trigger.expr };
    case "em_aggregate": {
      const scope =
        trigger.em_scope === "all"
          ? members
          : trigger.em_scope
              .map((id) => members.find((m) => m.emId === id))
              .filter((m): m is UnitMemberEm => m !== undefined);
      const comparisons: { emName: string; stateIndex: number }[] = [];
      let alwaysFalse = false;
      for (const m of scope) {
        const st = m.states.find((s) => s.slug === trigger.em_state);
        if (!st) {
          alwaysFalse = true;
          warnings.push(
            `unit ${unitName}: em_aggregate transition ${transitionId} references EM state "${trigger.em_state}" not found on EM ${m.emName} — guard renders FALSE`,
          );
          continue;
        }
        comparisons.push({ emName: m.emName, stateIndex: st.index });
      }
      return { kind: "em_aggregate", comparisons, alwaysFalse };
    }
  }
}
