# FDS Engine Phase 3 — V2 Interview Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the two V1-emitting prompt builders (`buildFdsInterviewSystemPrompt` for per-assembly steps, `buildFdsOrchestrationSystemPrompt` for per-subsystem orchestration) so they emit V2-shaped JSON natively. Add a hard `validateSpecContractPatch` gate at the merge point. Keep `ensureV2()` as a defensive tolerance layer.

**Architecture:** Surgical preservation. The existing per-assembly prompt is ~320 lines hardened against 9 documented LLM failure modes. Phase 3 swaps only the RESPONSE FORMAT block (V1 → V2 shape), the SEQUENTIAL STATES table (string ids → numeric PackML ids), and adds 2 MUST NOT rules. Per-subsystem prompt gets a similar surgical V2 swap and reuses shared documentation constants extracted from `system-orchestration-prompts.ts`. Validator-gate failures surface as system-role messages in the chat conversation; valid blocks in the same turn still merge (per-block merge granularity, not all-or-nothing).

**Tech Stack:** TypeScript 5.9, React 19, TanStack Query, Vitest 3, `@testing-library/react`, vitest snapshots, Phase 1's `validateSpecContractPatch` (already exported), Phase 1's V2 Zod schemas in `@/types/spec-contract-v2`.

**Parent design:** `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` (§4.1 interview rewrite, §6 Sequencing step 3, §8.2 prompt regression risk).

**Phase 3 design (this plan implements):** `Docs/superpowers/specs/2026-05-25-fds-engine-phase3-v2-prompt-design.md` (committed as `e181c4e` on this branch).

**Phase 1 + 2 plans** (both merged to master via squash `02e33c2`) for tone, TDD cadence, conventions:
- `Docs/superpowers/plans/2026-05-25-fds-engine-phase1-schema.md`
- `Docs/superpowers/plans/2026-05-25-fds-engine-phase2-wizard.md`

**Out of scope for Phase 3** (covered by later phases or explicit non-goals):
- Per-mode authoring in the prompt (override_kind inherit/suppressed) — Phase 6.
- `buildFdsSystemOrchestrationSystemPrompt` rewrite — already emits V2.
- `ensureV2()` deletion — kept as defensive layer. Phase 7 marks it deprecated.
- Live-AI E2E tests in CI — golden-output replay only. Manual smoke before merge.
- 8466 Italian-spec coverage — still deferred.
- The two Phase 2.5 deferrals (write-disabling in child components, conversation-archive schema) — Phase 3 does not touch them.

---

## Pre-flight

Verify state before starting:

```bash
git status                                    # expect 9 pre-existing unrelated files (quotes/tnc/.gitignore); FDS files clean
git branch --show-current                     # expect: feature/fds-engine-phase3
git log --oneline -2                          # expect: e181c4e docs(fds-engine): Phase 3 design — V2 interview prompt rewrite
                                              #         02e33c2 feat(fds-engine): Phases 1 + 2 — schema, validator, writer/reader, migration wizard
npx tsc -b                                    # expect: 0 errors (Phase 2's final sweep landed this state)
npm test -- --run 2>&1 | tail -5              # expect: 190 passed / 33 failed (baseline)
```

**Branch.** Already on `feature/fds-engine-phase3`. Plan executes on top; no new branch needed. After Task 14, open a new PR against master.

**Schema pre-check (already confirmed by controller — do NOT redo, but if for any reason you doubt it, run):**

```bash
grep -A 3 "FdsConversationTurnSchema\s*=" src/types/spec-contract-v2.ts | head -5
```

Expected: `role: z.enum(["user", "assistant", "system"])` — `"system"` is already accepted. No schema-widening task in this plan.

**`ensureV2()` location:** `src/lib/spec-builder/sequence-legacy-shim.ts` — left untouched throughout this plan.

---

## File Structure

**Files to create:**

```
src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
src/lib/spec-builder/__tests__/__fixtures__/
  catodo-assembly.json
  catodo-subsystem.json
  golden-ai-emission-assembly.json
  golden-ai-emission-orchestration.json

src/hooks/__tests__/use-fds-conversation.test.tsx
src/hooks/__tests__/use-fds-orchestration-conversation.test.tsx

src/lib/spec-builder/__tests__/__snapshots__/   — auto-created by vitest on first test run
```

**Files to modify:**

```
src/lib/spec-builder/system-orchestration-prompts.ts
  - Extract closed-effect documentation + CompletionCriterion documentation
    into exported string constants (INTERLOCK_EFFECTS_DOC, COMPLETION_CRITERION_DOC)

src/lib/spec-builder/fds-prompts.ts
  - buildFdsInterviewSystemPrompt: signature change (SequentialStateV2 + OperatingStateV2)
                                   + SEQUENTIAL STATES table source (numeric state_ids)
                                   + RESPONSE FORMAT swap (V1 → V2 JSON shape)
                                   + 2 new MUST NOT entries
  - buildFdsOrchestrationSystemPrompt: signature change (same)
                                       + V2 RESPONSE FORMAT
                                       + import + interpolate INTERLOCK_EFFECTS_DOC +
                                         COMPLETION_CRITERION_DOC from system-orchestration-prompts

src/hooks/use-fds-conversation.ts
  - allStates type: OperatingState[] → OperatingStateV2[]
  - Add validateSpecContractPatch gate after ensureV2, before merge
  - Wire onValidationFailure to persist system-role turn
  - Drop the "shim cast" workarounds since the prompt signature now matches

src/hooks/use-fds-orchestration-conversation.ts
  - allStates type: OperatingState[] → OperatingStateV2[]
  - Same gate + system-turn pattern
  - Drop "shim cast" workarounds

Docs/superpowers/specs/2026-05-25-fds-engine-design.md
  - Phase 3 status note in §6 (mirror Phase 1 + Phase 2 style)
```

**Files to keep (no changes):**

```
src/lib/spec-builder/sequence-legacy-shim.ts
  - ensureV2() stays as a tolerance layer. Phase 7 marks it @deprecated.

src/lib/spec-builder/fds-prompts.ts buildFdsOpeningMessage,
buildFdsOrchestrationOpeningMessage, extractJsonFromResponse, stripJsonFromResponse
  - Opening messages and JSON extraction don't change shape; only the
    main prompts.

src/lib/spec-builder/system-orchestration-prompts.ts buildFdsSystemOrchestrationSystemPrompt
  - Already V2.
```

---

## Conventions

- **Test colocation.** `__tests__/` directories next to source. File name = `<source>.test.ts` (logic) or `<source>.test.tsx` (React). Vitest picks them up via `vitest.config.ts`.
- **Snapshots.** Stored under `__tests__/__snapshots__/` next to the test file. Regression = diff in the PR. Drift requires explicit `--update-snapshots`.
- **TDD cadence.** Each task writes the failing test first, verifies it fails for the right reason, implements, verifies it passes, commits. Mirrors Phases 1 + 2.
- **Commit cadence.** One commit per task. Messages: `feat(fds-engine):` for new code, `test(fds-engine):` for test-only commits, `docs(fds-engine):` for docs.
- **Working tree.** 9 unrelated uncommitted files (quotes/tnc/.gitignore) carried from Phases 1 + 2. **Do not stage them.** Only commit files this plan modifies.
- **Test baseline.** Start of Phase 3: 190 passed / 33 failed (33 unrelated pre-existing failures in `src/components/quotes/**`, `src/hooks/__tests__/use-issue-*.test.tsx`, etc.). Treat "matches the 33 baseline" as the success condition for full-sweep runs.
- **AI calls.** The prompt rewrites do NOT include any live AI calls in tests. Golden-output replay (hand-authored fixtures) only. Manual smoke against the live AI is a pre-merge step, not a plan task.
- **No `ensureV2()` changes.** Defensive layer per spec decision 1. If a step seems to require touching `sequence-legacy-shim.ts`, stop and surface as a concern.
- **No pipeline-auditor.** CLAUDE.md mentions `.claude/agents/pipeline-auditor.md` after touching `forge-*.ts` / `use-forge-*.ts`. That file does not exist in the repo, and Phase 3 does not touch any forge file. Skip the auditor.
- **Component/hook test pattern.** Canonical examples in the repo:
  - Pure-fn tests: `src/lib/spec-builder/__tests__/contract.test.ts` (Supabase-mocked).
  - Hook tests with React Query: `src/hooks/__tests__/use-customers.test.tsx` (fresh QueryClient per render).
  - Hook tests with Supabase + AI streaming mocks: `src/hooks/__tests__/use-migration-draft.test.tsx` (Phase 2 pattern).

---

### Task 1: Extract shared effect + criterion docs from `system-orchestration-prompts.ts`

**Files:**
- Modify: `src/lib/spec-builder/system-orchestration-prompts.ts`
- Create: `src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts`

The closed-effect documentation and `CompletionCriterion` documentation already live inline in `buildFdsSystemOrchestrationSystemPrompt` (around lines 63-85 of `system-orchestration-prompts.ts`). Extract them into exported string constants so `fds-prompts.ts` can reuse them. This is DRY across the two orchestration layers — they share semantics; only the scope differs (subsystem-level interlocks reference assemblies, system-level reference subsystems).

- [ ] **Step 1: Write a tiny failing test that imports the new constants**

Create `src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  INTERLOCK_EFFECTS_DOC,
  COMPLETION_CRITERION_DOC,
  buildFdsSystemOrchestrationSystemPrompt,
} from "../system-orchestration-prompts";

describe("INTERLOCK_EFFECTS_DOC", () => {
  it("documents all five closed-set effects", () => {
    for (const effect of ["hold", "block_transition", "trigger", "enable", "disable"]) {
      expect(INTERLOCK_EFFECTS_DOC).toContain(`"${effect}"`);
    }
  });

  it("notes the effect_target requirement for block_transition and trigger", () => {
    expect(INTERLOCK_EFFECTS_DOC).toMatch(/effect_target.*REQUIRED/);
  });
});

describe("COMPLETION_CRITERION_DOC", () => {
  it("documents all five accepted kinds", () => {
    for (const kind of ["tag_equals", "tag_compare", "expression", "manual_ack", "placeholder"]) {
      expect(COMPLETION_CRITERION_DOC).toContain(`"${kind}"`);
    }
  });
});

describe("buildFdsSystemOrchestrationSystemPrompt", () => {
  it("still inlines the shared docs (regression — extraction didn't break the existing prompt)", () => {
    const prompt = buildFdsSystemOrchestrationSystemPrompt(
      {
        id: "00000000-0000-4000-8000-000000000001",
        doc_code: "X",
        title: "T",
      } as never,
      [],
      [],
      null,
    );
    // Both shared docs should appear verbatim in the assembled system-level prompt.
    expect(prompt).toContain(INTERLOCK_EFFECTS_DOC);
    expect(prompt).toContain(COMPLETION_CRITERION_DOC);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts
```

Expected: FAIL — `INTERLOCK_EFFECTS_DOC` / `COMPLETION_CRITERION_DOC` do not exist (import error).

- [ ] **Step 3: Extract the constants**

In `src/lib/spec-builder/system-orchestration-prompts.ts`, near the top of the file (after the imports, before `buildFdsSystemOrchestrationSystemPrompt`), add:

```ts
/**
 * Closed-set interlock effect documentation. Shared between system-level and
 * subsystem-level orchestration prompts. The five effects map 1:1 to
 * InterAssemblyInterlockEffectSchema in @/types/spec-contract-v2.
 */
export const INTERLOCK_EFFECTS_DOC = `INTERLOCK EFFECTS (must be one of these five strings verbatim):
  - "hold"             — target must pause in its current state until the source condition clears
  - "block_transition" — target may not leave a specific state until the source condition is met (effect_target.state_id REQUIRED)
  - "trigger"          — rising edge on source_condition forces target to enter a state (effect_target.state_id REQUIRED)
  - "enable"           — target is allowed to run/transition freely while source_condition is TRUE
  - "disable"          — target is forbidden from running while source_condition is TRUE`;

/**
 * CompletionCriterion documentation. Shared between system-level and subsystem-level
 * prompts. The five kinds map 1:1 to CompletionCriterionSchema in @/types/spec-contract-v2.
 */
export const COMPLETION_CRITERION_DOC = `CompletionCriterion kinds accepted in condition / source_condition / guard:
  - { "kind": "tag_equals", "tag": "ESTOP_OK", "value": true }
  - { "kind": "tag_compare", "tag": "HOPPER_LEVEL", "op": ">=", "value": 50 }
  - { "kind": "expression", "text": "ESTOP_OK AND DOOR_CLOSED", "referenced_tags": ["ESTOP_OK","DOOR_CLOSED"] }
  - { "kind": "manual_ack", "prompt": "Operator confirms area clear" }
  - { "kind": "placeholder", "criterion_id": "TBD_<slug>", "prompt": "what is X?" }   — only if genuinely unknown`;
```

Then in `buildFdsSystemOrchestrationSystemPrompt`, replace the existing inline `INTERLOCK EFFECTS` block (currently lines ~63-68) with `${INTERLOCK_EFFECTS_DOC}` and the existing `CompletionCriterion kinds...` block (currently lines ~79-84) with `${COMPLETION_CRITERION_DOC}`. The "target subsystem" wording in the original gets generalised to "target" in the extracted version (subsystem-level prompt context still makes it clear what "target" means; per-subsystem prompt context similarly).

If you want to preserve the original "target subsystem" wording specifically for the system-level prompt, leave the constants generic ("target") and let each calling prompt prefix or suffix with scope-specific text. Keep the constants generic.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts
```

Expected: PASS (3 tests). Also run the full sweep to make sure the prompt-text change didn't break any pre-existing test that references the prompt content:

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: 33 baseline failures, no new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/system-orchestration-prompts.ts src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts
git commit -m "feat(fds-engine): extract INTERLOCK_EFFECTS_DOC + COMPLETION_CRITERION_DOC for prompt reuse"
```

---

### Task 2: Rewrite `buildFdsInterviewSystemPrompt` — V2 RESPONSE FORMAT

**Files:**
- Modify: `src/lib/spec-builder/fds-prompts.ts`

The biggest single change in Phase 3. Surgical: swap the RESPONSE FORMAT block (current lines 200-318), the SEQUENTIAL STATES table source (lines 83-87 + 96 + 124), and the signature (line 36-43). Everything else preserved verbatim.

- [ ] **Step 1: Update imports + signature**

Current imports at the top of `src/lib/spec-builder/fds-prompts.ts` (line 27-34):

```ts
import type {
  AssemblyConfig,
  SubsystemConfig,
  InstrumentTag,
  OperatingState,
  DeviceStateEntry,
  SequentialStateData,
} from "@/types/spec-builder";
```

Replace `OperatingState` and `SequentialStateData` imports with the V2 versions from `@/types/spec-contract-v2`:

```ts
import type {
  AssemblyConfig,
  SubsystemConfig,
  InstrumentTag,
  DeviceStateEntry,
} from "@/types/spec-builder";
import type {
  OperatingStateV2,
  SequentialStateV2,
} from "@/types/spec-contract-v2";
```

Update the function signature (current lines 36-43):

```ts
export function buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateV2>,
  allStates: OperatingStateV2[],
): string {
```

- [ ] **Step 2: Update the SEQUENTIAL STATES table source**

The current lines 83-87 build the table from V1 `OperatingState`:

```ts
const sequentialStatesList = allStates.filter((s) => s.state_pattern === "sequential");
const sequentialStates = sequentialStatesList
  .map((s) => `${s.state_name} (state_id: "${s.state_id}")`)
  .join(", ");
const firstSequentialStateId = sequentialStatesList[0]?.state_id ?? "";
```

Replace with a multi-line table that surfaces the numeric `state_id`, the display name, and the description per the spec §3.1:

```ts
const sequentialStatesList = allStates.filter((s) => s.state_pattern === "sequential");

function stateLabel(s: OperatingStateV2): string {
  // Phase 1 widened OperatingStateV2; prefer display_name, then state_name, then custom_name.
  return s.display_name ?? s.state_name ?? s.custom_name ?? String(s.state_id);
}

const sequentialStatesTable = sequentialStatesList
  .map((s) => `  - ${s.state_id}  (${stateLabel(s)})${s.description ? ` — ${s.description}` : ""}`)
  .join("\n");
const firstSequentialStateId = sequentialStatesList[0]?.state_id ?? "";
```

Also update the `staticStatesText` and `completedText` builders (lines 68-81) where they look up state names — change `(s) => s.state_id === stateId` lookups to handle the `string | number` `state_id` shape:

```ts
const staticStatesText = Object.entries(staticStates)
  .map(([stateId, entries]) => {
    const stateName =
      allStates.find((s) => String(s.state_id) === stateId)
        ? stateLabel(allStates.find((s) => String(s.state_id) === stateId)!)
        : stateId;
    const rows = entries.map((e) => `    ${e.tag} must hold value: ${e.state}`).join("\n");
    return `  ${stateName}:\n${rows}`;
  }).join("\n");

const completedText = Object.entries(completedSequentialStates)
  .map(([stateId, data]) => {
    const stateName =
      allStates.find((s) => String(s.state_id) === stateId)
        ? stateLabel(allStates.find((s) => String(s.state_id) === stateId)!)
        : stateId;
    // SequentialStateV2 permissives are structured; render their tag for the summary.
    const perms = data.permissives.map((p) => `    - ${p.tag} ${p.operator} ${String(p.value)}`).join("\n");
    const stepCount = data.steps.length;
    return `  ${stateName}:\n    Permissives:\n${perms || "    (none)"}\n    Steps: ${stepCount} V2 step(s)`;
  }).join("\n");
```

(The legacy `data.steps[i].action + completion_criteria` rendering doesn't survive into V2 — `StepV2` has a different shape. A simple step-count summary is enough for the prompt's purposes; the AI doesn't need to re-read every step's content, just know how many exist.)

- [ ] **Step 3: Update the `SEQUENTIAL STATES REMAINING` and `IMMUTABLE IDENTIFIERS` template references**

Current line 96 (inside the `# IMMUTABLE IDENTIFIERS` block):

```
- state_id: MUST be one of the exact values listed under SEQUENTIAL STATES REMAINING below. Never invent a state_id. Never use the state_name as the state_id.
```

Update to clarify that state_id is now a number:

```
- state_id: MUST be a number from the SEQUENTIAL STATES REMAINING list below (PackML 1..17 or a custom state >100). Never invent a state_id. Never use a name as the state_id.
```

Current line 124 (inside `# SEQUENTIAL STATES REMAINING`):

```
${sequentialStates}
```

Replace with the new multi-line table:

```
SEQUENTIAL STATES REMAINING (state_id is a number — emit it verbatim):
${sequentialStatesTable || "  (none)"}
```

- [ ] **Step 4: Replace the RESPONSE FORMAT block**

Current lines 200-299 in `fds-prompts.ts` (the V1 RESPONSE FORMAT + worked example). Replace the entire block (from `# RESPONSE FORMAT` through the closing JSON fence + the "This example demonstrates: …" sentence) with the V2 version:

```ts
# RESPONSE FORMAT

When you propose a table update, include a fenced JSON block at the END of your message. Emit a JSON ARRAY of state objects (you may update multiple states in one turn).

Each state object must conform to this V2 shape:

\`\`\`json
[
  {
    "state_id": ${firstSequentialStateId || "6"},
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
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true, "within_ms": 3000, "on_fail": { "fault_code": "F_LFT01_PUMP_START", "severity": "fault" } }
            ],
            "next_step_id": "lft01_execute_step_20"
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
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_PS01", "value": true, "within_ms": 2000, "on_fail": { "fault_code": "F_LFT01_PART_DETECT", "severity": "fault" } }
            ],
            "next_step_id": "lft01_execute_step_21"
          },
          {
            "transition_id": "lft01_execute_step_20_to_22",
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_PS01", "value": false, "within_ms": 2000, "on_fail": { "fault_code": "F_LFT01_PART_DETECT", "severity": "fault" } }
            ],
            "next_step_id": "lft01_execute_step_22"
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
            "guard": [
              { "kind": "tag_compare", "tag": "LFT01_LT01", "op": ">=", "value": 500, "within_ms": 8000, "on_fail": { "fault_code": "F_LFT01_RAISE_LOAD", "severity": "fault" } }
            ],
            "next_step_id": "lft01_execute_step_30"
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
            "guard": [
              { "kind": "tag_compare", "tag": "LFT01_LT01", "op": ">=", "value": 300, "within_ms": 6000, "on_fail": { "fault_code": "F_LFT01_RAISE_BYPASS", "severity": "fault" } }
            ],
            "next_step_id": "lft01_execute_step_30"
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
            "guard": [
              { "kind": "tag_equals", "tag": "LFT01_ZSC03", "value": true, "within_ms": 5000, "on_fail": { "fault_code": "F_LFT01_GATE_CLOSE", "severity": "fault" } }
            ],
            "next_step_id": null
          }
        ]
      }
    ],
    "notes": null
  }
]
\`\`\`

This example demonstrates: a linear step (step_10), a branching step (step_20 → step_21 or step_22 via two transitions with mutually-exclusive guards), converging branches (step_21 and step_22 both transition to step_30), an analog threshold check (tag_compare with op ">="), and state termination (\`next_step_id: null\` on the final transition).

State_id ${firstSequentialStateId || "6"} above is illustrative — emit whichever state_id the engineer is currently authoring (must come from SEQUENTIAL STATES REMAINING).
```

Notes on the V2 shape (encoded above):
- `state_id` is a number from `SEQUENTIAL STATES REMAINING`.
- `override_kind` is always `"override"` in Phase 3 (per spec §3.2 — Phase 6 introduces inherit/suppressed).
- `permissives` keep the V1 shape `{ tag, operator, value }` — that's already `PermissiveConditionSchema` in V2.
- Each `step` has `step_id` (string), `branch_id` (string), `actions: ActionV2[]`, `monitors: MonitorV2[]` (empty `[]` is fine), and `transitions: TransitionV2[]`.
- Each `transition` has `transition_id`, `guard: CompletionCriterion[]`, and `next_step_id: string | null` (`null` = terminal).
- Each `guard` element is a `CompletionCriterion` discriminated union (`tag_equals` / `tag_compare` / `expression` / `placeholder` per spec §3.3).
- `on_fail` is nested `{ fault_code, severity }` not top-level `on_fail_code` + `on_fail_severity`.

- [ ] **Step 5: Replace the MUST NOT block**

Current lines 303-318 contain the V1 MUST NOT block. Replace with the same content plus two new entries (per spec §2.3) and updates to entries that referenced V1-specific shapes:

```ts
# MUST NOT — common failure modes to avoid

- ❌ Using an output tag as a completion check:
  \`{ "kind": "tag_equals", "tag": "LFT01_SOL01_CMD", "value": true }\`  ← _CMD is an output
  ✅ \`{ "kind": "tag_equals", "tag": "LFT01_ZSO01", "value": true }\`  ← the limit switch confirms the valve moved

- ❌ Omitting \`within_ms\` or \`on_fail\` on a guard because the engineer "didn't mention them" — ASK before emitting.
- ❌ Inventing tag names that don't appear in OUTPUT TAGS or INPUT TAGS.
- ❌ Emitting a JSON block while any required field is still missing.
- ❌ Using a state name or string as \`state_id\` — state_id is a NUMBER from SEQUENTIAL STATES REMAINING.
- ❌ Paraphrasing tag names in conversation ("the level sensor" instead of "LFT01_LT01").
- ❌ Asking more than one question per turn.
- ❌ Adding a step that violates a CONFIRMED STATIC STATE invariant without first flagging the conflict.
- ❌ Using the V1 condition shape \`{ tag, op, value }\` without a \`kind\` discriminator. The current schema requires \`kind\` as the first field of every guard / source_condition.
- ❌ Inventing override_kind values you have not been told about. Phase 3 is single-mode; always emit \`"override_kind": "override"\`.

If you have no table update to propose (still gathering info), do not include a JSON block. Keep conversational text concise — the engineer is an expert.\`;
```

(The two new entries are the last two before the closing line, per spec §2.3.)

- [ ] **Step 6: tsc check**

```bash
npx tsc -b
```

Expected: errors in `src/hooks/use-fds-conversation.ts` because that file passes `OperatingState[]` (legacy) to the prompt builder which now expects `OperatingStateV2[]`. **Do not fix the consumer yet** — that's Task 9. Note the error as expected; commit anyway. The consumer-side fix is the next-but-one task.

Actually, to keep `tsc` green between commits (per Phase 1+2 cadence), defer the prompt rewrite to land cleanly with Task 9: temporarily widen the signature to accept either V1 or V2 in this commit:

```ts
export function buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateV2>,
  allStates: OperatingStateV2[] | import("@/types/spec-builder").OperatingState[],   // TEMPORARY — Task 9 narrows
): string {
```

Inside the body, cast `allStates as OperatingStateV2[]` at the point of use. The temporary union keeps `tsc -b` clean until Task 9 narrows the type and updates the caller. Leave a one-line comment explaining the temporary widening so the implementer of Task 9 sees it.

The `completedSequentialStates: Record<string, SequentialStateV2>` parameter type may also need a temporary union if `use-fds-conversation.ts` currently passes the legacy `SequentialStateData` shape (the call site uses an `as unknown as` cast already — see lines 62-63 of the existing file). Keep that cast at the call site for now; the prompt-builder side can stay strict at `SequentialStateV2`.

Run `npx tsc -b` again:

Expected: 0 errors after the temporary widening.

- [ ] **Step 7: Commit**

```bash
git add src/lib/spec-builder/fds-prompts.ts
git commit -m "feat(fds-engine): buildFdsInterviewSystemPrompt — emit V2 JSON (override_kind, numeric state_id, StepV2, CompletionCriterion)"
```

---

### Task 3: Snapshot test for per-assembly prompt + `catodo-assembly.json` fixture

**Files:**
- Create: `src/lib/spec-builder/__tests__/__fixtures__/catodo-assembly.json`
- Create: `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`

Snapshot tests assert the prompt-string output is stable so regressions surface as PR diffs.

- [ ] **Step 1: Build the fixture**

Create `src/lib/spec-builder/__tests__/__fixtures__/catodo-assembly.json`. The fixture represents the input shape `buildFdsInterviewSystemPrompt` consumes. Each top-level key matches a parameter. UUIDs are v4-compliant (Phase 2 confirmed `UuidSchema` requires version 4 or nil/max).

```json
{
  "assembly": {
    "assembly_id": "00000000-0000-4000-8000-000000000a01",
    "assembly_name": "LFT01 — Hydraulic Lift",
    "devices": [
      {
        "device_id": "00000000-0000-4000-8000-000000000d01",
        "device_name": "Hydraulic Pump M01",
        "device_class": "motor",
        "is_safety": false,
        "io_signals": [
          { "tag": "LFT01_M01_CMD", "signal_type": "DO" },
          { "tag": "LFT01_M01_FB", "signal_type": "DI" }
        ]
      },
      {
        "device_id": "00000000-0000-4000-8000-000000000d02",
        "device_name": "Lift Solenoid SOL02",
        "device_class": "solenoid valve",
        "is_safety": false,
        "io_signals": [
          { "tag": "LFT01_SOL02_CMD", "signal_type": "DO" },
          { "tag": "LFT01_ZSO02", "signal_type": "DI" },
          { "tag": "LFT01_ZSC02", "signal_type": "DI" }
        ]
      },
      {
        "device_id": "00000000-0000-4000-8000-000000000d03",
        "device_name": "Level Sensor LT01",
        "device_class": "analog device",
        "is_safety": false,
        "io_signals": [
          { "tag": "LFT01_LT01", "signal_type": "AI" }
        ]
      }
    ]
  },
  "subsystem": {
    "subsystem_id": "00000000-0000-4000-8000-000000000b01",
    "subsystem_name": "Catodo Lift Station",
    "equipment_type": "lift"
  },
  "tags": [
    { "tag": "LFT01_M01_CMD", "description": "Pump motor command", "signal_direction": "DO" },
    { "tag": "LFT01_M01_FB", "description": "Pump run feedback", "signal_direction": "DI" },
    { "tag": "LFT01_SOL02_CMD", "description": "Lift solenoid command", "signal_direction": "DO" },
    { "tag": "LFT01_ZSO02", "description": "Lift open limit", "signal_direction": "DI" },
    { "tag": "LFT01_ZSC02", "description": "Lift closed limit", "signal_direction": "DI" },
    { "tag": "LFT01_LT01", "description": "Level sensor", "signal_direction": "AI" },
    { "tag": "SYS_ESTOP01", "description": "Master E-Stop", "signal_direction": "DI" }
  ],
  "staticStates": {
    "4": [
      { "tag": "LFT01_M01_CMD", "description": "Pump off", "state": "false" },
      { "tag": "LFT01_SOL02_CMD", "description": "Lift solenoid off", "state": "false" }
    ]
  },
  "completedSequentialStates": {},
  "allStates": [
    { "state_id": 4, "packml_id": 4, "display_name": "Idle", "description": "Idle", "state_pattern": "static" },
    { "state_id": 6, "packml_id": 6, "display_name": "Execute", "description": "Running", "state_pattern": "sequential" },
    { "state_id": 16, "packml_id": 16, "display_name": "Completing", "description": "Finishing", "state_pattern": "sequential" }
  ]
}
```

- [ ] **Step 2: Write the snapshot test**

Create `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFdsInterviewSystemPrompt } from "../fds-prompts";
import catodoAssembly from "./__fixtures__/catodo-assembly.json";

describe("buildFdsInterviewSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo lift assembly", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly as never,
      catodoAssembly.subsystem as never,
      catodoAssembly.tags as never,
      catodoAssembly.staticStates as never,
      catodoAssembly.completedSequentialStates as never,
      catodoAssembly.allStates as never,
    );
    expect(prompt).toMatchSnapshot();
  });

  it("includes the V2 marker fields in the rendered RESPONSE FORMAT", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly as never,
      catodoAssembly.subsystem as never,
      catodoAssembly.tags as never,
      catodoAssembly.staticStates as never,
      catodoAssembly.completedSequentialStates as never,
      catodoAssembly.allStates as never,
    );
    expect(prompt).toContain('"override_kind": "override"');
    expect(prompt).toContain('"kind": "tag_equals"');
    expect(prompt).toContain('"kind": "tag_compare"');
    expect(prompt).toContain('"next_step_id"');
    expect(prompt).toContain("state_id is a NUMBER");
  });

  it("renders the SEQUENTIAL STATES REMAINING table with numeric ids", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoAssembly.assembly as never,
      catodoAssembly.subsystem as never,
      catodoAssembly.tags as never,
      catodoAssembly.staticStates as never,
      catodoAssembly.completedSequentialStates as never,
      catodoAssembly.allStates as never,
    );
    // Both sequential states from the fixture must appear with their numeric ids.
    expect(prompt).toMatch(/- 6 +\(Execute\)/);
    expect(prompt).toMatch(/- 16 +\(Completing\)/);
    // The static state (Idle, id 4) must NOT appear in the remaining-table.
    const remainingBlock = prompt.split("# SEQUENTIAL STATES REMAINING")[1] ?? "";
    expect(remainingBlock).not.toMatch(/- 4 +\(Idle\)/);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
```

Expected: snapshot test PASSES on first run (writes the snapshot file). The two content-assertion tests PASS. If any assertion fails:

- "override_kind" / "kind" / "next_step_id" missing → Task 2 didn't fully replace the RESPONSE FORMAT block; go back and finish.
- "state_id is a NUMBER" missing → Task 2 didn't update the IMMUTABLE IDENTIFIERS text; update it.
- Numeric id table missing → Task 2's SEQUENTIAL STATES REMAINING table source wasn't applied; update.

After the first successful run, `__snapshots__/fds-prompts-v2.test.ts.snap` is created. Inspect it once — it should contain the full V2-shaped prompt. If it looks wrong (e.g. still has V1 shape in places), fix Task 2 and re-run with `--update-snapshots`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts \
        src/lib/spec-builder/__tests__/__fixtures__/catodo-assembly.json \
        src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap
git commit -m "test(fds-engine): snapshot + content tests for V2 per-assembly prompt"
```

---

### Task 4: Golden-output replay tests for per-assembly emissions

**Files:**
- Create: `src/lib/spec-builder/__tests__/__fixtures__/golden-ai-emission-assembly.json`
- Modify: `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`

Hand-author 5 representative AI responses (in the shape Claude actually returns: prose + fenced JSON block). Each test asserts: `extractJsonFromResponse` parses non-null → `ensureV2` passes through → an enclosing patch validates with zero issues.

- [ ] **Step 1: Build the golden-output fixture**

Create `src/lib/spec-builder/__tests__/__fixtures__/golden-ai-emission-assembly.json`:

```json
{
  "responses": [
    {
      "name": "linear sequence — three steps",
      "expectedStateId": 6,
      "rawText": "Got it. Here's the Execute sequence for LFT01:\n\n```json\n[\n  {\n    \"state_id\": 6,\n    \"override_kind\": \"override\",\n    \"permissives\": [\n      { \"tag\": \"SYS_ESTOP01\", \"operator\": \"=\", \"value\": true }\n    ],\n    \"steps\": [\n      {\n        \"step_id\": \"lft01_execute_step_10\",\n        \"branch_id\": \"main\",\n        \"actions\": [\n          { \"kind\": \"assign\", \"action_id\": \"lft01_execute_step_10_act_1\", \"target_tag\": \"LFT01_M01_CMD\", \"source\": { \"kind\": \"literal\", \"value\": true, \"value_type\": \"boolean\" }, \"prose\": \"Energise pump\" }\n        ],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_10_to_20\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_M01_FB\", \"value\": true, \"within_ms\": 3000, \"on_fail\": { \"fault_code\": \"F_LFT01_PUMP_START\", \"severity\": \"fault\" } } ], \"next_step_id\": \"lft01_execute_step_20\" }\n        ]\n      },\n      {\n        \"step_id\": \"lft01_execute_step_20\",\n        \"branch_id\": \"main\",\n        \"actions\": [\n          { \"kind\": \"assign\", \"action_id\": \"lft01_execute_step_20_act_1\", \"target_tag\": \"LFT01_SOL02_CMD\", \"source\": { \"kind\": \"literal\", \"value\": true, \"value_type\": \"boolean\" }, \"prose\": \"Open lift solenoid\" }\n        ],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_20_to_30\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_ZSO02\", \"value\": true, \"within_ms\": 5000, \"on_fail\": { \"fault_code\": \"F_LFT01_LIFT_OPEN\", \"severity\": \"fault\" } } ], \"next_step_id\": \"lft01_execute_step_30\" }\n        ]\n      },\n      {\n        \"step_id\": \"lft01_execute_step_30\",\n        \"branch_id\": \"main\",\n        \"actions\": [\n          { \"kind\": \"assign\", \"action_id\": \"lft01_execute_step_30_act_1\", \"target_tag\": \"LFT01_M01_CMD\", \"source\": { \"kind\": \"literal\", \"value\": false, \"value_type\": \"boolean\" }, \"prose\": \"De-energise pump\" }\n        ],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_30_terminal\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_M01_FB\", \"value\": false, \"within_ms\": 3000, \"on_fail\": { \"fault_code\": \"F_LFT01_PUMP_STOP\", \"severity\": \"fault\" } } ], \"next_step_id\": null }\n        ]\n      }\n    ],\n    \"notes\": null\n  }\n]\n```"
    },
    {
      "name": "branching step — two transitions out of one step",
      "expectedStateId": 6,
      "rawText": "Here's a step with a part-detect branch:\n\n```json\n[\n  {\n    \"state_id\": 6,\n    \"override_kind\": \"override\",\n    \"permissives\": [],\n    \"steps\": [\n      {\n        \"step_id\": \"lft01_execute_step_20\",\n        \"branch_id\": \"main\",\n        \"actions\": [],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_20_to_21\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_PS01\", \"value\": true, \"within_ms\": 2000, \"on_fail\": { \"fault_code\": \"F_LFT01_PART\", \"severity\": \"fault\" } } ], \"next_step_id\": \"lft01_execute_step_21\" },\n          { \"transition_id\": \"lft01_execute_step_20_to_22\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_PS01\", \"value\": false, \"within_ms\": 2000, \"on_fail\": { \"fault_code\": \"F_LFT01_PART\", \"severity\": \"fault\" } } ], \"next_step_id\": \"lft01_execute_step_22\" }\n        ]\n      }\n    ],\n    \"notes\": null\n  }\n]\n```"
    },
    {
      "name": "converging branches — two steps to the same next_step_id",
      "expectedStateId": 6,
      "rawText": "Both paths converge at step_30:\n\n```json\n[\n  {\n    \"state_id\": 6,\n    \"override_kind\": \"override\",\n    \"permissives\": [],\n    \"steps\": [\n      {\n        \"step_id\": \"lft01_execute_step_21\",\n        \"branch_id\": \"load\",\n        \"actions\": [],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_21_to_30\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_ZSO02\", \"value\": true, \"within_ms\": 5000, \"on_fail\": { \"fault_code\": \"F_LFT01_RAISE_LOAD\", \"severity\": \"fault\" } } ], \"next_step_id\": \"lft01_execute_step_30\" }\n        ]\n      },\n      {\n        \"step_id\": \"lft01_execute_step_22\",\n        \"branch_id\": \"bypass\",\n        \"actions\": [],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_22_to_30\", \"guard\": [ { \"kind\": \"tag_equals\", \"tag\": \"LFT01_ZSO02\", \"value\": true, \"within_ms\": 5000, \"on_fail\": { \"fault_code\": \"F_LFT01_RAISE_BYPASS\", \"severity\": \"fault\" } } ], \"next_step_id\": \"lft01_execute_step_30\" }\n        ]\n      }\n    ],\n    \"notes\": null\n  }\n]\n```"
    },
    {
      "name": "threshold check — tag_compare with op >=",
      "expectedStateId": 6,
      "rawText": "Wait for the level to reach 500:\n\n```json\n[\n  {\n    \"state_id\": 6,\n    \"override_kind\": \"override\",\n    \"permissives\": [],\n    \"steps\": [\n      {\n        \"step_id\": \"lft01_execute_step_30\",\n        \"branch_id\": \"main\",\n        \"actions\": [],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_30_terminal\", \"guard\": [ { \"kind\": \"tag_compare\", \"tag\": \"LFT01_LT01\", \"op\": \">=\", \"value\": 500, \"within_ms\": 8000, \"on_fail\": { \"fault_code\": \"F_LFT01_LEVEL\", \"severity\": \"fault\" } } ], \"next_step_id\": null }\n        ]\n      }\n    ],\n    \"notes\": null\n  }\n]\n```"
    },
    {
      "name": "placeholder condition — TBD path with criterion_id",
      "expectedStateId": 6,
      "rawText": "You haven't told me what the bypass condition is yet — emitting a placeholder for now:\n\n```json\n[\n  {\n    \"state_id\": 6,\n    \"override_kind\": \"override\",\n    \"permissives\": [],\n    \"steps\": [\n      {\n        \"step_id\": \"lft01_execute_step_22\",\n        \"branch_id\": \"bypass\",\n        \"actions\": [],\n        \"monitors\": [],\n        \"transitions\": [\n          { \"transition_id\": \"lft01_execute_step_22_to_30\", \"guard\": [ { \"kind\": \"placeholder\", \"criterion_id\": \"PH_LFT01_BYPASS\", \"prompt\": \"Awaiting engineer input on the bypass completion condition\" } ], \"next_step_id\": \"lft01_execute_step_30\" }\n        ]\n      }\n    ],\n    \"notes\": null\n  }\n]\n```"
    }
  ]
}
```

(JSON files don't accept multi-line strings prettily — each `rawText` is a single escaped string. That's fine; tests just compare its parsed output.)

- [ ] **Step 2: Append the golden-replay tests to `fds-prompts-v2.test.ts`**

Append to the existing `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`:

```ts
import { extractJsonFromResponse } from "../fds-prompts";
import { ensureV2 } from "../sequence-legacy-shim";
import { validateSpecContractPatch } from "../contract";
import goldenAssembly from "./__fixtures__/golden-ai-emission-assembly.json";

describe("golden AI emission — per-assembly", () => {
  const ASSEMBLY_ID = "00000000-0000-4000-8000-000000000aa1";
  const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000bb1";

  it.each(goldenAssembly.responses)(
    "response '$name' parses + validates",
    ({ rawText, expectedStateId }) => {
      const extracted = extractJsonFromResponse(rawText) as unknown as Array<Record<string, unknown>> | null;
      expect(extracted).not.toBeNull();
      expect(Array.isArray(extracted)).toBe(true);
      expect(extracted![0]).toMatchObject({ state_id: expectedStateId });

      const v2 = ensureV2(extracted![0] as never, String(expectedStateId));

      const issues = validateSpecContractPatch({
        assemblies: {
          [ASSEMBLY_ID]: {
            assembly_id: ASSEMBLY_ID,
            subsystem_id: SUBSYSTEM_ID,
            static_states: {},
            sequential_states: { [String(expectedStateId)]: v2 },
          } as never,
        } as never,
      });

      expect(issues).toEqual([]);
    },
  );
});
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
```

Expected: PASS — the snapshot + content tests from Task 3 (3 tests) plus the new golden-replay (5 tests) = 8 total.

If any golden test fails:
- "Argument of type 'string' is not assignable to parameter of type 'number'" in validation issue → fixture has a string `state_id`. Change to a number.
- "guard items must be CompletionCriterion" → fixture omits `kind`. Add it.
- "override_kind required" → fixture missing `override_kind: "override"`. Add it.
- Validation passes when it shouldn't → the validator may not yet enforce that particular invariant. Acceptable; we test what Phase 1 wrote.

- [ ] **Step 4: Commit**

```bash
git add src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts \
        src/lib/spec-builder/__tests__/__fixtures__/golden-ai-emission-assembly.json
