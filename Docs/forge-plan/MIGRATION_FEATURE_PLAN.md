# Pac-Forge: S7-300/400 → S7-1500 Migration Feature — Implementation Plan

**Target audience:** Claude Code / Codex autonomous implementation  
**Codebase:** `pac-forge-master` (React + TypeScript + Vite + Zustand + Supabase + TIA Openness bridge)  
**Reference document:** Siemens Entry ID 109478811 — Guide for Migrating SIMATIC S7-300/S7-400 to S7-1500  

---

## 0. Read First — Architecture Context

Before writing any code, internalise these facts about the existing codebase:

- **Frontend:** React 18, TypeScript, Vite, TailwindCSS, shadcn/ui components
- **State:** Zustand stores (see `src/stores/`). Every major feature has its own store.
- **Data fetching:** TanStack Query (`@tanstack/react-query`) throughout. Mutations use `useMutation`, reads use `useQuery`.
- **AI calls:** All Claude API calls go through the Supabase edge function `supabase/functions/generate/index.ts`. The frontend calls this via `streamFromEdgeFunction` or `callNonStreaming` from `src/hooks/use-generation.ts`. **Do not call the Claude API directly from the frontend.**
- **TIA Bridge:** A local .NET REST service at `http://localhost:5102`. The contract is fully typed in `src/lib/tia-bridge-contract.ts`. The hook `useExportFromTia` (`src/hooks/use-export-from-tia.ts`) already calls `POST /tia/export-sources` which exports all PLC block source text from the open TIA Portal project. This is the read path — **no new bridge endpoints are needed for reading.**
- **Existing patterns to copy:**
  - Wizard + step bar: `src/routes/forge.tsx` + `src/components/forge/` + `src/stores/forge-store.ts` + `src/types/forge.ts`
  - Agent pipeline execution: `src/hooks/use-pipeline-generate.ts`
  - SCL block parsing: `src/lib/scl-block-parser.ts`
  - Bridge status checking: `useBridgeStatus` from `src/hooks/use-tia-jobs.ts`
  - TIA job submission: `useSubmitTiaJob` from `src/hooks/use-tia-jobs.ts`
- **Navigation:** Add items to `NAV_GROUPS` array in `src/app/DashboardLayout.tsx`
- **Routing:** Add lazy route in `src/App.tsx`

---

## 1. Overview — What We Are Building

A **7-step migration wizard** that:

1. **Connects** to the TIA bridge and reads all PLC source blocks from the open S7-300/400 project via `POST /tia/export-sources`
2. **Analyses** the exported blocks — agents produce a structured 7-step migration plan covering the exact issues found in *this* project's code
3. **Approves** — user reviews the plan step-by-step, can edit descriptions, approve or skip individual steps
4. **Transforms** — agents execute each approved step, rewriting blocks to be S7-1500 / TIA Portal V17+ compliant, producing a diff per block
5. **Reviews** — the Standards Reviewer agent validates all transformed blocks against `ai/PLATFORM_RULES_SIEMENS_TIA.md`
6. **Compiles** — the approved transformed blocks are imported into the open TIA Portal project via the existing `IMPORT_AND_COMPILE` job type, compile errors are shown inline
7. **Reports** — final migration report summarising all changes, with download option

---

## 2. Files to Create

```
supabase/migrations/032_migration_sessions.sql
src/types/migrate.ts
src/stores/migrate-store.ts
src/lib/migrate-prompts.ts
src/lib/migrate-pipeline.ts
src/hooks/use-migrate-session.ts
src/hooks/use-migrate-pipeline.ts
src/routes/migrate.tsx
src/components/migrate/migrate-step-bar.tsx        (thin wrapper — reuse ForgeStepBar internals)
src/components/migrate/steps/migrate-connect.tsx
src/components/migrate/steps/migrate-analyse.tsx
src/components/migrate/steps/migrate-approve-plan.tsx
src/components/migrate/steps/migrate-transform.tsx
src/components/migrate/steps/migrate-review.tsx
src/components/migrate/steps/migrate-compile.tsx
src/components/migrate/steps/migrate-report.tsx
```

---

## 3. Files to Modify

```
src/App.tsx                          — add lazy route /migrate
src/app/DashboardLayout.tsx          — add nav item "Migration Wizard" under Code Tools
supabase/functions/generate/index.ts — add "MIGRATION" to generation_mode union type
```

---

## 4. Database Migration

### `supabase/migrations/032_migration_sessions.sql`

```sql
-- Migration Wizard: migration_sessions table
-- Stores the full state of one S7-300/400 → S7-1500 migration run

CREATE TABLE migration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,

  -- Source project info (filled at Connect step)
  tia_project_path text,
  source_block_count int DEFAULT 0,

  -- Raw exported sources from bridge (filename → SCL/STL text)
  source_blocks jsonb DEFAULT '{}',        -- Record<string, string>

  -- Analysis output (filled at Analyse step)
  analysis_summary text,                   -- Free-text executive summary
  migration_plan jsonb DEFAULT '[]',       -- MigrationPlanStep[]

  -- Transformation output (filled at Transform step)
  transformed_blocks jsonb DEFAULT '[]',   -- MigratedBlock[]

  -- Review output (filled at Review step)
  review_findings jsonb DEFAULT '[]',      -- ReviewFinding[]

  -- Compile output (filled at Compile step)
  compile_result jsonb,                    -- CompileResult (from existing types)
  tia_job_id text,

  -- Final report
  report_markdown text,

  -- Step tracking
  current_step text NOT NULL DEFAULT 'connect',
  step_statuses jsonb DEFAULT '{
    "connect": "active",
    "analyse": "pending",
    "approve_plan": "pending",
    "transform": "pending",
    "review": "pending",
    "compile": "pending",
    "report": "pending"
  }',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_migration_sessions_project_id ON migration_sessions (project_id);
CREATE INDEX idx_migration_sessions_user_id ON migration_sessions (user_id);

CREATE OR REPLACE FUNCTION update_migration_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER migration_sessions_updated_at
  BEFORE UPDATE ON migration_sessions
  FOR EACH ROW EXECUTE FUNCTION update_migration_sessions_updated_at();

ALTER TABLE migration_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "migration_sessions_select_own" ON migration_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "migration_sessions_insert_own" ON migration_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "migration_sessions_update_own" ON migration_sessions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "migration_sessions_delete_own" ON migration_sessions
  FOR DELETE TO authenticated USING (user_id = auth.uid());
```

