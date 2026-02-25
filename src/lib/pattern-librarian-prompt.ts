import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatPatterns } from "@/lib/prompt-builder";
import type { AgentKnowledgeDoc, PatternCandidate } from "@/types";

export interface PatternLibrarianDiff {
  blockName: string;
  originalCode: string;
  correctedCode: string;
}

export interface PatternLibrarianInput {
  diffs: PatternLibrarianDiff[];
  knowledgeDocs?: AgentKnowledgeDoc[];
  approvedPatterns?: PatternCandidate[];
  promptSections?: Record<string, string>;
}

/**
 * Build system prompt + user message for Pattern Librarian AI analysis.
 * The Pattern Librarian analyzes before/after diffs and returns structured
 * correction classifications with explanations.
 */
export function buildPatternLibrarianPrompt(input: PatternLibrarianInput): {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const { diffs, knowledgeDocs, approvedPatterns, promptSections } = input;
  const profile = getAgentProfile("Pattern Librarian");

  // --- System Prompt ---

  const identity = interpolateAgent(
    resolveSection(promptSections, "patterns", "identity"),
    { name: "Pattern Librarian", tagline: profile.tagline, description: profile.description, personality: profile.personality },
  );
  const instructions = resolveSection(promptSections, "patterns", "instructions");

  const outputFormat = `## Output Format

Respond with ONLY a JSON array. No markdown fencing, no explanation outside the array. Each element:

\`\`\`
[
  {
    "blockName": "FB_MotorControl",
    "correctionType": "STATE_LOGIC",
    "explanation": "The original code was missing the STOPPING state transition — when i_Stop was asserted during RUN state, the motor immediately jumped to STOPPED without ramping down. The fix adds state 3 (STOPPING) with a speed ramp-down before transitioning to STOPPED.",
    "confidence": 0.95
  }
]
\`\`\``;

  const knowledgeSection =
    knowledgeDocs && knowledgeDocs.length > 0
      ? `\n\n## Reference Knowledge\n\nThe following knowledge has been provided to guide your analysis. Apply it when classifying and explaining corrections:\n\n${knowledgeDocs.map((d) => `### ${d.title}\n${d.content}`).join("\n\n")}`
      : "";

  const patternsSection =
    approvedPatterns && approvedPatterns.length > 0
      ? `\n\n## Existing Approved Patterns\n\nThese patterns have already been saved. Avoid creating duplicates. If a correction matches an existing pattern, note this in your explanation and still classify it.\n\n${formatPatterns(approvedPatterns)}`
      : "";

  const systemPrompt = `${identity}\n\n${instructions}\n\n${outputFormat}${knowledgeSection}${patternsSection}`;

  // --- User Message ---

  const diffBlocks = diffs
    .map(
      (d) =>
        `## Block: ${d.blockName}\n\n### Before (original — incorrect):\n\`\`\`scl\n${d.originalCode}\n\`\`\`\n\n### After (corrected — fixed):\n\`\`\`scl\n${d.correctedCode}\n\`\`\``
    )
    .join("\n\n---\n\n");

  const userMessage = `Analyze the following ${diffs.length} code correction${diffs.length !== 1 ? "s" : ""} and classify each one.\n\n${diffBlocks}`;

  return {
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
}

/**
 * Parse the Pattern Librarian's JSON response into structured corrections.
 * Returns null if parsing fails.
 */
export function parsePatternLibrarianResponse(
  raw: string
): Array<{
  blockName: string;
  correctionType: string;
  explanation: string;
  confidence: number;
}> | null {
  try {
    // Strip markdown fencing if the model wrapped it
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    // Validate each entry has required fields
    const VALID_TYPES = new Set([
      "NAMING",
      "IO_MAPPING",
      "STATE_LOGIC",
      "ALARM",
      "SAFETY",
      "TIMING",
    ]);

    return parsed
      .filter(
        (item: unknown): item is Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).blockName === "string" &&
          typeof (item as Record<string, unknown>).correctionType === "string" &&
          typeof (item as Record<string, unknown>).explanation === "string"
      )
      .map((item) => ({
        blockName: item.blockName as string,
        correctionType: VALID_TYPES.has(item.correctionType as string)
          ? (item.correctionType as string)
          : "STATE_LOGIC",
        explanation: item.explanation as string,
        confidence:
          typeof item.confidence === "number"
            ? Math.min(Math.max(item.confidence as number, 0), 1)
            : 0.5,
      }));
  } catch {
    return null;
  }
}
