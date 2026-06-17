# Design: Register-Aware Foreign-Spec Ingest

**Date:** 2026-06-17
**Status:** Design approved — ready for implementation plan
**Supersedes the reconciliation approach in:** `Docs/superpowers/specs/2026-06-16-fds-foreign-spec-integration-design.md`

---

## Why

The first foreign-spec integration built the `.docx` ingest and the IO register as
**two independent pipelines** and tried to reconcile them afterward with a deterministic
matcher at co-author entry. Real data broke it:

- The `.docx` ingest extracts a hierarchy from the document text **alone** — it never reads
  the uploaded register, so the model **invents** control modules and IO that duplicate the
  real register tags.
- The post-hoc merge (`mergeRegisterIntoHierarchy`) matches register tags to spec control
  modules by id / tag / prefix. The real register (Segment Wagon, 51 tags) has **empty**
  `control_module` values and groups by equipment-module **names** (`Carriage Drive`,
  `Rotator Brake`) that share no strings with the AI's names (`Longitudinal Drive`,
  `Segment Rotator`). Nothing matched → all IO would fall into an "Unassigned" bucket.
- The same naming gap silently broke Gap 2: source sections are matched to a co-author
  module by name, so `.docx` context never reached the right module either.

A spike confirmed the fix direction: given **both** the register structure and the `.docx`,
a capable model maps the document's process language onto the register's real equipment
modules cleanly (Rail Movement → Carriage Drive/Brake/Limits; Segment Rotator → Rotator
Drive/Brake; e-stop/maintenance/safety-relay → E-Stop Circuit; flashing light + horn →
Travel Indicators; generator → Power Distribution). The semantic bind is exactly what an LLM
is good at and what string matching cannot do.

## Goal

When both a register and a customer `.docx` exist, produce **one coherent hierarchy**: the
register's real structure + IO, with the document's process/sequence/fault/description
content bound to the correct modules — no invented duplicate IO, no post-hoc reconciliation.

## Non-Goals

- Pre-generating per-state sequences at ingest. Sequence authoring stays interactive in the
  co-author; the ingest only binds requirements + extracts machine-level states/faults/process.
- Manual drag-to-reassign of a mis-bound requirement in the review UI (later enhancement).
- Changing the co-author conversation itself beyond how it receives per-EM context.

---

## Architecture — two modes, one ingest

The ingest is **register-aware**. It chooses a path automatically by whether the project
already has an `upload` register:

```
                        ┌─ register present ──► DETERMINISTIC structure from register
                        │   (buildHierarchyFromTags → real EMs/CMs/IO, minted UUIDs)
ingest .docx ──► route ─┤        + AI MAPPING pass (Opus 4.8): .docx → each EM (source_requirements)
                        │          + machine-level states / faults / process_model / unit name
                        │
                        └─ no register ──► AI structure (current path) + mint UUIDs
                                            + synthesize register (existing)
```

Both modes converge on the same downstream shape: a `SpecContractV2` with minted UUIDs and
per-EM `source_requirements`, hydrated to `spec_projects.confirmed_*`.

---

## 1. Register-present path (the core)

### Step 1 — Deterministic structure

