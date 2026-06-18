/**
 * Structural diff engine for SpecContractV2.
 *
 * Walks the known contract shape and emits typed add/remove/modify buckets
 * per top-level key. Keyed lookups use UUIDs for hierarchy, ids for states/
 * alarms, and (section_type, unit_id, state_id, equipment_module_id) tuples for
 * sections. jsondiffpatch is used only as a deep-detail fallback inside
 * `modified` rows so we don't have to hand-code every leaf field.
 *
 * Output shape is tuned for a reviewer UI: clear "what changed" per domain,
 * not a generic JSON diff. Callers should consume the typed entries rather
 * than the deep-patch blob unless rendering raw details.
 */
import * as jsondiffpatch from "jsondiffpatch";
import type {
  AlarmRow,
  EquipmentModuleContract,
  EquipmentModuleV2,
  ControlModuleV2,
  Hierarchy,
  SpecContractV2,
  SpecSectionRow,
  UnitV2,
} from "@/types/spec-contract-v2";

const differ = jsondiffpatch.create({
  objectHash: (obj: object, index?: number) => {
    const o = obj as Record<string, unknown>;
    return (
      (o?.id as string | undefined) ??
      (o?.control_module_id as string | undefined) ??
      (o?.equipment_module_id as string | undefined) ??
      (o?.unit_id as string | undefined) ??
      (o?.state_id as string | undefined) ??
      (o?.fault_code as string | undefined) ??
      `$$index:${index ?? 0}`
    );
  },
});

// ============================================================
// Result types
// ============================================================

export interface HierarchyDiff {
  unit_added: Array<{ unit: UnitV2 }>;
  unit_removed: Array<{ unit_id: string; unit_name: string }>;
  unit_renamed: Array<{ unit_id: string; before: string; after: string }>;
  equipment_module_added: Array<{ unit_id: string; equipment_module: EquipmentModuleV2 }>;
  equipment_module_removed: Array<{ unit_id: string; equipment_module_id: string; equipment_module_name: string }>;
  equipment_module_renamed: Array<{ unit_id: string; equipment_module_id: string; before: string; after: string }>;
  device_added: Array<{ unit_id: string; equipment_module_id: string; device: ControlModuleV2 }>;
  device_removed: Array<{ unit_id: string; equipment_module_id: string; control_module_id: string; control_module_name: string }>;
  device_modified: Array<{
    unit_id: string;
    equipment_module_id: string;
    control_module_id: string;
    detail: jsondiffpatch.Delta;
  }>;
}

export interface AlarmDiff {
  kind:
    | "added"
    | "removed"
    | "setpoint_changed"
    | "delay_changed"
    | "tier_changed"
    | "action_changed"
    | "description_changed"
    | "link_changed";
  alarm_id: string;
  before?: Partial<AlarmRow>;
  after?: Partial<AlarmRow>;
}

export interface AssemblyDiff {
  kind:
    | "added"
    | "removed"
    | "static_states_changed"
    | "sequential_states_changed";
  equipment_module_id: string;
  detail?: jsondiffpatch.Delta;
}

export interface SectionDiff {
  kind: "added" | "removed" | "modified";
  section_type: string;
  unit_id: string | null;
  equipment_module_id: string | null;
  state_id: string | null;
  detail?: jsondiffpatch.Delta;
}

export interface RevisionDiff {
  hierarchy: HierarchyDiff;
  alarms: AlarmDiff[];
  equipment_modules: AssemblyDiff[];
  sections: SectionDiff[];
}

// ============================================================
// Hierarchy
// ============================================================

