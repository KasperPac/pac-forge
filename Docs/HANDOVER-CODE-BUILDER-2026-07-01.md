# Handover — Code Builder (C3 shipped + migrations live)

**Date:** 2026-07-01
**Author:** Kasper + Claude (session handover to laptop)
**Repo:** https://github.com/KasperPac/pac-forge

## TL;DR

- **C3 (quality + versioning) is DONE, merged to `master`, and pushed.** All 8 tasks complete.
- **The Code Builder DB migrations are now APPLIED to the remote (Pac-Forge-v2) AND recorded in history.** Persistence is live — no `db push` needed.
- The previously-missing `20260618061905_reconcile_hybrid_em_state_model` migration was backfilled into the repo.
- Everything is on GitHub `master`. Nothing stranded on this machine.

## Git state at handover

| Ref | SHA | Meaning |
|---|---|---|
| `origin/master` | `60171f6` | C3 complete + all code-builder migrations committed. `tsc -b` clean, 331 codegen/code-builder tests green. |

### Resume on the laptop

```bash
git fetch origin
git checkout master && git pull        # gets everything below
npm install
```

> **Environment note:** the repo's `.env.local` (Supabase URL + anon key) is gitignored and will NOT be on the laptop — recreate/copy it, or any vitest suite that transitively imports `src/lib/supabase.ts` fails with "supabaseUrl is required". Remote project is **Pac-Forge-v2** (`fsxfdkjjkbkzjntjxiyi`). The pure codegen/code-builder suites do NOT need it.

### Verify the build

```bash
npx tsc -b                                                  # clean
npx vitest run src/lib/spec-builder src/components/code-builder \
  src/hooks/__tests__/use-em-standards-review.test.ts \
  src/routes/__tests__/code-builder.test.tsx                # 331 passing
```

Known pre-existing failures elsewhere (NOT our work): quote/variation suites fail without `.env.local`. Ignore.

---

## C3 — Quality + Versioning (DONE)

**Plan:** `Docs/superpowers/plans/2026-06-25-code-builder-c3-quality-versioning.md` (+ `.tasks.json`, all 8 complete)

In-builder quality gates (deterministic safety analyzer + on-demand AI Standards Review) and per-EM version history (snapshot / diff / restore) on the EM-layer Code Builder.

**Commits on master:** `6750a9b` (Task 4) → `0574660` (5) → `aaa226f` (6) → `c2a36b2` (7) → `f9600d3` (8) → `5dd339a` (tasks.json).

### What it does (EM-layer FB artifacts only)

- **Safety gate** (`src/lib/spec-builder/fb-quality-gate.ts`, pure): runs the rule-based `safety-analyzer` over the FB's SCL. Each warning gets a stable `warningKey` (`TYPE:line`). Approve is **blocked** while any warning is unacknowledged; acknowledging the last one re-enables it.
- **Standards Review** (`src/hooks/use-em-standards-review.ts`): on-demand AI review of one EM FB, reusing the generic Forge reviewer prompt at the `equipment_module` stage (`buildForgeReviewPrompt`) + `parseForgeReviewResponse`. Result persisted via `saveReview`.
- **Version history** (`src/hooks/use-code-builder-versions.ts` + `fb-version-history.tsx`): append-only snapshots keyed by `owner_id + layer`; diff a snapshot's FB content vs current via `computeDiff`; **non-destructive restore** (writes snapshot content back to `edited_content`). Approve also snapshots a version.
- Wired into `src/routes/code-builder.tsx` (gates + history render under `ArtifactPanel` for EM FBs); `ArtifactPanel` gained `approveDisabled`.

### Files

- Hooks: `use-code-builder.ts` (`acknowledgeWarning`/`saveReview`), `use-code-builder-versions.ts`, `use-em-standards-review.ts`
- Components: `components/code-builder/fb-quality-gates.tsx`, `fb-version-history.tsx` (+ tests)
- Route: `routes/code-builder.tsx`, `components/code-builder/artifact-panel.tsx` (+ `routes/__tests__/code-builder.test.tsx`)
- Migration: `supabase/migrations/20260625000000_code_builder_quality_versioning.sql`

---

## Database — migrations now LIVE on remote

The three Code Builder migrations had **never been pushed** to Pac-Forge-v2 (the remote history had stopped at `20260618061905`). Applied this session **surgically via the Supabase MCP** (NOT `supabase db push` — see drift note) and recorded under their exact filename versions:

| Version | What | How applied |
|---|---|---|
| `20260623000000` | `code_builder_artifacts` table | full DDL (moddatetime trigger confirmed present) |
| `20260624000000` | `fb_templates.interface_contract` | **idempotent** — column already existed out-of-band; recorded history only |
| `20260625000000` | **C3**: `code_builder_versions` table + `acknowledged_warnings`/`review_status`/`review_findings` on artifacts | full DDL |

Verified post-apply: both tables exist, all three C3 columns present, all three versions in `supabase_migrations.schema_migrations`. **Nothing to run on the laptop** — the remote is already correct.

### ⚠️ Remote DB drift — do NOT `supabase db push`

Pac-Forge-v2's migration history diverges from the repo folder (documented in the drift memory). Specifically:
- `090_fds_engine_phase3_unique_constraints` is recorded remotely under a **timestamp** version (`20260526214912`) — a renumbering mismatch that will make `db push` report history drift.
- The 091 ISA-88 rename is recorded but its effect landed via the `20260618061905` catch-up (old table names had persisted).

**To apply any future migration:** run the DDL surgically via MCP `execute_sql` in a `BEGIN;…COMMIT;` block that also does `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('<exact filename version>','<name>');`, and make `ADD COLUMN` idempotent (`IF NOT EXISTS`) since some columns were applied out-of-band. Do NOT `supabase db push` or `migration repair` without reconciling the renumbering first.

---

## Open next step (from the C5 handover, still valid)

**C5's verification does not kick in yet — highest-value next task.** There is no authoring UI for the FB-interface `states` field, so real library EM templates fall to Case B ("coverage unverifiable") instead of Case A (verified) in `compile-contract.ts`. Add a states grid to the FB-library contract editor (alongside the pins grid in `src/components/fb-library/fb-interface-grid.tsx`), with an AI-extract step (read the FB's `CASE` labels) + human review, mirroring how pins already work. See `Docs/HANDOVER-CODE-BUILDER-2026-06-30.md` §"Deferred (KNOWN GAPS)" for full context.

Lower priority: reconcile the remote migration renumbering (090 ↔ 20260526214912) so `db push` becomes usable again.

## Conventions reaffirmed

- **Generic rule (CLAUDE.md, non-negotiable):** all compiler/prompt/pipeline logic generic across machine types. C3's only prompt-touching file (`use-em-standards-review.ts`) reuses `buildForgeReviewPrompt("equipment_module")` — no hard-coded device names. `EM_Pump`/`Motor_Pump` appear only in test fixtures.
- **TS strict:** `import type`, no enums (`as const`), no unused locals.
- **Worktree note:** on the current machine `master` is checked out in a git worktree at `.claude/worktrees/master-hybrid` (the main checkout is on `feat/project-docs-doc-control`). On the laptop just use master normally.
