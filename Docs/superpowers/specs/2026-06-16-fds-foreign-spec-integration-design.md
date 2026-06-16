# Design: FDS Foreign-Spec Integration (.docx → Co-Author)

**Date:** 2026-06-16
**Status:** Design approved — ready for implementation plan
**Supersedes the open questions in:** `Docs/superpowers/specs/2026-06-16-io-register-foreign-spec-handover.md`

---

## Goal

A user can reach the FDS co-author from **any** of three starting points, with hierarchy,
operating states, alarms, IO data, and the original customer-spec text all wired through:

1. A customer functional description (`.docx`) alone
2. An IO register (`.xlsx`/`.csv`) alone
3. Both, reconciled together

Today the two data sources are disconnected: the foreign-spec ingest stores a
`SpecContractV2` snapshot that never reaches the live `spec_projects` row, the FDS prompts
never see the original spec text, and the co-author hard-gates on an instrument register
existing.

## Non-Goals

- Renaming/restructuring the FDS pipeline phases themselves.
- AI-based hierarchy reconciliation. The merge is deterministic. (An AI topic-extraction
  upgrade for section selection is explicitly deferred — see Gap 2.)
- Changing the SpecContractV2 schema shape.

---

## Data Flow

```
                ┌─ IO register (.xlsx) ──► parseInstrumentRegister ──► instrument_registers (tags + IO)
                │                                                              │
upload sources ─┤                                                              ├──► MERGE ──► co-author
                │                                                              │   (spec skeleton +
                └─ customer .docx ──► aiIngestDocx ──► SpecContractV2 ─────────┤    register IO +
                                          │            (hierarchy/states/        │    source sections)
                                          │             alarms)                  │
                                          ├──► splitIntoSections ──► spec_source_sections  (Gap 2)
                                          └──► synthesize register (Gap 3) ──────┘
```

Five workstreams, in dependency order:

1. **Foundation** — reconcile the hierarchy column naming (prerequisite for Gap 1).
2. **Gap 1 — Hydration** of `spec_projects.confirmed_*` from the ingested contract.
3. **Gap 2 — Source sections** stored and injected into FDS prompts.
4. **Gap 3 — Synthesize** an instrument register from the ingested hierarchy.
5. **Merge** — reconcile an uploaded register with the spec hierarchy.

---

## 1. Foundation — Reconcile hierarchy column naming

### Problem

The ISA-88 rename (migration `091`) renamed the **code** to `units` / `confirmed_units` but
left two **DB columns** at their old names:

- `spec_projects.confirmed_subsystems` (defined `054_spec_builder.sql:31`)
- `instrument_registers.subsystems`

The result is inconsistent:

- The save hook patches over it with a `units → subsystems` shim
  (`use-spec-projects.ts:173-176`).
- `contract.ts` references `confirmed_units` directly on read **and** write
  (`loadSpecContract:340`, `writeSpecContract:1051`). Because that column does not exist in
  the DB, this read returns empty and this write targets a non-existent column. This path is
  currently broken and the hydration work (Gap 1) sits on top of it.

### Decision: complete the DB rename

A migration renames the columns to match the code, finishing the ISA-88 rename:

- `spec_projects.confirmed_subsystems → confirmed_units`
- `instrument_registers.subsystems → units`

### Work

- New migration `093_isa88_column_rename.sql`:
  - `ALTER TABLE ... RENAME COLUMN` for both columns.
  - Update every RPC that references the old names. Known references (to be re-verified
    exhaustively when writing the plan): `066_spec_revision_rpcs.sql` (lines ~29, ~480),
    `067_fds_system_orchestrations.sql` (~89), `091_isa88_rename.sql` (~256). The plan must
    `grep` the full `supabase/migrations/` tree for `confirmed_subsystems` and
    `\bsubsystems\b` and update each.
- Remove the `units → subsystems` shim in `use-spec-projects.ts` (insert now passes `units`
  straight through; rename the DB target).
- Verify `contract.ts` `loadSpecContract` / `writeSpecContract` now align with the real
  column (`confirmed_units`).

### Risk / mitigation

Renames touch RPCs and live data. Mitigation: a single migration that renames + redefines
the affected RPC bodies in one transaction; round-trip tests on `writeSpecContract` /
`loadSpecContract` (mocked Supabase) lock the behaviour. The plan enumerates the full
reference list before writing the migration.

---

## 2. Gap 1 — Hydration

### What

After the ingest-review commit, populate `spec_projects.confirmed_units` /
`confirmed_states` / `alarm_tiers` (and the related equipment-module/unit/section rows) from
the reviewed `SpecContractV2`, so the skeleton wizard and co-author consume the ingested
hierarchy instead of starting empty.

### How

Reuse `writeSpecContract(reviewedContract)` (`contract.ts:1010`). Post-rename it correctly
maps `hierarchy.units → confirmed_units`, `states → confirmed_states`, `alarm_tiers`, and
upserts equipment-module/unit/section rows. The ingest hook (`use-spec-ingest.ts`) calls it
immediately after `create_draft_from_ingest` returns, passing the contract the user reviewed
on `spec-builder-ingest-review.tsx`.

