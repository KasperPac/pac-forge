# Pac-Quote v2 — Variations + Citations Design

> Follows the v1 spec at `Docs/superpowers/specs/2026-05-14-pac-quote-variation-builder-design.md`. This document scopes only **§6 Variation flow & citations** of that spec for a single implementation plan. Dropbox sync (§8), AI legacy extraction (§10), Style Review (§11), and DOCX export are deferred to subsequent plans.

**Goal.** Allow Pac engineers to issue formal change-orders (variations) against an already-awarded project quote. Each variation produces an immutable PDF + JSON snapshot defended by the same mechanic as v1 quote revisions, with structured citations linking specific items back to the original or prior variation they amend.

**Non-goal.** Replace the awarded quote, supersede prior variations, or auto-mutate the cited source.

---

## 1. Architecture

Variations are a parallel document type to quote revisions, hung off `projects` rather than `quotes`. They share the polymorphic content tables (`parent_type='variation'` is already accepted by every doc table), the same snapshot mechanic, and the same PDF render service.

Two things are genuinely new:

- A `variation_citations` table that links a variation's content row to an item in some other snapshot (a quote revision or a prior variation on the same project).
- An "Amends" callout block in the PDF template that renders above any content row that has a citation.

Everything else — the builder shell, section editors, PDF render, preview iframe — is reused via component-level reuse, not route-level reuse. The variation builder is its own route (`/variations/:variationId/edit`) that imports the same `BuilderLayout`, section editors, and `PreviewPane` as the quote builder.

## 2. Schema additions

### Migration 083 — `variation_citations`

```sql
CREATE TABLE variation_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id uuid NOT NULL REFERENCES variations(id) ON DELETE CASCADE,

  -- which row in the variation does this citation amend?
  target_section text NOT NULL
    CHECK (target_section IN ('scope','inclusion','exclusion','assumption','line_item')),
  target_doc_id uuid NOT NULL,        -- doc_scope_items.id / doc_line_items.id / etc.

  -- what is being cited?
  source_kind text NOT NULL
    CHECK (source_kind IN ('quote_revision','variation')),
  source_id uuid NOT NULL,             -- quote_revisions.id or variations.id
  source_section text NOT NULL,        -- 'scope' | 'inclusion' | ...
  source_item_id uuid NOT NULL,        -- the source's live doc_*.id at cite-time

  -- frozen at cite-time from the source snapshot
  original_text_verbatim text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (variation_id, target_section, target_doc_id)
);

CREATE INDEX variation_citations_variation_idx ON variation_citations(variation_id);
CREATE INDEX variation_citations_source_idx ON variation_citations(source_kind, source_id);
```

**Notes:**
- `UNIQUE (variation_id, target_section, target_doc_id)` keeps citations 1-per-row. A row either amends one source thing or is fresh — never many-to-many. Simplifies rendering and dialog UX.
- `revised_text` is **not** stored on the citation. The variation's own content row (e.g. `doc_scope_items` with `parent_type='variation'`) holds the revised content. The PDF renderer pairs them up at issue time when both get inlined into `snapshot_json`. This avoids two sources of truth during draft editing.
- **Clause-level citations are deferred.** `target_section` deliberately excludes `'clause'`. T&Cs clauses don't have stable IDs across snapshots (they're inlined), and the variation T&Cs section uses `doc_tnc_selections` which has no per-clause polymorphic row to target. If clause-level amendment is needed later, it lands as a follow-up plan.
- **Citation cleanup on variation-row delete.** `target_doc_id` is polymorphic (could point at any of the five doc tables), so a single FK with `ON DELETE CASCADE` isn't possible. The deletion hooks for each of `doc_scope_items` / `doc_inclusions` / `doc_exclusions` / `doc_assumptions` / `doc_line_items` must also delete any matching `variation_citations` row when `parent_type='variation'`. Documented as a per-hook responsibility in the plan, covered by a unit test per hook.
- **`source_item_id` references the source's live doc row, not the snapshot.** At cite-time the picker reads the source's polymorphic content rows (`doc_*` with `parent_type=source_kind` + `parent_id=source_id`) and freezes both the row's `id` (as `source_item_id`) and its `title`+`body` (as `original_text_verbatim`). The verbatim text is the defensibility — the id is a back-reference for audits. The PDF renderer never resolves `source_item_id`; it uses `original_text_verbatim` directly.

### Migration 084 — `issue_variation` RPC

