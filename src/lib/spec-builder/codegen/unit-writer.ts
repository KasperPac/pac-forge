// src/lib/spec-builder/codegen/unit-writer.ts
//
// G2 unit-FB writer — SCL emission from the resolved UnitSequenceIr (mirrors
// em-writer's split and formatting). Lowers a unit coordinator to a UC_<Unit>
// Function Block. Command assertion, safety aggregation, and the mode manager
// land in later G2-1/G2-2/G2-3 cycles.
// Design: Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md
import type { CodegenArtifact } from "./types";
import type {
  AxisGateIr,
  ResolvedSignalRef,
  RoutingRowIr,
  UnitSequenceIr,
  UnitStateIr,
  UnitTransitionIr,
} from "./unit-builder";
import { serializeGuard } from "./serialize-condition";
import { sclIdent } from "./sa-builder";
import { IO_COND_DB, MAINTENANCE_DB, ucFbName, unDbName } from "./naming";

const PROGRAM = "Program blocks";

function pad(n: number): string {
  return " ".repeat(n);
}

const CMD_PIN_BY_COMMAND: Record<string, string> = {
  START: "cmd_start",
  STOP: "cmd_stop",
  HOLD: "cmd_hold",
  RESET: "cmd_reset",
  CLEAR: "cmd_clear",
  ABORT: "cmd_abort",
};
const SEAM_PINS = ["cmd_start", "cmd_stop", "cmd_hold", "cmd_reset", "cmd_clear", "cmd_abort"];

type MemberIr = UnitSequenceIr["members"][number];

/** Level-style anti-latch command writes for one member: the asserted pin
 *  TRUE, every other seam pin FALSE. NONE asserts nothing (all FALSE);
 *  CLEAR/ABORT have no seam pin — all FALSE + TODO (never invented pins).
 *  G2-3: matched library-FB members have no command-role contract yet —
 *  emit a clearly marked TODO instead of inventing pins. */
function memberCommandLines(member: MemberIr, command: string, indent: number): string[] {
  if (member.librarySeam) {
    return [
      `${pad(indent)}// TODO: wire unit command to ${member.emName} (library FB ${member.librarySeam} — no command-role pins in its interface contract yet)`,
    ];
  }
  const asserted = CMD_PIN_BY_COMMAND[command];
  const lines = SEAM_PINS.map(
    (p) => `${pad(indent)}"${member.emName}_CMD".${p} := ${p === asserted ? "TRUE" : "FALSE"};`,
  );
  if (!asserted && command !== "NONE") {
    lines.push(
      `${pad(indent)}// TODO ${command} for ${member.emName}: EM command seam has no ${command.toLowerCase()} pin`,
    );
  }
  return lines;
}

// PackML command-word constants consumed from UN_<Unit>.St_Cmd (G0-9 rule;
// design doc item 4): 1 start … 9 abort.
const ST_CMD_WORD: Record<string, number> = {
  start: 1,
  stop: 2,
  hold: 3,
  unhold: 4,
  suspend: 5,
  unsuspend: 6,
  reset: 7,
  clear: 8,
  abort: 9,
};

/** The full advance expression for one resolved transition: trigger AND guard
 *  AND Cur_Mode mask (empty mask = all modes). */
function advanceExpr(t: UnitTransitionIr): string {
  const terms: string[] = [];
  switch (t.trigger.kind) {
    case "command":
      terms.push(`#cmd = ${ST_CMD_WORD[t.trigger.command] ?? 0}`);
      break;
    case "condition":
      terms.push(serializeGuard(t.trigger.expr, (tag) => `"${tag}"`));
      break;
    case "em_aggregate": {
      if (t.trigger.alwaysFalse) {
        terms.push("FALSE");
      } else if (t.trigger.comparisons.length === 0) {
        terms.push("TRUE");
      } else {
        terms.push(
          t.trigger.comparisons
            .map((c) => `"EM_${c.emName}_DB".state = ${c.stateIndex}`)
            .join(" AND "),
        );
      }
      break;
    }
  }
  if (t.guard.length) terms.push(serializeGuard(t.guard, (tag) => `"${tag}"`));
  if (t.modeMask.length) {
    const mask = t.modeMask.map((i) => `#Cur_Mode = ${i}`).join(" OR ");
    terms.push(t.modeMask.length > 1 ? `(${mask})` : mask);
  }
  return terms.join(" AND ");
}

