import type {
  Project,
  DesignProfile,
  PatternCandidate,
  FbTemplate,
  AgentKnowledgeDoc,
  ReferenceLibrarySection,
  ProcessLinkageMatrix,
} from "@/types";
import { resolveSection } from "@/lib/prompt-defaults";
import {
  formatDesignProfile,
  formatIoList,
  formatFbTemplates,
  buildContextMessages,
} from "@/lib/prompt-builder";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface StagePromptBase {
  project: Project;
  designProfile?: DesignProfile;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  previousArtifactsContext: string;
  linkageMatrix: ProcessLinkageMatrix | null;
}

// ---------------------------------------------------------------------------
// Stage-specific matrix formatters — each stage gets ONLY what it needs
// ---------------------------------------------------------------------------

/** IO stage: devices + IO signals only. No interlocks, no FB info, no process steps. */
export function formatMatrixForIo(matrix: ProcessLinkageMatrix): string {
  if (matrix.deviceLinkage.length === 0) return "";

  const header = "| Device | Type | Signal | Signal Type | Tag Name | Purpose |";
  const sep = "|--------|------|--------|-------------|----------|---------|";
  const rows: string[] = [];

  for (const d of matrix.deviceLinkage) {
    for (const sig of d.ioSignals) {
      rows.push(`| ${d.name} | ${d.deviceType} | ${sig.purpose} | ${sig.signalType} | ${sig.tagName} | ${sig.purpose} |`);
    }
  }

  // Signal type totals
  const totals = { DI: 0, DQ: 0, AI: 0, AQ: 0 };
  for (const d of matrix.deviceLinkage) {
    for (const sig of d.ioSignals) {
      totals[sig.signalType]++;
    }
  }

  return `## Device IO Signals (from Linkage Matrix)

${header}
${sep}
${rows.join("\n")}

**Signal Totals:** ${totals.DI} DI, ${totals.DQ} DQ, ${totals.AI} AI, ${totals.AQ} AQ`;
}

/** Folders stage: device types + global DB names. Just enough for folder structure. */
export function formatMatrixForFolders(matrix: ProcessLinkageMatrix): string {
  const deviceTypes = [...new Set(matrix.deviceLinkage.map((d) => d.deviceType))];
  const globalDbs = matrix.globalData.map((gd) => gd.dbName);

  return `## Project Structure Context (from Linkage Matrix)

**Device Types:** ${deviceTypes.join(", ") || "None"}
**Global Data Blocks:** ${globalDbs.join(", ") || "None"}
**Total Devices:** ${matrix.deviceLinkage.length}`;
}

/** FB stage: devices filtered by type + their interlocks. No IO module info, no process steps. */
export function formatMatrixForFb(matrix: ProcessLinkageMatrix, deviceType: string): string {
  const devices = matrix.deviceLinkage.filter((d) => d.deviceType === deviceType);
  if (devices.length === 0) return "";

  const lines: string[] = [];
  for (const d of devices) {
    lines.push(`### ${d.name} — ${d.description}`);
    lines.push(`- FB: ${d.fbName}`);
    if (d.fbTemplateName) lines.push(`- Template: ${d.fbTemplateName}${d.fbTemplateId ? " (from library)" : " (new)"}`);
    lines.push(`- Instance DB: ${d.instanceDbName}`);

    if (d.interlocks.length > 0) {
      lines.push(`- Interlocks:`);
      for (const il of d.interlocks) {
        lines.push(`  - ${il.direction} "${il.targetDeviceName}": ${il.condition}`);
      }
    }
    lines.push("");
  }

  return `## ${deviceType} Devices (from Linkage Matrix)

${lines.join("\n")}

**${devices.length}** ${deviceType} device(s) need this FB. Generate a single FB that handles all instances.`;
}