function diffHierarchy(before: Hierarchy, after: Hierarchy): HierarchyDiff {
  const out: HierarchyDiff = {
    unit_added: [],
    unit_removed: [],
    unit_renamed: [],
    equipment_module_added: [],
    equipment_module_removed: [],
    equipment_module_renamed: [],
    device_added: [],
    device_removed: [],
    device_modified: [],
  };

  const beforeSubs = new Map(before.units.map((s) => [s.unit_id, s]));
  const afterSubs = new Map(after.units.map((s) => [s.unit_id, s]));

  for (const [id, sub] of afterSubs) {
    if (!beforeSubs.has(id)) out.unit_added.push({ unit: sub });
  }
  for (const [id, sub] of beforeSubs) {
    if (!afterSubs.has(id))
      out.unit_removed.push({ unit_id: id, unit_name: sub.unit_name });
  }

  for (const [id, afterSub] of afterSubs) {
    const beforeSub = beforeSubs.get(id);
    if (!beforeSub) continue;
    if (beforeSub.unit_name !== afterSub.unit_name) {
      out.unit_renamed.push({
        unit_id: id,
        before: beforeSub.unit_name,
        after: afterSub.unit_name,
      });
    }

    const beforeAsm = new Map(beforeSub.equipment_modules.map((a) => [a.equipment_module_id, a]));
    const afterAsm = new Map(afterSub.equipment_modules.map((a) => [a.equipment_module_id, a]));

    for (const [aid, asm] of afterAsm) {
      if (!beforeAsm.has(aid)) out.equipment_module_added.push({ unit_id: id, equipment_module: asm });
    }
    for (const [aid, asm] of beforeAsm) {
      if (!afterAsm.has(aid))
        out.equipment_module_removed.push({
          unit_id: id,
          equipment_module_id: aid,
          equipment_module_name: asm.equipment_module_name,
        });
    }

    for (const [aid, afterAsmRow] of afterAsm) {
      const beforeAsmRow = beforeAsm.get(aid);
      if (!beforeAsmRow) continue;
      if (beforeAsmRow.equipment_module_name !== afterAsmRow.equipment_module_name) {
        out.equipment_module_renamed.push({
          unit_id: id,
          equipment_module_id: aid,
          before: beforeAsmRow.equipment_module_name,
          after: afterAsmRow.equipment_module_name,
        });
      }

      const beforeDev = new Map(beforeAsmRow.control_modules.map((d) => [d.control_module_id, d]));
      const afterDev = new Map(afterAsmRow.control_modules.map((d) => [d.control_module_id, d]));

      for (const [did, dev] of afterDev) {
        if (!beforeDev.has(did))
          out.device_added.push({ unit_id: id, equipment_module_id: aid, device: dev });
      }
      for (const [did, dev] of beforeDev) {
        if (!afterDev.has(did))
          out.device_removed.push({
            unit_id: id,
            equipment_module_id: aid,
            control_module_id: did,
            control_module_name: dev.control_module_name,
          });
      }
      for (const [did, afterDevRow] of afterDev) {
        const beforeDevRow = beforeDev.get(did);
        if (!beforeDevRow) continue;
        const delta = differ.diff(beforeDevRow, afterDevRow);
        if (delta) {
          out.device_modified.push({
            unit_id: id,
            equipment_module_id: aid,
            control_module_id: did,
            detail: delta,
          });
        }
      }
    }
  }

  return out;
}

// ============================================================
// Alarms
// ============================================================

function diffAlarms(before: AlarmRow[], after: AlarmRow[]): AlarmDiff[] {
  const out: AlarmDiff[] = [];
  const beforeMap = new Map(before.map((a) => [a.id, a]));
  const afterMap = new Map(after.map((a) => [a.id, a]));

  for (const [id, a] of afterMap) {
    if (!beforeMap.has(id)) out.push({ kind: "added", alarm_id: id, after: a });
  }
  for (const [id, a] of beforeMap) {
    if (!afterMap.has(id)) out.push({ kind: "removed", alarm_id: id, before: a });
  }
  for (const [id, after_] of afterMap) {
    const before_ = beforeMap.get(id);
    if (!before_) continue;
    if ((before_.setpoint ?? "") !== (after_.setpoint ?? "")) {
      out.push({
        kind: "setpoint_changed",
        alarm_id: id,
        before: { setpoint: before_.setpoint },
        after: { setpoint: after_.setpoint },
      });
    }
    if ((before_.delay ?? "") !== (after_.delay ?? "")) {
      out.push({
        kind: "delay_changed",
        alarm_id: id,
        before: { delay: before_.delay },
        after: { delay: after_.delay },
      });
    }
    if (before_.tier_id !== after_.tier_id) {
      out.push({
        kind: "tier_changed",
        alarm_id: id,
        before: { tier_id: before_.tier_id },
        after: { tier_id: after_.tier_id },
      });
    }
    if (before_.action !== after_.action) {
      out.push({
        kind: "action_changed",
        alarm_id: id,
        before: { action: before_.action },
        after: { action: after_.action },
      });
    }
    if (before_.description !== after_.description) {
      out.push({
        kind: "description_changed",
        alarm_id: id,
        before: { description: before_.description },
        after: { description: after_.description },
      });
    }
    if (
      (before_.control_module_id ?? "") !== (after_.control_module_id ?? "") ||
      (before_.equipment_module_id ?? "") !== (after_.equipment_module_id ?? "") ||
      (before_.unit_id ?? "") !== (after_.unit_id ?? "")
    ) {
      out.push({
        kind: "link_changed",
        alarm_id: id,
        before: {
          control_module_id: before_.control_module_id,
          equipment_module_id: before_.equipment_module_id,
          unit_id: before_.unit_id,
        },
        after: {
          control_module_id: after_.control_module_id,
          equipment_module_id: after_.equipment_module_id,
          unit_id: after_.unit_id,
        },
      });
    }
  }
  return out;
}

