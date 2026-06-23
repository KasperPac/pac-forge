import type { SaSequence, SaStep, CodegenArtifact } from "./types";

const FOLDER = "Program blocks";

/** The seal-in assignment for one step, generalised from a linear chain to a
 *  state graph: activate on ANY incoming edge firing, hold while none of the
 *  outgoing (leave) conditions are true. Home steps also activate on Reset. */
function stepLine(s: SaStep): string {
  const activations = s.incoming.map((e) => `(#db.S[${e.fromIndex}] AND (${e.condition}))`);
  if (s.isHome) activations.push("#db.Reset");
  activations.push(`#db.S[${s.index}]`); // seal
  const onTerm = activations.join(" OR ");
  const leave = s.leave.length ? ` AND NOT (${s.leave.join(" OR ")})` : "";
  return `   #db.S[${s.index}] := (${onTerm})${leave};`;
}

/** Aggregate output wiring: a tag commanded active by several steps is driven
 *  by the OR of those steps' action bits. */
function wireLines(seq: SaSequence): string[] {
  const byTag = new Map<string, number[]>();
  for (const s of seq.steps) for (const w of s.wires) {
    const arr = byTag.get(w.tag) ?? [];
    arr.push(s.index);
    byTag.set(w.tag, arr);
  }
  return [...byTag.entries()].map(
    ([tag, idx]) => `   "${tag}" := ${idx.map((i) => `#db.A[${i}]`).join(" OR ")};`,
  );
}

/** Emit the per-Unit sequencer FC (step transitions, action mirror, wiring). */
export function writeSequenceFc(seq: SaSequence): CodegenArtifact {
  const udt = `UDT_${seq.sclName}`;
  const name = `UC_${seq.sclName}`;
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_IN_OUT`,
    `      db : "${udt}";`,
    `   END_VAR`,
    ``,
    `BEGIN`,
    `   // --- Step transitions (sealed-step sequencer) ---`,
    ...seq.steps.map(stepLine),
    ``,
    `   // --- Actions ---`,
    ...seq.steps.map((s) => `   #db.A[${s.index}] := #db.S[${s.index}];`),
    ``,
    `   // --- Action -> output wiring ---`,
    ...wireLines(seq),
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies: [udt], folder: FOLDER, layer: "unit", ownerId: seq.unitId, ownerName: seq.unitName };
}
