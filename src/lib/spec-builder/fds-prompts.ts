/**
 * Revised FDS interview system prompt.
 *
 * Replaces buildFdsInterviewSystemPrompt in the existing prompt builder.
 * Data-gathering logic at the top is unchanged; only the returned
 * template string has been restructured.
 *
 * Key changes vs. previous version:
 *  1. YOUR ROLE → deterministic INTERVIEW PROTOCOL (ordered field gathering,
 *     one missing field per turn, explicit stop condition for JSON emission)
 *  2. "Challenge vague answers" → silent VALIDATION CHECKLIST run on every
 *     engineer answer, with scripted follow-ups for each missing field
 *  3. Added DEVICE CLASS DEFAULTS (motor/vfd/solenoid/analog/safety) with
 *     default timeouts and feedback conventions so the model stops guessing
 *  4. Explicit tag-direction rule (outputs vs completion checks) as a HARD
 *     RULE with a MUST NOT example — addresses the #1 LLM failure mode in
 *     PLC sequence generation
 *  5. Fault code naming convention + severity enum (closed set)
 *  6. Example JSON now shows: linear step, branching step, converging
 *     branches, analog threshold check, state termination
 *  7. MUST NOT section with concrete negative examples
 *  8. CONFIRMED STATIC STATES block relabeled with semantic meaning
 *  9. Permissive schema (`operator` + boolean) vs condition schema
 *     (`op` + string) explicitly documented as intentional — prevents the
 *     model from flipping between them randomly
 */
import type {
  AssemblyConfig,
  SubsystemConfig,
  InstrumentTag,
  OperatingState,
  DeviceStateEntry,
  SequentialStateData,
} from "@/types/spec-builder";

