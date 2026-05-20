# Pac Quote PDF Template Visual Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Puppeteer/Handlebars PDF quote template with a typography-first cover page (full Pac Technologies logo in the header, globe watermark bottom-right), clean corporate content pages, and polished section-level typography throughout.

**Architecture:** All changes are isolated to `services/pdf-renderer/src/templates/` (HTML partials + CSS) and a small update to `render.ts` to read logo assets as base64 data URIs and register a new `cover` partial. No changes to the rendering pipeline, Handlebars helpers, snapshot schema, or Edge Functions.

**Tech Stack:** Handlebars 4.x, Puppeteer-core 23.x, CSS (print-safe, no Tailwind), Node 20+, Vitest

**Spec:** `Docs/superpowers/specs/2026-05-20-pac-quote-pdf-template-design.md`

---

## File Map

| Action | Path |
|--------|------|
| Copy from `public/` | `services/pdf-renderer/src/templates/PacTechnologies.jpg` |
| Copy from `public/` | `services/pdf-renderer/src/templates/PacTechnologiesEdit_Blue_NoText._Transparent.png` |
| Modify | `services/pdf-renderer/src/render.ts` |
| Create | `services/pdf-renderer/src/templates/partials/_cover.html` |
| Modify | `services/pdf-renderer/src/templates/pac-quote.html` |
| Modify | `services/pdf-renderer/src/templates/pac-quote.css` |
| Modify | `services/pdf-renderer/src/templates/partials/_header.html` |
| Modify | `services/pdf-renderer/src/templates/partials/_footer.html` |
| Modify | `services/pdf-renderer/src/templates/components.css` |

`tokens.css` and `_amends.html`, `_signature.html` require no changes.

---

## Task 5: Copy logo assets and update render.ts

**Goal:** Make both logo images available to the renderer (as base64 data URIs) and register the new `cover` partial.

**Files:**
- Copy: `public/PacTechnologies.jpg` → `services/pdf-renderer/src/templates/PacTechnologies.jpg`
- Copy: `public/PacTechnologiesEdit_Blue_NoText._Transparent.png` → `services/pdf-renderer/src/templates/PacTechnologiesEdit_Blue_NoText._Transparent.png`
- Modify: `services/pdf-renderer/src/render.ts`

**Acceptance Criteria:**
- [ ] Both image files exist in `src/templates/`
- [ ] `npm run build` in `services/pdf-renderer/` succeeds and both files appear in `dist/templates/`
- [ ] `renderSnapshotToHtml` template context includes `_logoFull` and `_logoMark` as `data:` URIs
- [ ] `cover` partial is registered in `getTemplate()`
- [ ] `npm test` in `services/pdf-renderer/` passes (all existing tests still green)

**Verify:** `cd services/pdf-renderer && npm test` → all tests pass

**Steps:**

- [ ] **Step 1: Copy the logo files**

```bash
cp public/PacTechnologies.jpg services/pdf-renderer/src/templates/PacTechnologies.jpg
cp "public/PacTechnologiesEdit_Blue_NoText._Transparent.png" "services/pdf-renderer/src/templates/PacTechnologiesEdit_Blue_NoText._Transparent.png"
```

- [ ] **Step 2: Verify build copies them to dist**

```bash
cd services/pdf-renderer && npm run build
ls dist/templates/Pac*
```

Expected output: both filenames listed.

- [ ] **Step 3: Update `render.ts`**

Replace the `cachedAssets` declaration, `getAssets()` function, `getTemplate()` function, and `renderSnapshotToHtml()` function with the following. Everything else in the file stays unchanged.

