# Handoff — Pac-Quote schema phase complete (Tasks 2–5)

**For the next Claude Code session.** Read this once, then delete or archive when absorbed.

---

## Where we are

- **Branch:** `feature/pac-quote-builder` (off `master`)
- **No PR yet** — open one when v1 (Task 25) is done, or earlier if reviews wanted.
- **Plan:** `Docs/superpowers/plans/2026-05-14-pac-quote-builder-v1.md` (26 tasks total)
- **Task tracker:** `Docs/superpowers/plans/2026-05-14-pac-quote-builder-v1.md.tasks.json` — authoritative; sync after every task
- **Spec:** `Docs/superpowers/specs/2026-05-14-pac-quote-variation-builder-design.md`

### Tasks status

| Task | Subject | Status |
|------|---------|--------|
| 0 | Vitest + RTL scaffolding | ✅ |
| 1 | Migration 075 — customers | ✅ |
| 2 | Migration 076 — quotes/revisions/variations + projects extension | ✅ |
| 3 | Migration 077 — doc content + assumption library seed | ✅ |
| 4 | Migration 078 — T&Cs library | ✅ |
| 5 | Migration 079 — audit log + legacy stub + branding singleton | ✅ |
| 6 | useCustomers hook + unit test | ⏳ next |
| 7–9 | Hooks: quotes/revisions, doc content, T&Cs/library/branding | ⏳ |
| 10–13 | Pure logic: numbering, totals, validation, **snapshot builder** | ⏳ |
| 14–16 | PDF service + edge function + preview pipeline | ⏳ |
| 17–19 | Builder shell + section editors | ⏳ |
| 20 | **Issue flow — atomic transaction (CRITICAL)** | ⏳ |
| 21–24 | Issued view, award, T&Cs admin, list/sidebar | ⏳ |
| 25 | End-to-end sanity integration test | ⏳ |

---

## What's in the DB right now

All five Pac-Quote migrations applied to remote Supabase (`fsxfdkjjkbkzjntjxiyi`):

| Migration | Tables added |
|-----------|--------------|
| 075 | `customers` |
| 076 | `quotes`, `quote_revisions`, `variations` + extends `projects` (`customer_id`, `job_code`, `project_name`, `stage`, `awarded_quote_id`) |
| 077 | `assumption_library` (seeded 8 entries), `doc_scope_items`, `doc_inclusions`, `doc_exclusions`, `doc_assumptions`, `doc_line_items`, `doc_commercial_terms` |
| 078 | `tnc_templates`, `tnc_clauses`, `doc_tnc_selections`, `doc_tnc_override` |
| 079 | `issue_audit_log` (append-only), `legacy_doc_imports` (stub), `company_branding` (singleton, seeded) |

### Type files added/extended

- `src/types/quote.ts` — Quote, QuoteRevision, Variation, status const arrays
- `src/types/project.ts` — extended Project; **ProjectCreate omits new fields** so existing project-create callers stay clean
- `src/types/doc-content.ts` — ParentType, LineItemCategory (snake_case enum + `LINE_ITEM_CATEGORY_LABELS` display map), entity + create types
- `src/types/tnc.ts` — TncStatus, TncTemplate, TncClause, CustomClauseDraft, DocTncSelection, DocTncOverride
- `src/types/issue-audit.ts` — AuditEventType, AuditTargetType, IssueAuditLogEntry, CompanyBranding, LegacyDocImport
- `src/types/index.ts` — re-exports all of the above

---

## Important conventions & decisions worth remembering

