/**
 * Structural diff engine for SpecContractV2.
 *
 * Walks the known contract shape and emits typed add/remove/modify buckets
 * per top-level key. Keyed lookups use UUIDs for hierarchy, ids for states/
 * alarms, and (section_type, subsystem_id, state_id, assembly_id) tuples for
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
  AssemblyContract,
  AssemblyV2,
  DeviceV2,
  Hierarchy,
  OperatingStateV2,
  SpecContractV2,
  SpecSectionRow,
  SubsystemV2,
} from "@/types/spec-contract-v2";

const differ = jsondiffpatch.create({
  objectHash: (obj: object, index?: number) => {
    const o = obj as Record<string, unknown>;
    return (
      (o?.id as string | undefined) ??
      (o?.device_id as string | undefined) ??
      (o?.assembly_id as string | undefined) ??
      (o?.subsystem_id as string | undefined) ??
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
  subsystem_added: Array<{ subsystem: SubsystemV2 }>;
  subsystem_removed: Array<{ subsystem_id: string; subsystem_name: string }>;
  subsystem_renamed: Array<{ subsystem_id: string; before: string; after: string }>;
  assembly_added: Array<{ subsystem_id: string; assembly: AssemblyV2 }>;
  assembly_removed: Array<{ subsystem_id: string; assembly_id: string; assembly_name: string }>;
  assembly_renamed: Array<{ subsystem_id: string; assembly_id: string; before: string; after: string }>;
  device_added: Array<{ subsystem_id: string; assembly_id: string; device: DeviceV2 }>;
  device_removed: Array<{ subsystem_id: string; assembly_id: string; device_id: string; device_name: string }>;
  device_modified: Array<{
    subsystem_id: string;
    assembly_id: string;
    device_id: string;
    detail: jsondiffpatch.Delta;
  }>;
}

export interface StateDiff {
  kind: "added" | "removed" | "renamed" | "pattern_changed" | "description_changed";
  state_id: string;
  before?: Partial<OperatingStateV2>;
  after?: Partial<OperatingStateV2>;
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
  assembly_id: string;
  detail?: jsondiffpatch.Delta;
}

export interface SectionDiff {
  kind: "added" | "removed" | "modified";
  section_type: string;
  subsystem_id: string | null;
  assembly_id: string | null;
  state_id: string | null;
  detail?: jsondiffpatch.Delta;
}

export interface RevisionDiff {
  hierarchy: HierarchyDiff;
  states: StateDiff[];
  alarms: AlarmDiff[];
  assemblies: AssemblyDiff[];
  sections: SectionDiff[];
}

// ============================================================
// Hierarchy
// ============================================================

function diffHierarchy(before: Hierarchy, after: Hierarchy): HierarchyDiff {
  const out: HierarchyDiff = {
    subsystem_added: [],
    subsystem_removed: [],
    subsystem_renamed: [],
    assembly_added: [],
    assembly_removed: [],
    assembly_renamed: [],
    device_added: [],
    device_removed: [],
    device_modified: [],
  };

  const beforeSubs = new Map(before.subsystems.map((s) => [s.subsystem_id, s]));
  const afterSubs = new Map(after.subsystems.map((s) => [s.subsystem_id, s]));

  for (const [id, sub] of afterSubs) {
    if (!beforeSubs.has(id)) out.subsystem_added.push({ subsystem: sub });
  }
  for (const [id, sub] of beforeSubs) {
    if (!afterSubs.has(id))
      out.subsystem_removed.push({ subsystem_id: id, subsystem_name: sub.subsystem_name });
  }

  for (const [id, afterSub] of afterSubs) {
    const beforeSub = beforeSubs.get(id);
    if (!beforeSub) continue;
    if (beforeSub.subsystem_name !== afterSub.subsystem_name) {
      out.subsystem_renamed.push({
        subsystem_id: id,
        before: beforeSub.subsystem_name,
        after: afterSub.subsystem_name,
      });
    }

    const beforeAsm = new Map(beforeSub.assemblies.map((a) => [a.assembly_id, a]));
    const afterAsm = new Map(afterSub.assemblies.map((a) => [a.assembly_id, a]));

    for (const [aid, asm] of afterAsm) {
      if (!beforeAsm.has(aid)) out.assembly_added.push({ subsystem_id: id, assembly: asm });
    }
    for (const [aid, asm] of beforeAsm) {
      if (!afterAsm.has(aid))
        out.assembly_removed.push({
          subsystem_id: id,
          assembly_id: aid,
          assembly_name: asm.assembly_name,
        });
    }

    for (const [aid, afterAsmRow] of afterAsm) {
      const beforeAsmRow = beforeAsm.get(aid);
      if (!beforeAsmRow) continue;
      if (beforeAsmRow.assembly_name !== afterAsmRow.assembly_name) {
        out.assembly_renamed.push({
          subsystem_id: id,
          assembly_id: aid,
          before: beforeAsmRow.assembly_name,
          after: afterAsmRow.assembly_name,
        });
      }

      const beforeDev = new Map(beforeAsmRow.devices.map((d) => [d.device_id, d]));
      const afterDev = new Map(afterAsmRow.devices.map((d) => [d.device_id, d]));

      for (const [did, dev] of afterDev) {
        if (!beforeDev.has(did))
          out.device_added.push({ subsystem_id: id, assembly_id: aid, device: dev });
      }
      for (const [did, dev] of beforeDev) {
        if (!afterDev.has(did))
          out.device_removed.push({
            subsystem_id: id,
            assembly_id: aid,
            device_id: did,
            device_name: dev.device_name,
          });
      }
      for (const [did, afterDevRow] of afterDev) {
        const beforeDevRow = beforeDev.get(did);
        if (!beforeDevRow) continue;
        const delta = differ.diff(beforeDevRow, afterDevRow);
        if (delta) {
          out.device_modified.push({
            subsystem_id: id,
            assembly_id: aid,
            device_id: did,
            detail: delta,
          });
        }
      }
    }
  }

  return out;
}

// ============================================================
// States
// ============================================================

function diffStates(before: OperatingStateV2[], after: OperatingStateV2[]): StateDiff[] {
  const out: StateDiff[] = [];
  const beforeMap = new Map(before.map((s) => [s.state_id, s]));
  const afterMap = new Map(after.map((s) => [s.state_id, s]));
  for (const [id, s] of afterMap) {
    if (!beforeMap.has(id)) out.push({ kind: "added", state_id: id, after: s });
  }
  for (const [id, s] of beforeMap) {
    if (!afterMap.has(id)) out.push({ kind: "removed", state_id: id, before: s });
  }
  for (const [id, a] of afterMap) {
    const b = beforeMap.get(id);
    if (!b) continue;
    if (b.state_name !== a.state_name) {
      out.push({ kind: "renamed", state_id: id, before: { state_name: b.state_name }, after: { state_name: a.state_name } });
    }
    if (b.state_pattern !== a.state_pattern) {
      out.push({
        kind: "pattern_changed",
        state_id: id,
        before: { state_pattern: b.state_pattern },
        after: { state_pattern: a.state_pattern },
      });
    }
    if (b.description !== a.description) {
      out.push({
        kind: "description_changed",
        state_id: id,
        before: { description: b.description },
        after: { description: a.description },
      });
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
      (before_.device_id ?? "") !== (after_.device_id ?? "") ||
      (before_.assembly_id ?? "") !== (after_.assembly_id ?? "") ||
      (before_.subsystem_id ?? "") !== (after_.subsystem_id ?? "")
    ) {
      out.push({
        kind: "link_changed",
        alarm_id: id,
        before: {
          device_id: before_.device_id,
          assembly_id: before_.assembly_id,
          subsystem_id: before_.subsystem_id,
        },
        after: {
          device_id: after_.device_id,
          assembly_id: after_.assembly_id,
          subsystem_id: after_.subsystem_id,
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
  before: Record<string, AssemblyContract>,
  after: Record<string, AssemblyContract>,
): AssemblyDiff[] {
  const out: AssemblyDiff[] = [];
  const beforeIds = new Set(Object.keys(before));
  const afterIds = new Set(Object.keys(after));

  for (const id of afterIds) {
    if (!beforeIds.has(id)) out.push({ kind: "added", assembly_id: id });
  }
  for (const id of beforeIds) {
    if (!afterIds.has(id)) out.push({ kind: "removed", assembly_id: id });
  }
  for (const id of afterIds) {
    if (!beforeIds.has(id)) continue;
    const b = before[id];
    const a = after[id];
    const staticDelta = differ.diff(b.static_states, a.static_states);
    if (staticDelta) {
      out.push({ kind: "static_states_changed", assembly_id: id, detail: staticDelta });
    }
    const seqDelta = differ.diff(b.sequential_states, a.sequential_states);
    if (seqDelta) {
      out.push({ kind: "sequential_states_changed", assembly_id: id, detail: seqDelta });
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
    r.subsystem_id ?? "-",
    r.assembly_id ?? "-",
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
        subsystem_id: row.subsystem_id,
        assembly_id: row.assembly_id,
        state_id: row.state_id,
      });
    }
  }
  for (const [key, row] of beforeMap) {
    if (!afterMap.has(key)) {
      out.push({
        kind: "removed",
        section_type: row.section_type,
        subsystem_id: row.subsystem_id,
        assembly_id: row.assembly_id,
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
        subsystem_id: afterRow.subsystem_id,
        assembly_id: afterRow.assembly_id,
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
    states: diffStates(before.states, after.states),
    alarms: diffAlarms(before.alarms, after.alarms),
    assemblies: diffAssemblies(before.assemblies, after.assemblies),
    sections: diffSections(before.sections, after.sections),
  };
}
