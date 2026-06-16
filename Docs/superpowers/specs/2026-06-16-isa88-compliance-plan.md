# ISA-88 Part 1 Compliance — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-16-isa88-compliance-design.md`
**Scope:** ~100+ files, ~5,000+ lines across 4 layers
**Strategy:** Dependency-ordered layers. Types first, then libs, hooks, UI, tests.
**DB:** Pre-prod — drop and recreate with new names.

---

## Layer 1 — Foundation

### Task 1.1: Create ISA-88 condensed reference file (Tier 1)

**Goal:** Create `ai/ISA88_PHYSICAL_MODEL.md` — the always-injected reference.

**Files:**
- Create: `ai/ISA88_PHYSICAL_MODEL.md`

**Steps:**
1. Read ISA-88 PDF sections §3, §4.3, §4.4, §5.2–5.4
2. Write condensed reference with: physical model definitions (4 levels + clause numbers), collapsibility rules (§4.4.3.7), control type definitions, process model vs procedural model, naming conventions (CM_, EM_, UC_, SC_), common mistakes
3. Keep under ~200 lines for token efficiency

**Verify:** File exists, covers all 6 topics listed above.

---

### Task 1.2: Section and index ISA-88 PDF into Reference Library (Tier 2)

**Goal:** Split the ISA-88 PDF into ~30-40 sections in Reference Library format.

**Files:**
- Create: `ai/isa88-sections/` directory with individual section markdown files (or seed script)
- Modify: May need a seed SQL migration or script to insert into `reference_library_docs` + `reference_library_sections`

**Steps:**
1. Read the full ISA-88 PDF and identify section boundaries by clause
2. Create individual markdown files per section (§3 definitions, §4.3.1–§4.3.6, §4.4.1–§4.4.3.7, §5.2, §5.3, §5.3.4.1–§5.3.4.5, §5.4, §7, §8, Annex A)
3. Assign topic tags to each section
4. Create a seed migration or script that inserts these into `reference_library_docs` and `reference_library_sections` tables

**Verify:** Sections exist with correct tags. Reference lookup can find relevant sections.

---

### Task 1.3: Rename core type definitions — Physical Model

**Goal:** Rename hierarchy types in the foundational type files that everything imports from.

**Files:**
- `src/types/spec-contract-v2.ts` (~86 changes)
- `src/types/spec-builder.ts` (~76 changes)

**Steps:**
1. In `spec-contract-v2.ts`:
   - `SubsystemV2` → `UnitV2`, `SubsystemV2Schema` → `UnitV2Schema`
   - `AssemblyV2` → `EquipmentModuleV2`, `AssemblyV2Schema` → `EquipmentModuleV2Schema`
   - `DeviceV2` → `ControlModuleV2`, `DeviceV2Schema` → `ControlModuleV2Schema`
   - `DeviceStateEntrySchema` → `ControlModuleStateEntrySchema`
   - `AssemblyContractSchema` → `EquipmentModuleContractSchema`
   - `InterAssemblyInterlockSchema` → `InterEquipmentModuleInterlockSchema`
   - `SubsystemStateSequenceSchema` → `UnitProcedureSequenceSchema`
   - `StepV2` → `PhaseStep`, `StepV2Schema` → `PhaseStepSchema`
   - All field renames: `subsystem_id` → `unit_id`, `assembly_id` → `equipment_module_id`, `device_id` → `control_module_id`, etc.
   - Add new `ProcessModel`, `ProcessStage`, `ProcessOperation`, `ProcessAction` types
   - Bump `schema_version` to 3
   - Update `SpecContractV2` fields per design spec
2. In `spec-builder.ts`:
   - `SubsystemConfig` → `UnitConfig`
   - `AssemblyConfig` → `EquipmentModuleConfig`
   - `DeviceConfig` → `ControlModuleConfig`
   - `DeviceClass` → `ControlModuleClass`
   - `DeviceStateEntry` → `ControlModuleStateEntry`
   - `FdsAssemblySession` → `OperationSession`
   - `SubsystemOrchestration` → `UnitProcedure`
   - `SubsystemStateSequence` → `UnitProcedureSequence`
   - `InterAssemblyInterlock` → `InterEquipmentModuleInterlock`
   - `SystemOrchestration` → `SystemProcedure`
   - Helper function renames: `getSubsystemTagCount` → `getUnitTagCount`, `getSubsystemDeviceCount` → `getUnitControlModuleCount`, `migrateSubsystemConfig` → `migrateUnitConfig`
   - All field renames throughout

