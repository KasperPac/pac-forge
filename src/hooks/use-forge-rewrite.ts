import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildForgeRewritePrompt,
  buildForgeRewriteUserMessage,
  buildForgePatternAnalysisPrompt,
  buildForgePatternAnalysisUserMessage,
} from "@/lib/forge-agent-prompts";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { supabase } from "@/lib/supabase";
import type { ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { ReviewFinding } from "@/lib/forge-review-parser";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

/** Re-parse rewritten SCL artifacts from Code Architect response. */
function parseRewrittenArtifacts(
  responseText: string,
  originals: ForgeArtifact[],
): ForgeArtifact[] {
  const blockRe = /```scl\s+\[(\w+):([^\]]+)\]\s*\n([\s\S]*?)```/gi;
  const parsed = new Map<string, { type: string; content: string }>();

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(responseText)) !== null) {
    const [, blockType, blockName, code] = match;
    parsed.set(blockName.trim(), { type: blockType.toUpperCase(), content: code.trim() });
  }

  // Merge: update originals that were rewritten, keep the rest
  return originals.map((orig) => {
    const rewritten = parsed.get(orig.name);
    if (rewritten) {
      return { ...orig, content: rewritten.content };
    }
    return orig;
  });
}

/** Save a pattern diff to the pattern_candidates table (fire-and-forget). */
async function savePattern(
  artifactName: string,
  originalCode: string,
  fixedCode: string,
  systemPrompt: string,
): Promise<void> {
  try {
    const controller = new AbortController();
    const { content } = await callNonStreaming(
      systemPrompt,
      [{ role: "user", content: buildForgePatternAnalysisUserMessage(originalCode, fixedCode, artifactName) }],
      controller.signal,
      2048,
    );

    // Attempt to extract JSON (may or may not have fences)
    const jsonStr = content.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
    const pattern = JSON.parse(jsonStr) as {
      correction_type: string;
      original_snippet: string;
      corrected_snippet: string;
      explanation_tag: string;
      context: string;
    };

    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("pattern_candidates").insert({
      plc_brand: "SIEMENS_TIA",
      device_type: artifactName,
      context: pattern.context,
      original_snippet: pattern.original_snippet,
      corrected_snippet: pattern.corrected_snippet,
      correction_type: pattern.correction_type,
      explanation_tag: pattern.explanation_tag,
      status: "PENDING",
      created_by: user?.id ?? "",
    });
  } catch {
    // Pattern analysis is non-critical — don't fail the rewrite if it errors
  }
}

export function useForgeRewrite() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewrite = useCallback(
    async (
      artifacts: ForgeArtifact[],
      findings: ReviewFinding[],
      profile?: DesignProfile,
    ): Promise<ForgeArtifact[]> => {
      setLoading(true);
      setError(null);

      try {
        const platformRules = PLATFORM_RULES;
        const profileRules = profile?.general_rules ?? undefined;
        const systemPrompt = buildForgeRewritePrompt(platformRules, profileRules, promptSections);
        const userMessage = buildForgeRewriteUserMessage(findings, artifacts);
        const controller = new AbortController();

        const agentType = "code_architect_scl";

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          8192,
          agentType,
          !!profile,
        );

        const rewritten = parseRewrittenArtifacts(content, artifacts);

        // Kick off pattern analysis for each changed artifact (fire-and-forget).
        // TODO (FIX 7): Once the review/rewrite pipeline is fully implemented end-to-end,
        // extend this to also compute diffs between original generation and final rewritten
        // artifacts (not just per-rewrite-round diffs) for higher-signal pattern candidates.
        const patternSystemPrompt = buildForgePatternAnalysisPrompt(promptSections);
        for (const orig of artifacts) {
          const updated = rewritten.find((r) => r.id === orig.id);
          if (updated && updated.content !== orig.content) {
            void savePattern(orig.name, orig.content, updated.content, patternSystemPrompt);
          }
        }

        return rewritten;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rewrite failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { rewrite, loading, error };
}
