import type {
  Agent,
  Project,
  DesignProfile,
  PatternCandidate,
  FbTemplate,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
} from "@/types";
import type { ProcessStage } from "@/types/forge-matrix";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import type { ReviewReport } from "@/lib/review-response-parser";
import type { PipelineStepResult } from "@/lib/pipeline";
import { MAX_REVIEW_ROUNDS, CODE_GEN_MAX_TOKENS, createPendingStep } from "@/lib/pipeline";
import type { UnresolvedFinding } from "@/lib/pipeline";
import { buildReviewPrompt } from "@/lib/review-prompt-builder";
import { parseReviewReport } from "@/lib/review-response-parser";
import { buildRewritePrompt } from "@/lib/rewrite-prompt-builder";
import { parseArtifacts } from "@/lib/artifact-parser";
import { callNonStreaming } from "@/hooks/use-generation";

export interface ReviewRewriteCallbacks {
  addStep: (step: PipelineStepResult) => void;
  updateStep: (agentId: string, updates: Partial<PipelineStepResult>) => void;
  setActiveAgentName: (name: string | null) => void;
}

export interface ReviewRewriteInput {
  reviewers: Agent[];
  generator: Agent;
  currentArtifacts: ParsedArtifact[];
  project: Project;
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  abortSignal: AbortSignal;
  callbacks: ReviewRewriteCallbacks;
  /** When set, scopes the review to only what this pipeline stage produces. */
  stage?: ProcessStage;
}

export interface ReviewRewriteResult {
  artifacts: ParsedArtifact[];
  unresolvedFindings: UnresolvedFinding[];
  finalReviewReports: Array<{ reviewerName: string; report: ReviewReport }>;
}

/**
 * Execute up to MAX_REVIEW_ROUNDS of review→rewrite cycles.
 *
 * Exits early when:
 * - No findings at all (clean pass)
 * - No CRITICAL findings remain (WARNINGs/INFOs are acceptable)
 *
 * After the final round, any remaining CRITICAL findings are returned
 * as `unresolvedFindings` for the UI to display.
 */
