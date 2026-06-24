# Code Builder — Shell + Device Layer (Phase 4, A+B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reviewable, full-screen Phase 4 Code Builder route hosting a functional Device layer — generated CM FBs + instance DBs from the confirmed FDS, persisted with per-artifact approve/edit and drift detection.

**Architecture:** The canonical deterministic codegen engine (`src/lib/spec-builder/codegen/`) is extended with per-artifact provenance (`layer`/`ownerId`/`ownerName`) so the shell can filter Device-layer artifacts. A new Supabase table `code_builder_artifacts` persists generated content + reviewer edits/approvals keyed by `(spec_id, revision)`. A TanStack Query hook compiles-on-open, reconciles against stored rows (preserving edits, flagging drift), and exposes approve/saveEdit. A 3-pane wizard UI (top stepper › control-module list │ artifact viewer │ approve panel) renders behind a confirmed-spec gate, reusing `parseFbFlow` + `FbFlowRenderer` + Monaco directly.

**Tech Stack:** React 19, Vite 7, TypeScript 5.9 (strict, `import type`, no enums), TanStack Query, Zustand (not needed here), Supabase (Postgres + RLS), Monaco Editor, vitest.

---

## Scope

This plan covers **sub-project A (builder shell) + B (device layer) only**. EM / Unit / Export are disabled placeholder steps in the stepper; their artifacts are tagged (`em`/`unit`/`ob1`) and persisted but not surfaced. Global Inputs/Outputs image DBs are deferred to sub-project E/F.

**Generic-across-machines (CLAUDE.md non-negotiable):** no project-specific device names, sequences, or logic anywhere in engine, hook, or UI.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/lib/spec-builder/codegen/types.ts` | Modify | Add `CodegenLayer` union + `layer`/`ownerId`/`ownerName` on `CodegenArtifact` |
| `src/lib/spec-builder/codegen/fb-instantiate.ts` | Modify | Tag CM artifacts `device`, EM artifacts `em`, with owner id/name |
| `src/lib/spec-builder/codegen/udt-writer.ts` | Modify | Tag UDT `unit` + owner = unit |
| `src/lib/spec-builder/codegen/db-writer.ts` | Modify | Tag sequence DB `unit` + owner = unit |
| `src/lib/spec-builder/codegen/fc-writer.ts` | Modify | Tag sequence FC `unit` + owner = unit |
| `src/lib/spec-builder/codegen/ob1-writer.ts` | Modify | Tag OB1 `ob1` |
| `src/lib/spec-builder/codegen/layer-filter.ts` | Create | `filterByLayer()` pure helper |
| `src/lib/spec-builder/codegen/index.ts` | Modify | Export `filterByLayer`, `CodegenLayer` |
| `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts` | Modify | Assert provenance fields |
| `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` | Modify | Assert layer tagging + filter |
| `supabase/migrations/20260623000000_code_builder_artifacts.sql` | Create | Persistence table + RLS + trigger |
| `src/types/code-builder.ts` | Create | `CodeBuilderArtifactRow`, `CodeBuilderLayer`, reconcile types |
| `src/lib/spec-builder/code-builder-reconcile.ts` | Create | Pure `reconcileArtifacts()` (drift logic) |
| `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` | Create | Drift reconciliation tests |
| `src/hooks/use-code-builder.ts` | Create | Compile-on-open + upsert + approve/saveEdit |
| `src/components/code-builder/builder-stepper.tsx` | Create | Top phase stepper (Device active, rest disabled) |
| `src/components/code-builder/control-module-list.tsx` | Create | Left pane — CM list grouped Unit→EM with status pills |
| `src/components/code-builder/artifact-viewer.tsx` | Create | Middle pane — Code/Flow/UDT/Inst DB tabs |
| `src/components/code-builder/artifact-panel.tsx` | Create | Right pane — meta + Approve/Edit/Save |
| `src/routes/code-builder.tsx` | Create | Full-screen page; confirmed-gate; 3-pane wiring |
| `src/App.tsx` | Modify | Register `code-builder` route (lazy) |
| `src/routes/spec-co-author.tsx` | Modify | Replace "Generate SCL" one-shot with "Open Code Builder" link |

---

### Task 1: Engine provenance + layer filter

**Goal:** Every emitted `CodegenArtifact` carries a `layer` and (where applicable) `ownerId`/`ownerName`, and a pure `filterByLayer()` returns exactly the Device-layer artifacts (CM FBs + their instance DBs).

**Files:**
- Modify: `src/lib/spec-builder/codegen/types.ts`
- Modify: `src/lib/spec-builder/codegen/fb-instantiate.ts`
- Modify: `src/lib/spec-builder/codegen/udt-writer.ts`
- Modify: `src/lib/spec-builder/codegen/db-writer.ts`
- Modify: `src/lib/spec-builder/codegen/fc-writer.ts`
- Modify: `src/lib/spec-builder/codegen/ob1-writer.ts`
- Create: `src/lib/spec-builder/codegen/layer-filter.ts`
- Modify: `src/lib/spec-builder/codegen/index.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`

**Acceptance Criteria:**
- [ ] `CodegenArtifact` has `layer: CodegenLayer` (required) + optional `ownerId`/`ownerName`.
- [ ] CM artifacts tagged `device`; EM artifacts `em`; UDT/DB/FC `unit`; OB1 `ob1`.
- [ ] CM/EM device artifacts carry `ownerId`/`ownerName` = the module's id/name; UDT/DB/FC carry the unit's id/name.
- [ ] `filterByLayer(result.artifacts, "device")` returns exactly the CM FBs/instance DBs.
- [ ] `npx tsc -b` passes; all codegen tests pass.

**Verify:** `npx vitest run src/lib/spec-builder/codegen` → all pass; `npx tsc -b` → no errors.

**Steps:**

- [ ] **Step 1: Extend the artifact type (write the new type first so tests compile)**

In `src/lib/spec-builder/codegen/types.ts`, replace the `CodegenArtifact` interface (lines 4–12) with:

```ts
/** Which Phase-4 layer produced an artifact. Lets the Code Builder shell
 *  surface one layer at a time. */
