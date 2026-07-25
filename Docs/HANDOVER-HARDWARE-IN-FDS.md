# Handover — Hardware in the FDS + Fresh-Project Build

**Date:** 2026-07-25 · **Author:** Kasper + Claude (Opus 4.8) · **Branch:** `master`

Two related capabilities from the runnable-code roadmap. **Feature 1 is built and merged; Feature 2 is designed but not built.** This doc is the pick-up point for either continuing Feature 2 or verifying Feature 1 live.

---

## Feature 1 — Hardware in the FDS ✅ SHIPPED (to master)

The FDS now carries a `HardwareModelV1` (CPU + racks/modules), authored manually in a new **"Hardware" step** in the Spec Skeleton Wizard, with a live IO-fit banner. Codegen sees `contract.hardware`; an optional flag renders a hardware schedule into the DOCX.

- **Spec:** `Docs/superpowers/specs/2026-07-24-hardware-in-fds-design.md`
- **Plan:** `Docs/superpowers/plans/2026-07-24-hardware-in-fds.md`
- **Commits:** `53d787a` (schema) → `6020dc8` (migration + assembly) → `765c1db` (`validateHardwareFit`) → `fa3b954` (`HardwareStep`) → `a2b4b8c` (wizard wiring) → `77b3fe8` (DOCX BOM) → `199c5fb` (Review-screen fix). Base docs commit `ea1a1b1`.
- **Gate met:** `npx tsc -b` clean, 15/15 new tests.
- **Monday:** G0-16 (subitem `3109859259`) on board `5099871231` = **Awaiting Testing**.

### ⚠️ REQUIRED before it works live (2 steps)
1. **`npx supabase db push`** — applies migration `supabase/migrations/20260724000000_hardware_model.sql` (adds the `spec_projects.hardware` jsonb column). **Until this runs, the skeleton wizard's Confirm & Save will error on the unknown column.**
2. **Live FAT** — open a spec's skeleton wizard, go to the new **Hardware** step, enter a CPU + IO modules, confirm the fit banner appears/clears as capacity changes, and that Confirm & Save persists + the project's `plc_model` reflects the CPU.

### Key files (Feature 1)
- `src/types/spec-contract-v2.ts` — `HardwareModelV1Schema` (+ `hardware` key on `SpecContractV2Schema`). Sibling of `EngineeringDataV1`. Signal types are **IEC** (DI/DO/AI/AO), not Siemens DQ/AQ.
- `src/types/spec-builder.ts` — `SpecProject.hardware` / `SpecProjectUpdate.hardware`.
- `src/lib/spec-builder/contract.ts` — `loadSpecContract` assembles `projectRow.hardware → contract.hardware`.
- `src/lib/spec-builder/hardware-fit.ts` — pure `validateHardwareFit` (capacity + type-incompatibility; IEC-normalized via `dialect.ts`).
- `src/components/spec-builder/hardware-step.tsx` — `HardwareStep`, `emptyHardware`, `plcModelFromHardware`.
- `src/components/spec-builder/spec-skeleton-wizard.tsx` — "Hardware" step at render index 2; `plc_model` derived from CPU.
- `src/lib/spec-builder/docx-exporter.ts` — `hardwareBomData` + optional BOM under "1.2 Hardware Configuration" (gated on `render_in_docx`).

---

## Feature 2 — Fresh-project build from the FDS 📋 SPEC'd, NOT built

Turn Code Builder's "Send to TIA" from "reimport into an already-open project" into "**build a runnable project (HW + SW) from scratch**" using `HardwareModelV1`. Closes the PLCSIM CPU/firmware-mismatch class from G9 bring-up.

- **Spec:** `Docs/superpowers/specs/2026-07-24-fresh-project-build-design.md` (committed).
- **Plan:** none yet — **next step is `superpowers:writing-plans`**.
- **Monday:** G9-W9 (subitem `3110138357`) = **Spec Created**.

### Design in one paragraph
Extend the bridge's **`ProvisionProject`** (which already does parameterized CPU + fallback ladder + modules + tags + WS progress + created/existing) with optional `Sources` + `ImportOrder`, so it imports the generated SCL and compiles HW+SW in one call; add `CompileResult` to its response; deprecate `CreateProjectWithSources`. Frontend: a pure `tia-provision-inputs.ts` mapper (`contract.hardware` → cpu order number + `IoModuleDto[]`), a `provisionFresh` action on `useSendCodeToTia` (reuses `buildPlan`'s `sources`/`ioTags`), and a second **"Create new project…"** button in `SendToTiaPanel` (open-project path untouched). **Mandatory bridge version bump + CHANGELOG when built.**

### ⚠️ Verification caveat
The bridge change (C#, TIA Openness) has **no unit tests** and **can only be FAT'd on a live TIA install**. The frontend pieces (mapper, hook, panel) are unit-testable and should be gated normally. Do not claim Feature 2 works without a live fresh-build proof.

---

## Deferred follow-on specs (not started)

From Feature 1: (already includes Feature 2 as #1.)
From Feature 2:
1. **PLCSIM CPU auto-match** — `RegisterInstance(articleNumber)` from `hardware.cpu` so the sim CPU matches the built project (the original G9 pain).
2. **IO auto-addressing** — derive `%I/%Q` from module placement; also enables the deferred address-range fit check in `validateHardwareFit`.
3. **Module-firmware pinning** from the model (bridge already ladder-tries suffixes).
4. **AI "suggest hardware from the register"** — the app proposes a CPU + modules from the io_list signal counts.

## Resume checklist
1. On another PC: `git pull`, then copy the gitignored `.env.local` (Supabase keys) into the repo root — suites importing `src/lib/supabase.ts` fail without it.
2. Run `npx supabase db push` (Feature 1's migration) if not already applied to the target Supabase.
3. FAT Feature 1 in the skeleton wizard → move G0-16 to Done when verified.
4. To build Feature 2: read its spec → `superpowers:writing-plans` → subagent-driven build → bridge FAT on live TIA. Bump `BridgeVersion` + CHANGELOG in the bridge change.

## Git / Monday state
- All Feature-1 code + both specs + this handover are on `master`, pushed to `origin/master` 2026-07-25.
- Board "Forja" `5099871231`: **G0-16** = Awaiting Testing · **G9-W9** = Spec Created. Both carry origin comments + inline spec/plan Docs.
