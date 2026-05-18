# Pac-Quote v2 — Variations + Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the variation lifecycle (`projects.stage ∈ {awarded, in_progress}` → `New Variation` → builder with per-row citations → issue → snapshot + PDF) as a parallel document type to quote revisions, reusing the v1 builder shell + section editors + PDF service.

**Architecture:** Variations hang off `projects`, not `quotes`. They reuse the existing polymorphic content tables (`parent_type='variation'` is already accepted). One new table — `variation_citations` — links a variation's content row to an item in a source snapshot (a quote revision or a prior variation). A new RPC `issue_variation` mirrors `issue_quote_revision` but is simpler (no supersede). The same `BuilderLayout`, section editors, `PreviewPane`, `buildSnapshot`, and edge function are reused via component-level imports; routes are separate (`/variations/:variationId/edit` and `/view`). PDF renderer gains an "Amends" callout block above any row with a citation.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind v3, shadcn/ui, TanStack Query, Zustand, Supabase (Postgres + Edge Functions + Storage), Vitest + React Testing Library, Node + Puppeteer (existing render service).

**Spec:** `Docs/superpowers/specs/2026-05-18-pac-quote-variations-v2-design.md`

**Out of scope (re-confirmed):** Dropbox publish, auto-suggested pricing delta, DOCX export, Style Review, AI legacy ingestion, clause-level citations, variation supersede.

---

## File Structure

### New source files

```
src/
  routes/
    variation-builder.tsx           # /variations/:variationId/edit
    variation-view.tsx              # /variations/:variationId/view
    variations.tsx                  # /variations (global list)
  components/
    quotes/
      variation-card.tsx
      builder/
        cite-original-button.tsx
        amends-banner.tsx
        citation-picker-dialog.tsx
        __tests__/citation-picker-dialog.test.tsx
  hooks/
    use-variations.ts
    use-variation-citations.ts
    use-issue-variation.ts
    __tests__/use-variations.test.tsx
    __tests__/use-variation-citations.test.tsx
    __tests__/use-issue-variation.test.tsx
  lib/
    __tests__/variation-flow.integration.test.tsx
  types/
    variation.ts                    # Variation + VariationCreate + VariationUpdate
    variation-citation.ts           # VariationCitation + VariationCitationCreate
supabase/
  migrations/
    083_pac_quote_variation_citations.sql
    084_pac_quote_variation_issue_rpc.sql
services/pdf-renderer/src/templates/
  partials/_amends.html
```

### Modified files

```
src/types/
  index.ts                          # re-export Variation + VariationCitation
  quote-snapshot.ts                 # add kind? + SnapshotCitation + citations array
src/lib/
  quote-snapshot.ts                 # buildSnapshot accepts kind + citations input
  quote-numbering.ts                # add nextVariationNumber
  __tests__/quote-numbering.test.ts # add cases
  __tests__/quote-snapshot.test.ts  # add variation cases
src/hooks/
  use-doc-content.ts                # delete hooks cascade-delete citations when parent_type='variation'
src/components/quotes/
  project-commercial-tab.tsx        # grow Variations sub-section + New Variation button
  builder/section-scope.tsx
  builder/section-inclusions.tsx
  builder/section-exclusions.tsx
  builder/section-assumptions.tsx
  builder/section-line-items.tsx    # all five render CiteOriginalButton + AmendsBanner
src/routes/
  quote-builder.tsx                 # no change (route is separate)
src/App.tsx                         # register three new routes
src/app/DashboardLayout.tsx         # add Variations sidebar entry
services/pdf-renderer/src/
  render.ts                         # register _amends partial; default snapshot.kind to quote_revision when absent
  templates/pac-quote.html          # render Amends partial above each cited row + variation header subtitle
  templates/pac-quote.css           # add .amends-* styles
  __tests__/render.test.ts          # variation snapshot fixture + Amends block assertions
```

---

## Task 1: Migration 083 — `variation_citations` table

**Goal:** Schema for per-row citations linking a variation content row to an item in a source snapshot.

**Files:**
- Create: `supabase/migrations/083_pac_quote_variation_citations.sql`

**Acceptance Criteria:**
- [ ] `variation_citations` table created with all columns from spec §2 (no `revised_text` column).
- [ ] `target_section` CHECK includes the five doc sections; **excludes `clause`**.
- [ ] `source_kind` CHECK is `quote_revision` or `variation`.
- [ ] `source_item_id` is `uuid NOT NULL`.
- [ ] `UNIQUE (variation_id, target_section, target_doc_id)` enforces 1-citation-per-row.
- [ ] Indexes on `(variation_id)` and `(source_kind, source_id)`.
- [ ] RLS enabled with the standard four-policy authenticated set used in earlier migrations.
- [ ] `moddatetime` is not needed — there's no `updated_at` column (citations are immutable).

**Verify:** `npx supabase db push` succeeds.

**Steps:**

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/083_pac_quote_variation_citations.sql
-- ============================================================
-- Pac-Quote v2: variation_citations
--   Per-row link between a variation's content row and an item
--   in a source snapshot (quote revision or prior variation).
-- ============================================================

CREATE TABLE variation_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id uuid NOT NULL REFERENCES variations(id) ON DELETE CASCADE,

  target_section text NOT NULL
    CHECK (target_section IN ('scope','inclusion','exclusion','assumption','line_item')),
  target_doc_id uuid NOT NULL,

  source_kind text NOT NULL
    CHECK (source_kind IN ('quote_revision','variation')),
  source_id uuid NOT NULL,
  source_section text NOT NULL,
  source_item_id uuid NOT NULL,

  original_text_verbatim text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (variation_id, target_section, target_doc_id)
);

CREATE INDEX variation_citations_variation_idx
  ON variation_citations(variation_id);
CREATE INDEX variation_citations_source_idx
  ON variation_citations(source_kind, source_id);

ALTER TABLE variation_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY variation_citations_select_authenticated ON variation_citations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY variation_citations_insert_authenticated ON variation_citations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY variation_citations_update_authenticated ON variation_citations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY variation_citations_delete_authenticated ON variation_citations
  FOR DELETE TO authenticated USING (true);
```

- [ ] **Step 2: Apply locally**

```bash
npx supabase db push
```

Expected: migration applied without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/083_pac_quote_variation_citations.sql
git commit -m "feat(pac-quote-v2): migration 083 — variation_citations table"
```

---

## Task 2: Types — `Variation`, `VariationCitation`, snapshot extension

**Goal:** TypeScript types for the new entities + non-breaking extension of `QuoteSnapshotV1` to carry `kind` + `citations`.

**Files:**
- Create: `src/types/variation.ts`
- Create: `src/types/variation-citation.ts`
- Modify: `src/types/quote-snapshot.ts`
- Modify: `src/types/index.ts`

**Acceptance Criteria:**
- [ ] `Variation` interface mirrors the `variations` table (id, project_id, variation_number, status, summary, issued_at, issued_by, snapshot_json, pdf_storage_key, dropbox_content_hash, created_at, updated_at, created_by).
- [ ] `VARIATION_STATUSES = ["draft", "issued"] as const` (already exists in v1 types — keep).
- [ ] `VariationCreate` is `Pick<Variation, "project_id"> & { summary?: string | null }` (variation_number auto-assigned server-side).
- [ ] `VariationUpdate` is `Partial<Pick<Variation, "summary">>`.
- [ ] `VariationCitation` interface mirrors `variation_citations` (id, variation_id, target_section, target_doc_id, source_kind, source_id, source_section, source_item_id, original_text_verbatim, created_at).
- [ ] `CitationTargetSection` type union: `'scope' | 'inclusion' | 'exclusion' | 'assumption' | 'line_item'`.
- [ ] `CitationSourceKind` type union: `'quote_revision' | 'variation'`.
- [ ] `VariationCitationCreate` is `Pick<VariationCitation, "variation_id" | "target_section" | "target_doc_id" | "source_kind" | "source_id" | "source_section" | "source_item_id" | "original_text_verbatim">`.
- [ ] `QuoteSnapshotV1` gains **optional** `kind?: "quote_revision" | "variation"` and **optional** `citations?: SnapshotCitation[]`.
- [ ] `SnapshotCitation` interface: `target_section: CitationTargetSection`, `target_doc_id: string`, `original_text_verbatim: string`, `revised_text: string`, `source_label: string` (e.g. `"CVL-2129-Q01 Rev 1, item 3"`).
- [ ] All new types re-exported from `src/types/index.ts`.

**Verify:** `npm run lint && npx tsc -b`.

**Steps:**

- [ ] **Step 1: Write `src/types/variation.ts`**

```ts
// src/types/variation.ts
// Variation is already declared in src/types/quote.ts. We keep it there and
// just add the create/update helpers + value re-export pivot here so callers
// have a single "import from @/types/variation" entry point.

import type {
  Variation as VariationFromQuote,
  VariationCreate as VariationCreateFromQuote,
  VariationUpdate as VariationUpdateFromQuote,
  VariationStatus,
} from "./quote";
export { VARIATION_STATUSES } from "./quote";

export type Variation = VariationFromQuote;
export type VariationCreate = VariationCreateFromQuote;
export type VariationUpdate = VariationUpdateFromQuote;
export type { VariationStatus };
```

> **Note:** v1 already shipped `Variation`, `VariationCreate`, `VariationUpdate`, `VARIATION_STATUSES` in `src/types/quote.ts`. Re-exporting from `variation.ts` keeps callsites pointed at a focused module.

- [ ] **Step 2: Write `src/types/variation-citation.ts`**

```ts
// src/types/variation-citation.ts
export type CitationTargetSection =
  | "scope"
  | "inclusion"
  | "exclusion"
  | "assumption"
  | "line_item";

export const CITATION_TARGET_SECTIONS: CitationTargetSection[] = [
  "scope",
  "inclusion",
  "exclusion",
  "assumption",
  "line_item",
];

export type CitationSourceKind = "quote_revision" | "variation";

export interface VariationCitation {
  id: string;
  variation_id: string;
  target_section: CitationTargetSection;
  target_doc_id: string;
  source_kind: CitationSourceKind;
  source_id: string;
  source_section: CitationTargetSection;
  source_item_id: string;
  original_text_verbatim: string;
  created_at: string;
}

export type VariationCitationCreate = Pick<
  VariationCitation,
  | "variation_id"
  | "target_section"
  | "target_doc_id"
  | "source_kind"
  | "source_id"
  | "source_section"
  | "source_item_id"
  | "original_text_verbatim"
>;
```

- [ ] **Step 3: Extend `src/types/quote-snapshot.ts`**

Add the citation interface and the two optional fields on `QuoteSnapshotV1`:

```ts
// added near the other Snapshot* interfaces:
export type SnapshotKind = "quote_revision" | "variation";

export interface SnapshotCitation {
  target_section:
    | "scope"
    | "inclusion"
    | "exclusion"
    | "assumption"
    | "line_item";
  target_doc_id: string;          // the variation's own doc_*.id at issue time
  original_text_verbatim: string; // frozen at cite-time
  revised_text: string;           // denormalised from the variation's content row at issue time
  source_label: string;           // e.g. "CVL-2129-Q01 Rev 1, item 3" or "V1, item 2"
}

// then in QuoteSnapshotV1:
export interface QuoteSnapshotV1 {
  schema_version: 1;
  kind?: SnapshotKind;              // NEW — optional for v1 back-compat (defaults to "quote_revision")
  // ... existing fields ...
  citations?: SnapshotCitation[];   // NEW — present only when kind === "variation" with citations
}
```

- [ ] **Step 4: Re-export from `src/types/index.ts`**

```ts
// add these lines next to the existing exports:
export * from "./variation";
export * from "./variation-citation";
// Add SnapshotCitation + SnapshotKind to the re-export from quote-snapshot if not already covered by export *.
```

