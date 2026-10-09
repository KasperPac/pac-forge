# PacForge Bridge Changelog

Every bridge change bumps `TiaPortalService.Version` (semver:
new capability = minor, fix = patch) and gets an entry here. The running
version is visible at `GET /tia/status` and in the startup banner.

## 1.13.8 — 2026-10-09

An object whose git file already matches it is versioned on V21 (PHUB-311). V21 throws on
`MappedObject.Synchronize` when the mapping's compare status is equal ("Synchronize cannot be called on a workspace
mapping that has a compare status of equal") where V20 did nothing, which stopped MCR-2601 Beam's Start at
LCamHdl_CreateCamBasic. A mapping is now synchronised only when its status is not equal; an equal one's file is
already the export.

## 1.13.7 — 2026-10-09

The version-control export gives TIA V21 the folder form it accepts (PHUB-311). Probed live against MCR-2601 Beam: V21's
`Workspace.ExportObject` / `ConnectObject` refuse a relative folder ("cannot be a relative path") and the absolute
folder under the workspace root ("Relative Directory Path is Invalid"), and take the folder relative to the root
written with a leading separator and no drive — `\PLC_1\PLC tags` — mirroring the object's place in the project.
1.13.4's absolute folder is replaced by that form. (Also learned: `MappedObject.Delete()` is a silent no-op unless
it runs under `ExclusiveAccess` and a committed `Transaction`; nothing in the bridge deletes a mapping today.)

## 1.13.6 — 2026-10-09

The archive keeps its `.zap21` on V21 (PHUB-316). `Project.Archive` was given the bare name and V21 wrote a file
with no extension, which the archive route then could not find. It is now given the whole file name
(`<name>.zap<edition>`, as TIA's own docs describe the argument), and the one file TIA writes into the emptied
staging folder is the archive whatever an edition names it; it lands in Dropbox under the requested name.

## 1.13.5 — 2026-10-09

An archive goes to its PLC's Dropbox folder when the two are named apart (PHUB-316). `POST /tia/project/archive`
refused MCR-2601 Beam with "The working copy belongs to PLC folder '02 Beam', not '02 - Beam (横梁)'": it compared
the repo folder's name with the Dropbox folder's, which 1.13.1 (PHUB-269) had made free to differ. The two are now
the same PLC when their `<nn>` matches; a working copy is still refused for another PLC's folder.

## 1.13.4 — 2026-10-08

On TIA V21 the VCI export works (PHUB-311). Every `Workspace.ExportObject` and `ConnectObject` threw
"The argument 'relativeWorkspaceDirectoryPath' cannot be a relative path" — 49 of 49 on MCR-2601 Beam — so
every object was skipped and a change applied through the conversation was not committed. V21 now gets the absolute folder
inside the workspace; its own documentation still says the path is relative to the workspace root. V20 keeps
the relative form, which no live run has confirmed either way.

## 1.13.3 — 2026-10-08

The startup banner prints the bridge's real version (PHUB-310). It read `PacForge TIA Bridge v1.0`
whatever the build, so a stale bridge looked the same as a current one. The version now lives once,
in `TiaPortalService.Version`, and both the banner and `GET /tia/status` read it.

## 1.13.2 — 2026-10-07

The bridge never closes a project with unsaved changes (PHUB-252). Openness closes a project without
saving, so `POST /tia/disconnect` and `POST /tia/open-project` could throw away an engineer's edits.

- **Attached to the engineer's TIA, `POST /tia/disconnect` only releases it**, as shutdown already did;
  their project stays open as they left it. A portal the bridge started still closes its project.
- **Closing a project with unsaved changes is refused** `409 { success:false, refused:"UNSAVED_CHANGES",
  message }` — on disconnect from a portal the bridge started, and on `open-project` with another project
  open. A modified flag TIA will not report counts as modified (as Ruling 34 reads it for VC).

## 1.13.1 — 2026-10-06

A PLC is its number (PHUB-269). `POST /tia/vc/prepare` took the Dropbox folder name for the repo
folder, so `50 PLC - Beam (横梁)` became a second PLC 02, `02 - Beam (横梁)`, beside the
`02 Beam` the repo already had, and the working copy landed outside that PLC's history.

- The repo folder is the one `pac-hub-vc ensure` records in job.json for the PLC's number
  (`plc_folder`); ensure matches a PLC by number and keeps its recorded name.
- **`dropbox_plc_folder`** (new) is the folder in the job's Dropbox `50 PLC`, as named there. Pac Hub
  archives the working copy back to it; it need not equal `plc_folder`.
- Doc codes from job.json are merged into `plcs` by number.

## 1.13.0 — 2026-10-01

The working copy for Pac Hub's PLC conversation (PHUB-232, pac-hub spec
`2026-10-01-pac-hub-plc-version-control-design.md` §5).

