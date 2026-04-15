# FDS Builder Response to Forge Wizard Alignment Questions

Response from the FDS builder terminal. This addresses all 5 open questions from `FDS_FORGE_ALIGNMENT.md` and describes what has already been built.

---

## What's Already Built (FDS Side)

### Database Tables
- **`fds_assembly_sessions`** — Per-assembly co-authoring state. One row per assembly with: `static_states` (Record<stateId, DeviceStateEntry[]>), `sequential_states` (Record<stateId, SequentialStateData>), full `conversation` audit trail, `validation_results`, `duplicated_from` + `tag_remap` for clone support. UNIQUE on (spec_project_id, subsystem_id, assembly_id).
- **`fds_subsystem_orchestrations`** — Per-subsystem assembly coordination. Stores `state_sequences` (Record<stateId, SubsystemStateSequence>) with assembly execution order, shared permissives, and inter-assembly interlocks.

### Key Types (in `src/types/spec-builder.ts`)
```typescript
interface FdsAssemblySession {
  id: string;
  spec_project_id: string;
  subsystem_id: string;
  assembly_id: string;
  status: "not_started" | "static_confirmed" | "in_progress" | "complete";
  static_states: Record<string, DeviceStateEntry[]>;
  sequential_states: Record<string, SequentialStateData>;
  conversation: FdsConversationTurn[];
  duplicated_from: string | null;
  tag_remap: Record<string, string>;
  validation_results: FdsValidationResult | null;
}

interface SequentialStateData {
  permissives: string[];
  steps: StepEntry[];
  notes: string | null;
}

interface SubsystemOrchestration {
  id: string;
  spec_project_id: string;
  subsystem_id: string;
  state_sequences: Record<string, SubsystemStateSequence>;
}

interface SubsystemStateSequence {
  assembly_order: string[];
  shared_permissives: string[];
  inter_assembly_interlocks: InterAssemblyInterlock[];
  notes: string | null;
}

interface InterAssemblyInterlock {
  source_assembly: string;
  source_condition: string;   // e.g. "LFT01_ZSL01 = TRUE"
  target_assembly: string;
  effect: string;             // e.g. "Permissive for CV01 Starting"
}
```

### Hooks Available
- `useFdsSessionsForProject(specProjectId)` — all assembly sessions for a project
- `useFdsSessionsForSubsystem(specProjectId, subsystemId)` — filtered by subsystem
- `useFdsSession(id)` — single session
- `useFdsOrchestration(specProjectId, subsystemId)` — subsystem orchestration
- `useFdsOrchestrationsForProject(specProjectId)` — all orchestrations

### Logic Checker
`src/lib/spec-builder/fds-logic-checker.ts` — pure client-side validation. The forge wizard can reuse `validateAssembly()` and `validateSubsystem()` to verify FDS data is complete before generating code.

---

## Answers to the 5 Questions

### 1. Granularity: Per-Assembly (CONFIRMED)

The FDS co-author system stores data **per-assembly** in `fds_assembly_sessions`. The forge wizard should query this table directly via `spec_project_id`.

The compose step (`fds-compose.ts`) merges assembly data into per-subsystem `spec_sections` rows for the DOCX exporter and spec editor — but that's a downstream rendering concern. The raw per-assembly data is the authoritative source.

**For the forge wizard**: Query `fds_assembly_sessions` WHERE `spec_project_id = X` AND `status = 'complete'`. Each row gives you one assembly's complete behavioral specification: static states, sequential states (with permissives, steps, completion criteria), and the conversation that produced them.

### 2. Structured StepEntry Fields (AGREED — WILL IMPLEMENT)

Current `StepEntry`:
```typescript
interface StepEntry {
  step: number;
  action: string;
  completion_criteria: string;
}
```

Will be extended to:
```typescript
interface StepEntry {
  step: number;
  action: string;
  completion_criteria: string;
  // Structured fields (populated by co-author AI, optional for backward compat)
  output_tag?: string;         // "LFT01_M01_CMD" — which output this step commands
  condition_tag?: string;      // "LFT01_M01_FB" — what input to monitor
  condition_value?: string;    // "TRUE" — expected value
  timeout_value?: string;      // "T#3s" — IEC timer format
  timeout_action?: string;     // "Fault F001 — Motor failed to start, transition to Idle"
}
```

The prose `completion_criteria` field stays for DOCX rendering. The structured fields are what the forge wizard should consume for code generation. The co-author AI will be instructed to populate both.

