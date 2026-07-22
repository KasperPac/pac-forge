// src/lib/spec-builder/hmi/hmi-compiler.ts
//
// G7 — the FDS → HMI derivation layer. Pure and deterministic: every binding
// is derived from the contract via the SAME ordering + naming rules the SCL
// writers use (orderStates / codegen/naming.ts), so the HMI can never
// desynchronize from the generated code. No AI in this path.
// Design: Docs/superpowers/specs/2026-07-22-g7-hmi-compiler-design.md
import {
  UNIT_PACKML_STATES,
  type AlarmTier,
  type IoSignalV2,
  type SpecContractV2,
} from "@/types/spec-contract-v2";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";
import { sclIdent } from "@/lib/spec-builder/codegen/sa-builder";
import { buildEmSequence } from "@/lib/spec-builder/codegen/em-builder";
import { detectDrives } from "@/lib/spec-builder/codegen/drive-detect";
import {
  MAINTENANCE_DB,
  cfgDbName,
  driveDbName,
  emCmdDbName,
  emDbName,
  statDbName,
  unDbName,
} from "@/lib/spec-builder/codegen/naming";
import type {
  HmiAlarmClass,
  HmiDiscreteAlarm,
  HmiIr,
  HmiRole,
  HmiScreen,
  HmiScreenItem,
  HmiSetpointField,
  HmiTag,
  HmiTextList,
} from "./hmi-ir";

/** Display text for a PackML slug: "unholding" → "Unholding". */
function slugText(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** G7-6: tier → class. Generic rule — critical/fault-ish tiers demand
 *  acknowledgement; everything else is a Warning. */
export function alarmClassForTier(tier: AlarmTier): HmiAlarmClass {
  const faultish = /critical|fault/i.test(`${tier.tier_id} ${tier.tier_name}`);
  return faultish
    ? { name: "Fault", acknowledgement: true }
    : { name: "Warning", acknowledgement: false };
}

/** G7-1: one text list per contracted EM (dispatch order == runtime state
 *  value, guaranteed by sharing orderStates with em-builder) plus one per
 *  coordinated unit (canonical UNIT_PACKML_STATES order == Cur_St). */
function buildTextLists(contract: SpecContractV2): HmiTextList[] {
  const lists: HmiTextList[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      if (!emContract) continue; // no state machine → nothing to display
      const scl = sclIdent(em.equipment_module_name);
      lists.push({
        name: `${scl}_States`,
        stateTag: `${emDbName(scl)}.state`,
        entries: orderStates(emContract.states, emContract.transitions).map((s, index) => ({
          index,
          text: s.name || slugText(s.state_id),
        })),
      });
    }
    const coord = contract.unit_coordination?.[unit.unit_id];
    if (coord) {
      const scl = sclIdent(unit.unit_name);
      const ordered = [...coord.states].sort(
        (a, b) =>
          UNIT_PACKML_STATES.indexOf(a.state_id) - UNIT_PACKML_STATES.indexOf(b.state_id),
      );
      lists.push({
        name: `${scl}_States`,
        stateTag: `${unDbName(scl)}.Cur_St`,
        entries: ordered.map((s, index) => ({ index, text: slugText(s.state_id) })),
      });
    }
  }
  return lists;
}

/** Every IO signal in the hierarchy, keyed by tag (polarity lookups). */
function ioByTag(contract: SpecContractV2): Map<string, IoSignalV2> {
  const map = new Map<string, IoSignalV2>();
  for (const u of contract.hierarchy.units)
    for (const em of u.equipment_modules)
      for (const cm of em.control_modules)
        for (const s of cm.io_signals) map.set(s.tag, s);
  return map;
}

/** Tags whose TRUE means "healthy" — any tag a safety gate's healthy
 *  condition compares = true. Alarms on these trigger at 0. */
function healthyTags(contract: SpecContractV2): Set<string> {
  const out = new Set<string>();
  for (const g of contract.safety_gates)
    for (const c of g.condition)
      if (c.operator === "=" && c.value === true) out.add(c.tag);
  return out;
}

/** G7-2: contract alarms → discrete defs + one derived fault per detected
 *  drive (`<SINA DB>.Error`). Trigger polarity respects fail-safe wiring. */
