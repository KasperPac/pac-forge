# Pac-Quote — Quote & Variation Builder

Design spec, 2026-05-14.

## 1. Purpose

A new Pac-Forge module that produces defensible, professionally formatted quotes and variations, stitched to the existing Dropbox project folder, with explicit captured assumptions so post-award disagreements can be settled by reference to the issued artefact.

**Pain point that prompted this.** Pac quoted a project assuming business hours, was told after award the work was weekend-and-nights only, and had nothing to point to that proved the original assumption. Every load-bearing assumption needs to be captured structurally, locked at issue, and reproducible on demand.

**Users.** Two — Kasper (senior) and the Managing Director (non-technical). UX bias is toward simplicity.

**Scope, v1.** Quote authoring with pre-award revisions, variation authoring with optional structured citations to a parent quote, T&Cs library, Dropbox publishing of immutable PDFs, AI-assisted ingestion of legacy quotes/variations from the project folder, and an in-app style-review check against the Pac Technologies brand voice.

## 2. Architectural decisions (locked in brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Project model | Existing `projects` table gains a `stage` field. Quotes/variations hang off `project_id`. | One job = one folder = one record. Matches reality and avoids duplicating customer / job-code data. |
| Legacy ingestion | AI extraction (Claude) with mandatory human review before save. | Pure deterministic parsing is brittle. Light index alone doesn't make legacy projects queryable. AI-with-review is the realistic middle. |
| Source of truth | App database is canonical. Dropbox is the published-artefact mirror. | Matches the rest of Pac-Forge. Dropbox files write-only once issued. |
| Output format | PDF default. DOCX is a secondary export, single-file download only. | Prevents anyone editing the source-of-truth file directly. |
| Pricing model | Two layers — internal cost build (full detail) + customer-facing presentation (selective subtotals). | Pac uses creative pricing (offsets between categories, markups). Decoupling internal vs published presentation supports that. |
| Quote revisions | Numeric versions (V1, V2…), pre-award only, supersede on issue. | Pac re-quotes pre-award commonly. |
| Variations | Standalone mini-quotes parented to project. Optional structured citation when amending a prior item. | Variations are often net-new scope, not deltas. The amend case is the minority but the defensibility one. |
| Issue mechanic | Read-only snapshot of every content row written to `snapshot_json` atomically with PDF publish. | The snapshot is the defensibility instrument — even if live tables are later edited, the snapshot is immutable. |
| Dropbox integration | Dropbox API via a Pac-owned app, single shared OAuth identity. | Web-native, multi-machine, simple OAuth for the non-tech-savvy second user. |
| PDF renderer | Headless Chromium via Puppeteer on a self-hosted Node service (Fly.io / Render). | $5/mo, zero vendor lock-in, full control over template fidelity. |
| Brand system | Pac Technologies design system (Inter + JetBrains Mono, Pac Blue 600, light surfaces) applied verbatim to PDF output. Partial brand adoption in the in-app builder (JetBrains Mono for technical metadata) — full app redesign remains parked. | The PDF is a customer artefact and must be brand-perfect. The app is internal; partial alignment is sufficient. |
| Approval flow | No mandatory MD approval. Either user can issue. Optional review state omitted in v1. | Simplicity. Add later if MD wants a gate. |

## 3. Data model

Tables (new in bold, existing extended in italics):

### Project lifecycle
- *projects* — add `job_code` (e.g. `CVL-2129`), `customer_id`, `project_name`, `stage` (`quoting` | `awarded` | `in_progress` | `closed`), `dropbox_folder_path`, `awarded_quote_id` (nullable, set when stage flips to awarded).
- **customers** — `name`, `display_code` (e.g. `CVL`), `dropbox_root_path` (e.g. `/Pac/Jobs/Conveyor Logistics`). Lets the tool auto-resolve the job folder.

