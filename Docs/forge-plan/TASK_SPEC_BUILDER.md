# TASK: Functional Specification Builder
**Feature:** AI-powered generation of Cathodo-format functional specification documents  
**Status:** Ready for implementation  
**Depends on:** Existing Supabase schema, Anthropic API integration, .NET bridge (localhost:5102)  
**Claude Code:** Execute tasks sequentially. Do not begin a phase until the prior phase passes its acceptance criteria.

---

## Background

Pac-Forge requires the ability to generate industrial automation functional specification documents equivalent in quality and detail to the Cathodo Handling System spec (217108-EFD-001, 111 pages). These documents follow a strict structure:

1. **Document header** — project code, revision, dates, sign-offs  
2. **Table of contents**  
3. **Introduction** — system overview, brief description  
4. **Equipment descriptions** — per-subsystem device tag tables (Device | Tag | Description)  
5. **Functional description** — per-equipment behaviour across each operating state (Idle, Starting, Execute, Completing, Completed, E-Stop)  
6. **Alarms** — four tiers: Immediate Shutdown, Controlled Shutdown, Warnings, Interlocks  
7. **Process and alarm settings** — setpoint tables per subsystem  

The quality bar is: an experienced automation engineer should be unable to distinguish the output from a manually authored spec.

**Document format reference:** `217108-EFD-001_2-_Catodo.docx` (project folder)  
**Existing spec reference:** `PAC-EFD-003_Rev02_SingleConveyor.docx` (project folder)

---

## Agent Model Assignments

| Agent Role | Model | Rationale |
|---|---|---|
| Instrument register parser | `claude-haiku-4-5-20251001` | High-volume tag classification, column normalisation, subsystem grouping. No frontier capability needed. |
| Spec skeleton builder | `claude-sonnet-4-6` | Project metadata, subsystem topology, operating mode structure. Moderate reasoning. |
| Section generator (per subsystem) | `claude-sonnet-4-6` | Generates device tables + per-state narrative for each subsystem. Runs in parallel N times. |
| Alarm table generator | `claude-sonnet-4-6` | Categorises alarms into four tiers across all subsystems. |
| Settings table generator | `claude-sonnet-4-6` | Generates process and alarm setpoint tables with placeholder values. |
| Gap audit agent | `claude-opus-4-6` | Final single pass — reads entire generated spec, identifies missing coverage, inconsistent tags, incomplete alarm tiers. Single call per spec. |
| DOCX assembler | N/A (docx skill + Node.js) | Renders structured JSON IR to Cathodo-format Word document. No AI call. |

**Cost note:** Haiku handles all classification work. Sonnet handles all generation. Opus is called exactly once per spec for the final audit. This keeps per-spec API cost predictable.

---

## Supabase Schema — New Tables

Execute these migrations before any application code.

### `spec_projects`
Master record for each functional specification being built.

```sql
CREATE TABLE spec_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  design_profile_id UUID REFERENCES design_profiles(id) ON DELETE SET NULL,
  
  -- Document metadata
  doc_code TEXT NOT NULL,                    -- e.g. PAC-EFD-003
  revision TEXT NOT NULL DEFAULT '01',
  title TEXT NOT NULL,                       -- e.g. "Cathode Handling System"
  client_name TEXT NOT NULL,
  project_number TEXT,
  issued_by TEXT,
  verified_by TEXT,
  approved_by TEXT,
  doc_date DATE DEFAULT CURRENT_DATE,
  
  -- Control system
  plc_model TEXT,                            -- e.g. "Siemens S7-1500 CPU 1517F"
  hmi_type TEXT,                             -- e.g. "WinCC Unified"
  comms_protocol TEXT,                       -- e.g. "OPC UA", "PROFINET"
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft'       -- draft | generating | review | complete
    CHECK (status IN ('draft', 'generating', 'review', 'complete')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `instrument_registers`
Stores the imported and parsed tag register for a spec project.

```sql
CREATE TABLE instrument_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE,
  
  -- Parsed from uploaded file
  raw_filename TEXT,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Parsed tags as structured array
  -- Each entry: { tag, device_type, device_class, subsystem, description, signal_type, io_address }
  tags JSONB NOT NULL DEFAULT '[]',
  
  -- Subsystem groupings derived from tags
  -- Each entry: { subsystem_id, subsystem_name, tag_count }
  subsystems JSONB NOT NULL DEFAULT '[]',
  
  -- Parser metadata
  parse_warnings JSONB DEFAULT '[]',        -- tags with ambiguous classification
  haiku_usage JSONB DEFAULT '{}'            -- token usage for cost tracking
);
```

### `spec_sections`
Stores each generated section of the spec as structured content.

```sql
CREATE TABLE spec_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE,
  
  section_type TEXT NOT NULL               
    CHECK (section_type IN (
      'introduction',
      'equipment_description', 
      'functional_state',
      'alarm_table',
      'settings_table',
      'audit_report'
    )),
  
  subsystem_id TEXT,                       -- null for global sections (alarms, settings)
  state_name TEXT,                         -- for functional_state sections: 'idle','starting','execute','completing','completed','estop'
  
  -- Generated content
  content_json JSONB NOT NULL DEFAULT '{}', -- structured content (not prose blob)
  content_markdown TEXT,                    -- rendered markdown for preview
  
  -- Generation metadata
  model_used TEXT,
  generation_prompt TEXT,                  -- stored for regression testing / Helicone
  sonnet_usage JSONB DEFAULT '{}',
  
  -- Review state
  reviewed_by TEXT,
  review_notes TEXT,
  approved BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast retrieval by project + type