### Immutability-trigger interaction (resolve in plan)

`create_draft_from_ingest` creates a **draft revision**, and migration `065` installs a
post-draft immutability trigger on `spec_projects`. `revert_to_revision`
(`066_spec_revision_rpcs.sql`, ~line 474-480) already updates `confirmed_*` from a snapshot
and documents that the trigger "blocks drafts only," so a known-good pattern exists. The plan
will either (a) hydrate in a state the trigger permits (mirroring `revert_to_revision`), or
(b) fold the `confirmed_*` write into the `create_draft_from_ingest` RPC if the frontend
update is blocked. Preference per the brainstorm: frontend via `writeSpecContract`; the RPC
fold-in is the fallback.

### Wizard UX

The skeleton wizard (`spec-skeleton-wizard.tsx`) already prefers `spec.confirmed_units` over
`buildHierarchyFromTags()` (`:87-92`). With hydration in place it becomes a *review/adjust*
step pre-populated from the ingest, not a from-scratch build. No wizard code change required
beyond confirming this branch.

---

## 3. Gap 2 — Source sections in FDS prompts

### Capture

`aiIngestDocx` already extracts the raw `.docx` text via `mammoth.extractRawText`
(`ai-ingest.ts:161-162`). Run that text through the existing `splitIntoSections()`
(`document-sections.ts:27`) to get `DocSection[]` (heading + body).

### Store

New table `spec_source_sections`:

| column           | type        | notes                                     |
|------------------|-------------|-------------------------------------------|
| `id`             | uuid pk     |                                           |
| `spec_project_id`| uuid fk     | → `spec_projects(id)` on delete cascade   |
| `source_filename`| text        | the originating `.docx` name              |
| `heading`        | text        | section heading (may be empty for preface)|
| `body`           | text        | section body                              |
| `order_index`    | int         | preserves document order                  |
| `created_at`     | timestamptz | default `now()`                           |

RLS mirrors `instrument_registers` (owner via `spec_projects.created_by = auth.uid()`).
A table (not a JSONB blob on `spec_projects`) because sections can be numerous and may come
from multiple source docs, and we select subsets cheaply at prompt time.

### Inject (deterministic, per topic)

When building the FDS co-author prompt for a given equipment module:

1. Select **relevant** sections: heading or body mentions the EM name, any of its
   control-module ids, or its tags (case-insensitive substring / token match).
2. Always include a small set of **global** sections: headings matching
   overview / control philosophy / scope keywords.
3. Concatenate under a `## Customer Specification Context` block, **capped** to a configured
   max character budget (newest-relevant first) to bound tokens.

`buildFdsInterviewSystemPrompt` (`fds-prompts.ts:44-51`) gains a `sourceSections` parameter
(the already-selected subset, or the raw list + selection happening in the caller — decided
in the plan). The conversation hook loads sections for the active EM and passes them.

### Why deterministic (not the two-pass AI reference-lookup)

`reference-lookup.ts` exists for the large external Siemens library. Per-EM customer-spec
sections are small and strongly name-correlated, so keyword/tag matching is cheaper and
predictable, consistent with the project's deterministic-first preference. An AI
topic-extraction pass is a clean future upgrade if matching proves too blunt.

---

## 4. Gap 3 — Synthesize a register from ingest

### What

After ingest + hydration, build an `instrument_registers` row from the IO signals embedded in
the ingested hierarchy, so the co-author's `if (!register)` gate (`spec-co-author.tsx:61`)
passes and the user gets a reviewable tag list.

### How

Flatten the `SpecContractV2` hierarchy (`units → equipment_modules → control_modules →
io_signals`) into `InstrumentTag[]`:

- Populate ISA-88 hierarchy fields (`process_cell` / `unit` / `equipment_module` /
  `control_module`) from each level.
- Reuse `classifyDeterministic()` (`instrument-parser.ts`) for `control_module_class`,
  `signal_direction`, `is_safety`.
- Build the unit summary with `groupSubsystems()`.
- Persist via `useSaveInstrumentRegister()` — the same shapes the upload path produces, so
  everything downstream is identical.

This lives in a new pure helper, e.g. `synthesizeRegisterFromContract(contract) →
{ tags, units }`, unit-tested independently.

### Provenance

Add `instrument_registers.source` (`text`, default `'upload'`, values `'upload' | 'ingest'`).
The synthesized row is tagged `'ingest'`. This lets the merge (Section 5) distinguish a
derived register from an uploaded one and lets re-ingest re-synthesize without clobbering an
uploaded register.

### When

Synthesize when an ingest produces a hierarchy **and** no `'upload'` register exists for the
project. If a real register is later uploaded, the merge takes over and the uploaded register
is authoritative for IO; the `'ingest'` register is ignored while an `'upload'` register
exists.

