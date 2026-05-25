# FDS Engine Phase 3 — V2 Interview Prompt Rewrite

**Parent design:** `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` (§4.1 V2 interview prompt rewrite, §6 Sequencing step 3, §8.2 prompt regression risk, §5.4 in-flight conversations).

**Predecessors:**
- Phase 1: `Docs/superpowers/plans/2026-05-25-fds-engine-phase1-schema.md` — schema, validator (`validateSpecContractPatch`), writer/reader routing, ESLint boundary.
- Phase 2: `Docs/superpowers/plans/2026-05-25-fds-engine-phase2-wizard.md` — migration wizard, per-project confirmation flow.

Both merged to master in squash commit `02e33c2`.

**Working branch:** `feature/fds-engine-phase3` (cut off master after the Phase 1+2 squash).

**Status when this design was written:** Phase 1 and Phase 2 land the new schema and the per-project migration path. Confirmed projects already serve the new structured shape via Phase 1's reader. The co-author still emits V1 JSON though — Phase 3 closes that gap.

---

## 1. Goal & non-goals

### Goal

Rewrite the two V1-emitting prompt builders (`buildFdsInterviewSystemPrompt` for per-assembly steps, `buildFdsOrchestrationSystemPrompt` for per-subsystem orchestration) so they emit V2-shaped JSON natively. Add a hard validation gate at the merge point so malformed AI emissions don't corrupt the contract. Keep `ensureV2()` as a defensive tolerance layer for model misbehavior. Verify with snapshot + golden-output replay tests against representative fixtures.

After Phase 3:
- Every co-author turn on a confirmed project emits V2-shaped JSON.
- The merge path runs through `validateSpecContractPatch`; rejections surface as system messages in the chat.
- `ensureV2()` continues to convert any V1-leaning emission as a backstop but is no longer the primary V1→V2 path.

### Non-goals (explicitly deferred)

- **Per-mode authoring in the prompt** — Phase 6 territory. Phase 3 ships single default-mode emission (every row tagged `override_kind: "override"`).
- **`buildFdsSystemOrchestrationSystemPrompt` rewrite** — already emits V2; no work needed.
- **`ensureV2()` deletion** — kept as a tolerance layer. Phase 7 docs pass marks it deprecated once telemetry shows AI emission is reliable.
- **Live-AI E2E tests in CI** — golden-output replay only. Manual smoke against the live AI before merge.
- **8466 Italian-spec coverage** — same exclusion as Phase 2.
- **Phase 2.5 deferrals** — write-disabling inside child components and conversation-archive schema decision are still pending; Phase 3 does not touch them.

### Scope guard

Two prompt rewrites + one validator gate + one defensive shim retained + one snapshot/replay test layer. Anything else is a follow-up phase.

---

## 2. Architecture

### 2.1 Files touched

```
src/lib/spec-builder/
  fds-prompts.ts                          MODIFY — rewrite buildFdsInterviewSystemPrompt
                                                   + buildFdsOrchestrationSystemPrompt to emit V2
  sequence-legacy-shim.ts                 KEEP — defensive tolerance layer (no changes)
  __tests__/
    fds-prompts-v2.test.ts                NEW — snapshot + golden-output validation tests
    __fixtures__/                         NEW — prompt input + golden AI emission fixtures

src/hooks/
  use-fds-conversation.ts                 MODIFY — validateSpecContractPatch gate at merge
  use-fds-orchestration-conversation.ts   MODIFY — same gate
  __tests__/
    use-fds-conversation.test.tsx         NEW — validator-gate failure-path tests

Docs/superpowers/specs/2026-05-25-fds-engine-design.md   MODIFY — §6 status note
```

`buildFdsSystemOrchestrationSystemPrompt` (in `src/lib/spec-builder/system-orchestration-prompts.ts`) already emits V2 and is **out of scope**.

### 2.2 Flow after rewrite (per-assembly path)

