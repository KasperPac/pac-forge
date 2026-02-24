import type { Agent, Project, AgentKnowledgeDoc } from "@/types";
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
}

/**
 * Builds the PM's pre-pipeline plan prompt.
 * The PM analyzes the request and outlines which agents should be engaged.
 */
export function buildPlanPrompt(input: PlanPromptInput): BuiltPrompt {
  const { pmAgent, availableAgents, project, knowledgeDocs, userMessage } = input;

  const agentList = availableAgents
    .map((a) => {
      const profile = getAgentProfile(a.display_name);
      return `- **${a.display_name}** [${a.specialties.join(", ")}]: ${profile.tagline}`;
    })
    .join("\n");

  const knowledgeSection = formatKnowledgeDocs(knowledgeDocs ?? []);

  const systemPrompt = `You are the Project Manager for the Pac-ST agent pipeline.

Your role is to analyze the user's request and create a brief execution plan. You do NOT generate or modify code — you coordinate.

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

## Your Task

Analyze the user's request and respond with:
1. **Request Analysis**: What is being asked? What are the key requirements?
2. **Execution Plan**: Which agents should be engaged and in what order?
3. **Key Concerns**: Any risks, ambiguities, or things to watch for?
4. **Expected Output**: What artifacts should the pipeline produce?

Keep your response concise — this is an internal planning document, not user-facing.`;

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
}

/**
 * Builds the PM's post-pipeline summary prompt.
 * The PM synthesizes results from all agents into a final report.
 */
export function buildSummaryPrompt(input: SummaryPromptInput): BuiltPrompt {
  const { pmAgent, project, knowledgeDocs, steps, artifactCount } = input;

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

  const systemPrompt = `You are the Project Manager wrapping up a Pac-ST pipeline execution.

## Project Context
- Client: ${project.client_name}
- CPU: ${project.cpu_type} / TIA ${project.tia_version}

${knowledgeSection}

${pmAgent.system_prompt ? `## Additional Instructions\n${pmAgent.system_prompt}` : ""}

## Your Task

Synthesize the pipeline results into a clear, concise summary report:
1. **Status**: Overall pipeline outcome (success / partial / failure)
2. **What was generated**: ${artifactCount} artifact(s) — list key blocks
3. **Agent Contributions**: What each agent did (keep brief)
4. **Conflicts**: Any disagreements between reviewers?
5. **Recommendations**: Next steps or things to review manually

Keep the summary focused and actionable.`;

  const userMessage = `The pipeline has completed. Here are the results from each agent:\n\n${stepSummaries}`;

  return {
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
  };
}
