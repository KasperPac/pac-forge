import type { Project, Agent, IoEntry, TagDbDefinition, GenerationMode, PatternCandidate, FbTemplate } from "@/types";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { getAgentProfile } from "@/lib/agent-profiles";

/**
 * Output format instructions telling Claude how to structure its response
 * so the artifact parser can extract individual blocks.
 */
const OUTPUT_FORMAT = `## Output Format

You MUST output each artifact as a separate delimited block using this format:

\`\`\`scl filename="<relative_path>" type="<ARTIFACT_TYPE>" name="<BlockName>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: relative path in the bundle (e.g., "udt/UDT_ZoneIO.scl", "fb/FB_ConveyorZone.scl")
- type: one of UDT, FB, FC, DB, OB, SCL_SOURCE, TAG_TABLE
- name: the block name (e.g., "UDT_ZoneIO", "FB_ConveyorZone")
- dependencies: comma-separated list of artifact names this block depends on (empty if none)

After all artifact blocks, provide a brief summary of what was generated.

### Naming Conventions
- UDTs: "UDT_<Purpose>" (e.g., UDT_ZoneIO, UDT_MotorData)
- FBs: "FB_<DeviceType>" (e.g., FB_ConveyorZone, FB_Motor)
- FCs: "FC_<Purpose>" (e.g., FC_AlarmHandler, FC_IOMapper)
- DBs: "DB_<Purpose>" or "iDB_<FBName>_<Instance>" for instance DBs
- OBs: "OB1" (main), "OB_Cyclic_<N>"

### FB Template Structure
Each FB must follow this section structure:
1. VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT declarations
2. VAR (static) declarations including state machine enum, timers, alarms
3. Code body with clearly separated regions:
   - Region: IO Mapping
   - Region: State Machine (CASE-based)
   - Region: Alarm/Fault Handling
   - Region: Output Mapping`;

