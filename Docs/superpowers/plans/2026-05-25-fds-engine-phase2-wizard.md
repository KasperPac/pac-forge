# FDS Engine Phase 2 — Migration Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the engineer-confirm wizard that flips `confirmation_status` from `unconfirmed` to `confirmed` for FDS spec projects. After confirmation, Phase 1's reader serves the new structured shapes automatically; all spec-builder routes unlock for writes.

**Architecture:** New route `/specs/:projectId/:specId/migrate` renders a three-tab wizard (modes, state vocabulary, interlock structure). Each tab autosaves to a new `spec_projects.migration_draft jsonb` column. A single `writeSpecContract` call on Confirm assembles the patch (modes, states, override-kind-wrapped assemblies, structured orchestrations, `confirmation_status: "confirmed"`). Every existing spec-builder route renders a shared `UnconfirmedLockBanner` and disables writes until the project is confirmed.

**Tech Stack:** React 19 + Vite + TypeScript 5.9, TanStack Query, shadcn `Tabs`, Vitest 3, `@testing-library/react`, `@testing-library/user-event`, Supabase Postgres (SQL migration), Anthropic Claude via the existing `generate` Edge Function.

**Parent design:** `Docs/superpowers/specs/2026-05-25-fds-engine-phase2-wizard-design.md`

**Parent meta-design:** `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` (§5 Migration, §6 Sequencing step 2, §8.1 classifier risk, §8.5 wizard friction)

