import type {
  Project,
  Agent,
  PatternCandidate,
  FbTemplate,
  DesignProfile,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
} from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { buildContextMessages, formatFbTemplates, formatDesignProfile } from "@/lib/prompt-builder";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import type { ReviewReport } from "@/lib/review-response-parser";

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface RewritePromptInput {
  generator: Agent;
  artifacts: ParsedArtifact[];
  reviewReports: Array<{ reviewerName: string; report: ReviewReport }>;
  project: Project;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  /** Current review-rewrite round (1-indexed). Rounds >= 2 add escalation context. */
  round?: number;
  /** Maximum rounds allowed. Used in escalation messaging. */
  maxRounds?: number;
}


function formatKnowledgeDocs(docs: AgentKnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const sections = docs.map((d) => `#### [${d.short_id}] ${d.title}\n${d.content}`);
  return `## Reference Documentation\n\n${sections.join("\n\n---\n\n")}`;
}

function formatFindings(
  reviewReports: Array<{ reviewerName: string; report: ReviewReport }>
): string {
  const reportsWithFindings = reviewReports.filter((r) => r.report.hasFindings);
  if (reportsWithFindings.length === 0) return "";

  const sections = reportsWithFindings.map((r) => {
    const findingLines = r.report.findings
      .sort((a, b) => {
        const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
        return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
      })
      .map((f) => `- **[${f.severity}]** ${f.artifactName}: ${f.description}`)
      .join("\n");
    return `### ${r.reviewerName}\n${findingLines}`;
  });

  return sections.join("\n\n");
}

const OUTPUT_FORMAT = `## Output Format

You MUST output ALL artifacts (both changed and unchanged) as separate delimited blocks:

\`\`\`scl filename="<BlockName>.scl" type="<ARTIFACT_TYPE>" name="<BlockName>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Ensure ALL artifacts are present — especially Main (OB1) and instance DBs. After all artifact blocks, provide a brief summary of what you changed.`;

/**
 * Build a prompt for the Code Architect to rewrite artifacts
 * based on findings from reviewer agents.
 */
export function buildRewritePrompt(input: RewritePromptInput): BuiltPrompt {
  const {
    generator,
    artifacts,
    reviewReports,
    project,
    knowledgeDocs,
    designProfile,
    approvedPatterns,
    fbTemplates,
    promptSections,
    referenceSections,
    round,
    maxRounds,
  } = input;

  const profile = getAgentProfile(generator.display_name);

  const identity = interpolateAgent(
    resolveSection(promptSections, "rewrite", "identity"),
    { name: generator.display_name, tagline: profile.tagline },
  );
  const instructions = resolveSection(promptSections, "rewrite", "instructions");
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");

  const findingsSection = formatFindings(reviewReports);
  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);
  const profileSection = designProfile ? formatDesignProfile(designProfile) : "";
  const fbSection = formatFbTemplates(fbTemplates ?? []);

  const systemPrompt = `${identity}

${instructions}

${profileSection ? `${profileSection}\n\n**REWRITE RULE:** The Design Profile above defines the authoritative naming conventions and style for this project. Do NOT change names, prefixes, or structural patterns to match Platform Rules defaults if they already follow the Design Profile.\n` : ""}
${platformRules}

${codeExamples}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

${knowledgeSection}

${fbSection}

${round != null && round >= 2 && maxRounds != null ? `## IMPORTANT: This is rewrite attempt ${round} of ${maxRounds}

Previous rewrite attempts did NOT fully resolve the review findings below. The reviewers found these issues STILL PRESENT after your last rewrite. Pay extra attention to CRITICAL findings — they MUST be fixed this time.

` : ""}## Review Findings — Address ALL Issues Below

The following issues were identified by specialist reviewers. You MUST address every CRITICAL and WARNING finding. INFO findings are optional improvements.

${findingsSection}

${generator.system_prompt ? `## Additional Instructions\n${generator.system_prompt}` : ""}

${OUTPUT_FORMAT}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  const artifactBlocks = artifacts
    .map(
      (a) =>
        `### ${a.name} (${a.type})\nFilename: ${a.filename}\nDependencies: ${a.dependencies.join(", ") || "none"}\n\n\`\`\`scl\n${a.content}\n\`\`\``
    )
    .join("\n\n---\n\n");

  const userMessage = `The following artifacts were generated and reviewed by specialist agents. Rewrite them to address all review findings listed in the system prompt. Output ALL artifacts (both changed and unchanged).

${artifactBlocks}`;

  return {
    systemPrompt,
    messages: [...contextMessages, { role: "user" as const, content: userMessage }],
  };
}
