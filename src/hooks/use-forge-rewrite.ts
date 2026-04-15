import { useState, useCallback } from "react";
import { callStreamingCollect, callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildForgeRewritePrompt,
  buildForgeRewriteUserMessage,
  buildForgePatternAnalysisPrompt,
  buildForgePatternAnalysisUserMessage,
} from "@/lib/forge-agent-prompts";
import { parseJsonResponse } from "@/lib/json-response";
import { loadPlatformRules } from "@/lib/platform-rules";
import { supabase } from "@/lib/supabase";
import type { ForgeArtifact } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { ReviewFinding } from "@/lib/forge-review-parser";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

/** Re-parse rewritten artifacts (SCL or LAD JSON) from Code Architect response. */
function parseRewrittenArtifacts(
  responseText: string,
  originals: ForgeArtifact[],
): ForgeArtifact[] {
  // Match both ```scl [TYPE:Name] and ```json [TYPE:Name] blocks
  const blockRe = /```(?:scl|json)\s+\[(\w+):([^\]]+)\]\s*\n([\s\S]*?)```/gi;
  const parsed = new Map<string, { type: string; content: string }>();

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(responseText)) !== null) {
    const [, blockType, blockName, code] = match;
    parsed.set(blockName.trim(), { type: blockType.toUpperCase(), content: code.trim() });
  }

  // Merge: update originals that were rewritten, keep the rest.
  // Protect instance DBs — they have a fixed structure (DATA_BLOCK + FB ref)
  // that must not be modified by the rewriter.
  return originals.map((orig) => {
    const rewritten = parsed.get(orig.name);
    if (rewritten) {
      // Instance DBs (Inst*) are deterministically generated — never overwrite
      if (orig.type === "DB" && /^Inst[A-Z]/.test(orig.name)) {
        return orig;
      }
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
      { prompt_name: "forge-rewrite-pattern-analysis", agent_role: "pattern_librarian", pipeline_step: "rewrite_pattern_analysis" },
    );

    const pattern = parseJsonResponse<{
      correction_type: string;
      original_snippet: string;
      corrected_snippet: string;
      explanation_tag: string;
      context: string;
    }>(content);
    if (!pattern) return;

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
        const platformRules = loadPlatformRules("review");
        const profileRules = profile?.general_rules ?? undefined;
        const systemPrompt = buildForgeRewritePrompt(platformRules, profileRules, promptSections);
        const userMessage = buildForgeRewriteUserMessage(findings, artifacts);
        const controller = new AbortController();

        const agentType = "code_architect_scl";

        const { content } = await validateAndCall(
          callStreamingCollect,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          16384,
          agentType,
          !!profile,
          { prompt_name: "forge-rewrite", agent_role: agentType, pipeline_step: "rewrite" },
        );

        const rewritten = parseRewrittenArtifacts(content, artifacts);

        // Log rewrite results
        const changedCount = rewritten.filter((r, i) => r.content !== artifacts[i]?.content).length;
        console.log(`[forge-rewrite] Rewrite complete: ${changedCount}/${artifacts.length} artifacts changed`);
        if (changedCount === 0) {
          console.warn("[forge-rewrite] No artifacts were changed — the agent may not have understood the findings or returned incorrect block format");
          console.log("[forge-rewrite] Response preview:", content.slice(0, 500));
        }

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
