# Handover — IO addressing (G0-18) + what shipped 2026-07-25

**Branch:** `master`, 15 commits **local, unpushed**. **Bridge:** v1.7.0.

Pick-up point for finishing the IO mapping. Everything below was FAT'd on live TIA V20 unless marked otherwise.

---

## The one thing left to do

**Write the computed IO addresses back onto the spec.** Nothing does this yet, so a rebuild today still produces mismatched tags — cards get pinned correctly, the stored spec still holds its old addresses.

- **Design decision already made (Kasper):** *spec follows hardware*. The declared rack is the source of truth; addresses are recomputed onto it.
- **Engine is done and tested** — `src/lib/spec-builder/io-addressing.ts` → `planIoAddressing(hardware, signals)` returns `{ modules, assignments, warnings }`. `assignments` carries `{ tag, from, to, changed }`, which is exactly the diff the UI needs.
- **What to build:** a "Re-address IO from hardware" action with a diff preview and explicit apply, writing to `confirmed_units` (the JSON that holds `units[].equipment_modules[].control_modules[].io_signals[]`).
- **Where it belongs:** the skeleton wizard / IO register — **not** `HardwareStep`, whose `onChange` only carries hardware and cannot touch signals. That integration point is the open question.

---

## Shipped today

| | Commit | State |
|---|---|---|
| Fresh-project build (HW+SW) | `5defb99` | **FAT'd** — creates project, CPU, cards, tags, program |
| Hardware catalogue endpoint | `b0fc63f` | **FAT'd** — real Siemens parts returned |
| Catalogue picker UI | `9ceb421` | **FAT'd** — filtered picks working live |
| Case-insensitive search + open-project guard | `7a28dc8` | case fix FAT'd; guard unproven |
| Slot `max+1` + collision warning | `41c98ea` | unit-tested only |
| Addressing engine | `4a8e565` | unit-tested only |
| Folders + `StartAddress` pinning | `50d5fd8` | **NOT FAT'd** |
| FDS co-author → Opus 5 | `09a669a` | unit-tested only |

---

## Facts learned the hard way

- **`%I` and `%IW` share ONE input address space** (and `%Q`/`%QW` the output one). A DI card and an AI card both consume input bytes — the layout runs **two** counters, not four. Encoded in `planIoAddressing`; get it wrong and analog/digital ranges silently overlap.
- **Slot 1 is the CPU.** IO starts at slot 2. `PlugIoModules` already refuses slots < 2.
- **A slot collision does not drop a card** — TIA relocates it to the next free slot. It was *not* the cause of the unmapped IO (I initially misdiagnosed this).
- **Openness `HardwareCatalog.Find` is case-sensitive** — `6es7 521` → 0 results, `6ES7 521` → 23. Worked around by retrying uppercased; a lowercase *product-name* search (`digital input`) still won't match.
- **`CatalogEntry.TypeIdentifier` is exactly the `CreateWithItem` string** (`OrderNumber:<mlfb>/<Vx.y>`), so installed firmware is known, not guessed. The `VERSION_SUFFIXES` ladder-try and CPU fallback ladder are now redundant for catalogue-picked hardware — **not yet removed**, they still cover hand-typed entries.
- **`Connection to TiaPortal failed.`** is an Openness exception, not our code. Seen once after a rebuild; a plain bridge restart cleared it with no whitelist prompt. Check portal version and `Siemens TIA Openness` group membership before chasing the whitelist.
- **`npm run dev` starts a second bridge** — the V18 twin on port 5103. The app talks to 5102. Harmless, but confusing when two consoles appear.

---

## Test-spec state (`5ac7b9c5-65b3-4cf0-91f4-926c2af70adf`)

Hardware: CPU 1511-1 PN (`6ES7 511-1AK00-0AB0` V1.8), DQ slot 2, AI slot 3, **DI slot 4** (was colliding at slot 3; TIA relocated it).

Signals: **11 DI, 4 DO, 7 AI** — all wired, all addressed, no duplicate tags → 22 expected tags.

Computed layout vs stored spec:

| Card | Computed range | Spec currently says |
|---|---|---|
| DQ 16 | `%Q0.0–%Q1.7` | `%Q0.0/0.1` + `%Q16.0/16.1` |
| AI 8 | `%IW0–%IW14` | `%IW128–134` + `%IW256–260` |
| DI 16 | `%I16.0–%I17.7` | `%I0.0–0.4` + `%I16.0–16.5` |

Moves needed: all 7 AI, 2 of 4 DO, 5 DI.

---

## Environment / verification

- `npx tsc -b` clean. Full suite **33 failed / 1038 passed** — the 33 are **pre-existing** in quote/variation/issue suites, verified against pre-work commit `80306b5` in a scratch worktree. Zero regressions from any of today's work.
- Bridge builds 0 errors (4 pre-existing NU1603 NuGet warnings).
- `supabase db push` applied `20260724000000_hardware_model.sql`; `spec_projects.hardware` verified as `jsonb` on remote. History in sync.
- Background processes left running: bridge exe (logs → `<scratchpad>/bridge.log`) and the Vite dev server. Kill both if starting cold.

## Monday

Board "Forja" `5099871231`: **G9-W9** Awaiting Testing · **G0-17** Awaiting Testing · **G0-18** `3112412991` open (the work above) · model-sweep subitem `3112446493` (Sonnet 4.6 → Sonnet 5, note the intro pricing window closes **2026-08-31**).