- [ ] **Step 5: Verify**

```bash
npm run lint
npx tsc -b
```

Expected: both succeed without new errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/variation.ts src/types/variation-citation.ts src/types/quote-snapshot.ts src/types/index.ts
git commit -m "feat(pac-quote-v2): variation + citation + snapshot types"
```

---

## Task 3: `useVariations` CRUD hooks + tests

**Goal:** TanStack Query hooks for variations CRUD. Auto-assigns the next `variation_number` per project on create. Optionally clones the awarded rev's T&Cs selection.

**Files:**
- Create: `src/hooks/use-variations.ts`
- Create: `src/hooks/__tests__/use-variations.test.tsx`

**Acceptance Criteria:**
- [ ] `useVariation(id)`, `useVariationsForProject(projectId)` (order by `variation_number`).
- [ ] `useCreateVariation` accepts `{ project_id, clone_tnc_from_rev_id? }`:
  - reads `max(variation_number) where project_id = …` and assigns next.
  - inserts variation in `draft`.
  - inserts an empty `doc_commercial_terms` row with `parent_type='variation'`.
  - if `clone_tnc_from_rev_id` provided, reads the rev's `doc_tnc_selections` row and inserts a copy with `parent_id = newVariation.id`.
- [ ] `useUpdateVariation({ id, updates })` for summary edits.
- [ ] `useDeleteVariation(id)` — only deletes draft variations (throws on issued).
- [ ] Mutations invalidate `["variations", project_id]` and `["variations", "by-id", id]`.
- [ ] Tests cover list/get + the create flow asserting variation_number assignment + T&Cs clone insert.

**Verify:** `npm run test -- --run src/hooks/__tests__/use-variations.test.tsx`

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/__tests__/use-variations.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import {
  useVariation,
  useVariationsForProject,
  useCreateVariation,
} from "@/hooks/use-variations";

const insertMock = vi.fn();
let variationsList: Record<string, unknown>[] = [];

const tables: Record<string, () => unknown> = {
  variations: () => ({
    select: () => ({
      eq: () => ({
        order: () =>
          Promise.resolve({ data: variationsList, error: null }),
        single: () =>
          Promise.resolve({
            data: variationsList[0] ?? null,
            error: variationsList[0] ? null : { message: "not found" },
          }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      insertMock("variations", row);
      const created = { id: "v-new", ...row };
      variationsList.push(created);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: created, error: null }),
        }),
      };
    },
  }),
  doc_commercial_terms: () => ({
    insert: (row: Record<string, unknown>) => {
      insertMock("doc_commercial_terms", row);
      return Promise.resolve({ data: { id: "ct-new", ...row }, error: null });
    },
  }),
  doc_tnc_selections: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "sel-1",
                parent_type: "quote_revision",
                parent_id: "r-1",
                template_id: "tpl-1",
                omitted_clause_ids: [],
                added_custom_clauses: [],
                created_at: "2026-05-18T00:00:00Z",
                updated_at: "2026-05-18T00:00:00Z",
              },
              error: null,
            }),
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      insertMock("doc_tnc_selections", row);
      return Promise.resolve({ data: { id: "sel-new", ...row }, error: null });
    },
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (name: string) => {
      const h = tables[name];
      if (!h) throw new Error(`unhandled table: ${name}`);
      return h();
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-1" } } }) },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  insertMock.mockClear();
  variationsList = [];
});

describe("useVariations", () => {
  it("lists variations for a project ordered by variation_number", async () => {
    variationsList = [
      { id: "v-1", project_id: "p-1", variation_number: 1, status: "issued" },
      { id: "v-2", project_id: "p-1", variation_number: 2, status: "draft" },
    ];
    const { result } = renderHook(() => useVariationsForProject("p-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it("loads a single variation by id", async () => {
    variationsList = [{ id: "v-1", project_id: "p-1", variation_number: 1 }];
    const { result } = renderHook(() => useVariation("v-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("v-1");
  });

  it("creates a variation, auto-assigns variation_number, inserts empty commercial terms, and clones T&Cs when requested", async () => {
    variationsList = [
      { id: "v-1", project_id: "p-1", variation_number: 1, status: "issued" },
      { id: "v-2", project_id: "p-1", variation_number: 2, status: "draft" },
    ];
    const { result } = renderHook(() => useCreateVariation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        project_id: "p-1",
        clone_tnc_from_rev_id: "r-1",
      });
    });

    const variationInsert = insertMock.mock.calls.find(
      (c) => c[0] === "variations",
    )?.[1] as Record<string, unknown>;
    expect(variationInsert.project_id).toBe("p-1");
    expect(variationInsert.variation_number).toBe(3);
    expect(variationInsert.status).toBe("draft");

    const ctInsert = insertMock.mock.calls.find(
      (c) => c[0] === "doc_commercial_terms",
    )?.[1] as Record<string, unknown>;
    expect(ctInsert.parent_type).toBe("variation");
    expect(ctInsert.parent_id).toBe("v-new");

    const tncInsert = insertMock.mock.calls.find(
      (c) => c[0] === "doc_tnc_selections",
    )?.[1] as Record<string, unknown>;
    expect(tncInsert.parent_type).toBe("variation");
    expect(tncInsert.parent_id).toBe("v-new");
    expect(tncInsert.template_id).toBe("tpl-1");
  });
});
```

- [ ] **Step 2: Run test (expect failure — module doesn't exist)**

```bash
npm run test -- --run src/hooks/__tests__/use-variations.test.tsx
```

Expected: FAIL — `Cannot find module '@/hooks/use-variations'`.

- [ ] **Step 3: Write `src/hooks/use-variations.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Variation,
  VariationCreate,
  VariationUpdate,
} from "@/types";

const VARIATIONS_KEY = ["variations"] as const;

function variationsByProjectKey(projectId: string | undefined) {
  return [...VARIATIONS_KEY, projectId] as const;
}

function variationByIdKey(id: string | undefined) {
  return [...VARIATIONS_KEY, "by-id", id] as const;
}

export function useVariation(id: string | undefined) {
  return useQuery({
    queryKey: variationByIdKey(id),
    enabled: !!id,
    queryFn: async (): Promise<Variation> => {
      const { data, error } = await supabase
        .from("variations")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Variation;
    },
  });
}

export function useVariationsForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: variationsByProjectKey(projectId),
    enabled: !!projectId,
    queryFn: async (): Promise<Variation[]> => {
      const { data, error } = await supabase
        .from("variations")
        .select("*")
        .eq("project_id", projectId!)
        .order("variation_number");
      if (error) throw error;
      return data as Variation[];
    },
  });
}

export interface UseCreateVariationInput extends VariationCreate {
  clone_tnc_from_rev_id?: string;
}

export function useCreateVariation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UseCreateVariationInput): Promise<Variation> => {
      const { data: { user } } = await supabase.auth.getUser();

      // Determine next variation_number for this project.
      const { data: existing, error: lErr } = await supabase
        .from("variations")
        .select("*")
        .eq("project_id", input.project_id)
        .order("variation_number");
      if (lErr) throw lErr;
      const next = ((existing as Variation[]) ?? []).reduce(
        (max, v) => (v.variation_number > max ? v.variation_number : max),
        0,
      ) + 1;

      const { data: varRow, error: vErr } = await supabase
        .from("variations")
        .insert({
          project_id: input.project_id,
          variation_number: next,
          status: "draft",
          summary: input.summary ?? null,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (vErr) throw vErr;
      const variation = varRow as Variation;

      const { error: ctErr } = await supabase
        .from("doc_commercial_terms")
        .insert({ parent_type: "variation", parent_id: variation.id });
      if (ctErr) throw ctErr;

      if (input.clone_tnc_from_rev_id) {
        const { data: src } = await supabase
          .from("doc_tnc_selections")
          .select("*")
          .eq("parent_type", "quote_revision")
          .eq("parent_id", input.clone_tnc_from_rev_id)
          .maybeSingle();
        if (src) {
          const { template_id, omitted_clause_ids, added_custom_clauses } =
            src as {
              template_id: string | null;
              omitted_clause_ids: string[];
              added_custom_clauses: unknown[];
            };
          await supabase.from("doc_tnc_selections").insert({
            parent_type: "variation",
            parent_id: variation.id,
            template_id,
            omitted_clause_ids,
            added_custom_clauses,
          });
        }
      }
      return variation;
    },
    onSuccess: (variation) => {
      qc.invalidateQueries({
        queryKey: variationsByProjectKey(variation.project_id),
      });
      qc.invalidateQueries({ queryKey: variationByIdKey(variation.id) });
    },
  });
}

export function useUpdateVariation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: VariationUpdate;
    }): Promise<Variation> => {
      const { data, error } = await supabase
        .from("variations")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Variation;
    },
    onSuccess: (variation) => {
      qc.invalidateQueries({ queryKey: variationByIdKey(variation.id) });
      qc.invalidateQueries({
        queryKey: variationsByProjectKey(variation.project_id),
      });
    },
  });
}

export function useDeleteVariation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ id: string; project_id: string }> => {
      const { data: existing, error: lErr } = await supabase
        .from("variations")
        .select("*")
        .eq("id", id)
        .single();
      if (lErr) throw lErr;
      const v = existing as Variation;
      if (v.status !== "draft") {
        throw new Error(
          `cannot delete variation in status=${v.status} (drafts only)`,
        );
      }
      const { error } = await supabase.from("variations").delete().eq("id", id);
      if (error) throw error;
      return { id, project_id: v.project_id };
    },
    onSuccess: ({ id, project_id }) => {
      qc.invalidateQueries({ queryKey: variationByIdKey(id) });
      qc.invalidateQueries({ queryKey: variationsByProjectKey(project_id) });
    },
  });
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm run test -- --run src/hooks/__tests__/use-variations.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-variations.ts src/hooks/__tests__/use-variations.test.tsx
git commit -m "feat(pac-quote-v2): useVariations CRUD + tests"
```

---

## Task 4: `useVariationCitations` hooks + tests

**Goal:** Hooks for creating, listing, and deleting citations. Citations are immutable — no update.

**Files:**
- Create: `src/hooks/use-variation-citations.ts`
- Create: `src/hooks/__tests__/use-variation-citations.test.tsx`

**Acceptance Criteria:**
- [ ] `useCitationsForVariation(variationId)` returns all citations for a variation.
- [ ] `useCreateCitation(input)` inserts; surfaces a clean error on UNIQUE violation (`23505`).
- [ ] `useDeleteCitation({ id, variation_id })` deletes by id; invalidates the variation's list.
- [ ] Tests cover list / create / delete + UNIQUE-violation error mapping.

**Verify:** `npm run test -- --run src/hooks/__tests__/use-variation-citations.test.tsx`

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/__tests__/use-variation-citations.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import {
  useCitationsForVariation,
  useCreateCitation,
  useDeleteCitation,
} from "@/hooks/use-variation-citations";

let citations: Record<string, unknown>[] = [];
const insertMock = vi.fn();
const deleteEqMock = vi.fn();

let insertShouldReturnUniqueViolation = false;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(name: string) {
      if (name !== "variation_citations") throw new Error(`unexpected ${name}`);
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: citations, error: null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertMock(row);
          if (insertShouldReturnUniqueViolation) {
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        "duplicate key value violates unique constraint",
                    },
                  }),
              }),
            };
          }
          const created = { id: "vc-new", ...row };
          citations.push(created);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: created, error: null }),
            }),
          };
        },
        delete: () => ({
          eq: (col: string, val: unknown) => {
            deleteEqMock({ col, val });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  citations = [];
  insertMock.mockClear();
  deleteEqMock.mockClear();
  insertShouldReturnUniqueViolation = false;
});

describe("useVariationCitations", () => {
  it("lists citations for a variation", async () => {
    citations = [
      {
        id: "vc-1",
        variation_id: "v-1",
        target_section: "scope",
        target_doc_id: "s-1",
        source_kind: "quote_revision",
        source_id: "r-1",
        source_section: "scope",
        source_item_id: "src-1",
        original_text_verbatim: "Original scope",
        created_at: "2026-05-18T00:00:00Z",
      },
    ];
    const { result } = renderHook(() => useCitationsForVariation("v-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("creates a citation", async () => {
    const { result } = renderHook(() => useCreateCitation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        variation_id: "v-1",
        target_section: "scope",
        target_doc_id: "s-2",
        source_kind: "quote_revision",
        source_id: "r-1",
        source_section: "scope",
        source_item_id: "src-2",
        original_text_verbatim: "Cabinet kit",
      });
    });
    expect(insertMock).toHaveBeenCalledOnce();
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.target_section).toBe("scope");
    expect(payload.source_kind).toBe("quote_revision");
  });

  it("surfaces a clean error on UNIQUE violation", async () => {
    insertShouldReturnUniqueViolation = true;
    const { result } = renderHook(() => useCreateCitation(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          variation_id: "v-1",
          target_section: "scope",
          target_doc_id: "s-2",
          source_kind: "quote_revision",
          source_id: "r-1",
          source_section: "scope",
          source_item_id: "src-2",
          original_text_verbatim: "x",
        }),
      ).rejects.toThrowError(/already has a citation/i);
    });
  });

  it("deletes a citation", async () => {
    const { result } = renderHook(() => useDeleteCitation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "vc-1", variation_id: "v-1" });
    });
    expect(deleteEqMock).toHaveBeenCalledWith({ col: "id", val: "vc-1" });
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm run test -- --run src/hooks/__tests__/use-variation-citations.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/hooks/use-variation-citations.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  VariationCitation,
  VariationCitationCreate,
} from "@/types";

