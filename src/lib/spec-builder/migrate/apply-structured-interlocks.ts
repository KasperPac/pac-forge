import type {
  InterEquipmentModuleInterlock,
  UnitProcedureSequence,
} from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "./types";

/**
 * Returns a new unit_procedures record where each interlock whose
 * `interlock_id` matches a row in `proposals` has its `effect` and
 * `source_condition` replaced by the engineer-confirmed proposal.
 * Interlocks without a matching proposal pass through unchanged. Prose is
 * always preserved (used by DOCX rendering).
 */
export function applyStructuredInterlocks(
  unit_procedures: Record<string, Record<string, UnitProcedureSequence>>,
  proposals: ProposedInterlock[],
): Record<string, Record<string, UnitProcedureSequence>> {
  const byId = new Map(proposals.map((p) => [p.interlock_id, p]));
  const out: Record<string, Record<string, UnitProcedureSequence>> = {};

  for (const [unitId, stateMap] of Object.entries(unit_procedures)) {
    out[unitId] = {};
    for (const [stateKey, seq] of Object.entries(stateMap)) {
      const updated: InterEquipmentModuleInterlock[] = (
        seq.inter_equipment_module_interlocks ?? []
      ).map((il) => {
        const proposal = byId.get(il.interlock_id);
        if (!proposal) return il;
        return {
          ...il,
          effect: proposal.effect,
          source_condition: proposal.source_condition,
        };
      });
      out[unitId][stateKey] = {
        ...seq,
        inter_equipment_module_interlocks: updated,
      };
    }
  }

  return out;
}
