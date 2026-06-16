# ISA-88 Part 1 Compliance Implementation

**Date:** 2026-06-16
**Standard:** ANSI/ISA-88.00.01-2010 — Batch Control Part 1: Models and Terminology
**Scope:** Full ISA-88 Part 1 compliance across FDS authoring and code generation
**Recipe Model:** Excluded (not applicable to discrete/continuous manufacturing)

---

## 1. Terminology Mapping

### Physical Model (ISA-88 §4.4)

| ISA-88 Term | Old Pac-Forge Term | Type Name | UI Label | Code Prefix |
|---|---|---|---|---|
| Process Cell | System | `ProcessCell` | "Process Cell" | `SC_` |
| Unit | Subsystem | `Unit` | "Unit" | `UC_` |
| Equipment Module | Assembly | `EquipmentModule` | "Equipment Module" | `EM_` |
| Control Module | Device | `ControlModule` | "Control Module" | `CM_` |

Equipment Module layer is **collapsible** per §4.4.3.7. When collapsed, Control Modules belong directly to the Unit.

### Procedural Control Model (ISA-88 §5.3)

| ISA-88 Term | Old Pac-Forge Term | Type Name |
|---|---|---|
| Procedure | System Orchestration | `SystemProcedure` |
| Unit Procedure | Subsystem Orchestration | `UnitProcedure` |
| Operation | Assembly Sequential State | `Operation` |
| Phase | Step (StepV2) | `PhaseStep` |

### Control Types (ISA-88 §5.2–5.4)

| ISA-88 Term | Applies To | Generated Block |
|---|---|---|
| Basic Control | Control Module FBs (motor, valve, sensor) | `CM_` prefix, no state machine |
| Procedural Control | Equipment Module FBs with state machines | `EM_` prefix, PackML states |
| Coordination Control | Unit/System orchestrations + interlocks | `UC_`/`SC_` prefix |

### Process Model (ISA-88 §4.3) — NEW

| ISA-88 Term | Description |
|---|---|
| Process | Overall machine process (Process Cell level) |
| Process Stage | What happens at Unit level |
| Process Operation | What Equipment Modules execute |
| Process Action | What Control Modules do (valve open, motor run) |

---

## 2. Data Model Changes

### TypeScript Type Renames

**Physical Model hierarchy:**

| Current Type | New Type | File |
|---|---|---|
| `SubsystemV2` | `UnitV2` | `spec-contract-v2.ts` |
| `AssemblyV2` | `EquipmentModuleV2` | `spec-contract-v2.ts` |
| `DeviceV2` | `ControlModuleV2` | `spec-contract-v2.ts` |
| `SubsystemConfig` | `UnitConfig` | `spec-builder.ts` |
| `AssemblyConfig` | `EquipmentModuleConfig` | `spec-builder.ts` |
| `DeviceConfig` | `ControlModuleConfig` | `spec-builder.ts` |
| `DeviceClass` | `ControlModuleClass` | `spec-builder.ts` |
| `DeviceStateEntry` | `ControlModuleStateEntry` | `spec-builder.ts` |

**Procedural Control Model:**

| Current Type | New Type | File |
|---|---|---|
| `SystemOrchestration` | `SystemProcedure` | `spec-builder.ts` |
| `SubsystemOrchestration` | `UnitProcedure` | `spec-builder.ts` |
| `SubsystemStateSequence` | `UnitProcedureSequence` | `spec-builder.ts` |
| `InterAssemblyInterlock` | `InterEquipmentModuleInterlock` | `spec-builder.ts` |
| `FdsAssemblySession` | `OperationSession` | `spec-builder.ts` |
| `StepV2` | `PhaseStep` | `spec-contract-v2.ts` |

**Forge types:**

| Current Type | New Type | File |
|---|---|---|
| `ForgeAssemblyEntry` | `ForgeEquipmentModuleEntry` | `forge.ts` |
| `ForgeDeviceEntry` | `ForgeControlModuleEntry` | `forge.ts` |
| `AssemblyContract` | `EquipmentModuleContract` | `forge-contract.ts` |
| `AssemblyBrief` | `EquipmentModuleBrief` | `forge-brief.ts` |
| `AssemblyAlarm` | `EquipmentModuleAlarm` | `forge-brief.ts` |

