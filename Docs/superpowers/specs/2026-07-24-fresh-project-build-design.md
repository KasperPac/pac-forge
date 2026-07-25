# Fresh-project build from the FDS — design

**Date:** 2026-07-24 · **Status:** DECIDED (Kasper + Claude) · **Roadmap:** `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` (G9 area — runnable code)
**Depends on:** `Docs/superpowers/specs/2026-07-24-hardware-in-fds-design.md` (the `HardwareModelV1` this consumes — shipped).
**Motivating pain:** the PLCSIM CPU/firmware juggling during G9 loop bring-up. Generated SCL only imports into an already-open project whose hardware is arbitrary; there is no "build a runnable project (HW + SW) from scratch" path. This is deferred follow-on #1 from the hardware-in-FDS spec.

## Problem

Code Builder's "Send to TIA" (`useSendCodeToTia` + `SendToTiaPanel`) can only **reimport** the generated program into an **already-open** TIA project. To get a runnable machine you must first hand-create the project + CPU + IO modules + tags, then send. Now that the FDS carries a `HardwareModelV1`, the app can build the whole project from scratch — but nothing wires the contract's hardware into a project-creation call.

## What already exists (verified in this repo, 2026-07-24)

- **`ProvisionProject`** (`bridge/PacForgeBridge/TiaPortalService.cs`, method at ~L391) already: connects → creates-or-opens a project (new-vs-existing detection via `*.ap*` scan, sets `response.Created`) → adds the CPU with a **robust fallback ladder** (requested `CpuOrderNumber` → version-suffix-stripped → known-good S7-1500 fallbacks) → plugs IO modules (`PlugIoModules`, itself ladder-tries firmware suffixes) → creates IO tags (`CreateIoTags`) → saves → compiles hardware. Emits **WebSocket progress** throughout (`ProvisionProgress`).
- Its request `ProvisionProjectRequest` (`Models.cs` ~L136) has `TiaProjectPath`, `ProjectName`, `CpuOrderNumber` (firmware as a `/V2.9` suffix), `ProvisionId`, `IoModules` (`IoModuleDto {Mlfb, Rack, Slot, Description}`), `IoTags` (`IoTagDto {Name, DataType, LogicalAddress, Comment}`). **It has no `Sources`** — it builds hardware only.
- **`CreateProjectWithSources`** (`TiaPortalService.cs` ~L1547) does HW **+** SW import **+** compile in one call, but **hardcodes the CPU** (`6ES7 516-3AN02-0AB0/V2.9`) and has no progress streaming. Its source-import block (delete auto-OB1 → temp `.scl` → `ImportArtifact` in order → compile → save) is the logic to lift.
- **`useSendCodeToTia.buildPlan()`** already loads the contract and produces a `CodeSendPlan { sources (ordered UDT→OB), folders, countsByType, editedBlocks, ioTags: MigrationTagDto[], warnings }`. Its `send()` creates tags then reimports into the open project. Everything for the SW side is already assembled.
- The retiring Forge provision flow (`use-forge-provision.ts`) has the mapping pattern (signalType→dataType/prefix, `buildIoModules`, `buildIoTags`, a `CPU_ORDER_NUMBERS` lookup) — sourced from `ForgeHardwareConfig`/`ForgeIoEntry`. We port the shape, not the wizard dependency.

## Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Where HW+SW build lives in the bridge | **Consolidate on `ProvisionProject`** — extend it with optional `Sources` + `ImportOrder`; deprecate `CreateProjectWithSources` | `ProvisionProject` is the newer, better-instrumented path (parameterized CPU + fallback ladder + WS progress + created/existing). The SW-import logic already exists to lift in. One atomic call. |
| 2 | Fresh-vs-open trigger in the UI | **A second button** *Create new project…* in `SendToTiaPanel` with an inline form; the open-project path is untouched | Keeps the everyday reimport one-click; makes fresh-build a deliberate action with its own form + progress. |
| 3 | New-project location | **User types the target folder** (remembered in `localStorage`) + **project name** (defaults to spec doc code / title) | Browsers can't pick native folders; the bridge is local. Mirrors the Forge provision path. |
| 4 | Hardware guard | Fresh-build **requires `contract.hardware` with a resolvable CPU**; disabled with a hint otherwise | Build the customer's actual CPU, never a guessed default. |

## Design

### 1. Bridge — extend `ProvisionProject` (the only C# change)