### Quotes
- **quotes** — belongs to a project. Number (e.g. `CVL-2129-Q01`). `status` (`draft` | `issued` | `superseded` | `awarded` | `lost`).
- **quote_revisions** — belongs to a quote. `rev_number` (integer; 1, 2, 3…), `status` (`draft` | `issued` | `superseded`), `issued_at`, `issued_by`, `snapshot_json`, `pdf_dropbox_path`, `dropbox_content_hash`, `summary` (free-text executive summary, nullable; referenced as `doc_summary` in §4).

### Variations
- **variations** — belongs to a project (not a quote). Number (integer; `V1`, `V2`…). `status` (`draft` | `issued`), `issued_at`, `issued_by`, `snapshot_json`, `pdf_dropbox_path`, `dropbox_content_hash`, `summary` (free-text executive summary, nullable).
- **variation_citations** — optional structured links: `variation_id`, `cites_quote_revision_id` (or `cites_variation_id`), `cites_section` (assumption / scope / inclusion / exclusion / line_item / clause), `cites_item_id`, `original_text_verbatim`, `revised_text`, `pricing_delta_line_id` (nullable — links to auto-added pricing line if accepted).

### Document content
Shared by quotes and variations via polymorphic `parent_type` + `parent_id`.
- **doc_scope_items** — title, body, ordering.
- **doc_inclusions** — title, body, ordering.
- **doc_exclusions** — title, body, ordering.
- **doc_assumptions** — `assumption_key` (FK to library), value/notes, ordering.
- **assumption_library** — selectable assumption types (working hours, travel & accom paid by, customer-supplied items, lead times, software licences, witness testing, validity period, currency, plus custom). Seeded content workstream — see §13.
- **doc_line_items** — `category` (Labour / Hardware & Materials / Software & Licences / Software Development / Commissioning / Travel & Accom / Subcontract / Other), description, qty, unit, unit_price, hours, hour_rate, hour_rate_multiplier (office / after-hours), subtotal, `show_in_customer_doc` (bool), `customer_doc_label` (override).
- **doc_commercial_terms** — payment schedule, validity, GST treatment, currency, free-text.

### T&Cs
- **tnc_templates** — name (e.g. `Pac Standard 2026`), version (int), status (`active` | `archived`), `is_default`.
- **tnc_clauses** — belongs to template. `clause_number`, `title`, `body_markdown`, ordering.
- **doc_tnc_selections** — which template + which clauses are included/omitted/added for a given quote rev or variation. Per-quote custom clauses inline.
- **doc_tnc_override** — optional rich-text blob that, when present, replaces the standard T&Cs entirely.

### Audit and legacy
- **issue_audit_log** — every state transition (issue, supersede, award, mark lost, variation issue, legacy import). `actor_id`, `timestamp`, `event_type`, `target_type`, `target_id`, `details_json`.
- **legacy_doc_imports** — `dropbox_path`, `extracted_json`, `reviewed_by`, `reviewed_at`, `attached_to_project_id`, `attached_as` (`quote_revision` | `variation` | `reference_only`).

### Invariants
- Issued snapshots are immutable. `snapshot_json` is the single queryable record of what was sent.
- The PDF in Dropbox is the artefact. The DB snapshot is the queryable defensibility record. Both written atomically.
- T&Cs clauses are inlined into the snapshot (not referenced by ID) so editing a clause in the library never retroactively changes an issued document.

## 4. Document anatomy

Render order, for both quotes and variations:

| Section | Source | Customer-facing? | Notes |
|---|---|---|---|
| Header | `projects` + revision/variation metadata | Yes | Job code, project name, customer, doc number, issue date, issued by, valid until. Page 1 full lockup; pages 2+ mark-only. |
| Executive summary | `doc_summary` field | Yes | Optional, one paragraph. |
| Scope | `doc_scope_items` | Yes | Numbered list. |
| Inclusions | `doc_inclusions` | Yes | Hardware, materials. Numbered. |
| Exclusions | `doc_exclusions` | Yes | Numbered. |
| Assumptions | `doc_assumptions` | Yes | Each rendered `[Title]: [Value]`. Defensibility section. |
| Pricing summary | `doc_line_items` aggregated by category | Yes (filtered) | Default subtotal categories: Hardware & Materials, Software & Licences, Software Development, Commissioning. Other categories selectable. Hours and rates never shown unless explicitly toggled. Grand total always shown. |
| Commercial terms | `doc_commercial_terms` | Yes | Payment milestones, validity, GST. |
| Terms & Conditions | `tnc_template` + selections | Yes | Numbered clauses. Omitted clauses suppressed silently. Per-quote custom clauses appended with continued numbering. |
| Signature block | static | Yes | Signed-by + date, customer accept-by. |