```sql
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

Simpler than `issue_quote_revision`: no supersede semantics, no row-lock dance between siblings. Lock + flip + audit.

### Snapshot extension (no migration)

The variation snapshot is built by the same `buildSnapshot()` plus a thin wrapper. Two additions to `QuoteSnapshotV1`:

- `kind?: "quote_revision" | "variation"` discriminator. PDF template uses this to choose the header subtitle ("Quotation" vs "Variation V1 to CVL-2129"). **Optional for back-compat.** v1 snapshots already in the DB don't carry this field; both the type guard and the PDF renderer default `kind` to `"quote_revision"` when absent.
- `citations: SnapshotCitation[]` field, where each `SnapshotCitation` carries `target_section`, `target_doc_row_id_in_snapshot`, `original_text_verbatim`, `revised_text` (denormalised from the paired variation content row at snapshot-build time), and a human-readable `source_label` (e.g. `"CVL-2129-Q01 Rev 1, item 3"` or `"V1, item 2"`).

After issue, the snapshot stands alone — the citation rows in the DB are reference data; the snapshot is the authoritative defensibility record.

## 3. Hooks

```
src/hooks/
  use-variations.ts           // useVariation(id), useVariationsForProject(projectId),
                              // useCreateVariation, useUpdateVariation, useDeleteVariation
  use-variation-citations.ts  // useCitationsForVariation, useCreateCitation,
                              // useDeleteCitation. No update — citations are immutable
                              // (edit the variation's content row instead).
  use-issue-variation.ts      // mirrors useIssueRevision, simpler validation path.
```

**`useCreateVariation`** takes `{ project_id, clone_tnc_from_rev_id? }`. The mutation:
1. Computes next `variation_number` for the project (one beyond the current max).
2. Inserts the variation row in `draft`.
3. If `clone_tnc_from_rev_id` is provided, fetches that rev's `doc_tnc_selections` row and inserts a copy with the new variation as parent. Otherwise the variation gets the system-default template via the existing T&Cs selection flow.
4. Inserts an empty `doc_commercial_terms` row (mirrors `useCreateQuote`).

**`useIssueVariation`** orchestration:
1. Re-fetch bundle (variation + project + customer + polymorphic content + citations + T&Cs).
2. Build snapshot (extended `buildSnapshot` with `kind: "variation"` + citations).
3. Validate: project must be `awarded` or `in_progress`; variation must be `draft`; at least one of (scope/inclusion/exclusion/assumption/line_item); T&Cs resolved.
4. Render PDF via the existing edge function (it just forwards `snapshot` — no edge-function changes needed).
5. Call RPC `issue_variation`.

Typed discriminated `IssueError` mirrors `useIssueRevision`'s.

## 4. UI components & routes

```
src/routes/
  variation-builder.tsx           // /variations/:variationId/edit
  variation-view.tsx              // /variations/:variationId/view
  variations.tsx                  // /variations (global list)

src/components/quotes/
  project-commercial-tab.tsx      // grow a Variations sub-section; the v2 placeholder
                                  //   card becomes the real section. New Variation button
                                  //   gated on stage ∈ awarded/in_progress.
  variation-card.tsx              // mirrors quote-card.tsx

src/components/quotes/builder/
  citation-picker-dialog.tsx      // modal: pick source doc → section → item.
                                  //   Shows verbatim preview, confirms target row.
  cite-original-button.tsx        // in-row trigger + amends-callout badge
  amends-banner.tsx               // banner shown above a row that has a citation
                                  //   (live preview of the PDF's Amends block)
