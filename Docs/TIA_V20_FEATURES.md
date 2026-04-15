# TIA Portal V20 — Features Available

What Pac Technologies engineers now have access to after upgrading from V18. Covers the cumulative V18 → V19 → V20 delta, plus PLCSIM Advanced 6.0 since it's now wired into Pac-Forge.

Sources: local V18 / V19 system manuals, official V20 docs at `docs.tia.siemens.cloud`, Siemens V20 technical slides.

---

## TL;DR — the things most worth knowing

1. **Human-readable LAD/FBD text format** — ladder logic can now be exported and imported as text, not just SimaticML. Enables git diff on LAD code.
2. **WinCC Unified has first-class Openness** — new `Siemens.Engineering.HmiUnified` namespace with `HmiSoftware` class. Unified finally has parity with Comfort panels for programmatic access.
3. **PLCSIM Advanced 6.0 managed .NET API** — first-party replacement for the C++/CLI wrapper. Pac-Forge bridge already swapped over (IMP-03).
4. **Continuous Integration APIs** — new document-based import/export formats, multi-user workflow automation, Test Suite Advanced integration.
5. **S7-1200 G2 support** — new CPU family with PLCSIM Advanced simulation support.
6. **20–40% faster compile** than V18.
7. **Version Control Interface (VCI)** — fully exposed via both the TIA Portal UI and Openness. V18 had partial coverage, V20 is complete.

---

## Openness API additions

### From V18 to V19

**PLC programming**
- Import any SimaticML version with any API version (no more version-pin per assembly)
- Flexible SimaticML import options for handling project languages
- Configure S7-1500 blocks in **virtual PLCs**
- Read/write additional columns in data blocks
- Virtual-PLC support attribute on blocks
- **Named Value Types** in SimaticML + named-value constants in block export/import

**Hardware config**
- PLC-PLC transfer areas CRUD
- PLC system logging configuration
- CPU firmware 3.1 UMAC + access levels
- Default language for OPC UA alarms/events
- New modules: ET200pro/eco PN/MP Safety; SCALANCE XC-200, XP-200, SC-600

**CAx exchange**
- AutomationML round-trip via API (no more log-file scraping)

**Online scenarios**
- Enumerate accessible devices for download/upload
- Download PLC + Safety to memory-card folder
- UMAC credential handling for online access

**Technology objects**
- Groups support
- Import/export interpreter program files

**Test Suite Advanced**
- OPC UA settings for system tests
- Master-copy support

### From V19 to V20

**The Unified HMI breakthrough**
- New `Siemens.Engineering.HmiUnified` namespace
- `HmiSoftware` class — equivalent of `HmiTarget` for Unified
- Access to runtime Unified device data
- First release where Unified has true Openness parity with Comfort panels

**Code generation**
- **Human-readable LAD/FBD text format** — import/export as text, not just SimaticML XML. Enables real git diff workflows for ladder logic.
- **Document-based import/export formats** for Continuous Integration

**Library management**
- Programmatic library type creation and management
- Extended library workflow APIs

**Continuous Integration / Continuous Testing**
- Multi-user workflow automation
- Test Suite Advanced integration
- APIs specifically scoped for CI/CD pipelines

**Hardware config + module parameters**
- Extended access across more parameter categories

**Version Control Interface (VCI)**
- Full feature parity between UI and Openness API

**Add-Ins (runs inside TIA Portal, not bridge)**
- Multilingual Add-Ins that follow the TIA UI language
- Icons in context menu Add-In entries
- No more display timeouts on context menus

---

## Code generation — new language and block capabilities

| Capability | V18 | V19 | V20 |
|---|---|---|---|
| SCL import/export | ✓ | ✓ | ✓ |
| LAD/FBD SimaticML XML | ✓ | ✓ | ✓ |
| **LAD/FBD as human-readable text** | — | — | ✓ |
| Named Value Types in blocks | — | ✓ | ✓ |
| Virtual-PLC block configuration | — | ✓ | ✓ |
| Block fingerprint with `ProgramCode` (no comments) | ✓ | ✓ | ✓ |
| `NamespacePreset` on Software Units | ✓ | ✓ | ✓ |
| Update blocks to latest instruction versions | ✓ | ✓ | ✓ |
| Cross-reference (XREF) read-out | ✓ | ✓ | ✓ |