```ts
let cachedTemplate: HandlebarsTemplateDelegate | null = null;
let cachedAssets: {
  tokensCss: string;
  componentsCss: string;
  quoteCss: string;
  logoFull: string;
  logoMark: string;
} | null = null;

async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (cachedTemplate) return cachedTemplate;
  Handlebars.registerPartial(
    "header",
    await readFile(resolve(tplDir, "partials/_header.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "footer",
    await readFile(resolve(tplDir, "partials/_footer.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "cover",
    await readFile(resolve(tplDir, "partials/_cover.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "signature",
    await readFile(resolve(tplDir, "partials/_signature.html"), "utf8"),
  );
  Handlebars.registerPartial(
    "amends",
    await readFile(resolve(tplDir, "partials/_amends.html"), "utf8"),
  );
  const html = await readFile(resolve(tplDir, "pac-quote.html"), "utf8");
  cachedTemplate = Handlebars.compile(html, { noEscape: false });
  return cachedTemplate;
}

async function getAssets() {
  if (cachedAssets) return cachedAssets;
  const [tokensCss, componentsCss, quoteCss, logoFullBuf, logoMarkBuf] =
    await Promise.all([
      readFile(resolve(tplDir, "tokens.css"), "utf8"),
      readFile(resolve(tplDir, "components.css"), "utf8"),
      readFile(resolve(tplDir, "pac-quote.css"), "utf8"),
      readFile(resolve(tplDir, "PacTechnologies.jpg")),
      readFile(
        resolve(
          tplDir,
          "PacTechnologiesEdit_Blue_NoText._Transparent.png",
        ),
      ),
    ]);
  cachedAssets = {
    tokensCss,
    componentsCss,
    quoteCss,
    logoFull: `data:image/jpeg;base64,${logoFullBuf.toString("base64")}`,
    logoMark: `data:image/png;base64,${logoMarkBuf.toString("base64")}`,
  };
  return cachedAssets;
}

export async function renderSnapshotToHtml(snapshot: unknown): Promise<string> {
  const template = await getTemplate();
  const assets = await getAssets();
  return template({
    snapshot,
    _tokensCss: assets.tokensCss,
    _componentsCss: assets.componentsCss,
    _quoteCss: assets.quoteCss,
    _logoFull: assets.logoFull,
    _logoMark: assets.logoMark,
  });
}
```

Note: `_cover.html` doesn't exist yet — the test suite will fail until Task 2 creates it. That's expected at this step.

- [ ] **Step 4: Run typecheck**

```bash
cd services/pdf-renderer && npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/pdf-renderer/src/templates/PacTechnologies.jpg \
        "services/pdf-renderer/src/templates/PacTechnologiesEdit_Blue_NoText._Transparent.png" \
        services/pdf-renderer/src/render.ts
git commit -m "feat(pdf): add logo assets and wire base64 URIs into template context"
```

---

## Task 2: Cover page partial and page break

**Goal:** Create `_cover.html` partial, restructure `pac-quote.html` to use it, and add cover-page CSS.

**Files:**
- Create: `services/pdf-renderer/src/templates/partials/_cover.html`
- Modify: `services/pdf-renderer/src/templates/pac-quote.html`
- Modify: `services/pdf-renderer/src/templates/pac-quote.css`

**Acceptance Criteria:**
- [ ] Cover renders as a visually distinct first page
- [ ] Project name is displayed at ~36px bold
- [ ] Globe watermark appears bottom-right, bleeding off page edges at ~7% opacity
- [ ] `page-break-after: always` on `.cover-page` — content sections start on page 2
- [ ] Variation documents show `Variation V1` kicker and "Variation V1 to {project_number}" subtitle
- [ ] `npm test` passes — including the variation amends test which checks for "Variation V1 to CVL-2129"

**Verify:** `cd services/pdf-renderer && npm test` → all tests pass

**Steps:**

- [ ] **Step 1: Create `_cover.html`**

Write the file `services/pdf-renderer/src/templates/partials/_cover.html` with the following content:

```html
<section class="cover-page">
  <div class="cover-watermark">
    <img src="{{{@root._logoMark}}}" alt="" role="presentation">
  </div>
  <div class="cover-body">
    <div class="cover-rule"></div>
    {{#if (eq snapshot.kind "variation")}}
      <div class="tag">Variation V{{snapshot.rev_number}}</div>
      <h1 class="cover-title">{{snapshot.project.project_name}}</h1>
      <div class="cover-subtitle">Variation V{{snapshot.rev_number}} to {{snapshot.project.project_number}}</div>
    {{else}}
      <div class="tag">Quotation</div>
      <h1 class="cover-title">{{snapshot.project.project_name}}</h1>
    {{/if}}
  </div>
  <div class="cover-meta">
    <div class="cover-divider"></div>
    <div class="cover-grid">
      <div class="cover-key">Client</div>
      <div class="cover-val">{{snapshot.project.customer.name}}</div>
      <div class="cover-key">Project No.</div>
      <div class="cover-val">{{snapshot.project.project_number}}</div>
      <div class="cover-key">Quote No.</div>
      <div class="cover-val">{{snapshot.quote_number}} · Rev {{snapshot.rev_number}}</div>
      <div class="cover-key">Date</div>
      <div class="cover-val">{{displayDate snapshot.issued_at}}</div>
      {{#if (eq snapshot.kind "variation")}}
        {{#if snapshot.parent_quote_ref}}
          <div class="cover-key">Parent Quote</div>
          <div class="cover-val">{{snapshot.parent_quote_ref}}</div>
        {{/if}}
      {{/if}}
    </div>
  </div>
</section>
```

`{{{@root._logoMark}}}` triple-stash accesses the root template context variable without HTML-escaping (required for data: URIs).

- [ ] **Step 2: Restructure `pac-quote.html`**