/** Lower one state's outgoing transitions to its SM CASE branch. */
function smBranch(st: UnitStateIr, ir: UnitSequenceIr): string[] {
  const slugByIndex = new Map(ir.states.map((s) => [s.index, s.stateId]));
  const outgoing = ir.transitions.filter(
    (t) => t.fromIndex === st.index && t.toIndex >= 0,
  );
  const body = outgoing.flatMap((t) => [
    `${pad(9)}IF ${advanceExpr(t)} THEN`,
    `${pad(12)}#Cur_St := ${t.toIndex};   // ${t.transitionId} -> ${slugByIndex.get(t.toIndex)}`,
    `${pad(9)}END_IF;`,
  ]);
  return [
    `${pad(6)}${st.index}:   // ${st.stateId}`,
    ...(body.length ? body : [`${pad(9)};`]),
  ];
}

/** Lower one resolved unit state to its Cur_St CASE branch (G2-2: per-member
 *  command assertion from the canonical map + overrides). */
function stateBranch(st: UnitStateIr, ir: UnitSequenceIr): string[] {
  const memberById = new Map(ir.members.map((m) => [m.emId, m]));
  const body = st.commands.flatMap((c) =>
    memberCommandLines(memberById.get(c.emId) ?? { emId: c.emId, emName: c.emId }, c.command, 9),
  );
  return [
    `${pad(6)}${st.index}:   // ${st.stateId}`,
    ...(body.length ? body : [`${pad(9)};`]),
  ];
}

/** One routing-row signal term. Pending envelope gates render FALSE — motion
 *  stays blocked (fail-safe) until G2-5 emits the computed gate. */
function refExpr(r: ResolvedSignalRef): string {
  switch (r.kind) {
    case "tag":
      // G2-7: conditioned tags read the IO_Cond layer written first in OB1
      return r.conditioned ? `"${IO_COND_DB}".${sclIdent(r.tag)}` : `"${r.tag}"`;
    case "emStatus":
      return `"EM_${r.emName}_DB".${r.member}`;
    case "gateTemp":
      return `#${r.temp}`;
    case "gatePending":
      return "FALSE";
  }
}

/** source AND gates for one row (the golden master's full fast/jog expression). */
function rowExpr(source: ResolvedSignalRef, gates: ResolvedSignalRef[]): string {
  return [refExpr(source), ...gates.map(refExpr)].join(" AND ");
}

/** G2-4: one `"EM_x_DB".pin := ...` routing line. Two-detent jog rows emit the
 *  evidenced suppression pattern: (jog OR fast) AND NOT (<full fast expr>)
 *  AND jogGates — the fast request wins; with fallback, a fast request whose
 *  gates fail still drives the jog pin. */
function routingLine(row: RoutingRowIr): string {
  const pending = [row.source, ...row.gates, ...(row.suppressedBy ? [row.suppressedBy.source, ...row.suppressedBy.gates] : [])]
    .flatMap((r) => (r.kind === "gatePending" ? [r.gateId] : []));
  const todo = pending.length
    ? `   // TODO gate ${[...new Set(pending)].join(", ")} held FALSE pending G2-5`
    : "";
  let expr: string;
  if (row.suppressedBy) {
    const fast = rowExpr(row.suppressedBy.source, row.suppressedBy.gates);
    const src = row.suppressedBy.fallback
      ? `(${refExpr(row.source)} OR ${refExpr(row.suppressedBy.source)})`
      : refExpr(row.source);
    expr = [src, `NOT (${fast})`, ...row.gates.map(refExpr)].join(" AND ");
  } else {
    expr = rowExpr(row.source, row.gates);
  }
  return `   "EM_${row.emName}_DB".${row.pin} := ${expr};${todo}`;
}