Pac-Forge impact: the LAD text format is the biggest win — we can potentially eliminate the whole `lad-xml-builder.ts` SimaticML generation path once we can emit text directly. Parked for now, but worth revisiting.

---

## WinCC Unified — now programmable

Pre-V20 state: Unified panels could be edited in TIA but had almost no Openness surface. We had to use `HmiTarget` tricks that only worked on Comfort.

V20 state:
- **`Siemens.Engineering.HmiUnified`** namespace — full managed API
- **`HmiSoftware`** class — discovery via `container?.Software is HmiSoftware hmi`
- Runtime Unified device data access (tags, alarms, screen tree)
- Typed NuGet helpers: `Siemens.Collaboration.Net.TiaPortal.Openness.Hmi.Extensions 20.0.x` (installed in our bridge already)
- Custom Web Control (CWC) import automation
- Support for all screen items, including custom web controls and dynamic SVGs (added in V18, still there)
- Tag table import/export, screen/tag table groups

Pac-Forge impact: unblocks the HMI Builder rebuild for Unified. The `useFbLibraryImport` flow and `hmi-editor.tsx` generation can now emit Unified projects as well as Comfort.

---

## Safety engineering

From V18 onwards:
- Create/configure/delete Safety Runtime Groups (RTG)
- Manage "Generate default fail-safe program" and "Manage fail-safe in Software Units"
- Read access to Safety property of PLC tags
- Safety Software Unit management
- Global F-IO status block generation
- Write access for SAE (Safety Administration Editor) attributes (pre-existing)
- Safety password set/reset/lock/unlock (pre-existing)

V19 added:
- Configure F-PLC serial numbers for unique identification

V20 adds:
- (no major new safety API — feature-complete from V19 baseline)

Pac-Forge impact: our generation pipeline doesn't produce safety blocks yet, but the API is ready when we add safety support.

---

## Libraries

V18 baseline:
- Detailed compare of libraries or single master copies, types, versions
- Set update property for single types in global library
- Harmonize project, clean up library, force update
- Read/set default version of library types
- Read library-type status info

V19 adds:
- (incremental improvements only)

V20 adds:
- Programmatic library type creation and management
- Extended workflows for library processes

Pac-Forge impact: our `fb-templates` flow already uses the V18 library API surface. V20 additions enable programmatic type creation — relevant if we ever want the generation pipeline to auto-publish generated FBs to a shared global library.

---

## Multi-user and Version Control

V18 baseline (already present from V17):
- Multi-user sessions: create, modify, delete server connections
- Session lifecycle: create, open, save, close
- Server project view and exclusive sessions
- Protected projects (UMAC) activation and user/role config

V19 adds:
- CPU firmware 3.1 UMAC + access level management
- UMAC credential provisioning for online access
- Project user alias names

V20 adds:
- **Version Control Interface (VCI) full parity between UI and Openness** — previously some VCI operations were UI-only
- Continuous Integration support built on top of VCI + multi-user workflows

Pac-Forge impact: we could add VCI-driven workflows to push generated code through a git-backed review cycle before import. Currently Pac-Forge imports directly; this gives us an option for a more formal pipeline.

---

## Hardware configuration

V18 baseline:
- Read access to TIA hardware catalog
- Change device, bulk SetAttributes in correct ordering
- ET200pro/MP/eco PN, Push Buttons, HMI Extension Units parameter access
- Configurable error handling for SetAttributes (HWCN objects)

V19 adds:
- PLC-PLC transfer areas CRUD
- PLC system logging configuration
- More modules: ET200 Safety variants, SCALANCE XC-200 / XP-200 / SC-600
- Bulk SetAttributes in all overloaded methods

V20 adds:
- **S7-1200 G2 family** support (new CPU generation)
- Extended parameter access across more module categories

Pac-Forge impact: the spec-builder hardware-io step can now resolve to a wider range of modules without manual overrides.

---

## CAx / AutomationML exchange

V18 baseline:
- IO-Link data via PCT
- Siemens HW parameters and channel properties
- AML specification AR APC v1.2
- Safety Base Units for ET200SP
- Normalized MLFB export

V19 adds:
- Import/Export CAx data via AutomationML with **results returned via API** (not log file)
- Additional hardware attributes

