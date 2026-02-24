import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePacStStore } from "@/stores/pac-st-store";
import { buildPrompt } from "@/lib/prompt-builder";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import {
  streamFromEdgeFunction,
  getAuthToken,
  saveArtifactsAndTurns,
} from "@/hooks/use-generation";
import type { GenerateInput, GenerateResult } from "@/hooks/use-generation";
import { buildReviewPrompt } from "@/lib/review-prompt-builder";
import { parseReviewResponse, mergeReviewedArtifacts } from "@/lib/review-response-parser";
import { buildPlanPrompt, buildSummaryPrompt } from "@/lib/pm-prompt-builder";
import {
  sortAgentsByPipelineOrder,
  isGeneratorAgent,
  isReviewerAgent,
  isPatternAgent,
  isOrchestratorAgent,
  createPendingStep,
} from "@/lib/pipeline";
import type { PipelineStepResult } from "@/lib/pipeline";
import { classifyCorrections } from "@/lib/correction-classifier";
import { computeDiff } from "@/lib/diff-engine";
import { supabase } from "@/lib/supabase";
import type { AgentKnowledgeDoc } from "@/types";

const ARTIFACTS_KEY = ["artifacts"] as const;

export interface PipelineInput extends GenerateInput {
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
}

async function callNonStreaming(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  signal: AbortSignal
): Promise<{ content: string; usage: { input: number; output: number } | null }> {
  const token = await getAuthToken();

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        messages,
        stream: false,
      }),
      signal,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    let detail: string;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error ?? parsed.details ?? text;
    } catch {
      detail = text;
    }
    throw new Error(`API call failed (${response.status}): ${detail}`);
  }

  const result = await response.json();
  const content = result.content as string;
  const usage = result.usage
    ? { input: result.usage.input_tokens as number, output: result.usage.output_tokens as number }
    : null;

  return { content, usage };
}