CREATE INDEX idx_spec_sections_project ON spec_sections(spec_project_id, section_type);
```

### `spec_exports`
Tracks DOCX exports.

```sql
CREATE TABLE spec_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  exported_at TIMESTAMPTZ DEFAULT NOW(),
  exported_by TEXT,
  storage_path TEXT,                        -- Supabase storage path for the .docx file
  page_count INT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed'))
);
```

---

## Phase 1 — Instrument Register Importer

**Goal:** Accept an uploaded Excel/CSV instrument register and parse it into the structured `instrument_registers` schema. This is the critical path — nothing else can run without real tag data.

**Model:** `claude-haiku-4-5-20251001`

### 1.1 — File Upload UI Component

Create `src/components/spec-builder/InstrumentRegisterUpload.tsx`.

- Accepts `.xlsx`, `.xls`, `.csv` file types
- Displays upload zone with drag-and-drop
- On file select, calls the parse API endpoint
- Shows parse results: subsystem count, tag count, any warnings
- Allows re-upload if the parse result looks wrong

### 1.2 — Parse API Endpoint

Create `src/api/spec/parse-instrument-register.ts` (or equivalent API route).

**Step 1 — Column detection (deterministic, no AI)**

Read the uploaded file using `xlsx` (npm package). Detect the header row. Map columns to canonical fields using these heuristics:

| Canonical field | Common column names to match (case-insensitive) |
|---|---|
| `tag` | tag, tag number, instrument tag, device tag, tag no |
| `device_type` | device, device type, type, instrument type |
| `description` | description, desc, function, instrument description |
| `signal_type` | signal, signal type, io type, type |
| `io_address` | address, io address, plc address, %i, %q |
| `subsystem` | subsystem, system, area, unit, group |

If a `subsystem` column is present, use it directly. If not, derive subsystem from tag prefix (see Step 3).

**Step 2 — Send to Haiku for classification**

For each row, call Haiku with this system prompt:

```
You are an industrial automation instrument classification agent.

Given a tag and description from an instrument register, classify:
1. device_class: one of [valve, motor, sensor_level, sensor_pressure, sensor_temperature, sensor_weight, sensor_flow, sensor_position, indicator, transmitter, filter, conveyor, hopper, transporter, dryer, cooler, other]
2. signal_direction: one of [DI, DO, AI, AO, internal]
3. subsystem_prefix: the subsystem group derived from the tag (e.g. "TE005" → "TE005", "GK002" → "GK002"). If the tag clearly belongs to a named subsystem, return the most specific prefix.
4. is_safety: boolean — true if the device is safety-critical (rupture disk, pressure switch interlock, E-stop)

Use these ISA/IEC tag prefix conventions:
- AY = solenoid valve / indicator
- LP = butterfly/ball valve
- LS = level switch
- WT = weight transmitter
- PIT = pressure transmitter
- PDIT = differential pressure transmitter  
- PS = pressure switch
- ZSL/ZSH = position feedback (closed/open)
- PRV = proportional/control valve
- ZIC/ZIT = proportional valve command/feedback
- KC = filter run signal
- NC = screw conveyor motor
- VFD = variable frequency drive
- GK = fan/blower motor

