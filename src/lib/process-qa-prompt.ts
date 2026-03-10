import type { Project, Agent, DesignProfile, AgentKnowledgeDoc, FbTemplate, RackSlotLayout } from "@/types";
import type { PipelineStepResult } from "@/lib/pipeline";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatDesignProfile, formatIoList, formatFbTemplates } from "@/lib/prompt-builder";
import { getCompatibleModules } from "@/lib/module-catalog";
import type { ModuleCatalogEntry } from "@/lib/module-catalog";
import { getModuleByMlfb } from "@/lib/module-catalog";

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
  pipelineSteps?: PipelineStepResult[];
}

/**
 * Produce a compact pipeline execution summary for PM follow-up context.
 * Summarizes what each agent did in each stage so the PM can answer
 * "why did you change X?" without dumping full raw responses.
 */
export function formatPipelineContextForPm(steps: PipelineStepResult[]): string {
  if (steps.length === 0) return "";

  // Group steps by stage
  const stageMap = new Map<string, PipelineStepResult[]>();
  const stageOrder: string[] = [];
  for (const step of steps) {
    const key = step.stage ?? "unknown";
    if (!stageMap.has(key)) {
      stageMap.set(key, []);
      stageOrder.push(key);
    }
    stageMap.get(key)!.push(step);
  }

  const lines: string[] = ["## Pipeline Execution History", ""];

  for (const stage of stageOrder) {
    const stageSteps = stageMap.get(stage)!;
    lines.push(`### ${stage.toUpperCase()} Stage`);

    for (const step of stageSteps) {
      if (step.status !== "completed") continue;

      if (step.role === "generate" || step.role === "rewrite") {
        const artifacts = step.artifactsModified.length > 0
          ? step.artifactsModified.join(", ")
          : "code";
        const label = step.role === "rewrite" ? `${step.agentName} (Rewrite)` : step.agentName;
        lines.push(`- **${label}** generated: ${artifacts}`);
      } else if (step.role === "review") {
        // Extract finding count from summary if available
        lines.push(`- **${step.agentName}** review: ${step.summary || "completed"}`);
      } else {
        lines.push(`- **${step.agentName}**: ${step.summary || step.role}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format the project's hardware rack layout for injection into PM prompts.
 * Shows which IO modules are already configured so the PM doesn't re-suggest them.
 */
function formatRackLayout(layout: RackSlotLayout[]): string {
  if (!layout || layout.length === 0) return "";

  const lines: string[] = ["## Configured Hardware Modules"];
  let totalDi = 0, totalDq = 0, totalAi = 0, totalAq = 0;

  for (const rack of layout) {
    const rackLabel = rack.rack === 0 ? "Central Rack" : rack.rack === 1 ? "ET 200SP" : `Rack ${rack.rack}`;
    lines.push(`\n### ${rackLabel}`);
    lines.push("| Slot | Module | MLFB | DI | DQ | AI | AQ |");
    lines.push("|------|--------|------|----|----|----|----|");

    for (const slot of rack.slots) {
      const mod = slot.order_number ? getModuleByMlfb(slot.order_number) : undefined;
      if (mod) {
        lines.push(`| ${slot.slot} | ${mod.name} | ${mod.mlfb} | ${mod.diChannels} | ${mod.dqChannels} | ${mod.aiChannels} | ${mod.aqChannels} |`);
        totalDi += mod.diChannels;
        totalDq += mod.dqChannels;
        totalAi += mod.aiChannels;
        totalAq += mod.aqChannels;
      } else if (slot.module_type && slot.module_type !== "Empty") {
        lines.push(`| ${slot.slot} | ${slot.module_type} | ${slot.order_number ?? "—"} | — | — | — | — |`);
      }
    }
  }

  lines.push(`\n**Hardware IO Totals:** ${totalDi} DI, ${totalDq} DQ, ${totalAi} AI, ${totalAq} AQ`);
  return lines.join("\n");
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
  const { project, pmAgent, knowledgeDocs, designProfile, fbTemplates, promptSections, conversationHistory, userMessage, pipelineSteps } = input;

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

${formatRackLayout(project.rack_slot_layout ?? [])}

${designProfile ? formatDesignProfile(designProfile, "process") : ""}

${formatFbTemplates(fbTemplates ?? [])}

${moduleCatalogSection}

${knowledgeSection}

${pmAgent.system_prompt ? `## Additional Instructions\n${pmAgent.system_prompt}` : ""}

${pipelineSteps && pipelineSteps.length > 0 ? formatPipelineContextForPm(pipelineSteps) : ""}

## Hardware & IO Awareness Rules

1. **Respect existing hardware configuration.** If the "Configured Hardware Modules" section above shows modules already installed, do NOT suggest replacing them. Only suggest ADDITIONAL modules if the process requires more IO than what's available.
2. **IO sufficiency check.** Compare the total IO needed by the process against the hardware IO totals. If the Design Profile specifies a spare IO percentage (e.g., "30% spare IO"), factor that in. Alert the user if configured hardware does not provide enough IO (including spare).
3. **Respect existing IO list.** If the "Current IO List" shows tag assignments, these are user-confirmed mappings. Do not suggest overriding them — only identify gaps where new IO points are needed.
4. **When no hardware is configured**, recommend specific modules from the Available IO Module Catalog using exact MLFBs.

${instructions}`;

  // Detect if the user is asking for matrix generation/regeneration and inject format reminder
  const matrixKeywords = /\b(matrix|regenerate|produce|redo|update.*matrix|linkage|generate.*matrix|ready|enough info|complete|all the info)\b/i;
  const isMatrixRequest = matrixKeywords.test(userMessage);
  const finalUserMessage = isMatrixRequest
    ? `${userMessage}\n\n[SYSTEM FORMAT REQUIREMENT — MANDATORY]\nOutput the matrix as JSON inside [PROCESS_MATRIX]...[/PROCESS_MATRIX] tags.\nThe ONLY allowed top-level keys are: "version", "deviceLinkage", "globalData", "processSequences", "notes".\nDo NOT use: ioTags, callingFCs, functionBlocks, instanceDBs, processFC, ob1, ioModules, project, udts, directionTruthTable, faultStateSummary, or any other keys.\nEach device goes in "deviceLinkage" with a "wiring" array. Process sequences use "processSequences" with permissives, safetyConditions, and steps (each step has "transition" with combinator+conditions, and "actions" array).\n\n**CRITICAL — FB Template Matching:** For each device in deviceLinkage, check if any FB Library Template matches the device type. If a match exists, set "fbTemplateName" to the template name and "fbTemplateId" to the template ID. Also set "fbName" to the template's main FB block name. The wiring array parameters MUST match the template FB's actual VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT parameter names exactly. If no template matches, set fbTemplateName and fbTemplateId to null — the AI will generate an FB from scratch for that device.\nKeep it compact — no scan-cycle traces, no truth tables, no verbose descriptions. The JSON must fit in one response.`
    : userMessage;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...(conversationHistory ?? []),
    { role: "user" as const, content: finalUserMessage },
  ];

  return { systemPrompt, messages };
}