export function usePipelineGenerate() {
  const queryClient = useQueryClient();
  const store = usePacStStore;
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const executePipeline = useCallback(
    async (
      input: PipelineInput,
      callbacks?: {
        onSuccess?: (result: GenerateResult) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      const { agents, project, agentKnowledgeDocs } = input;

      setError(null);
      setIsRunning(true);

      const abort = new AbortController();
      abortRef.current = abort;

      const pipelineId = crypto.randomUUID();
      store.getState().startPipeline(pipelineId);
      store.getState().clearStreaming();

      const sortedAgents = sortAgentsByPipelineOrder(agents);
      const orchestrator = sortedAgents.find(isOrchestratorAgent);
      const generator = sortedAgents.find(isGeneratorAgent);
      const reviewers = sortedAgents.filter(isReviewerAgent);
      const patternAgent = sortedAgents.find(isPatternAgent);

      let currentArtifacts: ParsedArtifact[] = [];
      let originalArtifacts: ParsedArtifact[] = [];
      let generationSummary = "";

      try {
        // --- Step 0: PM Plan (if PM is selected) ---
        if (orchestrator) {
          const planStep = createPendingStep(orchestrator, "plan");
          store.getState().addPipelineStep(planStep);
          store.getState().setActiveAgentName(orchestrator.display_name);
          store.getState().updatePipelineStep(orchestrator.id, { status: "running" });

          const startTime = Date.now();
          try {
            const { systemPrompt, messages } = buildPlanPrompt({
              pmAgent: orchestrator,
              availableAgents: sortedAgents.filter((a) => !isOrchestratorAgent(a)),
              project,
              knowledgeDocs: agentKnowledgeDocs?.[orchestrator.id],
              userMessage: input.userMessage,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

            store.getState().updatePipelineStep(orchestrator.id, {
              status: "completed",
              systemPrompt,
              rawResponse: content,
              tokenUsage: usage,
              durationMs: Date.now() - startTime,
              summary: content.slice(0, 300),
            });
          } catch (err) {
            if (abort.signal.aborted) throw err;
            store.getState().updatePipelineStep(orchestrator.id, {
              status: "failed",
              durationMs: Date.now() - startTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Planning failed",
            });
            // PM failure is non-fatal — continue pipeline
          }
        }

        // --- Step 1: Generate (Code Architect streams) ---
        if (!generator) {
          throw new Error("No Code Architect agent found in the pipeline. At least one generator agent must be selected.");
        }

        const genStep = createPendingStep(generator, "generate");
        store.getState().addPipelineStep(genStep);
        store.getState().setActiveAgentName(generator.display_name);
        store.getState().updatePipelineStep(generator.id, { status: "running" });

        const genStartTime = Date.now();
        try {
          // Build prompt with only the generator agent
          const { systemPrompt, messages } = buildPrompt({
            ...input,
            agents: [generator],
          });

          const fetchBody = {
            system_prompt: systemPrompt,
            messages,
            project_context: {
              project_id: project.id,
              session_id: input.sessionId,
            },
            generation_mode: input.generationMode,
            stream: true,
          };

          const fullContent = await streamFromEdgeFunction(
            fetchBody,
            abort.signal,
            store.getState().appendStreamChunk,
          );

          store.getState().clearStreaming();

          const { artifacts: parsed, summary, errors } = parseArtifacts(fullContent);
          currentArtifacts = parsed;
          originalArtifacts = parsed.map((a) => ({ ...a }));
          generationSummary = summary;

          store.getState().updatePipelineStep(generator.id, {
            status: "completed",
            systemPrompt,
            rawResponse: fullContent,
            tokenUsage: null, // streaming doesn't return usage
            durationMs: Date.now() - genStartTime,
            artifactsModified: parsed.map((a) => a.name),
            summary: `Generated ${parsed.length} artifact(s)${errors.length > 0 ? ` with ${errors.length} parse error(s)` : ""}`,
          });
        } catch (err) {
          store.getState().clearStreaming();
          store.getState().updatePipelineStep(generator.id, {
            status: "failed",
            durationMs: Date.now() - genStartTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Generation failed",
          });
          throw err;
        }

        // --- Steps 2-N: Review agents ---
        for (const reviewer of reviewers) {
          if (abort.signal.aborted) break;

          const reviewStep = createPendingStep(reviewer, "review");
          store.getState().addPipelineStep(reviewStep);
          store.getState().setActiveAgentName(reviewer.display_name);
          store.getState().updatePipelineStep(reviewer.id, { status: "running" });

          const reviewStartTime = Date.now();
          try {
            const { systemPrompt, messages } = buildReviewPrompt({
              agent: reviewer,
              artifacts: currentArtifacts,
              project,
              knowledgeDocs: agentKnowledgeDocs?.[reviewer.id],
              designProfile: input.designProfile,
              approvedPatterns: input.approvedPatterns,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);
            const review = parseReviewResponse(content);

            let modifiedNames: string[] = [];
            if (review.modified) {
              const result = mergeReviewedArtifacts(currentArtifacts, review.artifacts);
              currentArtifacts = result.merged;
              modifiedNames = result.modifiedNames;
            }

            store.getState().updatePipelineStep(reviewer.id, {
              status: "completed",
              systemPrompt,
              rawResponse: content,
              tokenUsage: usage,
              durationMs: Date.now() - reviewStartTime,
              artifactsModified: modifiedNames,
              summary: review.modified
                ? `Modified ${modifiedNames.length} artifact(s): ${review.explanation.slice(0, 200)}`
                : `No changes: ${review.explanation.slice(0, 200)}`,
            });
          } catch (err) {
            if (abort.signal.aborted) throw err;
            store.getState().updatePipelineStep(reviewer.id, {
              status: "failed",
              durationMs: Date.now() - reviewStartTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Review failed",
            });
            // Reviewer failure is non-fatal — continue pipeline
          }
        }

        // --- Step 5: Pattern Librarian (if selected) ---
        if (patternAgent && !abort.signal.aborted) {
          const patternStep = createPendingStep(patternAgent, "patterns");
          store.getState().addPipelineStep(patternStep);
          store.getState().setActiveAgentName(patternAgent.display_name);
          store.getState().updatePipelineStep(patternAgent.id, { status: "running" });

          const patternStartTime = Date.now();
          try {
            let patternCount = 0;
            // Compare original vs final artifacts to detect corrections
            for (const original of originalArtifacts) {
              const final = currentArtifacts.find((a) => a.name === original.name);
              if (!final || final.content === original.content) continue;

              const diff = computeDiff(original.content, final.content);
              if (diff.hasChanges) {
                const corrections = classifyCorrections(diff, {
                  artifactName: original.name,
                  deviceType: original.type,
                });
                patternCount += corrections.length;

                // Persist corrections to pattern_candidates table
                if (corrections.length > 0) {
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    const rows = corrections.map((c) => ({
                      plc_brand: input.project.plc_brand,
                      device_type: c.correctionType,
                      context: original.name,
                      original_snippet: c.originalSnippet,
                      corrected_snippet: c.correctedSnippet,
                      correction_type: c.correctionType,
                      explanation_tag: c.explanationTag,
                      status: "PENDING" as const,
                      created_by: user?.id ?? "",
                    }));
                    await supabase.from("pattern_candidates").insert(rows);
                  } catch (persistErr) {
                    // Pattern persistence failure is non-fatal
                    console.error("Failed to persist pipeline patterns:", persistErr);
                  }
                }
              }
            }

            store.getState().updatePipelineStep(patternAgent.id, {
              status: "completed",
              durationMs: Date.now() - patternStartTime,
              summary: patternCount > 0
                ? `Persisted ${patternCount} correction pattern(s) from reviewer changes`
                : "No corrections detected between pipeline stages",
            });
          } catch (err) {
            store.getState().updatePipelineStep(patternAgent.id, {
              status: "failed",
              durationMs: Date.now() - patternStartTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Pattern analysis failed",
            });
          }
        }

        // --- Step 6: PM Summary (if PM is selected) ---
        if (orchestrator && !abort.signal.aborted) {
          const summaryStepId = `${orchestrator.id}-summary`;
          const summaryStep: PipelineStepResult = {
            ...createPendingStep(orchestrator, "summary"),
            agentId: summaryStepId,
          };
          store.getState().addPipelineStep(summaryStep);
          store.getState().setActiveAgentName(`${orchestrator.display_name} (Summary)`);
          store.getState().updatePipelineStep(summaryStepId, { status: "running" });

          const summaryStartTime = Date.now();
          try {
            const pipelineSteps = store.getState().pipelineExecution?.steps ?? [];
            const { systemPrompt, messages } = buildSummaryPrompt({
              pmAgent: orchestrator,
              project,
              knowledgeDocs: agentKnowledgeDocs?.[orchestrator.id],
              steps: pipelineSteps.filter((s) => s.role !== "summary"),
              artifactCount: currentArtifacts.length,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

            store.getState().updatePipelineStep(summaryStepId, {
              status: "completed",
              systemPrompt,
              rawResponse: content,
              tokenUsage: usage,
              durationMs: Date.now() - summaryStartTime,
              summary: content.slice(0, 300),
            });
          } catch (err) {
            if (abort.signal.aborted) throw err;
            store.getState().updatePipelineStep(summaryStepId, {
              status: "failed",
              durationMs: Date.now() - summaryStartTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Summary failed",
            });
          }
        }

        // --- Finalize: save artifacts ---
        store.getState().setActiveAgentName(null);

        const result = await saveArtifactsAndTurns(
          currentArtifacts,
          generationSummary,
          input,
          currentArtifacts.map((a) => a.content).join("\n\n---\n\n"),
        );

        store.getState().completePipeline(result.artifacts.length);

        queryClient.invalidateQueries({ queryKey: ARTIFACTS_KEY });
        queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
        queryClient.invalidateQueries({ queryKey: ["snapshots"] });

        setIsRunning(false);
        callbacks?.onSuccess?.(result);
        return result;
      } catch (err) {
        setIsRunning(false);
        store.getState().clearStreaming();
        store.getState().setActiveAgentName(null);

        if (err instanceof DOMException && err.name === "AbortError") {
          store.getState().completePipeline(0);
          return undefined;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        store.getState().completePipeline(0);
        callbacks?.onError?.(error);
        return undefined;
      }
    },
    [queryClient, store],
  );

  const cancelPipeline = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    store.getState().clearStreaming();
    store.getState().setActiveAgentName(null);
  }, [store]);

  return { executePipeline, cancelPipeline, isRunning, error };
}