**Verify:** `npx tsc --noEmit` — expect errors in downstream files (this is expected, they'll be fixed in subsequent tasks).

---

### Task 1.4: Rename forge type definitions

**Goal:** Rename types in forge-specific type files.

**Files:**
- `src/types/forge.ts` (~73 changes)
- `src/types/forge-brief.ts` (~31 changes)
- `src/types/forge-contract.ts` (~12 changes)
- `src/types/forge-matrix.ts` (~25 changes)
- `src/types/forge-logic-check.ts` (~6 changes)
- `src/types/process-builder.ts` (~16 changes)

**Steps:**
1. In `forge.ts`:
   - `ForgeDeviceEntry` → `ForgeControlModuleEntry`
   - `ForgeAssemblyEntry` → `ForgeEquipmentModuleEntry`
   - `SpecAnalysisDevice` → `SpecAnalysisControlModule`
   - `SpecAnalysisAssembly` → `SpecAnalysisEquipmentModule`
   - Step constants: `DEVICE_FB` → `CONTROL_MODULE_FB`, `ASSEMBLY_FB` → `EQUIPMENT_MODULE_FB`, `DEVICE_CODE` → `CONTROL_MODULE_CODE`, `PLCSIM_DEVICE_TEST` → `PLCSIM_CONTROL_MODULE_TEST`
   - Fields: `device_list` → `control_module_list`, `assembly_list` → `equipment_module_list`, `device_briefs` → `control_module_briefs`, `device_artifacts` → `control_module_artifacts`, `assembly_artifacts` → `equipment_module_artifacts`, `subsystem` → `unit`
2. In `forge-brief.ts`:
   - `AssemblyBrief` → `EquipmentModuleBrief`
   - `AssemblyAlarm` → `EquipmentModuleAlarm`
   - `AssemblyBriefMap` → `EquipmentModuleBriefMap`
   - `DeviceFbBrief` → `ControlModuleFbBrief`
   - Fields: `deviceIds` → `controlModuleIds`, `subsystemName` → `unitName`
3. In `forge-contract.ts`:
   - `AssemblyContract` → `EquipmentModuleContract`
   - Fields: `assemblyId` → `equipmentModuleId`, `assemblyTag` → `equipmentModuleTag`
   - Add ISA-88 metadata fields to `ForgeArtifact`: `isa88ControlType`, `isa88Level`
4. In remaining files: follow same rename pattern for all hierarchy terms

**Verify:** `npx tsc --noEmit` — expect errors in downstream files.

---

### Task 1.5: Rename remaining type files

**Goal:** Rename types in secondary type files.

**Files:**
- `src/types/design-profile.ts` (~11 changes)
- `src/types/fb-template.ts` (~6 changes — `is_assembly` → `is_equipment_module`)
- `src/types/hmi-screen.ts` (~6 changes)
- `src/types/hmi-panel.ts` (~12 changes)
- `src/types/audit.ts` (~23 changes)
- `src/types/plcsim-test-template.ts` (~6 changes)

**Steps:**
1. Rename all hierarchy terms in each file per the mapping table

**Verify:** `npx tsc --noEmit` — expect errors in downstream files.

---

### Task 1.6: Database migration — rename tables and columns

**Goal:** Create new migration that renames tables and columns to ISA-88 terms.

**Files:**
- Create: `supabase/migrations/XXX_isa88_rename.sql`

**Steps:**
1. Identify all tables with hierarchy columns (from migration exploration)
2. Write ALTER TABLE RENAME statements for:
   - Tables: `fds_assembly_sessions` → `fds_operation_sessions`, `fds_subsystem_orchestrations` → `fds_unit_procedures`, `fds_system_orchestrations` → `fds_system_procedures`
   - Columns across all tables: `subsystem_id` → `unit_id`, `assembly_id` → `equipment_module_id`, etc.
   - `is_assembly` → `is_equipment_module` on `fb_templates`
3. Update any RPCs that reference old column names
4. Update RLS policies if they reference old names
5. Add `process_model` JSONB column to `spec_projects` table

**Verify:** `npx supabase db push` succeeds (or local `npx supabase start` + push).

---

### Task 1.7: Update Zod schemas for runtime validation

**Goal:** Ensure all Zod schemas match renamed types.

**Files:**
- `src/types/spec-contract-v2.ts` (already partially done in Task 1.3)
- Any other files with Zod schemas that reference hierarchy terms

**Steps:**
1. Verify all Zod schema names match renamed TypeScript types
2. Update `.describe()` strings to use ISA-88 terminology
3. Add `ProcessModelSchema`, `ProcessStageSchema`, `ProcessOperationSchema`, `ProcessActionSchema`
4. Update `SpecContractV2Schema` to include `process_model` field

**Verify:** `npx tsc --noEmit` passes for type files. Zod `.parse()` calls in tests pass.

---

### Task 1.8: Update CLAUDE.md

**Goal:** Rewrite the Machine Hierarchy section to reference ISA-88.

**Files:**
- `CLAUDE.md`

**Steps:**
1. Replace the "Machine Hierarchy" section with ISA-88 compliant version from design spec
2. Update any other references to "subsystem", "assembly", "device" in hierarchy context
3. Add ISA-88 control types section
4. Add Process vs Procedure distinction

**Verify:** Read CLAUDE.md, verify no legacy hierarchy terms remain.

---

## Layer 2 — FDS Engine

### Task 2.1: Rename spec-builder library files

**Goal:** Update the spec-builder core library to use ISA-88 terms.

**Files (highest impact first):**
- `src/lib/spec-builder/contract.ts` (~221 changes)
- `src/lib/spec-builder/instrument-parser.ts` (~169 changes)
- `src/lib/spec-builder/section-prompts.ts` (~136 changes)
- `src/lib/spec-builder/orchestrator.ts` (~116 changes)
- `src/lib/spec-builder/revision-diff.ts` (~93 changes)
- `src/lib/spec-builder/fds-prompts.ts` (~63 changes)
- `src/lib/spec-builder/fds-logic-checker.ts` (~50 changes)
- `src/lib/spec-builder/docx-ingest-hierarchy.ts` (~51 changes)
- `src/lib/spec-builder/fds-compose.ts` (~40 changes)
- `src/lib/spec-builder/system-orchestration-prompts.ts` (~40 changes)
- `src/lib/spec-builder/docx-exporter.ts` (~71 changes)
- `src/lib/spec-builder/fds-auto-fill.ts` (~27 changes)
- `src/lib/spec-builder/ai-ingest.ts` (~37 changes)
- `src/lib/spec-builder/docx-hierarchy-table.ts` (~16 changes)
- `src/lib/spec-builder/docx-network-table.ts` (~15 changes)
- `src/lib/spec-builder/docx-ingest-states.ts` (~23 changes)
- `src/lib/spec-builder/docx-ingest-alarms.ts` (~9 changes)
- `src/lib/spec-builder/docx-ingest-appendix.ts` (~9 changes)
- `src/lib/spec-builder/docx-ingest-sentinels.ts` (~6 changes)
- `src/lib/spec-builder/docx-ingest.ts` (~10 changes)
- `src/lib/spec-builder/docx-machine-data-appendix.ts` (~4 changes)
- `src/lib/spec-builder/fds-prompts_archive.ts` (~58 changes)

**Steps:**
1. For each file: rename all type references, variable names, function parameters, object keys, and string literals that use old hierarchy terms
2. Pay special attention to AI prompt strings — these need ISA-88 terminology
3. Update `instrument-parser.ts`: template columns, AI classification prompt, hierarchy builder
4. Update `section-prompts.ts`: all prompt text to use ISA-88 terms
5. Update `orchestrator.ts`: rename orchestration → procedure terminology
6. Update `system-orchestration-prompts.ts`: rename to unit procedure terminology

**Verify:** `npx tsc --noEmit` passes. Read key prompt strings to confirm ISA-88 terms.

---

### Task 2.2: Rename spec-builder migration and random builder files

**Goal:** Update migration helpers and random FDS builder.

**Files:**
- `src/lib/spec-builder/migrate/apply-override-kind.ts` (~9)
- `src/lib/spec-builder/migrate/apply-structured-interlocks.ts` (~11)
- `src/lib/spec-builder/migrate/interlock-classifier.ts` (~16)
- `src/lib/spec-builder/migrate/types.ts` (~4)
- `src/lib/spec-builder/random/assemble.ts` (~112)
- `src/lib/spec-builder/random/sequence-builder.ts` (~48)
- `src/lib/spec-builder/random/orchestration-builder.ts` (~36)
- `src/lib/spec-builder/random/device-templates.ts` (~21)
- `src/lib/spec-builder/random/io-allocator.ts` (~14)
- `src/lib/spec-builder/random/theme-schema.ts` (~15)
- `src/lib/spec-builder/random/theme-prompt.ts` (~14)
- `src/lib/spec-builder/random/section-renderer.ts` (~6)
- `src/lib/spec-builder/random/state-machine.ts` (~2)

**Steps:**
1. Rename all hierarchy terms in migrate/ files
2. Rename all hierarchy terms in random/ files — these generate fake FDS data, so device templates become control module templates, etc.
3. `device-templates.ts` → consider renaming file to `control-module-templates.ts`
4. `orchestration-builder.ts` → consider renaming file to `procedure-builder.ts`

**Verify:** `npx tsc --noEmit` passes.

---

### Task 2.3: Update instrument register parser and template

**Goal:** ISA-88 columns in parser and download template.

**Files:**
- `src/lib/spec-builder/instrument-parser.ts`
- `src/components/spec-builder/instrument-register-upload.tsx`
- `src/types/spec-builder.ts` (InstrumentTag fields)

**Steps:**
1. `InstrumentTag`: `subsystem` → `unit`, `assembly` → `equipment_module`
2. `CANONICAL_COLUMN_NAMES`: update "subsystem" group to "unit" group, "assembly" group to "equipment module" group
3. `downloadTemplate()`: columns "Subsystem" → "Unit", "Assembly" → "Equipment Module"
4. AI classification prompt: use ISA-88 definitions
5. `buildHierarchyFromTags()`: build `UnitV2 → EquipmentModuleV2 → ControlModuleV2`

**Verify:** Template download has correct ISA-88 columns. Parser builds correct hierarchy types.

---

### Task 2.4: Update FDS hooks

**Goal:** Rename hierarchy terms in all FDS-related hooks.

**Files:**
- `src/hooks/use-fds-session.ts` (~85)
- `src/hooks/use-fds-conversation.ts` (~22)
- `src/hooks/use-fds-orchestration-conversation.ts` (~44)
- `src/hooks/use-fds-system-orchestration-conversation.ts` (~19)
- `src/hooks/use-random-fds-generate.ts` (~18)
- `src/hooks/use-migration-proposal.ts` (~5)
- `src/hooks/use-confirm-migration.ts` (~2)

**Steps:**
1. Rename all type references and variable names
2. Update Supabase table/column references to match new DB schema
3. Rename function names where they encode old terms

**Verify:** `npx tsc --noEmit` passes.

---

### Task 2.5: Update FDS UI components

**Goal:** Rename hierarchy labels and terms in FDS components.

**Files:**
- `src/components/spec-builder/fds-co-author.tsx` (~85)
- `src/components/spec-builder/fds-duplicate-dialog.tsx` (~45)
- `src/components/spec-builder/fds-assembly-sidebar.tsx` (~33) → rename file to `fds-operation-sidebar.tsx`
- `src/components/spec-builder/fds-static-review.tsx` (~15)
- `src/components/spec-builder/instrument-register-upload.tsx` (already in 2.3)
- `src/routes/spec-builder.tsx` (~15)
- `src/routes/spec-builder-ingest-review.tsx` (~43)
- `src/routes/spec-system-orchestration.tsx` (~38)
- `src/routes/spec-editor.tsx` (~3)
- `src/routes/spec-co-author.tsx` (~3)
- `src/routes/spec-export.tsx` (~3)

**Steps:**
1. Rename all UI label strings: "Subsystem" → "Unit", "Assembly" → "Equipment Module", "Device" → "Control Module"
2. Add ISA-88 tooltips where appropriate
3. Rename component file names where they encode old terms
4. Update imports across the codebase for renamed files

**Verify:** `npx tsc --noEmit` passes. Visually check key pages for correct labels.

---

### Task 2.6: Add Process Model data structure and FDS authoring

**Goal:** Add Process Model types to the FDS and integrate with authoring flow.

**Files:**
- `src/types/spec-contract-v2.ts` (ProcessModel types — done in 1.3)
- `src/lib/spec-builder/fds-prompts.ts` (add Process Model authoring prompt)
- `src/hooks/use-fds-session.ts` (add Process Model save/load)
- `src/components/spec-builder/fds-co-author.tsx` (add Process Model section)

**Steps:**
1. Add Process Model authoring prompt to `fds-prompts.ts`
2. After hierarchy confirmation in FDS wizard, AI proposes Process Model
3. Add save/load for `process_model` JSONB column
4. Add Process Model section to FDS co-author UI
5. Link Process Model stages to Units, operations to Equipment Modules

**Verify:** Can create and save a Process Model for a test project. Process Model appears in FDS export.

---

### Task 2.7: Inject ISA-88 reference into FDS prompts

**Goal:** All FDS prompt builders inject ISA-88 Tier 1 reference.

**Files:**
- `src/lib/spec-builder/section-prompts.ts`
- `src/lib/spec-builder/fds-prompts.ts`
- `src/lib/spec-builder/system-orchestration-prompts.ts`
- `src/lib/spec-builder/ai-ingest.ts`
- `src/lib/spec-builder/docx-ingest-hierarchy.ts`

**Steps:**
1. Create helper `loadIsa88Reference()` that reads `ai/ISA88_PHYSICAL_MODEL.md`
2. Inject as a system prompt section in all FDS prompt builders
3. Include control type classification context per builder:
   - Co-author prompts: "procedural control for Equipment Module {name}"
   - Orchestration prompts: "coordination control for Unit {name}"

**Verify:** Read generated prompts, confirm ISA-88 definitions appear.

---

### Task 2.8: Add ISA-88 FDS validation checks

**Goal:** New validation category for ISA-88 compliance.

**Files:**
- `src/lib/spec-builder/fds-logic-checker.ts`
- `src/types/spec-builder.ts` (add `isa88_compliance` to validation categories)

**Steps:**
1. Add validation checks:
   - Every Control Module assigned to exactly one Unit
   - Collapsed Equipment Modules: Control Modules correctly parented
   - Process Model coverage: every Unit has a Process Stage
   - No legacy terms in descriptions
2. Add `isa88_compliance` to `FdsValidationIssue` categories

**Verify:** Validation runs without errors on a well-formed FDS. Catches intentionally malformed data.

---

## Layer 3 — Code Generation

### Task 3.1: Rename main prompt builder files

**Goal:** Update all code generation prompt builders to ISA-88 terms.

**Files:**
- `src/lib/forge-prompts.ts` (~431 changes — largest file)
- `src/lib/prompt-defaults.ts` (~179)
- `src/lib/prompt-builder.ts` (~38)
- `src/lib/process-stage-prompts.ts` (~44)
- `src/lib/process-prompt-builder.ts` (~6)
- `src/lib/logic-validator-prompt.ts` (~22)
- `src/lib/plcsim-test-prompt.ts` (~60)
- `src/lib/fb-selection-prompt.ts` (~5)
- `src/lib/agent-chat-prompt.ts` (~19)
- `src/lib/forge-agent-prompts.ts` (~18)
- `src/lib/hmi-wizard-prompts.ts` (~15)
- `src/lib/fb-builder-prompt.ts` (~1)
- `src/lib/process-qa-prompt.ts` (~1)
- `src/lib/plcsim-test-analysis-prompt.ts` (~1)
- `src/lib/audit-analysis-prompt.ts` (~1)
- `src/lib/audit-analysis/residue-prompt.ts` (~1)

**Steps:**
1. `forge-prompts.ts` is the biggest — rename all hierarchy terms in prompt text, type refs, variable names
2. Update `prompt-defaults.ts` — rename section keys, default text, `interpolateAgent()` tokens
3. Each prompt builder: rename terms + inject ISA-88 control type context
4. FB naming rules: instruct AI to use CM_, EM_, UC_, SC_ prefixes
5. Add ISA-88 block header comment instructions to generation prompts

**Verify:** `npx tsc --noEmit` passes. Read key prompt strings to confirm ISA-88 terms and naming rules.

---

### Task 3.2: Update Platform Rules

**Goal:** Add ISA-88 compliance section to platform rules.

**Files:**
- `ai/PLATFORM_RULES_SIEMENS_TIA.md`

**Steps:**
1. Add new section "## ISA-88 Compliance (MANDATORY)"
2. Include naming rules (CM_, EM_, UC_, SC_ prefixes)
3. Include control type rules
4. Include block header requirements
5. Include ISA-88 clause references

**Verify:** Read the file, confirm section is clear and complete.

---

### Task 3.3: Rename core library files (non-prompt)

**Goal:** Update non-prompt library files.

**Files:**
- `src/lib/forge-device-matcher.ts` (~115) → rename to `forge-control-module-matcher.ts`
- `src/lib/process-sequence-diagram.ts` (~91)
- `src/lib/hmi-screen-generators.ts` (~73)
- `src/lib/hmi-unified-screen-generators.ts` (~69)
- `src/lib/open-library-catalog.ts` (~38)
- `src/lib/wiring-context.ts` (~41)
- `src/lib/hmi-tag-mapper.ts` (~40)
- `src/lib/forge-logic-checker.ts` (~39)
- `src/lib/plcsim-test-instantiate.ts` (~34)
- `src/lib/forge-spec-merge.ts` (~33)
- `src/lib/forge-process-compiler-v2.ts` (~31)
- `src/lib/tia-bridge-contract.ts` (~22)
- `src/lib/design-profile-schemas.ts` (~20)
- `src/lib/forge-type-convert.ts` (~24)
- `src/lib/forge-spec-chunk-extract.ts` (~18)
- `src/lib/forge-spec-survey.ts` (~16)
- `src/lib/forge-spec-chunker.ts` (~7)
- `src/lib/forge-process-compiler.ts` (~8)
- `src/lib/device-type-io-defaults.ts` (~5) → rename to `control-module-type-io-defaults.ts`
- `src/lib/platform-rules.ts` (~7)

**Steps:**
1. Rename all hierarchy terms in each file
2. Rename files where the filename encodes old terms
3. Update all imports across the codebase for renamed files

**Verify:** `npx tsc --noEmit` passes.

---

### Task 3.4: Rename forge hooks

**Goal:** Update all forge hooks to ISA-88 terms.

**Files:**
- `src/hooks/use-forge-device-generate.ts` (~400) → rename to `use-forge-control-module-generate.ts`
- `src/hooks/use-forge-assembly-generate.ts` (~53) → rename to `use-forge-equipment-module-generate.ts`
- `src/hooks/use-forge-ai-device-match.ts` (~64) → rename to `use-forge-ai-control-module-match.ts`
- `src/hooks/use-forge-process-generate.ts` (~90)
- `src/hooks/use-forge-fds-handoff.ts` (~40)
- `src/hooks/use-forge-matrix-generate.ts` (~42)
- `src/hooks/use-forge-matrix-validate.ts` (~20)
- `src/hooks/use-forge-spec-analysis.ts` (~9)
- `src/hooks/use-forge-chunked-analysis.ts` (~15)
- `src/hooks/use-forge-contract-generate.ts` (~6)
- `src/hooks/use-forge-hmi-generate.ts` (~18)
- `src/hooks/use-forge-tia-export.ts` (~2)
- `src/hooks/use-forge-spec-challenge.ts` (~9)
- `src/hooks/use-forge-spec-validate.ts` (~9)
- `src/hooks/use-forge-qa-review.ts` (~9)
- `src/hooks/use-forge-logic-check.ts` (~3)
- `src/hooks/use-forge-io-validate.ts` (~3)
- Other hooks: `use-process-pipeline.ts` (~19), `use-process-qa.ts` (~44), `use-fb-library-import.ts` (~19), `use-fb-categories.ts` (~14), `use-plcsim-test-generate.ts` (~12), `use-matrix-review.ts` (~8), `use-github.ts` (~18), `use-test-template-suggest.ts` (~11), `use-fb-templates.ts` (~7), `use-fb-doc-import.ts` (~5), `use-audit-cross-references.ts` (~2), `use-audit-io-fb-links.ts` (~3)

**Steps:**
1. Rename all hierarchy terms in each file
2. Rename files where the filename encodes old terms (3 forge hooks + matcher)
3. Update Supabase table/column references
4. Update all imports across the codebase for renamed files

**Verify:** `npx tsc --noEmit` passes.

---

### Task 3.5: Update Interface Contract types

**Goal:** Add ISA-88 metadata to ForgeArtifact and rename EquipmentModuleContract fields.

**Files:**
- `src/types/forge-contract.ts` (already done in 1.4)
- `src/types/forge.ts` — add `isa88ControlType` and `isa88Level` to ForgeArtifact

**Steps:**
1. Add `isa88ControlType?: "basic" | "procedural" | "coordination"` to ForgeArtifact
2. Add `isa88Level?: "control_module" | "equipment_module" | "unit" | "process_cell"` to ForgeArtifact
3. Set these fields in code generation hooks based on block origin

**Verify:** `npx tsc --noEmit` passes.

---

### Task 3.6: Update forge UI components and routes

**Goal:** Rename hierarchy labels in forge wizard UI.

**Files:**
- `src/routes/forge.tsx` (~50)
- `src/routes/fb-library.tsx` (~42)
- `src/routes/test-templates.tsx` (~21)
- `src/routes/profile-detail.tsx` (~25)
- `src/routes/prompt-editor.tsx` (~7)
- `src/components/forge/steps/forge-hardware-io.tsx` (~190)
- `src/components/forge/steps/forge-assembly-fb.tsx` (~72) → rename to `forge-equipment-module-fb.tsx`
- `src/components/forge/steps/forge-matrix-review.tsx` (~51)
- `src/components/forge/steps/forge-interface-contract.tsx` (~31)
- `src/components/forge/steps/forge-device-fb.tsx` (~31) → rename to `forge-control-module-fb.tsx`
- `src/components/forge/steps/forge-device-code.tsx` (~18) → rename to `forge-control-module-code.tsx`
- `src/components/forge/steps/forge-logic-check.tsx` (~23)
- `src/components/forge/steps/forge-process-code.tsx` (~8)
- `src/components/forge/steps/forge-project-setup.tsx` (~12)
- `src/components/forge/steps/forge-plcsim-test.tsx` (~11)
- `src/components/forge/steps/forge-qa-review.tsx` (~9)
- `src/components/forge/steps/forge-hmi-configurator.tsx` (~14)
- `src/components/forge/steps/forge-hmi.tsx` (~8)
- `src/components/forge/forge-device-fb-dialog.tsx` (~12) → rename
- `src/components/forge/fb-favourites-editor.tsx` (~12)
- `src/components/forge/io-fb-assignments-editor.tsx` (~2)
- Other components: `process-builder/*.tsx`, `hmi-builder/*.tsx`, `pac-st/*.tsx`, `pac-audit/*.tsx`

**Steps:**
1. Rename all UI label strings
2. Rename files where filename encodes old terms
3. Update all imports
4. Add ISA-88 tooltips to key hierarchy displays

**Verify:** `npx tsc --noEmit` passes. `npm run build` succeeds.

---

## Layer 4 — Validation & Polish

### Task 4.1: Update stores

**Goal:** Rename hierarchy terms in Zustand stores.

**Files:**
- `src/stores/forge-store.ts` (~5)
- `src/stores/process-builder-store.ts` (~37)

**Steps:**
1. Rename all hierarchy terms

**Verify:** `npx tsc --noEmit` passes.

---

### Task 4.2: Update tests and fixtures

**Goal:** Update all test files and fixtures to ISA-88 terms.

**Files:**
- All files in `src/types/__tests__/`
- All files in `src/lib/spec-builder/__tests__/` and `__fixtures__/`
- All files in `src/lib/spec-builder/migrate/__tests__/` and `__fixtures__/`
- All files in `src/lib/spec-builder/random/__tests__/`
- All files in `src/hooks/__tests__/`

**Steps:**
1. Update all type references in test files
2. Update fixture JSON files with new field names
3. Regenerate snapshots
4. Run all tests

**Verify:** `npm run test` passes (or vitest equivalent).

---

### Task 4.3: Final TypeScript build verification

**Goal:** Clean build with zero errors.

**Steps:**
1. `npx tsc --noEmit` — zero errors
2. `npm run build` — successful production build
3. `npm run lint` — no new lint errors
4. Search codebase for remaining legacy terms in hierarchy context

**Verify:** All three commands pass. No legacy hierarchy terms remain in code (except historical migration SQL files).

---

### Task 4.4: Update documentation files

**Goal:** Update all docs that reference old hierarchy terms.

**Files:**
- `CLAUDE.md` (done in 1.8)
- `Docs/PAC_ST_MASTER_SPEC.md`
- `UI_STYLE_GUIDE.md`
- `Docs/AGENT_POOL_ARCHITECTURE.md`
- `PAC_FORGE_SYSTEM_OVERVIEW.md`
- Any other docs referencing hierarchy terms

**Steps:**
1. Search all .md files for legacy hierarchy terms
2. Update to ISA-88 terminology
3. Add ISA-88 clause references where appropriate

**Verify:** Grep for "subsystem", "assembly" (hierarchy context), "device" (hierarchy context) in docs.

---

## File Rename Summary

These files should be renamed (in addition to content changes):

| Current Filename | New Filename |
|---|---|
| `forge-device-matcher.ts` | `forge-control-module-matcher.ts` |
| `device-type-io-defaults.ts` | `control-module-type-io-defaults.ts` |
| `use-forge-device-generate.ts` | `use-forge-control-module-generate.ts` |
| `use-forge-assembly-generate.ts` | `use-forge-equipment-module-generate.ts` |
| `use-forge-ai-device-match.ts` | `use-forge-ai-control-module-match.ts` |
| `forge-assembly-fb.tsx` | `forge-equipment-module-fb.tsx` |
| `forge-device-fb.tsx` | `forge-control-module-fb.tsx` |
| `forge-device-code.tsx` | `forge-control-module-code.tsx` |
| `forge-device-fb-dialog.tsx` | `forge-control-module-fb-dialog.tsx` |
| `fds-assembly-sidebar.tsx` | `fds-operation-sidebar.tsx` |
| `device-templates.ts` (random) | `control-module-templates.ts` |
| `orchestration-builder.ts` (random) | `procedure-builder.ts` |

---

## Dependency Graph

```
Layer 1 (Foundation):
  1.1 ISA-88 reference ─────────────────────────┐
  1.2 Reference Library indexing ────────────────┤
  1.3 Core types (spec-contract, spec-builder) ──┤
  1.4 Forge types ──────────────────────(1.3)────┤
  1.5 Secondary types ─────────────────(1.3)────┤
  1.6 Database migration ───────────────────────┤
  1.7 Zod schemas ─────────────────────(1.3)────┤
  1.8 CLAUDE.md ────────────────────────────────┘
                                                 │
Layer 2 (FDS Engine):                            │
  2.1 Spec-builder libs ──────────────(1.3-1.7)──┤
  2.2 Migration + random builders ────(1.3-1.7)──┤
  2.3 Instrument parser + template ───(1.3)──────┤
  2.4 FDS hooks ──────────────────────(2.1)──────┤
  2.5 FDS UI components ──────────────(2.1,2.4)──┤
  2.6 Process Model authoring ────────(2.1)──────┤
  2.7 ISA-88 prompt injection ────────(1.1,2.1)──┤
  2.8 FDS validation ─────────────────(2.1)──────┘
                                                 │
Layer 3 (Code Generation):                       │
  3.1 Main prompt builders ───────────(1.3-1.5)──┤
  3.2 Platform rules ─────────────────(1.1)──────┤
  3.3 Core lib files ─────────────────(1.3-1.5)──┤
  3.4 Forge hooks ────────────────────(3.1,3.3)──┤
  3.5 Interface contracts ────────────(1.4)──────┤
  3.6 Forge UI components ────────────(3.4)──────┘
                                                 │
Layer 4 (Validation & Polish):                   │
  4.1 Stores ─────────────────────────(1.3)──────┤
  4.2 Tests + fixtures ───────────────(all)──────┤
  4.3 Build verification ─────────────(all)──────┤
  4.4 Documentation ──────────────────(all)──────┘
```

Tasks within the same layer with shared dependencies can be parallelized.
Layer 1 tasks 1.1, 1.2, 1.6, 1.8 are independent of each other.
Layer 1 tasks 1.3 must complete before 1.4, 1.5, 1.7.
Layer 2 and 3 can be partially parallelized (2.x depends on Layer 1; 3.x depends on Layer 1).
Layer 4 depends on everything.
