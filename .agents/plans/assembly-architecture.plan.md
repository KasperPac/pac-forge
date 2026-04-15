# Plan: Assembly FB Architecture

## Summary

Introduce assembly-level function blocks into the forge wizard pipeline. The machine hierarchy becomes System → Subsystem → Assembly → Device, where assemblies (lift tables, conveyors, presses) coordinate groups of devices with state machines, fault handling, and HMI UDTs. Assembly FBs can come from the FB library (with a new `is_assembly` flag) or be AI-generated. Process sequences command assemblies, not individual devices — dramatically simplifying process code.

## User Story

As an automation engineer using the forge wizard,
I want assemblies extracted from the spec and matched to assembly FB templates (or AI-generated),
So that process sequences command high-level assembly operations instead of individual device signals.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | HIGH |
| Systems Affected | Types, DB schema, spec analysis, FB library, device matching, matrix, device code, process code, prompts |

---

## Patterns to Follow

### FB Template DB Column Addition
```sql
-- SOURCE: supabase/migrations/036_fb_template_enabled.sql
ALTER TABLE fb_templates ADD COLUMN is_enabled boolean NOT NULL DEFAULT true;
```

### Type Extension
```typescript
// SOURCE: src/types/fb-template.ts:38-66
// FbTemplate interface — add is_assembly field alongside existing fields
```

### Device Entry Pattern
```typescript
// SOURCE: src/types/forge.ts:200-215
// ForgeDeviceEntry — mirror this for ForgeAssemblyEntry
```

### Spec Analysis Schema
```typescript
// SOURCE: src/lib/forge-prompts.ts:87-179
// SPEC_ANALYSIS_SCHEMA — add assemblies array alongside devices
```

### Device Matching
```typescript
// SOURCE: src/hooks/use-forge-ai-device-match.ts
// AI matching pipeline: favourites → AI → heuristic fallback
// Mirror this for assembly matching
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/058_fb_template_is_assembly.sql` | CREATE | Add `is_assembly` column to `fb_templates` |
| `src/types/fb-template.ts` | UPDATE | Add `is_assembly: boolean` to `FbTemplate` |
| `src/types/forge.ts` | UPDATE | Add `SpecAnalysisAssembly`, `ForgeAssemblyEntry`, update `SpecAnalysis`, `ForgeSession` |
| `src/types/forge-matrix.ts` | UPDATE | Add `LinkageAssembly` type, update `ProcessLinkageMatrix` |
| `src/lib/forge-prompts.ts` | UPDATE | Update `SPEC_ANALYSIS_SCHEMA` with assemblies, add assembly FB generation prompts, update process prompts to command assemblies |
| `src/lib/forge-agent-prompts.ts` | UPDATE | Update review/rewrite prompts to understand assembly FBs |
| `src/hooks/use-forge-spec-analysis.ts` | UPDATE | Handle new `assemblies` field in spec analysis output |
| `src/hooks/use-forge-ai-device-match.ts` | UPDATE | Separate assembly matching from device matching (filter by `is_assembly`) |
| `src/hooks/use-forge-device-generate.ts` | UPDATE | Add assembly FB generation path (template or AI) |
| `src/hooks/use-forge-session.ts` | UPDATE | Handle new `assembly_list` field |
| `src/hooks/use-fb-templates.ts` | UPDATE | Add `is_assembly` filter support |
| `src/components/forge/steps/forge-hardware-io.tsx` | UPDATE | Show assemblies as grouping headers above devices |
| `src/components/forge/steps/forge-device-fb.tsx` | UPDATE | Add assembly FB matching/generation section |
| `src/components/forge/steps/forge-device-code.tsx` | UPDATE | Add assembly call FC generation |
| `src/components/forge/steps/forge-process-code.tsx` | UPDATE | Process sequences reference assemblies not devices |
| `src/stores/forge-store.ts` | UPDATE | Handle assembly artifacts in state |
| `src/lib/forge-export.ts` | UPDATE | Include assembly artifacts in TIA export |

---

## Tasks

