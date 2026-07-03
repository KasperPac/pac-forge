# Handover: PackML EM-State Initiative (SP-1 → SP-3d)

**Date:** 2026-07-03
**Status:** SP-1 through SP-3d **shipped and pushed** to `origin/master` (tip `c7158b2`). SP-4 (codegen) is the remaining slice.
**Purpose of this doc:** change-review guide + frontend test checklist before SP-4 kicks off.

---

## 1. What the initiative did (one paragraph)

Every Equipment Module now speaks the **fixed PackML 17-state vocabulary** (ISA-TR88.00.02, the sanctioned collapse of ISA-88 Part 1 Annex D) end to end: FB templates declare their PackML states as metadata, the FDS co-author authors PackML lifecycles in Stage A (hard-gated), manual/operator motions live as **command-conditional device holds inside `execute`** (`command_behavior`, authored in Stage B) instead of invented free-slug states, the exported spec renders them, and the Code Builder generates PackML `CASE` state machines from them. Proven end-to-end by re-authoring the real Segment Wagon project (as a duplicate — the original was never touched).

## 2. Slice-by-slice review guide

| Slice | Review at | Key commits | What to look at |
|---|---|---|---|
| **SP-1** — canonical state module | `src/lib/spec-builder/packml-states.ts` | `2a04480`, `5b23fcd` | The 17 states, `isPackmlSlug`, `defaultFbStates`, `defaultEmStates` |
| **SP-2** — FB templates declare states | `src/components/fb-library/fb-states-grid.tsx`, wired in `src/routes/fb-library.tsx` | `60b366e`, `83a3cdc`, `d8d5e3e` | EM-only grid, all-17 default, `Aborted` safe marker, saves into `interface_contract.states` |
| **SP-3a** — contract schema + validators | `src/types/spec-contract-v2.ts` (~740), `src/lib/spec-builder/em-state-machine.ts` | `33b350f`, `191b526`, `0320eba`, `9787f90` | `CommandBranch`/`CommandBehaviorV2` (`.optional()` deliberately), standalone `validateEmPackmlConformance`, random-builder `estop`→`aborted` |
| **SP-3b** — Stage A PackML reframe | `src/lib/spec-builder/em-state-machine-prompts.ts`, `src/hooks/use-fds-conversation.ts` (Stage A gate) | `9cc1dc6`, `70b1887` | Injected PackML menu, motions-are-not-states rule, `validateEmStateMachineAndPackml` hard gate — **Stage-A-only**, `validateSpecContractPatch` untouched so pre-PackML specs still work |
| **SP-3c** — Stage B command_behavior | migration `20260702000000`, `fds-prompts.ts`, `use-fds-conversation.ts` (routing), `fds-compose.ts`, `operating-sequence.ts`, `fds-logic-checker.ts` | `8158fef`, `2546035`, `46f9715`, `922cbbd`, `957d91a`, `dd938e4` | Nature question (automatic vs command-driven), steps-XOR-branches enforcement, row-per-branch rendering shared by editor+DOCX (zero renderer edits) |
| **SP-3d** — Segment Wagon re-author | `Docs/superpowers/plans/2026-07-02-sp3d-segment-wagon-packml-reauthor.md` (full Execution Record) | `5b00085`, `b157bd9`, `7385a74` | Data campaign, not a code slice — the three fix commits are the code |

Design docs + plans for every slice: `Docs/superpowers/specs/2026-07-01-*` and `2026-07-02-*`, with co-located `.tasks.json`.

**Migration status:** `20260702000000_command_behavior.sql` is **applied to the remote DB**; the migration ledger is fully aligned (the long-standing drift was repaired 2026-07-02 — see memory note `supabase-migration-drift-resolved`).

## 3. Frontend test checklist

The PackML re-authored spec: **Herrenknecht → SRL-1427-500802-PACKML** (spec id `8913bad6-7040-4908-bbb3-67f16a501802`). The original `SRL-1427-500802` sits beside it, untouched — good for A/B comparison.

### A. FB Library (SP-2)
1. FB Library → open any **EM** template (is_equipment_module) → a **PackML States** grid renders under the pins grid: 17 rows, all Implemented, `Aborted` safe-marked.
2. Untick a state, Save → "Needs review" badge clears; reopen → selection persisted.
3. A non-EM (device) template shows **no** states grid.

