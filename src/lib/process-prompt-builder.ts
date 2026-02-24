import type { Project, Agent, PatternCandidate, FbTemplate, DesignProfile, AgentKnowledgeDoc } from "@/types";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { formatPatterns } from "@/lib/prompt-builder";
import { getAgentProfile } from "@/lib/agent-profiles";

export interface ProcessPromptInput {
  project: Project;
  agents: Agent[];
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  functionalDescription: string;
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
        const docSections = docs.map((d) => `#### ${d.title}\n${d.content}`);
        sections.push(`**Reference Documentation:**\n${docSections.join("\n\n")}`);
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

When generating process code, reuse these company-standard FBs where applicable:

${blocks.join("\n\n")}`;
}

export function buildProcessPrompt(input: ProcessPromptInput): BuiltPrompt {
  const { project, agents, designProfile, approvedPatterns, fbTemplates, agentKnowledgeDocs, functionalDescription } = input;

  const profileSection = designProfile?.rules?.trim()
    ? `## Code Design Profile: ${designProfile.name}

The following rules define the customer's code standards. ALL generated code MUST follow these rules exactly.

${designProfile.rules}

`
    : "";

  const patternsSection = approvedPatterns && approvedPatterns.length > 0
    ? `## MANDATORY: Learned Corrections from Previous Compile Errors

The following corrections were learned from real TIA Portal compile failures. You MUST apply every one of these rules.

${formatPatterns(approvedPatterns)}

`
    : "";

  const systemPrompt = `You are Pac-ST Process, a specialist in generating process control code from functional descriptions for Siemens TIA Portal.

You generate production-ready SCL code that implements complete process control systems including:
- Sequence control (step-based state machines using CASE with integer literals)
- Interlock logic (safety interlocks, permissive conditions)
- HMI interface tags (status, commands, setpoints)
- Alarm management (latching alarms with operator reset)
- Timer-based operations (using TON/TOF with IN and PT always supplied)

${PLATFORM_RULES}

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

${patternsSection}## Output Format

You MUST output each artifact as a separate delimited block using this format:

\`\`\`scl filename="<relative_path>" type="<ARTIFACT_TYPE>" name="<BlockName>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: relative path in the bundle (e.g., "udt/UDT_Sequence.scl", "fb/FB_Process.scl")
- type: one of UDT, FB, FC, DB, OB, SCL_SOURCE, TAG_TABLE
- name: the block name
- dependencies: comma-separated list of artifact names this block depends on

## Process Code Requirements

1. **Sequences**: Implement each process sequence as an FB with a CASE-based state machine. Steps should be numbered (0, 10, 20, 30...) with clear transitions.
2. **Interlocks**: Generate interlock checks at the start of each sequence step. Use a dedicated #interlockOK BOOL variable.
3. **HMI Interface**: Every process FB must expose VAR_OUTPUT variables for HMI: #currentStep (INT), #stepName (STRING), #running (BOOL), #faulted (BOOL), #complete (BOOL).
4. **Alarms**: Use latching alarm patterns — set on fault condition, require operator reset via #resetAlarms (BOOL) input.
5. **Timers**: All timed operations use TON with configurable PT as VAR_INPUT.
6. **Main OB**: Generate an OB1 (Main) that instantiates and calls all process FBs.

After all artifact blocks, provide a brief summary of what was generated.`;

  const userMessage = `Generate process control code from the following functional description:

${functionalDescription}

Generate all necessary artifacts: UDTs, FBs for each process sequence, FCs for shared logic, instance DBs, and a Main OB that ties everything together.`;

  return {
    systemPrompt,
    messages: [{ role: "user" as const, content: userMessage }],
  };
}
