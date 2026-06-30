// src/lib/spec-builder/codegen/compile-contract.ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact, CodegenResult, StubReport } from "./types";
import { sclIdent } from "./sa-builder";
import { buildEmSequence } from "./em-builder";
import { writeEmArtifacts } from "./em-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1 } from "./ob1-writer";
import { checkStateCoverage, normSlug } from "./em-state-coverage";
import { buildCommandSeam, type CommandSeamPin } from "./em-command-seam";
import { buildEmCmLinks, type CmLinkInfo } from "./matched-em-builder";

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

      // Case C: synthesized (unmatched + contract). The generated EM FB owns
      // sequencing and its CMs' IO (via MAP_<EM>); CMs are not instantiated
      // separately here.
      if (emRes.stub && emContract) {
        const seq = buildEmSequence(em, emContract);
        const { artifacts: emArts, callLines } = writeEmArtifacts(seq);
        emArts.forEach(push);
        deviceCallLines.push(...callLines);
        warnings.push(...seq.warnings);
        continue;
      }

      // Case D: stub EM (no template, no contract). Owns its IO directly; no
      // separate CM instantiation (avoids orphan, never-called CM blocks).
      if (emRes.stub) {
        emRes.artifacts.forEach(push);
        deviceCallLines.push(...emRes.callLines);
        stubs.equipmentModules.push(emRes.stub);
        continue;
      }

      // Matched EM (Cases A/B). The EM never touches physical IO; CMs own it.
      const sclName = sclIdent(em.equipment_module_name);

      if (emContract) {
        // Case A: verify the library FB declares every FDS-required state. Gate
        // runs BEFORE CM instantiation so a blocked EM emits no CM blocks either.
        const cov = checkStateCoverage(emContract.states, emRes.contract?.states ?? []);
        if (!cov.ok) {
          const missing = cov.missing.map((s) => s.name).join(", ");
          stubs.equipmentModules.push({
            id: em.equipment_module_id,
            name: em.equipment_module_name,
            reason: `library FB "${emRes.contract?.block_name ?? sclName}" missing states: ${missing}`,
          });
          warnings.push(`EM ${em.equipment_module_name}: BLOCKED — library FB missing states: ${missing}`);
          continue;
        }
        const fdsSafe = emContract.states.find((s) => s.is_safe_state);
        const declSafe = (emRes.contract?.states ?? []).find((s) => s.is_safe);
        if (fdsSafe && declSafe && normSlug(fdsSafe.state_id) !== normSlug(declSafe.slug)) {
          warnings.push(`EM ${em.equipment_module_name}: safe-state mismatch — FDS "${fdsSafe.state_id}" vs FB "${declSafe.slug}"`);
        }
      } else {
        // Case B: matched, but no FDS state machine to verify against.
        warnings.push(`EM ${em.equipment_module_name}: coverage unverifiable — no FDS state machine`);
      }

      // Now instantiate CMs (matched, not blocked): each CM is its own FB and
      // owns all physical IO. Collect link info as we go.
      const cmLinks: CmLinkInfo[] = [];
      const cmCallLines: string[] = [];
      for (const cm of em.control_modules) {
        const cmRes = instantiateControlModule(cm, templates);
        cmRes.artifacts.forEach(push);
        cmCallLines.push(...cmRes.callLines);
        warnings.push(...cmRes.warnings);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
        cmLinks.push({
          instanceDb: cmRes.instanceDb,
          pins: cmRes.contract?.pins ?? [],
          tags: cm.io_signals.map((s) => s.tag),
        });
      }

      emRes.artifacts.forEach(push); // EM instance DB

      const cmdPins: CommandSeamPin[] = (emRes.contract?.pins ?? [])
        .filter((p) => p.role === "cmd" || p.role === "mode")
        .map((p) => ({ name: p.name, scl_type: p.scl_type }));
      const seam = buildCommandSeam(sclName, cmdPins);
      push({ ...seam.cmdDb, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name });
      warnings.push(...seam.warnings);

      const links = buildEmCmLinks(sclName, emRes.instanceDb, emRes.contract?.pins ?? [], cmLinks);
      push({ ...links.linkIn, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name });
      push({ ...links.linkOut, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name });
      warnings.push(...links.warnings);

      // OB1 order: CM calls → LINK_IN (CM status → EM) → EM → LINK_OUT (EM → CM).
      deviceCallLines.push(...cmCallLines);
      deviceCallLines.push(`   "${links.linkIn.name}"();`);
      deviceCallLines.push(`   "${emRes.instanceDb}"(${seam.callBindings.join(", ")});`);
      deviceCallLines.push(`   "${links.linkOut.name}"();`);
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
