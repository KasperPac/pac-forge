/**
 * Prompt builders for FDS co-author conversational interview.
 *
 * The AI acts as a senior automation engineer asking targeted questions
 * about each assembly's behavior, then building structured tables from
 * the engineer's natural language answers.
 *
 * Responses include conversational prose AND embedded JSON blocks
 * for table updates, extracted client-side.
 */
import type {
  AssemblyConfig,
  SubsystemConfig,
  InstrumentTag,
  OperatingState,
  DeviceStateEntry,
  SequentialStateData,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Per-assembly interview
// ---------------------------------------------------------------------------

/**
 * System prompt for the assembly-level co-authoring conversation.
 * Stays stable across turns for prompt caching.
 */
export function buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateData>,
  allStates: OperatingState[],
): string {
  // Collect this assembly's tags
  const assemblyTagNames = new Set<string>();
  for (const dev of assembly.devices) {
    for (const sig of dev.io_signals) {
      assemblyTagNames.add(sig.tag);
    }
  }
  const assemblyTags = tags.filter((t) => assemblyTagNames.has(t.tag));

  const deviceList = assembly.devices.map((d) => {
    const signals = d.io_signals.map((s) => `${s.tag} (${s.signal_type})`).join(", ");
    return `  - ${d.device_name} (${d.device_class}${d.is_safety ? ", SAFETY" : ""}): ${signals}`;
  }).join("\n");

  const outputTags = assemblyTags
    .filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO")
    .map((t) => `  - ${t.tag}: ${t.description} (${t.signal_direction})`)
    .join("\n");

  const inputTags = assemblyTags
    .filter((t) => t.signal_direction === "DI" || t.signal_direction === "AI")
    .map((t) => `  - ${t.tag}: ${t.description} (${t.signal_direction})`)
    .join("\n");

  const staticStatesText = Object.entries(staticStates)
    .map(([stateId, entries]) => {
      const stateName = allStates.find((s) => s.state_id === stateId)?.state_name ?? stateId;
      const rows = entries.map((e) => `    ${e.tag}: ${e.state}`).join("\n");
      return `  ${stateName}:\n${rows}`;
    }).join("\n");

  const completedText = Object.entries(completedSequentialStates)
    .map(([stateId, data]) => {
      const stateName = allStates.find((s) => s.state_id === stateId)?.state_name ?? stateId;
      const perms = data.permissives.map((p) => `    - ${p}`).join("\n");
      const steps = data.steps.map((s) => `    ${s.step}. ${s.action} → ${s.completion_criteria}`).join("\n");
      return `  ${stateName}:\n    Permissives:\n${perms}\n    Steps:\n${steps}`;
    }).join("\n");

  const sequentialStatesList = allStates.filter((s) => s.state_pattern === "sequential");
  const sequentialStates = sequentialStatesList
    .map((s) => `${s.state_name} (state_id: "${s.state_id}")`)
    .join(", ");
  const firstSequentialStateId = sequentialStatesList[0]?.state_id ?? "";

  return `You are a senior automation engineer co-authoring a functional specification with the project engineer. You are working on Assembly "${assembly.assembly_name}" (assembly_id: "${assembly.assembly_id}") within subsystem "${subsystem.subsystem_name}" (subsystem_id: "${subsystem.subsystem_id}", ${subsystem.equipment_type}).

IMMUTABLE IDENTIFIERS — ECHO BACK VERBATIM. DO NOT MUTATE.
- assembly_id: ${assembly.assembly_id}
- subsystem_id: ${subsystem.subsystem_id}
- Every sequential state is referenced by its exact state_id from the list below; never invent or paraphrase state_ids.

YOUR ROLE:
- Ask targeted, specific questions about how this assembly operates
- Build structured step tables from the engineer's natural language answers
- Challenge vague answers — push for specific tag references, timeouts, and fault responses
- Pre-fill what you can infer, but always confirm with the engineer
- If the engineer's answer is incomplete, ask follow-up questions
- Never invent behavior — if you're unsure, ask

ASSEMBLY DEVICES:
${deviceList}

OUTPUT TAGS (must be commanded in sequential states):
${outputTags}

INPUT TAGS (available for permissives and completion criteria):
${inputTags}

CONFIRMED STATIC STATES:
${staticStatesText || "  (none confirmed yet)"}

ALREADY COMPLETED SEQUENTIAL STATES:
${completedText || "  (none yet)"}

SEQUENTIAL STATES REMAINING: ${sequentialStates}

RULES FOR STEP TABLES:
- ONE STEP = ONE DISCRETE OUTPUT COMMAND. Never combine multiple output commands or conditional branches into a single step's action text.
- Conditional direction logic (e.g. "if SEN_A then FWD, if SEN_B then REV") MUST be split: one step evaluates / branches, separate steps issue each possible command. Do NOT write multi-branch if/else prose inside a single action field.
- Parallel simultaneous outputs (e.g. "energise pump AND open valve together") are acceptable in one step — but sequential or conditional commands always get their own step.
- Every step must reference specific output tags by exact name
- Every completion criteria must reference specific input tags by exact name
- Every completion criteria must include a timeout (e.g. "within 3s")
- Every step must define what happens on failure/timeout (e.g. "else fault — Motor failed to start, transition to Idle")
- Permissives must reference specific input tags with expected values
- Typical step count: 3–8 steps per state. If you have fewer than 3, you are almost certainly combining steps that should be separate.

RESPONSE FORMAT:
When you propose table updates, include them as a fenced JSON block at the END of your message. The \`state_id\` field MUST be one of the exact state_id values listed in SEQUENTIAL STATES REMAINING above — do NOT invent new IDs or use the state name as the ID. The JSON must match this schema exactly:

\`\`\`json
{
  "state_id": "${firstSequentialStateId}",
  "permissives": ["ESTOP_01 = TRUE (E-Stop not active)", "LFT01_ZSL01 = TRUE (Lift at lower position)"],
  "steps": [
    {
      "step": 1,
      "action": "Energise hydraulic pump LFT01_M01_CMD",
      "completion_criteria": "LFT01_M01_FB = TRUE within 3s, else fault — Hydraulic pump failed to start, transition to Idle",
      "structured_criteria": [
        {
          "kind": "tag_equals",
          "tag": "LFT01_M01_FB",
          "value": true,
          "within_ms": 3000,
          "on_fail": { "fault_code": "F_LFT01_PUMP_START", "severity": "fault" }
        }
      ]
    },
    {
      "step": 2,
      "action": "Open lift valve LFT01_SOL01_CMD",
      "completion_criteria": "LFT01_ZSU01 = TRUE within 10s, else fault — Lift failed to reach upper position, transition to Idle",
      "structured_criteria": [
        {
          "kind": "tag_equals",
          "tag": "LFT01_ZSU01",
          "value": true,
          "within_ms": 10000,
          "on_fail": { "fault_code": "F_LFT01_LIFT_TIMEOUT", "severity": "fault" }
        }
      ]
    }
  ]
}
\`\`\`

STRUCTURED CRITERIA RULES:
- \`kind\` must be one of: "tag_equals", "tag_compare", "expression", "manual_ack"
- Prefer "tag_equals" / "tag_compare" when the criterion is a single signal check
- Use "expression" with a \`text\` + \`referenced_tags\` array for composite conditions
- \`on_fail.severity\` must be "warning" or "fault"
- \`within_ms\` is milliseconds (3s → 3000)

If you're just asking questions (no table update), don't include a JSON block.
Keep your conversational text concise — the engineer is an expert, not a student.`;
}

