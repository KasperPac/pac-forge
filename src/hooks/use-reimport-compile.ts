import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

interface ReimportCompileInput {
  sources: Record<string, string>;
}

interface CompileErrorDto {
  artifact_name: string;
  line: number | null;
  column: number | null;
  error_text: string;
  severity: "ERROR" | "WARNING" | "INFO";
}

interface CompileResultWithSources {
  success: boolean;
  errors: CompileErrorDto[];
  warnings: CompileErrorDto[];
  compiled_at: string;
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
          signal: AbortSignal.timeout(120_000),
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
