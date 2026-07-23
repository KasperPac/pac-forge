// src/lib/spec-builder/codegen/layer-fc-writer.ts
//
// G5-4 — the three global scaffolding FCs of the Pac Program Structure
// Standard. FC_Inputs runs conditioning then maps physical inputs into the
// EM instance DBs (same-scan fresh); FC_Outputs maps EM outputs to physical
// tags and runs the drive telegram FBs; FC_Maintenance holds the maintenance
// FCs with the output override structurally last.
import type { CodegenArtifact, EmMapLines } from "./types";
import { FC_INPUTS, FC_OUTPUTS, FC_MAINTENANCE, FOLDER_SYSTEM, emDbName } from "./naming";

const banner = (emName: string): string => `   // --- ${emName} ---`;

function fcShell(name: string, body: string[], tempVars: string[]): string {
  const trimmed = [...body];
  while (trimmed.length && trimmed[trimmed.length - 1] === ``) trimmed.pop();
  return [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ...(tempVars.length ? [`   VAR_TEMP`, ...tempVars, `   END_VAR`, ``] : []),
    `BEGIN`,
    ...(trimmed.length ? trimmed : [`   // (nothing in this project)`]),
    `END_FUNCTION`,
    ``,
  ].join("\n");
}

function systemFc(name: string, content: string, dependencies: string[]): CodegenArtifact {
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies, folder: FOLDER_SYSTEM, layer: "system" };
}

export function writeFcInputs(input: { ioCondCallLine?: string; ems: EmMapLines[] }): CodegenArtifact {
  const body: string[] = [];
  if (input.ioCondCallLine) {
    body.push(`   // conditioning first — conditioned reads below are same-scan fresh`, input.ioCondCallLine, ``);
  }
  for (const em of input.ems) {
    if (!em.inputLines.length) continue;
    body.push(banner(em.emName), ...em.inputLines, ``);
  }
  const deps = input.ems.filter((e) => e.inputLines.length).map((e) => emDbName(e.emName));
  return systemFc(FC_INPUTS, fcShell(FC_INPUTS, body, []), deps);
}

export function writeFcOutputs(input: { ems: EmMapLines[] }): CodegenArtifact {
  const body: string[] = [];
  const tempVars = input.ems.flatMap((e) => e.tempVars);
  for (const em of input.ems) {
    if (!em.outputLines.length) continue;
    body.push(banner(em.emName), ...em.outputLines, ``);
  }
  const deps = input.ems.filter((e) => e.outputLines.length).map((e) => emDbName(e.emName));
  return systemFc(FC_OUTPUTS, fcShell(FC_OUTPUTS, body, tempVars), deps);
}

export function writeFcMaintenance(input: { presetCallLine?: string; overrideCallLine?: string }): CodegenArtifact {
  const body: string[] = [];
  if (input.presetCallLine) body.push(input.presetCallLine);
  if (input.overrideCallLine) body.push(input.overrideCallLine);
  return systemFc(FC_MAINTENANCE, fcShell(FC_MAINTENANCE, body, []), []);
}
