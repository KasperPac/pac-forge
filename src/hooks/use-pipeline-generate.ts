import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePacStStore } from "@/stores/pac-st-store";
import { buildPrompt } from "@/lib/prompt-builder";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import {
  streamFromEdgeFunction,
  callNonStreaming,
  saveArtifactsAndTurns,
} from "@/hooks/use-generation";
import type { GenerateInput, GenerateResult } from "@/hooks/use-generation";
import { buildReviewPrompt } from "@/lib/review-prompt-builder";
import { parseReviewReport } from "@/lib/review-response-parser";
import type { ReviewReport } from "@/lib/review-response-parser";
import { buildRewritePrompt } from "@/lib/rewrite-prompt-builder";
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
import { computeDiff, hasFunctionalChanges, extractFocusedSnippets } from "@/lib/diff-engine";
import { buildPatternLibrarianPrompt, parsePatternLibrarianResponse } from "@/lib/pattern-librarian-prompt";
import { supabase } from "@/lib/supabase";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import type { AgentKnowledgeDoc, ReferenceLibrarySection } from "@/types";

const ARTIFACTS_KEY = ["artifacts"] as const;

export interface PipelineInput extends GenerateInput {
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
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
      const { agents, project, agentKnowledgeDocs, promptSections } = input;

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
              promptSections,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

