# PacForge Bridge Changelog

Every bridge change bumps `BridgeVersion` in `TiaPortalService.cs` (semver:
new capability = minor, fix = patch) and gets an entry here. The running
version is visible at `GET /tia/status`.

## 1.9.0 — 2026-07-26

Simulation support is a **project** property, not a device attribute (G9-W11):

- **`IsSimulationDuringBlockCompilationEnabled`** — `DownloadToPlcsim` tried
  `SetAttribute("SupportSimulationDuringBlockCompilation", …)` on PlcSoftware, then
  the CPU DeviceItem, then the Device. On V20 **all three throw** — the last with
  *"not supported by type 'Siemens.Engineering.HW.DeviceImpl'"*. The V20 catalogue
  documents it as `Siemens.Engineering.ProjectBase.IsSimulationDuringBlockCompilationEnabled`,
  *"whether Support for Simulation during block compilation is enabled for the
  project"*. Now set there. V18 keeps the PlcSoftware attribute via `#if TIA_V18`.
- **`DownloadResultDto.SimulationSupportEnabled`** — the old failure was a
  `Console.WriteLine` only, so a compile that produced non-simulatable blocks still
  returned Success with 0 errors and nothing downstream could tell. The outcome is
  now on the response and, when false, called out in `Message` too.
- **Pre-download prompts are answered, and logged with their type.**
  `TargetForSoftware` ("download to CPU or PLCSIM Advanced") was being logged and
  ignored, leaving TIA aimed at the real CPU. It is now answered with
  `TargetForSoftwareSelections.PlcSimulationAdvanced`.

## 1.8.1 — 2026-07-26

- **Download routing searches subnets, not just the target interface.** With a
  subnet in place the node address is published under
  `ConfigurationPcInterface.Subnets[].Addresses`, while the target interface
  itself still reports zero (`Target '1 X1' → Addresses: 0`,
  `Subnet 'PN/IE_1' → 192.168.0.1`). `DownloadToPlcsim` only ever inspected the
  target, so it fell back to passing a bare `ConfigurationTargetInterface` — which
  has no node to reach, and `Download()` failed with `"Connect to module PLC_1
  failed."` It now prefers, in order: a target address → a subnet address → a
  direct interface address, and only then the bare target — logging a warning in
  that last case instead of failing silently (G9-W10).

## 1.8.0 — 2026-07-26

Generated projects are now reachable — nothing could be downloaded to them before (G9-W10):

- **`EnsureCpuNetworkAddress`** — a provisioned CPU had no node address and the
  project had no subnet, so TIA's download configuration enumerated
  `Target '1 X1' → Addresses: 0, Subnets: 0` and every download died with
  `"Connect to module PLC_1 failed."` The CPU's first PROFINET node is now given
  an address and connected to a subnet.
- Called from **`ProvisionProject`** (fresh builds are born addressable) and from
  **`DownloadToPlcsim`** (projects built before this, and hand-made ones, are
  repaired in place rather than failing with an error that names the wrong thing).

The address defaults to `192.168.0.1` on subnet `PN/IE_1` — the Siemens factory
default — because `HardwareCpuSchema` has nowhere to carry an authored IP yet.
The check is idempotent: an interface that already has an address, or is already
on a subnet, is left exactly as authored, so re-provisioning never renumbers a
commissioned rack. Failures downgrade to warnings, matching `ApplyStartAddress`.

Known, not fixed here: `SupportSimulationDuringBlockCompilation` still cannot be
set on V20 — all three fallbacks throw and the failure is only a console line, so
a clean compile does not imply the blocks are simulatable (G9-W11).

## 1.7.0 — 2026-07-25

Fresh builds now match the reimport path's structure and addressing (G0-18):

- **`ProvisionProjectRequest.Folders`** — `ImportSourcesIntoPlc` hardcoded every
  block's destination to `Program blocks`, so a freshly built project came out
  flat while `ReimportAndCompile` had always honoured a folder map. It now takes
  the same map and applies the same rule (unmapped blocks stay in the root).
- **`IoModuleDto.StartAddress`** — `PlugIoModules` called `PlugNew` and stopped,
  leaving TIA to auto-assign each card's IO range in plug order while the tags
  were created at the app's addresses. They matched only by luck. When
  `StartAddress` is supplied the plugged module's range is pinned to it via
  `Siemens.Engineering.HW.Address.StartAddress`.

`ApplyStartAddress` searches the module item and then its children (cards differ
in where the address sits) and downgrades any failure to a warning — a
mis-addressed rack is worth reporting alongside the rest of the build rather
than aborting it.

## 1.6.1 — 2026-07-25

Two fixes found during the G0-16/G0-17 live FAT:

- **Catalogue search was case-sensitive.** Openness' `HardwareCatalog.Find` matches
  case-sensitively: `6es7 521` returned 0 entries where `6ES7 521` returned 23, so
  anyone typing an article number in lower case saw an empty catalogue. The filter
  is now tried as typed, then retried uppercased when the first pass is empty —
  as-typed first so mixed-case product names (`DI 16x24VDC HF`) still match.
- **`ProvisionProject` gave an opaque error when a project was already open.** TIA
  holds one project at a time, so `Projects.Create` fails when something else is
  open. It now checks first and returns an actionable message naming the open
  project and the two ways forward (close it, or use Import + compile). It
  deliberately does **not** close the project itself — that is the user's call.

## 1.6.0 — 2026-07-25

Hardware catalogue browsing — `GET /tia/hardware-catalog` (G0-17):

- `?filter=<string>&typeIdentifier=<string>` wraps `TiaPortal.HardwareCatalog.Find`.
  The catalogue hangs off the **portal**, not a project, so this needs an attached
  TIA only — nothing has to be open. Returns `CatalogEntryDto[]` with
  `article_number`, `type_name`, `description`, `catalog_path`, `type_identifier`
  and `version`.
- Compiles for both V20 and the V18 twin — `HardwareCatalog.Find` exists in both
  Openness versions, so no `#if TIA_V18` guard is needed.

Verified live against TIA V20 on 2026-07-25:

- **`filter` is a substring match over article number AND type name.**
  `filter=DI 16` matches `SM 1221 DI16 x 24VDC` by name; `filter=6ES7 516`
  returns 138 entries.
- **`typeIdentifier` is a real compatibility filter, not a hint.** `DI 16`
  unfiltered returns 100 entries including S7-**1200** `SM 1221` cards; the same
  filter passed an S7-1500 CPU's type identifier returns 19, all S7-1500 `SM 521`.
  Incompatible cards are excluded rather than flagged.
- **`type_identifier` is exactly the string `Devices.CreateWithItem` expects** —
  `OrderNumber:6ES7 516-3AN00-0AB0/V1.0`, prefix and firmware suffix included.
  This is the important one: it means the installed firmware is *known* rather
  than guessed, so the `VERSION_SUFFIXES` ladder-try in `PlugIoModules` and the
  CPU fallback ladder in `ProvisionProject` become unnecessary for any hardware
  picked from the catalogue.
- One `article_number` repeats once per available firmware version, and
  ruggedized SIPLUS variants (`6AG1…` / `6AG2…`) sort alongside standard `6ES7…`
  parts — consumers should group by article number and prefer standard parts.

## 1.5.0 — 2026-07-25

Fresh-project build — `ProvisionProject` now builds hardware **and** software:

- `ProvisionProjectRequest` gains optional `Sources` (name → SCL) and
  `ImportOrder`. When present, the generated program is imported after the IO
  tag step and the final compile covers HW + SW, so a runnable project is
  created from the FDS in one call (G9-W9).
- `ProvisionProjectResponse` gains `CompileResult`, so the app renders per-block
  compile errors from a fresh build the same way it does for a reimport.
- The SCL-import block (delete auto-OB1 → temp `.scl` → `ImportArtifact` in
  order) is extracted into the shared private `ImportSourcesIntoPlc`, used by
  both `ProvisionProject` and `CreateProjectWithSources`.
- Existing-project safety: when a project already exists at the target path the
  bridge still opens it and returns `Created=false`, and now adds a warning that
  the program was NOT imported. A pre-existing project is never partially
  updated through this path.
- `CreateProjectWithSources` marked `[Obsolete]` — it hardcodes the CPU and has
  no progress streaming. The endpoint stays for back-compat; new work uses
  `ProvisionProject`.

## 1.4.2 — 2026-07-23

PLCSIM Advanced API bound to the installed runtime version:

- `PacForgeBridge.csproj` referenced the PLCSIM Advanced **6.0** Runtime API DLL;
  the dev/commissioning machine runs PLCSIM Advanced **7.0**. The managed API is
  versioned per release and must match the running runtime, so `RegisterInstance`
  could bind against the wrong runtime. HintPath swapped to
  `...\PLCSIMADV\API\7.0\Siemens.Simatic.Simulation.Runtime.Api.x64.dll`. No
  App.config binding redirect exists for this assembly, so the reference swap +
  rebuild is sufficient. Enables the automated PLCSIM-Advanced test loop
  (`PlcsimService` + app `use-plcsim-runner`) to drive the generated program.
  (V20 bridge only — `PlcsimService` is `#if !TIA_V18`.)

## 1.4.1 — 2026-07-23

Stale-project fix — disposed handle defeated the lazy-attach guard:

- `IsProjectOpen` / `HasProjectOpen` now probe the cached project handle and
  re-acquire `Projects[0]` when it is stale, instead of a plain `_project != null`
  check. When TIA closes/reopens/switches a project (e.g. the user reopening the
  scratch project after the Openness whitelist Accept), the old COM object is
  disposed but the cached reference stays non-null; the lazy-attach guard
  (`if (!IsProjectOpen) Connect()`) then skipped the reconnect and the next member
  access threw "Access to a disposed object of type 'Siemens.Engineering.Project'".
  Surfaced on `POST /tia/migration/create-tags` (the first TIA-touching call in the
  Send-to-TIA flow, G9-W4) with a 500; the same hole affected all ~15 guard sites.

## 1.4.0 — 2026-07-23

G5-4 program-structure standard — folder-aware reimport:

- `POST /tia/reimport-compile` accepts an optional `folders` map (artifact
  name → block-group path, e.g. `"Unit/DB"`). Blocks import into that group
  (created on demand, nested paths supported); names not in the map keep the
  Program blocks root. The pre-import delete now finds blocks RECURSIVELY
  across user groups — previously a block living in a subfolder was invisible
  to the root-level delete and every resend duplicated it.

## 1.3.2 — 2026-07-23

- `POST /tia/migration/create-tags` also lazy-attaches (same fix as 1.3.1) —
  it is now the FIRST bridge call in the Send-to-TIA flow (G9-W4 creates the
  IO tag table before importing sources), so it must survive a fresh bridge.

## 1.3.1 — 2026-07-23

Lazy TIA attach on the two remaining user-facing endpoints (G9 warm-up gap):

- `POST /tia/reimport-compile` and `POST /tia/export-sources` now call
  `Connect(preferAttach: true)` when no project is attached, matching the
  behavior of `/tia/hmi/build`. Previously the first Send-to-TIA (or source
  export) on a freshly started bridge always failed with 500
  "TIA Portal not connected or no project open" — the documented
  lazy-attach-on-first-call contract was broken for exactly these routes.

## 1.3.0 — 2026-07-22

Alarm-class creation (G8-2, consumed by the app's generated HMI build):

- `POST /tia/hmi/build` gains an `alarmClasses[]` section, processed before
  `alarms[]`: `{ "name": "Fault", "acknowledgement": true }` finds-or-creates
  the class and sets its state machine (`RaiseClearRequiresAcknowledgement`
  when acknowledgement is true, `RaiseClear` otherwise). Previously the alarms
  section could only *assign* classes that already existed in the panel, so
  generated Fault/Warning classes had to be created by hand. API shapes
  verified against the V20 Openness catalogue.

## 1.2.0 — 2026-07-08

WinCC Unified authoring extensions (Segment Wagon commissioning — maintenance
screen encoder-reset polish):

- `POST /tia/hmi/build` `tags[]`: new `"internal": true` flag creates an
  HMI-local internal tag (no PLC connection) with the given `dataType` and
  optional `initial` value — for UI scratch state (e.g. a two-tap "armed"
  flag). Without it every tag was forced onto the PLC connection.
- `POST /tia/hmi/build` `editItems[].set`: `Text` / `AlternateText` / `Content`
  (MultilingualText properties) are now routed through the XHTML text helper,
  so an existing item's caption can be relabelled. Previously `set` only
  handled scalar/Color attributes and silently failed on text.

WinCC Unified HMI inspection + authoring extensions (Segment Wagon commissioning):

- `GET /tia/hmi/inspect`: now dumps per-tag detail (`name`, `connection`,
  `plcTag`, `dataType`) — diagnoses broken tag bindings / orphan connections.
- `GET /tia/hmi/screen?name=X&props=1`: full recursive property-graph dump of
  every screen item, including dynamization internals
  (`ValueConverter.MappingTable` etc.) — the discovery tool for element options.
- `POST /tia/hmi/build` item specs:
  - `IOField` now binds values via a **Tag dynamization on `ProcessValue`**
    (static `ProcessValue` rendered the tag name — root cause of "names not
    values" on the panel).
  - `Circle` supports `alternateBackColor` (lamp on-colour).
  - Dynamization specs support `singleBit: {off, on}` — configures
    `ValueConverter.MappingTable` with `ConditionType=Singlebit` + the two
    bitmask rows (the editor's "Single bit" selection; without it a Bool→color
    dynamization never changes the colour).
- `editItems` gains: `dynamizations` (create-or-update, idempotent by property
  name), `removeDynamizations` (delete by property name), Color-string
  coercion and Int64→CLR-type coercion in `set` (Openness setters are strictly
  typed).
- `ApplyDynamizations` factored out and shared by item creation and editItems.

## 1.0.0 — baseline

HTTP/WS bridge as of the HRE commissioning start: status, import/reimport +
compile, export sources/block XML, LAD import, project create, Pac-Audit
extraction, WinCC Unified HMI build (tags/screens/items/alarms/events),
HMI export/inspect/compile, migration helpers.