```
Engineer message
  └─ buildFdsInterviewSystemPrompt(
       assembly, subsystem, tags, staticStates,
       completedV2States, allStates: OperatingStateV2[]
     )
      └─ AI emits V2 JSON:
         { state_id: <number>, override_kind: "override",
           permissives: PermissiveCondition[],
           steps: StepV2[], notes }
          └─ extractJsonFromResponse — unchanged
              └─ ensureV2() — runs but mostly pass-through (emission already V2)
                  └─ validateSpecContractPatch({
                       assemblies: { [id]: { ...existing,
                         sequential_states: { ...existing, [state_id]: merged } } }
                     })
                      ├─ issues.length === 0 → merge into contract, persist
                      └─ issues.length > 0 → abort merge for this block,
                                              post system-role turn into the conversation
                                              with the issue list
```

The per-subsystem path mirrors this, targeting `orchestrations[subsystem_id][state_id]` instead of `assemblies[id].sequential_states[state_id]`.

### 2.3 Surgical preservation discipline

The current per-assembly prompt is ~320 lines of carefully-tuned instructions; the comment block at the top of `fds-prompts.ts` lists nine specific LLM failure modes it addresses. Phase 3 preserves all of that and only swaps the RESPONSE FORMAT section + the schema-referencing text.

**Preserved verbatim:**
- Hard role and interview protocol headers
- VALIDATION CHECKLIST (one missing field per turn, scripted follow-ups)
- DEVICE CLASS DEFAULTS (motor / vfd / solenoid / analog / safety)
- Tag-direction HARD RULE (outputs vs completion checks)
- Fault code naming convention + severity enum
- MUST NOT section (the 9 negative examples, plus 2 new ones for V2)
- CONFIRMED STATIC STATES block

**Replaced:**
- The example JSON block in RESPONSE FORMAT (V1 → V2 shape)
- SEQUENTIAL STATES REMAINING table sourced from `confirmed_states` numeric state_ids instead of legacy string ids
- Two new MUST NOT entries:
  - "❌ Using the V1 condition shape `{ tag, op, value }` without a `kind` discriminator"
  - "❌ Inventing override_kind values you have not been told about (Phase 3 is single-mode; always emit `override`)"

---

## 3. Prompt content — per-assembly

### 3.1 SEQUENTIAL STATES REMAINING table

Replace the current string-id table with a numeric-id table sourced from `confirmed_states`:

```
SEQUENTIAL STATES REMAINING (state_id is a number — emit it verbatim):
  - 6  (Execute)        — Running
  - 3  (Starting)       — Begin transitioning to Execute
  - 16 (Completing)     — Finishing the current cycle
```

For each state in `confirmed_states` whose `state_pattern === "sequential"` and which is not in `completedSequentialStates`, emit one line:

- `state_id` from `OperatingStateV2.state_id` (numeric for PackML / custom_state, string for legacy shim window)
- `display_name` for the parenthesised label (falls back to `state_name` then `custom_name` then `String(state_id)`)
- `description` after the em-dash

Custom states (`state_id > 100`) appear in the same table with their `custom_name`.

### 3.2 Override_kind discipline

One-line addition to the prompt body:

> Phase 3 ships single-mode authoring. Always emit `"override_kind": "override"`. Per-mode authoring (inherit/suppressed) is a later phase — do not invent override_kind values you have not been told about.

### 3.3 Conditions use `CompletionCriterion`

Replace V1 condition shape (`{ tag, op, value, within_ms, on_fail_code, on_fail_severity }`) with the Phase 1 `CompletionCriterion` discriminated union. The prompt shows each accepted `kind` with a concrete one-line example:

