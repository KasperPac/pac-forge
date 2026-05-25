import { useQuery } from "@tanstack/react-query";
import { proposeModes } from "@/lib/spec-builder/migrate/propose-modes";
import { proposeStateMapping } from "@/lib/spec-builder/migrate/propose-states";
import { classifyInterlocks } from "@/lib/spec-builder/migrate/interlock-classifier";
import type { RawInterlock } from "@/lib/spec-builder/migrate/interlock-classifier";
import type {
  ProposedInterlock,
  ProposedModes,
  ProposedStateMapping,
} from "@/lib/spec-builder/migrate/types";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

export interface MigrationProposal {
  modes: ProposedModes;
  states: ProposedStateMapping[];
  interlocks: ProposedInterlock[];
}

function collectRawInterlocks(contract: SpecContractV2): RawInterlock[] {
  const out: RawInterlock[] = [];
  for (const [, stateMap] of Object.entries(contract.orchestrations)) {
    for (const [, seq] of Object.entries(stateMap)) {
      for (const il of seq.inter_assembly_interlocks ?? []) {
        out.push({
          interlock_id: il.interlock_id,
          source_assembly: il.source_assembly,
          target_assembly: il.target_assembly,
          prose_source_condition:
            typeof il.source_condition === "string"
              ? il.source_condition
              : JSON.stringify(il.source_condition),
          prose_effect:
            typeof il.effect === "string" ? il.effect : JSON.stringify(il.effect),
        });
      }
    }
  }
  return out;
}

/**
 * Computes the first-open wizard proposal from a loaded V1 contract. Used by
 * the wizard shell only when there's no existing migration_draft.
 */
export function useMigrationProposal(
  specProjectId: string,
  contract: SpecContractV2 | undefined,
  enabled: boolean,
) {
  return useQuery<MigrationProposal>({
    queryKey: ["migration-proposal", specProjectId],
    enabled: enabled && !!contract,
    queryFn: async () => {
      if (!contract) throw new Error("useMigrationProposal: contract required");
      const legacyStateNames = (contract.states ?? []).map((s) =>
        typeof s.state_id === "string" ? s.state_id : String(s.state_id),
      );
      const modes = proposeModes(legacyStateNames);
      const states = legacyStateNames.map(proposeStateMapping);
      const classified = await classifyInterlocks(collectRawInterlocks(contract));
      const interlocks: ProposedInterlock[] = classified.map((c) => {
        const raw = collectRawInterlocks(contract).find((r) => r.interlock_id === c.interlock_id);
        return {
          interlock_id: c.interlock_id,
          source_assembly: c.source_assembly,
          target_assembly: c.target_assembly,
          original_prose_condition: raw?.prose_source_condition ?? "",
          original_prose_effect: raw?.prose_effect ?? "",
          effect: c.effect,
          source_condition: c.source_condition,
          confidence: c.confidence,
          reasoning: c.reasoning,
        };
      });
      return { modes, states, interlocks };
    },
  });
}
