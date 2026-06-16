/**
 * FDS handoff — now a pure reader over the spec contract.
 *
 * Wave 5: this hook previously stitched together FDS session rows + spec
 * project meta + alarm spec with name-based reconciliation. All of that is
 * gone — every spec-shaped read goes through `useSpecContract`, which
 * returns canonical IEC signal types and keys everything by `equipment_module_id`.
 *
 * Returns briefs keyed by `equipment_module_id` (not name-mapped), equipment_module
 * entries whose `id` matches the brief key, and the operating states
 * from the contract header. No Siemens dialect conversion happens here.
 */
import { useMemo } from "react";
import { useSpecContract } from "@/hooks/use-spec-contract";
import type { OperatingState } from "@/types/spec-builder";
import type { EquipmentModuleBriefMap, EquipmentModuleAlarm } from "@/types/forge-brief";
import type { ForgeEquipmentModuleEntry } from "@/types/forge";

export interface FdsHandoff {
  /** Assembly briefs keyed by `equipment_module_id`. Empty when no spec_project_id. */
  briefs: EquipmentModuleBriefMap;
  /** Assembly entries with `id === equipment_module_id`. */
  equipment_moduleEntries: ForgeEquipmentModuleEntry[];
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
        briefs: {} as EquipmentModuleBriefMap,
        equipment_moduleEntries: [] as ForgeEquipmentModuleEntry[],
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

    // Build entries + briefs from the hierarchy. Keys are equipment_module_id.
    const briefs: EquipmentModuleBriefMap = {};
    const equipment_moduleEntries: ForgeEquipmentModuleEntry[] = [];

    for (const sub of contract.hierarchy.units) {
      if (sub.excluded) continue;
      for (const asm of sub.equipment_modules) {
        const asmContract = contract.equipment_modules[asm.equipment_module_id];

        // Alarms attached to this equipment_module OR to any of its control_modules.
        const deviceIdSet = new Set(asm.control_modules.map((d) => d.control_module_id));
        const equipment_moduleAlarms: EquipmentModuleAlarm[] = contract.alarms
          .filter(
            (a) =>
              a.equipment_module_id === asm.equipment_module_id ||
              (a.control_module_id && deviceIdSet.has(a.control_module_id)),
          )
          .map((a) => ({
            code: a.tag,
            name: a.tag,
            severity: a.tier_id,
            description: a.description,
            triggerCondition: a.setpoint ?? "",
            action: a.action,
          }));

        briefs[asm.equipment_module_id] = {
          equipment_moduleId: asm.equipment_module_id,
          equipment_moduleTag: asm.equipment_module_name,
          equipment_moduleName: asm.equipment_module_name,
          equipment_moduleType: sub.equipment_type,
          unitName: sub.unit_name,
          deviceIds: asm.control_modules.map((d) => d.control_module_id),
          operatingStates,
          // static_states was widened in Task 8 to `ControlModuleStateEntry[] | StaticStateV2`.
          // The handoff brief expects the legacy `ControlModuleStateEntry[]` shape; unwrap.
          staticStates: asmContract?.static_states
            ? Object.fromEntries(
                Object.entries(asmContract.static_states).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v : v.control_modules,
                ]),
              )
            : {},
          sequentialStates: (asmContract?.sequential_states ?? {}) as unknown as EquipmentModuleBriefMap[string]["sequentialStates"],
          alarmConditions: equipment_moduleAlarms,
          annotations: [],
          approved: false,
          source: "fds",
        };

        equipment_moduleEntries.push({
          id: asm.equipment_module_id,
          name: asm.equipment_module_name,
          tag: asm.equipment_module_name,
          equipment_module_type: sub.equipment_type,
          description: asm.description,
          unit: sub.unit_name,
          control_module_ids: asm.control_modules.map((d) => d.control_module_id),
          fb_template_id: null,
          fb_match_confidence: "none",
          language_override: null,
          approved: false,
        });
      }
    }

    return { briefs, equipment_moduleEntries, operatingStates };
  }, [enabled, contract]);

  return {
    ...result,
    loading: isLoading,
    isFdsLinked: enabled,
  };
}
