# CLAUDE CODE TASKS — Project Wizard

**Role:** Architecture, AI integration, orchestration, pipeline logic, prompt engineering.
**Reference:** Read `MASTER_PLAN.md` first for full context.
**Rule:** Do NOT edit files owned by Codex (see FILE_OWNERSHIP in master plan). If you need a UI component to exist, describe the interface in a comment or type and let Codex build it.

---

## CONTEXT: What Already Exists

Before building anything new, understand these existing systems you'll be integrating with:

- **Edge Function:** `supabase/functions/generate/index.ts` — Claude API proxy. Accepts `{ system_prompt, messages, stream?, max_tokens? }`. Returns SSE stream or JSON. Model: `claude-sonnet-4-6`, max tokens capped at 32768. Auth via Supabase JWT.
- **Generation helpers:** `src/hooks/use-generation.ts` — `streamFromEdgeFunction()`, `callNonStreaming()`, `processRawResponse()`, `getAuthToken()`. All forge hooks should use these.
- **Prompt builders:** `src/lib/prompt-builder.ts`, `process-prompt-builder.ts`, `compile-fix-prompt.ts`, `lad-prompt-builder.ts`, `fb-builder-prompt.ts`. Study these for patterns. The forge prompts should follow the same structure.
- **FB templates:** Queried via `useFbTemplates()` hook. Each has `name`, `device_category`, `base_scl`, `parameters`, `tags`.
- **LAD types:** `src/types/lad.ts` — `LadProgram`, `LadRung`, `LadNode`, `LadElement`. LAD generation must output this JSON structure.
- **LAD XML builder:** `src/lib/lad-xml-builder.ts` — converts `LadProgram` → SimaticML XML for TIA import.
- **HMI types:** `src/types/hmi-screen.ts` — `HmiScreenSpec`, `HmiElement`, etc.
- **HMI XML builder:** `src/lib/hmi-xml-builder.ts` — converts `HmiScreenSpec` → WinCC SimaticML XML.
- **Manifest builder:** `src/lib/manifest-builder.ts` — topological sort (Kahn's algorithm) for TIA import ordering.
- **Safety analyzer:** `src/lib/safety-analyzer.ts` — 6 rule-based safety checks on generated code.
- **Agent profiles:** `src/lib/agent-profiles.ts` — identities for Code Architect, PM, Standards Enforcer, etc.
- **Design profiles:** `src/types/design-profile.ts` — `DesignProfile` with `general_rules`, `folder_rules`, `process_rules`, `fb_rules`.
- **Platform rules:** `ai/PLATFORM_RULES_SIEMENS_TIA.md` — injected into all generation prompts.
- **SCL reference:** `ai/SCL_LANGUAGE_REFERENCE.md` — SCL syntax reference.
- **TIA bridge contract:** `src/lib/tia-bridge-contract.ts` — all bridge endpoint types.
- **Existing hooks pattern:** All hooks use TanStack Query (`@tanstack/react-query`). Mutations use `useMutation` with `queryClient.invalidateQueries`. Follow this pattern.

---

## TASK 1: Database Migration — forge_sessions table
**Priority:** Do first — everything depends on this.
**File:** `supabase/migrations/025_forge_sessions.sql`

Create the `forge_sessions` table as specified in MASTER_PLAN.md Section 3.1. Include:
- RLS policies (authenticated users can CRUD their own sessions)
- Index on `project_id` and `user_id`
- `updated_at` trigger

Also add new columns to `design_profiles` table:
```sql
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS code_language text NOT NULL DEFAULT 'SCL';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS process_code_language text NOT NULL DEFAULT 'SCL';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS hmi_theme text NOT NULL DEFAULT 'default';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS naming_prefix text NOT NULL DEFAULT '';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS db_naming_prefix text NOT NULL DEFAULT '';
```

**Output:** Migration file ready to apply.

---

## TASK 2: Forge Types
**Priority:** Do second — Codex needs these types for UI components.
**File:** `src/types/forge.ts`

Define all TypeScript types for the wizard:
- `ForgeStep` — union type of step names
- `ForgeStepStatus` — "pending" | "active" | "completed" | "failed"
- `ForgeSession` — matches the DB table
- `ForgeArtifact` — as specified in master plan Section 3.2
- `SpecAnalysis` — as specified in master plan Section 3.3
- `ForgeDeviceEntry` — device with FB assignment
- `ForgeIoEntry` — IO point (reuse/extend existing `IoEntry`)
- `ForgeHardwareConfig` — CPU + rack/slot + modules

Export `FORGE_STEPS` ordered array and `FORGE_STEP_LABELS` map.

**NOTE:** Coordinate with Codex — they will import these types. Publish this file early so they can start building UI.

---

## TASK 3: Forge Session Hook
**Priority:** Do third.
**File:** `src/hooks/use-forge-session.ts`

CRUD hook for forge sessions using TanStack Query:
- `useForgeSession(sessionId)` — fetch single session
- `useCreateForgeSession()` — create new session for a project
- `useUpdateForgeSession()` — update session (step data, step status, current_step)
- `useActiveForgeSession(projectId)` — get the active (non-completed) session for a project

Follow the pattern in `src/hooks/use-sessions.ts` and `src/hooks/use-projects.ts`.

---

## TASK 4: Spec Analysis Prompt + Hook
**Priority:** Critical for demo.
**Files:**
- `src/lib/forge-prompts.ts` (spec analysis prompt)
- `src/hooks/use-forge-spec-analysis.ts`

### Prompt Design
Build a system prompt for the PM agent that:
1. Receives the full text of a functional spec (extracted via mammoth/pdfjs-dist)
2. Returns a `SpecAnalysis` JSON object (see master plan Section 3.3)
3. Must handle:
   - Device tables (like the NZ001 instrumentation table in the Cathode spec)
   - Process sequence tables with Step / Action / Completion criteria columns
   - Alarm tables with severity classification
   - Interlock lists
   - Non-English terminology (the Cathode spec has Italian terms)
   - Markdown-formatted tables (pandoc/mammoth output)

### Prompt structure:
```
You are a senior automation engineer analyzing a functional specification document.
Extract the following structured data as JSON...

<spec_text>
{full_spec_text}
</spec_text>

Return ONLY valid JSON matching this schema:
{schema}
```

Use `callNonStreaming()` from `use-generation.ts`. Max tokens: 16384 (spec analysis can be large).

### Hook interface:
```typescript
function useForgeSpecAnalysis(): {
  analyze: (specText: string) => Promise<SpecAnalysis>;
  loading: boolean;
  error: string | null;
}
```

The hook should:
- Call the edge function with the PM agent identity
- Parse the JSON response
- Validate required fields
- Return typed `SpecAnalysis`

---

## TASK 5: Device-to-FB Template Matcher
**Priority:** Important for device code stage.
**File:** `src/lib/forge-device-matcher.ts`

Logic to automatically match devices from the spec analysis to FB templates in the library:

```typescript
interface DeviceFbMatch {
  device: ForgeDeviceEntry;
  template: FbTemplate | null;      // null = no match, AI must generate
  confidence: "exact" | "probable" | "none";
  reason: string;
}

function matchDevicesToTemplates(
  devices: ForgeDeviceEntry[],
  templates: FbTemplate[],
): DeviceFbMatch[];
```

Matching strategy (deterministic, no AI needed):
1. **Exact match:** device type matches template `device_category` exactly (e.g., "Motor DOL" → template with category "Motor DOL")
2. **Probable match:** device type partially matches (e.g., "Motor" matches "Motor DOL" template)
3. **No match:** no template found — flag for AI generation

Also consider template tags for fuzzy matching.

---

## TASK 6: Device Code Generation Hook
**Priority:** Critical for demo.
**Files:**
- `src/lib/forge-prompts.ts` (add device code prompts)
- `src/hooks/use-forge-device-generate.ts`

### For SCL:
Generate FBs, instance DBs, and the IO linking FC. Use the existing prompt builder patterns from `prompt-builder.ts` but adapted for the forge context:
- Include the profile's rules
- Include the device's IO signals
- Include the FB template base code (if matched)
- Include platform rules
- Include active correction patterns

### For LAD:
Generate `LadProgram` JSON (same as `use-lad-generate.ts` does). The JSON will be converted to XML via `lad-xml-builder.ts` for TIA import.

### Hook interface:
```typescript
function useForgeDeviceGenerate(): {
  generateAll: (session: ForgeSession, profile: DesignProfile) => Promise<ForgeArtifact[]>;
  generateSingle: (device: ForgeDeviceEntry, session: ForgeSession, profile: DesignProfile) => Promise<ForgeArtifact>;
  loading: boolean;
  progress: { current: number; total: number; currentDevice: string };
  error: string | null;
}
```

The `generateAll` function should:
1. Iterate through confirmed device list
2. For each device: if template matched, use template + IO to generate; if no template, full AI generation
3. Generate instance DBs
4. Generate IO linking FC
5. Return array of `ForgeArtifact` objects
6. Report progress (for the UI progress bar)

---

## TASK 7: Process Code Generation Hook
**Priority:** Critical for demo.
**Files:**
- `src/lib/forge-prompts.ts` (add process code prompts)
- `src/hooks/use-forge-process-generate.ts`

Generate process code from:
- Confirmed device list (FB interfaces only — use `extractFbInterface()` from `process-pipeline.ts`)
- Process sequences (from spec analysis or manually defined)
- Profile language preference
- Profile process rules and examples

### Prompt must handle:
- **SCL mode:** CASE-based state machines with step transitions
- **LAD mode:** Sequential ladder logic with step bits and transitions
- **Profile-specific patterns:** If the profile has process rule examples, include them in the prompt

### Hook interface:
```typescript
function useForgeProcessGenerate(): {
  generateAll: (session: ForgeSession, profile: DesignProfile) => Promise<ForgeArtifact[]>;
  generateSequence: (sequence: ProcessSequence, session: ForgeSession, profile: DesignProfile) => Promise<ForgeArtifact>;
  loading: boolean;
  progress: { current: number; total: number; currentSequence: string };
  error: string | null;
}
```

---

## TASK 8: HMI Generation Hook
**Priority:** Important for demo but can be basic.
**Files:**
- `src/lib/forge-prompts.ts` (add HMI prompts)
- `src/hooks/use-forge-hmi-generate.ts`

Generate basic HMI screens:
1. **Overview screen:** Device status indicators laid out in a grid/flow
2. **Faceplate screens:** One per device type (motor faceplate, valve faceplate)

AI must output `HmiScreenSpec` JSON (existing type in `src/types/hmi-screen.ts`), which gets converted to WinCC XML via `hmi-xml-builder.ts`.

Keep this simple for the demo — basic layout, standard colors, text labels and indicators.

---

## TASK 9: TIA Export Orchestration
**Priority:** Critical for demo — this is the "it actually works" moment.
**File:** `src/hooks/use-forge-tia-export.ts` and `src/lib/forge-export.ts`

Orchestrate the full TIA import:

1. Build manifest from all approved artifacts (use `buildManifest()` from `manifest-builder.ts`)
2. SCL artifacts → bundle into zip, send to `/tia/jobs` (same as existing `useSubmitTiaJob`)
3. LAD artifacts → send to `/tia/import-lad` one at a time (same as `use-lad-import.ts`)
4. HMI artifacts → convert to XML via `buildScreenXml()`, send to `/tia/import-hmi`
5. Track progress via WebSocket (reuse `use-tia-bridge-ws.ts`)
6. Return compile results

### Hook interface:
```typescript
function useForgeTiaExport(): {
  exportAll: (session: ForgeSession, tiaProjectPath: string) => Promise<TiaExportResult>;
  loading: boolean;
  progress: { phase: "scl" | "lad" | "hmi" | "compile"; current: number; total: number };
  error: string | null;
}
```

---

## TASK 10: Wire Up Forge Prompts File
**Priority:** Do alongside tasks 4, 6, 7, 8.
**File:** `src/lib/forge-prompts.ts`

Central file for ALL wizard prompt builders. Structure:

```typescript
// Spec analysis
export function buildSpecAnalysisPrompt(specText: string): string;

// Device code (SCL path)  
export function buildDeviceSclPrompt(device: ForgeDeviceEntry, context: DeviceGenContext): string;

// Device code (LAD path)
export function buildDeviceLadPrompt(device: ForgeDeviceEntry, context: DeviceGenContext): string;

// IO linking FC
export function buildIoLinkingPrompt(devices: ForgeDeviceEntry[], ioList: ForgeIoEntry[]): string;

// Process code (SCL path)
export function buildProcessSclPrompt(sequence: ProcessSequence, context: ProcessGenContext): string;

// Process code (LAD path)
export function buildProcessLadPrompt(sequence: ProcessSequence, context: ProcessGenContext): string;

// HMI screens
export function buildHmiPrompt(devices: ForgeDeviceEntry[], theme: string): string;
```

Each prompt builder should:
- Include the profile's relevant rules section
- Include platform rules (from `ai/PLATFORM_RULES_SIEMENS_TIA.md`)
- Include active correction patterns (via existing `useActivePatterns` / `formatPatterns`)
- Include relevant reference library sections if available
- Specify the exact output format expected (SCL fenced blocks, JSON, etc.)

---

## TASK ORDER SUMMARY

Work in this order for maximum velocity:

1. **Task 1** — Migration (unblocks everything)
2. **Task 2** — Types (unblocks Codex immediately)
3. **Task 3** — Session hook (unblocks UI wiring)
4. **Task 4** — Spec analysis (the "wow" moment)
5. **Task 5** — Device matcher (quick, deterministic)
6. **Task 6** — Device code gen (core value)
7. **Task 7** — Process code gen (core value)
8. **Task 9** — TIA export (the "it actually works" moment)
9. **Task 8** — HMI gen (can be basic)
10. **Task 10** — Prompts file (built incrementally with 4, 6, 7, 8)
