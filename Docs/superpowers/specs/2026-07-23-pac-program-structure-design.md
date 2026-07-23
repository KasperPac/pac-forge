# G5-4 — Pac Program Structure Standard v1 (generated program shape)

> **Task:** G5-4 (Monday phase G5 · OB1 orchestration, item 3056336774)
> **Date:** 2026-07-23 · **Status:** DESIGN APPROVED (interview with Kasper, this date)
> **Supersedes:** the flat HRE-style OB1 + per-EM MAP FCs as the emitted program shape.
> **Scope:** how generated blocks are *organized and scheduled* — zero behavioral change
> to UC/EM internals.

## Why

The G9 warm-up lap produced a compiling 29-block program, but its organization was
judged hard to follow: one flat OB1 calling every EM instance and MAP FC directly,
all blocks in the root of Program blocks. The roadmap already framed the HRE golden
master as "the quality bar, not the thing to reproduce" — this design defines the
Pac house standard the generator emits instead, merging the traditional Pac program
shape (per-unit Management/Process FCs, steps & actions) with the ISA-88/PackML
architecture the pipeline generates.

**Key insight from the design interview:** the old Pac standard and the generated
model are the same ideas in different vocabulary. The steps-and-actions sheet is now
authored in the FDS (Stage B) and *compiled* into the EM step CASEs; the "Process
FC that ties the unit together" is the UC. The new standard keeps the traditional
*organizational* vocabulary and lets the generated architecture be its implementation.

## Decisions (all confirmed by Kasper)

