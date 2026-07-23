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
  SignalSourceRef,
  UnitCoordinationV1,
  UnitPackMLState,
} from "@/types/spec-contract-v2";
import { emCommandForState, type EmCommand } from "../unit-coordination";
import { serializeGuard } from "./serialize-condition";
import { sclIdent } from "./sa-builder";
import { cfgDbName, statDbName } from "./naming";

/** A member EM of the unit, with its EM-local PackML slug → dispatch index map. */
export interface UnitMemberEm {
  emId: string;
  /** SCL identifier stem for `EM_<name>_DB` references (already sclIdent-ed by caller). */
  emName: string;
  /** EM-local states in dispatch order: slug → index (for em_aggregate guards).
   *  `allowedModes` = the EM state's allowed mode_ids (G0-9 EmStateV2.allowed_modes;
   *  empty/undefined = all modes) — drives mode-change legality (G2-1). */
  states: { slug: string; index: number; allowedModes?: string[] }[];
  /** G2-3: set to the library FB template name for matched library EMs (C5
   *  path) — no command-role pins in FbInterfaceContract yet, so the writer
   *  emits a TODO instead of seam writes. Absent = canonical `<EM>_CMD` seam. */
  librarySeam?: string;
}

/** Compile-time expansion of `isModeChangeLegal` for one target mode (G2-1).
 *  `null` index lists mean "unrestricted — omit the term". */
export interface UnitModeIr {
  name: string;
  index: number;
  /** Unit states in which this mode may be entered (null = all declared states). */
  unitStateIndices: number[] | null;
  /** Per member EM: EM state indices legal in this mode. Members whose every
   *  state allows the mode contribute no term (omitted from the list). */
  emTerms: { emName: string; stateIndices: number[] }[];
}

