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
  EquipmentModuleConfig,
  UnitConfig,
  InstrumentTag,
  ControlModuleStateEntry,
  ProcessModel,
} from "@/types/spec-builder";
import type {
  SequentialStateV2,
  EmStateV2,
  CommandBehaviorV2,
} from "@/types/spec-contract-v2";
import type { SourceSection } from "./source-section-select";

export function buildFdsInterviewSystemPrompt(
  equipment_module: EquipmentModuleConfig,
  unit: UnitConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, ControlModuleStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateV2>,
  emStates: EmStateV2[],
  sourceSections: SourceSection[] = [],
  commandBehavior: Record<string, CommandBehaviorV2> = {},
): string {
  // --- Data gathering (unchanged from original) ---
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

  function stateLabel(s: EmStateV2): string {
    return s.name || s.state_id;
  }

  const staticStatesText = Object.entries(staticStates)
    .map(([stateId, entries]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      const rows = entries.map((e) => `    ${e.tag} must hold value: ${e.state}`).join("\n");
      return `  ${stateName}:\n${rows}`;
    }).join("\n");

  const completedText = [
    ...Object.entries(completedSequentialStates).map(([stateId, data]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      // SequentialStateV2 permissives are structured; render their tag for the summary.
      const perms = data.permissives.map((p) => `    - ${p.tag} ${p.operator} ${String(p.value)}`).join("\n");
      const stepCount = data.steps.length;
      return `  ${stateName}:\n    Permissives:\n${perms || "    (none)"}\n    Steps: ${stepCount} V2 step(s)`;
    }),
    // SP-3c: command-driven states count as completed once their
    // command_behavior is authored. Exact wording (em dash here, comma in the
    // REMAINING suffix below) is pinned by fds-prompts-command.test.ts — the
    // comma variant must never appear outside the annotation, or its
    // not.toContain assertion breaks.
    ...Object.entries(commandBehavior).map(([stateId, cb]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      return `  ${stateName}:\n    Command-driven — ${cb.branches.length} branch(es) authored`;
    }),
  ].join("\n");

  const sequentialStatesList = emStates.filter((s) => s.kind === "sequential");
  const sequentialStatesTable = sequentialStatesList
    .map((s) => {
      const cb = commandBehavior[s.state_id];
      const suffix = cb ? `  — command-driven, ${cb.branches.length} branch(es) authored` : "";
      return `  - ${s.state_id}  (${stateLabel(s)})${suffix}`;
    })
    .join("\n");
  const firstSequentialStateId = sequentialStatesList[0]?.state_id ?? "";

  // Relevant customer-spec sections (selected by the caller). Rendered only when present.
  const grounded = sourceSections.length > 0;
  const sourceContext = !grounded
    ? ""
    : `\n## Customer Specification Context\n` +
      `Reference the original customer specification below. Treat it as the source\n` +
      `of intent for process, sequence, fault, and interlock requirements.\n\n` +
      sourceSections
        .map((s) => `### ${s.heading || "(untitled)"}\n${s.body}`)
        .join("\n\n") + "\n";

  // Ground-then-refine: with bound customer-spec requirements, the model drafts
  // the sequence from the spec FIRST, then refines, rather than interrogating the
  // engineer field by field. With no bound context it runs the strict cold
  // interview below unchanged.
  const groundingProtocol = !grounded
    ? ""
    : `# PHASE 1 — GROUND (your first reply for each sequential state)
The Customer Specification Context above describes what this state must do. Before interrogating, DRAFT the state from the spec:
- Propose the permissives and the ordered steps you infer for the current sequential state, citing the spec text behind each step.
- For any required field the spec does not state (completion tag, timeout, fault code, severity), fill it from DEVICE CLASS DEFAULTS and tag it "(assumption — confirm)" in your prose. Never silently omit a required field and never invent a tag name.
- Present the draft in prose, then emit the JSON block for the state (the schema below). End with a short bullet list of the specific points you need the engineer to confirm.

# PHASE 2 — REFINE (subsequent replies)
Ask ONE focused confirming/refining question per turn, anchored to your draft. Only ask about fields the spec left open or that the engineer flagged — do NOT re-interrogate fields the spec already answered. Re-emit the updated JSON whenever an answer changes the state.

---

`;

  // The completeness gate differs by mode: cold interview forbids emitting JSON
  // until the engineer has stated every field; grounded mode permits an
  // assumption-filled draft (every assumption tagged) so PHASE 1 can propose.
  const completenessRule = grounded
    ? `**Never emit a JSON update with a required field left blank or a tag name you invented.** In PHASE 1 you MAY fill gaps from the customer spec or DEVICE CLASS DEFAULTS, but every such gap-fill MUST be tagged "(assumption — confirm)" in your prose. In PHASE 2, prefer the engineer's stated values over your assumptions.`
    : `**You MUST NOT emit a JSON table update until every field above is either stated by the engineer or directly implied by a prior answer in this conversation.** If even one field is missing, ask about it first.`;

  // --- Revised prompt template ---
  return `You are a senior automation engineer co-authoring a functional specification with the project engineer for Equipment Module "${equipment_module.equipment_module_name}" (equipment_module_id: "${equipment_module.equipment_module_id}") within unit "${unit.unit_name}" (unit_id: "${unit.unit_id}", ${unit.equipment_type}).

# IMMUTABLE IDENTIFIERS
Echo these back verbatim — never mutate or paraphrase.
- equipment_module_id: ${equipment_module.equipment_module_id}
- unit_id: ${unit.unit_id}
- state_id: MUST be one of the EM-LOCAL state ids from the SEQUENTIAL STATES REMAINING list below (a string slug, e.g. "auto_cycle"). Never invent a state_id. Never use a state's display name as the state_id.
${sourceContext}
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

# SEQUENTIAL STATES REMAINING (state_id is an EM-local string slug — emit it verbatim):

${sequentialStatesTable || "  (none)"}

---

${groundingProtocol}# INTERVIEW PROTOCOL

You are running a deterministic interview, not a free-form chat. For each sequential state, gather information in this fixed order:

0. **Nature** — FIRST, determine whether this state is (a) an AUTOMATIC step sequence that runs to completion, or (b) COMMAND-DRIVEN manual behaviour (an operator holds a command input; devices respond while it is held). In grounded mode infer the nature from the customer spec and tag it "(assumption — confirm)". A command-driven state is authored as command_behavior (see COMMAND-DRIVEN STATES below), NOT as steps — skip the step interview for it.
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

${completenessRule}

# COMMAND-DRIVEN STATES (command_behavior)

When the engineer confirms a state is command-driven — do NOT author steps. Gather, in order:
1. The command input tags (operator / HMI / pendant inputs) that drive the motions.
2. One branch per command: a branch_id slug, a display label, the when-conditions (the command condition AND any interlock guards — all INPUT tags, permissive shape { tag, operator, value } with raw booleans), and the device holds while the when-conditions are true (OUTPUT tags with their held state).
3. The default_hold — what every commanded device holds when NO branch is active (typically the safe/off values).

Branch mutual exclusion is expressed through the when-conditions themselves. A branch with an empty holds list is legal.

For a command-driven state, emit this shape INSTEAD of steps:

\`\`\`json
[
  {
    "state_id": "execute",
    "command_behavior": {
      "branches": [
        { "branch_id": "drive_fwd", "label": "Drive Forward",
          "when": [ { "tag": "CAR_CMD_FWD", "operator": "=", "value": true }, { "tag": "CAR_LS_FWD", "operator": "=", "value": false } ],
          "control_modules": [ { "tag": "CAR_M01_FWD", "description": "Carriage motor forward", "state": "on" } ] },
        { "branch_id": "drive_rev", "label": "Drive Reverse",
          "when": [ { "tag": "CAR_CMD_REV", "operator": "=", "value": true }, { "tag": "CAR_LS_REV", "operator": "=", "value": false } ],
          "control_modules": [ { "tag": "CAR_M01_REV", "description": "Carriage motor reverse", "state": "on" } ] }
      ],
      "default_hold": [
        { "tag": "CAR_M01_FWD", "description": "Carriage motor forward", "state": "off" },
        { "tag": "CAR_M01_REV", "description": "Carriage motor reverse", "state": "off" }
      ]
    }
  }
]
\`\`\`

state_id must come from SEQUENTIAL STATES REMAINING. The example tags are illustrative — always use tags from OUTPUT TAGS / INPUT TAGS.

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
- \`"critical"\` — unit-wide shutdown; safety-relevant

## Branching
Use multiple \`branches[]\` entries only when the step has >1 possible successor depending on a runtime condition (material type, part presence, mode selection). If the step has exactly one successor, use a single \`branches[]\` entry containing its completion conditions.

---

# RESPONSE FORMAT

When you propose a table update, include a fenced JSON block at the END of your message. Emit a JSON ARRAY of state objects (you may update multiple states in one turn).

Each state object must conform to this V2 shape (or, for a command-driven state, the command_behavior shape from COMMAND-DRIVEN STATES above — never both):

\`\`\`json
[
  {
    "state_id": ${JSON.stringify(firstSequentialStateId || "auto_cycle")},
    "override_kind": "override",
    "permissives": [
      { "tag": "SYS_ESTOP01", "operator": "=", "value": true },
      { "tag": "LFT01_LT01", "operator": ">=", "value": 100 }
    ],
    "steps": [
      {
        "step_id": "lft01_execute_step_10",
        "branch_id": "main",
        "actions": [
          {
            "kind": "assign",
            "action_id": "lft01_execute_step_10_act_1",
            "target_tag": "LFT01_M01_CMD",
            "source": { "kind": "literal", "value": true, "value_type": "boolean" },
            "prose": "Energise hydraulic pump"
          }
        ],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "lft01_execute_step_10_to_20",
            "kind": "single",
            "target_step_id": "lft01_execute_step_20",
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true, "within_ms": 3000, "on_fail": { "fault_code": "F_LFT01_PUMP_START", "severity": "fault" } }
            ],
            "priority": 0,
            "is_default": true,
            "notes": null
          }
        ]
      },
      {
        "step_id": "lft01_execute_step_20",
        "branch_id": "main",
        "actions": [
          {
            "kind": "assign",
            "action_id": "lft01_execute_step_20_act_1",
            "target_tag": "LFT01_SOL01_CMD",
            "source": { "kind": "literal", "value": true, "value_type": "boolean" },
            "prose": "Detect part and branch to load or bypass path"
          }
        ],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "lft01_execute_step_20_to_21",
            "kind": "single",
            "target_step_id": "lft01_execute_step_21",
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_PS01", "value": true, "within_ms": 2000, "on_fail": { "fault_code": "F_LFT01_PART_DETECT", "severity": "fault" } }
            ],
            "priority": 0,
            "is_default": true,
            "notes": null
          },
          {
            "transition_id": "lft01_execute_step_20_to_22",
            "kind": "single",
            "target_step_id": "lft01_execute_step_22",
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_PS01", "value": false, "within_ms": 2000, "on_fail": { "fault_code": "F_LFT01_PART_DETECT", "severity": "fault" } }
            ],
            "priority": 1,
            "is_default": false,
            "notes": null
          }
        ]
      },
      {
        "step_id": "lft01_execute_step_21",
        "branch_id": "load_path",
        "actions": [
          {
            "kind": "assign",
            "action_id": "lft01_execute_step_21_act_1",
            "target_tag": "LFT01_SOL02_CMD",
            "source": { "kind": "literal", "value": true, "value_type": "boolean" },
            "prose": "Raise lift to load height"
          }
        ],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "lft01_execute_step_21_to_30",
            "kind": "single",
            "target_step_id": "lft01_execute_step_30",
            "guard": [
              { "kind": "tag_compare", "tag": "LFT01_LT01", "op": ">=", "value": 500, "within_ms": 8000, "on_fail": { "fault_code": "F_LFT01_RAISE_LOAD", "severity": "fault" } }
            ],
            "priority": 0,
            "is_default": true,
            "notes": null
          }
        ]
      },
      {
        "step_id": "lft01_execute_step_22",
        "branch_id": "bypass_path",
        "actions": [
          {
            "kind": "assign",
            "action_id": "lft01_execute_step_22_act_1",
            "target_tag": "LFT01_SOL02_CMD",
            "source": { "kind": "literal", "value": true, "value_type": "boolean" },
            "prose": "Raise lift to bypass height"
          }
        ],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "lft01_execute_step_22_to_30",
            "kind": "single",
            "target_step_id": "lft01_execute_step_30",
            "guard": [
              { "kind": "tag_compare", "tag": "LFT01_LT01", "op": ">=", "value": 300, "within_ms": 6000, "on_fail": { "fault_code": "F_LFT01_RAISE_BYPASS", "severity": "fault" } }
            ],
            "priority": 0,
            "is_default": true,
            "notes": null
          }
        ]
      },
      {
        "step_id": "lft01_execute_step_30",
        "branch_id": "main",
        "actions": [
          {
            "kind": "assign",
            "action_id": "lft01_execute_step_30_act_1",
            "target_tag": "LFT01_SOL03_CMD",
            "source": { "kind": "literal", "value": false, "value_type": "boolean" },
            "prose": "Close gate and park"
          }
        ],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "lft01_execute_step_30_terminal",
            "kind": "single",
            "target_step_id": "",
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_ZSC03", "value": true, "within_ms": 5000, "on_fail": { "fault_code": "F_LFT01_GATE_CLOSE", "severity": "fault" } }
            ],
            "priority": 0,
            "is_default": true,
            "notes": null
          }
        ]
      }
    ],
    "notes": null
  }
]
\`\`\`

This example demonstrates: a linear step (step_10), a branching step (step_20 → step_21 or step_22 via two transitions with mutually-exclusive guards), converging branches (step_21 and step_22 both transition to step_30), an analog threshold check (tag_compare with op ">="), and state termination (\`target_step_id: ""\` on the final transition — empty string per the shim convention).

Each \`transition\` has \`transition_id\`, \`kind: "single"\`, \`target_step_id: string\` (use \`""\` for terminal), \`guard: CompletionCriterion[]\`, \`priority: int\`, \`is_default: bool\`, optional \`on_fail: { fault_code, severity }\`, and \`notes: string | null\`.

State_id ${JSON.stringify(firstSequentialStateId || "auto_cycle")} above is illustrative — emit whichever state_id the engineer is currently authoring (must come from SEQUENTIAL STATES REMAINING).

---

# MUST NOT — common failure modes to avoid

- ❌ Using an output tag as a completion check:
  \`{ "kind": "tag_equals", "tag": "LFT01_SOL01_CMD", "value": true }\`  ← _CMD is an output
  ✅ \`{ "kind": "tag_equals", "tag": "LFT01_ZSO01", "value": true }\`  ← the limit switch confirms the valve moved

- ❌ Omitting \`within_ms\` or \`on_fail\` on a guard because the engineer "didn't mention them" — ASK before emitting.
- ❌ Inventing tag names that don't appear in OUTPUT TAGS or INPUT TAGS.
- ❌ Emitting a JSON block while any required field is still missing.
- ❌ Using a state's display name as \`state_id\` — state_id is the EM-LOCAL string slug from SEQUENTIAL STATES REMAINING.
- ❌ Paraphrasing tag names in conversation ("the level sensor" instead of "LFT01_LT01").
- ❌ Asking more than one question per turn.
- ❌ Adding a step that violates a CONFIRMED STATIC STATE invariant without first flagging the conflict.
- ❌ Using the V1 condition shape \`{ tag, op, value }\` without a \`kind\` discriminator. The current schema requires \`kind\` as the first field of every guard / source_condition.
- ❌ Inventing override_kind values you have not been told about. Phase 3 is single-mode; always emit \`"override_kind": "override"\`.
- ❌ Emitting a transition without \`"kind": "single"\`, \`"target_step_id"\`, \`"priority"\`, \`"is_default"\`, and \`"notes"\`. The schema rejects partial transitions.
- ❌ Emitting BOTH "steps" and "command_behavior" for the same state — a state is one or the other.
- ❌ Modelling a commanded motion as steps ("wait for operator to press X" is a command branch, not a step).
- ❌ Inventing command tag names that don't appear in INPUT TAGS.

If you have no table update to propose (still gathering info), do not include a JSON block. Keep conversational text concise — the engineer is an expert.`;
}