```json
{ "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true, "within_ms": 3000, "on_fail": { "fault_code": "F_LFT01_PUMP_START", "severity": "fault" } }
{ "kind": "tag_compare", "tag": "LFT01_LT01", "op": ">=", "value": 100, "within_ms": 6000, "on_fail": { "fault_code": "F_LFT01_LEVEL", "severity": "fault" } }
{ "kind": "expression", "text": "LFT01_PT01 > 50 AND LFT01_PT02 > 50", "referenced_tags": ["LFT01_PT01", "LFT01_PT02"], "within_ms": 8000, "on_fail": { "fault_code": "F_LFT01_PRESSURE", "severity": "fault" } }
{ "kind": "placeholder", "criterion_id": "PH_LFT01_TBD", "prompt": "Awaiting engineer input on the bypass condition" }
```

`tag_equals` accepts boolean / number / string `value`. `tag_compare` requires `op ∈ { "<", "<=", ">", ">=", "==" }` and a numeric `value`. `expression.text` is plain SCL-like syntax; `referenced_tags` enumerates the tags so the AI can't smuggle a tag into the expression without declaring it. `placeholder` requires both `criterion_id` (stable slug) and `prompt` (prose).

### 3.4 Steps use `StepV2`

Replace the V1 step shape with `StepV2`:

```json
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
      "guard": [
        {
          "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true,
          "within_ms": 3000,
          "on_fail": { "fault_code": "F_LFT01_PUMP_START", "severity": "fault" }
        }
      ],
      "next_step_id": "lft01_execute_step_20"
    }
  ]
}
```

The worked example block in the prompt walks: linear step, branching step (two transitions out of one step), converging branches (two steps both transitioning to the same `next_step_id`), state termination (`next_step_id: null` or a step whose transitions array is empty).

Step ID convention (recommendation, not enforced): `<assembly>_<state>_step_<10|20|30|...>`. Action ID convention: `<step_id>_act_<1|2|3|...>`. Transition ID convention: `<step_id>_to_<next_step_number>`. The AI follows these because the prompt shows them; the validator does not check the naming convention.

### 3.5 Full RESPONSE FORMAT block (the replacement text)

This is the literal markdown block that replaces lines 200-319 of the current `fds-prompts.ts`:

```markdown
# RESPONSE FORMAT

When you propose a table update, include a fenced JSON block at the END of your message. Emit a JSON ARRAY of state objects (you may update multiple states in one turn).

Each state object must conform to this shape:

```json
[
  {
    "state_id": <NUMBER — exact match from SEQUENTIAL STATES REMAINING>,
    "override_kind": "override",
    "permissives": [
      { "tag": "SYS_ESTOP01", "operator": "=", "value": true }
    ],
    "steps": [
      {
        "step_id": "<assembly>_<state>_step_<10|20|30|...>",
        "branch_id": "main",
        "actions": [
          {
            "kind": "assign",
            "action_id": "<step_id>_act_<1|2|3...>",
            "target_tag": "<OUTPUT_TAG>",
            "source": { "kind": "literal", "value": true, "value_type": "boolean" },
            "prose": "<one-line action description>"
          }
        ],
        "monitors": [],
        "transitions": [
          {
            "transition_id": "<step_id>_to_<next_step_number>",
            "guard": [
              {
                "kind": "tag_equals",
                "tag": "<COMPLETION_CHECK_TAG>",
                "value": true,
                "within_ms": 3000,
                "on_fail": { "fault_code": "F_<ASM>_<STEP>", "severity": "fault" }
              }
            ],
            "next_step_id": "<step_id of next step, or null to terminate>"
          }
        ]
      }
    ],
    "notes": null
  }
]
```

[WORKED_EXAMPLE — the implementer translates the existing V1 5-step lift example (currently at lines 204-297 of fds-prompts.ts) into the V2 shape shown above. Same logical content: linear step 10, branching step 20 (split into 21/22), converging steps 21+22 → 30, terminal step 30 (next_step_id null). All conditions become CompletionCriterion objects with `kind: "tag_equals"` or `kind: "tag_compare"`. All outputs become `actions[].source` literals.]
```