### Task 1: Database Migration — Add `is_assembly` to `fb_templates`

- **File**: `supabase/migrations/058_fb_template_is_assembly.sql`
- **Action**: CREATE
- **Implement**: 
  ```sql
  ALTER TABLE fb_templates ADD COLUMN is_assembly boolean NOT NULL DEFAULT false;
  COMMENT ON COLUMN fb_templates.is_assembly IS 'True for assembly-level FB templates (coordinate groups of devices), false for device-level templates';
  ```
- **Mirror**: `supabase/migrations/036_fb_template_enabled.sql` — same pattern (ALTER TABLE ADD COLUMN with default)
- **Validate**: `npx supabase db push` (or local start)

### Task 2: Update `FbTemplate` TypeScript Type

- **File**: `src/types/fb-template.ts`
- **Action**: UPDATE
- **Implement**: Add `is_assembly: boolean` to `FbTemplate` interface (after `is_enabled`). Add to `FbTemplateCreate` as optional (default false).
- **Validate**: `npm run build`

### Task 3: Add Assembly Types to `forge.ts`

- **File**: `src/types/forge.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `SpecAnalysisAssembly` interface:
    ```typescript
    export interface SpecAnalysisAssembly {
      id: string;              // e.g. "ASM001"
      name: string;            // e.g. "LFT01 Lift Table"
      tag: string;             // e.g. "LFT01"
      assembly_type: string;   // e.g. "Lift Table", "Belt Conveyor", "Stamping Press"
      description: string;
      subsystem: string;
      device_ids: string[];    // references to SpecAnalysisDevice.id
    }
    ```
  - Add `assemblies: SpecAnalysisAssembly[]` to `SpecAnalysis` (after `subsystems`, before `devices`)
  - Add `ForgeAssemblyEntry` interface (mirrors ForgeDeviceEntry pattern):
    ```typescript
    export interface ForgeAssemblyEntry {
      id: string;
      name: string;
      tag: string;
      assembly_type: string;
      description: string;
      subsystem: string;
      device_ids: string[];
      fb_template_id: string | null;
      fb_match_confidence: "exact" | "probable" | "none";
      language_override: "SCL" | "LAD" | null;
      approved: boolean;
    }
    ```
  - Add `assembly_list: ForgeAssemblyEntry[]` to `ForgeSession` (after `device_list`)
  - Add `assembly_artifacts: ForgeArtifact[]` to `ForgeSession` (after `device_artifacts`)
  - Add `"assembly_fb"` to `ForgeArtifactStage` union
- **Validate**: `npm run build`

### Task 4: Update `forge-matrix.ts` with Assembly Linkage

- **File**: `src/types/forge-matrix.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `LinkageAssembly` interface:
    ```typescript
    export interface LinkageAssembly {
      id: string;
      name: string;
      assemblyType: string;
      description: string;
      fbName: string;
      fbTemplateName: string | null;
      fbTemplateId: string | null;
      instanceDbName: string;
      deviceIds: string[];
      wiring: FbWire[];
      interlocks: LinkageInterlock[];
      statusMirrors?: StatusMirror[];
    }
    ```
  - Add `assemblyLinkage: LinkageAssembly[]` to `ProcessLinkageMatrix` (after `deviceLinkage`)
  - Update `ProcessSequence` type: add `assemblies_involved?: string[]` alongside devices
- **Validate**: `npm run build`

### Task 5: Update Spec Analysis Schema & Prompt