// ---------------------------------------------------------------------------
// Opening message
// ---------------------------------------------------------------------------

export function buildFdsOpeningMessage(
  equipment_module: EquipmentModuleConfig,
  tags: InstrumentTag[],
  // Hybrid state model: Stage B walks the EM's OWN sequential states. Only the
  // display name of the first sequential state is needed to seed the opening
  // question, so accept the bare name rather than a full state object.
  firstSequentialStateName: string,
  sourceSections: SourceSection[] = [],
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

  if (sourceSections.length > 0) {
    return `Generate the opening message for the equipment_module interview. The equipment_module is "${equipment_module.equipment_module_name}" (${equipment_module.description || "no description"}).

Outputs: ${outputs}
Inputs: ${inputs}

The customer specification context is in your system prompt. Execute PHASE 1 (GROUND) for the "${firstSequentialStateName}" state: read the spec, then PROPOSE your draft permissives and ordered steps for that state — citing the spec and tagging any gaps you filled from device-class defaults as assumptions — and end with the JSON block plus the points you need confirmed. Lead with your proposal; do NOT ask a cold question.`;
  }

  return `Generate the opening message for the equipment_module interview. The equipment_module is "${equipment_module.equipment_module_name}" (${equipment_module.description || "no description"}).

Outputs: ${outputs}
Inputs: ${inputs}

Ask about the "${firstSequentialStateName}" state first. Be specific — reference the actual device names and ask how they operate in sequence. Keep it to 2-3 sentences ending with a clear question.`;
}