The worked example uses the same lift scenario as the current V1 prompt to keep the engineer-facing logic familiar; only the JSON shape changes. The implementer expands the bracket above into ~80-100 lines of literal JSON inside the prompt string.

### 3.6 Prompt-builder signature change

Current signature (V1):

```ts
buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateData>,
  allStates: OperatingState[],            // legacy spec-builder type
): string;
```

New signature (V2):

```ts
buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateV2>,
  allStates: OperatingStateV2[],          // Phase 1 schema type
): string;
```

Two parameter type changes:
- `completedSequentialStates` value type: `SequentialStateData` → `SequentialStateV2` (Phase 1 type).
- `allStates`: `OperatingState[]` → `OperatingStateV2[]` (Phase 1 type).

Callers (currently `use-fds-conversation.ts` and possibly other spec-builder routes) need to map from the legacy `OperatingState[]` to `OperatingStateV2[]` if they don't already have the Phase 1 type in hand. The existing `useSpecContract` reader returns V2-typed states, so `useFdsConversation` should consume directly from the contract rather than the legacy `confirmed_states` projection.

---

## 4. Prompt content — per-subsystem orchestration

### 4.1 V1 → V2 field mapping

Today's `buildFdsOrchestrationSystemPrompt` emits this V1 shape:

```json
{
  "state_id": "starting",
  "assembly_order": ["asm_1", "asm_2"],
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
```

Rewrite to V2:

```json
{
  "state_id": 3,
  "assembly_order": ["00000000-0000-4000-8000-...asm1", "00000000-0000-4000-8000-...asm2"],
  "shared_permissives": [
    {
      "permissive_id": "SP_ESTOP_OK",
      "condition": { "kind": "tag_equals", "tag": "SYS_ESTOP01", "value": true },
      "prose": "Emergency stop circuit healthy"
    }
  ],
  "inter_assembly_interlocks": [
    {
      "interlock_id": "IL_LFT01_LIMIT_TO_CV01_START",
      "source_assembly": "00000000-0000-4000-8000-...asm1",
      "source_condition": { "kind": "tag_equals", "tag": "LFT01_ZSL01", "value": true },
      "target_assembly": "00000000-0000-4000-8000-...asm2",
      "effect": "enable",
      "effect_target": { "assembly": "00000000-0000-4000-8000-...asm2", "state_id": 3 },
      "prose": "CV01 may begin Starting once LFT01 reaches its lower limit"
    }
  ],
  "notes": null
}
```

Field-by-field deltas:

| Field | V1 (current) | V2 (rewrite) |
|---|---|---|
| `state_id` | string | number |
| `shared_permissives` | `string[]` (prose) | `SharedPermissive[]` (`{ permissive_id, condition: CompletionCriterion, prose }`) |
| `inter_assembly_interlocks[].interlock_id` | optional | required stable slug |
| `inter_assembly_interlocks[].source_condition` | string (prose) | `CompletionCriterion` (structured) |
| `inter_assembly_interlocks[].effect` | string (prose) | closed enum: `"hold" \| "block_transition" \| "trigger" \| "enable" \| "disable"` |
| `inter_assembly_interlocks[].effect_target` | absent | optional `{ assembly, state_id }` — required for `block_transition` and `trigger` |
| `inter_assembly_interlocks[].prose` | absent (effect was prose) | required (preserved for DOCX rendering) |

### 4.2 Reused content from `buildFdsSystemOrchestrationSystemPrompt`

The system-level prompt already documents:
- Closed-set effect explanations (5 effects, each with a one-line semantic)
- `CompletionCriterion` kinds with examples
- "IMMUTABLE IDENTIFIERS — ECHO BACK VERBATIM" discipline
- `effect_target` requirement for `block_transition` / `trigger`

