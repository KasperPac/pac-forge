// src/hooks/use-controls-data.ts
//
// G0-16 Controls Data panel persistence. All writes go through the typed
// contract writer so the Zod patch gate + cross-checks (mode co-send,
// named-gate existence, DO cross-check, …) apply to human edits exactly as
// they do to AI patches — the first interactive consumer of writeSpecContract.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { writeSpecContract, type SpecContractPatch } from "@/lib/spec-builder/contract";

export function useSaveSpecContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ specId, patch }: { specId: string; patch: SpecContractPatch }) => {
      await writeSpecContract(specId, patch);
    },
    onSuccess: (_, { specId }) => {
      queryClient.invalidateQueries({ queryKey: ["spec_projects", specId] });
    },
  });
}