export type CodegenLayer = "device" | "em" | "unit" | "ob1";

/** A generated SCL source unit, shaped for the TIA export plumbing. */
export interface CodegenArtifact {
  name: string;
  type: CodegenArtifactType;
  filename: string;
  content: string;
  dependencies: string[];
  folder: string;
  layer: CodegenLayer;
  ownerId?: string;
  ownerName?: string;
}
```

- [ ] **Step 2: Update the failing tests (red)**

In `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`, extend the existing `describe("instantiateControlModule")` block. Add these assertions inside the existing `"emits an instance DB + call when matched"` test (after the existing expects):

```ts
    const db = r.artifacts.find((a) => a.type === "DB");
    expect(db?.layer).toBe("device");
    expect(db?.ownerId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(db?.ownerName).toBe("M01");
```

And inside the existing `"emits a stub FB with typed interface when unmatched"` test:

```ts
    expect(fb?.layer).toBe("device");
    expect(fb?.ownerName).toBe("M01");
    expect(db?.layer).toBe("device");
```

In `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`, add a new test at the end of the top-level `describe`:

```ts
  it("tags artifacts by layer and filters device-layer artifacts", async () => {
    const { filterByLayer } = await import("../layer-filter");
    const result = compileContract(fixture(), []);
    // Every artifact carries a layer.
    expect(result.artifacts.every((a) => typeof a.layer === "string")).toBe(true);
    // Unit S/A artifacts are tagged "unit"; OB1 is "ob1".
    expect(result.artifacts.find((a) => a.type === "OB")?.layer).toBe("ob1");
    expect(result.artifacts.find((a) => a.type === "UDT")?.layer).toBe("unit");
    // Device filter returns only device-layer artifacts (CM FBs + instance DBs).
    const device = filterByLayer(result.artifacts, "device");
    expect(device.length).toBeGreaterThan(0);
    expect(device.every((a) => a.layer === "device")).toBe(true);
  });
```

Run: `npx vitest run src/lib/spec-builder/codegen` → Expected: FAIL (provenance not set yet; `layer-filter` missing).

- [ ] **Step 3: Tag device/EM artifacts in `fb-instantiate.ts`**

Replace the `instantiate` function (lines 99–118) with a version that threads layer + owner and tags each artifact:

```ts
/** Shared instantiation for CM and EM. */
function instantiate(
  prefix: string, id: string, name: string, deviceClass: string, isEm: boolean,
  io: IoSignalV2[], templates: FbTemplate[], layer: CodegenLayer,
): InstantiateResult {
  const tag = (a: CodegenArtifact): CodegenArtifact => ({ ...a, layer, ownerId: id, ownerName: name });
  const t = pickTemplate(name, deviceClass, isEm, templates);
  if (!t) {
    const fb = stubFb(prefix, name, io);
    const instanceName = `${fb.name}_DB`;
    return {
      artifacts: [fb, instanceDb(instanceName, fb.name)].map(tag),
      callLines: wiringLines(instanceName, io),
      stub: { id, name, reason: `no ${isEm ? "EM" : "CM"} template matched "${deviceClass}"` },
    };
  }
  const block = templateBlockName(t);
  const instance = `${block}_${sclIdent(name)}_DB`;
  const db = instanceDb(instance, block);
  return { artifacts: [db].map(tag), callLines: wiringLines(instance, io), stub: null };
}
```

Update the two public callers (lines 121–130) to pass the layer:

```ts
/** Instantiate one Control Module (basic-control FB). */
export function instantiateControlModule(cm: ControlModuleV2, templates: FbTemplate[]): InstantiateResult {
  return instantiate("CM", cm.control_module_id, cm.control_module_name, cm.control_module_class, false, cm.io_signals, templates, "device");
}

/** Instantiate one Equipment Module (procedural-control FB). EM-level IO is the
 *  union of its control modules' signals. */
export function instantiateEquipmentModule(em: EquipmentModuleV2, templates: FbTemplate[]): InstantiateResult {
  const io = em.control_modules.flatMap((c) => c.io_signals);
  return instantiate("EM", em.equipment_module_id, em.equipment_module_name, em.equipment_module_name, true, io, templates, "em");
}
```

Add `CodegenLayer` to the existing type import at line 4:

```ts
import type { CodegenArtifact, CodegenLayer } from "./types";
```

- [ ] **Step 4: Tag unit + OB1 artifacts in the writers**

Each writer receives the `SaSequence` `seq` (which has `unitId`/`unitName`) and ends with a single `return { ... }`. Each already imports `CodegenArtifact` from `./types`, so the `"unit"`/`"ob1"` literals are inferred against the return type — no extra import needed.

In `src/lib/spec-builder/codegen/udt-writer.ts`, replace the final return (line 24) with:

```ts
  return { name, type: "UDT", filename: `${name}.udt`, content, dependencies: [], folder: FOLDER, layer: "unit", ownerId: seq.unitId, ownerName: seq.unitName };
```

In `src/lib/spec-builder/codegen/db-writer.ts`, replace the final return (line 21) with:

```ts
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [udt], folder: FOLDER, layer: "unit", ownerId: seq.unitId, ownerName: seq.unitName };
```

In `src/lib/spec-builder/codegen/fc-writer.ts`, replace the final return (line 55) with:

```ts
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies: [udt], folder: FOLDER, layer: "unit", ownerId: seq.unitId, ownerName: seq.unitName };
```

In `src/lib/spec-builder/codegen/ob1-writer.ts`, replace the final return (line 29) with:

```ts
  return { name: "Main", type: "OB", filename: "Main.ob", content, dependencies: deps, folder: FOLDER, layer: "ob1" };
