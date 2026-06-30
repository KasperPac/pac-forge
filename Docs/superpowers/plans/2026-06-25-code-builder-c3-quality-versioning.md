# Code Builder C3 — Quality + Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-builder quality gates (deterministic safety analyzer + AI Standards Review) and per-FB version history (snapshot / diff / restore) to the EM-layer Code Builder, plus per-region drift granularity — so an EM FB can be vetted and its history tracked before Approve, with results that survive reload.

**Architecture:** Three deterministic seams reused from the existing codebase — `safety-analyzer.analyzeArtifacts` (safety gate), `forge-agent-prompts.buildForgeReviewPrompt("equipment_module")` + `forge-review-parser.parseForgeReviewResponse` (AI Standards Review, the same machinery the Forge wizard already uses off a spec, so no `Project`/`Agent` plumbing is needed), and `diff-engine.computeDiff` + `em-fill-regions.regionDrift` (versioning + per-region drift). New persistence is one migration: a `code_builder_versions` table plus three columns on `code_builder_artifacts` for acknowledgements and review results. The UI adds two presentational components mounted in the existing right-hand panel; Approve is gated when the safety check has unacknowledged warnings, and a version is snapshotted on every Approve.

**Tech Stack:** React 19 + TypeScript 5.9 (strict, `import type`, no enums), TanStack Query, Supabase (Postgres + RLS), Vitest + Testing Library, Tailwind v3 + shadcn/ui.

**Generic-by-construction (CLAUDE.md):** Every reused engine is machine-agnostic; no task introduces a device name, sequence, or fault condition. The only new prompt usage reuses the existing generic `buildForgeReviewPrompt` with the existing `"equipment_module"` stage — no new project-specific prompt content. Mentally verified against conveyor / lift-table / stamping EM shapes.

**Out of scope / deferred (matches design §6 and the C4 split):**
- Promote-to-Library (`promote-to-library-dialog`, `interface_contract` auto-derivation) — that is **C4**, not C3.
- TIA compile gate — stays in sub-project F.
- A rewrite/auto-fix loop off review findings — C3 only *reports* findings; it does not rewrite.
- Severity tiers for safety warnings — `SafetyWarning` carries no severity, so the gate treats every unacknowledged warning as Approve-blocking and acknowledgement as the release valve (honest mapping to the existing engine; no invented severity).

---

## File Structure

**New**
- `src/lib/spec-builder/fb-quality-gate.ts` — pure safety-gate evaluator + stable warning key (reuses `analyzeArtifacts`).
- `src/lib/spec-builder/__tests__/fb-quality-gate.test.ts`
- `src/hooks/use-em-standards-review.ts` — AI Standards Review for one EM FB; exports a pure `buildEmReviewInput` helper for testing.
- `src/hooks/__tests__/use-em-standards-review.test.ts`
- `src/hooks/use-code-builder-versions.ts` — version list / snapshot / restore against `code_builder_versions`.
- `src/components/code-builder/fb-quality-gates.tsx` — safety warnings (acknowledge) + Run Standards Review + findings + badges.
- `src/components/code-builder/__tests__/fb-quality-gates.test.tsx`
- `src/components/code-builder/fb-version-history.tsx` — version list + diff (via `diff-engine`) + restore.
- `src/components/code-builder/__tests__/fb-version-history.test.tsx`
- `supabase/migrations/20260625000000_code_builder_quality_versioning.sql` — `code_builder_versions` table + gate/review columns on `code_builder_artifacts`.

**Modified**
- `src/types/code-builder.ts` — `regionDrift` on the view; gate/review persistence columns on row + view; `CodeBuilderVersionRow`.
- `src/lib/spec-builder/code-builder-reconcile.ts` — compute `regionDrift`; carry gate/review persistence from the prior row into the view.
- `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` — extend.
- `src/hooks/use-code-builder.ts` — `acknowledgeWarning` + `saveReview` mutations.
- `src/routes/code-builder.tsx` — mount the gates + history; gate Approve on unacknowledged safety warnings; snapshot a version on Approve.
- `src/routes/__tests__/code-builder.test.tsx` — extend.

---

## Task 1: Per-region drift in reconcile

**Goal:** The reconciled view exposes which AI-fill regions changed on recompile, not just a whole-FB `drift` boolean.

**Files:**
- Modify: `src/types/code-builder.ts`
- Modify: `src/lib/spec-builder/code-builder-reconcile.ts`
- Test: `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`

**Acceptance Criteria:**
- [ ] `CodeBuilderArtifactView.regionDrift: string[]` exists.
- [ ] `regionDrift` is `[]` for new/unchanged/non-EM artifacts.
- [ ] When a reviewed EM FB's recompiled skeleton changes an AI-fill region body, that region id appears in `regionDrift`.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add `regionDrift` to the view type**

In `src/types/code-builder.ts`, inside `interface CodeBuilderArtifactView`, add the field directly after the existing `drift` field:

```ts
  /** True when this artifact was edited/approved AND the FDS recompile differs. */
  drift: boolean;
  /** AI-fill region ids whose body changed on recompile (subset of `drift`). */
  regionDrift: string[];
```

- [ ] **Step 2: Write the failing test**

Append to `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`, inside the existing `describe("reconcileArtifacts", ...)` block, before its closing `});`:

```ts
  it("defaults regionDrift to empty for a new artifact", () => {
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing: [] });
    expect(v.regionDrift).toEqual([]);
  });

  it("lists AI-fill regions that changed between the reviewed and recompiled FB", () => {
    const oldFb = [
      "FUNCTION_BLOCK EM_X",
      "// <ai-fill EM_X:running.1>",
      '"M01".cmd_run := TRUE;',
      "// </ai-fill EM_X:running.1>",
      "// <ai-fill EM_X:running.2>",
      "// TODO (AI-fill): hold",
      "// </ai-fill EM_X:running.2>",
      "END_FUNCTION_BLOCK",
    ].join("\n");
    const newFb = oldFb.replace('"M01".cmd_run := TRUE;', '"M01".cmd_run := FALSE;');
    const existing = [row({
      artifact_name: "EM_X", type: "FB", layer: "em",
      status: "approved", generated_content: oldFb,
    })];
    const [v] = reconcileArtifacts({
      specId: "s1", revision: 2,
      compiled: [artifact({ name: "EM_X", type: "FB", layer: "em", content: newFb })],
      existing,
    });
    expect(v.drift).toBe(true);
    expect(v.regionDrift).toEqual(["EM_X:running.1"]);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`