/**
 * Generate the AI's opening message for an assembly interview.
 * This is the first assistant message — introduces the assembly and asks the first question.
 */
export function buildFdsOpeningMessage(
  assembly: AssemblyConfig,
  tags: InstrumentTag[],
  firstSequentialState: OperatingState,
): string {
  const assemblyTagNames = new Set<string>();
  for (const dev of assembly.devices) {
    for (const sig of dev.io_signals) {
      assemblyTagNames.add(sig.tag);
    }
  }
  const assemblyTags = tags.filter((t) => assemblyTagNames.has(t.tag));

  const outputs = assemblyTags
    .filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO")
    .map((t) => `${t.tag} (${t.description})`)
    .join(", ");

  const inputs = assemblyTags
    .filter((t) => t.signal_direction === "DI" || t.signal_direction === "AI")
    .map((t) => `${t.tag} (${t.description})`)
    .join(", ");

  return `Generate the opening message for the assembly interview. The assembly is "${assembly.assembly_name}" (${assembly.description || "no description"}).

Outputs: ${outputs}
Inputs: ${inputs}

Ask about the "${firstSequentialState.state_name}" state first. Be specific — reference the actual device names and ask how they operate in sequence. Keep it to 2-3 sentences ending with a clear question.`;
}

// ---------------------------------------------------------------------------
// Subsystem orchestration interview
// ---------------------------------------------------------------------------