// ---------------------------------------------------------------------------
// Process Model authoring prompt (ISA-88 §4.3)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for AI-driven Process Model generation.
 * Given the confirmed physical hierarchy (Units + Equipment Modules) and
 * operating states, the AI proposes a product-centric Process Model that
 * maps to the existing physical/procedural structure.
 */
export function buildProcessModelSystemPrompt(
  units: UnitConfig[],
  systemDescription: string | null,
  existingModel: ProcessModel | null,
): string {
  const hierarchyBlock = units
    .filter((u) => !u.excluded)
    .map((u) => {
      const ems = u.equipment_modules
        .map((em) => `    - Equipment Module: ${em.equipment_module_name} (${em.equipment_module_id})`)
        .join("\n");
      return `  - Unit: ${u.unit_name} (${u.unit_id})\n${ems}`;
    })
    .join("\n");

  const existingBlock = existingModel
    ? `\n## EXISTING PROCESS MODEL (edit/refine this)\n\`\`\`json\n${JSON.stringify(existingModel, null, 2)}\n\`\`\``
    : "";

  return `You are an ISA-88 Process Model specialist.

## YOUR TASK

Propose a Process Model (ISA-88 §4.3) for the machine described below.
The Process Model is PRODUCT-CENTRIC — it describes what happens to the
product/material, not how the equipment does it.

## ISA-88 PROCESS MODEL HIERARCHY

Process
  └── Process Stage    (maps to a Unit — one stage per unit that transforms product)
        └── Process Operation  (maps to an Equipment Module — what that EM does to product)
              └── Process Action   (maps to a Control Module action — lowest product transformation)

## RULES

1. Every Process Stage MUST reference an existing unit_id from the hierarchy below.
2. Every Process Operation MUST reference an existing equipment_module_id from the hierarchy below.
3. Process Stages describe PRODUCT TRANSFORMATION, not equipment behavior.
   - GOOD: "Heat Treatment", "Material Transport", "Mixing"
   - BAD: "Run Motor", "Open Valve" (these are equipment actions, not product transformations)
4. Use plain descriptive names — no tag prefixes, no PLC naming.
5. Stage order reflects the production sequence (order field, 1-based).
6. Keep descriptions concise (1-2 sentences).
7. If an Equipment Module does not transform the product (e.g. pure safety systems),
   it may be omitted from the Process Model or included with a monitoring operation.

## PHYSICAL HIERARCHY (confirmed)

${hierarchyBlock}

${systemDescription ? `## SYSTEM DESCRIPTION\n\n${systemDescription}` : ""}
${existingBlock}

## OUTPUT FORMAT

Respond with a JSON block containing the Process Model:

\`\`\`json
{
  "process_name": "string",
  "process_description": "string",
  "stages": [
    {
      "stage_id": "PS_01",
      "stage_name": "string",
      "description": "string",
      "unit_id": "existing unit_id",
      "order": 1,
      "operations": [
        {
          "operation_id": "PO_01_01",
          "operation_name": "string",
          "description": "string",
          "equipment_module_id": "existing equipment_module_id",
          "actions": [
            {
              "action_id": "PA_01_01_01",
              "action_name": "string",
              "description": "string",
              "control_module_tag": "optional tag"
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

${existingModel ? "Refine the existing model based on the engineer's feedback." : "Propose an initial Process Model based on the hierarchy and system description."}
After the JSON block, briefly explain your rationale for the stage ordering and grouping.`;
}

/**
 * Build the opening user message that kicks off Process Model authoring.
 */
export function buildProcessModelOpeningMessage(
  units: UnitConfig[],
  existingModel: ProcessModel | null,
): string {
  if (existingModel) {
    return "Please review and refine the existing Process Model. Is the stage ordering correct? Are any operations missing or misplaced?";
  }
  const unitNames = units
    .filter((u) => !u.excluded)
    .map((u) => u.unit_name)
    .join(", ");
  return `Please propose an ISA-88 Process Model for this machine. The confirmed units are: ${unitNames}. What does the product go through from start to finish?`;
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