### B. Co-author Stage A (SP-3b)
4. Open the PACKML spec → Co-Author → any completed EM → the state machine shows **PackML names only** (Stopped/Idle/Execute/Aborting/Aborted…), no `driving_fwd`-style states.
5. (Optional destructive check on a scratch spec, not this one): author a new EM → Stage A proposes PackML slugs with `aborted` safe; the AI cites the customer spec; conformance violations are rejected with a visible failure message, never silently dropped.

### C. Co-author Stage B (SP-3c)
6. **Carriage Drive** → Stage B → the `Execute` tab exists but has **no steps** — its behaviour lives in `command_behavior` (4 branches: fwd/fwd-fast/rev/rev-fast + default hold). Compare **Rotator Drive** (4 rotate branches, holds = `VSD2_Speed_Ref` setpoints only).
7. Try authoring steps for `execute` via chat on one of these → rejected with the XOR message (state is command-driven).
8. Mark Complete works on command-driven EMs (this was pilot defect #1, fixed).

### D. Structured Spec Editor (SP-3c rendering)
9. Open Editor → 93 sections → **Carriage — Equipment** → "Carriage Drive — Steps & Actions": hoisted permissives table + Execute row shows **one line per branch**: `Drive Forward (Jog) — while Fwd_Carriage = TRUE AND Carriage_Brake_Open = TRUE AND Long_Limit_Stop = FALSE: CM1_Run: RUN, … VSD1_Speed_Ref: JOG_SPEED_FWD`, plus a `Default —` line.
10. DOCX Export → same branch tables in the Word output (renders through the same shared builder; the export run itself wasn't exercised during the campaign — this is the one manual step worth doing).

### E. Code Builder (C-series + granularity fix)
11. Open Code Builder on the PACKML spec → **2 EM** step → all 10 EMs grouped by unit, each `stub` (no library template matches — expected).
12. Select any EM → 5-artifact bundle (Code/State/Map/UDT/Inst DB); the FB shows a PackML `CASE #state OF` machine with `// Aborted (safe)`, `// Resetting`, `// Idle`, `// Execute` etc.; Safety gate "Safe — no warnings".
13. Command-driven states currently appear as **ai-fill stubs** in the generated SCL — that's the SP-4 gap, expected.
14. Regression: open Code Builder on any OTHER project with composed sections — previously it showed "No artifacts" for all of them (granularity bug, fixed in `7385a74`).

## 4. Defects found by the SP-3d campaign

| # | What | Status |
|---|---|---|
| 1 | Mark-Complete validator demanded steps on command-driven states | ✅ fixed (`5b00085` + `b157bd9`), first test suite for `fds-logic-checker.ts` |
| 2 | Legacy DB granularity (`assembly_state` column default) broke `loadSpecContract` → Code Builder empty for **any** composed project | ✅ fixed (`7385a74`, `normalizeGranularity`) |
| 3 | "Generate Spec Sections" button hidden whenever ANY section rows exist (`hasSections` counts all types) → compose unreachable for duplicated/pre-sectioned projects | ⬜ open ticket |
| 4 | `writeSpecContract` sections-insert writes contract-vocabulary granularity into a DB whose CHECK constraint only accepts legacy values → Postgres violation; **live** via the random-FDS path (`random/assemble.ts:77/377/392`) | ⬜ open ticket |

## 5. SP-4 — the remaining slice (next session)

**Goal:** the deterministic codegen consumes `command_behavior["execute"]` and emits the command-branched holds (IF command AND guards THEN holds … ELSE default_hold) inside the Execute case, replacing today's ai-fill stub for command-driven states.

Carry-ins for SP-4 planning:
- `validateEmPackmlConformance` checks slugs + `aborted` but NOT that a state's `kind` matches the canonical `state_pattern` (e.g. brake's `execute` was authored `static`). Codegen branches on `kind` — SP-4 should derive kind from the slug or add the check.
- `em-builder.ts` / `em-fill-regions.ts` are the consumption points; the 50 generated artifacts on the PACKML spec are the live test fixtures.
- Consider folding open tickets #3/#4 in or sequencing them right after.

## 6. Where everything lives

- **Memory (survives context clears):** `packml-em-state-initiative.md` (+ index in `MEMORY.md`) has the full state, ids, gotchas.
- **Execution record:** `Docs/superpowers/plans/2026-07-02-sp3d-segment-wagon-packml-reauthor.md`.
- **Spec ids:** PACKML copy `8913bad6-7040-4908-bbb3-67f16a501802` · original `1677f202-01ff-45de-a9b4-ff19642e0ead` · parent project `72f80e26-8a98-41ff-902e-ba1bb1e46872`.
