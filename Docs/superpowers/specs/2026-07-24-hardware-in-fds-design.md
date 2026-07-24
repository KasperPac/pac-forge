# Hardware in the FDS — model + skeleton authoring

**Date:** 2026-07-24 · **Status:** DECIDED (Kasper + Claude) · **Roadmap:** `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` (G0 area)
**Depends on / extends:** `Docs/superpowers/specs/2026-07-07-g0-fds-boundary-design.md` (the three-tier FDS boundary)
**Motivating pain:** the PLCSIM CPU/firmware juggling during G9 loop bring-up (see memory `g9-plcsim-loop-working`) — generated software lands in a project whose hardware is arbitrary, so hardware/software mismatch is a whole failure class.

## Problem

`SpecContractV2` has **no hardware model**. `io_list` carries `%I/%Q` addresses (`I0.0`…), but nothing describes the CPU, racks, or IO modules those addresses land on. Consequences:

- Send-to-TIA can only *match* an already-open project; it cannot build a runnable project from scratch, so the engineer hand-creates hardware and the addresses may not fit.
- Nothing catches "the IO doesn't fit the selected hardware" or hardware incompatibilities until very late (or never, until TIA compile).
- No basis for PLCSIM CPU auto-match — the sim CPU/firmware is picked by hand.

## Scope of this spec

**In scope:** the hardware *model* (schema + where it lives) and *manual authoring* of it at the skeleton stage, with early fit validation.

**Deferred to their own specs** (all consume this model; none built here):

1. **Fresh-project build** — Send-to-TIA creates a fresh project (HW + SW) from the model.
2. **PLCSIM auto-match** — `RegisterInstance(articleNumber, …)` picks the CPU matching the model.
3. **IO auto-addressing** — derive `%I/%Q` from module placement (moves address ownership out of `io_list`).
4. **AI suggest** — propose hardware from the register's signal counts.

## Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Authoring for the first cut | **Manual** structured entry | Customer usually dictates the hardware; app-suggests is a later nicety (deferred #4). |
| 2 | Tier / where it shows up | **Own top-level `hardware` key**, tier-2 by default, with an **optional per-project DOCX appendix** | Hardware is structurally its own device/rack/module tree, not a fit for the `engineering` grab-bag of commissioning *values*. The appendix switch gives "engineering-only" or "customer-documented" per project without committing the model to either. |
| 3 | Relationship to `io_list` | **Declare-only (BOM)** + warn-on-mismatch | `io_list` stays the address owner (already authored + tested). Hardware guarantees the devices exist beneath those addresses. Auto-addressing is deferred #3. |
| 4 | Model shape | **Siemens-concrete** + single `platform` discriminator, field names mirroring `ForgeHardwareConfig` | The only backend is Siemens TIA and the bridge consumes order numbers / rack-slot / catalog types directly. A vendor-neutral wrapper nothing consumes is speculative gold-plating (repo rules forbid it); the `platform` field leaves the door open. |
| 5 | Editor home | **Spec Skeleton Wizard**, a dedicated "Hardware" step | Authoring at the skeleton (before the full FDS co-author) means IO-fit and incompatibility alerts surface *early* — cheap, before spec effort is sunk. The wizard already holds the instrument register, so the fit check has its inputs on hand. |

**Boundary note (extends the 2026-07-07 tier doc):** hardware is tier-2 realization by default (never in the signable behavior DOCX, never asked by the Stage A/B behavior co-author). The DOCX appendix flag (decision 2) is a *presentational* override for customers who demand a documented hardware schedule — it does not change the tier.

## The model — `HardwareModelV1`

New Zod schema in `src/types/spec-contract-v2.ts`, following the `EngineeringDataV1` / `MaintenanceV1` sibling pattern; exposed as one **optional top-level key `hardware`** on `SpecContractV2`. Absent ⇒ not authored (existing specs unaffected).

```
HardwareModelV1
  platform        : "SIEMENS_TIA"        // discriminator — only value today; the open door to other vendors
  tia_version?    : string               // project target, e.g. "V20"
  cpu
    cpu_type          : string           // catalog name, e.g. "CPU 1515-2 PN"
    cpu_order_number? : string           // e.g. "6ES7 515-2AM03-0AB0"
    firmware?         : string           // e.g. "V3.1"; absent = newest compatible resolved at build time
  racks : [                              // central rack(s)
    { rack : number,
      modules : [
        { slot          : number,
          module_type   : string,        // e.g. "DI 16x24VDC", "AI 8xU/I/RTD"
          order_number? : string,
          channel_count?: number,
          signal_type?  : IoSignalType,  // reuse the existing enum (DI/DO/AI/AO/…)
          description?  : string
        } ] } ]
  render_in_docx? : boolean              // default false — decision 2 appendix switch
  notes?          : string
```

Field names mirror `ForgeHardwareConfig` (`src/types/forge.ts`) so the existing bridge payload `CreateProjectWithSources(…ioModules…)` maps 1:1 — the fresh-build follow-on spec serializes this straight into the call the bridge already supports. The TypeScript interfaces are **promoted out of the retiring `forge.ts`** into a neutral home `src/types/hardware.ts` that both the Zod schema and `src/lib/tia-bridge-contract.ts` import, so nothing new depends on the Forge wizard (which is being retired — memory `forge-wizard-phase-out`).

