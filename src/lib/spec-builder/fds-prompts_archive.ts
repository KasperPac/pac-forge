/**
 * Prompt builders for FDS co-author conversational interview.
 *
 * The AI acts as a senior automation engineer asking targeted questions
 * about each equipment_module's behavior, then building structured tables from
 * the engineer's natural language answers.
 *
 * Responses include conversational prose AND embedded JSON blocks
 * for table updates, extracted client-side.
 */
import type {
  EquipmentModuleConfig,
  UnitConfig,
  InstrumentTag,
  OperatingState,
  ControlModuleStateEntry,
  SequentialStateData,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Per-equipment_module interview
// ---------------------------------------------------------------------------

/**
 * System prompt for the equipment-module-level co-authoring conversation.
 * Stays stable across turns for prompt caching.
 */
export function buildFdsInterviewSystemPrompt(
  equipment_module: EquipmentModuleConfig,
  unit: UnitConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, ControlModuleStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateData>,
  allStates: OperatingState[],
): string {
  // Collect this equipment_module's tags
  const equipment_moduleTagNames = new Set<string>();
  for (const dev of equipment_module.control_modules) {
    for (const sig of dev.io_signals) {
      equipment_moduleTagNames.add(sig.tag);
    }
  }
  const equipment_moduleTags = tags.filter((t) => equipment_moduleTagNames.has(t.tag));

  const deviceList = equipment_module.control_modules.map((d) => {
    const signals = d.io_signals.map((s) => `${s.tag} (${s.signal_type})`).join(", ");
    return `  - ${d.control_module_name} (${d.control_module_class}${d.is_safety ? ", SAFETY" : ""}): ${signals}`;
  }).join("\n");

  const outputTags = equipment_moduleTags
    .filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO")
    .map((t) => `  - ${t.tag}: ${t.description} (${t.signal_direction})`)
    .join("\n");

  const inputTags = equipment_moduleTags
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

  return `You are a senior automation engineer co-authoring a functional specification with the project engineer. You are working on Assembly "${equipment_module.equipment_module_name}" (equipment_module_id: "${equipment_module.equipment_module_id}") within unit "${unit.unit_name}" (unit_id: "${unit.unit_id}", ${unit.equipment_type}).

IMMUTABLE IDENTIFIERS — ECHO BACK VERBATIM. DO NOT MUTATE.
- equipment_module_id: ${equipment_module.equipment_module_id}
- unit_id: ${unit.unit_id}
- Every sequential state is referenced by its exact state_id from the list below; never invent or paraphrase state_ids.

YOUR ROLE:
- Ask targeted, specific questions about how this equipment_module operates
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
- Step numbers use 10-step spacing (10, 20, 30...). Branch paths use interstitial numbers (21, 22, 23). Both branch paths must converge at the next round-ten step.
- Every step must reference specific output tags by exact name in the \`outputs\` array
- Every completion criteria must reference specific input tags by exact name in \`branches[].conditions\`
- Every condition must include a timeout in \`within_ms\` (e.g. 3s → 3000)
- Every condition must define what happens on failure: \`on_fail_code\` and \`on_fail_severity\`
- Permissives must reference specific input tags with expected values
- ONE step = ONE discrete output command. Parallel simultaneous outputs go in the same step's \`outputs\` array. Sequential commands are separate steps.
- Branches are expressed as multiple entries in the \`branches\` array, each with their own conditions and next_step.
- \`next_step: 0\` means end of state (DONE). Use 0 for the final step of a state.
- For branching steps (multiple branches), use different \`next_step\` values for each path.

RESPONSE FORMAT:
When you propose table updates, include them as a fenced JSON block at the END of your message. The \`state_id\` field MUST be one of the exact state_id values listed in SEQUENTIAL STATES REMAINING above — do NOT invent new IDs or use the state name as the ID. The JSON must match this schema exactly:

\`\`\`json
[
  {
    "state_id": "${firstSequentialStateId}",
    "permissives": [
      { "tag": "SYS_ESTOP01", "operator": "=", "value": false }
    ],
    "steps": [
      {
        "step": 10,
        "action": "Energise hydraulic pump",
        "outputs": [
          { "tag": "LFT01_M01_CMD", "value": "TRUE" }
        ],
        "branches": [
          {
            "conditions": [
              { "tag": "LFT01_M01_FB", "op": "=", "value": "TRUE", "within_ms": 3000, "on_fail_code": "F_LFT01_PUMP_START", "on_fail_severity": "fault" }
            ],
            "next_step": 20
          }
        ]
      },
      {
        "step": 20,
        "action": "Open inlet valve",
        "outputs": [
          { "tag": "LFT01_SOL01_CMD", "value": "TRUE" }
        ],
        "branches": [
          {
            "conditions": [
              { "tag": "LFT01_ZSO01", "op": "=", "value": "TRUE", "within_ms": 5000, "on_fail_code": "F_LFT01_VALVE_OPEN", "on_fail_severity": "fault" }
            ],
            "next_step": 0
          }
        ]
      }
    ]
  }
]
\`\`\`

If you're just asking questions (no table update), don't include a JSON block.
Keep your conversational text concise — the engineer is an expert, not a student.`;
}

/**
 * Generate the AI's opening message for an equipment_module interview.
 * This is the first assistant message — introduces the equipment_module and asks the first question.
 */
export function buildFdsOpeningMessage(
  equipment_module: EquipmentModuleConfig,
  tags: InstrumentTag[],
  firstSequentialState: OperatingState,
): string {
  const equipment_moduleTagNames = new Set<string>();
  for (const dev of equipment_module.control_modules) {
    for (const sig of dev.io_signals) {
      equipment_moduleTagNames.add(sig.tag);
    }
  }
  const equipment_moduleTags = tags.filter((t) => equipment_moduleTagNames.has(t.tag));

  const outputs = equipment_moduleTags
    .filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO")
    .map((t) => `${t.tag} (${t.description})`)
    .join(", ");

  const inputs = equipment_moduleTags
    .filter((t) => t.signal_direction === "DI" || t.signal_direction === "AI")
    .map((t) => `${t.tag} (${t.description})`)
    .join(", ");

  return `Generate the opening message for the equipment_module interview. The equipment_module is "${equipment_module.equipment_module_name}" (${equipment_module.description || "no description"}).

Outputs: ${outputs}
Inputs: ${inputs}

Ask about the "${firstSequentialState.state_name}" state first. Be specific — reference the actual device names and ask how they operate in sequence. Keep it to 2-3 sentences ending with a clear question.`;
}

// ---------------------------------------------------------------------------
// Subsystem orchestration interview
// ---------------------------------------------------------------------------

/**
 * System prompt for the unit-level orchestration conversation.
 * Used after all individual equipment_modules are complete.
 */
export function buildFdsOrchestrationSystemPrompt(
  unit: UnitConfig,
  equipment_moduleSummaries: Array<{
    equipment_module_name: string;
    equipment_module_id: string;
    sequential_states: Record<string, SequentialStateData>;
  }>,
  sequentialStates: OperatingState[],
): string {
  const equipment_moduleSummaryText = equipment_moduleSummaries.map((a) => {
    const stateText = Object.entries(a.sequential_states)
      .map(([stateId, data]) => {
        const stateName = sequentialStates.find((s) => s.state_id === stateId)?.state_name ?? stateId;
        return `    ${stateName}: ${data.steps.length} steps, ${data.permissives.length} permissives`;
      }).join("\n");
    return `  ${a.equipment_module_name} (${a.equipment_module_id}):\n${stateText}`;
  }).join("\n");

  return `You are a senior automation engineer defining how equipment_modules coordinate within unit "${unit.unit_name}" (${unit.equipment_type}).

Individual equipment_module behaviors are already defined. Now you need to define:
1. The ORDER in which equipment_modules execute for each sequential state
2. SHARED PERMISSIVES that gate the entire unit (not just one equipment_module)
3. INTER-ASSEMBLY INTERLOCKS — conditions where one equipment_module's state affects another

ASSEMBLIES IN THIS SUBSYSTEM:
${equipment_moduleSummaryText}

SEQUENTIAL STATES: ${sequentialStates.map((s) => s.state_name).join(", ")}

Ask the engineer about:
- Execution order: Do equipment_modules start simultaneously, sequentially, or in groups?
- Dependencies: Must equipment_module A reach a certain state before equipment_module B can start?
- Shared conditions: Are there unit-wide permissives beyond individual equipment_module permissives?

RESPONSE FORMAT:
When you propose orchestration, include a fenced JSON block:

\`\`\`json
{
  "state_id": "starting",
  "equipment_module_order": ["asm_1", "asm_2", "asm_3"],
  "shared_permissives": ["ESTOP_01 = TRUE"],
  "inter_equipment_module_interlocks": [
    {
      "source_equipment_module": "asm_1",
      "source_condition": "LFT01_ZSL01 = TRUE",
      "target_equipment_module": "asm_2",
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
  unit: UnitConfig,
  equipment_moduleNames: string[],
  firstSequentialState: OperatingState,
): string {
  return `Generate the opening message for unit orchestration. Subsystem "${unit.unit_name}" has ${equipment_moduleNames.length} equipment_modules: ${equipment_moduleNames.join(", ")}.

Ask about the "${firstSequentialState.state_name}" state: in what order do the equipment_modules execute, and are there dependencies between them? Be specific and concise.`;
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
