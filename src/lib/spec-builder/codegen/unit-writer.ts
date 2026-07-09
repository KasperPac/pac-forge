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

/** Lower one resolved unit state to its Cur_St CASE branch (skeleton). */
function stateBranch(st: UnitStateIr): string[] {
  return [
    `${pad(6)}${st.index}:   // ${st.stateId}`,
    // Placeholder body — command assertion (G2-3) lands here; every CASE branch
    // must carry at least one statement.
    `${pad(9)};`,
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
  const body = ir.states.flatMap(stateBranch);
  const content = [
    `FUNCTION_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR`,
    `      Cur_St : Int;`,
    `      Cur_Mode : Int;`,
    `   END_VAR`,
    ``,
    `BEGIN`,
    `   CASE #Cur_St OF`,
    ...body,
    `   END_CASE;`,
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