export interface UnitModeManagerIr {
  modes: UnitModeIr[];
  /** Cur_St indices whose state has mode_change_allowed (Mode_Change_Legal mirror). */
  modeChangeAllowedIndices: number[];
  /** Cur_Mode init value (index of the is_default mode; 0 when none flagged). */
  defaultModeIndex: number;
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

/** A routing-row signal reference resolved against the member EMs and the
 *  G0-4 axis gate registry (G2-4/G2-5).
 *  `gateTemp`    — a declared axis gate, computed by the G2-5 envelope block
 *                  into the named VAR_TEMP.
 *  `gatePending` — a named gate NOT declared by any unit axis — rendered
 *                  FALSE (fail-safe) + TODO. */
export type ResolvedSignalRef =
  | { kind: "tag"; tag: string; conditioned?: boolean }
  | { kind: "emStatus"; emName: string; member: string }
  | { kind: "gateTemp"; gateId: string; temp: string }
  | { kind: "gatePending"; gateId: string; declared: boolean };

/** A declared axis gate: its registry id + the writer's VAR_TEMP name. */
export interface AxisGateIr {
  gateId: string;
  temp: string;
}

/** One CFG_<Unit> DB member (G0-4 GeometryParamDef, lowered). */
export interface ConfigParamIr {
  member: string;
  retain: boolean;
  seed?: number;
  description?: string;
}

export interface LinearAxisIr {
  kind: "linear";
  axisId: string;
  /** SCL identifier stem for temp names. */
  ident: string;
  encoderTag: string;
  euUnit: string;
  /** Config-DB member names by role. */
  cfg: { scale: string; length: string; endMargin: string; rampZone: string };
  gates: {
    fwdOk?: AxisGateIr;
    fwdFastOk?: AxisGateIr;
    revOk?: AxisGateIr;
    revFastOk?: AxisGateIr;
  };
  unconfiguredOpen: boolean;
}

export interface RotaryAxisIr {
  kind: "rotary";
  axisId: string;
  ident: string;
  encoderTag: string;
  cfg: { countsPerRev: string };
  presetOffset: number;
  homeWindows: { center: number; band: number }[];
  atHome?: AxisGateIr;
}

/** G2-5: the unit's envelope geometry, resolved for emission. `statusDbName`
 *  is the G4-2 readback DB the UC writes each scan (positions, distances,
 *  zone flags, gate mirrors — the HMI's envelope telemetry). */
export interface UnitAxesIr {
  configDbName: string;
  statusDbName: string;
  params: ConfigParamIr[];
  linear: LinearAxisIr[];
  rotary: RotaryAxisIr[];
}

/** One resolved `target.pin := source AND gates` row (G0-3 routing_rows).
 *  `suppressedBy` set on a jog row that participates in a two-detent pair:
 *  the fast row's terms plus the fallback policy. */
export interface RoutingRowIr {
  rowId: string;
  emName: string;
  pin: string;
  source: ResolvedSignalRef;
  gates: ResolvedSignalRef[];
  suppressedBy?: { source: ResolvedSignalRef; gates: ResolvedSignalRef[]; fallback: boolean };
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
  /** G3: TRUE when the project emits the Maintenance_CMD seam — the writer
   *  then wires the #ok maintenance exclusion and the i_Seq_Test binding. */
  maintenanceSeam?: boolean;
  /** G2-7: tags carried by the IO_Cond conditioning layer — io_tag routing
   *  refs on these read the conditioned value, not the raw tag. */
  conditionedTags?: Set<string>;
  /** G5-4 final-review: the caller's already-deduplicated SCL identifier for
   *  this unit (collision-suffixed when two units' names sanitize to the
   *  same identifier). Every unit-scoped name the writer emits (UC_/UC_*_DB/
   *  UN_/CFG_/STAT_) MUST derive from this, never from a fresh
   *  `sclIdent(unitName)` — recomputing would silently re-collide with the
   *  sibling unit. Falls back to `sclIdent(unitName)` when the caller has no
   *  dedup pass (keeps existing callers/tests working unchanged). */
  unitScl?: string;
}

/** Resolved IR for one unit coordinator. Grows per G2 TDD cycle. */
export interface UnitSequenceIr {
  unitId: string;
  unitName: string;
  /** G5-4 final-review: the resolved (collision-safe) SCL identifier for this
   *  unit — the writer derives every unit-scoped block/DB name from this,
   *  never by recomputing `sclIdent(unitName)` (see `UnitBuildInput.unitScl`). */
  unitScl: string;
  /** Member EMs in declaration order (drives EM_St[] and command assertion). */
  members: { emId: string; emName: string; librarySeam?: string }[];
  states: UnitStateIr[];
  transitions: UnitTransitionIr[];
  /** G2-2: the serialized `#ok` term (AND of referenced safety gates).
   *  G2-1: `overrideTargetIndex` — the Cur_St the writer forces on NOT #ok
   *  (declared aborting, else aborted, else stopped; undefined = none declared,
   *  override skipped with a warning). `overrideExcludeIndices` — declared
   *  aborting/aborted indices the override must not fire from. */
  safetyHealthy?: {
    expr: string;
    excludeMaintenance: boolean;
    overrideTargetIndex?: number;
    overrideExcludeIndices: number[];
  };
  /** G2-2: command-routing policy flags from signal_routing (G0-3). */
  commandRouting?: { seqTestRelease: boolean };
  /** G2-1: mode manager — compile-time legality expansion (absent when no modes). */
  modeManager?: UnitModeManagerIr;
  /** G2-3: Cur_Mode index sets by semantic mode kind (absent when no modes) —
   *  engineering releases the command assertion, maintenance forces STOP. */
  commandGating?: { engineeringModeIndices: number[]; maintenanceModeIndices: number[] };
  /** G2-4: resolved signal-routing rows (absent when signal_routing has none). */
  routingRows?: RoutingRowIr[];
  /** G2-5: envelope geometry (absent when the unit declares no axes). */
  axes?: UnitAxesIr;
  /** G3: the project emits the Maintenance_CMD seam. */
  maintenanceSeam?: boolean;
  warnings: string[];
}

/**
 * Build the resolved IR for one unit. `Cur_St` indexes the unit's declared
 * states ordered per the canonical `UNIT_PACKML_STATES` order (G0-9 PackTags
 * rule; G7-1 text lists share this order) — never authoring order.
 */
export function buildUnitSequence(input: UnitBuildInput): UnitSequenceIr {
  const { unitId, unitName, coord, members, modes, safetyGates, maintenanceSeam, conditionedTags } = input;
  // G5-4 final-review: the caller's collision-safe identifier wins; only a
  // caller with no dedup pass falls back to a fresh sclIdent(unitName).
  const unitScl = input.unitScl ?? sclIdent(unitName);
  const warnings: string[] = [];
  const modeIndex = new Map(modes.map((m, i) => [m.mode_id, i]));

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

  // G2-2: resolve the safety-healthy term against the machine safety gates.
  // G2-1: resolve the NOT-#ok override target (aborting → aborted → stopped).
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
    const overrideTargetIndex = (["aborting", "aborted", "stopped"] as const)
      .map((s) => indexByState.get(s))
      .find((i) => i !== undefined);
    if (overrideTargetIndex === undefined) {
      warnings.push(
        `unit ${unitName}: no aborting/aborted/stopped state declared — safety override skipped (EM-level force-to-safe still applies)`,
      );
    }
    safetyHealthy = {
      expr: missing ? "FALSE" : serializeGuard(conditions, (t) => `"${t}"`),
      excludeMaintenance: sh.exclude_maintenance,
      overrideTargetIndex,
      overrideExcludeIndices: (["aborting", "aborted"] as const)
        .map((s) => indexByState.get(s))
        .filter((i): i is number => i !== undefined),
    };
  }

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

