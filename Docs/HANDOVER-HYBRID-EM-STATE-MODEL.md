# Handover — Hybrid Per-EM State Model

**Date:** 2026-06-19
**Branch:** `master` (this work is merged here; commit `8263dfa` is the merge)
**Status:** Feature implemented + merged + DB reconciled. **Two follow-ups remain before the foreign-spec→co-author flow works end-to-end** (see "Next work" — a uuid-id bug and a prompt tuning).

---

## 1. What this delivered

Replaced the single **global** PackML state model with **per-Equipment-Module state machines** (ISA-88 aligned):

- Each Equipment Module owns its own `states` (`EmStateV2[]`) + `transitions` (`EmTransitionV2[]`); behavior maps (`static_states`/`sequential_states`) re-keyed to **EM-local string slugs**.
- Machine level = **modes** (`OperatorMode[]`, seed Auto/Maintenance/Manual) + **safety gates** (`SafetyGateV2[]`, condition → force scoped EMs to their safe state). Inter-EM coordination = permissive guards on transitions. No global orchestration layer.
- **Removed**: global `states`/`unit_procedures` from the contract; the **system-orchestration** subsystem; the entire **legacy V1→V2 spec migrate flow** (kept the unrelated TIA `routes/migrate.tsx`).
- Wizard: global "Operating States" step → **Machine Modes** + **Safety Gates** steps.
- Co-author: **Stage A** (author the EM's own states/transitions) → **Stage B** (per-state behavior), both keyed by EM-local states.
- Random builder emits per-EM machines + safety gates directly.

Design spec: `Docs/superpowers/specs/2026-06-18-hybrid-em-state-model-design.md`
Implementation plan (+ known-red baseline): `Docs/superpowers/plans/2026-06-18-hybrid-em-state-model.md`

All 16 plan tasks + a Stage-A co-author sub-wave were executed TDD, each spec+quality reviewed. **Build is green.** Tests fail **only** on the pre-existing pac-quote baseline (clusters A+D — `quote-snapshot*`, `quote-validation`, `use-issue-quote/variation`, `issue-flow`/`variation-flow` integration, `section-line-items`); these are unrelated to this work and predate it.

---

## 2. Branch / environment state

- **`master`** = the hybrid work (this branch; what to continue from). Being pushed to `origin` now.
- **`feat/project-docs-doc-control`** = separate parallel work that lived in the main checkout on the original PC, with **uncommitted** changes there. NOT part of this handover and NOT pushed — it won't be on the other PC.
- `.claude/worktrees/master-hybrid` was a local test worktree — it does not transfer; ignore it.
- **`.env.local` is gitignored** — the other PC needs it copied over (Supabase URL + keys for project `Pac-Forge-v2`).

### Continue on the other PC
1. `git clone` (or `git pull origin master`) → checkout `master`.
2. Copy `.env.local` from the original PC (has the Supabase keys).
3. `npm install`, `npm run dev`.
4. The Supabase remote (`Pac-Forge-v2`) is **shared** and already reconciled (see §3) — no DB action needed on the other PC.

---

## 3. Database state (IMPORTANT)

The shared remote **Pac-Forge-v2** (id `fsxfdkjjkbkzjntjxiyi`) has been **reconciled to the new schema** and now matches `master`'s code. See [[project_supabase_remote_db_drift]] for the backstory (the remote had skipped repo migration `091`).

Applied via Supabase MCP (migration name `reconcile_hybrid_em_state_model`), verified:
- `fds_assembly_sessions` → `fds_operation_sessions` (+ `unit_id`/`equipment_module_id`, + `em_states`/`em_transitions` jsonb).
- Column renames on `spec_sections`, `spec_alarms`, `fb_templates`.
- Added `spec_projects.process_model`, `spec_projects.safety_gates`.
- Dropped `fds_subsystem_orchestrations`, `fds_system_orchestrations`.
- Rewrote `_build_contract_snapshot` to the hybrid shape (keys: project, hierarchy{units}, alarm_tiers, safety_gates, sections, equipment_modules, io_list, faults, alarms, schema_version=3).
- Migration history rows inserted for `091`, `20260618032808`, `20260618032809` so `supabase db push` won't re-run them.

**Caveats:**
- The catch-up was applied **directly via MCP**, not committed as a repo migration file. Repo migration files `20260618032808_*` and `20260618032809_*` exist on `master`; the latter's RPC body differs slightly from what was applied (the applied RPC adds empty `io_list`/`faults` for Zod-parseable snapshots). **Do not `supabase db push` blindly** against this remote without checking — it's reconciled but the file↔history mapping is bespoke.
- Migration `092` (ISA-88 reference-doc seed) was **not** applied — harmless `on conflict do nothing` seed; run later if the reference doc is wanted.

---

## 4. Next work (the two follow-ups that block the foreign-spec → co-author flow)

The intended flow: upload IO register → skeleton wizard → **Import foreign spec** (⋮ menu) binds the customer's requirements to each EM → co-author interview is **grounded in those requirements and asks refining questions**. Right now the interview asks *cold* because the requirements never reach it. Two fixes:

### 4a. BLOCKER — wizard generates non-UUID equipment_module_ids
**Symptom:** "Import foreign spec" says "N of N modules mapped" but `spec_source_sections` ends up with **0 rows**; co-author shows no spec context.
**Root cause:** the skeleton wizard builds the hierarchy with `equipment_module_id` = the module **name** (e.g. `"Carriage Drive"`), not a UUID:
- `src/components/spec-builder/spec-skeleton-wizard.tsx` → `inferHierarchy` (the AI prompt asks for `"equipment_module_id": "string"` and the model returns names).
- `src/lib/spec-builder/instrument-parser.ts` → `buildHierarchyFromTags` (deterministic path — verify it too).
These name-ids violate the contract's `UuidSchema` AND break the **uuid-typed** `spec_source_sections.equipment_module_id` insert → the bind throws `invalid input syntax for type uuid` and is **swallowed** by a `try/catch` in `src/routes/spec-builder-ingest-review.tsx` (the `// Gap 2` block). Note `fds_operation_sessions.equipment_module_id` is **text** (tolerates name-ids), which is why sessions/skeleton work but source-sections don't — an inconsistency.
**Fix (generic, per CLAUDE.md):** mint `crypto.randomUUID()` for `unit_id`/`equipment_module_id`/`control_module_id` in both hierarchy builders (keep names as display names). Unswallow the ingest-review `try/catch` so persist failures surface. This was **pre-existing** (not introduced by the hybrid work).

### 4b. Prompt tuning — ground-then-refine (the user's actual want)
The co-author interview should **read the EM's bound requirements, propose its understanding of the module's states/behavior, then ask refining/confirming questions** — not interrogate cold. The prompts already *inject* a "Customer Specification Context" block but are framed as "gather one field at a time." Reframe:
- `src/lib/spec-builder/em-state-machine-prompts.ts` → `buildEmStateMachineInterviewPrompt` (Stage A)
- `src/lib/spec-builder/fds-prompts.ts` → `buildFdsInterviewSystemPrompt` (Stage B)
to: (a) read the context, (b) propose a draft understanding, (c) ask to confirm/refine. **Only effective after 4a** (so the context actually reaches the prompt). This is NOT a full "AI auto-authors, user reviews" rewrite — the interview stays, just spec-grounded.

After 4a+4b: **rebuild the Herrenknecht test project** (its name-ids are baked into `confirmed_units` + 5 text sessions) — fresh register → wizard → import foreign spec → co-author.

### 4c. Minor deferred (from the plan, non-blocking)
- Co-author Stage-A is a conversational interview + read-only states pane (no grid editor).
- Dead `generateSpec` orchestrator kept compiling (could be deleted with `use-spec-generate.ts`).
- `FdsHandoff.operatingStates` union now unused; unused `FdsValidationIssue` enum members (`"orchestration"`, `"circular_interlock"`).
- Where to author the co-author flow shift, if ever moving to full auto-author+review.

---

## 5. Test/build status
- `npm run build` → green.
- `npm run lint` → 68 problems (all pre-existing, unrelated files; base commit had 76 — this work reduced them).
- `npx vitest run` → failing set == pac-quote baseline only (8 files). Hybrid contract-level smoke (`src/lib/spec-builder/__tests__/segment-wagon-hybrid.test.ts`) proves the done-bar: two EMs holding independent states + E-Stop gate forcing both to safe + modes.

## 6. Key files for the next session
- Schema: `src/types/spec-contract-v2.ts` (`EmStateV2`, `EmTransitionV2`, `SafetyGateV2`, `EquipmentModuleContract`).
- Logic: `src/lib/spec-builder/em-state-machine.ts` (mode-gating, safety resolution, validation).
- Contract: `src/lib/spec-builder/contract.ts` (read/write em_states/em_transitions/safety_gates; `validateSpecContractPatch`).
- Co-author: `src/hooks/use-fds-conversation.ts` (engine, Stage A/B), `src/components/spec-builder/fds-co-author.tsx` (UI), prompt builders above.
- Wizard: `src/components/spec-builder/spec-skeleton-wizard.tsx`, `src/lib/spec-builder/wizard-machine-layer.ts`.
- Ingest/binding: `src/lib/spec-builder/docx-ingest.ts`, `assemble-register-contract.ts`, `src/routes/spec-builder-ingest-review.tsx`, `src/hooks/use-source-sections.ts`.
