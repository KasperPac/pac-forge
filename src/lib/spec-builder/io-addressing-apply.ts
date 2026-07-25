/**
 * Adapter between the legacy `confirmed_units` hierarchy and the deterministic
 * addressing engine (G0-18).
 *
 * `io-addressing.ts` depends on `HardwareModelV1` alone; the legacy UnitConfig
 * shape stays here so the engine is reusable against the V2 contract later.
 *
 * The collector's selection rules MIRROR `deriveIoTags`
 * (src/lib/spec-builder/codegen/io-tag-table.ts) deliberately: a channel must
 * be allocated for precisely the signals that become TIA tags. If the two sets
 * ever diverge, every address after the point of disagreement silently shifts.
 *
 * Pure module: no React, no IO.
 * Design: Docs/superpowers/specs/2026-07-25-io-readdress-design.md
 */
import type { UnitConfig } from "@/types/spec-builder";
import type { AddressableSignal } from "@/lib/spec-builder/io-addressing";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";

/**
 * Walk unit → equipment module → control module → signal in array order and
 * collect everything needing a physical channel. Excluded units, telegram
 * signals, blank placeholder rows and non-physical classes are skipped; a
 * duplicated tag is collected once, first occurrence winning, matching
 * `deriveIoTags`' "keeping first" rule.
 */
export function collectAddressableSignals(units: UnitConfig[]): AddressableSignal[] {
  const out: AddressableSignal[] = [];
  const seen = new Set<string>();

  for (const unit of units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        for (const sig of cm.io_signals) {
          const tag = sig.tag?.trim();
          if (!tag || seen.has(tag)) continue;
          if (sig.source === "network_telegram") continue;

          // Tolerant of Siemens (DQ/AQ) and mixed case; unknown → "internal".
          const signal_type = convertSignalDirection(sig.signal_type);
          if (signal_type === "internal") continue;

          seen.add(tag);
          out.push({ tag, signal_type, io_address: sig.io_address });
        }
      }
    }
  }
  return out;
}
