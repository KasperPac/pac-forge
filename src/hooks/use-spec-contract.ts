/**
 * TanStack Query wrapper around `loadSpecContract`. Keeps the accessor in
 * `src/lib/spec-builder/contract.ts` as the single source of truth while
 * giving React components a cached, Suspense-friendly read path.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const STALE_MS = 30_000;

export function useSpecContract(
  specProjectId: string | undefined,
  revisionId?: string | undefined,
) {
  return useQuery<SpecContractV2>({
    queryKey: ["spec_contract", specProjectId, revisionId],
    enabled: Boolean(specProjectId),
    staleTime: STALE_MS,
    queryFn: async () => {
      if (!specProjectId) throw new Error("useSpecContract: specProjectId is required");
      return loadSpecContract(specProjectId, revisionId);
    },
  });
}

export function useInvalidateSpecContract() {
  const qc = useQueryClient();
  return (specProjectId?: string, revisionId?: string) => {
    if (specProjectId) {
      qc.invalidateQueries({ queryKey: ["spec_contract", specProjectId, revisionId] });
    } else {
      qc.invalidateQueries({ queryKey: ["spec_contract"] });
    }
  };
}
