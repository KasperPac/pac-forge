# Pac Technologies — Design System

> **Process Automation Control.** Industrial systems integrators delivering control and instrumentation across Australian process industries — water, mining, food & beverage, pharmaceuticals, and energy.

This is the visual and content system for everything Pac Technologies puts in front of customers: the website, capability statements, tender responses, datasheets, P&ID legends, SCADA mockups, sales decks, and project deliverables.

It is engineered, not decorative. Every choice in this system reflects the work — calm, exact, repeatable, calibrated.

---

## How to use this system

When you build something for Pac Technologies, **read this file first**, then load the relevant kit files. Don't invent tokens. Don't pull in another typeface. If a component you need doesn't exist, build it from the primitives below and add it to the kit.

```html
<link rel="stylesheet" href="tokens.css" />        <!-- color, type, spacing, shadows, motion -->
<link rel="stylesheet" href="components.css" />    <!-- buttons, inputs, cards, badges, tables -->
<link rel="icon" href="assets/favicon.png" />
```

For HTML mockups in this project, every file should `<link>` `tokens.css` and `components.css`. The variables and class names below are the contract.

---

## Index

| File | What's in it |
|---|---|
| `README.md` | This file. Brand fundamentals, content rules, visual foundations. |
| `tokens.css` | CSS variables — color, type, spacing, radii, shadows, motion. |
| `components.css` | Component classes built on the tokens. |
| `01-foundations.html` | Color, type, spacing, radii, shadow scales. |
| `02-components.html` | Buttons, forms, cards, badges, tables, navigation. |
| `03-brand.html` | Logo lockups, clear space, do/don't, iconography. |
| `04-website.html` | Marketing site recreation — hero, capabilities, sectors, projects, contact. |
| `assets/` | Logos and the mark in every required form. |

---

## Brand fundamentals

### Who Pac Technologies is

A specialist control and instrumentation engineering firm. We are the people the plant manager calls when an existing system can't be made to do what the process now needs it to do, and when the people who built it have moved on. We integrate PLC, SCADA, HMI, motor control, and field instrumentation into systems that run for twenty years without a thought.

### What we sound like

**Engineers writing for engineers, with hospitality for the people who sign the cheque.** Concrete nouns, active verbs, no marketing inflation. We name the standard, the protocol, the vendor, the unit. We cite the regulator. We don't say "solutions" when we mean "a panel."

A test: if a sentence could appear unchanged on the website of a generic IT consultancy, it does not belong on ours.

| ✓ Sounds like us | ✗ Doesn't |
|---|---|
| "Migrated a Citect SCADA from v7.20 to 2018 with zero unplanned downtime." | "Modernised the client's digital experience." |
| "AS/NZS 3000 compliant, IP66 enclosure, 24 V DC loop-powered." | "Industry-leading robust solution." |
| "Commissioning Tuesday 06:00, isolation 05:30." | "Delivering value at every touchpoint." |
| "Three operators trained on-site, runbook left in the panel." | "Empowering teams with knowledge transfer." |

### What we believe

1. **The plant is the truth.** Drawings, specs, and dashboards exist to serve what the plant actually does. When they disagree, fix the document.
2. **Quiet systems are good systems.** A control system you don't notice is one that's working. Our brand should feel the same way.
3. **A handover is a promise.** What we leave behind — the wiring, the tags, the comments in the code, the printed runbook — is the brand.
4. **Every alarm has a job.** No noise for noise's sake. This applies to interfaces, to copy, and to colour.

### Tone slider

```
formal ◯───●───◯───◯───◯ casual          warm ◯───◯───●───◯───◯ neutral
serious ●───◯───◯───◯───◯ playful        plain ◯───●───◯───◯───◯ technical
```

We sit toward formal, serious, and technically plain — but with measurable warmth in the second person. We say "you" and "we." We never say "leverage."

---

## Content fundamentals

### Naming

- The company is **Pac Technologies**. Never "PAC Technologies", "Pac Tech", "Pac.", or "PT".
- "Process Automation Control" is the tagline expansion of what we do; it is **not** part of the logo lockup. Use it in body copy and headlines, never as a typeset descriptor under the mark.
- Project names are written without quotation marks: "the Werribee SCADA upgrade," not "the 'Werribee' upgrade."

### Capitalisation