For variations with `variation_citations`, an "Amends" callout block renders above the relevant section, quoting the original text verbatim from the snapshot.

Rules:
- A field with no value is not rendered. No placeholders, no "N/A".
- Presentation settings (which categories to show, summary on/off) are saved with the snapshot. Re-issuing with different presentation creates a new immutable artefact.

## 5. Issue / lock / snapshot flow

States for a `quote_revision` (identical model for `variation`):

```
draft  ──▶  issued  ──▶  superseded   (quote revs only — when next rev issued)
                    ──▶  awarded      (quote revs only — when project awarded)
                    ──▶  lost         (quote revs only — when project lost)
```

The "Issue" action runs as a single server-side transaction:

1. Validate. Required fields filled, total non-zero, customer + job code resolved, at least one scope item, T&Cs template selected.
2. Resolve version. First issue of a quote = `V1`. Each subsequent issue increments. Prior issued rev (if any) marked `superseded`.
3. Build snapshot JSON. Deep-clone every content row (scope items, inclusions, exclusions, assumptions, line items, commercial terms, selected T&Cs clauses with full body text as they exist right now) into one JSON blob. T&Cs clauses are inlined, not referenced.
4. Render the PDF (§7) from the snapshot, not from live tables.
5. Push to Dropbox at the resolved path (§6). Filename per §6 convention.
6. Write snapshot + Dropbox path + content hash back to the record, flip status to `issued`, set `issued_at` and `issued_by`.
7. Audit log entry with `event_type='issued'` and the snapshot diff against the prior rev (if any).

If any step fails, the transaction rolls back. Status stays `draft`. No Dropbox file. No audit entry. User sees the exact failure cause.

**Dropbox-upload failure exception.** Because Dropbox upload is the network-dependent step, if the DB transaction succeeds but the Dropbox upload fails, the record is marked `issued` with a transient `dropbox_sync_pending` flag. A cron-triggered Edge Function retries every minute. UI shows a "Pending Dropbox sync" banner with manual retry. DB issue is recoverable; the only thing missing is the file on Dropbox, which can be regenerated from the immutable snapshot.

**After issue:**
- Form loads in read-only mode. Banner reads "Issued V2 on 2026-05-14 by Kasper. Read-only."
- "New revision (V3)" button clones the snapshot into a fresh editable draft.
- "View issued snapshot" view renders from `snapshot_json`, not live tables.

**Award flow.** Project-level "Mark as Awarded" action takes a `quote_revision_id`, flips it to `awarded`, sets `projects.stage='awarded'` and `projects.awarded_quote_id`, and logs it. Post-award, no further quote revisions on this project — only variations.

## 6. Variation flow & citations

From a project in `awarded` or `in_progress` stage, "New Variation" opens the builder with project metadata pre-filled and variation number auto-assigned.

**Two starting modes:**

- **Fresh scope** — the typical case. Empty builder. User fills in scope, inclusions, exclusions, assumptions, line items, T&Cs as for any quote. T&Cs default to the awarded quote's template.
- **Amends prior items** — user clicks "Cite an existing item," picks source (any issued quote rev or prior variation on the project), and selects the item.

Citation creates a `variation_citations` row. The variation doc renders an "Amends" callout block above the affected section quoting the original wording verbatim from the snapshot.

A variation can be mixed — some fresh scope lines plus some amended items.

