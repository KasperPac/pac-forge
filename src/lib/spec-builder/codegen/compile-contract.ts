// src/lib/spec-builder/codegen/compile-contract.ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact, CodegenResult, EmMapLines, StubReport } from "./types";
import { sclIdent } from "./sa-builder";
import { buildEmSequence } from "./em-builder";
import { writeEmArtifacts } from "./em-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1 } from "./ob1-writer";
import { writeFcInputs, writeFcMaintenance, writeFcOutputs } from "./layer-fc-writer";
import { writeUnitManagementFc, writeUnitProcessFc } from "./unit-fc-writer";
import { FOLDER_DATA_TYPES, FOLDER_LIBRARY, FOLDER_SYSTEM } from "./naming";
import { checkStateCoverage, normSlug } from "./em-state-coverage";
import { buildCommandSeam, type CommandSeamPin } from "./em-command-seam";
import { buildEmCmLinks, type CmLinkInfo } from "./matched-em-builder";
import { buildUnitSequence, type UnitMemberEm } from "./unit-builder";
import { writeUnitArtifacts } from "./unit-writer";
import { writeMaintenanceArtifacts, type PresetChannelInput } from "./maintenance-writer";
import { writeIoConditioning, type ConditionedSignal } from "./io-conditioning-writer";

/** One unit's resolved assembly: its Process brain call (the UC), its Management
 *  instance-call lines, and identity. Assembled per unit, emitted after the loop
 *  as the per-unit Process/Management FCs (G5-4). */
interface UnitAssembly {
  unitScl: string;
  unitName: string;
  unitId: string;
  /** The unit's single brain call — the UC instance (real) or the UC stub. */
  processCall: string;
  /** EM/CM/link instance calls, in scan order, for the Management FC. */
  managementLines: string[];
}

/**
 * G5-4 folder stamping — a unit-scoped artifact goes under the unit's tree:
 * FBs → `<unitScl>/FB`, DBs → `<unitScl>/DB`, FCs (LINK_IN/LINK_OUT, the UC
 * stub) at the unit root. Shared library bodies and PLC data types keep their
 * one home and are never re-stamped per unit.
 */
const stampUnit = (a: CodegenArtifact, unitScl: string): CodegenArtifact => {
  if (a.folder === FOLDER_LIBRARY || a.folder === FOLDER_DATA_TYPES) return a;
  if (a.type === "FB") return { ...a, folder: `${unitScl}/FB` };
  if (a.type === "DB") return { ...a, folder: `${unitScl}/DB` };
  return { ...a, folder: unitScl }; // FCs (LINK_IN/LINK_OUT, stubs) at unit root
};

/** G5-4: project-level scaffolding lives under 00_System; UDTs stay put. */
const stampSystem = (a: CodegenArtifact): CodegenArtifact =>
  a.folder === FOLDER_DATA_TYPES ? a : { ...a, folder: FOLDER_SYSTEM };

/**
 * Compile a confirmed FDS into deterministic SCL — the Pac Program Structure
 * Standard v1 (G5-4).
 *
 * EM-layer model: each EM owns its own procedural control. An unmatched EM with
 * a state-machine contract is lowered to the hybrid 4-artifact bundle (EM FB +
 * State UDT + CMD DB + instance DB); its IO map is routed into the global
 * FC_Inputs / FC_Outputs layer FCs (not a per-EM MAP FC), and its control
 * modules' IO is subsumed, so they are NOT instantiated separately. A matched
 * library EM (or an EM with no contract) keeps the device-layer instance +
 * per-CM wiring.
 *
 * The program is assembled as a fixed layer skeleton: FC_Inputs (conditioning +
 * input mapping), one FC_<Unit>_Process (the unit brain / UC call) and one
 * FC_<Unit>_Management (EM/CM instance calls) per unit, FC_Outputs (output
 * mapping + drive telegrams) and FC_Maintenance (overrides, structurally last).
 * Main calls the layers in order; the Process layer precedes the Management
 * layer, so a UC's command-seam writes are consumed by its EMs the same scan.
 * Every artifact carries its real folder. Pure: no IO, no AI.
 */