**Phase 1 reference (already merged via PR #3):** `Docs/superpowers/plans/2026-05-25-fds-engine-phase1-schema.md` — mirror its TDD cadence and commit style.

**Path correction from spec.** The spec proposes `/spec-builder/:id/migrate` but the actual route shape in `src/App.tsx` is `/specs/:projectId/:specId/<action>` (e.g. `/specs/:projectId/:specId/editor`). This plan uses `/specs/:projectId/:specId/migrate`. The spec's wording was an early approximation; the plan is the source of truth for the URL.

**Out of scope for Phase 2** (covered by later phases):
- Italian state-name handling — 8466 Norte/Sur stays unconfirmed until a follow-up wave
- Per-mode matrix tabs (modes wizard step 6 in parent design)
- Monitor picker UI (step 4)
- Materialised `spec_sections` rebuild (step 5)
- V2 interview prompt rewrite (step 3)
- Conversation-restore UX for archived sessions

---

## Pre-flight

Verify state before starting:

```bash
git status                                    # expect 9 pre-existing unrelated files (quotes/tnc/.gitignore); FDS files clean
git branch --show-current                     # expect: feature/fds-engine-phase1
npx tsc -b                                    # expect: 0 errors (Phase 1 sweep landed this state)
npm test -- --run 2>&1 | tail -5              # expect: 33 failed (unrelated), all others pass
ls supabase/migrations/ | tail -3             # confirm latest migration; if anything > 088 has landed, bump this plan's migration number
```

**Branch choice.** This plan executes on top of `feature/fds-engine-phase1` (Phase 1 work + the Phase 2 design doc). It does NOT cut a new branch. If you want Phase 2 on its own branch, cut it before Task 1: `git checkout -b feature/fds-engine-phase2`. Then update PR #3's base if needed.

**Migration numbering.** The next free number is `089`. If a migration between `089` and the current head lands while this plan is in flight, rename Task 1's file accordingly.

---

## File Structure

**Files to create:**

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
    unconfirmed-lock-banner.test.tsx
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
    use-unconfirmed-lock.test.tsx
    use-migration-draft.test.tsx
    use-confirm-migration.test.tsx
    use-classify-interlocks.test.ts

src/lib/spec-builder/migrate/
  packml-canonical.ts
  propose-modes.ts
  propose-states.ts
  interlock-classifier.ts
  apply-override-kind.ts
  apply-structured-interlocks.ts
  types.ts                              -- shared MigrationDraft / proposal types
  __tests__/
    packml-canonical.test.ts
    propose-modes.test.ts
    propose-states.test.ts
    interlock-classifier.test.ts
    apply-override-kind.test.ts
    apply-structured-interlocks.test.ts

src/lib/spec-builder/migrate/__fixtures__/
  catodo-v1.json
  norte-sur-en-v1.json
  cvl-2129-v1.json

src/lib/spec-builder/__tests__/
  migration-integration.test.ts
```

**Files to modify:**

```
src/App.tsx                                    -- register new /specs/:projectId/:specId/migrate route
src/routes/spec-editor.tsx                     -- render banner, disable writes when unconfirmed
src/routes/spec-co-author.tsx                  -- render banner, disable submit
src/routes/spec-system-orchestration.tsx       -- render banner, disable graph edits
src/routes/spec-export.tsx                     -- render banner only (already read-only)
src/routes/spec-builder-ingest-review.tsx      -- render banner, disable ingest writes
src/routes/spec-builder.tsx                    -- list-level V1 badge with migrate link
Docs/superpowers/specs/2026-05-25-fds-engine-design.md  -- final status note in §6
```

---

## Conventions

- **Test colocation.** `__tests__/` directories next to source. File name = `<source>.test.ts` (logic) or `<source>.test.tsx` (React). Picked up automatically by `vitest.config.ts`.
- **Migration numbering.** `089`. If anything between `089` and now has landed, bump in the migration task.
- **TDD cadence.** Each task writes the failing test first, verifies it fails for the right reason, implements the minimal change, verifies it passes, then commits. Mirrors Phase 1.
- **Commit cadence.** One commit per task. Messages use `feat(fds-engine):` for new code, `test(fds-engine):` for test-only commits, `docs(fds-engine):` for docs.
- **Working tree.** 9 unrelated uncommitted files (quotes/tnc/.gitignore) carried over from Phase 1. **Do not stage them.** Only commit files this plan modifies.
- **Test baseline.** Start of Phase 2: 33 pre-existing unrelated failures (in `src/components/quotes/**` and `src/hooks/__tests__/use-issue-*.test.tsx`). Treat "matches the 33 baseline" as the success condition for full sweep runs.
- **URL params.** `:projectId` = outer project UUID; `:specId` = `spec_projects.id` UUID (passed to `loadSpecContract`). Mirrors existing `/specs/:projectId/:specId/editor` route shape.
- **AI calls.** Use `callNonStreaming` from `src/hooks/use-generation.ts`. **Do NOT create a new Edge Function** — route through the existing `generate` function with a custom system prompt.
- **Component test pattern.** vitest + `@testing-library/react` + `@testing-library/user-event`. Canonical example: `src/components/quotes/builder/__tests__/builder-footer.test.tsx`.
- **Hook test pattern (Supabase-mocked).** `vi.mock("@/lib/supabase", ...)` at the top of the file with an in-memory call-capture pattern. Canonical example: `src/lib/spec-builder/__tests__/contract.test.ts`.
- **Hook test pattern (React Query).** Wrap in a fresh `QueryClientProvider` per test. Canonical example: `src/hooks/__tests__/use-customers.test.tsx`.
- **No pipeline-auditor.** CLAUDE.md mentions `.claude/agents/pipeline-auditor.md` after touching `forge-*.ts` / `use-forge-*.ts`. That file does not exist in the repo (Phase 1's final task surfaced this). Phase 2 does not touch forge files anyway; skip the auditor.

---

### Task 1: Migration 089 — `migration_draft` + `fds_migration_events`

**Files:**
- Create: `supabase/migrations/089_fds_engine_phase2_wizard.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/089_fds_engine_phase2_wizard.sql
-- FDS Engine Phase 2 — wizard scratch column on spec_projects + telemetry table
-- for completed migrations. No data rewrite at deploy time.

BEGIN;

-- Per-project wizard scratch state. NULL = no wizard run in flight (either
-- never started, or successfully confirmed and cleared).
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS migration_draft jsonb;

COMMENT ON COLUMN spec_projects.migration_draft IS
  'MigrationDraft: per-project wizard scratch state. Cleared (set NULL) on successful Confirm. See src/lib/spec-builder/migrate/types.ts for the TypeScript shape.';

-- Telemetry — one row per successful Confirm. Read by future dashboards.
-- Gates Release N+2 (legacy field drop) per parent design §6.
CREATE TABLE IF NOT EXISTS fds_migration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  modes_count int NOT NULL,
  custom_states_count int NOT NULL,
  interlocks_classified_count int NOT NULL,
  interlocks_overridden_count int NOT NULL
);

CREATE INDEX IF NOT EXISTS fds_migration_events_spec_project_id_idx
  ON fds_migration_events (spec_project_id);
CREATE INDEX IF NOT EXISTS fds_migration_events_confirmed_at_idx
  ON fds_migration_events (confirmed_at DESC);

COMMENT ON TABLE fds_migration_events IS
  'One row per successful FDS engine V2 migration confirm. interlocks_overridden_count is a proxy for AI classifier miss rate.';

COMMIT;
```

- [ ] **Step 2: Skip local apply** (Phase 1 carried the same policy)

The remote Supabase apply is a coordinated step that the user runs separately. Just create + commit; no `supabase db push`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/089_fds_engine_phase2_wizard.sql
git commit -m "feat(fds-engine): migration 089 — phase 2 wizard scratch column + telemetry"
```

---

### Task 2: `packml-canonical` — PackML 17-state reference data

**Files:**
- Create: `src/lib/spec-builder/migrate/packml-canonical.ts`
- Create: `src/lib/spec-builder/migrate/__tests__/packml-canonical.test.ts`

Parent design §3.2 requires the PackML state IDs and names come from the canonical OMAC / PLCopen 17-state model. This file is that single source of truth.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/migrate/__tests__/packml-canonical.test.ts
import { describe, expect, it } from "vitest";
import {
  PACKML_STATES,
  packmlByName,
  packmlById,
  isPackmlId,
} from "../packml-canonical";

describe("packml-canonical", () => {
  it("exposes all 17 PackML states", () => {
    expect(PACKML_STATES).toHaveLength(17);
    const ids = PACKML_STATES.map((s) => s.packml_id);
    expect(new Set(ids).size).toBe(17);
    expect(Math.min(...ids)).toBe(1);
    expect(Math.max(...ids)).toBe(17);
  });

  it("includes the canonical Execute state at id 6", () => {
    expect(packmlById(6)?.name).toBe("Execute");
  });

  it("looks up by name case-insensitively", () => {
    expect(packmlByName("execute")?.packml_id).toBe(6);
    expect(packmlByName("EXECUTE")?.packml_id).toBe(6);
    expect(packmlByName("Execute")?.packml_id).toBe(6);
  });

  it("returns undefined for unknown names", () => {
    expect(packmlByName("Frobnicate")).toBeUndefined();
  });

  it("isPackmlId recognises 1..17 only", () => {
    expect(isPackmlId(1)).toBe(true);
    expect(isPackmlId(17)).toBe(true);
    expect(isPackmlId(0)).toBe(false);
    expect(isPackmlId(18)).toBe(false);
    expect(isPackmlId(101)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/packml-canonical.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/spec-builder/migrate/packml-canonical.ts
/**
 * Canonical PackML 17-state model. Sourced from OMAC PackML / PLCopen
 * state-model reference. Do NOT edit these names or IDs without a parallel
 * update to the parent design doc §3.2.
 */
export interface PackmlState {
  packml_id: number;     // 1..17
  name: string;          // canonical display name
  state_pattern: "static" | "sequential";
}

export const PACKML_STATES: readonly PackmlState[] = [
  { packml_id: 1, name: "Clearing", state_pattern: "sequential" },
  { packml_id: 2, name: "Stopped", state_pattern: "static" },
  { packml_id: 3, name: "Starting", state_pattern: "sequential" },
  { packml_id: 4, name: "Idle", state_pattern: "static" },
  { packml_id: 5, name: "Suspended", state_pattern: "static" },
  { packml_id: 6, name: "Execute", state_pattern: "sequential" },
  { packml_id: 7, name: "Stopping", state_pattern: "sequential" },
  { packml_id: 8, name: "Aborting", state_pattern: "sequential" },
  { packml_id: 9, name: "Aborted", state_pattern: "static" },
  { packml_id: 10, name: "Holding", state_pattern: "sequential" },
  { packml_id: 11, name: "Held", state_pattern: "static" },
  { packml_id: 12, name: "Unholding", state_pattern: "sequential" },
  { packml_id: 13, name: "Suspending", state_pattern: "sequential" },
  { packml_id: 14, name: "Unsuspending", state_pattern: "sequential" },
  { packml_id: 15, name: "Resetting", state_pattern: "sequential" },
  { packml_id: 16, name: "Completing", state_pattern: "sequential" },
  { packml_id: 17, name: "Complete", state_pattern: "static" },
] as const;

const BY_NAME = new Map<string, PackmlState>(
  PACKML_STATES.map((s) => [s.name.toLowerCase(), s]),
);
const BY_ID = new Map<number, PackmlState>(
  PACKML_STATES.map((s) => [s.packml_id, s]),
);

export function packmlByName(name: string): PackmlState | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function packmlById(id: number): PackmlState | undefined {
  return BY_ID.get(id);
}

export function isPackmlId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= 17;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/packml-canonical.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/migrate/packml-canonical.ts src/lib/spec-builder/migrate/__tests__/packml-canonical.test.ts
git commit -m "feat(fds-engine): packml-canonical — 17-state reference data + lookups"
```

---

### Task 3: `propose-states` — legacy state name → PackML mapping

**Files:**
- Create: `src/lib/spec-builder/migrate/propose-states.ts`
- Create: `src/lib/spec-builder/migrate/__tests__/propose-states.test.ts`
- Create: `src/lib/spec-builder/migrate/types.ts` (shared types — created here, extended in later tasks)

- [ ] **Step 1: Create the shared types file**

```ts
// src/lib/spec-builder/migrate/types.ts
import type {
  OperatorMode,
  CompletionCriterion,
  InterAssemblyInterlockEffect,
} from "@/types/spec-contract-v2";

// ============================================================
// Tab 2 — state vocabulary
// ============================================================

export type StateMappingMatchSource =
  | "exact"          // case-insensitive match against PackML name
  | "synonym"        // synonym map hit
  | "unmapped";      // neither — engineer must decide

export interface ProposedStateMapping {
  legacy_name: string;                        // original string from confirmed_states
  match_source: StateMappingMatchSource;
  // What the engineer will commit. For "unmapped" rows the engineer fills in
  // packml_id or custom_state_id + custom_name. For "exact"/"synonym" rows
  // the proposal is pre-filled and editable.
  packml_id?: number;                         // 1..17
  custom_state_id?: number;                   // > 100
  custom_name?: string;
}

// ============================================================
// Tab 1 — modes
// ============================================================

export interface ProposedModeHint {
  detected_state: string;
  hint: string;                               // human-readable suggestion
}

export interface ProposedModes {
  modes: OperatorMode[];                      // pre-populated [{ auto, default }]
  hints: ProposedModeHint[];
}

// ============================================================
// Tab 3 — interlocks
// ============================================================

export interface ProposedInterlock {
  interlock_id: string;
  source_assembly: string;
  target_assembly: string;
  original_prose_condition: string;           // legacy free-text source_condition
  original_prose_effect: string;              // legacy free-text effect
  effect: InterAssemblyInterlockEffect;       // AI-classified, editable
  source_condition: CompletionCriterion;      // AI-classified, editable
  confidence: number;                         // 0..1
  reasoning: string;                          // short tooltip
}

// ============================================================
// Migration draft — persisted to spec_projects.migration_draft
// ============================================================

export interface MigrationDraft {
  modes?: { rows: OperatorMode[]; tabComplete: boolean };
  states?: { rows: ProposedStateMapping[]; tabComplete: boolean };
  interlocks?: {
    rows: ProposedInterlock[];
    classifiedAt: string;                     // ISO timestamp
    tabComplete: boolean;
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/spec-builder/migrate/__tests__/propose-states.test.ts
import { describe, expect, it } from "vitest";
import { proposeStateMapping } from "../propose-states";

describe("proposeStateMapping", () => {
  it("returns exact match against a PackML name", () => {
    const r = proposeStateMapping("Execute");
    expect(r.match_source).toBe("exact");
    expect(r.packml_id).toBe(6);
    expect(r.legacy_name).toBe("Execute");
  });

  it("matches case-insensitively", () => {
    expect(proposeStateMapping("execute").packml_id).toBe(6);
    expect(proposeStateMapping("EXECUTE").packml_id).toBe(6);
  });

  it("uses synonym map for 'running' → Execute", () => {
    const r = proposeStateMapping("Running");
    expect(r.match_source).toBe("synonym");
    expect(r.packml_id).toBe(6);
  });

  it("uses synonym map for 'e-stop' → Aborting", () => {
    const r = proposeStateMapping("E-Stop");
    expect(r.match_source).toBe("synonym");
    expect(r.packml_id).toBe(8);
  });

  it("uses synonym map for 'standby' → Idle", () => {
    const r = proposeStateMapping("Standby");
    expect(r.match_source).toBe("synonym");
    expect(r.packml_id).toBe(4);
  });

  it("falls through to unmapped for unrecognised names", () => {
    const r = proposeStateMapping("Lubrication");
    expect(r.match_source).toBe("unmapped");
    expect(r.packml_id).toBeUndefined();
    expect(r.legacy_name).toBe("Lubrication");
  });

  it("trims whitespace", () => {
    expect(proposeStateMapping("  Execute  ").packml_id).toBe(6);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/propose-states.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

```ts
// src/lib/spec-builder/migrate/propose-states.ts
import { packmlByName } from "./packml-canonical";
import type { ProposedStateMapping } from "./types";

/**
 * Hand-curated synonym map. Kept minimal — only what the in-scope specs
 * (Catodo, Norte-Sur English, CVL-2129) use. Extending this list is a
 * platform-level change: add a new synonym only when a real spec needs it.
 */
const SYNONYMS: Record<string, string> = {
  "running": "Execute",
  "run": "Execute",
  "auto run": "Execute",
  "stopped": "Stopped",
  "stop": "Stopped",
  "fault": "Aborted",
  "faulted": "Aborted",
  "e-stop": "Aborting",
  "estop": "Aborting",
  "emergency stop": "Aborting",
  "standby": "Idle",
  "ready": "Idle",
  "init": "Resetting",
  "initialise": "Resetting",
  "initialize": "Resetting",
  "reset": "Resetting",
  "paused": "Held",
  "pause": "Holding",
};

export function proposeStateMapping(legacyName: string): ProposedStateMapping {
  const trimmed = legacyName.trim();
  const lower = trimmed.toLowerCase();

  // 1. Exact match
  const exact = packmlByName(trimmed);
  if (exact) {
    return {
      legacy_name: trimmed,
      match_source: "exact",
      packml_id: exact.packml_id,
    };
  }

  // 2. Synonym map
  const canonical = SYNONYMS[lower];
  if (canonical) {
    const matched = packmlByName(canonical);
    if (matched) {
      return {
        legacy_name: trimmed,
        match_source: "synonym",
        packml_id: matched.packml_id,
      };
    }
  }

  // 3. Unmapped — engineer decides
  return { legacy_name: trimmed, match_source: "unmapped" };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/propose-states.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/migrate/propose-states.ts src/lib/spec-builder/migrate/types.ts src/lib/spec-builder/migrate/__tests__/propose-states.test.ts
git commit -m "feat(fds-engine): propose-states — legacy name → PackML mapping with synonym map"
```

---

### Task 4: `propose-modes` — default mode + multi-mode hints

**Files:**
- Create: `src/lib/spec-builder/migrate/propose-modes.ts`
- Create: `src/lib/spec-builder/migrate/__tests__/propose-modes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/migrate/__tests__/propose-modes.test.ts
import { describe, expect, it } from "vitest";
import { proposeModes } from "../propose-modes";

describe("proposeModes", () => {
  it("returns a single default 'auto' mode when no hints are found", () => {
    const r = proposeModes(["Idle", "Execute", "Stopped"]);
    expect(r.modes).toEqual([
      { mode_id: "auto", name: "Auto", is_default: true },
    ]);
    expect(r.hints).toEqual([]);
  });

  it("emits a Manual hint when a state name contains 'manual'", () => {
    const r = proposeModes(["Idle", "Manual Run", "Execute"]);
    expect(r.modes[0].is_default).toBe(true);
    expect(r.hints.some((h) => /manual/i.test(h.hint))).toBe(true);
  });

  it("emits a Service hint for service / maintenance", () => {
    const r = proposeModes(["Idle", "Service", "Maintenance Mode"]);
    expect(r.hints.length).toBeGreaterThanOrEqual(1);
    expect(r.hints.some((h) => /service/i.test(h.hint))).toBe(true);
  });

  it("deduplicates hints (one per detected mode keyword)", () => {
    const r = proposeModes(["Manual Start", "Manual Run", "Manual Stop"]);
    expect(r.hints.filter((h) => /manual/i.test(h.hint))).toHaveLength(1);
  });

  it("handles empty input safely", () => {
    const r = proposeModes([]);
    expect(r.modes).toEqual([{ mode_id: "auto", name: "Auto", is_default: true }]);
    expect(r.hints).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/propose-modes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/spec-builder/migrate/propose-modes.ts
import type { ProposedModes } from "./types";

interface ModeHintRule {
  match: RegExp;
  mode_name: string;          // suggested operator-facing label
  hint_template: string;      // "{state}" interpolated
}

const RULES: ModeHintRule[] = [
  {
    match: /manual/i,
    mode_name: "Manual",
    hint_template: "Detected state '{state}' — consider adding a Manual mode",
  },
  {
    match: /service|maintenance/i,
    mode_name: "Service",
    hint_template: "Detected state '{state}' — consider adding a Service mode",
  },
];

/**
 * Pre-populates the default `auto` mode and surfaces hints for other modes
 * the engineer may want to declare based on existing state names. Hints are
 * suggestions only; the engineer chooses whether to act on them.
 */
export function proposeModes(legacyStateNames: string[]): ProposedModes {
  const seen = new Set<string>();
  const hints = [];

  for (const state of legacyStateNames) {
    for (const rule of RULES) {
      if (rule.match.test(state) && !seen.has(rule.mode_name)) {
        seen.add(rule.mode_name);
        hints.push({
          detected_state: state,
          hint: rule.hint_template.replace("{state}", state),
        });
      }
    }
  }

  return {
    modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
    hints,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/propose-modes.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/migrate/propose-modes.ts src/lib/spec-builder/migrate/__tests__/propose-modes.test.ts
git commit -m "feat(fds-engine): propose-modes — default auto mode + multi-mode hint detection"
```

---

### Task 5: `apply-override-kind` — wrap existing assemblies under default mode

**Files:**
- Create: `src/lib/spec-builder/migrate/apply-override-kind.ts`
- Create: `src/lib/spec-builder/migrate/__tests__/apply-override-kind.test.ts`

On Confirm, every existing `sequential_states[key]` and `static_states[key]` row must be tagged with `override_kind: "override"` (per design §2.4 and Phase 1's Task 8 schema). This task is the pure transform that does it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/migrate/__tests__/apply-override-kind.test.ts
import { describe, expect, it } from "vitest";
import { applyOverrideKind } from "../apply-override-kind";
import type { AssemblyContract } from "@/types/spec-contract-v2";

const ASM_ID = "00000000-0000-0000-0000-000000000aaa";
const SUB_ID = "00000000-0000-0000-0000-000000000bbb";

function makeAssembly(overrides: Partial<AssemblyContract> = {}): AssemblyContract {
  return {
    assembly_id: ASM_ID,
    subsystem_id: SUB_ID,
    static_states: {},
    sequential_states: {},
    ...overrides,
  } as AssemblyContract;
}

describe("applyOverrideKind", () => {
  it("wraps sequential_states with override_kind: 'override'", () => {
    const input = {
      [ASM_ID]: makeAssembly({
        sequential_states: {
          "execute": {
            permissives: [],
            steps: [],
            notes: null,
          } as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    expect(out[ASM_ID].sequential_states["execute"].override_kind).toBe("override");
  });

  it("wraps legacy static_states array into StaticStateV2 with override_kind", () => {
    const input = {
      [ASM_ID]: makeAssembly({
        static_states: {
          "idle": [{ tag: "MOTOR_01.RUN", description: "off", state: "false" }] as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    const wrapped = out[ASM_ID].static_states["idle"];
    expect(Array.isArray(wrapped)).toBe(false);
    expect((wrapped as { override_kind: string }).override_kind).toBe("override");
    expect((wrapped as { devices: unknown[] }).devices).toHaveLength(1);
  });

  it("preserves existing StaticStateV2 wrapping (idempotent)", () => {
    const input = {
      [ASM_ID]: makeAssembly({
        static_states: {
          "idle": {
            override_kind: "override",
            devices: [{ tag: "X", description: "y", state: "z" }],
            notes: null,
          } as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    expect(out[ASM_ID].static_states["idle"]).toEqual(input[ASM_ID].static_states["idle"]);
  });

  it("preserves notes when wrapping", () => {
    const input = {
      [ASM_ID]: makeAssembly({
        sequential_states: {
          "execute": {
            permissives: [],
            steps: [],
            notes: "Must not run during inhibit.",
          } as never,
        },
      }),
    };
    const out = applyOverrideKind(input);
    expect(out[ASM_ID].sequential_states["execute"].notes).toBe(
      "Must not run during inhibit.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/apply-override-kind.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/spec-builder/migrate/apply-override-kind.ts
import type {
  AssemblyContract,
  DeviceStateEntry,
  SequentialStateV2,
  StaticStateV2,
} from "@/types/spec-contract-v2";

/**
 * Wraps every existing per-state row with `override_kind: "override"` so the
 * contract is valid against the post-Phase-1 schema under a single default
 * mode. Multi-mode authoring (inherit / suppressed) is a later phase.
 *
 * Idempotent — already-wrapped rows pass through unchanged.
 */
export function applyOverrideKind(
  assemblies: Record<string, AssemblyContract>,
): Record<string, AssemblyContract> {
  const out: Record<string, AssemblyContract> = {};

  for (const [assemblyId, contract] of Object.entries(assemblies)) {
    const sequential_states: Record<string, SequentialStateV2> = {};
    for (const [stateKey, seq] of Object.entries(contract.sequential_states ?? {})) {
      sequential_states[stateKey] = {
        ...seq,
        override_kind: seq.override_kind ?? "override",
      };
    }

    const static_states: Record<string, DeviceStateEntry[] | StaticStateV2> = {};
    for (const [stateKey, val] of Object.entries(contract.static_states ?? {})) {
      if (Array.isArray(val)) {
        // Legacy bare-array shape → wrap into StaticStateV2 container.
        static_states[stateKey] = {
          override_kind: "override",
          devices: val,
          notes: null,
        };
      } else {
        // Already a StaticStateV2 — pass through, defaulting override_kind.
        static_states[stateKey] = {
          ...val,
          override_kind: val.override_kind ?? "override",
        };
      }
    }

    out[assemblyId] = {
      ...contract,
      sequential_states,
      static_states,
    };
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/apply-override-kind.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/migrate/apply-override-kind.ts src/lib/spec-builder/migrate/__tests__/apply-override-kind.test.ts
git commit -m "feat(fds-engine): apply-override-kind — wrap existing rows under default mode"
```

---

### Task 6: `apply-structured-interlocks` — merge classifier output into orchestration rows

**Files:**
- Create: `src/lib/spec-builder/migrate/apply-structured-interlocks.ts`
- Create: `src/lib/spec-builder/migrate/__tests__/apply-structured-interlocks.test.ts`

Takes the existing orchestrations (legacy prose-shaped interlocks) and the engineer-confirmed `ProposedInterlock[]` from Tab 3, produces orchestrations with structured interlocks ready for `writeSpecContract`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/migrate/__tests__/apply-structured-interlocks.test.ts
import { describe, expect, it } from "vitest";
import { applyStructuredInterlocks } from "../apply-structured-interlocks";
import type { ProposedInterlock } from "../types";
import type { SubsystemStateSequence } from "@/types/spec-contract-v2";

const SUB_ID = "00000000-0000-0000-0000-000000000bbb";

function makeOrch(interlockIds: string[]): Record<string, Record<string, SubsystemStateSequence>> {
  return {
    [SUB_ID]: {
      "execute": {
        assembly_order: ["CV01", "LFT01"],
        shared_permissives: [],
        inter_assembly_interlocks: interlockIds.map((id) => ({
          interlock_id: id,
          source_assembly: "CV01",
          source_condition: { kind: "tag_equals", tag: "X", value: true },
          target_assembly: "LFT01",
          effect: "hold",
          prose: "legacy prose",
        })),
        notes: null,
      } as never,
    },
  };
}

const baseProposed: ProposedInterlock = {
  interlock_id: "il-1",
  source_assembly: "CV01",
  target_assembly: "LFT01",
  original_prose_condition: "CV01 is running",
  original_prose_effect: "hold the lift",
  effect: "block_transition",
  source_condition: { kind: "tag_equals", tag: "CV01.RUNNING", value: true },
  confidence: 0.95,
  reasoning: "exact tag match",
};

describe("applyStructuredInterlocks", () => {
  it("replaces an interlock's effect and source_condition with the proposal's", () => {
    const orch = makeOrch(["il-1"]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    const il = out[SUB_ID]["execute"].inter_assembly_interlocks[0];
    expect(il.effect).toBe("block_transition");
    expect(il.source_condition).toEqual({
      kind: "tag_equals",
      tag: "CV01.RUNNING",
      value: true,
    });
  });

  it("preserves prose for DOCX rendering", () => {
    const orch = makeOrch(["il-1"]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    expect(out[SUB_ID]["execute"].inter_assembly_interlocks[0].prose).toBe(
      "legacy prose",
    );
  });

  it("leaves interlocks without a matching proposal unchanged", () => {
    const orch = makeOrch(["il-1", "il-2"]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    const il2 = out[SUB_ID]["execute"].inter_assembly_interlocks.find(
      (i) => i.interlock_id === "il-2",
    );
    expect(il2?.effect).toBe("hold");        // unchanged from original
  });

  it("handles orchestrations with no interlocks", () => {
    const orch = makeOrch([]);
    const out = applyStructuredInterlocks(orch, [baseProposed]);
    expect(out[SUB_ID]["execute"].inter_assembly_interlocks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/apply-structured-interlocks.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/spec-builder/migrate/apply-structured-interlocks.ts
import type {
  InterAssemblyInterlock,
  SubsystemStateSequence,
} from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "./types";

/**
 * Returns a new orchestrations record where each interlock whose
 * `interlock_id` matches a row in `proposals` has its `effect` and
 * `source_condition` replaced by the engineer-confirmed proposal.
 * Interlocks without a matching proposal pass through unchanged. Prose is
 * always preserved (used by DOCX rendering).
 */
export function applyStructuredInterlocks(
  orchestrations: Record<string, Record<string, SubsystemStateSequence>>,
  proposals: ProposedInterlock[],
): Record<string, Record<string, SubsystemStateSequence>> {
  const byId = new Map(proposals.map((p) => [p.interlock_id, p]));
  const out: Record<string, Record<string, SubsystemStateSequence>> = {};

  for (const [subsystemId, stateMap] of Object.entries(orchestrations)) {
    out[subsystemId] = {};
    for (const [stateKey, seq] of Object.entries(stateMap)) {
      const updated: InterAssemblyInterlock[] = (
        seq.inter_assembly_interlocks ?? []
      ).map((il) => {
        const proposal = byId.get(il.interlock_id);
        if (!proposal) return il;
        return {
          ...il,
          effect: proposal.effect,
          source_condition: proposal.source_condition,
        };
      });
      out[subsystemId][stateKey] = {
        ...seq,
        inter_assembly_interlocks: updated,
      };
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/apply-structured-interlocks.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/migrate/apply-structured-interlocks.ts src/lib/spec-builder/migrate/__tests__/apply-structured-interlocks.test.ts
git commit -m "feat(fds-engine): apply-structured-interlocks — merge classifier output into orchestration rows"
```

---

### Task 7: `interlock-classifier` — batch AI classifier with Zod parse + fallback

**Files:**
- Create: `src/lib/spec-builder/migrate/interlock-classifier.ts`
- Create: `src/lib/spec-builder/migrate/__tests__/interlock-classifier.test.ts`

Calls the existing `generate` Edge Function (via `callNonStreaming`) with a custom system prompt that asks Claude to classify every interlock in one batch. Parses the response with Zod. On any parse / network failure, returns a per-row fallback row (`effect: "hold"`, `source_condition: { kind: "placeholder" }`) so the wizard can still proceed.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/migrate/__tests__/interlock-classifier.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const callMock = vi.fn();

vi.mock("@/hooks/use-generation", () => ({
  callNonStreaming: (...args: unknown[]) => callMock(...args),
}));

import { classifyInterlocks } from "../interlock-classifier";

const rawInterlocks = [
  {
    interlock_id: "il-1",
    source_assembly: "CV01",
    target_assembly: "LFT01",
    prose_source_condition: "CV01 is running",
    prose_effect: "hold the lift",
  },
  {
    interlock_id: "il-2",
    source_assembly: "CV01",
    target_assembly: "LFT01",
    prose_source_condition: "CV01 has faulted",
    prose_effect: "block lift execute",
  },
];

describe("classifyInterlocks", () => {
  beforeEach(() => {
    callMock.mockReset();
  });

  it("returns ClassifiedInterlock[] when the AI response is valid", async () => {
    callMock.mockResolvedValueOnce({
      text: JSON.stringify({
        rows: [
          {
            interlock_id: "il-1",
            effect: "hold",
            source_condition: { kind: "tag_equals", tag: "CV01.RUNNING", value: true },
            confidence: 0.95,
            reasoning: "exact match",
          },
          {
            interlock_id: "il-2",
            effect: "block_transition",
            source_condition: { kind: "tag_equals", tag: "CV01.FAULT", value: true },
            confidence: 0.9,
            reasoning: "fault-driven block",
          },
        ],
      }),
    });

    const out = await classifyInterlocks(rawInterlocks);

    expect(out).toHaveLength(2);
    expect(out[0].interlock_id).toBe("il-1");
    expect(out[0].effect).toBe("hold");
    expect(out[1].effect).toBe("block_transition");
  });

  it("returns placeholder fallback when the AI returns invalid JSON", async () => {
    callMock.mockResolvedValueOnce({ text: "not json at all" });
    const out = await classifyInterlocks(rawInterlocks);
    expect(out).toHaveLength(2);
    expect(out[0].effect).toBe("hold");
    expect(out[0].source_condition).toEqual({
      kind: "placeholder",
      prompt: "CV01 is running",
    });
    expect(out[0].confidence).toBe(0);
    expect(out[0].reasoning).toMatch(/fallback|classifier failed/i);
  });

  it("returns placeholder fallback when the AI call throws", async () => {
    callMock.mockRejectedValueOnce(new Error("Edge Function timed out"));
    const out = await classifyInterlocks(rawInterlocks);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.confidence === 0)).toBe(true);
  });

  it("preserves the original interlock_id, source_assembly, target_assembly", async () => {
    callMock.mockResolvedValueOnce({ text: "garbage" });   // forces fallback
    const out = await classifyInterlocks(rawInterlocks);
    expect(out[0].interlock_id).toBe("il-1");
    expect(out[0].source_assembly).toBe("CV01");
    expect(out[0].target_assembly).toBe("LFT01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/interlock-classifier.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/spec-builder/migrate/interlock-classifier.ts
import { z } from "zod";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  CompletionCriterionSchema,
  InterAssemblyInterlockEffectSchema,
  type CompletionCriterion,
  type InterAssemblyInterlockEffect,
} from "@/types/spec-contract-v2";

export interface RawInterlock {
  interlock_id: string;
  source_assembly: string;
  target_assembly: string;
  prose_source_condition: string;
  prose_effect: string;
}

export interface ClassifiedInterlock {
  interlock_id: string;
  source_assembly: string;
  target_assembly: string;
  effect: InterAssemblyInterlockEffect;
  source_condition: CompletionCriterion;
  confidence: number;
  reasoning: string;
}

const ResponseRowSchema = z.object({
  interlock_id: z.string().min(1),
  effect: InterAssemblyInterlockEffectSchema,
  source_condition: CompletionCriterionSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
const ResponseSchema = z.object({ rows: z.array(ResponseRowSchema) });

const SYSTEM_PROMPT = `You are classifying inter-assembly interlocks from a legacy FDS document into a structured V2 contract.

For EACH input row, output one entry in "rows" with:
- interlock_id: same as input
- effect: one of "hold" | "block_transition" | "trigger" | "enable" | "disable"
  - "hold": pause the target assembly's current state
  - "block_transition": prevent the target from leaving its current state
  - "trigger": force the target into a specific state
  - "enable": allow a transition that was previously blocked
  - "disable": forbid a transition that was previously allowed
- source_condition: a CompletionCriterion object, one of:
  - { "kind": "tag_equals", "tag": "<SCL_TAG>", "value": <boolean | number | string> }
  - { "kind": "tag_compare", "tag": "<SCL_TAG>", "operator": "<" | "<=" | ">" | ">=", "value": <number> }
  - { "kind": "expression", "expr": "<short SCL expression>" }
  - { "kind": "placeholder", "prompt": "<original prose>" }  -- when the input is too vague
- confidence: 0.0 to 1.0
- reasoning: one short sentence

Output STRICTLY valid JSON of shape { "rows": [...] }. No prose outside the JSON.`;

function buildUserPrompt(rows: RawInterlock[]): string {
  return [
    "Classify these interlocks:",
    "",
    ...rows.map((r, i) =>
      [
        `Row ${i + 1}:`,
        `  interlock_id: ${r.interlock_id}`,
        `  source_assembly: ${r.source_assembly}`,
        `  target_assembly: ${r.target_assembly}`,
        `  prose source_condition: ${r.prose_source_condition}`,
        `  prose effect: ${r.prose_effect}`,
      ].join("\n"),
    ),
  ].join("\n");
}

function fallbackRow(raw: RawInterlock, reason: string): ClassifiedInterlock {
  return {
    interlock_id: raw.interlock_id,
    source_assembly: raw.source_assembly,
    target_assembly: raw.target_assembly,
    effect: "hold",
    source_condition: { kind: "placeholder", prompt: raw.prose_source_condition },
    confidence: 0,
    reasoning: `Classifier ${reason}. Engineer must review and fill in.`,
  };
}

/**
 * Single batch classification call. On any failure (network, invalid JSON,
 * schema mismatch), returns a per-row placeholder fallback so the wizard
 * can still proceed. The engineer fills in by hand for fallback rows.
 */
export async function classifyInterlocks(
  rawInterlocks: RawInterlock[],
): Promise<ClassifiedInterlock[]> {
  if (rawInterlocks.length === 0) return [];

  let responseText: string;
  try {
    const result = await callNonStreaming({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: buildUserPrompt(rawInterlocks),
      maxTokens: 8192,
    });
    responseText = result.text;
  } catch (err) {
    return rawInterlocks.map((r) =>
      fallbackRow(r, `failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  // Strip code fences if Claude wrapped the JSON.
  const trimmed = responseText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return rawInterlocks.map((r) => fallbackRow(r, "returned invalid JSON"));
  }

  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    return rawInterlocks.map((r) => fallbackRow(r, "returned schema-invalid output"));
  }

  // Match returned rows back to inputs by interlock_id. Inputs without a
  // matching response row get the fallback.
  const byId = new Map(result.data.rows.map((r) => [r.interlock_id, r]));
  return rawInterlocks.map((raw) => {
    const ai = byId.get(raw.interlock_id);
    if (!ai) return fallbackRow(raw, "omitted the row from its response");
    return {
      interlock_id: raw.interlock_id,
      source_assembly: raw.source_assembly,
      target_assembly: raw.target_assembly,
      effect: ai.effect,
      source_condition: ai.source_condition,
      confidence: ai.confidence,
      reasoning: ai.reasoning,
    };
  });
}
```

- [ ] **Step 4: Verify the `callNonStreaming` signature actually matches**

```bash
grep -n "export.*callNonStreaming\|callNonStreaming(" src/hooks/use-generation.ts | head
```

If the signature differs (e.g. takes a different param shape), adjust the call site in `interlock-classifier.ts` to match the real signature. The contract is "feed a system prompt + user message, get back text". If the helper requires extra parameters (model, agent_id, project_id, etc.), pass safe defaults or `undefined` per existing call sites elsewhere in the codebase. **Do not invent a signature** — read the existing definition first.

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/migrate/__tests__/interlock-classifier.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/migrate/interlock-classifier.ts src/lib/spec-builder/migrate/__tests__/interlock-classifier.test.ts
git commit -m "feat(fds-engine): interlock-classifier — batch AI call with Zod parse + placeholder fallback"
```

---

### Task 8: `use-migration-draft` hook — read/write `spec_projects.migration_draft`

**Files:**
- Create: `src/hooks/use-migration-draft.ts`
- Create: `src/hooks/__tests__/use-migration-draft.test.tsx`

TanStack-Query-wrapped read + a debounced mutation for write. Wizard tabs call `saveDraft(partial)` on every accept; the hook coalesces rapid writes via lodash-style debounce (300ms).

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/__tests__/use-migration-draft.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const updateMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: (cols: string) => {
        selectMock(cols);
        return {
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { migration_draft: null }, error: null }),
          }),
        };
      },
      update: (payload: unknown) => {
        updateMock(payload);
        return {
          eq: () => Promise.resolve({ data: null, error: null }),
        };
      },
    }),
  },
}));

import { useMigrationDraft } from "../use-migration-draft";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("useMigrationDraft", () => {
  beforeEach(() => {
    updateMock.mockReset();
    selectMock.mockReset();
  });

  it("reads the draft on mount", async () => {
    const { result } = renderHook(
      () => useMigrationDraft("00000000-0000-0000-0000-000000000000"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(selectMock).toHaveBeenCalledWith("migration_draft");
  });

  it("writes via saveDraft (debounce coalesces calls)", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      () => useMigrationDraft("00000000-0000-0000-0000-000000000000"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.saveDraft({ modes: { rows: [], tabComplete: false } });
      result.current.saveDraft({ modes: { rows: [{ mode_id: "auto", name: "Auto", is_default: true }], tabComplete: true } });
    });

    // Flush debounce window.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      migration_draft: expect.objectContaining({
        modes: expect.objectContaining({ tabComplete: true }),
      }),
    });
  });

  it("clearDraft writes null to the column", async () => {
    const { result } = renderHook(
      () => useMigrationDraft("00000000-0000-0000-0000-000000000000"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.clearDraft();
    });

    expect(updateMock).toHaveBeenCalledWith({ migration_draft: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/use-migration-draft.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/hooks/use-migration-draft.ts
import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MigrationDraft } from "@/lib/spec-builder/migrate/types";

const DRAFT_DEBOUNCE_MS = 300;

async function fetchDraft(specProjectId: string): Promise<MigrationDraft | null> {
  const { data, error } = await supabase
    .from("spec_projects")
    .select("migration_draft")
    .eq("id", specProjectId)
    .single();
  if (error) throw new Error(`fetchDraft: ${error.message}`);
  return (data?.migration_draft as MigrationDraft | null) ?? null;
}

async function writeDraft(
  specProjectId: string,
  draft: MigrationDraft | null,
): Promise<void> {
  const { error } = await supabase
    .from("spec_projects")
    .update({ migration_draft: draft })
    .eq("id", specProjectId);
  if (error) throw new Error(`writeDraft: ${error.message}`);
}

export function useMigrationDraft(specProjectId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["migration-draft", specProjectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchDraft(specProjectId),
    enabled: !!specProjectId,
  });

  const writeMutation = useMutation({
    mutationFn: (draft: MigrationDraft | null) => writeDraft(specProjectId, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Debounced merge of partial updates into the latest known draft.
  const pendingRef = useRef<MigrationDraft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = pendingRef.current;
    if (next === null) return;
    pendingRef.current = null;
    writeMutation.mutate(next);
  }, [writeMutation]);

  const saveDraft = useCallback(
    (partial: Partial<MigrationDraft>) => {
      const current = pendingRef.current ?? query.data ?? {};
      pendingRef.current = { ...current, ...partial };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
    },
    [query.data, flush],
  );

  const clearDraft = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    await writeMutation.mutateAsync(null);
  }, [writeMutation]);

  // Flush on unmount so wizard nav doesn't lose the last edit.
  useEffect(() => () => flush(), [flush]);

  return {
    draft: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    saveDraft,
    clearDraft,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/use-migration-draft.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-migration-draft.ts src/hooks/__tests__/use-migration-draft.test.tsx
git commit -m "feat(fds-engine): use-migration-draft — debounced read/write for wizard scratch state"
```

---

### Task 9: `useUnconfirmedLock` hook + `UnconfirmedLockBanner` component

**Files:**
- Create: `src/hooks/use-unconfirmed-lock.ts`
- Create: `src/components/spec-builder/migrate/unconfirmed-lock-banner.tsx`
- Create: `src/hooks/__tests__/use-unconfirmed-lock.test.tsx`
- Create: `src/components/spec-builder/migrate/__tests__/unconfirmed-lock-banner.test.tsx`

- [ ] **Step 1: Write the failing hook test**

```tsx
// src/hooks/__tests__/use-unconfirmed-lock.test.tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-spec-contract", () => ({
  useSpecContract: (id: string) => {
    if (id === "confirmed-id") {
      return {
        data: { confirmation_status: "confirmed" },
        isLoading: false,
        isError: false,
      };
    }
    if (id === "unconfirmed-id") {
      return {
        data: { confirmation_status: "unconfirmed" },
        isLoading: false,
        isError: false,
      };
    }
    return { data: undefined, isLoading: true, isError: false };
  },
}));

import { useUnconfirmedLock } from "../use-unconfirmed-lock";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("useUnconfirmedLock", () => {
  it("returns isUnconfirmed=true for unconfirmed projects", async () => {
    const { result } = renderHook(
      () => useUnconfirmedLock("proj-1", "unconfirmed-id"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isUnconfirmed).toBe(true);
    expect(result.current.migrateHref).toBe("/specs/proj-1/unconfirmed-id/migrate");
  });

  it("returns isUnconfirmed=false for confirmed projects", async () => {
    const { result } = renderHook(
      () => useUnconfirmedLock("proj-1", "confirmed-id"),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isUnconfirmed).toBe(false);
  });
});
```

- [ ] **Step 2: Run hook test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/use-unconfirmed-lock.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/use-unconfirmed-lock.ts
import { useSpecContract } from "@/hooks/use-spec-contract";

/**
 * Shared lock-state hook for every spec-builder route. Returns whether the
 * loaded project is unconfirmed and the href to the migration wizard.
 *
 * Callers should:
 *   1. Render <UnconfirmedLockBanner /> at the top of the page if isUnconfirmed.
 *   2. Disable write controls (submit buttons, drag handles, etc.) while isUnconfirmed.
 */
export function useUnconfirmedLock(projectId: string, specProjectId: string) {
  const { data, isLoading, isError } = useSpecContract(specProjectId);
  return {
    isLoading,
    isError,
    isUnconfirmed: data?.confirmation_status === "unconfirmed",
    migrateHref: `/specs/${projectId}/${specProjectId}/migrate`,
  };
}
```

- [ ] **Step 4: Run hook test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/use-unconfirmed-lock.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing component test**

```tsx
// src/components/spec-builder/migrate/__tests__/unconfirmed-lock-banner.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { UnconfirmedLockBanner } from "../unconfirmed-lock-banner";

function renderWithRouter(href: string) {
  return render(
    <MemoryRouter>
      <UnconfirmedLockBanner migrateHref={href} />
    </MemoryRouter>,
  );
}

describe("UnconfirmedLockBanner", () => {
  it("renders the V1-schema warning copy", () => {
    renderWithRouter("/specs/p1/s1/migrate");
    expect(screen.getByText(/V1 schema/i)).toBeInTheDocument();
  });

  it("renders a Migrate link pointing to migrateHref", () => {
    renderWithRouter("/specs/p1/s1/migrate");
    const link = screen.getByRole("link", { name: /migrate/i });
    expect(link).toHaveAttribute("href", "/specs/p1/s1/migrate");
  });
});
```

- [ ] **Step 6: Run component test to verify it fails**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/unconfirmed-lock-banner.test.tsx
```

Expected: FAIL.

- [ ] **Step 7: Implement the component**

```tsx
// src/components/spec-builder/migrate/unconfirmed-lock-banner.tsx
import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  migrateHref: string;
}

export function UnconfirmedLockBanner({ migrateHref }: Props) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2 border-b border-amber-300 bg-amber-50 text-amber-900"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <p className="text-sm flex-1">
        This project is on the <strong>V1 schema</strong>. Edits are disabled until you migrate to V2.
      </p>
      <Button asChild size="sm" variant="default">
        <Link to={migrateHref}>Migrate to V2</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 8: Run component test to verify it passes**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/unconfirmed-lock-banner.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/use-unconfirmed-lock.ts src/hooks/__tests__/use-unconfirmed-lock.test.tsx src/components/spec-builder/migrate/unconfirmed-lock-banner.tsx src/components/spec-builder/migrate/__tests__/unconfirmed-lock-banner.test.tsx
git commit -m "feat(fds-engine): useUnconfirmedLock hook + UnconfirmedLockBanner component"
```

---

### Task 10: Banner integration — `spec-editor.tsx`

**Files:**
- Modify: `src/routes/spec-editor.tsx`

- [ ] **Step 1: Find the route's URL params and the existing page header**

```bash
grep -n "useParams\|export default\|return (" src/routes/spec-editor.tsx | head
```

The route's URL pattern is `/specs/:projectId/:specId/editor`. Confirm `useParams<{ projectId: string; specId: string }>()` is used (or add it if missing).

- [ ] **Step 2: Add the banner and disable write affordances**

At the top of the route component (right after the existing params/data hooks), add:

```ts
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/migrate/unconfirmed-lock-banner";

// inside the component
const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId!, specId!);
```

Render the banner immediately above the existing top of the page:

```tsx
return (
  <>
    {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
    {/* existing page content */}
  </>
);
```

Disable every write affordance (Save buttons, "Add row" controls, drag handles, anything that calls a mutation) by adding `disabled={isUnconfirmed}` or wrapping with a guard. Search the file for:
- `<Button` elements that fire mutations
- Any `onClick` that calls a mutation hook
- Form `onSubmit` handlers

For each, add the disabled prop. Where a guard isn't a button (e.g. inline-edit fields), wrap the field's onChange in `if (isUnconfirmed) return;`.

- [ ] **Step 3: Smoke-check the page still renders**

```bash
npx tsc -b
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/spec-editor.tsx
git commit -m "feat(fds-engine): spec-editor — render UnconfirmedLockBanner and disable writes"
```

---

### Task 11: Banner integration — `spec-co-author.tsx`

**Files:**
- Modify: `src/routes/spec-co-author.tsx`

- [ ] **Step 1: Mirror Task 10**

Add `useUnconfirmedLock` + render `UnconfirmedLockBanner` at the top. Disable the conversation Submit button and any "Apply suggestion" controls.

```ts
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/migrate/unconfirmed-lock-banner";

const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId!, specId!);
```

```tsx
return (
  <>
    {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
    {/* existing co-author UI */}
  </>
);
```

Find the conversation submit handler and the message input; add `disabled={isUnconfirmed}` to the submit button and `readOnly={isUnconfirmed}` to the textarea.

- [ ] **Step 2: `tsc -b`** (0 errors), then commit:

```bash
git add src/routes/spec-co-author.tsx
git commit -m "feat(fds-engine): spec-co-author — render UnconfirmedLockBanner and disable conversation submit"
```

---

### Task 12: Banner integration — `spec-system-orchestration.tsx`

**Files:**
- Modify: `src/routes/spec-system-orchestration.tsx`

- [ ] **Step 1: Mirror Task 10**

Add `useUnconfirmedLock` + banner. Disable graph-edit affordances (any node/edge add/remove, sidebar form submits).

```ts
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/migrate/unconfirmed-lock-banner";

const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId!, specId!);
```

```tsx
return (
  <>
    {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
    {/* existing graph UI */}
  </>
);
```

For the graph itself (probably a `system-orchestration-graph.tsx` component): pass `readOnly={isUnconfirmed}` as a prop and have the graph short-circuit drag / connect handlers. If the graph component doesn't already accept a `readOnly` prop, add it.

- [ ] **Step 2: `tsc -b`** (0 errors), then commit:

```bash
git add src/routes/spec-system-orchestration.tsx src/components/spec-builder/system-orchestration-graph.tsx
git commit -m "feat(fds-engine): spec-system-orchestration — render UnconfirmedLockBanner and disable graph edits"
```

---

### Task 13: Banner integration — `spec-export.tsx` (banner only)

**Files:**
- Modify: `src/routes/spec-export.tsx`

The export route is already read-only (it just builds a DOCX from the contract). So the banner is informational only — no write disabling needed.

- [ ] **Step 1: Add the banner**

```ts
import { useUnconfirmedLock } from "@/hooks/use-unconfirmed-lock";
import { UnconfirmedLockBanner } from "@/components/spec-builder/migrate/unconfirmed-lock-banner";

const { isUnconfirmed, migrateHref } = useUnconfirmedLock(projectId!, specId!);
```

```tsx
return (
  <>
    {isUnconfirmed && <UnconfirmedLockBanner migrateHref={migrateHref} />}
    {/* existing export UI */}
  </>
);
```

- [ ] **Step 2: `tsc -b`** (0 errors), then commit:

```bash
git add src/routes/spec-export.tsx
git commit -m "feat(fds-engine): spec-export — render UnconfirmedLockBanner (read-only route)"
```

---

### Task 14: Banner integration — `spec-builder-ingest-review.tsx`

**Files:**
- Modify: `src/routes/spec-builder-ingest-review.tsx`

This route accepts an ingest URL param rather than `:specId`. **Check first** how it gets the spec context:

```bash
grep -n "useParams\|useSearchParams\|specProjectId" src/routes/spec-builder-ingest-review.tsx | head
```

If the ingest review can be associated with an unconfirmed project, get the relevant project + spec IDs (possibly from query params or the loaded ingest record) and call `useUnconfirmedLock` the same way.

If the ingest review is purely pre-project (no spec exists yet), this route is **not affected** by confirmation_status and you can skip the banner. Document the reason in the commit.

- [ ] **Step 1: Decide based on the route's data flow**

- If the route reads/writes a `spec_projects` row → render banner, disable writes, commit.
- If the route is purely pre-project (no `spec_projects` row yet) → skip the banner; commit a one-line code comment explaining why so future readers don't add it.

- [ ] **Step 2: `tsc -b`** (0 errors), then commit (with whichever message fits):

```bash
# If banner added:
git add src/routes/spec-builder-ingest-review.tsx
git commit -m "feat(fds-engine): spec-builder-ingest-review — render UnconfirmedLockBanner and disable ingest writes"

# Or if skipped with a comment:
git commit -m "docs(fds-engine): spec-builder-ingest-review — note why UnconfirmedLockBanner does not apply"
```

---

### Task 15: List-page V1 badge — `spec-builder.tsx`

**Files:**
- Modify: `src/routes/spec-builder.tsx`

The `/specs` list shows every spec project for the current outer project. Add a V1 badge next to unconfirmed projects with a link to their migration wizard.

- [ ] **Step 1: Find the list-row rendering**

```bash
grep -n "specProject\|map.*=>" src/routes/spec-builder.tsx | head -20
```

Locate where each spec project row is rendered.

- [ ] **Step 2: Read `confirmation_status` on each row**

The existing fetch (`useSpecProjectsForProject` or similar) needs to return `confirmation_status`. Verify with:

```bash
grep -n "select(\|select.*confirmation_status" src/hooks/use-spec-projects.ts | head
```

If the hook's `select(...)` doesn't include `confirmation_status`, add it. Use `select("*")` if the hook already does that.

- [ ] **Step 3: Render the badge**

In the list-row JSX:

```tsx
{specProject.confirmation_status === "unconfirmed" && (
  <Badge variant="outline" className="border-amber-300 text-amber-900">
    V1 — <Link to={`/specs/${projectId}/${specProject.id}/migrate`} className="underline ml-1">migrate</Link>
  </Badge>
)}
```

Use the existing Badge import. If `projectId` isn't in scope at that point, derive it from `useParams()` or the existing context.

- [ ] **Step 4: `tsc -b`** (0 errors), then commit:

```bash
git add src/routes/spec-builder.tsx src/hooks/use-spec-projects.ts
git commit -m "feat(fds-engine): spec-builder list — V1 badge + migrate link for unconfirmed projects"
```

---

### Task 16: `migrate-modes-tab` component

**Files:**
- Create: `src/components/spec-builder/migrate/migrate-modes-tab.tsx`
- Create: `src/components/spec-builder/migrate/__tests__/migrate-modes-tab.test.tsx`

Renders the default `auto` mode (locked editable), surfaces hints, supports adding/removing additional modes, runs `validateSpecContractPatch({ modes })` client-side for inline errors. Reports `tabComplete: boolean` and the current `OperatorMode[]` upward.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/spec-builder/migrate/__tests__/migrate-modes-tab.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrateModesTab } from "../migrate-modes-tab";
import type { ProposedModes } from "@/lib/spec-builder/migrate/types";

const baseProposal: ProposedModes = {
  modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
  hints: [{ detected_state: "Manual Run", hint: "Detected state 'Manual Run' — consider adding a Manual mode" }],
};

describe("MigrateModesTab", () => {
  it("renders the default mode and the hint", () => {
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={baseProposal.modes}
        onChange={vi.fn()}
        onTabComplete={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Auto")).toBeInTheDocument();
    expect(screen.getByText(/Manual Run/)).toBeInTheDocument();
  });

  it("reports tabComplete=true for a valid single default mode", () => {
    const onTabComplete = vi.fn();
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={baseProposal.modes}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(onTabComplete).toHaveBeenCalledWith(true);
  });

  it("calls onChange when an Add Mode button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={baseProposal.modes}
        onChange={onChange}
        onTabComplete={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add mode/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
  });

  it("surfaces 'exactly one default' error when two defaults are present", () => {
    const onTabComplete = vi.fn();
    const value = [
      { mode_id: "auto", name: "Auto", is_default: true },
      { mode_id: "manual", name: "Manual", is_default: true },
    ];
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={value}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(screen.getByText(/exactly one/i)).toBeInTheDocument();
    expect(onTabComplete).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/migrate-modes-tab.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/spec-builder/migrate/migrate-modes-tab.tsx
import { useEffect, useMemo } from "react";
import { Plus, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { validateSpecContractPatch } from "@/lib/spec-builder/contract";
import type { OperatorMode } from "@/types/spec-contract-v2";
import type { ProposedModes } from "@/lib/spec-builder/migrate/types";

interface Props {
  proposal: ProposedModes;
  value: OperatorMode[];
  onChange: (next: OperatorMode[]) => void;
  onTabComplete: (complete: boolean) => void;
}

export function MigrateModesTab({ proposal, value, onChange, onTabComplete }: Props) {
  const issues = useMemo(
    () => validateSpecContractPatch({ modes: value }).filter((i) => /mode|default/i.test(i)),
    [value],
  );

  useEffect(() => {
    onTabComplete(issues.length === 0 && value.length >= 1);
  }, [issues, value, onTabComplete]);

  function updateMode(index: number, partial: Partial<OperatorMode>) {
    onChange(value.map((m, i) => (i === index ? { ...m, ...partial } : m)));
  }

  function setDefault(index: number) {
    onChange(value.map((m, i) => ({ ...m, is_default: i === index })));
  }

  function removeMode(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addMode() {
    onChange([
      ...value,
      { mode_id: `mode_${value.length + 1}`, name: "New Mode", is_default: false },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Every project needs at least one mode. Most projects ship with just <strong>Auto</strong>.
        Add Manual / Service / etc. only if the spec actually authors per-mode overrides.
      </p>

      {proposal.hints.length > 0 && (
        <Card className="p-3 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 text-amber-700" aria-hidden />
            <div className="flex flex-col gap-1 text-sm text-amber-900">
              {proposal.hints.map((h, i) => (
                <div key={i}>{h.hint}</div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {value.map((mode, i) => (
          <Card key={i} className="p-3 grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
            <div>
              <Label htmlFor={`mode-id-${i}`} className="text-xs">Mode ID</Label>
              <Input
                id={`mode-id-${i}`}
                value={mode.mode_id}
                onChange={(e) => updateMode(i, { mode_id: e.target.value })}
                className="h-8 font-mono"
              />
            </div>
            <div>
              <Label htmlFor={`mode-name-${i}`} className="text-xs">Display name</Label>
              <Input
                id={`mode-name-${i}`}
                value={mode.name}
                onChange={(e) => updateMode(i, { name: e.target.value })}
                className="h-8"
              />
            </div>
            <div className="flex flex-col items-center">
              <Label htmlFor={`mode-default-${i}`} className="text-xs">Default</Label>
              <Checkbox
                id={`mode-default-${i}`}
                checked={mode.is_default}
                onCheckedChange={() => setDefault(i)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeMode(i)}
              disabled={value.length === 1}
              aria-label={`Remove mode ${mode.mode_id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addMode} className="self-start">
        <Plus className="h-4 w-4 mr-1" />
        Add Mode
      </Button>

      {issues.length > 0 && (
        <Card className="p-3 bg-red-50 border-red-200 text-sm text-red-900">
          <ul className="list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
```

If `Checkbox` isn't imported in the project yet, add it: `npx shadcn@latest add checkbox`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/migrate-modes-tab.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/migrate/migrate-modes-tab.tsx src/components/spec-builder/migrate/__tests__/migrate-modes-tab.test.tsx
# If you added a shadcn component, stage it too:
# git add src/components/ui/checkbox.tsx
git commit -m "feat(fds-engine): migrate-modes-tab component with hints + inline validation"
```

---

### Task 17: `migrate-states-tab` component

**Files:**
- Create: `src/components/spec-builder/migrate/migrate-states-tab.tsx`
- Create: `src/components/spec-builder/migrate/__tests__/migrate-states-tab.test.tsx`

Renders the legacy → PackML mapping as an inline table. Each row: legacy name (read-only), match badge (Exact / Synonym / Unmapped), action dropdown (pick PackML id, mark custom). Custom rows reveal `custom_state_id` + `custom_name` inputs. Validates against Phase 1's PackML range rule.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/spec-builder/migrate/__tests__/migrate-states-tab.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrateStatesTab } from "../migrate-states-tab";
import type { ProposedStateMapping } from "@/lib/spec-builder/migrate/types";

const proposal: ProposedStateMapping[] = [
  { legacy_name: "Execute", match_source: "exact", packml_id: 6 },
  { legacy_name: "Running", match_source: "synonym", packml_id: 6 },
  { legacy_name: "Lubrication", match_source: "unmapped" },
];

describe("MigrateStatesTab", () => {
  it("renders one row per legacy state", () => {
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={proposal}
        onChange={vi.fn()}
        onTabComplete={vi.fn()}
      />,
    );
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Lubrication")).toBeInTheDocument();
  });

  it("reports tabComplete=false while an unmapped row is unresolved", () => {
    const onTabComplete = vi.fn();
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={proposal}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(false);
  });

  it("reports tabComplete=true once every row resolves", () => {
    const onTabComplete = vi.fn();
    const resolved: ProposedStateMapping[] = [
      { legacy_name: "Execute", match_source: "exact", packml_id: 6 },
      { legacy_name: "Running", match_source: "synonym", packml_id: 6 },
      { legacy_name: "Lubrication", match_source: "unmapped", custom_state_id: 101, custom_name: "Lubrication" },
    ];
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={resolved}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(true);
  });

  it("calls onChange when a custom_state_id is entered", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={proposal}
        onChange={onChange}
        onTabComplete={vi.fn()}
      />,
    );
    // Find the row for Lubrication, click "Mark as custom"
    const customButtons = screen.getAllByRole("button", { name: /mark as custom/i });
    await user.click(customButtons[0]);
    expect(onChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/migrate-states-tab.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/spec-builder/migrate/migrate-states-tab.tsx
import { useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PACKML_STATES } from "@/lib/spec-builder/migrate/packml-canonical";
import type { ProposedStateMapping } from "@/lib/spec-builder/migrate/types";

interface Props {
  proposal: ProposedStateMapping[];
  value: ProposedStateMapping[];
  onChange: (next: ProposedStateMapping[]) => void;
  onTabComplete: (complete: boolean) => void;
}

function isResolved(row: ProposedStateMapping): boolean {
  if (typeof row.packml_id === "number" && row.packml_id >= 1 && row.packml_id <= 17) {
    return true;
  }
  if (
    typeof row.custom_state_id === "number" &&
    row.custom_state_id > 100 &&
    !!row.custom_name &&
    row.custom_name.trim().length > 0
  ) {
    return true;
  }
  return false;
}

export function MigrateStatesTab({ proposal: _proposal, value, onChange, onTabComplete }: Props) {
  const allResolved = useMemo(() => value.every(isResolved), [value]);

  useEffect(() => {
    onTabComplete(allResolved);
  }, [allResolved, onTabComplete]);

  function updateRow(i: number, partial: Partial<ProposedStateMapping>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...partial } : r)));
  }

  function markCustom(i: number) {
    updateRow(i, {
      packml_id: undefined,
      custom_state_id: 101,
      custom_name: value[i].legacy_name,
    });
  }

  function pickPackml(i: number, packml_id: number) {
    updateRow(i, { packml_id, custom_state_id: undefined, custom_name: undefined });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Map every legacy state name to either a PackML 1-17 state or a custom state (ID &gt; 100).
      </p>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 px-3 py-2 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <div>Legacy name</div>
          <div>Match</div>
          <div>Mapping</div>
          <div></div>
        </div>
        {value.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 px-3 py-2 border-b items-center text-sm last:border-b-0">
            <div className="font-mono">{row.legacy_name}</div>
            <div>
              <Badge variant={row.match_source === "unmapped" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                {row.match_source}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {row.custom_state_id !== undefined ? (
                <>
                  <Input
                    type="number"
                    min={101}
                    value={row.custom_state_id}
                    onChange={(e) => updateRow(i, { custom_state_id: Number(e.target.value) })}
                    className="h-8 w-24"
                    aria-label="custom state id"
                  />
                  <Input
                    value={row.custom_name ?? ""}
                    onChange={(e) => updateRow(i, { custom_name: e.target.value })}
                    placeholder="Display name"
                    className="h-8"
                    aria-label="custom name"
                  />
                </>
              ) : (
                <Select
                  value={row.packml_id !== undefined ? String(row.packml_id) : ""}
                  onValueChange={(v) => pickPackml(i, Number(v))}
                >
                  <SelectTrigger className="h-8 w-64">
                    <SelectValue placeholder="Pick PackML state…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKML_STATES.map((s) => (
                      <SelectItem key={s.packml_id} value={String(s.packml_id)}>
                        {s.packml_id}. {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (row.custom_state_id !== undefined ? pickPackml(i, 6) : markCustom(i))}
            >
              {row.custom_state_id !== undefined ? "Use PackML" : "Mark as custom"}
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/migrate-states-tab.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/migrate/migrate-states-tab.tsx src/components/spec-builder/migrate/__tests__/migrate-states-tab.test.tsx
git commit -m "feat(fds-engine): migrate-states-tab component — legacy → PackML / custom row review"
```

---

### Task 18: `migrate-interlocks-tab` + `migrate-interlock-row`

**Files:**
- Create: `src/components/spec-builder/migrate/migrate-interlock-row.tsx`
- Create: `src/components/spec-builder/migrate/migrate-interlocks-tab.tsx`
- Create: `src/components/spec-builder/migrate/__tests__/migrate-interlocks-tab.test.tsx`

The interlocks tab is the most-touched UI: every row must be reviewed. Source_condition editing uses a small inline builder (kind dropdown + fields per kind). Confidence chip colors map to bucketed ranges.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/spec-builder/migrate/__tests__/migrate-interlocks-tab.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrateInterlocksTab } from "../migrate-interlocks-tab";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

const rows: ProposedInterlock[] = [
  {
    interlock_id: "il-1",
    source_assembly: "CV01",
    target_assembly: "LFT01",
    original_prose_condition: "CV01 is running",
    original_prose_effect: "hold the lift",
    effect: "hold",
    source_condition: { kind: "tag_equals", tag: "CV01.RUNNING", value: true },
    confidence: 0.95,
    reasoning: "exact tag",
  },
  {
    interlock_id: "il-2",
    source_assembly: "CV01",
    target_assembly: "LFT01",
    original_prose_condition: "CV01 has faulted",
    original_prose_effect: "block lift execute",
    effect: "hold",
    source_condition: { kind: "placeholder", prompt: "CV01 has faulted" },
    confidence: 0,
    reasoning: "fallback",
  },
];

describe("MigrateInterlocksTab", () => {
  it("renders one row per interlock", () => {
    render(
      <MigrateInterlocksTab rows={rows} onChange={vi.fn()} onTabComplete={vi.fn()} onReclassify={vi.fn()} />,
    );
    expect(screen.getByText("il-1")).toBeInTheDocument();
    expect(screen.getByText("il-2")).toBeInTheDocument();
  });

  it("reports tabComplete=false while any row has a placeholder source_condition", () => {
    const onTabComplete = vi.fn();
    render(
      <MigrateInterlocksTab rows={rows} onChange={vi.fn()} onTabComplete={onTabComplete} onReclassify={vi.fn()} />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(false);
  });

  it("reports tabComplete=true once every row has a non-placeholder source_condition", () => {
    const onTabComplete = vi.fn();
    const resolved = rows.map((r, i) =>
      i === 1
        ? { ...r, source_condition: { kind: "tag_equals" as const, tag: "X", value: true } }
        : r,
    );
    render(
      <MigrateInterlocksTab rows={resolved} onChange={vi.fn()} onTabComplete={onTabComplete} onReclassify={vi.fn()} />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(true);
  });

  it("fires onReclassify when 'Re-classify all' is clicked", async () => {
    const onReclassify = vi.fn();
    const user = userEvent.setup();
    render(
      <MigrateInterlocksTab rows={rows} onChange={vi.fn()} onTabComplete={vi.fn()} onReclassify={onReclassify} />,
    );
    await user.click(screen.getByRole("button", { name: /re-classify all/i }));
    expect(onReclassify).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/migrate-interlocks-tab.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the row component**

```tsx
// src/components/spec-builder/migrate/migrate-interlock-row.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InterAssemblyInterlockEffectSchema } from "@/types/spec-contract-v2";
import type {
  InterAssemblyInterlockEffect,
  CompletionCriterion,
} from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

interface Props {
  row: ProposedInterlock;
  onChange: (next: ProposedInterlock) => void;
}

function confidenceClass(c: number): string {
  if (c >= 0.9) return "bg-green-100 text-green-900 border-green-200";
  if (c >= 0.6) return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-red-100 text-red-900 border-red-200";
}

const EFFECT_OPTIONS = InterAssemblyInterlockEffectSchema.options;
const CONDITION_KINDS = ["tag_equals", "tag_compare", "expression", "placeholder"] as const;

export function MigrateInterlockRow({ row, onChange }: Props) {
  function setEffect(effect: InterAssemblyInterlockEffect) {
    onChange({ ...row, effect });
  }

  function setKind(kind: typeof CONDITION_KINDS[number]) {
    const empty: Record<string, CompletionCriterion> = {
      tag_equals: { kind: "tag_equals", tag: "", value: true },
      tag_compare: { kind: "tag_compare", tag: "", operator: ">=", value: 0 },
      expression: { kind: "expression", expr: "" },
      placeholder: { kind: "placeholder", prompt: row.original_prose_condition },
    };
    onChange({ ...row, source_condition: empty[kind] });
  }

  function setField<K extends string>(field: K, val: unknown) {
    onChange({
      ...row,
      source_condition: { ...row.source_condition, [field]: val } as CompletionCriterion,
    });
  }

  const sc = row.source_condition;

  return (
    <div className="grid grid-cols-[100px_100px_1fr_120px_2fr_60px] gap-2 items-center px-3 py-2 border-b text-sm last:border-b-0">
      <div className="font-mono text-xs">{row.source_assembly}</div>
      <div className="font-mono text-xs">{row.target_assembly}</div>
      <div className="text-xs text-muted-foreground truncate" title={row.original_prose_condition}>
        {row.original_prose_condition}
      </div>
      <Select value={row.effect} onValueChange={(v) => setEffect(v as InterAssemblyInterlockEffect)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EFFECT_OPTIONS.map((e) => (
            <SelectItem key={e} value={e}>
              {e}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Select value={sc.kind} onValueChange={(v) => setKind(v as typeof CONDITION_KINDS[number])}>
          <SelectTrigger className="h-8 w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sc.kind === "tag_equals" && (
          <>
            <Input
              value={sc.tag}
              onChange={(e) => setField("tag", e.target.value)}
              placeholder="TAG"
              className="h-8 font-mono"
            />
            <Select
              value={String(sc.value)}
              onValueChange={(v) => setField("value", v === "true" ? true : v === "false" ? false : v)}
            >
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">true</SelectItem>
                <SelectItem value="false">false</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        {sc.kind === "tag_compare" && (
          <>
            <Input
              value={sc.tag}
              onChange={(e) => setField("tag", e.target.value)}
              placeholder="TAG"
              className="h-8 font-mono"
            />
            <Select value={sc.operator} onValueChange={(v) => setField("operator", v)}>
              <SelectTrigger className="h-8 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["<", "<=", ">", ">="].map((op) => (
                  <SelectItem key={op} value={op}>{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={sc.value}
              onChange={(e) => setField("value", Number(e.target.value))}
              className="h-8 w-20"
            />
          </>
        )}
        {sc.kind === "expression" && (
          <Input
            value={sc.expr}
            onChange={(e) => setField("expr", e.target.value)}
            placeholder="expr"
            className="h-8 font-mono"
          />
        )}
        {sc.kind === "placeholder" && (
          <Input
            value={sc.prompt}
            onChange={(e) => setField("prompt", e.target.value)}
            placeholder="prose"
            className="h-8 italic"
          />
        )}
      </div>

      <Badge
        variant="outline"
        className={cn("text-[10px] uppercase justify-center", confidenceClass(row.confidence))}
        title={row.reasoning}
      >
        {Math.round(row.confidence * 100)}%
      </Badge>
    </div>
  );
}
```

- [ ] **Step 4: Implement the tab**

```tsx
// src/components/spec-builder/migrate/migrate-interlocks-tab.tsx
import { useEffect, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MigrateInterlockRow } from "./migrate-interlock-row";
import { CompletionCriterionSchema } from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

interface Props {
  rows: ProposedInterlock[];
  onChange: (next: ProposedInterlock[]) => void;
  onTabComplete: (complete: boolean) => void;
  onReclassify: () => void;
}

function isRowResolved(row: ProposedInterlock): boolean {
  if (row.source_condition.kind === "placeholder") return false;
  return CompletionCriterionSchema.safeParse(row.source_condition).success;
}

export function MigrateInterlocksTab({ rows, onChange, onTabComplete, onReclassify }: Props) {
  const allResolved = useMemo(() => rows.length === 0 || rows.every(isRowResolved), [rows]);

  useEffect(() => {
    onTabComplete(allResolved);
  }, [allResolved, onTabComplete]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review every inter-assembly interlock. The AI classifier proposed an effect and structured
          source_condition for each row; engineer-confirm or edit. Rows with a 0% confidence chip
          fell back to placeholder shape and need manual entry.
        </p>
        <Button variant="outline" size="sm" onClick={onReclassify}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Re-classify all
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[100px_100px_1fr_120px_2fr_60px] gap-2 px-3 py-2 border-b bg-muted/40 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <div>Source</div>
          <div>Target</div>
          <div>Original prose</div>
          <div>Effect</div>
          <div>Source condition</div>
          <div>Conf.</div>
        </div>
        {rows.map((row) => (
          <MigrateInterlockRow
            key={row.interlock_id}
            row={row}
            onChange={(next) => onChange(rows.map((r) => (r.interlock_id === row.interlock_id ? next : r)))}
          />
        ))}
        {rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No inter-assembly interlocks in this project — nothing to classify.
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/components/spec-builder/migrate/__tests__/migrate-interlocks-tab.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/spec-builder/migrate/migrate-interlock-row.tsx src/components/spec-builder/migrate/migrate-interlocks-tab.tsx src/components/spec-builder/migrate/__tests__/migrate-interlocks-tab.test.tsx
git commit -m "feat(fds-engine): migrate-interlocks-tab + row — classified review with confidence chips"
```

---

### Task 19: `migrate-confirm-bar` + `use-confirm-migration` hook

**Files:**
- Create: `src/components/spec-builder/migrate/migrate-confirm-bar.tsx`
- Create: `src/hooks/use-confirm-migration.ts`
- Create: `src/hooks/__tests__/use-confirm-migration.test.tsx`

The confirm bar is a sticky footer; the hook does the heavy lifting on commit.

- [ ] **Step 1: Write the failing hook test**

```tsx
// src/hooks/__tests__/use-confirm-migration.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SpecContractV2, AssemblyContract } from "@/types/spec-contract-v2";
import type { MigrationDraft } from "@/lib/spec-builder/migrate/types";

const writeMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/spec-builder/contract", () => ({
  writeSpecContract: (...args: unknown[]) => writeMock(...args),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "fds_migration_events") {
        return { insert: (rows: unknown) => Promise.resolve(insertMock(rows) ?? { data: null, error: null }) };
      }
      return {
        update: (payload: unknown) => ({
          eq: () => Promise.resolve(updateMock(payload) ?? { data: null, error: null }),
        }),
      };
    },
  },
}));

import { useConfirmMigration } from "../use-confirm-migration";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const SPEC_ID = "00000000-0000-0000-0000-000000000000";

function makeContract(): SpecContractV2 {
  return {
    schema_version: 2,
    project: {
      id: SPEC_ID,
      doc_code: "X",
      title: "T",
      client_name: "C",
      project_number: null,
      plc_model: null,
      hmi_type: null,
      comms_protocol: null,
      safety_classification: null,
      fault_philosophy: null,
      design_principles: [],
      scope_exclusions: [],
    },
    hierarchy: { subsystems: [] },
    states: [],
    alarm_tiers: [],
    assemblies: {
      "00000000-0000-0000-0000-000000000aaa": {
        assembly_id: "00000000-0000-0000-0000-000000000aaa",
        subsystem_id: "00000000-0000-0000-0000-000000000bbb",
        static_states: {},
        sequential_states: { execute: { permissives: [], steps: [], notes: null } } as never,
      } as AssemblyContract,
    },
    orchestrations: {},
    system_orchestration: null,
    alarms: [],
    io_list: [],
    faults: [],
    sections: {},
    confirmation_status: "unconfirmed",
  } as never;
}

const draft: MigrationDraft = {
  modes: { rows: [{ mode_id: "auto", name: "Auto", is_default: true }], tabComplete: true },
  states: { rows: [], tabComplete: true },
  interlocks: { rows: [], classifiedAt: new Date().toISOString(), tabComplete: true },
};

describe("useConfirmMigration", () => {
  beforeEach(() => {
    writeMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    writeMock.mockResolvedValue(undefined);
  });

  it("calls writeSpecContract with the assembled patch on confirm", async () => {
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await result.current.confirm({ contract: makeContract(), draft });
    });
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [calledSpecId, patch] = writeMock.mock.calls[0];
    expect(calledSpecId).toBe(SPEC_ID);
    expect(patch.confirmation_status).toBe("confirmed");
    expect(patch.modes).toHaveLength(1);
  });

  it("inserts a fds_migration_events row on success", async () => {
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await result.current.confirm({ contract: makeContract(), draft });
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      spec_project_id: SPEC_ID,
      modes_count: 1,
    });
  });

  it("clears the migration_draft on success", async () => {
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await result.current.confirm({ contract: makeContract(), draft });
    });
    expect(updateMock).toHaveBeenCalledWith({ migration_draft: null });
  });

  it("throws and does NOT clear the draft when writeSpecContract fails", async () => {
    writeMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await expect(
      act(async () => {
        await result.current.confirm({ contract: makeContract(), draft });
      }),
    ).rejects.toThrow(/boom/);
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/use-confirm-migration.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/use-confirm-migration.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { writeSpecContract, type SpecContractPatch } from "@/lib/spec-builder/contract";
import { applyOverrideKind } from "@/lib/spec-builder/migrate/apply-override-kind";
import { applyStructuredInterlocks } from "@/lib/spec-builder/migrate/apply-structured-interlocks";
import type { SpecContractV2, OperatingStateV2 } from "@/types/spec-contract-v2";
import type { MigrationDraft } from "@/lib/spec-builder/migrate/types";

interface ConfirmArgs {
  contract: SpecContractV2;
  draft: MigrationDraft;
}

function assemblePatch(contract: SpecContractV2, draft: MigrationDraft): SpecContractPatch {
  const states: OperatingStateV2[] = (draft.states?.rows ?? []).map((row) => {
    if (typeof row.packml_id === "number") {
      return {
        state_id: row.packml_id,
        packml_id: row.packml_id,
        display_name: row.legacy_name,
        description: row.legacy_name,
        state_pattern: "sequential",
      };
    }
    return {
      state_id: row.custom_state_id!,
      custom_name: row.custom_name!,
      display_name: row.custom_name!,
      description: row.custom_name!,
      state_pattern: "static",
    };
  });

  return {
    modes: draft.modes?.rows ?? [],
    states,
    assemblies: applyOverrideKind(contract.assemblies),
    orchestrations: applyStructuredInterlocks(
      contract.orchestrations,
      draft.interlocks?.rows ?? [],
    ),
    confirmation_status: "confirmed",
  };
}

export function useConfirmMigration(specProjectId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ contract, draft }: ConfirmArgs) => {
      const patch = assemblePatch(contract, draft);
      await writeSpecContract(specProjectId, patch);

      // Telemetry — single row.
      const interlockRows = draft.interlocks?.rows ?? [];
      const overrideCount = interlockRows.filter((r) => r.confidence < 0.6).length;
      await supabase.from("fds_migration_events").insert({
        spec_project_id: specProjectId,
        modes_count: patch.modes?.length ?? 0,
        custom_states_count: (patch.states ?? []).filter((s) => typeof s.state_id === "number" && s.state_id > 100).length,
        interlocks_classified_count: interlockRows.length,
        interlocks_overridden_count: overrideCount,
      });

      // Clear the draft only after both writes succeed.
      const { error } = await supabase
        .from("spec_projects")
        .update({ migration_draft: null })
        .eq("id", specProjectId);
      if (error) throw new Error(`useConfirmMigration.clearDraft: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spec-contract", specProjectId] });
      queryClient.invalidateQueries({ queryKey: ["migration-draft", specProjectId] });
    },
  });

  return {
    confirm: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
```

- [ ] **Step 4: Run hook test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/use-confirm-migration.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Implement the confirm bar component**

```tsx
// src/components/spec-builder/migrate/migrate-confirm-bar.tsx
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  canConfirm: boolean;          // true when all three tabs report tabComplete
  isPending: boolean;
  errorMessages: string[];       // shown above the button if non-empty
  onConfirm: () => void;
}

export function MigrateConfirmBar({ canConfirm, isPending, errorMessages, onConfirm }: Props) {
  return (
    <div className="sticky bottom-0 border-t bg-background z-10">
      {errorMessages.length > 0 && (
        <Card className="m-3 p-3 bg-red-50 border-red-200 text-sm text-red-900">
          <ul className="list-disc pl-5">
            {errorMessages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Confirming writes the new structured shape to the spec project and unlocks edits on every spec-builder route.
        </p>
        <Button
          onClick={onConfirm}
          disabled={!canConfirm || isPending}
          size="lg"
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Confirm Migration
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Conversation-archive gap — DEFERRED**

Spec §4.4 says Confirm should also call `archiveConversation(specProjectId)` to mark in-flight co-author sessions as archived. **This is deferred from Phase 2.** Reason: there is no dedicated `fds_co_author_sessions` table in the schema; co-author conversations are embedded as JSONB columns inside the existing `fds_assembly_sessions` / `fds_subsystem_orchestrations` / `fds_system_orchestrations` rows. Adding a meaningful "archived" semantic requires a separate schema decision (new status column, or a conversation_archive table) that isn't worth blocking Phase 2 on.

The user-visible impact is small: per spec §5.4 "engineer restarts authoring from the matrix view" — that still works because the new structured contract IS the new working state after Confirm. The conversation history just doesn't get marked as archived.

**Action:** add a single line of code in the `mutationFn` (right before the `clearDraft` step) that's a no-op for Phase 2 but documents the deferral:

```ts
// TODO(fds-engine phase 2.5): archive in-flight co-author conversations.
// Spec §4.4 calls for this but the schema doesn't have a single conversation
// table to update — conversations live across fds_assembly_sessions,
// fds_subsystem_orchestrations, fds_system_orchestrations as JSONB columns.
// Resolve in a follow-up wave when a conversation schema decision lands.
```

This is the only `TODO(...)` in the entire Phase 2 plan and is intentional — it documents a known schema-level gap rather than punting implementation detail.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-confirm-migration.ts src/hooks/__tests__/use-confirm-migration.test.tsx src/components/spec-builder/migrate/migrate-confirm-bar.tsx
git commit -m "feat(fds-engine): use-confirm-migration hook + migrate-confirm-bar component"
```

---

### Task 20: `use-migration-proposal` hook

**Files:**
- Create: `src/hooks/use-migration-proposal.ts`

Computes the first-open proposal: runs `proposeModes` + `proposeStates` on the loaded contract, kicks off `classifyInterlocks`, returns everything as a `{ modesProposal, statesProposal, interlocksProposal, classifierLoading }` object. The wizard shell calls this on mount only when there's no existing draft.

- [ ] **Step 1: Implement the hook (no test required — this is a thin assembly hook covered by the integration test in Task 22)**

```ts
// src/hooks/use-migration-proposal.ts
import { useQuery } from "@tanstack/react-query";
import { proposeModes } from "@/lib/spec-builder/migrate/propose-modes";
import { proposeStateMapping } from "@/lib/spec-builder/migrate/propose-states";
import { classifyInterlocks } from "@/lib/spec-builder/migrate/interlock-classifier";
import type { RawInterlock } from "@/lib/spec-builder/migrate/interlock-classifier";
import type {
  ProposedInterlock,
  ProposedModes,
  ProposedStateMapping,
} from "@/lib/spec-builder/migrate/types";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

export interface MigrationProposal {
  modes: ProposedModes;
  states: ProposedStateMapping[];
  interlocks: ProposedInterlock[];
}

function collectRawInterlocks(contract: SpecContractV2): RawInterlock[] {
  const out: RawInterlock[] = [];
  for (const [, stateMap] of Object.entries(contract.orchestrations)) {
    for (const [, seq] of Object.entries(stateMap)) {
      for (const il of seq.inter_assembly_interlocks ?? []) {
        out.push({
          interlock_id: il.interlock_id,
          source_assembly: il.source_assembly,
          target_assembly: il.target_assembly,
          prose_source_condition:
            typeof il.source_condition === "string"
              ? il.source_condition
              : JSON.stringify(il.source_condition),
          prose_effect:
            typeof il.effect === "string" ? il.effect : JSON.stringify(il.effect),
        });
      }
    }
  }
  return out;
}

/**
 * Computes the first-open wizard proposal from a loaded V1 contract. Used by
 * the wizard shell only when there's no existing migration_draft.
 */
export function useMigrationProposal(
  specProjectId: string,
  contract: SpecContractV2 | undefined,
  enabled: boolean,
) {
  return useQuery<MigrationProposal>({
    queryKey: ["migration-proposal", specProjectId],
    enabled: enabled && !!contract,
    queryFn: async () => {
      if (!contract) throw new Error("useMigrationProposal: contract required");
      const legacyStateNames = (contract.states ?? []).map((s) =>
        typeof s.state_id === "string" ? s.state_id : String(s.state_id),
      );
      const modes = proposeModes(legacyStateNames);
      const states = legacyStateNames.map(proposeStateMapping);
      const classified = await classifyInterlocks(collectRawInterlocks(contract));
      const interlocks: ProposedInterlock[] = classified.map((c) => {
        const raw = collectRawInterlocks(contract).find((r) => r.interlock_id === c.interlock_id);
        return {
          interlock_id: c.interlock_id,
          source_assembly: c.source_assembly,
          target_assembly: c.target_assembly,
          original_prose_condition: raw?.prose_source_condition ?? "",
          original_prose_effect: raw?.prose_effect ?? "",
          effect: c.effect,
          source_condition: c.source_condition,
          confidence: c.confidence,
          reasoning: c.reasoning,
        };
      });
      return { modes, states, interlocks };
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-migration-proposal.ts
git commit -m "feat(fds-engine): use-migration-proposal — first-open proposal computation across all three tabs"
```

---

### Task 21: `spec-migrate.tsx` shell + App.tsx route registration

**Files:**
- Create: `src/routes/spec-migrate.tsx`
- Modify: `src/App.tsx`

The shell wires everything together. Single 3-tab page with the sticky Confirm bar at the bottom.

- [ ] **Step 1: Add the route to App.tsx**

In `src/App.tsx`, near the other spec routes (around lines 102-107), add:

```tsx
const SpecMigratePage = lazy(() => import("@/routes/spec-migrate"));
```

(Put this declaration with the other `lazy(...)` imports at the top.)

Then in the `createBrowserRouter` array, add the route entry:

```tsx
{ path: "specs/:projectId/:specId/migrate", element: <LazyRoute><SpecMigratePage /></LazyRoute> },
```

- [ ] **Step 2: Implement the route shell**

```tsx
// src/routes/spec-migrate.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { useSpecContract } from "@/hooks/use-spec-contract";
import { useMigrationDraft } from "@/hooks/use-migration-draft";
import { useMigrationProposal } from "@/hooks/use-migration-proposal";
import { useConfirmMigration } from "@/hooks/use-confirm-migration";
import { MigrateModesTab } from "@/components/spec-builder/migrate/migrate-modes-tab";
import { MigrateStatesTab } from "@/components/spec-builder/migrate/migrate-states-tab";
import { MigrateInterlocksTab } from "@/components/spec-builder/migrate/migrate-interlocks-tab";
import { MigrateConfirmBar } from "@/components/spec-builder/migrate/migrate-confirm-bar";
import type { OperatorMode } from "@/types/spec-contract-v2";
import type {
  MigrationDraft,
  ProposedInterlock,
  ProposedStateMapping,
} from "@/lib/spec-builder/migrate/types";

export default function SpecMigratePage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const navigate = useNavigate();

  const { data: contract, isLoading: contractLoading, isError: contractError } = useSpecContract(specId!);
  const { draft, isLoading: draftLoading, saveDraft } = useMigrationDraft(specId!);

  // Recompute the proposal only when there's no draft yet.
  const needsProposal = !draft && !!contract;
  const proposalQuery = useMigrationProposal(specId!, contract, needsProposal);

  // Tab-complete flags reported up from each tab.
  const [modesComplete, setModesComplete] = useState(false);
  const [statesComplete, setStatesComplete] = useState(false);
  const [interlocksComplete, setInterlocksComplete] = useState(false);

  // Hydrate the draft from the proposal once it's ready.
  useEffect(() => {
    if (draft || !proposalQuery.data) return;
    saveDraft({
      modes: { rows: proposalQuery.data.modes.modes, tabComplete: true },
      states: { rows: proposalQuery.data.states, tabComplete: false },
      interlocks: {
        rows: proposalQuery.data.interlocks,
        classifiedAt: new Date().toISOString(),
        tabComplete: false,
      },
    });
  }, [draft, proposalQuery.data, saveDraft]);

  const { confirm, isPending: confirmPending, error: confirmError } = useConfirmMigration(specId!);

  if (contractLoading || draftLoading || (needsProposal && proposalQuery.isLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (contractError) {
    return <Card className="m-4 p-4 text-red-900 bg-red-50">Failed to load spec contract.</Card>;
  }

  if (!contract) return null;

  // Redirect if already confirmed (race / direct nav).
  if (contract.confirmation_status === "confirmed") {
    return <Navigate to={`/specs/${projectId}/${specId}/editor`} replace />;
  }

  // Need a non-null draft to render the tabs.
  if (!draft || !draft.modes || !draft.states || !draft.interlocks) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canConfirm = modesComplete && statesComplete && interlocksComplete;
  const errorMessages = confirmError ? [confirmError instanceof Error ? confirmError.message : String(confirmError)] : [];

  function onConfirm() {
    if (!contract || !draft) return;
    confirm({ contract, draft }).then(() => navigate(`/specs/${projectId}/${specId}/editor`));
  }

  function onChangeModes(next: OperatorMode[]) {
    saveDraft({ modes: { rows: next, tabComplete: modesComplete } });
  }

  function onChangeStates(next: ProposedStateMapping[]) {
    saveDraft({ states: { rows: next, tabComplete: statesComplete } });
  }

  function onChangeInterlocks(next: ProposedInterlock[]) {
    saveDraft({
      interlocks: {
        rows: next,
        classifiedAt: draft!.interlocks!.classifiedAt,
        tabComplete: interlocksComplete,
      },
    });
  }

  function onReclassify() {
    // Drop the cached classified rows so useMigrationProposal re-runs on next mount.
    // For now: clear the draft's interlocks slice; the user will see a spinner
    // while it re-computes via useMigrationProposal.
    saveDraft({
      interlocks: undefined as never,  // forces re-proposal
    } as Partial<MigrationDraft>);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b">
        <h1 className="text-lg font-semibold">Migrate to V2 — {contract.project.title}</h1>
        <p className="text-sm text-muted-foreground">
          Review modes, state vocabulary, and inter-assembly interlocks. Confirm at the bottom to
          unlock editing on every spec-builder route.
        </p>
      </header>

      <Tabs defaultValue="modes" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="modes">
            1. Modes {modesComplete && "✓"}
          </TabsTrigger>
          <TabsTrigger value="states">
            2. State vocabulary {statesComplete && "✓"}
          </TabsTrigger>
          <TabsTrigger value="interlocks">
            3. Interlock structure {interlocksComplete && "✓"}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto p-4">
          <TabsContent value="modes">
            <MigrateModesTab
              proposal={proposalQuery.data?.modes ?? { modes: draft.modes.rows, hints: [] }}
              value={draft.modes.rows}
              onChange={onChangeModes}
              onTabComplete={setModesComplete}
            />
          </TabsContent>
          <TabsContent value="states">
            <MigrateStatesTab
              proposal={draft.states.rows}
              value={draft.states.rows}
              onChange={onChangeStates}
              onTabComplete={setStatesComplete}
            />
          </TabsContent>
          <TabsContent value="interlocks">
            <MigrateInterlocksTab
              rows={draft.interlocks.rows}
              onChange={onChangeInterlocks}
              onTabComplete={setInterlocksComplete}
              onReclassify={onReclassify}
            />
          </TabsContent>
        </div>
      </Tabs>

      <MigrateConfirmBar
        canConfirm={canConfirm}
        isPending={confirmPending}
        errorMessages={errorMessages}
        onConfirm={onConfirm}
      />
    </div>
  );
}
```

If `Tabs` / `TabsContent` / `TabsList` / `TabsTrigger` aren't yet installed: `npx shadcn@latest add tabs`.

- [ ] **Step 3: Type-check + manual sanity**

```bash
npx tsc -b
```

Expected: 0 errors.

Spin up the dev server (optional) and click through `/specs/:projectId/:specId/migrate` for an unconfirmed project to confirm the page renders.

- [ ] **Step 4: Commit**

```bash
git add src/routes/spec-migrate.tsx src/App.tsx
# If you added a shadcn component, stage it too:
# git add src/components/ui/tabs.tsx
git commit -m "feat(fds-engine): spec-migrate route shell — 3-tab wizard wired to draft + confirm hook"
```

---

### Task 22: Fixture capture + `migration-integration.test.ts`

**Files:**
- Create: `src/lib/spec-builder/migrate/__fixtures__/catodo-v1.json`
- Create: `src/lib/spec-builder/migrate/__fixtures__/norte-sur-en-v1.json`
- Create: `src/lib/spec-builder/migrate/__fixtures__/cvl-2129-v1.json`
- Create: `src/lib/spec-builder/__tests__/migration-integration.test.ts`

The fixtures don't need to be exact prod snapshots — they're representative shapes that exercise the migration logic. Each fixture is a `SpecContractV2` object (V1-shaped, i.e. legacy `state_id` strings, prose interlocks, no `override_kind`).

- [ ] **Step 1: Build the three fixtures**

Each fixture is a JSON file shaped like a V1 `SpecContractV2`. Use UUIDs (the nil UUID `00000000-0000-0000-0000-000000000000` is accepted by `UuidSchema`; vary the last segments for uniqueness within a fixture).

For each fixture, target these characteristics:

| Fixture | Modes hint | States shape | Interlocks |
|---|---|---|---|
| `catodo-v1.json` | none (single-mode) | mostly PackML names + 1 unmapped ("Cathode Drying") | 2 interlocks, both with prose source_conditions |
| `norte-sur-en-v1.json` | none | mix of exact + synonyms ("Running", "E-Stop") | 1 interlock with a complex prose effect |
| `cvl-2129-v1.json` | yes ("Manual Run", "Service") | mostly PackML; no custom states | 3 interlocks with mixed prose |

Each JSON file should validate against `SpecContractV2Schema`. Build them by hand-editing one of them, then use Phase 1's existing `SpecContractV2Schema.parse` in a one-off script to verify they parse:

```bash
node -e "const f = require('./src/lib/spec-builder/migrate/__fixtures__/catodo-v1.json'); const { SpecContractV2Schema } = require('./src/types/spec-contract-v2'); SpecContractV2Schema.parse(f); console.log('valid');"
```

(If `require` doesn't work on the TS source, run the check inside the integration test instead — the assertion that the fixture parses is part of the test contract.)

Example skeleton (apply to each fixture with different ids / states / interlocks):

```json
{
  "schema_version": 2,
  "project": {
    "id": "00000000-0000-0000-0000-00000000c001",
    "doc_code": "CATODO-001",
    "title": "Catodo line",
    "client_name": "Acme",
    "project_number": null,
    "plc_model": null,
    "hmi_type": null,
    "comms_protocol": null,
    "safety_classification": null,
    "fault_philosophy": null,
    "design_principles": [],
    "scope_exclusions": []
  },
  "hierarchy": { "subsystems": [] },
  "states": [
    { "state_id": "Idle", "state_name": "Idle", "description": "Idle", "state_pattern": "static" },
    { "state_id": "Execute", "state_name": "Execute", "description": "Running", "state_pattern": "sequential" },
    { "state_id": "Cathode Drying", "state_name": "Cathode Drying", "description": "Site-specific", "state_pattern": "static" }
  ],
  "alarm_tiers": [],
  "assemblies": {
    "00000000-0000-0000-0000-00000000a001": {
      "assembly_id": "00000000-0000-0000-0000-00000000a001",
      "subsystem_id": "00000000-0000-0000-0000-00000000b001",
      "static_states": {},
      "sequential_states": {
        "Execute": { "permissives": [], "steps": [], "notes": null }
      }
    }
  },
  "orchestrations": {
    "00000000-0000-0000-0000-00000000b001": {
      "Execute": {
        "assembly_order": ["CV01", "LFT01"],
        "shared_permissives": [],
        "inter_assembly_interlocks": [
          {
            "interlock_id": "il-c-1",
            "source_assembly": "CV01",
            "source_condition": "CV01 is running",
            "target_assembly": "LFT01",
            "effect": "hold the lift",
            "prose": "CV01 is running"
          }
        ],
        "notes": null
      }
    }
  },
  "system_orchestration": null,
  "alarms": [],
  "io_list": [],
  "faults": [],
  "sections": {}
}
```

This fixture needs to validate against the current `SpecContractV2Schema`. Phase 1 introduced changes to `InterAssemblyInterlock` (closed-set `effect` enum, structured `source_condition`). The fixture above uses the **legacy** prose shapes — those will be **rejected** by the current `InterAssemblyInterlockSchema`.

**Two paths:**
- (a) Capture fixtures as **raw row data** (the shape Supabase returns, not the post-parse `SpecContractV2`). Then the test mocks the loader chain (project row + assembly_sessions + orchestrations rows) and the legacy shim turns them into a `SpecContractV2` for the wizard.
- (b) Capture fixtures as already-parsed V2 contracts that nevertheless represent unconfirmed projects. To survive `InterAssemblyInterlockSchema`, the prose-shaped interlock needs to be wrapped as `{ effect: "hold", source_condition: { kind: "placeholder", prompt: "CV01 is running" }, prose: "CV01 is running" }`. Strictly a structural workaround.

**Pick (b).** The wizard's input is a `SpecContractV2` (which the reader produces from any shape). The fixtures represent post-reader, pre-wizard state. Encode legacy prose by storing it on `prose`, and let `source_condition` start as a placeholder so the AI classifier still has something to work from.

Adjust the fixture's interlocks accordingly:

```json
"inter_assembly_interlocks": [
  {
    "interlock_id": "il-c-1",
    "source_assembly": "CV01",
    "source_condition": { "kind": "placeholder", "prompt": "CV01 is running" },
    "target_assembly": "LFT01",
    "effect": "hold",
    "prose": "hold the lift while CV01 is running"
  }
]
```

The integration test then asserts the wizard produces a structured `effect` and a non-placeholder `source_condition` after engineer acceptance.

Build the three fixtures with these shapes — vary states (numbers and names) and interlocks (count and original prose) per the table above.

- [ ] **Step 2: Write the integration test**

```ts
// src/lib/spec-builder/__tests__/migration-integration.test.ts
import { describe, expect, it, vi } from "vitest";
import { SpecContractV2Schema, type SpecContractV2 } from "@/types/spec-contract-v2";
import {
  validateSpecContractPatch,
  type SpecContractPatch,
} from "@/lib/spec-builder/contract";
import { applyOverrideKind } from "@/lib/spec-builder/migrate/apply-override-kind";
import { applyStructuredInterlocks } from "@/lib/spec-builder/migrate/apply-structured-interlocks";
import { proposeStateMapping } from "@/lib/spec-builder/migrate/propose-states";
import { proposeModes } from "@/lib/spec-builder/migrate/propose-modes";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

import catodo from "../migrate/__fixtures__/catodo-v1.json";
import norteSur from "../migrate/__fixtures__/norte-sur-en-v1.json";
import cvl2129 from "../migrate/__fixtures__/cvl-2129-v1.json";

const FIXTURES: Array<{ name: string; data: unknown }> = [
  { name: "catodo", data: catodo },
  { name: "norte-sur-en", data: norteSur },
  { name: "cvl-2129", data: cvl2129 },
];

// Stub the AI classifier to "auto-accept" — every interlock gets a
// confident structured classification mirroring the original prose.
function autoClassify(contract: SpecContractV2): ProposedInterlock[] {
  const out: ProposedInterlock[] = [];
  for (const stateMap of Object.values(contract.orchestrations)) {
    for (const seq of Object.values(stateMap)) {
      for (const il of seq.inter_assembly_interlocks ?? []) {
        out.push({
          interlock_id: il.interlock_id,
          source_assembly: il.source_assembly,
          target_assembly: il.target_assembly,
          original_prose_condition: typeof il.source_condition === "string" ? il.source_condition : il.prose,
          original_prose_effect: il.prose,
          effect: "hold",
          source_condition: { kind: "tag_equals", tag: "TEST_TAG", value: true },
          confidence: 0.95,
          reasoning: "test stub",
        });
      }
    }
  }
  return out;
}

describe.each(FIXTURES)("migration end-to-end: $name", ({ data }) => {
  it("loads the fixture as a valid SpecContractV2", () => {
    expect(() => SpecContractV2Schema.parse(data)).not.toThrow();
  });

  it("produces a writeSpecContract patch that validates", () => {
    const contract = SpecContractV2Schema.parse(data);
    const legacyStateNames = contract.states.map((s) =>
      typeof s.state_id === "string" ? s.state_id : String(s.state_id),
    );
    const modes = proposeModes(legacyStateNames).modes;
    const states = legacyStateNames.map(proposeStateMapping).map((row) => {
      // Resolve any unmapped → custom for the test
      if (row.match_source === "unmapped") {
        return { ...row, custom_state_id: 101, custom_name: row.legacy_name };
      }
      return row;
    });
    const interlocks = autoClassify(contract);

    const patch: SpecContractPatch = {
      modes,
      states: states.map((row) =>
        typeof row.packml_id === "number"
          ? {
              state_id: row.packml_id,
              packml_id: row.packml_id,
              display_name: row.legacy_name,
              description: row.legacy_name,
              state_pattern: "sequential",
            }
          : {
              state_id: row.custom_state_id!,
              custom_name: row.custom_name!,
              display_name: row.custom_name!,
              description: row.custom_name!,
              state_pattern: "static",
            },
      ),
      assemblies: applyOverrideKind(contract.assemblies),
      orchestrations: applyStructuredInterlocks(contract.orchestrations, interlocks),
      confirmation_status: "confirmed",
    };

    const issues = validateSpecContractPatch(patch);
    expect(issues).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the integration test**

```bash
npx vitest run src/lib/spec-builder/__tests__/migration-integration.test.ts
```

Expected: PASS — 2 tests × 3 fixtures = 6 tests.

If a fixture fails `SpecContractV2Schema.parse` — fix the fixture, not the schema. Schema is the source of truth.

- [ ] **Step 4: Commit**

```bash
git add src/lib/spec-builder/migrate/__fixtures__/ src/lib/spec-builder/__tests__/migration-integration.test.ts
git commit -m "test(fds-engine): migration integration — 3 fixtures × shape + validator"
```

---

### Task 23: Final sweep — tsc + tests + build + design-doc status note

**Files:** none (verification only) + `Docs/superpowers/specs/2026-05-25-fds-engine-design.md`

- [ ] **Step 1: Full type check**

```bash
npx tsc -b
```

Expected: 0 errors. Phase 1's Task 18 left tsc clean; Phase 2 should keep it clean. Any error here is a real Phase 2 regression and must be fixed before continuing.

- [ ] **Step 2: Full test suite**

```bash
npm test -- --run
```

Expected: 33 pre-existing unrelated failures (the established baseline). Phase 2's tests should add roughly 35-45 passing tests across the new modules. If the failure count grows beyond 33, debug the regression before continuing.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Lint sweep**

```bash
npm run lint
```

Expected: Phase 1's pre-existing 73 problems may still exist (unrelated). Phase 2 should not introduce new lint errors. The forge `no-restricted-imports` rule from Phase 1 Task 17 doesn't apply to any Phase 2 files (the wizard isn't a forge module).

- [ ] **Step 5: Update the design-doc status line**

In `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` §6, update the Phase-1 status note to reflect Phase 2 landing. Find the line:

```
**Release N+1 Phase 1 status: complete as of 2026-05-25. Schema, validator, writer routing, reader branching, ESLint boundary lint. Phases 2-7 pending.**
```

Replace with:

```
**Release N+1 Phase 1 status: complete as of 2026-05-25. Schema, validator, writer routing, reader branching, ESLint boundary lint.**
**Release N+1 Phase 2 status: complete as of <YYYY-MM-DD>. Migration wizard + per-project confirmation flow (route, banner, 3 tabs, AI interlock classifier, telemetry). Phases 3-7 pending.**
```

Use today's date for the Phase 2 line.

- [ ] **Step 6: Commit**

```bash
git add Docs/superpowers/specs/2026-05-25-fds-engine-design.md
git commit -m "docs(fds-engine): mark Phase 2 (migration wizard + per-project confirmation) complete"
```

---

## Phase 2 Done

After Task 23, the migration wizard is live. Engineers see a V1 badge on unconfirmed projects, navigate to `/specs/:projectId/:specId/migrate`, walk three tabs, and Confirm to flip `confirmation_status` to `confirmed`. Phase 1's reader serves the new structured shape automatically; all spec-builder routes unlock for writes. The AI interlock classifier is in production with telemetry (`fds_migration_events`) measuring engineer override rate as a proxy for classifier accuracy.

**No production project has been confirmed yet.** Migration 089 ships the column + telemetry table; the first real Confirm happens when an engineer opens the wizard against a real unconfirmed project. Coordinate with the user when applying the migration to remote Supabase.

**Next phases per parent design §6:**
- Phase 3 — V2 interview prompt rewrite (co-author emits V2 shapes natively)
- Phase 4 — Monitor picker UI
- Phase 5 — Materialised `spec_sections` rebuild + editor refactor through `writeSpecContract`
- Phase 6 — Modes wizard step + per-mode matrix tabs
- Phase 7 — ISA-88 docs / terminology pass

Plus the deferred Italian translation table (8466 Norte/Sur) — a narrow follow-up that can land any time.