**Auto-suggested pricing delta.** When a citation targets an assumption with a known pricing impact (working hours → labour multiplier; travel paid by → travel line additions), the builder offers to auto-add a delta line item with a descriptive label. Suggestion only — user accepts or rejects explicitly.

**Issued PDF "Amends" block** renders the original verbatim and the revised text side by side or stacked. Defensibility over tone. The wording is what wins the argument.

## 7. T&Cs library

Route: `/tnc`. Admin-editable, all-users selectable.

Library of named templates (e.g. `Pac Standard 2026`, `Customer-Specific — Conveyor Logistics`). Each template is a set of structured clauses (numbered, with title + body markdown), not a blob — so variations can cite specific clauses.

**Lifecycle:**
- Editing clauses bumps a template draft version. Issued quotes hold an inlined snapshot of clauses, so editing the library never retroactively changes a sent doc.
- One template marked `is_default`. Defaults onto new quotes/variations.
- Templates can be `archived` — hidden from new-quote pickers, still resolvable for snapshots and legacy imports.

**Per-quote selection in builder:**
- Pick base template.
- All clauses appear in a checklist — uncheck to omit. No reason required.
- Add per-quote custom clauses inline (title + body), renumbered into sequence on render.
- Optional `Customer T&Cs override` rich-text blob. If filled, replaces the standard T&Cs entirely for this doc. Audit-logged.

**Markdown body** subset: headings (h3 and below within a clause), bold/italic, ordered/unordered lists, links. No tables, no images.

**Seeding** — see §13. Tool ships with the table empty.

## 8. Dropbox sync

Single Edge Function layer; one shared OAuth identity (Pac-owned Dropbox app) so neither user re-authenticates.

**Scopes:** `files.content.read`, `files.content.write`, `files.metadata.read`. No `files.permanent_delete` — anything the app would delete is moved to `_archived/` within the job folder.

**Path resolution.**
- `dropbox_folder_path` set when project created (manually picked, or auto-derived from `customer.dropbox_root_path` + `{JobCode} - {ProjectName}`).
- Quote revs → `{folder}/54 Quotes/01 Pac_Quote/{filename}.pdf`
- Variations → `{folder}/55 Variations/01 Pac_Variation/{filename}.pdf`
- Sub-folders default to `01`; tool creates them idempotently if missing. If existing sub-folders under the parent folder follow the `NN …` numbered pattern, the lowest-numbered one is used (legacy compatibility). If none exist, `01 Pac_Quote` / `01 Pac_Variation` is created.

**Filename convention:**
```
{JobCode}-54{Sub}{DocNo}-V{Rev}.pdf      e.g. CVL-2129-5401001-V1.pdf
{JobCode}-55{Sub}{DocNo}-V{Rev}.pdf      e.g. CVL-2129-5501001-V1.pdf
```
- `Sub` default `01`, taken from resolved sub-folder.
- `DocNo` zero-padded to 3 digits, sequential per sub-folder per project.
- `Rev` integer, no padding.

**Three Edge Functions added** alongside existing `generate`, `renew-lease`, `cleanup-expired`:
1. **`dropbox-publish`** — input: snapshot JSON + target path + filename. Renders PDF, uploads to Dropbox, returns `path_display` + content hash.
2. **`dropbox-ingest`** — scans a project's folder for `*.pdf`/`*.docx` candidates in `54 Quotes/` and `55 Variations/` not already linked.
3. **`dropbox-fetch`** — returns file bytes for a Dropbox path. Used for legacy extraction and inline preview.

**Resilience.**
- DB snapshot first, Dropbox upload second. A successful issue with failed upload is recoverable. The reverse (Dropbox PDF exists but no DB record) is not. Order non-negotiable.
- All calls audit-logged with the Dropbox API response.

**Settings page** at `/settings/dropbox`: connect / disconnect, current account + expiry, browse `…/Pac/Jobs/` root for sanity, re-scan trigger.

**Out of scope v1:** webhook subscriptions, two-way sync, deletion (archive only).

## 9. PDF rendering pipeline

