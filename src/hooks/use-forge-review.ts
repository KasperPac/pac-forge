import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildForgeReviewPrompt,
  buildForgeReviewUserMessage,
  type ReviewStage,
} from "@/lib/forge-agent-prompts";
import {
  parseForgeReviewResponse,
  isCleanReview,
  type ForgeReviewResult,
} from "@/lib/forge-review-parser";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import type { ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

export type { ReviewStage };

export function useForgeReview() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = useCallback(
    async (
      artifacts: ForgeArtifact[],
      stage: ReviewStage,
      profile?: DesignProfile,
    ): Promise<ForgeReviewResult> => {
      setLoading(true);
      setError(null);

      try {
        const platformRules = PLATFORM_RULES;
        const profileRules = profile?.general_rules ?? undefined;
        const systemPrompt = buildForgeReviewPrompt(stage, platformRules, profileRules, promptSections);
        const userMessage = buildForgeReviewUserMessage(artifacts);
        const controller = new AbortController();

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          4096,
          "standards_reviewer",
          !!profile,
        );

        if (isCleanReview(content)) {
          return {
            findings: [],
            rewriteScope: "TARGETED",
            affectedFiles: [],
            hasCritical: false,
            hasWarning: false,
            rawResponse: content,
          };
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
    [],
  );

  return { review, loading, error };
}
