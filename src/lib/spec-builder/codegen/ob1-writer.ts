// src/lib/spec-builder/codegen/ob1-writer.ts
//
// G5-4 — Main is a fixed scan-cycle table of contents. It NEVER grows except
// by two lines per unit; all content lives in the layer / unit FCs.
import type { CodegenArtifact } from "./types";
import { FC_INPUTS, FC_MAINTENANCE, FC_OUTPUTS, unitManagementFcName, unitProcessFcName } from "./naming";

/** Minimal handle on a compiled Unit for the OB1 call tree. */
export interface UnitCallRef {
  sclName: string;
}

/** Emit the layer-ordered Main of the Pac Program Structure Standard v1. */
export function writeOb1(units: UnitCallRef[]): CodegenArtifact {
  const processCalls = units.map((u) => `   "${unitProcessFcName(u.sclName)}"();`);
  const managementCalls = units.map((u) => `   "${unitManagementFcName(u.sclName)}"();`);
  const deps = [
    FC_INPUTS, FC_OUTPUTS, FC_MAINTENANCE,
    ...units.flatMap((u) => [unitProcessFcName(u.sclName), unitManagementFcName(u.sclName)]),
  ];
  const content = [
    `ORGANIZATION_BLOCK "Main"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   "${FC_INPUTS}"();   // conditioning + input mapping`,
    ``,
    `   // --- process layer: unit brains decide ---`,
    ...processCalls,
    ``,
    `   // --- management layer: instances execute ---`,
    ...managementCalls,
    ``,
    `   "${FC_OUTPUTS}"();   // output mapping + drive telegrams`,
    `   "${FC_MAINTENANCE}"();   // overrides — always the last call`,
    `END_ORGANIZATION_BLOCK`,
    ``,
  ].join("\n");
  return { name: "Main", type: "OB", filename: "Main.ob", content, dependencies: deps, folder: "Program blocks", layer: "ob1" };
}