  // G2-1: mode manager — expand isModeChangeLegal at compile time per mode.
  let modeManager: UnitModeManagerIr | undefined;
  if (modes.length > 0) {
    modeManager = {
      modes: modes.map((mode, index) => {
        const unitAllowed = states
          .filter((s) => s.allowedModes.length === 0 || s.allowedModes.includes(mode.mode_id))
          .map((s) => s.index);
        const emTerms = members.flatMap((m) => {
          const allowed = m.states
            .filter((s) => !s.allowedModes || s.allowedModes.length === 0 || s.allowedModes.includes(mode.mode_id))
            .map((s) => s.index);
          // every EM state legal → unrestricted, no term
          return allowed.length === m.states.length
            ? []
            : [{ emName: m.emName, stateIndices: allowed }];
        });
        return {
          name: mode.name,
          index,
          unitStateIndices: unitAllowed.length === states.length ? null : unitAllowed,
          emTerms,
        };
      }),
      modeChangeAllowedIndices: states.filter((s) => s.modeChangeAllowed).map((s) => s.index),
      defaultModeIndex: Math.max(0, modes.findIndex((m) => m.is_default)),
    };
  }

  // G2-5: lower the axes to their emission IR. Gate temp names are derived
  // from the registry gate ids — the routing resolver below links to them.
  const gateTemp = (gateId: string): string => `gate_${sclIdent(gateId).toLowerCase()}`;
  let axesIr: UnitAxesIr | undefined;
  if (coord.axes?.length) {
    const params: ConfigParamIr[] = [];
    const lowerParam = (p: { db_member: string; default?: number; retain: boolean; description?: string }) => {
      params.push({ member: p.db_member, retain: p.retain, seed: p.default, description: p.description });
      return p.db_member;
    };
    const gate = (id: string | undefined): AxisGateIr | undefined =>
      id === undefined ? undefined : { gateId: id, temp: gateTemp(id) };
    const linear: LinearAxisIr[] = [];
    const rotary: RotaryAxisIr[] = [];
    for (const a of coord.axes) {
      if (a.kind === "linear") {
        linear.push({
          kind: "linear",
          axisId: a.axis_id,
          ident: sclIdent(a.axis_id).toLowerCase(),
          encoderTag: a.encoder_tag,
          euUnit: a.eu_unit,
          cfg: {
            scale: lowerParam(a.scale),
            length: lowerParam(a.length),
            endMargin: lowerParam(a.end_margin),
            rampZone: lowerParam(a.ramp_zone),
          },
          gates: {
            fwdOk: gate(a.gates.fwd_ok),
            fwdFastOk: gate(a.gates.fwd_fast_ok),
            revOk: gate(a.gates.rev_ok),
            revFastOk: gate(a.gates.rev_fast_ok),
          },
          unconfiguredOpen: a.unconfigured_open,
        });
      } else {
        rotary.push({
          kind: "rotary",
          axisId: a.axis_id,
          ident: sclIdent(a.axis_id).toLowerCase(),
          encoderTag: a.encoder_tag,
          cfg: { countsPerRev: lowerParam(a.counts_per_rev) },
          presetOffset: a.preset_offset,
          homeWindows: a.home_windows.map((w) => ({ center: w.center_deg10, band: w.band_deg10 })),
          atHome: gate(a.gates.at_home),
        });
      }
    }
    axesIr = {
      configDbName: cfgDbName(unitScl),
      statusDbName: statDbName(unitScl),
      params,
      linear,
      rotary,
    };
  }