### New Process Model Types

```typescript
// spec-contract-v2.ts

interface ProcessModel {
  process_name: string;
  process_stages: ProcessStage[];
}

interface ProcessStage {
  stage_id: string;
  stage_name: string;
  description: string;
  unit_id: string;
  process_operations: ProcessOperation[];
}

interface ProcessOperation {
  operation_id: string;
  operation_name: string;
  description: string;
  equipment_module_id?: string;
  process_actions: ProcessAction[];
}

interface ProcessAction {
  action_id: string;
  action_name: string;
  description: string;
  control_module_id: string;
}
```

### Database Table Renames

| Current Table | New Table |
|---|---|
| `fds_assembly_sessions` | `fds_operation_sessions` |
| `fds_subsystem_orchestrations` | `fds_unit_procedures` |
| `fds_system_orchestrations` | `fds_system_procedures` |

### Key Column Renames (all tables)

| Current Column | New Column |
|---|---|
| `subsystem_id` | `unit_id` |
| `subsystem_name` | `unit_name` |
| `assembly_id` | `equipment_module_id` |
| `assembly_name` | `equipment_module_name` |
| `device_id` | `control_module_id` |
| `device_name` | `control_module_name` |
| `device_class` | `control_module_class` |

### SpecContractV2 Update

```typescript
interface SpecContractV2 {
  schema_version: 3;
  project: SpecProjectHeader;
  hierarchy: Hierarchy;
  process_model?: ProcessModel;                                          // NEW
  states: OperatingStateV2[];
  alarm_tiers: AlarmTier[];
  equipment_modules: Record<string, EquipmentModuleContract>;            // renamed
  unit_procedures: Record<string, Record<string, UnitProcedureSequence>>; // renamed
  system_procedure?: SystemProcedure | null;                             // renamed
  alarms: AlarmRow[];
  io_list: IoListEntry[];
  faults: FaultRow[];
  modes?: OperatorMode[];
  configuration_parameters?: ConfigParameter[];
  confirmation_status: "unconfirmed" | "confirmed";
}
```

---

## 3. FDS Engine Updates

### ISA-88 Reference — Two-Tier System

**Tier 1: Condensed reference (always injected)**

Create `ai/ISA88_PHYSICAL_MODEL.md` — concise reference always injected into prompts:

- ISA-88 Part 1 definitions for all 4 physical model levels (with clause numbers)
- Collapsibility rules (Equipment Module optional per §4.4.3.7)
- Control type definitions (Basic, Procedural, Coordination)
- Process Model vs Procedural Model distinction
- Naming conventions (CM_, EM_, UC_, SC_ prefixes)
- Common mistakes to avoid

This covers the 80% case — naming, hierarchy rules, control types. Small token cost, always available.

**Tier 2: Full standard indexed in Reference Library (on-demand lookup)**

The ISA-88 PDF (`Docs/standards/606117434-ISA-88-00-01-Batch-Control-Part-1-Models-and-Terminology.pdf`) is sectioned and indexed into the existing Reference Library system (`reference_library_docs` + `reference_library_sections`).

Sectioning approach (~30-40 sections by clause):
- §3 Definitions → individual definition groups
- §4.3 Process Model (§4.3.1–§4.3.6 each a section)
- §4.4 Physical Model (§4.4.1–§4.4.3.7 each a section)
- §5.2 Basic Control, §5.3 Procedural Control, §5.4 Coordination Control
- §5.3.4 Procedural elements (§5.3.4.1–§5.3.4.5 each a section)
- §6 Recipes (minimal — excluded from implementation but indexed for reference)
- §7–8 Modes, states, exception handling
- Annex A State transition diagrams

Each section gets topic tags: `physical_model`, `procedural_control`, `equipment_module`, `control_module`, `collapsibility`, `coordination_control`, `basic_control`, `modes`, `states`, etc.

At generation time, the existing `reference-lookup.ts` two-pass system:
1. Extracts relevant topics from the current context via AI
2. FTS + tag search against ISA-88 sections
3. Injects matching clauses into the prompt as `## ISA-88 Reference`

This gives the AI access to the actual standard text for edge cases — "is this an Equipment Module or a Control Module?", "what does collapsible mean for this configuration?", "what are the coordination control rules between Units?"