**Renderer.** Headless Chromium via Puppeteer in a Node service on Fly.io / Render. ~$5/mo. PDF generated server-side from snapshot JSON + Handlebars template. Same engine for in-app preview (`dry_run=true`, no Dropbox write) and final issue — what's previewed is what's published.

**Template files:**
- `/templates/pac-quote.html` — Handlebars, takes snapshot JSON.
- `/templates/pac-quote.css` — copy of design-system `tokens.css` + `components.css` + quote-specific layout rules.
- `/templates/partials/_header.html`, `_footer.html`, `_signature.html`, `_amends-block.html`.
- `company_branding` DB row feeds the logo path, address, contact — editable via `/settings/branding`.

**Visual standards (per Pac Technologies design system):**
- A4, 25 mm margins.
- Inter for body, JetBrains Mono for tag fields and tabular figures.
- Pac Blue 600 for accents.
- Sentence case headings. Numbered sections.
- ISO-style dates in tables / footers; long-form date ("14 May 2026") in body copy.
- Signal colours reserved for state badges only.

**Page-break discipline.**
- `page-break-after: avoid` on section headers.
- Line item rows don't split across pages.
- Signature block kept together.
- Page 1 uses full horizontal logo lockup; pages 2+ use mark-only header strip (brand rule: lockup below 140 px drops to mark).

**Per-doc rendering options** (saved in snapshot for deterministic re-render):
- `show_executive_summary` (bool).
- `show_pricing_breakdown_detail`: `subtotal_only` | `per_line_no_rates` | `full`. Default `subtotal_only`.
- `include_signature_block` (bool, default true).

## 10. AI legacy extraction

Trigger: "Scan Dropbox folder" in a project's Commercial tab.

Flow per file:
1. Identify doc type by filename pattern; fall back to AI classification on first-page text.
2. Extract text server-side (PDFs via `pdf-parse` / `pdfjs-dist`, DOCX via `mammoth` — already in stack).
3. Claude extraction. System prompt returns one structured JSON matching snapshot schema. Each field annotated with `confidence` (`high` / `medium` / `low`) and `source_snippet` (verbatim supporting text).
4. Assumption library mapping — Claude given the library catalogue and asked to map extracted assumptions to existing keys. Falls back to "unmapped" free text.

**Reviewer UI.** Two-pane modal: left = original PDF/DOCX preview, right = extracted form (same structure as builder). Low-confidence fields amber. Each field has "view source" pin that scrolls left pane to the snippet.

**Save modes:**
- **Reject** — file stays unlinked, no record.
- **Save as draft** (default) — creates `quote_revision` / `variation` in `draft` status, fully editable, not yet immutable.
- **Save as legacy-issued** — creates directly in `issued` status. Snapshot frozen. `pdf_dropbox_path` points to the existing legacy file (not re-rendered). Use when the legacy doc was genuinely sent and is the historical truth.

**T&Cs handling for legacy.** Don't parse legacy T&Cs into clauses. Save the entire section as a `legacy_raw` blob attached to the snapshot. Variation citations to legacy T&Cs use free-text quote-from references.

**No retroactive re-rendering.** Original PDF on disk is authoritative for legacy docs. We never replace it with a Pac-Forge-rendered version.

**Cost.** Each extraction ~10k tokens. Backfill is bounded (a few hundred docs across all projects = a few dollars). Sequential with 1s pause between calls.

## 11. Style review

Brand voice enforcement. Soft surface, not hard enforce. Builder shows a "Style review" panel before Issue:

- Marketing words on the ban list (`solutions`, `cutting-edge`, `seamless`, `journey`, `unlock`, `empower`, `next-generation`, `revolutionary`, `Industry 4.0`, `digital transformation`, plus the full list from the design system README).
- Title-case headings (brand uses sentence case).
- Hyphen-in-range instead of en dash (`4-20 mA` → `4–20 mA`).
- US spellings (organize → organise, behavior → behaviour, etc.).
- Numbers without non-breaking space + unit (`24V` → `24 V`).
- 12-hour clock (`6 AM` → `06:00`).