/** All declared axis gates (deduped by temp, declaration order). */
function axisGateIrs(ir: UnitSequenceIr): AxisGateIr[] {
  const ax = ir.axes;
  if (!ax) return [];
  const gates = [
    ...ax.linear.flatMap((a) =>
      [a.gates.fwdOk, a.gates.fwdFastOk, a.gates.revOk, a.gates.revFastOk].flatMap((g) =>
        g ? [g] : [],
      ),
    ),
    ...ax.rotary.flatMap((a) => (a.atHome ? [a.atHome] : [])),
  ];
  const seen = new Set<string>();
  return gates.filter((g) => (seen.has(g.temp) ? false : (seen.add(g.temp), true)));
}

/** All gate temps an axes IR declares (deduped, declaration order). */
function axisGateTemps(ir: UnitSequenceIr): string[] {
  return axisGateIrs(ir).map((g) => g.temp);
}

/** G2-5: envelope geometry — encoder scaling + gate computation per axis.
 *  Evidence: UC_Carriage.scl geometry section; formulas generalized, all
 *  constants from CFG_<Unit> members / axis params. */
function axisLines(ir: UnitSequenceIr): string[] {
  const ax = ir.axes;
  if (!ax) return [];
  const db = ax.configDbName;
  const lines: string[] = [];
  for (const a of ax.linear) {
    lines.push(
      ``,
      `   // --- envelope geometry: axis "${a.axisId}" (linear, ${a.euUnit}) ---`,
      `   #pos_${a.ident} := LINT_TO_DINT(DINT_TO_LINT("${a.encoderTag}") * "${db}".${a.cfg.scale} / 10000);   // EU-per-rev x10, encoder 1000 units/rev (G0-4 convention)`,
    );
    const gatePairs: [AxisGateIr | undefined, string][] = [
      [a.gates.fwdOk, `#pos_${a.ident} < ("${db}".${a.cfg.length} - "${db}".${a.cfg.endMargin})`],
      [a.gates.fwdFastOk, `#pos_${a.ident} < ("${db}".${a.cfg.length} - "${db}".${a.cfg.rampZone})`],
      [a.gates.revOk, `#pos_${a.ident} > "${db}".${a.cfg.endMargin}`],
      [a.gates.revFastOk, `#pos_${a.ident} > "${db}".${a.cfg.rampZone}`],
    ];
    const declared = gatePairs.filter((p): p is [AxisGateIr, string] => p[0] !== undefined);
    if (declared.length) {
      const open = a.unconfiguredOpen;
      lines.push(
        `   IF ("${db}".${a.cfg.scale} > 0) AND ("${db}".${a.cfg.length} > 0) THEN`,
        ...declared.map(([g, expr]) => `      #${g.temp} := ${expr};`),
        `   ELSE`,
        `      // unconfigured (scale or length = 0) -> gates ${open ? "open (pre-commissioning policy)" : "closed"}`,
        ...declared.map(([g]) => `      #${g.temp} := ${open ? "TRUE" : "FALSE"};`),
        `   END_IF;`,
      );
    }
  }
  for (const a of ax.rotary) {
    lines.push(
      ``,
      `   // --- envelope geometry: axis "${a.axisId}" (rotary, deg x10) ---`,
      `   IF "${db}".${a.cfg.countsPerRev} > 0 THEN`,
      `      #raw_${a.ident} := DINT_TO_LINT("${a.encoderTag}") - ${a.presetOffset};`,
      `      #deg10_${a.ident} := LINT_TO_DINT(#raw_${a.ident} * 3600 / DINT_TO_LINT("${db}".${a.cfg.countsPerRev}));`,
      `   ELSE`,
      `      #deg10_${a.ident} := "${a.encoderTag}";   // uncalibrated: raw is direct 0.1 deg`,
      `   END_IF;`,
      `   // normalize to -1799..+1800 (tolerates full turns either way)`,
      `   #deg10_${a.ident} := ((#deg10_${a.ident} MOD 3600) + 3600) MOD 3600;`,
      `   IF #deg10_${a.ident} > 1800 THEN`,
      `      #deg10_${a.ident} := #deg10_${a.ident} - 3600;`,
      `   END_IF;`,
    );
    if (a.atHome) {
      // wrapped angular distance to each window center; +5400-c keeps the
      // MOD dividend positive for any deg10 in -1799..+1800
      const windows = a.homeWindows.map(
        (w) => `(ABS(((#deg10_${a.ident} + ${5400 - w.center}) MOD 3600) - 1800) < ${w.band})`,
      );
      lines.push(`   #${a.atHome.temp} := ${windows.join(" OR ")};`);
    }
  }
  return lines;
}

