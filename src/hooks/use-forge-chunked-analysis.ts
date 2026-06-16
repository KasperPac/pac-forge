/**
 * use-forge-chunked-analysis.ts
 * Orchestrator hook for the chunked spec analysis pipeline.
 * Stage 1 (Survey) → Stage 2 (Streaming Extraction per chunk) → Stage 3 (Merge)
 *
 * Chunk extraction uses streaming to avoid Supabase gateway timeouts.
 * Progressive updates show device/equipment_module counts as they're found.
 */

import { useState, useCallback } from "react";
import { callNonStreaming, streamFromEdgeFunction } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import { buildSurveySystemPrompt, buildSurveyUserMessage, validateSurveyResult } from "@/lib/forge-spec-survey";
import { buildChunksFromSurvey } from "@/lib/forge-spec-chunker";
import {
  buildChunkExtractionSystemPrompt,
  buildChunkExtractionUserMessage,
  validatePartialSpecAnalysis,
} from "@/lib/forge-spec-chunk-extract";
import { mergePartialAnalyses } from "@/lib/forge-spec-merge";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import type { SpecAnalysis, SpecSurveyResult, ChunkedAnalysisProgress, PartialSpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

const SURVEY_MAX_TOKENS = 8192;
const CHUNK_EXTRACT_MAX_TOKENS = 16384;

function cleanJson(raw: string): string {
  let cleaned = raw.trim();
  // Strip markdown fences (may have leading whitespace or newlines)
  cleaned = cleaned.replace(/^[\s\S]*?```json\s*/i, "");
  cleaned = cleaned.replace(/```[\s\S]*$/, "");
  cleaned = cleaned.trim();
  // If still not starting with { or [, extract JSON substring
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const jsonStart = cleaned.indexOf("{");
    if (jsonStart >= 0) cleaned = cleaned.slice(jsonStart);
  }
  return cleaned;
}

/** Count occurrences of a pattern in a string (cheap progressive counting) */
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

/**
 * Stream a chunk extraction call, returning the accumulated content.
 * Reports progressive device/equipment_module/sequence counts via onProgress.
 */
async function streamChunkExtraction(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  onProgress?: (stats: { control_modules: number; equipment_modules: number; sequences: number }) => void,
): Promise<string> {
  let accumulated = "";
  let lastReport = 0;

  const content = await streamFromEdgeFunction(
    {
      system_prompt: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      stream: true,
    },
    signal,
    (chunk: string) => {
      accumulated += chunk;

      // Report progressive stats every ~500 chars to avoid excessive updates
      if (onProgress && accumulated.length - lastReport > 500) {
        lastReport = accumulated.length;
        const control_modules = countMatches(accumulated, /"device_type"\s*:/g);
        const equipment_modules = countMatches(accumulated, /"equipment_module_type"\s*:/g);
        const sequences = countMatches(accumulated, /"unit"\s*:\s*"[^"]*"\s*,\s*"permissives"/g)
          + countMatches(accumulated, /"name"\s*:\s*"[^"]*"\s*,\s*"unit"\s*:\s*"[^"]*"\s*,\s*"permissives"/g);
        onProgress({ control_modules, equipment_modules, sequences });
      }
    },
    CHUNK_EXTRACT_MAX_TOKENS,
    {
      prompt_name: "forge-spec-chunk-extract",
      agent_role: "spec_analysis",
      pipeline_step: "spec_chunk_extract",
    },
  );

  return content;
}

/**
 * Hook for chunked spec analysis: survey → streaming extract per chunk → merge.
 */