/** DB stage: device→instanceDB mapping + global data with fields. Just the DB structure. */
export function formatMatrixForDb(matrix: ProcessLinkageMatrix): string {
  const lines: string[] = [];

  // Instance DBs
  lines.push("### Instance Data Blocks");
  lines.push("| Device | FB | Instance DB |");
  lines.push("|--------|-----|------------|");
  for (const d of matrix.deviceLinkage) {
    lines.push(`| ${d.name} | ${d.fbName} | ${d.instanceDbName} |`);
  }

  // Global Data
  if (matrix.globalData.length > 0) {
    lines.push("");
    lines.push("### Global Data Blocks");
    for (const gd of matrix.globalData) {
      lines.push(`\n#### ${gd.dbName} — ${gd.purpose}`);
      if (gd.fields.length > 0) {
        lines.push("| Field | Type | Description |");
        lines.push("|-------|------|-------------|");
        for (const f of gd.fields) {
          lines.push(`| ${f.fieldName} | ${f.dataType} | ${f.description} |`);
        }
      }
    }
  }

  return `## Data Block Structure (from Linkage Matrix)

${lines.join("\n")}`;
}

/** FC+OB stage: process steps + device→FB→instanceDB mapping. Main consumer. */
export function formatMatrixForFc(matrix: ProcessLinkageMatrix): string {
  const lines: string[] = [];

  // Device→FB→DB mapping table
  lines.push("### Device → FB → Instance DB Mapping");
  lines.push("| Device | Type | FB | Instance DB |");
  lines.push("|--------|------|----|------------|");
  for (const d of matrix.deviceLinkage) {
    lines.push(`| ${d.name} | ${d.deviceType} | ${d.fbName} | ${d.instanceDbName} |`);
  }

  // Process Sequence Table
  if (matrix.processSteps.length > 0) {
    lines.push("");
    lines.push("### Process Sequence");
    lines.push("| Step | Action | Completion Criteria | Devices |");
    lines.push("|------|--------|--------------------|---------| ");
    for (const ps of matrix.processSteps) {
      lines.push(`| ${ps.stepNumber} | ${ps.action} | ${ps.completionCriteria} | ${ps.devicesInvolved.join(", ")} |`);
    }
  }

  // Interlocks summary
  const allInterlocks = matrix.deviceLinkage.flatMap((d) =>
    d.interlocks.map((il) => ({ source: d.name, ...il }))
  );
  if (allInterlocks.length > 0) {
    lines.push("");
    lines.push("### Interlock Summary");
    lines.push("| Source | Direction | Target | Condition |");
    lines.push("|--------|-----------|--------|-----------|");
    for (const il of allInterlocks) {
      lines.push(`| ${il.source} | ${il.direction} | ${il.targetDeviceName} | ${il.condition} |`);
    }
  }

  return `## Process Logic Context (from Linkage Matrix)

${lines.join("\n")}

Use this information to:
1. Call each device FB via its Instance DB in the Process FC
2. Implement the process sequence as a state machine (CASE on step number)
3. Implement all interlocks as conditions before device activation
4. OB1 Main calls the Process FC`;
}

// ---------------------------------------------------------------------------
// Shared preamble
// ---------------------------------------------------------------------------

function buildSharedPreamble(input: StagePromptBase): string {
  const { project, designProfile, promptSections } = input;
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");

  return `${buildPriorityHierarchyBlock()}

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

## Current IO List
${formatIoList(project.io_lists)}`;
}

const ARTIFACT_OUTPUT_FORMAT = `## Output Format

You MUST output each artifact as a separate delimited block:

\`\`\`scl filename="<BlockName>.scl" type="<TYPE>" name="<BlockName>" folder="<destination>" dependencies="<comma-separated>"
<SCL code>
\`\`\`

Where type is one of: UDT, FB, FC, DB, OB
After all artifact blocks, provide a brief summary.`;

// ---------------------------------------------------------------------------
// IO Stage
// ---------------------------------------------------------------------------

