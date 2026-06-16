# Handover: IO Register + Foreign Spec Integration

**Date:** 2026-06-16
**Status:** Design needed — gaps identified, no implementation yet

---

## Context

The Spec Builder has a 6-phase pipeline for generating Functional Description Specifications (FDS). The user's desired workflow is:

1. Upload an **IO register** (Excel/CSV) — gives the system *what's connected* (tags, hierarchy, signal types, IO addresses)
2. Upload a **customer functional description** (.docx) — gives the system *what the machine should do* (sequences, fault conditions, process descriptions)
3. The **FDS co-author** merges both sources and fills in the FDS sections with AI assistance

This workflow doesn't work today. The two data sources are disconnected.

---

## What Was Done This Session

### ISA-88 IO Register Redesign

The instrument register pipeline was updated to support all 4 ISA-88 physical model hierarchy levels as explicit columns:

**Process Cell → Unit → Equipment Module → Control Module**

Files changed:
- `src/types/spec-builder.ts` — `InstrumentTag` and `ColumnMapping` now include `process_cell` and `control_module` fields; `CANONICAL_COLUMN_NAMES` maps common header variants
- `src/lib/spec-builder/instrument-parser.ts` — Column detection, row extraction, AI classification prompt, and hierarchy builder all handle the new fields
- `src/components/spec-builder/instrument-register-upload.tsx` — Template downloads with all 9 columns; results table shows full hierarchy

### Parser Robustness

- Expanded deterministic `DEVICE_TYPE_MAP` to handle VSD, thermistor relay, brake contactor, braking resistor, safety relay, maintenance switch, pendant controls, horn/strobe/beacon, circuit breakers, and spare IO
- AI classification is now wrapped in try/catch — parser works fully offline with deterministic-only fallback
- Parse and save are separated — parse results display immediately even if Supabase save fails
- Fixed `units` → `subsystems` column mapping in the save mutation (DB column is `subsystems`, code was sending `units`)

### Test IO Register Created

`Docs/Functional Specs/SRL-Segment-Wagon-IO-Register.xlsx` — 51 IO points for the Herrenknecht Segment Wagon, extracted from the functional specs in that folder. Full ISA-88 hierarchy populated.

### Commits (in order)

1. `e879cca` — `feat(io-register): add all ISA-88 hierarchy levels to instrument register`
2. `0c6ce13` — `fix(io-register): robust parsing without AI, better error handling`
3. `7055bdf` — `fix(io-register): map 'units' to 'subsystems' DB column on save`

---

## The Three Gaps

### Gap 1 — Foreign spec ingest is siloed from the live pipeline

When the user imports a customer `.docx` via "Import foreign spec":

1. `aiIngestDocx()` in `src/lib/spec-builder/ai-ingest.ts` extracts a full `SpecContractV2` (hierarchy, states, sequences, fault conditions)
2. The result goes to an ingest review page (`/specs/ingest-review`)
3. On commit, `create_draft_from_ingest` RPC stores the SpecContractV2 as `snapshot_json` on a `spec_project_revisions` row
4. **The live `spec_projects` row is NOT updated** — `confirmed_units`, `confirmed_states`, `alarm_tiers` remain empty

This means:
- The skeleton wizard (Phase 2) starts from scratch using `buildHierarchyFromTags(register.tags)`, ignoring the rich hierarchy the ingest already extracted
- The co-author (Phase 3) doesn't see any of the ingested equipment module contracts, pre-populated sequences, or fault conditions
- The only bridge is `revert_to_revision` RPC, but that's a manual step the user doesn't know to take

**Fix direction:** After ingest review commit, hydrate `spec_projects.confirmed_units`, `confirmed_states`, and `alarm_tiers` from the ingested SpecContractV2. This could be done in the `create_draft_from_ingest` RPC or in the frontend after the RPC returns.

### Gap 2 — Foreign spec content is absent from FDS prompts

The FDS co-author prompt (`buildFdsInterviewSystemPrompt` in `src/lib/spec-builder/fds-prompts.ts`) only receives:
- The equipment module definition (from `confirmed_units`)
- IO tags (from `register.tags`)
- Session state data (static/sequential states built during the interview)
- Operating states (from `confirmed_states`)