---

## 5. Types — `src/types/migrate.ts`

```typescript
// Migration wizard types

export const MIGRATE_STEPS = {
  CONNECT:      "connect",
  ANALYSE:      "analyse",
  APPROVE_PLAN: "approve_plan",
  TRANSFORM:    "transform",
  REVIEW:       "review",
  COMPILE:      "compile",
  REPORT:       "report",
} as const;

export type MigrateStep = (typeof MIGRATE_STEPS)[keyof typeof MIGRATE_STEPS];

export const MIGRATE_STEP_LABELS: Record<MigrateStep, string> = {
  connect:      "Connect & Read",
  analyse:      "Analyse",
  approve_plan: "Approve Plan",
  transform:    "Transform",
  review:       "Review",
  compile:      "Compile",
  report:       "Report",
};

export const MIGRATE_STEP_ORDER: MigrateStep[] = [
  "connect",
  "analyse",
  "approve_plan",
  "transform",
  "review",
  "compile",
  "report",
];

export type MigrateStepStatus = "pending" | "active" | "completed" | "failed";

// -------------------------------------------------------------------------
// Migration plan — produced by the Analyse step
// -------------------------------------------------------------------------

/** Severity of a migration issue found during analysis */
export type MigrationIssueSeverity = "BREAKING" | "WARNING" | "INFO";

/** A single action item within the migration plan */
export interface MigrationPlanStep {
  id: string;                         // e.g. "step_1", "step_2"
  title: string;                      // Short title shown in UI
  category: MigrationPlanCategory;
  severity: MigrationIssueSeverity;
  description: string;                // Full explanation of what needs doing
  affectedBlocks: string[];           // Block names this step touches
  approved: boolean;                  // User-approved before transform runs
  skipped: boolean;                   // User chose to skip
  userNote?: string;                  // Optional user modification note
}

export type MigrationPlanCategory =
  | "hardware_mapping"         // CPU/module replacement (Tables 7-1/7-2)
  | "deprecated_instructions"  // OV, MUTING, TWO_HAND, WR_FDB, etc.
  | "ob_restructure"           // OB100/101/102 → startup OBs, new priorities
  | "block_optimisation"       // non-optimised → optimised, 64-bit types
  | "data_type_upgrade"        // new data types: USInt, SInt, ULInt, VARIANT, etc.
  | "safety_program"           // F-CPU safety program special handling
  | "communication"            // MPI → no MPI, DP slave via CM/CP only
  | "symbolic_addressing"      // absolute addressing → symbolic
  | "naming_conventions"       // style guide alignment
  | "general";

// -------------------------------------------------------------------------
// Transformed blocks — produced by the Transform step
// -------------------------------------------------------------------------

export interface MigratedBlock {
  blockName: string;
  blockType: string;           // "FB" | "FC" | "OB" | "DB" | "UDT"
  originalSource: string;      // Original SCL/STL text
  transformedSource: string;   // Rewritten S7-1500 compliant SCL
  changesApplied: string[];    // Human-readable list of changes made
  planStepIds: string[];       // Which plan steps this transformation addresses
  approved: boolean;           // User approved this transformed block
}

// -------------------------------------------------------------------------
// Review findings — produced by the Review step
// -------------------------------------------------------------------------

export interface MigrationReviewFinding {
  severity: "CRITICAL" | "WARNING" | "INFO";
  blockName: string;
  description: string;
  resolved: boolean;
}

// -------------------------------------------------------------------------
// Session (mirrors DB table)
// -------------------------------------------------------------------------

export interface MigrationSession {
  id: string;
  project_id: string;
  user_id: string;
  tia_project_path: string | null;
  source_block_count: number;
  source_blocks: Record<string, string>;   // filename → source text
  analysis_summary: string | null;
  migration_plan: MigrationPlanStep[];
  transformed_blocks: MigratedBlock[];
  review_findings: MigrationReviewFinding[];
  compile_result: import("@/types").CompileResult | null;
  tia_job_id: string | null;
  report_markdown: string | null;
  current_step: MigrateStep;
  step_statuses: Record<MigrateStep, MigrateStepStatus>;
  created_at: string;
  updated_at: string;
}
```

Add `export * from "./migrate";` to `src/types/index.ts`.

---

## 6. Store — `src/stores/migrate-store.ts`

Model this exactly on `src/stores/forge-store.ts`. The store manages the wizard navigation and caches the current session data in memory to avoid prop drilling.

```typescript
import { create } from "zustand";
import { MIGRATE_STEP_ORDER } from "@/types/migrate";
import type { MigrateStep, MigrateStepStatus } from "@/types/migrate";

interface MigrateStoreState {
  currentStep: MigrateStep;
  stepStatuses: Record<MigrateStep, MigrateStepStatus>;

  // Cached read for the current session ID (avoids prop drilling)
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  // Agent running indicator for UI
  agentRunning: boolean;
  agentName: string | null;
  setAgentRunning: (running: boolean, name?: string | null) => void;

  // Streaming content for live display during agent runs
  streamingContent: string | null;
  appendStreamChunk: (chunk: string) => void;
  clearStreaming: () => void;

  // Navigation
  setCurrentStep: (step: MigrateStep) => void;
  setStepStatus: (step: MigrateStep, status: MigrateStepStatus) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  canProceedToNext: () => boolean;

  reset: () => void;
}

const createInitialStatuses = (): Record<MigrateStep, MigrateStepStatus> => ({
  connect:      "active",
  analyse:      "pending",
  approve_plan: "pending",
  transform:    "pending",
  review:       "pending",
  compile:      "pending",
  report:       "pending",
});

export const useMigrateStore = create<MigrateStoreState>((set, get) => ({
  currentStep: "connect",
  stepStatuses: createInitialStatuses(),
  sessionId: null,
  agentRunning: false,
  agentName: null,
  streamingContent: null,

  setSessionId: (id) => set({ sessionId: id }),

  setAgentRunning: (running, name = null) =>
    set({ agentRunning: running, agentName: running ? name : null }),

  appendStreamChunk: (chunk) =>
    set((s) => ({ streamingContent: (s.streamingContent ?? "") + chunk })),

  clearStreaming: () => set({ streamingContent: null }),

  setCurrentStep: (step) =>
    set((state) => {
      const nextStatuses = { ...state.stepStatuses };
      if (nextStatuses[step] === "pending") nextStatuses[step] = "active";
      if (nextStatuses[state.currentStep] === "active") nextStatuses[state.currentStep] = "pending";
      return { currentStep: step, stepStatuses: nextStatuses };
    }),

  setStepStatus: (step, status) =>
    set((state) => ({
      stepStatuses: { ...state.stepStatuses, [step]: status },
    })),

  goToNextStep: () => {
    const { currentStep, setCurrentStep, setStepStatus } = get();
    const idx = MIGRATE_STEP_ORDER.indexOf(currentStep);
    if (idx < MIGRATE_STEP_ORDER.length - 1) {
      setStepStatus(currentStep, "completed");
      setCurrentStep(MIGRATE_STEP_ORDER[idx + 1]);
    }
  },

  goToPreviousStep: () => {
    const { currentStep, setCurrentStep } = get();
    const idx = MIGRATE_STEP_ORDER.indexOf(currentStep);
    if (idx > 0) setCurrentStep(MIGRATE_STEP_ORDER[idx - 1]);
  },

  canProceedToNext: () => {
    const { currentStep, stepStatuses } = get();
    return stepStatuses[currentStep] === "completed";
  },

  reset: () =>
    set({
      currentStep: "connect",
      stepStatuses: createInitialStatuses(),
      sessionId: null,
      agentRunning: false,
      agentName: null,
      streamingContent: null,
    }),
}));
```

