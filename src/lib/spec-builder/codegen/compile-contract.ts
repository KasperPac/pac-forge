// src/lib/spec-builder/codegen/compile-contract.ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact, CodegenResult, StubReport } from "./types";
import { buildUnitSequence } from "./sa-builder";
import { writeUdt } from "./udt-writer";
import { writeSequenceDb } from "./db-writer";
import { writeSequenceFc } from "./fc-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1, type UnitCallRef } from "./ob1-writer";

/**
 * Compile a confirmed FDS into deterministic SCL. Per Unit: derive the S/A
 * sequence from its EM contracts and emit UDT + DB + FC. Across the hierarchy:
 * instantiate each CM/EM library FB (stub on no match) and collect call lines.
 * Finally emit one OB1. Pure: no IO, no AI.
 */
export function compileContract(contract: SpecContractV2, templates: FbTemplate[]): CodegenResult {
  const artifacts: CodegenArtifact[] = [];
  const warnings: string[] = [];
  const stubs: StubReport = { controlModules: [], equipmentModules: [] };
  const deviceCallLines: string[] = [];
  const unitRefs: UnitCallRef[] = [];
  const seenArtifact = new Set<string>();

  const push = (a: CodegenArtifact) => {
    if (seenArtifact.has(a.name)) return;
    seenArtifact.add(a.name);
    artifacts.push(a);
  };

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;

    // --- Per-Unit S/A sequence from this unit's EM contracts ---
    const emContracts = unit.equipment_modules
      .map((em) => contract.equipment_modules[em.equipment_module_id])
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (emContracts.length) {
      const seq = buildUnitSequence(unit.unit_id, unit.unit_name, emContracts, warnings);
      push(writeUdt(seq));
      push(writeSequenceDb(seq));
      push(writeSequenceFc(seq));
      unitRefs.push({ sclName: seq.sclName });
    }

    // --- Instantiate EM-level + CM-level library FBs ---
    for (const em of unit.equipment_modules) {
      const emRes = instantiateEquipmentModule(em, templates);
      emRes.artifacts.forEach(push);
      deviceCallLines.push(...emRes.callLines);
      if (emRes.stub) stubs.equipmentModules.push(emRes.stub);

      for (const cm of em.control_modules) {
        const cmRes = instantiateControlModule(cm, templates);
        cmRes.artifacts.forEach(push);
        deviceCallLines.push(...cmRes.callLines);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
      }
    }
  }

  push(writeOb1(deviceCallLines, unitRefs));
  return { artifacts, stubs, warnings };
}