Respond ONLY with a JSON object. No preamble.
{
  "device_class": "...",
  "signal_direction": "...",
  "subsystem_prefix": "...",
  "is_safety": false
}
```

Batch rows in groups of 50 per Haiku call to minimise API calls. Parse the JSON response and merge back into the row data.

**Step 3 — Subsystem grouping**

Group parsed tags by `subsystem` (from column) or `subsystem_prefix` (from Haiku). For each group, derive a `subsystem_name` using this mapping:

| Prefix pattern | Inferred equipment type |
|---|---|
| Contains "hopper" or "TE" | Hopper |
| Contains "VZ" or "transporter" | Pneumatic Transporter |
| Contains "HX" or "dryer" | Dryer |
| Contains "VK" or "cooler" | Cooler |
| Contains "NZ" or "unloading" | Unloading Station |
| Contains "CA" | Magnetic Filter |
| Contains "GK" | Fan/Blower |
| Contains "mill" | Milling |

Store results in `instrument_registers.tags` (array of enriched tag objects) and `instrument_registers.subsystems` (array of subsystem summaries).

**Step 4 — Parse warning generation**

Flag these conditions as warnings (stored in `parse_warnings`):
- Tags with `device_class: "other"` — Haiku could not classify
- Tags with no `io_address` — may be internal/virtual tags
- Subsystems with fewer than 3 tags — possibly a grouping error
- Duplicate tag values

### 1.3 — Acceptance Criteria

- Upload an Excel file with 50+ rows, mixed subsystems, messy column names
- All tags classified with a `device_class` (none should remain "other" for standard ISA prefixes)
- Subsystems correctly grouped — tags from the same physical equipment appear in the same group
- Parse warnings surfaced in the UI for any ambiguous rows
- Parsed data written to `instrument_registers` table with correct `spec_project_id`
- Haiku token usage recorded in `haiku_usage` field

---

## Phase 2 — Spec Skeleton Wizard

**Goal:** Collect project metadata and confirm the subsystem topology before generation begins.

**Model:** `claude-sonnet-4-6` (for the operating modes inference step only — see 2.3)

### 2.1 — Wizard Component

Create `src/components/spec-builder/SpecSkeletonWizard.tsx`.

Six steps, linear, no skipping:

**Step 1 — Document Metadata**
Fields: Document Code, Title, Client Name, Project Number, Revision, Date, Issued By, Verified By, Approved By.  
Pre-populate from `spec_project` record if already exists.

**Step 2 — Control System**
Fields: PLC Model (text, e.g. "Siemens S7-1500 CPU 1517F"), HMI Type (dropdown: WinCC Unified / WinCC Comfort / None / Other), Communications Protocol (multi-select: OPC UA / PROFINET / Ethernet/IP / None).

**Step 3 — Subsystem Review**
Display the subsystems derived from the instrument register (from Phase 1). Each subsystem shown as a card with: name, equipment type, tag count.  
Allow the engineer to:
- Rename a subsystem
- Change the equipment type (dropdown: Hopper / Transporter / Dryer / Cooler / Unloading Station / Filter / Milling / Other)
- Merge two subsystems
- Delete a subsystem (tags remain in the register, just excluded from spec generation)
- Add a manual subsystem (for equipment with no instrumentation e.g. conveyors)

**Step 4 — Operating Modes**
Call Sonnet once with the subsystem list to infer likely operating modes.

System prompt:
```
You are an industrial automation engineering expert. Given this list of subsystems from an instrument register, infer the likely operating states/modes for this plant.

Use ISA-88 state machine conventions where applicable. Typical states include:
Idle, Starting, Execute (Running), Completing, Completed, E-Stop, Abort, Held.