export function useForgeChunkedAnalysis() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ChunkedAnalysisProgress>({
    stage: "survey",
    currentChunk: 0,
    totalChunks: 0,
    chunkName: "",
    streamStats: undefined,
  });
  const [survey, setSurvey] = useState<SpecSurveyResult | null>(null);

  const analyzeChunked = useCallback(
    async (specText: string, fbTemplates?: FbTemplate[]): Promise<SpecAnalysis> => {
      setLoading(true);
      setError(null);

      try {
        // ── Stage 1: Survey ──────────────────────────────────────────
        setProgress({ stage: "survey", currentChunk: 0, totalChunks: 0, chunkName: "", streamStats: undefined });

        const surveyAbort = new AbortController();
        const { content: surveyRaw } = await validateAndCall(
          callNonStreaming,
          buildSurveySystemPrompt(),
          [{ role: "user", content: buildSurveyUserMessage(specText) }],
          surveyAbort.signal,
          SURVEY_MAX_TOKENS,
          "spec_survey",
          false,
          {
            prompt_name: "forge-spec-survey",
            agent_role: "spec_survey",
            pipeline_step: "spec_survey",
          },
        );

        let surveyParsed: unknown;
        try {
          surveyParsed = JSON.parse(cleanJson(surveyRaw));
        } catch {
          throw new Error(`Survey returned invalid JSON: ${surveyRaw.slice(0, 200)}...`);
        }

        const surveyResult = validateSurveyResult(surveyParsed);
        setSurvey(surveyResult);

        // ── Build chunks ─────────────────────────────────────────────
        const chunks = buildChunksFromSurvey(specText, surveyResult);

        setProgress({
          stage: "extracting",
          currentChunk: 0,
          totalChunks: chunks.length,
          chunkName: chunks[0]?.targetName ?? "",
          streamStats: undefined,
        });

        // ── Stage 2: Streaming Extraction (sequential) ──────────────
        const partials: PartialSpecAnalysis[] = [];
        let totalDevices = 0;
        let totalAssemblies = 0;
        let totalSequences = 0;

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          setProgress({
            stage: "extracting",
            currentChunk: i + 1,
            totalChunks: chunks.length,
            chunkName: chunk.targetName,
            streamStats: { control_modules: totalDevices, equipment_modules: totalAssemblies, sequences: totalSequences },
          });

          const systemPrompt = buildChunkExtractionSystemPrompt(
            surveyResult, chunk.targetId, fbTemplates, promptSections,
          );
          const userMsg = buildChunkExtractionUserMessage(chunk);
          const abort = new AbortController();

          let content: string;
          try {
            content = await streamChunkExtraction(
              systemPrompt,
              userMsg,
              abort.signal,
              (stats) => {
                setProgress((prev) => ({
                  ...prev,
                  streamStats: {
                    control_modules: totalDevices + stats.control_modules,
                    equipment_modules: totalAssemblies + stats.equipment_modules,
                    sequences: totalSequences + stats.sequences,
                  },
                }));
              },
            );
          } catch (streamErr) {
            console.warn(`[Chunked Analysis] Chunk "${chunk.targetName}" stream failed, retrying...`, streamErr);
            // Retry once with fresh abort
            try {
              const retryAbort = new AbortController();
              content = await streamChunkExtraction(
                systemPrompt, userMsg, retryAbort.signal,
              );
            } catch (retryErr) {
              console.error(`[Chunked Analysis] Chunk "${chunk.targetName}" failed on retry, skipping.`, retryErr);
              continue;
            }
          }

          // Parse the streamed JSON
          let parsed: unknown;
          try {
            parsed = JSON.parse(cleanJson(content));
          } catch {
            console.warn(`[Chunked Analysis] Chunk "${chunk.targetName}" returned invalid JSON, retrying...`);
            // Retry once — the stream may have been truncated
            try {
              const retryAbort = new AbortController();
              const retryContent = await streamChunkExtraction(
                systemPrompt, userMsg, retryAbort.signal,
              );
              parsed = JSON.parse(cleanJson(retryContent));
            } catch (retryErr) {
              console.error(`[Chunked Analysis] Chunk "${chunk.targetName}" JSON failed on retry, skipping.`, retryErr);
              continue;
            }
          }

          const partial = validatePartialSpecAnalysis(parsed, chunk.targetId);
          partials.push(partial);

          // Update running totals
          totalDevices += (partial.control_modules ?? []).length;
          totalAssemblies += (partial.equipment_modules ?? []).length;
          totalSequences += (partial.process_sequences ?? []).length;

          console.log(
            `[Chunked Analysis] Chunk "${chunk.targetName}" done — ` +
            `${partial.control_modules.length} control_modules, ${(partial.equipment_modules ?? []).length} equipment_modules, ` +
            `${partial.process_sequences.length} sequences`,
          );
        }

        if (partials.length === 0) {
          throw new Error("All chunk extractions failed — no data extracted from spec");
        }

        // ── Stage 3: Merge ───────────────────────────────────────────
        setProgress({
          stage: "merging",
          currentChunk: chunks.length,
          totalChunks: chunks.length,
          chunkName: "",
          streamStats: { control_modules: totalDevices, equipment_modules: totalAssemblies, sequences: totalSequences },
        });

        const merged = mergePartialAnalyses(surveyResult, partials);
        console.log(
          `[Chunked Analysis] Merge complete — ` +
          `${merged.control_modules.length} control_modules, ${merged.equipment_modules.length} equipment_modules, ` +
          `${merged.process_sequences.length} sequences`,
        );
        return merged;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [promptSections],
  );

  return { analyzeChunked, loading, error, progress, survey };
}
