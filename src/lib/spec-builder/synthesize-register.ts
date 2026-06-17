import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { InstrumentTag, UnitSummary, ControlModuleClass, SignalDirection } from "@/types/spec-builder";
import { groupSubsystems } from "@/lib/spec-builder/instrument-parser";

const DIRECTIONS: ReadonlySet<string> = new Set(["DI", "DO", "AI", "AO"]);

function toDirection(signalType: string): SignalDirection {
  const s = signalType.trim().toUpperCase();
  return (DIRECTIONS.has(s) ? s : "internal") as SignalDirection;
}

/**
 * Flatten an ingested SpecContractV2 hierarchy into the same shapes the
 * instrument-register upload path produces, so a register can be synthesized
 * for projects that only have a customer .docx. The contract already carries
 * classification (control_module_class, is_safety), so no AI/heuristic pass.
 */
export function synthesizeRegisterFromContract(
  contract: SpecContractV2,
): { tags: InstrumentTag[]; units: UnitSummary[] } {
  const tags: InstrumentTag[] = [];
  for (const unit of contract.hierarchy?.units ?? []) {
    for (const em of unit.equipment_modules ?? []) {
      for (const cm of em.control_modules ?? []) {
        for (const sig of cm.io_signals ?? []) {
          tags.push({
            tag: sig.tag,
            device_type: cm.control_module_class,
            description: sig.description,
            signal_type: sig.signal_type,
            io_address: sig.io_address,
            control_module_class: cm.control_module_class as ControlModuleClass,
            signal_direction: toDirection(sig.signal_type),
            unit_prefix: unit.unit_name,
            is_safety: cm.is_safety,
            process_cell: "",
            unit: unit.unit_name,
            equipment_module: em.equipment_module_name,
            control_module: cm.control_module_name,
          });
        }
      }
    }
  }
  return { tags, units: groupSubsystems(tags) };
}
