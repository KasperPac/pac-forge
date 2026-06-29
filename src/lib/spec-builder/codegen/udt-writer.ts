import type { SaSequence, CodegenArtifact } from "./types";

const FOLDER = "PLC data types";

/** Emit the per-Unit UDT: parallel S/A bit arrays + sequencer control bits. */
export function writeUdt(seq: SaSequence): CodegenArtifact {
  const name = `UDT_${seq.sclName}`;
  const last = Math.max(0, seq.steps.length - 1);
  const content = [
    `TYPE "${name}"`,
    `VERSION : 0.1`,
    `   STRUCT`,
    `      S : ARRAY[0..${last}] OF BOOL;   // step active`,
    `      A : ARRAY[0..${last}] OF BOOL;   // action active`,
    `      Stop : Bool;`,
    `      Running : Bool;`,
    `      Resume : Bool;`,
    `      Reset : Bool;`,
    `      StartReject : Bool;`,
    `   END_STRUCT;`,
    `END_TYPE`,
    ``,
  ].join("\n");
  return { name, type: "UDT", filename: `${name}.udt`, content, dependencies: [], folder: FOLDER, layer: "unit", ownerId: seq.unitId, ownerName: seq.unitName };
}
