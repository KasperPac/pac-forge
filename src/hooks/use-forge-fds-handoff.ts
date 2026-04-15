/**
 * FDS handoff — now a pure reader over the spec contract.
 *
 * Wave 5: this hook previously stitched together FDS session rows + spec
 * project meta + alarm spec with name-based reconciliation. All of that is
 * gone — every spec-shaped read goes through `useSpecContract`, which
 * returns canonical IEC signal types and keys everything by `assembly_id`.
 *
 * Returns briefs keyed by `assembly_id` (not name-mapped), assembly
 * entries whose `id` matches the brief key, and the operating states
 * from the contract header. No Siemens dialect conversion happens here.
 */
import { useMemo } from "react";
import { useSpecContract } from "@/hooks/use-spec-contract";
import type { OperatingState } from "@/types/spec-builder";
import type { AssemblyBriefMap, AssemblyAlarm } from "@/types/forge-brief";
import type { ForgeAssemblyEntry } from "@/types/forge";

export interface FdsHandoff {
  /** Assembly briefs keyed by `assembly_id`. Empty when no spec_project_id. */
  briefs: AssemblyBriefMap;
  /** Assembly entries with `id === assembly_id`. */
  assemblyEntries: ForgeAssemblyEntry[];
  /** Operating states from the contract header. */
  operatingStates: OperatingState[];
  /** Whether the contract is still loading. */
  loading: boolean;
  /** Whether the session is bound to a spec project. */
  isFdsLinked: boolean;
}

export function useForgeFdsHandoff(
  specProjectId: string | null | undefined,
  specRevisionId?: string | null | undefined,
): FdsHandoff {
  const enabled = Boolean(specProjectId);
  const { data: contract, isLoading } = useSpecContract(
    enabled ? specProjectId ?? undefined : undefined,
    specRevisionId ?? undefined,
  );

  const result = useMemo(() => {
    if (!enabled || !contract) {
      return {
        briefs: {} as AssemblyBriefMap,
        assemblyEntries: [] as ForgeAssemblyEntry[],
        operatingStates: [] as OperatingState[],
      };
    }

    // Operating states — contract already stores them in V2 shape.
    const operatingStates = contract.states.map((s) => ({
      state_id: s.state_id,
      state_name: s.state_name,
      description: s.description,
      state_pattern: s.state_pattern,
    })) as OperatingState[];

    // Build entries + briefs from the hierarchy. Keys are assembly_id.
    const briefs: AssemblyBriefMap = {};
    const assemblyEntries: ForgeAssemblyEntry[] = [];

    for (const sub of contract.hierarchy.subsystems) {
      if (sub.excluded) continue;
      for (const asm of sub.assemblies) {
        const asmContract = contract.assemblies[asm.assembly_id];

        // Alarms attached to this assembly OR to any of its devices.
        const deviceIdSet = new Set(asm.devices.map((d) => d.device_id));
        const assemblyAlarms: AssemblyAlarm[] = contract.alarms
          .filter(
            (a) =>
              a.assembly_id === asm.assembly_id ||
              (a.device_id && deviceIdSet.has(a.device_id)),
          )
          .map((a) => ({
            code: a.tag,
            name: a.tag,
            severity: a.tier_id,
            description: a.description,
            triggerCondition: a.setpoint ?? "",
            action: a.action,
          }));

        briefs[asm.assembly_id] = {
          assemblyId: asm.assembly_id,
          assemblyTag: asm.assembly_name,
          assemblyName: asm.assembly_name,
          assemblyType: sub.equipment_type,
          subsystemName: sub.subsystem_name,
          deviceIds: asm.devices.map((d) => d.device_id),
          operatingStates,
          staticStates: asmContract?.static_states ?? {},
          sequentialStates: (asmContract?.sequential_states ?? {}) as AssemblyBriefMap[string]["sequentialStates"],
          alarmConditions: assemblyAlarms,
          annotations: [],
          approved: false,
          source: "fds",
        };

        assemblyEntries.push({
          id: asm.assembly_id,
          name: asm.assembly_name,
          tag: asm.assembly_name,
          assembly_type: sub.equipment_type,
          description: asm.description,
          subsystem: sub.subsystem_name,
          device_ids: asm.devices.map((d) => d.device_id),
          fb_template_id: null,
          fb_match_confidence: "none",
          language_override: null,
          approved: false,
        });
      }
    }

    return { briefs, assemblyEntries, operatingStates };
  }, [enabled, contract]);

  return {
    ...result,
    loading: isLoading,
    isFdsLinked: enabled,
  };
}
