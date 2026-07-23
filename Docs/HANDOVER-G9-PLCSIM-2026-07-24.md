# Handover — G9 PLCSIM Advanced test-loop bring-up (2026-07-24)

> PC-switch handover. Read this + the board rows G9-W7/W8 and you have full context.
> Previous handover: `HANDOVER-G5-4-2026-07-23.md` (still the source for the G5-4
> program structure). This doc carries the live PLCSIM state on top of it.
> NOTE: the running TIA project (generated blocks) and the running PLCSIM Advanced
> instance are BOTH local to the previous PC — see "New-PC gotchas" below.

## Where we are

The G5-4 program compiled clean on the new PC (0 errors / 25 known-accepted warnings —
the G9-W6 baseline). We then went down the **functional-test** rung of the G9 ladder:
"does the generated code actually run?". Two bridge fixes landed and are PUSHED
(commit `9fed9a4`, bridge **v1.4.2**), and the PLCSIM Advanced automated test loop was
brought most of the way up.

### 1. Bridge v1.4.1 — stale-project handle recovery (G9-W7, DONE)

Live Send-to-TIA failed at `POST /tia/migration/create-tags` with a 500:
*"Access to a disposed object of type 'Siemens.Engineering.Project' is not possible."*

Root cause: `IsProjectOpen`/`HasProjectOpen` were plain `_project != null` checks. When
TIA disposes the project COM object externally (user reopening the scratch project after
the Openness whitelist Accept, or a project switch), the cached `_project` becomes
**disposed-but-non-null**. The lazy-attach guard `if (!IsProjectOpen) Connect()` then
skipped the reconnect that would refresh it, and the next member access threw. Hit
create-tags first only because G9-W4 made it the first TIA-touching call in Send; all
~15 guard sites shared the hole.

Fix: the properties now route through a new `EnsureProjectFresh()` (TiaPortalService.cs)
that probes the cached handle and re-acquires `Projects[0]` when stale — repairs every
guard site at once. **Live-verified**: create-tags returned success after deploy.

### 2. Bridge v1.4.2 — PLCSIM Advanced 7.0 API (G9-W8, WORKING ON IT)

Discovery: the automated PLCSIM test loop is **already built** —
- Bridge `PlcsimService.cs` (`#if !TIA_V18`, V20-bridge only): official
  `Siemens.Simatic.Simulation.Runtime` API — register/power/run/stop a virtual
  S7-1500, `UpdateTagList`, and read/write tags by symbolic name.
- Endpoints in `BridgeServer.cs`: `/tia/plcsim/{status,start,plc-mode,update-tags,
  write-tag,read-tags}`.
- App `src/hooks/use-plcsim-runner.ts`: full write→read→assert harness with an
  **I/O simulation-rule engine** (`scheduleSimRules`) that auto-fires feedbacks after a
  configurable delay — i.e. an automated `SIM_Input_Guard`, so the state machine does
  not stall on the missing (no-HW-config) I/O. `ensurePlcsimReady()` auto-starts the
  instance; the one manual step it cannot do is the TIA→PLCSIM download.

The bug: `PacForgeBridge.csproj` referenced the PLCSIM Advanced **6.0** Runtime API DLL;
this machine runs Advanced **7.0**. The managed API is versioned per release and must
match the running runtime. Swapped HintPath to
`...\PLCSIMADV\API\7.0\Siemens.Simatic.Simulation.Runtime.Api.x64.dll` (no App.config
binding redirect exists for this assembly, so reference-swap + rebuild suffices).
**Runtime-verified**: `POST /tia/plcsim/start` registered a 7.0 instance "PLC_1" →
state `Stop`, ready for download.

## Where PLCSIM left off — the live blocker

The TIA→PLCSIM download aborted:
> *'FOB_RTG1 [OB123]' cannot be simulated ... select "Support simulation during block
> compilation" in the project properties and recompile.*

Two things:
1. **`FOB_RTG1 [OB123]` is FOREIGN** — not emitted by our codegen (repo-wide search:
   zero hits outside an unrelated template; "RTG" = rubber-tyred-gantry crane). It's a
   leftover block in the scratch project. PLCSIM download is all-or-nothing, so it
   aborted before reaching our blocks.
