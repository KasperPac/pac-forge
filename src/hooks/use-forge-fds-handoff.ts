/**
 * Composes FDS data into forge-friendly AssemblyBrief objects AND
 * proper ForgeAssemblyEntry[] with consistent IDs.
 *
 * When spec_project_id is set: reads fds_assembly_sessions + spec_projects directly.
 * When null: returns empty (caller falls back to SpecAnalysis / AI contract path).
 *
 * ID STRATEGY: In FDS-linked mode, ForgeAssemblyEntry.id === FDS assembly_id
 * from spec_projects.confirmed_subsystems. Briefs are keyed by the same ID.
 * This ensures brief lookup (`briefs[asm.id]`) always works.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useFdsSessionsForProject } from "@/hooks/use-fds-session";
import type { FdsAssemblySession, OperatingState, SubsystemConfig } from "@/types/spec-builder";
import type { AssemblyBriefMap, AssemblyAlarm } from "@/types/forge-brief";
import type { ForgeAssemblyEntry, IoSignalType } from "@/types/forge";

// ---------------------------------------------------------------------------
// Fetch spec_project metadata (operating states, subsystems, alarm spec)
// ---------------------------------------------------------------------------

interface SpecProjectMeta {
  confirmed_states: OperatingState[];
  confirmed_subsystems: SubsystemConfig[];
}

function useSpecProjectMeta(specProjectId: string | undefined) {
  return useQuery({
    queryKey: ["spec_projects", "meta", specProjectId],
    queryFn: async () => {
      if (!specProjectId) return null;
      const { data, error } = await supabase
        .from("spec_projects")
        .select("confirmed_states, confirmed_subsystems")
        .eq("id", specProjectId)
        .single();
      if (error) throw error;
      return data as SpecProjectMeta;
    },
    enabled: !!specProjectId,
  });
}

function useAlarmSpec(specProjectId: string | undefined) {
  return useQuery({
    queryKey: ["spec_sections", "alarm_specification", specProjectId],
    queryFn: async () => {
      if (!specProjectId) return null;
      const { data, error } = await supabase
        .from("spec_sections")
        .select("content_json")
        .eq("spec_project_id", specProjectId)
        .eq("section_type", "alarm_specification")
        .maybeSingle();
      if (error) throw error;
      return data?.content_json as {
        alarm_tiers?: Array<{
          tier_name: string;
          alarms: Array<{
            tag: string;
            description: string;
            action: string;
            setpoint: string;
            delay: string;
          }>;
        }>;
      } | null;
    },
    enabled: !!specProjectId,
  });
}

// ---------------------------------------------------------------------------
// IO signal type normalization: IEC (DO/AO) → Siemens (DQ/AQ)
// ---------------------------------------------------------------------------

const SIGNAL_TYPE_MAP: Record<string, IoSignalType> = {
  DI: "DI",
  DO: "DQ",
  AI: "AI",
  AO: "AQ",
  DQ: "DQ",
  AQ: "AQ",
};

export function normalizeSignalType(raw: string): IoSignalType {
  return SIGNAL_TYPE_MAP[raw.toUpperCase()] ?? "DI";
}

// ---------------------------------------------------------------------------
// Build ForgeAssemblyEntry[] from FDS hierarchy
// ---------------------------------------------------------------------------

function buildAssemblyEntries(
  subsystems: SubsystemConfig[],
  forgeDeviceList?: Array<{ id: string; name: string; tag: string }>,
): ForgeAssemblyEntry[] {
  // Build a name/tag → forge device ID map for reconciling FDS ↔ forge device IDs
  const deviceNameMap = new Map<string, string>();
  for (const d of forgeDeviceList ?? []) {
    deviceNameMap.set(d.name.toLowerCase(), d.id);
    deviceNameMap.set(d.tag.toLowerCase(), d.id);
  }

  const entries: ForgeAssemblyEntry[] = [];
  for (const sub of subsystems) {
    if (sub.excluded) continue;
    for (const asm of sub.assemblies) {
      // Map FDS device_ids to forge device_list IDs using name/tag matching
      const mappedDeviceIds = asm.devices.map((d) => {
        const byName = deviceNameMap.get(d.device_name.toLowerCase());
        if (byName) return byName;
        // Fall back to FDS device_id
        return d.device_id;
      });

      entries.push({
        id: asm.assembly_id,
        name: asm.assembly_name,
        tag: extractTag(asm.assembly_name, asm.assembly_id),
        assembly_type: sub.equipment_type,
        description: asm.description,
        subsystem: sub.subsystem_name,
        device_ids: mappedDeviceIds,
        fb_template_id: null,
        fb_match_confidence: "none",
        language_override: null,
        approved: false,
      });
    }
  }
  return entries;
}

/**
 * Extract a short PLC tag from an assembly name or fall back to assembly_id.
 * e.g. "Conveyor CV01" → "CV01", "Lift Table LFT01" → "LFT01"
 */
function extractTag(name: string, fallback: string): string {
  // Look for a trailing alphanumeric tag (letters + digits) at end of name
  const match = name.match(/\b([A-Z]{2,}[_-]?\d+)\b/i);
  if (match) return match[1];
  // Fall back to last word if it looks tag-like
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (/[A-Z]/i.test(last) && /\d/.test(last)) return last;
  return fallback;
}

