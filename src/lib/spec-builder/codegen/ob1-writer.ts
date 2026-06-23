// src/lib/spec-builder/codegen/ob1-writer.ts
import type { CodegenArtifact } from "./types";

const FOLDER = "Program blocks";

/** Minimal handle on a compiled Unit for the OB1 call tree. */
export interface UnitCallRef {
  sclName: string;
}

/** Emit OB1: device/EM instance calls first, then each Unit's S/A sequencer. */
export function writeOb1(deviceCallLines: string[], units: UnitCallRef[]): CodegenArtifact {
  const unitCalls = units.map((u) => `   "UC_${u.sclName}"(db := "DB_${u.sclName}");`);
  const deps: string[] = [];
  for (const u of units) { deps.push(`UC_${u.sclName}`, `DB_${u.sclName}`); }
  const content = [
    `ORGANIZATION_BLOCK "Main"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   // --- Control / Equipment module instances ---`,
    ...deviceCallLines,
    ``,
    `   // --- Unit sequencers ---`,
    ...unitCalls,
    `END_ORGANIZATION_BLOCK`,
    ``,
  ].join("\n");
  return { name: "Main", type: "OB", filename: "Main.ob", content, dependencies: deps, folder: FOLDER };
}
