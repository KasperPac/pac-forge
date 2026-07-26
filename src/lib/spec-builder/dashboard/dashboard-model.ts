import type { SpecContractV2, SignalType } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";
import type {
  DashDevice, DashTag, DashCommand, DashTagType, DashEm, DashEmState, DashEmTransition,
  DashboardModel, DashAlarm, DashSetpoint, DashSimRule, DashIoPoint, DashSignalRole,
} from "@/types/commissioning-dashboard";
import { PLC_TAG_DATA_TYPE } from "@/lib/spec-builder/codegen/io-tag-table";
import { buildEmUiModel } from "@/lib/spec-builder/code-builder-em-ui-model";
import { emDbName } from "@/lib/spec-builder/codegen/naming";
import { EM_CMD_PINS } from "@/lib/spec-builder/codegen/em-builder";
import { sclIdent } from "@/lib/spec-builder/codegen/sa-builder";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";

/**
 * The PLC tag's data type, taken from the SAME map the tag table is generated
 * from. It must not be re-derived here: the dashboard previously mapped AI/AO
 * to "Real" while `deriveIoTags` created those tags as `Int`, so every analog
 * read failed and displayed "—" on every project.
 * ("internal" signals have no physical tag and are skipped by the callers.)
 */
function dashType(sig: SignalType): DashTagType {
  return (PLC_TAG_DATA_TYPE[sig] ?? "Bool") as DashTagType;
}

/**
 * Classify a signal for the mimic. Faults are taken from the contract's fault
 * and alarm lists — the only authoritative source. Everything else falls back
 * to direction: an output is what you command, a digital input is what tells
 * you it happened, an analog is a value to display.
 *
 * Deliberately reads no device names or project-specific vocabulary, so it
 * behaves the same for a conveyor, a filling station or a stamping cell.
 */
function signalRole(
  sig: { tag: string; signal_type: SignalType },
  faultTags: Set<string>,
): DashSignalRole {
  if (faultTags.has(sig.tag)) return "fault";
  if (sig.signal_type === "DO" || sig.signal_type === "AO") return "command";
  if (sig.signal_type === "DI") return "feedback";
  return "value";
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

  // Fault tags come from the contract's own fault/alarm list — authoritative,
  // and far better than pattern-matching tag text for the mimic's colouring.
  const faultTags = new Set<string>();
  for (const f of contract.faults ?? []) if (f.triggered_by_tag) faultTags.add(f.triggered_by_tag);
  for (const a of contract.alarms ?? []) if (a.tag) faultTags.add(a.tag);

  const devices: DashDevice[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const signals: DashTag[] = [];
        const commands: DashCommand[] = [];
        for (const sig of cm.io_signals) {
          if (sig.signal_type === "internal") continue;
          signals.push({
            id: sig.tag,
            type: dashType(sig.signal_type),
            label: sig.description || sig.tag,
            role: signalRole(sig, faultTags),
          });
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
          unit: unit.unit_name,
          em: em.equipment_module_name,
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
      // The `<EM>_CMD` seam the generated FB reads its commands from. Pins come
      // from EM_CMD_PINS so the dashboard can never write a member the codegen
      // did not emit. `enable` is a level (it must stay asserted); the PackML
      // commands are momentary pulses.
      const cmdDb = `${sclIdent(info.emName)}_CMD`;
      const commands: DashCommand[] = [
        { tag: `${cmdDb}.enable`, type: "Bool", label: "Enable", momentary: false },
        ...EM_CMD_PINS.map((pin) => ({
          tag: `${cmdDb}.${pin}`,
          type: "Bool" as DashTagType,
          label: pin.replace(/^cmd_/, "").replace(/^./, (c) => c.toUpperCase()),
          momentary: true,
        })),
      ];

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
        commands,
      });
    }
  }
  return { ems, warnings };
}

/** Class order on the IO page — inputs before outputs, digital before analog. */
const IO_ORDER = ["DI", "DO", "AI", "AO"];

/**
 * Every wired physical point, for the IO page. Mirrors `deriveIoTags`' notion of
 * "physical": telegram signals ride the drive path and `internal` has no tag, so
 * neither appears. Ordered by class so the page groups without re-sorting.
 */
export function buildIoPoints(contract: SpecContractV2): DashIoPoint[] {
  const points: DashIoPoint[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        for (const sig of cm.io_signals) {
          if (sig.source === "network_telegram") continue;
          if (!IO_ORDER.includes(sig.signal_type)) continue;
          points.push({
            tag: sig.tag,
            signalType: sig.signal_type,
            type: dashType(sig.signal_type),
            address: sig.io_address ?? "",
            label: sig.description || sig.tag,
            deviceName: cm.control_module_name,
          });
        }
      }
    }
  }
  return points.sort(
    (a, b) => IO_ORDER.indexOf(a.signalType) - IO_ORDER.indexOf(b.signalType) || a.tag.localeCompare(b.tag),
  );
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
  for (const p of model.io) add({ id: p.tag, type: p.type, label: p.label });
  for (const d of model.devices) d.signals.forEach(add);
  for (const d of model.devices) d.commands.forEach((c) => add({ id: c.tag, type: c.type, label: c.label }));
  for (const e of model.ems) {
    add({ id: e.stateTag, type: "Int", label: `${e.name} state` });
    // Only the level pins are worth polling — a momentary pulse is never
    // observable at poll rate, so reading it back would just show false.
    for (const c of e.commands) {
      if (!c.momentary) add({ id: c.tag, type: c.type, label: `${e.name} ${c.label}` });
    }
  }
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
  const io = buildIoPoints(input.contract);
  const partial = { project: input.project, devices, io, ems, alarms, setpoints, simRules };
  const readTags = unionReadTags(partial);
  return { ...partial, readTags, warnings: [...dw, ...ew] };
}
