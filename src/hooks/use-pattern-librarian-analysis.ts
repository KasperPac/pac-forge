import { useMutation } from "@tanstack/react-query";
import { getAuthToken } from "@/hooks/use-generation";
import {
  buildPatternLibrarianPrompt,
  parsePatternLibrarianResponse,
} from "@/lib/pattern-librarian-prompt";
import type { PatternLibrarianDiff } from "@/lib/pattern-librarian-prompt";
import { computeDiff, hasFunctionalChanges, extractFocusedSnippets } from "@/lib/diff-engine";
import { classifyCorrections } from "@/lib/correction-classifier";
import type { AgentKnowledgeDoc, PatternCandidate, CorrectionType } from "@/types";

export interface PatternAnalysisCorrection {
  blockName: string;
  correctionType: CorrectionType;
  explanation: string;
  confidence: number;
  originalSnippet: string;
  correctedSnippet: string;
}

export interface PatternAnalysisResult {
  corrections: PatternAnalysisCorrection[];
  aiAnalyzed: boolean;
}

interface AnalysisInput {
  originalSources: Record<string, string>;
  correctedSources: Record<string, string>;
  knowledgeDocs?: AgentKnowledgeDoc[];
  approvedPatterns?: PatternCandidate[];
}

/**
 * Call the Pattern Librarian AI agent to analyze code corrections.
 * Falls back to regex-based classifyCorrections() if the AI call fails.
 */
export function usePatternLibrarianAnalysis() {
  return useMutation({
    mutationFn: async (input: AnalysisInput): Promise<PatternAnalysisResult> => {
      const { originalSources, correctedSources, knowledgeDocs, approvedPatterns } = input;

      // Compute diffs for all changed blocks
      const diffs: PatternLibrarianDiff[] = [];
      const diffResults: Record<string, ReturnType<typeof computeDiff>> = {};

      for (const blockName of Object.keys(correctedSources)) {
        const original = originalSources[blockName];
        const corrected = correctedSources[blockName];
        if (!original || !corrected || original === corrected) continue;

        // Skip blocks with only whitespace/indentation changes
        if (!hasFunctionalChanges(original, corrected)) continue;

        const diff = computeDiff(original, corrected);
        if (!diff.hasChanges) continue;

        diffs.push({ blockName, originalCode: original, correctedCode: corrected });
        diffResults[blockName] = diff;
      }

      if (diffs.length === 0) {
        return { corrections: [], aiAnalyzed: true };
      }

      // Try AI analysis first
      try {
        const { systemPrompt, messages } = buildPatternLibrarianPrompt({
          diffs,
          knowledgeDocs,
          approvedPatterns,
        });

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
              max_tokens: 4096,
            }),
            signal: AbortSignal.timeout(60_000),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`AI call failed (${response.status}): ${text}`);
        }

        const result = await response.json();
        const rawContent = result.content as string;
        const aiCorrections = parsePatternLibrarianResponse(rawContent);

        if (aiCorrections && aiCorrections.length > 0) {
          // Map AI corrections back to full entries with focused snippets
          const corrections: PatternAnalysisCorrection[] = aiCorrections.map((c) => {
            const diff = diffResults[c.blockName];
            let originalSnippet = "(no removed lines)";
            let correctedSnippet = "(no added lines)";

            if (diff) {
              const focused = extractFocusedSnippets(diff);
              originalSnippet = focused.originalSnippet;
              correctedSnippet = focused.correctedSnippet;
            }

            return {
              blockName: c.blockName,
              correctionType: c.correctionType as CorrectionType,
              explanation: c.explanation,
              confidence: c.confidence,
              originalSnippet,
              correctedSnippet,
            };
          });

          return { corrections, aiAnalyzed: true };
        }

        // AI returned empty/unparseable — fall through to regex
        console.warn("Pattern Librarian returned empty result, falling back to regex");
      } catch (err) {
        console.warn("Pattern Librarian AI analysis failed, falling back to regex:", err);
      }

      // Fallback: regex classification
      return regexFallback(diffs, diffResults);
    },
  });
}

/** Regex-based fallback using the existing classifyCorrections() function. */
function regexFallback(
  diffs: PatternLibrarianDiff[],
  diffResults: Record<string, ReturnType<typeof computeDiff>>
): PatternAnalysisResult {
  const corrections: PatternAnalysisCorrection[] = [];

  for (const d of diffs) {
    const diff = diffResults[d.blockName];
    if (!diff) continue;

    const focused = extractFocusedSnippets(diff);

    const classified = classifyCorrections(diff, { artifactName: d.blockName });
    if (classified.length > 0) {
      for (const c of classified) {
        corrections.push({
          blockName: d.blockName,
          correctionType: c.correctionType,
          explanation: c.explanationTag,
          confidence: c.confidence,
          originalSnippet: focused.originalSnippet,
          correctedSnippet: focused.correctedSnippet,
        });
      }
    } else {
      // Generic fallback
      corrections.push({
        blockName: d.blockName,
        correctionType: "STATE_LOGIC",
        explanation: `Manual correction in ${d.blockName}`,
        confidence: 0.3,
        originalSnippet: focused.originalSnippet,
        correctedSnippet: focused.correctedSnippet,
      });
    }
  }

  return { corrections, aiAnalyzed: false };
}
