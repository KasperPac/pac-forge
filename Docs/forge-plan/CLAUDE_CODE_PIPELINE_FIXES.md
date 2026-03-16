# Pipeline Audit Fixes — Claude Code

These are fixes identified from a pipeline audit. Work through them in order. Build after each fix.

---

## FIX 1 (CRITICAL): Generate OB1 Main and master Process FC

The wizard never generates OB1 Main or a master Process FC that calls all device FBs. Without these, the TIA project has no entry point and device FBs are never called.

### What to do:

**A) Add OB1 + Process FC generation to the process code step.**

After all sequence FCs are generated, the process generate hook should also produce:
1. A master "RunProcess" FC that calls every device FB via its instance DB (wiring IO and config data)
2. An OB1 "Main" that calls "RunProcess"

**B) Add two new prompt builders to `src/lib/forge-prompts.ts`:**

```typescript
export function buildProcessFcPrompt(context: ProcessGenContext): string
```
This prompt tells the Code Architect to generate a master Process FC. It receives:
- All device FB interfaces (from extractFbInterfaces)
- All IO entries (tag names, addresses)
- All instance DB names
- The process sequence FCs that were just generated
- Instructions: "Generate a single FC called RunProcess that calls every device FB via its instance DB, wires IO tags to FB inputs, and calls all process sequence FCs. Follow the pattern: Main → RunProcess → Device FBs + Sequence FCs"

```typescript
export function buildOb1Prompt(): string
```
This prompt is simple: "Generate OB1 Main that calls RunProcess(). Keep it minimal — just the FC call."

**C) Update `use-forge-process-generate.ts`:**

After generating all sequence FCs in `generateAll()`:
1. Generate the RunProcess FC (passing all device artifacts + sequence artifacts as context)
2. Generate OB1 Main
3. Add both to the returned artifact array

The artifacts should have type "FC" for RunProcess and type "OB" for Main.

**D) Update the process SCL prompt (`buildProcessSclPrompt`):**

Currently it says "Generate one FC per process sequence." It should also say:
"Do NOT generate OB1 or the master Process FC here — only the sequence-specific FC. The master Process FC and OB1 are generated separately after all sequences."

This prevents the sequence generation from also trying to produce OB1 (which would create duplicates).

---

## FIX 2 (CRITICAL): Align device code generation with established architecture

Currently the device step generates per-device: FB + instance DB together in one call, plus an IO linking FC at the end. But the established architecture from your Code Architect prompt requires:
- Device FBs with proper REGION blocks (IO Mapping, State Machine, Alarm Handling, Output Mapping)
- Status reporting via Word output (PLCopen pattern)
- Every FB must have busy, error, status outputs

### What to do:

Update `buildDeviceSclPrompt()` in `src/lib/forge-prompts.ts` to include these requirements from the established Code Architect prompt. Add after the existing platform rules section:

```
## FB Architecture Requirements
- Organize FB body into REGION blocks: IO Mapping, State Machine, Alarm Handling, Output Mapping
- Include PLCopen-style outputs: busy (Bool), error (Bool), status (Word := 16#7000)
- Use status word ranges: 16#0000 done, 16#7000 idle, 16#7001 first call, 16#7002 executing, 16#8xxx errors
- Use CASE-based state machines with integer literal labels for all sequential logic
- Include interlock checks, alarm handling with latching/operator reset
- All timers/counters/edges declared in VAR (static) with inst prefix, NEVER in VAR_TEMP
- Include a resetAlarms : Bool input for operator alarm acknowledgment

## Instance DB Rules
- Generate a separate instance DB for each FB
- Instance DB just references the FB name — do NOT redeclare variables inside the DB
- Format: DATA_BLOCK "InstDeviceName" { S7_Optimized_Access := 'TRUE' } NON_RETAIN "FBName" BEGIN END_DATA_BLOCK

## Calling Convention
- Device FBs are called from the Process FC using instance DB name ONLY: "InstMotor1"(start := signal)
- NEVER use "FBName"."InstDBName" syntax — it does not compile
```