Return ONLY a JSON array of state objects. No preamble.
[
  { "state_id": "idle", "state_name": "Idle", "description": "Machine not running, all outputs safe state" },
  ...
]
```

Display the inferred states as editable cards. Engineer can add, remove, and rename states. Store confirmed states in `spec_projects`.

**Step 5 — Alarm Configuration**
Pre-populate the four standard alarm tiers with defaults:

| Tier | Default name | Description shown to engineer |
|---|---|---|
| 1 | Immediate Shutdown | Causes immediate de-energisation of all outputs |
| 2 | Controlled Shutdown | Initiates a controlled stop sequence |
| 3 | Warning | Alerts operator, no automatic action |
| 4 | Interlock | Prevents start or specific action, not a running-state alarm |

Allow renaming tiers. Allow adding custom tiers.

**Step 6 — Review and Confirm**
Summary of all entries. Estimated generation scope shown: N subsystems × M states = X sections to generate. Confirm button triggers Phase 3.

### 2.2 — Acceptance Criteria

- All six wizard steps navigable with back/forward
- Subsystem topology editable and saved correctly to `spec_projects`
- Operating modes inferred correctly from a realistic subsystem list (test against Cathodo subsystem list)
- Confirmed wizard data persisted — wizard can be exited and resumed
- Confirm button disabled until all required fields in Step 1 are complete

---

## Phase 3 — AI Section Generator

**Goal:** Generate all document sections in parallel using Sonnet, then run a single Opus audit pass.

**Model:** `claude-sonnet-4-6` (section generation) + `claude-opus-4-6` (audit)

### 3.1 — Generation Orchestrator

Create `src/lib/spec-generator/orchestrator.ts`.

**Generation sequence:**

```
1. Generate introduction section (1 Sonnet call)
2. For each subsystem [PARALLEL]:
   a. Generate equipment description section (device table)
   b. For each operating state:
      Generate functional state section (state narrative)
3. Generate alarm table section (1 Sonnet call, all subsystems in context)
4. Generate settings table section (1 Sonnet call, all subsystems in context)
5. Run gap audit (1 Opus call, full spec context)
```

Steps 2a and 2b run in parallel across subsystems. Use `Promise.allSettled` — if one subsystem fails, others continue. Failed sections are flagged for manual entry.

Update `spec_projects.status` to `'generating'` at start, `'review'` on completion.

### 3.2 — Section Generator: Equipment Description

For each subsystem, generate its device table section.

**Context passed to Sonnet:**
- Subsystem name and equipment type
- All tags belonging to this subsystem (from instrument register)
- Design profile rules (if `design_profile_id` is set — inject as `RULE:` format)

**System prompt:**
```
You are a senior automation engineer authoring a formal functional specification document.
Your output style must match this example exactly.

You are generating the "Description of Subsystem Equipment" section for: {subsystem_name} ({equipment_type}).

RULES:
{design_profile_rules}

INSTRUMENT REGISTER FOR THIS SUBSYSTEM:
{tags_json}

Generate a section with:
1. A short prose description of the equipment's purpose and operation (2-4 sentences, formal technical register, third person).
2. A control device instrumentation table with columns: Device | Tag | Description
   - Every tag in the instrument register must appear in the table
   - Device column format: TAG (Type) e.g. "LP059 (Valve)"
   - Description column must be specific, not generic — state the device's actual function
   - Safety devices (rupture disks, pressure switches) must include "(Safety)" in description
   - Group related devices (valve body + position feedbacks) as consecutive rows

Respond ONLY with a JSON object:
{
  "prose": "...",
  "device_table": [
    { "device": "LP059 (Valve)", "tag": "AY062", "description": "Solenoid — Inlet valve of the transporter" },
    ...
  ]
}
```

Store result in `spec_sections` with `section_type: 'equipment_description'`, `subsystem_id`, `content_json`.

### 3.3 — Section Generator: Functional State

For each subsystem × operating state combination, generate the state narrative.

**Context passed to Sonnet:**
- Subsystem name and equipment type
- Operating state name and description
- Tags for this subsystem
- Device table already generated (from 3.2) — prevents tag name hallucination
- Equipment type template (see templates below)

**Equipment type templates** — embed in system prompt for each type:

*Hopper — Idle state template:*
```
The idle state description for a hopper must cover:
- Filter state (running or stopped, dust extraction status)
- Fluidization state (enabled at idle setting or disabled)
- All valve positions (outlet valve: closed, vent valves: state)
- Level sensor states (what high/low sensors indicate in idle)
- Weight reading (displayed but not acted on)
- Any pressure monitoring active/inactive
```

*Pneumatic Transporter — Execute state template:*
```
The execute (running) state description for a pneumatic transporter must cover:
- Load cycle: inlet valve opens, vessel fills to high level or target weight
- Pressure sequence: inlet valve closes, vessel pressurises to set pressure
- Conveying sequence: outlet valve opens, material conveyed to destination
- End of convey: low pressure detected, outlet valve closes, vent valve opens
- Cycle repetition: new charge cycle starts until target weight reached at destination
- Semi-auto mode note: each cycle step can be tested independently
```

*Dryer — Execute state template:*
```
The execute (running) state description for a dryer must cover:
- Heating enable conditions (inlet temperature setpoint reached)
- Temperature control loop behaviour
- Product residence time monitoring
- Outlet conditions that trigger completion
- Any purge sequences on inlet/outlet
```

Add templates for: Cooler, Unloading Station, Magnetic Filter, Milling.

**System prompt:**
```
You are a senior automation engineer authoring a formal functional specification.

