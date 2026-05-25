# FDS Engine Phase 2 — Migration Wizard + Per-Project Confirmation Flow

**Parent design:** `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` (§5 Migration, §6 Sequencing step 2, §8.1 classifier risk, §8.5 wizard friction, §9 follow-ups #2 + #4).

**Phase 1 reference:** `Docs/superpowers/plans/2026-05-25-fds-engine-phase1-schema.md` (schema, validator, writer/reader routing, ESLint boundary — all merged via PR #3).

**Status when this design was written:** Phase 1 has landed. Schema accepts the new V2 shapes; reader branches on `confirmation_status`; no project in production has been flipped to `confirmed` yet.

---

## 1. Goal & non-goals

### Goal

Ship the per-project engineer-confirm wizard that walks an engineer through three structural migrations (modes axis, PackML state vocabulary, structured inter-assembly interlocks) and flips `confirmation_status` from `unconfirmed` to `confirmed`. After confirmation:

- Phase 1's reader serves the new structured shapes automatically.
- All FDS-builder routes unlock for writes.
- The legacy-shim path only runs for still-unconfirmed projects.

### Non-goals (explicitly deferred)

- **Italian state-name handling** — the 8466 Norte/Sur spec stays unconfirmed until a follow-up wave adds the translation table. Phase 2 ships English/canonical only.
- **Per-mode matrix tabs** — Phase 2 lets engineers *declare* modes but does not render the per-mode authoring grid. That is Phase 6 in the parent design's sequencing.
- **Monitor picker UI** — Phase 4.
- **Materialised `spec_sections` rebuild** — Phase 5.
- **V2 interview prompt rewrite** — Phase 3.
- **"Restore archived conversation" affordance** — in-flight co-author sessions are archived on confirm (per design §5.4); no restore UX in Phase 2.
- **Conflict resolution for two engineers editing the same wizard draft** — last-write-wins on `migration_draft`. Surface a conflict banner only if Phase 2 telemetry shows it happening.

---

## 2. Architecture

### 2.1 Route shape

One new dedicated route: `/spec-builder/:id/migrate` → `src/routes/spec-migrate.tsx`.

Every existing spec-builder route (`/spec-editor`, `/spec-co-author`, `/spec-system-orchestration`, `/spec-export`, `/spec-builder-ingest-review`, plus the list view at `/spec-builder`) renders an `UnconfirmedLockBanner` at the top when the loaded project is unconfirmed, and passes the flag down to disable write affordances. **Read access is unaffected; only writes block.**

The banner copy is short and actionable:

> ⚠ This project is on the V1 schema. [Migrate to V2] to edit.

### 2.2 Wizard shell

Single React route with shadcn `Tabs`. Three tabs, sticky Confirm bar at the bottom.

| Tab | Component | Purpose |
|---|---|---|
| 1. Modes | `migrate-modes-tab.tsx` | Confirm default `auto` mode; optionally add more |
| 2. State vocabulary | `migrate-states-tab.tsx` | Map legacy state names → PackML id / custom_state |
| 3. Interlock structure | `migrate-interlocks-tab.tsx` | Review AI-classified `effect` + `source_condition` per interlock |

The shell only orchestrates navigation and the final commit. Each tab owns one slice of the proposal, one slice of the scratch state, and reports its own `tabComplete: boolean` to the shell. **No nested routes** — the wizard is a single workflow; the three tabs are not independently linkable, and nested routes would complicate autosave-on-tab-switch.

### 2.3 Save semantics

A new `migration_draft jsonb NULL` column on `spec_projects` (migration 089) holds in-progress wizard state, keyed by tab:

```ts
interface MigrationDraft {
  modes?: { rows: OperatorMode[]; tabComplete: boolean };
  states?: { rows: ProposedStateMapping[]; tabComplete: boolean };
  interlocks?: {
    rows: ProposedInterlock[];
    classifiedAt: string;  // ISO timestamp; lets us know when AI cache was filled
    tabComplete: boolean;
  };
}
```

Each tab autosaves to it via `useMigrationDraft(specProjectId)` (debounced upsert). Draft is cleared on successful Confirm. An explicit "Reset draft" button discards the draft and re-runs the first-open proposal computation.

### 2.4 Final-confirm bar

Sticky footer renders the Confirm Migration button, disabled until all three tabs report `tabComplete: true`. Click → `useConfirmMigration` mutation:

1. Client-side `validateSpecContractPatch(assembledPatch)`. Issues → show errors on the offending tab, abort.
2. Single `writeSpecContract(specProjectId, assembledPatch)` call.
3. On success: clear `migration_draft`, emit a `fds_migration_events` row, invalidate `["spec-contract", id]`, redirect to `/spec-builder/:id`.
4. On failure: top-of-page alert with the error list. Draft preserved.

The assembled patch:

```ts
{
  modes: draft.modes.rows,
  states: draft.states.rows,                          // OperatingStateV2[]
  assemblies: applyOverrideKind(existingAssemblies),  // wrap in override_kind:"override" under "auto"
  orchestrations: applyStructuredInterlocks(existingOrchestrations, draft.interlocks.rows),
  confirmation_status: "confirmed",
}
```

`applyOverrideKind` tags every existing `sequential_states[key]` and `static_states[key]` with `override_kind: "override"`. Multi-mode authoring is a Phase 6 concern; Phase 2 commits everything under the single default mode.

---

## 3. Migration proposal computation

All three proposals run **once on wizard first-open** (or after "Reset draft"), persist into `migration_draft`, then become editable scratch state. Subsequent wizard opens re-hydrate from the draft and skip recomputation.

### 3.1 Tab 1 — Modes

**Input.** `confirmed_subsystems` + a heuristic scan of `confirmed_states` for hints (state names matching `/manual/i`, `/service/i`, `/maintenance/i` → suggests multi-mode).

**Proposal.**
```ts
{
  modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
  hints: ["Detected state 'Manual Run' — consider adding a Manual mode", ...],
}
```

**Engineer action.** Confirm the default `auto` mode, optionally add more modes (mode_id + display name; exactly one is_default:true). Phase 1's `validateSpecContractPatch({ modes })` runs client-side; errors show inline.

**Tab complete when:** `validateSpecContractPatch({ modes }).filter(modeRelated).length === 0`.

### 3.2 Tab 2 — State vocabulary

**Input.** `confirmed_states: string[]` (legacy open-set names).

**Proposal.** A deterministic `proposeStateMapping(legacyName: string): StateMappingProposal` in `src/lib/spec-builder/migrate/propose-states.ts`. Match order:

1. Exact case-insensitive match against PackML 17 canonical names → `packml_id` proposed.
2. Hand-curated synonym map (small — only what the 3 in-scope specs need, e.g. `"running" → "Execute"`, `"stopped" → "Stopped"`, `"e-stop" → "Aborting"`).
3. Otherwise → unmapped, flagged for engineer decision.

PackML 17-state names sourced from the OMAC / PLCopen canonical reference per parent design §3.2. No hand-maintained PackML table lives in this design; the implementation imports from the canonical reference module.

**Engineer action per row.** Accept the proposed `packml_id`, remap via dropdown, or mark as **custom** (engineer provides `state_id > 100` and `custom_name`).

**Tab complete when:** every row resolves to a valid `packml_id ∈ 1..17` or a custom state with `custom_name` and `state_id > 100`. (`validateSpecContractPatch({ states })` returns `[]` for the states slice.)

### 3.3 Tab 3 — Interlock structure

**Input.** Every `inter_assembly_interlocks[].source_condition` (prose) + `.effect` (free-text) across all `fds_subsystem_orchestrations` rows for the project.

**Proposal.** Single batch AI classifier call (one Edge Function invocation for the whole project, not one per row) — see `src/lib/spec-builder/migrate/interlock-classifier.ts`. Returns:

```ts
interface ClassifiedInterlock {
  interlock_id: string;
  effect: InterAssemblyInterlockEffect;   // closed enum from Phase 1
  source_condition: CompletionCriterion;  // structured
  confidence: number;                     // 0..1
  reasoning: string;                      // short, shown in row tooltip
}
```

Response Zod-parsed before storing. Stored in `migration_draft.interlocks.rows` so re-opening the wizard doesn't re-bill the AI. Refresh via a single "Re-classify all" button at the tab level (resets the tab's draft slice and re-runs the batch call).

**Engineer action per row.** Inline table with 6 columns: source assembly, target assembly, original prose, AI-proposed effect (dropdown, defaulted from AI), AI-proposed source_condition (link → opens a small builder modal), confidence chip (green ≥0.9 / amber 0.6-0.9 / red <0.6). **No bulk-accept.** Engineer reviews every row.

**Tab complete when:** every row has `effect ∈ enum` and `CompletionCriterionSchema.safeParse(source_condition).success === true`.

---

## 4. Data flow & failure modes

### 4.1 Read path during wizard

```
spec-migrate.tsx mounts
  └─ useSpecContract(id) → loadSpecContract → branches on confirmation_status
      └─ "unconfirmed" → upgradeLegacyRow → V2-shaped contract from V1 columns
          └─ Wizard reads contract.states, contract.orchestrations, contract.hierarchy
              └─ First open → useMigrationProposal computes Tabs 1-2 + kicks off AI for Tab 3
                  └─ Proposal merged into useMigrationDraft → debounced upsert to spec_projects.migration_draft
```

### 4.2 Write path on Confirm

```
useConfirmMigration fires
  └─ validateSpecContractPatch(assembled) → issues → inline errors, abort
  └─ writeSpecContract(id, patch) — one Supabase round-trip
      └─ success → clear migration_draft, emit fds_migration_events row, invalidate, redirect
      └─ failure → ContractValidationError surfaced top-of-page; draft preserved
```

### 4.3 Failure modes

| Failure | Detection | UX |
|---|---|---|
| AI classifier returns invalid JSON | Zod parse on response | Tab 3 shows "AI classification failed". Per-row defaults: `effect: "hold"`, `source_condition: { kind: "placeholder", prompt: original_prose }`. Engineer fills in by hand. "Retry classification" button visible. |
| AI classifier times out | Promise timeout in the hook | Same fallback as above. |
| Engineer enters `state_id` in the invalid 18..100 range | Phase 1 validator | Tab 2 inline error; Confirm disabled. |
| Engineer enters two `is_default:true` modes | Phase 1 validator | Tab 1 inline error; Confirm disabled. |
| `writeSpecContract` fails (network / Supabase / ContractValidationError) | Mutation `onError` | Top-of-page alert with the error list; draft preserved; retry button. |
| Engineer abandons mid-flow | Draft persisted | Next visit re-opens at last active tab with all accepts in place. |
| Engineer clicks "Reset draft" | Explicit click → confirm dialog | `migration_draft = NULL`; wizard recomputes proposal. |
| Two engineers open simultaneously | Last-write-wins on `migration_draft` | Accepted limitation. Banner only if telemetry shows it. |
| Project already confirmed when wizard opens | Route guard at mount | Redirect to `/spec-builder/:id`. |

### 4.4 In-flight co-author conversations

Per parent design §5.4 — archived, not replayed. On successful Confirm, `useConfirmMigration` also calls `archiveConversation(specProjectId)` which sets `fds_co_author_sessions.status = 'archived_by_v2_migration'` on any active session. The Co-Author route reads that status and shows an explanatory empty state. **No restore affordance in Phase 2.**

### 4.5 Telemetry

New table `fds_migration_events` (migration 089):

```sql
CREATE TABLE fds_migration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  modes_count int NOT NULL,
  custom_states_count int NOT NULL,
  interlocks_classified_count int NOT NULL,
  interlocks_overridden_count int NOT NULL  -- proxy for AI miss rate
);
```

One row per Confirm. Gates Release N+2 (legacy field drop) — see parent design §6.

---

## 5. File structure

### Files to create

```
supabase/migrations/
  089_fds_engine_phase2_wizard.sql

src/routes/
  spec-migrate.tsx

src/components/spec-builder/migrate/
  unconfirmed-lock-banner.tsx
  migrate-modes-tab.tsx
  migrate-states-tab.tsx
  migrate-interlocks-tab.tsx
  migrate-interlock-row.tsx
  migrate-confirm-bar.tsx
  __tests__/
    migrate-modes-tab.test.tsx
    migrate-states-tab.test.tsx
    migrate-interlocks-tab.test.tsx

src/hooks/
  use-unconfirmed-lock.ts
  use-migration-proposal.ts
  use-migration-draft.ts
  use-confirm-migration.ts
  use-classify-interlocks.ts
  __tests__/
    use-migration-draft.test.ts
    use-confirm-migration.test.ts

src/lib/spec-builder/migrate/
  propose-modes.ts
  propose-states.ts
  packml-canonical.ts                 — single source of PackML 17-state names + ids
  interlock-classifier.ts
  apply-override-kind.ts
  apply-structured-interlocks.ts      — merges classifier output into legacy orchestration rows
  __tests__/
    propose-modes.test.ts
    propose-states.test.ts
    interlock-classifier.test.ts
    apply-override-kind.test.ts
    apply-structured-interlocks.test.ts

src/lib/spec-builder/migrate/__fixtures__/
  catodo-v1.json
  norte-sur-v1.json                   — English-only slice (Italian portion stripped)
  cvl-2129-v1.json                    — multi-mode hint shape

src/lib/spec-builder/__tests__/
  migration-integration.test.ts
```

### Files to modify

```
src/App.tsx                                    — add /spec-builder/:id/migrate route
src/routes/spec-editor.tsx                     — render banner, disable writes
src/routes/spec-co-author.tsx                  — render banner, disable submit
src/routes/spec-system-orchestration.tsx       — render banner, disable graph edits
src/routes/spec-export.tsx                     — render banner only (already read-only)
src/routes/spec-builder-ingest-review.tsx      — render banner, disable ingest writes
src/routes/spec-builder.tsx                    — list-level "V1" badge with migrate link
```

---

## 6. Testing strategy

**Unit tests** (vitest, mocked Supabase) — one per pure module under `src/lib/spec-builder/migrate/`. Cover the deterministic proposers, classifier response parser, override-kind wrapper.

**Hook tests** (`use-migration-draft`, `use-confirm-migration`) — vitest with the same Supabase mock pattern Phase 1 used in `contract.test.ts`. Assert correct draft upserts on every accept; assert single `writeSpecContract` call on confirm with the right patch shape.

**Component tests** (per tab) — vitest + `@testing-library/react`. Render each tab against a fixture, simulate accept/edit, assert tab-complete state transitions.

**Integration test** (`migration-integration.test.ts`) — for each of the 3 fixtures (Catodo, Norte-Sur English-only slice, CVL-2129), drive the full path: load → compute proposal → simulate engineer accepting → confirm → assert the resulting `writeSpecContract` patch is shape-valid and `SpecContractV2Schema.parse`s. AI classifier mocked with canned `ClassifiedInterlock[]` per fixture.

**Out of scope.** No browser/E2E tests. Manual UI smoke pass before merge.

---

## 7. Sequencing (rough — actual plan will refine)

Roughly 20 tasks:

1. Migration 089 (column + telemetry table).
2. `useUnconfirmedLock` hook + `UnconfirmedLockBanner` component.
3. Banner integration into 5 spec-builder routes (one task per route).
4. `propose-modes` + `propose-states` + `packml-canonical` pure libs + tests.
5. `interlock-classifier` + Edge Function prompt + tests.
6. `use-migration-draft` + tests.
7. `apply-override-kind` + tests.
8. `migrate-modes-tab` + tests.
9. `migrate-states-tab` + tests.
10. `migrate-interlocks-tab` + `migrate-interlock-row` + tests.
11. `migrate-confirm-bar` + `use-confirm-migration` + tests.
12. `spec-migrate.tsx` shell wiring.
13. Fixture capture (3 specs) + `migration-integration.test.ts`.
14. Final sweep: `tsc -b`, `npm test`, `npm run build`, design-doc status note in §6.

---

## 8. What Phase 2 delivers

After Phase 2 lands:

- Engineer sees a **V1** badge on unconfirmed projects, opens one, sees the lock banner on every spec-builder route.
- Clicks Migrate, walks the three tabs, hits Confirm.
- `confirmation_status` flips to `confirmed`. Phase 1's reader returns the new structured shape automatically.
- All spec-builder routes unlock for writes (still on single-mode `auto`; no per-mode authoring UI yet — that is Phase 6).
- AI interlock classifier is in production; accuracy is measured against the per-row override count in `fds_migration_events`.

---

## 9. What still needs Phase 3+

| Phase | Scope |
|---|---|
| 3 | V2 interview prompt rewrite (co-author emits V2 shapes natively) |
| 4 | Monitor picker UI |
| 5 | Materialised `spec_sections` rebuild + editor refactor through `writeSpecContract` |
| 6 | Modes wizard step + per-mode matrix tabs |
| 7 | ISA-88 docs / terminology pass |

Plus the deferred Italian translation table (8466 Norte/Sur), which can land any time as its own narrow follow-up.

---

## 10. Decisions log

Decisions made during brainstorming (2026-05-25):

1. **Wizard placement** → dedicated route `/spec-builder/:id/migrate`. (Design §9 follow-up #2 resolved.)
2. **Trigger / lock semantics** → lock + persistent banner + manual click; no auto-redirect.
3. **Classifier UX** → inline table, every row reviewed, no bulk-accept. Matches design §5.1 wording.
4. **Italian support** → deferred. 8466 stays unconfirmed.
5. **Test corpus** → vitest fixtures + mocked Supabase (3 specs). (Design §9 follow-up #4 resolved.)
6. **Save semantics** → per-tab autosave to `spec_projects.migration_draft`; single final confirm.
7. **Tab routing** → in-page tab state (not nested routes).
8. **Override-kind wrapping** → on Confirm, all existing assemblies tagged `override_kind: "override"` under the default `auto` mode.
9. **AI-failure fallback** → `effect: "hold"` + `source_condition: { kind: "placeholder" }`. Engineer fills in by hand.
10. **Conversation handling** → archived on Confirm, no restore UX in Phase 2.
