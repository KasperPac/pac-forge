# Design: SP-3b — Stage A PackML Reframe + Conformance Enforcement

**Date:** 2026-07-01
**Status:** Design approved — ready for implementation plan
**Scope:** The Stage A slice of SP-3 ("PackML everywhere"). Reframes the per-EM co-author's Stage A interview to author the **fixed PackML lifecycle** instead of inventing free EM-local slugs, and wires the SP-3a `validateEmPackmlConformance` validator in as a **hard-block gate** at Stage A persist. **No Stage B, codegen, or UI changes.**

## Why

SP-1/SP-2 made the FB side declare the fixed PackML state vocabulary, and SP-3a gave the FDS contract the ability to *hold* the PackML model (the `command_behavior` construct, `defaultEmStates()`, and the standalone-but-unwired `validateEmPackmlConformance`). But coverage (C5's Case A) stays vacuous because Stage A still authors free-form EM-local slugs (`driving_fwd`) and models manual motions as first-class `static` states.

The agreed model (see `Docs/superpowers/specs/2026-07-01-packml-em-state-foundation-design.md` and `2026-07-01-sp3a-packml-em-schema-design.md`):

- EM state vocabulary is the **fixed PackML 17-state set** (`packml-states.ts`).
- **Manual motions** (Drive Fwd/Rev) are **command-conditional device holds performed while in `execute`**, not standalone states.

SP-3b makes Stage A emit that vocabulary so the FB-side declaration (SP-2) and the FDS-side authoring finally line up — turning Case A coverage from vacuous to real. It is the slice that ends the "verification is deliberately vacuous" caveat carried since SP-2.

## Decisions (locked during brainstorming)

1. **Manual motions defer to SP-3c.** Stage A authors ONLY the PackML lifecycle (which of the 17 states this EM implements + mode gates + transitions). Manual motions get captured later as `command_behavior` branches under `execute` in SP-3c's Stage B reframe. This keeps SP-3b tight and matches the SP-3a split.
2. **Hard-block enforcement.** `validateEmPackmlConformance` issues become a validation-failure turn that blocks persistence — the same pattern as the existing `validateEmStateMachine` gate. Non-PackML slugs never reach `em_states`, so coverage (Case A) is genuinely non-vacuous.
3. **Inject-as-reference seeding.** The prompt injects the 17 PackML states (from `defaultEmStates()` / `PACKML_STATES`) as the fixed menu; the AI selects the subset this EM implements, sets mode gates + transitions, and emits the proposal. Nothing is pre-persisted, so the existing `emStates.length === 0 ? state_machine : behavior` stage gate is preserved.
4. **Stage-A-only wiring boundary.** The gate wires into `handleStateMachineResponse` (the Stage A persist path) **only** — NOT into `validateSpecContractPatch`, which runs on every Stage B behavior turn and would re-validate already-persisted states and block Stage B for existing free-slug specs.
5. **No separate `ai/PACKML_STATE_MODEL.md` doc.** The PackML vocabulary is inlined into the prompt builder, generated from `PACKML_STATES` — single source of truth, no doc drift. (Confirmed: no such doc ever existed in git history; "restoring" it would be authoring fresh.)

## Non-Goals (this slice)

- **Stage B behavior prompt reframe + `command_behavior` authoring (SP-3c).** Stage A does not capture manual motions this slice; the conformance validator's `command_behavior`-key check stays dormant here (Stage A emits none).
- **Codegen — emitting the command-branched Execute `CASE` (SP-4).**
- **Re-authoring the Segment Wagon spec (SP-3d).** Existing sessions already have free-slug `em_states` persisted; the hard gate only fires on *new/re-authored* Stage A proposals, so existing specs keep working untouched. No migration in this slice.
- **Wiring `validateEmPackmlConformance` into `validateSpecContractPatch` / Stage B.** Deliberately excluded per Decision 4.
- **Any hard Zod rejection of non-PackML slugs** (kept permissive at load; enforcement is at the Stage A co-author gate only).
- **Any UI change.**

---

## 1. Stage A prompt reframe (`src/lib/spec-builder/em-state-machine-prompts.ts`)

`buildEmStateMachineInterviewPrompt` is rewritten so the state vocabulary is fixed, not invented.

### a) Inject the PackML menu

A new section — `# PACKML STATE VOCABULARY (fixed — choose from these only)` — generated from `PACKML_STATES` (imported from `./packml-states`). For each state it renders `slug`, `name`, `kind` (`static`/`sequential`), and a one-line meaning, plus the rule that `aborted` is the mandatory safe state. Because it is generated from the canonical data, it can never drift from `defaultEmStates()`.

### b) Reframe the task

The interview shifts from *"what states can this module be in?"* to *"which PackML states does this EM implement, in which modes, with what transition guards?"*. The **ground-then-refine two-phase framing is kept** (draft from customer spec → refine): it is orthogonal to the vocabulary change and remains valuable. PHASE 1 now proposes *a subset of the PackML states* the module implements (citing the spec), and PHASE 2 refines mode gates / transitions.

### c) Invert the manual-motion instruction

Delete the current guidance that models manual motions as `static` states (the `driving_fwd` example at current lines 71/79/89). Replace with an explicit note:

> Manual / command-driven motions (e.g. "Drive Forward") are **behaviour performed while in `execute`**, driven by command inputs. They are **NOT states** — do not create a state for them. They are captured later in the behaviour interview (Stage B).

### d) Rewrite HARD RULES + example JSON to PackML slugs

- `state_id` must be **one of the 17 PackML slugs**; the single safe state must be `aborted`.
- The example machine uses real PackML slugs (`stopped`, `idle`, `starting`, `execute`, `stopping`, `aborting`, `aborted`, `resetting`, …) instead of `driving_fwd` / `auto_cycle` / `faulted`.
- The **fault fan-in pattern is preserved** — one single-condition transition per fault tag, no OR-array, no `trigger_logic` field (the `expandOrTriggers` safety net in `em-state-machine.ts` is unchanged). Fault transitions now target `aborting` / `aborted`.
- The `allowed_modes` mode-gating semantics are unchanged (empty = all modes).

### e) Opening message

`buildEmStateMachineOpeningMessage` is reworded to ask which PackML lifecycle states this EM needs (grounded phase still proposes a draft from the customer spec), not "what distinct states can it be in."

### Generic-rule compliance

This is a `*-prompt*.ts` file → triggers the CLAUDE.md post-task self-check. All added content is the abstract PackML vocabulary + generic guidance; the example uses no project/device names. Mentally verified against a different machine type (conveyor, filler): the PackML lifecycle + fault-fan-in framing is machine-agnostic.

---

## 2. Validator wiring + persist behavior (`src/hooks/use-fds-conversation.ts`)

The change is localized to `handleStateMachineResponse` (the Stage A persist path). Today it runs a single gate: `validateEmStateMachine(...)`; on issues it emits a `buildValidationFailureTurn` and does not persist; otherwise it persists `em_states` / `em_transitions`.

**Change:** run conformance **alongside** the structural check, combining issues (structural first, then conformance) before the existing gate:

```ts
const em = {
  equipment_module_id: equipment_module.equipment_module_id,
  unit_id: unit.unit_id,
  states: proposal.states,
  transitions: proposal.transitions,
  static_states: {},
  sequential_states: {},
};
const issues = [
  ...validateEmStateMachine(em),
  ...validateEmPackmlConformance(em), // ← SP-3b wires this in (Stage A only)
];
if (issues.length > 0) {
  // existing failure-turn path, unchanged
}
```

**Behavior details:**

- **Ordering:** structural issues first (e.g. "unknown state"), then conformance (e.g. "non-PackML slug"). Both surface in **one** `buildValidationFailureTurn`, so the co-author gets the full picture in a single turn and can ask the AI to re-emit.
- **Empty-skeleton safety:** both validators early-return `[]` on `states.length === 0`, so a prose-only "still gathering" turn never trips the gate (unchanged behavior).
- **Truncation path unchanged:** `parseStateMachineProposal` → `null` → `isLikelyTruncatedProposal` handling is untouched; conformance only runs on a successfully-parsed proposal.
- **No change to `validateSpecContractPatch`, `processAiResponse`, or the Stage B path** — enforcing the Stage-A-only boundary (Decision 4). Existing free-slug specs' Stage B keeps working.
- **Import:** add `validateEmPackmlConformance` to the existing `from "@/lib/spec-builder/em-state-machine"` import (which already imports `validateEmStateMachine`, `parseStateMachineProposal`, `isLikelyTruncatedProposal`).

Note: `use-fds-conversation.ts` does **not** match the pipeline-auditor hook globs (`use-forge-*` / `use-pipeline-*`); only `em-state-machine-prompts.ts` triggers the prompt self-check.

---

## Architecture / data flow

```
packml-states.ts  ──PACKML_STATES / defaultEmStates()──┐
                                                        ▼
em-state-machine-prompts.ts  buildEmStateMachineInterviewPrompt
        └─ injects the fixed 17-state PackML menu; AI proposes a subset
                                                        │
                                                        ▼  { states⊆PackML, transitions }
use-fds-conversation.ts  handleStateMachineResponse (Stage A persist)
        ├─ validateEmStateMachine (structural, unchanged)
        └─ validateEmPackmlConformance (NEW gate — non-PackML slug / non-aborted safe → BLOCK)
                                                        │ valid
                                                        ▼
              fds_operation_sessions.em_states  (PackML slugs)
                                                        │
                                                        ▼
              C5 compile-contract Case A  checkStateCoverage(fdsStates=PackML, contract.states)  → verified
```

## Files

- **Modify:** `src/lib/spec-builder/em-state-machine-prompts.ts` — inject PackML menu, reframe task, invert manual-motion guidance, PackML-slug example + HARD RULES, reworded opening. Import `PACKML_STATES` from `./packml-states`.
- **Modify:** `src/hooks/use-fds-conversation.ts` — add `validateEmPackmlConformance` to the combined Stage A gate in `handleStateMachineResponse` + import.
- **New (or extend):** `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts` — assert the reframed prompt content.
- **No change:** `src/lib/spec-builder/em-state-machine.ts` (`validateEmPackmlConformance` already exists from SP-3a), `packml-states.ts`, `spec-contract-v2.ts`, `contract.ts`, `codegen/*`, migrations.

## Testing

- **Prompt (pure, no `.env.local`):** `buildEmStateMachineInterviewPrompt(...)` output **contains** the PackML menu (asserts `execute`, `aborted`, `stopped` present), states the fixed-vocabulary rule, and instructs manual-motions-are-not-states; and **does not contain** the old free-slug examples (`driving_fwd`, `auto_cycle`, `faulted`). `buildEmStateMachineOpeningMessage(...)` reflects the PackML framing. Generic (no device names). These lock the reframe against regression.
- **Gate composition (pure):** a proposal-shaped `em` object with a `driving_fwd` state yields conformance issues via `validateEmPackmlConformance` (reusing the SP-3a validator), proving the combined-issues contract the hook relies on. The canonical case (states from `defaultEmStates()`) yields `[]`.
- **Hook-level tradeoff (documented):** full behavioral testing of `handleStateMachineResponse` requires Supabase + streaming mocks (heavy; the hook is not currently unit-tested). SP-3b asserts the wiring at the validator-composition level rather than mounting the hook. This is called out in the plan as an accepted limitation.
- **Existing suites stay green:** `em-state-machine.test.ts` (SP-3a validator coverage), `segment-wagon-hybrid.test.ts` and any free-slug fixtures — SP-3b touches neither `validateEmStateMachine` nor `validateSpecContractPatch`, so these are unaffected.
- **Self-check:** `npx tsc -b` clean + prompt suite + `em-state-machine.test.ts` green + generic re-read of the prompt file.

## Generic-rule compliance (CLAUDE.md)

The reframe adds the abstract PackML vocabulary + generic lifecycle guidance; no device/project/machine-type names in the prompt or example. The touched files are one prompt builder and one co-author hook. Post-task self-check: `npx tsc -b` clean + new/existing vitest green + the generic re-read (prompt file).

## Verification

- `npx tsc -b` clean.
- `npx vitest run src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts` green.
- Manual: open a fresh EM co-author → Stage A now proposes PackML-slug states (`execute`, `aborted`, …); attempting a machine with a non-PackML slug or a non-`aborted` safe state produces a validation-failure turn and does not persist.
