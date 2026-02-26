import type { Project, Agent, IoEntry, TagDbDefinition, GenerationMode, PatternCandidate, FbTemplate, DesignProfile, AgentKnowledgeDoc, ReferenceLibrarySection } from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatReferenceSections } from "@/lib/reference-lookup";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";

/**
 * Output format instructions telling Claude how to structure its response
 * so the artifact parser can extract individual blocks.
 */
const OUTPUT_FORMAT = `## Output Format

You MUST output each artifact as a separate delimited block using this format:

\`\`\`scl filename="<BlockName>.scl" type="<ARTIFACT_TYPE>" name="<BlockName>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: the block name with .scl extension (e.g., "typeMotorConfig.scl", "ControlMotor.scl", "InstMotor1.scl", "Main.scl")
- type: one of UDT, FB, FC, DB, OB
- name: the block name matching the SCL declaration (e.g., "typeMotorConfig", "ControlMotor", "InstMotor1", "Main")
- dependencies: comma-separated list of artifact names this block depends on (empty if none)

After all artifact blocks, provide a brief summary of what was generated.

### Naming (MUST match platform rules)
- UDTs: \`type\` prefix, lowerCamelCase (e.g., typeMotorConfig, typeZoneIO)
- FBs: Verb-first UpperCamelCase (e.g., ControlMotor, MonitorConveyor)
- FCs: Verb-first UpperCamelCase (e.g., ScaleAnalog, CalcChecksum)
- Instance DBs: \`Inst\` prefix, UpperCamelCase (e.g., InstMotor1, InstConveyor1)
- Global DBs: UpperCamelCase, no prefix (e.g., Configuration, HmiData)
- OB1: Always named "Main"

### MANDATORY Artifact Checklist — Generate ALL of These

Before responding, verify your output includes EVERY required artifact:

1. **UDTs** — One per reusable data structure (config, IO, diagnostics)
2. **FBs** — One per device type or process (with full state machine, timers, alarms)
3. **FCs** — For stateless utility functions (scaling, clamping, conversion) if needed
4. **Global DBs** — For configuration data, HMI interface, recipes if needed
5. **Instance DBs** — **ONE per FB instance called from OB1** (this is the #1 missed artifact)
6. **OB1 "Main"** — **ALWAYS generate this.** It calls every FB using its instance DB. Without Main, nothing runs.

**If you generate an FB, you MUST also generate:**
- An instance DB for it (type=DB, references the FB)
- A call to it in Main (type=OB)

### FB Body Structure
Each FB must follow this section structure:
1. VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT declarations
2. VAR (static) declarations including state variables, timers, edge triggers (inst prefix)
3. VAR_TEMP for intermediate calculations (temp prefix)
4. Code body with clearly separated REGION blocks:
   - REGION IO Mapping
   - REGION State Machine (CASE-based with integer literal labels + ELSE)
   - REGION Alarm/Fault Handling
   - REGION Output Mapping`;

interface PromptBuilderInput {
  project: Project;
  agents: Agent[];
  generationMode: GenerationMode;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  designProfile?: DesignProfile;
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export function formatIoList(ioList: IoEntry[]): string {
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

function formatAgentRoles(
  agents: Agent[],
  knowledgeDocs?: Record<string, AgentKnowledgeDoc[]>
): string {
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
      // Inject agent's knowledge base documents
      const docs = knowledgeDocs?.[a.id];
      if (docs && docs.length > 0) {
        const docSections = docs.map((d) => `#### ${d.title}\n${d.content}`);
        sections.push(`**Reference Documentation:**\n${docSections.join("\n\n")}`);
      }
      return sections.join("\n");
    })
    .join("\n\n");
}

function formatDesignProfile(profile: DesignProfile): string {
  if (!profile.rules.trim()) return "";
  return `## Code Design Profile: ${profile.name}

The following rules define the customer's code standards. ALL generated code MUST follow these rules exactly.

${profile.rules}`;
}

export function formatFbTemplates(templates: FbTemplate[]): string {
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

/**
 * Build prefixed context messages for reference sections and correction patterns.
 * These are prepended before conversation messages to keep the system prompt
 * under the 100K character limit while preserving all reference material.
 */
export function buildContextMessages(
  referenceSections: ReferenceLibrarySection[],
  approvedPatterns: PatternCandidate[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const refBlock = formatReferenceSections(referenceSections);
  const hasPatterns = approvedPatterns && approvedPatterns.length > 0;

  if (!refBlock && !hasPatterns) return [];

  const parts: string[] = [];

  if (refBlock) {
    parts.push(refBlock);
  }

  if (hasPatterns) {
    parts.push(`## MANDATORY: Learned Corrections from Previous Compile Errors

The following corrections were learned from real TIA Portal compile failures. You MUST apply every one of these rules. Generating code that violates these rules will cause compile errors.

${formatPatterns(approvedPatterns)}`);
  }

  return [
    { role: "user" as const, content: parts.join("\n\n") },
    { role: "assistant" as const, content: "Understood. I have reviewed the reference documentation and correction rules provided. I will use these as authoritative sources and apply all learned corrections to this task." },
  ];
}

export function buildPrompt(input: PromptBuilderInput): BuiltPrompt {
  const { project, agents, generationMode, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections, referenceSections, userMessage, conversationHistory } = input;

  const codeArchitect = getAgentProfile("Code Architect");
  const identity = interpolateAgent(
    resolveSection(promptSections, "generate", "identity"),
    { name: "Code Architect", tagline: codeArchitect.tagline, description: codeArchitect.description, personality: codeArchitect.personality },
  );
  const instructions = resolveSection(promptSections, "generate", "instructions");
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");

  const generationModeDesc =
    generationMode === "FB_PER_DEVICE"
      ? "Generate one FB per device type with UDT-based IO arrays. Each device type gets its own FB, UDT, and instance DB template."
      : "Generate a complete project-level structure with all FBs, UDTs, DBs, and OBs needed for the full system.";

  const systemPrompt = `${identity}

${instructions}

${buildPriorityHierarchyBlock()}

${platformRules}

${codeExamples}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

${designProfile ? formatDesignProfile(designProfile) : ""}
## IO List
${formatIoList(project.io_lists)}

## Tag DB Definitions
${formatTagDbs(project.tag_db_definitions)}

## Generation Mode
${generationModeDesc}

## Agent Roles
${formatAgentRoles(agents, agentKnowledgeDocs)}

${formatFbTemplates(fbTemplates ?? [])}

${OUTPUT_FORMAT}`;

  // Reference sections + patterns are sent as prefixed context messages
  // to keep the system prompt under the 100K character limit
  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...contextMessages,
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
  return `Generate a complete, runnable PLC program for a ${answers.deviceType} device with the following specifications:

- **Instances**: ${answers.instanceCount} instance(s)
- **IO Mapping**: ${answers.ioMapping === "array_indexed" ? "Array-indexed via UDT" : "Individual tags per instance"}
- **State Machine States**: ${stateList}
- **Alarm Requirements**: ${answers.alarmRequirements || "Standard latching alarms with operator reset"}
${answers.specialRequirements ? `- **Special Requirements**: ${answers.specialRequirements}` : ""}

You MUST generate ALL of these artifacts:
1. UDT(s) for IO structure and configuration
2. FB with CASE-based state machine
3. Instance DB for each FB instance (${answers.instanceCount} instance(s))
4. OB1 "Main" that calls each FB instance with its instance DB
5. Any utility FCs needed (scaling, etc.)

Follow all platform rules and naming conventions.`;
}
