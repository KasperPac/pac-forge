# Plan: Chunked Spec Analysis Engine (FEAT-12)

## Summary

Replace the single-shot spec analysis (which sends 100K+ tokens in one call and loses details) with a 4-stage pipeline: Survey the full spec to build a section map, then run targeted extractions per subsystem (10-20K tokens each), merge the results, and finally run the existing challenger/validator passes. This dramatically improves extraction quality for large specs while keeping the single-shot path as fallback for small specs (<40K chars).

## User Story

As an automation engineer uploading a 120-page functional spec,
I want the analysis to catch every threshold, alarm, and device in every subsystem,
So that the downstream code generation doesn't miss critical process logic like temperature-based fan staging.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | HIGH |
| Systems Affected | Spec analysis pipeline, forge-spec-upload UI, forge types |
| Depends On | FEAT-11 (multi-pass challenger/validator) |
| Monday | FEAT-12, Critical |

---

## Architecture

```
          ┌─────────────┐
          │  Spec Text   │ (plain text from .docx/.pdf)
          └──────┬───────┘
                 │
     ┌───────────▼───────────┐
     │  STAGE 1: SURVEY      │  Full spec → lightweight section map
     │  (Claude, ~100K in,   │  Output: extraction targets + anchors
     │   ~2K out)            │
     └───────────┬───────────┘
                 │
     ┌───────────▼───────────┐
     │  CHUNKER              │  Finds chunk boundaries via text anchors
     │  (deterministic)      │  Falls back to section heading matching
     └───────────┬───────────┘
                 │
     ┌───────────▼───────────┐
     │  STAGE 2: EXTRACT     │  One call per chunk (~15K in, ~4K out)
     │  (Claude, parallel 2) │  Each produces PartialSpecAnalysis
     └───────────┬───────────┘
                 │
     ┌───────────▼───────────┐
     │  STAGE 3: MERGE       │  Combine + deduplicate
     │  (deterministic)      │  Resolve cross-references
     └───────────┬───────────┘
                 │
     ┌───────────▼───────────┐
     │  STAGE 4: FEAT-11     │  Challenge (Gemini) + Validate (Claude)
     │  (existing)           │  Runs on merged SpecAnalysis
     └───────────┬───────────┘
                 │
          ┌──────▼───────┐
          │ SpecAnalysis  │
          └──────────────┘
```

### Fallback Strategy

- **Spec < 40K chars**: Skip survey + chunking, use existing single-shot `analyze()`.
- **Survey fails**: Fall back to single-shot.
- **< 50% anchors match**: Fall back to single-shot (survey likely hallucinated).
- **Individual chunk fails**: Retry once, then skip. Challenger/validator catches gaps.

---

## New Types

**File: `src/types/forge.ts`** (after SpecAnalysis, ~line 353)

```typescript
/** Stage 1 output: section map + extraction targets */
export interface SpecSurveyResult {
  project_name: string;
  project_description: string;
  plc_type: string;
  plc_order_number: string | null;
  hmi_type: string;
  safety_classification: string | null;
  extraction_targets: SpecExtractionTarget[];
  cross_cutting_concerns: SpecCrossCuttingConcerns;
}

export interface SpecExtractionTarget {
  id: string;                    // "T01", "T02", etc.
  name: string;                  // "Fan Staging System"
  subsystem: string;             // "Cooling"
  start_anchors: string[];       // Literal text from spec marking section start
  end_anchors: string[];         // Literal text marking section end
  expected_device_count: number;
  expected_sequences: string[];
  extraction_notes: string;
}

export interface SpecCrossCuttingConcerns {
  safety_systems: string[];
  global_settings: string[];
  hmi_requirements: string[];
  shared_interlocks: string[];
}

export interface PartialSpecAnalysis {
  target_id: string;
  subsystems: Array<{ name: string; description: string }>;
  devices: SpecAnalysisDevice[];
  process_sequences: SpecAnalysisProcessSequence[];
  alarms: SpecAnalysisAlarm[];
  interlocks: SpecAnalysisInterlock[];
  process_settings: SpecAnalysisProcessSetting[];
  hardware_rack: SpecAnalysisHardwareSlot[];
}

export interface SpecChunk {
  targetId: string;
  targetName: string;
  text: string;
  contextPreamble: string;
}

export interface ChunkedAnalysisProgress {
  stage: "survey" | "extracting" | "merging";
  currentChunk: number;
  totalChunks: number;
  chunkName: string;
}
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/types/forge.ts` | UPDATE | Add survey/chunk/partial types |
| `src/lib/forge-spec-survey.ts` | CREATE | Survey prompt builder + validator |
| `src/lib/forge-spec-chunker.ts` | CREATE | Chunk boundary detection from survey anchors |
| `src/lib/forge-spec-chunk-extract.ts` | CREATE | Per-chunk extraction prompt builder |
| `src/lib/forge-spec-merge.ts` | CREATE | Merge + deduplicate partial analyses |
| `src/hooks/use-forge-chunked-analysis.ts` | CREATE | Orchestrator hook (survey→extract→merge) |
| `src/lib/forge-prompts.ts` | UPDATE | Export SPEC_ANALYSIS_SCHEMA |
| `src/lib/forge-pipeline-validator.ts` | UPDATE | Add spec_survey agent markers |
| `src/components/forge/steps/forge-spec-upload.tsx` | UPDATE | Route to chunked analysis for large specs |
| `src/components/forge/spec-depth-dialog.tsx` | UPDATE | Show spec size info + chunked mode note |