`buildHierarchyFromTags(register.tags)` (existing, `instrument-parser.ts`) produces the real
hierarchy: unit → equipment modules (from the register's `equipment_module` column) →
control modules (from tag device prefixes, e.g. `CM1`, `VSD1`, `BR1`, `M5`, `SR1`) → IO
signals (the real tags + addresses + signal types).

A deterministic **UUID-minting** pass then assigns RFC-4122 v4 UUIDs to every `unit_id`,
`equipment_module_id`, `control_module_id`, keeping the human names as `*_name`. No model
involvement. This is the canonical structure.

### Step 2 — AI mapping pass (Opus 4.8)

Input to the model:
- the Step-1 structure rendered as a compact list: each EM with its name, its CM names, and
  each CM's tags + `device_type`s (so coded names like `CM1`/`VSD1`/`SR1`/`MS1`/`M5` decode);
- the full `.docx` raw text.

The model returns JSON constrained to the **ids it was given**:
- per `equipment_module_id`: `source_requirements` — the `.docx` narrative/requirements
  relevant to that module (prose);
- machine-level: `states` (operating states), `faults`, `process_model`, and a suggested
  `unit_name` (the register's unit is blank → defaults to "UNGROUPED" without this).

### Step 3 — Validate + assemble (deterministic)

- **Id-validation guard:** every `equipment_module_id` the model returns must be one we
  provided; unknown ids are dropped (logged as warnings). The model can never alter or
  invent structure.
- Assemble the `SpecContractV2`: hierarchy + IO from Step 1; `source_requirements` attached
  per EM; `states` / `faults` / `process_model` / `unit_name` from Step 2.
- Hydrate `spec_projects.confirmed_units` / `confirmed_states` / `alarm_tiers` (the existing
  `useUpdateSpecProject` path).

---

## 2. `.docx`-only path (no register)

Keeps today's behavior — the model builds the hierarchy from the document — with two
hardening additions so it stops emitting malformed output:

- **Deterministic UUID minting** over the model's output (mints a v4 UUID for any
  `unit_id` / `equipment_module_id` / `control_module_id` that is not already a valid UUID).
  This eliminates the `Invalid UUID` warnings. `schema_version` is set deterministically to
  `3` in post-processing rather than trusted from the model.
- **Synthesize a register** from the resulting hierarchy (existing
  `synthesizeRegisterFromContract`) so the co-author gate passes.

The model is asked to also emit per-EM `source_requirements` here (natural, since it is
already producing the hierarchy from the `.docx`), so the downstream shape matches the
register-present path.

---

## 3. Removed / changed components

- **Removed — the co-author merge.** Delete `mergeRegisterIntoHierarchy`
  (`merge-register-hierarchy.ts`) and the merge `useEffect` + banner in `spec-co-author.tsx`.
  Structure is unified at ingest, so there is nothing to reconcile at co-author entry.
- **Changed — Gap 2 binding.** `spec_source_sections` gains an `equipment_module_id` column
  (nullable) that the AI mapping populates with the bound EM. `source-section-select` is
  replaced by a deterministic "fetch sections for this `equipment_module_id`" query — the
  name-matching logic is removed. (Raw sections remain stored for reference/audit.)
  - Implementation note: the per-EM `source_requirements` prose is the primary context. The
    section rows become the auditable backing store, keyed to the EM by id.
- **New — `mintHierarchyUuids(hierarchy)`** deterministic helper (idempotent; only mints for
  non-UUID ids). Used by both modes.
- **New — `assembleContractFromRegister(structure, mapping)`** deterministic helper for the
  register-present path (Step 3), including the id-validation guard.
- **New — the register-aware ingest entry** that loads the project's `upload` register, runs
  Step 1, calls the mapping pass, and assembles. Lives alongside `ai-ingest.ts` /
  `docx-ingest.ts`; `ingestDocx` is extended to accept the register (or its absence).

---

## 4. Review UX

The ingest-review page (`spec-builder-ingest-review.tsx`) gains a register-present rendering:

- Shows the **register-derived** hierarchy (real EMs/CMs) — not an AI-invented tree.
- Per EM, shows a short summary of the bound `.docx` `source_requirements`, and the suggested
  unit name.
- Shows **coverage** so the engineer can trust the mapping:
  `N EMs mapped · M EMs with no document content (e.g. Spare, Power Distribution) · K document areas unbound`.
- Names stay editable (existing). Manual reassignment of a mis-bound requirement is out of
  scope for v1.

The `.docx`-only review is unchanged.

---

## 5. Model & testing

- **Model:** the mapping pass runs on **Opus 4.8** (`claude-opus-4-8`) via the `generate`
  edge function's `model` override. The `.docx`-only structure pass moves to Opus too (same
  extraction difficulty).
- **Deterministic helpers → vitest:**
  - `mintHierarchyUuids`: idempotent; mints only non-UUID ids; preserves names + IO.
  - `assembleContractFromRegister`: register structure + mapping → `SpecContractV2`; correct
    UUIDs; `source_requirements` attached to the right EM.
  - id-validation guard: unknown ids returned by the model are dropped.
  - section→EM binding query.
- **AI mapping → golden/manual validation** against the real Segment Wagon `.docx` +
  51-tag register (the spike data). Automated tests mock the model.
- **End-to-end smoke, all three paths**, with the both-sources path verified to produce one
  coherent hierarchy with `.docx` requirements on the correct modules — run on the real
  Segment Wagon data **before** the work is called complete.

---

## 6. Open items deferred to the plan

- Exact JSON schema of the mapping-pass response and its Zod validator.
- Where `source_requirements` is stored (EM field on `confirmed_units` vs the
  `spec_source_sections` row keyed by `equipment_module_id`) — pin one in the plan; the
  section-row approach is preferred for reuse.
- The prompt text for the mapping pass (constrained-id instructions, decode hints for coded
  tags via `device_type`).
- Whether to keep `source-section-select.ts` as a thin id-based query or fold it into
  `use-source-sections`.
