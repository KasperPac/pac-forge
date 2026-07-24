import type { SpecContractV2, SignalType } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";
import type { DashDevice, DashTag, DashCommand, DashTagType, DashEm, DashEmState, DashEmTransition } from "@/types/commissioning-dashboard";
import { buildEmUiModel } from "@/lib/spec-builder/code-builder-em-ui-model";
import { emDbName } from "@/lib/spec-builder/codegen/naming";
import { sclIdent } from "@/lib/spec-builder/codegen/sa-builder";

/** DI/DO → Bool; AI/AO → Real. ("internal" signals are skipped in Plan 1.) */
function dashType(sig: SignalType): DashTagType {
  return sig === "AI" || sig === "AO" ? "Real" : "Bool";
}

export function buildDevices(
  contract: SpecContractV2,
  compile: CodegenResult,
): { devices: DashDevice[]; warnings: string[] } {
  const warnings: string[] = [];
  // instance DBs by owning control-module id, from the compile result
  const dbByOwner = new Map<string, string>();
  for (const a of compile.artifacts) {
    if (a.type === "DB" && a.ownerId) dbByOwner.set(a.ownerId, a.name);
  }

  const devices: DashDevice[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const signals: DashTag[] = [];
        const commands: DashCommand[] = [];
        for (const sig of cm.io_signals) {
          if (sig.signal_type === "internal") continue;
          signals.push({ id: sig.tag, type: dashType(sig.signal_type), label: sig.description || sig.tag });
          // Outputs (DO) are operator-drivable as momentary commands.
          if (sig.signal_type === "DO") {
            commands.push({ tag: sig.tag, type: "Bool", label: sig.description || sig.tag, momentary: true });
          }
        }
        if (signals.length === 0) warnings.push(`Device ${cm.control_module_name}: no IO signals — nothing to display`);
        devices.push({
          id: cm.control_module_id,
          name: cm.control_module_name,
          tag: cm.control_module_name, // contract CMs carry no short tag; name doubles as the label
          deviceType: cm.control_module_class,
          instanceDb: dbByOwner.get(cm.control_module_id) ?? null,
          signals,
          commands,
        });
      }
    }
  }
  return { devices, warnings };
}

export function buildEms(contract: SpecContractV2): { ems: DashEm[]; warnings: string[] } {
  const warnings: string[] = [];
  const ui = buildEmUiModel(contract);
  const ems: DashEm[] = [];
  for (const group of ui.unitGroups) {
    for (const emId of group.emIds) {
      const info = ui.emById[emId];
      if (!info) continue;
      const states: DashEmState[] = info.states.map((s, i) => ({ index: i, name: s.name }));
      const nameById = new Map(info.states.map((s) => [s.state_id, s.name]));
      const transitions: DashEmTransition[] = info.transitions.map((t) => ({
        from: nameById.get(t.from_state_id) ?? t.from_state_id,
        to: nameById.get(t.to_state_id) ?? t.to_state_id,
        label: "", // trigger/guard formatting deferred to Plan 2
      }));
      if (states.length === 0) warnings.push(`EM ${info.emName}: no state machine — state view will be empty`);
      ems.push({
        id: emId,
        name: info.emName,
        unit: group.unitName,
        // `.state` value is the CASE-order index; the states array is in that
        // same order, so stateLabel(index) resolves correctly. Reusing
        // emDbName(sclIdent(name)) keeps the tag identical to generated code.
        stateTag: `${emDbName(sclIdent(info.emName))}.state`,
        states,
        transitions,
        commands: [], // EM command pins derived in Plan 2 once the CMD seam is wired
      });
    }
  }
  return { ems, warnings };
}
