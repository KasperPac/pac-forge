/**
 * Hook for running logic checks on assembly FB artifacts.
 * Currently deterministic only (instant). AI-based deeper analysis can be added later.
 */
import { useState, useCallback } from "react";
import { runLogicCheck } from "@/lib/forge-logic-checker";
import { useForgeFdsHandoff } from "@/hooks/use-forge-fds-handoff";
import type { ForgeSession, ForgeArtifact, ForgeAssemblyEntry } from "@/types/forge";
import type { LogicCheckResult } from "@/types/forge-logic-check";

export function useForgeLogicCheck(session: ForgeSession) {
  const { briefs, isFdsLinked } = useForgeFdsHandoff(session.spec_project_id);
  const [result, setResult] = useState<LogicCheckResult | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(
    (assemblies: ForgeAssemblyEntry[], artifacts: ForgeArtifact[]) => {
      setLoading(true);
      try {
        const checkResult = runLogicCheck(
          assemblies,
          artifacts,
          isFdsLinked ? briefs : undefined,
        );
        setResult(checkResult);
        return checkResult;
      } finally {
        setLoading(false);
      }
    },
    [isFdsLinked, briefs],
  );

  const clear = useCallback(() => setResult(null), []);

  return { check, result, loading, clear };
}