V20 adds:
- (stable — no major new CAx surface)

Pac-Forge impact: the IO validation pipeline can pull richer module metadata directly. Worth considering when we rework `use-forge-io-validate.ts`.

---

## Technology objects (Motion Control)

V18 baseline:
- Basic TO support

V19 adds:
- Groups support for TOs
- Import/export interpreter program files

V20 adds:
- (stable)

Pac-Forge impact: no direct impact yet. Relevant if we extend the generator to motion-control projects.

---

## Test Suite Advanced

V18 baseline:
- Create + execute system tests
- Rule set + test case export/import (from V17)
- Test case execution and results as .NET objects

V19 adds:
- OPC UA settings for system tests
- Application test modes
- Master-copy support

V20 adds:
- Part of the Continuous Integration / Continuous Testing APIs
- Structured integration with VCI workflows

Pac-Forge impact: we currently use PLCSIM Advanced for runtime tests. Test Suite Advanced is a separate product layer with rule-set + style-check support. Potential future path: a "Standards Reviewer" agent that exports its review findings directly as Test Suite rule sets.

---

## Startdrive (SINAMICS integration)

V18 baseline:
- Third-party rotary motors on CU3x0-2 drives
- SINAMICS TEC (Technology Extensions) full lifecycle

V19 adds:
- Connect TO to Startdrive telegram
- Read hardware ID from Startdrive telegram
- New Startdrive devices
- Third-party encoder parameterization

V20 adds:
- (incremental)

Pac-Forge impact: not currently in scope. Would matter if we add drive configuration to the pipeline.

---

## Teamcenter Gateway (PLM integration)

Available from V18 onwards:
- Dataset lock/unlock from Teamcenter
- Connect/disconnect
- Search and download projects and libraries from Teamcenter
- Save project/library back to Teamcenter

Pac-Forge impact: relevant for enterprise customers on Teamcenter PLM. Would plug into our project import flow.

---

## PLCSIM Advanced 6.0 — managed .NET API

Now directly consumable from Pac-Forge bridge. Installed at:
```
C:\Program Files (x86)\Common Files\Siemens\PLCSIMADV\API\6.0\
  Siemens.Simatic.Simulation.Runtime.Api.x64.dll
  Siemens.Simatic.Simulation.Runtime.Api.x86.dll
  SimulationRuntimeApi.h
```

Namespace: `Siemens.Simatic.Simulation.Runtime`

Key types the bridge now uses:
- `SimulationRuntimeManager` — static facade, `RegisterInstance(ECPUType, name)`
- `IInstance` — full lifecycle (`PowerOn`, `PowerOff`, `Run`, `Stop`, `MemoryReset`, `UpdateTagList`, `UnregisterInstance`)
- `IIOArea` — `InputArea`, `OutputArea`, `MarkerArea` properties for raw byte access
- `ECPUType` — enum covering every S7-1500 variant including failsafe, ET200SP/PRO, T/TF, SW-OC, RH, MFP, G2
- `EOperatingState` — `Off`, `Booting`, `Stop`, `Startup`, `Run`, `Freeze`, `ShuttingDown`, `Hold`
- `SimulationRuntimeException` — thrown on errors, carries `RuntimeErrorCode`

Supported CPU families in V6.0 (all selectable via `ECPUType` in the bridge):

**S7-1500 standard**
- CPU1511 / CPU1513 / CPU1515 / CPU1516 / CPU1517 / CPU1518
- Failsafe variants: CPU1511F / CPU1513F / CPU1515F / CPU1516F / CPU1517F / CPU1518F
- Compact: CPU1511C / CPU1512C
- Technology: CPU1511T / CPU1515T / CPU1516T / CPU1517T / CPU1518T
- Tech + Failsafe: CPU1511TF / CPU1515TF / CPU1516TF / CPU1517TF / CPU1518TF

**ET 200SP**
- CPU1510SP / CPU1512SP / CPU1514SP / CPU1514SPT
- Failsafe: CPU1510SPF / CPU1512SPF / CPU1514SPF / CPU1514SPTF
- Process Automation: CPU1514PA

**ET 200PRO**
- CPU1513PRO / CPU1516PRO
- Failsafe: CPU1513PROF / CPU1516PROF
- Multi-Fieldbus: CPU1518MFP / CPU1518FMFP