export function buildIoStagePrompt(input: StagePromptBase): BuiltPrompt {
  const { approvedPatterns, referenceSections, linkageMatrix, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_io", "instructions");

  const matrixContext = linkageMatrix ? formatMatrixForIo(linkageMatrix) : "";

  const systemPrompt = `You are the **Code Architect** generating IO configuration artifacts for a Siemens PLC project.

${buildSharedPreamble(input)}

${matrixContext}

${ARTIFACT_OUTPUT_FORMAT}

## IO Stage Instructions

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  return {
    systemPrompt,
    messages: [
      ...contextMessages,
      { role: "user" as const, content: "Generate the IO configuration artifacts based on the device linkage matrix and requirements." },
    ],
  };
}

// ---------------------------------------------------------------------------
// Folder Stage
// ---------------------------------------------------------------------------

export function buildFolderStagePrompt(input: StagePromptBase): BuiltPrompt {
  const { designProfile, previousArtifactsContext, linkageMatrix, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_folders", "instructions");

  const matrixContext = linkageMatrix ? formatMatrixForFolders(linkageMatrix) : "";

  const systemPrompt = `You are the **Code Architect** creating a TIA Portal folder structure for a Siemens PLC project.

## Project Context
- Client: ${input.project.client_name}
- CPU: ${input.project.cpu_type} / TIA ${input.project.tia_version}

${designProfile ? formatDesignProfile(designProfile) : ""}

${matrixContext}

${previousArtifactsContext ? `## Previously Generated Artifacts\n\n${previousArtifactsContext}` : ""}

## Folder Stage Instructions

${stageInstructions}`;

  return {
    systemPrompt,
    messages: [
      { role: "user" as const, content: "Create the TIA Portal folder structure for this project." },
    ],
  };
}

// ---------------------------------------------------------------------------
// FB Stage
// ---------------------------------------------------------------------------

export function buildFbStagePrompt(
  input: StagePromptBase & { deviceType: string },
): BuiltPrompt {
  const { approvedPatterns, fbTemplates, referenceSections, previousArtifactsContext, linkageMatrix, deviceType, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_fb", "instructions");

  const matrixContext = linkageMatrix ? formatMatrixForFb(linkageMatrix, deviceType) : "";

  const systemPrompt = `You are the **Code Architect** generating Function Blocks for **${deviceType}** devices.

${buildSharedPreamble(input)}

${formatFbTemplates(fbTemplates ?? [])}

${matrixContext}

${previousArtifactsContext ? `## Previously Generated Artifacts\n\n${previousArtifactsContext}` : ""}

${ARTIFACT_OUTPUT_FORMAT}

## FB Stage Instructions — ${deviceType}

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  return {
    systemPrompt,
    messages: [
      ...contextMessages,
      { role: "user" as const, content: `Generate the Function Block artifacts for ${deviceType} devices.` },
    ],
  };
}

// ---------------------------------------------------------------------------
// DB Stage
// ---------------------------------------------------------------------------

export function buildDbStagePrompt(input: StagePromptBase): BuiltPrompt {
  const { approvedPatterns, referenceSections, previousArtifactsContext, linkageMatrix, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_db", "instructions");

  const matrixContext = linkageMatrix ? formatMatrixForDb(linkageMatrix) : "";

  const systemPrompt = `You are the **Code Architect** generating Data Blocks for a Siemens PLC project.

${buildSharedPreamble(input)}

${matrixContext}

${previousArtifactsContext ? `## Previously Generated Artifacts\n\n${previousArtifactsContext}` : ""}

${ARTIFACT_OUTPUT_FORMAT}

## DB Stage Instructions

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  return {
    systemPrompt,
    messages: [
      ...contextMessages,
      { role: "user" as const, content: "Generate all Instance DBs and Global DBs for the project." },
    ],
  };
}

// ---------------------------------------------------------------------------
// FC + OB Stage
// ---------------------------------------------------------------------------

export function buildFcObStagePrompt(input: StagePromptBase): BuiltPrompt {
  const { approvedPatterns, referenceSections, previousArtifactsContext, linkageMatrix, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_fc", "instructions");

  const matrixContext = linkageMatrix ? formatMatrixForFc(linkageMatrix) : "";

  const systemPrompt = `You are the **Code Architect** generating the Process FC and OB1 Main for a Siemens PLC project.

${buildSharedPreamble(input)}

${matrixContext}

${previousArtifactsContext ? `## Previously Generated Artifacts\n\n${previousArtifactsContext}` : ""}

${ARTIFACT_OUTPUT_FORMAT}

## FC + OB Stage Instructions

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  return {
    systemPrompt,
    messages: [
      ...contextMessages,
      { role: "user" as const, content: "Generate the Process FC and OB1 Main to tie all generated blocks together." },
    ],
  };
}
