import type { Project, Agent, IoEntry, TagDbDefinition, GenerationMode, PatternCandidate, FbTemplate, DesignProfile, ProcessRuleExample, AgentKnowledgeDoc, ReferenceLibrarySection, RackSlotLayout } from "@/types";
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

\`\`\`scl filename="<BlockName>.scl" type="<ARTIFACT_TYPE>" name="<BlockName>" folder="<destination>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: the block name with .scl extension (e.g., "typeMotorConfig.scl", "ControlMotor.scl", "InstMotor1.scl", "Main.scl")
- type: one of UDT, FB, FC, DB, OB
- name: the block name matching the SCL declaration (e.g., "typeMotorConfig", "ControlMotor", "InstMotor1", "Main")
- folder: TIA Portal destination folder (e.g., "Program blocks/Pac-ST/Devices"). Omit to use defaults.
- dependencies: comma-separated list of artifact names this block depends on (empty if none)

### Default Folder Structure
| Type | Default Folder |
|------|---------------|
| UDT | Types |
| FB, FC, DB | Program blocks/Pac-ST |
| OB | Program blocks |

If the Design Profile specifies a folder structure, use those paths in the folder attribute. Otherwise omit folder to use defaults.

After all artifact blocks, provide a brief summary of what was generated.

### Naming (MUST match platform rules)
- UDTs: \`type\` prefix, lowerCamelCase (e.g., typeMotorConfig, typeZoneIO)
- FBs: Verb-first UpperCamelCase (e.g., ControlMotor, MonitorConveyor)
- FCs: Verb-first UpperCamelCase (e.g., ScaleAnalog, CalcChecksum)
- Instance DBs: \`Inst\` prefix, UpperCamelCase (e.g., InstMotor1, InstConveyor1)
- Global DBs: UpperCamelCase, no prefix (e.g., Configuration, HmiData)
- OB1: Always named "Main"

### MANDATORY Artifact Checklist — Generate ALL of These

Before responding, verify your output includes EVERY required artifact in this exact order:

1. **UDTs** — One per reusable data structure (config, IO, diagnostics)
2. **Device FBs** — One per device type (motors, valves, conveyors, sensors). Each handles its own state machine, timers, alarms.
3. **Instance DBs** — **ONE per Device FB instance** (this is the #1 missed artifact)
4. **Process FC** — **ALWAYS generate this.** A stateless Function that orchestrates all Device FB calls. It receives IO as inputs/outputs, calls each Device FB via its instance DB, and wires device outputs to process logic. This is the central coordination layer.
5. **OB1 "Main"** — **ALWAYS generate this.** It calls the Process FC. Main should be minimal — just the FC call.
6. **Global DBs** — For configuration data, HMI interface, recipes if needed
7. **Utility FCs** — For stateless helper functions (scaling, clamping, conversion) if needed

**Program hierarchy (CRITICAL):**
- Main (OB1) calls the Process FC
- The Process FC calls Device FBs via their instance DBs
- Device FBs do NOT call each other — the Process FC wires data between them
- Main does NOT call Device FBs directly

**If you generate a Device FB, you MUST also generate:**
- An instance DB for it (type=DB, references the FB)
- A call to it in the Process FC (NOT in Main)

### Multi-Instance FB Wiring

When an FB contains multi-instance FBs (e.g., sensor FBs, edge triggers, timers), wire higher-level logic directly to the multi-instance outputs. Do NOT create redundant intermediate variables that just copy multi-instance outputs. For example, if you have #instStartSensor as a multi-instance FB with an output Q, use #instStartSensor.Q directly in your logic instead of creating a separate #startSensorActive variable to hold the same value.

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
        const docSections = docs.map((d) => `#### [${d.short_id}] ${d.title}\n${d.content}`);
        sections.push(`**Reference Documentation:**\n${docSections.join("\n\n")}`);
      }
      return sections.join("\n");
    })
    .join("\n\n");
}

/**
 * Format design profile rules for prompt injection.
 * @param context - Which generation context to include rules for.
 *   "general" = general + folder rules only (default, used by most paths)
 *   "process" = general + folder + process rules (used by process code generation)
 *   "fb" = general + folder + fb rules (used by FB generation, future)
 *   "all" = everything (used by PM planning)
 */
export function formatDesignProfile(
  profile: DesignProfile,
  context: "general" | "process" | "fb" | "all" = "general",
): string {
  const sections: string[] = [];

  // General rules (always included) — use new field, fall back to legacy
  const generalRules = profile.general_rules?.trim() || profile.rules?.trim() || "";
  if (generalRules) {
    sections.push(`### General Code Rules\n\n${generalRules}`);
  }

  // Folder rules (always included when present)
  if (profile.folder_rules?.trim()) {
    sections.push(`### Program Folder Structure\n\n${profile.folder_rules}`);
  }

  // Process rules (only for process/all contexts)
  if ((context === "process" || context === "all") && profile.process_rules?.length > 0) {
    sections.push(formatRuleExamples("Process Code Structure", profile.process_rules));
  }

  // FB rules (only for fb/all contexts)
  if ((context === "fb" || context === "all") && profile.fb_rules?.length > 0) {
    sections.push(formatRuleExamples("Function Block Structure", profile.fb_rules));
  }

  if (sections.length === 0) return "";

  return `## MANDATORY: Code Design Profile — ${profile.name}

**IMPORTANT:** The following rules define the customer's mandatory code standards. These rules take PRIORITY over any default patterns or conventions. ALL generated code MUST follow these rules exactly. If a rule contradicts a default pattern, the customer's rule wins.

${sections.join("\n\n")}`;
}