Replace the entire `<section class="cover-block">...</section>` block in `pac-quote.html` with `{{> cover}}`. The new file should look like:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{snapshot.quote_number}} Rev {{snapshot.rev_number}} — {{snapshot.project.customer.name}}</title>
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
    <style>
      {{{_tokensCss}}}
      {{{_componentsCss}}}
      {{{_quoteCss}}}
    </style>
  </head>
  <body>
    {{> header}}
    {{> cover}}

    {{#if snapshot.summary}}
      <section class="section">
        <h2 class="section-title">Executive Summary</h2>
        <div>{{markdown snapshot.summary}}</div>
      </section>
    {{/if}}

    {{#if snapshot.scope.length}}
      <section class="section">
        <h2 class="section-title">Scope of Work</h2>
        {{#each snapshot.scope}}
          {{#with (citationFor "scope" this.id) as |c|}}
            {{#if c}}{{> amends c}}{{/if}}
          {{/with}}
          <div class="scope-item">
            <div class="scope-title">{{this.title}}</div>
            {{#if this.body}}<div class="scope-body">{{markdown this.body}}</div>{{/if}}
          </div>
        {{/each}}
      </section>
    {{/if}}

    {{#if snapshot.inclusions.length}}
      <section class="section">
        <h2 class="section-title">Inclusions</h2>
        <ul class="list-tight">
          {{#each snapshot.inclusions}}
            {{#with (citationFor "inclusion" this.id) as |c|}}
              {{#if c}}{{> amends c}}{{/if}}
            {{/with}}
            <li>
              <strong>{{this.title}}</strong>
              {{#if this.body}}<div class="scope-body">{{markdown this.body}}</div>{{/if}}
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}

    {{#if snapshot.exclusions.length}}
      <section class="section">
        <h2 class="section-title">Exclusions</h2>
        <ul class="list-tight">
          {{#each snapshot.exclusions}}
            {{#with (citationFor "exclusion" this.id) as |c|}}
              {{#if c}}{{> amends c}}{{/if}}
            {{/with}}
            <li>
              <strong>{{this.title}}</strong>
              {{#if this.body}}<div class="scope-body">{{markdown this.body}}</div>{{/if}}
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}

    {{#if snapshot.assumptions.length}}
      <section class="section">
        <h2 class="section-title">Assumptions</h2>
        <ul class="list-tight">
          {{#each snapshot.assumptions}}
            {{#with (citationFor "assumption" this.id) as |c|}}
              {{#if c}}{{> amends c}}{{/if}}
            {{/with}}
            <li>
              {{#if this.title}}<strong>{{this.title}}</strong>{{/if}}
              {{#if this.value}} — {{this.value}}{{/if}}
              {{#if this.notes}}<div class="scope-body">{{markdown this.notes}}</div>{{/if}}
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}

    <section class="section">
      <h2 class="section-title">Pricing</h2>
      {{#if (eq snapshot.pricing_presentation.show_pricing_breakdown_detail "subtotal_only")}}
        {{#if snapshot.totals.by_category_customer_visible.length}}
          <table class="line-items">
            <thead>
              <tr>
                <th>Category</th>
                <th class="right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {{#each snapshot.totals.by_category_customer_visible}}
                <tr>
                  <td>{{this.category}}</td>
                  <td class="right money">{{money this.subtotal}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{/if}}
      {{else}}
        {{#if snapshot.line_items.length}}
          <table class="line-items">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th class="right">Qty</th>
                {{#if (eq snapshot.pricing_presentation.show_pricing_breakdown_detail "full")}}
                  <th class="right">Unit</th>
                  <th class="right">Hours</th>
                  <th class="right">Rate</th>
                {{/if}}
                <th class="right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {{#each snapshot.line_items}}
                {{#if this.show_in_customer_doc}}
                  {{#with (citationFor "line_item" this.id) as |c|}}
                    {{#if c}}
                      <tr class="amends-row">
                        <td colspan="99">{{> amends c}}</td>
                      </tr>
                    {{/if}}
                  {{/with}}
                  <tr>
                    <td>{{this.category}}</td>
                    <td>
                      {{#if this.customer_doc_label}}{{this.customer_doc_label}}{{else}}{{this.description}}{{/if}}
                    </td>
                    <td class="right">{{#if this.qty}}{{this.qty}}{{/if}}</td>
                    {{#if (eq @root.snapshot.pricing_presentation.show_pricing_breakdown_detail "full")}}
                      <td class="right money">{{money this.unit_price}}</td>
                      <td class="right">{{#if this.hours}}{{this.hours}}{{/if}}</td>
                      <td class="right money">{{money this.hour_rate}}</td>
                    {{/if}}
                    <td class="right money">{{money this.subtotal}}</td>
                  </tr>
                {{/if}}
              {{/each}}
            </tbody>
          </table>
        {{/if}}
      {{/if}}
      <div class="grand-total">
        <span class="label">Grand Total (excl. GST)</span>
        <span class="money">{{money snapshot.totals.grand_total}}</span>
      </div>
    </section>

    {{#if snapshot.commercial_terms}}
      <section class="section">
        <h2 class="section-title">Commercial Terms</h2>
        <div class="commercial-grid">
          {{#if snapshot.commercial_terms.payment_schedule}}
            <div class="label">Payment Schedule</div>
            <div class="value">{{markdown snapshot.commercial_terms.payment_schedule}}</div>
          {{/if}}
          {{#if snapshot.commercial_terms.validity_period}}
            <div class="label">Validity Period</div>
            <div class="value">{{snapshot.commercial_terms.validity_period}}</div>
          {{/if}}
          {{#if snapshot.commercial_terms.gst_treatment}}
            <div class="label">GST Treatment</div>
            <div class="value">{{snapshot.commercial_terms.gst_treatment}}</div>
          {{/if}}
          {{#if snapshot.commercial_terms.currency}}
            <div class="label">Currency</div>
            <div class="value">{{snapshot.commercial_terms.currency}}</div>
          {{/if}}
          {{#if snapshot.commercial_terms.notes}}
            <div class="label">Notes</div>
            <div class="value">{{markdown snapshot.commercial_terms.notes}}</div>
          {{/if}}
        </div>
      </section>
    {{/if}}

    {{#if snapshot.tnc}}
      <section class="section">
        <h2 class="section-title">Terms &amp; Conditions</h2>
        {{#if (eq snapshot.tnc.kind "structured")}}
          {{#each snapshot.tnc.clauses}}
            <div class="tnc-clause">
              <div class="clause-head">
                <span class="clause-number">{{this.clause_number}}</span>{{this.title}}
              </div>
              <div class="clause-body">{{markdown this.body_markdown}}</div>
            </div>
          {{/each}}
        {{else}}
          <div class="tnc-override">{{markdown snapshot.tnc.body_markdown}}</div>
        {{/if}}
      </section>
    {{/if}}

    {{> signature}}

    {{> footer}}
  </body>
</html>
```

- [ ] **Step 3: Add cover CSS to `pac-quote.css`**

Add the following block at the top of `pac-quote.css` (before the existing `@page` rule):

```css
/* ── Cover page ─────────────────────────────────────────────── */

.cover-page {
  min-height: 228mm;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  page-break-after: always;
  padding-bottom: 16mm;
}

.cover-watermark {
  position: absolute;
  right: -60px;
  bottom: -50px;
  width: 380px;
  pointer-events: none;
}

.cover-watermark img {
  width: 100%;
  opacity: 0.07;
  display: block;
}

.cover-body {
  position: relative;
  z-index: 1;
}

.cover-rule {
  width: 100%;
  height: 2px;
  background: var(--pac-blue-600);
  margin: 14px 0 12px;
}

.cover-title {
  font-size: 36px;
  font-weight: 800;
  color: var(--pac-ink-900);
  line-height: 1.1;
  letter-spacing: -0.025em;
  margin: 6px 0 0;
}

.cover-subtitle {
  font-size: 13px;
  color: var(--pac-ink-600);
  margin-top: 6px;
  font-weight: 400;
}

.cover-meta {
  position: relative;
  z-index: 1;
}

.cover-divider {
  height: 1px;
  background: var(--pac-line-200);
  margin-bottom: 10px;
}

.cover-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 0;
}

.cover-key {
  font-size: 10px;
  color: var(--pac-ink-500);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-top: 1px;
}

.cover-val {
  font-size: 11px;
  color: var(--pac-ink-900);
  font-weight: 500;
}
```

- [ ] **Step 4: Run tests**

```bash
cd services/pdf-renderer && npm test
```

Expected: all tests pass. The variation test checks for `"Variation V1 to CVL-2129"` which is now produced by the cover subtitle. Confirm `"Variation V1 to CVL-2129"` appears in the passing test output.

- [ ] **Step 5: Commit**

```bash
git add services/pdf-renderer/src/templates/partials/_cover.html \
        services/pdf-renderer/src/templates/pac-quote.html \
        services/pdf-renderer/src/templates/pac-quote.css
git commit -m "feat(pdf): add cover page partial with watermark and page break"
```

---

## Task 3: Restyle header and footer partials

**Goal:** Header shows the full Pac Technologies logo image; footer and header CSS updated to match the design spec.

**Files:**
- Modify: `services/pdf-renderer/src/templates/partials/_header.html`
- Modify: `services/pdf-renderer/src/templates/partials/_footer.html`
- Modify: `services/pdf-renderer/src/templates/components.css`

**Acceptance Criteria:**
- [ ] Header renders `PacTechnologies.jpg` at 32px height on the left
- [ ] Header right column shows quote number, customer name, issue date in JetBrains Mono
- [ ] 2px Pac Blue rule appears below the header on every page
- [ ] Footer shows quote ref left + date right in 9px mono muted grey
- [ ] `npm test` still passes — `expect(html).toContain("Pac Technologies")` still satisfied via footer text

**Verify:** `cd services/pdf-renderer && npm test` → all tests pass

**Steps:**

- [ ] **Step 1: Update `_header.html`**

Replace the entire file with:

```html
<header class="doc-header">
  <div class="brand">
    <img src="{{{@root._logoFull}}}" alt="Pac Technologies" class="brand-logo">
  </div>
  <div class="doc-meta">
    <div class="mono">{{snapshot.quote_number}} · Rev {{snapshot.rev_number}}</div>
    <div>{{snapshot.project.customer.name}}</div>
    <div>{{displayDate snapshot.issued_at}}</div>
  </div>
</header>
```

- [ ] **Step 2: Update `_footer.html`**

The current footer content is already correct. Confirm it reads:

```html
<footer class="doc-footer">
  <span>Pac Technologies · {{snapshot.quote_number}} Rev {{snapshot.rev_number}}</span>
  <span>{{displayDate snapshot.issued_at}}</span>
</footer>
```

No change needed unless it differs.

- [ ] **Step 3: Update `components.css` — header brand logo**

In `components.css`, replace the `.doc-header .brand` and `.doc-header .brand-name` / `.brand-mark` rules with:

```css
.doc-header .brand {
  display: flex;
  align-items: center;
}

.brand-logo {
  height: 32px;
  display: block;
}
```

Leave all other `.doc-header` rules (`.doc-meta`, `.mono`, etc.) unchanged.

- [ ] **Step 4: Run tests**

```bash
cd services/pdf-renderer && npm test
```

Expected: all pass. The test `expect(html).toContain("Pac Technologies")` is satisfied by the footer `<span>Pac Technologies · ...</span>`, not the header img alt text — both are fine.

- [ ] **Step 5: Commit**

```bash
git add services/pdf-renderer/src/templates/partials/_header.html \
        services/pdf-renderer/src/templates/partials/_footer.html \
        services/pdf-renderer/src/templates/components.css
git commit -m "feat(pdf): logo image in header, mono footer restyle"
```

---

## Task 4: Content section CSS restyle

**Goal:** Update `pac-quote.css` and `components.css` with polished section-level styles — Pac Blue scope bullet dots, bolder grand total rule, refined spacing throughout.

**Files:**
- Modify: `services/pdf-renderer/src/templates/pac-quote.css`
- Modify: `services/pdf-renderer/src/templates/components.css`

**Acceptance Criteria:**
- [ ] Scope items have a small Pac Blue `::before` bullet dot aligned to cap-height
- [ ] Pricing table header row has 1px `--pac-blue-600` bottom border
- [ ] Grand total row has 2px `--pac-blue-600` top border with increased padding
- [ ] T&C clause numbers render in `--pac-blue-600` mono
- [ ] Signature block has 1px `--pac-ink-400` top rule per column
- [ ] Amends callout: `--pac-blue-100` background, 3px `--pac-blue-600` left border
- [ ] `npm test` passes

**Verify:** `cd services/pdf-renderer && npm test` → all tests pass

**Steps:**

- [ ] **Step 1: Update scope item CSS in `pac-quote.css`**

Replace the existing `.scope-item` block with:

```css
.scope-item {
  padding-left: 14px;
  position: relative;
  margin: 8px 0;
}

.scope-item::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 5px;
  width: 5px;
  height: 5px;
  background: var(--pac-blue-600);
  border-radius: 50%;
}

.scope-item .scope-title {
  font-weight: 600;
  color: var(--pac-ink-900);
}

.scope-item .scope-body {
  margin-top: 2px;
  color: var(--pac-ink-700);
  font-size: 10.5px;
}
```

- [ ] **Step 2: Update grand total CSS in `pac-quote.css`**

Replace the existing `.grand-total` block with:

```css
.grand-total {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 12px;
  gap: 24px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--pac-blue-900);
  font-weight: 600;
  border-top: 2px solid var(--pac-blue-600);
  padding-top: 10px;
}

.grand-total .label {
  color: var(--pac-ink-600);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 10px;
  font-family: var(--font-sans);
  font-weight: 400;
}
```

- [ ] **Step 3: Update pricing table header rule in `pac-quote.css`**

In the existing `table.line-items th` rule, ensure the border-bottom uses Pac Blue:

```css
table.line-items th {
  text-align: left;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 10px;
  color: var(--pac-ink-600);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pac-blue-600);
}
```

- [ ] **Step 4: Update T&C clause CSS in `pac-quote.css`**

Replace the `.tnc-clause` block with:

```css
.tnc-clause {
  margin: 14px 0;
  page-break-inside: avoid;
}

.tnc-clause .clause-head {
  font-weight: 600;
  color: var(--pac-blue-900);
  font-size: 12px;
  margin-bottom: 3px;
}

.tnc-clause .clause-head .clause-number {
  font-family: var(--font-mono);
  color: var(--pac-blue-600);
  margin-right: 6px;
  font-weight: 500;
}

.tnc-clause .clause-body p {
  margin: 3px 0;
  color: var(--pac-ink-800);
  font-size: 10.5px;
  line-height: 1.55;
}
```

- [ ] **Step 5: Update signature CSS in `pac-quote.css`**

Replace the `.signature` block with:

```css
.signature {
  margin-top: 48px;
  page-break-inside: avoid;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.signature .sig-block {
  border-top: 1px solid var(--pac-ink-400);
  padding-top: 8px;
  font-size: 10px;
  color: var(--pac-ink-600);
}

.signature .sig-block .name {
  color: var(--pac-ink-900);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 3px;
}
```

- [ ] **Step 6: Update amends callout CSS in `pac-quote.css`**

Replace the `.amends` block with:

```css
.amends {
  margin: 10px 0;
  padding: 10px 14px;
  background: var(--pac-blue-100);
  border-left: 3px solid var(--pac-blue-600);
  border-radius: 0 4px 4px 0;
  page-break-inside: avoid;
}

.amends-label {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--pac-blue-700);
  margin-bottom: 8px;
  font-weight: 500;
}

.amends-original,
.amends-revised {
  margin: 4px 0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.amends-tag {
  flex: 0 0 64px;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  background: var(--pac-blue-200);
  color: var(--pac-blue-800);
  padding: 2px 6px;
  border-radius: 3px;
  text-align: center;
  letter-spacing: 0.06em;
  margin-top: 2px;
}

.amends-tag-revised {
  background: var(--pac-blue-600);
  color: white;
}

.amends-body {
  flex: 1;
  font-size: 11px;
  color: var(--pac-ink-700);
}

.amends-body p {
  margin: 0 0 4px 0;
}

tr.amends-row > td {
  background: transparent;
  padding: 0;
  border: none;
}
```

- [ ] **Step 7: Run tests**

```bash
cd services/pdf-renderer && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/pdf-renderer/src/templates/pac-quote.css \
        services/pdf-renderer/src/templates/components.css
git commit -m "feat(pdf): restyle content sections — scope bullets, grand total, T&Cs, amends"
```

---

## Self-Review Notes

- **`render.ts` caching**: `cachedTemplate` is module-level, so registering the `cover` partial inside `getTemplate()` is only called once — correct.
- **Base64 image size**: Both logos together are ~1.5MB → ~2MB as base64. This bloats the HTML but Puppeteer handles it fine and it avoids all file:// path issues across platforms.
- **Test for "Variation V1 to CVL-2129"**: This test was previously failing (the old template never produced this string). Task 2's cover subtitle `Variation V{{rev_number}} to {{project.project_number}}` produces exactly `"Variation V1 to CVL-2129"` for the test fixture.
- **`@root._logoFull` in partials**: Handlebars partials inherit the root data frame. `{{{@root._logoFull}}}` correctly accesses the top-level template context variable from within any partial.
- **Task order**: 5 → 2 → 3 → 4. Task 5 must land first (logo files + render.ts). Tasks 3 and 4 are independent of each other.
