/**
 * io-tag-table — derive the PLC tag table from the contract's wired IO
 * signals so Send-to-TIA can create every physical tag the generated code
 * references (G9-W4: compiling into a fresh project failed with "Tag not
 * defined" for every physical IO access because no tag table existed).
 *
 * The writers emit `"<signal.tag>"` verbatim (em-writer MAP section,
 * io-conditioning-writer, maintenance-writer override FC, unit-writer
 * routing reads), so the tag NAME here is `signal.tag` unchanged — the
 * contract is the single source of truth and name drift is impossible.
 */
import type { SpecContractV2, SignalType } from "@/types/spec-contract-v2";
import type { MigrationTagDto } from "@/lib/tia-bridge-contract";

/** Tag table the send flow creates/uses in TIA. */
export const IO_TAG_TABLE_NAME = "PacForge IO Tags";

export interface IoTagDerivation {
  tags: MigrationTagDto[];
  warnings: string[];
}

/** S7-1500 tag data type per FDS signal type. `internal` has no physical tag. */
const DATA_TYPE: Partial<Record<SignalType, string>> = {
  DI: "Bool",
  DO: "Bool",
  AI: "Int",
  AO: "Int",
};

/** Normalize an FDS io_address to TIA absolute notation (leading %). */
function normalizeAddress(addr: string): string {
  const trimmed = addr.trim();
  return trimmed.startsWith("%") ? trimmed : `%${trimmed}`;
}

/**
 * Walk every non-excluded unit → EM → CM → io_signal and collect the wired
 * physical tags. Telegram signals are excluded (they are addressed through
 * the drive/telegram path, not symbolic IO tags); signals without an
 * io_address are skipped with a warning. Duplicate tag names are deduped;
 * a duplicate with a conflicting address/type keeps the first and warns.
 */
export function deriveIoTags(contract: Pick<SpecContractV2, "hierarchy">): IoTagDerivation {
  const byName = new Map<string, MigrationTagDto>();
  const warnings: string[] = [];

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        for (const s of cm.io_signals) {
          if (s.source !== "wired") continue;
          const dataType = DATA_TYPE[s.signal_type];
          if (!dataType) continue;
          if (!s.io_address || !s.io_address.trim()) {
            warnings.push(
              `IO tag "${s.tag}" (${cm.control_module_name}) has no io_address — not created; compile will fail on it`,
            );
            continue;
          }
          const candidate: MigrationTagDto = {
            name: s.tag,
            dataType,
            address: normalizeAddress(s.io_address),
          };
          const existing = byName.get(s.tag);
          if (existing) {
            if (existing.address !== candidate.address || existing.dataType !== candidate.dataType) {
              warnings.push(
                `IO tag "${s.tag}" defined twice with conflicting address/type ` +
                  `(${existing.address} ${existing.dataType} vs ${candidate.address} ${candidate.dataType}) — keeping first`,
              );
            }
            continue;
          }
          byName.set(s.tag, candidate);
        }
      }
    }
  }

  return { tags: [...byName.values()], warnings };
}