const CITATIONS_KEY = ["variation-citations"] as const;

function citationsKey(variationId: string | undefined) {
  return [...CITATIONS_KEY, variationId] as const;
}

export function useCitationsForVariation(variationId: string | undefined) {
  return useQuery({
    queryKey: citationsKey(variationId),
    enabled: !!variationId,
    queryFn: async (): Promise<VariationCitation[]> => {
      const { data, error } = await supabase
        .from("variation_citations")
        .select("*")
        .eq("variation_id", variationId!)
        .order("created_at");
      if (error) throw error;
      return data as VariationCitation[];
    },
  });
}

export function useCreateCitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: VariationCitationCreate,
    ): Promise<VariationCitation> => {
      const { data, error } = await supabase
        .from("variation_citations")
        .insert(input)
        .select()
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Error(
            "That row already has a citation. Delete it first if you want to cite a different source.",
          );
        }
        throw error;
      }
      return data as VariationCitation;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: citationsKey(row.variation_id) });
    },
  });
}

export function useDeleteCitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      variation_id,
    }: {
      id: string;
      variation_id: string;
    }) => {
      const { error } = await supabase
        .from("variation_citations")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return { id, variation_id };
    },
    onSuccess: ({ variation_id }) => {
      qc.invalidateQueries({ queryKey: citationsKey(variation_id) });
    },
  });
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm run test -- --run src/hooks/__tests__/use-variation-citations.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-variation-citations.ts src/hooks/__tests__/use-variation-citations.test.tsx
git commit -m "feat(pac-quote-v2): useVariationCitations CRUD + tests"
```

---

## Task 5: Cascade-delete citations from doc content delete hooks

**Goal:** When a variation's content row is deleted, also delete the citation that targets it. `target_doc_id` is polymorphic, so this is application-level cleanup.

**Files:**
- Modify: `src/hooks/use-doc-content.ts`
- Modify: `src/hooks/__tests__/use-doc-content.test.tsx`

**Acceptance Criteria:**
- [ ] The shared `useDelete` factory inside `makeListCrud` deletes any matching `variation_citations` row when the parent_type is `'variation'` BEFORE deleting the doc row.
- [ ] The factory accepts an optional `targetSection: CitationTargetSection` argument; each per-table export passes its corresponding section name.
- [ ] When `parent_type === 'quote_revision'`, no extra delete happens.
- [ ] Existing tests pass; new test covers the cascade for one section (e.g. scopeItems) and one quote_revision case to prove no cascade.

**Verify:** `npm run test -- --run src/hooks/__tests__/use-doc-content.test.tsx`

**Steps:**

- [ ] **Step 1: Refactor `makeListCrud` to accept the section name and use it on delete**

```ts
// src/hooks/use-doc-content.ts (changes)
import type { CitationTargetSection } from "@/types";

function makeListCrud<T extends { id: string }>(
  table: string,
  targetSection?: CitationTargetSection,
) {
  return {
    // ... useList, useCreate, useUpdate unchanged ...

    useDelete() {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: async ({ id, ref }: { id: string; ref: ParentRef }) => {
          // Variation rows: clean up any citation targeting this row first.
          if (ref.parent_type === "variation" && targetSection) {
            const { error: cErr } = await supabase
              .from("variation_citations")
              .delete()
              .eq("variation_id", ref.parent_id)
              .eq("target_section", targetSection)
              .eq("target_doc_id", id);
            if (cErr) throw cErr;
          }
          const { error } = await supabase.from(table).delete().eq("id", id);
          if (error) throw error;
          return ref;
        },
        onSuccess: (ref) => {
          queryClient.invalidateQueries({ queryKey: contentKey(table, ref) });
          if (ref.parent_type === "variation") {
            queryClient.invalidateQueries({
              queryKey: ["variation-citations", ref.parent_id],
            });
          }
        },
      });
    },
  };
}

export const scopeItems = makeListCrud<DocScopeItem>("doc_scope_items", "scope");
export const inclusions = makeListCrud<DocInclusion>("doc_inclusions", "inclusion");
export const exclusions = makeListCrud<DocExclusion>("doc_exclusions", "exclusion");
export const assumptions = makeListCrud<DocAssumption>("doc_assumptions", "assumption");
export const lineItems = makeListCrud<DocLineItem>("doc_line_items", "line_item");
```

- [ ] **Step 2: Add cascade test cases to `use-doc-content.test.tsx`**

```tsx
// add to the existing describe block in src/hooks/__tests__/use-doc-content.test.tsx
it("delete with parent_type='variation' first deletes the matching citation", async () => {
  const { result } = renderHook(() => scopeItems.useDelete(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      id: "s-1",
      ref: { parent_type: "variation", parent_id: "v-1" },
    });
  });

  // Order matters — citation delete BEFORE doc delete.
  const calls = supabaseFromMock.mock.calls.map((c) => c[0]);
  expect(calls).toContain("variation_citations");
  expect(calls).toContain("doc_scope_items");
  expect(calls.indexOf("variation_citations")).toBeLessThan(
    calls.indexOf("doc_scope_items"),
  );
});

it("delete with parent_type='quote_revision' does NOT touch variation_citations", async () => {
  const { result } = renderHook(() => scopeItems.useDelete(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      id: "s-1",
      ref: { parent_type: "quote_revision", parent_id: "r-1" },
    });
  });
  const tables = supabaseFromMock.mock.calls.map((c) => c[0]);
  expect(tables).not.toContain("variation_citations");
});
```

> **Note:** The existing test file already uses a `supabaseFromMock` spy via the mocked supabase client; the new cases extend that pattern. If the existing test doesn't track table-name order, add a `vi.fn()` wrapper around `from` that records `(name)` per call.

- [ ] **Step 3: Run the suite**

```bash
npm run test -- --run src/hooks/__tests__/use-doc-content.test.tsx
```

Expected: all existing tests + 2 new cases PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-doc-content.ts src/hooks/__tests__/use-doc-content.test.tsx
git commit -m "feat(pac-quote-v2): cascade-delete citations on doc row delete"
```

---

## Task 6: `nextVariationNumber` pure helper + test

**Goal:** Mirror `nextQuoteNumber` / `nextRevNumber` for variations. Pure function over the existing list.

**Files:**
- Modify: `src/lib/quote-numbering.ts`
- Modify: `src/lib/__tests__/quote-numbering.test.ts`

**Acceptance Criteria:**
- [ ] `nextVariationNumber(existing: { variation_number: number }[])` returns 1 when empty, max+1 otherwise.
- [ ] Test covers empty list, contiguous list, gapped list (e.g. [1, 3] → 4).

**Verify:** `npm run test -- --run src/lib/__tests__/quote-numbering.test.ts`

**Steps:**

- [ ] **Step 1: Add failing test**