---

## 7. Supabase Hooks — `src/hooks/use-migrate-session.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MigrationSession, MigrationPlanStep, MigratedBlock, MigrationReviewFinding } from "@/types";
import type { CompileResult } from "@/types";

const KEY = (id: string | null | undefined) => ["migration-session", id] as const;

export function useMigrationSession(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: KEY(sessionId),
    queryFn: async (): Promise<MigrationSession> => {
      const { data, error } = await supabase
        .from("migration_sessions")
        .select("*")
        .eq("id", sessionId!)
        .single();
      if (error) throw error;
      return data as MigrationSession;
    },
    enabled: !!sessionId,
  });
}

export function useCreateMigrationSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string): Promise<MigrationSession> => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("migration_sessions")
        .insert({ project_id: projectId, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as MigrationSession;
    },
    onSuccess: (data) => {
      qc.setQueryData(KEY(data.id), data);
    },
  });
}

export function useUpdateMigrationSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<MigrationSession>;
    }): Promise<MigrationSession> => {
      const { data, error } = await supabase
        .from("migration_sessions")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as MigrationSession;
    },
    onSuccess: (data) => {
      qc.setQueryData(KEY(data.id), data);
      qc.invalidateQueries({ queryKey: KEY(data.id) });
    },
  });
}
```

---

## 8. Agent Prompts — `src/lib/migrate-prompts.ts`

This is the most important file. It encodes all the migration knowledge from the Siemens manual. Write it in full — do not stub or truncate.

### 8.1 Constants — CPU mapping table (from manual Tables 7-1 and 7-2)

```typescript
// Hard-coded from Siemens Entry ID 109478811, Tables 7-1 and 7-2
export const CPU_MAPPING_TABLE = `
## S7-300 → S7-1500 CPU Mapping (for reference)

| S7-300 CPU         | S7-1500 Replacement        |
|--------------------|----------------------------|
| CPU 312            | CPU 1511-1 PN              |
| CPU 313C / 313C-2  | CPU 1511C-1 PN             |
| CPU 314 / 314C     | CPU 1511-1 PN / 1512C      |
| CPU 315-2 DP/PN    | CPU 1513-1 PN / 1515-2 PN  |
| CPU 317-2          | CPU 1516-3 PN/DP           |
| CPU 319-3 PN/DP    | CPU 1517-3 PN/DP           |
| CPU 315F / 317F    | CPU 1513F / 1515F / 1516F  |

## S7-400 → S7-1500 CPU Mapping

| S7-400 CPU         | S7-1500 Replacement        |
|--------------------|----------------------------|
| CPU 412            | CPU 1513-1 PN              |
| CPU 414-2/3        | CPU 1515-2 PN / 1516-3     |
| CPU 416-2/3        | CPU 1518-4 PN/DP           |
| CPU 417-4          | CPU 1518-4 PN/DP           |
| CPU 414F/416F      | CPU 1515F / 1518F          |
`;
```

### 8.2 Prompt: Analysis agent (Step 2)

```typescript
export function buildMigrationAnalysisPrompt(
  sourceBlocks: Record<string, string>
): { systemPrompt: string; userMessage: string } {
  const blockSummary = Object.entries(sourceBlocks)
    .map(([name, src]) => {
      const lines = src.split("\n").length;
      const preview = src.split("\n").slice(0, 3).join(" | ");
      return `- **${name}** (${lines} lines): ${preview}`;
    })
    .join("\n");

  const systemPrompt = `You are a Siemens SIMATIC migration expert performing a code analysis for the migration of an S7-300/S7-400 project to the S7-1500 platform using TIA Portal V17+.

Your task is to analyse the exported PLC block sources and produce a structured 7-step migration plan as a JSON array.

${CPU_MAPPING_TABLE}

## Known Breaking Changes You Must Detect

### 1. Deprecated Instructions (S7-1500 does NOT support)
Scan for: OV, MUTING, TWO_HAND, WR_FDB, RD_FDB, OPN, SENDS7, RCVS7
These MUST be removed and replaced. Flag as BREAKING.

### 2. OB Restructuring Required
- OB100 (warm restart), OB101 (restart), OB102 (cold start — S7-400 only) → all map to startup OBs on S7-1500 (OB100 or range 123+)
- S7-1500 always performs warm restart — OB101/OB102 logic must be consolidated into a single startup OB
- MPI interface used in OBs → no MPI on S7-1500; replace with PROFINET logic
- Flag any OB with absolute address references as WARNING

### 3. DP Slave Mode
- S7-1500 cannot be a DP slave via its integrated interface — only via CM/CP modules
- If project uses the CPU as a DP slave, flag as BREAKING

### 4. Block Optimisation
- Non-optimised blocks (using absolute byte offsets like DB1.DBW4) → must convert to symbolic access
- S7-300/400 DBs are limited to 64KB; S7-1500 optimised DBs support up to 10MB — opportunity to restructure
- Flag absolute addressing (DBx.DBBx, DBx.DBWx, DBx.DBDx, DBx.DBXx.x) as WARNING

### 5. Data Type Upgrades Available
- INT → consider DINT/LINT for wider ranges
- REAL → consider LREAL for precision
- New types available: USInt, SInt, UInt, UDInt, ULInt, LInt, LWord, LReal
- Flag as INFO (opportunities, not blockers)

### 6. Absolute I/O Addressing
- S7-1500 strongly prefers symbolic addressing
- Absolute I/O like I0.0, Q1.3, IW2, QW4 in program logic (not tag tables) should be symbolic
- Flag uses inside FBs/FCs/OBs as WARNING

### 7. Timer / Counter Syntax
- S7 timers (T0..T511 with S5TIME) → prefer IEC timers (TON, TOF, TP) on S7-1500 for performance
- S7 counters (C0..C511) → prefer IEC counters (CTU, CTD, CTUD)
- Flag legacy timer/counter usage as WARNING

### 8. Communication Blocks
- SFB/SFC calls specific to S7-300/400 (e.g. SFB8 USEND, SFB9 URCV, SFB12 BSEND, SFB13 BRCV) → replaced by new TSEND_C, TRCV_C, PUT, GET pattern
- Flag as BREAKING if found

### 9. Safety Program (F-CPU)
- F_GLOBDB.VKE0/1 → replace with FALSE/TRUE literals on S7-1500
- QBAD_I_xx / QBAD_O_xx → replace with value status on S7-1500
- F runtime group communication → restructure F runtime groups
- I/O DB naming changes automatically on migration
- Flag as BREAKING if F-blocks detected

## Output Format

Respond with ONLY a valid JSON object in this exact structure — no markdown, no preamble:

{
  "summary": "A 3-5 sentence plain English executive summary of migration complexity and key risks.",
  "steps": [
    {
      "id": "step_1",
      "title": "Short imperative title",
      "category": "one of: hardware_mapping | deprecated_instructions | ob_restructure | block_optimisation | data_type_upgrade | safety_program | communication | symbolic_addressing | naming_conventions | general",
      "severity": "BREAKING | WARNING | INFO",
      "description": "Full explanation of what needs to be done and why. Be specific — reference actual block names found in the code.",
      "affectedBlocks": ["BlockName1", "BlockName2"]
    }
  ]
}

Generate between 5 and 9 steps. Order by severity (BREAKING first, then WARNING, then INFO).
Only include a step if you actually found evidence of that issue in the source code.
If you find no BREAKING issues, still produce at least 3 WARNING/INFO steps.`;

  const userMessage = `Analyse the following exported PLC blocks from an S7-300/400 project and produce the migration plan JSON.

## Exported Blocks Summary
${blockSummary}

## Full Block Sources

${Object.entries(sourceBlocks)
  .map(([name, src]) => `### ${name}\n\`\`\`scl\n${src}\n\`\`\``)
  .join("\n\n")}`;

  return { systemPrompt, userMessage };
}
```