Reuse this text verbatim in the per-subsystem prompt (DRY across the two orchestration layers — they share semantics, only the scope differs: subsystem-level interlocks reference assemblies, system-level reference subsystems).

Recommended approach: extract the shared sections (effect documentation, `CompletionCriterion` documentation) into local helper string constants at the top of `system-orchestration-prompts.ts`, export them, and have `fds-prompts.ts` import them. This avoids drift if the schema's effect set changes later.

### 4.3 Prompt-builder signature change

Current signature:

```ts
buildFdsOrchestrationSystemPrompt(
  subsystem: SubsystemConfig,
  assemblySummaries: Array<{
    assembly_name: string;
    assembly_id: string;
    sequential_states: Record<string, SequentialStateData>;
  }>,
  sequentialStates: OperatingState[],
): string;
```

New signature:

```ts
buildFdsOrchestrationSystemPrompt(
  subsystem: SubsystemConfig,
  assemblySummaries: Array<{
    assembly_name: string;
    assembly_id: string;
    sequential_states: Record<string, SequentialStateV2>;
  }>,
  sequentialStates: OperatingStateV2[],
): string;
```

Same caller-update story as §3.6.

---

## 5. Validation gate at the merge point

### 5.1 Per-assembly gate

`use-fds-conversation.ts` currently merges any extracted JSON block straight into the assembly contract. Add a `validateSpecContractPatch` call right after `ensureV2` and before the merge.

Current flow (condensed):

```ts
const extracted = extractJsonFromResponse(fullText);
if (extracted) {
  for (const block of extracted) {
    const stateId = resolveStateId(block.state_id);
    const merged = mergeIntoExistingState(block);
    results.push({ state_id: stateId, data: ensureV2(merged, stateId) });
  }
}
// later: results merged into assembly_session.sequential_states + persisted
```

New flow:

```ts
const extracted = extractJsonFromResponse(fullText);
if (extracted) {
  for (const block of extracted) {
    const stateId = resolveStateId(block.state_id);
    const merged = mergeIntoExistingState(block);
    const v2 = ensureV2(merged, stateId);

    // Phase 3 — hard validator gate
    const patch = {
      assemblies: {
        [assembly.assembly_id]: {
          ...currentAssemblyContract,
          sequential_states: {
            ...currentAssemblyContract.sequential_states,
            [String(stateId)]: v2,
          },
        },
      },
    };
    const issues = validateSpecContractPatch(patch);
    if (issues.length > 0) {
      onValidationFailure({ stateId, issues });
      continue;            // skip this block; valid blocks in the same response still merge
    }

    results.push({ state_id: String(stateId), data: v2 });
  }
}
```

### 5.2 Per-subsystem gate

Same pattern in `use-fds-orchestration-conversation.ts`, targeting `orchestrations[subsystem_id][state_id]`:

```ts
const patch = {
  orchestrations: {
    [subsystem.subsystem_id]: {
      ...currentOrch,
      [String(stateId)]: v2Orchestration,
    },
  },
};
const issues = validateSpecContractPatch(patch);
```

Phase 1's `InterAssemblyInterlock` lift (Task 6) and structured-permissive lift (Task 7) catch every shape regression here.

### 5.3 Failure UX

`onValidationFailure` injects a system-role message into the same `fds_assembly_sessions.conversation` (or `fds_subsystem_orchestrations.conversation`) array that holds engineer + assistant turns. The chat UI renders system messages with warning styling.

Message format:

> ⚠ The AI's proposed update to state Execute (state_id 6) was rejected:
> - `override_kind` is required and must be "override" / "inherit" / "suppressed"
> - Step `lft01_execute_step_10` references unknown next_step_id `step_25`
>
> The other state updates in this turn merged successfully. Ask the AI to retry just this state, or correct it by hand.

The engineer typically replies "fix that" and the AI re-emits. Already-valid blocks from the same turn merge cleanly; no all-or-nothing rollback.

### 5.4 `onValidationFailure` implementation

