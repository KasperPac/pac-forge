import { useState, useCallback } from "react";
import { callStreamingCollect } from "@/hooks/use-generation";
import {
  buildTestAnalysisPrompt,
  buildTestAnalysisUserMessage,
  TEST_ANALYSIS_MAX_TOKENS,
} from "@/lib/plcsim-test-analysis-prompt";
import type { PlcsimTestSuite, TestLearning } from "@/types/plcsim-test";
import type { ForgeSession } from "@/types/forge";

function validateLearnings(parsed: unknown): TestLearning[] {
  if (!Array.isArray(parsed)) return [];
  return (parsed as Record<string, unknown>[]).map((raw) => ({
    id: crypto.randomUUID(),
    testCaseId: (raw.testCaseId as string) ?? "",
    testCaseName: (raw.testCaseName as string) ?? "",
    severity: (["bug", "improvement", "note"].includes(raw.severity as string)
      ? raw.severity
      : "note") as TestLearning["severity"],
    title: (raw.title as string) ?? "Untitled",
    description: (raw.description as string) ?? "",
    affectedBlock: (raw.affectedBlock as string | null) ?? null,
    suggestedFix: (raw.suggestedFix as string | null) ?? null,
    acknowledged: false,
  }));
}

/**
 * Hook for PM agent to analyse test failures and generate learnings.
 */
export function usePlcsimTestAnalysis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyse = useCallback(
    async (
      suite: PlcsimTestSuite,
      session: ForgeSession,
    ): Promise<TestLearning[]> => {
      const failures = suite.results.filter((r) => r.status === "fail" || r.status === "error");
      if (failures.length === 0) return [];

      setLoading(true);
      setError(null);
      const abort = new AbortController();

      try {
        const systemPrompt = buildTestAnalysisPrompt();
        const userMessage = buildTestAnalysisUserMessage(suite, session);

        const { content } = await callStreamingCollect(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          TEST_ANALYSIS_MAX_TOKENS,
        );

        const cleaned = content
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error(`Analysis returned invalid JSON: ${cleaned.slice(0, 200)}…`);
        }

        return validateLearnings(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { analyse, loading, error };
}
