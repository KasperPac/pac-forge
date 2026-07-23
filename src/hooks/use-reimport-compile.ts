import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { CompileResultWithSources } from "@/types/tia";

interface ReimportCompileInput {
  sources: Record<string, string>;
}

export function useReimportCompile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReimportCompileInput): Promise<CompileResultWithSources> => {
      const response = await fetch(
        `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/reimport-compile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: input.sources }),
          // Openness is slow per block (~5-10 s each): a full-program reimport
          // takes minutes. 120 s aborted the fetch while the bridge kept
          // working, losing the compile result (G9-W5).
          signal: AbortSignal.timeout(600_000),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Reimport failed (${response.status}): ${body}`);
      }

      return (await response.json()) as CompileResultWithSources;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tia-compile-result"] });
      queryClient.invalidateQueries({ queryKey: ["tia-bridge-status"] });
    },
  });
}