function buildAlarms(contract: SpecContractV2): HmiDiscreteAlarm[] {
  const tiers = new Map(contract.alarm_tiers.map((t) => [t.tier_id, t]));
  const healthy = healthyTags(contract);
  const io = ioByTag(contract);
  const alarms: HmiDiscreteAlarm[] = contract.alarms.map((a) => {
    const tier = tiers.get(a.tier_id);
    const cls = tier ? alarmClassForTier(tier) : { name: "Fault", acknowledgement: true };
    // fail-safe semantics: healthy-signals and N/C wired inputs read TRUE
    // when OK, so their alarm fires on 0
    const inverted = healthy.has(a.tag) || io.get(a.tag)?.polarity === "nc";
    return {
      tag: a.tag,
      triggerValue: inverted ? 0 : 1,
      className: cls.name,
      text: a.description,
    };
  });
  // derived drive faults — same detection the MAP writer uses
  for (const u of contract.hierarchy.units) {
    if (u.excluded) continue;
    for (const em of u.equipment_modules) {
      for (const d of detectDrives(em, contract.engineering)) {
        if (!d.fb_name) continue;
        alarms.push({
          tag: `${driveDbName(d.fb_name, d.sclName)}.Error`,
          triggerValue: 1,
          className: "Fault",
          text: `${d.control_module_name} drive fault — press reset`,
        });
      }
    }
  }
  return alarms;
}

/** G7-3: setpoint fields — EM command-seam sp_ pins (via the same
 *  buildEmSequence the compiler uses) + operator-settable CFG members with
 *  their G0-10 access levels. */
function buildSetpoints(contract: SpecContractV2): HmiSetpointField[] {
  const fields: HmiSetpointField[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      if (!emContract) continue;
      const seq = buildEmSequence(em, emContract, contract.engineering);
      for (const sp of seq.setpointPins) {
        fields.push({
          tag: `${emCmdDbName(seq.sclName)}.${sp}`,
          label: sp.replace(/^sp_/, "").replace(/_/g, " "),
          group: em.equipment_module_name,
        });
      }
    }
    const coord = contract.unit_coordination?.[unit.unit_id];
    for (const axis of coord?.axes ?? []) {
      const params =
        axis.kind === "linear"
          ? [axis.scale, axis.length, axis.end_margin, axis.ramp_zone]
          : [axis.counts_per_rev];
      for (const p of params) {
        if (!p.operator_settable) continue;
        fields.push({
          tag: `${cfgDbName(sclIdent(unit.unit_name))}.${p.db_member}`,
          label: p.description ?? p.db_member.replace(/_/g, " "),
          group: unit.unit_name,
          requiredLevel: p.access?.required_level,
          limits: p.access?.limits,
        });
      }
    }
  }
  return fields;
}

/** G7-4: every binding referenced anywhere, deduped, dots → underscores. */
function buildTags(
  textLists: HmiTextList[],
  alarms: HmiDiscreteAlarm[],
  setpoints: HmiSetpointField[],
  screens: HmiScreen[],
): HmiTag[] {
  const plcTags = [
    ...textLists.map((l) => l.stateTag),
    ...alarms.map((a) => a.tag),
    ...setpoints.map((s) => s.tag),
    ...screens.flatMap((s) =>
      s.items.flatMap((i) => ("tag" in i && i.tag ? [i.tag] : [])),
    ),
  ];
  const seen = new Set<string>();
  const tags: HmiTag[] = [];
  for (const plcTag of plcTags) {
    if (seen.has(plcTag)) continue;
    seen.add(plcTag);
    tags.push({ name: plcTag.replace(/\./g, "_"), plcTag });
  }
  return tags;
}

/** G7-5: Unified roles from the G0-10 ladder (empty = single-user panel). */
function buildRoles(contract: SpecContractV2): HmiRole[] {
  return (contract.authorization?.roles ?? [])
    .map((r) => ({ name: r.name, level: r.level }))
    .sort((a, b) => a.level - b.level);
}

/** Screen access = max of its items' required levels (G0-10 derivation rule). */
function screenLevel(items: HmiScreenItem[]): number | undefined {
  const max = Math.max(
    0,
    ...items.map((i) => ("requiredLevel" in i ? (i.requiredLevel ?? 0) : 0)),
  );
  return max > 0 ? max : undefined;
}