interface PromptBuilderInput {
  project: Project;
  agents: Agent[];
  generationMode: GenerationMode;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function formatIoList(ioList: IoEntry[]): string {
  if (ioList.length === 0) return "No IO entries defined.";
  const header = "| Address | Tag Name | Data Type | Description | Module | Slot |";
  const separator = "|---------|----------|-----------|-------------|--------|------|";
  const rows = ioList.map(
    (io) => `| ${io.address} | ${io.tag_name} | ${io.data_type} | ${io.description} | ${io.module} | ${io.slot} |`
  );
  return [header, separator, ...rows].join("\n");
}

function formatTagDbs(tagDbs: TagDbDefinition[]): string {
  if (tagDbs.length === 0) return "No tag DB definitions.";
  return tagDbs
    .map((db) => {
      const tags = db.tags
        .map((t) => `  - ${t.name}: ${t.data_type}${t.default_value ? ` = ${t.default_value}` : ""}${t.comment ? ` // ${t.comment}` : ""}`)
        .join("\n");
      return `### ${db.name}\n${tags}`;
    })
    .join("\n\n");
}

function formatAgentRoles(agents: Agent[]): string {
  if (agents.length === 0) return "No agents assigned.";
  return agents
    .map((a) => {
      const profile = getAgentProfile(a.display_name);
      const skillsList = profile.skills.map((s) => `  - ${s}`).join("\n");
      const sections = [
        `### ${a.display_name} [${a.specialties.join(", ")}]`,
        `**Role:** ${profile.tagline}`,
        `**Personality:** ${profile.description}`,
        `**Skills:**\n${skillsList}`,
      ];
      if (a.system_prompt) {
        sections.push(`**Instructions:** ${a.system_prompt}`);
      }
      return sections.join("\n");
    })
    .join("\n\n");
}

function formatFbTemplates(templates: FbTemplate[]): string {
  if (templates.length === 0) return "";
  const blocks = templates.map((t) => {
    const header = `### ${t.name} [${t.device_category}]`;
    const desc = t.description ? `${t.description}\n` : "";
    return `${header}\n${desc}\`\`\`scl\n${t.base_scl}\n\`\`\``;
  });
  return `## FB Library Templates

The following are company-standard FB templates. When generating code for matching device types, use these as the starting base and customize as needed for the project requirements. Do NOT deviate from their structure unless the user explicitly requests it.

${blocks.join("\n\n")}`;
}

export function formatPatterns(patterns: PatternCandidate[]): string {
  if (patterns.length === 0) return "No learned corrections.";
  const rules = patterns
    .map((p, i) => {
      const parts = [
        `### Rule ${i + 1}: ${p.explanation_tag}`,
        `**Category:** ${p.correction_type} | **Device:** ${p.device_type}`,
      ];
      if (p.original_snippet) {
        parts.push(`**WRONG (do NOT generate this):**\n\`\`\`scl\n${p.original_snippet}\n\`\`\``);
      }
      if (p.corrected_snippet) {
        parts.push(`**CORRECT (use this instead):**\n\`\`\`scl\n${p.corrected_snippet}\n\`\`\``);
      }
      return parts.join("\n");
    })
    .join("\n\n");
  return rules;
}

export function buildPrompt(input: PromptBuilderInput): BuiltPrompt {
  const { project, agents, generationMode, approvedPatterns, fbTemplates, userMessage, conversationHistory } = input;

  const generationModeDesc =
    generationMode === "FB_PER_DEVICE"
      ? "Generate one FB per device type with UDT-based IO arrays. Each device type gets its own FB, UDT, and instance DB template."
      : "Generate a complete project-level structure with all FBs, UDTs, DBs, and OBs needed for the full system.";

  // Debug: log pattern injection so we can verify patterns reach the prompt
  console.log("[prompt-builder] approvedPatterns count:", approvedPatterns?.length ?? 0);
  if (approvedPatterns && approvedPatterns.length > 0) {
    console.log("[prompt-builder] patterns:", approvedPatterns.map(p => ({
      id: p.id,
      type: p.correction_type,
      explanation: p.explanation_tag?.slice(0, 100),
      original: p.original_snippet?.slice(0, 80),
      corrected: p.corrected_snippet?.slice(0, 80),
    })));
  }

  const systemPrompt = `You are Pac-ST, a deterministic PLC code generation assistant for Siemens TIA Portal.
You generate production-ready SCL (Structured Control Language) code artifacts.

${PLATFORM_RULES}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

## IO List
${formatIoList(project.io_lists)}

## Tag DB Definitions
${formatTagDbs(project.tag_db_definitions)}

## Generation Mode
${generationModeDesc}

## Agent Roles
${formatAgentRoles(agents)}

${formatFbTemplates(fbTemplates ?? [])}

## MANDATORY: Learned Corrections from Previous Compile Errors

The following corrections were learned from real TIA Portal compile failures. You MUST apply every one of these rules. Generating code that violates these rules will cause compile errors.

${formatPatterns(approvedPatterns ?? [])}

${OUTPUT_FORMAT}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...(conversationHistory ?? []),
    { role: "user" as const, content: userMessage },
  ];

  return { systemPrompt, messages };
}

/**
 * Builds a structured prompt from the guided question flow answers.
 */
export interface GuidedAnswers {
  deviceType: string;
  instanceCount: number;
  ioMapping: "array_indexed" | "individual_tags";
  states: string[];
  alarmRequirements: string;
  specialRequirements: string;
}

export function buildGuidedPrompt(answers: GuidedAnswers): string {
  const stateList = answers.states.join(", ");
  return `Generate a complete FB for a ${answers.deviceType} device with the following specifications:

- **Instances**: ${answers.instanceCount} instance(s)
- **IO Mapping**: ${answers.ioMapping === "array_indexed" ? "Array-indexed via UDT" : "Individual tags per instance"}
- **State Machine States**: ${stateList}
- **Alarm Requirements**: ${answers.alarmRequirements || "Standard latching alarms with operator reset"}
${answers.specialRequirements ? `- **Special Requirements**: ${answers.specialRequirements}` : ""}

Generate all necessary artifacts: UDT for IO structure, FB with CASE-based state machine, instance DB template.
Follow all platform rules and naming conventions.`;
}
