// @deprecated — relocation pending (Wave 4 ai-ingest.ts). Wave 5 does not
// delete this file because `@/lib/spec-builder/ai-ingest.ts` is not yet on
// master. Main session will remove once Wave 4 merges.
import { useState, useCallback } from "react";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
// validateAndCall not needed — streaming bypasses the pipeline validator wrapper
import {
  buildSpecAnalysisPrompt,
  buildSpecAnalysisUserMessage,
} from "@/lib/forge-prompts";
import type { SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

const SPEC_ANALYSIS_MAX_TOKENS = 65536;

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
    plc_order_number: (obj.plc_order_number as string) ?? null,
    hmi_type: (obj.hmi_type as string) ?? "",
    safety_classification: (obj.safety_classification as string) ?? null,
    hardware_rack: Array.isArray(obj.hardware_rack)
      ? (obj.hardware_rack as SpecAnalysis["hardware_rack"])
      : [],
    process_settings: Array.isArray(obj.process_settings)
      ? (obj.process_settings as SpecAnalysis["process_settings"])
      : [],
    fb_architecture: (obj.fb_architecture as string) ?? null,
    subsystems: Array.isArray(obj.subsystems)
      ? (obj.subsystems as SpecAnalysis["subsystems"])
      : [],
    assemblies: Array.isArray(obj.assemblies)
      ? (obj.assemblies as Array<Record<string, unknown>>).map((a) => ({
          id: (a.id ?? "") as string,
          name: (a.name ?? a.tag ?? "") as string,
          tag: (a.tag ?? a.name ?? "") as string,
          assembly_type: (a.assembly_type ?? a.type ?? "") as string,
          description: (a.description ?? "") as string,
          subsystem: (a.subsystem ?? "") as string,
          device_ids: Array.isArray(a.device_ids) ? (a.device_ids as string[]) : [],
        })) as SpecAnalysis["assemblies"]
      : [],
    devices: Array.isArray(obj.devices)
      ? (obj.devices as Array<Record<string, unknown>>).map((d) => ({
          ...d,
          // Normalize: AI sometimes omits name (uses tag only) or vice versa
          name: (d.name ?? d.tag ?? "") as string,
          tag: (d.tag ?? d.name ?? "") as string,
          io_signals: Array.isArray(d.io_signals)
            ? (d.io_signals as Array<Record<string, unknown>>).map((sig) => ({
                // Normalize field names — AI sometimes uses signal_name instead of tag_name
                tag_name: (sig.tag_name ?? sig.signal_name ?? sig.name ?? "") as string,
                signal_type: (sig.signal_type ?? sig.type ?? "") as string,
                description: (sig.description ?? sig.desc ?? "") as string,
                signal_behaviour: (sig.signal_behaviour ?? sig.behaviour ?? "") as string,
                contact_type: (sig.contact_type ?? "") as string,
              }))
            : [],
        })) as SpecAnalysis["devices"]
      : [],
    process_sequences: Array.isArray(obj.process_sequences)
      ? (obj.process_sequences as Array<Record<string, unknown>>).map((s) => ({
          ...s,
          steps: Array.isArray(s.steps)
            ? (s.steps as Array<Record<string, unknown>>).map((step) => ({
                ...step,
                trigger_condition: (step.trigger_condition ?? step.trigger ?? null) as string | null,
              }))
            : [],
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
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (specText: string, fbTemplates?: FbTemplate[]): Promise<SpecAnalysis> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();

      try {
        const systemPrompt = buildSpecAnalysisPrompt(fbTemplates, promptSections);
        const userMessage = buildSpecAnalysisUserMessage(specText);

        console.log("[spec-analysis] streaming — system prompt:", systemPrompt.length, "chars, user message:", userMessage.length, "chars");
        const startTime = Date.now();

        const content = await streamFromEdgeFunction(
          {
            system_prompt: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            stream: true,
          },
          abort.signal,
          () => {}, // no per-chunk callback needed for single analysis
          SPEC_ANALYSIS_MAX_TOKENS,
          { prompt_name: "forge-spec-analysis", agent_role: "spec_analysis", pipeline_step: "spec_analysis" },
        );

        console.log("[spec-analysis] streamed in", Date.now() - startTime, "ms,", content.length, "chars");

        // Strip any accidental markdown fences the model may add
        let cleaned = content.trim();
        cleaned = cleaned.replace(/^[\s\S]*?```json\s*/i, "");
        cleaned = cleaned.replace(/```[\s\S]*$/, "");
        cleaned = cleaned.trim();
        if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
          const jsonStart = cleaned.indexOf("{");
          if (jsonStart >= 0) cleaned = cleaned.slice(jsonStart);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (jsonErr) {
          console.error("[spec-analysis] JSON parse failed:", jsonErr);
          console.error("[spec-analysis] last 200 chars:", cleaned.slice(-200));
          throw new Error(`Spec analysis returned invalid JSON: ${cleaned.slice(0, 200)}…`);
        }

        const result = validateSpecAnalysis(parsed);
        console.log("[spec-analysis] OK — devices:", result.devices.length, "assemblies:", result.assemblies.length, "sequences:", result.process_sequences.length);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[spec-analysis] ERROR:", msg);
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
