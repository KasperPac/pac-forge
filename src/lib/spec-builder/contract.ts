/**
 * Spec Contract accessor — the ONLY module allowed to read or write spec data
 * post-refactor. A future lint rule will forbid direct `supabase.from(...)` on
 * `spec_sections`, `spec_alarms`, `fds_assembly_sessions`,
 * `fds_subsystem_orchestrations`, or `spec_project_revisions` outside this file.
 *
 * Reader API is shared by builder + forge. Writer API is builder-only — forge
 * must never import those. A runtime `assertBuilderContext()` hook is stubbed;
 * wiring is deferred until the lint rule lands.
 *
 * Dialect: every signal type returned here is canonical IEC (DI/DO/AI/AO/
 * internal). Siemens (DQ/AQ) is produced only at code-emission sites.
 */
import { supabase } from "@/lib/supabase";
import { FLAGS } from "@/lib/feature-flags";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";
import {
  AlarmRowSchema,
  AlarmTierSchema,
  AssemblyContractSchema,
  HierarchySchema,
  IoListEntrySchema,
  OperatingStateV2Schema,
  SpecContractV2Schema,
  SpecSectionRowSchema,
  SubsystemStateSequenceSchema,
  SystemOrchestrationSchema,
  type AlarmRow,
  type AlarmTier,
  type AssemblyContract,
  type AssemblyV2,
  type DeviceStateEntry,
  type DeviceV2,
  type FaultRow,
  type FaultSeverity,
  type Hierarchy,
  type IoListEntry,
  type OperatingStateV2,
  type SequentialStateV2,
  type SpecContractV2,
  type SpecSectionRow,
  type SpecSectionType,
  type SubsystemStateSequence,
  type SubsystemV2,
  type IoSignalV2,
  type SystemOrchestration,
} from "@/types/spec-contract-v2";
import { z } from "zod";

// ============================================================
// Public auxiliary types
// ============================================================

export interface AssemblyStateView {
  assembly_id: string;
  subsystem_id: string;
  state_id: string;
  state_pattern: "static" | "sequential";
  static_states?: DeviceStateEntry[];
  sequential_states?: SequentialStateV2;
}

/**
 * Typed patch for `writeSpecContract`. Full-subtree replace per top-level key.
 * Nested maps (`assemblies`, `orchestrations`) allow per-key replacement.
 */
export interface SpecContractPatch {
  hierarchy?: Hierarchy;
  alarms?: AlarmRow[];
  alarm_tiers?: AlarmTier[];
  assemblies?: Record<string, AssemblyContract>;
  states?: OperatingStateV2[];
  orchestrations?: Record<string, Record<string, SubsystemStateSequence>>;
  system_orchestration?: SystemOrchestration;
  io_list?: IoListEntry[];
  faults?: FaultRow[];
  sections?: Partial<Record<SpecSectionType, SpecSectionRow[]>>;
}

const SpecContractPatchSchema = z.object({
  hierarchy: HierarchySchema.optional(),
  alarms: z.array(AlarmRowSchema).optional(),
  alarm_tiers: z.array(AlarmTierSchema).optional(),
  assemblies: z.record(z.string(), AssemblyContractSchema).optional(),
  states: z.array(OperatingStateV2Schema).optional(),
  orchestrations: z
    .record(z.string(), z.record(z.string(), SubsystemStateSequenceSchema))
    .optional(),
  system_orchestration: SystemOrchestrationSchema.optional(),
  io_list: z.array(IoListEntrySchema).optional(),
  faults: z
    .array(
      z.object({
        fault_code: z.string(),
        description: z.string(),
        triggered_by_tag: z.string(),
        severity: z.enum(["warning", "fault"]),
        affected_devices: z.array(z.string()),
        action_text: z.string(),
      }),
    )
    .optional(),
  sections: z.record(z.string(), z.array(SpecSectionRowSchema)).optional(),
});

/**
 * Thrown by writeSpecContract when the patch violates one or more
 * structural invariants (tag uniqueness, orchestration layering, SFC
 * cross-branch rule, etc). `issues` lists every failure — callers should
 * surface all of them, not just the first.
 */
export class ContractValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `writeSpecContract: ${issues.length} validation issue(s):\n - ${issues.join("\n - ")}`,
    );
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

// ============================================================
// Builder context assertion (stub — real enforcement lands later)
// ============================================================

/**
 * Stub. Real enforcement will inspect the call stack for forge module paths
 * and throw if a forge module imported a writer API. Intentional no-op today
 * — signalling-only, not a security boundary.
 *
 * TODO(wave-later): wire this up alongside the lint rule.
 */
function assertBuilderContext(): void {
  // no-op
}

// ============================================================
// Loaders: atomic rows
// ============================================================

async function fetchProjectRow(specProjectId: string): Promise<
  Record<string, unknown>
> {
  const { data, error } = await supabase
    .from("spec_projects")
    .select("*")
    .eq("id", specProjectId)
    .single();
  if (error) throw new Error(`loadSpecContract: project fetch failed: ${error.message}`);
  if (!data) throw new Error(`loadSpecContract: project ${specProjectId} not found`);
  return data as Record<string, unknown>;
}

async function fetchSectionsRows(specProjectId: string): Promise<
  Record<string, unknown>[]
