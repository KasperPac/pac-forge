import type { CodegenArtifact } from "./types";

const PROGRAM = "Program blocks";

/** A command/mode pin exposed on the EM's command seam. */
export interface CommandSeamPin {
  name: string;
  /** SCL type token, e.g. "Bool" | "Int". */
  scl_type: string;
}

export interface CommandSeam {
  cmdDb: CodegenArtifact;
  /** Param strings for the EM instance call, each reading a pin from the DB. */
  callBindings: string[];
  warnings: string[];
}

/**
 * Build the `<EM>_CMD` DATA_BLOCK (the Unit/HMI command seam) plus the instance-
 * call bindings that read each command pin from it. Shared by the synthesized
 * and matched EM paths so both emit an identical command DB. Status outputs are
 * NOT wired here — they are left for the Unit coordinator. Pure.
 */
export function buildCommandSeam(emSclName: string, pins: CommandSeamPin[]): CommandSeam {
  const dbName = `${emSclName}_CMD`;
  const structLines = pins.map((p) => `      ${p.name} : ${p.scl_type};`);
  const cmdDb: CodegenArtifact = {
    name: dbName,
    type: "DB",
    filename: `${dbName}.db`,
    content: [
      `DATA_BLOCK "${dbName}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `   STRUCT`,
      ...structLines,
      `   END_STRUCT;`,
      `BEGIN`,
      `END_DATA_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [],
    folder: PROGRAM,
    layer: "em",
  };
  const callBindings = pins.map((p) => `${p.name} := "${dbName}".${p.name}`);
  const warnings =
    pins.length === 0 ? [`EM ${emSclName}: library FB exposes no command interface`] : [];
  return { cmdDb, callBindings, warnings };
}
