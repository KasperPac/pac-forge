import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildForgeReviewPrompt } from "@/lib/forge-agent-prompts";
import { parseForgeReviewResponse, isCleanReview, type ForgeReviewResult } from "@/lib/forge-review-parser";
import { loadPlatformRules } from "@/lib/platform-rules";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

export interface EmReviewArtifact {
  name: string;
  type: string;
  content: string;
}

/**
 * Build the system prompt + user message for a single-EM Standards Review.
 * Reuses the generic Forge reviewer prompt at the `"equipment_module"` stage —
 * no project-specific content. Pure: takes platform rules + prompt sections as
 * args so it is testable without hooks.
 */
export function buildEmReviewInput(
  fb: EmReviewArtifact,
  platformRules: string,
  promptSections?: Record<string, string>,
  profileRules?: string,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = buildForgeReviewPrompt("equipment_module", platformRules, profileRules, promptSections);
  const userMessage = `Review the following artifacts:\n\n### ${fb.name} (${fb.type})\n\`\`\`scl\n${fb.content}\n\`\`\``;
  return { systemPrompt, userMessage };
}

/** On-demand AI Standards Review for one EM FB. */
export function useEmStandardsReview() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = useCallback(
    async (fb: EmReviewArtifact): Promise<ForgeReviewResult> => {
      setLoading(true);
      setError(null);
      try {
        const platformRules = loadPlatformRules("review");
        const { systemPrompt, userMessage } = buildEmReviewInput(fb, platformRules, promptSections);
        const controller = new AbortController();
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          8192,
          { prompt_name: "em-standards-review", agent_role: "standards_reviewer", pipeline_step: "em_standards_review" },
        );
        if (isCleanReview(content)) {
          return { findings: [], rewriteScope: "TARGETED", affectedFiles: [], hasCritical: false, hasWarning: false, rawResponse: content };
        }
        return parseForgeReviewResponse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Review failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [promptSections],
  );

  return { review, loading, error };
}
