# SP-3b Stage A PackML Reframe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-EM co-author's Stage A author the fixed PackML lifecycle (not free EM-local slugs) and hard-block non-conformant machines at persist, so C5's Case A state-coverage check becomes non-vacuous.

**Architecture:** Two isolated changes. (1) Reframe `buildEmStateMachineInterviewPrompt` to inject the fixed 17-state PackML menu (from `PACKML_STATES`), invert the "manual motions are static states" guidance, and use PackML-slug examples. (2) Add a pure composition helper `validateEmStateMachineAndPackml` (structural + PackML conformance) and call it from the Stage-A persist path `handleStateMachineResponse`, replacing the lone structural gate. The gate is wired into the Stage-A path ONLY — never `validateSpecContractPatch` — so existing free-slug specs' Stage B keeps working.

**Tech Stack:** TypeScript 5.9 strict (`import type`, no enums, `noUnusedLocals`), React 19, Vitest. `@/` = `src/`.

**Spec:** `Docs/superpowers/specs/2026-07-01-sp3b-stage-a-packml-reframe-design.md`

**Non-goals (fenced):** Stage B `command_behavior` authoring (SP-3c), codegen (SP-4), Segment Wagon re-author (SP-3d), wiring conformance into `validateSpecContractPatch`/Stage B, hard Zod rejection, any UI, separate `ai/PACKML_STATE_MODEL.md` doc.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/spec-builder/em-state-machine-prompts.ts` | **Modify.** Inject the fixed PackML menu (from `PACKML_STATES`), reframe the task to "select which PackML states this EM implements", invert manual-motion guidance, PackML-slug example + HARD RULES, reworded opening. | 1 |
| `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts` | **Modify.** Add assertions locking the PackML reframe (menu present, manual-motion rule, old free-slug examples absent, opening reframed). | 1 |
| `src/lib/spec-builder/em-state-machine.ts` | **Modify.** Add pure `validateEmStateMachineAndPackml(em)` composing the structural + PackML validators (structural issues first). | 2 |
| `src/lib/spec-builder/__tests__/em-state-machine.test.ts` | **Modify.** Append tests for the composition helper (canonical → [], non-PackML surfaced, structural-before-conformance ordering). | 2 |
| `src/hooks/use-fds-conversation.ts` | **Modify.** In `handleStateMachineResponse`, call `validateEmStateMachineAndPackml` instead of `validateEmStateMachine`; update the import. | 2 |

**Task independence:** Tasks 1 and 2 touch disjoint files and have no code dependency on each other (the prompt does not import the validator; the validator does not import the prompt). They may be implemented in either order or in parallel. No `blockedBy` relationship.

---

### Task 1: Reframe Stage A prompt to the fixed PackML vocabulary

**Goal:** `buildEmStateMachineInterviewPrompt` / `buildEmStateMachineOpeningMessage` instruct the model to author the module's machine using PackML slugs only, model manual motions as Execute-phase behaviour (not states), and mark `aborted` as the single safe state.

**Files:**
- Modify: `src/lib/spec-builder/em-state-machine-prompts.ts`
- Test: `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts`

**Acceptance Criteria:**
- [ ] Prompt contains a `PACKML STATE VOCABULARY` section listing PackML slugs generated from `PACKML_STATES` (includes `stopped`, `idle`, `execute`, `aborting`, `aborted`).
- [ ] Prompt states the safe state must be `aborted` and that `state_id` must be a PackML slug.
- [ ] Prompt contains a `MANUAL / COMMAND-DRIVEN MOTIONS ARE NOT STATES` section deferring motions to Stage B.
- [ ] Prompt no longer contains the old free-slug example tokens `driving_fwd`, `auto_cycle`, or `faulted`.
- [ ] Opening message (no source sections) references PackML states and `aborted`, not "manually driving".
- [ ] Existing assertions in the test file still pass (EM identity, modes, IO, `is_safe_state`, `allowed_modes`, `transitions`, command/completion trigger, source sections).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts` → all pass. Then `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts` (the fixtures `em`, `unit`, `modes` and the import of `buildEmStateMachineInterviewPrompt` already exist at the top of the file). Also add `buildEmStateMachineOpeningMessage` to the import on line 2:

```ts
import {
  buildEmStateMachineInterviewPrompt,
  buildEmStateMachineOpeningMessage,
} from "@/lib/spec-builder/em-state-machine-prompts";
```