```ts
// append to src/lib/__tests__/quote-numbering.test.ts
import { nextVariationNumber } from "@/lib/quote-numbering";

describe("nextVariationNumber", () => {
  it("returns 1 when no variations exist", () => {
    expect(nextVariationNumber([])).toBe(1);
  });
  it("returns max+1 for contiguous list", () => {
    expect(
      nextVariationNumber([
        { variation_number: 1 },
        { variation_number: 2 },
      ]),
    ).toBe(3);
  });
  it("returns max+1 for gapped list", () => {
    expect(
      nextVariationNumber([
        { variation_number: 1 },
        { variation_number: 3 },
      ]),
    ).toBe(4);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

Expected: FAIL — `nextVariationNumber is not exported`.

- [ ] **Step 3: Implement**

```ts
// src/lib/quote-numbering.ts (append)
export function nextVariationNumber(
  existing: { variation_number: number }[],
): number {
  return existing.reduce(
    (max, v) => (v.variation_number > max ? v.variation_number : max),
    0,
  ) + 1;
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm run test -- --run src/lib/__tests__/quote-numbering.test.ts
```

Expected: PASS.

- [ ] **Step 5: Refactor `useCreateVariation` to use it**

```ts
// src/hooks/use-variations.ts — replace the inline reducer
import { nextVariationNumber } from "@/lib/quote-numbering";
// ...
const next = nextVariationNumber((existing as Variation[]) ?? []);
```

Re-run `npm run test -- --run src/hooks/__tests__/use-variations.test.tsx` — still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quote-numbering.ts src/lib/__tests__/quote-numbering.test.ts src/hooks/use-variations.ts
git commit -m "feat(pac-quote-v2): nextVariationNumber helper + reuse in useCreateVariation"
```

---

## Task 7: Extend `buildSnapshot` for variation kind + citations

**Goal:** `buildSnapshot` accepts a `kind` discriminator + a `citations` input bundle; emits `kind` and `citations[]` on the snapshot. `revised_text` is denormalised at this point from the variation's content rows.

**Files:**
- Modify: `src/lib/quote-snapshot.ts`
- Modify: `src/lib/__tests__/quote-snapshot.test.ts`

**Acceptance Criteria:**
- [ ] `BuildSnapshotInput` gains optional `kind?: "quote_revision" | "variation"` (default `"quote_revision"`) and optional `citations?: { row: VariationCitation; source_label: string }[]`.
- [ ] When `kind === "variation"`, the snapshot includes `kind: "variation"` and `citations: SnapshotCitation[]`.
- [ ] Each `SnapshotCitation` is built by joining the citation's `target_section` + `target_doc_id` to the corresponding row in the snapshot's content arrays — pulling its text (`title` + optional `body`) as `revised_text`.
- [ ] When `kind` is absent or `"quote_revision"`, the snapshot does **not** include `citations` (back-compat).
- [ ] Tests cover: a variation with one citation on scope, one on line_item, and `source_label` is preserved verbatim.

**Verify:** `npm run test -- --run src/lib/__tests__/quote-snapshot.test.ts`

**Steps:**

- [ ] **Step 1: Add failing tests**

```ts
// src/lib/__tests__/quote-snapshot.test.ts (append)
import type { VariationCitation } from "@/types";

describe("buildSnapshot — variation kind", () => {
  it("includes kind='variation' and citations[] when kind='variation'", () => {
    const scopeRow = {
      id: "s-1",
      parent_type: "variation",
      parent_id: "v-1",
      title: "Revised cabinet build",
      body: "Extra panel.",
      ordering: 0,
      created_at: "2026-05-18T00:00:00Z",
      updated_at: "2026-05-18T00:00:00Z",
    };
    const citation: VariationCitation = {
      id: "vc-1",
      variation_id: "v-1",
      target_section: "scope",
      target_doc_id: "s-1",
      source_kind: "quote_revision",
      source_id: "r-1",
      source_section: "scope",
      source_item_id: "src-1",
      original_text_verbatim: "Original cabinet build",
      created_at: "2026-05-18T00:00:00Z",
    };
    const snap = buildSnapshot({
      rev: { id: "v-1", quote_id: "q-1", rev_number: 1, status: "draft", summary: null, issued_at: null, issued_by: null, snapshot_json: null, pdf_storage_key: null, dropbox_content_hash: null, created_at: "", updated_at: "", created_by: null },
      quote: { id: "q-1", project_id: "p-1", number: "CVL-2129-V01", status: "draft", created_at: "", updated_at: "", created_by: null },
      project: { id: "p-1", job_code: "CVL-2129", project_name: "Infeed", customer_id: "c-1", stage: "awarded", awarded_quote_id: null } as never,
      customer: { id: "c-1", name: "Conveyor Logistics", display_code: "CVL" } as never,
      issued_at: "2026-05-18T00:00:00Z",
      issued_by_email: null,
      scope: [scopeRow],
      inclusions: [],
      exclusions: [],
      assumptions: [],
      line_items: [],
      commercial: null,
      tnc: null,
      kind: "variation",
      citations: [{ row: citation, source_label: "CVL-2129-Q01 Rev 1, item 1" }],
    });
    expect(snap.kind).toBe("variation");
    expect(snap.citations).toHaveLength(1);
    const c = snap.citations![0];
    expect(c.target_section).toBe("scope");
    expect(c.target_doc_id).toBe("s-1");
    expect(c.original_text_verbatim).toBe("Original cabinet build");
    expect(c.revised_text).toBe("Revised cabinet build\n\nExtra panel.");
    expect(c.source_label).toBe("CVL-2129-Q01 Rev 1, item 1");
  });

  it("omits kind and citations when no kind is provided (back-compat)", () => {
    const snap = buildSnapshot({
      rev: { id: "r-1", quote_id: "q-1", rev_number: 1, status: "draft", summary: null, issued_at: null, issued_by: null, snapshot_json: null, pdf_storage_key: null, dropbox_content_hash: null, created_at: "", updated_at: "", created_by: null },
      quote: { id: "q-1", project_id: "p-1", number: "X", status: "draft", created_at: "", updated_at: "", created_by: null },
      project: { id: "p-1", job_code: "X", project_name: "X", customer_id: "c-1", stage: "quoting", awarded_quote_id: null } as never,
      customer: { id: "c-1", name: "X", display_code: "X" } as never,
      issued_at: "2026-05-18T00:00:00Z",
      issued_by_email: null,
      scope: [],
      inclusions: [],
      exclusions: [],
      assumptions: [],
      line_items: [],
      commercial: null,
      tnc: null,
    });
    expect(snap.kind).toBeUndefined();
    expect(snap.citations).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run (expect failure)**

```bash
npm run test -- --run src/lib/__tests__/quote-snapshot.test.ts
```

Expected: FAIL — `BuildSnapshotInput has no kind/citations property` (TS error).

- [ ] **Step 3: Extend `buildSnapshot`**

```ts
// src/lib/quote-snapshot.ts (additions)
import type {
  VariationCitation,
  SnapshotCitation,
  SnapshotKind,
  CitationTargetSection,
} from "@/types";

export interface BuildSnapshotCitation {
  row: VariationCitation;
  source_label: string;
}

export interface BuildSnapshotInput {
  // ... existing fields ...
  kind?: SnapshotKind;
  citations?: BuildSnapshotCitation[];
}

function pickRowText(
  section: CitationTargetSection,
  doc_id: string,
  input: BuildSnapshotInput,
): string {
  const join = (title: string, body: string | null | undefined) =>
    body ? `${title}\n\n${body}` : title;
  switch (section) {
    case "scope": {
      const r = input.scope.find((x) => x.id === doc_id);
      return r ? join(r.title, r.body) : "";
    }
    case "inclusion": {
      const r = input.inclusions.find((x) => x.id === doc_id);
      return r ? join(r.title, r.body) : "";
    }
    case "exclusion": {
      const r = input.exclusions.find((x) => x.id === doc_id);
      return r ? join(r.title, r.body) : "";
    }
    case "assumption": {
      const r = input.assumptions.find((x) => x.id === doc_id);
      if (!r) return "";
      const parts = [r.title, r.value, r.notes].filter(Boolean) as string[];
      return parts.join(" — ");
    }
    case "line_item": {
      const r = input.line_items.find((x) => x.id === doc_id);
      return r ? r.customer_doc_label ?? r.description : "";
    }
  }
}

export function buildSnapshot(input: BuildSnapshotInput): QuoteSnapshotV1 {
  // ... existing assembly returns base ...
  const base: QuoteSnapshotV1 = {
    schema_version: 1,
    // ... existing fields ...
  };

  if (input.kind === "variation") {
    const snapshotCitations: SnapshotCitation[] = (input.citations ?? []).map(
      ({ row, source_label }) => ({
        target_section: row.target_section,
        target_doc_id: row.target_doc_id,
        original_text_verbatim: row.original_text_verbatim,
        revised_text: pickRowText(row.target_section, row.target_doc_id, input),
        source_label,
      }),
    );
    return { ...base, kind: "variation", citations: snapshotCitations };
  }
  return base;
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
npm run test -- --run src/lib/__tests__/quote-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quote-snapshot.ts src/lib/__tests__/quote-snapshot.test.ts
git commit -m "feat(pac-quote-v2): buildSnapshot supports variation kind + citations"
```

---

## Task 8: Migration 084 — `issue_variation` RPC

**Goal:** Atomic issue for variations. Locks draft, flips status, sets snapshot/pdf/issued_at/issued_by, writes audit row. Requires `projects.stage ∈ {awarded, in_progress}`.

**Files:**
- Create: `supabase/migrations/084_pac_quote_variation_issue_rpc.sql`

**Acceptance Criteria:**
- [ ] `public.issue_variation(_variation_id, _snapshot, _storage_key)` exists with SECURITY DEFINER + `search_path = public`.
- [ ] Requires authenticated user (raises on `auth.uid() IS NULL`).
- [ ] Locks the variation row `FOR UPDATE`, requires `status = 'draft'`.
- [ ] Reads `projects.stage` via join through `variations.project_id`; raises when stage not in `('awarded','in_progress')`.
- [ ] Updates the variation: `status='issued'`, `snapshot_json`, `pdf_storage_key`, `issued_at=now()`, `issued_by=auth.uid()`.
- [ ] Inserts `issue_audit_log` with `event_type='issued'`, `target_type='variation'`, `target_id=_variation_id`, `details_json={variation_number, project_id, total}`.
- [ ] EXECUTE granted to `authenticated` only.

**Verify:** `npx supabase db push`.

**Steps:**

- [ ] **Step 1: Write the migration** (full text per spec §2)

```sql
-- supabase/migrations/084_pac_quote_variation_issue_rpc.sql
CREATE OR REPLACE FUNCTION public.issue_variation(
  _variation_id uuid,
  _snapshot jsonb,
  _storage_key text
) RETURNS public.variations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _var public.variations;
  _user uuid := auth.uid();
  _project_stage text;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'must be authenticated'; END IF;

  SELECT * INTO _var FROM public.variations WHERE id = _variation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'variation not found'; END IF;
  IF _var.status <> 'draft' THEN
    RAISE EXCEPTION 'variation is not in draft (status=%)', _var.status;
  END IF;

  SELECT stage INTO _project_stage
    FROM public.projects WHERE id = _var.project_id;
  IF _project_stage NOT IN ('awarded', 'in_progress') THEN
    RAISE EXCEPTION 'variations require an awarded or in-progress project';
  END IF;

  UPDATE public.variations
    SET status = 'issued',
        snapshot_json = _snapshot,
        pdf_storage_key = _storage_key,
        issued_at = now(),
        issued_by = _user
    WHERE id = _variation_id
    RETURNING * INTO _var;

  INSERT INTO public.issue_audit_log (
    actor_id, event_type, target_type, target_id, details_json
  ) VALUES (
    _user, 'issued', 'variation', _variation_id,
    jsonb_build_object(
      'variation_number', _var.variation_number,
      'project_id', _var.project_id,
      'total', COALESCE((_snapshot -> 'totals' ->> 'grand_total')::numeric, 0)
    )
  );

  RETURN _var;
END $$;

REVOKE ALL ON FUNCTION public.issue_variation(uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_variation(uuid, jsonb, text) TO authenticated;
```

- [ ] **Step 2: Apply locally**

```bash
npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/084_pac_quote_variation_issue_rpc.sql
git commit -m "feat(pac-quote-v2): migration 084 — issue_variation RPC"
```

---

## Task 9: `useIssueVariation` hook + tests

**Goal:** Issue flow hook for variations. Mirrors `useIssueRevision`: re-fetch → snapshot → validate → render → RPC. Typed `IssueError` discriminated union.

**Files:**
- Create: `src/hooks/use-issue-variation.ts`
- Create: `src/hooks/__tests__/use-issue-variation.test.tsx`

**Acceptance Criteria:**
- [ ] `useIssueVariation()` mutation accepts `{ variationId: string }`.
- [ ] Re-fetches the variation, project, customer, polymorphic content rows for `parent_type='variation'`, citations, and (when a `doc_tnc_selections` row exists) the referenced template + clauses.
- [ ] Computes the source_label for each citation by looking up the source doc (quote_revision.number + rev_number, or variation.variation_number) and the source item's ordering+1.
- [ ] Calls `buildSnapshot` with `kind: "variation"` + citations bundle.
- [ ] Runs `validateForIssue` against the project + content; throws `kind: "validation"` on failure.
- [ ] Calls the `quote-render-pdf` edge function (`dry_run: false`) with `rev_id: variationId` (the edge function is parent-agnostic — uses the value as the storage path component).
- [ ] Calls `supabase.rpc("issue_variation", { _variation_id, _snapshot, _storage_key })`; throws `kind: "db"` on failure.
- [ ] Invalidates `["variations", ...]` keys on success.
- [ ] Tests: happy path, validation failure (e.g. project stage=quoting → no scope → fails), render-502, rpc-error.

**Verify:** `npm run test -- --run src/hooks/__tests__/use-issue-variation.test.tsx`

**Steps:**

- [ ] **Step 1: Write the failing tests**

```tsx
// src/hooks/__tests__/use-issue-variation.test.tsx
// Pattern is the same as use-issue-quote.test.tsx — full stateful in-memory mock
// of supabase + global fetch mock returning a synthetic storage_key.
// Cover: happy path, validation-fail (project stage='quoting'), render-502, rpc-error.
```

Full test content is structurally identical to `use-issue-quote.test.tsx` from v1 — swap rev → variation, add `tnc_template` + `tnc_clauses` per the fixture from v1, and assert `rpc` is called with `issue_variation` and `_variation_id` (not `_rev_id`). One additional test: when `project.stage === 'quoting'`, validate the hook throws `kind: 'validation'` with a specific error referencing the stage.

- [ ] **Step 2: Write `src/hooks/use-issue-variation.ts`**

The hook is structurally identical to `useIssueRevision` in `src/hooks/use-issue-quote.ts`. Differences from that hook:

```ts
// src/hooks/use-issue-variation.ts (key differences from useIssueRevision)
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { buildSnapshot, type BuildSnapshotTnc, type BuildSnapshotCitation } from "@/lib/quote-snapshot";
import { validateForIssue, type ValidationError } from "@/lib/quote-validation";
import type {
  Customer,
  DocAssumption,
  DocCommercialTerms,
  DocExclusion,
  DocInclusion,
  DocLineItem,
  DocScopeItem,
  DocTncOverride,
  DocTncSelection,
  Project,
  Quote,
  QuoteRevision,
  QuoteSnapshotV1,
  TncClause,
  TncTemplate,
  Variation,
  VariationCitation,
} from "@/types";

export type IssueError =
  | { kind: "validation"; errors: ValidationError[] }
  | { kind: "render"; message: string }
  | { kind: "db"; message: string };

export interface IssueVariationInput {
  variationId: string;
}

export interface IssueVariationResult {
  variation: Variation;
  snapshot: QuoteSnapshotV1;
  storage_key: string;
}

// fetchBundle returns:
// { variation, project, customer, scope, inclusions, exclusions, assumptions,
//   line_items, commercial, selection, override, template, clauses, citations,
//   sourceLabels: Map<string, string> }
// where sourceLabels is built by joining each citation.source_kind + source_id
// to the appropriate quote_revisions/variations row and the source's
// polymorphic content row (for the ordering).

function buildTncForSnap(b: { override: DocTncOverride | null; selection: DocTncSelection | null; template: TncTemplate | null; clauses: TncClause[] }): BuildSnapshotTnc {
  if (b.override) return { override: b.override };
  if (b.selection && b.template) {
    return { template: b.template, clauses: b.clauses, selection: b.selection };
  }
  return null;
}

function safeFilename(snapshot: QuoteSnapshotV1, variation: Variation): string {
  const base = `${snapshot.project.job_code}-V${variation.variation_number}`;
  return `${base.replace(/[^A-Za-z0-9_.-]/g, "_")}.pdf`;
}

export function useIssueVariation() {
  const qc = useQueryClient();

  return useMutation<IssueVariationResult, IssueError, IssueVariationInput>({
    mutationFn: async ({ variationId }) => {
      // 1. Re-fetch bundle (see fetchBundle helper).
      const bundle = await fetchBundle(variationId).catch((e) => {
        throw { kind: "db", message: e instanceof Error ? e.message : String(e) } satisfies IssueError;
      });

      const userRes = await supabase.auth.getUser();
      const issuedByEmail = userRes.data.user?.email ?? null;

      // 2. Build snapshot with kind=variation + citations bundle.
      const citationsForBuild: BuildSnapshotCitation[] = bundle.citations.map(
        (c) => ({ row: c, source_label: bundle.sourceLabels.get(c.id) ?? "" }),
      );
      // The snapshot input uses the variation as the "rev" since we reuse the
      // same buildSnapshot shape. We synthesise a QuoteRevision-shaped wrapper
      // around the variation just for the snapshot input — this is local-only
      // and never touches the DB.
      const snapshot = buildSnapshot({
        rev: {
          id: bundle.variation.id,
          quote_id: bundle.variation.project_id, // not used in snapshot output
          rev_number: bundle.variation.variation_number,
          status: "draft",
          summary: bundle.variation.summary,
          issued_at: null,
          issued_by: null,
          snapshot_json: null,
          pdf_storage_key: null,
          dropbox_content_hash: null,
          created_at: bundle.variation.created_at,
          updated_at: bundle.variation.updated_at,
          created_by: null,
        },
        quote: {
          id: bundle.variation.project_id,
          project_id: bundle.variation.project_id,
          number: `${bundle.project.job_code}-V${bundle.variation.variation_number}`,
          status: "draft",
          created_at: bundle.variation.created_at,
          updated_at: bundle.variation.updated_at,
          created_by: null,
        },
        project: bundle.project,
        customer: bundle.customer,
        issued_by_email: issuedByEmail,
        issued_at: new Date().toISOString(),
        scope: bundle.scope,
        inclusions: bundle.inclusions,
        exclusions: bundle.exclusions,
        assumptions: bundle.assumptions,
        line_items: bundle.line_items,
        commercial: bundle.commercial,
        tnc: buildTncForSnap(bundle),
        kind: "variation",
        citations: citationsForBuild,
      });

      // 3. Validate (project stage check happens server-side too; we mirror it
      //    here so the user sees the failure before the PDF is rendered).
      if (!["awarded", "in_progress"].includes(bundle.project.stage)) {
        throw {
          kind: "validation",
          errors: [{ field: "project.stage", message: "Variations require an awarded or in-progress project." }],
        } satisfies IssueError;
      }
      const verdict = validateForIssue({
        project: { customer_id: bundle.project.customer_id, job_code: bundle.project.job_code, project_name: bundle.project.project_name },
        scope: bundle.scope.map((s) => ({ title: s.title })),
        lineItems: bundle.line_items,
        tncSelection: bundle.selection ? { template_id: bundle.selection.template_id } : null,
        tncOverride: bundle.override ? { body_markdown: bundle.override.body_markdown } : null,
        commercial: bundle.commercial ? { payment_schedule: bundle.commercial.payment_schedule } : null,
      });
      if (!verdict.ok) {
        throw { kind: "validation", errors: verdict.errors } satisfies IssueError;
      }

      // 4. Render PDF.
      const filename = safeFilename(snapshot, bundle.variation);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw { kind: "db", message: "Not authenticated" } satisfies IssueError;

      const renderRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-render-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ snapshot, rev_id: variationId, filename, dry_run: false }),
        },
      ).catch((e) => {
        throw { kind: "render", message: e instanceof Error ? e.message : String(e) } satisfies IssueError;
      });
      if (!renderRes.ok) {
        const detail = await renderRes.text().catch(() => "");
        throw { kind: "render", message: `render service error (${renderRes.status}): ${detail}` } satisfies IssueError;
      }
      const { storage_key } = (await renderRes.json()) as { storage_key: string };
      if (!storage_key) {
        throw { kind: "render", message: "missing storage_key in render response" } satisfies IssueError;
      }

      // 5. Call the atomic RPC.
      const { data, error } = await supabase.rpc("issue_variation", {
        _variation_id: variationId,
        _snapshot: snapshot,
        _storage_key: storage_key,
      });
      if (error) throw { kind: "db", message: error.message } satisfies IssueError;

      return { variation: data as Variation, snapshot, storage_key };
    },
    onSuccess: (_, { variationId }) => {
      qc.invalidateQueries({ queryKey: ["variations"] });
      qc.invalidateQueries({ queryKey: ["variations", "by-id", variationId] });
      qc.invalidateQueries({ queryKey: ["variation-citations", variationId] });
    },
  });
}

