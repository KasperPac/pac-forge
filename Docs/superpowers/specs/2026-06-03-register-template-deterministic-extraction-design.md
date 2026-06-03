# Register Template + Deterministic Hierarchy Extraction — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending spec review → implementation plan
**Author:** Kasper Simonsen (with Claude)
**Builds on:** `2026-06-03-machine-hierarchy-design.md` (ISA-88 + PackML hierarchy model)

---

## 1. Context & Problem

The machine hierarchy (System → Subsystem → Assembly → Device) is now defined by ISA-88
(see the prior design). Phase 1 made the **register-driven** builder default to one
subsystem and treat a single grouping column as the assembly level, with tag-prefix
heuristics deriving devices.

Those heuristics are imperfect (e.g. `_ENABLE`/`_THERM` mis-splits) and still lean on
guessing. In **normal production the engineer authors the instrument register**, and the
hierarchy should be **extracted deterministically — no AI, no guessing**.

**Decision:** provide a **downloadable register template** with explicit columns for each
hierarchy level. When the engineer fills it in, the tool groups
`subsystem → assembly → device → signals` with zero heuristics and zero AI for structure.
Legacy registers (without the new columns) keep working via the existing fallbacks.

This **replaces the earlier "Phase 2" idea** (AI reads the spec document to infer
subsystems). The structured register the engineer authors is the deterministic extraction
source; the functional spec document becomes reference, not the structural input.

---

## 2. The Template

A downloadable **Excel (`.xlsx`)** workbook with two sheets:

- **Instructions** — a legend explaining each column, the allowed values
  (`signal_type` ∈ DI/DO/AI/AO; `is_safety` ∈ TRUE/FALSE), the hierarchy meaning
  (one subsystem unless independent sequences), and a note that `device`/`assembly`
  group the tree deterministically.
- **Register** — the data sheet: a header row, the columns below, and 2–3 worked example
  rows the engineer deletes.

| Column | Required | Purpose |
|---|---|---|
| `tag` | ✅ | Signal tag |
| `description` | ✅ | Human description |
| `io_address` | – | `%I0.0` etc. (blank for network/derived) |
| `signal_type` | ✅ | DI / DO / AI / AO |
| `device` | ✅ | Groups signals onto one device (`M1`, `VSD1`) |
| `assembly` | ✅ | Equipment module (`Carriage`, `Conveyor CV01`) |
| `subsystem` | – | Blank → single subsystem (the machine). Filled only for genuinely independent-sequence units |
| `device_type` | – | For FB selection / device_class enrichment (Motor, Sensor, VSD…) |
| `is_safety` | – | TRUE/FALSE |

**Generation:** built with the project's existing `xlsx` (SheetJS community) lib via
`XLSX.utils.aoa_to_sheet` + `book_append_sheet` + `XLSX.write`, downloaded client-side.

**Risk — dropdowns:** SheetJS *community* edition does not write data-validation
dropdowns. So `signal_type`/`is_safety` allowed values are **documented on the
Instructions sheet** rather than enforced as Excel dropdowns. (Dropdowns are a nice-to-have,
not a requirement.)

---

## 3. Deterministic Extraction

When the explicit columns are present, parsing is pure grouping — no prefix heuristics,
no AI for structure:

```
group by subsystem (blank → single "System" / spec title)
  └ group by assembly (blank cell → "Unassigned")
      └ group by device (blank cell → tag-prefix fallback)
          └ signals = the tag rows
```

**Fallback rules (precise — these avoid regressing the Phase 1 over-elevation fix):**
- **Subsystem level:** read the `subsystem` column **only when an explicit `assembly` column also exists**. Otherwise default to a **single** subsystem (named from the spec title). This is the key rule: a register with a *lone* grouping column must NOT treat that column as subsystems.
- **Assembly level:** use the `assembly` column if present; else use a lone grouping column (`subsystem`/`area`/`unit`/`group`) as the assembly (Phase 1 semantics); else `"Unassigned"`.
- **Device level:** use the `device` column if present (blank cell → tag-prefix fallback); else derive from tag prefixes (current behavior).