> {
  const { data, error } = await supabase
    .from("spec_sections")
    .select("*")
    .eq("spec_project_id", specProjectId);
  if (error) throw new Error(`loadSpecContract: sections fetch failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchAssemblySessions(specProjectId: string): Promise<
  Record<string, unknown>[]
> {
  const { data, error } = await supabase
    .from("fds_assembly_sessions")
    .select("*")
    .eq("spec_project_id", specProjectId);
  if (error) throw new Error(`loadSpecContract: assembly sessions fetch failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchSubsystemOrchestrations(specProjectId: string): Promise<
  Record<string, unknown>[]
> {
  const { data, error } = await supabase
    .from("fds_subsystem_orchestrations")
    .select("*")
    .eq("spec_project_id", specProjectId);
  if (error) throw new Error(`loadSpecContract: orchestrations fetch failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchSystemOrchestrationRow(
  specProjectId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("fds_system_orchestrations")
    .select("*")
    .eq("spec_project_id", specProjectId)
    .maybeSingle();
  if (error)
    throw new Error(
      `loadSpecContract: system orchestration fetch failed: ${error.message}`,
    );
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * Public — load the system orchestration row for a project, if any.
 * Returns null when no row exists yet.
 */
export async function loadSystemOrchestration(
  specProjectId: string,
): Promise<SystemOrchestration | null> {
  const row = await fetchSystemOrchestrationRow(specProjectId);
  if (!row) return null;
  return SystemOrchestrationSchema.parse(row);
}

async function fetchAlarmRows(
  specProjectId: string,
  opts?: { deviceId?: string; assemblyId?: string; tierId?: string },
): Promise<Record<string, unknown>[]> {
  let q = supabase.from("spec_alarms").select("*").eq("spec_project_id", specProjectId);
  if (opts?.deviceId) q = q.eq("device_id", opts.deviceId);
  if (opts?.assemblyId) q = q.eq("assembly_id", opts.assemblyId);
  if (opts?.tierId) q = q.eq("tier_id", opts.tierId);
  const { data, error } = await q;
  if (error) throw new Error(`loadAlarms: fetch failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

// ============================================================
// Legacy (schema_version = 1) → V2 in-memory upgrade
// Gated by FLAGS.legacy_shim_enabled. Does NOT persist.
// ============================================================

interface UpgradeContext {
  confirmedStates: OperatingStateV2[];
  /** Map of lowercased state_name → state_id, for legacy state_name matching. */
  stateNameToId: Map<string, string>;
}

function buildUpgradeContext(projectRow: Record<string, unknown>): UpgradeContext {
  const rawStates = (projectRow.confirmed_states ?? []) as Record<string, unknown>[];
  const confirmedStates: OperatingStateV2[] = rawStates.map((s) => ({
    state_id: String(s.state_id ?? ""),
    state_name: String(s.state_name ?? ""),
    description: String(s.description ?? ""),
    state_pattern: ((s.state_pattern as string) === "sequential"
      ? "sequential"
      : "static") as "static" | "sequential",
  }));
  const stateNameToId = new Map<string, string>();
  for (const s of confirmedStates) {
    if (s.state_name) stateNameToId.set(s.state_name.toLowerCase(), s.state_id);
  }
  return { confirmedStates, stateNameToId };
}

/** Resolve a legacy state_name to a canonical state_id. Fallback: verbatim. */
function resolveLegacyStateId(
  stateName: string | null | undefined,
  ctx: UpgradeContext,
): string | null {
  if (!stateName) return null;
  const byName = ctx.stateNameToId.get(stateName.toLowerCase());
  if (byName) return byName;
  // Legacy ST* ids are often used verbatim as both id and name. Accept as-is.
  return stateName;
}

/**
 * Longest-shared-prefix match (min 4 chars). Returns the device_id whose tag
 * shares the longest prefix with the alarm tag, restricted to a single
 * assembly. Below threshold → null.
 */
function bestTagPrefixMatch(
  alarmTag: string,
  devices: DeviceV2[],
): string | null {
  const MIN = 4;
  let bestId: string | null = null;
  let bestLen = 0;
  for (const d of devices) {
    for (const sig of d.io_signals) {
      const shared = sharedPrefixLength(alarmTag, sig.tag);
      if (shared > bestLen && shared >= MIN) {
        bestLen = shared;
        bestId = d.device_id;
      }
    }
  }
  return bestId;
}

function sharedPrefixLength(a: string, b: string): number {
  const lim = Math.min(a.length, b.length);
  let i = 0;
  while (i < lim && a[i] === b[i]) i++;
  return i;
}

/**
 * Build the hierarchy sub-tree from legacy `confirmed_subsystems` + ensure
 * every IoSignal signal_type is canonical IEC.
 */
function buildHierarchyFromLegacy(
  projectRow: Record<string, unknown>,
): Hierarchy {
  const subs = (projectRow.confirmed_subsystems ?? []) as Record<string, unknown>[];
  const subsystems: SubsystemV2[] = subs.map((s) => {
    const assembliesRaw = (s.assemblies ?? []) as Record<string, unknown>[];
    const assemblies: AssemblyV2[] = assembliesRaw.map((a) => {
      const devicesRaw = (a.devices ?? []) as Record<string, unknown>[];
      const devices: DeviceV2[] = devicesRaw.map((d) => {
        const signalsRaw = (d.io_signals ?? []) as Record<string, unknown>[];
        const io_signals: IoSignalV2[] = signalsRaw.map((sig) => ({
          tag: String(sig.tag ?? ""),
          signal_type: convertSignalDirection(String(sig.signal_type ?? "")),
          io_address: String(sig.io_address ?? ""),
          description: String(sig.description ?? ""),
          source: (sig.source as "wired" | "network_telegram") ?? "wired",
          telegram_offset: (sig.telegram_offset as IoSignalV2["telegram_offset"]) ?? undefined,
          direction_overlay:
            (sig.direction_overlay as IoSignalV2["direction_overlay"]) ?? undefined,
        }));
        return {
          device_id: String(d.device_id ?? ""),
          device_name: String(d.device_name ?? ""),
          device_class: String(d.device_class ?? "other"),
          is_safety: Boolean(d.is_safety),
          description: String(d.description ?? ""),
          io_signals,
          network_config: (d.network_config as DeviceV2["network_config"]) ?? undefined,
        };
      });
      return {
        assembly_id: String(a.assembly_id ?? ""),
        assembly_name: String(a.assembly_name ?? ""),
        description: String(a.description ?? ""),
        devices,
      };
    });
    return {
      subsystem_id: String(s.subsystem_id ?? ""),
      subsystem_name: String(s.subsystem_name ?? ""),
      equipment_type: String(s.equipment_type ?? "Other"),
      description: String(s.description ?? ""),
      excluded: Boolean(s.excluded),
      assemblies,
    };
  });
  return { subsystems };
}

/**
 * Upgrade legacy per-assembly session rows into AssemblyContract entries,
 * keyed by assembly_id. Prefers `static_states_v2` (already keyed by
 * state_id); otherwise converts legacy `static_states` (keyed by state_name).
 */
function upgradeAssemblyContracts(
  assemblySessions: Record<string, unknown>[],
  ctx: UpgradeContext,
): Record<string, AssemblyContract> {
  const out: Record<string, AssemblyContract> = {};
  for (const s of assemblySessions) {
    const assembly_id = String(s.assembly_id ?? "");
    const subsystem_id = String(s.subsystem_id ?? "");
    if (!assembly_id) continue;

    let staticStates: Record<string, DeviceStateEntry[]> = {};
    if (s.static_states_v2 && typeof s.static_states_v2 === "object") {
      staticStates = s.static_states_v2 as Record<string, DeviceStateEntry[]>;
    } else if (s.static_states && typeof s.static_states === "object") {
      // Legacy map was keyed by state_name — convert to state_id keys.
      const legacy = s.static_states as Record<string, DeviceStateEntry[]>;
      for (const [key, value] of Object.entries(legacy)) {
        const mapped = resolveLegacyStateId(key, ctx) ?? key;
        staticStates[mapped] = value;
      }
    }

    const sequentialRaw = (s.sequential_states ?? {}) as Record<string, unknown>;
    const sequentialStates: Record<string, SequentialStateV2> = {};
    for (const [key, value] of Object.entries(sequentialRaw)) {
      const mapped = resolveLegacyStateId(key, ctx) ?? key;
      sequentialStates[mapped] = value as SequentialStateV2;
    }

    out[assembly_id] = {
      assembly_id,
      subsystem_id,
      static_states: staticStates,
      sequential_states: sequentialStates,
    };
  }
  return out;
}

function upgradeOrchestrations(
  rows: Record<string, unknown>[],
  ctx: UpgradeContext,
): Record<string, Record<string, SubsystemStateSequence>> {
  const out: Record<string, Record<string, SubsystemStateSequence>> = {};
  for (const row of rows) {
    const subsystem_id = String(row.subsystem_id ?? "");
    if (!subsystem_id) continue;
    const sequences = (row.state_sequences ?? {}) as Record<string, unknown>;
    const mapped: Record<string, SubsystemStateSequence> = {};
    for (const [key, value] of Object.entries(sequences)) {
      const stateId = resolveLegacyStateId(key, ctx) ?? key;
      mapped[stateId] = value as SubsystemStateSequence;
    }
    out[subsystem_id] = mapped;
  }
  return out;
}

/**
 * Upgrade spec_section rows: legacy rows use `state_name` + `subsystem_id`;
 * per-subsystem functional_description rows fan out into per-assembly copies.
 * Each fan-out carries `provenance: "fanout_from_subsystem"` so downstream
 * consumers can track origin.
 */
function upgradeSections(
  sectionRows: Record<string, unknown>[],
  hierarchy: Hierarchy,
  ctx: UpgradeContext,
): SpecSectionRow[] {
  const out: SpecSectionRow[] = [];
  for (const row of sectionRows) {
    const section_type = String(row.section_type ?? "") as SpecSectionType;
    const hasAssemblyId = Boolean(row.assembly_id);
    const isFunctionalDesc = section_type === "functional_description";
    const stateId =
      (row.state_id as string | null | undefined) ??
      resolveLegacyStateId(row.state_name as string | null, ctx);

    const base: SpecSectionRow = {
      id: String(row.id ?? ""),
      spec_project_id: String(row.spec_project_id ?? ""),
      section_type,
      subsystem_id: (row.subsystem_id as string | null) ?? null,
      assembly_id: (row.assembly_id as string | null) ?? null,
      state_id: stateId ?? null,
      state_pattern:
        (row.state_pattern as "static" | "sequential" | null) ?? null,
      granularity:
        (row.granularity as "assembly_state" | "subsystem" | "project") ??
        "assembly_state",
      content_json: (row.content_json as Record<string, unknown>) ?? {},
      content_markdown: (row.content_markdown as string | null) ?? null,
      model_used: (row.model_used as string | null) ?? null,
      generation_prompt: (row.generation_prompt as string | null) ?? null,
      token_usage: (row.token_usage as Record<string, unknown>) ?? {},
      reviewed_by: (row.reviewed_by as string | null) ?? null,
      review_notes: (row.review_notes as string | null) ?? null,
      approved: Boolean(row.approved),
      created_at: String(row.created_at ?? new Date(0).toISOString()),
      updated_at: String(row.updated_at ?? new Date(0).toISOString()),
    };

    if (isFunctionalDesc && !hasAssemblyId && base.subsystem_id) {
      const sub = hierarchy.subsystems.find((s) => s.subsystem_id === base.subsystem_id);
      if (sub) {
        for (const asm of sub.assemblies) {
          out.push({
            ...base,
            assembly_id: asm.assembly_id,
            granularity: "assembly_state",
            content_json: {
              ...base.content_json,
              provenance: "fanout_from_subsystem",
            },
          });
        }
        continue;
      }
    }

    out.push(base);
  }
  return out;
}

function upgradeAlarms(
  alarmRows: Record<string, unknown>[],
  hierarchy: Hierarchy,
): AlarmRow[] {
  return alarmRows.map((row) => {
    const assemblyId = (row.assembly_id as string | null) ?? null;
    let deviceId = (row.device_id as string | null) ?? null;
    const tag = String(row.tag ?? "");
    let linkProvenance: "explicit" | "auto" = deviceId ? "explicit" : "auto";

    if (!deviceId && assemblyId) {
      // Restrict candidate devices to the same assembly.
      for (const sub of hierarchy.subsystems) {
        const asm = sub.assemblies.find((a) => a.assembly_id === assemblyId);
        if (asm) {
          deviceId = bestTagPrefixMatch(tag, asm.devices);
          linkProvenance = "auto";
          break;
        }
      }
    } else if (!deviceId) {
      // No assembly hint — search across all devices.
      const all: DeviceV2[] = [];
      for (const sub of hierarchy.subsystems) {
        for (const asm of sub.assemblies) all.push(...asm.devices);
      }
      deviceId = bestTagPrefixMatch(tag, all);
      linkProvenance = "auto";
    }

    const ce = (row.cause_effect as Record<string, unknown> | null) ?? null;
    return {
      id: String(row.id ?? ""),
      tier_id: String(row.tier_id ?? ""),
      device_id: deviceId,
      assembly_id: assemblyId,
      subsystem_id: (row.subsystem_id as string | null) ?? null,
      tag,
      description: String(row.description ?? ""),
      action: String(row.action ?? ""),
      setpoint: (row.setpoint as string | undefined) ?? undefined,
      delay: (row.delay as string | undefined) ?? undefined,
      cause_effect: ce
        ? { ...ce, link_provenance: linkProvenance }
        : { link_provenance: linkProvenance },
    };
  });
}

/**
 * Flatten the hierarchy into an IoListEntry[] (for `io_list` on the contract
 * and the `loadIoList` accessor). Legacy data never materialises an io_list
 * — it's assembled from the hierarchy in upgrade.
 */
function deriveIoList(hierarchy: Hierarchy): IoListEntry[] {
  const out: IoListEntry[] = [];
  for (const sub of hierarchy.subsystems) {
    for (const asm of sub.assemblies) {
      for (const dev of asm.devices) {
        for (const sig of dev.io_signals) {
          out.push({
            tag: sig.tag,
            device_type: dev.device_class,
            description: sig.description,
            signal_type: convertSignalDirection(String(sig.signal_type)),
            io_address: sig.io_address,
            normal_state: "",
            failsafe_state: "",
            assembly_id: asm.assembly_id,
            device_id: dev.device_id,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Synthesize FaultRow[] from alarms + FaultRef references found on state
 * completion criteria. Deterministic.
 */
function deriveFaults(
  alarms: AlarmRow[],
  assemblies: Record<string, AssemblyContract>,
): FaultRow[] {
  const byCode = new Map<string, FaultRow>();

  // Pass 1: alarms with a tier treated as faults contribute base rows.
  for (const a of alarms) {
    const code = a.tag || a.id;
    if (!code) continue;
    if (!byCode.has(code)) {
      byCode.set(code, {
        fault_code: code,
        description: a.description,
        triggered_by_tag: a.tag,
        severity:
          a.tier_id === "warning" ? "warning" : ("fault" as FaultSeverity),
        affected_devices: a.device_id ? [a.device_id] : [],
        action_text: a.action,
      });
    }
  }

  // Pass 2: walk FaultRef references inside sequential state completion criteria.
  for (const asm of Object.values(assemblies)) {
    for (const seq of Object.values(asm.sequential_states)) {
      for (const step of seq.steps) {
        const onFails: { fault_code: string; severity: FaultSeverity }[] = [];
        if (step.on_fail) onFails.push(step.on_fail);
        for (const cc of step.completion_criteria) {
          if (cc.kind !== "manual_ack" && cc.kind !== "placeholder" && cc.on_fail) onFails.push(cc.on_fail);
        }
        for (const ref of onFails) {
          if (!byCode.has(ref.fault_code)) {
            byCode.set(ref.fault_code, {
              fault_code: ref.fault_code,
              description: "",
              triggered_by_tag: "",
              severity: ref.severity,
              affected_devices: [],
              action_text: "",
            });
          }
        }
      }
    }
  }

  return Array.from(byCode.values()).sort((a, b) =>
    a.fault_code.localeCompare(b.fault_code),
  );
}

// ============================================================
// Assembly: either live rows (v2) or legacy shim
// ============================================================

function toProjectHeader(projectRow: Record<string, unknown>): SpecContractV2["project"] {
  return {
    id: String(projectRow.id ?? ""),
    doc_code: String(projectRow.doc_code ?? ""),
    title: String(projectRow.title ?? ""),
    client_name: String(projectRow.client_name ?? ""),
    project_number: (projectRow.project_number as string | null) ?? null,
    plc_model: (projectRow.plc_model as string | null) ?? null,
    hmi_type: (projectRow.hmi_type as string | null) ?? null,
    comms_protocol: (projectRow.comms_protocol as string | null) ?? null,
    safety_classification:
      (projectRow.safety_classification as string | null) ?? null,
    fault_philosophy: (projectRow.fault_philosophy as string | null) ?? null,
    design_principles: (projectRow.design_principles as string[] | null) ?? [],
    scope_exclusions: (projectRow.scope_exclusions as string[] | null) ?? [],
  };
}

function toAlarmTiers(projectRow: Record<string, unknown>): SpecContractV2["alarm_tiers"] {
  const tiers = (projectRow.alarm_tiers ?? []) as Record<string, unknown>[];
  return tiers.map((t) => ({
    tier_id: String(t.tier_id ?? ""),
    tier_name: String(t.tier_name ?? ""),
    description: String(t.description ?? ""),
  }));
}

function indexSections(rows: SpecSectionRow[]): Record<string, SpecSectionRow[]> {
  // Contract schema keys sections by section_type; each key holds an array so
  // per-(subsystem, state) `functional_description` rows can coexist. Arrays
  // are sorted by updated_at ASC so the last element is the most recent.
  const out: Record<string, SpecSectionRow[]> = {};
  for (const r of rows) {
    if (!out[r.section_type]) out[r.section_type] = [];
    out[r.section_type].push(r);
  }
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }
  return out;
}

/**
 * Private — upgrade a legacy (schema_version = 1) project row into the
 * in-memory V2 contract shape. Does NOT persist. Gated at the caller by
 * FLAGS.legacy_shim_enabled.
 */
async function upgradeLegacyRow(
  projectRow: Record<string, unknown>,
): Promise<SpecContractV2> {
  const ctx = buildUpgradeContext(projectRow);
  const [sectionRows, assemblySessions, orchestrationRows, alarmRows] =
    await Promise.all([
      fetchSectionsRows(String(projectRow.id)),
      fetchAssemblySessions(String(projectRow.id)),
      fetchSubsystemOrchestrations(String(projectRow.id)),
      fetchAlarmRows(String(projectRow.id)),
    ]);

  const hierarchy = buildHierarchyFromLegacy(projectRow);
  const assemblies = upgradeAssemblyContracts(assemblySessions, ctx);
  const orchestrations = upgradeOrchestrations(orchestrationRows, ctx);
  const upgradedSections = upgradeSections(sectionRows, hierarchy, ctx);
  const alarms = upgradeAlarms(alarmRows, hierarchy);
  const io_list = deriveIoList(hierarchy);
  const faults = deriveFaults(alarms, assemblies);
  const system_orchestration = await loadSystemOrchestration(
    String(projectRow.id),
  );

  const contract: SpecContractV2 = {
    schema_version: 2,
    project: toProjectHeader(projectRow),
    hierarchy,
    states: ctx.confirmedStates,
    alarm_tiers: toAlarmTiers(projectRow),
    assemblies,
    orchestrations,
    system_orchestration,
    alarms,
    io_list,
    faults,
    sections: indexSections(upgradedSections),
  };

  return SpecContractV2Schema.parse(contract);
}

/**
 * Private — assemble a V2 contract from live V2 rows (schema_version = 2).
 * Reserved for when builder writers start persisting V2-native data.
 */
async function assembleLiveV2(
  projectRow: Record<string, unknown>,
): Promise<SpecContractV2> {
  // The live V2 data model is still being wired up in later waves. Until then,
  // fall through to the same assembly path as the legacy shim — the shape is
  // identical; only the raw column choices differ. Any V2 writer that lands
  // before this fallback is replaced must produce rows that the same
  // assembly/alarm/section loaders can consume.
  return upgradeLegacyRow(projectRow);
}

// ============================================================
// Snapshot reader
// ============================================================

async function loadRevisionSnapshot(
  revisionId: string,
): Promise<SpecContractV2> {
  const { data, error } = await supabase
    .from("spec_project_revisions")
    .select("snapshot_json, snapshot_storage_path")
    .eq("id", revisionId)
    .single();
  if (error)
    throw new Error(`loadSpecContract: revision fetch failed: ${error.message}`);
  if (!data) throw new Error(`loadSpecContract: revision ${revisionId} not found`);

  const row = data as {
    snapshot_json: unknown;
    snapshot_storage_path: string | null;
  };
  if (row.snapshot_json) {
    return SpecContractV2Schema.parse(row.snapshot_json);
  }
  if (row.snapshot_storage_path) {
    const path = row.snapshot_storage_path.startsWith("spec-revisions/")
      ? row.snapshot_storage_path.slice("spec-revisions/".length)
      : row.snapshot_storage_path;
    const { data: blob, error: dlError } = await supabase.storage
      .from("spec-revisions")
      .download(path);
    if (dlError)
      throw new Error(`loadSpecContract: snapshot download failed: ${dlError.message}`);
    if (!blob) throw new Error(`loadSpecContract: empty snapshot at ${row.snapshot_storage_path}`);
    const text = await blob.text();
    return SpecContractV2Schema.parse(JSON.parse(text));
  }
  throw new Error(
    `loadSpecContract: revision ${revisionId} has neither snapshot_json nor snapshot_storage_path`,
  );
}

// ============================================================
// Public reader API
// ============================================================

/**
 * Load the full spec contract. When `revisionId` is provided, reads the
 * immutable snapshot; otherwise assembles from live rows. Result is Zod-
 * validated before return.
 */
export async function loadSpecContract(
  specProjectId: string,
  revisionId?: string,
): Promise<SpecContractV2> {
  if (revisionId) return loadRevisionSnapshot(revisionId);

  const projectRow = await fetchProjectRow(specProjectId);
  const schemaVersion = Number(projectRow.schema_version ?? 1);

  if (schemaVersion >= 2) return assembleLiveV2(projectRow);

  if (!FLAGS.legacy_shim_enabled) {
    throw new Error(
      `loadSpecContract: project ${specProjectId} is schema_version=1 but legacy_shim_enabled=false`,
    );
  }
  return upgradeLegacyRow(projectRow);
}

export async function loadAssemblyStates(
  specProjectId: string,
  assemblyId: string,
  stateId?: string,
): Promise<AssemblyStateView | AssemblyStateView[]> {
  const contract = await loadSpecContract(specProjectId);
  const asm = contract.assemblies[assemblyId];
  if (!asm) {
    return stateId ? ({
      assembly_id: assemblyId,
      subsystem_id: "",
      state_id: stateId,
      state_pattern: "static",
    } as AssemblyStateView) : [];
  }

  const statesById = new Map<string, OperatingStateV2>();
  for (const s of contract.states) statesById.set(s.state_id, s);

  const buildView = (sid: string): AssemblyStateView => {
    const meta = statesById.get(sid);
    const pattern: "static" | "sequential" = meta?.state_pattern ?? "static";
    return {
      assembly_id: asm.assembly_id,
      subsystem_id: asm.subsystem_id,
      state_id: sid,
      state_pattern: pattern,
      static_states: asm.static_states[sid],
      sequential_states: asm.sequential_states[sid],
    };
  };

  if (stateId) return buildView(stateId);

  const ids = new Set<string>([
    ...Object.keys(asm.static_states),
    ...Object.keys(asm.sequential_states),
  ]);
  return Array.from(ids).map(buildView);
}

export async function loadAlarms(opts: {
  specProjectId: string;
  deviceId?: string;
  assemblyId?: string;
  tierId?: string;
}): Promise<AlarmRow[]> {
  const rows = await fetchAlarmRows(opts.specProjectId, {
    deviceId: opts.deviceId,
    assemblyId: opts.assemblyId,
    tierId: opts.tierId,
  });
  // Alarms live in spec_alarms directly (no dialect, no shim needed on read).
  return rows.map((r) =>
    AlarmRowSchema.parse({
      id: String(r.id ?? ""),
      tier_id: String(r.tier_id ?? ""),
      device_id: (r.device_id as string | null) ?? null,
      assembly_id: (r.assembly_id as string | null) ?? null,
      subsystem_id: (r.subsystem_id as string | null) ?? null,
      tag: String(r.tag ?? ""),
      description: String(r.description ?? ""),
      action: String(r.action ?? ""),
      setpoint: (r.setpoint as string | undefined) ?? undefined,
      delay: (r.delay as string | undefined) ?? undefined,
      cause_effect: (r.cause_effect as unknown) ?? undefined,
    }),
  );
}

export async function loadHierarchy(specProjectId: string): Promise<Hierarchy> {
  const contract = await loadSpecContract(specProjectId);
  return contract.hierarchy;
}

export async function loadOrchestration(
  specProjectId: string,
  subsystemId: string,
  stateId?: string,
): Promise<SubsystemStateSequence | Record<string, SubsystemStateSequence>> {
  const contract = await loadSpecContract(specProjectId);
  const forSub = contract.orchestrations[subsystemId] ?? {};
  if (stateId) {
    const seq = forSub[stateId];
    if (!seq) {
      throw new Error(
        `loadOrchestration: no sequence for subsystem=${subsystemId} state=${stateId}`,
      );
    }
    return seq;
  }
  return forSub;
}

export async function loadIoList(
  specProjectId: string,
  opts?: { assemblyId?: string },
): Promise<IoListEntry[]> {
  const contract = await loadSpecContract(specProjectId);
  const list = contract.io_list;
  if (opts?.assemblyId) {
    return list.filter((e) => e.assembly_id === opts.assemblyId);
  }
  return list;
}

export async function loadFaults(specProjectId: string): Promise<FaultRow[]> {
  const contract = await loadSpecContract(specProjectId);
  return contract.faults;
}

export async function loadOperatingStates(
  specProjectId: string,
): Promise<OperatingStateV2[]> {
  const contract = await loadSpecContract(specProjectId);
  return contract.states;
}

// ============================================================
// Public writer API — builder only
// ============================================================

/**
 * Apply a typed patch to the live contract. Each top-level key replaces its
 * sub-tree in full. Nested maps (`assemblies`, `orchestrations`) replace
 * per-key. Patch is Zod-validated before any write occurs.
 *
 * Note: concrete persistence for non-alarm keys is deferred to later waves
 * — today this validates the shape and routes alarm writes through
 * `spec_alarms`. Other keys are accepted and ignored with a console warning
 * so builder scaffolding can light up without the writer migration landing.
 */
export async function writeSpecContract(
  specProjectId: string,
  patch: SpecContractPatch,
): Promise<void> {
  assertBuilderContext();
  const parsed = SpecContractPatchSchema.parse(patch);

  // ---- Structural validators (all collected, then thrown as one) ----
  const issues = validateSpecContractPatch(parsed);
  if (issues.length > 0) throw new ContractValidationError(issues);

  // ---- alarms (full replace in spec_alarms) ----
  if (parsed.alarms) {
    const { error: delErr } = await supabase
      .from("spec_alarms")
      .delete()
      .eq("spec_project_id", specProjectId);
    if (delErr) throw new Error(`writeSpecContract.alarms delete: ${delErr.message}`);
    if (parsed.alarms.length > 0) {
      const rows = parsed.alarms.map((a) => ({
        id: a.id || undefined,
        spec_project_id: specProjectId,
        tier_id: a.tier_id,
        device_id: a.device_id,
        assembly_id: a.assembly_id,
        subsystem_id: a.subsystem_id,
        tag: a.tag,
        description: a.description,
        action: a.action,
        setpoint: a.setpoint,
        delay: a.delay,
        cause_effect: a.cause_effect ?? null,
      }));
      const { error: insErr } = await supabase.from("spec_alarms").insert(rows);
      if (insErr) throw new Error(`writeSpecContract.alarms insert: ${insErr.message}`);
    }
  }

  // ---- hierarchy / states / alarm_tiers all live on spec_projects ----
  const projectUpdate: Record<string, unknown> = {};
  if (parsed.hierarchy) {
    projectUpdate.confirmed_subsystems = parsed.hierarchy.subsystems;
  }
  if (parsed.states) {
    projectUpdate.confirmed_states = parsed.states;
  }
  if (parsed.alarm_tiers) {
    projectUpdate.alarm_tiers = parsed.alarm_tiers;
  }
  if (Object.keys(projectUpdate).length > 0) {
    const { error: updErr } = await supabase
      .from("spec_projects")
      .update(projectUpdate)
      .eq("id", specProjectId);
    if (updErr) throw new Error(`writeSpecContract.project update: ${updErr.message}`);
  }

  // ---- assemblies → fds_assembly_sessions (upsert per assembly) ----
  if (parsed.assemblies) {
    for (const asm of Object.values(parsed.assemblies)) {
      const row = {
        spec_project_id: specProjectId,
        subsystem_id: asm.subsystem_id,
        assembly_id: asm.assembly_id,
        status: "complete",
        static_confirmed: true,
        static_states_v2: asm.static_states,
        sequential_states: asm.sequential_states,
      };
      const { error } = await supabase
        .from("fds_assembly_sessions")
        .upsert(row, { onConflict: "spec_project_id,assembly_id" });
      if (error)
        throw new Error(
          `writeSpecContract.assemblies upsert (${asm.assembly_id}): ${error.message}`,
        );
    }
  }

  // ---- orchestrations → fds_subsystem_orchestrations (upsert per subsystem) ----
  if (parsed.orchestrations) {
    for (const [subsystemId, stateSequences] of Object.entries(parsed.orchestrations)) {
      const row = {
        spec_project_id: specProjectId,
        subsystem_id: subsystemId,
        state_sequences: stateSequences,
      };
      const { error } = await supabase
        .from("fds_subsystem_orchestrations")
        .upsert(row, { onConflict: "spec_project_id,subsystem_id" });
      if (error)
        throw new Error(
          `writeSpecContract.orchestrations upsert (${subsystemId}): ${error.message}`,
        );
    }
  }

  // ---- system_orchestration → fds_system_orchestrations (single row upsert) ----
  if (parsed.system_orchestration) {
    const so = parsed.system_orchestration;
    const row: Record<string, unknown> = {
      spec_project_id: specProjectId,
      state_sequences: so.state_sequences,
      conversation: so.conversation,
      token_usage: so.token_usage,
    };
    if (so.validation_results !== undefined) {
      row.validation_results = so.validation_results;
    }
    const { error } = await supabase
      .from("fds_system_orchestrations")
      .upsert(row, { onConflict: "spec_project_id" });
    if (error)
      throw new Error(
        `writeSpecContract.system_orchestration upsert: ${error.message}`,
      );
  }

  // ---- sections → spec_sections (delete + reinsert per section_type) ----
  if (parsed.sections) {
    for (const [sectionType, rows] of Object.entries(parsed.sections)) {
      const { error: delErr } = await supabase
        .from("spec_sections")
        .delete()
        .eq("spec_project_id", specProjectId)
        .eq("section_type", sectionType);
      if (delErr)
        throw new Error(
          `writeSpecContract.sections delete (${sectionType}): ${delErr.message}`,
        );
      if (!rows || rows.length === 0) continue;
      const inserts = rows.map((r) => ({
        // Omit id so Postgres generates a fresh uuid for the new row.
        spec_project_id: specProjectId,
        section_type: r.section_type,
        subsystem_id: r.subsystem_id,
        assembly_id: r.assembly_id,
        state_id: r.state_id,
        state_pattern: r.state_pattern,
        granularity: r.granularity,
        content_json: r.content_json,
        content_markdown: r.content_markdown,
        model_used: r.model_used,
        generation_prompt: r.generation_prompt,
        token_usage: r.token_usage,
        reviewed_by: r.reviewed_by,
        review_notes: r.review_notes,
        approved: r.approved,
      }));
      const { error: insErr } = await supabase.from("spec_sections").insert(inserts);
      if (insErr)
        throw new Error(
          `writeSpecContract.sections insert (${sectionType}): ${insErr.message}`,
        );
    }
  }

  // io_list + faults are derived — no persistence.
  const derivedIgnored: (keyof SpecContractPatch)[] = ["io_list", "faults"];
  const derivedProvided = derivedIgnored.filter((k) => parsed[k] !== undefined);
  if (derivedProvided.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `writeSpecContract: [${derivedProvided.join(
        ", ",
      )}] are derived from hierarchy/alarms — ignored`,
    );
  }
}

export async function upsertAlarm(
  specProjectId: string,
  alarm: Partial<AlarmRow>,
): Promise<AlarmRow> {
  assertBuilderContext();
  const row = {
    id: alarm.id || undefined,
    spec_project_id: specProjectId,
    tier_id: alarm.tier_id ?? "",
    device_id: alarm.device_id ?? null,
    assembly_id: alarm.assembly_id ?? null,
    subsystem_id: alarm.subsystem_id ?? null,
    tag: alarm.tag ?? "",
    description: alarm.description ?? "",
    action: alarm.action ?? "",
    setpoint: alarm.setpoint ?? null,
    delay: alarm.delay ?? null,
    cause_effect: alarm.cause_effect ?? null,
  };
  const { data, error } = await supabase
    .from("spec_alarms")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw new Error(`upsertAlarm: ${error.message}`);
  if (!data) throw new Error(`upsertAlarm: no row returned`);
  return AlarmRowSchema.parse({
    id: String((data as Record<string, unknown>).id ?? ""),
    tier_id: String((data as Record<string, unknown>).tier_id ?? ""),
    device_id:
      ((data as Record<string, unknown>).device_id as string | null) ?? null,
    assembly_id:
      ((data as Record<string, unknown>).assembly_id as string | null) ?? null,
    subsystem_id:
      ((data as Record<string, unknown>).subsystem_id as string | null) ?? null,
    tag: String((data as Record<string, unknown>).tag ?? ""),
    description: String((data as Record<string, unknown>).description ?? ""),
    action: String((data as Record<string, unknown>).action ?? ""),
    setpoint:
      ((data as Record<string, unknown>).setpoint as string | undefined) ??
      undefined,
    delay:
      ((data as Record<string, unknown>).delay as string | undefined) ??
      undefined,
    cause_effect: (data as Record<string, unknown>).cause_effect ?? undefined,
  });
}

export async function deleteAlarm(alarmId: string): Promise<void> {
  assertBuilderContext();
  const { error } = await supabase.from("spec_alarms").delete().eq("id", alarmId);
  if (error) throw new Error(`deleteAlarm: ${error.message}`);
}

// ============================================================
// writeSpecContract validators (wave A)
// ============================================================

type ParsedPatch = z.infer<typeof SpecContractPatchSchema>;

/**
 * Runs all structural invariant checks over a parsed patch and returns
 * the list of human-readable issues. Empty list = valid. Callers wrap
 * non-empty results in {@link ContractValidationError}.
 *
 * Checks (wave A):
 *   1. Global IO tag uniqueness across the hierarchy.
 *   2. System-level interlocks reference subsystems only (not assemblies).
 *   3. Cycle detection on hold/block_transition/disable system interlocks.
 *   4. Subsystem-level inter-assembly interlocks must stay within the
 *      same subsystem.
 *   5. SFC: no cross-branch transitions; sequence_model_version=2 requires
 *      step_id + transitions populated on non-terminal steps.
 */
function validateSpecContractPatch(patch: ParsedPatch): string[] {
  const issues: string[] = [];

  // 1. IO tag global uniqueness ------------------------------------------
  if (patch.hierarchy) {
    const seen = new Map<string, string>(); // tag -> first location
    for (const sub of patch.hierarchy.subsystems) {
      for (const asm of sub.assemblies) {
        for (const dev of asm.devices) {
          for (const sig of dev.io_signals) {
            const tag = sig.tag;
            if (!tag) continue;
            const loc = `${sub.subsystem_id}/${asm.assembly_id}/${dev.device_id}`;
            const prior = seen.get(tag);
            if (prior) {
              issues.push(
                `IO tag "${tag}" is not unique — appears in ${prior} and ${loc}`,
              );
            } else {
              seen.set(tag, loc);
            }
          }
        }
      }
    }
  }

  // Resolve the set of subsystem IDs (for layering checks below).
  const knownSubsystemIds = new Set<string>();
  const subsystemByAssembly = new Map<string, string>(); // assembly_id -> subsystem_id
  if (patch.hierarchy) {
    for (const sub of patch.hierarchy.subsystems) {
      knownSubsystemIds.add(sub.subsystem_id);
      for (const asm of sub.assemblies) {
        subsystemByAssembly.set(asm.assembly_id, sub.subsystem_id);
      }
    }
  }

  // 2 + 3. System orchestration layering + cycle detection ---------------
  if (patch.system_orchestration) {
    for (const [stateId, seq] of Object.entries(
      patch.system_orchestration.state_sequences,
    )) {
      // 2. Layering — IDs must resolve to subsystems in the hierarchy, if
      //    the hierarchy is part of this patch. If hierarchy is not in the
      //    patch we cannot check resolution here; skip silently.
      if (patch.hierarchy) {
        for (const sid of seq.subsystem_order) {
          if (!knownSubsystemIds.has(sid)) {
            issues.push(
              `system_orchestration[${stateId}].subsystem_order references unknown subsystem "${sid}"`,
            );
          }
        }
        for (const il of seq.inter_subsystem_interlocks) {
          if (subsystemByAssembly.has(il.source_subsystem_id)) {
            issues.push(
              `system_orchestration[${stateId}] interlock ${il.interlock_id}: source "${il.source_subsystem_id}" looks like an assembly — lift it to the subsystem that owns it`,
            );
          } else if (!knownSubsystemIds.has(il.source_subsystem_id)) {
            issues.push(
              `system_orchestration[${stateId}] interlock ${il.interlock_id}: source_subsystem_id "${il.source_subsystem_id}" is not a known subsystem`,
            );
          }
          if (subsystemByAssembly.has(il.target_subsystem_id)) {
            issues.push(
              `system_orchestration[${stateId}] interlock ${il.interlock_id}: target "${il.target_subsystem_id}" looks like an assembly — lift it to the subsystem that owns it`,
            );
          } else if (!knownSubsystemIds.has(il.target_subsystem_id)) {
            issues.push(
              `system_orchestration[${stateId}] interlock ${il.interlock_id}: target_subsystem_id "${il.target_subsystem_id}" is not a known subsystem`,
            );
          }
        }
      }

      // 3. Cycle detection on restrictive effects within a single state.
      const restrictive = new Set(["hold", "block_transition", "disable"]);
      const graph = new Map<string, Set<string>>();
      for (const il of seq.inter_subsystem_interlocks) {
        if (!restrictive.has(il.effect)) continue;
        if (!graph.has(il.source_subsystem_id))
          graph.set(il.source_subsystem_id, new Set());
        graph.get(il.source_subsystem_id)!.add(il.target_subsystem_id);
      }
      if (hasCycle(graph)) {
        issues.push(
          `system_orchestration[${stateId}] contains a cycle across restrictive interlocks (hold/block_transition/disable). Break the cycle or reclassify one edge as trigger/enable.`,
        );
      }
    }
  }

  // 4. Subsystem-level inter-assembly interlocks: stay within subsystem ---
  if (patch.orchestrations) {
    for (const [subsystemId, byState] of Object.entries(patch.orchestrations)) {
      for (const [stateId, seq] of Object.entries(byState)) {
        for (const il of seq.inter_assembly_interlocks) {
          const srcSub = subsystemByAssembly.get(il.source_assembly);
          const tgtSub = subsystemByAssembly.get(il.target_assembly);
          // If hierarchy is not in the patch we can only reject mismatches
          // we can see. Assemblies we cannot resolve are skipped silently.
          if (srcSub && srcSub !== subsystemId) {
            issues.push(
              `orchestrations[${subsystemId}][${stateId}]: interlock source_assembly "${il.source_assembly}" belongs to subsystem "${srcSub}" — lift to system orchestration`,
            );
          }
          if (tgtSub && tgtSub !== subsystemId) {
            issues.push(
              `orchestrations[${subsystemId}][${stateId}]: interlock target_assembly "${il.target_assembly}" belongs to subsystem "${tgtSub}" — lift to system orchestration`,
            );
          }
        }
      }
    }
  }

  // 5. SFC sequence-model checks ----------------------------------------
  if (patch.assemblies) {
    for (const asm of Object.values(patch.assemblies)) {
      for (const [stateId, seq] of Object.entries(asm.sequential_states)) {
        if (seq.sequence_model_version !== 2) continue;
        // Build step_id -> branch_id map
        const branchByStep = new Map<string, string>();
        for (const s of seq.steps) {
          if (!s.step_id) {
            issues.push(
              `assemblies[${asm.assembly_id}].sequential_states[${stateId}]: sequence_model_version=2 requires step_id on every step (offending step #${s.step})`,
            );
            continue;
          }
          branchByStep.set(s.step_id, s.branch_id ?? "main");
        }
        // Branch registry: allow transitions that target parent branch
        // boundaries (fork_step_id, join_step_id) across the parent edge.
        const branchMeta = new Map<string, BranchV2Like>();
        for (const b of seq.branches ?? []) branchMeta.set(b.branch_id, b);

        for (let i = 0; i < seq.steps.length; i++) {
          const s = seq.steps[i];
          const isTerminal = i === seq.steps.length - 1;
          const transitions = s.transitions ?? [];
          if (!isTerminal && transitions.length === 0) {
            issues.push(
              `assemblies[${asm.assembly_id}].sequential_states[${stateId}]: step "${s.step_id || s.step}" has no transitions but is not terminal`,
            );
          }
          for (const tr of transitions) {
            const targets =
              tr.kind === "parallel" ? tr.target_step_ids : [tr.target_step_id];
            for (const targetId of targets) {
              const sourceBranch = s.branch_id ?? "main";
              const targetBranch = branchByStep.get(targetId);
              if (!targetBranch) {
                issues.push(
                  `assemblies[${asm.assembly_id}].sequential_states[${stateId}]: transition ${tr.transition_id} targets unknown step "${targetId}"`,
                );
                continue;
              }
              if (
                !isBranchTransitionLegal(sourceBranch, targetBranch, branchMeta)
              ) {
                issues.push(
                  `assemblies[${asm.assembly_id}].sequential_states[${stateId}]: transition ${tr.transition_id} crosses branches (${sourceBranch} -> ${targetBranch}). Cross-branch transitions are illegal; use a MonitorV2 with effect="fault" for pre-emption.`,
                );
              }
            }
          }
        }
      }
    }
  }

  return issues;
}

interface BranchV2Like {
  branch_id: string;
  parent_branch_id?: string;
  fork_step_id: string;
  join_step_id?: string;
}

/**
 * Legal transitions:
 *   - same branch
 *   - child->parent at the parent's fork/join point (i.e. target is in the
 *     parent branch — the transition is the branch completing and merging)
 *   - parent->child at the child's fork_step (spawning, but spawns are
 *     normally modeled via a "parallel" transition; allow it here).
 */
function isBranchTransitionLegal(
  sourceBranch: string,
  targetBranch: string,
  branchMeta: Map<string, BranchV2Like>,
): boolean {
  if (sourceBranch === targetBranch) return true;
  const source = branchMeta.get(sourceBranch);
  const target = branchMeta.get(targetBranch);
  // Moving from a child branch up into its parent — allowed (join).
  if (source?.parent_branch_id === targetBranch) return true;
  // Moving from a parent into a declared child branch — allowed (fork).
  if (target?.parent_branch_id === sourceBranch) return true;
  return false;
}

function hasCycle(graph: Map<string, Set<string>>): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const k of graph.keys()) color.set(k, WHITE);
  const dfs = (node: string): boolean => {
    color.set(node, GRAY);
    for (const nxt of graph.get(node) ?? []) {
      const c = color.get(nxt) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(nxt)) return true;
    }
    color.set(node, BLACK);
    return false;
  };
  for (const k of graph.keys()) {
    if ((color.get(k) ?? WHITE) === WHITE && dfs(k)) return true;
  }
  return false;
}