function formatRuleExamples(heading: string, examples: ProcessRuleExample[]): string {
  const parts = [`### MANDATORY: ${heading}`];
  parts.push(
    `**CRITICAL REQUIREMENT:** The customer has defined a specific code structure pattern for ${heading.toLowerCase()}. ` +
    `You MUST replicate this exact structural pattern in ALL generated code. ` +
    `Do NOT substitute your own preferred patterns (e.g., do NOT use a CASE integer state machine if the customer pattern uses boolean step arrays). ` +
    `The structure, naming conventions, array usage, and organization shown below are NON-NEGOTIABLE — follow them precisely.`,
  );
  for (const ex of examples) {
    parts.push(`#### ${ex.label}`);
    if (ex.analysis?.trim()) {
      parts.push(`**Mandatory structural pattern (you MUST follow this):**\n${ex.analysis}`);
    }
    if (ex.example?.trim()) {
      parts.push(`**Reference implementation (replicate this structure):**\n\`\`\`scl\n${ex.example}\n\`\`\``);
    }
  }
  return parts.join("\n\n");
}

export function formatRackLayout(rackLayout: RackSlotLayout[]): string {
  if (rackLayout.length === 0) return "";
  const sections: string[] = [];
  for (const rack of rackLayout) {
    const label = rack.rack === 0 ? "Central Rack" : rack.rack === 1 ? "ET 200SP" : `Rack ${rack.rack}`;
    const header = `| Slot | Module | Order Number | Description |`;
    const sep = `|------|--------|--------------|-------------|`;
    const rows = rack.slots.map(
      (s) => `| ${s.slot} | ${s.module_type} | ${s.order_number ?? "—"} | ${s.description ?? "—"} |`,
    );
    sections.push(`### ${label}\n${header}\n${sep}\n${rows.join("\n")}`);
  }
  return `## Hardware Configuration\n\n${sections.join("\n\n")}`;
}

export function formatFbTemplates(templates: FbTemplate[]): string {
  if (templates.length === 0) return "";
  const sections = templates.map((t) => {
    const header = `### ${t.name} [${t.device_category}] (ID: ${t.id})`;
    const desc = t.description ? `${t.description}\n` : "";
    const blocks = t.blocks ?? [];
    if (blocks.length === 0) return `${header}\n${desc}(no blocks defined)`;
    const blockSections = blocks.map(
      (b) => `#### ${b.block_name} (${b.block_type})\n\`\`\`scl\n${b.scl_code}\n\`\`\``
    );
    return `${header}\n${desc}${blockSections.join("\n\n")}`;
  });
  return `## FB Library Templates (USE THESE — Template Code is Locked)

The following are company-standard, pre-approved FB templates. When a template matches the device type being generated, you **MUST use it** — do NOT generate equivalent logic from scratch.

**HOW TO USE TEMPLATES:**
1. **EMIT the template FB/UDT code exactly as shown** — copy it character-for-character into your output artifacts. Do not rename blocks, parameters, variables, or modify internal logic.
2. **CREATE instance DBs** for each template FB you use (e.g., \`"InstConveyor1" : "ControlConveyor"\`).
3. **WIRE the template's parameters** to the project's IO tags in your calling code (OB1/Process FC):
   \`\`\`
   "InstConveyor1"(
       cmdStart := "Tag_StartButton",
       cmdStop  := "Tag_StopButton",
       fdbkRun  => "Tag_MotorRunning"
   );
   \`\`\`
4. **CREATE multiple instances** if the project has multiple devices of the same type.
5. **Generate additional FBs from scratch** only for device types that have NO matching template.

**TEMPLATE CODE IS LOCKED — what you must NOT change:**
- Internal logic, state machine structure, or control flow
- VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, or VAR sections (names, types, order, defaults)
- Block names, UDT names, comments, whitespace

**What you MUST do:**
- Use every template that matches a device in the project — skipping a matching template is an error
- Create the instance DBs and wiring code needed to integrate the template into this specific project
- If the user's requirements conflict with a template's interface, use the template as-is and note the limitation

${sections.join("\n\n")}`;
}

export function formatPatterns(patterns: PatternCandidate[]): string {
  if (patterns.length === 0) return "No learned corrections.";
  const rules = patterns
    .map((p) => {
      const parts = [
        `### ${p.short_id}: ${p.explanation_tag}`,
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
${formatRackLayout(project.rack_slot_layout)}
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
