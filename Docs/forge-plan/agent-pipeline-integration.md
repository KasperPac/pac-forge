# Forge Wizard: Full Agent Pipeline Integration

## Overview

The forge wizard currently does single-pass generation — Code Architect generates, engineer approves, done. This needs to become a proper pipeline where each step goes through: **Generate → Review → Fix if needed → Engineer Approve → Upload to TIA → Compile → Auto-fix if compile fails**.

Each stage has SCOPED review — the Standards Reviewer only checks what's relevant to that stage, not the entire project.

## Architecture: Per-Step Pipeline

Every generation step in the wizard should execute this sub-pipeline:

```
1. GENERATE    → Code Architect produces artifacts for this stage
2. REVIEW      → Standards Reviewer checks artifacts (stage-scoped)
3. REWRITE     → If review has CRITICAL/WARNING findings, Code Architect rewrites
4. RE-REVIEW   → Standards Reviewer re-checks (optional — skip if no CRITICAL findings remain)
5. APPROVE     → Engineer reviews and approves artifacts
6. TIA UPLOAD  → Upload approved artifacts to TIA Portal via bridge
7. COMPILE     → Compile in TIA, get results
8. COMPILE-FIX → If compile errors, Code Architect fixes, re-upload, re-compile (max 3 attempts)
9. COMPLETE    → Step done, artifacts are in TIA and compiling clean
```

Steps 2-4 (review/rewrite cycle) run automatically — the engineer sees the result after review is complete. Steps 6-8 (TIA compile cycle) also run automatically after engineer approval.

## New Files Required

### `src/lib/forge-agent-prompts.ts`
Central file containing ALL agent prompt builders for the forge wizard. This replaces the generic prompts in `forge-prompts.ts` with the proper agent-specific prompts.

Each function returns a system prompt string. The prompts below should be adapted from the existing agent prompts (provided below) but scoped to the forge wizard context.

### `src/hooks/use-forge-review.ts`
Hook that runs the Standards Reviewer on a set of artifacts.

### `src/hooks/use-forge-rewrite.ts`
Hook that runs the Code Architect rewrite based on review findings.

### `src/hooks/use-forge-compile-check.ts`
Hook that uploads artifacts to TIA, compiles, and if errors, runs compile-fix cycle.

### `src/lib/forge-review-parser.ts`
Parser for the Standards Reviewer response — extracts CRITICAL/WARNING/INFO findings.

## Agent Prompt Specifications

### 1. Standards Reviewer — Stage-Scoped Prompts

The reviewer gets DIFFERENT scope instructions depending on which stage is being reviewed.

#### `buildForgeReviewPrompt(stage, artifacts, platformRules, profileRules)`

Base identity (same for all stages):
```
You are reviewing generated SCL code artifacts. Your job is to:
1. Inspect each artifact against the platform rules and the checklist below
2. Report your findings as a structured list — the Code Architect will fix any issues you identify
3. Do NOT rewrite or correct the code yourself — only report what you found
```

The MANDATORY checklist (applies to ALL stages):
1. CASE labels must be integer literals — flag CRITICAL if not
2. CASE must have ELSE branch — flag CRITICAL if missing
3. Instance DBs for every FB — flag CRITICAL if missing
4. FB call syntax uses instance DB name only — flag CRITICAL if wrong
5. Timer/Counter/Edge in VAR not VAR_TEMP — flag CRITICAL if wrong
6. Type conversions must be explicit — flag CRITICAL if implicit
7. # prefix on all local variables — flag CRITICAL if missing
8. All FB parameters wired up — flag CRITICAL if missing
9. All variables used must be declared — flag CRITICAL if undeclared
10. Naming conventions per platform rules — flag WARNING
11. REGION blocks for organization — flag INFO

Then append the STAGE-SPECIFIC scope:

**IO Stage scope** — append:
```
This review covers ONLY the IO Configuration stage.
Check: tag naming, data types, address format (%I/%Q), no duplicate addresses, inputs use %I, outputs use %Q.
Do NOT flag: missing FBs, FCs, OBs, DBs, or program logic — those come in later stages.
```

**FB Stage scope** — append:
```
This review covers ONLY the Function Block stage.
Check: FB interface sections, static vs temp declarations, no absolute addressing in FBs, REGION blocks, CASE ELSE branches, naming conventions.
Do NOT flag: missing OB1, instance DBs, global DBs, Process FC, IO tags — those come in other stages.
```

**DB Stage scope** — append:
```
This review covers ONLY the Data Block stage.
Check: instance DBs match FB interfaces, global DB initial values, UDT references, naming (Inst prefix), retain attributes.
Do NOT flag: missing OB1, FB logic, FC calls, IO tags — those come in other stages.
```

**FC+OB Stage scope** — append:
```
This review covers ONLY the Process FC + OB1 stage.
Check: all FBs instantiated and called with instance DBs, correct call syntax, IO tags match, OB1 calls Process FC, parameter passing correct.
Do NOT flag: missing FB internal logic, IO tag definitions, DB declarations — those were reviewed in earlier stages.
```