            store.getState().updatePipelineStep(orchestrator.id, {
              status: "completed",
              systemPrompt,
              userMessage: messages[0]?.content ?? "",
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

        // --- Reference Lookup: retrieve relevant sections for generation ---
        let referenceSections: ReferenceLibrarySection[] = [];
        try {
          referenceSections = await getRelevantReferenceSections(
            input.userMessage,
            "generation_request",
            project.plc_brand,
            abort.signal,
            20,
            promptSections,
          );
          if (referenceSections.length > 0) {
            console.log(`Reference lookup: ${referenceSections.length} section(s) retrieved for generation`);
          }
        } catch (refErr) {
          console.warn("Reference lookup failed (non-fatal):", refErr);
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
          const { systemPrompt, messages } = buildPrompt({
            ...input,
            agents: [generator],
            referenceSections,
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
            userMessage: messages[0]?.content ?? "",
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

        // --- Reference Lookup for review: retrieve sections relevant to generated code ---
        let reviewReferenceSections: ReferenceLibrarySection[] = referenceSections;
        if (currentArtifacts.length > 0 && reviewers.length > 0) {
          try {
            const codeContext = currentArtifacts.map((a) => `// ${a.name}\n${a.content}`).join("\n\n");
            const reviewRefs = await getRelevantReferenceSections(
              codeContext,
              "generated_code",
              project.plc_brand,
              abort.signal,
              20,
              promptSections,
            );
            if (reviewRefs.length > 0) {
              // Merge with generation refs, deduplicating by id
              const existingIds = new Set(referenceSections.map((s) => s.id));
              const newSections = reviewRefs.filter((s) => !existingIds.has(s.id));
              reviewReferenceSections = [...referenceSections, ...newSections];
              console.log(`Reference lookup: ${newSections.length} additional section(s) retrieved for review (${reviewReferenceSections.length} total)`);
            }
          } catch (refErr) {
            console.warn("Review reference lookup failed (non-fatal):", refErr);
          }
        }

        // --- Steps 2-N: Review agents (report-only, no rewriting) ---
        const reviewReports: Array<{ reviewerName: string; report: ReviewReport }> = [];

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
              promptSections,
              referenceSections: reviewReferenceSections,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);
            const report = parseReviewReport(content);

            reviewReports.push({ reviewerName: reviewer.display_name, report });

            const findingCount = report.findings.length;
            const criticalCount = report.findings.filter((f) => f.severity === "CRITICAL").length;

            store.getState().updatePipelineStep(reviewer.id, {
              status: "completed",
              systemPrompt,
              userMessage: messages[0]?.content ?? "",
              rawResponse: content,
              tokenUsage: usage,
              durationMs: Date.now() - reviewStartTime,
              artifactsModified: [],
              summary: report.hasFindings
                ? `${findingCount} finding(s) (${criticalCount} critical): ${report.summary.slice(0, 200)}`
                : `No issues: ${report.summary.slice(0, 200)}`,
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

        // --- Rewrite step: Code Architect addresses review findings ---
        const hasAnyFindings = reviewReports.some((r) => r.report.hasFindings);

        if (hasAnyFindings && generator && !abort.signal.aborted) {
          const rewriteStepId = `${generator.id}-rewrite`;
          const rewriteStep: PipelineStepResult = {
            ...createPendingStep(generator, "rewrite"),
            agentId: rewriteStepId,
          };
          store.getState().addPipelineStep(rewriteStep);
          store.getState().setActiveAgentName(`${generator.display_name} (Rewrite)`);
          store.getState().updatePipelineStep(rewriteStepId, { status: "running" });

          const rewriteStartTime = Date.now();
          try {
            const { systemPrompt, messages } = buildRewritePrompt({
              generator,
              artifacts: currentArtifacts,
              reviewReports,
              project,
              knowledgeDocs: agentKnowledgeDocs?.[generator.id],
              designProfile: input.designProfile,
              approvedPatterns: input.approvedPatterns,
              fbTemplates: input.fbTemplates,
              promptSections,
              referenceSections: reviewReferenceSections,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);
            const { artifacts: rewrittenArtifacts, errors } = parseArtifacts(content);

            if (rewrittenArtifacts.length > 0) {
              currentArtifacts = rewrittenArtifacts;
            }

            store.getState().updatePipelineStep(rewriteStepId, {
              status: "completed",
              systemPrompt,
              userMessage: messages[0]?.content ?? "",
              rawResponse: content,
              tokenUsage: usage,
              durationMs: Date.now() - rewriteStartTime,
              artifactsModified: rewrittenArtifacts.map((a) => a.name),
              summary: `Rewrote ${rewrittenArtifacts.length} artifact(s) addressing ${reviewReports.reduce((n, r) => n + r.report.findings.length, 0)} finding(s)${errors.length > 0 ? ` with ${errors.length} parse error(s)` : ""}`,
            });
          } catch (err) {
            if (abort.signal.aborted) throw err;
            store.getState().updatePipelineStep(rewriteStepId, {
              status: "failed",
              durationMs: Date.now() - rewriteStartTime,
              error: err instanceof Error ? err.message : String(err),
              summary: "Rewrite failed",
            });
            // Rewrite failure is non-fatal — continue with original artifacts
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
            // Collect diffs between original and final artifacts, skipping whitespace-only
            const diffs: Array<{ blockName: string; originalCode: string; correctedCode: string }> = [];
            for (const original of originalArtifacts) {
              const final = currentArtifacts.find((a) => a.name === original.name);
              if (!final || final.content === original.content) continue;
              if (!hasFunctionalChanges(original.content, final.content)) continue;
              const diff = computeDiff(original.content, final.content);
              if (diff.hasChanges) {
                diffs.push({
                  blockName: original.name,
                  originalCode: original.content,
                  correctedCode: final.content,
                });
              }
            }

            let patternCount = 0;
            let analysisMethod = "none";

            if (diffs.length > 0) {
              // Try AI analysis via Pattern Librarian
              let aiCorrections: Array<{
                blockName: string;
                correctionType: string;
                explanation: string;
                confidence: number;
              }> | null = null;

              try {
                const { systemPrompt, messages: promptMessages } = buildPatternLibrarianPrompt({
                  diffs,
                  knowledgeDocs: agentKnowledgeDocs?.[patternAgent.id],
                  approvedPatterns: input.approvedPatterns,
                  promptSections,
                });

                const { content, usage } = await callNonStreaming(
                  systemPrompt,
                  promptMessages,
                  abort.signal
                );

                aiCorrections = parsePatternLibrarianResponse(content);
                if (aiCorrections && aiCorrections.length > 0) {
                  analysisMethod = "ai";
                }

                // Store raw response + token usage on step
                store.getState().updatePipelineStep(patternAgent.id, {
                  systemPrompt,
                  userMessage: promptMessages[0]?.content ?? "",
                  rawResponse: content,
                  tokenUsage: usage,
                });
              } catch (aiErr) {
                console.warn("Pattern Librarian AI failed, falling back to regex:", aiErr);
              }

              // Persist corrections — AI results or regex fallback
              try {
                const { data: { user } } = await supabase.auth.getUser();

                if (aiCorrections && aiCorrections.length > 0) {
                  // AI-analyzed corrections with focused snippets
                  const rows = aiCorrections.map((c) => {
                    const diffEntry = diffs.find((d) => d.blockName === c.blockName);
                    const diff = diffEntry ? computeDiff(diffEntry.originalCode, diffEntry.correctedCode) : null;
                    const focused = diff ? extractFocusedSnippets(diff) : { originalSnippet: "(no removed lines)", correctedSnippet: "(no added lines)" };
                    return {
                      plc_brand: input.project.plc_brand,
                      device_type: c.correctionType,
                      context: c.blockName,
                      original_snippet: focused.originalSnippet,
                      corrected_snippet: focused.correctedSnippet,
                      correction_type: c.correctionType,
                      explanation_tag: c.explanation,
                      status: "PENDING" as const,
                      created_by: user?.id ?? "",
                    };
                  });
                  await supabase.from("pattern_candidates").insert(rows);
                  patternCount = rows.length;
                } else {
                  // Regex fallback
                  analysisMethod = "regex";
                  for (const d of diffs) {
                    const diff = computeDiff(d.originalCode, d.correctedCode);
                    const corrections = classifyCorrections(diff, { artifactName: d.blockName });
                    if (corrections.length > 0) {
                      const rows = corrections.map((c) => ({
                        plc_brand: input.project.plc_brand,
                        device_type: c.correctionType,
                        context: d.blockName,
                        original_snippet: c.originalSnippet,
                        corrected_snippet: c.correctedSnippet,
                        correction_type: c.correctionType,
                        explanation_tag: c.explanationTag,
                        status: "PENDING" as const,
                        created_by: user?.id ?? "",
                      }));
                      await supabase.from("pattern_candidates").insert(rows);
                      patternCount += rows.length;
                    }
                  }
                }
              } catch (persistErr) {
                console.error("Failed to persist pipeline patterns:", persistErr);
              }
            }

            store.getState().updatePipelineStep(patternAgent.id, {
              status: "completed",
              durationMs: Date.now() - patternStartTime,
              summary: patternCount > 0
                ? `Persisted ${patternCount} correction pattern(s) via ${analysisMethod} analysis`
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
              promptSections,
            });

            const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

            store.getState().updatePipelineStep(summaryStepId, {
              status: "completed",
              systemPrompt,
              userMessage: messages[0]?.content ?? "",
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