- **`POST /tia/vc/prepare`** `{ job, customer, job_name, dropbox_job_path, plc_folder? }`. It picks
  the PLC from the job's Dropbox `50 PLC`, and with several and none given it refuses
  `PLC_CHOICE_NEEDED` with `plcs`. It runs `pac-hub-vc ensure` for the job repo under
  `PAC_JOBS_ROOT` (default `C:\PacTechGit`). A jobs root inside Dropbox is refused
  `JOBS_ROOT_IN_DROPBOX` before anything runs. A working copy, or with none the newest master, of
  another TIA version is refused `WRONG_TIA_VERSION` before TIA is asked anything. A version that
  cannot be read from the name is refused the same way. It is never
  retrieved, copied, opened or upgraded, so a master cannot become a newer TIA version by accident.
  When TIA has another project open it refuses `NOT_WORKING_COPY` before anything is opened,
  closed, saved or copied, and again if one is opened while the master downloads. When the working copy
  `<repo>\<nn> <name>\Project\` is absent, it makes it from the newest master: a `.zap` through
  `Projects.Retrieve`, or a copy of an `.ap` project folder. Either is made in
  `<repo>\<nn> <name>\.pachub\staging\` and moved into `Project\` only once complete, so a copy
  cut short is never taken for a working copy. A retrieved working copy has the archive's file
  name recorded in `<repo>\<nn> <name>\.pachub\retrieved-from` once it is in `Project\`, and
  every prepare answers it as `retrieved_from` (null for a copied one), not only the one that
  retrieved, so a failure after the move or a later Start never loses it.
  Making a new working copy (from a `.zap` or an `.ap` folder) also deletes the old copy's base,
  `<repo>\<nn> <name>\.pachub\base`, with the old `retrieved-from`: kept, `base --from-archive` would
  keep it, and the next Start could commit "as found" a master older than git, reverting committed
  work. A working copy used as is keeps both.
  Leftover staging is cleared at the next prepare; staging still held by an unfinished copy is
  `DROPBOX_NOT_LOCAL` ("try again in a minute"). It opens the working copy when TIA has nothing open, refuses
  `MULTI_PLC_PROJECT`, records the PLC in `job.json` (doc code; CPU order number as the model), and
  creates the `Pac Hub` VCI workspace at `Export\` (not on V18). An online-only Dropbox file is
  downloaded by reading it; one that will not download is `DROPBOX_NOT_LOCAL`.
- **`POST /tia/project/archive`** `{ target_dir, file_name, working_copy_path }`. Archives the
  open working copy (`Project.Archive`, compressed) as `<file_name>.zap<edition>` into its PLC's
  Dropbox folder. `target_dir` must be a `50 PLC\<nn> <name>` folder that exists (it is never
  created; one that is not on this workstation is `DROPBOX_NOT_LOCAL`), and the working copy's
  PLC folder (the parent of its `Project\`) must have the same name and lie outside Dropbox
  (`JOBS_ROOT_IN_DROPBOX`). TIA writes the archive
  outside Dropbox, in `<plc>\.pachub\archive-staging\`, and only the finished file is put in the
  Dropbox folder, in one rename that fails when the name is taken (from another volume: a copy
  under a `.pachub-partial` name, then that rename). So a partial archive never shows in Dropbox
  as anybody's newest master. A file already there is refused `ARCHIVE_EXISTS`, before TIA is
  asked anything and again at the rename, and nothing is overwritten. An open project that is not
  `working_copy_path` is refused `NOT_WORKING_COPY`. A TIA failure (unsaved changes, say) answers
  500 in TIA's words, as does an archive TIA did not write. Success is only ever the file at its
  target. TIA is never started to archive: with none running, or no project open, it answers 500.
- **Bridge shutdown never closes a project** (`TiaPortalService.Dispose`). It used to close the
  open project, discarding the engineer's unsaved changes, on every bridge stop. Now it only
  disposes the TiaPortal object: an attached TIA is detached and keeps running with its project
  untouched. A TIA the bridge started itself (no TIA was running when it connected) still exits
  with the bridge.
- **`/tia/status` `pac_hub_vc_version`**: `pac-hub-vc --version`, absent when it is not installed
  (prepare then refuses `VC_TOOL_MISSING`, as it does for a missing git, gh or Node).
- Refusals answer `409 { success:false, refused, message }`. Bad input (fields missing, a
  `dropbox_job_path` or `target_dir` that is absolute or leaves Dropbox, a `target_dir` that is not
  a `50 PLC\<nn> <name>` folder, a `plc_folder` that is not in `50 PLC`, a `file_name` that is not
  a file name, a `working_copy_path` that is malformed or in no PLC folder's `Project\`, or one
  whose PLC folder is not the target's) answers `400 { success:false, message }`.
  A named refusal from `pac-hub-vc ensure` (`REPO_NOT_FAST_FORWARD`, `REPO_NOT_ON_MAIN`,
  `GITHUB_UNAVAILABLE`, `VC_TOOL_MISSING`) passes through under its name. An ensure with no JSON
  result (a usage error prints none, even under `--json`) is a 500 carrying its exit code and
  stderr, never a success.
  `PAC_DROPBOX_ROOT` overrides the Dropbox root read from `%LOCALAPPDATA%\Dropbox\info.json`
  (`business.root_path`).
- **`pac-hub-vc` is started directly, never through cmd.exe** (`PacHubVc`). A `pac-hub-vc.cmd`
  shim on PATH is read for the script it names, which `node.exe` runs. Each argument is quoted by the
  `CommandLineToArgvW` rules. `PAC_HUB_VC` names the CLI's `bin\pac-hub-vc.mjs` (or an exe) instead.
  A run never outlasts its timeout. That holds while its output is drained too, even when a process it
  started keeps that output open.
- **`POST /tia/vc/check`** `{ repo_path, plc_folder, retrieved_from? }` (PHUB-232 §6). With
  `retrieved_from` (the archive prepare retrieved the working copy from) it first has
  `pac-hub-vc base --from-archive` record that archive's base when none is recorded. Then it exports
  the whole PLC (blocks, PLC data types, tag tables; SimaticML, never SIMATIC SD; an SCL block as SCL
  where TIA offers it) through the `Pac Hub` VCI workspace into `<repo>\<plc>\Export\`, removes export
  files no object wrote any more (a deleted object reads as a deletion), and runs
  `pac-hub-vc status --json`. An object VCI has not mapped yet whose file is already in `Export\` (git
  has it from another workstation) is connected to that file, in that file's format, and written over,
  so its format in git never changes. A block or type that does not compile refuses the export before
  anything is written (`export: refused_not_compiling`, named in `not_compiling`) and the state is
  `unverified` / `unverified_behind` (base against latest only; `diverged` stays `diverged`).
  Know-how-protected blocks and types, any object TIA offers no SimaticML format for (an F-block,
  say), and any whose `ExportObject` / `ConnectObject` throws although a format was offered, are named
  in `skipped` and never fail the export (check or commit); their files in git are kept, in every area,
  and a file a failed export left where the object had none is removed.
  Answers `{ success, state, export, base, latest, latest_author, latest_date, local_changes,
  newer_changes: [{ object, author, sha }], skipped, not_compiling, saved }`; a status with no state
  Pac Hub knows is refused, never guessed.
- **`POST /tia/vc/commit`** `{ repo_path, plc_folder, objects: [{ kind: block|tag_table, name }],
  changes, subject, author_name, author_email, agent, expect_base? }` (§7). Exports only the objects a change
  touched and runs `pac-hub-vc commit --change … --agent … --subject … --author … --push --json`. With
  `expect_base` (the conversation's base: 40 lowercase hex digits, anything else 400) it adds
  `--expect-base <sha>`, so pac-hub-vc commits only while HEAD is still that commit; its refusal
  (`outcome: refused`, `HEAD_MOVED: …`, nothing staged) answers `outcome: failed` with that reason
  verbatim. Without it there is no guard. A block
  that does not compile answers `outcome: deferred`; anything pac-hub-vc could not do is
  `outcome: failed` with its reason; `committed` answers `committed` with its `sha`, and nothing new
  (`idle`) answers `committed` with no `sha` and pac-hub-vc's reason when it gives one (an earlier
  offline commit whose push was rejected keeps `remote moved; not fast-forward`), else `no changes`.
  A push the remote rejected stays a local commit (`pushed: false`, pac-hub-vc's reason untouched,
  never a pull or a force). A block the change deleted (none of that name, in any case, is left in
  TIA) has its export file removed, so the deletion lands in this commit. Objects not exported are
  named in `skipped`. `--author` goes only with both a name and an email. Free text is flattened to
  one line and passed verbatim through `PacHubVc` (new `PacHubVc.Json`).
- **`POST /tia/vc/update`** `{ repo_path, plc_folder }` (§6, Update from Git). Exports, lets
  `pac-hub-vc update` fast-forward the repo and list the changed files, imports them with the existing
  paths (import-scl, reimport-blocks, type and tag-table import; a deleted object is deleted; anything
  else, a technology object say, is named in `not_imported`), compiles, saves, and has
  `pac-hub-vc base --set` record the base only when every file landed and is saved. A new block at the
  root of Program blocks lands at the root (never in a user group named "Program blocks"), and one
  under a root user group that is itself called "Program blocks" lands in that group, not one level
  up: `GetOrCreateBlockGroup` strips exactly one leading `Program blocks/` and is handed the same
  `Program blocks/<groups>` folder on the SimaticML path as on the SCL path; `deleted`
  names only objects that were in TIA. Answers `{ success, imported, deleted, not_imported, compile,
  base_written, saved }`; `already up to date` when there is nothing newer.
- The three version-control routes run only on the PLC's working copy: the project TIA has open must
  be under `<repo>\<plc>\Project\`, else `NOT_WORKING_COPY` (checked again before each import, the
  compile and the save of an update), so nothing is exported from, imported into or saved over
  another project. They attach to a running TIA only and have no start path: with none running, or
  no project open, they answer 409 saying so. `repo_path` must be a job repo under the jobs root and
  `plc_folder` one of its `<nn> <name>` folders, both existing, else 400. They take the VC lock, as
  prepare and archive do; no git runs in the bridge. A refusal answers 409 `{ success:false, refused?,
  message }` (`refused` only for a name Pac Hub knows: `NOT_WORKING_COPY`, `VC_TOOL_MISSING`,
  `REPO_NOT_FAST_FORWARD`, `VC_DIVERGED`, `VC_BEHIND`; any other pac-hub-vc refusal is its message),
  plus update's own `UNSAVED_CHANGES`.
- **Ruling 34: VCI work never leaves the working copy unsaved behind the engineer's back.** Check,
  commit and update read `Project.IsModified` before any VCI work. Afterwards, on every path
  (failures and early returns included), a working copy that had no unsaved changes and has some now
  is saved, because only this route changed it (`saved: true`). A route that fails after the bridge
  saved the copy (Update from Git's own save, or the save after VCI work that threw) still says
  `saved: true` on its 409 or 500. One that had unsaved changes before is
  never saved: they are the engineer's. Update from Git refuses such a copy up front, 409
  `refused: UNSAVED_CHANGES` ("save the project in TIA, then press Update from Git again"): nothing
  is exported, imported or compiled, and the base is not recorded. The name is given only when the
  flag really reads true: a modified flag the bridge cannot read is refused the same way with no name,
  in words that say it could not read the project's modified flag (and such a copy is never saved).
- **Cross-origin guard on the new routes.** `/tia/vc/*` and `/tia/project/archive` answer 403
  `{ success:false, message }` ("… refuses a request from a web page …") to any request that carries an
  `Origin` header, unless it presents a valid bridge token; with no token configured they always do. The
  bridge sends `Access-Control-Allow-Origin: *` and the token is optional, so without this any web page
  could post to them drive-by: commit and push, prepare's `gh repo create` and clone, an archive into
  Dropbox. Pac Hub calls them from its server and sends no `Origin`, so it is unaffected. Every older
  route answers as in 1.12.x.
- **V18 bridges do not support version-controlled conversations** (the bridge drives VCI on V20 and
  later only): the V18 build answers all three routes 409 "Version control export needs TIA Portal V20 or later;
  this bridge is built for V18.", so Pac Hub's Start, which runs the check, refuses on a V18 bridge.
- `pac-hub-vc`'s JSON is read with strings kept as printed: an ISO date such as status's `latestDate`
  is no longer turned into a `DateTime` and back into this machine's local format.

## 1.12.2 — 2026-10-01

- **SCL imports never delete an engineer's external source** (PHUB-231). Every SCL import
  (`import-scl`, `reimport-compile`, `/tia/jobs`, provision) goes through `ImportArtifact`, which
  first deleted any external source named like the block — an engineer's own included — then
  created its own under that name and deleted it. It now creates its temporary source as
  `<block>__pachub_<8 hex>` and deletes only that one, also when generation throws; an external
  source already in the project is never found, replaced or deleted. A temporary source that
  cannot be deleted is logged, not reported as a failed import (the blocks were generated).
  Pac Hub's PLC conversation requires 1.12.2.

## 1.12.1 — 2026-09-30

- **`POST /tia/migration/reimport-blocks`** replaces a block in the folder that holds it, so a
  LAD/FBD edit or a revert of a block in a subfolder no longer fails with "already exists" or leaves
  a duplicate in the root (PHUB-231). New blocks still go to the root.

## 1.12.0 — 2026-09-30

Compile and save as their own routes, so Pac Hub's PLC conversation can write a change, compile
it and save it without `reimport-compile`, which deletes a block before importing it (PHUB-231).

- **`POST /tia/compile`** — compiles the PLC software and answers `CompileResultDto`. Imports,
  deletes and saves nothing.
- **`POST /tia/save`** — saves the open project.
- **`import-scl` `folders`** — block name → destination folder; absent keeps `"Program blocks"`.
- **`export-block-xml`** — finds a block in any subfolder when no folder is given, so a read never
  names (and so never creates) a folder.

## 1.11.0 — 2026-09-29

Mesh bind and bearer token, so the hosted Pac Hub can compile on an engineer's own
bridge over NetBird (PHUB-210). Defaults are unchanged: no flags = `localhost` only, no auth.

- **`--bind <host>`** — adds `http://<host>:{port}/` to the listener. `localhost` is always
  kept, so local tools still work. **`--bind mesh`** finds this machine's NetBird address
  (the `wt0` adapter, else the first IPv4 in `100.64.0.0/10`) and binds that; it exits with
  a message if NetBird is not connected.
- **`--token <value>`** or env **`PAC_BRIDGE_TOKEN`** — when set, every request except
  `GET /tia/status` must carry `Authorization: Bearer <value>`; otherwise **401**
  `{"error":"unauthorised"}`. Compared in constant time (SHA-256 digests). This includes
  localhost callers and `/tia/ws`, so a local tool talking to a token-protected bridge must
  send the header too.
- **One-time URL reservation.** Binding a non-localhost address as a normal user needs a
  urlacl. Without it `HttpListener` fails with access denied, and the bridge prints the
  exact command. Run it once per machine, elevated:

  ```
  netsh http add urlacl url=http://<netbird-ip>:<port>/ user=Everyone
  ```

  then start the bridge: `PacForgeBridge.exe --bind mesh --token <token>`
  (ports: V20 5102, V18 5103, V21 5104). If the machine's NetBird address changes, add a
  reservation for the new one.
- CORS now allows the `Authorization` header.

## 1.10.0 — 2026-09-04

TIA Portal **V21** build — `PacForgeBridge.V21.csproj`, define `TIA_V21`, port **5104**
(G9-W13). Sits beside the V20 build (5102) and the V18 twin (5103).

- **V21 Openness is split into per-product assemblies** under
  `Portal V21\PublicAPI\V21\net48\`: `Siemens.Engineering.Base` (core, Compiler,
  Download, Library, HW), `.Step7` (SW.*, HW.Features), `.WinCC` (classic `Hmi.*`)
  and `.WinCCUnified` (`HmiUnified.*`). There is no `Siemens.Engineering.dll` or
  `Siemens.Engineering.Hmi.dll`. The csproj references the four directly with
  `Private=false`; `App.config` carries a `codeBase` per assembly with the **new
  public key token `29bfe5fdf4ba5d3b`** (V20's was `d29ec89bac048f84`).
- **`IsSimulationDuringBlockCompilationEnabled` moved** off `ProjectBase` onto the
  `Siemens.Engineering.SW.PlcSimulationSettingsProvider` service —
  `_project.GetService<PlcSimulationSettingsProvider>()`. Only API change needed;
  every namespace the bridge imports still exists.
- `DetectInstalledVersion()` reports `V21`; `FindWinccGraphicsZip()` looks in
  `Portal V21` first; the `*.ap*` resolver message names `.ap21`.
- The `Siemens.Collaboration.Net` Openness.Extensions NuGet (pinned `20.*`, never
  used in code) is left out of this build. PLCSIM Advanced 7.0 reference unchanged.
- Build with `dotnet build bridge/PacForgeBridge/PacForgeBridge.V21.csproj` (the
  three projects share `obj/`, so build them one at a time).

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