export function isIssueError(err: unknown): err is IssueError {
  return typeof err === "object" && err !== null && "kind" in err && typeof (err as { kind: unknown }).kind === "string";
}
```

The `fetchBundle` helper at the top of the file mirrors v1's `fetchBundle` in `use-issue-quote.ts` but loads from `variations` instead of `quote_revisions` and additionally loads citations + computes `sourceLabels` by reading the source doc + its content row (for ordering+1).

- [ ] **Step 3: Run tests (expect pass)**

```bash
npm run test -- --run src/hooks/__tests__/use-issue-variation.test.tsx
```

Expected: PASS (4 cases).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-issue-variation.ts src/hooks/__tests__/use-issue-variation.test.tsx
git commit -m "feat(pac-quote-v2): useIssueVariation hook + tests"
```

---

## Task 10: PDF renderer — Amends partial + variation header

**Goal:** Render an "Amends" callout block above any row that has a citation; render a different header subtitle when `snapshot.kind === "variation"`.

**Files:**
- Create: `services/pdf-renderer/src/templates/partials/_amends.html`
- Modify: `services/pdf-renderer/src/templates/pac-quote.html`
- Modify: `services/pdf-renderer/src/templates/pac-quote.css`
- Modify: `services/pdf-renderer/src/render.ts`
- Modify: `services/pdf-renderer/src/templates/partials/_header.html`
- Modify: `services/pdf-renderer/src/__tests__/render.test.ts`

**Acceptance Criteria:**
- [ ] New partial `_amends.html` renders Original + Revised, stacked, with the source_label as a sub-heading.
- [ ] `pac-quote.html` builds a per-row `citation` lookup from `snapshot.citations` keyed by `target_doc_id`; renders `{{> amends citation}}` immediately above each row when `kind === "variation"`.
- [ ] Header partial reads `snapshot.kind` (defaults to `"quote_revision"` when absent) and shows "Variation V{n} to {job_code}" when variation; "Quotation" otherwise.
- [ ] CSS adds `.amends-label`, `.amends-original`, `.amends-revised`, `.amends-tag`, `.amends-tag-revised`, `.amends-body` rules reusing existing `--pac-blue-100`, `--pac-blue-600`.
- [ ] `render.test.ts` adds a fixture with one cited scope row, asserts the rendered HTML contains the Amends block and the original verbatim text, and asserts the variation header subtitle.

**Verify:** `cd services/pdf-renderer && npm test`

**Steps:**

- [ ] **Step 1: Write `_amends.html`**

```handlebars
<div class="amends">
  <div class="amends-label">Amends {{this.source_label}}</div>
  <div class="amends-original">
    <span class="amends-tag">Original</span>
    <div class="amends-body">{{markdown this.original_text_verbatim}}</div>
  </div>
  <div class="amends-revised">
    <span class="amends-tag amends-tag-revised">Revised</span>
    <div class="amends-body">{{markdown this.revised_text}}</div>
  </div>
</div>
```

- [ ] **Step 2: Register the partial in `render.ts`**

```ts
// in getTemplate(), alongside existing partials:
Handlebars.registerPartial("amends", await readFile(resolve(tpl, "partials/_amends.html"), "utf8"));
```

Add a Handlebars helper to look up a citation by section+id:

```ts
Handlebars.registerHelper(
  "citationFor",
  function (this: { citations?: Array<{ target_section: string; target_doc_id: string }> }, section: string, id: string) {
    return (this.citations ?? []).find(
      (c) => c.target_section === section && c.target_doc_id === id,
    );
  },
);
```

- [ ] **Step 3: Update `pac-quote.html`** to render the Amends partial above each cited row, in every section. Example for scope:

```handlebars
{{#each snapshot.scope}}
  {{#with (lookup .. 'snapshot') as |snap|}}
    {{!-- guard the helper call to root --}}
  {{/with}}
  {{#with (citationFor 'scope' this.id) as |c|}}
    {{#if c}}{{> amends c}}{{/if}}
  {{/with}}
  <div class="scope-item">
    <div class="scope-title">{{this.title}}</div>
    {{#if this.body}}<p>{{markdown this.body}}</p>{{/if}}
  </div>
{{/each}}
```

(Repeat the `{{#with (citationFor 'X' this.id) as |c|}}{{#if c}}{{> amends c}}{{/if}}{{/with}}` block for inclusion / exclusion / assumption / line_item sections.)