export function compileContract(contract: SpecContractV2, templates: FbTemplate[]): CodegenResult {
  const artifacts: CodegenArtifact[] = [];
  const warnings: string[] = [];
  const stubs: StubReport = { controlModules: [], equipmentModules: [] };
  const emMapLines: EmMapLines[] = [];
  const unitAssemblies: UnitAssembly[] = [];
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
  const fbAssignments = contract.engineering?.fb_assignments ?? [];

  // G1-4b: resolve the conditioned-DI set up front — the unit coordinators
  // (G2-7) and the MAP layer both key off it. Per-signal conditioning
  // OVERRIDES the blanket tier-2 DI debounce.
  const blanketDi = contract.engineering?.io_conditioning_defaults?.di_debounce_ms;
  const conditionedSignals: ConditionedSignal[] = [];
  for (const u of contract.hierarchy.units) {
    if (u.excluded) continue;
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        for (const s of cm.io_signals) {
          if (s.signal_type !== "DI") continue;
          if (s.conditioning) {
            conditionedSignals.push({
              tag: s.tag,
              onDelayMs: s.conditioning.on_delay_ms,
              offDelayMs: s.conditioning.off_delay_ms,
            });
          } else if (blanketDi !== undefined) {
            conditionedSignals.push({ tag: s.tag, onDelayMs: blanketDi, offDelayMs: blanketDi });
          }
        }
      }
    }
  }
  const conditionedTags = new Set(conditionedSignals.map((s) => s.tag));
  const presetPlanned = contract.hierarchy.units.some((u) =>
    (contract.unit_coordination?.[u.unit_id]?.axes ?? []).some(
      (a) => a.preset && presetChannels.some((e) => e.unit_id === u.unit_id && e.axis_id === a.axis_id),
    ),
  );
  const maintenanceSeam = overridableOutputs.length > 0 || presetPlanned;
  const presets: PresetChannelInput[] = [];

  // G5-4 final-review finding 1: two units whose names sanitize to the same
  // SCL identifier (e.g. "Infeed-1" and "Infeed 1" both -> "Infeed_1") would
  // otherwise collide on every unit-scoped artifact name (FC_<U>_Process,
  // FC_<U>_Management, UC_<U>, ...) — the artifact-name dedup guard (`push`)
  // would silently drop the second unit's blocks, and Main would call the
  // survivor's Process FC twice per scan (double-stepping its UC state
  // machine). Suffix numerically instead, mirroring the em-builder setpoint
  // name-collision handling (em-builder.ts).
  const usedUnitScls = new Map<string, string>(); // sclIdent -> claiming unit's raw name
  const resolveUnitScl = (rawName: string): string => {
    const base = sclIdent(rawName);
    const priorName = usedUnitScls.get(base);
    if (priorName === undefined) {
      usedUnitScls.set(base, rawName);
      return base;
    }
    let suffix = 2;
    let candidate = `${base}_${suffix}`;
    while (usedUnitScls.has(candidate)) {
      suffix += 1;
      candidate = `${base}_${suffix}`;
    }
    warnings.push(
      `unit ${rawName}: name collision — "${rawName}" and "${priorName}" both map to SCL identifier "${base}" — renamed to "${candidate}"`,
    );
    usedUnitScls.set(candidate, rawName);
    return candidate;
  };

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;

    const unitScl = resolveUnitScl(unit.unit_name);
    // G2-1: member EMs (declaration order) for the real unit coordinator. The
    // UC call runs in this unit's Process FC BEFORE its Management FC (the EM
    // instances), so the UC's CMD-seam writes are consumed by the EMs the same
    // scan. Management-layer instance calls accumulate here in scan order.
    const unitMembers: UnitMemberEm[] = [];
    const managementLines: string[] = [];

    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      const emRes = instantiateEquipmentModule(em, templates, fbAssignments);

      // Synthesize path (Case C + the G6-2 coverage-fallback): the generated
      // EM FB owns sequencing and its CMs' IO (routed into the FC_Inputs /
      // FC_Outputs layer FCs via emMapLines); CMs are not instantiated
      // separately.
      const synthesizeEm = (contractForEm: NonNullable<typeof emContract>) => {
        const seq = buildEmSequence(em, contractForEm, contract.engineering);
        const { artifacts: emArts, callLines, mapLines } = writeEmArtifacts(seq);
        emArts.forEach((a) => push(stampUnit(a, unitScl)));
        managementLines.push(...callLines);
        emMapLines.push(mapLines);
        warnings.push(...seq.warnings);
        // dispatch-order states + FDS allowed_modes drive the unit coordinator
        unitMembers.push({
          emId: em.equipment_module_id,
          emName: seq.sclName,
          states: seq.states.map((s) => ({
            slug: s.stateId,
            index: s.index,
            allowedModes: contractForEm.states.find((cs) => cs.state_id === s.stateId)?.allowed_modes,
          })),
        });
      };

      // Case C: unmatched + contract.
      if (emRes.stub && emContract) {
        synthesizeEm(emContract);
        continue;
      }

      // Case D: stub EM (no template, no contract). Owns its IO directly; no
      // separate CM instantiation (avoids orphan, never-called CM blocks).
      if (emRes.stub) {
        emRes.artifacts.forEach((a) => push(stampUnit(a, unitScl)));
        managementLines.push(...emRes.callLines);
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
          // G6-2: an AUTO-matched library FB that fails coverage falls back to
          // the synthesized EM (the contract can express what the library
          // can't). Only an explicit fb_assignment stays a hard block — the
          // engineer asked for that template, so the mismatch must surface.
          if (!emRes.forcedByAssignment) {
            warnings.push(
              `EM ${em.equipment_module_name}: auto-matched library FB "${emRes.contract?.block_name ?? sclName}" missing states: ${missing} — falling back to synthesized EM`,
            );
            synthesizeEm(emContract);
            continue;
          }
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
        const cmRes = instantiateControlModule(cm, templates, fbAssignments);
        cmRes.artifacts.forEach((a) => push(stampUnit(a, unitScl)));
        cmCallLines.push(...cmRes.callLines);
        warnings.push(...cmRes.warnings);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
        cmLinks.push({
          instanceDb: cmRes.instanceDb,
          pins: cmRes.contract?.pins ?? [],
          tags: cm.io_signals.map((s) => s.tag),
        });
      }

      emRes.artifacts.forEach((a) => push(stampUnit(a, unitScl))); // EM instance DB

      const cmdPins: CommandSeamPin[] = (emRes.contract?.pins ?? [])
        .filter((p) => p.role === "cmd" || p.role === "mode")
        .map((p) => ({ name: p.name, scl_type: p.scl_type }));
      const seam = buildCommandSeam(sclName, cmdPins);
      push(stampUnit({ ...seam.cmdDb, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name }, unitScl));
      warnings.push(...seam.warnings);

      const links = buildEmCmLinks(sclName, emRes.instanceDb, emRes.contract?.pins ?? [], cmLinks);
      push(stampUnit({ ...links.linkIn, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name }, unitScl));
      push(stampUnit({ ...links.linkOut, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name }, unitScl));
      warnings.push(...links.warnings);

      // Management-FC order: CM calls → LINK_IN (CM status → EM) → EM → LINK_OUT (EM → CM).
      managementLines.push(...cmCallLines);
      managementLines.push(`   "${links.linkIn.name}"();`);
      managementLines.push(`   "${emRes.instanceDb}"(${seam.callBindings.join(", ")});`);
      managementLines.push(`   "${links.linkOut.name}"();`);

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

    let processCall: string;
    if (coord) {
      const ir = buildUnitSequence({
        unitId: unit.unit_id,
        unitName: unit.unit_name,
        unitScl,
        coord,
        members: unitMembers,
        modes: contract.modes ?? [],
        safetyGates: contract.safety_gates ?? [],
        maintenanceSeam,
        conditionedTags,
      });
      const { artifacts: unitArts, callLine } = writeUnitArtifacts(ir);
      unitArts.forEach((a) => push(stampUnit(a, unitScl)));
      warnings.push(...ir.warnings);
      processCall = callLine;
    } else {
      warnings.push(
        `unit ${unit.unit_name}: no unit_coordination authored — UC coordination stub emitted`,
      );
      push(stampUnit(
        unitCoordinationStub(unit.unit_id, unit.unit_name, unitScl, unit.equipment_modules.map((e) => e.equipment_module_name)),
        unitScl,
      ));
      processCall = `   "UC_${unitScl}"();`;
    }

    unitAssemblies.push({ unitScl, unitName: unit.unit_name, unitId: unit.unit_id, processCall, managementLines });
  }

  // G3 maintenance layer (artifacts unchanged; both calls land in FC_Maintenance,
  // which Main runs LAST so the override write wins over the output mapping —
  // G5-3). Preset runs before the override inside FC_Maintenance (G5-2).
  let presetCallLine: string | undefined;
  let overrideCallLine: string | undefined;
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
    maint.artifacts.forEach((a) => push(stampSystem(a)));
    presetCallLine = maint.presetCallLine;
    overrideCallLine = maint.overrideCallLine;
  }

  // G1-4b conditioning layer (artifacts unchanged; its call lands FIRST in
  // FC_Inputs so conditioned reads below it are same-scan fresh).
  const ioCond = writeIoConditioning(conditionedSignals);
  ioCond.artifacts.forEach((a) => push(stampSystem(a)));

  // G5-4 — the fixed layer skeleton + per-unit Process/Management scaffolding.
  // FC_Inputs (conditioning + input map) → per-unit Process (brains) then
  // Management (instances) → FC_Outputs (output map + drives) → FC_Maintenance
  // (overrides last). Main threads them in that order.
  push(writeFcInputs({ ioCondCallLine: ioCond.callLine, ems: emMapLines }));
  for (const u of unitAssemblies) {
    push(writeUnitProcessFc({ unitScl: u.unitScl, unitName: u.unitName, unitId: u.unitId, ucCallLine: u.processCall }));
    push(writeUnitManagementFc({ unitScl: u.unitScl, unitName: u.unitName, unitId: u.unitId, callLines: u.managementLines }));
  }
  push(writeFcOutputs({ ems: emMapLines }));
  push(writeFcMaintenance({ presetCallLine, overrideCallLine }));
  push(writeOb1(unitAssemblies.map((u) => ({ sclName: u.unitScl }))));
  return { artifacts, stubs, warnings };
}

/**
 * Minimal Unit coordinator placeholder. EM-owned sequencing supersedes the old
 * per-Unit S/A sequence; the real Unit coordinator (mode arbitration, interlock
 * routing, EM enables — ISA-88 §5.4) is built in sub-project D. Until then emit
 * a typed, parameterless stub so the Unit appears in the block tree. It IS
 * called — from the unit's Process FC (the brain slot) — so the call tree is
 * complete before D swaps in the real coordinator.
 */
function unitCoordinationStub(unitId: string, unitName: string, unitScl: string, emNames: string[]): CodegenArtifact {
  const name = `UC_${unitScl}`;
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
