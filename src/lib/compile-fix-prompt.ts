import { PLATFORM_RULES } from "@/lib/platform-rules";
import { formatPatterns } from "@/lib/prompt-builder";
import type { PatternCandidate } from "@/types";

export interface CompileErrorInfo {
  artifact_name: string;
  line: number | null;
  column: number | null;
  error_text: string;
  severity: "ERROR" | "WARNING" | "INFO";
}

/**
 * Build the system prompt for the compile-fix chat.
 * Optionally injects approved correction patterns so the AI learns from past fixes.
 */
export function buildCompileFixSystemPrompt(approvedPatterns?: PatternCandidate[]): string {
  const patternsSection =
    approvedPatterns && approvedPatterns.length > 0
      ? `\n\n## Learned Corrections\n\nThese corrections were taught by the user from previous compile errors. Apply them when relevant:\n\n${formatPatterns(approvedPatterns)}`
      : "";

  return `You are Pac-ST Compile Fix, a specialist in fixing Siemens TIA Portal SCL compile errors.

You will receive compile errors/warnings along with the original SCL source code.
Your job is to analyze the errors, identify root causes, and return corrected SCL code.

${PLATFORM_RULES}${patternsSection}

## Output Format

For each corrected artifact, output the full corrected SCL inside a fenced code block with the artifact name:

\`\`\`scl filename="<ArtifactName>"
<full corrected SCL code>
\`\`\`

IMPORTANT:
- Always output the COMPLETE corrected file, not just the changed lines.
- The filename attribute must match the original artifact name exactly.
- Only output blocks that you actually changed. If a file has no errors, do not include it.
- After the code blocks, provide a brief explanation of what you fixed and why.`;
}

/**
 * Format compile errors + source code into a structured user message.
 */
export function formatCompileErrorContext(
  errors: CompileErrorInfo[],
  warnings: CompileErrorInfo[],
  sources: Record<string, string>
): string {
  const parts: string[] = [];

  // Errors section
  if (errors.length > 0) {
    parts.push("## Compile Errors\n");
    for (const err of errors) {
      const loc = err.line != null ? ` (line ${err.line}${err.column != null ? `, col ${err.column}` : ""})` : "";
      parts.push(`- **${err.artifact_name}**${loc}: ${err.error_text}`);
    }
    parts.push("");
  }

  // Warnings section
  if (warnings.length > 0) {
    parts.push("## Compile Warnings\n");
    for (const w of warnings) {
      const loc = w.line != null ? ` (line ${w.line}${w.column != null ? `, col ${w.column}` : ""})` : "";
      parts.push(`- **${w.artifact_name}**${loc}: ${w.error_text}`);
    }
    parts.push("");
  }

  // Source code section
  const sourceNames = Object.keys(sources);
  if (sourceNames.length > 0) {
    parts.push("## Original SCL Sources\n");
    for (const name of sourceNames) {
      parts.push(`### ${name}\n`);
      parts.push("```scl");
      parts.push(sources[name]);
      parts.push("```\n");
    }
  }

  parts.push("Please fix the compile errors and return the corrected SCL code.");

  return parts.join("\n");
}
