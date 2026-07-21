// src/lib/spec-builder/codegen/unit-writer.ts
//
// G2 unit-FB writer — SCL emission from the resolved UnitSequenceIr (mirrors
// em-writer's split and formatting). Lowers a unit coordinator to a UC_<Unit>
// Function Block. Command assertion, safety aggregation, and the mode manager
// land in later G2-1/G2-2/G2-3 cycles.
// Design: Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md
import type { CodegenArtifact } from "./types";
import type { UnitSequenceIr, UnitStateIr } from "./unit-builder";
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

  // G2-2: seq-test release — dashboard drives the command pins (G0-3).
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
    `      Cur_Mode : Int;`,
    ...(ir.safetyHealthy ? [`      ok : Bool;`] : []),
    `   END_VAR`,
    ``,
    `BEGIN`,
    ...mirror,
    ...seqTest,
    ...okLines,
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