/** G4-2: per-scan envelope status writes into STAT_<Unit> — positions,
 *  configured-gated distances to the soft ends, ramp-zone flag, and one Bool
 *  mirror per declared gate (the HMI's envelope telemetry). */
function statusLines(ir: UnitSequenceIr): string[] {
  const ax = ir.axes;
  if (!ax) return [];
  const db = ax.configDbName;
  const stat = ax.statusDbName;
  const lines: string[] = [``, `   // --- envelope status readbacks (${stat}) ---`];
  for (const a of ax.linear) {
    lines.push(
      `   "${stat}".${a.ident}_position_${a.euUnit} := #pos_${a.ident};`,
      `   IF ("${db}".${a.cfg.scale} > 0) AND ("${db}".${a.cfg.length} > 0) THEN`,
      `      "${stat}".${a.ident}_dist_to_fwd_end_${a.euUnit} := "${db}".${a.cfg.length} - "${db}".${a.cfg.endMargin} - #pos_${a.ident};`,
      `      "${stat}".${a.ident}_dist_to_rev_end_${a.euUnit} := #pos_${a.ident} - "${db}".${a.cfg.endMargin};`,
      `   ELSE`,
      `      "${stat}".${a.ident}_dist_to_fwd_end_${a.euUnit} := 0;`,
      `      "${stat}".${a.ident}_dist_to_rev_end_${a.euUnit} := 0;`,
      `   END_IF;`,
    );
    const fastGates = [a.gates.fwdFastOk, a.gates.revFastOk].flatMap((g) => (g ? [g.temp] : []));
    if (fastGates.length) {
      lines.push(
        `   "${stat}".${a.ident}_in_ramp_zone := ${fastGates.map((t) => `(NOT #${t})`).join(" OR ")};`,
      );
    }
  }
  for (const a of ax.rotary) {
    lines.push(`   "${stat}".${a.ident}_position_deg10 := #deg10_${a.ident};`);
  }
  for (const g of axisGateIrs(ir)) {
    lines.push(`   "${stat}".${sclIdent(g.gateId).toLowerCase()} := #${g.temp};`);
  }
  return lines;
}

/** STAT_<Unit> DB — the envelope readback interface the UC writes (G4-2). */
function writeStatusDb(ir: UnitSequenceIr): CodegenArtifact[] {
  const ax = ir.axes;
  if (!ax) return [];
  const members = [
    ...ax.linear.flatMap((a) => [
      `      ${a.ident}_position_${a.euUnit} : DInt;`,
      `      ${a.ident}_dist_to_fwd_end_${a.euUnit} : DInt;`,
      `      ${a.ident}_dist_to_rev_end_${a.euUnit} : DInt;`,
      ...(a.gates.fwdFastOk || a.gates.revFastOk ? [`      ${a.ident}_in_ramp_zone : Bool;`] : []),
    ]),
    ...ax.rotary.map((a) => `      ${a.ident}_position_deg10 : DInt;`),
    ...axisGateIrs(ir).map((g) => `      ${sclIdent(g.gateId).toLowerCase()} : Bool;`),
  ];
  const content = [
    `DATA_BLOCK "${ax.statusDbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   STRUCT`,
    ...members,
    `   END_STRUCT;`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return [
    {
      name: ax.statusDbName, type: "DB", filename: `${ax.statusDbName}.db`, content,
      dependencies: [], folder: PROGRAM, layer: "unit",
      ownerId: ir.unitId, ownerName: ir.unitName,
    },
  ];
}

/** CFG_<Unit> DB — RETAIN geometry params + seeded defaults (G2-5). Runtime
 *  values live in the PLC; commissioned constants are recorded tier-2. */
function writeConfigDb(ir: UnitSequenceIr): CodegenArtifact[] {
  const ax = ir.axes;
  if (!ax || !ax.params.length) return [];
  const line = (p: (typeof ax.params)[number]) =>
    `      ${p.member} : DInt;${p.description ? `   // ${p.description}` : ""}`;
  const retained = ax.params.filter((p) => p.retain);
  const plain = ax.params.filter((p) => !p.retain);
  const content = [
    `DATA_BLOCK "${ax.configDbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ...(retained.length ? [`   VAR RETAIN`, ...retained.map(line), `   END_VAR`] : []),
    ...(plain.length ? [`   VAR`, ...plain.map(line), `   END_VAR`] : []),
    `BEGIN`,
    ...ax.params.filter((p) => p.seed !== undefined).map((p) => `   ${p.member} := ${p.seed};`),
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return [
    {
      name: ax.configDbName, type: "DB", filename: `${ax.configDbName}.db`, content,
      dependencies: [], folder: PROGRAM, layer: "unit",
      ownerId: ir.unitId, ownerName: ir.unitName,
    },
  ];
}

/** OR-chain over #Cur_St for a set of state indices ("FALSE" when empty). */
function curStIn(indices: number[]): string {
  if (!indices.length) return "FALSE";
  return indices.map((i) => `#Cur_St = ${i}`).join(" OR ");
}

/** G2-1 mode manager: Mode_Change_Legal mirror + Mode_Req grant/clear via the
 *  compile-time legality expansion (design item 3; the TS isModeChangeLegal
 *  helper stays the source of truth — this is its ST equivalent). */
function modeManagerLines(ir: UnitSequenceIr, unName: string): string[] {
  const mm = ir.modeManager;
  if (!mm) return [];
  const branches = mm.modes.flatMap((m) => {
    const terms: string[] = [];
    if (m.unitStateIndices !== null) terms.push(`(${curStIn(m.unitStateIndices)})`);
    for (const t of m.emTerms) {
      terms.push(
        t.stateIndices.length
          ? `(${t.stateIndices.map((i) => `"EM_${t.emName}_DB".state = ${i}`).join(" OR ")})`
          : "FALSE",
      );
    }
    const grant = `#Cur_Mode := ${m.index};`;
    // Mode_Req carries mode index + 1 (0 = no request)
    return terms.length
      ? [
          `${pad(9)}${m.index + 1}:   // ${m.name}`,
          `${pad(12)}IF ${terms.join(" AND ")} THEN`,
          `${pad(15)}${grant}`,
          `${pad(12)}END_IF;`,
        ]
      : [`${pad(9)}${m.index + 1}:   // ${m.name}`, `${pad(12)}${grant}`];
  });
  return [
    ``,
    `   // --- mode manager (Mode_Req = mode index + 1; 0 = none) ---`,
    `   "${unName}".Mode_Change_Legal := ${curStIn(mm.modeChangeAllowedIndices)};`,
    `   IF "${unName}".Mode_Req > 0 THEN`,
    `      IF "${unName}".Mode_Change_Legal THEN`,
    `      CASE "${unName}".Mode_Req OF`,
    ...branches,
    `      END_CASE;`,
    `      END_IF;`,
    `      "${unName}".Mode_Req := 0;   // request always cleared`,
    `   END_IF;`,
  ];
}

/** Instance DB for the UC_<Unit> FB (Cur_St / Cur_Mode / edge memories live in the FB). */
function writeInstanceDb(fbName: string, ir: UnitSequenceIr): CodegenArtifact {
  const name = `${fbName}_DB`;
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `"${fbName}"`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return {
    name, type: "DB", filename: `${name}.db`, content,
    dependencies: [fbName], folder: PROGRAM, layer: "unit",
    ownerId: ir.unitId, ownerName: ir.unitName,
  };
}

/** UN_<Unit> global PackTags DB — the HMI/SCADA machine-data interface (G0-9). */
function writeUnDb(ir: UnitSequenceIr): CodegenArtifact {
  const name = unDbName(sclIdent(ir.unitName));
  const fields = [
    `      Cur_St : Int;`,
    `      Cur_Mode : Int;`,
    `      St_Cmd : Int;`,
    `      Mode_Req : Int;`,
    `      Mode_Change_Legal : Bool;`,
    // EM_St[i] mirrors "EM_<x>_DB".state in member declaration order.
    ...(ir.members.length > 0
      ? [`      EM_St : Array[0..${ir.members.length - 1}] of Int;`]
      : []),
  ];
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   STRUCT`,
    ...fields,
    `   END_STRUCT;`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return {
    name, type: "DB", filename: `${name}.db`, content,
    dependencies: [], folder: PROGRAM, layer: "unit",
    ownerId: ir.unitId, ownerName: ir.unitName,
  };
}

/**
 * Emit the UC_<Unit> coordinator FB, its instance DB, and the UN_<Unit>
 * PackTags DB from the resolved IR, plus the OB1 call line.
 */
export function writeUnitArtifacts(ir: UnitSequenceIr): {
  artifacts: CodegenArtifact[];
  callLine: string;
} {
  const name = ucFbName(sclIdent(ir.unitName));
  const unName = unDbName(sclIdent(ir.unitName));
  const body = ir.states.flatMap((st) => stateBranch(st, ir));

  // G2-2: PackTags mirror (runs every scan, incl. seq-test mode).
  const mirror = [
    `   // --- PackTags mirror (${unName}) ---`,
    `   "${unName}".Cur_St := #Cur_St;`,
    `   "${unName}".Cur_Mode := #Cur_Mode;`,
    ...ir.members.map(
      (m, i) => `   "${unName}".EM_St[${i}] := "EM_${m.emName}_DB".state;`,
    ),
  ];

  // G2-2/G2-3: command-routing release — seq-test input OR any engineering-kind
  // mode (design item 5; the HRE seq_test_mode pattern). Placed AFTER safety
  // aggregation + mode manager + SM so those still run while released; only
  // the command assertion below is skipped.
  const releaseTerms = [
    ...(ir.commandRouting?.seqTestRelease ? ["#i_Seq_Test"] : []),
    ...(ir.commandGating?.engineeringModeIndices ?? []).map((i) => `#Cur_Mode = ${i}`),
  ];
  const seqTest = releaseTerms.length
    ? [
        ``,
        `   IF ${releaseTerms.join(" OR ")} THEN`,
        `      RETURN;   // engineering/seq-test release: command routing handed to the dashboard`,
        `   END_IF;`,
      ]
    : [];

  // G2-2: safety-healthy term + walk-to-Execute/STOP-on-unhealthy policy.
  // G3: the maintenance exclusion joins the term once the seam DB exists.
  const maintExclusion =
    ir.safetyHealthy?.excludeMaintenance && ir.maintenanceSeam
      ? ` AND NOT "${MAINTENANCE_DB}".maintenance_mode`
      : "";
  const okLines = ir.safetyHealthy
    ? [
        ``,
        `   #ok := ${ir.safetyHealthy.expr}${maintExclusion};`,
        ...(ir.safetyHealthy.excludeMaintenance && !ir.maintenanceSeam
          ? [`   // TODO exclude maintenance mode (G3 maintenance DB)`]
          : []),
        // G2-1: structural "safety gate -> aborting" rule (G0-9) — enforced by
        // the writer, never dependent on authored transitions.
        ...(ir.safetyHealthy.overrideTargetIndex !== undefined
          ? [
              `   IF NOT #ok${ir.safetyHealthy.overrideExcludeIndices
                .map((i) => ` AND #Cur_St <> ${i}`)
                .join("")} THEN`,
              `      #Cur_St := ${ir.safetyHealthy.overrideTargetIndex};   // safety gate -> ${
                ir.states.find((s) => s.index === ir.safetyHealthy!.overrideTargetIndex)?.stateId
              }`,
              `   END_IF;`,
            ]
          : []),
      ]
    : [];

  // G2-1: unit state machine — consume+clear St_Cmd, then dispatch the
  // resolved transitions (runs every scan, incl. seq-test mode).
  const smLines = ir.transitions.length
    ? [
        ``,
        `   // --- unit state machine ---`,
        `   #cmd := "${unName}".St_Cmd;`,
        `   "${unName}".St_Cmd := 0;   // consumed each scan`,
        `   CASE #Cur_St OF`,
        ...ir.states.flatMap((st) => smBranch(st, ir)),
        `   END_CASE;`,
      ]
    : [];
  // G2-2/G2-3: STOP-everywhere gate — safety unhealthy OR any maintenance-kind
  // mode (design rule "drives commanded to Stopped", overrides ignored).
  const stopTerms = [
    ...(ir.safetyHealthy ? ["NOT #ok"] : []),
    ...(ir.commandGating?.maintenanceModeIndices ?? []).map((i) => `#Cur_Mode = ${i}`),
  ];
  const stopAll = ir.members.flatMap((m) => memberCommandLines(m, "STOP", 6));
  const commandBlock = stopTerms.length
    ? [
        ``,
        `   IF ${stopTerms.join(" OR ")} THEN`,
        `      // safety unhealthy / maintenance -> STOP everywhere (policy: walk_to_execute_stop_on_unhealthy)`,
        ...stopAll,
        `   ELSE`,
        `   CASE #Cur_St OF`,
        ...body,
        `   END_CASE;`,
        `   END_IF;`,
      ]
    : [``, `   CASE #Cur_St OF`, ...body, `   END_CASE;`];

  const content = [
    `FUNCTION_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ...(ir.commandRouting?.seqTestRelease
      ? [
          `   VAR_INPUT`,
          `      i_Seq_Test : Bool;${ir.maintenanceSeam ? `   // wired from "${MAINTENANCE_DB}".seq_test_mode in OB1` : `   // TODO wire from the maintenance seam (G3)`}`,
          `   END_VAR`,
        ]
      : []),
    `   VAR`,
    `      Cur_St : Int;`,
    `      Cur_Mode : Int${
      ir.modeManager && ir.modeManager.defaultModeIndex > 0
        ? ` := ${ir.modeManager.defaultModeIndex}`
        : ""
    };`,
    ...(ir.safetyHealthy ? [`      ok : Bool;`] : []),
    `   END_VAR`,
    ...(() => {
      const temps = [
        ...(ir.transitions.length ? [`      cmd : Int;`] : []),
        ...(ir.axes?.linear ?? []).map((a) => `      pos_${a.ident} : DInt;`),
        ...(ir.axes?.rotary ?? []).flatMap((a) => [
          `      raw_${a.ident} : LInt;`,
          `      deg10_${a.ident} : DInt;`,
        ]),
        ...axisGateTemps(ir).map((t) => `      ${t} : Bool;`),
      ];
      return temps.length ? [`   VAR_TEMP`, ...temps, `   END_VAR`] : [];
    })(),
    ``,
    `BEGIN`,
    ...mirror,
    ...axisLines(ir),
    ...statusLines(ir),
    ...okLines,
    ...modeManagerLines(ir, unName),
    ...smLines,
    // G2-4: routing rows run every scan, incl. seq-test (only command routing
    // is released) — matches the golden master's section ordering.
    ...(ir.routingRows?.length
      ? [``, `   // --- signal routing (ilk_) ---`, ...ir.routingRows.map(routingLine)]
      : []),
    ...seqTest,
    ...commandBlock,
    `END_FUNCTION_BLOCK`,
    ``,
  ].join("\n");

  const fb: CodegenArtifact = {
    name,
    type: "FB",
    filename: `${name}.scl`,
    content,
    dependencies: [],
    folder: PROGRAM,
    layer: "unit",
    ownerId: ir.unitId,
    ownerName: ir.unitName,
  };

  return {
    artifacts: [fb, writeInstanceDb(name, ir), writeUnDb(ir), ...writeConfigDb(ir), ...writeStatusDb(ir)],
    callLine:
      ir.commandRouting?.seqTestRelease && ir.maintenanceSeam
        ? `   "${name}_DB"(i_Seq_Test := "${MAINTENANCE_DB}".seq_test_mode);`
        : `   "${name}_DB"();`,
  };
}