  // G2-4: resolve routing rows + two-detent suppression.
  let routingRows: RoutingRowIr[] | undefined;
  const rawRows = coord.signal_routing?.routing_rows ?? [];
  if (rawRows.length) {
    // the G0-4 axis gate registry: every gate id any unit axis declares
    const declaredGates = new Set(
      (coord.axes ?? []).flatMap((a) =>
        Object.values(a.gates).filter((g): g is string => typeof g === "string"),
      ),
    );
    const memberByEmId = new Map(members.map((m) => [m.emId, m]));
    const resolveRef = (ref: SignalSourceRef, rowId: string): ResolvedSignalRef | null => {
      switch (ref.kind) {
        case "io_tag":
          // G2-7: conditioned tags read the IO_Cond layer (golden-master parity)
          return conditionedTags?.has(ref.tag)
            ? { kind: "tag", tag: ref.tag, conditioned: true }
            : { kind: "tag", tag: ref.tag };
        case "em_status": {
          const m = memberByEmId.get(ref.equipment_module_id);
          if (!m) {
            warnings.push(
              `unit ${unitName}: routing row ${rowId} reads em_status of unknown EM "${ref.equipment_module_id}" — row skipped`,
            );
            return null;
          }
          return { kind: "emStatus", emName: m.emName, member: ref.member };
        }
        case "named_gate": {
          // G2-5: declared axis gates are computed live into VAR_TEMPs.
          if (declaredGates.has(ref.gate_id)) {
            return { kind: "gateTemp", gateId: ref.gate_id, temp: gateTemp(ref.gate_id) };
          }
          warnings.push(
            `unit ${unitName}: routing row ${rowId} gate "${ref.gate_id}" not declared by any unit axis — held FALSE (fail-safe)`,
          );
          return { kind: "gatePending", gateId: ref.gate_id, declared: false };
        }
      }
    };

    const resolved = new Map<string, RoutingRowIr>();
    for (const row of rawRows) {
      const target = memberByEmId.get(row.target.equipment_module_id);
      if (!target) {
        warnings.push(
          `unit ${unitName}: routing row ${row.row_id} targets unknown EM "${row.target.equipment_module_id}" — row skipped`,
        );
        continue;
      }
      const source = resolveRef(row.source, row.row_id);
      if (!source) continue;
      const gates: ResolvedSignalRef[] = [];
      let bad = false;
      for (const g of row.gates) {
        const r = resolveRef(g, row.row_id);
        if (!r) { bad = true; break; }
        gates.push(r);
      }
      if (bad) continue;
      resolved.set(row.row_id, {
        rowId: row.row_id, emName: target.emName, pin: row.target.pin, source, gates,
      });
    }

    for (const td of coord.signal_routing?.two_detent ?? []) {
      const jog = resolved.get(td.jog_row_id);
      const fast = resolved.get(td.fast_row_id);
      if (!jog || !fast) {
        warnings.push(
          `unit ${unitName}: two_detent pair (${td.jog_row_id}, ${td.fast_row_id}) references a missing/skipped row — suppression not emitted`,
        );
        continue;
      }
      jog.suppressedBy = { source: fast.source, gates: fast.gates, fallback: td.fallback };
    }
    routingRows = [...resolved.values()];
  }

  // G2-3: semantic mode kinds → Cur_Mode index sets for command gating.
  const commandGating =
    modes.length > 0
      ? {
          engineeringModeIndices: modes.flatMap((m, i) => (m.kind === "engineering" ? [i] : [])),
          maintenanceModeIndices: modes.flatMap((m, i) => (m.kind === "maintenance" ? [i] : [])),
        }
      : undefined;

  // G2-3: library-seam members have no command-role contract yet — warn once.
  for (const m of members) {
    if (m.librarySeam) {
      warnings.push(
        `unit ${unitName}: EM ${m.emName} is a matched library FB (${m.librarySeam}) with no command-role pins in its interface contract — unit command routing emitted as TODO`,
      );
    }
  }

  return {
    unitId,
    unitName,
    unitScl,
    members: members.map((m) => ({ emId: m.emId, emName: m.emName, librarySeam: m.librarySeam })),
    states,
    transitions,
    safetyHealthy,
    commandRouting,
    modeManager,
    commandGating,
    routingRows,
    axes: axesIr,
    maintenanceSeam,
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
