import type { SpecContractV2, SignalType } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";
import type { DashDevice, DashTag, DashCommand, DashTagType } from "@/types/commissioning-dashboard";

/** DI/DO → Bool; AI/AO → Real. ("internal" signals are skipped in Plan 1.) */
function dashType(sig: SignalType): DashTagType {
  return sig === "AI" || sig === "AO" ? "Real" : "Bool";
}

export function buildDevices(
  contract: SpecContractV2,
  compile: CodegenResult,
): { devices: DashDevice[]; warnings: string[] } {
  const warnings: string[] = [];
  // instance DBs by owning control-module id, from the compile result
  const dbByOwner = new Map<string, string>();
  for (const a of compile.artifacts) {
    if (a.type === "DB" && a.ownerId) dbByOwner.set(a.ownerId, a.name);
  }

  const devices: DashDevice[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const signals: DashTag[] = [];
        const commands: DashCommand[] = [];
        for (const sig of cm.io_signals) {
          if (sig.signal_type === "internal") continue;
          signals.push({ id: sig.tag, type: dashType(sig.signal_type), label: sig.description || sig.tag });
          // Outputs (DO) are operator-drivable as momentary commands.
          if (sig.signal_type === "DO") {
            commands.push({ tag: sig.tag, type: "Bool", label: sig.description || sig.tag, momentary: true });
          }
        }
        if (signals.length === 0) warnings.push(`Device ${cm.control_module_name}: no IO signals — nothing to display`);
        devices.push({
          id: cm.control_module_id,
          name: cm.control_module_name,
          tag: cm.control_module_name, // contract CMs carry no short tag; name doubles as the label
          deviceType: cm.control_module_class,
          instanceDb: dbByOwner.get(cm.control_module_id) ?? null,
          signals,
          commands,
        });
      }
    }
  }
  return { devices, warnings };
}