---

## 5. Merge — spec structure + register IO

### Trigger

An uploaded register (`source='upload'`) and a confirmed hierarchy both exist.

### Core function (pure, deterministic, testable)

```
mergeRegisterIntoHierarchy(units: UnitConfig[], registerTags: InstrumentTag[])
  → { units: UnitConfig[]; report: MergeReport }
```

The spec hierarchy is the skeleton; the register supplies authoritative IO.

1. **Index** spec control modules by `control_module_id` (and the tags of their existing
   `io_signals`).
2. **Match** each register tag, deterministically:
   - exact: `tag.control_module` equals a spec `control_module_id`, **or** `tag.tag` equals
     an existing spec io-signal tag;
   - else normalized: `extractDevicePrefix(tag.tag)` (`instrument-parser.ts`) against spec
     `control_module_id`s.
3. **Apply authority:**
   - **Matched** → the register's `io_address` + `signal_type` fill/override that control
     module's io-signal; the spec keeps names, descriptions, sequences, faults.
   - **Unmatched** register device → attach to a best-match equipment module by tag-prefix
     vs the EM's control-module prefixes; if none, an `"Unassigned"` EM under the tag's unit
     (or the first/declared unit).
   - **Spec-only** control modules with no register tag are **kept** (they carry intent) and
     flagged "no IO mapped."
4. **Report:** `MergeReport = { matched: number; addedUnassigned: number;
   specModulesWithoutIo: string[] }`, surfaced in the co-author UI.

### Where it runs

At co-author entry (idempotent), writing the reconciled hierarchy back via
`writeSpecContract`. No AI in the merge.

### Edge cases

- Re-running is safe (idempotent): matched signals are overwritten with the same values;
  unassigned placement is stable.
- A re-uploaded register re-merges.
- The synthesized (`source='ingest'`) register is ignored while an `'upload'` register exists.

---

## 6. Component / file map

| Concern | File | Change |
|---|---|---|
| Column rename | `supabase/migrations/093_isa88_column_rename.sql` (new) | rename 2 columns + update RPC bodies |
| Remove shim | `src/hooks/use-spec-projects.ts` | drop `units→subsystems` mapping |
| Contract mapping | `src/lib/spec-builder/contract.ts` | align with `confirmed_units` column |
| Hydration | `src/hooks/use-spec-ingest.ts` | call `writeSpecContract` after commit |
| Source sections table | `supabase/migrations/094_spec_source_sections.sql` (new) | new table + RLS |
| Capture sections | `src/lib/spec-builder/ai-ingest.ts` (or ingest hook) | `splitIntoSections` + persist |
| Inject sections | `src/lib/spec-builder/fds-prompts.ts` | `sourceSections` param + `## Customer Specification Context` |
| Section selection | new helper `src/lib/spec-builder/source-section-select.ts` | deterministic per-EM selection |
| Register provenance | `supabase/migrations/094_spec_source_sections.sql` | `instrument_registers.source` column (additive, same migration as the new table) |
| Synthesize register | new helper `src/lib/spec-builder/synthesize-register.ts` | hierarchy → `InstrumentTag[]` |
| Merge | new helper `src/lib/spec-builder/merge-register-hierarchy.ts` | `mergeRegisterIntoHierarchy` |
| Co-author entry | `src/routes/spec-co-author.tsx` / `fds-co-author.tsx` | run merge, show `MergeReport` |

(Exact split of capture/selection between hook and lib decided in the plan; helpers are pure
so they can be unit-tested in isolation.)

---

## 7. Testing

- **Pure logic → vitest unit tests:**
  - `mergeRegisterIntoHierarchy`: exact + normalized matching, unmatched placement,
    register-IO authority, spec-only "no IO" flagging, idempotency on re-run.
  - `synthesizeRegisterFromContract`: hierarchy → `InstrumentTag[]` with correct ISA-88
    fields + deterministic classification.
  - source-section selection: per-EM matching picks the right sections + global sections,
    respects the length cap.
- **Contract round-trip:** `writeSpecContract` / `loadSpecContract` against the renamed
  `confirmed_units` column (mocked Supabase) — locks the foundation fix.
- **Hydration:** focused test that ingest-commit → hydrate leaves `confirmed_units` /
  `confirmed_states` / `alarm_tiers` populated.
- **Migrations:** `093` (rename + RPC updates), `094` (`spec_source_sections`,
  `instrument_registers.source`) apply cleanly; existing parser/contract tests stay green.
- **Manual smoke (documented):** the three entry paths — `.docx`-only, register-only, both —
  each reach the co-author.

---

## 8. Open items deferred to the plan

- Exhaustive reference list for the column rename (every RPC/view/code site).
- Final placement of section capture/selection (ingest hook vs lib helper) and the prompt
  parameter shape for `buildFdsInterviewSystemPrompt`.
- Resolution of the immutability-trigger interaction for Gap 1 (frontend write vs RPC
  fold-in).
- The section-injection character budget value.