1. **`npm run build` baseline is dirty.** ~20+ pre-existing TS errors in `forge-*`, `test-template-suggest`, `routes/forge.tsx`, etc. **Do not gate** on full build/lint. Run targeted `tsc --noEmit` and verify only that your touched files don't introduce *new* errors. See plan line 121.
2. **Migrations use the codebase pattern, not the plan's literal SQL.** Specifically:
   - `extensions.moddatetime(updated_at)` for triggers (NOT `public.set_updated_at()`, which doesn't exist)
   - 4-policy RLS via `DO $$ ... FOREACH t IN ARRAY ... LOOP ... END $$` (see 076–078)
3. **`doc_line_items.category` uses snake_case keys** (`hardware_materials`, `travel_accom`, etc.) — display strings live in `LINE_ITEM_CATEGORY_LABELS` only. If the spec strings need to land in the DB instead, flip in 077 + types together.
4. **`doc_assumptions.assumption_key` is a soft FK** to `assumption_library` (ON DELETE SET NULL) plus a `title` column for inline custom assumptions. CHECK enforces `assumption_key OR title NOT NULL`. Not in the plan literally; added to support spec §13's "plus custom".
5. **`issue_audit_log` is append-only** by RLS (select + insert policies only; no update, no delete). Don't expose mutations.
6. **`ProjectCreate` deliberately omits the new fields** (customer_id, job_code, project_name, stage, awarded_quote_id) so `project-form.tsx` and `use-projects.ts` keep working. Set them via `ProjectUpdate` from the quote flow.
7. **Numeric columns return strings from Supabase** (`numeric` → `string`). Types reflect this (`qty: string | null`). Convert at the totals step (Task 11).
8. **Supabase remote was out of sync** before pushing 076. The tracker said 075 applied but `customers` table didn't exist. Fixed via `npx supabase migration repair --status reverted 075` followed by `db push`. Migrations 075–079 now all show `Local | Remote | Time` aligned.

---

## Things turned off / deferred this session

| Thing | Why | Where to look |
|-------|-----|--------------|
| Monday integration | User-disabled until further notice; CLAUDE.md updated (commit `362142b`). | `git log -p -- CLAUDE.md` to recover the previous workflow. |
| `MONDAY_API_TOKEN` | Not set in env. Local `tasks/tasks.json` got one row before user disabled Monday — fine to leave or delete. | `tasks/tasks.json` (gitignored) |
| `PAC_FORGE_SYSTEM_OVERVIEW.md` | Untracked at repo root, carried in from `feature/assembly-fb-library`. Not part of this branch's work. | Delete, ignore, or move into `Docs/`. |

---

## Commits made this session

```
fa3adef chore(pac-quote): mark Task 5 complete in tasks.json
0ebf1d9 feat(pac-quote): audit log + legacy stub + company branding singleton
5a2f363 chore(pac-quote): mark Task 4 complete in tasks.json
b97bebb feat(tnc): templates, clauses, per-doc selections, override blob
40d2d76 chore(pac-quote): mark Task 3 complete in tasks.json
ed31aae feat(pac-quote): doc content tables + assumption library seed
362142b chore(docs): disable Monday integration until further notice
8e3689e chore(pac-quote): mark Task 2 complete in tasks.json
db4e06a feat(pac-quote): core lifecycle tables (quotes, revisions, variations) + project.stage
```

---

## Picking up at Task 6

**Task 6 is the first hook task and the first TDD task.** It introduces the pattern that Tasks 7–9 follow. Mirrors `src/hooks/use-projects.ts` exactly. Acceptance lives in the plan (lines 612–746 in the plan file).

Suggested kickoff:

1. Open `src/hooks/use-projects.ts` and skim — it's the template for every hook here.
2. Open `Docs/superpowers/plans/2026-05-14-pac-quote-builder-v1.md` at "Task 6: useCustomers hook + unit test".
3. Read `src/test/setup.ts` (set up in Task 0) and `vitest.config.ts` — the test runner is already wired.
4. Write the test first (per TDD). Mock `@/lib/supabase`. The plan gives explicit acceptance criteria: list/get/create/update/delete hooks, mutations invalidate `["customers"]`.
5. Verify: `npm run test -- --run src/hooks/__tests__/use-customers.test.ts` then targeted tsc on the new files.

After Task 6, Tasks 7–9 follow the same shape. They can be done sequentially or in parallel (see the `superpowers-extended-cc:subagent-driven-development` skill if you want to fan them out).

---

## Useful commands

```bash
# Targeted TS check (do this instead of `npm run build`)
npx tsc --noEmit 2>&1 | grep -E "src/types/(quote|doc-content|tnc|issue-audit|index)|src/hooks/use-customers"

# Vitest single-file
npm run test -- --run src/hooks/__tests__/use-customers.test.ts

# Push migrations (already linked to fsxfdkjjkbkzjntjxiyi)
echo "Y" | npx supabase db push

# Check remote migration state
npx supabase migration list

# Branch history
git log master..HEAD --oneline
```