Sentence case for headings, buttons, navigation, and form labels. **Title case is reserved for proper nouns and product names** (Citect, Modbus TCP, FactoryTalk, RSLogix). This is the single most common style error; police it.

### Numbers and units

- SI units, always. `24 V DC`, `4–20 mA`, `Ø50 mm`, `25 °C`. Non-breaking space between number and unit.
- En dash for ranges: `4–20 mA`, not `4-20 mA`.
- Australian English: realise, organisation, behaviour, programme (when noun), program (when software).
- Dates are `7 March 2026` in body copy; `2026-03-07` in tables, filenames, and logs.
- Times are 24-hour with a colon: `06:00`, not `6 AM`.
- Tag names and PLC addresses set in `monospace`: `FIT_3201`, `%MD120`.

### Voice patterns we use

- **Lead with the verb the customer cares about.** "Reduce alarm flood by 80 %." Not "Our solution helps to potentially reduce…"
- **Name the unit.** "We've commissioned 47 control panels in the last three years." Specifics earn trust.
- **Caveat once, then commit.** Don't litter copy with "may," "could," "potentially." If we'll do it, say we'll do it.
- **Acronyms expand on first use, then run.** "Programmable Logic Controller (PLC)" → "PLC" thereafter.

### Things we do not say

`solutions`, `cutting-edge`, `world-class`, `best-of-breed`, `synergy`, `journey`, `unlock`, `empower`, `seamless`, `next-generation`, `revolutionary`, `Industry 4.0` (unless quoting a customer), `digital transformation`.

---

## Visual foundations

The full numerical tokens live in `tokens.css`. What follows is the *intent* behind them — the bit a stylesheet can't carry.

### Colour

The brand is anchored on a single industrial blue — **Pac Blue 600 `#3050A0`** — sampled from the mark itself. Everything else is a controlled neighbourhood around it.

| Token | Hex | Use |
|---|---|---|
| `--pac-blue-900` | `#0F1E3D` | Body text on light surfaces, the deepest blue we use |
| `--pac-blue-700` | `#1F3878` | Hover/active for primary action; small headings |
| **`--pac-blue-600`** | **`#3050A0`** | **The brand. Logo, primary buttons, accents, links** |
| `--pac-blue-500` | `#5874BC` | Secondary text on blue surfaces; chart series |
| `--pac-blue-100` | `#E5EBF6` | Tinted surfaces (info banners, table stripes) |
| `--pac-ink-900` | `#0E1116` | Primary text |
| `--pac-ink-700` | `#3A434E` | Secondary text |
| `--pac-ink-500` | `#6B7785` | Tertiary text, captions, helper |
| `--pac-line-300` | `#D9DEE5` | Hairline borders, dividers |
| `--pac-line-200` | `#E8EBF0` | Card borders, input borders |
| `--pac-bg-100` | `#F4F6FA` | Page background |
| `--pac-bg-50`  | `#FAFBFD` | Card background on tinted page |
| `--pac-paper`  | `#FFFFFF` | True white — paper, panels |
| `--pac-signal-green`  | `#1F8A4C` | OK / running |
| `--pac-signal-amber`  | `#C7821B` | Warning / caution |
| `--pac-signal-red`    | `#B83227` | Fault / stopped |

**Rules.** Pac Blue 600 is the only "decorative" colour. The signal triplet is reserved for state — never decoration. Don't tint signal colours; a green that isn't the green stops meaning "running." We do not use gradients on brand surfaces; the mark already has implied motion. For chart palettes, extend the blue ramp, then introduce neutrals (slate, graphite) before reaching for hue.

### Type

A two-family system, both wide-licensed and free for commercial use:

- **Inter** — UI, body, and the wordmark style. Set the wordmark at `font-weight: 600`, `letter-spacing: -0.01em`. The descriptor under the mark is set in `font-feature-settings: "smcp"` (or all-caps with `letter-spacing: 0.18em`).
- **JetBrains Mono** — tags, addresses, code, technical specs, anywhere a value needs to be read precisely.

