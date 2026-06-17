import type { UnitConfig, ControlModuleConfig, IoSignal, InstrumentTag } from "@/types/spec-builder";
import { extractDevicePrefix } from "@/lib/spec-builder/instrument-parser";

export interface MergeReport {
  matched: number;
  addedUnassigned: number;
  specModulesWithoutIo: string[];
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Spec hierarchy is the skeleton; the register supplies authoritative IO.
 * Deterministic: match each register tag to a spec control module by exact
 * control_module id / existing io-signal tag, else by normalized device prefix.
 * Matched → register io_address + signal_type fill/override that module's signal.
 * Unmatched → an "Unassigned" EM under the tag's unit. Spec-only modules with no
 * register tag are kept and reported.
 */
export function mergeRegisterIntoHierarchy(
  units: UnitConfig[],
  registerTags: InstrumentTag[],
): { units: UnitConfig[]; report: MergeReport } {
  const out = deepClone(units);

  // Index spec control modules by id and by existing io-signal tag.
  interface Ref { cm: ControlModuleConfig; unitName: string; }
  const byId = new Map<string, Ref>();
  const byTag = new Map<string, Ref>();
  const touched = new Set<ControlModuleConfig>();

  for (const u of out) {
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        byId.set(cm.control_module_id.toLowerCase(), { cm, unitName: u.unit_name });
        for (const sig of cm.io_signals) byTag.set(sig.tag.toLowerCase(), { cm, unitName: u.unit_name });
      }
    }
  }

  const report: MergeReport = { matched: 0, addedUnassigned: 0, specModulesWithoutIo: [] };

  const ensureUnassignedEm = (unitName: string): ControlModuleConfig[] => {
    let unit = out.find((u) => u.unit_name === unitName);
    if (!unit) {
      unit = { unit_id: unitName, unit_name: unitName, equipment_type: "Other",
               description: "", excluded: false, equipment_modules: [] };
      out.push(unit);
    }
    let em = unit.equipment_modules.find((e) => e.equipment_module_id === "Unassigned");
    if (!em) {
      em = { equipment_module_id: "Unassigned", equipment_module_name: "Unassigned",
             description: "", control_modules: [] };
      unit.equipment_modules.push(em);
    }
    return em.control_modules;
  };

  const applySignal = (cm: ControlModuleConfig, t: InstrumentTag) => {
    const sig: IoSignal = { tag: t.tag, signal_type: t.signal_type || t.signal_direction,
                            io_address: t.io_address, description: t.description };
    const existing = cm.io_signals.find((s) => s.tag === t.tag);
    if (existing) { existing.io_address = sig.io_address; existing.signal_type = sig.signal_type; }
    else cm.io_signals.push(sig);
    touched.add(cm);
  };

  for (const t of registerTags) {
    let ref = (t.control_module && byId.get(t.control_module.toLowerCase()))
      || byTag.get(t.tag.toLowerCase());
    if (!ref) {
      const prefix = extractDevicePrefix(t.tag, t.unit).toLowerCase();
      ref = byId.get(prefix);
    }
    if (ref) {
      applySignal(ref.cm, t);
      report.matched++;
    } else {
      const cms = ensureUnassignedEm(t.unit || (out[0]?.unit_name ?? "Unassigned"));
      const cmId = t.control_module || extractDevicePrefix(t.tag, t.unit);
      let cm = cms.find((c) => c.control_module_id === cmId);
      if (!cm) {
        cm = { control_module_id: cmId, control_module_name: t.description || cmId,
               control_module_class: t.control_module_class, description: t.description,
               is_safety: t.is_safety, io_signals: [] };
        cms.push(cm);
      }
      applySignal(cm, t);
      report.addedUnassigned++;
    }
  }

  // Spec-only modules that received no register IO at all (no touched signal and
  // no pre-existing addressed signal).
  for (const u of out) {
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        const hasIo = cm.io_signals.some((s) => s.io_address) || touched.has(cm);
        if (!hasIo) report.specModulesWithoutIo.push(cm.control_module_id);
      }
    }
  }

  return { units: out, report };
}
