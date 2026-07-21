// src/lib/spec-builder/codegen/unit-writer.ts
//
// G2 unit-FB writer — SCL emission from the resolved UnitSequenceIr (mirrors
// em-writer's split and formatting). Lowers a unit coordinator to a UC_<Unit>
// Function Block. Command assertion, safety aggregation, and the mode manager
// land in later G2-1/G2-2/G2-3 cycles.
// Design: Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md
import type { CodegenArtifact } from "./types";
import type { UnitSequenceIr, UnitStateIr, UnitTransitionIr } from "./unit-builder";
import { serializeGuard } from "./serialize-condition";
import { sclIdent } from "./sa-builder";

const PROGRAM = "Program blocks";

function pad(n: number): string {
  return " ".repeat(n);
}

const CMD_PIN_BY_COMMAND: Record<string, string> = {
  START: "cmd_start",
  STOP: "cmd_stop",
  HOLD: "cmd_hold",
  RESET: "cmd_reset",
};
const SEAM_PINS = ["cmd_start", "cmd_stop", "cmd_hold", "cmd_reset"];

/** Level-style anti-latch command writes for one member: the asserted pin
 *  TRUE, every other seam pin FALSE. NONE asserts nothing (all FALSE);
 *  CLEAR/ABORT have no seam pin — all FALSE + TODO (never invented pins). */
function memberCommandLines(emName: string, command: string, indent: number): string[] {
  const asserted = CMD_PIN_BY_COMMAND[command];
  const lines = SEAM_PINS.map(
    (p) => `${pad(indent)}"${emName}_CMD".${p} := ${p === asserted ? "TRUE" : "FALSE"};`,
  );
  if (!asserted && command !== "NONE") {
    lines.push(
      `${pad(indent)}// TODO ${command} for ${emName}: EM command seam has no ${command.toLowerCase()} pin`,
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
  const emNameById = new Map(ir.members.map((m) => [m.emId, m.emName]));
  const body = st.commands.flatMap((c) =>
    memberCommandLines(emNameById.get(c.emId) ?? c.emId, c.command, 9),
  );
  return [
    `${pad(6)}${st.index}:   // ${st.stateId}`,
    ...(body.length ? body : [`${pad(9)};`]),
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
  const name = `UN_${sclIdent(ir.unitName)}`;
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
  const name = `UC_${sclIdent(ir.unitName)}`;
  const unName = `UN_${sclIdent(ir.unitName)}`;
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

  // G2-2: seq-test release — dashboard drives the command pins (G0-3). Placed
  // AFTER safety aggregation + SM so those still run in seq-test mode (design
  // item 5); only the command assertion below is released.
  const seqTest = ir.commandRouting?.seqTestRelease
    ? [
        ``,
        `   IF #i_Seq_Test THEN`,
        `      RETURN;   // seq-test mode: command routing released`,
        `   END_IF;`,
      ]
    : [];

  // G2-2: safety-healthy term + walk-to-Execute/STOP-on-unhealthy policy.
  const okLines = ir.safetyHealthy
    ? [
        ``,
        `   #ok := ${ir.safetyHealthy.expr};`,
        ...(ir.safetyHealthy.excludeMaintenance
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
  const stopAll = ir.members.flatMap((m) => memberCommandLines(m.emName, "STOP", 6));
  const commandBlock = ir.safetyHealthy
    ? [
        ``,
        `   IF NOT #ok THEN`,
        `      // safety unhealthy -> STOP everywhere (policy: walk_to_execute_stop_on_unhealthy)`,
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
          `      i_Seq_Test : Bool;   // TODO wire from the maintenance seam (G3)`,
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
    ...(ir.transitions.length
      ? [`   VAR_TEMP`, `      cmd : Int;`, `   END_VAR`]
      : []),
    ``,
    `BEGIN`,
    ...mirror,
    ...okLines,
    ...modeManagerLines(ir, unName),
    ...smLines,
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
    artifacts: [fb, writeInstanceDb(name, ir), writeUnDb(ir)],
    callLine: `   "${name}_DB"();`,
  };
}