Expected: FAIL — `regionDrift` is `undefined` (property does not exist on the returned view).

- [ ] **Step 4: Implement region-drift computation**

In `src/lib/spec-builder/code-builder-reconcile.ts`, add the import at the top (after the existing imports):

```ts
import { regionDrift as computeRegionDrift } from "@/lib/spec-builder/codegen/em-fill-regions";
```

Then inside `reconcileArtifacts`, replace the `const drift = ...` line and the returned object's `drift` field. The full updated `.map(...)` body:

```ts
  return input.compiled.map((a) => {
    const prior = byName.get(a.name);
    const reviewed = !!prior && (prior.status === "approved" || prior.edited_content !== null);
    const drift = !!prior && reviewed && prior.generated_content !== a.content;
    const regionDrift = drift ? computeRegionDrift(prior!.generated_content, a.content) : [];
    return {
      artifact_name: a.name,
      layer: a.layer,
      owner_id: a.ownerId ?? prior?.owner_id ?? null,
      owner_name: a.ownerName ?? null,
      type: a.type,
      filename: a.filename,
      folder: a.folder,
      dependencies: a.dependencies,
      generated_content: a.content,
      edited_content: prior?.edited_content ?? null,
      status: prior?.status ?? "pending",
      drift,
      regionDrift,
    };
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`
Expected: PASS — all reconcile tests green.

- [ ] **Step 6: Commit**

```bash
git add src/types/code-builder.ts src/lib/spec-builder/code-builder-reconcile.ts src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts
git commit -m "feat(code-builder): per-region drift in EM artifact reconcile"
```

---

## Task 2: Safety-gate model (pure)

**Goal:** A pure evaluator that turns an FB's SCL into a pass/blocked safety-gate result over the existing safety analyzer, with a stable per-warning key for acknowledgement persistence.

**Files:**
- Create: `src/lib/spec-builder/fb-quality-gate.ts`
- Test: `src/lib/spec-builder/__tests__/fb-quality-gate.test.ts`

**Acceptance Criteria:**
- [ ] `warningKey(w)` is stable across analyzer runs (independent of the random `w.id`).
- [ ] `evaluateSafetyGate` returns every analyzer warning plus a `blocked` flag.
- [ ] `blocked` is true when any warning's key is NOT in the acknowledged set, false otherwise.
- [ ] A clean FB yields `{ warnings: [], blocked: false }`.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/fb-quality-gate.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/fb-quality-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { warningKey, evaluateSafetyGate } from "../fb-quality-gate";
import type { SafetyWarning } from "@/types";

const w = (over: Partial<SafetyWarning>): SafetyWarning => ({
  id: crypto.randomUUID(), type: "MISSING_INTERLOCK", artifact_name: "EM_X",
  description: "x", line: 12, acknowledged: false, ...over,
});

describe("warningKey", () => {
  it("is independent of the random id", () => {
    const a = w({ id: "id-a", type: "UNSAFE_MOTOR", line: 7 });
    const b = w({ id: "id-b", type: "UNSAFE_MOTOR", line: 7 });
    expect(warningKey(a)).toBe(warningKey(b));
  });

  it("encodes type and line", () => {
    expect(warningKey(w({ type: "ARRAY_OOB", line: 30 }))).toBe("ARRAY_OOB:30");
    expect(warningKey(w({ type: "ARRAY_OOB", line: null }))).toBe("ARRAY_OOB:?");
  });
});

