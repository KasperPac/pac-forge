# Design: PackML EM-State Foundation (SP-1 + SP-2)

**Date:** 2026-07-01
**Status:** Design approved — ready for implementation plan
**Scope:** Foundation slice of the larger "PackML everywhere" EM-state initiative. Delivers the canonical PackML state model + FB-template state metadata + coverage. Does NOT touch Stage A authoring or codegen (those are SP-3 / SP-4).

---

## Why

C5 shipped a verified matched-library-EM compile path whose Case A ("FDS state coverage verified against the library FB's declared states") **never actually engages**, because nothing populates a library EM FB's `interface_contract.states`. Real library EM templates therefore fall to Case B ("coverage unverifiable") instead of Case A (verified). See `Docs/HANDOVER-CODE-BUILDER-2026-06-30.md` §"Deferred (KNOWN GAPS)" item 1 and `2026-07-01` §"Open next step".

The fix is not a bespoke per-FB states editor. The agreed model is:

- **Every EM FB implements the full PackML state machine.** The state vocabulary is *fixed* (PackML), not invented per FB.
- **The states are declared as metadata on the FB template**, not extracted by parsing SCL `CASE` labels.
- **Manual/command-driven motions** (e.g. a carriage's Driving Forward/Reverse) are **behavior performed while in `Execute`**, driven by command inputs — they are *not* states.

This slice establishes the canonical vocabulary and the FB-side metadata so coverage can verify. Making real FDS specs emit that vocabulary (so verification is non-vacuous) is the next slice, SP-3.

## Standards provenance

Grounded in the actual standards in `Docs/standards/`:

- **ISA-88 Part 1 (ANSI/ISA-88.00.01-2010), Annex D** defines the full *Reference Procedural State Model*.
- Per **Annex D.1**, the **PackML "Base State Model" (ISA-TR88.00.02)** is explicitly a **collapse** of that Annex D reference model. PackML renames Annex D's `RUNNING → EXECUTE` and omits Annex D's `PAUSING/PAUSED`.
- SP-1's canonical set is that **PackML 17-state collapse** — the standard-endorsed subset, matching Siemens/TIA convention and the numbering already assumed by `src/lib/spec-builder/random/state-machine.ts`. The definition is recovered verbatim from the project's own deleted `src/lib/spec-builder/migrate/packml-canonical.ts` (git `a9942fb`, *"Sourced from OMAC PackML / PLCopen state-model reference"*).

## Decisions (locked during brainstorming)

1. Canonical EM state vocabulary = the **fixed PackML 17-state collapse** (naming: `Execute`, not `Running`; no `Pausing/Paused`).
2. Manual motions live as **Execute-phase behavior**, not as states (relevant to SP-3, recorded here for continuity).
3. Every EM FB **declares all 17 PackML states** as metadata by default; the author may un-declare states a leaner FB genuinely does not implement.
4. **Safe state = `aborted`** (packml_id 9) — the PackML fault-landing state.
5. **No AI extraction** for states — they are fixed metadata, defaulted then human-confirmed.
6. Coverage requires **no compiler change** — `checkStateCoverage` already reads the FB contract's `states`.

## Non-Goals (this slice)

- **SP-3 — Stage A/B PackML reframe.** Today `em-state-machine-prompts.ts` mandates free-form EM-local slugs (`driving_fwd`) and models motions as `static` states. Until SP-3 aligns Stage A to the PackML vocabulary, coverage will still not match for real specs — **verification is technically vacuous after this slice**. This is accepted: SP-2 makes the *FB side* correct and PackML-standard; SP-3 makes the *FDS side* emit PackML so the two line up.
- **SP-4 — Codegen alignment** (EM FB `CASE` machine emitting PackML lifecycle + motion-in-Execute).
- Reconciling the random builder's non-canonical `estop` slug (→ `aborted`) — SP-3.
- Splitting the single `interface_contract.reviewed` flag into pins-vs-states — deferred.
- Restoring a companion `ai/PACKML_STATE_MODEL.md` prompt-reference doc — belongs to SP-3 (when Stage A needs the vocabulary injected).

---

## SP-1 — Canonical PackML state model (pure)

New module `src/lib/spec-builder/packml-states.ts`. Pure, no React/IO, no other project deps. Restores the recovered `packml-canonical.ts` data and adds a `slug` + `is_safe` layer plus an FB-defaults helper.

### Types & data

```ts
export type PackmlStatePattern = "static" | "sequential";

export interface PackmlState {
  packml_id: number;               // 1..17 (OMAC/PLCopen numbering)
  slug: string;                    // lowercase canonical id — matches EmStateV2.state_id + FbInterfaceState.slug
  name: string;                    // canonical display name
  state_pattern: PackmlStatePattern; // static (waiting) | sequential (acting)
  is_safe: boolean;                // exactly one true → aborted
}

export const PACKML_STATES: readonly PackmlState[]; // the 17, in packml_id order
```

The 17 states (id / slug / name / pattern), safe = `aborted`:

| id | slug | name | pattern |
|----|------|------|---------|
| 1 | clearing | Clearing | sequential |
| 2 | stopped | Stopped | static |
| 3 | starting | Starting | sequential |
| 4 | idle | Idle | static |
| 5 | suspended | Suspended | static |
| 6 | execute | Execute | sequential |
| 7 | stopping | Stopping | sequential |
| 8 | aborting | Aborting | sequential |
| 9 | **aborted** | Aborted | static |
| 10 | holding | Holding | sequential |
| 11 | held | Held | static |
| 12 | unholding | Unholding | sequential |
| 13 | suspending | Suspending | sequential |
| 14 | unsuspending | Unsuspending | sequential |
| 15 | resetting | Resetting | sequential |
| 16 | completing | Completing | sequential |
| 17 | complete | Complete | static |

`slug` is `name.toLowerCase()` (all 17 names are single words, so slugs are unambiguous and underscore-free).

### Helpers

```ts
export const PACKML_STATE_SLUGS: ReadonlySet<string>;      // normalized slugs
export function packmlStateBySlug(slug: string): PackmlState | undefined; // trim+lowercase
export function packmlStateById(id: number): PackmlState | undefined;
export function isPackmlSlug(slug: string): boolean;        // trim+lowercase membership
export function defaultFbStates(): FbInterfaceState[];      // all 17 → { slug, name, is_safe }
```

`defaultFbStates()` returns the full 17 mapped to the existing `FbInterfaceState` shape (`{ slug, name, is_safe }`) — the default an EM FB declares.

### Tests (pure vitest — no `.env.local`)

- 17 states; `packml_id` unique and 1..17; `slug` unique; exactly one `is_safe` (== `aborted`).
- The 6 pragmatic slugs used by `random/state-machine.ts` (`idle/starting/execute/stopping/complete`) are all members (documents the alignment; `estop` is intentionally NOT — it is the random builder's non-canonical safe slug, reconciled in SP-3).
- `packmlStateBySlug("EXECUTE ")` (case/space-insensitive) resolves; `isPackmlSlug("driving_fwd")` is false.
- `defaultFbStates()` returns 17 `FbInterfaceState` with exactly one `is_safe`.

---

## SP-2 — FB template declares PackML states + coverage verifies

### Component `src/components/fb-library/fb-states-grid.tsx`

A sibling of `FbInterfaceGrid`, rendered immediately after it in the template detail view (`src/routes/fb-library.tsx:1436`), **only when `template.is_equipment_module`** (device/CM templates have no state machine — ISA-88 §5.2 basic control).

Behavior (mirrors the pins grid pattern):

- **Seed:** `template.interface_contract?.states ?? defaultFbStates()` — a fresh EM template shows all 17 states pre-declared.
- **Grid rows:** driven by `PACKML_STATES` (canonical order). Each row: state name, a **"Implemented" checkbox** (declared ⇢ included in the saved `states`), and a **single-select "Safe" marker** (radio semantics — exactly one; defaults to whatever row is `is_safe`, i.e. `aborted`).
- **All implemented by default** (honoring "all EM FBs have all PackML states"); the author may untick states a leaner FB does not implement.
- **"Needs review" badge** when `!interface_contract?.reviewed`, matching the pins grid.
- **Save:** builds the merged contract and calls the existing `useSaveFbInterface`:
  ```ts
  const contract: FbInterfaceContract = {
    block_name: existing?.block_name ?? mainBlock,
    pins: existing?.pins ?? seedPins(template),   // preserve authored pins
    states: declaredStates,                        // the ticked rows, with the chosen safe marker
    reviewed: true,
    generated_at: existing?.generated_at ?? new Date().toISOString(),
  };
  save.mutate({ templateId: template.id, contract });
  ```
  This is symmetric with `FbInterfaceGrid.handleSave`, which already preserves `states`. Each grid reads the persisted counterpart from `template.interface_contract`, so saving one preserves the other. (A simultaneous-edit race on both grids is possible but out of scope — last save wins on the shared JSONB column; acceptable for a single-author authoring surface.)

No `Generate`/AI button — states are fixed metadata.

### Coverage — no compiler change

`compile-contract.ts` Case A already calls `checkStateCoverage(emContract.states, emRes.contract?.states ?? [])`, and `emRes.contract` originates from `template.interface_contract` via `fb-instantiate.ts`. Once the grid populates `interface_contract.states`, a matched EM template with declared states flows straight into Case A. **Nothing in `codegen/` changes.**

The only residual: Case A verifies only when the FDS `emContract.states` slugs are PackML slugs. They are not yet (Stage A emits free slugs) → covered by SP-3. Documented as the accepted non-goal above.

### Tests

- **Component (vitest + Testing Library):**
  - EM template with no contract → grid renders 17 rows, all "Implemented" checked, `Aborted` marked safe, "Needs review" badge present.
  - Non-EM template (`is_equipment_module: false`) → grid renders nothing (parent gate).
  - Unticking a state and saving calls `useSaveFbInterface` with a contract whose `states` excludes it and whose `pins` equal the pre-existing pins (merge preserved).
  - Changing the safe marker updates exactly one `is_safe: true`.
- **Coverage regression (pure, existing suite `em-state-coverage.test.ts`):** add a case proving `defaultFbStates()` covers an FDS EM whose states are PackML slugs, and reports `missing` for a non-PackML slug — locking the SP-1↔coverage contract.

---

## Architecture / data flow

```
SP-1  packml-states.ts  ──PACKML_STATES / defaultFbStates()──┐
                                                             ▼
SP-2  FbStatesGrid (EM templates only)  ──save──►  fb_templates.interface_contract.states  (JSONB)
                                                             │  (already loaded by fb-instantiate)
                                                             ▼
      compile-contract.ts Case A  ──checkStateCoverage(fdsStates, contract.states)──►  verified | BLOCK
```

No new tables, no migration (`interface_contract` JSONB already holds `states`; `FbInterfaceState` type already exists). No new hooks (reuses `useSaveFbInterface`). No edge-function or codegen changes.

## Files

- **New:** `src/lib/spec-builder/packml-states.ts` (+ `__tests__/packml-states.test.ts`)
- **New:** `src/components/fb-library/fb-states-grid.tsx` (+ `__tests__/fb-states-grid.test.tsx`)
- **Edit:** `src/routes/fb-library.tsx` — render `<FbStatesGrid>` after `<FbInterfaceGrid>`, gated on `template.is_equipment_module`
- **Edit (test-only):** `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts` — SP-1↔coverage regression
- No change: `fb-interface.ts` type, `useSaveFbInterface`, `codegen/*`, migrations

## Generic-rule compliance (CLAUDE.md)

The canonical states are the abstract PackML vocabulary — no device/project/machine-type names. `defaultFbStates()` and the grid are identical for every EM FB. No prompt/pipeline files are touched in this slice, so the post-task self-check reduces to `npx tsc -b` clean + the new vitest suites green.

## Verification

- `npx tsc -b` clean.
- `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts src/components/fb-library src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts` green.
- Manual: open an EM FB template in FB Library → states grid shows 17 PackML states, all declared, `Aborted` safe → Save → "Needs review" clears.