1. **Layer-ordered Main** (all brains decide, then all instances execute — matches
   HRE's UC-before-EM precedent).
2. **Flat input/output mapping FCs** — `MAP_<EM>` FCs eliminated; input mapping in
   `FC_Inputs` (same-scan fresh inputs — an upgrade over HRE's one-scan-late MAP),
   output mapping + drive telegram calls in `FC_Outputs`.
3. **By-unit folders**, each with `FB/` and `DB/` subfolders; Process/Management FCs
   at the unit-folder root; shared library FB bodies in a root `Library/` folder;
   instance DBs always live in the owning unit's `DB/`.
4. **One brain per unit** — `FC_<Unit>_Process` hosts the generated `UC_<Unit>`
   instance call plus a regen-preserved custom-logic region. No second hand-written
   sequencer alongside the UC (two brains commanding the same EMs is the
   coordination-layer version of double-drive).
5. **Naming** — scaffolding FCs use `FC_<Unit>_Process` / `FC_<Unit>_Management`.
   The ISA-88 prefix family (`CM_`/`EM_`/`UC_`) stays reserved for the entities
   ISA-88 actually defines; scaffolding deliberately does not imitate it.
6. **Sequencing** — restructure first, then re-send the warm-up spec, then a single
   download + PLC-SIM run-verification on the final structure, then HMI + Level 1.

## 1. Scan architecture

```
ORGANIZATION_BLOCK "Main"
BEGIN
   "FC_Inputs"();                            // conditioning + input mapping

   // --- process layer: unit brains decide ---
   "FC_<UnitA>_Process"();                   // one per unit
   "FC_<UnitB>_Process"();

   // --- management layer: instances execute ---
   "FC_<UnitA>_Management"();                // one per unit
   "FC_<UnitB>_Management"();

   "FC_Outputs"();                           // output mapping + drive telegrams
   "FC_Maintenance"();                       // overrides — always last
END_ORGANIZATION_BLOCK
```

| Block | Contents | Ordering guarantees |
|---|---|---|
| `FC_Inputs` | `IO_Cond` conditioning FB call FIRST, then all input mapping: physical / conditioned (`IO_Cond.*`) / N/C-inverted / EU-scaled reads → EM instance-DB input pins, grouped under a `// --- <EM name> ---` banner per EM | Conditioning before any conditioned read (same FC, same scan). EMs execute on same-scan fresh inputs |
| `FC_<Unit>_Process` | `UC_<Unit>_DB`() call + custom-logic region (§3) | All Process FCs before all Management FCs (uniform scan snapshot for every brain; HRE precedent) |
| `FC_<Unit>_Management` | The unit's EM instance calls with `_CMD` DB parameter wiring + its library-device instance calls | After every Process FC |
| `FC_Outputs` | All output mapping: instance-DB actuator pins → physical tags, per-EM banners; drive telegram FB calls (`SINA_SPEED` etc. — consume EM setpoints, return status; feedback lands next scan, same semantics as today's MAP placement) | After all Management FCs |
| `FC_Maintenance` | `MAINT_Encoder_Preset`-class FCs, `MAINT_Output_Override` | Override structurally the final call of the scan (G5-3 guard moves here). NOTE: preset-class FCs move from HRE's pre-EM slot (G5-2) to scan-end — a one-scan shift on maintenance-mode one-shots, accepted deliberately to keep all maintenance in one layer |

`MAP_<EM>` FCs are **eliminated**. The EM bundle becomes 4 artifacts:
EM FB, State UDT, CMD DB, instance DB.

## 2. Project tree (TIA block groups)

```
Program blocks/
├─ Main
├─ 00_System/          FC_Inputs, FC_Outputs, FC_Maintenance, IO_Cond (FB+DB),
│                      MAINT_*, Maintenance_CMD, HMI_CMD
├─ <Unit>/             FC_<Unit>_Process, FC_<Unit>_Management
│  ├─ FB/              UC_<Unit>, EM_* FBs
│  └─ DB/              EM iDBs, *_CMD DBs, UC_<Unit>_DB, UN/CFG/STAT,
│                      drive DBs (SINA_*), device instance DBs
└─ Library/            shared device FB bodies only (e.g. FB_Valve)
```

- Folder names come verbatim from FDS unit names — generic for every machine.
- UDTs live in TIA's own PLC data types tree (TIA-imposed; unchanged).
- `00_System` is numbered so it sorts first; unit folders are unnumbered.

## 3. Custom-region preservation (seed of the G9-3 edit strategy)

`FC_<Unit>_Process` is generated with strict markers:

```
   // --- custom process logic (preserved on regen) ---
   // (site/process-specific ties, one-shots, special cases)
   // --- end custom ---
```

On regeneration the compiler extracts the region body from the **latest stored
Code Builder edit of the previous revision** (`code_builder_artifacts.edited_content`
for that artifact name) and re-inserts it between the markers of the fresh
generation. Hand logic survives regen by
construction. Marker lines are exact-match; a missing/end-mangled marker aborts the
merge with a warning (never silently drops hand code). Hand-created blocks that the
generator does not know by name are already safe — reimport deletes only known
artifact names.

## 4. Implementation surface

**App (`src/lib/spec-builder/codegen/`):**
- `ob1-writer.ts` — rewritten to the layer-ordered Main above.
- New `layer-fc-writer.ts` — builds `FC_Inputs` / `FC_Outputs` / `FC_Maintenance`
  from content the existing writers already produce (sensor/actuator lines, drive
  emissions, conditioning + maintenance calls).
- New `unit-fc-writer.ts` — builds `FC_<Unit>_Process` / `FC_<Unit>_Management`;
  Process includes the custom region + merge logic.
- `em-writer.ts` — stops emitting MAP FCs; exposes its mapping-line builders to the
  layer writer.
- `compile-contract.ts` — routes call lines to layer/unit FCs instead of
  assembling flat `deviceCallLines`; OB1 gets the fixed layer shape.
- `types.ts` — artifacts carry a real `folder` path (`00_System`, `<Unit>`,
  `<Unit>/FB`, `<Unit>/DB`, `Library`); new codegen layer `"system"` for the
  scaffolding FCs (UI layer filter unaffected for device/em/unit).
- Code Builder UI — the EM viewer's "Map" tab is removed (mapping now lives in the
  shared layer FCs).

**Bridge (v1.4.0 — minor bump, new capability):**
- `POST /tia/reimport-compile` request gains optional `folders: { [sourceName]:
  "path/like/Unit/DB" }`; import places each block via the existing
  `GetOrCreateBlockGroup` (proven by the LAD import path), creating nested groups
  as needed. Sources without a folder entry behave exactly as today (root).
- CHANGELOG entry per the mandatory versioning rule.

**Explicitly unchanged:** UC internals, EM internals, command seam, PackTags
(UN/CFG/STAT), maintenance logic, IO tag table (G9-W4), promote-to-library
(mapping is per-project derived data — losing MAP FCs costs nothing), HMI compiler.

## 5. Testing

- New `layer-fc-writer` suite: content routing (input vs output vs drive lines),
  per-EM banners, IO_Cond-first, override-last, generic 2-unit fixture.
- New `unit-fc-writer` suite: Process = UC call + markers; Management = EM calls
  with CMD wiring; custom-region merge (roundtrip, missing-marker abort + warning).
- Updated: `ob1-writer` (layer shape), `compile-contract` (artifact set + folder
  map structural assertion), `em-writer` (no MAP artifact).
- HRE parity fixtures re-scoped to EM/UC internals (structure assertions move to
  the new standard).
- Bridge folder placement verified manually by re-sending the warm-up spec
  (folders visible in the TIA tree).

## 6. Rollout

1. Implement writers + compile-contract + tests (`npx tsc -b` + vitest clean).
2. Bridge v1.4.0, rebuild, restart (Openness whitelist re-accept).
3. Re-send warm-up spec → compile clean → verify tree shape in TIA.
4. Download → PLC-SIM run-verification (first *functional* validation).
5. Continue warm-up: HMI build + G8-3/G8-4 probes → Level 1.

## Out of scope (recorded, not forgotten)

- G9-3 full edit strategy (regen vs hand-edit across ALL block types) — the custom
  region here is its seed; design after Level 2 edit data exists, per the ladder.
- Per-unit input/output sub-FCs (only needed if `FC_Inputs`/`FC_Outputs` prove
  unwieldy on very large machines — revisit on evidence).
- Renaming `UC_` (stays; ISA-88 coordination-control prefix).