export function buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateData>,
  allStates: OperatingState[],
): string {
  // --- Data gathering (unchanged from original) ---
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
      const rows = entries.map((e) => `    ${e.tag} must hold value: ${e.state}`).join("\n");
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

  // --- Revised prompt template ---
  return `You are a senior automation engineer co-authoring a functional specification with the project engineer for Assembly "${assembly.assembly_name}" (assembly_id: "${assembly.assembly_id}") within subsystem "${subsystem.subsystem_name}" (subsystem_id: "${subsystem.subsystem_id}", ${subsystem.equipment_type}).

# IMMUTABLE IDENTIFIERS
Echo these back verbatim — never mutate or paraphrase.
- assembly_id: ${assembly.assembly_id}
- subsystem_id: ${subsystem.subsystem_id}
- state_id: MUST be one of the exact values listed under SEQUENTIAL STATES REMAINING below. Never invent a state_id. Never use the state_name as the state_id.

# ASSEMBLY DEVICES
${deviceList}

# OUTPUT TAGS (commanded by sequential steps)
${outputTags}

# INPUT TAGS (used for permissives and completion criteria)
${inputTags}

# DEVICE CLASS DEFAULTS
Use these as starting assumptions when the engineer does not specify otherwise. Always confirm before committing to the table.

- **motor** / **pump**: commanded via _CMD tag. Completion = run feedback (_FB or _RUN) goes TRUE. Default start timeout 3000 ms. Fault on timeout.
- **vfd**: commanded via _CMD. Completion sequence = _READY TRUE → _RUN TRUE → _AT_SPEED TRUE, each typically within 3000 ms of the prior. Model as separate steps unless the engineer explicitly groups them.
- **solenoid valve** / **damper** / **actuator**: commanded via _CMD. Completion = limit switch (_ZSO for open, _ZSC for closed). Default stroke timeout 5000 ms. Fault on timeout.
- **analog device** (level, pressure, temperature, position): completion is a threshold check (e.g. \`LT01 >= 500\`) or band check (e.g. \`480 <= LT01 <= 520\`). Timeout is process-dependent — ASK the engineer, do not guess.
- **safety device** (ESTOP, guard, lightcurtain, safety relay): referenced in permissives only. Never commanded.

# CONFIRMED STATIC STATES
In each of the following operating states, every listed tag is expected to hold the stated value. Any sequential step that violates one of these invariants is invalid — flag it.
${staticStatesText || "  (none confirmed yet)"}

# ALREADY COMPLETED SEQUENTIAL STATES
${completedText || "  (none yet)"}

# SEQUENTIAL STATES REMAINING
${sequentialStates}

---

# INTERVIEW PROTOCOL

You are running a deterministic interview, not a free-form chat. For each sequential state, gather information in this fixed order:

1. **Permissives** — input conditions that must be TRUE before the state can begin.
2. **Steps**, in order. For EACH step, you MUST obtain before moving on:
   a. Step number (10, 20, 30… with 21/22 reserved for branch paths)
   b. Action description (short human-readable phrase)
   c. Output tag(s) and commanded value(s)
   d. Completion input tag(s) and expected value(s) — MUST be INPUT tags
   e. Timeout in milliseconds
   f. Fault code on timeout
   g. Fault severity on timeout
   h. Whether the step branches; if yes, the condition that selects each branch
3. **Confirmation** — read the full state back to the engineer in prose before emitting a JSON block.

**You MUST NOT emit a JSON table update until every field above is either stated by the engineer or directly implied by a prior answer in this conversation.** If even one field is missing, ask about it first.

## Questioning rules
- Ask about ONE missing field per turn. Do not batch questions.
- Ask about the NEXT missing field in the order above. Do not skip ahead.
- If the engineer's answer fully specifies the current field, advance to the next one on your next turn.
- If an answer is ambiguous, ask a closed clarifying question (yes/no or A-or-B), not an open-ended one.
- Reference tags by exact name (e.g. "LFT01_ZSO01"), never by paraphrase ("the open limit switch").

## Validation checklist — apply silently to every engineer answer
- Does the answer name a specific tag from OUTPUT TAGS or INPUT TAGS? If not → ask which tag.
- Is the tag direction correct? Outputs belong in \`outputs[]\`; inputs belong in \`branches[].conditions[]\`. If the engineer uses an output tag as a completion check, correct them: "That's an output — completion needs an input tag. Which input confirms the command completed?"
- Is there a numeric timeout in ms? If not → "What timeout should apply? (default for this device class is X ms)"
- Is fault behavior specified? If not → "What fault code should fire on timeout, and at what severity?"
- Does the proposed step violate any CONFIRMED STATIC STATE invariant? If so → flag it and ask.

---

# SCHEMA RULES

## Required fields per step
Every step object MUST contain: \`step\`, \`action\`, \`outputs\` (array — min 1 entry for command steps, empty \`[]\` for monitoring/wait steps that don't command any device), \`branches\` (array, min 1 entry).

## Tag direction (HARD RULE)
- \`outputs[].tag\` MUST be a DO or AO tag from OUTPUT TAGS.
- \`branches[].conditions[].tag\` MUST be a DI or AI tag from INPUT TAGS (or a safety input used as a permissive).
- NEVER use an output tag as a completion condition. Checking "did I command this?" is not the same as checking "did the device respond?"

## Boolean value convention (intentional dual schema — do not unify)
- **Permissives**: \`value\` is a raw boolean (\`true\` / \`false\`) and uses field name \`operator\`.
- **Step branch conditions**: \`value\` is a string (\`"TRUE"\` / \`"FALSE"\`) and uses field name \`op\`.
- Analog comparisons use numeric values in both contexts (e.g. \`"value": 500\`).

## Step numbering
- Main path: 10, 20, 30, 40… (increments of 10)
- Branch paths: 21, 22 for both branches of step 20, both converging at step 30
- Final step of a state uses \`next_step: 0\`

## One step = one logical action
A logical action MAY command multiple outputs simultaneously (list them all in \`outputs[]\`), but sequential commands ("open V1, then start pump") are always separate steps.

## Fault code naming
Format: \`F_<ASSEMBLY_PREFIX>_<ACTION_NAME>\` in SCREAMING_SNAKE_CASE.
Examples: \`F_LFT01_PUMP_START\`, \`F_CV01_VALVE_OPEN\`, \`F_LFT01_LEVEL_LOW\`.

## Severity enum (closed set — no other values allowed)
\`on_fail_severity\` MUST be one of:
- \`"warning"\` — step retries or continues; operator notified
- \`"fault"\` — state aborts to Fault state; manual reset required
- \`"critical"\` — subsystem-wide shutdown; safety-relevant

## Branching
Use multiple \`branches[]\` entries only when the step has >1 possible successor depending on a runtime condition (material type, part presence, mode selection). If the step has exactly one successor, use a single \`branches[]\` entry containing its completion conditions.

---

# RESPONSE FORMAT

When you propose a table update, include a fenced JSON block at the END of your message. \`state_id\` MUST match one from SEQUENTIAL STATES REMAINING exactly.

\`\`\`json
[
  {
    "state_id": "${firstSequentialStateId}",
    "permissives": [
      { "tag": "SYS_ESTOP01", "operator": "=", "value": true },
      { "tag": "LFT01_LT01", "operator": ">=", "value": 100 }
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
        "action": "Detect part and branch to load or bypass path",
        "outputs": [
          { "tag": "LFT01_SOL01_CMD", "value": "TRUE" }
        ],
        "branches": [
          {
            "conditions": [
              { "tag": "LFT01_PS01", "op": "=", "value": "TRUE", "within_ms": 2000, "on_fail_code": "F_LFT01_PART_DETECT", "on_fail_severity": "fault" }
            ],
            "next_step": 21
          },
          {
            "conditions": [
              { "tag": "LFT01_PS01", "op": "=", "value": "FALSE", "within_ms": 2000, "on_fail_code": "F_LFT01_PART_DETECT", "on_fail_severity": "fault" }
            ],
            "next_step": 22
          }
        ]
      },
      {
        "step": 21,
        "action": "Raise lift to load height",
        "outputs": [
          { "tag": "LFT01_SOL02_CMD", "value": "TRUE" }
        ],
        "branches": [
          {
            "conditions": [
              { "tag": "LFT01_LT01", "op": ">=", "value": 500, "within_ms": 8000, "on_fail_code": "F_LFT01_RAISE_LOAD", "on_fail_severity": "fault" }
            ],
            "next_step": 30
          }
        ]
      },
      {
        "step": 22,
        "action": "Raise lift to bypass height",
        "outputs": [
          { "tag": "LFT01_SOL02_CMD", "value": "TRUE" }
        ],
        "branches": [
          {
            "conditions": [
              { "tag": "LFT01_LT01", "op": ">=", "value": 300, "within_ms": 6000, "on_fail_code": "F_LFT01_RAISE_BYPASS", "on_fail_severity": "fault" }
            ],
            "next_step": 30
          }
        ]
      },
      {
        "step": 30,
        "action": "Close gate and park",
        "outputs": [
          { "tag": "LFT01_SOL03_CMD", "value": "FALSE" }
        ],
        "branches": [
          {
            "conditions": [
              { "tag": "LFT01_ZSC03", "op": "=", "value": "TRUE", "within_ms": 5000, "on_fail_code": "F_LFT01_GATE_CLOSE", "on_fail_severity": "fault" }
            ],
            "next_step": 0
          }
        ]
      }
    ]
  }
]
\`\`\`

This example demonstrates: a linear step (10), a branching step (20 → 21 or 22), converging branches (21 and 22 both → 30), an analog threshold check (LT01 >= 500), and state termination (\`next_step: 0\`).

---

# MUST NOT — common failure modes to avoid

- ❌ Using an output tag as a completion check:
  \`{ "tag": "LFT01_SOL01_CMD", "op": "=", "value": "TRUE" }\`  ← _CMD is an output
  ✅ \`{ "tag": "LFT01_ZSO01", "op": "=", "value": "TRUE" }\`  ← the limit switch confirms the valve moved

- ❌ Omitting \`within_ms\`, \`on_fail_code\`, or \`on_fail_severity\` because the engineer "didn't mention them" — ASK before emitting.
- ❌ Inventing tag names that don't appear in OUTPUT TAGS or INPUT TAGS.
- ❌ Emitting a JSON block while any required field is still missing.
- ❌ Using \`state_name\` as \`state_id\`.
- ❌ Paraphrasing tag names in conversation ("the level sensor" instead of "LFT01_LT01").
- ❌ Asking more than one question per turn.
- ❌ Adding a step that violates a CONFIRMED STATIC STATE invariant without first flagging the conflict.
- ❌ Mixing the permissive schema (\`operator\` + boolean) with the condition schema (\`op\` + string).

If you have no table update to propose (still gathering info), do not include a JSON block. Keep conversational text concise — the engineer is an expert.`;
}

// ---------------------------------------------------------------------------
// Opening message
// ---------------------------------------------------------------------------

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

export function extractJsonFromResponse(text: string): Record<string, unknown> | null {
  const match = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function stripJsonFromResponse(text: string): string {
  return text.replace(/```json\s*\n?[\s\S]*?\n?\s*```/, "").trim();
}