Each issue has one-click fix. Panel can be dismissed. Issue is not blocked by style failures.

## 12. UI shape

**New sidebar entries:**
- `Quotes` — global list view, filterable by stage / customer / status / issued date.
- `T&Cs` — admin.

**Per-project "Commercial" tab** alongside existing IO list editor:
- Project header strip: job code, customer, project name, stage badge, Dropbox folder path with "Open in Dropbox" link.
- Three stacked sub-sections: Quotes (with revisions), Variations (with citations), Legacy (imported, not yet acted on).
- Each row a card: doc number, status badge, issued date, issued by, total $, action buttons (View / Edit draft / Issue / New rev).

**Builder canvas** (same form for quotes and variations):
- Three-column layout: left rail = section navigator, centre = active section editor, right rail = live PDF preview (iframe, dry_run).
- Sticky footer: total, Issue button (with validation tooltip), Save Draft, Style Review toggle.
- Pac Blue 600 accents. JetBrains Mono for technical metadata (job codes, totals, hour fields, Dropbox paths). Inter for everything else. Existing dark shell preserved.

**Settings additions:**
- `/settings/dropbox` — OAuth connect, root browse, re-scan.
- `/settings/branding` — company info row feeding PDF header/footer.

**DOCX export.** Available on every issued doc via "Download as DOCX" button. Rendered server-side from snapshot through a separate template (`docx-templates` or similar). Single-file download, not pushed to Dropbox. Tooltip clarifies the issued PDF in Dropbox remains the source of truth.

## 13. Parallel content workstreams (not code)

Required for v1 to be useful:
1. **T&Cs content** — draft `Pac Standard 2026` clauses or adapt AS 4000 / AS 2124. Highest priority; without this, no quote can be issued.
2. **Assumption library seed content** — selectable list. Initial set: working hours, travel & accom paid by, customer-supplied items, software licences, lead times, witness testing, validity period, currency. Expand after reviewing last 10 quotes for common patterns.
3. **Customer records seed** — back-fill `customers` table from a one-time scan of `…/Pac/Jobs/`.
4. **Dropbox app registration** — register Pac-owned Dropbox app, capture OAuth credentials in Supabase secrets.
5. **PDF render service deployment** — Node + Puppeteer on Fly.io / Render. URL + auth into Supabase secrets.

## 14. Out of scope (v1)

Explicit exclusions:
- Multi-currency live FX rates (currency captured, no live conversion).
- Customer e-signature / signing portal.
- Email-send-from-app (PDF emailed manually from Outlook).
- Time-tracking / actuals comparison.
- Forecasting / pipeline / win-probability views.
- Multi-language docs.
- Webhook-driven live folder watching.
- Mandatory MD approval before issue.
- Per-user Dropbox OAuth.

## 15. Implementation order

Sequenced so the tool is useful by step 5, brand-aligned and integrated by step 6, post-award capable by step 7, history-aware by step 8.

1. Schema migrations + minimal CRUD for `customers`, `projects` (extended), `quotes`, `quote_revisions`, `variations`, T&Cs.
2. T&Cs admin page.
3. Quote builder canvas (scope / inclusions / exclusions / assumptions / pricing / commercial / T&Cs).
4. PDF render service + preview pipeline.
5. Issue flow + snapshot mechanic + audit log.
6. Dropbox OAuth + publish.
7. Variation builder + citations.
8. AI legacy extraction.
9. Style Review panel.
10. DOCX export.

## 16. Open items for the writing-plans phase

- Confirm exact sub-folder name when newly creating a variations sub-folder. Spec assumes `01 Pac_Variation` to mirror `01 Pac_Quote`.
- Confirm Supabase Edge Functions can call the external Node PDF service via fetch (no special networking constraints).
- Confirm Dropbox app type — full-access Dropbox vs scoped to a folder. Spec assumes full team-account access via the Pac-owned app.
- Decide RLS scope on the new tables — both users have read/write on everything, or per-row author tracking only.
