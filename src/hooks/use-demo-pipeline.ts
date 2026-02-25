import { useMutation } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildPrompt } from "@/lib/prompt-builder";
import { buildPlanPrompt, buildSummaryPrompt } from "@/lib/pm-prompt-builder";
import { buildReviewPrompt } from "@/lib/review-prompt-builder";
import { parseReviewReport } from "@/lib/review-response-parser";
import type { ReviewReport } from "@/lib/review-response-parser";
import { buildRewritePrompt } from "@/lib/rewrite-prompt-builder";
import {
  buildPatternLibrarianPrompt,
  parsePatternLibrarianResponse,
} from "@/lib/pattern-librarian-prompt";
import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import {
  sortAgentsByPipelineOrder,
  isGeneratorAgent,
  isReviewerAgent,
  isPatternAgent,
  isOrchestratorAgent,
  createPendingStep,
} from "@/lib/pipeline";
import type { PipelineStepResult } from "@/lib/pipeline";
import {
  computeDiff,
  hasFunctionalChanges,
  extractFocusedSnippets,
} from "@/lib/diff-engine";
import { classifyCorrections } from "@/lib/correction-classifier";
import { supabase } from "@/lib/supabase";
import type {
  Project,
  Agent,
  DesignProfile,
  FbTemplate,
  PatternCandidate,
  AgentKnowledgeDoc,
} from "@/types";

export interface DemoPipelineInput {
  description: string;
  project?: Project;
  agents: Agent[];
  designProfile?: DesignProfile;
  fbTemplates?: FbTemplate[];
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  approvedPatterns?: PatternCandidate[];
  promptSections?: Record<string, string>;
  onStepUpdate?: (steps: PipelineStepResult[]) => void;
}

export interface DemoPipelineResult {
  sources: Record<string, string>;
  importOrder: string[];
  artifacts: ParsedArtifact[];
  summary: string;
  steps: PipelineStepResult[];
}

const DEFAULT_PROJECT: Project = {
  id: "",
  client_name: "Demo",
  project_number: null,
  design_profile_id: null,
  plc_brand: "SIEMENS_TIA",
  tia_version: "V18",
  cpu_type: "S7-1500",
  rack_slot_layout: [],
  io_lists: [],
  tag_db_definitions: [],
  uploaded_docs: [],
  safety_level: "NONE",
  safety_notes: "",
  revision_log: [],
  functional_description: null,
  functional_description_filename: null,
  created_by: "",
  created_at: "",
  updated_at: "",
};

/**
 * Runs the full multi-agent pipeline for demo/custom TIA Console generation.
 * Unlike usePipelineGenerate, this does NOT require a session and does NOT
 * persist artifacts to the database. It returns sources + import order
 * for the TIA bridge import, plus full pipeline step data for the console.
 */