- **File**: `src/lib/forge-prompts.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `assemblies` array to `SPEC_ANALYSIS_SCHEMA` between `subsystems` and `devices`:
    ```json
    "assemblies": [
      {
        "id": "string (unique, e.g. ASM001)",
        "name": "string (e.g. LFT01 Lift Table)",
        "tag": "string (instrument tag prefix)",
        "assembly_type": "string (e.g. Lift Table, Belt Conveyor, Stamping Press, Pneumatic Cylinder)",
        "description": "string (what this assembly does as a coordinated unit)",
        "subsystem": "string (which subsystem it belongs to)",
        "device_ids": ["string (IDs of constituent devices from the devices array)"]
      }
    ]
    ```
  - Update the spec analysis system prompt instructions to explain the hierarchy:
    - System → Subsystem → Assembly → Device
    - Assemblies are coordinated groups of devices (a lift table with motor + solenoids + limit switches)
    - Devices are individual physical things with IO (a single motor, sensor, valve)
    - Every device should belong to exactly one assembly (via device_ids)
    - Devices that don't belong to any assembly (e.g. standalone E-Stop) have no assembly linkage
  - Update `devices` section comment: "Leaf-level physical devices only — assemblies are listed separately"
  - Update process_sequences: steps should reference assembly tags (not device tags) where applicable
- **Mirror**: Existing schema pattern in `SPEC_ANALYSIS_SCHEMA`
- **Validate**: `npm run build`

### Task 6: Update Spec Analysis Hooks for Assembly Extraction

- **File**: `src/hooks/use-forge-spec-analysis.ts`
- **Action**: UPDATE
- **Implement**:
  - Ensure the response parser handles the new `assemblies` field
  - Default to empty array `[]` if assemblies not returned (backward compat)
  - Update chunked analysis merge logic to combine assemblies across chunks
  - Update Q&A review hook to handle assembly refinements
- **Validate**: `npm run build`

### Task 7: Update FB Template Hooks with Assembly Filter

- **File**: `src/hooks/use-fb-templates.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `is_assembly` to select queries
  - Add `useFbTemplatesForSession` variant or parameter to filter by `is_assembly: true` vs `is_assembly: false`
  - E.g. `useFbTemplatesForSession(profileId, { isAssembly: false })` for device templates, `useFbTemplatesForSession(profileId, { isAssembly: true })` for assembly templates
- **Validate**: `npm run build`

### Task 8: Update Device Matching for Assembly vs Device

- **File**: `src/hooks/use-forge-ai-device-match.ts`
- **Action**: UPDATE
- **Implement**:
  - Split matching into two passes: device matching (templates where `is_assembly: false`) and assembly matching (templates where `is_assembly: true`)
  - Assembly matching: takes `ForgeAssemblyEntry[]` + assembly templates, returns matches with confidence
  - Device matching: unchanged, but only receives `is_assembly: false` templates
  - Assembly matching prompt: match by `assembly_type` + constituent device types + description
  - Reuse existing matching infrastructure (favourites → AI → heuristic)
- **Validate**: `npm run build`

### Task 9: Add Assembly FB Generation to Device Generate Hook

- **File**: `src/hooks/use-forge-device-generate.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `generateAssembly()` function alongside `generateSingle()`:
    - If `assembly.fb_template_id` → copy template blocks (same as device path)
    - If no template → AI generate assembly FB
  - Assembly FB AI generation needs:
    - Assembly description and tag
    - List of constituent devices with their FB interfaces (extracted from device_artifacts)
    - Device IO signals
    - Interlocks and alarms relevant to this assembly
    - Design profile rules + platform rules
  - Assembly FB output: FB + config UDT + HMI UDT + instance DB
  - Post-processing: same reconciliation (UDT refs, instance DB names, global DB backfill)
- **Validate**: `npm run build`

### Task 10: Add Assembly FB Generation Prompt

- **File**: `src/lib/forge-prompts.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `AssemblyGenContext` interface:
    ```typescript
    export interface AssemblyGenContext {
      profile?: DesignProfile;
      platformRules: string;
      patterns?: PatternCandidate[];
      fbTemplate?: FbTemplate | null;
      constituentDevices: ForgeDeviceEntry[];
      deviceArtifacts: ForgeArtifact[];  // device FBs for interface extraction
      interlocks?: SpecAnalysisInterlock[];
      alarms?: SpecAnalysisAlarm[];
      instructions?: Instruction[];
    }
    ```
  - Add `buildAssemblySclPrompt(assembly, context)` function:
    - Identity: "You are a Code Architect generating an Assembly Function Block"
    - Context: Assembly coordinates devices — state machine, fault detection, HMI UDT
    - Inputs: command signals (cmdRaise, cmdLower, etc.), enable, reset, config UDT
    - Outputs: status (atUpper, busy, done, error, faultCode, stateNumber)
    - Internal: reads device FB status (via ProcessState or direct call)
    - Output format: `[UDT:typeAssemblyConfig]`, `[UDT:udtHMI_Assembly]`, `[FB:ControlAssembly]`, `[DB:InstAssembly]`
  - Add `buildAssemblySclUserMessage(assembly, context)` 
  - Platform rules: inject relevant sections (state machines, fault handling, naming)