Then append these describe blocks:

```ts
describe("buildEmStateMachineInterviewPrompt — PackML reframe (SP-3b)", () => {
  it("injects the fixed PackML state vocabulary", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toContain("PACKML STATE VOCABULARY");
    for (const slug of ["stopped", "idle", "execute", "aborting", "aborted"]) {
      expect(p).toContain(slug);
    }
  });

  it("mandates PackML slugs and the aborted safe state", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toMatch(/PackML slug/i);
    expect(p).toMatch(/"aborted"/);
    expect(p).toMatch(/aborted/);
  });

  it("models manual motions as Execute-phase behaviour, not states", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toContain("MANUAL / COMMAND-DRIVEN MOTIONS ARE NOT STATES");
    expect(p).toMatch(/execute/i);
  });

  it("drops the old free-slug examples", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).not.toContain("driving_fwd");
    expect(p).not.toContain("auto_cycle");
    expect(p).not.toContain("faulted");
  });
});

describe("buildEmStateMachineOpeningMessage — PackML reframe (SP-3b)", () => {
  it("frames the opening around PackML lifecycle states", () => {
    const msg = buildEmStateMachineOpeningMessage(em, []);
    expect(msg).toMatch(/PackML/);
    expect(msg).toContain("aborted");
    expect(msg).not.toContain("manually driving");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts`
Expected: FAIL — the new blocks fail (`PACKML STATE VOCABULARY` absent, `driving_fwd` still present, etc.). The existing three tests still pass.

- [ ] **Step 3: Rewrite the prompt builder.** Replace the ENTIRE contents of `src/lib/spec-builder/em-state-machine-prompts.ts` with:

```ts
/**
 * Stage A of the per-EM co-author interview (hybrid state model): author
 * the equipment module's OWN state machine using the FIXED PackML vocabulary —
 * which of the 17 PackML states this EM implements, their mode gating, and the
 * transitions between them — BEFORE the per-state behaviour interview (Stage B,
 * fds-prompts.ts).
 *
 * SP-3b reframe: state_id values are PackML slugs (packml-states.ts), NOT
 * invented EM-local slugs. Manual/command-driven motions (Drive Fwd/Rev) are
 * behaviour performed while in "execute" and are captured in Stage B as
 * command_behavior — they are NOT states here.
 */
import type {
  EquipmentModuleConfig,
  UnitConfig,
} from "@/types/spec-builder";
import type { OperatorMode } from "@/types/spec-contract-v2";
import { PACKML_STATES } from "./packml-states";
import type { SourceSection } from "./source-section-select";

export function buildEmStateMachineInterviewPrompt(
  equipmentModule: EquipmentModuleConfig,
  unit: UnitConfig,
  modes: OperatorMode[],
  sourceSections: SourceSection[] = [],
): string {
  const deviceList = equipmentModule.control_modules
    .map((d) => {
      const sigs = d.io_signals.map((s) => `${s.tag} (${s.signal_type})`).join(", ");
      return `  - ${d.control_module_name} (${d.control_module_class}${d.is_safety ? ", SAFETY" : ""}): ${sigs}`;
    })
    .join("\n");

  const modeList = modes
    .map((m) => `  - ${m.mode_id} (${m.name}${m.is_default ? ", default" : ""})`)
    .join("\n");

  // The fixed PackML vocabulary — generated from the canonical data so it can
  // never drift from defaultEmStates() / the FB-side declaration (SP-2).
  const packmlMenu = PACKML_STATES
    .map((s) => `  - ${s.slug} (${s.name}) — ${s.state_pattern}`)
    .join("\n");

  const grounded = sourceSections.length > 0;

  const sourceContext = !grounded
    ? ""
    : `\n## Customer Specification Context\nTreat the following as the source of intent for this equipment module's behavior.\n\n` +
      sourceSections.map((s) => `### ${s.heading || "(untitled)"}\n${s.body}`).join("\n\n") +
      "\n";

  // Ground-then-refine: when the module has bound customer-spec requirements,
  // the model drafts its understanding FIRST and then refines, instead of
  // interrogating the engineer cold. With no bound context it falls back to the
  // cold field-by-field interview.
  const taskFraming = grounded
    ? `The Customer Specification Context above is the source of truth for how this module behaves. Work in two phases:

PHASE 1 — GROUND (your FIRST reply): Read the spec and PROPOSE which of the PackML states below this module implements, plus the transitions between them. In concise prose, list the states you selected (PackML slug + why the spec calls for it), the mode gating, and the key transitions, citing the spec text that justifies each. Where the spec is silent on a required field, state your assumption explicitly and tag it "(assumption — confirm)". End PHASE 1 with the JSON block for your full draft, followed by a short bullet list of the specific points you most need the engineer to confirm or correct.

PHASE 2 — REFINE (every reply after the engineer responds): Ask ONE focused confirming or refining question per turn, anchored to your current draft. Only ask about points the spec left open or that the engineer flagged — do NOT re-interrogate fields the spec already answered. Re-emit the updated JSON block whenever an answer changes the machine.`
    : `Interview the engineer to determine which PackML states below this module implements and the transitions between them. One question per turn.`;

  return `You are a senior automation engineer co-authoring the STATE MACHINE for Equipment Module "${equipmentModule.equipment_module_name}" (equipment_module_id: "${equipmentModule.equipment_module_id}") within unit "${unit.unit_name}" (unit_id: "${unit.unit_id}").

Per ISA-88, the state machine belongs to the EQUIPMENT MODULE. Every EM implements the standard PackML state machine (ISA-TR88.00.02). This module runs INDEPENDENTLY of other modules — do not assume the whole machine moves in lockstep.

# IMMUTABLE IDENTIFIERS (echo verbatim)
- equipment_module_id: ${equipmentModule.equipment_module_id}
- unit_id: ${unit.unit_id}
${sourceContext}
# MACHINE MODES (states are gated by these; states have NO modes of their own)
${modeList}

# THIS MODULE'S DEVICES + IO
${deviceList}

# PACKML STATE VOCABULARY (fixed — choose state_id ONLY from these slugs)
Every EM state is a PackML state. Select the subset this module actually implements
(a lean module may implement only a few, e.g. stopped / idle / execute / aborted).
Never invent a slug and never rename these.
${packmlMenu}

# YOUR TASK
${taskFraming}

# WHAT A COMPLETE STATE MACHINE MUST SPECIFY (both phases)
1. The list of states. Each state_id MUST be a PackML slug from the vocabulary above; use its canonical name and kind. For each state also give allowed_modes (which machine modes the state is valid in — empty means all modes) and whether it is the single safe state (is_safe_state). The safe state is ALWAYS "aborted".
2. The transitions. For each: from_state_id, to_state_id (both PackML slugs), a trigger (either {kind:"command", expr: <permissive on an operator/HMI tag>} for a commanded transition, or {kind:"completion"} when a sequential state finishes), and an optional permissive guard (array of {tag, operator, value}); a guard may reference OTHER modules' tags for inter-module interlocks.
   - A command trigger's \`expr\` is a SINGLE condition {tag, operator, value} — never an array, never an OR-group, never a \`trigger_logic\` field.
   - To express "ANY OF these faults → aborting" (the universal fault fan-in), emit ONE separate transition per fault tag: same from_state_id/to_state_id/guard, each with its own single-condition trigger and a unique transition_id (e.g. "<from>_to_aborting__cm1_fault", "<from>_to_aborting__cm2_therm"). The parallel transitions together ARE the OR.

# MANUAL / COMMAND-DRIVEN MOTIONS ARE NOT STATES
Motions an operator commands (e.g. "Drive Forward", "Jog Reverse") are BEHAVIOUR performed while the module is in the "execute" state, driven by command inputs — they are NOT states. Do NOT create a state for a motion. Model the module as being in "execute" while it runs; the specific commanded motions are captured later, in the behaviour interview (Stage B). This module's lifecycle is the PackML states only.

# HARD RULES
- Every state_id is a PackML slug from the vocabulary above. Never invent or rename a slug.
- EXACTLY ONE state has is_safe_state = true, and it MUST be "aborted" (the PackML fault-landing state a safety gate forces this module into).
- allowed_modes gates a state to specific machine modes (empty = all modes).
- kind comes from the vocabulary: static = a waiting/held state; sequential = an acting state that runs to completion.

# RESPONSE FORMAT
When you have a concrete proposal, end your message with ONE fenced JSON block holding { "states": EmStateV2[], "transitions": EmTransitionV2[] }:

\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "idle", "name": "Idle", "kind": "static", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "execute", "name": "Execute", "kind": "sequential", "allowed_modes": ["auto"], "is_safe_state": false },
    { "state_id": "aborting", "name": "Aborting", "kind": "sequential", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "aborted", "name": "Aborted", "kind": "static", "allowed_modes": [], "is_safe_state": true }
  ],
  "transitions": [
    {
      "transition_id": "idle_to_execute",
      "from_state_id": "idle",
      "to_state_id": "execute",
      "trigger": { "kind": "command", "expr": { "tag": "CAR_CMD_START", "operator": "=", "value": true } },
      "guard": [ { "tag": "CAR_READY", "operator": "=", "value": true } ]
    },
    {
      "transition_id": "execute_done",
      "from_state_id": "execute",
      "to_state_id": "idle",
      "trigger": { "kind": "completion" },
      "guard": []
    },
    {
      "transition_id": "execute_to_aborting__vsd1_trip",
      "from_state_id": "execute",
      "to_state_id": "aborting",
      "trigger": { "kind": "command", "expr": { "tag": "VSD1_CB_Trip", "operator": "=", "value": true } },
      "guard": []
    },
    {
      "transition_id": "execute_to_aborting__cm1_therm",
      "from_state_id": "execute",
      "to_state_id": "aborting",
      "trigger": { "kind": "command", "expr": { "tag": "CM1_Therm", "operator": "=", "value": true } },
      "guard": []
    },
    {
      "transition_id": "aborting_to_aborted",
      "from_state_id": "aborting",
      "to_state_id": "aborted",
      "trigger": { "kind": "completion" },
      "guard": []
    }
  ]
}
\`\`\`

(The two \`*_to_aborting__*\` transitions above show the fault fan-in: ONE single-condition transition per fault tag — together they mean "VSD1_CB_Trip OR CM1_Therm → aborting". Never collapse them into an array expr. Faults land in "aborting", which completes to the "aborted" safe state.)

Only include a JSON block when you have an update to persist. Keep prose concise — the engineer is an expert.`;
}

