# Design: SP-3a — PackML EM-State Schema + Validation Foundation

**Date:** 2026-07-01
**Status:** Design approved — ready for implementation plan
**Scope:** Foundation slice of SP-3 (the "PackML everywhere" Stage A/B reframe). Establishes the contract schema + validation + seed data so the co-author (SP-3b/c), codegen (SP-4), and Segment Wagon re-author (SP-3d) can be built on a stable base. **No prompt, UI, or codegen changes in this slice.**

## Why

SP-1/SP-2 made the FB side declare the fixed PackML state vocabulary, but coverage (Case A) stays vacuous because Stage A still authors free-form EM-local slugs (`driving_fwd`) and models manual motions as first-class `static` states. The agreed model (see `Docs/superpowers/specs/2026-07-01-packml-em-state-foundation-design.md`):

- EM state vocabulary is the **fixed PackML 17-state set** (SP-1's `packml-states.ts`).
- **Manual motions** (Driving Fwd/Rev) are **command-conditional device holds performed while in `execute`**, not standalone states.

Before the co-author can author in that model, the contract must be able to *hold* it. SP-3a adds that capability and the validation that guards it.

## Decisions (locked during brainstorming)

1. Manual motion = **command-conditional device holds within Execute** (not a state, not a direction-param).
2. The holds live in a **new `command_behavior` field** on `EquipmentModuleContract` — NOT overloaded onto `static_states`.
3. PackML-membership validation is a **standalone, not-yet-wired** `validateEmPackmlConformance` (NOT baked into `validateEmStateMachine`, NOT a hard Zod refinement) — so the existing Segment Wagon spec + co-author keep working unchanged; SP-3b wires enforcement in when Stage A emits PackML.
4. The single `is_safe_state` must be the canonical `aborted` (packml_id 9).
5. Random builder's non-canonical `estop` safe slug is reconciled to `aborted` here.

## Non-Goals (this slice)

- Stage A interview prompt reframe (SP-3b) and Stage B behavior prompt reframe (SP-3c).
- Codegen — emitting the command-branched Execute CASE (SP-4).
- Re-authoring the Segment Wagon (SP-3d).
- Any UI. Any hard Zod rejection of non-PackML slugs (kept permissive at load).
- **Wiring `validateEmPackmlConformance` into the co-author / `validateSpecContractPatch`** — deferred to SP-3b (would otherwise flag the co-author before Stage A emits PackML).
- Restoring `ai/PACKML_STATE_MODEL.md` prompt-reference doc (belongs to SP-3b when Stage A needs the vocabulary injected).

---

## 1. New schema: command-conditional Execute behavior (`src/types/spec-contract-v2.ts`)

Reuses the existing `PermissiveConditionSchema` (`{ tag, operator, value }`, the same type transition triggers use) and `ControlModuleStateEntrySchema` (`{ tag, description, state }`, the same device-hold shape `static_states` uses).

```ts
// A device-hold branch active while an operator/EM command condition holds.
// Manual motions (Drive Fwd/Rev) are branches under command_behavior["execute"],
// NOT states — see SP-3 design. Generic across machine types.
export const CommandBranchSchema = z.object({
  branch_id: z.string().min(1),
  label: z.string().min(1),                                 // "Drive Forward"
  when: z.array(PermissiveConditionSchema).min(1),          // AND-ed command condition
  control_modules: z.array(ControlModuleStateEntrySchema),  // holds while `when` is true
});
export type CommandBranch = z.infer<typeof CommandBranchSchema>;

// Command-conditional behavior for one acting PackML state (primarily execute):
// mutually-evaluated command branches + the hold applied when no branch is active.
export const CommandBehaviorV2Schema = z.object({
  branches: z.array(CommandBranchSchema).default([]),
  default_hold: z.array(ControlModuleStateEntrySchema).default([]),
});
export type CommandBehaviorV2 = z.infer<typeof CommandBehaviorV2Schema>;
```

Add to `EquipmentModuleContractSchema`:

```ts
  // Command-conditional device holds for acting PackML states (primarily
  // "execute"). Keyed by EM state_id (a PackML slug). Absent for EMs with no
  // manual motion. Optional so the ~15 existing EquipmentModuleContract
  // construction sites are not forced to add `command_behavior: {}`.
  command_behavior: z.record(z.string(), CommandBehaviorV2Schema).optional(),
```

**`.optional()`, not `.default({})`:** a `.default({})` makes the field *required* in the Zod-inferred output type, which would break every literal `EquipmentModuleContract` construction (~15 sites across random/forge/tests). `.optional()` keeps the same backward-compat (absent → treated as `{}` by consumers via `?? {}`) with zero blast radius on existing code.

## 2. PackML EM-state seed (`src/lib/spec-builder/packml-states.ts`)

Add a helper mirroring `defaultFbStates()` but producing `EmStateV2` (type-only import of `EmStateV2` — no runtime coupling to the Zod module):

```ts
import type { EmStateV2 } from "@/types/spec-contract-v2";

/** The full canonical PackML set as EM state-machine states (Stage A seed). */
export function defaultEmStates(): EmStateV2[] {
  return PACKML_STATES.map((s) => ({
    state_id: s.slug,
    name: s.name,
    kind: s.state_pattern,        // "static" | "sequential" == EmStateKind
    allowed_modes: [],
    is_safe_state: s.is_safe,     // true only on aborted
  }));
}
```

`PackmlState.state_pattern` (`static`/`sequential`) maps 1:1 onto `EmStateV2.kind` (`EmStateKind`). Consumed by SP-3b's Stage A seeding.

## 3. Standalone PackML conformance validator (`src/lib/spec-builder/em-state-machine.ts`)

**Add a NEW function** `validateEmPackmlConformance(em): string[]` — do NOT extend `validateEmStateMachine`, and do NOT wire it into `validateSpecContractPatch` in this slice.

**Why standalone:** `validateEmStateMachine` runs in the live persistence path (`contract.ts` `validateSpecContractPatch`, and `use-fds-conversation.ts` Stage-A persistence). Baking PackML checks into it would flag/break the co-author *before* SP-3b makes Stage A emit PackML slugs, and would break existing tests that assert `validateEmStateMachine(...) === []` on free-slug fixtures (`segment-wagon-hybrid.test.ts`, `em-state-machine.test.ts`) by design. Keeping conformance separate lets SP-3a land non-breaking; **SP-3b wires `validateEmPackmlConformance` into the co-author** exactly where Stage A starts emitting PackML.

The function (pure, guarded by `em.states.length > 0`, returns `[]` for an empty skeleton):

- **PackML membership:** for each `s` in `em.states`, if `!isPackmlSlug(s.state_id)` → `` `${where}: non-PackML state_id "${s.state_id}" (expected a PackML slug)` ``.
- **Canonical safe state:** when exactly one `is_safe_state` exists, it must have `state_id === "aborted"`; else → `` `${where}: safe state must be "aborted", found "${safe.state_id}"` ``.
- **command_behavior keys:** for each key of `em.command_behavior ?? {}`, it must match an existing `state_id` whose `kind === "sequential"` (an acting state); else → `` `${where}: command_behavior for unknown/non-acting state "${key}"` ``.

Imports `isPackmlSlug` from `packml-states.ts`. These are **soft** issues (surfaced, never block Zod parse). `validateEmStateMachine` is left entirely unchanged.

## 4. Random-builder alignment (`src/lib/spec-builder/random/state-machine.ts` + `em-state-machine-builder.ts`)

The random builder's six-state pragmatic subset already uses canonical PackML slugs for five states; only the safe state is non-canonical (`estop`).

- `state-machine.ts`: rename the constant `EM_LOCAL_ESTOP` value from `"estop"` to `"aborted"` (keep the exported symbol name or rename to `EM_LOCAL_ABORTED` — implementation detail; update all references).
- `em-state-machine-builder.ts`: the safe state becomes `{ state_id: "aborted", name: "Aborted", kind: "static", ..., is_safe_state: true }`.
- Grep the repo for stray `"estop"` / `E_STOP` / `"E-Stop"` state references in the random-builder path and reconcile; leave unrelated E-Stop *tag* names (e.g. safety gate conditions referencing an `EStop_Healthy` IO tag) untouched — only the EM **state** slug changes.

`STATE_ID_E_STOP = 9` (the numeric packml_id constant) already equals PackML `aborted`, so it stays.

---

## Architecture / data flow

```
SP-1 packml-states.ts ──PACKML_STATES / isPackmlSlug──┐
   └─ NEW defaultEmStates() ─────────────┐            │
                                         ▼            ▼
SP-3a spec-contract-v2.ts: EquipmentModuleContract
        + command_behavior: Record<slug, CommandBehaviorV2>   ← NEW construct
                                         │
                                         ▼
     em-state-machine.ts  validateEmPackmlConformance  ← NEW standalone fn (not wired yet)
                                         ▲
     random/*  buildEmCanonicalStateMachine  → now emits "aborted" (conformance-clean)
```

Consumers arriving later: SP-3b seeds Stage A from `defaultEmStates()` **and wires `validateEmPackmlConformance` into the co-author**; SP-3c authors `command_behavior`; SP-4 codegen reads `command_behavior["execute"]` to emit command-branched holds.

## Files

- **Edit:** `src/types/spec-contract-v2.ts` — `CommandBranchSchema`, `CommandBehaviorV2Schema`, `command_behavior` on `EquipmentModuleContractSchema`.
- **Edit:** `src/lib/spec-builder/packml-states.ts` — `defaultEmStates()`.
- **Edit:** `src/lib/spec-builder/em-state-machine.ts` — add standalone `validateEmPackmlConformance` (leave `validateEmStateMachine` unchanged).
- **Edit:** `src/lib/spec-builder/random/state-machine.ts` + `random/em-state-machine-builder.ts` — `estop` → `aborted`.
- **Tests:** `spec-contract-v2` round-trip for the new schema + backward-compat; `packml-states.test.ts` `defaultEmStates`; `em-state-machine.test.ts` new validation cases; `random` builder regression.

## Testing

- **Schema (vitest):** `CommandBranch`/`CommandBehaviorV2` parse; an `EquipmentModuleContract` with `command_behavior["execute"]` round-trips; a contract JSON *without* `command_behavior` parses to `{}` (backward-compat).
- **Seed:** `defaultEmStates()` returns 17 `EmStateV2`, exactly one `is_safe_state` (`aborted`), `kind` mapped from `state_pattern`.
- **Validation (`validateEmPackmlConformance`):** a canonical machine (states from `defaultEmStates()`) yields no issues; a machine with a `driving_fwd` state yields a "non-PackML state_id" issue; `is_safe_state` on `stopped` yields a "safe state must be aborted" issue; a `command_behavior` key on a non-acting/unknown state yields an issue. `validateEmStateMachine` is separately confirmed UNCHANGED (existing suite still green).
- **Random builder:** `buildEmCanonicalStateMachine()` now produces `aborted` (not `estop`) as the safe state; `validateEmPackmlConformance` returns no issues for it (regression against the estop non-canonical slug), and the existing `validateEmStateMachine` regression still passes.

## Generic-rule compliance (CLAUDE.md)

All additions are the abstract PackML vocabulary + a generic command-branch construct — no device/project names. The touched files include `random/*` (a builder, not a prompt) and `em-state-machine.ts` (validation, not a prompt); no `*-prompt*.ts` / `use-forge-*` / `pipeline.ts` files are touched, so the post-task self-check is `npx tsc -b` clean + the new/existing vitest suites green + the generic re-read.

## Verification

- `npx tsc -b` clean.
- `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/em-schema.test.ts src/lib/spec-builder/random` green (plus any spec-contract round-trip suite touched).
