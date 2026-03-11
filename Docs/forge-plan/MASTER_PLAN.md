# PAC-FORGE PROJECT WIZARD — MASTER PLAN

**Version:** 1.0
**Date:** March 11, 2026
**Goal:** Build a unified Project Wizard that takes an automation project from functional spec to TIA Portal import in one guided flow.
**Demo deadline:** Monday March 17, 2026

---

## 1. VISION

The Project Wizard replaces the scattered approach of separate chat, process builder, FB builder, and TIA console pages with a single, guided pipeline. An engineer opens a project, walks through structured stages, and the AI agents handle the heavy lifting — with the engineer reviewing and approving at each gate.

**Demo story:**
1. Create a new project → select a profile (SCL-focused or LAD-focused)
2. Upload a functional spec OR describe the project in a guided form
3. AI extracts/confirms: project overview, device list, IO signals, hardware config
4. System generates device code (FBs from library + AI-generated, DBs, IO wiring)
5. System generates process code (SCL or LAD based on profile)
6. System generates basic HMI screens
7. Everything imports into TIA Portal via the bridge → compiles

**Secondary demo moment:** Upload the real 111-page Cathode Handling spec, show the AI extracting devices, IO tables, and process sequences from it in real-time.

---

## 2. ARCHITECTURE DECISIONS

### 2.1 New Route, Clean Slate
- New route: `/forge` → `src/routes/forge.tsx`
- Does NOT replace existing routes — they remain as fallback/legacy
- New wizard-specific components in `src/components/forge/`
- New hooks in `src/hooks/` prefixed with `use-forge-*`
- Reuses existing infrastructure: Supabase, edge functions, agent system, TIA bridge, FB templates

### 2.2 Profile-Driven Generation
The project profile determines:
- **Code language:** SCL, LAD, or mixed (e.g., device code in SCL, process code in LAD)
- **Code structure:** CASE-based state machines vs sequential ladder vs customer-specific patterns
- **Naming conventions:** FB/FC/DB prefixes, tag naming
- **Folder structure:** TIA Portal program block organization
- **HMI theme:** Colors, layout style, faceplate templates
- **Process rules:** With examples (existing `ProcessRuleExample` structure)
- **FB rules:** With examples

### 2.3 Extend Existing Design Profile
Add new fields to `DesignProfile` type (migration 025):
```typescript
// New fields on DesignProfile
code_language: "SCL" | "LAD" | "MIXED";           // Primary language preference
process_code_language: "SCL" | "LAD" | "MIXED";   // Override for process code specifically
hmi_theme: string;                                  // Theme identifier
naming_prefix: string;                              // e.g. "FB_CK_" for a customer
db_naming_prefix: string;                           // e.g. "DB_CK_"
```

For the demo: ONE working profile with SCL device code + configurable process code language. UI shows profile selector dropdown.

### 2.4 Wizard Step Model
The wizard is a linear pipeline with gates. Each step must be completed (or skipped where optional) before the next unlocks.

```
SPEC_UPLOAD → PROJECT_SETUP → HARDWARE_IO → DEVICE_CODE → PROCESS_CODE → HMI → TIA_EXPORT
```

State stored in a new Zustand store (`src/stores/forge-store.ts`), with persistence to Supabase for session recovery.

### 2.5 Reuse Existing Generation Infrastructure
- **Edge function:** Same `POST /functions/v1/generate` — no changes needed
- **Agent system:** Same agents (Code Architect, PM, Standards Enforcer, etc.)
- **Prompt builders:** New unified prompt builders in `src/lib/forge-prompts.ts` that call into existing builders where appropriate
- **TIA bridge:** Same endpoints — SCL import via `/tia/jobs`, LAD via `/tia/import-lad`, HMI via `/tia/import-hmi`
- **FB templates:** Same `fb_templates` table and hooks

---

## 3. DATA MODEL

