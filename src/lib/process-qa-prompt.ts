import type { Project, Agent, DesignProfile, AgentKnowledgeDoc, FbTemplate } from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatDesignProfile, formatIoList, formatFbTemplates } from "@/lib/prompt-builder";
import { getCompatibleModules } from "@/lib/module-catalog";
import type { ModuleCatalogEntry } from "@/lib/module-catalog";

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ProcessQaPromptInput {
  project: Project;
  pmAgent: Agent;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  fbTemplates?: FbTemplate[];
  promptSections?: Record<string, string>;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}

function formatModuleCatalog(modules: ModuleCatalogEntry[]): string {
  if (modules.length === 0) return "";
  const lines = modules.map((m) => `- **${m.mlfb}** — ${m.name} (${m.shortLabel}) [${m.diChannels}DI/${m.dqChannels}DQ/${m.aiChannels}AI/${m.aqChannels}AQ]`);
  return `## Available IO Module Catalog

**IMPORTANT: Only use MLFBs from this list.** Do NOT invent or guess order numbers.

${lines.join("\n")}`;
}

/**
 * Builds the PM's system prompt for Process Builder requirements gathering.
 * The PM asks structured questions to understand the full process, recommends
 * IO modules and FB templates, and collects enough info for staged generation.
 */
export function buildProcessQaPrompt(input: ProcessQaPromptInput): BuiltPrompt {
  const { project, pmAgent, knowledgeDocs, designProfile, fbTemplates, promptSections, conversationHistory, userMessage } = input;

  const pmProfile = getAgentProfile("Project Manager");
  const identity = interpolateAgent(
    resolveSection(promptSections, "process_qa", "identity"),
    { name: "Project Manager", tagline: pmProfile.tagline, description: pmProfile.description, personality: pmProfile.personality },
  );
  const instructions = resolveSection(promptSections, "process_qa", "instructions");

  const knowledgeSection = knowledgeDocs && knowledgeDocs.length > 0
    ? `## Reference Documentation\n\n${knowledgeDocs.map((d) => `### [${d.short_id}] ${d.title}\n${d.content}`).join("\n\n---\n\n")}`
    : "";

  // Get IO modules compatible with this project's CPU
  const compatibleModules = getCompatibleModules(project.cpu_type, project.cpu_type.startsWith("S7-12") ? "S7-1200" : "S7-1500");
  const moduleCatalogSection = formatModuleCatalog(compatibleModules);

  const systemPrompt = `${identity}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

## Current IO List
${formatIoList(project.io_lists)}

${designProfile ? formatDesignProfile(designProfile) : ""}

${formatFbTemplates(fbTemplates ?? [])}

${moduleCatalogSection}

${knowledgeSection}

${pmAgent.system_prompt ? `## Additional Instructions\n${pmAgent.system_prompt}` : ""}

${instructions}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...(conversationHistory ?? []),
    { role: "user" as const, content: userMessage },
  ];

  return { systemPrompt, messages };
}