It has **zero access** to the original customer spec text. Process descriptions, sequence logic, fault conditions, interlock requirements — all lost.

**Fix direction:** Store the raw extracted text (or structured sections) from the foreign spec ingest alongside the SpecContractV2. Add it to the FDS prompt as a `## Customer Specification Context` section so the AI can reference the original functional requirements while interviewing.

Possible storage locations:
- New column on `spec_projects` (e.g. `source_spec_text TEXT`)
- New column on `instrument_registers` (unlikely — wrong table)
- Separate table (e.g. `spec_source_documents`)

### Gap 3 — Ingest doesn't create an instrument register

The AI ingest extracts IO signals (tags with signal_type, io_address, description) embedded in the customer spec, but doesn't populate the `instrument_registers` table. The co-author route hard-gates on `register` existing:

```typescript
// spec-co-author.tsx line 61-78
if (!register) {
  return "Instrument register required — Upload the instrument register in Phase 1..."
}
```

So a user who only has a customer spec (no separate IO register spreadsheet) is blocked from reaching the co-author.

**Fix direction:** Two options:
1. **Synthesise an instrument register from the ingest** — after AI ingest, create an `instrument_registers` row from the extracted hierarchy's IO signals. This lets the co-author proceed.
2. **Relax the hard gate** — allow co-author to work with `confirmed_units` alone when no register exists (the hierarchy already contains IO signal data). The register is nice-to-have for the full tag list, but not strictly required if the hierarchy is populated from ingest.

---

## Recommended Design Approach

The simplest path that unblocks the user's workflow:

1. **After foreign spec ingest commit → hydrate `spec_projects`** with the ingested hierarchy, states, and alarm tiers. Skip the wizard or pre-populate it.

2. **Store source spec text** on the spec project (new column or related table). Include it in FDS prompts as reference context.

3. **Synthesise instrument register from ingest** — extract IO signals from the ingested hierarchy and create an `instrument_registers` row. This satisfies the co-author gate and gives the user a reviewable tag list.

4. **Merge when both exist** — when the user uploads BOTH an IO register AND a foreign spec, merge the IO register's precise tag/address data with the foreign spec's process descriptions. The IO register is the authority for *what's connected*; the spec is the authority for *what it does*.

---

## Key Files Reference

| Area | File | Purpose |
|------|------|---------|
| IO register types | `src/types/spec-builder.ts` | `InstrumentTag`, `ColumnMapping`, `CANONICAL_COLUMN_NAMES` |
| IO register parser | `src/lib/spec-builder/instrument-parser.ts` | Column detection, classification, hierarchy builder |
| IO register upload UI | `src/components/spec-builder/instrument-register-upload.tsx` | Upload zone, template download, results table |
| IO register save hook | `src/hooks/use-spec-projects.ts` | `useSaveInstrumentRegister()` — maps `units` → `subsystems` |
| Foreign spec ingest | `src/lib/spec-builder/ai-ingest.ts` | AI extraction of SpecContractV2 from .docx |
| DOCX ingest dispatcher | `src/lib/spec-builder/docx-ingest.ts` | Sentinel detection, routes to deterministic or AI path |
| Ingest hook | `src/hooks/use-spec-ingest.ts` | Orchestrates ingest + navigation to review |
| Ingest review UI | `src/routes/spec-builder-ingest-review.tsx` | User reviews/edits AI-extracted hierarchy before commit |
| Skeleton wizard | `src/components/spec-builder/spec-skeleton-wizard.tsx` | 6-step wizard, reads `register.tags` + `spec.confirmed_units` |
| FDS co-author route | `src/routes/spec-co-author.tsx` | Hard-gates on register, passes spec + register to FdsCoAuthor |
| FDS co-author component | `src/components/spec-builder/fds-co-author.tsx` | Equipment module sidebar, conversation, validation |
| FDS prompt builder | `src/lib/spec-builder/fds-prompts.ts` | `buildFdsInterviewSystemPrompt()` — uses tags + hierarchy only |
| Spec contract | `src/lib/spec-builder/contract.ts` | `readSpecContract()` / `writeSpecContract()` — SpecContractV2 I/O |
| DB schema | `supabase/migrations/054_spec_builder.sql` | `instrument_registers` table (note: column is `subsystems` not `units`) |
