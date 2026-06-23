import type { SaSequence, CodegenArtifact } from "./types";

const FOLDER = "Program blocks";

/** Emit the per-Unit sequence DB: an instance of the Unit UDT with home steps
 *  initialised TRUE so the sequencer powers up at its safe state(s). */
export function writeSequenceDb(seq: SaSequence): CodegenArtifact {
  const udt = `UDT_${seq.sclName}`;
  const name = `DB_${seq.sclName}`;
  const inits = seq.steps.filter((s) => s.isHome).map((s) => `   S[${s.index}] := true;`);
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `"${udt}"`,
    `BEGIN`,
    ...inits,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [udt], folder: FOLDER, layer: "unit", ownerId: seq.unitId, ownerName: seq.unitName };
}