```

- [ ] **Step 5: Add the filter helper**

Create `src/lib/spec-builder/codegen/layer-filter.ts`:

```ts
import type { CodegenArtifact, CodegenLayer } from "./types";

/** Return only the artifacts produced by a given Phase-4 layer. Pure. */
export function filterByLayer(artifacts: CodegenArtifact[], layer: CodegenLayer): CodegenArtifact[] {
  return artifacts.filter((a) => a.layer === layer);
}
```

Add to `src/lib/spec-builder/codegen/index.ts`:

```ts
export { filterByLayer } from "./layer-filter";
```

And add `CodegenLayer` to the existing `export type { ... }` block:

```ts
export type {
  CodegenArtifact, CodegenArtifactType, CodegenLayer, CodegenResult, StubReport,
  SaSequence, SaStep,
} from "./types";
```

- [ ] **Step 6: Run tests + typecheck (green)**

Run: `npx vitest run src/lib/spec-builder/codegen` → Expected: PASS.
Run: `npx tsc -b` → Expected: no errors. (Fixes any writer that needs an explicit `CodegenArtifact` return annotation.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/spec-builder/codegen
git commit -m "feat(codegen): per-artifact layer/owner provenance + device-layer filter"
```

---

### Task 2: `code_builder_artifacts` persistence table

**Goal:** A Supabase table storing generated content, reviewer edits, and approvals keyed by `(spec_id, revision, artifact_name)`, with RLS scoped to the owning spec project.

**Files:**
- Create: `supabase/migrations/20260623000000_code_builder_artifacts.sql`

**Acceptance Criteria:**
- [ ] Table created with all columns from the design spec.
- [ ] `UNIQUE (spec_id, revision, artifact_name)`.
- [ ] RLS `FOR ALL` scoped via `spec_projects.created_by = auth.uid()`.
- [ ] `moddatetime` trigger on `updated_at`; index on `(spec_id, revision)`.

**Verify:** `npx supabase db reset` (local) applies cleanly, OR manual SQL review confirms it matches the `061` pattern. (No remote `db push` in this task.)

**Steps:**

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260623000000_code_builder_artifacts.sql`:

```sql
-- Code Builder (Phase 4) — persisted generated artifacts + reviewer edits/approvals.

CREATE TABLE code_builder_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,
  revision INT NOT NULL,

  artifact_name TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('device', 'em', 'unit', 'ob1')),
  owner_id TEXT,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  folder TEXT NOT NULL,
  dependencies JSONB NOT NULL DEFAULT '[]',

  generated_content TEXT NOT NULL,
  edited_content TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (spec_id, revision, artifact_name)
);