You are generating the "{state_name}" state section for: {subsystem_name} ({equipment_type}).

DEVICE TABLE (use ONLY these tag names — never invent tags):
{device_table_json}

STATE TEMPLATE FOR {equipment_type} — {state_name}:
{equipment_state_template}

Write 3-6 formal technical sentences describing the equipment behaviour in this state.
- Use third person formal register ("The hopper filter runs continuously...")
- Reference specific tag names from the device table where relevant
- Do not use bullet points — prose paragraphs only
- If a behaviour is not determinable from the available data, write: "[ENGINEER TO COMPLETE — {reason}]"

Respond ONLY with a JSON object:
{
  "state_narrative": "..."
}
```

Store in `spec_sections` with `section_type: 'functional_state'`, `subsystem_id`, `state_name`.

### 3.4 — Section Generator: Alarm Table

Single Sonnet call with all subsystems' device tables in context.

**System prompt:**
```
You are a senior automation engineer authoring a formal functional specification alarm section.

SUBSYSTEMS AND DEVICE TABLES:
{all_subsystems_with_device_tables_json}

ALARM TIERS DEFINED FOR THIS PROJECT:
{alarm_tiers_json}

Generate an alarm table for each tier. For each alarm entry include:
- tag: the instrument tag that triggers this alarm
- description: what the alarm condition is
- action: what the control system does automatically
- setpoint: use "[ENGINEER TO SET]" as placeholder if not determinable
- delay: use "[ENGINEER TO SET]" as placeholder if not determinable

Classification rules:
- Safety pressure switches (PS tags) → Immediate Shutdown
- High pressure transmitters above safety limit → Immediate Shutdown  
- Differential pressure high on filters → Warning (first), Controlled Shutdown (second stage)
- Weight out of range → Warning
- Position confirmation timeout (ZSL/ZSH) → Controlled Shutdown
- Temperature out of range → Warning or Controlled Shutdown depending on severity
- Rupture disk (AY indicators) → Immediate Shutdown
- Run feedback timeout on motors → Controlled Shutdown
- Interlock conditions (permissive not met) → Interlock tier

Respond ONLY with a JSON object:
{
  "alarm_tiers": [
    {
      "tier_name": "Immediate Shutdown",
      "alarms": [
        { "tag": "PS064", "description": "...", "action": "...", "setpoint": "...", "delay": "..." }
      ]
    }
  ]
}
```

### 3.5 — Section Generator: Settings Table

Single Sonnet call generating process parameter and setpoint tables per subsystem.

**System prompt:**
```
You are generating the Process Settings and Alarm Settings section of a functional specification.

SUBSYSTEMS:
{subsystems_with_equipment_types_json}

For each subsystem, generate two tables:
1. Process settings — operational parameters (temperatures, pressures, weights, timers, speeds)
2. Alarm settings — the threshold values that trigger alarms

For every setpoint value, use "[ENGINEER TO SET]" as placeholder unless the value is a well-known industry standard for this equipment type.

Respond ONLY with a JSON object per subsystem:
{
  "subsystems": [
    {
      "subsystem_id": "...",
      "process_settings": [
        { "parameter": "Transport pressure setpoint", "default": "[ENGINEER TO SET]", "unit": "bar", "notes": "" }
      ],
      "alarm_settings": [
        { "parameter": "High pressure alarm", "setpoint": "[ENGINEER TO SET]", "unit": "bar", "delay": "[ENGINEER TO SET]" }
      ]
    }
  ]
}
```

### 3.6 — Gap Audit Agent

Single Opus call after all sections are generated.

**Context passed to Opus:**
- Full spec as assembled markdown (all sections concatenated)
- Complete instrument register (all tags)
- Subsystem list and state list

**System prompt:**
```
You are a principal automation engineer conducting a formal review of a functional specification document before client issue.