- **Validate**: `npm run build`

### Task 11: Update Hardware & IO Step — Assembly Grouping

- **File**: `src/components/forge/steps/forge-hardware-io.tsx`
- **Action**: UPDATE
- **Implement**:
  - Show devices grouped under their assembly (from `spec_analysis.assemblies`)
  - Assembly header shows: name, tag, assembly_type, device count
  - Ungrouped devices (no assembly) shown in "Standalone Devices" section
  - Device editing remains the same — just visual grouping
  - Allow drag/drop of devices between assemblies (optional, can defer)
- **Validate**: Visual check in dev server

### Task 12: Update Device FB Step — Add Assembly FB Section

- **File**: `src/components/forge/steps/forge-device-fb.tsx`
- **Action**: UPDATE
- **Implement**:
  - Two sections: "Device FBs" (existing) and "Assembly FBs" (new)
  - Assembly FBs section:
    - List each assembly from `assembly_list`
    - Show matched template (from assembly templates) or "AI Generated"
    - Allow template override (dropdown of `is_assembly: true` templates)
    - Generate button per assembly (or "Generate All")
  - Assembly FB generation runs AFTER device FBs (needs device FB interfaces)
  - Update step completion: both device FBs and assembly FBs must be approved
- **Validate**: Visual check in dev server

### Task 13: Update Matrix Generation for Assemblies

- **File**: `src/lib/forge-prompts.ts` (matrix prompts)
- **Action**: UPDATE  
- **Implement**:
  - Update `buildDeviceLinkagePrompt()` to include assembly linkage
  - Assembly linkage: assembly FB wiring (commands in, status out)
  - Device linkage: device FB wiring stays the same BUT device FBs are now "owned" by assemblies
  - Process sequences reference assembly commands/status, not device signals
  - Signal flow: ProcessCommands → Assembly FB → Device FBs → IO
  - Update `buildSequencesPrompt()`: steps use assembly tags (lft01CmdRaise, cv01CmdStart)
- **Validate**: `npm run build`

### Task 14: Update Device Code Step — Assembly Call FCs

- **File**: `src/components/forge/steps/forge-device-code.tsx` + `src/hooks/use-forge-device-generate.ts`
- **Action**: UPDATE
- **Implement**:
  - Generate assembly call FCs alongside device call FCs
  - Assembly call FC: instantiates assembly FBs, wires commands/status to global DBs
  - Device call FCs: still wire device FBs to IO, BUT assembly FBs may call device FBs internally
  - Two modes (from architecture doc):
    - **ProcessState mode**: Assembly FB reads device status from ProcessState DB (loose coupling)
    - **Direct call mode**: Assembly FB calls device FBs directly (future)
  - Start with ProcessState mode (simpler)
  - Add assembly call FC prompt builder
- **Validate**: `npm run build`

### Task 15: Update Process Code Generation — Command Assemblies

- **File**: `src/hooks/use-forge-process-generate.ts` + `src/lib/forge-prompts.ts`
- **Action**: UPDATE
- **Implement**:
  - Process sequences now command assemblies: `lft01CmdRaise`, `cv01CmdStart`
  - Assembly FB status used as completion criteria: `lft01AtUpper`, `cv01Running`
  - Update `ProcessGenContext` to include assembly list + assembly FB interfaces
  - Update `buildProcessSclPrompt()` to reference assembly commands instead of device signals
  - Dramatically simpler sequences: 3-4 steps per motion vs 7+
  - Fault handling is IN the assembly FB, not in the sequence
