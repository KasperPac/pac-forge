import type {
  Project,
  Agent,
  PatternCandidate,
  FbTemplate,
  DesignProfile,
  AgentKnowledgeDoc,
} from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatPatterns } from "@/lib/prompt-builder";
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
}

function formatDesignProfile(profile: DesignProfile): string {
  if (!profile.rules.trim()) return "";
  return `## Code Design Profile: ${profile.name}

The following rules define the customer's code standards. ALL generated code MUST follow these rules exactly.

${profile.rules}`;
}

function formatFbTemplates(templates: FbTemplate[]): string {
  if (templates.length === 0) return "";
  const blocks = templates.map((t) => {
    const header = `### ${t.name} [${t.device_category}]`;
    const desc = t.description ? `${t.description}\n` : "";
    return `${header}\n${desc}\`\`\`scl\n${t.base_scl}\n\`\`\``;
  });
  return `## FB Library Templates

Use these company-standard FB templates as the base for matching device types.

${blocks.join("\n\n")}`;
}

function formatKnowledgeDocs(docs: AgentKnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const sections = docs.map((d) => `#### ${d.title}\n${d.content}`);
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

\`\`\`scl filename="<relative_path>" type="<ARTIFACT_TYPE>" name="<BlockName>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

After all artifact blocks, provide a brief summary of what you changed.`;

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
  } = input;

  const profile = getAgentProfile(generator.display_name);

  const identity = interpolateAgent(
    resolveSection(promptSections, "rewrite", "identity"),
    { name: generator.display_name, tagline: profile.tagline },
  );
  const instructions = resolveSection(promptSections, "rewrite", "instructions");
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");

  const findingsSection = formatFindings(reviewReports);
  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);
  const profileSection = designProfile ? formatDesignProfile(designProfile) : "";
  const fbSection = formatFbTemplates(fbTemplates ?? []);
  const patternsSection = approvedPatterns && approvedPatterns.length > 0
    ? `## MANDATORY: Learned Corrections from Previous Compile Errors

The following corrections were learned from real TIA Portal compile failures. You MUST apply every one of these rules.

${formatPatterns(approvedPatterns)}`
    : "";

  const systemPrompt = `${identity}

${instructions}

${platformRules}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

${profileSection}

${knowledgeSection}

${fbSection}

${patternsSection}

## Review Findings — Address ALL Issues Below

The following issues were identified by specialist reviewers. You MUST address every CRITICAL and WARNING finding. INFO findings are optional improvements.

${findingsSection}

${generator.system_prompt ? `## Additional Instructions\n${generator.system_prompt}` : ""}

${OUTPUT_FORMAT}`;

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
    messages: [{ role: "user" as const, content: userMessage }],
  };
}