New conversation-turn helper that:

1. Builds the issue-list message text above.
2. Appends a `{ role: "system", content: <text>, timestamp: <ISO>, state_context?: <state_id> }` turn to the conversation array.
3. Persists via the existing conversation save path (same Supabase upsert the other turn types use).
4. Returns nothing — caller continues processing other blocks.

If the conversation table doesn't already accept `role: "system"` (current shape may be just user/assistant), this is a small schema widening — either accept any string role at the DB level (already true since `conversation` is `jsonb`) or extend the `FdsConversationTurn` Zod schema in `spec-contract-v2.ts` to add `"system"` to the role union.

Check: `FdsConversationTurnSchema.role` already accepts `z.enum(["user", "assistant", "system"])` (per the system-orchestration design from Wave A). If so, no schema change needed. If not, add `"system"` to that enum as part of this task.

---

## 6. Testing strategy

### 6.1 Snapshot tests

Assert the prompt-string output is stable. Regression = the snapshot diff is visible in the PR; drift requires explicit `--update-snapshots`.

```ts
// src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
import { describe, expect, it } from "vitest";
import { buildFdsInterviewSystemPrompt, buildFdsOrchestrationSystemPrompt } from "../fds-prompts";
import catodoAssembly from "./__fixtures__/catodo-assembly.json";
import catodoSubsystem from "./__fixtures__/catodo-subsystem.json";

describe("buildFdsInterviewSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo lift assembly", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly,
      catodoAssembly.subsystem,
      catodoAssembly.tags,
      catodoAssembly.staticStates,
      catodoAssembly.completedSequentialStates,
      catodoAssembly.allStates,
    );
    expect(prompt).toMatchSnapshot();
  });
});

describe("buildFdsOrchestrationSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo subsystem", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoSubsystem.subsystem,
      catodoSubsystem.assemblySummaries,
      catodoSubsystem.sequentialStates,
    );
    expect(prompt).toMatchSnapshot();
  });
});
```

Snapshot files land under `src/lib/spec-builder/__tests__/__snapshots__/`.

### 6.2 Golden-output replay tests

Hand-author 3-5 representative AI responses per builder. Each test asserts: extracted JSON parses → `ensureV2` doesn't throw → `validateSpecContractPatch` returns `[]`.

```ts
import { extractJsonFromResponse } from "../fds-prompts";
import { ensureV2 } from "../sequence-legacy-shim";
import { validateSpecContractPatch } from "../contract";
import goldenAssembly from "./__fixtures__/golden-ai-emission-assembly.json";

describe("golden AI emission — per-assembly", () => {
  it.each(goldenAssembly.responses)("response $name parses + validates", ({ rawText, expectedStateId }) => {
    const extracted = extractJsonFromResponse(rawText);
    expect(extracted).toBeDefined();
    const v2 = ensureV2(extracted![0], String(expectedStateId));
    const issues = validateSpecContractPatch({
      assemblies: {
        "00000000-0000-4000-8000-000000000aa1": {
          assembly_id: "00000000-0000-4000-8000-000000000aa1",
          subsystem_id: "00000000-0000-4000-8000-000000000bb1",
          static_states: {},
          sequential_states: { [String(expectedStateId)]: v2 },
        },
      },
    });
    expect(issues).toEqual([]);
  });
});
```

### 6.3 Recommended golden cases

**Per-assembly (5 cases):**
1. Linear sequence (one branch, three steps).
2. Branching step (one step with two outgoing transitions).
3. Converging branches (two steps both transitioning to the same `next_step_id`).
4. Threshold check (`tag_compare`, `op: ">="`).
5. Placeholder condition (TBD path with `criterion_id`).

**Per-subsystem orchestration (3 cases):**
1. Two assemblies, one shared permissive, one interlock (`effect: "hold"`).
2. Three assemblies, two interlocks (`block_transition` with `effect_target` + `enable`).
3. Single assembly with `assembly_order: [it]` only (degenerate but legal — surfaces edge cases in the prompt).

