import type { Project, Agent, PatternCandidate, FbTemplate, DesignProfile, AgentKnowledgeDoc, ReferenceLibrarySection } from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatDesignProfile, formatIoList, formatFbTemplates, buildContextMessages } from "@/lib/prompt-builder";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

// ---------------------------------------------------------------------------
// Phase 1: PM Q&A — Requirements Gathering
// ---------------------------------------------------------------------------

export interface FbQaPromptInput {
  project: Project;
  pmAgent: Agent;
  knowledgeDocs?: AgentKnowledgeDoc[];
  designProfile?: DesignProfile;
  promptSections?: Record<string, string>;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}

/**
 * Builds the PM's system prompt for FB Builder requirements gathering.
 * The PM asks questions to understand the FB spec — no code generation.
 */
export function buildFbQaPrompt(input: FbQaPromptInput): BuiltPrompt {
  const { project, pmAgent, knowledgeDocs, designProfile, promptSections, conversationHistory, userMessage } = input;

  const pmProfile = getAgentProfile("Project Manager");
  const identity = interpolateAgent(
    resolveSection(promptSections, "fb_builder", "identity"),
    { name: "Project Manager", tagline: pmProfile.tagline, description: pmProfile.description, personality: pmProfile.personality },
  );
  const instructions = resolveSection(promptSections, "fb_builder", "instructions");

  const knowledgeSection = knowledgeDocs && knowledgeDocs.length > 0
    ? `## Reference Documentation\n\n${knowledgeDocs.map((d) => `### [${d.short_id}] ${d.title}\n${d.content}`).join("\n\n---\n\n")}`
    : "";

  const systemPrompt = `${identity}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

## IO List
${formatIoList(project.io_lists)}

${designProfile ? formatDesignProfile(designProfile) : ""}

${knowledgeSection}

${pmAgent.system_prompt ? `## Additional Instructions\n${pmAgent.system_prompt}` : ""}

${instructions}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...(conversationHistory ?? []),
    { role: "user" as const, content: userMessage },
  ];

  return { systemPrompt, messages };
}

// ---------------------------------------------------------------------------
// Phase 2: Code Architect Generation (with Q&A context)
// ---------------------------------------------------------------------------

/**
 * Output format for FB Builder — same artifact delimiters as the main pipeline
 * but WITHOUT the mandatory artifact checklist. The user chose which artifacts
 * to generate during the Q&A phase.
 */
const FB_OUTPUT_FORMAT = `## Output Format

You MUST output each artifact as a separate delimited block using this format:

\`\`\`scl filename="<BlockName>.scl" type="<ARTIFACT_TYPE>" name="<BlockName>" folder="<destination>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: the block name with .scl extension (e.g., "typeMotorConfig.scl", "ControlMotor.scl", "InstMotor1.scl")
- type: one of UDT, FB, FC, DB, OB
- name: the block name matching the SCL declaration
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
   - REGION Output Mapping

### IMPORTANT: Generate ONLY the artifacts agreed during Q&A

Do NOT add extra artifacts beyond what was discussed. If the engineer asked for just an FB, generate just the FB. If they asked for FB + UDT + Instance DB, generate exactly those three.`;

export interface FbGeneratePromptInput {
  project: Project;
  agents: Agent[];
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  qaConversation: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Builds the Code Architect's prompt for FB generation.
 * The full Q&A conversation is passed as context messages so the architect
 * has complete requirements from the PM phase.
 */
export function buildFbGeneratePrompt(input: FbGeneratePromptInput): BuiltPrompt {
  const { project, agents, designProfile, approvedPatterns, fbTemplates, agentKnowledgeDocs, promptSections, referenceSections, qaConversation } = input;

  const codeArchitect = getAgentProfile("Code Architect");
  const identity = interpolateAgent(
    resolveSection(promptSections, "generate", "identity"),
    { name: "Code Architect", tagline: codeArchitect.tagline, description: codeArchitect.description, personality: codeArchitect.personality },
  );
  const instructions = resolveSection(promptSections, "generate", "instructions");
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");

  // Format agent roles with their knowledge docs
  const agentRoles = agents.length > 0
    ? agents.map((a) => {
        const profile = getAgentProfile(a.display_name);
        const skillsList = profile.skills.map((s) => `  - ${s}`).join("\n");
        const sections = [
          `### ${a.display_name} [${a.specialties.join(", ")}]`,
          `**Role:** ${profile.tagline}`,
          `**Skills:**\n${skillsList}`,
        ];
        const docs = agentKnowledgeDocs?.[a.id];
        if (docs && docs.length > 0) {
          const docSections = docs.map((d) => `#### [${d.short_id}] ${d.title}\n${d.content}`);
          sections.push(`**Reference Documentation:**\n${docSections.join("\n\n")}`);
        }
        return sections.join("\n");
      }).join("\n\n")
    : "";

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

${agentRoles ? `## Agent Roles\n${agentRoles}` : ""}

${formatFbTemplates(fbTemplates ?? [])}

${FB_OUTPUT_FORMAT}`;

  // Reference sections + patterns as prefixed context messages
  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...contextMessages,
    ...qaConversation,
    { role: "user" as const, content: "Generate the Function Block artifacts as discussed above. Follow all platform rules and naming conventions. Generate ONLY the artifacts that were agreed upon during the requirements discussion." },
  ];

  return { systemPrompt, messages };
}