> **Note on Handlebars `this.id`:** Snapshot content arrays currently project rows as `{title, body, ordering}` — without `id`. Task 7's snapshot builder must therefore include `id` on each emitted item. **Add this requirement to Task 7's acceptance criteria** (already implied by Task 7 Step 3's `target_doc_id` lookup, but make it explicit when implementing): each `SnapshotScopeItem` / `SnapshotLineItem` / etc. gains an optional `id?: string` field populated only when `kind === "variation"`.

- [ ] **Step 4: Update `_header.html`** to read `snapshot.kind`:

```handlebars
<header class="doc-header">
  <div class="brand">
    <div class="brand-name">Pac Technologies</div>
    <div class="brand-mark">
      {{#if (eq snapshot.kind "variation")}}
        Variation V{{snapshot.rev_number}} to {{snapshot.project.job_code}}
      {{else}}
        Quotation
      {{/if}}
    </div>
  </div>
  ...
</header>
```

- [ ] **Step 5: Add CSS**

```css
/* services/pdf-renderer/src/templates/pac-quote.css (append) */
.amends {
  margin: 12px 0;
  padding: 12px;
  background: var(--pac-blue-100);
  border-left: 3px solid var(--pac-blue-600);
  border-radius: 0 4px 4px 0;
}
.amends-label {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--pac-blue-700);
  margin-bottom: 8px;
}
.amends-original, .amends-revised {
  margin: 4px 0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.amends-tag {
  flex: 0 0 60px;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  background: var(--pac-blue-200);
  color: var(--pac-blue-800);
  padding: 1px 6px;
  border-radius: 3px;
  text-align: center;
  letter-spacing: 0.06em;
  margin-top: 2px;
}
.amends-tag-revised {
  background: var(--pac-blue-600);
  color: white;
}
.amends-body { flex: 1; font-size: 11px; color: var(--pac-ink-700); }
```

- [ ] **Step 6: Update render.test.ts**

```ts
// add to existing render.test.ts
it("renders an Amends callout above a cited scope row for a variation snapshot", async () => {
  const snapshot = {
    schema_version: 1,
    kind: "variation",
    quote_number: "CVL-2129-V01",
    rev_number: 1,
    issued_at: "2026-05-18T00:00:00Z",
    issued_by_email: null,
    project: { job_code: "CVL-2129", project_name: "Infeed", customer: { id: "c-1", name: "X", display_code: "CVL" } },
    pricing_presentation: { show_pricing_breakdown_detail: "subtotal_only", show_executive_summary: false },
    summary: null,
    scope: [{ id: "s-1", title: "Revised cabinet build", body: null, ordering: 0 }],
    inclusions: [], exclusions: [], assumptions: [],
    line_items: [], totals: { grand_total: 0, by_category: [], by_category_customer_visible: [] },
    commercial_terms: null,
    tnc: null,
    citations: [{
      target_section: "scope",
      target_doc_id: "s-1",
      original_text_verbatim: "Original cabinet build",
      revised_text: "Revised cabinet build",
      source_label: "CVL-2129-Q01 Rev 1, item 1",
    }],
  };
  const html = await renderSnapshotToHtml(snapshot);
  expect(html).toContain("Amends CVL-2129-Q01 Rev 1, item 1");
  expect(html).toContain("Original cabinet build");
  expect(html).toContain("Variation V1 to CVL-2129");
});
```

- [ ] **Step 7: Run tests**

```bash
cd services/pdf-renderer && npm test
```

Expected: PASS, including the new variation case.

- [ ] **Step 8: Commit**

```bash
git add services/pdf-renderer/src
git commit -m "feat(pac-quote-v2): pdf renderer — amends block + variation header"
```

---

## Task 11: `CiteOriginalButton` + `AmendsBanner` components

**Goal:** Per-row in-builder UI for attaching/showing a citation.

**Files:**
- Create: `src/components/quotes/builder/cite-original-button.tsx`
- Create: `src/components/quotes/builder/amends-banner.tsx`

**Acceptance Criteria:**
- [ ] `CiteOriginalButton` props: `{ variationId: string; targetSection: CitationTargetSection; targetDocId: string; hasCitation: boolean; onClick: () => void; onClear: () => void }`.
- [ ] Renders a small "Cite original…" link when no citation, or a "Linked: …" pill + "Clear" button when a citation exists.
- [ ] `AmendsBanner` props: `{ citation: VariationCitation; sourceLabel: string }`.
- [ ] Renders Pac-Blue-100 tinted background + 3px Pac-Blue-600 left border (matches PDF visual). Shows "Amends <source_label>" + original verbatim text.
- [ ] Pure presentational components; no data fetching.

**Verify:** `npm run lint && npx tsc -b`

**Steps:**

- [ ] **Step 1: Write `cite-original-button.tsx`**

```tsx
import { Link as LinkIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CitationTargetSection } from "@/types";

interface Props {
  variationId: string;
  targetSection: CitationTargetSection;
  targetDocId: string;
  hasCitation: boolean;
  sourceLabelShort?: string;
  onClick: () => void;
  onClear: () => void;
}

export function CiteOriginalButton({
  hasCitation,
  sourceLabelShort,
  onClick,
  onClear,
}: Props) {
  if (hasCitation) {
    return (
      <div className="inline-flex items-center gap-2 text-[11px] font-mono">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded",
            "bg-[#3050A0]/20 text-[#94AEDF] border border-[#3050A0]",
          )}
        >
          <LinkIcon className="h-3 w-3" />
          {sourceLabelShort ?? "Cited"}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-zinc-500 hover:text-red-400 inline-flex items-center gap-1"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-mono text-zinc-500 hover:text-[#94AEDF] inline-flex items-center gap-1"
    >
      <LinkIcon className="h-3 w-3" />
      Cite original…
    </button>
  );
}
```

- [ ] **Step 2: Write `amends-banner.tsx`**

```tsx
import type { VariationCitation } from "@/types";

interface Props {
  citation: VariationCitation;
  sourceLabel: string;
}

export function AmendsBanner({ citation, sourceLabel }: Props) {
  return (
    <div className="rounded border-l-4 border-[#3050A0] bg-[#3050A0]/10 p-3 mb-2 space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#94AEDF]">
        Amends {sourceLabel}
      </div>
      <div className="text-xs font-mono text-zinc-300 whitespace-pre-wrap">
        {citation.original_text_verbatim}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npm run lint
npx tsc -b
```

- [ ] **Step 4: Commit**

```bash
git add src/components/quotes/builder/cite-original-button.tsx src/components/quotes/builder/amends-banner.tsx
git commit -m "feat(pac-quote-v2): CiteOriginalButton + AmendsBanner components"
```

---

## Task 12: `CitationPickerDialog` + test

**Goal:** Modal that lets the user pick a source document (issued quote rev or prior variation on the same project), then a section, then a specific item. Confirm creates a `variation_citations` row.

**Files:**
- Create: `src/components/quotes/builder/citation-picker-dialog.tsx`
- Create: `src/components/quotes/builder/__tests__/citation-picker-dialog.test.tsx`

**Acceptance Criteria:**
- [ ] Props: `{ open, onOpenChange, variationId, projectId, targetSection: CitationTargetSection, targetDocId, onCreated: () => void }`.
- [ ] On open, fetches:
  - All `quote_revisions` for the project with `status = 'issued' OR 'superseded'`, joined to their parent quote for the quote number.
  - All `variations` for the project with `status = 'issued'` and `id <> variationId`.
- [ ] Source picker defaults to the project's `awarded_quote_id` rev if one exists.
- [ ] Section is fixed to `targetSection` — user can only cite a matching section type.
- [ ] Item picker fetches the source's polymorphic content rows for that section (filtered by parent_type/parent_id) and renders a sortable list with verbatim preview.
- [ ] Confirm button calls `useCreateCitation` with the right payload; uses the row's `id` as `source_item_id` and `title`+optional `body` (or assumption parts, or line_item description) as `original_text_verbatim`.
- [ ] On success, calls `onCreated()` and closes.
- [ ] Test mocks the supabase fetch chain + `useCreateCitation`; asserts the insert payload when a row is picked + confirmed.

**Verify:** `npm run test -- --run src/components/quotes/builder/__tests__/citation-picker-dialog.test.tsx`

**Steps:**

- [ ] **Step 1: Write the test** (full content; verify the insert shape including original_text_verbatim composition)

```tsx
// src/components/quotes/builder/__tests__/citation-picker-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { CitationPickerDialog } from "@/components/quotes/builder/citation-picker-dialog";

const insertMock = vi.fn();

const tables: Record<string, () => unknown> = {
  quote_revisions: () => ({
    select: () => ({
      eq: () => ({
        in: () => Promise.resolve({
          data: [
            { id: "r-1", quote_id: "q-1", rev_number: 1, status: "issued" },
          ],
          error: null,
        }),
      }),
    }),
  }),
  quotes: () => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: { id: "q-1", number: "CVL-2129-Q01" },
          error: null,
        }),
      }),
      in: () => Promise.resolve({
        data: [{ id: "q-1", number: "CVL-2129-Q01" }],
        error: null,
      }),
    }),
  }),
  variations: () => ({
    select: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
  doc_scope_items: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => Promise.resolve({
            data: [
              { id: "s-src-1", title: "Original cabinet build", body: null, ordering: 0 },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }),
  variation_citations: () => ({
    insert: (row: Record<string, unknown>) => {
      insertMock(row);
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id: "vc-new", ...row }, error: null }),
        }),
      };
    },
  }),
  projects: () => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: { id: "p-1", awarded_quote_id: "r-1" }, error: null }),
      }),
    }),
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (n: string) => tables[n]!() },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => insertMock.mockClear());

describe("CitationPickerDialog", () => {
  it("after picking source + item and confirming, inserts the right citation payload", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <CitationPickerDialog
        open
        onOpenChange={() => {}}
        variationId="v-1"
        projectId="p-1"
        targetSection="scope"
        targetDocId="s-target"
        onCreated={onCreated}
      />,
      { wrapper },
    );

    // The source rev appears (awarded) and item appears after fetch.
    expect(await screen.findByText(/CVL-2129-Q01 Rev 1/)).toBeInTheDocument();
    const item = await screen.findByRole("button", { name: /Original cabinet build/ });
    await act(async () => { await user.click(item); });
    const confirm = screen.getByRole("button", { name: /confirm/i });
    await act(async () => { await user.click(confirm); });

    expect(insertMock).toHaveBeenCalledOnce();
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      variation_id: "v-1",
      target_section: "scope",
      target_doc_id: "s-target",
      source_kind: "quote_revision",
      source_id: "r-1",
      source_section: "scope",
      source_item_id: "s-src-1",
      original_text_verbatim: "Original cabinet build",
    });
    expect(onCreated).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `citation-picker-dialog.tsx`**

The component:
1. On open, fetches: project (for awarded_quote_id), issued/superseded quote_revisions for the project, their parent quotes (for `number`), issued variations for the project (excluding self).
2. Renders three columns: Source documents (radio list) | Items in the picked source's matching section (list) | Preview pane showing the picked item's verbatim text.
3. Confirm button enabled only when an item is picked; calls `useCreateCitation.mutateAsync({...})` with the resolved payload.

```tsx
// Full file — kept focused; pulls source rows via the same supabase chain
// other dialogs use. Source label format: "<quote_number> Rev <n>" or "V<n>".
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useCreateCitation } from "@/hooks/use-variation-citations";
import type {
  CitationTargetSection, Quote, QuoteRevision, Variation,
  DocScopeItem, DocAssumption, DocLineItem,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variationId: string;
  projectId: string;
  targetSection: CitationTargetSection;
  targetDocId: string;
  onCreated: () => void;
}

const SECTION_TABLE: Record<CitationTargetSection, string> = {
  scope: "doc_scope_items",
  inclusion: "doc_inclusions",
  exclusion: "doc_exclusions",
  assumption: "doc_assumptions",
  line_item: "doc_line_items",
};

type SourceKind = "quote_revision" | "variation";
interface SourceOption {
  kind: SourceKind;
  id: string;
  label: string;
}