// ============================================================
// Assemblies
// ============================================================

function diffAssemblies(
  before: Record<string, EquipmentModuleContract>,
  after: Record<string, EquipmentModuleContract>,
): AssemblyDiff[] {
  const out: AssemblyDiff[] = [];
  const beforeIds = new Set(Object.keys(before));
  const afterIds = new Set(Object.keys(after));

  for (const id of afterIds) {
    if (!beforeIds.has(id)) out.push({ kind: "added", equipment_module_id: id });
  }
  for (const id of beforeIds) {
    if (!afterIds.has(id)) out.push({ kind: "removed", equipment_module_id: id });
  }
  for (const id of afterIds) {
    if (!beforeIds.has(id)) continue;
    const b = before[id];
    const a = after[id];
    const staticDelta = differ.diff(b.static_states, a.static_states);
    if (staticDelta) {
      out.push({ kind: "static_states_changed", equipment_module_id: id, detail: staticDelta });
    }
    const seqDelta = differ.diff(b.sequential_states, a.sequential_states);
    if (seqDelta) {
      out.push({ kind: "sequential_states_changed", equipment_module_id: id, detail: seqDelta });
    }
  }
  return out;
}

// ============================================================
// Sections
// ============================================================

function sectionKey(r: SpecSectionRow): string {
  return [
    r.section_type,
    r.unit_id ?? "-",
    r.equipment_module_id ?? "-",
    r.state_id ?? "-",
  ].join("|");
}

function diffSections(
  before: Record<string, SpecSectionRow[]>,
  after: Record<string, SpecSectionRow[]>,
): SectionDiff[] {
  const beforeFlat: SpecSectionRow[] = [];
  const afterFlat: SpecSectionRow[] = [];
  for (const rows of Object.values(before)) beforeFlat.push(...rows);
  for (const rows of Object.values(after)) afterFlat.push(...rows);

  const beforeMap = new Map(beforeFlat.map((r) => [sectionKey(r), r]));
  const afterMap = new Map(afterFlat.map((r) => [sectionKey(r), r]));

  const out: SectionDiff[] = [];
  for (const [key, row] of afterMap) {
    if (!beforeMap.has(key)) {
      out.push({
        kind: "added",
        section_type: row.section_type,
        unit_id: row.unit_id,
        equipment_module_id: row.equipment_module_id,
        state_id: row.state_id,
      });
    }
  }
  for (const [key, row] of beforeMap) {
    if (!afterMap.has(key)) {
      out.push({
        kind: "removed",
        section_type: row.section_type,
        unit_id: row.unit_id,
        equipment_module_id: row.equipment_module_id,
        state_id: row.state_id,
      });
    }
  }
  for (const [key, afterRow] of afterMap) {
    const beforeRow = beforeMap.get(key);
    if (!beforeRow) continue;
    const delta = differ.diff(beforeRow.content_json, afterRow.content_json);
    if (delta) {
      out.push({
        kind: "modified",
        section_type: afterRow.section_type,
        unit_id: afterRow.unit_id,
        equipment_module_id: afterRow.equipment_module_id,
        state_id: afterRow.state_id,
        detail: delta,
      });
    }
  }
  return out;
}

// ============================================================
// Public entry point
// ============================================================

export function diffContracts(
  before: SpecContractV2,
  after: SpecContractV2,
): RevisionDiff {
  return {
    hierarchy: diffHierarchy(before.hierarchy, after.hierarchy),
    alarms: diffAlarms(before.alarms, after.alarms),
    equipment_modules: diffAssemblies(before.equipment_modules, after.equipment_modules),
    sections: diffSections(before.sections, after.sections),
  };
}
