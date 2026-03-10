import type {
  Agent,
  Project,
  DesignProfile,
  PatternCandidate,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
} from "@/types";
import type { ProcessStage } from "@/types/process-builder";
import type { PromptRole } from "@/types/prompt-section";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatDesignProfile } from "@/lib/prompt-builder";
import { buildContextMessages } from "@/lib/prompt-builder";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";
import type { ParsedArtifact } from "@/lib/artifact-parser";

export interface ReviewPromptInput {
  agent: Agent;
  artifacts: ParsedArtifact[];
  project: Project;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  /** When set, constrains the review to only what this stage produced. */
  stage?: ProcessStage;
}

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function formatKnowledgeDocs(docs: AgentKnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const sections = docs.map(
    (d) => `### [${d.short_id}] ${d.title}\n${d.content}`
  );
  return `## Reference Documentation\n\nThe following documents are part of your knowledge base. Use them as reference when performing your review.\n\n${sections.join("\n\n---\n\n")}`;
}


function formatArtifactsForReview(artifacts: ParsedArtifact[]): string {
  return artifacts
    .map(
      (a) =>
        `### ${a.name} (${a.type})\nFilename: ${a.filename}\nDependencies: ${a.dependencies.join(", ") || "none"}\n\n\`\`\`scl\n${a.content}\n\`\`\``
    )
    .join("\n\n---\n\n");
}

/** Maps a ProcessStage to its dedicated review-scope PromptRole. */
const STAGE_TO_ROLE: Partial<Record<ProcessStage, PromptRole>> = {
  io: "review_scope_io",
  fb: "review_scope_fb",
  db: "review_scope_db",
  fc_ob: "review_scope_fc",
};

/**
 * Returns the Review Scope block for this stage, resolved from DB overrides
 * → prompt defaults.  Returns empty string for stages with no review scope
 * (qa, folders).
 */
function buildStageReviewScope(
  stage: ProcessStage,
  promptSections: Record<string, string> | undefined,
): string {
  const role = STAGE_TO_ROLE[stage];
  if (!role) return "";
  const content = resolveSection(promptSections, role, "scope");
  if (!content.trim()) return "";
  return `## Review Scope\n\n${content}`;
}

/**
 * Builds a system prompt + messages for a reviewer agent.
 * The reviewer receives all generated artifacts and must either
 * return corrected versions or indicate no changes are needed.
 * When `stage` is provided, the review is scoped to only what that stage produces.
 */
export function buildReviewPrompt(input: ReviewPromptInput): BuiltPrompt {
  const { agent, artifacts, project, knowledgeDocs, designProfile, approvedPatterns, promptSections, referenceSections, stage } = input;

  const profile = getAgentProfile(agent.display_name);

  const identity = interpolateAgent(
    resolveSection(promptSections, "review", "identity"),
    { name: agent.display_name, tagline: profile.tagline, description: profile.description },
  );
  const instructions = resolveSection(promptSections, "review", "instructions");
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");

  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);
  const profileSection = designProfile ? formatDesignProfile(designProfile) : "";
  const stageScopeSection = stage ? buildStageReviewScope(stage, promptSections) : "";

  const systemPrompt = `${identity}

${instructions}

${stageScopeSection ? `${stageScopeSection}\n` : ""}${buildPriorityHierarchyBlock()}

## Output Format

If no issues found:
NO_CHANGES: [brief explanation of what you checked]

If issues found, respond with a structured report:

## Findings

### [ArtifactName]
- **[CRITICAL]**: [description of issue and what should be changed]
- **[WARNING]**: [description of issue and what should be changed]
- **[INFO]**: [description of observation or suggestion]

### [NextArtifactName]
- ...

## Summary
[brief summary of what you found and the overall quality assessment]

${profileSection ? `${profileSection}\n\n**REVIEW RULE:** Do NOT flag naming conventions, prefixes, or structural patterns that match the Design Profile above — even if they differ from Platform Rules defaults. The customer's Design Profile defines the authoritative naming standard for this project.\n` : ""}
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

${agent.system_prompt ? `## Additional Instructions\n${agent.system_prompt}` : ""}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);
  const userMessage = `Please review the following generated PLC code artifacts:\n\n${formatArtifactsForReview(artifacts)}`;

  return {
    systemPrompt,
    messages: [...contextMessages, { role: "user" as const, content: userMessage }],
  };
}