ALTER TABLE code_builder_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own code_builder_artifacts"
  ON code_builder_artifacts FOR ALL
  USING (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE INDEX idx_code_builder_artifacts_spec_rev
  ON code_builder_artifacts(spec_id, revision);

CREATE TRIGGER set_code_builder_artifacts_updated_at
  BEFORE UPDATE ON code_builder_artifacts
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260623000000_code_builder_artifacts.sql
git commit -m "feat(db): code_builder_artifacts table (Phase 4 persistence)"
```

---

### Task 3: Reconcile core + `use-code-builder` hook

**Goal:** A pure `reconcileArtifacts()` that merges freshly compiled Device artifacts with stored rows — preserving edits/approvals and flagging drift — plus a TanStack Query hook that compiles-on-open, upserts, and exposes `approve`/`saveEdit`.

**Files:**
- Create: `src/types/code-builder.ts`
- Create: `src/lib/spec-builder/code-builder-reconcile.ts`
- Create: `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`
- Create: `src/hooks/use-code-builder.ts`

**Acceptance Criteria:**
- [ ] New compiled artifact with no stored row → `status: "pending"`, `edited_content: null`, `drift: false`.
- [ ] Stored approved/edited row whose `generated_content` differs from fresh compile → keeps `status`/`edited_content`, refreshes `generated_content`, `drift: true`.
- [ ] Stored approved row whose content is unchanged → `drift: false`.
- [ ] Hook loads `(spec_id, revision)` rows, compiles device layer, upserts, and exposes `approve(name)` / `saveEdit(name, content)` with query invalidation.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` → all pass; `npx tsc -b` → no errors.

**Steps:**

- [ ] **Step 1: Define row + view types**

Create `src/types/code-builder.ts`:

```ts
import type { CodegenLayer } from "@/lib/spec-builder/codegen";

/** A persisted row in code_builder_artifacts. */
export interface CodeBuilderArtifactRow {
  id: string;
  spec_id: string;
  revision: number;
  artifact_name: string;
  layer: CodegenLayer;
  owner_id: string | null;
  type: string;
  filename: string;
  folder: string;
  dependencies: string[];
  generated_content: string;
  edited_content: string | null;
  status: "pending" | "approved";
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
}

/** The reconciled, in-memory view the UI renders (drift is computed, not stored). */
export interface CodeBuilderArtifactView {
  artifact_name: string;
  layer: CodegenLayer;
  owner_id: string | null;
  owner_name: string | null;
  type: string;
  filename: string;
  folder: string;
  dependencies: string[];
  generated_content: string;
  edited_content: string | null;
  status: "pending" | "approved";
  /** True when this artifact was edited/approved AND the FDS recompile differs. */
  drift: boolean;
}

/** The upsert payload written back to Supabase (no id; conflict on the unique key). */
export interface CodeBuilderArtifactUpsert {
  spec_id: string;
  revision: number;
  artifact_name: string;
  layer: CodegenLayer;
  owner_id: string | null;
  type: string;
  filename: string;
  folder: string;
  dependencies: string[];
  generated_content: string;
}
```

- [ ] **Step 2: Write the reconcile test (red)**

Create `src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reconcileArtifacts } from "../code-builder-reconcile";
import type { CodegenArtifact } from "@/lib/spec-builder/codegen";
import type { CodeBuilderArtifactRow } from "@/types/code-builder";

const artifact = (over: Partial<CodegenArtifact>): CodegenArtifact => ({
  name: "CM_Motor_M01_DB", type: "DB", filename: "CM_Motor_M01_DB.db",
  content: "DATA_BLOCK v1", dependencies: ["CM_Motor"], folder: "Program blocks",
  layer: "device", ownerId: "cm-1", ownerName: "M01", ...over,
});

const row = (over: Partial<CodeBuilderArtifactRow>): CodeBuilderArtifactRow => ({
  id: "r1", spec_id: "s1", revision: 2, artifact_name: "CM_Motor_M01_DB",
  layer: "device", owner_id: "cm-1", type: "DB", filename: "CM_Motor_M01_DB.db",
  folder: "Program blocks", dependencies: ["CM_Motor"],
  generated_content: "DATA_BLOCK v1", edited_content: null, status: "pending",
  approved_by: null, approved_at: null, updated_at: "", ...over,
});

describe("reconcileArtifacts", () => {
  it("creates a pending view for a brand-new artifact", () => {
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({})], existing: [] });
    expect(v.status).toBe("pending");
    expect(v.edited_content).toBeNull();
    expect(v.drift).toBe(false);
    expect(v.owner_name).toBe("M01");
  });

  it("preserves an approval and flags drift when the recompile differs", () => {
    const existing = [row({ status: "approved", generated_content: "DATA_BLOCK v0" })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({ content: "DATA_BLOCK v1" })], existing });
    expect(v.status).toBe("approved");           // approval preserved
    expect(v.generated_content).toBe("DATA_BLOCK v1"); // refreshed to latest
    expect(v.drift).toBe(true);                  // FDS changed since review
  });

  it("preserves an edit and flags drift when the recompile differs", () => {
    const existing = [row({ edited_content: "DATA_BLOCK edited", generated_content: "DATA_BLOCK v0" })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({ content: "DATA_BLOCK v1" })], existing });
    expect(v.edited_content).toBe("DATA_BLOCK edited");
    expect(v.drift).toBe(true);
  });

  it("does not flag drift when an approved artifact is unchanged", () => {
    const existing = [row({ status: "approved", generated_content: "DATA_BLOCK v1" })];
    const [v] = reconcileArtifacts({ specId: "s1", revision: 2, compiled: [artifact({ content: "DATA_BLOCK v1" })], existing });
    expect(v.drift).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` → Expected: FAIL (`reconcile` not implemented).

- [ ] **Step 3: Implement `reconcileArtifacts` (green)**

Create `src/lib/spec-builder/code-builder-reconcile.ts`:

```ts
import type { CodegenArtifact } from "@/lib/spec-builder/codegen";
import type {
  CodeBuilderArtifactRow, CodeBuilderArtifactView, CodeBuilderArtifactUpsert,
} from "@/types/code-builder";

export interface ReconcileInput {
  specId: string;
  revision: number;
  /** Freshly compiled artifacts to surface (Device layer for this slice). */
  compiled: CodegenArtifact[];
  /** Stored rows for the same (spec_id, revision). */
  existing: CodeBuilderArtifactRow[];
}

/**
 * Merge freshly compiled artifacts with stored rows. Reviewer edits/approvals
 * survive a recompile; `generated_content` is always refreshed to the latest
 * deterministic output. `drift` is set when an artifact already carried an
 * edit or approval AND the recompiled content differs — never silently lost.
 * Pure: no IO.
 */
export function reconcileArtifacts(input: ReconcileInput): CodeBuilderArtifactView[] {
  const byName = new Map(input.existing.map((r) => [r.artifact_name, r]));
  return input.compiled.map((a) => {
    const prior = byName.get(a.name);
    const reviewed = !!prior && (prior.status === "approved" || prior.edited_content !== null);
    const drift = !!prior && reviewed && prior.generated_content !== a.content;
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
    };
  });
}

/** Build the upsert payloads that refresh stored `generated_content` for the
 *  current revision. Edits/approvals are NOT touched here. */
export function toUpserts(input: ReconcileInput): CodeBuilderArtifactUpsert[] {
  return input.compiled.map((a) => ({
    spec_id: input.specId,
    revision: input.revision,
    artifact_name: a.name,
    layer: a.layer,
    owner_id: a.ownerId ?? null,
    type: a.type,
    filename: a.filename,
    folder: a.folder,
    dependencies: a.dependencies,
    generated_content: a.content,
  }));
}
```

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts` → Expected: PASS.

- [ ] **Step 4: Implement the hook**

Create `src/hooks/use-code-builder.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract, filterByLayer } from "@/lib/spec-builder/codegen";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useSpecProject } from "@/hooks/use-spec-projects";
import {
  reconcileArtifacts, toUpserts,
} from "@/lib/spec-builder/code-builder-reconcile";
import type {
  CodeBuilderArtifactRow, CodeBuilderArtifactView,
} from "@/types/code-builder";
import type { FbTemplate } from "@/types/fb-template";

