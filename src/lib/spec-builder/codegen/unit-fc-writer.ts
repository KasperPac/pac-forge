// src/lib/spec-builder/codegen/unit-fc-writer.ts
//
// G5-4 — per-unit scaffolding FCs. Process is the unit's brain slot (UC call
// + preserved custom region; ONE brain per unit — never a second sequencer).
// Management is the unit's instance-call slot.
import type { CodegenArtifact } from "./types";
import { unitManagementFcName, unitProcessFcName } from "./naming";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END } from "./custom-region";

interface UnitFcBase { unitScl: string; unitName: string; unitId: string; }

function unitFc(name: string, base: UnitFcBase, content: string, dependencies: string[]): CodegenArtifact {
  return {
    name, type: "FC", filename: `${name}.scl`, content, dependencies,
    folder: base.unitScl, layer: "unit", ownerId: base.unitId, ownerName: base.unitName,
  };
}

export function writeUnitProcessFc(input: UnitFcBase & { ucCallLine: string }): CodegenArtifact {
  const name = unitProcessFcName(input.unitScl);
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   // --- generated: unit brain (${input.unitName}) ---`,
    input.ucCallLine,
    ``,
    `   ${CUSTOM_REGION_BEGIN}`,
    `   // (site/process-specific ties, one-shots, special cases)`,
    `   ${CUSTOM_REGION_END}`,
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return unitFc(name, input, content, []);
}

export function writeUnitManagementFc(input: UnitFcBase & { callLines: string[] }): CodegenArtifact {
  const name = unitManagementFcName(input.unitScl);
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    ...(input.callLines.length ? input.callLines : [`   // (no equipment modules)`]),
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return unitFc(name, input, content, []);
}