Type scale (`--type-*` in tokens.css):

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `display` | 56 / 60 | 600 | Hero only |
| `h1` | 40 / 48 | 600 | Page title |
| `h2` | 28 / 36 | 600 | Section header |
| `h3` | 20 / 28 | 600 | Subsection / card title |
| `eyebrow` | 12 / 16 | 600, tracked +0.14em, uppercase | Small labels above headings |
| `body-lg` | 18 / 28 | 400 | Lead paragraphs |
| `body` | 16 / 24 | 400 | Default body |
| `body-sm` | 14 / 20 | 400 | Tables, captions |
| `caption` | 12 / 16 | 500 | Helper, metadata |
| `mono` | 14 / 20 | 500 | Tags, values |

Body copy max width is `64ch`. Run that wider and the eye loses the line.

### Spacing & rhythm

A 4 px grid. Everything snaps. Section vertical rhythm uses `--space-16` (64 px) on desktop, `--space-10` (40 px) on phones.

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128`

### Radius

Restrained. We are not making a consumer app.

- `--radius-sm` `4px` — inputs, badges
- `--radius-md` `8px` — cards, panels
- `--radius-lg` `12px` — feature cards, modals
- Pills and full-rounds are reserved for status chips and avatars.

### Elevation

Three levels, used sparingly. Most panels sit on a hairline border, not a shadow.

- `--shadow-1` — `0 1px 2px rgba(15,30,61,.06), 0 1px 1px rgba(15,30,61,.04)` — resting card
- `--shadow-2` — `0 6px 16px rgba(15,30,61,.08), 0 2px 4px rgba(15,30,61,.04)` — hovered/active card
- `--shadow-3` — `0 18px 40px rgba(15,30,61,.14), 0 4px 8px rgba(15,30,61,.06)` — modal, popover

### Motion

Movement is functional. Easing is `cubic-bezier(.2,.7,.2,1)`. Durations: `120ms` for state changes, `200ms` for entries, `320ms` for layout shifts. We never animate the logo mark.

---

## Iconography

We use **Lucide** (https://lucide.dev). 1.75 px stroke at 20 px, 2 px at 24 px. `currentColor` only — no two-tone icons.

Industrial pictograms (valve, pump, heat-exchanger) are drawn from the **ISA-5.1** symbol set when used in technical diagrams. They are line-only, single-colour, and never mixed with UI icons in the same group.

---

## Logo

The mark is a stylised globe formed from a counter-rotating arc and three orbital bands — control loops, suggested. It sits to the left of the wordmark in the horizontal lockup with no divider; the two are read as one object. The wordmark is set in Inter at `font-weight: 600`, `letter-spacing: -0.015em`.

**Clear space.** A margin equal to the cap-height of the "P" in the wordmark, on every side.
**Minimum size.** 24 px tall for the mark alone, 140 px wide for the horizontal lockup. Below 140 px, drop to the mark only — the wordmark will not hold up.
**Backgrounds.** The blue mark on white or `--pac-bg-50`. The white mark on Pac Blue 700 or photographic backgrounds with sufficient contrast (≥4.5:1 measured at the mark's silhouette). Never on red, amber, or green — those colours mean state.

**Don't.** Recolour the mark. Stretch the lockup. Place the mark inside another shape. Tilt or animate it. Translate the wordmark. Reintroduce the old vertical divider or descriptor — the lockup is the mark plus "Pac Technologies," nothing else.

---

## Accessibility

WCAG 2.2 AA is the floor. Body text contrast ≥ 4.5:1, large text ≥ 3:1, focus rings ≥ 3:1 against both their background and the element they ring. Focus is `2px solid var(--pac-blue-600)` with a `2px` offset — never removed, never replaced with shadow only. Hit targets ≥ 44 × 44 px on touch.

---

## Photography (placeholder rules)

We do not yet have a photography library. When real photography is unavailable, use a **flat slate placeholder** (`--pac-ink-700` 60 % over `--pac-bg-100`) with a 1 px hairline frame and the mark centred at 12 % opacity. Do not generate stock-style imagery. Do not use AI-rendered "industrial" photos.

When a real photograph is used, prefer:

- Operators in real PPE on real plant — not models, not gloved-hands-on-a-tablet stock.
- Wide depth of field. Equipment in focus. No bokeh-heavy "tech" stock.
- Natural daylight or actual plant lighting; no teal-and-orange grade.

---

## Versioning

This system is versioned with the company's project register. Tag every change in `CHANGELOG.md` (when it exists) with the engineer who made it and the project that prompted it. Brand updates do not happen mid-tender.

— Pac Technologies, 2026