**Benefits:**
- Actual standard text, not just our summary — more defensible decisions
- Token-efficient — only relevant sections injected per generation
- Scales to future standards (ISA-88 Part 2, IEC 61131-3, etc.)
- Uses existing infrastructure — no new retrieval code needed

### Instrument Register Parser

`instrument-parser.ts` changes:

- Template columns: "Subsystem" → "Unit", "Assembly" → "Equipment Module"
- `downloadTemplate()` uses ISA-88 column headers
- AI classification prompt uses ISA-88 definitions:
  - "Classify each IO tag into the ISA-88 physical model: Unit (functional station), Equipment Module (coordinated device group), Control Module (single physical device)"
- `buildHierarchyFromTags()` builds `UnitV2 → EquipmentModuleV2 → ControlModuleV2`
- `InstrumentTag` type: `subsystem` → `unit`, `assembly` → `equipment_module`

### Wizard UI Labels

All wizard steps use ISA-88 terms:

- "Subsystems" → "Units"
- "Assemblies" → "Equipment Modules"
- "Devices" → "Control Modules"
- Tooltips include ISA-88 definitions with clause references

### Process Model Authoring

New FDS section authored alongside the Procedural Model:

1. After hierarchy confirmation, AI proposes a Process Model from the functional spec
2. Process Model describes what happens to the product at each level
3. User validates/edits
4. Process Model informs Procedural Model — AI references "this Operation achieves Process Operation X"

**Process vs Procedure:**
- Process Model = WHAT (product perspective)
- Procedural Model = HOW (equipment perspective)
- Linked via Unit ↔ Process Stage, Equipment Module ↔ Process Operation

### FDS Prompt Builder Updates

All FDS prompt builders:

1. Import and inject ISA-88 reference definitions from `ai/ISA88_PHYSICAL_MODEL.md`
2. Use ISA-88 terminology throughout
3. Include control type classification in context:
   - "You are generating **basic control** logic for Control Module {cm_name}"
   - "You are generating **procedural control** for Equipment Module {em_name}"
   - "You are generating **coordination control** for Unit {unit_name}"
4. Reference Process Model when generating procedures

### FDS Validation — ISA-88 Checks

New validation category `isa88_compliance`:

- Every Control Module assigned to exactly one Unit (directly or via Equipment Module)
- Equipment Module collapsibility: if collapsed, Control Modules correctly parented to Unit
- Process Model coverage: every Unit has at least one Process Stage
- Procedural coverage: every operating state has procedures at each active level
- No legacy terms in user-facing descriptions

---

## 4. Code Generation Updates

### FB Naming Convention

| Block Type | ISA-88 Control Type | Pattern | Example |
|---|---|---|---|
| Control Module FB | Basic Control | `CM_{DeviceClass}_{Tag}` | `CM_Motor_M01` |
| Control Module IDB | Basic Control | `CM_IDB_{Tag}` | `CM_IDB_M01` |
| Equipment Module FB | Procedural Control | `EM_{Name}` | `EM_CarriageDrive` |
| Equipment Module IDB | Procedural Control | `EM_IDB_{Name}` | `EM_IDB_CarriageDrive` |
| Unit FC | Coordination Control | `UC_{Name}` | `UC_Carriage` |
| System OB/FC | Coordination Control | `SC_{Name}` | `SC_SegmentWagon` |

### Generated Code Structure

**Control Module FBs (Basic Control):**
- Single device control (motor start/stop, valve open/close, sensor read)
- No state machine — direct IO with interlocks
- Standard interface: `iCmd`, `iEnable`, `oRunning`, `oFault`, `oStatus`
- ISA-88 header comment in generated code

**Equipment Module FBs (Procedural Control):**
- State machine driven (PackML states)
- Calls Control Module FBs
- Manages Operations and Phases
- Standard interface: `iCmd`, `iMode`, `oState`, `oStatus`, `oFault`
- ISA-88 header comment

**Unit FCs (Coordination Control):**
- Coordinates Equipment Modules within a Unit
- Manages Unit Procedures
- Handles inter-Equipment-Module interlocks
- ISA-88 header comment

### All 4 Generation Paths Updated

