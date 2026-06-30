# Handover — Code Builder (C5 shipped, C3 in progress)

**Date:** 2026-06-30
**Author:** Kasper + Claude (session handover to another PC)
**Repo:** https://github.com/KasperPac/pac-forge

## TL;DR

- **C5 (verified library-EM instantiation) is DONE and merged to `master`, pushed.**
- **C3 (quality + versioning) is partially done** — Tasks 1–3 shipped on `master`; Task 4 is partial and Tasks 5–8 are pending. The partial work is on branch **`wip/code-builder-c3-quality-versioning`** (pushed).
- Everything below is on GitHub. Nothing is stranded on the old PC **except** the Excel lock temp `Docs/Functional Specs/~$SRL-Segment-Wagon-IO-Register.xlsx` (an editor lock file — ignore it).

## Git state at handover

| Ref | SHA | Meaning |
|---|---|---|
| `origin/master` | `23459be` | C5 complete + C1/C2 plan docs. Build green. |
| `origin/wip/code-builder-c3-quality-versioning` | `8daa184` | C3 Tasks 1–3 (already on master) + Task 4 partial + C3 plan. tsc clean. |

### Resume on the other PC

```bash
git fetch origin
git checkout master && git pull          # gets C5
# to continue C3:
git checkout wip/code-builder-c3-quality-versioning
```

> **Environment note (from prior sessions):** the repo's `.env.local` (Supabase anon key etc.) is gitignored and will NOT be on the new PC — recreate it or copy it over, or any vitest suite that transitively imports `src/lib/supabase.ts` fails with "supabaseUrl is required". The codegen suites (`src/lib/spec-builder/codegen`) do NOT need it. `npm install` first.

### Verify the build

```bash
npx tsc -b                                  # clean
npx vitest run src/lib/spec-builder/codegen # 104 passing (C5 surface)
```

Known pre-existing failures elsewhere (NOT our work): all quote/variation suites fail on clean master (~25). Ignore.

---

## C5 — Verified library-EM instantiation (DONE)

**Design:** `Docs/superpowers/specs/2026-06-30-verified-library-em-instantiation-design.md`
**Plan:** `Docs/superpowers/plans/2026-06-30-verified-library-em-instantiation.md` (+ `.tasks.json`, all 6 tasks completed)

**Commits on master:** `eabf6ed` → `c94ddc4` → `c654530` → `cb6e213` → `387b137` → `0235ac6` → `482f43f` → `6afb1e3`.

### What it does

The matched library-EM path in `src/lib/spec-builder/codegen/compile-contract.ts` is now a first-class, verified, 4-case branch (per EM, on *template matched?* × *FDS contract?*):

- **Case A** (matched + FDS contract): `checkStateCoverage` asserts FDS states ⊆ the library FB's declared states. Miss → `stubs.equipmentModules` gap report (`missing states: …`) + **BLOCK** (no instance/seam/links emitted). Pass → instantiate. (Safe-state slug mismatch → warning, not block.)
- **Case B** (matched, no FDS contract): warn "coverage unverifiable", instantiate anyway.
- **Case C** (unmatched + contract): synthesized hybrid bundle — unchanged.
- **Case D** (stub EM): stub FB owns its IO; **no** CM instantiation (no orphan blocks).

**EM-coordinates-CMs model (ISA-88 textbook):** the matched EM never writes a physical address — CMs own all physical IO. **Double-drive is fixed structurally.** EM↔CM wiring is resolved by role+tag (`buildEmCmLinks`, `matched-em-builder.ts`): `LINK_<em>_IN` (CM out → EM in, before the EM call) and `LINK_<em>_OUT` (EM out → CM in, after). Ambiguity (0 or 2+ tag matches) → `// TODO bind` comment + warning; never guessed. Coverage gate runs **before** CM instantiation so a blocked EM emits nothing.

### Files (all on master)

- `src/types/fb-interface.ts` — `FbInterfaceState` + `FbInterfaceContract.states` (rides in existing `interface_contract` JSONB; **no migration**).
- `src/lib/spec-builder/codegen/em-state-coverage.ts` — `checkStateCoverage`, `normSlug`.
- `src/lib/spec-builder/codegen/em-command-seam.ts` — `buildCommandSeam` (shared `<EM>_CMD` DB + call bindings).
- `src/lib/spec-builder/codegen/matched-em-builder.ts` — `buildEmCmLinks`, `linkKey`.
- `src/lib/spec-builder/codegen/fb-instantiate.ts` — `InstantiateResult` gained `instanceDb` + `contract`.
- `src/lib/spec-builder/codegen/em-writer.ts` — `writeCmdDb`/`buildCallLines` delegate to the shared seam (byte-for-byte).
- `src/lib/spec-builder/codegen/compile-contract.ts` — the 4-case branch.

