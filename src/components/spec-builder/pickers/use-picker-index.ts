/**
 * Memoised indexer across a SpecContractV2 — produces flat picker-ready lists
 * with denormalised resolution fields. Every entry carries a `searchKey` that
 * concatenates display strings for fuzzy matching in `cmdk`.
 *
 * Memo key: `schema_version + project.id + subsystem/assembly/device name
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
  device_id: string;
  device_name: string;
  assembly_id: string;
  assembly_name: string;
  subsystem_id: string;
  subsystem_name: string;
  groupLabel: string; // subsystem / assembly / device
  searchKey: string;
}

export interface IndexedDevice {
  device_id: string;
  device_name: string;
  device_class: string;
  is_safety: boolean;
  description: string;
  assembly_id: string;
  assembly_name: string;
  subsystem_id: string;
  subsystem_name: string;
  groupLabel: string; // subsystem / assembly
  searchKey: string;
}

export interface IndexedAssembly {
  assembly_id: string;
  assembly_name: string;
  description: string;
  device_count: number;
  subsystem_id: string;
  subsystem_name: string;
  groupLabel: string; // subsystem
  searchKey: string;
}

export interface IndexedSubsystem {
  subsystem_id: string;
  subsystem_name: string;
  equipment_type: string;
  excluded: boolean;
  description: string;
  assembly_count: number;
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
  severity: "warning" | "fault";
  affected_devices: string[];
  searchKey: string;
}

export interface PickerIndex {
  tags: IndexedTag[];
  devices: IndexedDevice[];
  assemblies: IndexedAssembly[];
  subsystems: IndexedSubsystem[];
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
      devices: [],
      assemblies: [],
      subsystems: [],
      states: [],
      faults: [],
    };
    if (!contract) return empty;

    const tags: IndexedTag[] = [];
    const devices: IndexedDevice[] = [];
    const assemblies: IndexedAssembly[] = [];
    const subsystems: IndexedSubsystem[] = [];

    for (const sub of contract.hierarchy.subsystems) {
      subsystems.push({
        subsystem_id: sub.subsystem_id,
        subsystem_name: sub.subsystem_name,
        equipment_type: sub.equipment_type,
        excluded: sub.excluded,
        description: sub.description,
        assembly_count: sub.assemblies.length,
        searchKey:
          `${sub.subsystem_name} ${sub.equipment_type} ${sub.description}`.toLowerCase(),
      });

      for (const asm of sub.assemblies) {
        assemblies.push({
          assembly_id: asm.assembly_id,
          assembly_name: asm.assembly_name,
          description: asm.description,
          device_count: asm.devices.length,
          subsystem_id: sub.subsystem_id,
          subsystem_name: sub.subsystem_name,
          groupLabel: sub.subsystem_name,
          searchKey:
            `${sub.subsystem_name} ${asm.assembly_name} ${asm.description}`.toLowerCase(),
        });

        for (const dev of asm.devices) {
          devices.push({
            device_id: dev.device_id,
            device_name: dev.device_name,
            device_class: dev.device_class,
            is_safety: dev.is_safety,
            description: dev.description,
            assembly_id: asm.assembly_id,
            assembly_name: asm.assembly_name,
            subsystem_id: sub.subsystem_id,
            subsystem_name: sub.subsystem_name,
            groupLabel: `${sub.subsystem_name} / ${asm.assembly_name}`,
            searchKey:
              `${sub.subsystem_name} ${asm.assembly_name} ${dev.device_name} ${dev.device_class} ${dev.description}`.toLowerCase(),
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
              device_id: dev.device_id,
              device_name: dev.device_name,
              assembly_id: asm.assembly_id,
              assembly_name: asm.assembly_name,
              subsystem_id: sub.subsystem_id,
              subsystem_name: sub.subsystem_name,
              groupLabel: `${sub.subsystem_name} / ${asm.assembly_name} / ${dev.device_name}`,
              searchKey:
                `${sig.tag} ${sig.signal_type} ${sig.io_address} ${sig.description} ${dev.device_name} ${asm.assembly_name}`.toLowerCase(),
            });
          }
        }
      }
    }

    const states: IndexedState[] = contract.states.map((s) => ({
      state_id: s.state_id,
      state_name: s.state_name,
      state_pattern: s.state_pattern,
      description: s.description,
      searchKey: `${s.state_id} ${s.state_name} ${s.description}`.toLowerCase(),
    }));

    const faults: IndexedFault[] = contract.faults.map((f) => ({
      fault_code: f.fault_code,
      description: f.description,
      severity: f.severity,
      affected_devices: f.affected_devices,
      searchKey:
        `${f.fault_code} ${f.description} ${f.severity}`.toLowerCase(),
    }));

    return { tags, devices, assemblies, subsystems, states, faults };
    // Memo signature — schema_version + project id + hierarchy length
    // signature. Callers that swap project id will refresh automatically.
  }, [contract]);
}