- `ProvisionProjectRequest` += `Sources: Dictionary<string,string>` (name→SCL) + `ImportOrder: List<string>` (both optional).
- `ProvisionProjectResponse` += `CompileResult: CompileResultDto` (so the panel shows per-block compile errors, same shape the send flow renders).
- In `ProvisionProject`, **after the IO-tag step, before `SaveProject`**: if `Sources` is non-empty → delete the auto-created OB1, write each source to a temp `.scl`, `ImportArtifact(plcSoftware, name, path, "Program blocks")` in `ImportOrder` order, collecting imported blocks + per-block warnings (logic lifted verbatim from `CreateProjectWithSources`). The existing final `CompileAll` then compiles HW **+** SW; capture its result into `response.CompileResult`. Progress label reads "Compiling program" when sources are present.
- **Existing-project case:** `ProvisionProject` already returns early when a `*.ap*` exists at the target path (opens it, `Created=false`) — *before* modules/tags/sources. Fresh-build must **not** clobber or partial-update an existing project: in that early-return branch, when `Sources` were provided, add a warning ("project already existed — program not imported; use Import + compile into the open project"). The program is never imported into a pre-existing project via this path.
- Mark `CreateProjectWithSources` `[Obsolete]` (endpoint kept for back-compat; new work routes to `ProvisionProject`).
- **MANDATORY:** bump `BridgeVersion` in `TiaPortalService.cs` (minor — new capability) + add a `bridge/PacForgeBridge/CHANGELOG.md` entry.

The endpoint (`BridgeServer.cs` `/tia/provision-project`) needs no routing change — the deserializer already binds `ProvisionProjectRequest`; the new fields ride along.

### 2. Frontend — pure contract→provision mapper

New pure module `src/lib/spec-builder/tia-provision-inputs.ts` (no React, no IO):

```
cpuOrderNumberFromHardware(hardware: HardwareModelV1 | null | undefined): string | undefined
  // prefer cpu.cpu_order_number (+ "/<firmware>" when firmware set and not already suffixed);
  // else CPU_ORDER_NUMBERS lookup by cpu.cpu_type; undefined ⇒ no CPU authored

ioModulesFromHardware(hardware): { modules: IoModuleDto[]; missingOrderNumbers: string[] }
  // flatten racks→modules; module WITH order_number → { mlfb, rack, slot, description: module_type };
  // module WITHOUT order_number → name collected into missingOrderNumbers (can't be plugged)
```

`CPU_ORDER_NUMBERS` (S7-1511…1518 → MLFB `/V2.9`) is ported into this module (generic Siemens catalog data, not project-specific). Fully unit-tested.

### 3. Frontend — `useSendCodeToTia` gains a fresh-build action

- `buildPlan()` computes provision inputs from the already-loaded `contract.hardware` and adds to `CodeSendPlan`:
  `provision: { cpuOrderNumber?: string; ioModules: IoModuleDto[]; missingOrderNumbers: string[] }`.
- New action `provisionFresh(plan, { projectPath, projectName }) → ProvisionProjectResponse | null`: maps `plan.ioTags` (`MigrationTagDto`) → `IoTagDto` (`logical_address = address`, other fields 1:1), POSTs the extended `ProvisionProject` request with `cpu_order_number`, `io_modules`, `io_tags`, `sources = plan.sources`, `import_order = Object.keys(plan.sources)` (already dependency-ordered), and `provision_id`. Wires the **existing WS progress** mechanism (ported from `use-forge-provision`'s `connectWs`), returns created/existing + `compile_result`.

### 4. UX — `SendToTiaPanel`

- After *Assemble program*, alongside *Import + compile (open project)*, add ***Create new project…***.
- Reveals an inline form: **folder path** (text input, remembered in `localStorage`) + **project name** (default from spec doc code / title).
- **Guard:** disabled with a hint ("author a CPU in the skeleton wizard's Hardware step first") when `plan.provision.cpuOrderNumber` is absent.
- Renders the WS progress steps, the created/existing message, and the compile result (reusing the panel's existing compile-result block).
- **On `created === false`** (a project already existed at the path): show the bridge's warning — the program was *not* imported — and point the user to *Import + compile* against the now-open project, or to pick a new name/folder.

### 5. Contract types (`tia-bridge-contract.ts`)

`ProvisionProjectRequest` += `sources?: Record<string,string>` + `import_order?: string[]`; `ProvisionProjectResponse` += `compile_result?: CompileResultDto` — following the existing snake_case field convention the bridge already deserializes.

## Genericity (repo non-negotiable)

Nothing project-specific is introduced. The CPU table is generic Siemens catalog data; all inputs derive from the project's own `contract.hardware` + generated program. A conveyor, a stamping cell, and a filling station each build their own fresh project from the same code paths.

## Testing

- **Pure mapper unit tests** — `cpuOrderNumberFromHardware` (order-number wins, firmware suffix appended, lookup fallback, absent ⇒ undefined); `ioModulesFromHardware` (maps order-number modules, collects missing-order-number names); `MigrationTagDto → IoTagDto` mapping.
- **Send hook** — `buildPlan` populates `plan.provision` from `contract.hardware`; absent hardware ⇒ `cpuOrderNumber` undefined.
- **Bridge** — no unit tests (C#, Openness). **Live-TIA FAT is the real gate**: fresh build on a real install → new project with the authored CPU + modules + tags + imported program compiles.

## Deferred (own follow-on specs)

1. **PLCSIM CPU auto-match** — `RegisterInstance(articleNumber)` from `hardware.cpu` so the sim CPU matches the built project (the original G9 pain).
2. **Module-firmware pinning** from the model (the bridge already ladder-tries firmware suffixes; pinning is an enhancement).