---

## Tasks

### Task 1: Add new types to forge.ts

- **File**: `src/types/forge.ts`
- **Action**: UPDATE
- **Implement**: Add `SpecSurveyResult`, `SpecExtractionTarget`, `SpecCrossCuttingConcerns`, `PartialSpecAnalysis`, `SpecChunk`, `ChunkedAnalysisProgress` interfaces
- **Mirror**: Existing `SpecAnalysis` type at line 326-346
- **Validate**: `npx tsc --noEmit`

### Task 2: Create survey prompt builder

- **File**: `src/lib/forge-spec-survey.ts`
- **Action**: CREATE
- **Implement**:
  - `SURVEY_OUTPUT_SCHEMA` — JSON schema for SpecSurveyResult
  - `buildSurveySystemPrompt()` — instructs model to scan full spec, output section map
  - `buildSurveyUserMessage(specText: string)` — wraps spec text
  - `validateSurveyResult(parsed: unknown): SpecSurveyResult` — validates output
  - Survey prompt focus: identify subsystems, find text anchors (literal heading/phrase strings), estimate device counts, identify cross-cutting safety/settings
  - Max output: 4096 tokens (lightweight)
- **Mirror**: `forge-prompts.ts:246-281` for prompt builder pattern, `use-forge-spec-analysis.ts:15-69` for validation pattern
- **Validate**: `npx tsc --noEmit`

### Task 3: Create chunk boundary detector

- **File**: `src/lib/forge-spec-chunker.ts`
- **Action**: CREATE
- **Implement**:
  - `buildChunksFromSurvey(specText: string, survey: SpecSurveyResult): SpecChunk[]`
  - Primary: anchor-based splitting (indexOf start_anchor, indexOf end_anchor)
  - Fallback: section heading matching via `splitIntoSections()` from `document-sections.ts`
  - Add 500 char overlap at boundaries
  - Build context preamble per chunk (project name, subsystem list, cross-cutting concerns, other target names)
  - If <50% anchors match, return single chunk (full spec) to trigger fallback
  - `CHUNKED_THRESHOLD = 40_000` constant
- **Mirror**: `document-sections.ts:27` for section splitting, `use-knowledge-distribute.ts:74` for chunk size limits
- **Validate**: `npx tsc --noEmit`

### Task 4: Export SPEC_ANALYSIS_SCHEMA

- **File**: `src/lib/forge-prompts.ts`
- **Action**: UPDATE
- **Implement**: Change `const SPEC_ANALYSIS_SCHEMA` to `export const SPEC_ANALYSIS_SCHEMA`
- **Validate**: `npx tsc --noEmit`

### Task 5: Create per-chunk extraction prompt

- **File**: `src/lib/forge-spec-chunk-extract.ts`
- **Action**: CREATE
- **Implement**:
  - `buildChunkExtractionSystemPrompt(survey, targetId, fbTemplates?, promptSections?)` — reuses FORGE_PM_SPEC_ANALYSIS_INSTRUCTIONS but prefixed with survey context and scoped to one target
  - `buildChunkExtractionUserMessage(chunk: SpecChunk)` — wraps chunk text with context preamble
  - `validatePartialSpecAnalysis(parsed, targetId): PartialSpecAnalysis` — validates per-chunk output
  - Max tokens: 8192 per chunk
  - Schema: subset of SPEC_ANALYSIS_SCHEMA (devices, sequences, alarms, interlocks, settings, hardware_rack)
- **Mirror**: `forge-prompts.ts:246-281` for prompt pattern, `use-forge-spec-analysis.ts:15-69` for validation
- **Validate**: `npx tsc --noEmit`

### Task 6: Create merge + deduplicate logic