**R/H (Redundancy / High availability)**
- CPU1513R / CPU1515R / CPU1517H / CPU1518HF

**Software controllers**
- CPU1505SP / CPU1507S / CPU1508S
- Failsafe: CPU1505SPF / CPU1507SF / CPU1508SF
- Tech: CPU1505SPT / CPU1508ST
- Tech + Failsafe: CPU1505SPTF / CPU1508STF

**ODK (Open Development Kit)**
- CPU1518ODK / CPU1518FODK

**Distributed/Tech/Failsafe combos**
- CPU1504DTF / CPU1507DTF

Bridge implementation: `bridge/PacForgeBridge/PlcsimService.cs` — public surface unchanged from the old C++/CLI wrapper, so `JobExecutor.cs` and all HTTP handlers continue working without modification.

Benefits over the old C++/CLI wrapper:
- Bridge builds with plain `dotnet build` — no Visual C++ toolchain required
- Siemens-maintained; automatic updates via Common Files on PLCSIM Advanced upgrades
- 668 lines of C++/CLI glue code removed from the repo
- Type-safe enum access (no more hex constants with `(ECPUType)cpuType` casts)

---

## Performance and runtime

From V20:
- **20–40% faster compile times** than V18
- **TIA Portal Test Suite** runtime improvements
- Openness connection startup faster (less DLL load overhead)

---

## What Pac-Forge is using vs. what's still on the table

### Already wired up
| Feature | Location |
|---|---|
| V20 Openness base API | `bridge/PacForgeBridge.csproj` HintPath |
| `Openness.Extensions 20.0.x` NuGet | `bridge/PacForgeBridge.csproj` |
| `Openness.Hmi.Extensions 20.0.x` NuGet | `bridge/PacForgeBridge.csproj` |
| PLCSIM Advanced 6.0 managed API | `bridge/PacForgeBridge/PlcsimService.cs` |
| V20-default project defaults | `src/components/project-form.tsx`, `src/components/forge/steps/forge-project-setup.tsx`, misc defaults in `src/lib/hmi-xml-builder.ts`, `src/lib/forge-export.ts`, `src/lib/lad-xml-builder.ts` |
| V20 migrate prompts | `src/lib/migrate-prompts.ts`, `src/lib/migrate-compile-fix-prompt.ts` |

### Available but not yet wired up (on the backlog)
| Feature | Why it matters |
|---|---|
| Human-readable LAD text format | Could replace `lad-xml-builder.ts` SimaticML generation. Enables git-diffable ladder output. |
| `Siemens.Engineering.HmiUnified` namespace | Required for HMI Builder Unified rebuild (`src/routes/hmi-editor.tsx`) |
| Programmatic library type creation | Future: auto-publish generated FBs as shared library types |
| Version Control Interface full Openness | Future: git-backed review cycle before import |
| Test Suite Advanced integration | Future: Standards Reviewer agent exports findings as rule sets |
| Continuous Integration document formats | Future: formal CI/CD pipeline for generated projects |
| S7-1200 G2 CPU family | Future: expand CPU support beyond S7-1500 |
| AutomationML CAx round-trip API | IO validation enhancement (`use-forge-io-validate.ts`) |

### Explicitly skipped
| Feature | Why |
|---|---|
| V19-specific features | We're on V20 now; V19 would only matter if we sell the software commercially and need multi-version support |
| TIA Portal Add-In framework | Deferred until we pick which Pac-Forge feature ships as an in-TIA Add-In |
| Teamcenter Gateway | Not in scope unless an enterprise customer needs PLM integration |
| Startdrive (SINAMICS) | Not in scope unless we add drive config to the pipeline |
| Technology objects (motion control) | Not in scope |

---

## Compatibility notes

- **Project migration is one-way**: V20 projects cannot be saved back to V18 or V19. Keep V18 installed in parallel if you need to open old customer projects.
- **API assembly back-compat**: V18 / V19 DLLs also ship with V20 install under `Portal V20\PublicAPI\V18\` and `V19\` for running older Openness clients without modification.
- **.NET Framework 4.8** requirement unchanged — our bridge already targets `net481`.
- **V20 Openness clients built against .NET Framework 4.6.1** still load in V20 if the client app targets 4.6.1. We recompile for 4.8 anyway.