export function useDemoPipeline() {
  return useMutation({
    mutationFn: async (input: DemoPipelineInput): Promise<DemoPipelineResult> => {
      const {
        description,
        agents,
        designProfile,
        fbTemplates,
        agentKnowledgeDocs,
        approvedPatterns,
        promptSections,
        onStepUpdate,
      } = input;

      const project = input.project ?? DEFAULT_PROJECT;
      const abort = new AbortController();
      const steps: PipelineStepResult[] = [];

      // Diagnostic: log what learnings data the pipeline received
      const docCount = agentKnowledgeDocs
        ? Object.values(agentKnowledgeDocs).reduce((sum, docs) => sum + docs.length, 0)
        : 0;
      console.log("[DemoPipeline] Starting with:", {
        agents: agents.length,
        knowledgeDocs: docCount,
        patterns: approvedPatterns?.length ?? 0,
        fbTemplates: fbTemplates?.length ?? 0,
        hasDesignProfile: !!designProfile,
        hasProject: !!input.project,
      });

      function pushStep(step: PipelineStepResult) {
        steps.push(step);
        onStepUpdate?.([...steps]);
      }

      function updateStep(agentId: string, patch: Partial<PipelineStepResult>) {
        const idx = steps.findIndex((s) => s.agentId === agentId);
        if (idx !== -1) {
          steps[idx] = { ...steps[idx], ...patch };
          onStepUpdate?.([...steps]);
        }
      }

      const sortedAgents = sortAgentsByPipelineOrder(agents);
      const orchestrator = sortedAgents.find(isOrchestratorAgent);
      const generator = sortedAgents.find(isGeneratorAgent);
      const reviewers = sortedAgents.filter(isReviewerAgent);
      const patternAgent = sortedAgents.find(isPatternAgent);

      let currentArtifacts: ParsedArtifact[] = [];
      let originalArtifacts: ParsedArtifact[] = [];
      let generationSummary = "";

      // --- Step 0: PM Plan ---
      if (orchestrator) {
        const planStep = createPendingStep(orchestrator, "plan");
        pushStep(planStep);
        updateStep(orchestrator.id, { status: "running" });

        const startTime = Date.now();
        try {
          const { systemPrompt, messages } = buildPlanPrompt({
            pmAgent: orchestrator,
            availableAgents: sortedAgents.filter((a) => !isOrchestratorAgent(a)),
            project,
            knowledgeDocs: agentKnowledgeDocs?.[orchestrator.id],
            userMessage: description,
            promptSections,
          });

          const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

          updateStep(orchestrator.id, {
            status: "completed",
            systemPrompt,
            userMessage: messages[0]?.content ?? "",
            rawResponse: content,
            tokenUsage: usage,
            durationMs: Date.now() - startTime,
            summary: content.slice(0, 300),
          });
        } catch (err) {
          updateStep(orchestrator.id, {
            status: "failed",
            durationMs: Date.now() - startTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Planning failed",
          });
        }
      }

      // --- Step 1: Code Generation ---
      if (!generator) {
        throw new Error("No Code Architect agent found. Cannot generate code.");
      }

      const genStep = createPendingStep(generator, "generate");
      pushStep(genStep);
      updateStep(generator.id, { status: "running" });

      const genStartTime = Date.now();
      try {
        const { systemPrompt, messages } = buildPrompt({
          project,
          agents: [generator],
          generationMode: "PROJECT_LEVEL",
          approvedPatterns,
          fbTemplates,
          designProfile,
          agentKnowledgeDocs,
          promptSections,
          userMessage: description,
        });

        const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

        const { artifacts: parsed, summary, errors } = parseArtifacts(content);
        currentArtifacts = parsed;
        originalArtifacts = parsed.map((a) => ({ ...a }));
        generationSummary = summary;

        updateStep(generator.id, {
          status: "completed",
          systemPrompt,
          userMessage: messages[0]?.content ?? "",
          rawResponse: content,
          tokenUsage: usage,
          durationMs: Date.now() - genStartTime,
          artifactsModified: parsed.map((a) => a.name),
          summary: `Generated ${parsed.length} artifact(s)${errors.length > 0 ? ` with ${errors.length} parse error(s)` : ""}`,
        });

        if (parsed.length === 0) {
          throw new Error("No artifacts parsed from response. The AI response may not contain valid SCL blocks.");
        }
      } catch (err) {
        updateStep(generator.id, {
          status: "failed",
          durationMs: Date.now() - genStartTime,
          error: err instanceof Error ? err.message : String(err),
          summary: "Generation failed",
        });
        throw err;
      }

      // --- Steps 2-N: Review agents (report-only, no rewriting) ---
      const reviewReports: Array<{ reviewerName: string; report: ReviewReport }> = [];

      for (const reviewer of reviewers) {
        const reviewStep = createPendingStep(reviewer, "review");
        pushStep(reviewStep);
        updateStep(reviewer.id, { status: "running" });

        const reviewStartTime = Date.now();
        try {
          const { systemPrompt, messages } = buildReviewPrompt({
            agent: reviewer,
            artifacts: currentArtifacts,
            project,
            knowledgeDocs: agentKnowledgeDocs?.[reviewer.id],
            designProfile,
            approvedPatterns,
            promptSections,
          });

          const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);
          const report = parseReviewReport(content);

          reviewReports.push({ reviewerName: reviewer.display_name, report });

          const findingCount = report.findings.length;
          const criticalCount = report.findings.filter((f) => f.severity === "CRITICAL").length;

          updateStep(reviewer.id, {
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
          updateStep(reviewer.id, {
            status: "failed",
            durationMs: Date.now() - reviewStartTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Review failed",
          });
          // Review failure is non-fatal
        }
      }

      // --- Rewrite step: Code Architect addresses review findings ---
      const hasAnyFindings = reviewReports.some((r) => r.report.hasFindings);

      if (hasAnyFindings && generator) {
        const rewriteStepId = `${generator.id}-rewrite`;
        const rewriteStep: PipelineStepResult = {
          ...createPendingStep(generator, "rewrite"),
          agentId: rewriteStepId,
        };
        pushStep(rewriteStep);
        updateStep(rewriteStepId, { status: "running" });

        const rewriteStartTime = Date.now();
        try {
          const { systemPrompt, messages } = buildRewritePrompt({
            generator,
            artifacts: currentArtifacts,
            reviewReports,
            project,
            knowledgeDocs: agentKnowledgeDocs?.[generator.id],
            designProfile,
            approvedPatterns,
            fbTemplates,
            promptSections,
          });

          const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);
          const { artifacts: rewrittenArtifacts, errors } = parseArtifacts(content);

          if (rewrittenArtifacts.length > 0) {
            currentArtifacts = rewrittenArtifacts;
          }

          updateStep(rewriteStepId, {
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
          updateStep(rewriteStepId, {
            status: "failed",
            durationMs: Date.now() - rewriteStartTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Rewrite failed",
          });
          // Rewrite failure is non-fatal — continue with original artifacts
        }
      }

      // --- Pattern Librarian ---
      if (patternAgent) {
        const patternStep = createPendingStep(patternAgent, "patterns");
        pushStep(patternStep);
        updateStep(patternAgent.id, { status: "running" });

        const patternStartTime = Date.now();
        try {
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
                approvedPatterns,
                promptSections,
              });

              const { content, usage } = await callNonStreaming(
                systemPrompt,
                promptMessages,
                abort.signal,
              );

              aiCorrections = parsePatternLibrarianResponse(content);
              if (aiCorrections && aiCorrections.length > 0) {
                analysisMethod = "ai";
              }

              updateStep(patternAgent.id, {
                systemPrompt,
                userMessage: promptMessages[0]?.content ?? "",
                rawResponse: content,
                tokenUsage: usage,
              });
            } catch (aiErr) {
              console.warn("Pattern Librarian AI failed, falling back to regex:", aiErr);
            }

            // Persist corrections
            try {
              const { data: { user } } = await supabase.auth.getUser();

              if (aiCorrections && aiCorrections.length > 0) {
                const rows = aiCorrections.map((c) => {
                  const diffEntry = diffs.find((d) => d.blockName === c.blockName);
                  const diff = diffEntry ? computeDiff(diffEntry.originalCode, diffEntry.correctedCode) : null;
                  const focused = diff ? extractFocusedSnippets(diff) : { originalSnippet: "(no removed lines)", correctedSnippet: "(no added lines)" };
                  return {
                    plc_brand: project.plc_brand,
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
                analysisMethod = "regex";
                for (const d of diffs) {
                  const diff = computeDiff(d.originalCode, d.correctedCode);
                  const corrections = classifyCorrections(diff, { artifactName: d.blockName });
                  if (corrections.length > 0) {
                    const rows = corrections.map((c) => ({
                      plc_brand: project.plc_brand,
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

          updateStep(patternAgent.id, {
            status: "completed",
            durationMs: Date.now() - patternStartTime,
            summary: patternCount > 0
              ? `Persisted ${patternCount} correction pattern(s) via ${analysisMethod} analysis`
              : "No corrections detected between pipeline stages",
          });
        } catch (err) {
          updateStep(patternAgent.id, {
            status: "failed",
            durationMs: Date.now() - patternStartTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Pattern analysis failed",
          });
        }
      }

      // --- PM Summary ---
      if (orchestrator) {
        const summaryStepId = `${orchestrator.id}-summary`;
        const summaryStep: PipelineStepResult = {
          ...createPendingStep(orchestrator, "summary"),
          agentId: summaryStepId,
        };
        pushStep(summaryStep);
        updateStep(summaryStepId, { status: "running" });

        const summaryStartTime = Date.now();
        try {
          const { systemPrompt, messages } = buildSummaryPrompt({
            pmAgent: orchestrator,
            project,
            knowledgeDocs: agentKnowledgeDocs?.[orchestrator.id],
            steps: steps.filter((s) => s.role !== "summary"),
            artifactCount: currentArtifacts.length,
            promptSections,
          });

          const { content, usage } = await callNonStreaming(systemPrompt, messages, abort.signal);

          updateStep(summaryStepId, {
            status: "completed",
            systemPrompt,
            userMessage: messages[0]?.content ?? "",
            rawResponse: content,
            tokenUsage: usage,
            durationMs: Date.now() - summaryStartTime,
            summary: content.slice(0, 300),
          });

          generationSummary = content;
        } catch (err) {
          updateStep(summaryStepId, {
            status: "failed",
            durationMs: Date.now() - summaryStartTime,
            error: err instanceof Error ? err.message : String(err),
            summary: "Summary failed",
          });
        }
      }

      // --- Build sources + import order ---
      const typeOrder: Record<string, number> = {
        UDT: 0, FB: 1, FC: 1, DB: 2, OB: 3, SCL_SOURCE: 1, TAG_TABLE: 4,
      };

      const sorted = [...currentArtifacts].sort(
        (a, b) => (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2),
      );

      const sources: Record<string, string> = {};
      const importOrder: string[] = [];
      for (const artifact of sorted) {
        sources[artifact.name] = artifact.content;
        importOrder.push(artifact.name);
      }

      return {
        sources,
        importOrder,
        artifacts: currentArtifacts,
        summary: generationSummary,
        steps: [...steps],
      };
    },
  });
}
