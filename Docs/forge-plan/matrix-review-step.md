# Add Matrix Review step to the forge wizard

## Overview

Add a new wizard step "Matrix Review" between Hardware & IO and Device Code. This step builds and displays the Process Linkage Matrix and sequence flow diagram so the engineer can verify device wiring, interlocks, and process sequences before code generation begins.

The existing Process Builder has a full linkage matrix panel (`src/components/process-builder/linkage-matrix-panel.tsx`, 1016 lines) and a Mermaid sequence diagram generator (`src/lib/process-sequence-diagram.ts`, 178 lines). Reuse as much of this as possible.

## 1. Update step definitions

In `src/types/forge.ts`:

Add `MATRIX_REVIEW: "matrix_review"` to `FORGE_STEPS`

Update `FORGE_STEP_ORDER` to:
```
spec_upload, qa_review, project_setup, hardware_io, matrix_review, device_code, process_code, hmi, tia_export
```

Add to `FORGE_STEP_LABELS`: `matrix_review: "Matrix Review"`

On `ForgeSession`, the `linkage_matrix` field already exists (typed as `unknown | null`). Update it to be typed properly:
```typescript
linkage_matrix: ProcessLinkageMatrix | null;
```

Import `ProcessLinkageMatrix` from `@/types/process-builder`.

## 2. Update forge store

In `src/stores/forge-store.ts`, add `matrix_review: "pending"` to `createInitialStepStatuses()`.

## 3. AI-generated matrix from spec analysis + devices

The matrix should be auto-generated from the data we already have:
- Spec analysis (devices, process sequences, interlocks, alarms)
- Confirmed device list from the Hardware/IO step (with FB template assignments)
- IO list

Create a new prompt builder in `src/lib/forge-prompts.ts`:

```typescript
export function buildMatrixGenerationPrompt(): string
```

This prompt tells the PM agent to produce a `ProcessLinkageMatrix` JSON from the project data. Use the EXACT same JSON schema as the existing Process Builder PM prompt — the one with `deviceLinkage`, `globalData`, `processSequences`, and `notes` at the top level.

Key requirements for the prompt:
- Output must be wrapped in `[PROCESS_MATRIX]...[/PROCESS_MATRIX]` tags (same as existing PM prompt)
- Device names must match the confirmed device list
- FB names must match the assigned FB templates
- Instance DB names must follow the `Inst` prefix convention
- Wiring must use the `fb`, `io`, `global`, `constant` wire types
- Process sequences must include permissives, safety conditions, and steps with transitions
- Interlocks must reference devices that exist in the device list

```typescript
export function buildMatrixGenerationUserMessage(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  specAnalysis: SpecAnalysis | null,
): string
```

This formats the device list, IO list, and spec analysis sequences as the user message.

## 4. New hook: `src/hooks/use-forge-matrix-generate.ts`

```typescript
export function useForgeMatrixGenerate() {
  // generate(session) => Promise<ProcessLinkageMatrix>
  // Calls the PM agent to produce the matrix from session data
  // Parses the [PROCESS_MATRIX]...[/PROCESS_MATRIX] tags from the response
  // Returns typed ProcessLinkageMatrix
  // loading, error states
}
```

Parse the response using the same tag extraction as the existing process builder:
```typescript
const matrixMatch = content.match(/\[PROCESS_MATRIX\]\s*([\s\S]*?)\s*\[\/PROCESS_MATRIX\]/);
if (matrixMatch) {
  const matrix = JSON.parse(matrixMatch[1]) as ProcessLinkageMatrix;
  return matrix;
}
```

Use `validateAndCall()` with agent type `"pm_plan"`.

## 5. New component: `src/components/forge/steps/forge-matrix-review.tsx`

This is the key component. It should have:

### Layout: Two-panel view

**Left panel (55%) — Matrix Editor:**

Reuse the existing `linkage-matrix-panel.tsx` component if its props can be adapted. It expects data from the process builder store, so you may need to either:

**Option A (preferred):** Extract the display/edit logic from `linkage-matrix-panel.tsx` into the forge step, adapting it to work with forge session data instead of the process builder store. Don't import the whole component — cherry-pick the parts we need.

**Option B (simpler for demo):** Build a simpler matrix view:
- Device list showing each device with its FB name, instance DB name, and wiring summary
- Expandable device cards showing wiring details (param → source)
- Interlock list showing device dependencies
- Process sequence list showing each sequence with its steps
- Basic inline editing (add/remove wiring, edit interlocks, edit steps)

**Right panel (45%) — Sequence Diagram:**

Reuse the existing Mermaid diagram generator:

```typescript
import { buildMultiSequenceDiagram } from "@/lib/process-sequence-diagram";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";
```

The diagram auto-updates as the engineer edits sequences in the matrix.

### Top toolbar:
- "Generate Matrix" button — calls `useForgeMatrixGenerate()` to produce the initial matrix from AI
- "Regenerate" button — if the engineer wants to start fresh
- "Confirm & Continue" button — saves matrix to session and advances

### Key interactions:
1. On step entry: auto-generate the matrix if it doesn't exist yet
2. Display the matrix in the editor panel with the diagram alongside
3. Engineer reviews, edits if needed
4. Engineer clicks "Confirm & Continue"
5. Matrix is saved to `forge_sessions.linkage_matrix`

### Props:
```typescript
interface ForgeMatrixReviewProps {
  session: ForgeSession;
  onComplete: (matrix: ProcessLinkageMatrix) => void;
}
```

## 6. Wire into route

In `src/routes/forge.tsx`:

- Import `ForgeMatrixReview`
- Add case `"matrix_review"` to `renderStep()` switch
- Add handler:
```typescript
async function handleMatrixComplete(matrix: ProcessLinkageMatrix) {
  await saveSession({ linkage_matrix: matrix, current_step: "device_code" });
  completeStep("matrix_review");
}
```
- Hardware/IO completion should advance to `matrix_review` (not `device_code`)

## 7. Feed matrix data into code generation

The matrix contains critical information for code generation:
- **Device wiring** — tells the Code Architect exactly how to wire FB parameters
- **Interlocks** — tells the process code generator what interlock checks to include
- **Process sequences with transitions** — tells the process code generator the exact state machine logic

Update `use-forge-device-generate.ts`:
- When generating the IO linking FC, pass the matrix wiring data as additional context
- The wiring array for each device shows exactly which FB param connects to which IO tag, global DB field, or other FB output

Update `use-forge-process-generate.ts`:
- Instead of using the simplified `SpecAnalysisProcessSequence`, use the matrix's `processSequences` which have full transition conditions (AND/OR combinators), permissives with polarity, safety conditions, and device references
- Pass the matrix's `deviceLinkage` so the process code knows exact instance DB names and parameter names

In `src/lib/forge-prompts.ts`, update `buildProcessSclPrompt()` and `buildProcessSclUserMessage()` to accept and format the matrix data:
- Include the device wiring table so the AI knows exact FB parameter names
- Include instance DB names so the AI generates correct FB calls
- Include interlocks so the AI generates interlock checks in the process code
- Include the full transition conditions (not just simplified step/action/criteria)

## 8. Types

The forge already imports types from `@/types/process-builder` — use `ProcessLinkageMatrix`, `LinkageDevice`, `ProcessSequence`, `ProcessStep`, `TransitionCondition`, etc. directly. Don't recreate them.

## 9. Migration

Update `supabase/migrations/025_forge_sessions.sql` or create a new migration to ensure `linkage_matrix` column type is `jsonb` (it already is — just verify).

## Implementation order

1. Update types and store (step definitions)
2. Build the matrix generation prompt and hook
3. Build the matrix review component (start with Option B — simpler view)
4. Wire into route
5. Update code generation hooks to use matrix data
6. Test end-to-end

Commit with: "forge-ui: add Matrix Review step with linkage matrix and sequence diagram"