### 3.1 Forge Session (new table: `forge_sessions`)
```sql
CREATE TABLE forge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  design_profile_id uuid REFERENCES design_profiles,
  current_step text NOT NULL DEFAULT 'spec_upload',
  
  -- Step data (JSONB for flexibility during rapid development)
  spec_text text,                          -- Extracted functional spec text
  spec_filename text,                      -- Original filename
  spec_analysis jsonb DEFAULT '{}',        -- AI-parsed project overview, devices, IO
  
  hardware_config jsonb DEFAULT '{}',      -- CPU, rack/slot, IO modules
  io_list jsonb DEFAULT '[]',              -- Confirmed IO entries
  device_list jsonb DEFAULT '[]',          -- Confirmed devices with FB assignments
  network_topology jsonb DEFAULT '{}',     -- Network architecture
  
  linkage_matrix jsonb,                    -- Device wiring / process sequence data
  
  -- Generated artifacts per stage
  device_artifacts jsonb DEFAULT '[]',     -- Generated FBs, DBs, IO wiring
  process_artifacts jsonb DEFAULT '[]',    -- Generated process code
  hmi_artifacts jsonb DEFAULT '[]',        -- Generated HMI screens
  
  -- Step completion tracking
  step_statuses jsonb DEFAULT '{}',        -- { step_name: "pending"|"active"|"completed"|"failed" }
  
  -- TIA export tracking
  tia_project_path text,
  tia_export_result jsonb,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### 3.2 Forge Artifact (extends existing artifact concept)
Each generated code block is stored as a forge artifact within the session's JSONB arrays. Structure:
```typescript
interface ForgeArtifact {
  id: string;                              // UUID
  name: string;                            // e.g. "FB_Motor_DOL"
  type: "UDT" | "FB" | "FC" | "DB" | "OB" | "TAG_TABLE";
  language: "SCL" | "LAD";                 // What language this artifact is in
  content: string;                         // SCL source code OR LAD JSON (for LAD XML generation)
  xml_content?: string;                    // Pre-built SimaticML XML (for LAD)
  approved: boolean;                       // Engineer has reviewed and approved
  fb_template_id?: string;                 // If generated from FB library template
  stage: "device" | "process" | "hmi";     // Which wizard stage produced this
  destination_folder: string;              // TIA Portal folder path
  dependencies: string[];                  // Other artifact names this depends on
  compile_after_import: boolean;
}
```

### 3.3 Spec Analysis Result (output of AI spec parsing)
```typescript
interface SpecAnalysis {
  project_name: string;
  project_description: string;
  plc_type: string;                         // e.g. "S7-1517F"
  hmi_type: string;                         // e.g. "UNIFIED COMFORT"
  
  subsystems: Array<{
    name: string;                           // e.g. "LFP-NCO system"
    description: string;
  }>;
  
  devices: Array<{
    id: string;
    name: string;                           // e.g. "GK002"
    tag: string;                            // e.g. "GK002-M01-VFD"
    device_type: string;                    // e.g. "Motor", "Valve", "Sensor"
    description: string;                    // e.g. "Aspiration fan"
    subsystem: string;                      // Which subsystem it belongs to
    io_signals: Array<{
      tag_name: string;
      signal_type: "DI" | "DQ" | "AI" | "AQ";
      description: string;
    }>;
  }>;
  
  process_sequences: Array<{
    name: string;                           // e.g. "Unloading from NZ001 to TE005"
    subsystem: string;
    permissives: string[];
    steps: Array<{
      step_number: number;
      action: string;
      completion_criteria: string;
    }>;
  }>;
  
  alarms: Array<{
    name: string;
    severity: "IMMEDIATE_SHUTDOWN" | "CONTROLLED_SHUTDOWN" | "WARNING";
    description: string;
    possible_causes: string[];
  }>;
  
