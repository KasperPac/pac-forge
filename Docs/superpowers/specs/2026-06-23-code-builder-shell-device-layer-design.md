# Code Builder — Shell + Device Layer (Phase 4, sub-project A+B)

**Date:** 2026-06-23
**Status:** Approved design, ready for implementation planning
**Module:** Pac-Forge spec-builder → Phase 4 Code Builder

---

## Context

The spec-builder produces a complete, confirmed ISA-88/PackML **FDS** (Functional Design
Specification) in Phase 3 (the Co-Author). A separate **Phase 4 Code Builder** consumes that
*confirmed* FDS and deterministically compiles it into a Siemens TIA project — reproducing what
the old `/forge` wizard produced (project, IO cards, IO mapping, UDTs/internal variables, device
CM FBs, EM FBs, unit sequencing, global DBs, OB1, export) **without any AI decision-making**,
because every decision already lives in the FDS.

This is a **program of layered sub-projects** (A–F), each its own spec → plan → build cycle:

| # | Sub-project | FDS source | Status |
|---|---|---|---|
| A | Builder shell + reviewable workspace | — | this spec |
| B | Device layer — CM FBs + instance DBs | `control_modules[].io_signals[]` | this spec |
| C | EM layer — state-machine FBs | per-EM states/transitions/sequential_states | later |
| D | Unit/coordination — UC sequencers + OB1 + fault DB | sequential_states, faults, safety_gates | later |
| E | Hardware/IO infra — rack/slot/card layout + addressing | GAP (addresses exist, layout doesn't) | later |
| F | Export/compile — manifest + TIA zip + bridge | artifact DAG | later |

**This spec covers A+B only**: the reviewable Code Builder workspace (A) hosting a functional
Device layer (B). The EM / Unit / Export steps exist in the shell as disabled placeholders so
later sub-projects slot in behind the same stepper.

### What already exists

A deterministic codegen module is already built and tested at `src/lib/spec-builder/codegen/`
(`compile-contract.ts`, `fb-instantiate.ts`, `sa-builder.ts`, `udt-writer.ts`, `db-writer.ts`,
`fc-writer.ts`, `ob1-writer.ts`, `serialize-condition.ts`, `step-order.ts`). `compileContract`
already emits per-CM FBs + instance DBs (matched library FB or stub), per-Unit UDT/DB/FC, and a
single OB1. **This module is canonical** — the old wizard's parallel generators
(`forge-device-matcher`, `forge-prompts` DB writers) are NOT pulled in. Only the wizard's UI
presentation components are reused.

Today the FDS→SCL path is a single "Generate SCL" button on the Co-Author header
(`spec-co-author.tsx` `handleGenerate`) that compiles, zips, downloads, and swallows all errors to
console. It is replaced by the Code Builder route.

---

## Design decisions (locked)

1. **Layout** — top horizontal phase stepper (Device › EM › Unit › Export) + 3-pane workspace
   (control-modules list │ artifact viewer │ approve panel). Wizard-style.
2. **Entry point** — dedicated full-screen route `/specs/:projectId/:specId/code-builder`, reached
   from an "Open Code Builder" button on the Co-Author header. Clean Phase 3 / Phase 4 separation.
3. **Persistence** — generated artifacts + per-artifact approval/edit state persist to Supabase,
   keyed by spec + revision. Survives reload; provides an audit trail.
4. **Editability** — reviewer may hand-edit any artifact's SCL before approving; edits persist as
   overrides (`edited_content`). Stub FBs are the primary edit case.
5. **Reuse strategy** — `src/lib/spec-builder/codegen/` is the canonical engine. Reuse only the
   wizard's UI presentation: `forge-code-viewer` (Monaco SCL wrapper) and `fb-flow-renderer`
   (signal-flow SVG). Do not import the wizard's codegen logic.

---

## Architecture

### 1. Route & shell (sub-project A)

- New route `/specs/:projectId/:specId/code-builder` → `CodeBuilderPage`
  (`src/routes/code-builder.tsx`), registered in `App.tsx` alongside the co-author route.
- **Gate:** renders a locked empty-state unless `spec.confirmation_status === "confirmed"`.
- **Entry:** the Co-Author header's current "Generate SCL" button is replaced by an
  **"Open Code Builder"** link (enabled only when confirmed). The old `handleGenerate` one-shot and
  its swallow-errors path are removed from `spec-co-author.tsx`.
- **Stepper:** `Device › EM › Unit › Export`. Only **Device** is interactive in this slice; the
  others render disabled with a "coming next" affordance. The stepper component lives in
  `src/components/code-builder/builder-stepper.tsx`.

### 2. Codegen engine change (sub-project B)

`CodegenArtifact` gains provenance so the shell can filter by layer:

```ts
export interface CodegenArtifact {
  name: string;
  type: CodegenArtifactType;
  filename: string;
  content: string;
  dependencies: string[];
  folder: string;
  layer: "device" | "em" | "unit" | "ob1";  // NEW
  ownerId?: string;                          // NEW — CM/EM id that produced it
  ownerName?: string;                        // NEW — for grouping/display
}
```

- `compileContract` stays a single pass; each artifact is tagged at emit time. The Device step
  filters `layer === "device"` — the CM-level FBs + their instance DBs from
  `instantiateControlModule`.
- EM-level FBs/instance DBs (`instantiateEquipmentModule`) are tagged `layer === "em"`,
  Unit UDT/DB/FC `layer === "unit"`, and the single OB1 `layer === "ob1"`. These are emitted but
  **not surfaced** in this slice — they belong to sub-projects C/D and appear behind the disabled
  stepper steps.
- All existing codegen tests update to assert the new fields.

**Deferred (out of scope for this slice):** global Inputs/Outputs image DBs. The module wires
`io_address` directly; global IO DBs are an Export/hardware (sub-project E/F) concern and are NOT
generated here.

### 3. Persistence (sub-project A)

New Supabase table `code_builder_artifacts`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `spec_id` | uuid | FK to spec project |
| `revision` | int | spec revision at generation time |
| `artifact_name` | text | unique key within (spec_id, revision) |
| `layer` | text | `device` \| `em` \| `unit` \| `ob1` |
| `owner_id` | text null | CM/EM id |
| `type` | text | UDT/FB/FC/DB/OB |
| `filename` | text | |
| `folder` | text | |
| `dependencies` | jsonb | string[] |
| `generated_content` | text | last deterministic compile output |
| `edited_content` | text null | reviewer override |
| `status` | text | `pending` \| `approved` |
| `approved_by` | uuid null | |
| `approved_at` | timestamptz null | |
| `updated_at` | timestamptz | |

Unique constraint `(spec_id, revision, artifact_name)`. RLS consistent with existing spec tables.

**On open** the Code Builder compiles from the FDS and upserts `generated_content` for the current
revision. **Drift rule:** if an artifact already carries an edit/approval and the freshly
regenerated `generated_content` differs, keep `edited_content` + `status` but surface a
**"FDS changed since review"** drift badge so the reviewer re-checks — work is never silently lost.

Hook `src/hooks/use-code-builder.ts` (TanStack Query): loads artifacts for `(spec_id, revision)`,
runs the compile+upsert, and exposes `approve` / `saveEdit` mutations with
`invalidateQueries`.

### 4. UI — 3-pane Device workspace (sub-project A + B)

`src/components/code-builder/`:

- **Left** `control-module-list.tsx` — control modules grouped Unit → EM, each with a status pill:
  `matched FB` / `stub` / `pending` / `approved` (+ `drift` badge when flagged).
- **Middle** `artifact-viewer.tsx` — tabs **Code / Flow / UDT / Inst DB**.
  - Code: Monaco SCL via reused `forge-code-viewer`; writable when the artifact is in Edit mode.
  - Flow: reused `fb-flow-renderer` signal-flow SVG derived from the FB's IO.
  - UDT / Inst DB: render the related artifact content.
- **Right** `artifact-panel.tsx` — name, type, folder, dependencies, **Approve** / **Edit**.
  Edit makes the Code tab writable; Save persists `edited_content`; Approve sets `status=approved`.

### 5. Edge cases

- **Stub FB** (no library match) — flagged with a `stub` pill, the primary manual-edit case.
- **Not confirmed / empty FDS** — route renders a locked state with a link back to the Co-Author.
- **Export gating** — nothing exports until approved; Export step is a placeholder in this slice, so
  enforcement lands with sub-project F.

---

## Testing

- **Vitest (engine):** provenance tagging on every emitted artifact; `layer === "device"` filtering
  returns exactly the CM FBs + instance DBs; existing codegen tests updated for new fields.
- **Vitest (hook):** drift reconciliation — regenerated content differing from an approved/edited
  artifact preserves the override + sets the drift flag.
- **Component smoke:** `CodeBuilderPage` renders the stepper + 3 panes for a confirmed spec and the
  locked state for an unconfirmed one.

All changes must remain **generic across machine types** (CLAUDE.md non-negotiable): no
project-specific device names, sequences, or logic.

---

## Out of scope (later sub-projects)

- EM state-machine FBs (C), Unit/coordination sequencers + fault DB (D).
- Hardware/IO infrastructure: rack/slot/card layout, tag tables, global IO image DBs (E).
- Export/compile: manifest, TIA zip, bridge import, approval-gated export enforcement (F).
- HMI structure, type-conversion FCs, config-parameter→logic linkage.