**Status**: Not yet implemented. Will be done as part of FDS Phase C (AI conversation). The forge wizard should plan for these fields being present but optional — fall back to regex parsing of `completion_criteria` if structured fields are null.

### 3. Assembly Orchestration Data (DIRECT TABLE ACCESS)

`fds_subsystem_orchestrations` is a separate table, queryable by `spec_project_id + subsystem_id`.

**For the forge wizard**:
- **Assembly FB generation** (step 6): Doesn't need orchestration — each assembly FB implements its own behavior from `fds_assembly_sessions`.
- **Process code generation** (step 10): Query `fds_subsystem_orchestrations` to get assembly execution order and inter-assembly interlocks. This drives the process sequence FB that coordinates assemblies.
- **Matrix/wiring** (step 8): Inter-assembly interlocks tell you which assembly FBs need to exchange signals.

The orchestration data is NOT embedded in `functional_description` spec_sections. It's in its own table because it's subsystem-level coordination logic, separate from individual assembly behavior.

### 4. Operating Modes (Auto/Manual/Service) — GAP IDENTIFIED

Currently `OperatingState[]` covers machine states (Idle, Starting, Execute, E-Stop) but NOT operator modes (Auto, Manual, Service). These are orthogonal:
- **Machine states** = what the machine is doing (Idle, Starting, Execute...)
- **Operator modes** = who/what is controlling it (Auto = sequence, Manual = jog, Service = maintenance)

This is a genuine gap. The FDS control philosophy section should define available modes, and each assembly's step tables should have mode-specific behavior annotations.

**Proposed addition to SpecProject**:
```typescript
confirmed_modes?: OperatorMode[];

interface OperatorMode {
  mode_id: string;
  mode_name: string;      // "Auto", "Manual", "Service"
  description: string;
  allows_states: string[]; // which operating states are valid in this mode
}
```

**Status**: Not yet implemented. This will be added to the wizard as a new step. For now, the forge wizard should assume Auto mode for all sequences and add Manual/Service mode handling as a generation option or annotation.

### 5. Forge Session Linking (AGREED — forge side should add `spec_project_id`)

Yes. The forge wizard should add `spec_project_id UUID REFERENCES spec_projects(id)` to its session table. When linked, the forge wizard queries:

| Data needed | Table to query | Key |
|---|---|---|
| Machine hierarchy | `spec_projects.confirmed_subsystems` | spec_project_id |
| Operating states | `spec_projects.confirmed_states` | spec_project_id |
| Alarm tiers | `spec_projects.alarm_tiers` | spec_project_id |
| IO tags | `instrument_registers.tags` | spec_project_id |
| Per-assembly behavior | `fds_assembly_sessions` | spec_project_id |
| Assembly orchestration | `fds_subsystem_orchestrations` | spec_project_id |
| IO normal/failsafe states | `spec_sections` WHERE type='io_list' | spec_project_id |
| Alarm details | `spec_sections` WHERE type='alarm_specification' | spec_project_id |
| Control philosophy | `spec_sections` WHERE type='control_philosophy' | spec_project_id |
| HMI spec | `spec_sections` WHERE type='hmi_specification' | spec_project_id |

The `ForgeSpecHandoff` interface from `FDS_FORGE_ALIGNMENT.md` is a good composition type — build it as a function that queries all the above and returns the assembled handoff object. But don't store it — compose on read so it's always current.

---

## Proposed Handoff Function (FDS side will provide)

```typescript
// src/lib/spec-builder/fds-handoff.ts
export async function buildForgeHandoff(specProjectId: string): Promise<ForgeSpecHandoff> {
  // Queries spec_projects, instrument_registers, spec_sections,
  // fds_assembly_sessions, fds_subsystem_orchestrations
  // Returns the composed handoff object
}
```

This can live in the spec-builder lib and be imported by the forge wizard. Single function, always current.

---

## Action Items

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Per-assembly data: already done | FDS | DONE |
| 2 | Structured StepEntry fields | FDS | TODO (Phase C) |
| 3 | Orchestration table: already done | FDS | DONE |
| 4 | Operator modes (Auto/Manual/Service) | FDS | TODO (new wizard step) |
| 5 | `spec_project_id` on forge_sessions | Forge | TODO |
| 6 | `buildForgeHandoff()` function | FDS | TODO (after Phase C) |
| 7 | Forge reads FDS tables directly | Forge | TODO (after #5) |