// ---------------------------------------------------------------------------
// Build assembly briefs from FDS data
// ---------------------------------------------------------------------------

function buildBriefsFromFds(
  fdsSessions: FdsAssemblySession[],
  meta: SpecProjectMeta | null,
  alarmContent: { alarm_tiers?: Array<{ tier_name: string; alarms: Array<{ tag: string; description: string; action: string; setpoint: string; delay: string }> }> } | null,
  forgeDeviceList?: Array<{ id: string; name: string; tag: string }>,
): AssemblyBriefMap {
  const operatingStates = (meta?.confirmed_states ?? []) as OperatingState[];
  const subsystems = meta?.confirmed_subsystems ?? [];

  // Build name/tag → forge device ID map for reconciling FDS ↔ forge device IDs
  const deviceNameMap = new Map<string, string>();
  for (const d of forgeDeviceList ?? []) {
    deviceNameMap.set(d.name.toLowerCase(), d.id);
    deviceNameMap.set(d.tag.toLowerCase(), d.id);
  }

  // Flatten all alarms for matching
  const allAlarms: AssemblyAlarm[] = [];
  for (const tier of alarmContent?.alarm_tiers ?? []) {
    for (const alarm of tier.alarms) {
      allAlarms.push({
        code: alarm.tag,
        name: alarm.tag,
        severity: tier.tier_name,
        description: alarm.description,
        triggerCondition: alarm.setpoint,
        action: alarm.action,
      });
    }
  }

  const briefs: AssemblyBriefMap = {};

  for (const session of fdsSessions) {
    // Find subsystem + assembly config from the hierarchy
    const subsystem = subsystems.find((s) => s.subsystem_id === session.subsystem_id);
    const assemblyConfig = subsystem?.assemblies?.find((a) => a.assembly_id === session.assembly_id);

    // Match alarms to this assembly's devices
    const deviceTags = (assemblyConfig?.devices ?? []).map((d) => d.device_name);
    const assemblyAlarms = allAlarms.filter((a) =>
      deviceTags.some((tag) => a.code.includes(tag) || a.description.toLowerCase().includes(tag.toLowerCase())),
    );

    const asmName = assemblyConfig?.assembly_name ?? session.assembly_id;
    briefs[session.assembly_id] = {
      assemblyId: session.assembly_id,
      assemblyTag: extractTag(asmName, session.assembly_id),
      assemblyName: asmName,
      assemblyType: subsystem?.equipment_type ?? "Unknown",
      subsystemName: subsystem?.subsystem_name ?? session.subsystem_id,
      deviceIds: (assemblyConfig?.devices ?? []).map((d) => {
        const byName = deviceNameMap.get(d.device_name.toLowerCase());
        return byName ?? d.device_id;
      }),
      operatingStates,
      staticStates: session.static_states ?? {},
      sequentialStates: session.sequential_states ?? {},
      alarmConditions: assemblyAlarms,
      annotations: [],
      approved: false,
      source: "fds",
    };
  }

  return briefs;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export interface FdsHandoff {
  /** Assembly briefs keyed by assemblyId — empty if no spec_project_id */
  briefs: AssemblyBriefMap;
  /** Properly typed ForgeAssemblyEntry[] built from FDS hierarchy.
   *  IDs match the brief map keys so `briefs[entry.id]` always works. */
  assemblyEntries: ForgeAssemblyEntry[];
  /** Operating states from the FDS */
  operatingStates: OperatingState[];
  /** Whether FDS data is being loaded */
  loading: boolean;
  /** Whether a spec_project_id is linked (FDS mode vs standalone mode) */
  isFdsLinked: boolean;
}

export function useForgeFdsHandoff(
  specProjectId: string | null | undefined,
  forgeDeviceList?: Array<{ id: string; name: string; tag: string }>,
): FdsHandoff {
  const enabled = !!specProjectId;

  const { data: fdsSessions, isLoading: sessionsLoading } = useFdsSessionsForProject(
    enabled ? specProjectId! : undefined,
  );
  const { data: meta, isLoading: metaLoading } = useSpecProjectMeta(
    enabled ? specProjectId! : undefined,
  );
  const { data: alarmContent, isLoading: alarmsLoading } = useAlarmSpec(
    enabled ? specProjectId! : undefined,
  );

  const loading = sessionsLoading || metaLoading || alarmsLoading;

  const briefs = useMemo(() => {
    if (!enabled || !fdsSessions?.length) return {};
    // Only include complete sessions
    const completeSessions = fdsSessions.filter((s) => s.status === "complete");
    return buildBriefsFromFds(completeSessions, meta ?? null, alarmContent ?? null, forgeDeviceList);
  }, [enabled, fdsSessions, meta, alarmContent, forgeDeviceList]);

  const assemblyEntries = useMemo(() => {
    if (!enabled || !meta?.confirmed_subsystems?.length) return [];
    return buildAssemblyEntries(meta.confirmed_subsystems, forgeDeviceList);
  }, [enabled, meta, forgeDeviceList]);

  const operatingStates = useMemo(
    () => (meta?.confirmed_states ?? []) as OperatingState[],
    [meta],
  );

  return {
    briefs,
    assemblyEntries,
    operatingStates,
    loading,
    isFdsLinked: enabled,
  };
}