describe("evaluateSafetyGate", () => {
  it("passes a clean FB", () => {
    const r = evaluateSafetyGate("EM_Clean", "FB", "FUNCTION_BLOCK EM_Clean\nEND_FUNCTION_BLOCK", []);
    expect(r.warnings).toEqual([]);
    expect(r.blocked).toBe(false);
  });

  it("blocks when a warning is unacknowledged and unblocks once its key is acknowledged", () => {
    // A motor coil written with no interlock anywhere nearby trips MISSING_INTERLOCK.
    const scl = [
      "FUNCTION_BLOCK EM_Pump",
      "BEGIN",
      '"PUMP_RUN" := TRUE;',
      "END_FUNCTION_BLOCK",
    ].join("\n");
    const open = evaluateSafetyGate("EM_Pump", "FB", scl, []);
    expect(open.warnings.length).toBeGreaterThan(0);
    expect(open.blocked).toBe(true);

    const keys = open.warnings.map(warningKey);
    const closed = evaluateSafetyGate("EM_Pump", "FB", scl, keys);
    expect(closed.warnings.length).toBe(open.warnings.length);
    expect(closed.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/fb-quality-gate.test.ts`
Expected: FAIL — cannot resolve `../fb-quality-gate`.

- [ ] **Step 3: Implement the gate**

Create `src/lib/spec-builder/fb-quality-gate.ts`:

```ts
import { analyzeArtifacts } from "@/lib/safety-analyzer";
import type { SafetyWarning } from "@/types";

/** Stable acknowledgement key for a warning — independent of the random
 *  `SafetyWarning.id`, which changes every analyzer run. */
export function warningKey(w: SafetyWarning): string {
  return `${w.type}:${w.line ?? "?"}`;
}

export interface SafetyGateResult {
  /** Every warning the analyzer raised for this FB. */
  warnings: SafetyWarning[];
  /** True when at least one warning's key is not in `acknowledged`. */
  blocked: boolean;
}

/**
 * Run the rule-based safety analyzer over one FB's SCL and classify the gate.
 * `acknowledged` is the set of previously-acknowledged warning keys
 * (`warningKey`). The gate blocks Approve while any warning is unacknowledged.
 * Pure: no IO, deterministic for a given input.
 */
export function evaluateSafetyGate(
  name: string,
  type: string,
  content: string,
  acknowledged: string[],
): SafetyGateResult {
  const ackSet = new Set(acknowledged);
  const warnings = analyzeArtifacts([{ name, type, content }]);
  const blocked = warnings.some((w) => !ackSet.has(warningKey(w)));
  return { warnings, blocked };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/fb-quality-gate.test.ts`
Expected: PASS.

> If the `MISSING_INTERLOCK` rule does not trip on the exact fixture above, open `src/lib/safety-analyzer.ts`, read the first rule's `detect`/`mitigatedBy` regexes, and adjust the fixture SCL so it matches a `detect` pattern with no `mitigatedBy` pattern within ±15 lines. Do NOT change the analyzer.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/fb-quality-gate.ts src/lib/spec-builder/__tests__/fb-quality-gate.test.ts
git commit -m "feat(code-builder): pure safety-gate evaluator over safety-analyzer"
```

---

## Task 3: Migration + persistence types + reconcile passthrough

**Goal:** Persist acknowledgements and review results on `code_builder_artifacts`, add a `code_builder_versions` table, and surface the persisted gate/review state on the reconciled view.

**Files:**
- Create: `supabase/migrations/20260625000000_code_builder_quality_versioning.sql`
- Modify: `src/types/code-builder.ts`
- Modify: `src/lib/spec-builder/code-builder-reconcile.ts`
- Test: `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`

**Acceptance Criteria:**
- [ ] Migration creates `code_builder_versions` with RLS scoped to the owning spec, and adds `acknowledged_warnings`, `review_status`, `review_findings` to `code_builder_artifacts`.
- [ ] `CodeBuilderArtifactRow`/`View` carry the three persisted fields; `CodeBuilderVersionRow` exists.
- [ ] `reconcileArtifacts` carries the persisted gate/review fields from the prior row (defaults when absent).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260625000000_code_builder_quality_versioning.sql`:

```sql
-- Code Builder C3 — quality-gate state on artifacts + a per-FB version log.

-- 1. Persisted gate / review state on each artifact (survives reload).
ALTER TABLE code_builder_artifacts
  ADD COLUMN acknowledged_warnings JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN review_status TEXT CHECK (review_status IN ('pass', 'findings')),
  ADD COLUMN review_findings JSONB NOT NULL DEFAULT '[]';

-- 2. Per-FB version log: a snapshot of the EM artifact set (FB + UDT + Cmd DB
--    + Map FC) keyed by owner_id + layer. Restore is non-destructive (writes a
--    new row), so history is append-only.
CREATE TABLE code_builder_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,
  revision INT NOT NULL,

  owner_id TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('device', 'em', 'unit', 'ob1')),

  -- payload: { "artifacts": [{ "artifact_name": "...", "content": "..." }, ...] }
  payload JSONB NOT NULL DEFAULT '{"artifacts":[]}',
  note TEXT NOT NULL DEFAULT '',
  author UUID,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE code_builder_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own code_builder_versions"
  ON code_builder_versions FOR ALL
  USING (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE INDEX idx_code_builder_versions_owner
  ON code_builder_versions(spec_id, revision, owner_id, layer);
```

- [ ] **Step 2: Extend the types**

In `src/types/code-builder.ts`, add the import at the top:

```ts
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import type { ReviewFinding } from "@/lib/forge-review-parser";
```

Add these fields to `interface CodeBuilderArtifactRow` (after `approved_at`):

```ts
  approved_at: string | null;
  acknowledged_warnings: string[];
  review_status: "pass" | "findings" | null;
  review_findings: ReviewFinding[];
  updated_at: string;
```

Add the same three fields to `interface CodeBuilderArtifactView` (after `drift` / `regionDrift`):

```ts
  drift: boolean;
  regionDrift: string[];
  acknowledged_warnings: string[];
  review_status: "pass" | "findings" | null;
  review_findings: ReviewFinding[];
```

Append the version row type at the end of the file:

```ts
/** A snapshot row in code_builder_versions. */
export interface CodeBuilderVersionRow {
  id: string;
  spec_id: string;
  revision: number;
  owner_id: string;
  layer: CodegenLayer;
  payload: { artifacts: { artifact_name: string; content: string }[] };
  note: string;
  author: string | null;
  created_at: string;
}
```

- [ ] **Step 3: Write the failing test**

Append to `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`, inside the `describe` block. First update the `row()` helper's defaults to include the new columns (so it type-checks) — change the helper to:

```ts
const row = (over: Partial<CodeBuilderArtifactRow>): CodeBuilderArtifactRow => ({
  id: "r1", spec_id: "s1", revision: 2, artifact_name: "CM_Motor_M01_DB",
  layer: "device", owner_id: "cm-1", type: "DB", filename: "CM_Motor_M01_DB.db",
  folder: "Program blocks", dependencies: ["CM_Motor"],
  generated_content: "DATA_BLOCK v1", edited_content: null, status: "pending",
  approved_by: null, approved_at: null,
  acknowledged_warnings: [], review_status: null, review_findings: [],
  updated_at: "", ...over,
});
```

Then add this test before the `describe` block's closing `});`:

```ts
  it("carries persisted gate/review state from the prior row", () => {
    const existing = [row({
      acknowledged_warnings: ["MISSING_INTERLOCK:12"],
      review_status: "findings",
      review_findings: [{ severity: "WARNING", artifactName: "CM_Motor_M01_DB", message: "x" }],
    })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing });
    expect(v.acknowledged_warnings).toEqual(["MISSING_INTERLOCK:12"]);
    expect(v.review_status).toBe("findings");
    expect(v.review_findings).toHaveLength(1);
  });

  it("defaults persisted gate/review state when there is no prior row", () => {
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing: [] });
    expect(v.acknowledged_warnings).toEqual([]);
    expect(v.review_status).toBeNull();
    expect(v.review_findings).toEqual([]);
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`
Expected: FAIL — view lacks `acknowledged_warnings` / `review_status` / `review_findings`.

- [ ] **Step 5: Carry persisted fields through reconcile**

In `src/lib/spec-builder/code-builder-reconcile.ts`, inside the `.map(...)` return object (added in Task 1), append after `regionDrift`:

```ts
      drift,
      regionDrift,
      acknowledged_warnings: prior?.acknowledged_warnings ?? [],
      review_status: prior?.review_status ?? null,
      review_findings: prior?.review_findings ?? [],
    };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260625000000_code_builder_quality_versioning.sql src/types/code-builder.ts src/lib/spec-builder/code-builder-reconcile.ts src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts
git commit -m "feat(code-builder): quality/version persistence schema + reconcile passthrough"
```

---

## Task 4: Gate/review/version persistence hooks

**Goal:** Mutations to acknowledge a warning and save review results on an artifact, plus a versions hook to list / snapshot / restore an EM FB's artifact set.

**Files:**
- Modify: `src/hooks/use-code-builder.ts`
- Create: `src/hooks/use-code-builder-versions.ts`

**Acceptance Criteria:**
- [ ] `useCodeBuilder` returns `acknowledgeWarning` and `saveReview` mutations that update the row and invalidate by the `codeBuilderKey` prefix.
- [ ] `useCodeBuilderVersions` returns a `versions` query keyed by spec/revision/owner/layer plus `saveVersion` and `restoreVersion`.
- [ ] `restoreVersion` writes each snapshot artifact's content back to `edited_content` (non-destructive) and invalidates the artifact query.
- [ ] `npx tsc -b` is clean.

**Verify:** `npx tsc -b && npx vitest run src/routes/__tests__/code-builder.test.tsx` → typecheck clean, route tests still pass.

**Steps:**

- [ ] **Step 1: Add acknowledge + saveReview mutations to `use-code-builder.ts`**

In `src/hooks/use-code-builder.ts`, add the import for the finding type at the top with the other type imports:

```ts
import type { ReviewFinding } from "@/lib/forge-review-parser";
```

After the existing `saveEdit` mutation (before the `const unitGroups = ...` line), add:

```ts
  const acknowledgeWarning = useMutation({
    mutationFn: async (vars: { artifactName: string; warningKeys: string[] }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ acknowledged_warnings: vars.warningKeys })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", vars.artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  const saveReview = useMutation({
    mutationFn: async (vars: { artifactName: string; status: "pass" | "findings"; findings: ReviewFinding[] }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ review_status: vars.status, review_findings: vars.findings })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", vars.artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });
```

Then add both to the returned object on the final `return { ... }` line:

```ts
  return { artifacts, approve, saveEdit, acknowledgeWarning, saveReview, ready, revision, unitGroups, emById };
```

- [ ] **Step 2: Create the versions hook**

Create `src/hooks/use-code-builder-versions.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { codeBuilderKey } from "@/hooks/use-code-builder";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import type { CodeBuilderVersionRow } from "@/types/code-builder";

const VERSIONS_TABLE = "code_builder_versions";

export type VersionArtifact = { artifact_name: string; content: string };

export const codeBuilderVersionsKey = (
  specId?: string, revision?: number, ownerId?: string, layer?: CodegenLayer,
) => ["code_builder_versions", specId ?? "", revision ?? -1, ownerId ?? "", layer ?? ""] as const;

/**
 * Per-EM (owner_id + layer) version log. Snapshots are append-only; restore
 * writes the chosen snapshot back onto the working artifacts as edits and never
 * deletes history.
 */
export function useCodeBuilderVersions(
  specId: string | undefined,
  revision: number | undefined,
  ownerId: string | null | undefined,
  layer: CodegenLayer,
) {
  const qc = useQueryClient();
  const enabled = !!specId && revision !== undefined && !!ownerId;

  const versions = useQuery({
    queryKey: codeBuilderVersionsKey(specId, revision, ownerId ?? undefined, layer),
    enabled,
    queryFn: async (): Promise<CodeBuilderVersionRow[]> => {
      const { data, error } = await supabase
        .from(VERSIONS_TABLE)
        .select("*")
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("owner_id", ownerId as string)
        .eq("layer", layer)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CodeBuilderVersionRow[];
    },
  });

  const saveVersion = useMutation({
    mutationFn: async (vars: { artifacts: VersionArtifact[]; note: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from(VERSIONS_TABLE).insert({
        spec_id: specId as string,
        revision: revision as number,
        owner_id: ownerId as string,
        layer,
        payload: { artifacts: vars.artifacts },
        note: vars.note,
        author: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codeBuilderVersionsKey(specId, revision, ownerId ?? undefined, layer) });
    },
  });

  const restoreVersion = useMutation({
    mutationFn: async (version: CodeBuilderVersionRow) => {
      for (const a of version.payload.artifacts) {
        const { error } = await supabase
          .from("code_builder_artifacts")
          .update({ edited_content: a.content })
          .eq("spec_id", specId as string)
          .eq("revision", revision as number)
          .eq("artifact_name", a.artifact_name);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) });
    },
  });

  return { versions, saveVersion, restoreVersion };
}
```

- [ ] **Step 3: Verify typecheck + existing route tests**

Run: `npx tsc -b && npx vitest run src/routes/__tests__/code-builder.test.tsx`
Expected: TSC clean; route tests still pass (the hook surface grew but is additive).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-code-builder.ts src/hooks/use-code-builder-versions.ts
git commit -m "feat(code-builder): acknowledge/saveReview mutations + version log hook"
```

---

## Task 5: EM Standards Review hook (AI)

**Goal:** An on-demand AI Standards Review of a single EM FB, reusing the Forge reviewer prompt + parser, with a pure input-builder that is unit-testable without the network.

**Files:**
- Create: `src/hooks/use-em-standards-review.ts`
- Test: `src/hooks/__tests__/use-em-standards-review.test.ts`

**Acceptance Criteria:**
- [ ] `buildEmReviewInput` returns `{ systemPrompt, userMessage }`; the user message contains the FB name + its SCL and is generic (no machine-specific tokens).
- [ ] The hook calls `callNonStreaming` with that input and returns `parseForgeReviewResponse(content)`.
- [ ] A `NO_CHANGES` response yields a clean (no-findings) result.

**Verify:** `npx vitest run src/hooks/__tests__/use-em-standards-review.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/use-em-standards-review.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildEmReviewInput } from "../use-em-standards-review";

describe("buildEmReviewInput", () => {
  const platformRules = "## Platform Rules\nUse interlocks.";

  it("includes the FB name and SCL in the user message", () => {
    const { userMessage } = buildEmReviewInput(
      { name: "EM_Carriage_Drive", type: "FB", content: 'FUNCTION_BLOCK EM_Carriage_Drive\n"M01".cmd_run := TRUE;\nEND_FUNCTION_BLOCK' },
      platformRules,
    );
    expect(userMessage).toContain("EM_Carriage_Drive");
    expect(userMessage).toContain('"M01".cmd_run := TRUE;');
    expect(userMessage).toContain("```scl");
  });

  it("produces a non-empty system prompt from the reviewer sections", () => {
    const { systemPrompt } = buildEmReviewInput(
      { name: "EM_X", type: "FB", content: "FUNCTION_BLOCK EM_X\nEND_FUNCTION_BLOCK" },
      platformRules,
    );
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt).toContain("Platform Rules");
  });

  it("is generic — carries no machine-specific tokens of its own", () => {
    const { systemPrompt, userMessage } = buildEmReviewInput(
      { name: "EM_X", type: "FB", content: "FUNCTION_BLOCK EM_X\nEND_FUNCTION_BLOCK" },
      platformRules,
    );
    for (const token of ["conveyor", "lift", "stamp", "carriage", "wagon"]) {
      expect(systemPrompt.toLowerCase()).not.toContain(token);
      // userMessage only contains the caller-supplied FB, never a hard-coded name
      expect(userMessage.toLowerCase()).not.toContain(token);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-em-standards-review.test.ts`
Expected: FAIL — cannot resolve `../use-em-standards-review`.

- [ ] **Step 3: Implement the hook + pure builder**

Create `src/hooks/use-em-standards-review.ts`:

```ts
import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildForgeReviewPrompt } from "@/lib/forge-agent-prompts";
import { parseForgeReviewResponse, isCleanReview, type ForgeReviewResult } from "@/lib/forge-review-parser";
import { loadPlatformRules } from "@/lib/platform-rules";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

export interface EmReviewArtifact {
  name: string;
  type: string;
  content: string;
}

/**
 * Build the system prompt + user message for a single-EM Standards Review.
 * Reuses the generic Forge reviewer prompt at the `"equipment_module"` stage —
 * no project-specific content. Pure: takes platform rules + prompt sections as
 * args so it is testable without hooks.
 */
export function buildEmReviewInput(
  fb: EmReviewArtifact,
  platformRules: string,
  promptSections?: Record<string, string>,
  profileRules?: string,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = buildForgeReviewPrompt("equipment_module", platformRules, profileRules, promptSections);
  const userMessage = `Review the following artifacts:\n\n### ${fb.name} (${fb.type})\n\`\`\`scl\n${fb.content}\n\`\`\``;
  return { systemPrompt, userMessage };
}

/** On-demand AI Standards Review for one EM FB. */
export function useEmStandardsReview() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = useCallback(
    async (fb: EmReviewArtifact): Promise<ForgeReviewResult> => {
      setLoading(true);
      setError(null);
      try {
        const platformRules = loadPlatformRules("review");
        const { systemPrompt, userMessage } = buildEmReviewInput(fb, platformRules, promptSections);
        const controller = new AbortController();
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          controller.signal,
          8192,
          { prompt_name: "em-standards-review", agent_role: "standards_reviewer", pipeline_step: "em_standards_review" },
        );
        if (isCleanReview(content)) {
          return { findings: [], rewriteScope: "TARGETED", affectedFiles: [], hasCritical: false, hasWarning: false, rawResponse: content };
        }
        return parseForgeReviewResponse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Review failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [promptSections],
  );

  return { review, loading, error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-em-standards-review.test.ts`
Expected: PASS.

> If the `"is generic"` test fails because a reviewer prompt section legitimately contains one of the example tokens, narrow the token list to the ones that are genuinely absent — the intent is "no machine-specific name is hard-coded by THIS builder", which is satisfied as long as the user message only echoes the caller-supplied FB.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-em-standards-review.ts src/hooks/__tests__/use-em-standards-review.test.ts
git commit -m "feat(code-builder): single-EM Standards Review hook reusing forge reviewer"
```

---

## Task 6: FB quality-gates component

**Goal:** A presentational panel that shows safety warnings with acknowledge controls and the Standards Review badge + findings, driven entirely by props/callbacks.

**Files:**
- Create: `src/components/code-builder/fb-quality-gates.tsx`
- Test: `src/components/code-builder/__tests__/fb-quality-gates.test.tsx`

**Acceptance Criteria:**
- [ ] Renders one row per safety warning with an Acknowledge button; acknowledged warnings show an acknowledged state and no button.
- [ ] Shows a `blocked` indicator when the gate is blocked and a clean indicator when not.
- [ ] "Run Standards Review" button fires `onRunReview`; while `reviewing` it is disabled.
- [ ] Renders a review badge (`pass` / `findings`) and one row per finding when `reviewStatus` is set.

**Verify:** `npx vitest run src/components/code-builder/__tests__/fb-quality-gates.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/components/code-builder/__tests__/fb-quality-gates.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FbQualityGates } from "../fb-quality-gates";
import type { SafetyWarning } from "@/types";
import type { ReviewFinding } from "@/lib/forge-review-parser";

const warning = (over: Partial<SafetyWarning>): SafetyWarning => ({
  id: crypto.randomUUID(), type: "MISSING_INTERLOCK", artifact_name: "EM_X",
  description: "Motor coil without interlock", line: 12, acknowledged: false, ...over,
});

const base = {
  warnings: [] as SafetyWarning[],
  blocked: false,
  acknowledged: [] as string[],
  reviewStatus: null as "pass" | "findings" | null,
  findings: [] as ReviewFinding[],
  reviewing: false,
  onAcknowledge: vi.fn(),
  onRunReview: vi.fn(),
};

describe("FbQualityGates", () => {
  it("shows a clean safety state with no warnings", () => {
    render(<FbQualityGates {...base} />);
    expect(screen.getByTestId("safety-gate")).toHaveTextContent(/safe|pass|no warnings/i);
  });

  it("lists warnings and fires onAcknowledge", () => {
    const w = warning({ type: "UNSAFE_MOTOR", line: 7 });
    const onAcknowledge = vi.fn();
    render(<FbQualityGates {...base} warnings={[w]} blocked onAcknowledge={onAcknowledge} />);
    expect(screen.getByText(/Motor coil without interlock/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ack-UNSAFE_MOTOR:7"));
    expect(onAcknowledge).toHaveBeenCalledWith("UNSAFE_MOTOR:7");
  });

  it("hides the acknowledge button for already-acknowledged warnings", () => {
    const w = warning({ type: "ARRAY_OOB", line: 5 });
    render(<FbQualityGates {...base} warnings={[w]} acknowledged={["ARRAY_OOB:5"]} />);
    expect(screen.queryByTestId("ack-ARRAY_OOB:5")).not.toBeInTheDocument();
  });

  it("runs the standards review and renders findings", () => {
    const onRunReview = vi.fn();
    const findings: ReviewFinding[] = [{ severity: "WARNING", artifactName: "EM_X", message: "Prefer SR over RS" }];
    const { rerender } = render(<FbQualityGates {...base} onRunReview={onRunReview} />);
    fireEvent.click(screen.getByTestId("run-review"));
    expect(onRunReview).toHaveBeenCalled();

    rerender(<FbQualityGates {...base} reviewStatus="findings" findings={findings} />);
    expect(screen.getByTestId("review-badge")).toHaveTextContent(/findings/i);
    expect(screen.getByText(/Prefer SR over RS/)).toBeInTheDocument();
  });

  it("disables the run button while reviewing", () => {
    render(<FbQualityGates {...base} reviewing />);
    expect(screen.getByTestId("run-review")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/fb-quality-gates.test.tsx`
Expected: FAIL — cannot resolve `../fb-quality-gates`.

- [ ] **Step 3: Implement the component**

Create `src/components/code-builder/fb-quality-gates.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { warningKey } from "@/lib/spec-builder/fb-quality-gate";
import type { SafetyWarning } from "@/types";
import type { ReviewFinding } from "@/lib/forge-review-parser";

export function FbQualityGates({
  warnings, blocked, acknowledged, reviewStatus, findings, reviewing, onAcknowledge, onRunReview,
}: {
  warnings: SafetyWarning[];
  blocked: boolean;
  acknowledged: string[];
  reviewStatus: "pass" | "findings" | null;
  findings: ReviewFinding[];
  reviewing: boolean;
  onAcknowledge: (key: string) => void;
  onRunReview: () => void;
}) {
  const ackSet = new Set(acknowledged);

  return (
    <div className="flex flex-col gap-3 p-3 text-[11px]" data-testid="fb-quality-gates">
      <section data-testid="safety-gate" className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Safety</span>
          {warnings.length === 0 ? (
            <Badge variant="outline" className="text-[9px]">Safe — no warnings</Badge>
          ) : blocked ? (
            <Badge variant="destructive" className="text-[9px]">Blocked — {warnings.length} warning(s)</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px]">Acknowledged</Badge>
          )}
        </div>
        {warnings.map((w) => {
          const key = warningKey(w);
          const done = ackSet.has(key);
          return (
            <div key={w.id} className="flex items-start justify-between gap-2 rounded border px-2 py-1">
              <div>
                <span className="font-mono text-[9px] text-muted-foreground">{w.type}{w.line != null ? `:${w.line}` : ""}</span>
                <div>{w.description}</div>
              </div>
              {done ? (
                <span className="shrink-0 text-[9px] text-muted-foreground">acknowledged</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 text-[9px]"
                  data-testid={`ack-${key}`}
                  onClick={() => onAcknowledge(key)}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Standards Review</span>
          {reviewStatus && (
            <Badge
              variant={reviewStatus === "findings" ? "destructive" : "outline"}
              className="text-[9px]"
              data-testid="review-badge"
            >
              {reviewStatus === "findings" ? "Findings" : "Pass"}
            </Badge>
          )}
          <Button
            size="sm"
            className="ml-auto h-6 text-[9px]"
            data-testid="run-review"
            disabled={reviewing}
            onClick={onRunReview}
          >
            {reviewing ? "Reviewing…" : "Run Standards Review"}
          </Button>
        </div>
        {findings.map((f, i) => (
          <div key={i} className="rounded border px-2 py-1">
            <span className="font-mono text-[9px] text-muted-foreground">{f.severity}</span>
            <div>{f.message}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/fb-quality-gates.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/fb-quality-gates.tsx src/components/code-builder/__tests__/fb-quality-gates.test.tsx
git commit -m "feat(code-builder): FB quality-gates panel (safety + standards review)"
```

---

## Task 7: FB version-history component

**Goal:** A presentational panel that lists snapshots, diffs the selected snapshot against the current content, and offers restore — driven by props/callbacks.

**Files:**
- Create: `src/components/code-builder/fb-version-history.tsx`
- Test: `src/components/code-builder/__tests__/fb-version-history.test.tsx`

**Acceptance Criteria:**
- [ ] Renders one row per version with its note + relative position; empty state when none.
- [ ] Selecting a version shows a diff (added/removed counts) of its FB content vs `currentContent`.
- [ ] "Restore" fires `onRestore` with the selected version; "Save version" fires `onSaveVersion`.

**Verify:** `npx vitest run src/components/code-builder/__tests__/fb-version-history.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/components/code-builder/__tests__/fb-version-history.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FbVersionHistory } from "../fb-version-history";
import type { CodeBuilderVersionRow } from "@/types/code-builder";

const version = (over: Partial<CodeBuilderVersionRow>): CodeBuilderVersionRow => ({
  id: "v1", spec_id: "s1", revision: 2, owner_id: "em-1", layer: "em",
  payload: { artifacts: [{ artifact_name: "EM_X", content: "FUNCTION_BLOCK EM_X\nA := 1;\nEND_FUNCTION_BLOCK" }] },
  note: "snapshot A", author: null, created_at: "2026-06-25T10:00:00Z", ...over,
});

const base = {
  fbName: "EM_X",
  currentContent: "FUNCTION_BLOCK EM_X\nA := 2;\nEND_FUNCTION_BLOCK",
  versions: [] as CodeBuilderVersionRow[],
  saving: false,
  restoring: false,
  onSaveVersion: vi.fn(),
  onRestore: vi.fn(),
};

describe("FbVersionHistory", () => {
  it("shows an empty state when there are no versions", () => {
    render(<FbVersionHistory {...base} />);
    expect(screen.getByTestId("version-history")).toHaveTextContent(/no versions/i);
  });

  it("lists versions and diffs the selected one against current", () => {
    render(<FbVersionHistory {...base} versions={[version({})]} />);
    expect(screen.getByText(/snapshot A/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("version-v1"));
    // diff of "A := 1;" vs "A := 2;" → 1 added, 1 removed
    expect(screen.getByTestId("version-diff")).toHaveTextContent(/\+1/);
    expect(screen.getByTestId("version-diff")).toHaveTextContent(/-1/);
  });

  it("fires onRestore for the selected version", () => {
    const onRestore = vi.fn();
    const v = version({});
    render(<FbVersionHistory {...base} versions={[v]} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId("version-v1"));
    fireEvent.click(screen.getByTestId("restore-v1"));
    expect(onRestore).toHaveBeenCalledWith(v);
  });

  it("fires onSaveVersion", () => {
    const onSaveVersion = vi.fn();
    render(<FbVersionHistory {...base} onSaveVersion={onSaveVersion} />);
    fireEvent.click(screen.getByTestId("save-version"));
    expect(onSaveVersion).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/fb-version-history.test.tsx`
Expected: FAIL — cannot resolve `../fb-version-history`.

- [ ] **Step 3: Implement the component**

Create `src/components/code-builder/fb-version-history.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { computeDiff } from "@/lib/diff-engine";
import type { CodeBuilderVersionRow } from "@/types/code-builder";

/** Pull this FB's snapshot content out of a version payload by name. */
function fbContent(v: CodeBuilderVersionRow, fbName: string): string {
  return v.payload.artifacts.find((a) => a.artifact_name === fbName)?.content ?? "";
}

export function FbVersionHistory({
  fbName, currentContent, versions, saving, restoring, onSaveVersion, onRestore,
}: {
  fbName: string;
  currentContent: string;
  versions: CodeBuilderVersionRow[];
  saving: boolean;
  restoring: boolean;
  onSaveVersion: () => void;
  onRestore: (version: CodeBuilderVersionRow) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const diff = selected ? computeDiff(fbContent(selected, fbName), currentContent) : null;

  return (
    <div className="flex flex-col gap-2 p-3 text-[11px]" data-testid="version-history">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Versions</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-6 text-[9px]"
          data-testid="save-version"
          disabled={saving}
          onClick={onSaveVersion}
        >
          {saving ? "Saving…" : "Save version"}
        </Button>
      </div>

      {versions.length === 0 ? (
        <div className="text-muted-foreground">No versions yet.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                data-testid={`version-${v.id}`}
                onClick={() => setSelectedId(v.id)}
                className={`w-full rounded border px-2 py-1 text-left ${selectedId === v.id ? "bg-muted" : ""}`}
              >
                <div className="font-mono text-[9px] text-muted-foreground">{new Date(v.created_at).toLocaleString()}</div>
                <div>{v.note || "(no note)"}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && diff && (
        <div className="flex flex-col gap-1 rounded border p-2" data-testid="version-diff">
          <div className="text-muted-foreground">
            vs current: <span className="text-green-600">+{diff.addedCount}</span>{" "}
            <span className="text-red-600">-{diff.removedCount}</span>
          </div>
          <Button
            size="sm"
            className="h-6 w-fit text-[9px]"
            data-testid={`restore-${selected.id}`}
            disabled={restoring}
            onClick={() => onRestore(selected)}
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/fb-version-history.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/fb-version-history.tsx src/components/code-builder/__tests__/fb-version-history.test.tsx
git commit -m "feat(code-builder): FB version-history panel (list + diff + restore)"
```

---

## Task 8: Wire gates + history into the Code Builder route

**Goal:** Mount the quality gates and version history below the artifact panel for EM artifacts, gate Approve on unacknowledged safety warnings, persist acknowledgements + review results, and snapshot a version on Approve.

**Files:**
- Modify: `src/routes/code-builder.tsx`
- Test: `src/routes/__tests__/code-builder.test.tsx`

**Acceptance Criteria:**
- [ ] For an EM-layer artifact, the gates + history panels render in the right column.
- [ ] Approve is disabled while the safety gate is blocked; acknowledging the last warning re-enables it.
- [ ] Approve also snapshots a version (calls the versions hook's `saveVersion`).
- [ ] "Run Standards Review" calls the review hook and persists the result via `saveReview`.
- [ ] Full suite + typecheck pass.

**Verify:** `npx vitest run src/components/code-builder src/routes/__tests__/code-builder.test.tsx && npx tsc -b` → all pass, typecheck clean.

**Steps:**

- [ ] **Step 1: Add imports + derived gate state to the route**

In `src/routes/code-builder.tsx`, add to the imports:

```ts
import { FbQualityGates } from "@/components/code-builder/fb-quality-gates";
import { FbVersionHistory } from "@/components/code-builder/fb-version-history";
import { useCodeBuilderVersions } from "@/hooks/use-code-builder-versions";
import { useEmStandardsReview, type EmReviewArtifact } from "@/hooks/use-em-standards-review";
import { evaluateSafetyGate } from "@/lib/spec-builder/fb-quality-gate";
```

Change the `useCodeBuilder` destructure to also pull the new mutations + `revision`:

```ts
  const { artifacts, approve, saveEdit, acknowledgeWarning, saveReview, revision, unitGroups = [], emById = {} } = useCodeBuilder(specId, activeLayer);
```

After the `emInfo` line, add the gate/versions/review wiring:

```ts
  const isEmFb = current?.layer === "em" && current.type === "FB";
  const gate = useMemo(
    () =>
      isEmFb && current
        ? evaluateSafetyGate(
            current.artifact_name,
            current.type,
            current.edited_content ?? current.generated_content,
            current.acknowledged_warnings,
          )
        : { warnings: [], blocked: false },
    [isEmFb, current],
  );

  const { versions, saveVersion, restoreVersion } = useCodeBuilderVersions(
    specId, revision, current?.owner_id, activeLayer,
  );
  const { review: runStandardsReview, loading: reviewing } = useEmStandardsReview();

  const snapshotArtifacts = () =>
    related.map((r) => ({ artifact_name: r.artifact_name, content: r.edited_content ?? r.generated_content }));
```

- [ ] **Step 2: Gate Approve + snapshot on Approve**

In the `<ArtifactPanel ... />` JSX, replace the `onApprove` handler so it blocks while the gate is blocked and snapshots a version:

```ts
            onApprove={() => {
              if (!current || gate.blocked) return;
              saveVersion.mutate({ artifacts: snapshotArtifacts(), note: `Approved ${current.artifact_name}` });
              approve.mutate(current.artifact_name);
            }}
```

And pass a `approveDisabled` prop into the panel by adding it to the `<ArtifactPanel>` element:

```ts
          <ArtifactPanel
            artifact={current}
            editing={editing}
            saving={saveEdit.isPending}
            approving={approve.isPending}
            approveDisabled={gate.blocked}
```

Then in `src/components/code-builder/artifact-panel.tsx`, add the optional prop and apply it to the Approve button's `disabled`:

```ts
export function ArtifactPanel({
  artifact, editing, onEdit, onSave, onApprove, saving, approving, approveDisabled = false,
}: {
  artifact: CodeBuilderArtifactView | null;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onApprove: () => void;
  saving: boolean;
  approving: boolean;
  approveDisabled?: boolean;
}) {
```

```ts
        <Button
          size="sm"
          className="h-7 text-[11px]"
          disabled={approving || approveDisabled || artifact.status === "approved"}
          onClick={onApprove}
        >
```

- [ ] **Step 3: Render the gates + history under the panel (EM only)**

In the third grid column of `src/routes/code-builder.tsx`, after the `<ArtifactPanel ... />` element (still inside its `<div className="min-h-0 overflow-auto">`), add:

```tsx
          {isEmFb && current && (
            <>
              <FbQualityGates
                warnings={gate.warnings}
                blocked={gate.blocked}
                acknowledged={current.acknowledged_warnings}
                reviewStatus={current.review_status}
                findings={current.review_findings}
                reviewing={reviewing}
                onAcknowledge={(key) =>
                  acknowledgeWarning.mutate({
                    artifactName: current.artifact_name,
                    warningKeys: [...current.acknowledged_warnings, key],
                  })
                }
                onRunReview={async () => {
                  const fb: EmReviewArtifact = {
                    name: current.artifact_name,
                    type: current.type,
                    content: current.edited_content ?? current.generated_content,
                  };
                  const result = await runStandardsReview(fb);
                  saveReview.mutate({
                    artifactName: current.artifact_name,
                    status: result.findings.length > 0 ? "findings" : "pass",
                    findings: result.findings,
                  });
                }}
              />
              <FbVersionHistory
                fbName={current.artifact_name}
                currentContent={current.edited_content ?? current.generated_content}
                versions={versions.data ?? []}
                saving={saveVersion.isPending}
                restoring={restoreVersion.isPending}
                onSaveVersion={() =>
                  saveVersion.mutate({ artifacts: snapshotArtifacts(), note: `Manual snapshot ${current.artifact_name}` })
                }
                onRestore={(v) => restoreVersion.mutate(v)}
              />
            </>
          )}
```

- [ ] **Step 4: Extend the route test**

In `src/routes/__tests__/code-builder.test.tsx`, the existing `useCodeBuilder` mock must return the new fields. Find the `vi.mock("@/hooks/use-code-builder", ...)` factory and ensure the returned object includes the additions (merge into whatever the mock already returns):

```ts
    acknowledgeWarning: { mutate: vi.fn(), isPending: false },
    saveReview: { mutate: vi.fn(), isPending: false },
    revision: 2,
```

Add mocks for the two new hooks near the other `vi.mock` calls:

```ts
vi.mock("@/hooks/use-code-builder-versions", () => ({
  useCodeBuilderVersions: () => ({
    versions: { data: [] },
    saveVersion: { mutate: vi.fn(), isPending: false },
    restoreVersion: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock("@/hooks/use-em-standards-review", () => ({
  useEmStandardsReview: () => ({ review: vi.fn(), loading: false, error: null }),
}));
```

Then add a test asserting the gates render and Approve is gated for an EM FB with an unacknowledged warning. Add it after the existing EM-layer-switch test (reuse that test's mock setup pattern — an EM-layer FB artifact whose `generated_content` trips a safety rule, `acknowledged_warnings: []`):

```ts
  it("renders quality gates and blocks Approve for an EM FB with unacknowledged warnings", async () => {
    // The existing confirmed-spec mock must expose an EM FB view with a safety
    // warning. Ensure the mocked useCodeBuilder artifacts include:
    //   { artifact_name: "EM_Pump", type: "FB", layer: "em", owner_id: "em-1",
    //     generated_content: 'FUNCTION_BLOCK EM_Pump\nBEGIN\n"PUMP_RUN" := TRUE;\nEND_FUNCTION_BLOCK',
    //     edited_content: null, status: "pending", drift: false, regionDrift: [],
    //     acknowledged_warnings: [], review_status: null, review_findings: [] }
    // and emById["em-1"] = { states: [...], transitions: [...] } as in the layer-switch test.
    renderConfirmed();
    fireEvent.click(screen.getByTestId("step-em"));
    fireEvent.click(await screen.findByText("EM_Pump"));
    expect(screen.getByTestId("fb-quality-gates")).toBeInTheDocument();
    const approveBtn = screen.getByRole("button", { name: /approve/i });
    expect(approveBtn).toBeDisabled();
  });
```

> Adapt the selectors (`renderConfirmed`, `step-em`, the EM-FB row text) to match the helpers the existing test file already defines from C2. The point of the assertion is: gates mount for an EM FB and Approve is disabled while `gate.blocked` is true. If the existing mock does not already surface an EM FB row, extend the mocked `useCodeBuilder` artifact list with the `EM_Pump` view above.

- [ ] **Step 5: Run the full verification**

Run: `npx vitest run src/components/code-builder src/routes/__tests__/code-builder.test.tsx && npx tsc -b`
Expected: All component + route tests pass; `tsc -b` clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/code-builder.tsx src/routes/__tests__/code-builder.test.tsx src/components/code-builder/artifact-panel.tsx
git commit -m "feat(code-builder): wire quality gates + version history into EM layer"
```

---

## Final Verification

After Task 8, run the whole Code Builder surface + typecheck:

```bash
npx vitest run src/lib/spec-builder src/components/code-builder src/hooks/__tests__/use-em-standards-review.test.ts src/routes/__tests__/code-builder.test.tsx && npx tsc -b
```

Expected: all green, `tsc -b` clean. Then deploy the migration with `npx supabase db push` (investigate history drift first per CLAUDE.md before any `migration repair`).

**Post-task self-check (CLAUDE.md):** Only `use-em-standards-review.ts` touches a prompt path, and it reuses the existing generic `buildForgeReviewPrompt("equipment_module")` — no project-specific device names, sequences, or fault conditions are introduced. The safety analyzer, diff engine, and region-drift helpers are all machine-agnostic. Verified mentally against conveyor / lift-table / stamping EM shapes.