COMPLETE INSTRUMENT REGISTER:
{instrument_register_json}

GENERATED SPECIFICATION:
{full_spec_markdown}

Conduct a structured gap audit. Check:

1. TAG COVERAGE — Is every tag in the instrument register referenced at least once in the specification? List any missing tags.

2. STATE COVERAGE — For each subsystem, is every defined operating state (Idle, Starting, Execute, Completing, Completed, E-Stop) described? List any missing state/subsystem combinations.

3. ALARM COVERAGE — Is every safety device (PS, rupture disk, pressure transmitter) represented in the alarm table? List any missing.

4. PLACEHOLDER COUNT — Count all "[ENGINEER TO SET]" and "[ENGINEER TO COMPLETE]" placeholders. List each one with its location.

5. TAG CONSISTENCY — Are tag names used consistently throughout? Flag any inconsistencies between the device table and narrative sections.

6. INTERLOCK COMPLETENESS — Are interlocks defined for all critical permissive conditions?

Respond ONLY with a JSON object:
{
  "overall_status": "pass" | "review_required" | "fail",
  "missing_tags": [...],
  "missing_states": [...],
  "missing_alarms": [...],
  "placeholders": [...],
  "tag_inconsistencies": [...],
  "interlock_gaps": [...],
  "opus_usage": {}
}
```

Store audit result in `spec_sections` with `section_type: 'audit_report'`.

### 3.7 — Acceptance Criteria

- All subsystem × state combinations generate a section (or are flagged as failed)
- No generated section references a tag not in the instrument register
- Alarm table contains at least one entry per safety device in the register
- Opus audit report generated and stored
- `spec_projects.status` updated to `'review'` on completion
- Generation token usage recorded per section for cost monitoring

---

## Phase 4 — Structured Spec Editor

**Goal:** Allow the engineer to review and edit each generated section before export.

### 4.1 — Editor Component

Create `src/components/spec-builder/SpecEditor.tsx`.

**Layout:** Left panel — section navigation tree. Right panel — section editor.

**Navigation tree structure:**
```
├── Introduction
├── Equipment Descriptions
│   ├── [Subsystem 1 name]
│   ├── [Subsystem 2 name]
│   └── ...
├── Functional Description
│   ├── [Subsystem 1]
│   │   ├── Idle
│   │   ├── Starting
│   │   ├── Execute
│   │   └── ...
│   └── ...
├── Alarms
│   ├── Immediate Shutdown
│   ├── Controlled Shutdown
│   ├── Warnings
│   └── Interlocks
├── Settings
│   ├── [Subsystem 1]
│   └── ...
└── Audit Report  ← shows Opus gap analysis
```

**Section editor — equipment description:**
- Editable prose textarea (top)
- Inline-editable device table (add/remove/edit rows)
- Each row: Device (text) | Tag (text) | Description (text)

**Section editor — functional state:**
- Editable prose textarea
- "[ENGINEER TO COMPLETE]" placeholders highlighted in amber
- Regenerate button — re-runs the Sonnet call for this section only

**Section editor — alarm table:**
- Tabbed by tier
- Inline-editable table: Tag | Description | Action | Setpoint | Delay
- "[ENGINEER TO SET]" cells highlighted in amber
- Add/remove alarm rows

**Section editor — settings table:**
- Two sub-tables per subsystem: Process Settings | Alarm Settings
- All "[ENGINEER TO SET]" cells highlighted, click-to-edit

**Audit report panel:**
- Read-only display of Opus gap analysis
- Each gap item has a "Go to section" button that navigates to the relevant section
- Overall status badge: Pass (green) / Review Required (amber) / Fail (red)
- Re-run audit button (triggers another Opus call)

**Section approval:**
- Each section has an "Approve" toggle
- Export is gated — all sections must be approved before DOCX export is enabled

### 4.2 — Acceptance Criteria

- All section types render correctly in the editor
- Device table rows editable inline, changes persisted to `spec_sections.content_json`
- Amber highlighting on all placeholders
- Regenerate works for individual sections without re-running the whole pipeline
- Audit report navigates correctly to flagged sections
- Export button disabled until all sections approved

---

## Phase 5 — DOCX Export

**Goal:** Render the approved spec to a Cathodo-format Word document.

**Model:** None — deterministic rendering only.

### 5.1 — DOCX Renderer

Create `src/lib/spec-generator/docx-renderer.ts`.

Use the `docx` npm package (already referenced in `/mnt/skills/public/docx/SKILL.md`).

**Document structure to render:**

```
Title Block Table (no borders, right-aligned):
  CODE:         [doc_code]
  REVISION:     [revision]  
  DATE:         [doc_date formatted DD.MM.YYYY]
  ISSUED BY:    [issued_by]
  VERIFIED BY:  [verified_by]
  APPROVED BY:  [approved_by]
  TOTAL PAGES:  [calculated on export]