### 6.4 Validator-gate tests

`src/hooks/__tests__/use-fds-conversation.test.tsx` (new; check first whether the file already exists):

- Mock `extractJsonFromResponse` to return a payload that fails validation.
- Assert `onValidationFailure` is called with the expected issue list.
- Assert the contract is NOT updated for the failing block.
- Assert a system-role turn is persisted into the conversation.
- Repeat for `use-fds-orchestration-conversation.ts`.

### 6.5 Manual smoke

Before merge: open the co-author against one fixture project (catodo or cvl-2129), run a real Claude call, confirm the V2 emission validates and merges. This is engineer-visual confirmation only — not gated by a script.

---

## 7. File structure summary

### Files to create

```
src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
src/lib/spec-builder/__tests__/__fixtures__/
  catodo-assembly.json
  catodo-subsystem.json
  golden-ai-emission-assembly.json
  golden-ai-emission-orchestration.json
src/hooks/__tests__/use-fds-conversation.test.tsx              (if not already present)
src/hooks/__tests__/use-fds-orchestration-conversation.test.tsx (if not already present)
```

### Files to modify

```
src/lib/spec-builder/fds-prompts.ts
  - buildFdsInterviewSystemPrompt: surgical replace of RESPONSE FORMAT block
                                   + SEQUENTIAL STATES table sourced from contract
                                   + 2 new MUST NOT entries (V1 condition shape, override_kind)
                                   + signature changes (SequentialStateV2 + OperatingStateV2)
  - buildFdsOrchestrationSystemPrompt: V2 shape in RESPONSE FORMAT
                                       + reuse closed-effect + CompletionCriterion docs from
                                         system-orchestration-prompts.ts (extract to shared
                                         exported string constants)
                                       + signature changes (same as per-assembly)

src/lib/spec-builder/system-orchestration-prompts.ts
  - Extract effect documentation + CompletionCriterion documentation into exported
    string constants so fds-prompts.ts can reuse them (DRY)

src/hooks/use-fds-conversation.ts
  - Add validateSpecContractPatch gate after ensureV2, before merge
  - Wire onValidationFailure to persist a system-role turn
  - Update caller of buildFdsInterviewSystemPrompt to pass OperatingStateV2[]

src/hooks/use-fds-orchestration-conversation.ts
  - Same gate + system-turn pattern
  - Update caller of buildFdsOrchestrationSystemPrompt

src/hooks/use-fds-conversation.ts (and orchestration counterpart)
  - Wherever the caller currently builds the prompt-builder args from
    spec-builder legacy types, switch to consuming the Phase 1 contract
    via useSpecContract instead

Docs/superpowers/specs/2026-05-25-fds-engine-design.md
  - Phase 3 status note in §6 (mirror Phase 1 + Phase 2 style)
```

### Files to keep (no changes)

```
src/lib/spec-builder/sequence-legacy-shim.ts
  - ensureV2() stays as a tolerance layer. Phase 7 docs pass marks it
    @deprecated once telemetry shows AI emission is reliable. No code
    change in Phase 3.

src/lib/spec-builder/system-orchestration-prompts.ts (apart from the helper extraction)
  - buildFdsSystemOrchestrationSystemPrompt already emits V2.
```

---

## 8. Sequencing (rough — actual plan will refine)

Roughly 12-15 tasks:

