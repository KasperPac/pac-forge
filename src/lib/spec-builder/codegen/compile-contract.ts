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
import { buildUnitSequence, type UnitMemberEm } from "./unit-builder";
import { writeUnitArtifacts } from "./unit-writer";
import { writeMaintenanceArtifacts, type PresetChannelInput } from "./maintenance-writer";

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

  // G3: the maintenance layer is project-level. Decide seam existence up
  // front (the unit writers wire #ok / i_Seq_Test against it); preset EM
  // interlocks are resolved per unit as members become known.
  const overridableOutputs = contract.maintenance?.overridable_outputs ?? [];
  const presetChannels = contract.engineering?.encoder_presets ?? [];
  const presetPlanned = contract.hierarchy.units.some((u) =>
    (contract.unit_coordination?.[u.unit_id]?.axes ?? []).some(
      (a) => a.preset && presetChannels.some((e) => e.unit_id === u.unit_id && e.axis_id === a.axis_id),
    ),
  );
  const maintenanceSeam = overridableOutputs.length > 0 || presetPlanned;
  const presets: PresetChannelInput[] = [];

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;

    // G2-1: member EMs (declaration order) for the real unit coordinator; the
    // UC call is spliced in BEFORE this unit's EM calls (UC writes CMD seams
    // the EMs consume in the same scan).
    const unitMembers: UnitMemberEm[] = [];
    const unitCallStart = deviceCallLines.length;

    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      const emRes = instantiateEquipmentModule(em, templates);

      // Case C: synthesized (unmatched + contract). The generated EM FB owns
      // sequencing and its CMs' IO (via MAP_<EM>); CMs are not instantiated
      // separately here.
      if (emRes.stub && emContract) {
        const seq = buildEmSequence(em, emContract, contract.engineering);
        const { artifacts: emArts, callLines } = writeEmArtifacts(seq);
        emArts.forEach(push);
        deviceCallLines.push(...callLines);
        warnings.push(...seq.warnings);
        // dispatch-order states + FDS allowed_modes drive the unit coordinator
        unitMembers.push({
          emId: em.equipment_module_id,
          emName: seq.sclName,
          states: seq.states.map((s) => ({
            slug: s.stateId,
            index: s.index,
            allowedModes: emContract.states.find((cs) => cs.state_id === s.stateId)?.allowed_modes,
          })),
        });
        continue;
      }

      // Case D: stub EM (no template, no contract). Owns its IO directly; no
      // separate CM instantiation (avoids orphan, never-called CM blocks).
      if (emRes.stub) {
        emRes.artifacts.forEach(push);
        deviceCallLines.push(...emRes.callLines);
        stubs.equipmentModules.push(emRes.stub);
        // no state contract: em_aggregate refs against it render FALSE + warn
        unitMembers.push({ emId: em.equipment_module_id, emName: sclIdent(em.equipment_module_name), states: [] });
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

      // G2-3: matched library EM — no command-role pins in its interface
      // contract yet, so the unit routes commands to it as a marked TODO.
      unitMembers.push({
        emId: em.equipment_module_id,
        emName: sclName,
        states: (emRes.contract?.states ?? []).map((s, i) => ({ slug: s.slug, index: i })),
        librarySeam: emRes.contract?.block_name ?? sclName,
      });
    }

    // G2-1: real coordinator when the FDS carries unit_coordination for this
    // unit; typed stub + warning otherwise (never silently neither).
    const coord = contract.unit_coordination?.[unit.unit_id];

    // G3-3: presettable axes with recorded TR channels, run-interlock resolved
    // against this unit's members (canonical "execute" slug; TODO otherwise).
    for (const axis of coord?.axes ?? []) {
      if (!axis.preset) continue;
      const chan = presetChannels.find((e) => e.unit_id === unit.unit_id && e.axis_id === axis.axis_id);
      if (!chan) {
        warnings.push(
          `unit ${unit.unit_name}: axis ${axis.axis_id} declares an encoder preset but no channels are recorded (engineering.encoder_presets) — sequencer skipped`,
        );
        continue;
      }
      const blockEmId = axis.preset.blocked_while_em_execute;
      const member = blockEmId ? unitMembers.find((m) => m.emId === blockEmId) : undefined;
      const execState = member?.states.find((s) => s.slug === "execute");
      if (blockEmId && !execState) {
        warnings.push(
          `unit ${unit.unit_name}: axis ${axis.axis_id} preset run-interlock EM "${blockEmId}" has no resolvable execute state — preset armed without an EM guard (TODO emitted)`,
        );
      }
      presets.push({
        axisId: axis.axis_id,
        ident: sclIdent(axis.axis_id).toLowerCase(),
        ctrlAddress: chan.ctrl_address,
        valueAddress: chan.value_address,
        statusAddress: chan.status_address,
        blockedWhileEmExecute:
          member && execState ? { emName: member.emName, executeIndex: execState.index } : undefined,
      });
    }

    if (coord) {
      const ir = buildUnitSequence({
        unitId: unit.unit_id,
        unitName: unit.unit_name,
        coord,
        members: unitMembers,
        modes: contract.modes ?? [],
        safetyGates: contract.safety_gates ?? [],
        maintenanceSeam,
      });
      const { artifacts: unitArts, callLine } = writeUnitArtifacts(ir);
      unitArts.forEach(push);
      warnings.push(...ir.warnings);
      deviceCallLines.splice(unitCallStart, 0, callLine);
    } else {
      warnings.push(
        `unit ${unit.unit_name}: no unit_coordination authored — UC coordination stub emitted`,
      );
      push(unitCoordinationStub(unit.unit_id, unit.unit_name, unit.equipment_modules.map((e) => e.equipment_module_name)));
    }
  }

  // G3: maintenance layer + OB1 ordering — preset FC before the EMs (G5-2),
  // override FC as the FINAL call so its writes win over the MAP FCs (G5-3).
  if (maintenanceSeam) {
    const io = new Map(
      contract.hierarchy.units.flatMap((u) =>
        u.equipment_modules.flatMap((em) =>
          em.control_modules.flatMap((cm) => cm.io_signals.map((s) => [s.tag, s.io_address] as const)),
        ),
      ),
    );
    for (const o of overridableOutputs) {
      if (!io.has(o.tag)) {
        warnings.push(`maintenance: overridable output "${o.tag}" not found among hierarchy IO signals`);
      }
    }
    const maint = writeMaintenanceArtifacts({
      overridableOutputs: overridableOutputs.map((o) => ({
        tag: o.tag,
        address: io.get(o.tag),
        wireCheckOnly: o.wire_check_only,
        description: o.description,
      })),
      presets,
    });
    maint.artifacts.forEach(push);
    if (maint.presetCallLine) deviceCallLines.unshift(maint.presetCallLine);
    if (maint.overrideCallLine) deviceCallLines.push(maint.overrideCallLine);
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
