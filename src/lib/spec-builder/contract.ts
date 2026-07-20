/**
 * Spec Contract accessor — the ONLY module allowed to read or write spec data
 * post-refactor. A future lint rule will forbid direct `supabase.from(...)` on
 * `spec_sections`, `spec_alarms`, `fds_operation_sessions`,
 * or `spec_project_revisions` outside this file.
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
  EquipmentModuleContractSchema,
  HierarchySchema,
  IoListEntrySchema,
  SafetyGateV2Schema,
  SpecContractV2Schema,
  SpecSectionRowSchema,
  SpecSectionTypeSchema,
  OperatorModeSchema,
  ConfigParameterSchema,
  ProjectSectionTypeSchema,
  ProjectSectionContentSchema,
  ConfirmationStatusSchema,
  ProcessModelSchema,
  UnitCoordinationV1Schema,
  EngineeringDataV1Schema,
  type AlarmRow,
  type AlarmTier,
  type EquipmentModuleContract,
  type SafetyGateV2,
  type EquipmentModuleV2,
  type ControlModuleStateEntry,
  type ControlModuleV2,
  type FaultRow,
  type FaultSeverity,
  type Hierarchy,
  type IoListEntry,
  type SequentialStateV2,
  type SpecContractV2,
  type SpecSectionRow,
  type SpecSectionType,
  type UnitV2,
  type IoSignalV2,
  type OperatorMode,
  type ConfigParameter,
  type ProjectSectionType,
  type ProjectSectionContent,
  type ConfirmationStatus,
  type ProcessModelV2,
  type UnitCoordinationV1,
  type EngineeringDataV1,
} from "@/types/spec-contract-v2";
import { validateEmStateMachine, validateCommandBehavior } from "@/lib/spec-builder/em-state-machine";
import { validateUnitCoordination } from "@/lib/spec-builder/unit-coordination";
import {
  seedDrivesFromNetworkConfig,
  validateDriveModels,
} from "@/lib/spec-builder/drive-model";
import { validateIoSignals } from "@/lib/spec-builder/io-signal-model";
import { validateSignalRouting } from "@/lib/spec-builder/signal-routing";
import { z } from "zod";

// ============================================================
// Public auxiliary types
// ============================================================

export interface AssemblyStateView {
  equipment_module_id: string;
  unit_id: string;
  state_id: string;
  state_pattern: "static" | "sequential";
  static_states?: ControlModuleStateEntry[];
  sequential_states?: SequentialStateV2;
}

/**
 * Typed patch for `writeSpecContract`. Full-subtree replace per top-level key.
 * Nested maps (`equipment_modules`) allow per-key replacement.
 */
export interface SpecContractPatch {
  hierarchy?: Hierarchy;
  alarms?: AlarmRow[];
  alarm_tiers?: AlarmTier[];
  equipment_modules?: Record<string, EquipmentModuleContract>;
  safety_gates?: SafetyGateV2[];
  io_list?: IoListEntry[];
  faults?: FaultRow[];
  sections?: Partial<Record<SpecSectionType, SpecSectionRow[]>>;
  // FDS Engine Phase 1
  modes?: OperatorMode[];
  configuration_parameters?: ConfigParameter[];
  section_overrides?: Partial<Record<ProjectSectionType, ProjectSectionContent>>;
  confirmation_status?: ConfirmationStatus;
  process_model?: ProcessModelV2 | null;
  unit_coordination?: Record<string, UnitCoordinationV1>;
  engineering?: EngineeringDataV1;
}

