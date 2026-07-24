import type { SpecContractV2, SignalType } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";
import type {
  DashDevice, DashTag, DashCommand, DashTagType, DashEm, DashEmState, DashEmTransition,
  DashboardModel, DashAlarm, DashSetpoint, DashSimRule,
} from "@/types/commissioning-dashboard";
import { buildEmUiModel } from "@/lib/spec-builder/code-builder-em-ui-model";
import { emDbName } from "@/lib/spec-builder/codegen/naming";
import { sclIdent } from "@/lib/spec-builder/codegen/sa-builder";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";

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
      const ordered = orderStates(info.states, info.transitions);
      const states: DashEmState[] = ordered.map((s, i) => ({ index: i, name: s.name }));
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
        // states are ordered with codegen's orderStates() so index i matches
        // the generated .state CASE selector. Reusing emDbName(sclIdent(name))
        // keeps the tag identical to generated code.
        stateTag: `${emDbName(sclIdent(info.emName))}.state`,
        states,
        transitions,
        commands: [], // EM command pins derived in Plan 2 once the CMD seam is wired
      });
    }
  }
  return { ems, warnings };
}

export interface DashboardBuildInput {
  contract: SpecContractV2;
  compile: CodegenResult;
  project: { name: string; specId: string; revision: number; generatedNote: string };
}

function buildAlarms(contract: SpecContractV2): DashAlarm[] {
  const alarms: DashAlarm[] = [];
  // Faults carry the trigger tag + severity — the primary alarm source.
  for (const f of contract.faults ?? []) {
    if (!f.triggered_by_tag) continue;
    alarms.push({
      tag: f.triggered_by_tag,
      trigger: "hi",
      class: f.severity === "warning" ? "Warning" : "Fault",
      text: f.description || f.fault_code,
    });
  }
  // Alarm rows add anything not already covered by a fault.
  for (const a of contract.alarms ?? []) {
    if (!a.tag) continue;
    if (alarms.some((x) => x.tag === a.tag)) continue;
    alarms.push({ tag: a.tag, trigger: "hi", class: "Fault", text: a.description || a.tag });
  }
  return alarms;
}

function buildSetpoints(_contract: SpecContractV2): DashSetpoint[] {
  // Writable <EM>_CMD sp_* members are surfaced in Plan 2 once the command-DB
  // seam is wired; Plan 1 emits an empty list (Settings renders "no setpoints").
  return [];
}

function buildSimRules(contract: SpecContractV2, devices: DashDevice[]): DashSimRule[] {
  // Deterministic default rule per device that has EXACTLY ONE DO command AND
  // a genuine run/running feedback DI: feedback follows the command after
  // 500 ms. Devices with 0 or ≥2 commands are skipped — with multiple DOs
  // (bidirectional actuators: extend/retract, open/close, fwd/rev) there is
  // no way to tell which command correlates with the matched feedback, and a
  // wrong (backwards) rule is worse than none. Bidirectional pairing is
  // deferred to Plan 2, where the sim engine consumes these rules.
  const rules: DashSimRule[] = [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const dev = byId.get(cm.control_module_id);
        const fbk = cm.io_signals.find(
          (s) => s.signal_type === "DI" && /\b(fbk|feedback|running|run)\b/i.test(s.description || s.tag),
        );
        if (dev && dev.commands.length === 1 && fbk) {
          const cmd = dev.commands[0];
          rules.push({
            deviceId: cm.control_module_id, triggerTag: cmd.tag, triggerValue: true,
            responseTag: fbk.tag, responseValue: true, responseType: "Bool",
            delayMs: 500, faultInjectable: true,
            description: `${cm.control_module_name}: ${fbk.tag} follows ${cmd.tag} after 500 ms`,
          });
        }
      }
    }
  }
  return rules;
}

function unionReadTags(model: Omit<DashboardModel, "readTags" | "warnings">): DashTag[] {
  const seen = new Map<string, DashTag>();
  const add = (t: DashTag) => { if (!seen.has(t.id)) seen.set(t.id, t); };
  for (const d of model.devices) d.signals.forEach(add);
  for (const d of model.devices) d.commands.forEach((c) => add({ id: c.tag, type: c.type, label: c.label }));
  for (const e of model.ems) add({ id: e.stateTag, type: "Int", label: `${e.name} state` });
  for (const a of model.alarms) add({ id: a.tag, type: "Bool", label: a.text });
  for (const s of model.setpoints) add({ id: s.tag, type: s.type, label: s.label });
  return [...seen.values()];
}

export function buildDashboardModel(input: DashboardBuildInput): DashboardModel {
  const { devices, warnings: dw } = buildDevices(input.contract, input.compile);
  const { ems, warnings: ew } = buildEms(input.contract);
  const alarms = buildAlarms(input.contract);
  const setpoints = buildSetpoints(input.contract);
  const simRules = buildSimRules(input.contract, devices);
  const partial = { project: input.project, devices, ems, alarms, setpoints, simRules };
  const readTags = unionReadTags(partial);
  return { ...partial, readTags, warnings: [...dw, ...ew] };
}