**Process Code scope** — use the FULL review checklist (no stage restrictions).

**Output format** — the reviewer must output findings in a parseable format:
```
[FINDING:CRITICAL] artifact_name | Description of the issue
[FINDING:WARNING] artifact_name | Description of the issue
[FINDING:INFO] artifact_name | Description of the issue

[REWRITE_SCOPE:TARGETED|CASCADE|ARCHITECTURAL]
Files needing changes: file1, file2
```

### 2. Code Architect — Rewrite Prompt

#### `buildForgeRewritePrompt(artifacts, findings, platformRules, profileRules)`

Identity:
```
You are Code Architect, rewriting PLC code to address review findings.
```

Instructions:
```
Specialist reviewers have inspected the generated code and reported findings. You MUST address every CRITICAL and WARNING finding. INFO findings are optional improvements.

Rewrite the artifacts to fix all reported issues while maintaining the existing code structure and functionality. Do not introduce unnecessary changes beyond what the findings require.

After rewriting, verify:
- All variables used in code bodies are declared in VAR sections
- All UDT field accesses match the UDT STRUCT definitions
- All cross-artifact references (UDTs, FBs, instance DBs, Main calls) are consistent
- No parameters were dropped from FB calls during the rewrite

REWRITE SCOPE MANAGEMENT:
- TARGETED: Only regenerate files with actual issues
- COPY FORWARD: Unchanged files should be identical to previous version
- FULL OUTPUT: Always provide complete artifact set

Response Format:
## Rewrite Summary
**Files Changed ([N]):**
- [filename] - [specific change made]

**Files Unchanged ([N]):**
- [filename] - Copied from previous version

[Then output ALL files - changed and unchanged]
```

### 3. Compile Fix Prompt

#### `buildForgeCompileFixPrompt(artifact, compileErrors, platformRules)`

Identity and instructions — use the existing compile fix prompt from the app. Key points:
- Analyze each compile error for true root cause
- Apply minimal correction per Siemens TIA Portal SCL rules
- Preserve block interface, STAT memory layout, UDT structures
- Return complete corrected source file
- Follow fixing methodology: syntax → undeclared identifiers → datatype mismatches → call interface mismatches
- Do NOT redesign, rename, remove logic, or invent missing members
- If no safe fix possible, output NO_SAFE_FIX_FOUND

### 4. Pattern Librarian — Post-Fix Analysis

#### `buildForgePatternAnalysisPrompt(originalCode, fixedCode)`

After any rewrite or compile-fix, the Pattern Librarian analyzes the diff:
- Classify the correction (NAMING, IO_MAPPING, STATE_LOGIC, ALARM, SAFETY, TIMING)
- Determine if SYSTEMIC_PATTERN or LOCAL_PATTERN
- Extract a generalized rule for future generation
- These patterns get saved to the pattern_candidates table and injected into future prompts

## Hook Implementations

### `useForgeReview`

```typescript
interface UseForgeReviewReturn {
  review: (artifacts: ForgeArtifact[], stage: ReviewStage) => Promise<ReviewResult>;
  loading: boolean;
  error: string | null;
}

type ReviewStage = "io" | "fb" | "db" | "fc_ob" | "process" | "full";

interface ReviewFinding {
  severity: "CRITICAL" | "WARNING" | "INFO";
  artifactName: string;
  message: string;
}

interface ReviewResult {
  findings: ReviewFinding[];
  rewriteScope: "TARGETED" | "CASCADE" | "ARCHITECTURAL";
  affectedFiles: string[];
  hasCritical: boolean;
  hasWarning: boolean;
}
```

Implementation:
- Build the stage-scoped review prompt via `buildForgeReviewPrompt(stage, ...)`
- Send all artifacts as the user message (formatted as fenced code blocks)
- Parse the response using `forge-review-parser.ts` to extract findings
- Return structured result

### `useForgeRewrite`

```typescript
interface UseForgeRewriteReturn {
  rewrite: (artifacts: ForgeArtifact[], findings: ReviewFinding[]) => Promise<ForgeArtifact[]>;
  loading: boolean;
  error: string | null;
}
```

Implementation:
- Build the rewrite prompt with findings included
- Send current artifacts + findings to Code Architect
- Parse response to extract rewritten artifacts
- Return updated artifact array

### `useForgeCompileCheck`

```typescript
interface UseForgeCompileCheckReturn {
  compileCheck: (artifacts: ForgeArtifact[], tiaProjectPath: string) => Promise<CompileCheckResult>;
  loading: boolean;
  progress: { phase: "uploading" | "compiling" | "fixing" | "recompiling" | "done"; attempt: number };
  error: string | null;
}

interface CompileCheckResult {
  success: boolean;
  artifacts: ForgeArtifact[];  // Potentially updated if compile-fix was needed
  compileErrors: string[];
  compileWarnings: string[];
  fixAttempts: number;
}
```