export async function executeReviewRewriteLoop(
  input: ReviewRewriteInput,
): Promise<ReviewRewriteResult> {
  const {
    reviewers,
    generator,
    project,
    agentKnowledgeDocs,
    designProfile,
    approvedPatterns,
    fbTemplates,
    promptSections,
    referenceSections,
    abortSignal,
    callbacks,
    stage,
  } = input;

  let artifacts = input.currentArtifacts;
  let lastReviewReports: Array<{ reviewerName: string; report: ReviewReport }> = [];
  const unresolvedFindings: UnresolvedFinding[] = [];

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    if (abortSignal.aborted) break;
    if (reviewers.length === 0) break;

    // --- Review pass ---
    const reviewReports: Array<{ reviewerName: string; report: ReviewReport }> = [];

    for (const reviewer of reviewers) {
      if (abortSignal.aborted) break;

      const stepId = round === 1 ? reviewer.id : `${reviewer.id}-review-${round}`;
      const displayName = round === 1
        ? reviewer.display_name
        : `${reviewer.display_name} (Round ${round})`;

      const reviewStep: PipelineStepResult = {
        ...createPendingStep(reviewer, "review"),
        agentId: stepId,
        agentName: displayName,
      };
      callbacks.addStep(reviewStep);
      callbacks.setActiveAgentName(displayName);
      callbacks.updateStep(stepId, { status: "running" });

      const reviewStartTime = Date.now();
      try {
        const { systemPrompt, messages } = buildReviewPrompt({
          agent: reviewer,
          artifacts,
          project,
          knowledgeDocs: agentKnowledgeDocs?.[reviewer.id],
          designProfile,
          approvedPatterns,
          promptSections,
          referenceSections,
          stage,
        });

        const { content, usage } = await callNonStreaming(systemPrompt, messages, abortSignal);
        const report = parseReviewReport(content);

        reviewReports.push({ reviewerName: reviewer.display_name, report });

        const findingCount = report.findings.length;
        const criticalCount = report.findings.filter((f) => f.severity === "CRITICAL").length;

        callbacks.updateStep(stepId, {
          status: "completed",
          systemPrompt,
          userMessage: messages[messages.length - 1]?.content ?? "",
          rawResponse: content,
          tokenUsage: usage,
          durationMs: Date.now() - reviewStartTime,
          artifactsModified: [],
          summary: report.hasFindings
            ? `${findingCount} finding(s) (${criticalCount} critical): ${report.summary.slice(0, 200)}`
            : `No issues: ${report.summary.slice(0, 200)}`,
        });
      } catch (err) {
        if (abortSignal.aborted) throw err;
        callbacks.updateStep(stepId, {
          status: "failed",
          durationMs: Date.now() - reviewStartTime,
          error: err instanceof Error ? err.message : String(err),
          summary: "Review failed",
        });
        // Reviewer failure is non-fatal — continue
      }
    }

    lastReviewReports = reviewReports;

    // --- Check exit conditions ---
    const hasAnyFindings = reviewReports.some((r) => r.report.hasFindings);
    if (!hasAnyFindings) break; // Clean pass — no findings at all

    const allFindings = reviewReports.flatMap((r) => r.report.findings);
    const hasCritical = allFindings.some((f) => f.severity === "CRITICAL");
    if (!hasCritical) break; // Only WARNINGs/INFOs remain — acceptable

    // --- Final round: collect unresolved CRITICAL findings, no rewrite ---
    if (round === MAX_REVIEW_ROUNDS) {
      for (const r of reviewReports) {
        for (const f of r.report.findings) {
          if (f.severity === "CRITICAL") {
            unresolvedFindings.push({
              artifactName: f.artifactName,
              description: f.description,
              reviewerName: r.reviewerName,
              round,
            });
          }
        }
      }
      break;
    }

    // --- Rewrite step ---
    if (abortSignal.aborted) break;

    const rewriteStepId = round === 1
      ? `${generator.id}-rewrite`
      : `${generator.id}-rewrite-${round}`;
    const rewriteDisplayName = round === 1
      ? `${generator.display_name} (Rewrite)`
      : `${generator.display_name} (Rewrite Round ${round})`;

    const rewriteStep: PipelineStepResult = {
      ...createPendingStep(generator, "rewrite"),
      agentId: rewriteStepId,
      agentName: rewriteDisplayName,
    };
    callbacks.addStep(rewriteStep);
    callbacks.setActiveAgentName(rewriteDisplayName);
    callbacks.updateStep(rewriteStepId, { status: "running" });

    const rewriteStartTime = Date.now();
    try {
      const { systemPrompt, messages } = buildRewritePrompt({
        generator,
        artifacts,
        reviewReports,
        project,
        knowledgeDocs: agentKnowledgeDocs?.[generator.id],
        designProfile,
        approvedPatterns,
        fbTemplates,
        promptSections,
        referenceSections,
        round,
        maxRounds: MAX_REVIEW_ROUNDS,
      });

      const { content, usage } = await callNonStreaming(systemPrompt, messages, abortSignal, CODE_GEN_MAX_TOKENS);
      const { artifacts: rewrittenArtifacts, errors } = parseArtifacts(content);

      if (rewrittenArtifacts.length > 0) {
        artifacts = rewrittenArtifacts;
      }

      callbacks.updateStep(rewriteStepId, {
        status: "completed",
        systemPrompt,
        userMessage: messages[messages.length - 1]?.content ?? "",
        rawResponse: content,
        tokenUsage: usage,
        durationMs: Date.now() - rewriteStartTime,
        artifactsModified: rewrittenArtifacts.map((a) => a.name),
        summary: `Rewrote ${rewrittenArtifacts.length} artifact(s) addressing ${reviewReports.reduce((n, r) => n + r.report.findings.length, 0)} finding(s)${errors.length > 0 ? ` with ${errors.length} parse error(s)` : ""}`,
      });
    } catch (err) {
      if (abortSignal.aborted) throw err;
      callbacks.updateStep(rewriteStepId, {
        status: "failed",
        durationMs: Date.now() - rewriteStartTime,
        error: err instanceof Error ? err.message : String(err),
        summary: "Rewrite failed",
      });
      // Rewrite failure is non-fatal — continue with current artifacts
      break; // No point reviewing again if rewrite failed
    }
  }

  return {
    artifacts,
    unresolvedFindings,
    finalReviewReports: lastReviewReports,
  };
}