```

The seven existing section editors are reused as-is — they're already keyed on `ParentRef`, so they accept `parent_type='variation'` with no change. The only addition: each editor row renders `<CiteOriginalButton row={row} parentRef={ref} />`. When a citation exists for that row, the row also renders `<AmendsBanner citation={c} />` above its content.

**Citation picker flow:**
1. User clicks "Cite original…" on a variation content row.
2. Modal lists issued documents on the same project: quote revisions (issued or superseded) + prior variations (issued only). Default selection: the awarded quote rev when one exists.
3. User picks the section (constrained to match the target row's section type — amending a scope row only lets you cite a scope item).
4. User picks the specific item. Preview shows the verbatim text from the source snapshot.
5. Confirm → inserts `variation_citations` row with `original_text_verbatim` frozen.

**Routes registered** in `src/App.tsx` (lazy-loaded). Sidebar gets a new "Variations" entry next to "Quotes" in the top group.

**`variation-view.tsx`** mirrors `quote-view.tsx`: renders entirely from `snapshot_json`, signed-URL PDF iframe in the right pane. Banner shows "Issued V<n> on <date> by <email>. Read-only."

## 5. PDF template additions

`services/pdf-renderer/src/templates/pac-quote.html` gets an Amends-block partial. For each content section the snapshot carries, the renderer walks the section's rows and emits the Amends block (stacked layout — better for A4 portrait) immediately above any row whose `id` appears in the snapshot's `citations` array.

```handlebars
{{#if citation}}
  <div class="amends">
    <div class="amends-label">Amends {{citation.source_label}}</div>
    <div class="amends-original">
      <span class="amends-tag">Original</span>
      <div class="amends-body">{{markdown citation.original_text_verbatim}}</div>
    </div>
    <div class="amends-revised">
      <span class="amends-tag amends-tag-revised">Revised</span>
      <div class="amends-body">{{markdown citation.revised_text}}</div>
    </div>
  </div>
{{/if}}
```

The `.amends` block reuses the existing Pac Blue 100 tinted background + 3px Pac Blue 600 left border already defined in `pac-quote.css`. The Handlebars template renders a different header subtitle when `snapshot.kind === "variation"`.

## 6. Tests

- `quote-numbering.test.ts` extended with `nextVariationNumber()`.
- `quote-snapshot.test.ts` extended: variation snapshot with one cited scope row + one cited line item; assert `citations` array shape, `revised_text` denormalisation, and `source_label` formatting.
- `use-variations.test.tsx` — list/get/create (with T&Cs clone) / update / delete.
- `use-variation-citations.test.tsx` — create/delete + uniqueness violation surfaces a clean error.
- `use-issue-variation.test.tsx` — happy path, validation-fail, render-fail, db-fail, project-stage-blocked.
- `citation-picker-dialog.test.tsx` — selects a source row, verifies the citation insert payload.
- `variation-flow.integration.test.tsx` — end-to-end with the v1 in-memory supabase mock, extended to model `issue_variation`.

PDF rendering of the Amends block is covered by an HTML-only render test in `services/pdf-renderer/src/__tests__/render.test.ts`.

## 7. Out of scope (re-confirmed)

Each of these gets its own plan when prioritised:

- **Dropbox publish** (spec §8). Issued variations land in Supabase Storage only.
- **Auto-suggested pricing delta** (spec §6, final paragraph). When a citation targets an assumption with a known pricing impact, the builder would offer to insert a delta line item. Suggestion-only, user accepts or rejects. Real logic, deferred.
- **DOCX export** (spec §15 step 10).
- **Style Review panel** (spec §11).
- **AI legacy ingestion** (spec §10).
- **Variation supersede / revise-in-place** semantics. Variations are draft → issued; to "revise" an issued variation, the user issues a new variation. No supersede chain.

## 8. Implementation order (high-level — refined into bite-sized tasks in the plan)

1. Schema (migration 083 `variation_citations`).
2. Types (`src/types/variation.ts`, `src/types/variation-citation.ts`, extend `QuoteSnapshotV1`).
3. Variations CRUD hook + tests.
4. Citation hooks + tests.
5. Extend `buildSnapshot` to handle the `variation` kind + `citations` array.
6. Migration 084 `issue_variation` RPC.
7. `useIssueVariation` hook + tests.
8. PDF renderer: Amends block partial + variation header subtitle + tests.
9. UI: `cite-original-button`, `citation-picker-dialog`, `amends-banner`.
10. Wire CiteOriginalButton + AmendsBanner into each section editor.
11. `variation-builder.tsx` route + `variation-view.tsx` route + redirect-when-not-draft.
12. `project-commercial-tab.tsx` grows the Variations sub-section + "New Variation" button.
13. `variation-card.tsx` + `variations.tsx` global list.
14. Sidebar entry; route registration.
15. End-to-end integration test.

## 9. Open items (resolved during brainstorm)

- **Scope:** variations + citations only. Other v2 items deferred.
- **Nav placement:** Commercial-tab sub-section + global `/variations` list.
- **Citation UX:** per-row "Cite original…" action on each section editor row.
- **Builder reuse:** separate route, shared lower-level components.
- **Citation cardinality:** 1 citation per variation content row (UNIQUE constraint).
- **`revised_text` storage:** lives on the variation's content row, not on the citation; denormalised into `snapshot_json` at issue time.
- **Variation status flow:** draft → issued only. No supersede.
- **Issuing precondition:** project.stage ∈ {awarded, in_progress}.
- **T&Cs default for new variations:** clone the awarded rev's selection if provided; else system default.
