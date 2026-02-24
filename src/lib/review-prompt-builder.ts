import type {
  Agent,
  Project,
  DesignProfile,
  PatternCandidate,
  AgentKnowledgeDoc,
} from "@/types";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatPatterns } from "@/lib/prompt-builder";
import type { ParsedArtifact } from "@/lib/artifact-parser";

export interface ReviewPromptInput {
  agent: Agent;
  artifacts: ParsedArtifact[];
  project: Project;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
}

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function formatKnowledgeDocs(docs: AgentKnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const sections = docs.map(
    (d) => `### ${d.title}\n${d.content}`
  );
  return `## Reference Documentation\n\nThe following documents are part of your knowledge base. Use them as reference when performing your review.\n\n${sections.join("\n\n---\n\n")}`;
}

function formatDesignProfile(profile: DesignProfile): string {
  if (!profile.rules.trim()) return "";
  return `## Code Design Profile: ${profile.name}\n\nThe following rules define the customer's code standards. ALL generated code MUST follow these rules exactly.\n\n${profile.rules}`;
}

function formatArtifactsForReview(artifacts: ParsedArtifact[]): string {
  return artifacts
    .map(
      (a) =>
        `### ${a.name} (${a.type})\nFilename: ${a.filename}\nDependencies: ${a.dependencies.join(", ") || "none"}\n\n\`\`\`scl\n${a.content}\n\`\`\``
    )
    .join("\n\n---\n\n");
}

/**
 * Builds a system prompt + messages for a reviewer agent.
 * The reviewer receives all generated artifacts and must either
 * return corrected versions or indicate no changes are needed.
 */
export function buildReviewPrompt(input: ReviewPromptInput): BuiltPrompt {
  const { agent, artifacts, project, knowledgeDocs, designProfile, approvedPatterns } = input;

  const profile = getAgentProfile(agent.display_name);

  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);
  const profileSection = designProfile ? formatDesignProfile(designProfile) : "";
  const patternsSection = approvedPatterns && approvedPatterns.length > 0
    ? `## MANDATORY: Learned Corrections from Previous Compile Errors\n\n${formatPatterns(approvedPatterns)}`
    : "";

  const systemPrompt = `You are ${agent.display_name}, a specialist PLC code reviewer for Siemens TIA Portal.

**Role:** ${profile.tagline}
**Personality:** ${profile.description}

## Your Review Task

You are reviewing generated SCL (Structured Control Language) code artifacts. Your job is to:
1. Inspect each artifact according to your specialty
2. If you find issues, return the CORRECTED artifacts using the same output format
3. If all artifacts pass your review, respond with: NO_CHANGES: [brief explanation of what you checked]

## Output Format for Corrections

When returning corrected artifacts, use this exact format:

\`\`\`scl filename="<path>" type="<TYPE>" name="<BlockName>" dependencies="<deps>"
<corrected SCL code>
\`\`\`

Only include artifacts you have MODIFIED. Unchanged artifacts should NOT be repeated.
After the corrected artifacts, provide a brief summary of what you changed and why.

${PLATFORM_RULES}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

${profileSection}

${knowledgeSection}

${patternsSection}

${agent.system_prompt ? `## Additional Instructions\n${agent.system_prompt}` : ""}`;

  const userMessage = `Please review the following generated PLC code artifacts:\n\n${formatArtifactsForReview(artifacts)}`;

  return {
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
  };
}
