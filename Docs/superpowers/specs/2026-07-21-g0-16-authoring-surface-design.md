# G0-16 — Authoring Surface + Rendering for the G0 Models — Design

> **Task:** G0-16 (roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`, Monday subitem 3097230769)
> **Date:** 2026-07-21 · **Status:** DESIGN (authored by Claude, pending Kasper review — implementation may start on Wave 1 slices)
> **Depends on:** G0-1…G0-15 (all schema shipped), G1–G5 writers (shipped 2026-07-20/21 — they are the consumers)
> **Survey evidence:** authoring-surface map, 2026-07-21 session (spec-editor/machine-hierarchy/co-author/docx/migrations)

## Problem

The contract holds every G0 model (drives, IO polarity/conditioning, signal routing,
axes, maintenance, engineering data, authorization, appliances, safety inventory,
recipes, upstream comms) and the G1–G5 deterministic writers consume them — but
**nothing authors or renders them**:

- No structured-editor forms. The editor surfaces are two switch-on-key registries:
  `spec-editor.tsx` (prose section blobs → `spec_sections`) and
  `machine-hierarchy-table.tsx` (units/EMs/CMs/IO → `confirmed_units`). The IO row
  edits only tag/type/address/description — no polarity, conditioning, or drive
  fields. No panel exists for `unit_coordination` at all.
- The co-author (Stage A/B prompts) never enumerates the G0 models, so the AI
  cannot propose them, even though `use-fds-conversation.ts` already validates
  arbitrary patch keys via `SpecContractPatchSchema`.
- The random FDS builder (`random/assemble.ts`) seeds none of them — so no test
  project exercises the G1–G5 writers end-to-end from authored data.
- The DOCX exporter renders none of them (grep = zero hits), including the
  G0-8-mandated *derived* FB-behavior appendix.
- The 7 authored migrations (20260720000000…06, one JSONB column each on
  `spec_projects`) may not be applied remotely — the remote DB has known history
  drift (091 rename unapplied). **All writes currently rely on those columns.**

## Non-goals

- New schema. G0-16 is purely authoring/rendering over shipped models.
- AI-first authoring. Per the deterministic-first rule, forms are the source of
  truth; co-author proposals land as patches the user confirms in the forms.
- Editing derived material (IO list, faults, FB-behavior appendix stay derived).

## Decision 1 — One "Controls Data" surface, patching through `writeSpecContract`

A new top-level pane in the Spec Builder workspace ("Controls Data") hosting one
sub-panel per model family. All writes go through
`writeSpecContract(specProjectId, patch)` (`lib/spec-builder/contract.ts:998`) —
NOT the granular editor hooks — so every edit passes the Zod gate +
`validateSpecContractPatch` cross-checks (mode co-send, named-gate existence,
axis-constant keys, ladder cross-check, …). This is the first UI consumer of the
typed writer; the random builder already proves the path.

Exception: models that ride existing columns keep their existing persistence —
polarity/conditioning (on `IoSignalV2` inside `confirmed_units`) and the drive
model (tier-1 on the CM) are edited inline in `machine-hierarchy-table.tsx` and
persist via the table's `confirmed_units` update path, because splitting one
hierarchy across two writers would race.

Panel inventory (sub-panels, in codegen-value order):

| Panel | Contract key(s) | Consumed by | Wave |
|---|---|---|---|
| Hierarchy inline: IO polarity + conditioning | `IoSignalV2` in units | G1-4/G1-4b MAP writer | W1 |
| Hierarchy inline: CM drive model | `DriveModelV1` on CM | G1-1/2/3 | W1 |
| Unit Coordination (states, transitions, overrides, signal routing, two-detent, axes) | `unit_coordination` | G2 (entire) | W1 |
| Maintenance (overridable outputs) | `maintenance` | G3 | W1 |
| Engineering Data (drives t2, axis constants, encoder presets, fb assignments, commissioning pack, conditioning defaults, upstream endpoints) | `engineering` | G1/G2-5/G3-3, DOCX | W1 |
| Authorization (ladder + item access) | `authorization` | G7/G8 HMI, PLC limits | W2 |
| Appliances | `appliances` | G1 generalized, G6 | W2 |
| Safety Inventory / Recipes / Upstream Comms | respective keys | DOCX / future writers | W2 |

Form conventions: shadcn primitives per `UI_STYLE_GUIDE.md`; JetBrains Mono for
tags/addresses; dense 4px grid; validation errors surfaced verbatim from
`ContractValidationError.issues`; every panel works generically for any machine
(no HRE assumptions — HRE values only ever appear as user-entered data).

## Decision 2 — Co-author enumeration (Stage B prompt additions)

`fds-prompts.ts` gains a "controls-data models" section enumerating the tier-1
models the AI may propose (`unit_coordination`, drive model, polarity), with the
patch-key contract and the rule "propose sparingly; the engineer confirms in the
Controls Data panels". Tier-2 `engineering` stays human-only (commissioned
constants are measured, not inferred). Stage A untouched.

## Decision 3 — Random FDS seeding

`random/assemble.ts` seeds a plausible controls-data set: one VSD CM with drive
model + engineering entry, N/C polarity on safety-ish inputs, one
`unit_coordination` per unit (canonical states, safety-healthy, command routing,
one linear axis with preset + channels), maintenance outputs. Keeps every G1–G5
writer exercised by generated fixtures (V2-only per project rule).

## Decision 4 — DOCX sections (parity for the signable spec)

New `buildX()` blocks appended in `docx-exporter.ts` around the existing Sec 8 /
Appendix Z insertion point (`:1144-1176`):

- Sec "Drive & Device Integration" — drive models joined with tier-2 engineering.
- Sec "IO Signal Treatment" — polarity/conditioning/scaling table (from units).
- Sec "Unit Coordination" — states/transitions/routing/two-detent/axes per unit.
- Sec "Maintenance & Commissioning" — overridable outputs, presets, pack.
- Sec "Authorization" — ladder + per-item access.
- Appendix: **derived** FB-behavior appendix from `fb_assignments` + templates
  (G0-8 rule: derived at export time, never stored).

## Decision 5 — DB reconciliation (USER-GATED)

Steps, in order, each verified before the next:
1. `npx supabase migration list` — compare local vs remote history.
2. Manually verify column presence for the 7 JSONB columns + `unit_coordination`
   (SQL editor / information_schema via read-only query).
3. Repair history only for rows verifiably applied out-of-band; then push the
   missing 7 migrations.
**No push happens without explicit user approval** — remote is known-drifted
(091 rename unapplied) and `db push` may fail or mis-apply. Until then the app
must degrade gracefully: `loadSpecContract`/`writeSpecContract` already treat the
keys as optional, but a missing column will 500 on write — the panels should
surface that as "column not migrated" guidance, not a crash.

## Wave plan

- **W1 (P0, the codegen feed):** hierarchy inline fields (polarity/conditioning/
  drive) → unit-coordination panel → maintenance + engineering panels. Each panel
  its own TDD slice; `writeSpecContract` wiring tested against the patch gate.
- **W2 (P1):** authorization/appliances/safety/recipes/upstream panels + Stage B
  co-author enumeration.
- **W3 (P1):** random-FDS seeding (unlocks end-to-end pipeline fixtures).
- **W4 (P1):** DOCX sections + derived FB appendix.
- **W5 (gated):** migration reconciliation with Kasper.

## Genericity check

Panels are schema-driven forms over generic models; no device names, sequences,
or fault conditions are embedded. Random seeding uses parameterized generic
values. DOCX renders whatever the contract holds.
