import type { Project, Agent, PatternCandidate, FbTemplate, DesignProfile, AgentKnowledgeDoc, ReferenceLibrarySection } from "@/types";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { buildContextMessages, formatFbTemplates } from "@/lib/prompt-builder";
import { getAgentProfile } from "@/lib/agent-profiles";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";

export interface ProcessPromptInput {
  project: Project;
  agents: Agent[];
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  functionalDescription: string;
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
}

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function formatAgentRoles(
  agents: Agent[],
  knowledgeDocs?: Record<string, AgentKnowledgeDoc[]>
): string {
  if (agents.length === 0) return "No agents assigned.";
  return agents
    .map((a) => {
      const profile = getAgentProfile(a.display_name);
      const sections = [
        `### ${a.display_name} [${a.specialties.join(", ")}]`,
        `**Role:** ${profile.tagline}`,
      ];
      const docs = knowledgeDocs?.[a.id];
      if (docs && docs.length > 0) {
        const docSections = docs.map((d) => `#### [${d.short_id}] ${d.title}\n${d.content}`);
        sections.push(`**Reference Documentation:**\n${docSections.join("\n\n")}`);
      }
      return sections.join("\n");
    })
    .join("\n\n");
}

export function buildProcessPrompt(input: ProcessPromptInput): BuiltPrompt {
  const { project, agents, designProfile, approvedPatterns, fbTemplates, agentKnowledgeDocs, functionalDescription, promptSections, referenceSections } = input;

  const codeArchitect = getAgentProfile("Code Architect");
  const identity = interpolateAgent(
    resolveSection(promptSections, "process", "identity"),
    { name: "Code Architect", tagline: codeArchitect.tagline, description: codeArchitect.description, personality: codeArchitect.personality },
  );
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");
  const processInstructions = resolveSection(promptSections, "process", "instructions");

  const profileSection = designProfile?.rules?.trim()
    ? `## Code Design Profile: ${designProfile.name}

The following rules define the customer's code standards. ALL generated code MUST follow these rules exactly.

${designProfile.rules}

`
    : "";

  const systemPrompt = `${identity}

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

${profileSection}## Agent Roles
${formatAgentRoles(agents, agentKnowledgeDocs)}

${formatFbTemplates(fbTemplates ?? [])}

## Output Format

You MUST output each artifact as a separate delimited block using this format:

\`\`\`scl filename="<BlockName>.scl" type="<ARTIFACT_TYPE>" name="<BlockName>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: the block name with .scl extension (e.g., "typeProcessData.scl", "ControlSequence.scl", "InstSequence1.scl", "Main.scl")
- type: one of UDT, FB, FC, DB, OB
- name: the block name matching the SCL declaration
- dependencies: comma-separated list of artifact names this block depends on

### Naming (MUST match platform rules)
- UDTs: \`type\` prefix, lowerCamelCase (e.g., typeProcessData, typeSequenceConfig)
- FBs: Verb-first UpperCamelCase (e.g., ControlSequence, ManageBatch)
- FCs: Verb-first UpperCamelCase (e.g., ScaleAnalog, CalcChecksum)
- Instance DBs: \`Inst\` prefix, UpperCamelCase (e.g., InstSequence1, InstBatch1)
- Global DBs: UpperCamelCase, no prefix (e.g., Configuration, HmiData)
- OB1: Always named "Main"

### MANDATORY Artifact Checklist

You MUST generate ALL of these in this order:
1. UDTs for process data structures
2. Device FBs — one per device type (motors, valves, sensors, conveyors)
3. Instance DBs — one per Device FB instance
4. Process FC — orchestrates all Device FB calls, wires data between them
5. OB1 "Main" — calls the Process FC only. Main should be minimal.
6. Global DBs / Utility FCs as needed

**Program hierarchy:** Main (OB1) -> Process FC -> Device FBs (via instance DBs). Device FBs do NOT call each other. Main does NOT call Device FBs directly.

### Multi-Instance FB Wiring

When an FB contains multi-instance FBs (e.g., sensor FBs, edge triggers, timers), wire higher-level logic directly to the multi-instance outputs. Do NOT create redundant intermediate variables that just copy multi-instance outputs. For example, if you have #instStartSensor as a multi-instance FB with an output Q, use #instStartSensor.Q directly in your logic instead of creating a separate #startSensorActive variable to hold the same value.

${processInstructions}

After all artifact blocks, provide a brief summary of what was generated.`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  const userMessage = `Generate process control code from the following functional description:

${functionalDescription}

Generate all necessary artifacts: UDTs, Device FBs, instance DBs, a Process FC that orchestrates the Device FBs, and a Main OB that calls the Process FC.`;

  return {
    systemPrompt,
    messages: [...contextMessages, { role: "user" as const, content: userMessage }],
  };
}