### 8.3 Prompt: Transform agent (Step 4)

```typescript
export function buildMigrationTransformPrompt(
  planStep: MigrationPlanStep,
  blocksToTransform: Record<string, string>,  // blockName → source
  platformRules: string
): { systemPrompt: string; userMessage: string } {

  const systemPrompt = `You are a Siemens SIMATIC code migration specialist. You are executing migration step "${planStep.id}: ${planStep.title}" for an S7-300/400 → S7-1500 migration project.

## What You Must Do
${planStep.description}

## S7-1500 Platform Rules (MANDATORY)
${platformRules}

${CPU_MAPPING_TABLE}

## Transformation Rules by Category

### deprecated_instructions
- Remove OV, MUTING, TWO_HAND, WR_FDB, RD_FDB, OPN, SENDS7, RCVS7 instructions entirely
- Add a comment in the code: // MIGRATION: <InstructionName> removed — not supported on S7-1500. Equivalent: <suggestion>
- For SENDS7/RCVS7: replace with TSEND_C / TRCV_C pattern (use placeholder if parameters are unclear)

### ob_restructure
- Merge OB100, OB101, OB102 content into a single ORGANIZATION_BLOCK "OB_Startup" or OB100
- Add comment: // MIGRATION: Merged from OB<n> — S7-1500 always warm-starts
- Remove any OB101/OB102 blocks from output (they are not valid on S7-1500)
- Remove MPI-specific startup logic; add comment explaining replacement needed

### block_optimisation
- Replace all absolute DB addressing (DB1.DBW4, DB1.DBX0.0 etc.) with symbolic equivalents
- Use the declared variable names from the DB interface instead
- If the symbolic name cannot be determined from context, use a placeholder: // MIGRATION: replace DB<n>.DB<type><offset> with symbolic name

### symbolic_addressing
- Replace absolute I/O addresses used inside FB/FC/OB bodies (not tag definitions) with symbolic tag references
- Prefix the symbolic name with the tag table convention from the existing code
- Add comment: // MIGRATION: was %I0.0 — assign PLC tag

### data_type_upgrade (INFO only — apply conservatively)
- Upgrade S5TIME literals to TIME equivalents: S5T#5s → T#5s
- Do NOT aggressively change INT → DINT unless the plan step explicitly says so

### communication
- Replace SFB8/USEND with TSEND_C stub
- Replace SFB9/URCV with TRCV_C stub
- Replace SFC14/DPRD_DAT, SFC15/DPWR_DAT with RDREC/WRREC
- Always add comment: // MIGRATION: was <OldBlock> — rewired to <NewBlock>

### safety_program
- Replace F_GLOBDB.VKE0 with FALSE
- Replace F_GLOBDB.VKE1 with TRUE
- Add comment on every replacement: // MIGRATION: F_GLOBDB replaced per S7-1500 requirements

## Output Format

For each transformed block output a section in this EXACT format (do not use any other format):

[BLOCK_START:BlockName]
[CHANGES]
- Brief description of change 1
- Brief description of change 2
[/CHANGES]
[SOURCE]
<complete transformed SCL source for this block>
[/SOURCE]
[BLOCK_END:BlockName]