### Deferred (KNOWN GAPS — the obvious next work)

1. **No authoring UI for the `states` field.** The compiler *consumes* it but nothing populates it yet. So **real library EM templates currently fall to Case B ("coverage unverifiable"), not Case A (verified)** until you add a states grid to the FB-library contract editor (alongside the existing pins grid in `src/components/fb-library/fb-interface-grid.tsx`). An AI-extract step (read the FB's `CASE` labels) + human review mirrors how pins already work. **This is the highest-value next step to make C5 actually verify in practice.**
2. **Link naming reality.** EM library pin names normalize-match CM-owned FDS tags only when naming aligns (`linkKey` strips one role prefix + lowercases + strips non-alnum: `fb_at_top` → `attop`, tag `at_top` → `attop`; but tag `M01_Run` → `m01run` won't match pin `fb_run` → `run`). When they don't match, links emit `// TODO bind`. The proper fix is a **per-instance binding UI** (EM pin → specific CM instance pin), which was deferred ("Phase 3.5 Device FB Binding"). Until then, library-EM links often need manual binding in TIA.
3. **Unit coordinator (sub-project D).** EM status outputs (`state`/`done`/`fault`) and `enable`/`mode`/interlock drive are intentionally left dangling — the Unit coordinator that consumes/drives them is sub-project D. Each Unit currently gets a thin `UC_<unit>` stub FC.

---

## C3 — Quality + Versioning (IN PROGRESS, branch `wip/code-builder-c3-quality-versioning`)

**Plan:** `Docs/superpowers/plans/2026-06-25-code-builder-c3-quality-versioning.md` (+ `.tasks.json`)

Adds in-builder quality gates (deterministic safety analyzer + AI Standards Review) and per-FB version history (snapshot/diff/restore) to the EM-layer Code Builder.

### Status

- **Tasks 1–3: DONE, on `master`** (commits `ac8c594`, `57575a1`, `dc0ad79`): per-region drift in reconcile, pure safety-gate evaluator (`fb-quality-gate.ts`), migration `20260625000000_code_builder_quality_versioning.sql` + persistence types + reconcile passthrough.
- **Task 4: PARTIAL, on the wip branch** (commit `8daa184`): `acknowledgeWarning` + `saveReview` mutations added to `src/hooks/use-code-builder.ts`; new `src/hooks/use-code-builder-versions.ts` (list/snapshot/restore). tsc clean at this checkpoint.
- **Tasks 5–8: PENDING** — Task 5 EM Standards Review hook (`use-em-standards-review.ts`), Task 6 `fb-quality-gates.tsx`, Task 7 `fb-version-history.tsx`, Task 8 wire into `routes/code-builder.tsx` (gate Approve on unacknowledged safety warnings; snapshot a version on Approve).

### To resume C3

```bash
git checkout wip/code-builder-c3-quality-versioning
# follow the plan from Task 4 (finish) → Tasks 5-8
```
The plan file has complete code for each remaining task. Execution method that worked well this session: subagent-driven (fresh implementer per task → spec/quality review → commit). **Deploy the C3 migration** (`npx supabase db push`) before the persistence is live — investigate history drift first per CLAUDE.md.

> Decision when you pick C3 back up: merge the wip branch into master once Task 4 is finished and green, or keep iterating on the branch until C3 is complete then merge. (C5 was built first this session specifically because it changes what the C3 gates validate.)

---

## Conventions / gotchas reaffirmed this session

- **Generic rule (CLAUDE.md, non-negotiable):** all compiler/prompt/pipeline logic must be generic across machine types — no device names/sequences/faults hard-coded. C5 honors this (compares slugs, resolves through tags, reads roles); example names live only in test fixtures.
- **`.claude/agents/pipeline-auditor.md` does not exist** — do the manual generic self-check instead.
- **TS strict:** `import type`, no enums (`as const`), no unused locals.
- Repo convention is commit-to-master, but this session used a short-lived feature branch for C5 (merged ff) because of the parallel `feat/project-docs-doc-control` work in flight on another machine. That other branch is unrelated to Code Builder.
