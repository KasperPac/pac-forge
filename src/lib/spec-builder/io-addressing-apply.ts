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
import type { InstrumentTag, UnitConfig } from "@/types/spec-builder";
import type { AddressableSignal, IoAssignment } from "@/lib/spec-builder/io-addressing";
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

/** tag → assigned address. Shared by both appliers so they cannot disagree. */
function addressByTag(assignments: IoAssignment[]): Map<string, string> {
  return new Map(assignments.map((a) => [a.tag, a.to]));
}

/**
 * Write assignments onto the hierarchy. Immutable, and keyed by tag rather
 * than position, so a tag appearing in more than one place receives the one
 * address everywhere. Unchanged signals keep their identity, so React sees
 * the smallest possible diff.
 */
export function applyIoAddresses(
  units: UnitConfig[],
  assignments: IoAssignment[],
): UnitConfig[] {
  if (assignments.length === 0) return units;
  const byTag = addressByTag(assignments);

  return units.map((unit) => ({
    ...unit,
    equipment_modules: unit.equipment_modules.map((em) => ({
      ...em,
      control_modules: em.control_modules.map((cm) => ({
        ...cm,
        io_signals: cm.io_signals.map((sig) => {
          const to = byTag.get(sig.tag?.trim() ?? "");
          return to === undefined || sig.io_address === to ? sig : { ...sig, io_address: to };
        }),
      })),
    })),
  }));
}

/**
 * Same rewrite against the in-session instrument register, so a tag wired on
 * a later wizard step does not arrive carrying a stale address
 * (`assignTagToSignal` copies io_address straight off the register tag). The
 * `instrument_registers` row itself is never written — it is the as-received
 * import and keeps its provenance.
 */
export function applyRegisterAddresses(
  tags: InstrumentTag[],
  assignments: IoAssignment[],
): InstrumentTag[] {
  if (assignments.length === 0) return tags;
  const byTag = addressByTag(assignments);

  return tags.map((t) => {
    const to = byTag.get(t.tag?.trim() ?? "");
    return to === undefined || t.io_address === to ? t : { ...t, io_address: to };
  });
}
