import type { InstrumentTag } from "@/types/spec-builder";
import type { Hierarchy } from "@/types/spec-contract-v2";
import { buildHierarchyFromTags } from "@/lib/spec-builder/instrument-parser";
import { mintHierarchyUuids } from "@/lib/spec-builder/mint-uuids";

/**
 * Register tags → V2 hierarchy: real EMs/CMs/IO from buildHierarchyFromTags,
 * IO tagged source="wired", all ids minted to UUIDs. This is the deterministic
 * structural backbone for register-aware ingest — no AI involved.
 */
export function registerToHierarchy(tags: InstrumentTag[]): Hierarchy {
  const units = buildHierarchyFromTags(tags);
  const v2: Hierarchy = {
    units: units.map((u) => ({
      unit_id: u.unit_id,
      unit_name: u.unit_name,
      equipment_type: u.equipment_type,
      description: u.description,
      excluded: u.excluded,
      equipment_modules: u.equipment_modules.map((em) => ({
        equipment_module_id: em.equipment_module_id,
        equipment_module_name: em.equipment_module_name,
        description: em.description,
        control_modules: em.control_modules.map((cm) => ({
          control_module_id: cm.control_module_id,
          control_module_name: cm.control_module_name,
          control_module_class: cm.control_module_class,
          is_safety: cm.is_safety,
          description: cm.description,
          io_signals: cm.io_signals.map((s) => ({
            tag: s.tag,
            signal_type: s.signal_type,
            io_address: s.io_address,
            description: s.description,
            source: "wired" as const,
          })),
        })),
      })),
    })),
  } as unknown as Hierarchy;
  return mintHierarchyUuids(v2);
}
