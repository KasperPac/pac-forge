# Pac Quote PDF Template — Visual Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** Visual restyle of `services/pdf-renderer/src/templates/pac-quote.*` — no changes to Handlebars data model, helpers, or rendering pipeline.

---

## 1. Design Principles

- Typography-first. Whitespace and font weight carry the hierarchy — no coloured background panels.
- Pac Blue (#3050A0) used as a precise accent only: rules, kickers, table headers, clause numbers.
- Dense but readable. This is a technical business document, not a marketing brochure.
- Cover page makes an impression; content pages get out of the way.

---

## 2. Assets

Two logo files must be copied into `services/pdf-renderer/src/templates/` (and `dist/templates/`) at build time so Puppeteer can load them from the local file context:

| File | Usage |
|------|-------|
| `public/PacTechnologies.jpg` | Full logo (globe mark + "Pac Technologies" + "PROCESS AUTOMATION CONTROL") — used in page header |
| `public/PacTechnologiesEdit_Blue_NoText._Transparent.png` | Globe mark only, transparent background — used as cover watermark |

---

## 3. Cover Page

The cover is the first page of every issued quote and variation. It is a distinct full-page layout; content sections begin on the next page.

### 3.1 Header strip (shared with all pages)

- **Left**: `PacTechnologies.jpg` as an `<img>` tag, height 32px. White background blends naturally on the white page.
- **Right**: `Q-2026-001 · Rev 1` on top line, customer name below, issue date below that. JetBrains Mono, 10px, `--pac-ink-700`.
- **Below header**: Full-width 2px solid `--pac-blue-600` rule. This rule is present on every page.

### 3.2 Cover body

Sits below the header rule, padded 25mm on all sides (matching page margins).

- **Kicker**: `QUOTATION` or `VARIATION V1` — JetBrains Mono, 10px, uppercase, `--pac-blue-600`, letter-spacing 0.12em.
- **Project name**: Inter 800, ~36px, `--pac-ink-900`, letter-spacing −0.025em, line-height 1.1. This is the visual hero of the cover.
- **Full-width 2px Pac Blue rule** separating project name area from metadata grid below.
- **Metadata grid** (bottom of cover, above footer): 2-column key/value layout.
  - Keys: 10px, `--pac-ink-500`, uppercase, letter-spacing 0.08em.
  - Values: Inter 500, 11px, `--pac-ink-900`.
  - Fields: Client, Project No., Quote No., Date.
  - Variation adds: Parent Quote (e.g. `Q-2026-001 Rev 2`).

### 3.4 Page break

The cover section must have `page-break-after: always` so content sections always begin on a new page in the rendered PDF.

### 3.3 Globe watermark

- Image: `PacTechnologiesEdit_Blue_NoText._Transparent.png`
- Position: `position: absolute`, anchored bottom-right of the cover page container.
- Size: height ~60% of the page content area (~160mm on A4).
- Offset: bleeds off both the right and bottom edges (`right: -60px; bottom: -50px` approximately).
- Opacity: 0.07.
- `pointer-events: none`. Parent container has `overflow: hidden`.
- **Cover page only** — does not appear on content pages.

---

## 4. Content Pages

All pages after the cover (Scope, Pricing, T&Cs, Signature etc.).

### 4.1 Header

Identical to the cover header: full logo left, doc metadata right, 2px Pac Blue rule beneath.

### 4.2 Footer

- Left: `Pac Technologies · Q-2026-001 Rev 1`
- Right: Issue date
- Font: JetBrains Mono, 9px, `--pac-ink-500`
- Top: 1px solid `--pac-line-200` rule

### 4.3 Section titles

```css
.section-title {
  font-family: Inter, sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--pac-blue-900);
  border-bottom: 1px solid var(--pac-line-200);
  padding-bottom: 4px;
  margin-bottom: 10px;
}
```

No coloured backgrounds on section title bars.

---

## 5. Section-Level Styling

### 5.1 Scope items

```
● [Bold title, --pac-ink-900]
  [Optional body paragraph, --pac-ink-700, 11px]
```

Bullet dot: 5px circle, `--pac-blue-600` fill, aligned to cap-height of title.

### 5.2 Inclusions / Exclusions

Tight `<ul>` list. `<strong>` item title, optional body indented below in `--pac-ink-700`.

### 5.3 Assumptions

`<strong>Title</strong> — Value` on one line, optional notes below in `--pac-ink-600`.

### 5.4 Pricing table

- Column headers: 10px, uppercase, letter-spacing 0.04em, `--pac-ink-600`. 1px `--pac-blue-600` rule below header row.
- Data rows: 11px, 1px `--pac-line-200` bottom border.
- Numeric cells: JetBrains Mono, right-aligned, `font-variant-numeric: tabular-nums`.
- **Grand Total row**: separated by a 2px `--pac-blue-600` top border. JetBrains Mono, 13px, `--pac-blue-900`, bold, right-aligned. Label in small uppercase caps left of the figure.

### 5.5 Commercial Terms

2-column CSS grid (160px key column / 1fr value column). Keys: 10px, `--pac-ink-500`, uppercase. Values: 11px, `--pac-ink-900`.

### 5.6 Terms & Conditions clauses

- Clause number: JetBrains Mono, `--pac-blue-600`, `margin-right: 6px`.
- Clause title: inline, Inter 600, `--pac-blue-900`.
- Body: Inter 400, 11px, `--pac-ink-800`, `margin-top: 4px`.
- `page-break-inside: avoid` per clause.

### 5.7 Signature block

Two-column grid. Each column has a 1px `--pac-ink-400` top rule, padding-top 6px.
- Left: "Pac Technologies" (bold, 12px) / "Issued by [email]" / date.
- Right: "[Customer name]" (bold) / "Authorised signature" / "Date".

### 5.8 Variation amends callout

Displayed inline before any amended item:
- Background: `--pac-blue-100`
- Left border: 3px solid `--pac-blue-600`
- `AMENDS` label: JetBrains Mono, 10px, `--pac-blue-700`, uppercase, letter-spacing 0.08em
- `ORIGINAL` tag: small pill, `--pac-blue-200` bg, `--pac-blue-800` text
- `REVISED` tag: small pill, `--pac-blue-600` bg, white text

---

## 6. PDF Technical Details

### Puppeteer options

```ts
{
  format: 'A4',
  margin: { top: '25mm', right: '25mm', bottom: '25mm', left: '25mm' },
  printBackground: true,   // required for watermark opacity to render
}
```

`printBackground: true` is non-negotiable — without it Puppeteer strips background colours and the watermark won't render.

### Fonts

Inter and JetBrains Mono loaded via Google Fonts `<link>` in the template `<head>`. No change from current setup.

### Existing helpers preserved

`money`, `markdown`, `displayDate`, `citationFor`, `eq`, `or` — all unchanged. This spec covers visual CSS/HTML only.

### File structure after restyle

```
services/pdf-renderer/src/templates/
  pac-quote.html          ← restructured for cover page + content pages
  pac-quote.css           ← full visual restyle per this spec
  tokens.css              ← unchanged
  components.css          ← minor updates (section-title rule, amends callout)
  PacTechnologies.jpg     ← copied from public/
  PacTechnologiesEdit_Blue_NoText._Transparent.png  ← copied from public/
  partials/
    _header.html          ← updated to use logo img + metadata
    _footer.html          ← updated mono style
    _cover.html           ← NEW partial for cover page content
    _signature.html       ← updated two-col rule style
    _amends.html          ← updated tag pill style
```

---

## 7. Out of Scope

- No changes to Handlebars data model or snapshot schema
- No changes to Edge Function or rendering pipeline
- No DOCX export
- No light/dark mode — print document is always light
