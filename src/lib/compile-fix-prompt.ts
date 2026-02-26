import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { formatIoList, formatFbTemplates } from "@/lib/prompt-builder";
import { getAgentProfile } from "@/lib/agent-profiles";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";
import type { PatternCandidate, DesignProfile, AgentKnowledgeDoc, Project, FbTemplate, ReferenceLibrarySection } from "@/types";

export interface CompileErrorInfo {
  artifact_name: string;
  line: number | null;
  column: number | null;
  error_text: string;
  severity: "ERROR" | "WARNING" | "INFO";
}

export interface CompileFixPromptInput {
  approvedPatterns?: PatternCandidate[];
  designProfile?: DesignProfile;
  knowledgeDocs?: AgentKnowledgeDoc[];
  promptSections?: Record<string, string>;
  /** Project context — so the fix agent knows IO mappings, CPU, safety level, etc. */
  project?: Project;
  /** FB templates — so the fix agent preserves company-standard block structures */
  fbTemplates?: FbTemplate[];
  /** Reference library sections retrieved via AI topic lookup */
  referenceSections?: ReferenceLibrarySection[];
}

/**
 * Build the system prompt for the compile-fix chat.
 * Includes the full project context so the Code Architect can fix errors
 * without losing awareness of IO mappings, FB templates, and project rules.
 */
export function buildCompileFixSystemPrompt(input: CompileFixPromptInput): string {
  const { designProfile, knowledgeDocs, promptSections, project, fbTemplates } = input;

  const codeArchitect = getAgentProfile("Code Architect");
  const identity = interpolateAgent(
    resolveSection(promptSections, "compile_fix", "identity"),
    { name: "Code Architect", tagline: codeArchitect.tagline, description: codeArchitect.description, personality: codeArchitect.personality },
  );
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");
  const instructions = resolveSection(promptSections, "compile_fix", "instructions");

  const projectSection = project
    ? `\n\n## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}${project.safety_notes ? `\n- Safety Notes: ${project.safety_notes}` : ""}

## IO List
${formatIoList(project.io_lists)}` : "";

  const fbSection =
    fbTemplates && fbTemplates.length > 0
      ? `\n\n${formatFbTemplates(fbTemplates)}`
      : "";

  const profileSection =
    designProfile?.rules?.trim()
      ? `\n\n## Code Design Profile: ${designProfile.name}\n\n${designProfile.rules}`
      : "";

  const knowledgeSection =
    knowledgeDocs && knowledgeDocs.length > 0
      ? `\n\n## Reference Documentation\n\n${knowledgeDocs.map((d) => `### ${d.title}\n${d.content}`).join("\n\n")}`
      : "";

  return `${identity}

${buildPriorityHierarchyBlock()}

${platformRules}

${codeExamples}${projectSection}${profileSection}${fbSection}${knowledgeSection}

${instructions}

## Output Format

For each corrected artifact, output the full corrected SCL inside a fenced code block with the artifact name:

\`\`\`scl filename="<ArtifactName>"
<full corrected SCL code>
\`\`\``;
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

  // Source code section — include line numbers so the AI can locate the error lines
  const sourceNames = Object.keys(sources);
  if (sourceNames.length > 0) {
    parts.push("## Original SCL Sources\n");
    parts.push("Line numbers are shown at the start of each line to match the compiler error locations.\n");
    for (const name of sourceNames) {
      parts.push(`### ${name}\n`);
      parts.push("```scl");
      const lines = sources[name].split("\n");
      for (let i = 0; i < lines.length; i++) {
        parts.push(`${String(i + 1).padStart(4)} | ${lines[i]}`);
      }
      parts.push("```\n");
    }
  }

  parts.push("Please fix the compile errors and return the corrected SCL code.");

  return parts.join("\n");
}
