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

/** IO stage: devices + IO-type wires only. These are the signals needing physical IO module assignment. */
export function formatMatrixForIo(matrix: ProcessLinkageMatrix): string {
  if (matrix.deviceLinkage.length === 0) return "";

  const header = "| Device | FB Param | Direction | Tag Name | Data Type |";
  const sep = "|--------|----------|-----------|----------|-----------|";
  const rows: string[] = [];

  let inCount = 0;
  let outCount = 0;

  for (const d of matrix.deviceLinkage) {
    for (const w of d.wiring) {
      if (w.wireType !== "io") continue;
      rows.push(`| ${d.name} | ${w.paramName} | ${w.direction.toUpperCase()} | ${w.connectedTo} | ${w.dataType ?? "Bool"} |`);
      if (w.direction === "in") inCount++;
      else outCount++;
    }
  }

  if (rows.length === 0) return "";

  return `## Device IO Wiring (from Linkage Matrix)

${header}
${sep}
${rows.join("\n")}

**Signal Totals:** ${inCount} inputs, ${outCount} outputs`;
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

/** FB stage: devices filtered by type + wiring + interlocks. Full parameter interface for FB generation. */
export function formatMatrixForFb(matrix: ProcessLinkageMatrix, deviceType: string): string {
  const devices = matrix.deviceLinkage.filter((d) => d.deviceType === deviceType);
  if (devices.length === 0) return "";

  const lines: string[] = [];
  for (const d of devices) {
    lines.push(`### ${d.name} — ${d.description}`);
    lines.push(`- FB: ${d.fbName}`);
    if (d.fbTemplateName) lines.push(`- Template: ${d.fbTemplateName}${d.fbTemplateId ? " (from library)" : " (new)"}`);
    lines.push(`- Instance DB: ${d.instanceDbName}`);

    if (d.wiring.length > 0) {
      lines.push(`- Parameters:`);
      for (const w of d.wiring) {
        const arrow = w.direction === "in" ? "\u2190" : "\u2192";
        lines.push(`  - ${w.direction.toUpperCase()} ${w.paramName} ${arrow} ${w.connectedTo} (${w.wireType})`);
      }
    }

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

**${devices.length}** ${deviceType} device(s) need this FB. Generate a single FB that handles all instances.
The wiring above defines the complete VAR_INPUT/VAR_OUTPUT interface for this FB.`;
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

/** Format a transition condition as a readable string. */
function formatTransitionLabel(transition: { combinator: string; conditions: Array<{ description: string; deviceName?: string | null }> }): string {
  const conditions = transition?.conditions ?? [];
  if (conditions.length === 0) return "";
  if (conditions.length === 1) return conditions[0].description;
  const joiner = transition.combinator === "OR" ? " OR " : " AND ";
  return conditions.map((c) => c.description).join(joiner);
}

/** FC+OB stage: process sequences + device→FB→instanceDB mapping + inter-FB wiring. Main consumer. */
export function formatMatrixForFc(matrix: ProcessLinkageMatrix, hasProcessRules = false): string {
  const lines: string[] = [];

  // Device→FB→DB mapping table
  lines.push("### Device \u2192 FB \u2192 Instance DB Mapping");
  lines.push("| Device | Type | FB | Instance DB |");
  lines.push("|--------|------|----|------------|");
  for (const d of matrix.deviceLinkage) {
    lines.push(`| ${d.name} | ${d.deviceType} | ${d.fbName} | ${d.instanceDbName} |`);
  }

  // Inter-FB Wiring summary — shows how FB instances connect to each other
  const fbWires: { source: string; sourceParam: string; target: string; targetParam: string }[] = [];
  for (const d of matrix.deviceLinkage) {
    for (const w of d.wiring) {
      if (w.wireType !== "fb") continue;
      const dotIdx = w.connectedTo.indexOf(".");
      if (dotIdx > 0) {
        const targetInst = w.connectedTo.substring(0, dotIdx);
        const targetParam = w.connectedTo.substring(dotIdx + 1);
        if (w.direction === "in") {
          fbWires.push({ source: targetInst, sourceParam: targetParam, target: d.name, targetParam: w.paramName });
        } else {
          fbWires.push({ source: d.name, sourceParam: w.paramName, target: targetInst, targetParam });
        }
      }
    }
  }
  if (fbWires.length > 0) {
    lines.push("");
    lines.push("### Inter-FB Wiring");
    lines.push("| Source Instance.Param | \u2192 | Target Instance.Param |");
    lines.push("|----------------------|---|----------------------|");
    const seen = new Set<string>();
    for (const fw of fbWires) {
      const key = `${fw.source}.${fw.sourceParam}->${fw.target}.${fw.targetParam}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`| ${fw.source}.${fw.sourceParam} | \u2192 | ${fw.target}.${fw.targetParam} |`);
    }
  }

  // Process Sequences (new format)
  for (const seq of matrix.processSequences) {
    lines.push("");
    lines.push(`#### Sequence: "${seq.name}"`);
    if (seq.description) lines.push(`\n${seq.description}`);

    // Safety conditions
    if (seq.safetyConditions.length > 0) {
      lines.push("");
      lines.push("**Safety Conditions (continuously monitored \u2014 halt to safe state on failure):**");
      for (const sc of seq.safetyConditions) {
        const mark = sc.polarity ? "\u2713 ACTIVE" : "\u2717 INACTIVE";
        lines.push(`- ${mark}: ${sc.description}${sc.deviceName ? ` (${sc.deviceName})` : ""}`);
      }
    }

    // Permissives
    if (seq.permissives.length > 0) {
      lines.push("");
      lines.push("**Permissives (must ALL be satisfied to start):**");
      for (const p of seq.permissives) {
        const mark = p.polarity ? "\u2713 ACTIVE" : "\u2717 INACTIVE";
        lines.push(`- ${mark}: ${p.description}${p.deviceName ? ` (${p.deviceName})` : ""}`);
      }
    }

    // Steps table
    if ((seq.steps ?? []).length > 0) {
      lines.push("");
      lines.push("| Step | Transition (AND/OR) | Actions | Devices |");
      lines.push("|------|---------------------|---------|---------|");
      for (const ps of (seq.steps ?? [])) {
        const transLabel = ps.transition ? formatTransitionLabel(ps.transition) : "";
        const actionLabel = (ps.actions ?? []).map((a) => a.description).join("; ");
        lines.push(`| ${ps.stepNumber} | ${transLabel} | ${actionLabel} | ${(ps.devicesInvolved ?? []).join(", ")} |`);
      }
    }

    // State machine implementation guidance — only show default CASE pattern if no process rules override it
    if (!hasProcessRules) {
      lines.push(`
State machine implementation (default pattern):
- Check safety conditions FIRST \u2014 if any fail, force statSeq := 0, deactivate all outputs
- Check permissives before entering step 1
- CASE statSeq OF: each step = one branch
- In each branch: execute actions, then check next step's transition (AND=all true, OR=any true)
- When transition fires \u2192 statSeq := next step number
- ELSE: statSeq := 0 (undefined state recovery)`);
    } else {
      lines.push(`
**NOTE:** The customer's Design Profile defines a MANDATORY process code structure pattern.
You MUST use that pattern (see "MANDATORY: Process Code Structure" section above) instead of the default CASE state machine.
Implement all sequences, steps, transitions, and actions following the customer's defined pattern exactly.`);
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
2. Wire FB outputs to downstream FB inputs as shown in the Inter-FB Wiring table
3. ${hasProcessRules ? "Implement each process sequence using the MANDATORY structure defined in the Design Profile (see above)" : "Implement each process sequence as a state machine (CASE on step number)"}
4. Check safety conditions continuously \u2014 halt to safe state on failure
5. Check permissives before entering step 1 of each sequence
6. Implement all interlocks as conditions before device activation
7. OB1 Main calls the Process FC`;
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

${designProfile ? formatDesignProfile(designProfile, "process") : ""}

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
  const { project, approvedPatterns, referenceSections, linkageMatrix, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_io", "instructions");

  const matrixContext = linkageMatrix ? formatMatrixForIo(linkageMatrix) : "";
  const hasExistingIoList = project.io_lists && project.io_lists.length > 0;

  const ioModeInstructions = hasExistingIoList
    ? `## IO List Mode: COMPARISON

An IO list already exists for this project (shown in "Current IO List" above).
Your job is to generate what you believe the COMPLETE IO list should be based on the linkage matrix and process requirements.

Output your suggested IO list as a JSON array inside [SUGGESTED_IO_LIST]...[/SUGGESTED_IO_LIST] tags:
\`\`\`
[SUGGESTED_IO_LIST]
[
  { "address": "%I0.0", "tag_name": "motorStartBtn", "data_type": "BOOL", "description": "Motor 1 start pushbutton", "module": "DI 16", "slot": 1 },
  ...
]
[/SUGGESTED_IO_LIST]
\`\`\`

Rules:
- Include ALL IO points the process needs (not just new ones)
- Reuse existing tag names and addresses where they match the same physical signal
- Use the address space from the configured hardware modules
- Follow the Design Profile naming conventions for any new tags
- After the JSON block, provide a brief summary of differences: new tags added, tags renamed, addresses changed, etc.

Do NOT generate SCL artifacts in this mode — only the suggested IO list JSON and summary.`
    : `## IO List Mode: GENERATION

No IO list exists yet for this project. Generate the complete IO list as a JSON array inside [SUGGESTED_IO_LIST]...[/SUGGESTED_IO_LIST] tags:
\`\`\`
[SUGGESTED_IO_LIST]
[
  { "address": "%I0.0", "tag_name": "motorStartBtn", "data_type": "BOOL", "description": "Motor 1 start pushbutton", "module": "DI 16", "slot": 1 },
  ...
]
[/SUGGESTED_IO_LIST]
\`\`\`

Rules:
- Assign addresses based on the configured hardware modules (use the address space shown in the IO list/hardware sections above)
- If no hardware modules are configured, assign addresses sequentially starting from %I0.0 for inputs and %Q0.0 for outputs
- Follow the Design Profile naming conventions for tag names (lowerCamelCase by default)
- Include meaningful descriptions for every IO point
- Group related signals together (by device, then by area)

After the JSON block, also generate the IO-related SCL artifacts (IO UDTs, IO Mapping Global DB) as code blocks.`;

  const systemPrompt = `You are the **Code Architect** generating IO configuration for a Siemens PLC project.

${buildSharedPreamble(input)}

${matrixContext}

${ioModeInstructions}

## IO Stage Instructions

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  const userContent = hasExistingIoList
    ? "Analyze the process requirements from the linkage matrix and generate the suggested IO list. Compare against the existing IO list shown in the system prompt."
    : "Generate the complete IO list and IO configuration artifacts based on the device linkage matrix and requirements.";

  return {
    systemPrompt,
    messages: [
      ...contextMessages,
      { role: "user" as const, content: userContent },
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

${designProfile ? formatDesignProfile(designProfile, "process") : ""}

${matrixContext}

## Folder Stage Instructions

${stageInstructions}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (previousArtifactsContext) {
    messages.push(
      { role: "user" as const, content: `Here are the artifacts generated so far:\n\n${previousArtifactsContext}` },
      { role: "assistant" as const, content: "Understood. I'll reference these existing artifacts when creating the folder structure." },
    );
  }
  messages.push({ role: "user" as const, content: "Create the TIA Portal folder structure for this project." });

  return { systemPrompt, messages };
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

${ARTIFACT_OUTPUT_FORMAT}

## FB Stage Instructions — ${deviceType}

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [...contextMessages];
  if (previousArtifactsContext) {
    messages.push(
      { role: "user" as const, content: `Here are the artifacts generated so far:\n\n${previousArtifactsContext}` },
      { role: "assistant" as const, content: "Understood. I'll reference these existing artifacts for consistency." },
    );
  }
  messages.push({ role: "user" as const, content: `Generate the Function Block artifacts for ${deviceType} devices.` });

  return { systemPrompt, messages };
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

${ARTIFACT_OUTPUT_FORMAT}

## DB Stage Instructions

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [...contextMessages];
  if (previousArtifactsContext) {
    messages.push(
      { role: "user" as const, content: `Here are the artifacts generated so far (FBs and IO config):\n\n${previousArtifactsContext}` },
      { role: "assistant" as const, content: "Understood. I'll create matching Instance DBs and Global DBs based on these existing artifacts." },
    );
  }
  messages.push({ role: "user" as const, content: "Generate all Instance DBs and Global DBs for the project." });

  return { systemPrompt, messages };
}

// ---------------------------------------------------------------------------
// FC + OB Stage
// ---------------------------------------------------------------------------

export function buildFcObStagePrompt(input: StagePromptBase): BuiltPrompt {
  const { approvedPatterns, referenceSections, previousArtifactsContext, linkageMatrix, promptSections } = input;

  const stageInstructions = resolveSection(promptSections, "process_fc", "instructions");

  const hasProcessRules = (input.designProfile?.process_rules?.length ?? 0) > 0;
  const matrixContext = linkageMatrix ? formatMatrixForFc(linkageMatrix, hasProcessRules) : "";

  const systemPrompt = `You are the **Code Architect** generating the Process FC and OB1 Main for a Siemens PLC project.

${buildSharedPreamble(input)}

${matrixContext}

${ARTIFACT_OUTPUT_FORMAT}

## FC + OB Stage Instructions

${stageInstructions}`;

  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [...contextMessages];
  if (previousArtifactsContext) {
    messages.push(
      { role: "user" as const, content: `Here are all previously generated artifacts (FB interfaces and DBs). Use these to wire up the Process FC and OB1 correctly:\n\n${previousArtifactsContext}` },
      { role: "assistant" as const, content: hasProcessRules
        ? "Understood. I'll use the FB interfaces, Instance DBs, and Global DBs above to generate the Process FC (following the customer's mandatory process code structure pattern) and OB1 Main."
        : "Understood. I'll use the FB interfaces, Instance DBs, and Global DBs above to generate the Process FC (with state machine logic per sequence) and OB1 Main." },
    );
  }
  messages.push({ role: "user" as const, content: "Generate the Process FC and OB1 Main to tie all generated blocks together." });

  return { systemPrompt, messages };
}