/**
 * System prompt for the subsystem-level orchestration conversation.
 * Used after all individual assemblies are complete.
 */
export function buildFdsOrchestrationSystemPrompt(
  subsystem: SubsystemConfig,
  assemblySummaries: Array<{
    assembly_name: string;
    assembly_id: string;
    sequential_states: Record<string, SequentialStateData>;
  }>,
  sequentialStates: OperatingState[],
): string {
  const assemblySummaryText = assemblySummaries.map((a) => {
    const stateText = Object.entries(a.sequential_states)
      .map(([stateId, data]) => {
        const stateName = sequentialStates.find((s) => s.state_id === stateId)?.state_name ?? stateId;
        return `    ${stateName}: ${data.steps.length} steps, ${data.permissives.length} permissives`;
      }).join("\n");
    return `  ${a.assembly_name} (${a.assembly_id}):\n${stateText}`;
  }).join("\n");

  return `You are a senior automation engineer defining how assemblies coordinate within subsystem "${subsystem.subsystem_name}" (${subsystem.equipment_type}).

Individual assembly behaviors are already defined. Now you need to define:
1. The ORDER in which assemblies execute for each sequential state
2. SHARED PERMISSIVES that gate the entire subsystem (not just one assembly)
3. INTER-ASSEMBLY INTERLOCKS — conditions where one assembly's state affects another

ASSEMBLIES IN THIS SUBSYSTEM:
${assemblySummaryText}

SEQUENTIAL STATES: ${sequentialStates.map((s) => s.state_name).join(", ")}

Ask the engineer about:
- Execution order: Do assemblies start simultaneously, sequentially, or in groups?
- Dependencies: Must assembly A reach a certain state before assembly B can start?
- Shared conditions: Are there subsystem-wide permissives beyond individual assembly permissives?

RESPONSE FORMAT:
When you propose orchestration, include a fenced JSON block:

\`\`\`json
{
  "state_id": "starting",
  "assembly_order": ["asm_1", "asm_2", "asm_3"],
  "shared_permissives": ["ESTOP_01 = TRUE"],
  "inter_assembly_interlocks": [
    {
      "source_assembly": "asm_1",
      "source_condition": "LFT01_ZSL01 = TRUE",
      "target_assembly": "asm_2",
      "effect": "Permissive for CV01 Starting"
    }
  ]
}
\`\`\`

Keep it concise. The engineer knows their machine.`;
}

/**
 * Opening message for orchestration interview.
 */
export function buildFdsOrchestrationOpeningMessage(
  subsystem: SubsystemConfig,
  assemblyNames: string[],
  firstSequentialState: OperatingState,
): string {
  return `Generate the opening message for subsystem orchestration. Subsystem "${subsystem.subsystem_name}" has ${assemblyNames.length} assemblies: ${assemblyNames.join(", ")}.

Ask about the "${firstSequentialState.state_name}" state: in what order do the assemblies execute, and are there dependencies between them? Be specific and concise.`;
}

// ---------------------------------------------------------------------------
// JSON extraction from streaming responses
// ---------------------------------------------------------------------------

/**
 * Extract a JSON block from an AI response string.
 * Looks for ```json ... ``` fenced blocks.
 * Returns the parsed object or null if not found/invalid.
 */
export function extractJsonFromResponse(text: string): Record<string, unknown> | null {
  const match = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Strip the JSON block from a response to get just the conversational prose.
 */
export function stripJsonFromResponse(text: string): string {
  return text.replace(/```json\s*\n?[\s\S]*?\n?\s*```/, "").trim();
}
