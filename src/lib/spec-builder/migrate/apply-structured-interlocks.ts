import type {
  InterAssemblyInterlock,
  SubsystemStateSequence,
} from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "./types";

/**
 * Returns a new orchestrations record where each interlock whose
 * `interlock_id` matches a row in `proposals` has its `effect` and
 * `source_condition` replaced by the engineer-confirmed proposal.
 * Interlocks without a matching proposal pass through unchanged. Prose is
 * always preserved (used by DOCX rendering).
 */
export function applyStructuredInterlocks(
  orchestrations: Record<string, Record<string, SubsystemStateSequence>>,
  proposals: ProposedInterlock[],
): Record<string, Record<string, SubsystemStateSequence>> {
  const byId = new Map(proposals.map((p) => [p.interlock_id, p]));
  const out: Record<string, Record<string, SubsystemStateSequence>> = {};

  for (const [subsystemId, stateMap] of Object.entries(orchestrations)) {
    out[subsystemId] = {};
    for (const [stateKey, seq] of Object.entries(stateMap)) {
      const updated: InterAssemblyInterlock[] = (
        seq.inter_assembly_interlocks ?? []
      ).map((il) => {
        const proposal = byId.get(il.interlock_id);
        if (!proposal) return il;
        return {
          ...il,
          effect: proposal.effect,
          source_condition: proposal.source_condition,
        };
      });
      out[subsystemId][stateKey] = {
        ...seq,
        inter_assembly_interlocks: updated,
      };
    }
  }

  return out;
}
