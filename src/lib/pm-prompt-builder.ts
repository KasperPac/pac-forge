import type { Agent, Project, AgentKnowledgeDoc } from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import type { PipelineStepResult } from "@/lib/pipeline";

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function formatKnowledgeDocs(docs: AgentKnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const sections = docs.map((d) => `### ${d.title}\n${d.content}`);
  return `## Reference Documentation\n\n${sections.join("\n\n---\n\n")}`;
}

// --- Plan Phase (pre-generation) ---

export interface PlanPromptInput {
  pmAgent: Agent;
  availableAgents: Agent[];
  project: Project;
  knowledgeDocs?: AgentKnowledgeDoc[];
  userMessage: string;
  promptSections?: Record<string, string>;
}

/**
 * Builds the PM's pre-pipeline plan prompt.
 * The PM analyzes the request and outlines which agents should be engaged.
 */
export function buildPlanPrompt(input: PlanPromptInput): BuiltPrompt {
  const { pmAgent, availableAgents, project, knowledgeDocs, userMessage, promptSections } = input;

  const pmProfile = getAgentProfile("Project Manager");
  const identity = interpolateAgent(
    resolveSection(promptSections, "plan", "identity"),
    { name: "Project Manager", tagline: pmProfile.tagline, description: pmProfile.description, personality: pmProfile.personality },
  );
  const instructions = resolveSection(promptSections, "plan", "instructions");

  const agentList = availableAgents
    .map((a) => {
      const profile = getAgentProfile(a.display_name);
      return `- **${a.display_name}** [${a.specialties.join(", ")}]: ${profile.tagline}`;
    })
    .join("\n");

  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);

  const systemPrompt = `${identity}

## Available Agents
${agentList}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

${knowledgeSection}

${pmAgent.system_prompt ? `## Additional Instructions\n${pmAgent.system_prompt}` : ""}

${instructions}`;

  return {
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
  };
}

// --- Summary Phase (post-pipeline) ---

export interface SummaryPromptInput {
  pmAgent: Agent;
  project: Project;
  knowledgeDocs?: AgentKnowledgeDoc[];
  steps: PipelineStepResult[];
  artifactCount: number;
  promptSections?: Record<string, string>;
}

/**
 * Builds the PM's post-pipeline summary prompt.
 * The PM synthesizes results from all agents into a final report.
 */
export function buildSummaryPrompt(input: SummaryPromptInput): BuiltPrompt {
  const { pmAgent, project, knowledgeDocs, steps, artifactCount, promptSections } = input;

  const pmProfile2 = getAgentProfile("Project Manager");
  const identity = interpolateAgent(
    resolveSection(promptSections, "summary", "identity"),
    { name: "Project Manager", tagline: pmProfile2.tagline, description: pmProfile2.description, personality: pmProfile2.personality },
  );
  const instructions = resolveSection(promptSections, "summary", "instructions");

  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);

  const stepSummaries = steps
    .map((s) => {
      const statusIcon = s.status === "completed" ? "[OK]" : s.status === "failed" ? "[FAIL]" : `[${s.status.toUpperCase()}]`;
      const modifications = s.artifactsModified.length > 0
        ? `Modified: ${s.artifactsModified.join(", ")}`
        : "No modifications";
      const duration = `${(s.durationMs / 1000).toFixed(1)}s`;
      return `- ${statusIcon} **${s.agentName}** (${s.role}) — ${duration} — ${modifications}\n  Summary: ${s.summary || "(no summary)"}`;
    })
    .join("\n");

  const systemPrompt = `${identity}

## Project Context
- Client: ${project.client_name}
- CPU: ${project.cpu_type} / TIA ${project.tia_version}
- Artifacts generated: ${artifactCount}

${knowledgeSection}

${pmAgent.system_prompt ? `## Additional Instructions\n${pmAgent.system_prompt}` : ""}

${instructions}`;

  const userMessage = `The pipeline has completed. Here are the results from each agent:\n\n${stepSummaries}`;

  return {
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
  };
}
