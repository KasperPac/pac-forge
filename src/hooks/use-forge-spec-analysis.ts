import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildSpecAnalysisPrompt,
  buildSpecAnalysisUserMessage,
} from "@/lib/forge-prompts";
import type { SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

const SPEC_ANALYSIS_MAX_TOKENS = 16384;

/** Minimal validation — ensures required top-level fields are present. */
function validateSpecAnalysis(parsed: unknown): SpecAnalysis {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Spec analysis response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const result: SpecAnalysis = {
    project_name: (obj.project_name as string) ?? "",
    project_description: (obj.project_description as string) ?? "",
    plc_type: (obj.plc_type as string) ?? "",
    hmi_type: (obj.hmi_type as string) ?? "",
    subsystems: Array.isArray(obj.subsystems)
      ? (obj.subsystems as SpecAnalysis["subsystems"])
      : [],
    devices: Array.isArray(obj.devices)
      ? (obj.devices as Array<Record<string, unknown>>).map((d) => ({
          ...d,
          io_signals: Array.isArray(d.io_signals) ? d.io_signals : [],
        })) as SpecAnalysis["devices"]
      : [],
    process_sequences: Array.isArray(obj.process_sequences)
      ? (obj.process_sequences as Array<Record<string, unknown>>).map((s) => ({
          ...s,
          steps: Array.isArray(s.steps) ? s.steps : [],
          permissives: Array.isArray(s.permissives) ? s.permissives : [],
        })) as SpecAnalysis["process_sequences"]
      : [],
    alarms: Array.isArray(obj.alarms) ? (obj.alarms as SpecAnalysis["alarms"]) : [],
    interlocks: Array.isArray(obj.interlocks)
      ? (obj.interlocks as SpecAnalysis["interlocks"])
      : [],
  };

  return result;
}

/**
 * Hook to run AI spec analysis on extracted functional spec text.
 *
 * Usage:
 *   const { analyze, loading, error } = useForgeSpecAnalysis();
 *   const result = await analyze(specText);
 */
export function useForgeSpecAnalysis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (specText: string, fbTemplates?: FbTemplate[]): Promise<SpecAnalysis> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();

      try {
        const systemPrompt = buildSpecAnalysisPrompt(fbTemplates);
        const userMessage = buildSpecAnalysisUserMessage(specText);

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          SPEC_ANALYSIS_MAX_TOKENS,
          "spec_analysis",
        );

        // Strip any accidental markdown fences the model may add
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
          throw new Error(`Spec analysis returned invalid JSON: ${cleaned.slice(0, 200)}…`);
        }

        return validateSpecAnalysis(parsed);
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

  return { analyze, loading, error };
}