---

## FIX 3 (IMPORTANT): Enrich process code prompt to match established agent

The forge process prompt is too simple compared to the established Process Code agent prompt. Update `buildProcessSclPrompt()` in `src/lib/forge-prompts.ts`:

Add these requirements (from the established prompt):

```
## Process Code Requirements
1. Implement each process sequence as an FB (not FC) with a CASE-based state machine if it needs timers or edge detection. Use FC only if purely stateless.
2. Steps should be numbered (0, 10, 20, 30...) with clear transitions.
3. Include interlock checks at the start of each sequence step using a dedicated #tempInterlockOK Bool.
4. Every process FB must expose VAR_OUTPUT for HMI: currentStep (Int), running (Bool), faulted (Bool), complete (Bool).
5. Use latching alarm patterns — set on fault condition, require operator reset via resetAlarms (Bool) input.
6. All timed operations use TON with configurable PT as VAR_INPUT.
7. Include safety condition checks (E-stop, safety relay) that halt the sequence to safe state on failure.
8. Include permissive checks that gate sequence start.
```

Also update the user message builder `buildProcessSclUserMessage()` to include permissives from the sequence data (it already does this partially — verify the safety conditions are also included).

---

## FIX 4 (IMPORTANT): Add pipeline validator to Q&A review hook

`src/hooks/use-forge-qa-review.ts` calls `callNonStreaming()` directly without `validateAndCall()`.

### What to do:

1. Import `validateAndCall` from `@/lib/forge-pipeline-validator`
2. Add a new agent type to the validator. In `src/lib/forge-pipeline-validator.ts`, add to AGENT_IDENTITY_MARKERS:
```typescript
pm_qa: [
  "Project Manager",
  "reviewing",
  "spec analysis",
  "clarifying questions",
  "gaps",
],
```
3. Replace all three `callNonStreaming()` calls in `use-forge-qa-review.ts` with `validateAndCall()` using agent type `"pm_qa"`.

---

## FIX 5 (IMPORTANT): Use topological sort for forge export

`src/lib/forge-export.ts` uses a simple type-order sort. Replace with proper dependency-aware sorting.

### What to do:

In `buildForgeManifest()`, after the initial type-based sort, also sort within each type group by dependencies. Or better — reuse the existing `buildManifest()` from `src/lib/manifest-builder.ts` which implements Kahn's algorithm.

If reusing is complex due to type differences, at minimum ensure:
- UDTs that reference other UDTs are ordered correctly
- FBs that use other FBs as multi-instances are ordered correctly  
- Instance DBs come after their referenced FB

---

## FIX 6 (RECOMMENDATION): Consistent JSON output format

Make all prompts consistently request JSON inside ```json fences, and always strip fences on parse.

In `src/lib/forge-prompts.ts`:
- `buildSpecAnalysisPrompt()` — change "no markdown fences" to: "Return the JSON inside ```json fences."
- `buildQaUpdateAnalysisPrompt()` — change to: "Return the updated JSON inside ```json fences."
- `buildHmiPrompt()` — change "No markdown fences" to: "Return the JSON array inside ```json fences."

This is consistent with how all the parsers already work (they all strip ```json fences).

---

## FIX 7 (RECOMMENDATION): Add Pattern Librarian call after review/rewrite

This only applies once the review/rewrite pipeline (from agent-pipeline-integration.md) is implemented. After any successful rewrite:

1. Compute diff between original artifacts and rewritten artifacts
2. For each changed artifact, call the Pattern Librarian with the original and fixed code
3. Save resulting patterns to `pattern_candidates` table via `useCreatePatternCandidate`

Use the existing pattern librarian prompt from `src/lib/pattern-librarian-prompt.ts` — the `buildPatternLibrarianPrompt()` function.

This can be a post-demo improvement — flag it with a TODO comment in the rewrite hook when you build it.

---

Commit after all fixes with: "forge-pipeline: critical architecture fixes from audit"
