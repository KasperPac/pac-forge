# Design: SP-3d — Segment Wagon PackML Re-author

**Date:** 2026-07-02
**Status:** Design approved — ready for implementation plan
**Scope:** The final validation slice of SP-3 ("PackML everywhere"). Re-authors the live HRE Segment Wagon FDS in the PackML model delivered by SP-3b/3c, **as a duplicated project** so the original deliverable is never mutated. **No product code, no schema changes** — this is a data operation (DML-only) plus a co-author campaign on the live app.

## Why

SP-3b/3c made the co-author author PackML lifecycles + command-driven behaviour for NEW specs, but the one real project (HRE "Segment Wagon Control System", SRL-1427-500802) still carries pre-SP-3b free-slug machines (`driving_fwd` etc., motions as static states). Re-authoring it:

- proves the whole SP-1→3c pipeline on a real 10-EM digital-IO machine (Stage A gate, nature question, command branches, DOCX rendering),
- produces the first spec whose C5 Case A state-coverage check is **non-vacuous** end to end — the initiative's original goal,
- gives the HRE project a PackML-native FDS going forward.

## Decisions (locked during brainstorming)

1. **Duplicate, don't mutate.** The re-author happens in a NEW `spec_projects` row under the same parent project (`72f80e26-8a98-41ff-902e-ba1bb1e46872`); the original spec (`1677f202-01ff-45de-a9b4-ff19642e0ead`) is never written to. This satisfies preservation without snapshots.
2. **One-off data operation, not an app feature.** No generic "Duplicate Project" capability is built — the copy is a scratch script for this project only, executed via the live app's authenticated REST (browser `javascript_tool` pattern: anon key + session access token). DML-only; no migration-history risk.
3. **Claude drives the co-author campaign** in the live app via browser automation; the engineer reviews each EM's result.
4. **Pilot one EM first** (the carriage drive — the canonical command-driven case), then batch the remaining 9 with lessons applied.
5. Fresh sessions by construction: `fds_operation_sessions` are get-or-create on demand (`use-fds-session.ts` ~113), so the copy skips them entirely and every EM opens in Stage A.

## Non-Goals

- Any product code, UI, schema, or prompt change. (If the campaign surfaces a pipeline bug, it is fixed as its own mini-slice with the usual review flow, not smuggled into SP-3d.)
- A generic project-duplication feature (explicitly declined).
- Migrating the ORIGINAL spec's data to PackML (it remains the frozen pre-PackML reference).
- SP-4 codegen work. Running Code Builder here is verification only.

---

## Phase 1 — One-off duplication (DML)

Copy the source spec into a new spec under the same parent project, named **"Segment Wagon Control System (PackML)"**.

| Table | Action | Notes |
|---|---|---|
| `spec_projects` | copy 1 row → new UUID | keep hierarchy/modes/safety_gates/system description; reset `confirmation_status` to unconfirmed; same parent `project_id` |
| `instrument_registers` | copy rows → new PKs | re-point `spec_project_id` |
| `spec_source_sections` | copy rows → new PKs | the customer-spec bindings — required for ground-then-refine |
| `spec_alarms` | copy rows → new PKs | logical unit/EM/CM ids preserved verbatim |
| `spec_sections` | copy ingest/overview types only | SKIP `functional_description` + `equipment_description` (compose regenerates) |
| `fds_operation_sessions` | **skip** | lazily created → every EM starts fresh in Stage A |
| `spec_exports`, `spec_project_revisions`, `fds_migration_events` | **skip** | history of the original, not the copy |

**Id strategy:** DB PKs/FKs regenerate; logical ids inside JSONB (unit_id, equipment_module_id, control-module tags) stay identical — they are project-scoped, and the source-section bindings key on them.

**Execution + safety:** project row inserted first, children after, so any child-table failure (RLS, NOT NULL, unique) is surfaced per-table and the partial copy is cleanly deletable by the new spec id (children cascade). Verification before proceeding: new project opens in Spec Builder, hierarchy shows 10 EMs, register/tag counts match the source, source sections visible per EM. The scratch script (and any column surprises encountered) are logged in the plan's execution record — audit trail without committing throwaway code.

## Phase 2 — Re-author campaign (live app)

**Pilot (1 EM — carriage drive):**
1. Open the copy's co-author for the carriage EM → session auto-creates → Stage A runs with the SP-3b PackML prompt (grounded PHASE 1 from the bound source sections).
2. Confirm the proposed machine: states ⊆ PackML slugs, safe state `aborted`, manual motions ABSENT from the state list, fault fan-in one-transition-per-tag. The SP-3b hard gate blocks anything non-conformant.
3. Stage B: nature question → "command-driven" for `execute` → author drive-fwd/drive-rev branches + interlock guards + `default_hold` (motors off). Static states (e.g. `aborted`, `stopped`, `idle`) get their device-hold tables as usual.
4. **Engineer review gate** — the user inspects the persisted machine, branches, and (after compose) the DOCX branch table before batching.

**Batch (remaining 9 EMs):** same procedure per EM, applying pilot lessons. EMs that are genuinely automatic author steps, not branches — the nature question decides per state; nothing is forced to be command-driven.

**Campaign verification:**
- Compose the units → Structured Spec Editor + DOCX export show PackML state tables and row-per-branch command tables (SP-3c rendering).
- Run Code Builder on the copy: matched library EMs with declared states (SP-2 grid) must hit **C5 Case A with non-vacuous coverage**; unmatched EMs produce the EM-layer bundles as usual.
- Stage A/B validators produced zero silent failures during the campaign (any validation-failure turn is resolved in-conversation, not bypassed).

**Known campaign constraints** (from working memory): long `type` actions freeze the renderer — use `find` → `form_input` for long text; browser zoom can shift coordinates between screenshots — verify before clicking; Stage A responses can be large — SP-3b already runs Stage A at the 32768-token ceiling.

## Success criteria

1. New "(PackML)" spec exists; original untouched (verified by comparing the original's `updated_at` before/after).
2. All 10 EMs authored: PackML-slug machines, `aborted` safe, motions as `command_behavior`.
3. DOCX shows the PackML operating-sequence + branch tables.
4. Code Builder Case A engages non-vacuously on at least one matched library EM (or, if no template matches, `checkStateCoverage(defaultEmStates-shaped FDS states, declared FB states)` is demonstrated via the compile output on the EM path).
5. Any pipeline defect found is logged and fixed as its own reviewed slice.

## Generic-rule compliance (CLAUDE.md)

No prompts/pipeline code change in this slice. The scratch duplication script is deliberately NOT committed to the repo (throwaway, project-specific by design — committing it would invite reuse of non-generic code). Campaign answers are grounded in the customer spec via source sections — that is authoring project data, which is exactly what project data is for; nothing project-specific leaks into shared code.

## Verification

Phase 1: table-count comparison source vs copy per copied table; app-level smoke (hierarchy, register, source sections visible).
Phase 2: the success criteria above, with the engineer review gate after the pilot EM.
