// src/hooks/use-controls-data.ts
//
// G0-16 Controls Data panel persistence. All writes go through the typed
// contract writer so the Zod patch gate + cross-checks (mode co-send,
// named-gate existence, …) apply to human edits exactly as they do to AI
// patches — the first interactive consumer of writeSpecContract.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { writeSpecContract } from "@/lib/spec-builder/contract";
import type { OperatorMode, UnitCoordinationV1 } from "@/types/spec-contract-v2";

export function useSaveUnitCoordination() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      specId,
      unitCoordination,
      modes,
    }: {
      specId: string;
      unitCoordination: Record<string, UnitCoordinationV1>;
      /** Co-sent so mode-referencing coordination validates (G0-9-F1 rule). */
      modes: OperatorMode[];
    }) => {
      await writeSpecContract(specId, {
        unit_coordination: unitCoordination,
        ...(modes.length ? { modes } : {}),
      });
    },
    onSuccess: (_, { specId }) => {
      queryClient.invalidateQueries({ queryKey: ["spec_projects", specId] });
    },
  });
}