const TABLE = "code_builder_artifacts";

export const codeBuilderKey = (specId?: string, revision?: number) =>
  ["code_builder", specId ?? "", revision ?? -1] as const;

async function loadRows(specId: string, revision: number): Promise<CodeBuilderArtifactRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("spec_id", specId)
    .eq("revision", revision);
  if (error) throw error;
  return (data ?? []) as CodeBuilderArtifactRow[];
}

/**
 * Compile the confirmed FDS, upsert fresh device-layer content for the current
 * revision, and return the reconciled view (edits/approvals preserved, drift
 * flagged). Re-runs whenever the spec revision or templates change.
 */
async function compileAndReconcile(
  specId: string, revision: number, templates: FbTemplate[],
): Promise<CodeBuilderArtifactView[]> {
  const existing = await loadRows(specId, revision);
  const contract = await loadSpecContract(specId);
  const result = compileContract(contract, templates);
  const device = filterByLayer(result.artifacts, "device");

  const upserts = toUpserts({ specId, revision, compiled: device, existing });
  if (upserts.length) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(upserts, { onConflict: "spec_id,revision,artifact_name" });
    if (error) throw error;
  }
  return reconcileArtifacts({ specId, revision, compiled: device, existing });
}

export function useCodeBuilder(specId: string | undefined) {
  const qc = useQueryClient();
  const { data: templates = [] } = useFbTemplates();
  const { data: spec } = useSpecProject(specId);
  const revision = spec?.revision;
  const ready = !!specId && typeof revision === "number" && spec?.confirmation_status === "confirmed";

  const artifacts = useQuery({
    queryKey: codeBuilderKey(specId, revision),
    enabled: ready && templates.length >= 0,
    queryFn: () => compileAndReconcile(specId as string, revision as number, templates),
  });

  const approve = useMutation({
    mutationFn: async (artifactName: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from(TABLE)
        .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  const saveEdit = useMutation({
    mutationFn: async (vars: { artifactName: string; content: string }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ edited_content: vars.content })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", vars.artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  return { artifacts, approve, saveEdit, ready, revision };
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/code-builder.ts src/lib/spec-builder/code-builder-reconcile.ts src/lib/spec-builder/__tests__/code-builder-reconcile.test.ts src/hooks/use-code-builder.ts
git commit -m "feat(code-builder): reconcile core + use-code-builder hook (compile/upsert/approve/edit)"
```

---

### Task 4: Device workspace UI components

**Goal:** The three workspace panes + the stepper: a control-module list with status pills, an artifact viewer (Code/Flow/UDT/Inst DB tabs reusing `parseFbFlow` + `FbFlowRenderer` + Monaco), and an approve/edit panel.

**Files:**
- Create: `src/components/code-builder/builder-stepper.tsx`
- Create: `src/components/code-builder/control-module-list.tsx`
- Create: `src/components/code-builder/artifact-viewer.tsx`
- Create: `src/components/code-builder/artifact-panel.tsx`

**Acceptance Criteria:**
- [ ] Stepper shows Device (active) › EM › Unit › Export with the last three visibly disabled.
- [ ] Control-module list renders FB artifacts with `matched`/`stub`/`pending`/`approved` pills + a `drift` badge.
- [ ] Viewer Code tab is read-only unless `editable`; Flow tab renders `FbFlowRenderer` for FB/FC SCL; UDT / Inst DB tabs render the related artifact content.
- [ ] Panel shows name/type/folder/deps + Approve and Edit/Save buttons wired to callbacks.
- [ ] `npx tsc -b` passes.

**Verify:** `npx tsc -b` → no errors. (Behaviour verified via the page smoke test in Task 5.)

**Steps:**

- [ ] **Step 1: Stepper**

Create `src/components/code-builder/builder-stepper.tsx`:

```tsx
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type BuilderStep = "device" | "em" | "unit" | "export";

const STEPS: { id: BuilderStep; label: string; enabled: boolean }[] = [
  { id: "device", label: "Device", enabled: true },
  { id: "em", label: "EM", enabled: false },
  { id: "unit", label: "Unit", enabled: false },
  { id: "export", label: "Export", enabled: false },
];

export function BuilderStepper({ active }: { active: BuilderStep }) {
  return (
    <div className="flex items-center gap-2" data-testid="builder-stepper">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          {i > 0 && <span className="text-muted-foreground">›</span>}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium",
              s.id === active && "bg-primary text-primary-foreground",
              s.id !== active && s.enabled && "bg-muted text-foreground",
              !s.enabled && "bg-muted/50 text-muted-foreground/60 cursor-not-allowed",
            )}
            title={s.enabled ? undefined : "Coming next"}
            aria-disabled={!s.enabled}
          >
            {s.id === "device" && <Check className="h-3 w-3" />}
            {i + 1} {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Control-module list**

Create `src/components/code-builder/control-module-list.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

type Pill = "matched" | "stub" | "pending" | "approved";

function pillFor(a: CodeBuilderArtifactView): Pill {
  if (a.status === "approved") return "approved";
  // A stub FB names itself CM_<name>; a matched template instance DB names itself <Block>_<name>_DB.
  if (a.type === "FB") return "stub";
  return "pending";
}

const PILL_STYLE: Record<Pill, string> = {
  matched: "bg-emerald-100 text-emerald-700",
  approved: "bg-emerald-100 text-emerald-700",
  stub: "bg-orange-100 text-orange-700",
  pending: "bg-muted text-muted-foreground",
};

export function ControlModuleList({
  artifacts, selected, onSelect,
}: {
  artifacts: CodeBuilderArtifactView[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  // Show one row per FB-or-DB device artifact, grouped by owner name.
  const rows = artifacts.filter((a) => a.layer === "device");
  return (
    <div className="flex flex-col divide-y" data-testid="cm-list">
      {rows.map((a) => {
        const pill = pillFor(a);
        return (
          <button
            key={a.artifact_name}
            type="button"
            onClick={() => onSelect(a.artifact_name)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-accent",
              selected === a.artifact_name && "bg-accent border-l-2 border-primary",
            )}
          >
            <span className="font-mono truncate">{a.owner_name ?? a.artifact_name}</span>
            <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[9px]", PILL_STYLE[pill])}>{pill}</span>
            {a.drift && <Badge variant="destructive" className="text-[9px] px-1">drift</Badge>}
          </button>
        );
      })}
      {rows.length === 0 && (
        <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No device artifacts.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Artifact viewer**

Create `src/components/code-builder/artifact-viewer.tsx`:

```tsx
import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { parseFbFlow } from "@/lib/fb-flow-diagram";
import { FbFlowRenderer } from "@/components/forge/fb-flow-renderer";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

type Tab = "code" | "flow" | "udt" | "instdb";

export function ArtifactViewer({
  artifact, related, editable, onContentChange,
}: {
  artifact: CodeBuilderArtifactView | null;
  /** Other device artifacts owned by the same module (for UDT / Inst DB tabs). */
  related: CodeBuilderArtifactView[];
  editable: boolean;
  onContentChange: (content: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("code");
  const content = artifact ? (artifact.edited_content ?? artifact.generated_content) : "";

  const canFlow = !!artifact && (artifact.type === "FB" || artifact.type === "FC");
  const diagrams = useMemo(() => (canFlow ? parseFbFlow(content) : []), [canFlow, content]);
  const instDb = related.find((r) => r.type === "DB");
  const udt = related.find((r) => r.type === "UDT");

  if (!artifact) {
    return <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Select an artifact.</div>;
  }

  const TABS: { id: Tab; label: string; show: boolean }[] = [
    { id: "code", label: "Code", show: true },
    { id: "flow", label: "Flow", show: canFlow },
    { id: "udt", label: "UDT", show: !!udt },
    { id: "instdb", label: "Inst DB", show: !!instDb },
  ];

  return (
    <div className="flex h-full flex-col" data-testid="artifact-viewer">
      <div className="flex gap-1 border-b px-2 py-1.5">
        {TABS.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn("rounded px-2 py-0.5 text-[10px]", tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "code" && (
          <Editor
            height="100%"
            language="scl"
            theme="vs-dark"
            value={content}
            options={{ readOnly: !editable, minimap: { enabled: false }, fontSize: 12 }}
            onChange={(v) => onContentChange(v ?? "")}
          />
        )}
        {tab === "flow" && <div className="h-full overflow-auto"><FbFlowRenderer diagrams={diagrams} /></div>}
        {tab === "udt" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{udt?.generated_content}</pre>}
        {tab === "instdb" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{instDb?.generated_content}</pre>}
      </div>
    </div>
  );
}
```

> Monaco SCL language `"scl"` is already registered app-wide via `src/lib/monaco-scl.ts` (used by other editors). No re-registration needed here.

- [ ] **Step 4: Artifact panel**

Create `src/components/code-builder/artifact-panel.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";

export function ArtifactPanel({
  artifact, editing, onEdit, onSave, onApprove, saving, approving,
}: {
  artifact: CodeBuilderArtifactView | null;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onApprove: () => void;
  saving: boolean;
  approving: boolean;
}) {
  if (!artifact) {
    return <div className="p-3 text-[11px] text-muted-foreground">No selection.</div>;
  }
  return (
    <div className="flex flex-col gap-2 p-3 text-[11px]" data-testid="artifact-panel">
      <div className="font-mono font-semibold">{artifact.artifact_name}</div>
      <div className="text-muted-foreground">{artifact.type} · SCL</div>
      {artifact.drift && <Badge variant="destructive" className="w-fit text-[9px]">FDS changed since review</Badge>}
      <div>Folder: <span className="font-mono">{artifact.folder}</span></div>
      <div>Deps: <span className="font-mono">{artifact.dependencies.join(", ") || "—"}</span></div>
      <div className="mt-2 flex gap-2">
        {editing ? (
          <Button size="sm" className="h-7 text-[11px]" disabled={saving} onClick={onSave}>Save</Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onEdit}>Edit</Button>
        )}
        <Button
          size="sm"
          className="h-7 text-[11px]"
          disabled={approving || artifact.status === "approved"}
          onClick={onApprove}
        >
          {artifact.status === "approved" ? "Approved" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b` → Expected: no errors.

```bash
git add src/components/code-builder
git commit -m "feat(code-builder): device workspace UI (stepper, list, viewer, panel)"
```

---

### Task 5: Code Builder route + registration + gate

**Goal:** A full-screen `/specs/:projectId/:specId/code-builder` page that gates on `confirmation_status === "confirmed"`, wires the 3-pane Device workspace to `useCodeBuilder`, and is registered in `App.tsx`. A component smoke test covers confirmed vs locked.

**Files:**
- Create: `src/routes/code-builder.tsx`
- Create: `src/routes/__tests__/code-builder.test.tsx`
- Modify: `src/App.tsx`

**Acceptance Criteria:**
- [ ] Route renders the stepper + 3 panes for a confirmed spec.
- [ ] Renders a locked empty-state (link back to Co-Author) for an unconfirmed spec.
- [ ] Selecting a CM row shows its artifact; Edit makes Code writable; Save calls `saveEdit`; Approve calls `approve`.
- [ ] `App.tsx` lazy-registers the route under AuthGuard → DashboardLayout.

**Verify:** `npx vitest run src/routes/__tests__/code-builder.test.tsx` → pass; `npx tsc -b` → no errors.

**Steps:**

- [ ] **Step 1: Page component**

Create `src/routes/code-builder.tsx`:

```tsx
/**
 * Phase 4 — Code Builder full-screen route.
 * URL: /specs/:projectId/:specId/code-builder
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSpecProject } from "@/hooks/use-spec-projects";
import { useCodeBuilder } from "@/hooks/use-code-builder";
import { BuilderStepper } from "@/components/code-builder/builder-stepper";
import { ControlModuleList } from "@/components/code-builder/control-module-list";
import { ArtifactViewer } from "@/components/code-builder/artifact-viewer";
import { ArtifactPanel } from "@/components/code-builder/artifact-panel";

export default function CodeBuilderPage() {
  const { projectId, specId } = useParams<{ projectId: string; specId: string }>();
  const { data: spec } = useSpecProject(specId);
  const { artifacts, approve, saveEdit } = useCodeBuilder(specId);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");

  const views = artifacts.data ?? [];
  const current = useMemo(() => views.find((v) => v.artifact_name === selected) ?? null, [views, selected]);
  const related = useMemo(
    () => (current ? views.filter((v) => v.owner_id && v.owner_id === current.owner_id) : []),
    [views, current],
  );

  if (spec && spec.confirmation_status !== "confirmed") {
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="code-builder-locked">
        <Card className="max-w-md space-y-3 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4" /> Spec not confirmed</div>
          <p className="text-xs text-muted-foreground">Confirm the FDS in the Co-Author before building code.</p>
          <Link to={`/specs/${projectId}/${specId}/co-author`} className="text-xs underline">Back to Co-Author</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="-m-4 flex h-full flex-col" data-testid="code-builder-page">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Back to Co-Author">
          <Link to={`/specs/${projectId}/${specId}/co-author`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="font-mono text-sm font-semibold">{spec?.doc_code}</h1>
        <div className="ml-4"><BuilderStepper active="device" /></div>
        <Badge variant="outline" className="ml-auto text-[10px]">Phase 4 — Code Builder</Badge>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[28%_44%_28%]">
        <div className="min-h-0 overflow-auto border-r">
          <ControlModuleList artifacts={views} selected={selected} onSelect={(n) => { setSelected(n); setEditing(false); }} />
        </div>
        <div className="min-h-0 border-r">
          <ArtifactViewer
            artifact={current}
            related={related}
            editable={editing}
            onContentChange={setDraft}
          />
        </div>
        <div className="min-h-0 overflow-auto">
          <ArtifactPanel
            artifact={current}
            editing={editing}
            saving={saveEdit.isPending}
            approving={approve.isPending}
            onEdit={() => { setDraft(current?.edited_content ?? current?.generated_content ?? ""); setEditing(true); }}
            onSave={() => { if (current) { saveEdit.mutate({ artifactName: current.artifact_name, content: draft }); setEditing(false); } }}
            onApprove={() => { if (current) approve.mutate(current.artifact_name); }}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `App.tsx`**

Add a lazy import alongside the other spec route imports:

```tsx
const CodeBuilderPage = lazy(() => import("@/routes/code-builder"));
```

Add a child route next to the existing `specs/:projectId/:specId/co-author` entry (around line 101):

```tsx
{
  path: "specs/:projectId/:specId/code-builder",
  element: <LazyRoute><CodeBuilderPage /></LazyRoute>,
},
```

- [ ] **Step 3: Smoke test**

Create `src/routes/__tests__/code-builder.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CodeBuilderPage from "../code-builder";

const mockSpec = vi.fn();
const mockCb = vi.fn();

vi.mock("@/hooks/use-spec-projects", () => ({ useSpecProject: () => mockSpec() }));
vi.mock("@/hooks/use-code-builder", () => ({ useCodeBuilder: () => mockCb() }));
vi.mock("react-router", async (orig) => {
  const actual = await orig<typeof import("react-router")>();
  return { ...actual, useParams: () => ({ projectId: "p1", specId: "s1" }) };
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("CodeBuilderPage", () => {
  beforeEach(() => {
    mockCb.mockReturnValue({
      artifacts: { data: [] },
      approve: { mutate: vi.fn(), isPending: false },
      saveEdit: { mutate: vi.fn(), isPending: false },
    });
  });

  it("renders the locked state for an unconfirmed spec", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "draft", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    expect(screen.getByTestId("code-builder-locked")).toBeInTheDocument();
  });

  it("renders the stepper + panes for a confirmed spec", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    expect(screen.getByTestId("code-builder-page")).toBeInTheDocument();
    expect(screen.getByTestId("builder-stepper")).toBeInTheDocument();
  });
});
```

> If `@testing-library/react` / `jsdom` are not yet configured for this project, verify the Task instead with `npx tsc -b` (the page must typecheck) and a manual `npm run dev` check of both states. Confirm the test runner's environment before relying on the DOM assertions.

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run src/routes/__tests__/code-builder.test.tsx` → Expected: PASS (or skip per the note above).
Run: `npx tsc -b` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/code-builder.tsx src/routes/__tests__/code-builder.test.tsx src/App.tsx
git commit -m "feat(code-builder): Phase 4 route + confirmed-gate + App registration"
```

---

### Task 6: Replace "Generate SCL" one-shot with "Open Code Builder"

**Goal:** The Co-Author header links to the new Code Builder (enabled only when confirmed) and the swallow-errors one-shot `handleGenerate` path is removed.

**Files:**
- Modify: `src/routes/spec-co-author.tsx`

**Acceptance Criteria:**
- [ ] The "Generate SCL" button is replaced by an "Open Code Builder" link to `/specs/:projectId/:specId/code-builder`.
- [ ] The link is disabled (or rendered as a disabled button) unless `confirmation_status === "confirmed"`.
- [ ] `handleGenerate`, `useSpecCodegen`, `buildManifest`, `downloadExportBundle`, and the now-unused `supabase` import are removed from this file.
- [ ] `npx tsc -b` passes (no unused-import/var errors under strict mode).

**Verify:** `npx tsc -b` → no errors; `npm run dev` → header shows "Open Code Builder", navigates to the new route.

**Steps:**

- [ ] **Step 1: Remove the one-shot wiring**

In `src/routes/spec-co-author.tsx`:
- Delete the imports on lines 21–24 (`useSpecCodegen`, `buildManifest`, `downloadExportBundle`, `supabase`).
- Delete the `const { generate, running: codegenRunning } = useSpecCodegen();` line (34).
- Delete the entire `handleGenerate` function (lines 60–80).
- Remove `Code2` from the `lucide-react` import and add `Hammer` (used for the new button).

- [ ] **Step 2: Replace the button with a link**

Replace the `<Button …>Generate SCL</Button>` block (lines 150–164) with:

```tsx
<Button
  asChild={spec.confirmation_status === "confirmed"}
  size="sm"
  variant="outline"
  className="h-7 gap-1.5 px-2.5 text-[11px]"
  disabled={spec.confirmation_status !== "confirmed"}
  title={spec.confirmation_status !== "confirmed" ? "Confirm the spec before building code" : "Open the Code Builder"}
>
  {spec.confirmation_status === "confirmed" ? (
    <Link to={`/specs/${projectId}/${specId}/code-builder`}>
      <Hammer className="h-3.5 w-3.5" /> Open Code Builder
    </Link>
  ) : (
    <span><Hammer className="h-3.5 w-3.5" /> Open Code Builder</span>
  )}
</Button>
```

> `Link` is already imported from `react-router` at the top of the file.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b` → Expected: no errors (confirms no unused imports remain).

- [ ] **Step 4: Commit**

```bash
git add src/routes/spec-co-author.tsx
git commit -m "feat(spec-builder): replace Generate SCL one-shot with Open Code Builder link"
```

---

## Final verification

After all tasks:

- [ ] `npx vitest run src/lib/spec-builder` → all pass (engine provenance + reconcile).
- [ ] `npx vitest run src/routes/__tests__/code-builder.test.tsx` → pass (or documented skip).
- [ ] `npx tsc -b` → no errors.
- [ ] `npm run dev` → confirmed spec: Co-Author "Open Code Builder" → 3-pane Device workspace; unconfirmed spec: locked state.
- [ ] Generic check (CLAUDE.md): no project-specific names anywhere in the new engine/hook/UI.

## Out of scope (later sub-projects)

- EM state-machine FBs (C), Unit/coordination sequencers + fault DB (D).
- Hardware/IO infrastructure: rack/slot/card layout, tag tables, global IO image DBs (E).
- Export/compile: manifest, TIA zip, bridge import, approval-gated export enforcement (F).
- HMI structure, type-conversion FCs, config-parameter→logic linkage.
