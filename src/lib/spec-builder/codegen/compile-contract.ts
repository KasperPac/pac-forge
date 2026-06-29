// src/lib/spec-builder/codegen/compile-contract.ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact, CodegenResult, StubReport } from "./types";
import { sclIdent } from "./sa-builder";
import { buildEmSequence } from "./em-builder";
import { writeEmArtifacts } from "./em-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1 } from "./ob1-writer";

/**
 * Compile a confirmed FDS into deterministic SCL.
 *
 * EM-layer model (supersedes the old flattened per-Unit S/A sequence): each EM
 * owns its own procedural control. An unmatched EM that has a state-machine
 * contract is lowered to the hybrid 5-artifact bundle (EM FB + State UDT + CMD
 * DB + MAP FC + instance DB); its control modules' IO is subsumed by MAP_<EM>,
 * so they are NOT instantiated separately. A matched library EM (or an EM with
 * no contract) keeps the device-layer instance + per-CM wiring. Each Unit emits
 * a UC_<unit> coordination stub (the real coordinator is built in sub-project
 * D). Finally one OB1. Pure: no IO, no AI.
 */
export function compileContract(contract: SpecContractV2, templates: FbTemplate[]): CodegenResult {
  const artifacts: CodegenArtifact[] = [];
  const warnings: string[] = [];
  const stubs: StubReport = { controlModules: [], equipmentModules: [] };
  const deviceCallLines: string[] = [];
  const seenArtifact = new Set<string>();

  const push = (a: CodegenArtifact) => {
    if (seenArtifact.has(a.name)) return;
    seenArtifact.add(a.name);
    artifacts.push(a);
  };

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;

    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      const emRes = instantiateEquipmentModule(em, templates);

      // Unmatched EM with a state-machine contract → generate the hybrid bundle.
      // The EM FB owns sequencing and its CMs' IO (via MAP_<EM>); CMs are not
      // instantiated separately here.
      if (emRes.stub && emContract) {
        const seq = buildEmSequence(em, emContract);
        const { artifacts: emArts, callLines } = writeEmArtifacts(seq);
        emArts.forEach(push);
        deviceCallLines.push(...callLines);
        warnings.push(...seq.warnings);
        continue;
      }

      // Matched library EM (or unmatched-with-no-contract) → device-layer
      // instance + per-CM wiring, unchanged.
      emRes.artifacts.forEach(push);
      deviceCallLines.push(...emRes.callLines);
      warnings.push(...emRes.warnings);
      if (emRes.stub) stubs.equipmentModules.push(emRes.stub);

      for (const cm of em.control_modules) {
        const cmRes = instantiateControlModule(cm, templates);
        cmRes.artifacts.forEach(push);
        deviceCallLines.push(...cmRes.callLines);
        warnings.push(...cmRes.warnings);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
      }
    }

    // Coordination stub replaces the flattened per-Unit sequencer.
    push(unitCoordinationStub(unit.unit_id, unit.unit_name, unit.equipment_modules.map((e) => e.equipment_module_name)));
  }

  // Pass [] units: OB1 must not call per-unit sequencer DBs (they no longer
  // exist). The UC_<unit> stub is uncalled until sub-project D wires it.
  push(writeOb1(deviceCallLines, []));
  return { artifacts, stubs, warnings };
}

/**
 * Minimal Unit coordinator placeholder. EM-owned sequencing supersedes the old
 * per-Unit S/A sequence; the real Unit coordinator (mode arbitration, interlock
 * routing, EM enables — ISA-88 §5.4) is built in sub-project D. Until then emit
 * a typed, parameterless stub so the Unit appears in the block tree.
 */
function unitCoordinationStub(unitId: string, unitName: string, emNames: string[]): CodegenArtifact {
  const name = `UC_${sclIdent(unitName)}`;
  const lines = emNames.length
    ? emNames.map((n) => `   // coordinate ${n}  (mode / enable / interlocks wired in D)`)
    : [`   // no equipment modules`];
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ``,
    `BEGIN`,
    `   // Unit coordination placeholder — D builds the real coordinator (ISA-88 §5.4).`,
    ...lines,
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return {
    name, type: "FC", filename: `${name}.scl`, content,
    dependencies: [], folder: "Program blocks", layer: "unit",
    ownerId: unitId, ownerName: unitName,
  };
}
