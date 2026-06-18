/**
 * Memoised indexer across a SpecContractV2 — produces flat picker-ready lists
 * with denormalised resolution fields. Every entry carries a `searchKey` that
 * concatenates display strings for fuzzy matching in `cmdk`.
 *
 * Memo key: `schema_version + project.id + unit/equipment_module/device name
 * signature`. Avoids rebuilding when TanStack Query re-emits the same contract.
 */
import { useMemo } from "react";
import type {
  SpecContractV2,
  IoSignalTier,
  SignalType,
} from "@/types/spec-contract-v2";

export interface IndexedTag {
  tag: string;
  signal_type: SignalType;
  signal_direction: "input" | "output" | "internal";
  io_address: string;
  description: string;
  tier: IoSignalTier;
  is_safety: boolean;
  control_module_id: string;
  control_module_name: string;
  equipment_module_id: string;
  equipment_module_name: string;
  unit_id: string;
  unit_name: string;
  groupLabel: string; // unit / equipment_module / device
  searchKey: string;
}

export interface IndexedDevice {
  control_module_id: string;
  control_module_name: string;
  control_module_class: string;
  is_safety: boolean;
  description: string;
  equipment_module_id: string;
  equipment_module_name: string;
  unit_id: string;
  unit_name: string;
  groupLabel: string; // unit / equipment_module
  searchKey: string;
}

export interface IndexedAssembly {
  equipment_module_id: string;
  equipment_module_name: string;
  description: string;
  control_module_count: number;
  unit_id: string;
  unit_name: string;
  groupLabel: string; // unit
  searchKey: string;
}

export interface IndexedSubsystem {
  unit_id: string;
  unit_name: string;
  equipment_type: string;
  excluded: boolean;
  description: string;
  equipment_module_count: number;
  searchKey: string;
}

export interface IndexedState {
  state_id: string;
  state_name: string;
  state_pattern: "static" | "sequential";
  description: string;
  searchKey: string;
}

export interface IndexedFault {
  fault_code: string;
  description: string;
  severity: "warning" | "fault" | "critical";
  affected_control_modules: string[];
  searchKey: string;
}

export interface PickerIndex {
  tags: IndexedTag[];
  control_modules: IndexedDevice[];
  equipment_modules: IndexedAssembly[];
  units: IndexedSubsystem[];
  states: IndexedState[];
  faults: IndexedFault[];
}

function directionForSignalType(
  t: SignalType,
): "input" | "output" | "internal" {
  switch (t) {
    case "DI":
    case "AI":
      return "input";
    case "DO":
    case "AO":
      return "output";
    default:
      return "internal";
  }
}

export function usePickerIndex(
  contract: SpecContractV2 | null | undefined,
): PickerIndex {
  return useMemo(() => {
    const empty: PickerIndex = {
      tags: [],
      control_modules: [],
      equipment_modules: [],
      units: [],
      states: [],
      faults: [],
    };
    if (!contract) return empty;

    const tags: IndexedTag[] = [];
    const control_modules: IndexedDevice[] = [];
    const equipment_modules: IndexedAssembly[] = [];
    const units: IndexedSubsystem[] = [];

    for (const sub of contract.hierarchy.units) {
      units.push({
        unit_id: sub.unit_id,
        unit_name: sub.unit_name,
        equipment_type: sub.equipment_type,
        excluded: sub.excluded,
        description: sub.description,
        equipment_module_count: sub.equipment_modules.length,
        searchKey:
          `${sub.unit_name} ${sub.equipment_type} ${sub.description}`.toLowerCase(),
      });

      for (const asm of sub.equipment_modules) {
        equipment_modules.push({
          equipment_module_id: asm.equipment_module_id,
          equipment_module_name: asm.equipment_module_name,
          description: asm.description,
          control_module_count: asm.control_modules.length,
          unit_id: sub.unit_id,
          unit_name: sub.unit_name,
          groupLabel: sub.unit_name,
          searchKey:
            `${sub.unit_name} ${asm.equipment_module_name} ${asm.description}`.toLowerCase(),
        });

        for (const dev of asm.control_modules) {
          control_modules.push({
            control_module_id: dev.control_module_id,
            control_module_name: dev.control_module_name,
            control_module_class: dev.control_module_class,
            is_safety: dev.is_safety,
            description: dev.description,
            equipment_module_id: asm.equipment_module_id,
            equipment_module_name: asm.equipment_module_name,
            unit_id: sub.unit_id,
            unit_name: sub.unit_name,
            groupLabel: `${sub.unit_name} / ${asm.equipment_module_name}`,
            searchKey:
              `${sub.unit_name} ${asm.equipment_module_name} ${dev.control_module_name} ${dev.control_module_class} ${dev.description}`.toLowerCase(),
          });

          for (const sig of dev.io_signals) {
            const dir = directionForSignalType(sig.signal_type);
            tags.push({
              tag: sig.tag,
              signal_type: sig.signal_type,
              signal_direction: dir,
              io_address: sig.io_address,
              description: sig.description,
              tier: sig.tier ?? "wired",
              is_safety: dev.is_safety,
              control_module_id: dev.control_module_id,
              control_module_name: dev.control_module_name,
              equipment_module_id: asm.equipment_module_id,
              equipment_module_name: asm.equipment_module_name,
              unit_id: sub.unit_id,
              unit_name: sub.unit_name,
              groupLabel: `${sub.unit_name} / ${asm.equipment_module_name} / ${dev.control_module_name}`,
              searchKey:
                `${sig.tag} ${sig.signal_type} ${sig.io_address} ${sig.description} ${dev.control_module_name} ${asm.equipment_module_name}`.toLowerCase(),
            });
          }
        }
      }
    }

    // States are authored per-EM (hybrid state model). Build a project-wide
    // union (dedup by EM-local state_id) for the picker; there is no global
    // operating-states layer anymore.
    const stateById = new Map<string, IndexedState>();
    for (const asm of Object.values(contract.equipment_modules)) {
      for (const s of asm.states ?? []) {
        if (stateById.has(s.state_id)) continue;
        stateById.set(s.state_id, {
          state_id: s.state_id,
          state_name: s.name,
          state_pattern: s.kind,
          description: "",
          searchKey: `${s.state_id} ${s.name}`.toLowerCase(),
        });
      }
    }
    const states: IndexedState[] = Array.from(stateById.values());

    const faults: IndexedFault[] = contract.faults.map((f) => ({
      fault_code: f.fault_code,
      description: f.description,
      severity: f.severity,
      affected_control_modules: f.affected_control_modules,
      searchKey:
        `${f.fault_code} ${f.description} ${f.severity}`.toLowerCase(),
    }));

    return { tags, control_modules, equipment_modules, units, states, faults };
    // Memo signature — schema_version + project id + hierarchy length
    // signature. Callers that swap project id will refresh automatically.
  }, [contract]);
}