/** G7-8: assemble Overview / Setpoints / Alarms (+ G7-7 Maintenance). */
function buildScreens(
  contract: SpecContractV2,
  textLists: HmiTextList[],
  setpoints: HmiSetpointField[],
): HmiScreen[] {
  const listByTag = new Map(textLists.map((l) => [l.stateTag, l.name]));
  const screens: HmiScreen[] = [];

  // --- Overview ---
  const overview: HmiScreenItem[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    const unitScl = sclIdent(unit.unit_name);
    const unTag = `${unDbName(unitScl)}.Cur_St`;
    if (listByTag.has(unTag)) {
      overview.push({ kind: "state_field", label: unit.unit_name, tag: unTag, textList: listByTag.get(unTag)! });
    }
    for (const em of unit.equipment_modules) {
      const emTag = `${emDbName(sclIdent(em.equipment_module_name))}.state`;
      if (listByTag.has(emTag)) {
        overview.push({
          kind: "state_field", label: em.equipment_module_name, tag: emTag,
          textList: listByTag.get(emTag)!,
        });
      }
    }
    // envelope telemetry (G4-2 STAT mirrors)
    const coord = contract.unit_coordination?.[unit.unit_id];
    const stat = statDbName(unitScl);
    for (const axis of coord?.axes ?? []) {
      const ident = sclIdent(axis.axis_id).toLowerCase();
      if (axis.kind === "linear") {
        overview.push({
          kind: "numeric_field", label: `${axis.axis_id} position`, writable: false,
          tag: `${stat}.${ident}_position_${axis.eu_unit}`, unit: axis.eu_unit,
        });
      } else {
        overview.push({
          kind: "numeric_field", label: `${axis.axis_id} angle (deg ×10)`, writable: false,
          tag: `${stat}.${ident}_position_deg10`, unit: "deg×10",
        });
      }
      for (const gateId of Object.values(axis.gates).filter((g): g is string => typeof g === "string")) {
        overview.push({
          kind: "lamp", label: gateId, onValue: 1,
          tag: `${stat}.${sclIdent(gateId).toLowerCase()}`,
        });
      }
    }
  }
  // safety-chain lamps: healthy-when-TRUE gate tags
  for (const tag of healthyTags(contract)) {
    overview.push({ kind: "lamp", label: tag, tag, onValue: 1 });
  }
  screens.push({ name: "Overview", title: "Overview", items: overview, requiredLevel: screenLevel(overview) });

  // --- Setpoints ---
  if (setpoints.length) {
    const items: HmiScreenItem[] = setpoints.map((s) => ({
      kind: "numeric_field", label: s.label, tag: s.tag, writable: true,
      requiredLevel: s.requiredLevel, limits: s.limits,
    }));
    screens.push({ name: "Setpoints", title: "Setpoints", items, requiredLevel: screenLevel(items) });
  }

  // --- Alarms ---
  screens.push({
    name: "Alarms", title: "Alarms",
    items: [{ kind: "alarm_control", label: "Active + logged alarms" }],
  });

  // --- Maintenance (G7-7) ---
  const outputs = contract.maintenance?.overridable_outputs ?? [];
  const presetChannels = contract.engineering?.encoder_presets ?? [];
  const maint: HmiScreenItem[] = [];
  if (outputs.length || presetChannels.length) {
    maint.push({ kind: "toggle", label: "MAINTENANCE MODE", tag: `${MAINTENANCE_DB}.maintenance_mode` });
    for (const o of outputs) {
      maint.push({
        kind: "toggle", label: o.description ?? o.tag,
        tag: `${MAINTENANCE_DB}.ov_${sclIdent(o.tag)}`,
        requiredLevel: o.access?.required_level,
      });
    }
    for (const unit of contract.hierarchy.units) {
      const coord = contract.unit_coordination?.[unit.unit_id];
      for (const axis of coord?.axes ?? []) {
        if (!axis.preset) continue;
        const chan = presetChannels.find(
          (e) => e.unit_id === unit.unit_id && e.axis_id === axis.axis_id,
        );
        if (!chan) continue; // no channels recorded → no sequencer emitted
        const ident = sclIdent(axis.axis_id).toLowerCase();
        const lvl = axis.preset.access?.required_level;
        maint.push(
          { kind: "numeric_field", label: `${axis.axis_id} preset value`, writable: true, tag: `${MAINTENANCE_DB}.${ident}_preset_value`, requiredLevel: lvl },
          { kind: "button_momentary", label: `${axis.axis_id} PRESET EXECUTE`, tag: `${MAINTENANCE_DB}.${ident}_preset_execute`, requiredLevel: lvl },
          { kind: "lamp", label: `${axis.axis_id} preset done`, tag: `${MAINTENANCE_DB}.${ident}_preset_done`, onValue: 1 },
          { kind: "numeric_field", label: `${axis.axis_id} encoder raw`, writable: false, tag: axis.encoder_tag },
        );
      }
    }
    screens.push({
      name: "Maintenance", title: "Maintenance", items: maint, requiredLevel: screenLevel(maint),
    });
  }

  return screens;
}

/** Build the full HMI IR from a confirmed contract. */
export function buildHmiIr(contract: SpecContractV2): HmiIr {
  const seen = new Set<string>();
  const alarmClasses: HmiAlarmClass[] = [];
  for (const tier of contract.alarm_tiers) {
    const cls = alarmClassForTier(tier);
    if (seen.has(cls.name)) continue;
    seen.add(cls.name);
    alarmClasses.push(cls);
  }
  const textLists = buildTextLists(contract);
  const alarms = buildAlarms(contract);
  const setpoints = buildSetpoints(contract);
  const screens = buildScreens(contract, textLists, setpoints);
  return {
    tags: buildTags(textLists, alarms, setpoints, screens),
    textLists,
    alarmClasses,
    alarms,
    setpoints,
    roles: buildRoles(contract),
    screens,
  };
}