In short: an explicit `assembly` column "unlocks" the subsystem column; without it, the single grouping column stays at the assembly level under one subsystem (preserving Phase 1).

**AI:** the Haiku **device_class classification** pass is **retained** (it enriches/verifies
`device_class`), but it has **no role in hierarchy structure**. Structure is 100%
deterministic. (Explicitly: keeping AI classification was a deliberate choice; the
"no AI" requirement applies to hierarchy extraction only.)

---

## 4. Changes

### 4.1 New — template generator + download

- `src/lib/spec-builder/register-template.ts` — `buildRegisterTemplateWorkbook(): Blob`
  (or returns a workbook) producing the two-sheet `.xlsx`. One responsibility: template.
- A **"Download template"** button on the register-upload card (Phase 1 area of the
  spec-builder UI) that triggers the client-side download (via `file-saver`, already a dep).

### 4.2 Parser — explicit columns

- `src/types/spec-builder.ts`:
  - `ColumnMapping` gains `assembly` and `device` fields (alongside existing `subsystem`).
  - `CANONICAL_COLUMN_NAMES`: split the grouping aliases into three distinct fields —
    `subsystem` (subsystem/sub system/area/unit), `assembly` (assembly/equipment/equipment module/group), `device` (device/device id/device name/control module). **Remove the bare `"device"` alias from `device_type`** to avoid a header collision (`device_type` keeps `device type`/`type`/`device class`); revert the Phase 1 `"assembly"`-in-subsystem alias.
  - `InstrumentTag` gains `device: string` and `assembly: string` (the JSONB `tags` blob is schema-less, so **no DB migration**).
- `src/lib/spec-builder/instrument-parser.ts`:
  - `detectColumns` / `extractRows`: detect and read `assembly` + `device` columns.
  - `buildHierarchyFromTags`: group `subsystem → assembly → device → signals` from explicit
    fields, with the §3 fallbacks. (Supersedes the Phase 1 single-column mapping.)
  - The deterministic classification (`classifyDeterministic`) may consume `device_type`
    as today; AI classification path unchanged.

### 4.3 UI

- Register-upload card: add the "Download template" action next to the upload dropzone.

---

## 5. Scope

**In scope:** the `.xlsx` template generator + download button; the parser's explicit
`subsystem`/`assembly`/`device` column model + deterministic builder + fallbacks;
`InstrumentTag` extension.

**Out of scope:** changing the AI device_class classification (retained as-is); the forge
FB-layer code generation; migrating existing saved specs; the `groupSubsystems` upload-summary
label (tracked separately).

---

## 6. Success Criteria

- A "Download template" button yields a valid two-sheet `.xlsx` that opens in Excel with
  the documented columns + examples + instructions.
- A register authored from the template (device + assembly filled, subsystem blank) uploads
  and produces, deterministically: **one subsystem** with the engineer's assemblies, each
  device carrying its signals exactly as grouped by the `device` column — **no AI calls for
  structure**, no prefix mis-splits.
- A register with a filled `subsystem` column produces multiple subsystems exactly as stated.
- A legacy register (no `device`/`assembly` columns) still parses via the existing fallbacks.
- Generic: works for a conveyor line, a stamping cell, a filling station — not just the HK wagon.

---

## 7. Open Questions / Risks

- **Dropdowns** not supported by community SheetJS write — mitigated by documenting allowed
  values on the Instructions sheet (accepted).
- **Column-alias collision** (`device` vs `device_type`) — handled by reworking aliases (§4.2);
  the plan must include a detection test proving `device` and `device type` headers map to
  different fields.
- **Fallback correctness** — the blank/absent-column fallbacks must be covered by tests so a
  legacy register doesn't regress.
