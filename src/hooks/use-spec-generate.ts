/**
 * Hook for running the spec section generation pipeline.
 */
import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { generateSpec } from "@/lib/spec-builder/orchestrator";
import type { GenerationProgress, GenerationResult } from "@/lib/spec-builder/orchestrator";
import type { SpecProject, InstrumentRegister } from "@/types/spec-builder";

export function useSpecGenerate() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (spec: SpecProject, register: InstrumentRegister) => {
      setRunning(true);
      setProgress(null);
      setResult(null);
      setError(null);
      abortRef.current = new AbortController();

      try {
        const res = await generateSpec(
          spec,
          register,
          abortRef.current.signal,
          setProgress,
        );
        setResult(res);
        // Invalidate queries so spec status + sections refresh
        queryClient.invalidateQueries({ queryKey: ["spec_projects"] });
        queryClient.invalidateQueries({ queryKey: ["spec_sections"] });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Generation failed");
      } finally {
        setRunning(false);
      }
    },
    [queryClient],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { run, cancel, running, progress, result, error };
}