  interlocks: Array<{
    name: string;
    condition: string;
    affected_devices: string[];
  }>;
}
```

---

## 4. WIZARD FLOW — STEP BY STEP

### Step 1: SPEC_UPLOAD
**What happens:** Engineer either uploads a .docx/.pdf functional spec, or clicks "Start from scratch" to skip to manual setup.

**If spec uploaded:**
- Client-side text extraction (mammoth for .docx, pdfjs-dist for PDF — already in the app)
- Full text sent to AI (PM agent) with a spec analysis prompt
- AI returns `SpecAnalysis` JSON
- Results displayed for engineer review: project overview, extracted devices table, IO signals, process sequences
- Engineer can edit/correct any extracted data before confirming

**If starting from scratch:**
- Skip to Step 2 with empty data — engineer fills in manually

**UI:** Full-width view. Left side: uploaded doc preview or upload dropzone. Right side: AI analysis results in editable cards/tables.

### Step 2: PROJECT_SETUP
**What happens:** Confirm/edit project metadata and select the design profile.

**Fields:**
- Project name, project number, client name
- Design profile selector (dropdown of existing profiles, or "Default")
- Code language preference (inherited from profile, but overridable)
- Process code language (inherited from profile, but overridable)
- TIA Portal version
- CPU type (auto-filled from spec analysis if available)
- Safety level / notes

**UI:** Form layout, single column, compact. Profile selector at the top — when changed, language preferences update automatically.

### Step 3: HARDWARE_IO
**What happens:** Define the hardware configuration and IO list.

**Sub-sections:**
- **Hardware config:** CPU type, rack/slot layout, IO module selection (reuse existing `HardwareConfigEditor` component)
- **IO list:** Table of all IO points with address, tag, data type, description, module/slot (reuse existing `IoListEditor` component, pre-populated from spec analysis)
- **Network topology:** Network addresses, device addressing (new — can be simple for demo)

**AI assist:** If spec was uploaded, IO list is pre-populated. Engineer reviews and confirms. Agent can suggest missing IO based on device list.

**UI:** Tabbed sub-view (Hardware | IO List | Network). Each tab reuses existing editors where possible.

### Step 4: DEVICE_CODE
**What happens:** The "boring stuff" — automated.

**Flow:**
1. System matches each device from the device list to an FB template from the library
2. For devices with no matching template, AI generates an FB
3. System generates instance DBs for each device
4. System generates the IO linking program (FC that maps physical IO → FB inputs/outputs)
5. All code generated in the language specified by the profile (SCL or LAD)

**Engineer interaction:**
- Review device → FB template mapping (table view, can override)
- Review each generated artifact in Monaco editor
- Approve all or approve individually
- Can regenerate any single artifact

**UI:** Left panel: device list with FB assignments. Right panel: Monaco editor showing selected artifact. Bottom: approval toolbar.

### Step 5: PROCESS_CODE
**What happens:** Generate the process/sequence code that ties devices together.

**Flow:**
1. From linkage matrix (built in Step 3 or extracted from spec): identify process sequences
2. For each sequence, generate process code in the profile's language
3. Code structure follows profile rules (CASE state machine, sequential, etc.)

**Engineer interaction:**
- Review process sequence list
- Review each generated process FC/OB in Monaco editor
- Can edit directly, regenerate, or approve
- Section-by-section approval

**UI:** Left panel: sequence list with status. Right panel: Monaco editor. Top: profile-driven language indicator.

### Step 6: HMI
**What happens:** Generate basic HMI screens.

**Flow:**
1. From confirmed device list: generate an overview screen with device status indicators
2. Generate device faceplate screens (motor control, valve status, etc.)
3. Generate HMI tag tables linking screen elements to PLC tags
4. All output as WinCC SimaticML XML (using existing `hmi-xml-builder.ts`)

**Engineer interaction:**
- Preview generated screens (visual preview if possible, or XML view)
- Approve for export

**UI:** Grid of screen thumbnails (or list), click to preview. Approval buttons.

### Step 7: TIA_EXPORT
**What happens:** Import everything into TIA Portal.

**Flow:**
1. Engineer specifies TIA Portal project path (or bridge auto-detects)
2. System builds import manifest (topological sort for dependency order)
3. SCL artifacts → bundled and sent via `/tia/jobs` (import-compile)
4. LAD artifacts → sent via `/tia/import-lad` (one at a time)
5. HMI artifacts → sent via `/tia/import-hmi`
6. Real-time progress via WebSocket
7. Compile results displayed
8. If compile errors: option to auto-fix and retry (existing compile-fix flow)

**UI:** Progress view with artifact-by-artifact status. Compile results panel at bottom. Success/failure summary.

---

## 5. PROMPT STRATEGY

### 5.1 Spec Analysis Prompt
The PM agent receives the full spec text and returns structured `SpecAnalysis` JSON. The prompt must:
- Extract ALL devices with their tags, types, and IO signals
- Extract ALL process sequences with steps, actions, and completion criteria
- Extract alarms and interlocks
- Handle tables (which pandoc/mammoth convert to markdown tables)
- Be tolerant of non-English specs (the Cathode spec has Italian terminology)

### 5.2 Device Code Generation Prompts
For each device type, the Code Architect receives:
- The profile's coding rules
- The FB template (if one exists in the library)
- The device's IO signals
- Platform rules (existing `PLATFORM_RULES_SIEMENS_TIA.md`)
- Active correction patterns (existing pattern system)
- Language directive: "Generate in SCL" or "Generate as LAD JSON"

For LAD: the AI must output the `LadProgram` JSON structure (existing type in `src/types/lad.ts`), which then gets converted to SimaticML XML via `lad-xml-builder.ts`.

### 5.3 Process Code Generation Prompts
The Code Architect receives:
- Complete device code context (FB interfaces)
- Linkage matrix / process sequences
- Profile's process code rules and examples
- Language directive
- Platform rules + correction patterns

### 5.4 HMI Generation Prompts
An HMI agent receives:
- Device list with tag names
- HMI theme/style from profile
- Existing HMI type definitions (`src/types/hmi-screen.ts`)
- Must output `HmiScreenSpec` JSON, which gets converted to WinCC XML via `hmi-xml-builder.ts`

---

## 6. FILE OWNERSHIP BOUNDARIES

To prevent merge conflicts between Claude Code and Codex working simultaneously:

### Claude Code Owns (AI/orchestration/logic):
- `src/hooks/use-forge-*.ts` (all forge hooks)
- `src/lib/forge-prompts.ts` (all wizard prompt builders)
- `src/lib/forge-spec-parser.ts` (spec analysis logic)
- `src/lib/forge-device-matcher.ts` (device → FB template matching)
- `src/lib/forge-pipeline.ts` (wizard pipeline orchestration)
- `src/lib/forge-export.ts` (TIA export orchestration)
- `supabase/migrations/025_forge_sessions.sql`
- Changes to existing prompt builders if needed

### Codex Owns (UI/components/types):
- `src/routes/forge.tsx` (main wizard route)
- `src/components/forge/*.tsx` (ALL wizard UI components)
- `src/stores/forge-store.ts` (wizard Zustand store)
- `src/types/forge.ts` (wizard type definitions)
- Changes to `src/App.tsx` (adding the route)
- Changes to `src/app/DashboardLayout.tsx` (adding sidebar nav item)

### Shared (coordinate before editing):
- `src/types/design-profile.ts` (adding new fields)
- `src/hooks/use-design-profiles.ts` (if query changes needed)
- Any existing component reused in the wizard

---

## 7. DEMO PROJECT DEFINITION

### Simple Conveyor Sorting System
For testing the full wizard flow end-to-end:

**Project:** Small conveyor sorting system
**CPU:** S7-1500 (1511C-1 PN)
**Profile:** Default Pac Technologies (SCL device code, configurable process code)

**Devices:**
| Device | Tag | Type | IO |
|--------|-----|------|-----|
| Conveyor 1 Motor | M101 | Motor DOL | DQ: start cmd, DI: running fb, DI: fault |
| Conveyor 2 Motor | M102 | Motor DOL | DQ: start cmd, DI: running fb, DI: fault |
| Conveyor 3 Motor | M103 | Motor VFD | AQ: speed ref, DI: running fb, DI: fault, AI: speed actual |
| Diverter 1 | SOL201 | Solenoid 2-pos | DQ: energize, DI: pos A, DI: pos B |
| Diverter 2 | SOL202 | Solenoid 2-pos | DQ: energize, DI: pos A, DI: pos B |
| Sensor: Entry detect | PE301 | Photoelectric | DI: detect |
| Sensor: Sort detect | PE302 | Photoelectric | DI: detect |
| Sensor: Lane A confirm | PE303 | Photoelectric | DI: detect |
| Sensor: Lane B confirm | PE304 | Photoelectric | DI: detect |
| Sensor: Entry prox | PRX401 | Proximity | DI: detect |
| Sensor: Exit prox | PRX402 | Proximity | DI: detect |
| E-Stop circuit | ESTOP | Safety | DI: ok (NC) |

**Process sequence (5 steps):**
1. Wait for entry sensor PE301 detection
2. Read sort sensor PE302 — determines Lane A or Lane B
3. Actuate appropriate diverter (SOL201 for A, SOL202 for B)
4. Confirm arrival at lane sensor (PE303 or PE304)
5. Return diverter to home, ready for next item

**HMI:** Overview screen showing 3 conveyors, 2 diverters, sensor states, motor status, E-stop indicator.

This project is small enough to generate in minutes but complex enough to demonstrate: DOL motors, VFD motor, solenoids, multiple sensor types, a decision-based sequence, and safety (E-stop).

---

## 8. TASK PRIORITY ORDER

### Critical Path (must work for demo):
1. Wizard route + step navigation UI
2. Forge store (Zustand) for step state
3. Spec upload + text extraction
4. Spec analysis AI prompt + display
5. Project setup form with profile selector
6. Device list + IO list review/edit UI
7. Device code generation (SCL FBs from templates + AI)
8. Process code generation (SCL)
9. TIA export flow (SCL import + compile)
10. Demo end-to-end test

### Important but can be simpler for demo:
11. LAD generation path (device or process code as LAD)
12. HMI screen generation + export
13. Real Cathode spec parsing demo
14. Hardware config editor integration

### Post-demo (the big restructure):
- Document management system
- Revision control / Git integration
- TIA ↔ Git sync
- Monday.com auto-updates from wizard progress
- Full profile system with HMI themes
- Multi-project dashboard with pipeline status
- Commissioning documentation templates