git commit -m "test(fds-engine): golden AI emission replay — 5 per-assembly cases"
```

---

### Task 5: Rewrite `buildFdsOrchestrationSystemPrompt` — V2 shape

**Files:**
- Modify: `src/lib/spec-builder/fds-prompts.ts`

The per-subsystem prompt is smaller and shares structure with the system-level prompt. Reuse the constants extracted in Task 1.

- [ ] **Step 1: Update the signature**

Current signature (lines 360-368 of `fds-prompts.ts`):

```ts
export function buildFdsOrchestrationSystemPrompt(
  subsystem: SubsystemConfig,
  assemblySummaries: Array<{
    assembly_name: string;
    assembly_id: string;
    sequential_states: Record<string, SequentialStateData>;
  }>,
  sequentialStates: OperatingState[],
): string {
```

Update to V2 types (mirroring Task 2's signature change). Since Task 2 had to introduce a temporary widening to keep the consumer compilable, do the same here:

```ts
export function buildFdsOrchestrationSystemPrompt(
  subsystem: SubsystemConfig,
  assemblySummaries: Array<{
    assembly_name: string;
    assembly_id: string;
    sequential_states: Record<string, SequentialStateV2>;
  }>,
  sequentialStates: OperatingStateV2[] | import("@/types/spec-builder").OperatingState[],   // TEMPORARY — Task 10 narrows
): string {
```

Add the V2 type imports if not already present (Task 2 added `SequentialStateV2` and `OperatingStateV2`; reuse those).

Add an import for the extracted constants:

```ts
import {
  INTERLOCK_EFFECTS_DOC,
  COMPLETION_CRITERION_DOC,
} from "./system-orchestration-prompts";
```

- [ ] **Step 2: Update the state-name lookup**

The current line 372 does `s.state_id === stateId` (string compare). Same change as Task 2 — handle `string | number` `state_id`:

```ts
const assemblySummaryText = assemblySummaries.map((a) => {
  const stateText = Object.entries(a.sequential_states)
    .map(([stateId, data]) => {
      const matched = (sequentialStates as Array<{ state_id: string | number; state_name?: string; display_name?: string }>)
        .find((s) => String(s.state_id) === stateId);
      const stateName = matched?.display_name ?? matched?.state_name ?? stateId;
      return `    ${stateName}: ${data.steps.length} step(s), ${data.permissives.length} permissive(s)`;
    }).join("\n");
  return `  ${a.assembly_name} (${a.assembly_id}):\n${stateText}`;
}).join("\n");
```

The SEQUENTIAL STATES table at line 388 also needs updating to surface numeric ids:

```ts
const sequentialStatesTable = (sequentialStates as Array<{ state_id: string | number; state_name?: string; display_name?: string; description?: string }>)
  .map((s) => `  - ${s.state_id}  (${s.display_name ?? s.state_name ?? String(s.state_id)})${s.description ? ` — ${s.description}` : ""}`)
  .join("\n");
```

And replace `${sequentialStates.map((s) => s.state_name).join(", ")}` in the prompt body (line 388) with the multi-line table.

- [ ] **Step 3: Replace the RESPONSE FORMAT block**

Current lines 395-414 (the V1 RESPONSE FORMAT + JSON example for the per-subsystem prompt). Replace with V2:

```ts
${INTERLOCK_EFFECTS_DOC}

SHARED PERMISSIVE SHAPE:
Each shared_permissive is a structured object:
{
  "permissive_id": "<stable slug, e.g. SP_ESTOP_OK>",
  "condition": <CompletionCriterion — see below>,
  "source_subsystem": "<optional subsystem_id that owns the signal>",
  "prose": "<one-line natural language>"
}

${COMPLETION_CRITERION_DOC}

RESPONSE FORMAT:
When you propose orchestration for a state, include a fenced JSON block at the END of your message. The state_id is a NUMBER from the SEQUENTIAL STATES list above. assembly_order, source_assembly, and target_assembly must be assembly_ids from this subsystem.

\`\`\`json
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
\`\`\`

Required fields per interlock: interlock_id (stable slug), source_assembly, source_condition (CompletionCriterion), target_assembly, effect (from the closed set above), prose (one-line natural language for DOCX rendering). effect_target is REQUIRED when effect is "block_transition" or "trigger"; optional otherwise.

Only include a JSON block when you have a concrete update to persist. When asking clarifying questions, omit it. Keep prose concise — the engineer is a peer.
```

- [ ] **Step 4: tsc check**

```bash
npx tsc -b
```

Expected: 0 errors (temporary union on `sequentialStates` keeps the consumer happy; Task 10 narrows it).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/fds-prompts.ts
git commit -m "feat(fds-engine): buildFdsOrchestrationSystemPrompt — emit V2 (numeric state_id, structured InterAssemblyInterlock, SharedPermissive)"
```

---

### Task 6: Snapshot test for per-subsystem prompt + `catodo-subsystem.json` fixture

**Files:**
- Create: `src/lib/spec-builder/__tests__/__fixtures__/catodo-subsystem.json`
- Modify: `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`

- [ ] **Step 1: Build the fixture**

Create `src/lib/spec-builder/__tests__/__fixtures__/catodo-subsystem.json`:

```json
{
  "subsystem": {
    "subsystem_id": "00000000-0000-4000-8000-000000000b01",
    "subsystem_name": "Catodo Lift Station",
    "equipment_type": "lift",
    "assemblies": [
      { "assembly_id": "00000000-0000-4000-8000-000000000a01", "assembly_name": "LFT01" },
      { "assembly_id": "00000000-0000-4000-8000-000000000a02", "assembly_name": "CV01" }
    ]
  },
  "assemblySummaries": [
    {
      "assembly_name": "LFT01",
      "assembly_id": "00000000-0000-4000-8000-000000000a01",
      "sequential_states": {
        "6": { "permissives": [], "steps": [{ "step_id": "lft01_execute_step_10", "branch_id": "main", "actions": [], "monitors": [], "transitions": [] }], "notes": null }
      }
    },
    {
      "assembly_name": "CV01",
      "assembly_id": "00000000-0000-4000-8000-000000000a02",
      "sequential_states": {
        "6": { "permissives": [], "steps": [], "notes": null }
      }
    }
  ],
  "sequentialStates": [
    { "state_id": 3, "packml_id": 3, "display_name": "Starting", "description": "Bring assemblies online", "state_pattern": "sequential" },
    { "state_id": 6, "packml_id": 6, "display_name": "Execute", "description": "Running", "state_pattern": "sequential" }
  ]
}
```

- [ ] **Step 2: Append the snapshot tests**

Append to `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`:

```ts
import { buildFdsOrchestrationSystemPrompt } from "../fds-prompts";
import catodoSubsystem from "./__fixtures__/catodo-subsystem.json";

describe("buildFdsOrchestrationSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo subsystem", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoSubsystem.subsystem as never,
      catodoSubsystem.assemblySummaries as never,
      catodoSubsystem.sequentialStates as never,
    );
    expect(prompt).toMatchSnapshot();
  });

  it("inlines the shared closed-effect documentation", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoSubsystem.subsystem as never,
      catodoSubsystem.assemblySummaries as never,
      catodoSubsystem.sequentialStates as never,
    );
    for (const effect of ["hold", "block_transition", "trigger", "enable", "disable"]) {
      expect(prompt).toContain(`"${effect}"`);
    }
  });

  it("renders the V2 RESPONSE FORMAT example", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoSubsystem.subsystem as never,
      catodoSubsystem.assemblySummaries as never,
      catodoSubsystem.sequentialStates as never,
    );
    expect(prompt).toContain('"interlock_id"');
    expect(prompt).toContain('"effect_target"');
    expect(prompt).toContain('"prose"');
    expect(prompt).toContain('"kind": "tag_equals"');
  });
});
```

- [ ] **Step 3: Run + verify snapshot**

```bash
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
```

Expected: PASS — 8 prior tests + 3 new = 11 total. Inspect the new snapshot block in `__snapshots__/fds-prompts-v2.test.ts.snap`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts \
        src/lib/spec-builder/__tests__/__fixtures__/catodo-subsystem.json \
        src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap
git commit -m "test(fds-engine): snapshot + content tests for V2 per-subsystem prompt"
```

---

### Task 7: Golden-output replay tests for per-subsystem emissions

**Files:**
- Create: `src/lib/spec-builder/__tests__/__fixtures__/golden-ai-emission-orchestration.json`
- Modify: `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`

Three representative AI responses per spec §6.3.

- [ ] **Step 1: Build the fixture**

Create `src/lib/spec-builder/__tests__/__fixtures__/golden-ai-emission-orchestration.json`:

```json
{
  "responses": [
    {
      "name": "two assemblies, one shared permissive, one hold interlock",
      "expectedStateId": 6,
      "rawText": "Here's the Execute orchestration:\n\n```json\n{\n  \"state_id\": 6,\n  \"assembly_order\": [\"00000000-0000-4000-8000-000000000a01\", \"00000000-0000-4000-8000-000000000a02\"],\n  \"shared_permissives\": [\n    { \"permissive_id\": \"SP_ESTOP_OK\", \"condition\": { \"kind\": \"tag_equals\", \"tag\": \"SYS_ESTOP01\", \"value\": true }, \"prose\": \"E-stop circuit healthy\" }\n  ],\n  \"inter_assembly_interlocks\": [\n    { \"interlock_id\": \"IL_LFT01_FAULT_HOLDS_CV01\", \"source_assembly\": \"00000000-0000-4000-8000-000000000a01\", \"source_condition\": { \"kind\": \"tag_equals\", \"tag\": \"LFT01_FAULT\", \"value\": true }, \"target_assembly\": \"00000000-0000-4000-8000-000000000a02\", \"effect\": \"hold\", \"prose\": \"CV01 holds while LFT01 is faulted\" }\n  ],\n  \"notes\": null\n}\n```"
    },
    {
      "name": "three assemblies, two interlocks (block_transition + enable)",
      "expectedStateId": 6,
      "rawText": "Orchestration for Execute with three assemblies:\n\n```json\n{\n  \"state_id\": 6,\n  \"assembly_order\": [\"00000000-0000-4000-8000-000000000a01\", \"00000000-0000-4000-8000-000000000a02\", \"00000000-0000-4000-8000-000000000a03\"],\n  \"shared_permissives\": [],\n  \"inter_assembly_interlocks\": [\n    { \"interlock_id\": \"IL_LFT01_BLOCKS_CV01_START\", \"source_assembly\": \"00000000-0000-4000-8000-000000000a01\", \"source_condition\": { \"kind\": \"tag_equals\", \"tag\": \"LFT01_RUNNING\", \"value\": false }, \"target_assembly\": \"00000000-0000-4000-8000-000000000a02\", \"effect\": \"block_transition\", \"effect_target\": { \"assembly\": \"00000000-0000-4000-8000-000000000a02\", \"state_id\": 6 }, \"prose\": \"CV01 cannot enter Execute until LFT01 is running\" },\n    { \"interlock_id\": \"IL_CV01_ENABLES_CV02\", \"source_assembly\": \"00000000-0000-4000-8000-000000000a02\", \"source_condition\": { \"kind\": \"tag_equals\", \"tag\": \"CV01_RUNNING\", \"value\": true }, \"target_assembly\": \"00000000-0000-4000-8000-000000000a03\", \"effect\": \"enable\", \"prose\": \"CV02 enabled when CV01 is running\" }\n  ],\n  \"notes\": null\n}\n```"
    },
    {
      "name": "single assembly orchestration — degenerate but legal",
      "expectedStateId": 6,
      "rawText": "Trivial: one assembly, no coordination needed.\n\n```json\n{\n  \"state_id\": 6,\n  \"assembly_order\": [\"00000000-0000-4000-8000-000000000a01\"],\n  \"shared_permissives\": [],\n  \"inter_assembly_interlocks\": [],\n  \"notes\": null\n}\n```"
    }
  ]
}
```

- [ ] **Step 2: Append the golden-replay tests**

Append to `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`:

```ts
import goldenOrch from "./__fixtures__/golden-ai-emission-orchestration.json";
import type { SubsystemStateSequence } from "@/types/spec-contract-v2";

describe("golden AI emission — per-subsystem orchestration", () => {
  const SUB_ID = "00000000-0000-4000-8000-000000000b01";

  it.each(goldenOrch.responses)(
    "response '$name' parses + validates",
    ({ rawText, expectedStateId }) => {
      const extracted = extractJsonFromResponse(rawText) as unknown as Record<string, unknown> | null;
      expect(extracted).not.toBeNull();
      expect(extracted).toMatchObject({ state_id: expectedStateId });

      // Build the subsystem-orchestration patch the wizard would assemble.
      const sequence: SubsystemStateSequence = {
        assembly_order: extracted!.assembly_order as string[],
        shared_permissives: (extracted!.shared_permissives ?? []) as never,
        inter_assembly_interlocks: (extracted!.inter_assembly_interlocks ?? []) as never,
        notes: (extracted!.notes ?? null) as string | null,
      };

      const issues = validateSpecContractPatch({
        orchestrations: {
          [SUB_ID]: { [String(expectedStateId)]: sequence } as never,
        },
      });

      expect(issues).toEqual([]);
    },
  );
});
```

- [ ] **Step 3: Run + verify**

```bash
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
```

Expected: PASS — 11 prior + 3 new = 14 total.

- [ ] **Step 4: Commit**

```bash
git add src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts \
        src/lib/spec-builder/__tests__/__fixtures__/golden-ai-emission-orchestration.json
git commit -m "test(fds-engine): golden AI emission replay — 3 per-subsystem cases"
```

---

### Task 8: Add `onValidationFailure` system-turn helper

**Files:**
- Create: `src/lib/spec-builder/validation-failure-turn.ts`
- Create: `src/lib/spec-builder/__tests__/validation-failure-turn.test.ts`

Small pure helper that builds the system-role message text from a list of validation issues. Both conversation hooks (`use-fds-conversation`, `use-fds-orchestration-conversation`) call it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/validation-failure-turn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildValidationFailureTurn } from "../validation-failure-turn";

describe("buildValidationFailureTurn", () => {
  it("returns a system-role turn with the issue list", () => {
    const turn = buildValidationFailureTurn({
      stateLabel: "Execute (state_id 6)",
      issues: ["override_kind is required", "next_step_id step_25 unknown"],
    });
    expect(turn.role).toBe("system");
    expect(turn.content).toContain("Execute (state_id 6)");
    expect(turn.content).toContain("override_kind is required");
    expect(turn.content).toContain("next_step_id step_25 unknown");
    expect(turn.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records state_context for filtering / lookup", () => {
    const turn = buildValidationFailureTurn({
      stateLabel: "Execute (state_id 6)",
      stateContext: "6",
      issues: ["x"],
    });
    expect(turn.state_context).toBe("6");
  });

  it("renders the partial-merge guidance line", () => {
    const turn = buildValidationFailureTurn({
      stateLabel: "Execute (state_id 6)",
      issues: ["x"],
    });
    expect(turn.content).toMatch(/other state updates.*merged successfully/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/validation-failure-turn.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/spec-builder/validation-failure-turn.ts`:

```ts
import type { FdsConversationTurn } from "@/types/spec-contract-v2";

interface BuildArgs {
  stateLabel: string;          // human-readable state name (e.g. "Execute (state_id 6)")
  issues: string[];            // raw validator issue strings
  stateContext?: string;       // optional state_id for downstream filtering
}

/**
 * Builds a system-role turn announcing a validator-gate rejection. The
 * conversation hooks (use-fds-conversation, use-fds-orchestration-conversation)
 * append this to the same `conversation` JSONB array that holds user and
 * assistant turns. Valid blocks from the same response still merge — the
 * partial-merge guidance line tells the engineer not to worry about the
 * other states.
 *
 * FdsConversationTurnSchema.role already accepts "system" (verified before
 * Phase 3 plan-write); no schema widening needed.
 */
export function buildValidationFailureTurn({
  stateLabel,
  issues,
  stateContext,
}: BuildArgs): FdsConversationTurn {
  const issueLines = issues.map((i) => `  - ${i}`).join("\n");
  const content =
    `⚠ The AI's proposed update to ${stateLabel} was rejected:\n` +
    `${issueLines}\n\n` +
    `The other state updates in this turn merged successfully. Ask the AI to retry just this state, or correct it by hand.`;
  return {
    role: "system",
    content,
    timestamp: new Date().toISOString(),
    state_context: stateContext,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/__tests__/validation-failure-turn.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/validation-failure-turn.ts \
        src/lib/spec-builder/__tests__/validation-failure-turn.test.ts
git commit -m "feat(fds-engine): buildValidationFailureTurn — system-role turn for validator-gate rejections"
```

---

### Task 9: Wire validator gate into `use-fds-conversation.ts`

**Files:**
- Modify: `src/hooks/use-fds-conversation.ts`

Adds the `validateSpecContractPatch` gate in `processAiResponse`, persists the system-role turn on failure, and tightens the prompt-builder caller to pass V2 types (narrowing the temporary union from Task 2).

- [ ] **Step 1: Update imports**

Current imports include `OperatingState` from `@/types/spec-builder`. Update to:

```ts
import type {
  AssemblyConfig,
  SubsystemConfig,
  InstrumentTag,
  FdsAssemblySession,
} from "@/types/spec-builder";
import type {
  FdsConversationTurn,
  OperatingStateV2,
  PermissiveCondition,
  SequentialStateV2,
} from "@/types/spec-contract-v2";
import { validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { buildValidationFailureTurn } from "@/lib/spec-builder/validation-failure-turn";
```

Note: `FdsConversationTurn` moves from `@/types/spec-builder` to `@/types/spec-contract-v2` (it's defined there per Phase 1). Verify with `grep -n "FdsConversationTurn" src/types/spec-builder.ts src/types/spec-contract-v2.ts` — if `spec-builder.ts` re-exports it from `spec-contract-v2`, keep the existing import. If it's a separate definition, the V2 one is canonical (Phase 1 widened the role enum to include `"system"` there).

- [ ] **Step 2: Update the `UseFdsConversationOptions` interface**

```ts
interface UseFdsConversationOptions {
  session: FdsAssemblySession;
  assembly: AssemblyConfig;
  subsystem: SubsystemConfig;
  allTags: InstrumentTag[];
  allStates: OperatingStateV2[];        // was OperatingState[]
}
```

- [ ] **Step 3: Update `buildSystemPrompt` (drop the shim cast)**

Current implementation (lines 58-66) has a "shim cast" for `session.sequential_states`. With Task 2's signature change, the cast on `session.sequential_states` may still be needed if `FdsAssemblySession.sequential_states` is typed as legacy `Record<string, SequentialStateData>`; check `src/types/spec-builder.ts`:

```bash
grep -n "sequential_states" src/types/spec-builder.ts
```

If the session type uses `SequentialStateV2` already, drop the cast. If not, keep the cast (the prompt-builder signature requires `SequentialStateV2`). Document the cast with a one-line comment referencing the type mismatch.

```ts
const buildSystemPrompt = useCallback(() => {
  return buildFdsInterviewSystemPrompt(
    assembly, subsystem, allTags,
    session.static_states,
    // session.sequential_states is typed as legacy SequentialStateData in
    // spec-builder.ts but the runtime shape is SequentialStateV2 (ensureV2
    // ran at write time). Phase 7 will narrow the session type.
    session.sequential_states as unknown as Record<string, SequentialStateV2>,
    allStates,
  );
}, [assembly, subsystem, allTags, session.static_states, session.sequential_states, allStates]);
```

- [ ] **Step 4: Add the validator gate in `processAiResponse`**

Replace the current `processAiResponse` (lines 120-144) with:

```ts
const processAiResponse = useCallback(
  (fullText: string): {
    updates: Array<{ state_id: string; data: SequentialStateV2 }>;
    failures: Array<{ state_id: string; issues: string[]; stateLabel: string }>;
  } => {
    const extracted = extractJsonFromResponse(fullText) as unknown as Array<Record<string, unknown>> | null;
    if (!extracted || extracted.length === 0) {
      return { updates: [], failures: [] };
    }

    const updates: Array<{ state_id: string; data: SequentialStateV2 }> = [];
    const failures: Array<{ state_id: string; issues: string[]; stateLabel: string }> = [];

    for (const block of extracted) {
      const rawStateId = block.state_id;
      const stateId = resolveStateId(typeof rawStateId === "number" ? String(rawStateId) : (rawStateId as string | undefined));
      if (!stateId) continue;

      const existing = session.sequential_states[stateId] ?? { permissives: [], steps: [], notes: null };
      const merged: SequentialStateV2 = {
        ...existing,
        override_kind: (block.override_kind as SequentialStateV2["override_kind"]) ?? existing.override_kind ?? "override",
        permissives: (block.permissives as PermissiveCondition[]) ?? existing.permissives,
        steps: (block.steps as SequentialStateV2["steps"]) ?? existing.steps,
        notes: (block.notes as string | null) ?? existing.notes,
      };
      const v2 = ensureV2(merged, stateId);

      // Phase 3 — hard validator gate. Build a per-state assembly patch
      // and check it. Any issues abort just this block; valid blocks in
      // the same response still merge.
      const patch = {
        assemblies: {
          [assembly.assembly_id]: {
            assembly_id: assembly.assembly_id,
            subsystem_id: subsystem.subsystem_id,
            static_states: session.static_states,
            sequential_states: {
              ...session.sequential_states,
              [stateId]: v2,
            },
          },
        },
      };
      const issues = validateSpecContractPatch(patch as never);
      if (issues.length > 0) {
        const matched = allStates.find((s) => String(s.state_id) === stateId);
        const stateLabel = matched
          ? `${matched.display_name ?? matched.state_name ?? matched.custom_name ?? stateId} (state_id ${stateId})`
          : `state_id ${stateId}`;
        failures.push({ state_id: stateId, issues, stateLabel });
        continue;
      }

      updates.push({ state_id: stateId, data: v2 });
    }

    return { updates, failures };
  },
  [resolveStateId, session.sequential_states, session.static_states, assembly.assembly_id, subsystem.subsystem_id, allStates],
);
```

- [ ] **Step 5: Update the `sendMessage` call site to handle failures**

In `sendMessage` (around lines 193-217), the current code does `const tableUpdates = processAiResponse(fullText);`. Update to destructure the new return:

```ts
const { updates: tableUpdates, failures } = processAiResponse(fullText);
const proseContent = stripJsonFromResponse(fullText);

const assistantTurn: FdsConversationTurn = {
  role: "assistant",
  content: proseContent,
  timestamp: new Date().toISOString(),
  table_delta: tableUpdates[0]?.data,
};

const failureTurns = failures.map((f) =>
  buildValidationFailureTurn({
    stateLabel: f.stateLabel,
    issues: f.issues,
    stateContext: f.state_id,
  }),
);

// Append assistant turn + any failure turns (failures come after the
// assistant message so the engineer sees the AI's prose first, then the
// validator's complaint).
const conversationWithBoth = [...conversationWithUser, assistantTurn, ...failureTurns];
const update: Record<string, unknown> = { conversation: conversationWithBoth };
if (tableUpdates.length > 0) {
  const existing = { ...session.sequential_states };
  for (const { state_id, data } of tableUpdates) {
    existing[state_id] = data;
  }
  update.sequential_states = existing;
  if (session.status === "static_confirmed") update.status = "in_progress";
}
await supabase
  .from("fds_assembly_sessions")
  .update(update)
  .eq("id", session.id);
queryClient.invalidateQueries({ queryKey: ["fds_assembly_sessions"] });
```

- [ ] **Step 6: Update consumers of `useFdsConversation`**

The route that invokes `useFdsConversation` currently passes `OperatingState[]`. Find it:

```bash
grep -rn "useFdsConversation\b" src/routes/ src/components/ 2>&1 | head
```

The caller is likely `src/routes/spec-co-author.tsx` or a child component. Pass `OperatingStateV2[]` instead. If the source data is the spec contract (from `useSpecContract`), `contract.states` is already `OperatingStateV2[]`. If it's the legacy `OperatingState[]` projection, use the existing `migrateOperatingStates` helper from `@/types/spec-builder` to convert:

```ts
import { migrateOperatingStates } from "@/types/spec-builder";
// ...
const allStates = useMemo(() => migrateOperatingStates(spec.confirmed_states ?? []), [spec.confirmed_states]);
```

If `migrateOperatingStates` doesn't produce a `OperatingStateV2[]` shape (it returns the legacy type), cast at the call site with a one-line comment:

```ts
allStates={allStates as unknown as OperatingStateV2[]}
```

The end goal is V2-typed; the cast is a temporary bridge if the helper hasn't been migrated yet.

- [ ] **Step 7: tsc check**

```bash
npx tsc -b
```

Expected: 0 errors. If errors remain about the prompt builder's `sequentialStates` parameter, narrow the union in `fds-prompts.ts` (drop the `| OperatingState[]` part Task 2 added) — Task 9 is the right time for that, since the consumer is now V2-typed.

Actually, **as part of this task, narrow `buildFdsInterviewSystemPrompt`'s signature** by removing the temporary union and the temporary cast inside:

```ts
export function buildFdsInterviewSystemPrompt(
  assembly: AssemblyConfig,
  subsystem: SubsystemConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, DeviceStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateV2>,
  allStates: OperatingStateV2[],          // narrowed; Task 2's temporary union removed
): string {
```

Remove the comment that said "TEMPORARY — Task 9 narrows".

Re-run `npx tsc -b`. Expected: 0 errors (the consumer now passes V2 types).

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-fds-conversation.ts src/lib/spec-builder/fds-prompts.ts src/routes/spec-co-author.tsx
# Stage other consumers if the grep in Step 6 turned up more files
git commit -m "feat(fds-engine): validator gate in use-fds-conversation; narrow prompt-builder signature to V2"
```

---

### Task 10: Wire validator gate into `use-fds-orchestration-conversation.ts`

**Files:**
- Modify: `src/hooks/use-fds-orchestration-conversation.ts`

Mirror of Task 9 for the per-subsystem orchestration hook.

- [ ] **Step 1: Update imports + interface**

Replace the legacy type imports with V2 types and add the validator + helper imports:

```ts
import type {
  SubsystemConfig,
  FdsAssemblySession,
  SubsystemOrchestration,
} from "@/types/spec-builder";
import type {
  FdsConversationTurn,
  InterAssemblyInterlock,
  OperatingStateV2,
  SharedPermissive,
  SubsystemStateSequence,
} from "@/types/spec-contract-v2";
import { validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { buildValidationFailureTurn } from "@/lib/spec-builder/validation-failure-turn";
```

Update `UseFdsOrchestrationConversationOptions`:

```ts
interface UseFdsOrchestrationConversationOptions {
  specProjectId: string;
  subsystem: SubsystemConfig;
  sessions: FdsAssemblySession[];
  orchestration: SubsystemOrchestration | null;
  allStates: OperatingStateV2[];        // was OperatingState[]
}
```

- [ ] **Step 2: Drop the shim cast in `buildSystemPrompt`**

Current implementation (lines 69-80) has a "shim cast" for `assemblySummaries`. With Task 5's V2 signature narrowed in Task 10, drop the cast:

```ts
const buildSystemPrompt = useCallback(() => {
  return buildFdsOrchestrationSystemPrompt(
    subsystem,
    assemblySummaries,           // already V2-shaped since sessions.sequential_states is SequentialStateV2
    sequentialStates,
  );
}, [subsystem, assemblySummaries, sequentialStates]);
```

If `assemblySummaries` actually carries legacy-shaped data (verify by reading `FdsAssemblySession.sequential_states` type in `spec-builder.ts`), keep the cast and document why with a one-line comment. Same pattern as Task 9 Step 3.

- [ ] **Step 3: Add the validator gate in `processAiResponse`**

Replace the current `processAiResponse` (lines 123-156) with:

```ts
const processAiResponse = useCallback(
  (fullText: string): {
    updates: Array<{ state_id: string; sequence: SubsystemStateSequence }>;
    failures: Array<{ state_id: string; issues: string[]; stateLabel: string }>;
  } => {
    const extracted = extractJsonFromResponse(fullText) as unknown as Record<string, unknown> | null;
    if (!extracted) {
      return { updates: [], failures: [] };
    }

    const updates: Array<{ state_id: string; sequence: SubsystemStateSequence }> = [];
    const failures: Array<{ state_id: string; issues: string[]; stateLabel: string }> = [];

    // The system-orchestration prompt emits a single object per turn (not an
    // array). Wrap it in an array uniformly for the loop below.
    const blocks = Array.isArray(extracted) ? extracted : [extracted];

    for (const block of blocks) {
      const rawStateId = block.state_id;
      const stateId = resolveStateId(
        typeof rawStateId === "number" ? String(rawStateId) : (rawStateId as string | undefined),
      );
      if (!stateId) continue;

      const existing = orchestration?.state_sequences[stateId] ?? {
        assembly_order: [],
        shared_permissives: [],
        inter_assembly_interlocks: [],
        notes: null,
      };

      const sequence: SubsystemStateSequence = {
        assembly_order: (block.assembly_order as string[]) ?? existing.assembly_order,
        shared_permissives:
          (block.shared_permissives as SharedPermissive[]) ?? existing.shared_permissives,
        inter_assembly_interlocks:
          (block.inter_assembly_interlocks as InterAssemblyInterlock[]) ?? existing.inter_assembly_interlocks,
        notes: (block.notes as string | null) ?? existing.notes,
      };

      // Phase 3 — hard validator gate.
      const patch = {
        orchestrations: {
          [subsystem.subsystem_id]: {
            ...(orchestration?.state_sequences ?? {}),
            [stateId]: sequence,
          },
        },
      };
      const issues = validateSpecContractPatch(patch as never);
      if (issues.length > 0) {
        const matched = allStates.find((s) => String(s.state_id) === stateId);
        const stateLabel = matched
          ? `${matched.display_name ?? matched.state_name ?? matched.custom_name ?? stateId} (state_id ${stateId})`
          : `state_id ${stateId}`;
        failures.push({ state_id: stateId, issues, stateLabel });
        continue;
      }

      updates.push({ state_id: stateId, sequence });
    }

    return { updates, failures };
  },
  [resolveStateId, orchestration, subsystem.subsystem_id, allStates],
);
```

- [ ] **Step 4: Update the `sendMessage` call site**

Find where `processAiResponse` is currently called inside `sendMessage` (around lines 200-230 of the existing file). Apply the same destructure-and-append pattern as Task 9 Step 5:

```ts
const { updates: stateUpdates, failures } = processAiResponse(fullText);
const proseContent = stripJsonFromResponse(fullText);

const assistantTurn: FdsConversationTurn = {
  role: "assistant",
  content: proseContent,
  timestamp: new Date().toISOString(),
};

const failureTurns = failures.map((f) =>
  buildValidationFailureTurn({
    stateLabel: f.stateLabel,
    issues: f.issues,
    stateContext: f.state_id,
  }),
);

const newConversation = [...conversation, userTurn, assistantTurn, ...failureTurns];

const existing = { ...(orchestration?.state_sequences ?? {}) };
for (const { state_id, sequence } of stateUpdates) {
  existing[state_id] = sequence;
}

await supabase
  .from("fds_subsystem_orchestrations")
  .upsert(
    {
      spec_project_id: specProjectId,
      subsystem_id: subsystem.subsystem_id,
      state_sequences: existing,
      conversation: newConversation,
    },
    { onConflict: "spec_project_id,subsystem_id" },
  );

queryClient.invalidateQueries({ queryKey: ["fds_subsystem_orchestrations"] });
```

(The exact placement depends on how `sendMessage` is structured today — match the existing pattern; just swap the single-update path for the structured `updates + failures` path.)

- [ ] **Step 5: Update consumers**

```bash
grep -rn "useFdsOrchestrationConversation\b" src/routes/ src/components/ 2>&1 | head
```

Pass `OperatingStateV2[]` to the hook (mirror Task 9 Step 6).

- [ ] **Step 6: Narrow `buildFdsOrchestrationSystemPrompt` signature**

Drop the temporary union from Task 5:

```ts
export function buildFdsOrchestrationSystemPrompt(
  subsystem: SubsystemConfig,
  assemblySummaries: Array<{
    assembly_name: string;
    assembly_id: string;
    sequential_states: Record<string, SequentialStateV2>;
  }>,
  sequentialStates: OperatingStateV2[],          // narrowed; Task 5's temporary union removed
): string {
```

- [ ] **Step 7: tsc check**

```bash
npx tsc -b
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-fds-orchestration-conversation.ts src/lib/spec-builder/fds-prompts.ts
# Stage other consumers if grep in Step 5 turned up more files
git commit -m "feat(fds-engine): validator gate in use-fds-orchestration-conversation; narrow prompt-builder signature to V2"
```

---

### Task 11: Validator-gate failure tests — `use-fds-conversation.test.tsx`

**Files:**
- Create: `src/hooks/__tests__/use-fds-conversation.test.tsx`

Hook-level integration tests asserting the validator-gate behavior. Mock `streamFromEdgeFunction` to return a controlled AI response; mock Supabase; assert the right rows / system turns land.

- [ ] **Step 1: Write the failing test file**

Create `src/hooks/__tests__/use-fds-conversation.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// --- Mocks --------------------------------------------------------

const updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: () => {
          updateCalls.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  },
}));

const streamMock = vi.fn();

vi.mock("@/hooks/use-generation", () => ({
  streamFromEdgeFunction: (...args: unknown[]) => streamMock(...args),
}));

// --- Imports under test ------------------------------------------

import { useFdsConversation } from "../use-fds-conversation";
import type { OperatingStateV2 } from "@/types/spec-contract-v2";

// --- Fixtures ----------------------------------------------------

const ASSEMBLY_ID = "00000000-0000-4000-8000-000000000a01";
const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000b01";
const SESSION_ID = "00000000-0000-4000-8000-000000000s01";

const baseSession = {
  id: SESSION_ID,
  spec_project_id: "00000000-0000-4000-8000-000000000001",
  assembly_id: ASSEMBLY_ID,
  subsystem_id: SUBSYSTEM_ID,
  status: "static_confirmed",
  static_states: {},
  sequential_states: {},
  conversation: [],
} as never;

const baseAssembly = {
  assembly_id: ASSEMBLY_ID,
  assembly_name: "LFT01",
  devices: [
    {
      device_id: "d1",
      device_name: "Pump M01",
      device_class: "motor",
      is_safety: false,
      io_signals: [
        { tag: "LFT01_M01_CMD", signal_type: "DO" },
        { tag: "LFT01_M01_FB", signal_type: "DI" },
      ],
    },
  ],
} as never;

const baseSubsystem = {
  subsystem_id: SUBSYSTEM_ID,
  subsystem_name: "Catodo",
  equipment_type: "lift",
} as never;

const baseTags = [
  { tag: "LFT01_M01_CMD", description: "Pump cmd", signal_direction: "DO" },
  { tag: "LFT01_M01_FB", description: "Pump fb", signal_direction: "DI" },
] as never;

const baseStates: OperatingStateV2[] = [
  { state_id: 6, packml_id: 6, display_name: "Execute", description: "Running", state_pattern: "sequential" },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// --- Tests -------------------------------------------------------

describe("useFdsConversation validator gate", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    streamMock.mockReset();
  });

  it("merges a valid V2 emission and does NOT post a failure turn", async () => {
    const validResponse = `Here's Execute:

\`\`\`json
[
  {
    "state_id": 6,
    "override_kind": "override",
    "permissives": [],
    "steps": [
      {
        "step_id": "lft01_execute_step_10",
        "branch_id": "main",
        "actions": [],
        "monitors": [],
        "transitions": [
          { "transition_id": "lft01_execute_step_10_terminal", "guard": [ { "kind": "tag_equals", "tag": "LFT01_M01_FB", "value": true, "within_ms": 3000, "on_fail": { "fault_code": "F_X", "severity": "fault" } } ], "next_step_id": null }
        ]
      }
    ],
    "notes": null
  }
]
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(validResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: baseSession,
          assembly: baseAssembly,
          subsystem: baseSubsystem,
          allTags: baseTags,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me Execute");
    });

    // Last update should include the new sequential_states row.
    const final = updateCalls[updateCalls.length - 1];
    expect(final.payload.sequential_states).toBeDefined();
    expect((final.payload.sequential_states as Record<string, unknown>)["6"]).toBeDefined();

    // No system-role turn in any persisted conversation snapshot.
    const conversations = updateCalls
      .map((c) => c.payload.conversation as Array<{ role: string }> | undefined)
      .filter((c): c is Array<{ role: string }> => !!c);
    const sawSystemTurn = conversations.some((conv) => conv.some((t) => t.role === "system"));
    expect(sawSystemTurn).toBe(false);
  });

  it("rejects an invalid V2 emission and posts a system-role failure turn", async () => {
    // Invalid: override_kind missing and state_id is an out-of-range number.
    const invalidResponse = `Here's a broken Execute:

\`\`\`json
[
  {
    "state_id": 50,
    "permissives": [],
    "steps": [],
    "notes": null
  }
]
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(invalidResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsConversation({
          session: baseSession,
          assembly: baseAssembly,
          subsystem: baseSubsystem,
          allTags: baseTags,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me");
    });

    const final = updateCalls[updateCalls.length - 1];
    // No sequential_states update (block rejected).
    expect(final.payload.sequential_states).toBeUndefined();

    // System-role turn appended to the conversation.
    const conv = final.payload.conversation as Array<{ role: string; content: string }>;
    const sysTurn = conv.find((t) => t.role === "system");
    expect(sysTurn).toBeDefined();
    expect(sysTurn!.content).toMatch(/rejected/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails first, then passes**

```bash
npx vitest run src/hooks/__tests__/use-fds-conversation.test.tsx
```

Expected on first run: both tests should already PASS because Task 9's wiring is in place. If they fail, debug:

- "module not found" → confirm imports match what `use-fds-conversation.ts` actually exports.
- "no sequential_states update on the valid case" → the validator may be rejecting the seemingly-valid fixture. Add a `console.log(issues)` temporarily and adjust the fixture.
- "no system turn on invalid case" → Task 9's failure-turn append didn't fire. Re-check Step 5 of Task 9.

Iterate until both PASS.

- [ ] **Step 3: Full sweep**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: 33 baseline failures, no new ones; 2 new tests from this file PASS (total grows by 2).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/__tests__/use-fds-conversation.test.tsx
git commit -m "test(fds-engine): validator-gate failure path for use-fds-conversation"
```

---

### Task 12: Validator-gate failure tests — `use-fds-orchestration-conversation.test.tsx`

**Files:**
- Create: `src/hooks/__tests__/use-fds-orchestration-conversation.test.tsx`

Mirror of Task 11 for the per-subsystem hook.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/use-fds-orchestration-conversation.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const upsertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>) => {
        upsertCalls.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

const streamMock = vi.fn();

vi.mock("@/hooks/use-generation", () => ({
  streamFromEdgeFunction: (...args: unknown[]) => streamMock(...args),
}));

import { useFdsOrchestrationConversation } from "../use-fds-orchestration-conversation";
import type { OperatingStateV2 } from "@/types/spec-contract-v2";

const SPEC_ID = "00000000-0000-4000-8000-000000000001";
const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000b01";
const ASM1 = "00000000-0000-4000-8000-000000000a01";
const ASM2 = "00000000-0000-4000-8000-000000000a02";

const baseSubsystem = {
  subsystem_id: SUBSYSTEM_ID,
  subsystem_name: "Catodo",
  equipment_type: "lift",
  assemblies: [
    { assembly_id: ASM1, assembly_name: "LFT01" },
    { assembly_id: ASM2, assembly_name: "CV01" },
  ],
} as never;

const baseSessions = [
  { assembly_id: ASM1, status: "complete", sequential_states: { "6": { permissives: [], steps: [], notes: null } } },
  { assembly_id: ASM2, status: "complete", sequential_states: { "6": { permissives: [], steps: [], notes: null } } },
] as never;

const baseStates: OperatingStateV2[] = [
  { state_id: 6, packml_id: 6, display_name: "Execute", description: "Running", state_pattern: "sequential" },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("useFdsOrchestrationConversation validator gate", () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    streamMock.mockReset();
  });

  it("merges a valid V2 orchestration emission", async () => {
    const validResponse = `Here's Execute orchestration:

\`\`\`json
{
  "state_id": 6,
  "assembly_order": ["${ASM1}", "${ASM2}"],
  "shared_permissives": [],
  "inter_assembly_interlocks": [
    { "interlock_id": "IL_X", "source_assembly": "${ASM1}", "source_condition": { "kind": "tag_equals", "tag": "LFT01_RUNNING", "value": true }, "target_assembly": "${ASM2}", "effect": "enable", "prose": "x" }
  ],
  "notes": null
}
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(validResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsOrchestrationConversation({
          specProjectId: SPEC_ID,
          subsystem: baseSubsystem,
          sessions: baseSessions,
          orchestration: null,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me");
    });

    const final = upsertCalls[upsertCalls.length - 1];
    const stateSequences = final.payload.state_sequences as Record<string, unknown>;
    expect(stateSequences["6"]).toBeDefined();

    const conv = final.payload.conversation as Array<{ role: string }>;
    expect(conv.every((t) => t.role !== "system")).toBe(true);
  });

  it("rejects an invalid orchestration emission and posts a system-role turn", async () => {
    // Invalid: effect is not in the closed enum.
    const invalidResponse = `Bad orchestration:

\`\`\`json
{
  "state_id": 6,
  "assembly_order": ["${ASM1}"],
  "shared_permissives": [],
  "inter_assembly_interlocks": [
    { "interlock_id": "IL_X", "source_assembly": "${ASM1}", "source_condition": { "kind": "tag_equals", "tag": "X", "value": true }, "target_assembly": "${ASM2}", "effect": "fly_to_the_moon", "prose": "x" }
  ],
  "notes": null
}
\`\`\``;

    streamMock.mockImplementation(async (_body, _signal, onChunk) => {
      onChunk(invalidResponse);
    });

    const { result } = renderHook(
      () =>
        useFdsOrchestrationConversation({
          specProjectId: SPEC_ID,
          subsystem: baseSubsystem,
          sessions: baseSessions,
          orchestration: null,
          allStates: baseStates,
        }),
      { wrapper: ({ children }) => wrap(children) },
    );

    await act(async () => {
      await result.current.sendMessage("Tell me");
    });

    const final = upsertCalls[upsertCalls.length - 1];
    const stateSequences = final.payload.state_sequences as Record<string, unknown>;
    expect(stateSequences["6"]).toBeUndefined();

    const conv = final.payload.conversation as Array<{ role: string; content: string }>;
    const sysTurn = conv.find((t) => t.role === "system");
    expect(sysTurn).toBeDefined();
    expect(sysTurn!.content).toMatch(/rejected/i);
  });
});
```

- [ ] **Step 2: Run test**

```bash
npx vitest run src/hooks/__tests__/use-fds-orchestration-conversation.test.tsx
```

Expected: 2/2 PASS. If failures occur, debug as in Task 11 Step 2.

- [ ] **Step 3: Full sweep**

```bash
npm test -- --run 2>&1 | tail -5
```

Expected: 33 baseline failures, no new ones.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/__tests__/use-fds-orchestration-conversation.test.tsx
git commit -m "test(fds-engine): validator-gate failure path for use-fds-orchestration-conversation"
```

---

### Task 13: Verify no other callers broken by signature changes

**Files:** none (verification only)

The prompt-builder signature changes from Tasks 2 + 5 + 9 + 10 may have broken other callers. Phase 3 plan pre-verified only `use-fds-conversation.ts` and `use-fds-orchestration-conversation.ts` import the builders, but a fresh grep confirms nothing else was missed.

- [ ] **Step 1: Grep for all callers**

```bash
grep -rn "buildFdsInterviewSystemPrompt\|buildFdsOrchestrationSystemPrompt" src/ 2>&1
```

Expected callers:
- `src/lib/spec-builder/fds-prompts.ts` (definitions)
- `src/lib/spec-builder/fds-prompts_archive.ts` (archive copy of the old prompts — don't touch)
- `src/hooks/use-fds-conversation.ts` (Task 9 fixed)
- `src/hooks/use-fds-orchestration-conversation.ts` (Task 10 fixed)

Anything else is a leak that the plan didn't anticipate. If you find one, fix the caller in this task (mirror Task 9/10's caller-update pattern).

- [ ] **Step 2: tsc + full sweep**

```bash
npx tsc -b
npm test -- --run 2>&1 | tail -5
```

Expected: 0 tsc errors; 33 baseline failures, no new ones.

- [ ] **Step 3: Commit (only if Step 1 found extra callers)**

If Step 1 found no leaks, skip the commit step — this task is verification-only and produces no diff.

If a leak was found and fixed:

```bash
git add <files updated>
git commit -m "fix(fds-engine): update remaining prompt-builder caller to V2 types"
```

---

### Task 14: Final sweep — tsc + tests + build + design-doc status note

**Files:** none for verification + `Docs/superpowers/specs/2026-05-25-fds-engine-design.md`

- [ ] **Step 1: Full type check**

```bash
npx tsc -b
```

Expected: 0 errors.

- [ ] **Step 2: Full test suite**

```bash
npm test -- --run 2>&1 | tail -10
```

Expected: 33 pre-existing unrelated failures (the baseline). Phase 3's tests should add roughly 22-26 new passing tests:
- Task 1: 3 (system-orchestration-prompts.test.ts)
- Task 3: 3 (snapshot + content)
- Task 4: 5 (golden assembly)
- Task 6: 3 (orchestration snapshot + content)
- Task 7: 3 (golden orchestration)
- Task 8: 3 (validation-failure-turn)
- Task 11: 2 (use-fds-conversation gate)
- Task 12: 2 (use-fds-orchestration-conversation gate)
- **Total: 24 new passing tests** (Phase 2 baseline 190 → expect ~214).

Calculate (passed_after − 190) and report it.

- [ ] **Step 3: Production build**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 4: Lint sweep**

```bash
npm run lint 2>&1 | tail -5
```

Expected: pre-existing problem count may shift slightly (the new test files are new code that gets linted), but **zero new `no-restricted-imports` violations from Phase 1's forge boundary rule** (Phase 3 touches no forge files).

- [ ] **Step 5: Update the design-doc status line**

In `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` §6, find the existing Phase 2 status line:

```
**Release N+1 Phase 2 status: complete as of 2026-05-25. Migration wizard + per-project confirmation flow (route, banner, 3 tabs, AI interlock classifier, telemetry). Phases 3-7 pending.**
```

Append a Phase 3 line below it:

```
**Release N+1 Phase 3 status: complete as of 2026-05-25. V2 interview prompt rewrite (per-assembly + per-subsystem); hard validateSpecContractPatch gate at merge with system-role failure turns; ensureV2() kept as defensive tolerance layer. Phases 4-7 pending.**
```

Use today's date (2026-05-25 or whatever the current date is when this task runs).

- [ ] **Step 6: Commit**

```bash
git add Docs/superpowers/specs/2026-05-25-fds-engine-design.md
git commit -m "docs(fds-engine): mark Phase 3 (V2 interview prompt rewrite) complete"
```

- [ ] **Step 7: Manual smoke (pre-merge, before PR)**

Not a plan-task per se, but the spec calls for a manual smoke against the live AI before merge. Recommended flow:

1. Apply migration 088 + 089 to a development Supabase if not already done.
2. Open the spec builder on a confirmed project (cvl-2129 or catodo) in the dev environment.
3. Start a co-author session for one assembly.
4. Verify the AI returns V2-shaped JSON (open the dev tools / network panel; look for `override_kind: "override"`, numeric `state_id`, `kind: "tag_equals"` etc.).
5. Force an intentional error (ask the AI to use state_id `"running"` — a string). Verify a system-role turn appears in the chat with the validator's complaint.
6. Repeat for the per-subsystem orchestration interview.

Document the smoke result in the PR description, not in this plan.

---

## Phase 3 Done

After Task 14:
- The co-author emits V2 JSON on every turn for confirmed projects.
- The merge path runs through `validateSpecContractPatch`; per-block rejections surface as system-role messages without blocking other valid blocks.
- `ensureV2()` continues as a defensive tolerance layer (Phase 7 marks it `@deprecated`).
- 24+ new tests gate the prompt shape and the validator-gate behavior; regressions surface as snapshot diffs or golden-replay failures in CI.
- Shared documentation (closed-set effects, `CompletionCriterion` kinds) is DRY across system-level and subsystem-level orchestration prompts.

**No production project has had a V2 co-author turn yet** until the manual smoke runs against the live AI. After smoke, open a new PR off master with the squashed branch.

**Coordinated next steps** (not in this plan):
- Migration 088 + 089 application to remote Supabase (deferred from Phases 1 + 2).
- First production co-author session against a confirmed project.

**Phase 4+ per parent design §6:**
- Phase 4 — Monitor picker UI
- Phase 5 — Materialised `spec_sections` rebuild + editor refactor through `writeSpecContract`
- Phase 6 — Modes wizard step + per-mode matrix tabs (where `override_kind: "inherit"` / `"suppressed"` become authoring affordances; co-author prompt gains mode-awareness)
- Phase 7 — ISA-88 docs / terminology pass + mark `ensureV2()` `@deprecated`

Plus the deferred Italian translation table (8466 Norte/Sur stays unconfirmed) and the two Phase 2.5 deferrals (write-disabling inside child components, conversation-archive schema decision) — all still pending.