export const SpecContractPatchSchema = z.object({
  hierarchy: HierarchySchema.optional(),
  alarms: z.array(AlarmRowSchema).optional(),
  alarm_tiers: z.array(AlarmTierSchema).optional(),
  equipment_modules: z.record(z.string(), EquipmentModuleContractSchema).optional(),
  safety_gates: z.array(SafetyGateV2Schema).optional(),
  io_list: z.array(IoListEntrySchema).optional(),
  faults: z
    .array(
      z.object({
        fault_code: z.string(),
        description: z.string(),
        triggered_by_tag: z.string(),
        severity: z.enum(["warning", "fault"]),
        affected_control_modules: z.array(z.string()),
        action_text: z.string(),
      }),
    )
    .optional(),
  sections: z.record(z.string(), z.array(SpecSectionRowSchema)).optional(),
  modes: z.array(OperatorModeSchema).optional(),
  unit_coordination: z.record(z.string(), UnitCoordinationV1Schema).optional(),
  engineering: EngineeringDataV1Schema.optional(),
  configuration_parameters: z.array(ConfigParameterSchema).optional(),
  // section_overrides uses partialRecord because z.record with an enum key in
  // Zod v4 demands all keys be present — overrides are sparse by definition.
  // (Mirrors the same pattern in SpecContractV2Schema; see Task 10.)
  section_overrides: z
    .partialRecord(ProjectSectionTypeSchema, ProjectSectionContentSchema)
    .optional(),
  confirmation_status: ConfirmationStatusSchema.optional(),
  process_model: ProcessModelSchema.nullable().optional(),
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
    .from("fds_operation_sessions")
    .select("*")
    .eq("spec_project_id", specProjectId);
  if (error) throw new Error(`loadSpecContract: equipment_module sessions fetch failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchAlarmRows(
  specProjectId: string,
  opts?: { deviceId?: string; equipment_moduleId?: string; tierId?: string },
): Promise<Record<string, unknown>[]> {
  let q = supabase.from("spec_alarms").select("*").eq("spec_project_id", specProjectId);
  if (opts?.deviceId) q = q.eq("control_module_id", opts.deviceId);
  if (opts?.equipment_moduleId) q = q.eq("equipment_module_id", opts.equipment_moduleId);
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
  /** Map of lowercased state_name → state_id, for legacy state_name matching. */
  stateNameToId: Map<string, string>;
}

// The legacy global `confirmed_states` JSONB column may still exist on old
// project rows. It is NO LONGER an operating-state source — states live
// per-EM now — but the legacy shim still uses its state_name → state_id pairs
// to resolve legacy section / static-state map keys during upgrade.
export function buildUpgradeContext(projectRow: Record<string, unknown>): UpgradeContext {
  const rawStates = (projectRow.confirmed_states ?? []) as Record<string, unknown>[];
  const stateNameToId = new Map<string, string>();
  for (const s of rawStates) {
    const stateName = String(s.state_name ?? "");
    const stateId = String(s.state_id ?? "");
    if (stateName && stateId) stateNameToId.set(stateName.toLowerCase(), stateId);
  }
  return { stateNameToId };
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
 * Longest-shared-prefix match (min 4 chars). Returns the control_module_id whose tag
 * shares the longest prefix with the alarm tag, restricted to a single
 * equipment_module. Below threshold → null.
 */
function bestTagPrefixMatch(
  alarmTag: string,
  control_modules: ControlModuleV2[],
): string | null {
  const MIN = 4;
  let bestId: string | null = null;
  let bestLen = 0;
  for (const d of control_modules) {
    for (const sig of d.io_signals) {
      const shared = sharedPrefixLength(alarmTag, sig.tag);
      if (shared > bestLen && shared >= MIN) {
        bestLen = shared;
        bestId = d.control_module_id;
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
 * Build the hierarchy sub-tree from legacy `confirmed_units` + ensure
 * every IoSignal signal_type is canonical IEC.
 */
function buildHierarchyFromLegacy(
  projectRow: Record<string, unknown>,
): Hierarchy {
  const subs = (projectRow.confirmed_units ?? []) as Record<string, unknown>[];
  const units: UnitV2[] = subs.map((s) => {
    const equipment_modulesRaw = (s.equipment_modules ?? []) as Record<string, unknown>[];
    const equipment_modules: EquipmentModuleV2[] = equipment_modulesRaw.map((a) => {
      const control_modulesRaw = (a.control_modules ?? []) as Record<string, unknown>[];
      const control_modules: ControlModuleV2[] = control_modulesRaw.map((d) => {
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
          control_module_id: String(d.control_module_id ?? ""),
          control_module_name: String(d.control_module_name ?? ""),
          control_module_class: String(d.control_module_class ?? "other"),
          is_safety: Boolean(d.is_safety),
          description: String(d.description ?? ""),
          io_signals,
          network_config: (d.network_config as ControlModuleV2["network_config"]) ?? undefined,
        };
      });
      return {
        equipment_module_id: String(a.equipment_module_id ?? ""),
        equipment_module_name: String(a.equipment_module_name ?? ""),
        description: String(a.description ?? ""),
        control_modules,
      };
    });
    return {
      unit_id: String(s.unit_id ?? ""),
      unit_name: String(s.unit_name ?? ""),
      equipment_type: String(s.equipment_type ?? "Other"),
      description: String(s.description ?? ""),
      excluded: Boolean(s.excluded),
      equipment_modules,
    };
  });
  return { units };
}

/**
 * Upgrade legacy per-equipment_module session rows into EquipmentModuleContract entries,
 * keyed by equipment_module_id. Prefers `static_states_v2` (already keyed by
 * state_id); otherwise converts legacy `static_states` (keyed by state_name).
 * Exported for unit tests (pure).
 */
export function upgradeEquipmentModuleContracts(
  equipment_moduleSessions: Record<string, unknown>[],
  ctx: UpgradeContext,
): Record<string, EquipmentModuleContract> {
  const out: Record<string, EquipmentModuleContract> = {};
  for (const s of equipment_moduleSessions) {
    const equipment_module_id = String(s.equipment_module_id ?? "");
    const unit_id = String(s.unit_id ?? "");
    if (!equipment_module_id) continue;

    let staticStates: Record<string, ControlModuleStateEntry[]> = {};
    if (s.static_states_v2 && typeof s.static_states_v2 === "object") {
      staticStates = s.static_states_v2 as Record<string, ControlModuleStateEntry[]>;
    } else if (s.static_states && typeof s.static_states === "object") {
      // Legacy map was keyed by state_name — convert to state_id keys.
      const legacy = s.static_states as Record<string, ControlModuleStateEntry[]>;
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

    out[equipment_module_id] = {
      equipment_module_id,
      unit_id,
      states: Array.isArray(s.em_states) ? (s.em_states as EquipmentModuleContract["states"]) : [],
      transitions: Array.isArray(s.em_transitions)
        ? (s.em_transitions as EquipmentModuleContract["transitions"])
        : [],
      static_states: staticStates,
      sequential_states: sequentialStates,
      // SP-3c: command-conditional Execute-behavior — pass the session column
      // through verbatim; absent stays absent (schema field is .optional()).
      command_behavior:
        s.command_behavior && typeof s.command_behavior === "object"
          ? (s.command_behavior as EquipmentModuleContract["command_behavior"])
          : undefined,
    };
  }
  return out;
}

/**
 * The DB's spec_sections_granularity_check still only permits the LEGACY
 * granularity vocabulary ('assembly_state', 'subsystem', ...), and compose
 * deliberately lets the column default apply (see fds-compose.ts). Map the
 * legacy values onto the contract vocabulary at load; unknown/absent falls
 * back to equipment_module_state (matching the previous default).
 * Exported for unit tests (pure).
 */
export function normalizeGranularity(
  raw: unknown,
): "equipment_module_state" | "unit" | "project" {
  switch (raw) {
    case "unit":
    case "subsystem":
      return "unit";
    case "project":
      return "project";
    default:
      return "equipment_module_state"; // incl. legacy 'assembly_state' and absent
  }
}

/**
 * Upgrade spec_section rows: legacy rows use `state_name` + `unit_id`;
 * per-unit functional_description rows fan out into per-equipment_module copies.
 * Each fan-out carries `provenance: "fanout_from_unit"` so downstream
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
    const hasAssemblyId = Boolean(row.equipment_module_id);
    const isFunctionalDesc = section_type === "functional_description";
    const stateId =
      (row.state_id as string | null | undefined) ??
      resolveLegacyStateId(row.state_name as string | null, ctx);

    const base: SpecSectionRow = {
      id: String(row.id ?? ""),
      spec_project_id: String(row.spec_project_id ?? ""),
      section_type,
      unit_id: (row.unit_id as string | null) ?? null,
      equipment_module_id: (row.equipment_module_id as string | null) ?? null,
      state_id: stateId ?? null,
      state_pattern:
        (row.state_pattern as "static" | "sequential" | null) ?? null,
      granularity: normalizeGranularity(row.granularity),
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

    if (isFunctionalDesc && !hasAssemblyId && base.unit_id) {
      const sub = hierarchy.units.find((s) => s.unit_id === base.unit_id);
      if (sub) {
        for (const asm of sub.equipment_modules) {
          out.push({
            ...base,
            equipment_module_id: asm.equipment_module_id,
            granularity: "equipment_module_state",
            content_json: {
              ...base.content_json,
              provenance: "fanout_from_unit",
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
    const equipment_moduleId = (row.equipment_module_id as string | null) ?? null;
    let deviceId = (row.control_module_id as string | null) ?? null;
    const tag = String(row.tag ?? "");
    let linkProvenance: "explicit" | "auto" = deviceId ? "explicit" : "auto";

    if (!deviceId && equipment_moduleId) {
      // Restrict candidate control_modules to the same equipment_module.
      for (const sub of hierarchy.units) {
        const asm = sub.equipment_modules.find((a) => a.equipment_module_id === equipment_moduleId);
        if (asm) {
          deviceId = bestTagPrefixMatch(tag, asm.control_modules);
          linkProvenance = "auto";
          break;
        }
      }
    } else if (!deviceId) {
      // No equipment_module hint — search across all control_modules.
      const all: ControlModuleV2[] = [];
      for (const sub of hierarchy.units) {
        for (const asm of sub.equipment_modules) all.push(...asm.control_modules);
      }
      deviceId = bestTagPrefixMatch(tag, all);
      linkProvenance = "auto";
    }

    const ce = (row.cause_effect as Record<string, unknown> | null) ?? null;
    return {
      id: String(row.id ?? ""),
      tier_id: String(row.tier_id ?? ""),
      control_module_id: deviceId,
      equipment_module_id: equipment_moduleId,
      unit_id: (row.unit_id as string | null) ?? null,
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
export function deriveIoList(hierarchy: Hierarchy): IoListEntry[] {
  const out: IoListEntry[] = [];
  for (const sub of hierarchy.units) {
    for (const asm of sub.equipment_modules) {
      for (const dev of asm.control_modules) {
        for (const sig of dev.io_signals) {
          out.push({
            tag: sig.tag,
            device_type: dev.control_module_class,
            description: sig.description,
            signal_type: convertSignalDirection(String(sig.signal_type)),
            io_address: sig.io_address,
            // G0-2: render structured polarity into the signable view.
            normal_state:
              sig.polarity === "nc" ? "N/C" : sig.polarity === "no" ? "N/O" : "",
            failsafe_state:
              sig.polarity === "nc" ? "fail-safe (healthy = TRUE)" : "",
            equipment_module_id: asm.equipment_module_id,
            control_module_id: dev.control_module_id,
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
  equipment_modules: Record<string, EquipmentModuleContract>,
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
        affected_control_modules: a.control_module_id ? [a.control_module_id] : [],
        action_text: a.action,
      });
    }
  }

  // Pass 2: walk FaultRef references inside sequential state completion criteria.
  for (const asm of Object.values(equipment_modules)) {
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
              affected_control_modules: [],
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
// Equipment Module: either live rows (v2) or legacy shim
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
  // per-(unit, state) `functional_description` rows can coexist. Arrays
  // are sorted by updated_at ASC so the last element is the most recent.
  //
  // Pre-populate every SpecSectionType enum key with [] so SpecContractV2Schema
  // parse succeeds even when a project has zero section rows yet. Zod v4's
  // z.record(enum, …) demands all enum keys present; an empty {} fails parse,
  // which is what blocked the migrate wizard on freshly-hierarchied projects.
  const out: Record<string, SpecSectionRow[]> = {};
  for (const key of SpecSectionTypeSchema.options) {
    out[key] = [];
  }
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
  const [sectionRows, equipment_moduleSessions, alarmRows] =
    await Promise.all([
      fetchSectionsRows(String(projectRow.id)),
      fetchAssemblySessions(String(projectRow.id)),
      fetchAlarmRows(String(projectRow.id)),
    ]);

  const hierarchy = buildHierarchyFromLegacy(projectRow);
  const equipment_modules = upgradeEquipmentModuleContracts(equipment_moduleSessions, ctx);
  const upgradedSections = upgradeSections(sectionRows, hierarchy, ctx);
  const alarms = upgradeAlarms(alarmRows, hierarchy);
  const io_list = deriveIoList(hierarchy);
  const faults = deriveFaults(alarms, equipment_modules);

  const contract: SpecContractV2 = {
    schema_version: 3,
    // Legacy upgrade path serves projects that have not gone through Phase 2
    // confirmation; mark unconfirmed (Task 10).
    confirmation_status: "unconfirmed",
    project: toProjectHeader(projectRow),
    hierarchy,
    alarm_tiers: toAlarmTiers(projectRow),
    equipment_modules,
    safety_gates: Array.isArray(projectRow.safety_gates)
      ? (projectRow.safety_gates as SpecContractV2["safety_gates"])
      : [],
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
  // fall through to the same equipment_module path as the legacy shim — the shape is
  // identical; only the raw column choices differ. Any V2 writer that lands
  // before this fallback is replaced must produce rows that the same
  // equipment_module/alarm/section loaders can consume.
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

  // FDS Engine Phase 1: confirmation_status gates whether the legacy shim
  // is even considered. Unconfirmed projects continue through the existing
  // schema_version branch (legacy shape via shim); confirmed projects skip
  // the shim regardless of schema_version.
  const confirmationStatus = ((projectRow.confirmation_status as string | undefined) ??
    "unconfirmed") as ConfirmationStatus;

  let baseContract: SpecContractV2;
  if (confirmationStatus === "confirmed" || schemaVersion >= 2) {
    baseContract = await assembleLiveV2(projectRow);
  } else {
    if (!FLAGS.legacy_shim_enabled) {
      throw new Error(
        `loadSpecContract: project ${specProjectId} is schema_version=1 but legacy_shim_enabled=false`,
      );
    }
    baseContract = await upgradeLegacyRow(projectRow);
  }

  // FDS Engine Phase 1: populate new top-level fields from spec_projects.
  // Re-parse so SpecContractV2Schema.confirmation_status default + the new
  // optional fields are normalised. G0-1: seed drive models from legacy
  // network_config after parse (pure in-memory shim, see drive-model.ts).
  return seedDrivesFromNetworkConfig(
    SpecContractV2Schema.parse({
    ...baseContract,
    modes: (projectRow.confirmed_modes as OperatorMode[] | null) ?? undefined,
    unit_coordination:
      (projectRow.unit_coordination as Record<string, UnitCoordinationV1> | null) ??
      undefined,
    engineering: (projectRow.engineering as EngineeringDataV1 | null) ?? undefined,
    configuration_parameters:
      (projectRow.configuration_parameters as ConfigParameter[] | null) ?? undefined,
    section_overrides:
      (projectRow.section_overrides as
        | Partial<Record<ProjectSectionType, ProjectSectionContent>>
        | null) ?? undefined,
    confirmation_status: confirmationStatus,
    process_model:
      (projectRow.process_model as ProcessModelV2 | null) ?? undefined,
    }),
  );
}

export async function loadAssemblyStates(
  specProjectId: string,
  equipment_moduleId: string,
  stateId?: string,
): Promise<AssemblyStateView | AssemblyStateView[]> {
  const contract = await loadSpecContract(specProjectId);
  const asm = contract.equipment_modules[equipment_moduleId];
  if (!asm) {
    return stateId ? ({
      equipment_module_id: equipment_moduleId,
      unit_id: "",
      state_id: stateId,
      state_pattern: "static",
    } as AssemblyStateView) : [];
  }

  // state_pattern comes from the EM's OWN state machine (hybrid state model),
  // keyed by EM-local state_id (EmStateV2.kind), not a global state list.
  const kindById = new Map<string, "static" | "sequential">();
  for (const s of asm.states ?? []) kindById.set(s.state_id, s.kind);

  const buildView = (sid: string): AssemblyStateView => {
    const pattern: "static" | "sequential" = kindById.get(sid) ?? "static";
    // static_states was widened in Task 8 to `ControlModuleStateEntry[] | StaticStateV2`.
    // EquipmentModuleStateView still expects `ControlModuleStateEntry[] | undefined`; unwrap.
    const rawStatic = asm.static_states[sid];
    const staticEntries = rawStatic
      ? Array.isArray(rawStatic)
        ? rawStatic
        : rawStatic.control_modules
      : undefined;
    return {
      equipment_module_id: asm.equipment_module_id,
      unit_id: asm.unit_id,
      state_id: sid,
      state_pattern: pattern,
      static_states: staticEntries,
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
  equipment_moduleId?: string;
  tierId?: string;
}): Promise<AlarmRow[]> {
  const rows = await fetchAlarmRows(opts.specProjectId, {
    deviceId: opts.deviceId,
    equipment_moduleId: opts.equipment_moduleId,
    tierId: opts.tierId,
  });
  // Alarms live in spec_alarms directly (no dialect, no shim needed on read).
  return rows.map((r) =>
    AlarmRowSchema.parse({
      id: String(r.id ?? ""),
      tier_id: String(r.tier_id ?? ""),
      control_module_id: (r.control_module_id as string | null) ?? null,
      equipment_module_id: (r.equipment_module_id as string | null) ?? null,
      unit_id: (r.unit_id as string | null) ?? null,
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

export async function loadIoList(
  specProjectId: string,
  opts?: { equipment_moduleId?: string },
): Promise<IoListEntry[]> {
  const contract = await loadSpecContract(specProjectId);
  const list = contract.io_list;
  if (opts?.equipment_moduleId) {
    return list.filter((e) => e.equipment_module_id === opts.equipment_moduleId);
  }
  return list;
}

export async function loadFaults(specProjectId: string): Promise<FaultRow[]> {
  const contract = await loadSpecContract(specProjectId);
  return contract.faults;
}

// ============================================================
// Public writer API — builder only
// ============================================================

/**
 * Apply a typed patch to the live contract. Each top-level key replaces its
 * sub-tree in full. Nested maps (`equipment_modules`) replace per-key. Patch is
 * Zod-validated before any write occurs.
 *
 * Persists hierarchy (`confirmed_units`), `alarm_tiers`,
 * `confirmed_modes`, `configuration_parameters`, `section_overrides`,
 * `process_model`, `unit_coordination`, `engineering`, and
 * `confirmation_status` onto `spec_projects`, plus alarm rows via
 * `spec_alarms` and equipment-module / section upserts.
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
        control_module_id: a.control_module_id,
        equipment_module_id: a.equipment_module_id,
        unit_id: a.unit_id,
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

  // ---- hierarchy / alarm_tiers / modes etc. all live on spec_projects ----
  const projectUpdate: Record<string, unknown> = {};
  if (parsed.hierarchy) {
    projectUpdate.confirmed_units = parsed.hierarchy.units;
  }
  if (parsed.alarm_tiers) {
    projectUpdate.alarm_tiers = parsed.alarm_tiers;
  }
  if (parsed.modes !== undefined) {
    projectUpdate.confirmed_modes = parsed.modes;
  }
  if (parsed.unit_coordination !== undefined) {
    projectUpdate.unit_coordination = parsed.unit_coordination;
  }
  if (parsed.engineering !== undefined) {
    projectUpdate.engineering = parsed.engineering;
  }
  if (parsed.configuration_parameters !== undefined) {
    projectUpdate.configuration_parameters = parsed.configuration_parameters;
  }
  if (parsed.section_overrides !== undefined) {
    projectUpdate.section_overrides = parsed.section_overrides;
  }
  if (parsed.confirmation_status !== undefined) {
    projectUpdate.confirmation_status = parsed.confirmation_status;
  }
  if (parsed.process_model !== undefined) {
    projectUpdate.process_model = parsed.process_model;
  }
  if (parsed.safety_gates !== undefined) {
    projectUpdate.safety_gates = parsed.safety_gates;
  }
  if (Object.keys(projectUpdate).length > 0) {
    const { error: updErr } = await supabase
      .from("spec_projects")
      .update(projectUpdate)
      .eq("id", specProjectId);
    if (updErr) throw new Error(`writeSpecContract.project update: ${updErr.message}`);
  }

  // ---- equipment_modules → fds_operation_sessions (upsert per equipment_module) ----
  if (parsed.equipment_modules) {
    for (const asm of Object.values(parsed.equipment_modules)) {
      const row = {
        spec_project_id: specProjectId,
        unit_id: asm.unit_id,
        equipment_module_id: asm.equipment_module_id,
        status: "complete",
        static_confirmed: true,
        static_states_v2: asm.static_states,
        sequential_states: asm.sequential_states,
        em_states: asm.states,
        em_transitions: asm.transitions,
        command_behavior: asm.command_behavior ?? null,
      };
      const { error } = await supabase
        .from("fds_operation_sessions")
        .upsert(row, { onConflict: "spec_project_id,equipment_module_id" });
      if (error)
        throw new Error(
          `writeSpecContract.equipment_modules upsert (${asm.equipment_module_id}): ${error.message}`,
        );
    }
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
        unit_id: r.unit_id,
        equipment_module_id: r.equipment_module_id,
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
    control_module_id: alarm.control_module_id ?? null,
    equipment_module_id: alarm.equipment_module_id ?? null,
    unit_id: alarm.unit_id ?? null,
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
    control_module_id:
      ((data as Record<string, unknown>).control_module_id as string | null) ?? null,
    equipment_module_id:
      ((data as Record<string, unknown>).equipment_module_id as string | null) ?? null,
    unit_id:
      ((data as Record<string, unknown>).unit_id as string | null) ?? null,
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
 *   5. SFC: no cross-branch transitions; sequence_model_version=2 requires
 *      step_id + transitions populated on non-terminal steps.
 */
export function validateSpecContractPatch(patch: ParsedPatch): string[] {
  const issues: string[] = [];

  // FDS Engine Phase 1: modes invariants
  if (patch.modes !== undefined) {
    const ids = patch.modes.map((m) => m.mode_id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      issues.push(`duplicate mode_id(s): ${[...new Set(dupes)].join(", ")}`);
    }
    const defaults = patch.modes.filter((m) => m.is_default);
    if (defaults.length === 0) {
      issues.push("modes patch must include exactly one default mode (is_default=true)");
    } else if (defaults.length > 1) {
      issues.push(
        `modes patch must include exactly one default mode; found ${defaults.length}`,
      );
    }
  }

  // FDS Engine Phase 1: override_kind content rules — inherit / suppressed
  // rows must be empty (no permissives, steps, monitors, branches, control_modules).
  if (patch.equipment_modules !== undefined) {
    Object.entries(patch.equipment_modules).forEach(([equipment_moduleId, contract]) => {
      Object.entries(contract.sequential_states ?? {}).forEach(([stateKey, seq]) => {
        const kind = (seq as { override_kind?: string }).override_kind;
        if (kind === "inherit" || kind === "suppressed") {
          const hasContent =
            (seq.permissives && seq.permissives.length > 0) ||
            (seq.steps && seq.steps.length > 0) ||
            (seq.state_monitors && seq.state_monitors.length > 0) ||
            (seq.branches && seq.branches.length > 0);
          if (hasContent) {
            issues.push(
              `equipment_modules[${equipment_moduleId}].sequential_states[${stateKey}]: ${kind} rows must be empty (no permissives/steps/monitors/branches)`,
            );
          }
        }
      });
      // Static states share the same rule when wrapped in StaticStateV2.
      Object.entries(contract.static_states ?? {}).forEach(([stateKey, val]) => {
        if (Array.isArray(val)) return; // legacy shape, no override_kind
        const kind = (val as { override_kind?: string }).override_kind;
        if (kind === "inherit" || kind === "suppressed") {
          const control_modules = (val as { control_modules?: unknown[] }).control_modules;
          if (control_modules && control_modules.length > 0) {
            issues.push(
              `equipment_modules[${equipment_moduleId}].static_states[${stateKey}]: ${kind} rows must have empty control_modules`,
            );
          }
        }
      });
    });
  }

  // Hybrid state model: per-EM state-machine invariants.
  // NB: EquipmentModuleContractSchema.states has .default([]), so on
  // schema-parsed patches this Array.isArray guard never skips — it only
  // protects callers that bypass Zod. A zero-state EM still passes silently
  // (both validators early-return / gate on states.length).
  if (patch.equipment_modules !== undefined) {
    for (const contract of Object.values(patch.equipment_modules)) {
      if (!Array.isArray((contract as EquipmentModuleContract).states)) continue;
      issues.push(...validateEmStateMachine(contract as EquipmentModuleContract));
      // SP-3c: command_behavior structural checks. Returns [] when the field is
      // absent, so pre-SP-3c specs are unaffected (no PackML enforcement here —
      // the SP-3b Stage-A-only boundary stands).
      issues.push(...validateCommandBehavior(contract as EquipmentModuleContract));
    }
  }

  // Hybrid state model: safety gates must scope to known equipment modules.
  if (patch.safety_gates !== undefined) {
    const knownEmIds = new Set<string>();
    if (patch.hierarchy) {
      for (const sub of patch.hierarchy.units) {
        for (const asm of sub.equipment_modules) knownEmIds.add(asm.equipment_module_id);
      }
    }
    const gateIds = patch.safety_gates.map((g) => g.gate_id);
    const dupGateIds = gateIds.filter((id, i) => gateIds.indexOf(id) !== i);
    for (const id of new Set(dupGateIds)) {
      issues.push(`duplicate safety gate gate_id "${id}"`);
    }
    if (patch.hierarchy) {
      for (const g of patch.safety_gates) {
        if (g.scope === "all") continue;
        for (const emId of g.scope) {
          if (!knownEmIds.has(emId)) {
            issues.push(`safety gate ${g.gate_id} scopes unknown equipment_module "${emId}"`);
          }
        }
      }
    }
  }

  // G0-9: unit coordination invariants. Member-EM cross-check only runs when
  // the same patch carries the hierarchy (same convention as safety_gates);
  // mode rules only when the patch carries modes.
  if (patch.unit_coordination !== undefined) {
    for (const [key, coord] of Object.entries(patch.unit_coordination)) {
      if (key !== coord.unit_id) {
        issues.push(
          `unit_coordination key ${key} disagrees with its unit_id ${coord.unit_id}`,
        );
      }
      let memberEmIds: Set<string> | undefined;
      if (patch.hierarchy) {
        const unit = patch.hierarchy.units.find((u) => u.unit_id === coord.unit_id);
        memberEmIds = new Set(
          (unit?.equipment_modules ?? []).map((asm) => asm.equipment_module_id),
        );
      }
      issues.push(
        ...validateUnitCoordination(coord, { modes: patch.modes, memberEmIds }),
      );
      // G0-3: the routing layer rides the same per-unit construct.
      issues.push(
        ...validateSignalRouting(coord, {
          memberEmIds,
          safetyGateIds: patch.safety_gates
            ? new Set(patch.safety_gates.map((g) => g.gate_id))
            : undefined,
        }),
      );
    }
  }

  // G0-1 drive models + G0-2 per-IO model: both need hierarchy context
  // (CMs live there); an engineering-only patch skips — same convention
  // as the block above.
  if (patch.hierarchy) {
    const control_modules = patch.hierarchy.units.flatMap((u) =>
      u.equipment_modules.flatMap((em) => em.control_modules),
    );
    issues.push(
      ...validateDriveModels({ control_modules, engineering: patch.engineering })
        .errors,
    );
    issues.push(...validateIoSignals(control_modules).errors);
  }

  // FDS Engine Phase 1: parameter_ref expressions must reference a known
  // configuration parameter. Within-patch only — cross-patch resolution
  // (when the parameter sits in the persisted contract but not in the patch)
  // is a follow-up wave.
  if (patch.equipment_modules !== undefined) {
    const knownParamIds = new Set(
      (patch.configuration_parameters ?? []).map((p) => p.parameter_id),
    );
    Object.entries(patch.equipment_modules).forEach(([equipment_moduleId, contract]) => {
      Object.entries(contract.sequential_states ?? {}).forEach(([stateKey, seq]) => {
        (seq.steps ?? []).forEach((step, sIdx) => {
          const actions = (step as { actions?: Array<{ source?: { kind: string; parameter_id?: string } }> }).actions ?? [];
          actions.forEach((a, aIdx) => {
            if (a.source?.kind === "parameter_ref") {
              const pid = a.source.parameter_id;
              if (pid && !knownParamIds.has(pid)) {
                issues.push(
                  `equipment_modules[${equipment_moduleId}].sequential_states[${stateKey}].steps[${sIdx}].actions[${aIdx}]: parameter_ref "${pid}" is not a known parameter`,
                );
              }
            }
          });
        });
      });
    });
  }

  // 1. IO tag global uniqueness ------------------------------------------
  if (patch.hierarchy) {
    const seen = new Map<string, string>(); // tag -> first location
    for (const sub of patch.hierarchy.units) {
      for (const asm of sub.equipment_modules) {
        for (const dev of asm.control_modules) {
          for (const sig of dev.io_signals) {
            const tag = sig.tag;
            if (!tag) continue;
            const loc = `${sub.unit_id}/${asm.equipment_module_id}/${dev.control_module_id}`;
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

  // 5. SFC sequence-model checks ----------------------------------------
  if (patch.equipment_modules) {
    for (const asm of Object.values(patch.equipment_modules)) {
      for (const [stateId, seq] of Object.entries(asm.sequential_states)) {
        if (seq.sequence_model_version !== 2) continue;
        // Build step_id -> branch_id map
        const branchByStep = new Map<string, string>();
        for (const s of seq.steps) {
          if (!s.step_id) {
            issues.push(
              `equipment_modules[${asm.equipment_module_id}].sequential_states[${stateId}]: sequence_model_version=2 requires step_id on every step (offending step #${s.step})`,
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
              `equipment_modules[${asm.equipment_module_id}].sequential_states[${stateId}]: step "${s.step_id || s.step}" has no transitions but is not terminal`,
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
                  `equipment_modules[${asm.equipment_module_id}].sequential_states[${stateId}]: transition ${tr.transition_id} targets unknown step "${targetId}"`,
                );
                continue;
              }
              if (
                !isBranchTransitionLegal(sourceBranch, targetBranch, branchMeta)
              ) {
                issues.push(
                  `equipment_modules[${asm.equipment_module_id}].sequential_states[${stateId}]: transition ${tr.transition_id} crosses branches (${sourceBranch} -> ${targetBranch}). Cross-branch transitions are illegal; use a MonitorV2 with effect="fault" for pre-emption.`,
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