export function CitationPickerDialog({
  open, onOpenChange, variationId, projectId, targetSection, targetDocId, onCreated,
}: Props) {
  const project = useQuery({
    queryKey: ["project-for-citation", projectId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("*").eq("id", projectId).single();
      if (error) throw error;
      return data as { id: string; awarded_quote_id: string | null };
    },
  });

  const revs = useQuery({
    queryKey: ["issued-revs-for-project", projectId],
    enabled: open,
    queryFn: async () => {
      const { data: revRows, error } = await supabase
        .from("quote_revisions").select("*")
        .eq("status", "issued"); // also include superseded if desired
      if (error) throw error;
      const allRevs = revRows as QuoteRevision[];
      if (allRevs.length === 0) return [] as { rev: QuoteRevision; quote: Quote }[];
      const quoteIds = Array.from(new Set(allRevs.map((r) => r.quote_id)));
      const { data: qs } = await supabase
        .from("quotes").select("*").in("id", quoteIds);
      const projectQuotes = (qs as Quote[]).filter((q) => q.project_id === projectId);
      const projectQuoteIds = new Set(projectQuotes.map((q) => q.id));
      return allRevs
        .filter((r) => projectQuoteIds.has(r.quote_id))
        .map((rev) => ({ rev, quote: projectQuotes.find((q) => q.id === rev.quote_id)! }));
    },
  });

  const variations = useQuery({
    queryKey: ["issued-variations-for-project", projectId, variationId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variations").select("*")
        .eq("project_id", projectId)
        .eq("status", "issued");
      if (error) throw error;
      return (data as Variation[]).filter((v) => v.id !== variationId);
    },
  });

  const sources: SourceOption[] = useMemo(() => {
    const r = (revs.data ?? []).map(({ rev, quote }) => ({
      kind: "quote_revision" as const,
      id: rev.id,
      label: `${quote.number} Rev ${rev.rev_number}`,
    }));
    const v = (variations.data ?? []).map((variation) => ({
      kind: "variation" as const,
      id: variation.id,
      label: `V${variation.variation_number}`,
    }));
    return [...r, ...v];
  }, [revs.data, variations.data]);

  const [picked, setPicked] = useState<SourceOption | null>(null);

  // Initial default: when sources load and there's an awarded rev, pick it.
  useMemo(() => {
    if (!picked && project.data?.awarded_quote_id) {
      const m = sources.find(
        (s) => s.kind === "quote_revision" && s.id === project.data!.awarded_quote_id,
      );
      if (m) setPicked(m);
    } else if (!picked && sources[0]) {
      setPicked(sources[0]);
    }
  }, [picked, project.data, sources]);

  const items = useQuery({
    queryKey: ["citation-items", picked?.kind, picked?.id, targetSection],
    enabled: !!picked,
    queryFn: async () => {
      const parent_type = picked!.kind;
      const parent_id = picked!.id;
      const { data, error } = await supabase
        .from(SECTION_TABLE[targetSection])
        .select("*")
        .eq("parent_type", parent_type)
        .eq("parent_id", parent_id)
        .order("ordering");
      if (error) throw error;
      return data as Array<DocScopeItem | DocAssumption | DocLineItem>;
    },
  });

  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const itemRow = (items.data ?? []).find((r) => r.id === pickedItem);
  const create = useCreateCitation();

  function originalVerbatim(row: typeof itemRow): string {
    if (!row) return "";
    if (targetSection === "assumption") {
      const a = row as DocAssumption;
      return [a.title, a.value, a.notes].filter(Boolean).join(" — ");
    }
    if (targetSection === "line_item") {
      const li = row as DocLineItem;
      return li.customer_doc_label ?? li.description;
    }
    const s = row as DocScopeItem;
    return s.body ? `${s.title}\n\n${s.body}` : s.title;
  }

  async function confirm() {
    if (!picked || !itemRow) return;
    await create.mutateAsync({
      variation_id: variationId,
      target_section: targetSection,
      target_doc_id: targetDocId,
      source_kind: picked.kind,
      source_id: picked.id,
      source_section: targetSection,
      source_item_id: itemRow.id,
      original_text_verbatim: originalVerbatim(itemRow),
    });
    onCreated();
    onOpenChange(false);
    setPicked(null);
    setPickedItem(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Cite an original item</DialogTitle>
          <DialogDescription className="font-mono text-xs text-zinc-400">
            Pick the document and section item this row amends.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3">
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Source</div>
            <ul className="space-y-1">
              {sources.map((s) => (
                <li key={`${s.kind}-${s.id}`}>
                  <button
                    type="button"
                    onClick={() => { setPicked(s); setPickedItem(null); }}
                    className={cn(
                      "w-full text-left text-xs font-mono px-2 py-1.5 rounded border",
                      picked?.kind === s.kind && picked.id === s.id
                        ? "border-[#3050A0] bg-[#3050A0]/15 text-white"
                        : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
              {sources.length === 0 && (
                <li className="text-xs text-zinc-500">No issued documents on this project.</li>
              )}
            </ul>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              {targetSection} items
            </div>
            <ul className="space-y-1 max-h-96 overflow-y-auto">
              {(items.data ?? []).map((row) => {
                const label = originalVerbatim(row);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setPickedItem(row.id)}
                      className={cn(
                        "w-full text-left text-xs px-2 py-1.5 rounded border whitespace-pre-wrap",
                        pickedItem === row.id
                          ? "border-[#3050A0] bg-[#3050A0]/15 text-white"
                          : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
                      )}
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!itemRow || create.isPending}
            onClick={confirm}
            className="text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
          >
            {create.isPending ? "Saving…" : "Confirm"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- --run src/components/quotes/builder/__tests__/citation-picker-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/quotes/builder/citation-picker-dialog.tsx src/components/quotes/builder/__tests__/citation-picker-dialog.test.tsx
git commit -m "feat(pac-quote-v2): citation picker dialog + test"
```

---

## Task 13: Wire `CiteOriginalButton` + `AmendsBanner` into the five section editors

**Goal:** Each of `section-scope`, `section-inclusions`, `section-exclusions`, `section-assumptions`, `section-line-items` gains the per-row citation UI. The same files are reused by quote and variation builders — they activate the citation UI only when the route is the variation builder (we surface this via a context).

**Files:**
- Create: `src/components/quotes/builder/variation-builder-context.tsx`
- Modify: `src/components/quotes/builder/section-scope.tsx`
- Modify: `src/components/quotes/builder/section-inclusions.tsx`
- Modify: `src/components/quotes/builder/section-exclusions.tsx`
- Modify: `src/components/quotes/builder/section-assumptions.tsx`
- Modify: `src/components/quotes/builder/section-line-items.tsx`
- Modify: `src/components/quotes/builder/_scope-like-editor.tsx`

**Acceptance Criteria:**
- [ ] A React context `VariationBuilderContext` provides `{ variationId, projectId } | null`. Null = quote builder; non-null = variation builder.
- [ ] Each section editor reads the context. When null, the editor renders unchanged. When non-null, each row gets a `CiteOriginalButton` + (if cited) an `AmendsBanner`.
- [ ] The citation lookup uses `useCitationsForVariation(variationId)` (or null) at the editor level; rows pick their citation by `target_doc_id`.
- [ ] Picker opens with the correct `targetSection` per editor.
- [ ] "Clear" calls `useDeleteCitation` for that row's citation.
- [ ] Existing v1 quote-builder tests still pass.

**Verify:** `npm run test -- --run src/components/quotes` (full suite under quotes/)

**Steps:**

- [ ] **Step 1: Write the context**

```tsx
// src/components/quotes/builder/variation-builder-context.tsx
import { createContext, useContext, type ReactNode } from "react";

export interface VariationBuilderContextValue {
  variationId: string;
  projectId: string;
}

const Ctx = createContext<VariationBuilderContextValue | null>(null);

export function VariationBuilderProvider({
  value,
  children,
}: {
  value: VariationBuilderContextValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVariationBuilderCtx() {
  return useContext(Ctx);
}
```

- [ ] **Step 2: Extend `_scope-like-editor.tsx` (used by scope, inclusions, exclusions)** to render the citation UI for each row when the context is present.

Add inside the row body in the existing `renderRow` (kept as a small section near the top of each row):

```tsx
import { useState } from "react";
import { useVariationBuilderCtx } from "./variation-builder-context";
import { useCitationsForVariation, useDeleteCitation } from "@/hooks/use-variation-citations";
import { CiteOriginalButton } from "./cite-original-button";
import { AmendsBanner } from "./amends-banner";
import { CitationPickerDialog } from "./citation-picker-dialog";
import type { CitationTargetSection } from "@/types";

// at top of component:
const variation = useVariationBuilderCtx();
const targetSection: CitationTargetSection = /* derived from props.crud */;
const { data: citations = [] } = useCitationsForVariation(variation?.variationId);
const removeCitation = useDeleteCitation();
const [openPickerForRowId, setOpenPickerForRowId] = useState<string | null>(null);

// inside renderRow(row), at the top of the row body:
{variation && (
  <>
    {(() => {
      const c = citations.find(
        (c) => c.target_section === targetSection && c.target_doc_id === row.id,
      );
      return c ? <AmendsBanner citation={c} sourceLabel="(source)" /> : null;
    })()}
    <div className="flex justify-end mb-1">
      <CiteOriginalButton
        variationId={variation.variationId}
        targetSection={targetSection}
        targetDocId={row.id}
        hasCitation={!!citations.find(
          (c) => c.target_section === targetSection && c.target_doc_id === row.id,
        )}
        onClick={() => setOpenPickerForRowId(row.id)}
        onClear={() => {
          const c = citations.find(
            (c) => c.target_section === targetSection && c.target_doc_id === row.id,
          );
          if (c) removeCitation.mutate({ id: c.id, variation_id: variation.variationId });
        }}
      />
    </div>
  </>
)}
```

(Plus rendering the picker dialog once at the editor level:)

```tsx
{variation && openPickerForRowId && (
  <CitationPickerDialog
    open
    onOpenChange={(o) => !o && setOpenPickerForRowId(null)}
    variationId={variation.variationId}
    projectId={variation.projectId}
    targetSection={targetSection}
    targetDocId={openPickerForRowId}
    onCreated={() => setOpenPickerForRowId(null)}
  />
)}
```

`targetSection` is computed by passing it in as a new prop on `ScopeLikeEditor`: each of `section-scope.tsx` / `section-inclusions.tsx` / `section-exclusions.tsx` passes `"scope"` / `"inclusion"` / `"exclusion"` respectively.

- [ ] **Step 3: Update `section-assumptions.tsx`** with the same pattern (`targetSection="assumption"`).

- [ ] **Step 4: Update `section-line-items.tsx`** with the same pattern (`targetSection="line_item"`); the citation UI sits inside the Description cell, below the description input.

- [ ] **Step 5: Verify existing tests still pass**

```bash
npm run test -- --run src/components/quotes
```

Expected: PASS — existing quote-builder editor tests remain green because `useVariationBuilderCtx()` returns null in those tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/quotes/builder
git commit -m "feat(pac-quote-v2): wire citation UI into section editors"
```

---

## Task 14: `variation-builder.tsx` route

**Goal:** `/variations/:variationId/edit` — three-column builder shell wrapped in `VariationBuilderProvider`. Mirrors `quote-builder.tsx`.

**Files:**
- Create: `src/routes/variation-builder.tsx`

**Acceptance Criteria:**
- [ ] Loads the variation, project, customer, polymorphic content rows for `parent_type='variation'`, T&Cs selection/override + referenced template/clauses, citations + source-label map.
- [ ] Computes the live snapshot (with `kind: "variation"` + citations) via `buildSnapshot` and feeds it to `PreviewPane`.
- [ ] Wraps editor in `<VariationBuilderProvider value={{ variationId, projectId }}>`.
- [ ] Footer Issue button gated by `validateForIssue` + project stage check; on click opens an `IssueConfirmDialog` (variation flavour — reuses the v1 dialog with parent-type-aware copy).
- [ ] When the variation is not draft, redirects to `/variations/:id/view`.
- [ ] Header subtitle shows "Variation V<n> — <project_name>".

**Verify:** `npm run lint && npx tsc -b`. Manual: open `/variations/<draftId>/edit` after seeding a draft.

**Steps:**

- [ ] **Step 1: Implement** by adapting the existing `src/routes/quote-builder.tsx` — same loaders, same memoised snapshot, plus citations + source-label map computation. Different RPC + `IssueConfirmDialog` mode (the dialog already handles either parent via prop).

(See `quote-builder.tsx` for the exact pattern. Replace `useQuoteRevision` → `useVariation`, `useQuote` becomes optional, no `useQuote`/`useCustomer` chain via quote — we go variation → project → customer directly.)

- [ ] **Step 2: Generalise `IssueConfirmDialog`** to accept either `useIssueRevision` or `useIssueVariation` via a `mode: "rev" | "variation"` prop. Adjust copy.

- [ ] **Step 3: Verify**

```bash
npm run lint && npx tsc -b
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/variation-builder.tsx src/components/quotes/issue-confirm-dialog.tsx
git commit -m "feat(pac-quote-v2): variation builder route + issue dialog mode"
```

---

## Task 15: `variation-view.tsx` route + redirect when non-draft

**Goal:** `/variations/:variationId/view` — read-only, renders entirely from `snapshot_json`, PDF iframe via signed URL.

**Files:**
- Create: `src/routes/variation-view.tsx`
- Modify: `src/routes/variation-builder.tsx` (redirect when status !== draft)

**Acceptance Criteria:**
- [ ] Same skeleton as `quote-view.tsx`. Header: "Issued V<n> on <date> by <email>. Read-only."
- [ ] Snapshot projection includes the Amends-block render (web equivalent of the PDF) above any row with a citation in `snapshot.citations`.
- [ ] PDF iframe URL re-signs every 4 minutes via TanStack Query (same pattern as `quote-view`).
- [ ] No award / mark-lost buttons (those are quote-level).
- [ ] Builder route redirects to view when variation.status !== "draft".

**Verify:** `npm run lint && npx tsc -b`.

**Steps:**

- [ ] **Step 1: Implement by adapting `quote-view.tsx`.** Loop snapshot.scope / inclusions / exclusions / assumptions / line_items and prepend an inline Amends block when a matching citation exists in `snapshot.citations`.

- [ ] **Step 2: Add the redirect in `variation-builder.tsx`** (`useEffect` watching `variation?.status`).

- [ ] **Step 3: Verify** + commit.

```bash
git add src/routes/variation-view.tsx src/routes/variation-builder.tsx
git commit -m "feat(pac-quote-v2): variation view route + redirect when non-draft"
```

---

## Task 16: Project Commercial tab — Variations sub-section + "New Variation" button

**Goal:** Replace the v2 Variations placeholder card on the project Commercial tab with a real sub-section listing variations + a New Variation button.

**Files:**
- Modify: `src/components/quotes/project-commercial-tab.tsx`
- Create: `src/components/quotes/variation-card.tsx`

**Acceptance Criteria:**
- [ ] Replaces the existing `<PlaceholderCard title="Variations" />` with the real Variations sub-section.
- [ ] Shows all variations for the project (via `useVariationsForProject`) sorted by `variation_number`.
- [ ] "New Variation" button is disabled unless `project.stage ∈ {awarded, in_progress}`, with a tooltip explaining why.
- [ ] Clicking "New Variation" calls `useCreateVariation({ project_id, clone_tnc_from_rev_id: project.awarded_quote_id ?? undefined })` and navigates to `/variations/<newId>/edit`.
- [ ] `VariationCard` props: `{ variation: Variation }`. Renders variation_number + status pill + issued date + Edit (when draft) / View (when issued) links.

**Verify:** `npm run lint && npx tsc -b`.

**Steps:**

- [ ] **Step 1: Write `variation-card.tsx`** (mirrors `quote-card.tsx` but simpler since variations have no revisions).

- [ ] **Step 2: Modify `project-commercial-tab.tsx`** — keep the existing Quotes sub-section, replace the Variations placeholder block with:

```tsx
{/* Variations sub-section */}
<div className="border-t border-zinc-800 pt-4 space-y-3">
  <div className="flex items-center justify-between">
    <div>
      <h3 className="text-sm font-semibold text-zinc-100">Variations</h3>
      <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
        Change-orders raised against the awarded quote.
      </p>
    </div>
    <button
      type="button"
      onClick={createNewVariation}
      disabled={!canCreateVariation || createVariation.isPending}
      title={
        !canCreateVariation
          ? "Project must be Awarded or In-Progress to create a variation"
          : undefined
      }
      className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
    >
      <Plus className="h-3 w-3" />
      {createVariation.isPending ? "Creating…" : "New Variation"}
    </button>
  </div>
  {variationsLoading ? (
    <p className="text-xs font-mono text-zinc-500">Loading…</p>
  ) : variations.length === 0 ? (
    <p className="text-xs font-mono text-zinc-500 rounded border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
      No variations yet on this project.
    </p>
  ) : (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {variations.map((v) => <VariationCard key={v.id} variation={v} />)}
    </div>
  )}
</div>
```

`canCreateVariation` = `project.stage === "awarded" || project.stage === "in_progress"`.

The "Legacy documents" placeholder card stays as the lone v2 card.

- [ ] **Step 3: Commit**

```bash
git add src/components/quotes/project-commercial-tab.tsx src/components/quotes/variation-card.tsx
git commit -m "feat(pac-quote-v2): project commercial tab — variations sub-section"
```

---

## Task 17: Global `/variations` list + sidebar entry + route registration

**Goal:** Mirror `/quotes` for cross-project discovery. Sidebar gains "Variations" next to "Quotes". All three new routes registered.

**Files:**
- Create: `src/routes/variations.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/DashboardLayout.tsx`

**Acceptance Criteria:**
- [ ] `/variations` table with filters by status (draft/issued) + project stage + customer (same pattern as `/quotes`).
- [ ] Card uses `VariationCard`.
- [ ] Sidebar gets a Variations entry with the `FileDiff` (or similar) lucide icon between Quotes and T&Cs.
- [ ] All three routes (`/variations`, `/variations/:variationId/edit`, `/variations/:variationId/view`) lazy-loaded in `App.tsx`.
- [ ] `npm run lint && npm run build` green.

**Verify:** `npm run lint && npm run build`.

**Steps:**

- [ ] **Step 1: Write `src/routes/variations.tsx`** (clone `quotes.tsx`, swap to variations data sources).

- [ ] **Step 2: Update `src/App.tsx`** — add three lazy imports + three route entries.

```tsx
const VariationBuilderPage = lazy(() => import("@/routes/variation-builder"));
const VariationViewPage = lazy(() => import("@/routes/variation-view"));
const VariationsListPage = lazy(() => import("@/routes/variations"));
// ...
{ path: "variations", element: <LazyRoute><VariationsListPage /></LazyRoute> },
{ path: "variations/:variationId/edit", element: <LazyRoute><VariationBuilderPage /></LazyRoute> },
{ path: "variations/:variationId/view", element: <LazyRoute><VariationViewPage /></LazyRoute> },
```

- [ ] **Step 3: Update `DashboardLayout.tsx`** — add `FileDiff` to the lucide import and insert between Quotes and T&Cs:

```tsx
{ to: "/quotes", label: "Quotes", icon: Receipt },
{ to: "/variations", label: "Variations", icon: FileDiff },
{ to: "/tnc", label: "T&Cs", icon: ScrollText },
```

- [ ] **Step 4: Verify**

```bash
npm run lint
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/variations.tsx src/App.tsx src/app/DashboardLayout.tsx
git commit -m "feat(pac-quote-v2): variations list + sidebar entry + route registration"
```

---

## Task 18: End-to-end integration test

**Goal:** A single test that goes from "no data" → "variation with one citation issued" through the real code paths, with `fetch` mocked.

**Files:**
- Create: `src/lib/__tests__/variation-flow.integration.test.tsx`

**Acceptance Criteria:**
- [ ] Stateful in-memory supabase mock (extend the v1 issue-flow integration mock) that:
  - Seeds an awarded quote rev with a scope item ("Original cabinet build") and the project in stage `awarded`.
  - Seeds a draft variation on the same project with one scope item ("Revised cabinet build").
  - Seeds a `variation_citations` row linking the variation's scope row to the source rev's scope row.
- [ ] Mock `rpc("issue_variation", …)` mirrors the migration 084 RPC: requires draft, requires project stage in awarded/in_progress, flips status + snapshot + storage_key + issued_at + issued_by, inserts issue_audit_log row.
- [ ] Test runs `useIssueVariation` via `renderHook` and asserts:
  - `variations` row flipped to status `issued`, `snapshot_json` non-null with `kind === "variation"`, `pdf_storage_key` set.
  - `issue_audit_log` row written with `event_type='issued'`, `target_type='variation'`, `target_id=<variationId>`, `details_json.variation_number=1`.
  - Snapshot's `citations[0]` has `original_text_verbatim === "Original cabinet build"` and `revised_text === "Revised cabinet build"`.
- [ ] One additional case: variation on a `quoting`-stage project — assert `useIssueVariation` rejects with `kind: "validation"`.
- [ ] Full suite green.

**Verify:** `npm run test -- --run`

**Steps:**

- [ ] **Step 1: Copy `issue-flow.integration.test.tsx` to `variation-flow.integration.test.tsx`** and adapt:
  - Add `variations` table to the in-memory DB.
  - Add `variation_citations` rows + handler.
  - Replace the rpc handler for `issue_variation` (per spec §2 RPC body).
  - Build the source label so the snapshot's `citations[0].source_label` reads `"CVL-2129-Q01 Rev 1, item 1"`.
  - Re-run the same end-to-end assertions, swapped to the variation entity.

- [ ] **Step 2: Run the full suite**

```bash
npm run test -- --run
```

Expected: all existing v1 tests + new variation tests green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/variation-flow.integration.test.tsx
git commit -m "test(pac-quote-v2): end-to-end variation flow integration test"
```

---

## Self-review notes (post-write)

- **Spec coverage** — Tasks 1–2 cover §2 schema + types. Tasks 3–4 cover hooks for the new entities. Task 5 handles the polymorphic cascade-delete documented in §2's notes. Tasks 6–7 cover the snapshot extension. Tasks 8–9 cover the issue flow. Task 10 covers the PDF "Amends" block + variation header (§5). Tasks 11–13 cover the citation UX (§4 + §6). Tasks 14–17 cover the routes + nav (§4 placement). Task 18 closes the loop with an integration test.
- **Out-of-scope items re-confirmed:** Dropbox publish, auto-suggested pricing delta, DOCX export, Style Review, AI legacy ingestion, clause-level citations.
- **Type consistency check:** `CitationTargetSection` is the same union across the type file, the schema CHECK, the hook payloads, the snapshot interface, and the picker dialog. `SnapshotKind` defaults to `"quote_revision"` when absent (back-compat for v1 snapshots).
- **Risk callouts:** Task 13 (wiring citation UI into the five section editors) is the most invasive — it touches files that already have passing v1 tests. The `useVariationBuilderCtx() === null` guard isolates v1. Task 10 (Handlebars template) requires `snapshot.scope[].id` etc. to be populated when `kind === "variation"`; this is added to Task 7's responsibilities.
- **Operational steps** (user-side, not in any task): `npx supabase db push` after migration 083 + 084.
