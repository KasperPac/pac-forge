# Pac-Forge System Overview

> **Purpose:** Comprehensive reference for the Pac-Forge feature set — what each system does, how it works, how they interact, and what is still planned. Written from the codebase state on the `feature/assembly-fb-library` branch (2026-04-29).

---

## Table of Contents

1. [FDS Builder](#1-fds-builder)
2. [Forge Wizard](#2-forge-wizard)
3. [FDS Builder ↔ Forge Wizard Integration](#3-fds-builder--forge-wizard-integration)
4. [HMI Builder](#4-hmi-builder)
5. [Pattern Librarian](#5-pattern-librarian)
6. [Multi-Agent Pipeline](#6-multi-agent-pipeline)
7. [Assembly FB Library](#7-assembly-fb-library)
8. [Planned Changes Not Yet Implemented](#8-planned-changes-not-yet-implemented)

---

## 1. FDS Builder

### What It Is

The FDS (Functional Description Specification) Builder is the **design-engineering side** of Pac-Forge. It is an AI-assisted authoring environment for producing industrial automation functional specification documents — the same documents a senior engineer would write by hand before a TIA Portal project begins.

Its output is not just a document — it is a structured, machine-readable specification that directly drives the Forge Wizard's code generation. The philosophy: **the FDS IS the engineering**. The Forge Wizard is just the coding engineer that receives the handoff.

Route: `/specs` (spec list + phase dashboard), with sub-routes per phase.

---

### Phases and User Flow

The FDS Builder is a six-phase linear workflow. Each phase unlocks the next.

#### Phase 1 — Instrument Register Upload

The user uploads an IO spreadsheet (CSV or Excel) listing all physical signals. The system uses Claude Haiku to classify each tag (input/output, signal type, device class). This register becomes the authoritative tag source for the entire spec — all subsequent phases reference it for tag validation.

**User inputs required:**
- IO spreadsheet file (CSV/Excel)

**What happens:** Tags are parsed, classified, and stored. The instrument register persists against the spec project.

---

#### Phase 2 — Spec Skeleton Wizard

A 6-step guided form that captures the machine hierarchy and operating philosophy. The user defines:

- **System** — the full machine/production line
- **Subsystems** — functional stations (e.g. "Infeed Conveyor Station", "Hydraulic Lift Station")
- **Assemblies** per subsystem — coordinated groups of devices (e.g. "LFT01 Lift Table", "CV01 Conveyor")
- **Devices** per assembly — individual physical things (e.g. motor M01, limit switch LS_TOP)
- **Operating States** — the named operating modes the machine can be in (e.g. AUTO, MANUAL, ESTOP, CLEANING). Each state is classified as either `static` (outputs held in a fixed position) or `sequential` (a step sequence executes)
- **Alarm Tiers** — severity levels and their escalation rules

Claude Sonnet is used once to infer likely operating states from the machine description if the user wants suggestions.

**User inputs required:**
- Machine name and description
- Subsystem names and descriptions
- Assembly names, which devices belong to each
- Device names, types (motor/VFD/solenoid/sensor/etc.), and IO signal assignments from the instrument register
- Operating state names and classification (static/sequential)
- Alarm tier definitions

---

#### Phase 3 — FDS Co-Authoring (Main Authoring Phase)

Route: `/specs/:projectId/:specId/co-author`

This is the core of the FDS Builder. The engineer works through each assembly one at a time, co-authoring its behavioral specification with Claude.

**Sidebar:** Lists all subsystems → assemblies in a tree. Status icons show progress per assembly (not started / static confirmed / in progress / complete). A progress bar shows N/total assemblies done.

**For each assembly, two stages:**

**Stage 1 — Static State Review**

For every *static* operating state (e.g. AUTO, ESTOP), the system auto-fills what each device output should be (STOP/DE-ENERGISED/0/OFF etc.) using deterministic rules based on device class. The engineer reviews a table of device × state entries and can change any value. When satisfied, they click **Confirm Static States** to lock this stage and proceed.

*No AI is involved in Stage 1 — it is entirely deterministic.*

**Stage 2 — Sequential State Co-Authoring**

For every *sequential* operating state (e.g. AUTO_RUN), the engineer conducts a structured AI interview with Claude Sonnet. The AI follows a deterministic protocol — gathering one field at a time in a defined order:

1. Permissive conditions (what must be true before the sequence can start)
2. Step-by-step sequence (each step: output tag, condition to advance, completion criteria, timeout, fault path)
3. Fault handling
4. Alarm conditions

The AI updates a live structured table (`FdsTablePane`) as the conversation progresses. The table shows: Step | Condition | Output | Next | controls. The engineer can edit cells directly in the table without going through the chat. Tags are picked from the instrument register via a tag picker popover.

When the engineer is satisfied, they click **Mark Complete**. A deterministic logic checker (`fds-logic-checker.ts`) runs immediately — validating tag coverage, completion criteria, permissive references against the instrument register, and fault path presence. Issues are shown in a bottom drawer. The engineer can mark complete with warnings or fix them first.

**Duplicate feature:** For assemblies that are structurally identical (same device class + IO signal count), the engineer can clone a completed assembly's behavioral data and remap tags automatically. This is the main time-saver for machines with repeated assembly types.

**Random FDS generation:** A "Generate Random FDS" dialog (three sliders: subsystems, assemblies, devices) generates a complete fake machine spec via a single AI call — used for development and demos.

**User inputs required:**
- For each assembly: review/confirm static state values
- For each assembly: answer the AI's interview questions about the sequential operating logic, or type them directly into the table
- Tag selections from the instrument register picker

---

#### Phase 4 — System Orchestration

Route: `/specs/:projectId/:specId/system-orchestration`

After all per-assembly sessions are complete, the engineer defines how subsystems coordinate with each other at the system level. This is done via an AI conversation at the subsystem-to-subsystem level (not device/assembly level).

**Left pane:** Streaming AI conversation. The AI asks about subsystem ordering for each operating state, shared permissives across subsystems, and inter-subsystem interlocks (e.g. "Subsystem A must finish its AUTO_RUN sequence before Subsystem B can start").

**Right pane:** Tabbed view — Overview (graph visualization of subsystem relationships) and per-state editors (subsystem ordering drag-reorder, shared permissives form, inter-subsystem interlock form).

The interlock model supports five effects: `hold`, `block_transition`, `trigger`, `enable`, `disable`.

The AI validates its own output before persisting. Validation errors are shown inline.

**User inputs required:**
- Subsystem execution order per operating state
- Shared permissive conditions
- Inter-subsystem interlock definitions

---

#### Phase 5 — Structured Spec Editor

Route: `/specs/:projectId/:specId/editor`

Unlocks only after all FDS sessions are `complete` and sections have been composed (via `composeFdsToSections()`). A document tree navigator on the left, section-by-section approval flow on the right. The compose step merges all assembly sessions into `spec_sections` rows, respecting assembly ordering from the orchestration layer and merging shared permissives.

---

#### Phase 6 — DOCX Export

Route: `/specs/:projectId/:specId/export`

Exports the approved spec as a formatted Word document (.docx) in the Cathodo/Pac Technologies house style (Times New Roman, section numbering, IO tables, alarm tables).

---

### Key Data Structures

- `SpecProject` — top-level record with wizard state (`confirmed_subsystems`, `confirmed_states`, `alarm_tiers`)
- `SubsystemConfig → AssemblyConfig → DeviceConfig → IoSignal[]` — the 4-level machine hierarchy
- `FdsAssemblySession` — per-assembly authoring state (`static_states`, `sequential_states`, `conversation`, `status`)
- `SequentialStateV2` — structured step schema with `PermissiveCondition[]`, `StepV2[]` (each with `actions`, `transitions`, `completion_criteria`, `within_ms`, `on_fail`)
- `SubsystemOrchestration` — per-subsystem coordination (`assembly_order`, `shared_permissives`, `inter_assembly_interlocks`)
- `FdsSystemOrchestration` — system-level coordination across subsystems

### Database

- `spec_projects` — one row per spec
- `spec_sections` — composed section rows (output of Phase 5 compose)
- `fds_assembly_sessions` — one row per (spec_project, subsystem, assembly)
- `fds_subsystem_orchestrations` — one row per (spec_project, subsystem)
- `fds_system_orchestrations` — one row per spec_project
- `spec_alarms` — alarm definitions

The Postgres function `_build_contract_snapshot(spec_project_id)` assembles a full `SpecContractV2` JSONB from all these tables in a single call. This is the handoff interface to the Forge Wizard.

---

## 2. Forge Wizard

### What It Is

The Forge Wizard is the **coding-engineering side** of Pac-Forge. It takes a functional specification (from the FDS Builder or a manually uploaded .docx/.pdf) and runs it through a 15-step guided pipeline that ends with a complete, compiled TIA Portal project.

Every step has a status (pending / active / completed / failed). Navigation is via a step bar at the top. The wizard is session-based — progress persists to Supabase and can be resumed.

Route: `/forge?projectId=<uuid>`

---

### Machine Hierarchy

The wizard enforces the same 4-level hierarchy as the FDS Builder:

| Level | Description | Gets FB? | Gets Process Sequence? |
|---|---|---|---|
| System | Full machine/production line | No | No |
| Subsystem | Functional station | No | Yes (orchestration) |
| Assembly | Coordinated group of devices | Yes (Assembly FB) | No — commands devices |
| Device | Single physical thing with IO | Yes (Device FB) | No |

**Critical rules:**
- Only devices appear in the device list and get device FBs
- Assemblies appear in process sequences as coordination logic
- The spec defines the hierarchy — AI extracts it, never invents it

---

### The 15 Steps

#### Step 1 — Functional Spec (spec_upload)

When linked to an FDS Builder spec project (Wave 5 integration), the spec is already available and this step auto-completes. For standalone use, the engineer uploads a .docx or .pdf file.

**User inputs:** FDS Builder link (preferred) or .docx/.pdf upload.

---

#### Step 2 — Q&A Review (qa_review)

The Project Manager agent reviews the extracted spec analysis and conducts a clarifying interview. The engineer answers questions about ambiguous devices, signals, or sequences. A "finalise analysis" action produces a clean `SpecAnalysis` object.

Three optional refinement passes run automatically:
- **Challenger pass** (Gemini 2.5 Pro) — looks for missed devices, alarms, and interlocks
- **Validator pass** — a structured checklist with patch suggestions
- **Chunked analysis** — for large specs (>80,000 chars), the spec is split into a survey → per-chunk extraction → merge pipeline

**User inputs:** Answers to PM's clarifying questions; acceptance of the finalised analysis.

---

#### Step 3 — Project Setup (project_setup)

A configuration form.

**User inputs:**
- CPU type (e.g. CPU 1516-3 PN/DP)
- TIA Portal version (V17–V20)
- Design profile selection (determines coding conventions, FB preferences)
- Per-language overrides (device FB language, device call FC language, IO linking language, process code language)
- TIA project path (for bridge integration)

---

#### Step 4 — Hardware & IO (hardware_io)

Hardware rack/module configuration and IO list editing. The AI device matcher runs automatically — it reads the device list from the spec and matches each device to a template in the FB Library. Assembly template matching also runs here.

If the bridge is online, TIA project provisioning starts (creates the TIA project structure, imports hardware config).

**User inputs:**
- Hardware rack and module configuration
- IO list review and corrections
- Device FB template selection overrides (if AI match is wrong)

---

#### Step 5 — Interface Contracts (interface_contract)

The AI generates `InterfaceContractMap` — for each assembly, the exposed/consumed signals and state machine state definitions. The engineer reviews and approves per assembly.

When FDS-linked, assembly briefs are derived from the spec contract (operating states, device state tables, sequential steps, alarms, permissives) via `useForgeFdsHandoff`.

**User inputs:** Review and approval of per-assembly interface contracts.

---

#### Step 6 — Device FBs (device_fb)

For each device:
- **Library match:** If a template exists in the FB Library, its artifacts are copied directly. No AI.
- **AI generation:** Otherwise, Claude generates the device FB in SCL or LAD (per language setting), plus config UDT, HMI UDT, instance DB.

Post-generation deterministic steps run automatically: `reconcileUdtReferences()` (fuzzy UDT name matching), `backfillGlobalDbFieldsFromWiring()`, `extractConversions()` (type-convert FC generation).

A review+rewrite loop follows: the Standards Reviewer agent checks the artifacts; if findings are CRITICAL or WARNING, the Code Architect rewrites. Max 3 rounds.

The engineer reviews all artifacts in Monaco editors and can approve or request regeneration with custom instructions.

**User inputs:** Review and approval of device FB artifacts; optional regeneration instructions.

---

#### Step 7 — Assembly FBs (assembly_fb)

For each assembly:
- **Library match:** If the assembly FB Library has a matching template (by `is_assembly=true` and template selection from Step 4), its artifacts are copied.
- **AI generation:** Otherwise, Claude generates the Assembly FB in SCL — a state machine that commands the constituent devices using the interface contract as the behavioral spec.

Generated artifacts per assembly: Assembly FB (SCL state machine), config UDT, HMI UDT, instance DB.

When FDS-linked, the generation context includes the full behavioral brief from the spec (static device states, sequential step sequences, alarms, permissives). The Logic Check in Step 8 validates the generated code against this brief.

**User inputs:** Review and approval per assembly; optional regeneration.

---

#### Step 8 — Logic Check (logic_check)

A deterministic (no AI) validation pass. Runs instantly.

When FDS-linked, validates generated assembly FB code against the FDS behavioral spec across 10 categories:
- State coverage (does the FB handle all operating states?)
- Step sequence (does the sequence match the spec?)
- Permissives (are all permissive conditions wired?)
- Completion criteria (are timeouts and success conditions correct?)
- Device state tables (do output assignments match static states?)
- Fault handling (are fault paths present?)
- Interface signals (are all contract signals used?)
- Syntax (SCL structural validity)
- General checks

Returns `LogicCheckResult` with `passed`, `issues[]`, `assembliesChecked`, `artifactsChecked`.

**User inputs:** None required. Engineer reviews findings and decides whether to proceed or return to Step 7.

---

#### Step 9 — Matrix Review (matrix_review)

Two sequential AI calls:

1. **Device Linkage** — The PM agent builds the `DeviceLinkageMatrix`: which devices each assembly FB calls, what wiring connects them, interlock conditions, status mirrors. Returns `{deviceLinkage, configUdts}`.

2. **Sequences** — Fed with the wiring field names from Step 1, the PM agent builds `ProcessSequences`: the step-by-step process logic for each subsystem in each operating state. Returns `{processSequences, globalData}`.

Post-processing: `splitOrRows()`, `fixOrphanSteps()`. Deterministic validation: T# timer fix, structural checks via `validateSequence()` (orphan steps, unreachable states, coil conflicts). AI patch calls for fixable issues.

The engineer edits sequences in a table view (one condition per row, branch letters for parallel paths, `next` field with dropdown to step number or FAULT/IDLE).

**User inputs:** Review and approval of the device linkage matrix and process sequences; corrections via the sequence table editor.

---

#### Step 10 — Device Code (device_code)

Generates the device-layer call infrastructure:
- **Device Call FCs** (one per device type) — either deterministic (`generateDeviceCallFc()`) or AI-generated
- **IO Linking FC** — wires physical IO tags to device FB instance DB fields
- **OB/Main scaffold** — calls all FCs in the correct order

A full review+rewrite loop runs (same as Step 6). IO validation runs via a dedicated agent. A compile check loop runs (3 phases: upload+compile → AI fix proposals → user applies fixes + recompile). Patterns are saved on successful compile.

**User inputs:** Review of generated FCs; approval of compile-fix proposals.

---

#### Step 11 — Device Tests (plcsim_device_test)

PLCSim-based test suite for individual device FBs. Stores test results in the session.

**User inputs:** Run tests, review results.

---

#### Step 12 — Process Code (process_code)

Generates the process-layer FCs from the approved sequences:

- **Deterministic path** (preferred when profile enables `step_action_db` and sequences have rows): `compileDeterministicProcessArtifact()` — no AI, instant, fully auditable
- **AI path** (fallback): `buildProcessSclPrompt()` or `buildProcessLadPrompt()`

Additional deterministic generations: Step/Action DBs (scanning max S[n]/A[n] index, including timer instances), OB1 Main FC, Fault DB + Fault FC (when fault matrix is populated), type-convert FCs (when DB wiring has type mismatches).

Post-generation: `reconcileProcessDbFields()` adds missing DB fields from FC references. Reference library lookup and agent knowledge docs are injected per sequence.

**User inputs:** Review of process FCs; approval.

---

#### Step 13 — HMI Screens (hmi)

HMI generation with two paths:

- **Comfort path** (legacy): Deterministic screens first (overview, checklist, faceplate), then optional AI generation for alarm summary, trend, and custom screens
- **Unified path** (current standard, V20): Deterministic `generateUnifiedScreenSuite()` generates the Template Suite V6.0 shell (4-level navigation, title bar, status bar) plus device faceplate screens from the Open Library V19 catalog (52 faceplates, ~80-90% device coverage)

The faceplate catalog builder resolves each device type: Open Library V19 match > FB template `hmi_faceplate_type` > algorithmic fallback. Unmatched device types are flagged as warnings.

**User inputs:** Panel family/model selection; theme selection; screen category selection; review of generated screens; optional "Open in HMI Editor" for detailed editing.

---

#### Step 14 — System Tests (plcsim_system_test)

PLCSim-based test suite for the full program. Stores results in the session.

**User inputs:** Run tests, review results.

---

#### Step 15 — TIA Export (tia_export)

Final export to TIA Portal:
1. Copy library blocks from Dropbox to TIA project
2. Import+compile SCL bundle via bridge (`/tia/jobs`)
3. Import LAD artifacts one by one via `/tia/import-lad`
4. Import HMI: Unified path uses `/tia/hmi/create-screen`; Comfort path uses `/tia/import-hmi`

Progress tracked via `ForgeTiaExportProgress` with WebSocket real-time status.

**User inputs:** Initiate export; monitor progress.

---

### Key Files

| Category | Files |
|---|---|
| Route | `src/routes/forge.tsx` |
| Store | `src/stores/forge-store.ts` |
| Types | `src/types/forge.ts`, `forge-matrix.ts`, `forge-contract.ts`, `forge-brief.ts`, `forge-logic-check.ts` |
| Prompt builders | `src/lib/forge-prompts.ts` (central), `forge-agent-prompts.ts` |
| Deterministic generators | `src/lib/forge-process-compiler.ts`, `forge-process-compiler-v2.ts` |
| Logic checker | `src/lib/forge-logic-checker.ts` |
| Export | `src/lib/forge-export.ts` |
| Spec analysis | `src/hooks/use-forge-spec-analysis.ts`, `use-forge-chunked-analysis.ts`, `use-forge-spec-challenge.ts`, `use-forge-spec-validate.ts` |
| Per-step hooks | `use-forge-device-generate.ts`, `use-forge-assembly-generate.ts`, `use-forge-review.ts`, `use-forge-rewrite.ts`, `use-forge-compile-check.ts`, `use-forge-matrix-generate.ts`, `use-forge-process-generate.ts`, `use-forge-hmi-generate.ts`, `use-forge-tia-export.ts` |

---

## 3. FDS Builder ↔ Forge Wizard Integration

### The Core Idea

The FDS Builder and the Forge Wizard are designed as two sides of the same workflow. An engineer authors the full behavioral specification in the FDS Builder first, then the Forge Wizard uses that spec as its authoritative source of truth for code generation — rather than re-interpreting a prose document.

```
FDS Builder                              Forge Wizard
─────────────────────────────────────────────────────
Design engineer authors spec         → Coding engineer generates TIA code
Instrument Register (tags)           → IO Linking FC (physical wiring)
Static device state tables           → Assembly FB state outputs
Sequential step sequences            → Process sequence matrix
Permissive conditions                → Interlock logic
Assembly orchestration               → ProcessState UDT assembly
System orchestration                 → OB/Main call order
```

### How the Handoff Works

When a Forge session has a `spec_project_id` set (migration 063), the wizard queries the Postgres function `_build_contract_snapshot(spec_project_id)` which returns a full `SpecContractV2` JSONB snapshot. The React hook `useForgeFdsHandoff` reads this and returns an `AssemblyBriefMap` keyed by `assembly_id`.

The brief for each assembly contains:
- `operatingStates[]` — all states from the spec header
- `staticStates: Record<state_id, DeviceStateEntry[]>` — what every output does in each state
- `sequentialStates: Record<state_id, {permissives, steps, notes}>` — step sequences per state
- `alarmConditions: AssemblyAlarm[]` — assembly-specific alarms

This brief is consumed by:
- **Step 7 (Assembly FBs)** — drives AI generation context; assembly FB state machine is generated to match these behavioral specs
- **Step 5 (Interface Contracts)** — brief data seeds the contract form
- **Step 8 (Logic Check)** — the deterministic checker validates generated FB code against the brief

### Linking a Forge Session to an FDS Spec

The session is linked by setting `spec_project_id` on the `forge_sessions` row. In Step 1, if `FLAGS.forge_require_revision_binding` is active, the spec must be linked before the wizard proceeds.

### What Changes When FDS-Linked

| Wizard Step | Without FDS Link | With FDS Link |
|---|---|---|
| Step 1 (Spec) | Manual .docx/.pdf upload + AI extraction | Auto-populated from spec contract |
| Step 5 (Contracts) | AI generates contracts from extracted spec | Contracts seeded from FDS behavioral data |
| Step 7 (Assembly FBs) | AI generates FB with limited context | AI generates FB against the full behavioral brief |
| Step 8 (Logic Check) | Skipped (no spec to check against) | Full 10-category validation against FDS spec |

---

## 4. HMI Builder

### What It Is

Pac-Forge has two distinct HMI tools:

1. **HMI Editor** (`/hmi-editor`) — a mature Comfort (legacy) screen editor with full AI design, graphic library management, template system, and TIA import/export
2. **HMI Builder** (`/hmi-builder`) — a newer standalone canvas for building WinCC Unified screens manually, with an AI Wizard for layout planning

In the Forge Wizard, HMI generation (Step 13) uses a third path — the deterministic `generateUnifiedScreenSuite()` generator for Unified, or `generateDeterministicScreens()` for Comfort — neither of which requires the standalone routes.

The current standard (V20) is **WinCC Unified**. WinCC Comfort is maintained for legacy projects.

---

### HMI Editor (`/hmi-editor`)

A full-featured screen editor for WinCC Comfort projects.

**Features:**
- Multi-screen management with a tab-like screen selector
- 25 element types (RECTANGLE, BUTTON, TEXT, IO_FIELD, GRAPHIC_VIEW, GRAPHIC_IO_FIELD, SYMBOLIC_IO_FIELD, LINE, CIRCLE, GAUGE, BAR, SLIDER, SWITCH, TREND_VIEW, ALARM_VIEW, FACEPLATE, etc.)
- Drag/resize canvas via `react-rnd`, snap-to-grid
- Layer management (eye/lock per layer)
- **AI design:** The user types a prompt describing what screen they want. The `hmi_designer` Claude agent generates `HmiScreenSpec` elements in JSON. The system prompt includes: available WinCC library graphics with AI-scanned descriptions, reference library design guide sections, agent identity/instructions from the Prompt Editor, and optional TIA library catalog
- **WinCC graphic library:** Import .svg files from the WinCC library; Claude scans each one using vision (SVG rasterized to PNG) to generate searchable descriptions
- **AI SVG generation:** Request custom SVG graphics with state variants (running/stopped/faulted etc.) per device category
- **State grouping:** `assignStateGroups()` detects state suffixes and groups graphics for `GRAPHIC_IO_FIELD` image list binding
- **Template system:** Save/load/apply screen templates to IndexedDB
- **TIA import:** Export screens from TIA Portal via the bridge, parse SimaticML XML back into `HmiScreenSpec`
- **Export:** Screen XML + Tag Table (SimaticML), Faceplate Type XML
- **Undo/redo:** 50-step stack

**User inputs:** Text prompt describing the screen; element placement/resize; property edits; graphic selections; tag bindings.

**From the Forge Wizard:** The forge HMI step has an "Open in HMI Editor" button per screen, which stores the generated spec in sessionStorage and opens `/hmi-editor?from=forge` in a new tab.

---

### HMI Builder (`/hmi-builder`)

A canvas-based builder for WinCC Unified screens.

**Features:**
- Panel model selector (10 Unified models from MTP700 to MTP2200 + PC stations)
- Theme selector (SiemensLight / SiemensDark / DeepBlue)
- Left toolbar: 19 item types matching WinCC Unified items (HmiRectangle, HmiButton, HmiText, HmiIOField, HmiFaceplateContainer, HmiGauge, HmiBar, etc.)
- Canvas: zoom 25–200%, snap-to-grid (10px), multi-select, drag/resize
- Properties panel: geometry, text, font, attribute picker (driven by reflected item type catalog from the TIA V20 Openness DLL)
- **AI Wizard** (4 steps: Describe → Layout → Graphics → Review):
  - Step 1: User describes the screen purpose, selects role, enables template frame
  - Step 2: Editable plan (devices, controls, nav items) + minimap preview
  - Step 3: Per-device graphic picker — swap from WinCC library or generate custom SVG
  - Step 4: Full-screen proportional preview
- "Push to TIA" button: sends `HmiUnifiedScreenPayload` to bridge `/tia/hmi/create-screen` (120s timeout)

**User inputs:** Panel/theme selection; element placement; property edits; AI wizard prompts and graphic selections; "Push to TIA" action.

**Note:** The `/hmi-builder` route has no sidebar link — it is accessible via direct URL only.

---

### Forge Wizard HMI Generation (Step 13)

The Forge Wizard generates HMI screens deterministically for both paths:

**Unified path (current standard):**
- `generateUnifiedScreenSuite()` generates the Template Suite V6.0 shell: 4-level navigation structure, title bar, status bar, content window, per-device faceplate screens
- Faceplate selection: Open Library V19 (52 faceplates) > FB template `hmi_faceplate_type` field > algorithmic fallback
- Tag binding: `buildDeviceFaceplateBinding()` resolves device instance → UDT fields → WinCC tag paths
- Framework screens can be imported from TIA Portal to replace deterministic versions

**Comfort path (legacy):**
- `generateDeterministicScreens()` generates overview, subsystem checklist, device checklist, and device faceplate screens
- Optional AI generation for alarm summary, trend, and custom screen categories

The faceplate catalog (`hmi-faceplate-catalog.ts`) surfaces "unmatched device type" warnings when no library entry exists — these are Phase 5-lite items requiring custom faceplate authoring.

---

### Key HMI Files

| Category | Files |
|---|---|
| Routes | `src/routes/hmi-editor.tsx`, `src/routes/hmi-builder.tsx` |
| Types | `src/types/hmi-screen.ts`, `src/types/hmi-panel.ts` |
| Unified structure | `src/lib/hmi-unified-structure.ts` (Template Suite V6.0 layout zones) |
| Item types | `src/lib/hmi-unified-item-types.ts` (reflected from TIA V20 DLL — all 39 item types) |
| Payload builder | `src/lib/hmi-unified-payload-builder.ts` |
| Screen generators | `src/lib/hmi-unified-screen-generators.ts`, `src/lib/hmi-screen-generators.ts` |
| Faceplate catalog | `src/lib/hmi-faceplate-catalog.ts`, `src/lib/open-library-catalog.ts` |
| Tag mapper | `src/lib/hmi-tag-mapper.ts` |
| XML | `src/lib/hmi-xml-builder.ts`, `src/lib/hmi-xml-parser.ts` |
| AI prompts | `src/lib/hmi-wizard-prompts.ts` |
| Layout engine | `src/lib/hmi-wizard-layout.ts` |
| Graphics DB | `src/lib/hmi-graphics-db.ts`, `src/lib/hmi-generated-graphics-db.ts` |
| SVG generator | `src/lib/hmi-svg-generator.ts` |
| Hooks | `src/hooks/use-forge-hmi-generate.ts`, `src/hooks/use-forge-hmi-import.ts`, `src/hooks/use-hmi-wizard.ts`, `src/hooks/use-hmi-history.ts` |

---

## 5. Pattern Librarian

### What It Is

The Pattern Librarian is a continuous learning system. Every time a code correction happens anywhere in Pac-Forge — whether through a compile error fix, a manual TIA fix, a pipeline review, or the Forge Wizard — the system captures the WRONG code and the CORRECT code as a structured pattern. Approved patterns are injected into all future AI generation prompts so the same mistake is never repeated.

Route: `/patterns` (Pattern Library admin UI)

---

### How Patterns Are Created

Patterns are created from 7 distinct sources:

| Source | How | Initial Status |
|---|---|---|
| Pac-ST pipeline (Pattern Librarian step) | Diffs original generation vs post-review artifacts; AI analysis | PENDING |
| Forge Wizard per-rewrite | Diffs original vs rewritten per artifact, fire-and-forget | PENDING |
| Forge compile-fix | After successful compile+fix cycle | APPROVED (auto) |
| Compile-fix chat verification | Per-round AI analysis after fix session | PENDING |
| Manual TIA fix panel | AI analysis of manually applied fixes | PENDING |
| Agent chat teaching | Direct WRONG/CORRECT pair via chat | APPROVED |
| Teach dialogs | `teach-pattern-dialog.tsx` (category selection), `teach-upload-dialog.tsx` (extraction from doc) | PENDING |

---

### Pattern Classification

Two-tier classification: AI first, regex fallback.

**AI path:** The Pattern Librarian Claude agent receives the WRONG/CORRECT code pair and returns structured JSON with:
- `correctionType` — one of: `NAMING`, `IO_MAPPING`, `STATE_LOGIC`, `ALARM`, `SAFETY`, `TIMING`
- `explanation` — human-readable description of the pattern
- `confidence` — 0.0–1.0
- `assessmentNote` — optional note when in Verification Mode (assesses whether fix genuinely resolves an error vs. masking it)

**Regex fallback** (`correction-classifier.ts`): Six rule sets, each with keyword patterns per type. Confidence = `matchCount / patterns.length`. Used when the AI call fails or returns empty.

---

### Pattern Lifecycle

```
Creation → PENDING → (human review) → APPROVED or REJECTED
APPROVED → (revoke) → PENDING
Any status → (delete) → removed
```

The Patterns page (`/patterns`) defaults to the PENDING filter — engineers land directly on the review queue. Actions: Approve, Reject, Revoke (return approved to pending), Delete.

Only `APPROVED` patterns with `plc_brand = "SIEMENS_TIA"` are fetched by `useActivePatterns()` and injected into generation prompts.

---

### How Patterns Are Injected

`formatPatterns(approvedPatterns)` in `prompt-builder.ts` formats each approved pattern as a `WRONG/CORRECT` SCL code block pair with an explanation label. This formatted block is injected into the system prompt of **all four generation paths**:

| Generation Path | Hook | Prompt Builder |
|---|---|---|
| Pac-ST pipeline | `use-pipeline-generate.ts` | `buildPrompt()` |
| Process code | `use-process-generate.ts` | `buildProcessPrompt()` |
| TIA Console demo | `use-demo-pipeline.ts` | `buildPrompt()` (same as pipeline) |
| Compile fix | `use-compile-fix.ts` | `buildCompileFixSystemPrompt()` |

The Forge Wizard generation paths (`use-forge-device-generate.ts`, `use-forge-assembly-generate.ts`, `use-forge-process-generate.ts`) also inject approved patterns via `formatPatterns()` through their respective prompt builders.

---

### Verification Mode (Compile-Fix)

When patterns are generated from compile-fix rounds, the Pattern Librarian runs in Verification Mode. It receives the compile errors that were addressed and assesses each correction:

- Did this fix genuinely resolve the compile error, or just mask it?
- Patterns where the fix looks like masking get `confidence < 0.5` and an `assessmentNote` warning

---

### Pattern Library Admin UI

**Source toggle:** "Pac-ST" (`SIEMENS_TIA`) vs "Migration" (`SIEMENS_MIGRATION`)

**Status tabs:** All / Pending / Approved / Rejected / Conflicts

**Type filter:** Per-source correction type buttons

**Search:** Full-text across ID, tag, device, context, code snippets

**Conflict detection:** `detectConflicts()` runs against design profiles and agent knowledge docs. Patterns involved in contradictions show a conflict badge count with a dedicated Conflicts tab.

---

### Pattern Prompt Sections

The Pattern Librarian's identity and instructions are editable via the Prompt Editor at:
- Role `"patterns"` — Pac-ST pipeline variant
- Role `"forge_pattern_librarian"` — Forge Wizard variant

Both fall back through: DB override → shared default → hardcoded default via `resolveSection()`.

---

## 6. Multi-Agent Pipeline

### Overview

Pac-Forge uses Claude agents for code generation, review, rewriting, and learning. Agents are not generic — each has a named identity, specialisation, and system prompt that includes their role-specific rules, correction patterns, and knowledge documents.

Agent leases: 30-minute leases with auto-renewal every 10 minutes. Multiple agents can be reserved simultaneously within concurrency limits.

---

### Pac-ST Main Pipeline (`use-pipeline-generate.ts`)

The Pac-ST workspace uses a 7-step multi-agent pipeline for each generation request:

```
Step 0: Project Manager — Plan
        ↓ (non-fatal, continues on failure)
Step 1: Code Architect — Generate (streaming, 16,384 tokens)
        ↓
        Reference Library lookup (merged for generation + review)
        ↓
Steps 2-N: Review → Rewrite Loop (max 3 rounds)
        ├── PLC Standards Enforcer — Review
        ├── IO Validator — Review (optional, toggleable)
        ├── Safety Auditor — Review (optional, toggleable)
        └── Code Architect — Rewrite (if CRITICAL or WARNING findings)
        ↓
Step 5: Pattern Librarian — Analyze diffs, save patterns as PENDING
        ↓
Step 6: Project Manager — Summary (non-fatal)
        ↓
        Save artifacts + invalidate queries
```

**Toggleable steps** (via session start dialog): Standards Review (default on), IO Validation (default off), Safety Audit (default off), Pattern Learning (default on). Code Generation is always on and locked.

**Context injected per generation:**
- Approved correction patterns (WRONG/CORRECT pairs)
- Agent knowledge documents (for the generating agent)
- Reference library sections (two-pass AI lookup: extract topics → FTS + tag search)
- Design profile rules
- FB template library (company-standard templates)
- Platform rules (ai/PLATFORM_RULES_SIEMENS_TIA.md)
- Editable prompt sections (from `prompt_sections` table)

---

### Forge Wizard Per-Step Pipeline

Each Forge Wizard generation step runs its own mini-pipeline:

```
AI Generate (Code Architect, stage-scoped system prompt)
    ↓
Standards Review (PLC Standards Enforcer, Forge variant)
    ↓ (if CRITICAL/WARNING findings)
Rewrite (Code Architect, Forge variant)
    ↓ (max 3 rounds)
Engineer Approve
    ↓
TIA Upload via bridge
    ↓
Compile
    ↓ (if compile errors)
Compile-Fix loop (max 3 rounds):
    AI propose fixes → Engineer apply → Recompile
    ↓ (on success)
Pattern Librarian (fire-and-forget, PENDING)
```

The compile-fix path in the Forge Wizard auto-approves patterns (unlike the Pac-ST pipeline which saves as PENDING for human review).

---

### Agent Roles

| Role Key | Agent Name | Function |
|---|---|---|
| `plan` | Project Manager | Plans generation approach, asks clarifying questions |
| `generate` | Code Architect | Generates SCL/LAD code |
| `review` | PLC Standards Enforcer | Reviews code against platform rules and patterns |
| `review` | IO Validator | Validates IO address mappings |
| `review` | Safety Auditor | Checks safety-critical code patterns |
| `rewrite` | Code Architect | Rewrites code based on review findings |
| `patterns` | Pattern Librarian | Analyzes diffs, classifies corrections, saves patterns |
| `summary` | Project Manager | Summarizes pipeline results |
| `compile_fix` | Code Architect | Proposes fixes for TIA compile errors |
| `hmi_designer` | HMI Designer | Generates WinCC screen layouts |

Agent identities, taglines, personalities, and system prompt sections are all editable via the Prompt Editor route (`/prompts`).

---

### Four Generation Paths (All Must Be Updated Together)

There are exactly four independent AI code-generation paths. Any change to "what all agents know" (new platform rule, pattern format change, knowledge injection) must be applied to **all four**:

| Path | Hook | Prompt Builder |
|---|---|---|
| Pac-ST pipeline | `use-pipeline-generate.ts` | `buildPrompt()` in `prompt-builder.ts` |
| Process code | `use-process-generate.ts` | `buildProcessPrompt()` in `process-prompt-builder.ts` |
| TIA Console demo | `use-demo-pipeline.ts` | Full pipeline (reuses all builders) |
| Compile fix | `use-compile-fix.ts` | `buildCompileFixSystemPrompt()` in `compile-fix-prompt.ts` |

---

## 7. Assembly FB Library

### What It Is

The Assembly FB Library (the focus of the `feature/assembly-fb-library` branch) replaces greenfield AI-invented assembly code with a catalog of typed, versioned, instance-parameterised templates.

The vision: when a spec has an assembly of a known type (e.g. "Conveyor Standard VSD", "Pusher Linear Cylinder"), the system picks the matching template from the library, wires up the instance-specific parameters (IO signals, tag names, UDT references), and uses the proven, TIA-compiled, tested SCL code — no AI generation needed. AI generation becomes a fallback for novel assembly types with no library match.

---

### Interface Contract Schema

Each assembly FB template has an `interface_contract` JSONB field that defines:

- **Inputs** (`name`, `tia_name`, `data_type`, `role`, `description`, `agent_description`, `default_value`, `required`) — roles include: `auto_run`, `start_cmd`, `reset_cmd`, `emergency_stop_in`, `permissive`, `upstream_ready`, `downstream_ready`, `setpoint`, `command_mode`, and others
- **Outputs** (`name`, `tia_name`, `data_type`, `role`, `description`) — roles include: `running`, `at_home`, `at_target`, `at_position`, `faulted`, `fault_code`, `ready`, and others
- **IO Slots** (`slot_name`, `signal_type`, `role`, `description`, `cardinality`) — physical IO declarations, roles include: `discharge_sensor`, `home_sensor`, `run_command`, `actuator_command`, `vsd_drive`, and others. Cardinality: `one`, `zero_or_one`, `one_or_more`
- **ProcessState Reads** — which `ProcessState` UDT members this FB reads
- **ProcessState Writes** — which `ProcessState` UDT members this FB writes (drives ProcessState UDT auto-assembly)

The contract is authored in a 5-tab editor in the FB Library UI (Inputs / Outputs / IO Slots / ProcessState Reads / ProcessState Writes). A "Pre-fill from SCL" button parses the FB's VAR_INPUT/VAR_OUTPUT blocks and auto-populates the contract, inferring roles from naming conventions. Engineers can then reclassify items and move signals between inputs/outputs and IO slots.

---

### V1 Catalog (8 Templates)

| Template | Type | Contract Status | Body SCL Status |
|---|---|---|---|
| ConveyorStandardVsd | Conveyor with VSD drive | Complete (6 in / 6 out / 1 io_slot / 4 ps_writes) | Pending (empty BEGIN/END) |
| ConveyorStandardDol | Conveyor with DOL motor | Complete (3 in / 4 out / 4 io_slots / 3 ps_writes) | Pending |
| TransferTable2Axis | 2-axis transfer table | Complete (4 in / 8 out / 7 io_slots / 4 ps_writes) | Pending |
| TurntableSingleStop | Single-stop turntable | Complete (4 in / 5 out / 5 io_slots / 3 ps_writes) | Pending |
| PusherLinearCylinder | Linear pusher cylinder | Complete (4 in / 5 out / 4 io_slots / 3 ps_writes) | Pending |
| DiverterSwingGate | Swing gate diverter | Complete (4 in / 5 out / 4 io_slots / 3 ps_writes) | Pending |
| LiftStationVertical | Vertical lift station | Complete (5 in / 5 out / 5 io_slots / 3 ps_writes) | Pending |
| AccumulatorBufferConveyor | Buffer accumulator conveyor | Complete (5 in / 6 out / 5 io_slots / 3 ps_writes) | Pending |

All 8 contracts are seeded in the DB. Body SCL authoring (the actual FB logic) is pending manual authoring and TIA V18 compile validation by Kasper.

**Body SCL authoring order** (simplest first): ConveyorStandardDol → PusherLinearCylinder → DiverterSwingGate → TurntableSingleStop → ConveyorStandardVsd → LiftStationVertical → AccumulatorBufferConveyor → TransferTable2Axis

---

### Implementation Phases

| Phase | Description | Status |
|---|---|---|
| 0 | Library audit (105 templates, 0 assembly, 8/8 Mode C) | Complete |
| 1 | Migration 075 + TypeScript types | Complete |
| 2 | FB Library interface-contract editor UI | Complete |
| 3 | SCL → contract parser + Pre-fill button | Complete |
| 4 | Seed v1 catalog | Contracts complete; body SCL pending Kasper |
| 5 | Spec Builder integration (template matching in Phase 2, contract form in Phase 3 Co-Author) | Not started |
| 6 | Subsystem orchestration SFC editor | Not started |
| 7 | Forge wire-through verification (assembly generator uses `interface_contract` + `instance_params`) | Not started |
| 8 | AI-assisted authoring (Mode D) | Not started |
| 9 | Versioning + upgrade UI | Not started |
| 10 | PILOT-001 re-run on library-first flow | Not started |

---

### Schema Changes (Migration 075)

**`fb_templates` additions:**
- `interface_contract jsonb NOT NULL DEFAULT '{}'`
- `deprecated boolean NOT NULL DEFAULT false`

**`fds_assembly_sessions` additions:**
- `fb_template_id uuid REFERENCES fb_templates(id)`
- `fb_template_version int`
- `instance_params jsonb NOT NULL DEFAULT '{}'`
- `instance_overrides jsonb NOT NULL DEFAULT '{}'`
- `process_intent text`

**`AssemblyConfig` additions** (spec-builder types):
- `fb_template_id?: string | null`
- `fb_template_version?: number | null`
- `instance_params?: Record<string, string>`
- `instance_overrides?: Record<string, unknown>`
- `process_intent?: string | null`

---

### Locked Design Decisions

1. IO slots are named pins — physical IO lives in VAR_INPUT/VAR_OUTPUT; classification is in the DB contract only
2. No SCL naming convention enforced by the parser — reclassify via the UI after pre-fill
3. FB Builder UI revival deferred to Phase 8
4. VSD telegram parameterisation deferred to Phase 5 (v1 hardcodes telegram-352)
5. ProcessState UDT naming: `ProcessState_<SUBSYSTEM>.<assembly_tag>_<signal_name>` with globally-unique tags
6. FB `VERSION : 1.0` on all seed templates
7. Diverter: GateActuatorCmdA = `zero_or_one` (spring-return), GateActuatorCmdB = `one` (active solenoid)
8. Pusher: ExtendSolenoid = `one` always, RetractSolenoid = `zero_or_one`

---

## 8. Planned Changes Not Yet Implemented

### FDS Builder

**Structured StepEntry optional fields** (`output_tag`, `condition_tag`, `condition_value`, `timeout_value`, `timeout_action` as separate typed fields on `StepEntry`): Agreed in alignment docs as "Phase C". The V2 schema (`SequentialStateV2`) uses a different, richer structure (`ActionV2[]` + `CompletionCriterion[]`) that may have superseded this, but the alignment doc item is not formally closed.

**Operator modes** (`confirmed_modes?: OperatorMode[]` on `SpecProject`): Auto/Manual/Service modes per assembly were identified as a gap in both alignment documents. Not yet present in any type definition or DB schema.

**`buildForgeHandoff()` standalone function** (proposed in `FDS_FORGE_ALIGNMENT_RESPONSE.md`): Described as a future deliverable. Currently replaced by `useSpecContract` + `useForgeFdsHandoff`, but the proposed typed function (`src/lib/spec-builder/fds-handoff.ts`) was never created.

---

### Pattern Librarian

**End-to-end diff for Forge rewrite** (FIX 7 in `CLAUDE_CODE_PIPELINE_FIXES.md`): Currently, `use-forge-rewrite.ts` saves patterns per rewrite round (comparing before/after that round only). The planned improvement is to also compute diffs between the *original generation* and the *final rewritten artifact* to capture higher-signal, composite patterns. A `// TODO (FIX 7)` comment at line 137 of `use-forge-rewrite.ts` marks this location.

**`PARAMETER_WIRING` correction type** (Stage S9-3 in `PAC_FORGE_PROMPT_AUDIT.md`): `IO_MAPPING` is currently misclassified for parameter wiring issues (connecting FB outputs to downstream inputs). A dedicated `PARAMETER_WIRING` type would improve classifier precision.

**Exact snippet capture** (Stage S9-2): `original_snippet` is sometimes a paraphrase rather than the exact WRONG code. Fix: use the exact generated artifact code as the original snippet.

**Pattern deduplication** (Stage S9-4): Near-identical corrections appear across multiple artifacts with the same explanation. Consider deduplication by `explanation_tag` before saving.

---

### Assembly FB Library

**Phase 5 — Spec Builder integration:** When an assembly in the spec skeleton matches a library template, the Phase 2 Machine Hierarchy step should run `matchAssembliesToTemplates()` and pre-select the template. The Phase 3 Co-Author should render the interface-contract form (tag picker per IO slot, scoped to the assembly's instrument-register tags) instead of the standard interview for template-backed assemblies.

**Phase 7 — Forge wire-through:** Verify that `use-forge-assembly-generate.ts` correctly consumes `interface_contract` and `instance_params` from a matched template when generating assembly FBs. The generate hook exists but has not been tested end-to-end with a library-first spec.

**ProcessState UDT auto-assembly:** The spec contract defines which `process_state_writes[]` each assembly declares. The plan is to auto-build the ProcessState UDT from the union of all member assemblies' declarations at spec time. This is not yet implemented.

---

### HMI Builder

**`/hmi-builder` sidebar link:** The standalone WinCC Unified builder route has no sidebar navigation link — it is only reachable by direct URL. A sidebar entry needs to be added.

**Open Library V19 unmatched device types:** `buildFaceplateCatalog()` flags device types with no library faceplate match as warnings. These "Phase 5-lite" gaps require custom faceplate authoring or additional library expansion.

**HMI Unified Rebuild Plan phases 3–6:**

| Phase | Description | Status |
|---|---|---|
| 1 | Architecture decision + HMI template/panel family column | Complete |
| 2 | Data model (HmiPanelConfig, screen categories, faceplate catalog) | In progress |
| 3 | Template Suite V6.0 shell generation + Open Library V19 consumption | Not started |
| 4 | Bridge integration (Unified API path) | Not started |
| 5 | AI faceplate authoring (deferred indefinitely — library-first replaces this) | Deferred |
| 6 | Standards Reviewer updates for Unified | Not started |

---

### Multi-Agent Pipeline — Forge Wizard

**Review/Rewrite loop completeness:** The agent pipeline integration plan (`agent-pipeline-integration.md`) describes the full generate→review→rewrite→approve→compile→fix sub-pipeline per wizard step. The individual hooks exist (`use-forge-review.ts`, `use-forge-rewrite.ts`, `use-forge-compile-check.ts`) but end-to-end correctness has 15 known bugs documented in `Docs/forge-plan/WIZARD_STEP7_DEVICE_CODE_BUGS.md`, the most critical being:

- **BUG-07 (SAFETY):** eStop polarity inversion — `safetyOk` signal wired without NOT to the eStop input
- **BUG-09:** VAR_IN_OUT parameters are mandatory but the deterministic generator skips unwired ones
- **BUG-11:** Review-rewrite loop fixes FCs but does not update dependent DBs (cross-artifact coordination failure)
- **BUG-13:** Validation fix JSON is truncated when the full matrix is too large for a single AI fix call

---

### Spec Analysis — Forge Wizard

**`use-forge-spec-analysis.ts` deprecation:** Marked `@deprecated`, relocation pending to `ai-ingest.ts`. Not yet deleted; retained pending Wave 4 merge.

---

*This document reflects the codebase as of 2026-04-29 on branch `feature/assembly-fb-library`. For active task tracking see `HANDOFF_assembly_fb_library.md` (phases 4–10) and `Docs/forge-plan/WIZARD_STEP7_DEVICE_CODE_BUGS.md` (15 known bugs).*
