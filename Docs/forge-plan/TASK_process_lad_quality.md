# TASK: Process LAD Code Quality Issues

## Status: In Progress

## Context

The forge wizard generates process/sequence code as LAD (Ladder Logic) when the user selects LAD as the process code language. This is AI-generated (not deterministic) via `buildProcessLadPrompt()` in `src/lib/forge-prompts.ts`, called from `src/hooks/use-forge-process-generate.ts`.

The AI generates a `LadProgram` JSON that gets parsed by `parseLadArtifact()` → `normalizeLadJson()`, then rendered visually and exported as SimaticML XML via `src/lib/lad-xml-builder.ts`.

## Current Problems (observed 2026-04-02)

### 1. AI uses invalid/unknown element types
- The AI invented `P_TRIG` as a LAD element type. While P_TRIG IS a real TIA instruction, it's not yet supported in the LAD engine's `LadElementType` union (`src/types/lad.ts`).
- The instruction library (FEAT-09, 170+ instructions in DB) was built to solve this — the AI should ONLY use element types from the instruction library.
- `formatInstructions()` in `src/lib/prompt-builder.ts` now includes a HARD CONSTRAINT listing allowed element_type values.
- Post-parse normalization maps some aliases but should NOT map real instructions (P_TRIG, R_TRIG, etc.) to contacts — those are real instructions that need XML builder support.

### 2. AI references non-existent DB names
- Generated code referenced `"DB_Faults".faultActive` but the actual artifact is `DB_FaultData`.
- The process prompt receives the device artifacts (FB interfaces, global DB schemas) but the AI doesn't always use the correct names.
- Fix: ensure ALL generated DB names are included in the process prompt context.

### 3. Inconsistent sequence structure across regenerations
- First generation: clean step-action pattern with inline conditions, XOR branching
- Second generation: "derived conditions" pre-computation networks, some with unconditional coils (wrong), different step ordering
- The AI is not consistent — needs stronger structural rules in the prompt.

### 4. Specific issues in latest generation
- `tempPbStartRisingEdge` coil has no contacts before it — outputs unconditionally (should be edge detection logic)
- Step 62 has no transition conditions — just an unconditional coil
- Step ordering: Step 10 logic appears before Step 0 bootstrap in some variations

## Root Causes

### A. LAD engine only supports 12 hardcoded element types
`src/types/lad.ts` defines `LadElementType` as a union of 12 types: NO_CONTACT, NC_CONTACT, OUTPUT_COIL, SET_COIL, RESET_COIL, TON, TOF, CTU, CTD, CMP, MATH, MOVE, FB_CALL.

The XML builder (`src/lib/lad-xml-builder.ts`) has hardcoded `getPartName()` and pin wiring logic for only these 12 types.

The instruction library has 170+ instructions but the XML builder can't use them yet. This was deferred as "Phase 2" during FEAT-09 implementation.

### B. No post-generation validation of LAD structure
No validation that:
- Every rung has at least one condition contact before its output
- Step numbers are sequential and complete
- All referenced DBs exist in the project artifacts
- All element_type values are in the instruction library

### C. Process LAD prompt lacks structural rules
The prompt tells the AI the JSON schema and available instructions but doesn't enforce:
- Step ordering conventions
- Edge detection patterns (use R_TRIG/F_TRIG static instances, not invented types)
- Derived condition computation patterns
- Rung structure rules (every output must have a condition path)

## Recommended Fixes (Priority Order)

### Fix 1: Extend LAD engine to support instruction library (Phase 2 of FEAT-09)
- `LadElementType` becomes `string` (not fixed union)
- `getPartName()` looks up instruction DB instead of switch statement
- Pin wiring uses instruction pin definitions from DB
- XML builder handles any instruction that has a valid instruction library entry
- **Files**: `src/types/lad.ts`, `src/lib/lad-xml-builder.ts`, `src/lib/lad-xml-parser.ts`

### Fix 2: Post-generation LAD validator
- Validate every rung has at least one contact before output elements
- Validate all element_type values exist in instruction library
- Validate all DB references exist in project artifacts
- Flag invalid rungs for user review
- **Files**: new `src/lib/lad-validator.ts`, called from `use-forge-process-generate.ts`

### Fix 3: Improve process LAD prompt
- Add explicit step ordering rules (Step 0 first, then transitions in order)
- Add edge detection pattern examples (use static R_TRIG instance + NO_CONTACT on Q)
- Add derived condition rules (every derived condition must have contacts → coil, never unconditional)
- Include list of ALL generated DB names in context
- **Files**: `src/lib/forge-prompts.ts` (`buildProcessLadPrompt`)

### Fix 4: DB name validation in process prompt
- Before calling AI, build a set of all artifact DB names
- Include in prompt: "These are the ONLY valid DB names: DB_ProcessCommands, DB_ProcessState, DB_FaultData, DB_Configuration, DB_HmiData, DB_Converted, DB_FacePlates"
- **Files**: `src/hooks/use-forge-process-generate.ts`

## Key Files

| File | Purpose |
|------|---------|
| `src/types/lad.ts` | LadElementType union (currently 12 types) |
| `src/lib/lad-xml-builder.ts` | SimaticML XML generation (hardcoded Part Names + pins) |
| `src/lib/lad-xml-parser.ts` | Reverse XML → LadProgram parser |
| `src/lib/forge-prompts.ts` | `buildProcessLadPrompt()` — AI system prompt |
| `src/hooks/use-forge-process-generate.ts` | Process code generation hook, `parseLadArtifact()`, `normalizeLadJson()` |
| `src/lib/prompt-builder.ts` | `formatInstructions()` — instruction library injection |
| `src/hooks/use-instructions.ts` | `fetchInstructionsForPrompt()` — DB fetch |
| `src/types/instruction.ts` | Instruction/InstructionPin types |
| `supabase/migrations/047_instruction_library.sql` | Instruction DB schema + seed data |

## Session Summary (2026-04-01 to 2026-04-02)

### Completed
- FEAT-09: Instruction Library (170+ instructions from PDF import, XML verification, category filtering, all LAD paths integrated)
- FEAT-10: FC_TypeConvert (deterministic Int→Bool conversion, DB_Converted, DB_FacePlates for HMI UDTs)
- Library DB merge (HmiData/Configuration → DB_HmiData/DB_Configuration)
- VAR_IN_OUT UDT handling (HMI UDTs → DB_FacePlates, non-HMI skipped)
- UDT output param filtering (ERROR_Motor skipped in call FCs)
- Type mismatch detection from DB artifacts (not wire.dataType)
- Backfill skip for UDT types
- conversion_fc_language added to project setup + profiles
- OB1 call ordering includes FC_TypeConvert

### Device code compiles clean in TIA Portal
### Process code has the quality issues described above
