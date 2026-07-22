# FDS Document Design System

> **Normative reference** for all Pac Technologies FDS document output (PDF export, HTML preview, and — where representable — DOCX). Extracted from the approved template `Templates/Functional Design Specification.html` (bundled, self-contained A4 document). The implementation lives in `services/pdf-renderer` (`pac-fds.html` + `pac-fds.css`).
>
> Tracking: Monday item `3096105139` (board Forja).

## 1. Tokens

### Color

| Token | Hex | Use |
|---|---|---|
| `--fds-ink-strong` | `#0F1E3D` | Headings, TOC entries |
| `--fds-ink` | `#3A434E` | Body text |
| `--fds-ink-muted` | `#6B7785` | Captions, footers, placeholder text, "—" cells |
| `--fds-blue` | `#3050A0` | Brand. Kickers, links, H2 underline, TOC numerals |
| `--fds-blue-deep` | `#1F3878` | Table header text, label cells, link hover |
| `--fds-blue-tint` | `#E5EBF6` | Selected/emphasis fills |
| `--fds-line` | `#E8EBF0` | THE hairline. All table borders, header/footer rules, card borders |
| `--fds-line-soft` | `#D9DEE5` | Dashed placeholder borders, table-head borders |
| `--fds-surface` | `#F4F6FA` | Label cells (left column of key/value cards) |
| `--fds-surface-faint` | `#FAFBFD` | Note/placeholder fills |
| `--fds-crit` | `#B83227` | Critical/fault severity — text or solid chip |
| `--fds-warn` | `#C7821B` | Warning severity |
| `--fds-ok` | `#5FCF8A` | Healthy/pass |

Signal colors mark **state only**, never decoration. (Note: these are the *document* palette — cooler than the app's warm `--pac-ink-*` UI greys. Both share Pac Blue 600.)

### Typography

- **Inter** 400/500/600 — all prose.
- **JetBrains Mono** — everything technical: document numbers, tag names, IP addresses, code cells, TOC numerals, table columns holding identifiers.
- **The kicker** (signature element): JetBrains Mono, 11px, weight 600, `letter-spacing: .14em`, uppercase, Pac Blue. Labels every section (`SECTION 7`), the cover (`FUNCTIONAL DESIGN SPECIFICATION`), and placeholder blocks. Cover variant: 12px / `.16em`.

### Scale

| Element | Spec |
|---|---|
| H1 (cover title) | 40px / 600 / line-height 1.12 / `-0.01em` / max-width 16ch |
| Cover subtitle | 19px / 400 / `#3A434E` / max-width 34ch |
| H2 (section) | 24px / 600 / **2px solid Pac Blue bottom border** / 10px padding-bottom |
| H3 (subsection, `7.1`-numbered) | 16px / 600 / margin `24px 0 10px` |
| Body | 13–13.5px / line-height 1.6 |
| Table body | 12–12.5px; cells `8px 12px` padding |
| Header/footer | 8.5–9px `#6B7785` |

## 2. Components

- **Cover page**: logo (30px) → 64px gap → kicker → H1 → subtitle → flexible gap → document-control card → confidentiality note (11px muted). `break-after: page`.
- **Document-control card**: hairline border, 8px radius, `overflow:hidden`; rows of `#F4F6FA` bold `#1F3878` label cell (38% width) + value cell (mono for codes/platforms).
- **Running header**: logo 16px left · mono `DOC-CODE · Rev X · Commercial in confidence` right · `1px #E8EBF0` bottom rule · white bg.
- **Running footer**: `Pac Technologies Pty Ltd · ABN` left · mono project name centre · `Uncontrolled when printed` right · hairline top rule.
- **Section opener**: kicker (`SECTION n`) directly above the H2. H2 text itself is numbered `n  Title`.
- **TOC**: table, 42px mono Pac Blue bold numeral column + `#0F1E3D` 500 title column, line-height 2.
- **Data tables**: full hairline grid (`1px #E8EBF0`), head row text `#1F3878` 600 (borders may use `#D9DEE5`), mono for tag/code/number columns, `thead{display:table-header-group}` so heads repeat across page breaks, rows `break-inside:avoid` (`.fds-row`).
- **Severity chips**: solid-fill white-text cells — `#B83227` critical, `#C7821B` warning; 6px radius, 11.5px 600. Inline severity text in tables: colored 600 text on white.
- **Placeholder/note blocks** (`.fds-note`): `1px dashed #D9DEE5`, 8px radius, centered, `#FAFBFD` fill, kicker + 13.5px muted explainer. Used for "to be attached" appendix content.
- **End-of-document line**: centered 11px muted — `Pac Technologies Pty Ltd · Process Automation Control · Document X Rev Y · date`.

## 3. Document skeleton (canonical section order)

1. Document control (revision history, distribution) · 2. Introduction & scope · 3. Reference documents & standards · 4. System architecture · 5. Control philosophy & modes · 6. I/O schedule · 7. **Functional descriptions** · 8. Alarms & interlocks · 9. HMI/SCADA screens · 10. Reporting & historian · 11. Security & access · 12. Testing & acceptance · 13. Approval & sign-off · A. Appendices.

Maps to `SpecSectionType` (`spec-contract-v2.ts`): `document_control`, `system_overview` (→2), `interfaces`+network CMs (→3/4), `control_philosophy` (→5), `io_list` (→6), `functional_description` (→7), `alarm_specification` (→8), `hmi_specification` (→9), `testing_fat` (→12). Sections with no contract data render as `.fds-note` placeholders — never omitted silently.

## 4. Print rules

A4. Puppeteer margins ~`22mm top / 18mm bottom / 0 sides` with content padding `22mm` horizontal (cover `34mm` top). Running header/footer via Puppeteer `headerTemplate`/`footerTemplate` (inline styles + data-URI logo only). `printBackground: true`. `break-inside: avoid` on rows/notes/cards; each numbered section starts on a new page (`break-before: page`) except where it naturally continues.