Implementation:
1. Upload artifacts to TIA via bridge (SCL → `/tia/jobs`, LAD → `/tia/import-lad`)
2. Get compile results
3. If compile errors and attempt < 3:
   a. Run compile-fix prompt with error details
   b. Parse fixed artifacts
   c. Re-upload and re-compile
   d. Repeat if still errors
4. Return final result with updated artifacts

## Updating the Wizard Step Components

### Device Code Step (`forge-device-code.tsx`)

The "Generate All" flow becomes:

```
User clicks "Generate All"
→ Code Architect generates FBs (existing hook)
  → Show: "Generating device FBs..."
→ Standards Reviewer reviews FBs (FB scope)
  → Show: "Reviewing code..."
→ If findings: Code Architect rewrites
  → Show: "Fixing [N] issues..."
→ Display artifacts with review summary badge
  → Green: "Passed review" / Amber: "Fixed [N] issues" / Red: "[N] issues remain"
→ User reviews and approves
→ User clicks "Upload to TIA"
  → Upload → compile → auto-fix cycle
  → Show progress
→ Step complete
```

The device code step should actually run in sub-stages:
1. Generate FBs → review (FB scope) → fix
2. Generate DBs → review (DB scope) → fix
3. Generate IO linking FC + OB1 → review (FC+OB scope) → fix
4. Upload all to TIA → compile → fix

Show these as a sub-progress within the step.

### Process Code Step (`forge-process-code.tsx`)

Same pattern but with full review scope:
1. Generate process FCs → review (full scope, since process code references everything) → fix
2. Upload to TIA → compile → fix

### HMI Step (`forge-hmi.tsx`)

Simpler — no SCL review needed:
1. Generate HMI screens (HMI Screen Designer agent)
2. Upload to TIA via `/tia/import-hmi`
3. No compile step (HMI doesn't compile the same way)

## Sub-Pipeline Progress UI

Each generation step should show a sub-progress indicator:

```
Device Code Step:
  [✅ Generate FBs] → [✅ Review] → [⏳ Fix 2 issues] → [○ Approve] → [○ Upload] → [○ Compile]
```

Use a small horizontal stepper within the step content area, above the artifact list.

Create a reusable component: `src/components/forge/forge-sub-pipeline.tsx`

```typescript
interface ForgeSubPipelineProps {
  stages: Array<{
    label: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    detail?: string;  // e.g. "2 issues found", "3 artifacts"
  }>;
}
```

## Integration with Existing Pattern System

After any rewrite or compile-fix succeeds, run the Pattern Librarian:
1. Compute diff between original and fixed code
2. Send to Pattern Librarian agent for analysis
3. Save resulting patterns to `pattern_candidates` table with status PENDING
4. These patterns will be injected into future generation prompts via `formatPatterns()`

Use the existing `useCreatePatternCandidate` hook from `src/hooks/use-patterns.ts`.

## Validation Integration

All AI calls in the new hooks MUST use `validateAndCall()` from `forge-pipeline-validator.ts` (once installed). Agent type mappings:

| Hook | AI Call | Agent Type |
|------|---------|-----------|
| useForgeReview | Review call | "standards_reviewer" |
| useForgeRewrite | Rewrite call | "code_architect_scl" or "code_architect_lad" |
| useForgeCompileCheck | Compile fix call | "compile_fix" |
| Pattern analysis | Pattern librarian call | "pattern_librarian" |

## File Ownership

These are ALL Claude Code files — no UI components in this task:
- `src/lib/forge-agent-prompts.ts` (NEW)
- `src/lib/forge-review-parser.ts` (NEW)
- `src/hooks/use-forge-review.ts` (NEW)
- `src/hooks/use-forge-rewrite.ts` (NEW)
- `src/hooks/use-forge-compile-check.ts` (NEW)
- `src/components/forge/forge-sub-pipeline.tsx` (NEW — small UI component, OK for Claude Code)
- Updates to `src/components/forge/steps/forge-device-code.tsx`
- Updates to `src/components/forge/steps/forge-process-code.tsx`
- Updates to `src/components/forge/steps/forge-hmi.tsx`

## Implementation Order

1. `forge-agent-prompts.ts` — all the prompt builders (reference the prompts above)
2. `forge-review-parser.ts` — parse reviewer output
3. `use-forge-review.ts` — review hook
4. `use-forge-rewrite.ts` — rewrite hook
5. `use-forge-compile-check.ts` — compile check hook
6. `forge-sub-pipeline.tsx` — sub-progress UI component
7. Update `forge-device-code.tsx` — wire in the full pipeline
8. Update `forge-process-code.tsx` — wire in the full pipeline
9. Update `forge-hmi.tsx` — wire in HMI import

Build and test after each step. Commit with: "forge-pipeline: integrate full agent review/compile pipeline into wizard"