- **Validate**: `npm run build`

### Task 16: Update Session Hook & DB Schema

- **File**: `src/hooks/use-forge-session.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `assembly_list` and `assembly_artifacts` to session queries and mutations
  - These are JSONB columns in `forge_sessions` table
  - Need a migration to add these columns:
    ```sql
    ALTER TABLE forge_sessions ADD COLUMN assembly_list jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE forge_sessions ADD COLUMN assembly_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb;
    ```
  - Consider combining this with Task 1 migration or creating a separate one
- **Validate**: `npx supabase db push` + `npm run build`

### Task 17: Update Forge Export

- **File**: `src/lib/forge-export.ts`
- **Action**: UPDATE
- **Implement**:
  - Include `assembly_artifacts` in manifest building
  - Assembly FBs go in `FBs/Assemblies/` folder (or similar)
  - Assembly UDTs go in `UDTs/` alongside device UDTs
  - Assembly instance DBs go in `DBs/Assemblies/`
  - Update topological sort to handle assembly FB dependencies
- **Validate**: `npm run build`

### Task 18: Update FB Library UI — Assembly Flag

- **File**: `src/routes/fb-library.tsx`
- **Action**: UPDATE
- **Implement**:
  - Add "Assembly" toggle/badge on FB template cards
  - Filter: "All" / "Device FBs" / "Assembly FBs"
  - When creating/editing a template, checkbox for "This is an assembly-level template"
  - Assembly templates show differently (visual distinction — e.g. different icon or border color)
- **Validate**: Visual check in dev server

### Task 19: Update Review Prompts for Assembly Awareness

- **File**: `src/lib/forge-agent-prompts.ts`
- **Action**: UPDATE
- **Implement**:
  - Update `buildForgeReviewPrompt()` to understand assembly FBs
  - Review checks: assembly FB has state machine, fault handling, HMI UDT, correct device coordination
  - Update rewrite prompt: assembly FBs follow same cross-artifact consistency rules
  - Add `"assembly"` to ReviewStage if needed
- **Validate**: `npm run build`

---

## Implementation Order (Dependency Chain)

```
Phase 1: Foundation (Tasks 1-4)
  DB migration → Types → Can build without runtime changes
  
Phase 2: Extraction (Tasks 5-6)  
  Spec analysis prompt + hooks → Assemblies appear in spec_analysis
  
Phase 3: FB Library (Tasks 7-8, 18)
  Template filtering + matching → Assembly templates discoverable
  
Phase 4: Generation (Tasks 9-10)
  Assembly FB generation → Can produce assembly FBs
  
Phase 5: Wizard UI (Tasks 11-12)
  Hardware grouping + FB step → User sees assemblies in wizard
  
Phase 6: Wiring & Code (Tasks 13-15)
  Matrix + device code + process code → Full pipeline works
  
Phase 7: Infrastructure (Tasks 16-17, 19)
  Session persistence + export + review → Production-ready
```

---

## Validation

```bash
npm run build     # Type check + Vite build
npm run lint      # ESLint
npm run dev       # Visual check in browser
```

---

## Acceptance Criteria

- [ ] `fb_templates` table has `is_assembly` column (default false)
- [ ] Spec analysis extracts assemblies with constituent device references
- [ ] Assembly FB templates are filterable in FB library (device vs assembly)
- [ ] Assembly matching runs separately from device matching (using is_assembly flag)
- [ ] Assembly FBs can be generated from library templates OR AI
- [ ] Hardware & IO step shows devices grouped under assemblies
- [ ] Device FB step has separate section for assembly FB matching/generation
- [ ] Matrix includes assembly linkage (assembly FB wiring)
- [ ] Device code step generates assembly call FCs
- [ ] Process sequences command assemblies, not individual devices
- [ ] Assembly artifacts included in TIA export
- [ ] All 4 generation paths compile without errors
- [ ] Existing device-only projects still work (backward compat — assemblies default to empty)