- **File**: `src/lib/forge-spec-merge.ts`
- **Action**: CREATE
- **Implement**:
  - `mergePartialAnalyses(survey: SpecSurveyResult, partials: PartialSpecAnalysis[]): SpecAnalysis`
  - Device dedup: match by tag (exact, case-insensitive) or by name+subsystem. Keep entry with more IO signals.
  - Subsystem dedup: by name.
  - Process settings dedup: by name, keep entry with more non-null fields.
  - Alarms dedup: by name, merge affected_sequences arrays.
  - Interlocks dedup: by name, merge affected_devices arrays.
  - Hardware rack dedup: by slot number.
  - Assign sequential device IDs (DEV001, DEV002, ...).
  - Validate devices_involved references in sequences.
- **Validate**: `npx tsc --noEmit`

### Task 7: Create orchestrator hook

- **File**: `src/hooks/use-forge-chunked-analysis.ts`
- **Action**: CREATE
- **Implement**:
  - `useForgeChunkedAnalysis()` → `{ analyzeChunked, loading, error, progress }`
  - `progress` state: `ChunkedAnalysisProgress`
  - Flow: survey → buildChunks → extract each (sequential or 2 concurrent) → merge
  - Each call uses `validateAndCall(callNonStreaming, ...)` with appropriate plMeta
  - Survey: model default (Claude), `prompt_name: "forge-spec-survey"`
  - Chunks: model default (Claude), `prompt_name: "forge-spec-chunk-extract"`, `round: chunkIndex`
  - Retry once per chunk on failure, skip on second failure
- **Mirror**: `use-forge-spec-analysis.ts:79-134` for hook pattern, `use-knowledge-distribute.ts:258-357` for two-pass orchestration
- **Validate**: `npx tsc --noEmit`

### Task 8: Add spec_survey to pipeline validator

- **File**: `src/lib/forge-pipeline-validator.ts`
- **Action**: UPDATE
- **Implement**: Add to AGENT_IDENTITY_MARKERS: `spec_survey: ["senior automation engineer", "survey", "section map", "extraction targets"]`
- **Validate**: `npx tsc --noEmit`

### Task 9: Integrate chunked analysis into UI

- **File**: `src/components/forge/steps/forge-spec-upload.tsx`
- **Action**: UPDATE
- **Implement**:
  - Import `useForgeChunkedAnalysis`
  - In `runAnalysis()`: if `specText.length > CHUNKED_THRESHOLD`, call `analyzeChunked()` instead of `analyze()`
  - Update PassState to include `survey` step
  - Show chunk progress: "Extracting 3/7: Fan Staging System"
  - Pipe chunked result into existing challenge/validate passes
- **Mirror**: Existing multi-pass flow in same file
- **Validate**: `npm run build`

### Task 10: Update depth dialog with spec size info

- **File**: `src/components/forge/spec-depth-dialog.tsx`
- **Action**: UPDATE
- **Implement**:
  - Accept `specLength?: number` prop
  - If specLength > CHUNKED_THRESHOLD, show info note: "Large spec detected (Xk chars). Chunked extraction will be used automatically."
  - No new options needed — chunking is automatic
- **Validate**: `npm run build`

---

## Key Design Decisions

1. **Chunking is automatic, not user-selectable.** Specs over 40K chars use chunked pipeline. Under that, single-shot. Simpler UX.

2. **Survey uses text anchors, not page numbers.** Because page numbers aren't preserved from docx/pdf extraction. Anchor strings are literal text found in the spec — robust substring matching.

3. **Parallel chunk extraction with concurrency limit of 2.** Balances speed vs. rate limits. Each chunk is ~15K tokens input.

4. **Merge is deterministic, not AI-driven.** No AI call for merging — just data structure operations. Cheaper, faster, reproducible.

5. **Fallback to single-shot is aggressive.** If survey fails or anchors don't match, we fall back rather than risk garbage. The challenger/validator passes catch remaining gaps.

---

## Validation

```bash
npx tsc --noEmit     # Type check
npx vite build        # Full production build
npm run lint          # ESLint
```

## Acceptance Criteria

- [ ] Survey pass produces valid SpecSurveyResult with extraction targets
- [ ] Chunker splits spec into chunks matching survey targets
- [ ] Each chunk extraction produces valid PartialSpecAnalysis
- [ ] Merge produces a complete SpecAnalysis with no duplicate devices
- [ ] Specs under 40K chars use single-shot (no regression)
- [ ] Specs over 40K chars use chunked pipeline automatically
- [ ] UI shows per-chunk progress during extraction
- [ ] Challenge/validate passes work on merged chunked output
- [ ] PromptLayer logs show separate entries for survey + each chunk
- [ ] Full build passes with no type errors