2. **The sim-support gate** — even a perfectly clean generated program will not download
   to PLCSIM unless the project is compiled with "Support simulation during block
   compilation" enabled.

### Resume recipe (once a TIA project with the generated program is open)

1. Start bridge v1.4.2, start a PLCSIM Advanced instance:
   `POST /tia/plcsim/start {"instance_name":"PLC_1","timeout_ms":45000}`.
   (Default CPU is S7-1515 — if the project's PLC differs, pass `cpu_type`; the ints in
   `PlcsimService.CpuTypes` map to `ECPUType`.)
2. In TIA: right-click the **project** → Properties → tick **"Support simulation during
   block compilation"** → recompile the PLC (Software / rebuild all).
3. If `FOB_RTG1` still aborts the download (library block), delete that one stray block
   (scratch project) or send the warm-up spec into a fresh empty project.
4. Online → Download to device → PG/PC interface = PLCSIM → `PLC_1` → Download → Start.
5. When it hits **RUN**: drive `"UN_<Unit>".St_Cmd` and read back `"UC_<Unit>_DB".Cur_St`
   and `"EM_<x>_DB".state` via `/tia/plcsim/{write-tag,read-tags}` to confirm the state
   machine cycles. Expect first-run tag-path friction from the G5-4 renames (UC/UN block
   names — see `src/lib/spec-builder/codegen/unit-writer.ts` for exact members:
   `UC_<Unit>` FB, `UC_<Unit>_DB` with `Cur_St`/`Cur_Mode`/edge memories, `UN_<Unit>`).
6. Then optionally auto-run a generated PLCSIM test suite via the app's PLCSIM test step.

## Generic app gaps found (not project-specific — candidate board work)

- **Sim-support compilation is not enabled by Send-to-TIA.** The PLCSIM test loop can't
  work out-of-the-box: the user must manually tick the project property + recompile.
  Candidate: have the bridge set this project property before a sim run if TIA Openness
  exposes it, else document it in the send panel. Logged on G9-W8.
- **CLAUDE.md doc drift (not yet fixed):** the "Three Control Types" section says
  Coordination Control → **FCs** (`UC_`/`SC_`). In G5-4 the UC is actually a
  **FUNCTION_BLOCK** with a `UC_<Unit>_DB` instance (holds `Cur_St`/`Cur_Mode`/edge
  memory — genuine per-scan state, correctly an FB). The `FC_<Unit>_Process/_Management`
  scaffolding around it stays FC. Only the doc line is stale; the codegen is right.

## New-PC gotchas

- **The generated TIA project lives on the previous PC.** To continue the PLCSIM test
  you need that project accessible on the new PC, OR re-send the warm-up spec
  ("Pneumatic Conveying & Conditioning", 2 units / 4 EMs — it's a Supabase row, so it
  travels with your login) into a fresh project.
- **The running PLCSIM Advanced instance does not travel** — restart it on the new PC.
- **Rebuild the bridge** (the exe is not in git): build `PacForgeBridge.csproj` only
  (the solution also builds a V18 twin whose exe is often locked). Verify
  `bridge_version: "1.4.2"` at `GET :5102/tia/status`. First TIA touch re-pops the
  Openness whitelist (new exe checksum) → Accept.
- **The 7.0 API HintPath is machine-specific** (`.csproj` line ~39). The new PC must have
  PLCSIM Advanced 7.0 at `C:\Program Files (x86)\Common Files\Siemens\PLCSIMADV\API\7.0\`.
  A different installed version needs the HintPath matched — same fix as G9-W8.

## Board state (Forja 5099871231, phase G9 item 3056329989)

- **G9-W7** (item 3107416490): **Done** — bridge v1.4.1 stale-project fix, live-verified,
  commit `9fed9a4`.
- **G9-W8** (item 3107602480): **Working on it** — bridge v1.4.2 PLCSIM 7.0 API + loop
  bring-up; blocked on sim-support gate + foreign block; resumes per recipe above.

## Commit

`9fed9a4` on master — `fix(bridge): stale-project handle recovery + PLCSIM Advanced 7.0
API — v1.4.2 (G9-W7, G9-W8)`. `Projects/` (customer reference material) left untracked.