| Path | Prompt Builder | Changes |
|---|---|---|
| Pac-ST pipeline | `prompt-builder.ts` | ISA-88 definitions, FB naming, control type context |
| Process code | `process-prompt-builder.ts` | ISA-88 definitions, Process Model context |
| TIA Console demo | Full pipeline (inherits) | Inherits from prompt-builder.ts |
| Compile fix | `compile-fix-prompt.ts` | ISA-88 naming awareness (preserve CM_/EM_ prefixes) |

Additional prompt builders updated:
- `review-prompt-builder.ts` — reviewer checks ISA-88 naming
- `rewrite-prompt-builder.ts` — rewrite preserves ISA-88 structure
- `pm-prompt-builder.ts` — PM uses ISA-88 terminology
- `pattern-librarian-prompt.ts` — pattern librarian uses ISA-88 terms

### Platform Rules Update

`ai/PLATFORM_RULES_SIEMENS_TIA.md` gets ISA-88 Compliance section:
- Naming rules (CM_, EM_, UC_, SC_ prefixes)
- Control type rules (basic = no state machine, procedural = state machine, coordination = orchestration)
- Block header requirements
- ISA-88 clause references

### Interface Contract Updates

`EquipmentModuleContract` (renamed from `AssemblyContract`):
- `stateDefinitions` stays (PackML state names)
- Field names updated: `assemblyId` → `equipmentModuleId`, `assemblyTag` → `equipmentModuleTag`

`ForgeArtifact` gets ISA-88 metadata:
- `isa88ControlType?: "basic" | "procedural" | "coordination"` — set based on block origin
- `isa88Level?: "control_module" | "equipment_module" | "unit" | "process_cell"` — physical model level

---

## 5. Validation, Documentation & CLAUDE.md

### Post-Generation Validation

- FB prefix validation: CM FBs start with `CM_`, EM FBs with `EM_`
- Block header contains ISA-88 classification comment
- Equipment Module FBs contain state machine (procedural control)
- Control Module FBs do NOT contain state machines (basic control only)
- Standards Reviewer gets ISA-88 naming as review criterion

### CLAUDE.md Hierarchy Section

Rewritten to reference ISA-88:

```markdown
## Machine Hierarchy — ISA-88 Part 1 Compliant (Non-negotiable)

Per ANSI/ISA-88.00.01 §4.4:

- **Process Cell** — the full machine / production line (§4.4.3.3)
- **Unit** — a functional station carrying out a major processing activity (§4.4.3.4)
- **Equipment Module** — a coordinated group of control modules (§4.4.3.5). COLLAPSIBLE per §4.4.3.7.
- **Control Module** — a single physical device with IO signals (§4.4.3.6)

Rules:
- Control Modules get FBs (basic control, CM_ prefix)
- Equipment Modules get FBs with state machines (procedural control, EM_ prefix)
- Units are coordination (UC_ prefix)
- Equipment Module layer is optional
```

### ISA-88 Reference System

- **Tier 1**: `ai/ISA88_PHYSICAL_MODEL.md` — condensed reference, always injected into prompts
- **Tier 2**: ISA-88 PDF sectioned into Reference Library — on-demand lookup via `reference-lookup.ts`

### File-Level Comments

Every file implementing ISA-88 concepts gets a one-line header comment:

```typescript
/** ISA-88 Part 1 (ANSI/ISA-88.00.01) — Physical Model §4.4 */
```

---

## Implementation Layers

### Layer 1 — Foundation
- TypeScript type renames across all type files
- Database drop/recreate with ISA-88 column/table names
- Create `ai/ISA88_PHYSICAL_MODEL.md` condensed reference file (Tier 1)
- Section and index ISA-88 PDF into Reference Library (Tier 2)
- Update CLAUDE.md hierarchy section
- Update Zod schemas

### Layer 2 — FDS Engine
- Instrument register parser + template (ISA-88 columns)
- Wizard UI labels
- Process Model data structure and authoring
- FDS prompt builders (ISA-88 definitions injected)
- FDS validation (ISA-88 compliance checks)

### Layer 3 — Code Generation
- All 4 prompt builders updated
- Platform rules ISA-88 section
- FB naming convention (CM_, EM_, UC_, SC_)
- Interface contract updates
- Standards Reviewer ISA-88 checks

### Layer 4 — Validation & Polish
- Post-generation ISA-88 compliance validation
- Cross-cutting consistency checks
- End-to-end testing with sample projects