1. Extract effect + CompletionCriterion docs from `system-orchestration-prompts.ts` to exported string constants.
2. Rewrite `buildFdsInterviewSystemPrompt` — surgical RESPONSE FORMAT replace + SEQUENTIAL STATES table + 2 new MUST NOT entries + signature change.
3. Snapshot test for per-assembly prompt + `catodo-assembly.json` fixture.
4. Golden-output replay tests for per-assembly emissions (5 cases) + `golden-ai-emission-assembly.json` fixtures.
5. Rewrite `buildFdsOrchestrationSystemPrompt` — V2 shape, reuse extracted docs, signature change.
6. Snapshot test for per-subsystem prompt + `catodo-subsystem.json` fixture.
7. Golden-output replay tests for per-subsystem emissions (3 cases) + `golden-ai-emission-orchestration.json` fixtures.
8. Add `onValidationFailure` system-turn helper (verify `FdsConversationTurnSchema.role` already accepts `"system"`; widen if not).
9. Wire validator gate into `use-fds-conversation.ts` + update prompt-builder caller.
10. Wire validator gate into `use-fds-orchestration-conversation.ts` + update prompt-builder caller.
11. Validator-gate failure-path tests for `use-fds-conversation.ts`.
12. Validator-gate failure-path tests for `use-fds-orchestration-conversation.ts`.
13. Update any other call site broken by the prompt-builder signature changes (search for `buildFdsInterviewSystemPrompt` / `buildFdsOrchestrationSystemPrompt` and patch consumers).
14. Final sweep — `tsc -b`, `npm test`, `npm run build`, design-doc status note in §6.

---

## 9. What Phase 3 delivers

After Phase 3 lands:

- The co-author emits V2 JSON natively on every turn for confirmed projects.
- Hard validator gate blocks malformed AI emissions from corrupting the contract; failures appear as system messages in the chat with the exact issue list.
- `ensureV2()` becomes a thin tolerance layer rather than the primary V1→V2 path.
- 10+ golden-output fixtures lock in the expected emission shapes; regression = test diff in CI.
- Two prompt builders share a single source of truth for closed-effect documentation (no drift between subsystem-level and assembly-level interlock semantics).

---

## 10. What still needs Phase 4+

| Phase | Scope |
|---|---|
| 4 | Monitor picker UI |
| 5 | Materialised `spec_sections` rebuild + editor refactor through `writeSpecContract` |
| 6 | Modes wizard step + per-mode matrix tabs (where `override_kind: "inherit"` / `"suppressed"` become authoring affordances; co-author prompt gains mode-awareness) |
| 7 | ISA-88 docs / terminology pass + mark `ensureV2()` `@deprecated` |

Plus the deferred Italian translation table (8466 Norte/Sur stays unconfirmed until that follow-up) and the Phase 2.5 deferrals (write-disabling inside child components, conversation-archive schema decision) — still pending.

---

## 11. Decisions log

Decisions made during brainstorming (2026-05-25):

1. **Shim fate** → keep `ensureV2()` as tolerance layer; rewrite prompts to emit V2 natively. Phase 7 marks the shim deprecated.
2. **Validation gate** → hard gate via `validateSpecContractPatch` at the merge point. Per-block; valid blocks in the same response merge cleanly while invalid blocks abort + surface system-role message.
3. **Modes in prompt** → default-mode only. Every emitted row carries `override_kind: "override"`. Per-mode authoring (inherit/suppressed) is Phase 6.
4. **PackML state_ids in prompt** → inject project's `confirmed_states` as a SEQUENTIAL STATES table with numeric state_ids and display names. AI emits state_id verbatim.
5. **Test strategy** → snapshot tests for prompt-string stability + golden-output replay (hand-authored fixtures) for emission validation. No live AI in CI.
6. **Rewrite approach** → surgical (preserve the existing prompt scaffolding; replace only RESPONSE FORMAT + schema-referencing text). The current prompt has been iterated against real LLM failure modes; throwing it away would be a regression risk.
7. **Failure UX** → system-role message into the conversation array with the exact issue list. Engineer asks AI to retry that state; already-valid blocks from the same turn stay merged.
8. **Shared documentation** → effect documentation + CompletionCriterion documentation extracted from `system-orchestration-prompts.ts` into exported string constants reused by both prompt builders.