CPU identity is grouped under `cpu` and `tia_version` sits at the top (vs `ForgeHardwareConfig`'s fully-flat layout) — cleaner, at the cost of a trivial flatten when building the bridge payload. `firmware` absent means "newest compatible" resolved at build time rather than always pinning.

## Storage & assembly

Follows the exact pattern already used by `safety_gates` / `confirmed_units`:

- **Storage:** new `spec_projects.hardware` jsonb column (one migration).
- **Assembly:** `src/lib/spec-builder/contract.ts` `loadSpecContract` maps `projectRow.hardware → contract.hardware` (a `toHardware(projectRow)` helper, sibling to `toAlarmTiers`).
- **Write-back:** `persistContractPatch` writes `patch.hardware → projectUpdate.hardware` (sibling to the `safety_gates` branch).
- **`plc_model` sync:** the existing free-text `spec_projects.plc_model` (surfaced in the contract project header + DOCX header) is kept in sync **from** `hardware.cpu.cpu_type`. The structured model becomes the source of truth; `plc_model` becomes a derived summary so current readers keep working.

## Editor — dedicated "Hardware" step in the skeleton wizard

`src/components/spec-builder/spec-skeleton-wizard.tsx` gains a step after "Control System":

- **CPU picker** — `cpu_type` (+ optional order number, firmware, `tia_version`). The free-text `plc_model` field on the "Control System" step is superseded by this; HMI type + comms protocol stay where they are. Because CPU now lives on this later step, the wizard's step-1 `canNext` requirement on `plc_model` is relaxed — `plc_model` is derived from `hardware.cpu.cpu_type` on save, so it is no longer hand-entered at "Control System".
- **Rack/slot module table** — add/remove module rows (slot, module_type, order_number, channel_count, signal_type). One central rack by default; adding racks is allowed but not required.
- **Fit banner** — renders `validateHardwareFit` warnings live (see below).

Persisted through the wizard's existing `updateSpec.mutateAsync({ …, hardware })` call, exactly like `confirmed_units` / `safety_gates`. The step is **not gate-blocking** (`canNext` stays true) — hardware is optional, like safety gates.

## Early fit validation — `validateHardwareFit`

Pure function (no React/IO), `src/lib/spec-builder/hardware-fit.ts`:

```
type FitSignal = { signal_type: string }   // register/io_list signal class, any dialect
validateHardwareFit(hardware: HardwareModelV1, signals: FitSignal[]) : HardwareFitWarning[]
```

It reads a normalized `FitSignal[]`, never a caller-specific type — the **skeleton wizard** adapts `register.tags` into it, and the future **compile-time** caller adapts `io_list` entries. That is what lets the one function serve both surfaces. Signal-type strings are normalized to IEC via `convertSignalDirection()` (`dialect.ts`).

Checks, each emitting a structured, **non-blocking** warning:

- **Capacity** — demanded channel count per signal class (DI/DO/AI/AO, counted from register `signal_type`s) vs channels the declared modules provide. e.g. "12 DI signals, 8 DI channels declared — short 4."
- **Type incompatibility** — a register signal class with no module able to serve it. e.g. "analog input signals present, no AI module declared."
- **Address range — DEFERRED** (planning refinement): declare-only modules carry a slot but no mapped `%I/%Q` start address, so there is nothing to range-check against yet. This check lands with the auto-addressing follow-on (deferred #3).

**Warn, never block.** The skeleton must always stay completable (consistent with safety-gates-optional). The same function is reused at compile time later (a warning surface in Code Builder / Send-to-TIA) — it is written once, consumed in both places.

## Optional DOCX hardware appendix

When `hardware.render_in_docx === true`, the DOCX exporter renders a "Hardware Schedule" section (CPU + module BOM table). Default off ⇒ pure tier-2, invisible to the customer. The behavior co-author prompts (Stage A/B) never read `hardware` regardless — the appendix is exporter-only.

## Genericity (repo non-negotiable)

Everything here is generic across machine types. The model, the fit checks, and the wizard step are driven by the project's own register/io_list signal counts and the engineer's hardware entry — no project-specific device names, module lists, or CPU choices are baked in anywhere. A conveyor, a stamping cell, and a filling station each declare their own hardware and get their own fit warnings from the same code paths.

## Testing

- **`validateHardwareFit` unit tests** — short-capacity, type-mismatch, dialect/case normalization, clean-pass, empty-hardware (returns no warnings), empty-register, module-missing-channel-count.
- **`contract.ts` assembly round-trip** — `spec_projects.hardware ↔ contract.hardware`; `plc_model` derived from `cpu_type`; absent `hardware` yields absent contract key.
- **Zod schema** — `HardwareModelV1Schema` accepts a minimal CPU-only model and a full multi-module model; rejects an unknown `platform`.

## Follow-on specs (ordered)

1. Fresh-project build in Send-to-TIA (serialize `hardware` → `CreateProjectWithSources`).
2. PLCSIM CPU auto-match from `hardware.cpu`.
3. IO auto-addressing (declare → allocate; re-homes address ownership).
4. AI "suggest hardware from the register."