Output ALL blocks listed below, even if no changes were needed for a particular block (output it unchanged with [CHANGES] - No changes required [/CHANGES]).`;

  const blockSources = Object.entries(blocksToTransform)
    .map(([name, src]) => `### ${name}\n\`\`\`scl\n${src}\n\`\`\``)
    .join("\n\n");

  const userMessage = `Execute migration step "${planStep.id}: ${planStep.title}".

Affected blocks: ${planStep.affectedBlocks.join(", ")}

## Block Sources to Transform

${blockSources}`;

  return { systemPrompt, userMessage };
}
```

### 8.4 Prompt: Review agent (Step 5)

```typescript
export function buildMigrationReviewPrompt(
  transformedBlocks: MigratedBlock[],
  platformRules: string
): { systemPrompt: string; userMessage: string } {

  const systemPrompt = `You are a Standards Reviewer performing a post-migration code review.
The blocks below have been transformed from S7-300/400 to S7-1500 SCL.
Your job is to identify any remaining issues that would prevent compilation or violate TIA Portal V17+ standards.

## Platform Rules
${platformRules}

## What To Check
1. CASE labels must be integer literals — CRITICAL if not
2. CASE must have ELSE branch — CRITICAL if missing
3. Instance DBs required for every FB call — CRITICAL if missing
4. FB calls use instance DB name only (e.g. "InstMotor1"(...)) — CRITICAL if wrong syntax
5. Timers/Counters/R_TRIG/F_TRIG must be in VAR (not VAR_TEMP) — CRITICAL
6. Type conversions must be explicit (INT_TO_REAL, etc.) — CRITICAL if implicit
7. # prefix on local variables in SCL — CRITICAL if missing
8. All FB parameters wired in calls — CRITICAL if missing  
9. S5TIME anywhere in code — WARNING (should be TIME / T#...)
10. Absolute DB addressing remaining (DB1.DBW4 pattern) — WARNING
11. OB101 or OB102 still present — CRITICAL (not valid on S7-1500)
12. Deprecated instructions still present (OV, MUTING, TWO_HAND, etc.) — CRITICAL
13. MIGRATION placeholder comments present — INFO (manual follow-up required)

## Output Format
List every finding using EXACTLY this format (one per line):
[FINDING:CRITICAL] BlockName | Description
[FINDING:WARNING] BlockName | Description
[FINDING:INFO] BlockName | Description

After all findings:
[REVIEW_COMPLETE]

If no issues found:
NO_ISSUES: All transformed blocks pass review.
[REVIEW_COMPLETE]`;

  const blockText = transformedBlocks
    .map((b) => `### ${b.blockName} (${b.blockType})\n\`\`\`scl\n${b.transformedSource}\n\`\`\``)
    .join("\n\n");

  const userMessage = `Review the following post-migration blocks:\n\n${blockText}`;

  return { systemPrompt, userMessage };
}
```

### 8.5 Prompt: Report agent (Step 7)

```typescript
export function buildMigrationReportPrompt(
  session: MigrationSession
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are a technical writer producing a migration completion report.
Write a professional Markdown report summarising the completed S7-300/400 → S7-1500 migration.
Include: executive summary, migration plan steps completed/skipped, transformation summary per block (changes applied), review findings resolved, compile result, and any manual follow-up actions required (MIGRATION placeholder comments).
Be concise and factual. Use tables where appropriate.`;

  const userMessage = `Produce the migration report for this session:

## Analysis Summary
${session.analysis_summary ?? "N/A"}

## Migration Plan Steps
${session.migration_plan.map((s) =>
  `- [${s.skipped ? "SKIPPED" : s.approved ? "DONE" : "PENDING"}] ${s.id}: ${s.title} (${s.severity})`
).join("\n")}

## Transformed Blocks (${session.transformed_blocks.length})
${session.transformed_blocks.map((b) =>
  `### ${b.blockName}\nChanges: ${b.changesApplied.join("; ") || "None"}`
).join("\n\n")}

## Review Findings
${session.review_findings.length === 0
  ? "No findings — all blocks passed review."
  : session.review_findings.map((f) =>
      `- [${f.severity}] ${f.blockName}: ${f.description}`
    ).join("\n")}

## Compile Result
${session.compile_result ? JSON.stringify(session.compile_result, null, 2) : "Not compiled yet."}`;

  return { systemPrompt, userMessage };
}
```

---

## 9. Pipeline Hook — `src/hooks/use-migrate-pipeline.ts`

This hook orchestrates all agent calls for the migration wizard. Model it on `use-pipeline-generate.ts` but simpler — no review/rewrite loop, each step is linear.

```typescript
import { useCallback } from "react";
import { useMigrateStore } from "@/stores/migrate-store";
import { useUpdateMigrationSession } from "@/hooks/use-migrate-session";
import {
  buildMigrationAnalysisPrompt,
  buildMigrationTransformPrompt,
  buildMigrationReviewPrompt,
  buildMigrationReportPrompt,
} from "@/lib/migrate-prompts";
import { callNonStreaming } from "@/hooks/use-generation";
import type { MigrationSession, MigrationPlanStep, MigratedBlock, MigrationReviewFinding } from "@/types";
import { supabase } from "@/lib/supabase";

// Fetch platform rules text at runtime from the Supabase storage or hardcode path
// For now: import from the known location bundled with the app
import PLATFORM_RULES from "@/ai/PLATFORM_RULES_SIEMENS_TIA.md?raw";

/**
 * Parses the analysis JSON from agent response.
 * Strips any markdown fences if present.
 */
function parseAnalysisResponse(raw: string): {
  summary: string;
  steps: Omit<MigrationPlanStep, "approved" | "skipped" | "userNote">[];
} {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Parses the transform agent response into MigratedBlock[].
 */
function parseTransformResponse(
  raw: string,
  planStep: MigrationPlanStep,
  originalBlocks: Record<string, string>
): MigratedBlock[] {
  const blocks: MigratedBlock[] = [];
  const blockRegex =
    /\[BLOCK_START:(.+?)\]([\s\S]*?)\[BLOCK_END:\1\]/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(raw)) !== null) {
    const blockName = match[1].trim();
    const body = match[2];

    const changesMatch = body.match(/\[CHANGES\]([\s\S]*?)\[\/CHANGES\]/);
    const sourceMatch = body.match(/\[SOURCE\]([\s\S]*?)\[\/SOURCE\]/);

    const changesText = changesMatch?.[1].trim() ?? "";
    const changes = changesText
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 0 && l !== "No changes required");

    const transformedSource = sourceMatch?.[1].trim() ?? "";

    blocks.push({
      blockName,
      blockType: inferBlockTypeFromSource(transformedSource),
      originalSource: originalBlocks[blockName] ?? "",
      transformedSource,
      changesApplied: changes,
      planStepIds: [planStep.id],
      approved: false,
    });
  }

  return blocks;
}

function inferBlockTypeFromSource(src: string): string {
  if (/^FUNCTION_BLOCK\b/im.test(src)) return "FB";
  if (/^FUNCTION\b/im.test(src)) return "FC";
  if (/^ORGANIZATION_BLOCK\b/im.test(src)) return "OB";
  if (/^DATA_BLOCK\b/im.test(src)) return "DB";
  if (/^TYPE\b/im.test(src)) return "UDT";
  return "UNKNOWN";
}

/**
 * Parses review agent response into MigrationReviewFinding[].
 */
function parseReviewResponse(raw: string): MigrationReviewFinding[] {
  const findings: MigrationReviewFinding[] = [];
  const regex = /\[FINDING:(CRITICAL|WARNING|INFO)\]\s+(.+?)\s*\|\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    findings.push({
      severity: match[1] as "CRITICAL" | "WARNING" | "INFO",
      blockName: match[2].trim(),
      description: match[3].trim(),
      resolved: false,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useMigratePipeline() {
  const store = useMigrateStore;
  const { mutateAsync: updateSession } = useUpdateMigrationSession();

  /**
   * Step 2: Run the analysis agent against exported source blocks.
   */
  const runAnalysis = useCallback(
    async (session: MigrationSession) => {
      store.getState().setAgentRunning(true, "Migration Analyst");
      store.getState().clearStreaming();

      try {
        const { systemPrompt, userMessage } = buildMigrationAnalysisPrompt(
          session.source_blocks
        );

        const raw = await callNonStreaming({
          systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          generationMode: "MIGRATION",
          maxTokens: 8192,
        });

        const parsed = parseAnalysisResponse(raw);

        const planSteps: MigrationPlanStep[] = parsed.steps.map((s) => ({
          ...s,
          approved: false,
          skipped: false,
          userNote: undefined,
        }));

        await updateSession({
          id: session.id,
          patch: {
            analysis_summary: parsed.summary,
            migration_plan: planSteps,
            current_step: "approve_plan",
          },
        });

        store.getState().goToNextStep(); // analyse → approve_plan
      } finally {
        store.getState().setAgentRunning(false);
      }
    },
    [updateSession]
  );

  /**
   * Step 4: Run transform agent for each approved plan step.
   * Processes steps sequentially; accumulates transformed blocks.
   */
  const runTransform = useCallback(
    async (session: MigrationSession) => {
      const approvedSteps = session.migration_plan.filter(
        (s) => s.approved && !s.skipped
      );

      let allTransformed: MigratedBlock[] = [...session.transformed_blocks];

      for (const step of approvedSteps) {
        store.getState().setAgentRunning(true, `Transformer — ${step.title}`);

        // Collect the blocks needed for this step
        const blocksForStep: Record<string, string> = {};
        for (const blockName of step.affectedBlocks) {
          // Use latest transformed version if available, else original
          const alreadyTransformed = allTransformed.find(
            (b) => b.blockName === blockName
          );
          blocksForStep[blockName] = alreadyTransformed
            ? alreadyTransformed.transformedSource
            : (session.source_blocks[blockName] ?? "// Block source not found");
        }

        const { systemPrompt, userMessage } = buildMigrationTransformPrompt(
          step,
          blocksForStep,
          PLATFORM_RULES
        );

        const raw = await callNonStreaming({
          systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          generationMode: "MIGRATION",
          maxTokens: 16384,
        });

        const newBlocks = parseTransformResponse(raw, step, session.source_blocks);

        // Merge: update existing entries or append new ones
        for (const nb of newBlocks) {
          const idx = allTransformed.findIndex((b) => b.blockName === nb.blockName);
          if (idx >= 0) {
            allTransformed[idx] = {
              ...nb,
              // Preserve previously applied changes from earlier steps
              changesApplied: [
                ...allTransformed[idx].changesApplied,
                ...nb.changesApplied,
              ],
              planStepIds: [
                ...allTransformed[idx].planStepIds,
                ...nb.planStepIds,
              ],
            };
          } else {
            allTransformed.push(nb);
          }
        }

        // Persist after each step so progress is not lost
        await updateSession({
          id: session.id,
          patch: { transformed_blocks: allTransformed },
        });
      }

      await updateSession({
        id: session.id,
        patch: {
          transformed_blocks: allTransformed,
          current_step: "review",
        },
      });

      store.getState().setAgentRunning(false);
      store.getState().goToNextStep(); // transform → review
    },
    [updateSession]
  );

  /**
   * Step 5: Run the review agent on all transformed blocks.
   */
  const runReview = useCallback(
    async (session: MigrationSession) => {
      store.getState().setAgentRunning(true, "Standards Reviewer");

      try {
        const { systemPrompt, userMessage } = buildMigrationReviewPrompt(
          session.transformed_blocks,
          PLATFORM_RULES
        );

        const raw = await callNonStreaming({
          systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          generationMode: "MIGRATION",
          maxTokens: 8192,
        });

        const findings = parseReviewResponse(raw);

        await updateSession({
          id: session.id,
          patch: {
            review_findings: findings,
            current_step: "compile",
          },
        });

        store.getState().goToNextStep(); // review → compile
      } finally {
        store.getState().setAgentRunning(false);
      }
    },
    [updateSession]
  );

  /**
   * Step 7: Run the report agent.
   */
  const runReport = useCallback(
    async (session: MigrationSession) => {
      store.getState().setAgentRunning(true, "Report Writer");

      try {
        const { systemPrompt, userMessage } = buildMigrationReportPrompt(session);

        const raw = await callNonStreaming({
          systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          generationMode: "MIGRATION",
          maxTokens: 4096,
        });

        await updateSession({
          id: session.id,
          patch: {
            report_markdown: raw,
            current_step: "report",
          },
        });

        store.getState().goToNextStep(); // compile → report
      } finally {
        store.getState().setAgentRunning(false);
      }
    },
    [updateSession]
  );

  return { runAnalysis, runTransform, runReview, runReport };
}
```

**IMPORTANT:** `callNonStreaming` in `src/hooks/use-generation.ts` must be updated to accept `generationMode: "MIGRATION"`. Also update `supabase/functions/generate/index.ts` to include `"MIGRATION"` in the `generation_mode` union — it does not require any special behaviour, just add it to the type.

---

## 10. Step Components

Each step component receives `session: MigrationSession` as a prop and has access to `useMigrateStore` and `useMigratePipeline`.

### 10.1 `migrate-connect.tsx`

**Responsibilities:**
- Show bridge connection status (reuse `useBridgeStatus`)
- Input field for TIA project path (pre-fill from last used path if available)
- "Read Project Blocks" button → calls `useExportFromTia` mutation
- On success: calls `updateSession` with `source_blocks` and `source_block_count`, then advances to Analyse
- Shows a list of exported block names with type badges after successful read
- Error state if bridge is offline or export fails

**Key imports:** `useBridgeStatus`, `useExportFromTia`, `useUpdateMigrationSession`

**UI elements:** Connection status badge (green/amber/red dot), block count summary card, scrollable list of block names, "Read Blocks" button, "Continue to Analyse" button (only enabled after blocks are loaded).

### 10.2 `migrate-analyse.tsx`

**Responsibilities:**
- Shows "Run Analysis" button
- On click: calls `runAnalysis(session)` from `useMigratePipeline`
- While running: show animated agent avatar + streaming indicator (display `store.streamingContent` if available, else a spinner with agent name)
- On completion: auto-advances to Approve Plan step (store does this)
- Show `session.analysis_summary` as a card if analysis is already done (re-run option available)

### 10.3 `migrate-approve-plan.tsx`

**Responsibilities:**
- Renders `session.migration_plan` as a list of cards
- Each card shows: step number, title, severity badge (BREAKING=red, WARNING=amber, INFO=blue), category badge, description, affected blocks list
- Each card has: "Approve" toggle (checkbox), "Skip" toggle, editable note textarea
- "Approve All BREAKING" quick action button
- Running total: "X of Y steps approved"
- "Proceed to Transform" button — enabled only when at least 1 step is approved and no BREAKING steps are unapproved (or user explicitly skips them all)
- On proceed: calls `updateSession` with updated `migration_plan` array (with `approved`/`skipped` flags)
- Warn user if they skip BREAKING steps: show AlertDialog "Skipping BREAKING steps may result in compile errors. Proceed?"

### 10.4 `migrate-transform.tsx`

**Responsibilities:**
- Summary of approved steps to execute
- "Run Transformation" button
- Progress indicator: shows current step being processed ("Executing step 2 of 5: Deprecated Instructions")
- After completion: show transformed block list with diff viewer
  - For each transformed block: accordion card with block name, changes applied list, side-by-side diff (use `computeDiff` from `src/lib/diff-engine.ts`)
  - "Approve Block" checkbox on each transformed block
  - "Approve All" bulk action
- "Proceed to Review" button — enabled when all transformed blocks are approved

### 10.5 `migrate-review.tsx`

**Responsibilities:**
- "Run Review" button
- Shows `session.review_findings` grouped by severity
- CRITICAL findings shown with red badge — user must acknowledge each one
- WARNING/INFO findings shown as collapsible list
- Option to manually edit a transformed block's source in a Monaco editor (inline or modal) to fix CRITICAL issues before compile
- "Proceed to Compile" button — if CRITICAL findings exist, show warning "X critical findings remain. Compile anyway?" AlertDialog

### 10.6 `migrate-compile.tsx`

**Responsibilities:**
- Shows list of transformed blocks to be imported (those with `approved: true`)
- TIA project path field (pre-filled from session)
- "Import & Compile" button → calls `useSubmitTiaJob` with `job_type: "IMPORT_AND_COMPILE"`
  - Build manifest from transformed blocks using `buildManifest` from `src/lib/manifest-builder.ts`
  - Artifact bundle: zip of transformed block sources
- Live compile progress via `useTiaBridgeWs` (already exists)
- On completion: calls `updateSession` with `compile_result` and `tia_job_id`
- Compile errors shown inline with block name and line number
- "Proceed to Report" button

**Manifest building:** The manifest for migration jobs should set `destination_folder: "Pac-Migration"` for all blocks. Block type determines the artifact type field.

### 10.7 `migrate-report.tsx`

**Responsibilities:**
- "Generate Report" button → calls `runReport(session)` 
- Renders `session.report_markdown` using a Markdown renderer (install `react-markdown` if not already present, or use `prose` class with dangerouslySetInnerHTML — check existing usage in codebase first)
- "Download Report" button → triggers browser download of the markdown as `.md` file
- "Start New Migration" button → calls `store.reset()` and navigates to `/migrate`
- Summary stats cards: blocks analysed, steps executed, findings resolved, compile result badge

---

## 11. Route — `src/routes/migrate.tsx`

Model on `src/routes/forge.tsx`. Key structure:

```typescript
export default function MigratePage() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") ?? undefined;

  const currentStep = useMigrateStore((s) => s.currentStep);
  const stepStatuses = useMigrateStore((s) => s.stepStatuses);
  const goToNextStep = useMigrateStore((s) => s.goToNextStep);
  const goToPreviousStep = useMigrateStore((s) => s.goToPreviousStep);
  const setCurrentStep = useMigrateStore((s) => s.setCurrentStep);
  const setSessionId = useMigrateStore((s) => s.setSessionId);
  const sessionId = useMigrateStore((s) => s.sessionId);

  const { mutateAsync: createSession } = useCreateMigrationSession();
  const { data: session } = useMigrationSession(sessionId);
  const { mutateAsync: updateSession } = useUpdateMigrationSession();

  // Auto-create session if none exists
  useEffect(() => {
    if (!sessionId && projectId) {
      createSession(projectId).then((s) => setSessionId(s.id));
    }
  }, [sessionId, projectId, createSession, setSessionId]);

  // Restore step from session on page load
  useEffect(() => {
    if (session && currentStep !== session.current_step) {
      setCurrentStep(session.current_step as MigrateStep);
    }
  }, [session?.current_step]);

  const renderCurrentStep = () => {
    if (!session) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin h-8 w-8" /></div>;
    switch (currentStep) {
      case "connect":      return <MigrateConnect session={session} />;
      case "analyse":      return <MigrateAnalyse session={session} />;
      case "approve_plan": return <MigrateApprovePlan session={session} />;
      case "transform":    return <MigrateTransform session={session} />;
      case "review":       return <MigrateReview session={session} />;
      case "compile":      return <MigrateCompile session={session} />;
      case "report":       return <MigrateReport session={session} />;
    }
  };

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Migration Wizard</h1>
          <p className="text-sm text-muted-foreground">S7-300/400 → S7-1500 software migration</p>
        </div>
        {/* Bridge status indicator — reuse BridgeStatusIndicator pattern */}
      </div>

      {/* Step bar — reuse ForgeStepBar component directly */}
      <ForgeStepBar
        steps={MIGRATE_STEP_ORDER as unknown as ForgeStep[]}
        currentStep={currentStep as unknown as ForgeStep}
        stepStatuses={stepStatuses as unknown as Record<ForgeStep, ForgeStepStatus>}
        onStepClick={(step) => setCurrentStep(step as unknown as MigrateStep)}
      />

      {/* Step content */}
      <div className="flex-1 min-h-0">
        {renderCurrentStep()}
      </div>

      {/* Nav buttons */}
      <div className="flex items-center justify-between border-t pt-3">
        <Button
          variant="outline"
          onClick={goToPreviousStep}
          disabled={currentStep === "connect"}
        >
          <ChevronLeft /> Back
        </Button>
        <Button
          onClick={goToNextStep}
          disabled={!useMigrateStore.getState().canProceedToNext()}
        >
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
```

**Note on ForgeStepBar reuse:** `ForgeStepBar` uses `ForgeStep` and `ForgeStepStatus` types. Since our types are structurally identical strings, casting with `as unknown as` is sufficient. Alternatively, make `ForgeStepBar` generic — but the cast is simpler and avoids touching the Forge components.

---

## 12. App.tsx Changes

Add to lazy imports:
```typescript
const MigratePage = lazy(() => import("@/routes/migrate"));
```

Add to router children:
```typescript
{ path: "migrate", element: <LazyRoute><MigratePage /></LazyRoute> },
```

---

## 13. DashboardLayout.tsx Changes

In the `NAV_GROUPS` array, under the `"Code Tools"` group, add:
```typescript
{ to: "/migrate", label: "Migration Wizard", icon: ArrowRightLeft },
```

Import `ArrowRightLeft` from `lucide-react`.

---

## 14. Edge Function Changes — `supabase/functions/generate/index.ts`

Update the `generation_mode` union type on line 42:
```typescript
generation_mode?: "FB_PER_DEVICE" | "PROJECT_LEVEL" | "PROCESS_CODE" | "FB_BUILDER" | "MIGRATION";
```

No other logic change required — the edge function passes the mode through for logging purposes only.

---

## 15. Vite Config — Raw File Import

The `migrate-prompts.ts` file imports the platform rules as raw text:
```typescript
import PLATFORM_RULES from "@/ai/PLATFORM_RULES_SIEMENS_TIA.md?raw";
```

Vite supports `?raw` imports natively. No config change needed. However, add the type declaration to `src/vite-env.d.ts` (or create it if it doesn't exist):
```typescript
declare module "*.md?raw" {
  const content: string;
  export default content;
}
```

---

## 16. `use-generation.ts` — `callNonStreaming` signature

Find `callNonStreaming` in `src/hooks/use-generation.ts`. Ensure its `generationMode` parameter accepts `"MIGRATION"`. If the type is a string literal union, add `"MIGRATION"` to it. If it's just `string`, no change needed.

---

## 17. Implementation Order

Execute in this order to avoid broken imports at each stage:

1. `supabase/migrations/032_migration_sessions.sql` — run migration first
2. `src/types/migrate.ts` + update `src/types/index.ts`
3. `src/stores/migrate-store.ts`
4. `src/lib/migrate-prompts.ts`
5. `src/hooks/use-migrate-session.ts`
6. `src/hooks/use-migrate-pipeline.ts`
7. Step components (all 7, in order)
8. `src/routes/migrate.tsx`
9. `src/App.tsx` (add route)
10. `src/app/DashboardLayout.tsx` (add nav item)
11. `supabase/functions/generate/index.ts` (add MIGRATION mode)
12. `src/vite-env.d.ts` (add raw import declaration)

---

## 18. Behaviour Specification — Edge Cases

| Scenario | Expected Behaviour |
|---|---|
| Bridge offline when user lands on Connect step | Show red "Bridge offline" badge. Disable "Read Blocks" button. Show "Start TIA Bridge" instructions panel. |
| Export returns 0 blocks | Show warning toast "No blocks exported. Ensure a project is open in TIA Portal." Do not advance. |
| Analysis returns malformed JSON | Catch parse error, show toast "Analysis failed — unexpected response format. Try again." Do not advance. |
| Transform fails mid-way (network error) | Show error toast with which step failed. Partially completed transforms already persisted to DB — show "Resume" option. |
| All plan steps are INFO severity | Allow proceeding to Transform with a note "No breaking issues found — this migration may succeed without changes." |
| User skips all plan steps | Disable "Run Transformation" — show "Nothing to transform. All steps are skipped." with option to go back. |
| Compile returns errors | Do not auto-advance to Report. Show compile errors inline. Offer "Edit Block" to open Monaco with the failing block. Offer "Re-compile" after edits. |
| Session already exists for project | On landing, check for existing incomplete session and offer "Resume previous migration" or "Start new migration". |

---

## 19. UI / Style Conventions

Follow existing conventions exactly:
- Use `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`
- Use `Badge` with variant prop for severity: `variant="destructive"` for CRITICAL/BREAKING, no variant (default) for WARNING, `variant="secondary"` for INFO
- Agent running state: show a pulsing dot + agent name, same as the pattern in `forge-device-code.tsx`
- Scrollable content areas: wrap in `ScrollArea` from `@/components/ui/scroll-area`
- Loading states: use `Loader2` icon with `animate-spin` class
- All buttons follow existing `Button` component usage — do not use raw `<button>` elements
- Font mono for block names, step IDs, technical identifiers: `font-mono text-sm`
- Empty states: centred, muted text, relevant icon above, no data message

---

## 20. Testing Checklist (for implementer to verify)

- [ ] TypeScript compiles with no errors (`tsc --noEmit`)
- [ ] `migrate` route renders without crashing when no session exists
- [ ] Creating a new session writes to Supabase and stores ID in Zustand
- [ ] Bridge offline state correctly prevents block export
- [ ] Block export populates `source_blocks` in DB and displays block list in UI
- [ ] Analysis agent call returns valid JSON and populates `migration_plan`
- [ ] Approve Plan step correctly saves `approved`/`skipped` flags
- [ ] Transform executes only approved/non-skipped steps
- [ ] Transformed blocks are persisted to DB after each step (not just at the end)
- [ ] Review findings are displayed grouped by severity
- [ ] Compile step builds correct manifest and submits to bridge
- [ ] Report step generates markdown and download works
- [ ] Step bar reflects correct completed/active/pending states throughout
- [ ] Back navigation works and does not re-trigger agent runs
- [ ] Existing Forge wizard and Pac-ST routes are unaffected