Heading 1: [title] (centred, all caps)
Subheading: [client_name]

Auto-generated Table of Contents (Word field, not static)

Section 1: Introduction
  1.1 Brief Functioning Description
  1.2 Control System

Section 2: Description of Subsystem Equipment
  2.N [Subsystem Name]
    2.N.1 Control Device Instrumentation [Subsystem Name]
      [Device table: 3 columns, header row shaded, all borders]

Section 3: Functional Description
  3.1 Mode of Operation and Machine Behaviour
  3.2+ [Per state, per subsystem]

Section 4: Alarms
  4.1 Immediate Shutdown [table]
  4.2 Controlled Shutdown [table]
  4.3 Warnings [table]
  4.4 Interlocks [table]

Section 5: Process Settings and Alarm Settings
  5.N [Per subsystem — two tables each]
```

**Formatting rules (match Cathodo exactly):**
- Font: Times New Roman 11pt for body, 12pt for headings
- Section headings: Bold, numbered (1, 1.1, 1.1.1)
- Device tables: 3 columns, auto-width, all borders 0.5pt, header row light grey fill
- Alarm tables: 5 columns (Tag | Description | Action | Setpoint | Delay)
- Settings tables: 3 columns (Parameter | Value | Unit)
- Page numbers: bottom centre
- Header: document code + revision on every page after cover

### 5.2 — Export Flow

1. Validate all sections are approved (`approved = TRUE`)
2. Assemble full document from `spec_sections` ordered by section type and subsystem order
3. Run DOCX renderer
4. Upload resulting `.docx` to Supabase Storage at `spec-exports/{spec_project_id}/{doc_code}_Rev{revision}.docx`
5. Create `spec_exports` record
6. Return signed URL for download (24-hour expiry)

### 5.3 — Acceptance Criteria

- Generated DOCX opens correctly in Microsoft Word
- Title block matches Cathodo format exactly
- All device tables render with correct column widths and borders
- Section numbering is correct and hierarchical
- Page numbers present on all pages after cover
- A spec based on a 50-tag instrument register generates a minimum 20-page document
- The document is indistinguishable in style from the Cathodo reference document by a reviewing engineer

---

## Implementation Notes for Claude Code

**Before starting Phase 1:**
- Read `/mnt/skills/public/xlsx/SKILL.md` for the instrument register file parsing approach
- Read `/mnt/skills/public/docx/SKILL.md` before Phase 5 — the docx-js approach is required, do not use alternative libraries

**Environment:**
- Anthropic API calls use the existing API client pattern in the codebase
- All model strings must use exact values from the model assignment table above
- Token usage must be captured for every API call and stored in the relevant JSONB field

**Error handling:**
- All Anthropic API calls wrapped in try/catch with exponential backoff (max 3 retries)
- If a section generation fails after retries, write a placeholder section with `content_json: { "error": true, "message": "..." }` — do not halt the pipeline
- Surface failed sections in the editor UI with a red "Failed — click to retry" state

**Parallelism:**
- Phase 3 section generation: use `Promise.allSettled` with a concurrency limit of 5 simultaneous Sonnet calls to avoid rate limiting
- Do not parallelise the Opus audit call — it must run after all Sonnet calls complete

**Prompt storage:**
- Store the exact prompt sent to each model in `spec_sections.generation_prompt`
- This enables Helicone integration and prompt regression testing in a future task

---

## Definition of Done

- [ ] Instrument register upload parses a real 50+ tag Excel file correctly
- [ ] Wizard completes and persists all project metadata
- [ ] Full generation pipeline runs end-to-end on the Cathodo subsystem set
- [ ] No generated section contains a tag name not present in the instrument register
- [ ] Opus audit report generated and displayed in the editor
- [ ] All placeholder cells highlighted amber in the editor
- [ ] DOCX export opens in Word with correct formatting
- [ ] Generated document reviewed by Kasper against Cathodo reference — style match confirmed