export function buildEmStateMachineOpeningMessage(
  equipmentModule: EquipmentModuleConfig,
  sourceSections: SourceSection[] = [],
): string {
  if (sourceSections.length > 0) {
    return `Generate the opening message for the state-machine interview of equipment module "${equipmentModule.equipment_module_name}". The customer specification context for this module is in your system prompt. Execute PHASE 1 (GROUND): read it, then PROPOSE which PackML states this module implements and the transitions between them (marking "aborted" as the safe state), citing the spec, flagging any gaps as assumptions, and ending with the JSON block plus the specific points you need the engineer to confirm. Lead with your proposal; do NOT ask a cold open-ended question.`;
  }
  return `Generate the opening message for the state-machine interview of equipment module "${equipmentModule.equipment_module_name}". Ask, in 2-3 sentences ending with a clear question, which PackML lifecycle states this module needs (e.g. stopped, idle, execute, aborted) and confirm that "aborted" is its safe state.`;
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts`
Expected: PASS (existing 3 + new 5). Then `npx tsc -b` → clean.

- [ ] **Step 5: Generic self-check (CLAUDE.md).** This is a `*-prompt*.ts` file. Re-read "All Changes Must Be Generic": the prompt contains only the abstract PackML vocabulary + generic lifecycle/fault-fan-in guidance; the example tags (`CAR_CMD_START`, `VSD1_CB_Trip`) are illustrative, not project-specific logic, and the same prompt serves a conveyor, filler, or stamping cell unchanged. Confirm no device names from `Docs/Functional Specs/` leaked in.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/spec-builder/em-state-machine-prompts.ts src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts
git commit -m "feat(spec-builder): reframe Stage A co-author to PackML vocabulary (SP-3b)"
```

---

### Task 2: Compose + wire the PackML conformance gate into Stage A persist

**Goal:** Add a pure `validateEmStateMachineAndPackml(em)` that runs the structural validator then the PackML conformance validator, and call it from `handleStateMachineResponse` so a non-PackML / non-`aborted`-safe Stage A proposal is blocked with a validation-failure turn instead of persisted.

**Files:**
- Modify: `src/lib/spec-builder/em-state-machine.ts` (add the helper; `validateEmStateMachine` and `validateEmPackmlConformance` already exist and stay untouched)
- Test: `src/lib/spec-builder/__tests__/em-state-machine.test.ts` (append helper tests)
- Modify: `src/hooks/use-fds-conversation.ts` (`handleStateMachineResponse` + import)

**Acceptance Criteria:**
- [ ] `validateEmStateMachineAndPackml(em)` returns `[]` for a machine seeded from `defaultEmStates()` and for an empty skeleton.
- [ ] It surfaces a non-PackML slug (`driving_fwd`) as a conformance issue.
- [ ] When a machine is BOTH structurally broken (transition to unknown state) AND non-conformant, structural issues are listed before conformance issues.
- [ ] `handleStateMachineResponse` calls `validateEmStateMachineAndPackml` (not `validateEmStateMachine`); a proposal with a non-PackML slug produces a failure turn and does not persist `em_states`.
- [ ] `validateEmStateMachine` and `validateEmPackmlConformance` remain exported and independently tested (their existing tests still pass).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → all pass. Then `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `src/lib/spec-builder/__tests__/em-state-machine.test.ts`. First add `validateEmStateMachineAndPackml` to the existing import block from `@/lib/spec-builder/em-state-machine` (lines 2–9). `em`, `defaultEmStates`, `EmStateV2` are already imported. Then append:

```ts
describe("validateEmStateMachineAndPackml", () => {
  it("returns [] for a canonical PackML machine", () => {
    expect(validateEmStateMachineAndPackml(em("cm", { states: defaultEmStates() }))).toEqual([]);
  });

  it("returns [] for an empty skeleton", () => {
    expect(validateEmStateMachineAndPackml(em("empty"))).toEqual([]);
  });

  it("surfaces a non-PackML slug as a conformance issue", () => {
    const states: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const issues = validateEmStateMachineAndPackml(em("a", { states }));
    expect(issues.some((i) => i.includes('non-PackML state_id "driving_fwd"'))).toBe(true);
  });

  it("lists structural issues before conformance issues", () => {
    const states: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const bad = em("b", {
      states,
      transitions: [
        { transition_id: "t1", from_state_id: "driving_fwd", to_state_id: "ghost",
          trigger: { kind: "completion" }, guard: [] },
      ],
    });
    const issues = validateEmStateMachineAndPackml(bad);
    const structuralIdx = issues.findIndex((i) => /unknown.*ghost/.test(i));
    const conformanceIdx = issues.findIndex((i) => /non-PackML/.test(i));
    expect(structuralIdx).toBeGreaterThanOrEqual(0);
    expect(conformanceIdx).toBeGreaterThanOrEqual(0);
    expect(structuralIdx).toBeLessThan(conformanceIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts`
Expected: FAIL — `validateEmStateMachineAndPackml` is not exported. Existing tests still pass.

- [ ] **Step 3: Add the composition helper.** In `src/lib/spec-builder/em-state-machine.ts`, immediately AFTER the `validateEmPackmlConformance` function (which currently ends at line 134, before the `// =====… Stage-A proposal parsing` banner), add:

```ts
/**
 * Full Stage-A gate for one EM's authored machine: structural invariants
 * (validateEmStateMachine) followed by PackML conformance
 * (validateEmPackmlConformance). Structural issues are listed first so the
 * co-author surfaces shape problems before vocabulary problems. This is the
 * single function the Stage-A persist path (use-fds-conversation.ts) calls;
 * both component validators remain independently exported and tested.
 *
 * SP-3b: this composition is wired into the CO-AUTHOR Stage-A path only, NOT
 * into validateSpecContractPatch — wiring conformance into the global patch
 * validator would re-check already-persisted free-slug states and break the
 * Stage-B path for pre-SP-3b specs (reconciled per-spec in SP-3d).
 */
export function validateEmStateMachineAndPackml(em: EquipmentModuleContract): string[] {
  return [...validateEmStateMachine(em), ...validateEmPackmlConformance(em)];
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts`
Expected: PASS (existing + 4 new). Then `npx tsc -b` → clean.

- [ ] **Step 5: Wire the gate into the hook.** In `src/hooks/use-fds-conversation.ts`:

  (a) Update the import (currently lines 34–38) to add the composed helper:

```ts
import {
  parseStateMachineProposal,
  isLikelyTruncatedProposal,
  validateEmStateMachineAndPackml,
} from "@/lib/spec-builder/em-state-machine";
```

  > Note: `validateEmStateMachine` is currently imported but is ONLY used inside `handleStateMachineResponse` (which this step rewrites to call the composed helper). Removing it from the import avoids a `noUnusedLocals` build error. If any other reference to `validateEmStateMachine` exists in this file, keep it in the import instead.

  (b) In `handleStateMachineResponse`, replace the structural-only validation call (currently lines 316–325):

```ts
      // Validate the proposed machine before persisting. Reuse the structural
      // validator with empty behavior maps (states/transitions only matter here).
      const issues = validateEmStateMachine({
        equipment_module_id: equipment_module.equipment_module_id,
        unit_id: unit.unit_id,
        states: proposal.states,
        transitions: proposal.transitions,
        static_states: {},
        sequential_states: {},
      });
```

  with the composed structural + PackML gate:

```ts
      // Validate the proposed machine before persisting: structural invariants
      // AND PackML conformance (SP-3b). Non-PackML slugs / a non-"aborted" safe
      // state are hard-blocked here so em_states only ever holds PackML slugs —
      // making C5 Case A coverage non-vacuous. Empty behavior maps: only
      // states/transitions matter at this gate.
      const issues = validateEmStateMachineAndPackml({
        equipment_module_id: equipment_module.equipment_module_id,
        unit_id: unit.unit_id,
        states: proposal.states,
        transitions: proposal.transitions,
        static_states: {},
        sequential_states: {},
      });
```

  Leave the rest of `handleStateMachineResponse` (the `if (issues.length > 0)` failure-turn branch and the persist branch) unchanged.

- [ ] **Step 6: Verify build + suites.**

Run:
```bash
npx tsc -b
npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts
```
Expected: `tsc -b` clean (confirms the import swap left no unused local and no type error); both suites green.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/spec-builder/em-state-machine.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts src/hooks/use-fds-conversation.ts
git commit -m "feat(spec-builder): hard-block non-PackML Stage A machines at persist (SP-3b)"
```

---

## Self-Review

**Spec coverage:**
- §1 prompt reframe — PackML menu injection → Task 1 Step 3 (`packmlMenu` + `PACKML STATE VOCABULARY` section). ✓
- §1 task reframe (select subset, ground-then-refine kept) → Task 1 Step 3 (`taskFraming`). ✓
- §1 invert manual-motion guidance → Task 1 Step 3 (`MANUAL / COMMAND-DRIVEN MOTIONS ARE NOT STATES` section; old `driving_fwd` static example removed). ✓
- §1 PackML-slug example + HARD RULES + fault fan-in preserved (now → `aborting`) → Task 1 Step 3. ✓
- §1 opening reworded → Task 1 Step 3 (`buildEmStateMachineOpeningMessage`). ✓
- §2 composed validator, structural-first → Task 2 Steps 3 (`validateEmStateMachineAndPackml`). ✓
- §2 wired into `handleStateMachineResponse` only, not `validateSpecContractPatch` → Task 2 Step 5. ✓
- §2 import update / `noUnusedLocals` safety → Task 2 Step 5(a). ✓
- Testing (prompt content; gate composition incl. canonical-empty-nonPackML-ordering) → Task 1 Step 1, Task 2 Step 1. ✓
- Non-goals (no Stage B / codegen / UI / `validateSpecContractPatch` / Zod rejection / doc) → nothing in either task touches them. ✓

**Placeholder scan:** No TBD/TODO; every code + test block is complete and concrete; exact file paths, line ranges, and commands given. ✓

**Type consistency:** `validateEmStateMachineAndPackml(em: EquipmentModuleContract): string[]` — signature identical in definition (Task 2 Step 3) and call site (Task 2 Step 5b, which passes the same `{equipment_module_id, unit_id, states, transitions, static_states, sequential_states}` shape the old `validateEmStateMachine` call used). Test transition literal `{ transition_id, from_state_id, to_state_id, trigger: { kind: "completion" }, guard: [] }` matches the existing file's usage at lines 118–119 (no `as const` needed — contextually typed via the `Partial<EquipmentModuleContract>` override). `EmStateV2` fields (`state_id, name, kind, allowed_modes, is_safe_state`) consistent with existing fixtures. `PACKML_STATES` element fields used (`slug`, `name`, `state_pattern`) match `packml-states.ts`. ✓

**Known caveat carried from spec:** the hook's runtime persist path is not mounted in tests (would need Supabase + streaming mocks); the gate is verified at the pure-composition level (`validateEmStateMachineAndPackml`) plus `tsc` confirming the wiring compiles. Accepted per the spec's testing section.
