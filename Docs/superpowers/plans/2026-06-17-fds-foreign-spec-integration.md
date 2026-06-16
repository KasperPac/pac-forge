# FDS Foreign-Spec Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user reach the FDS co-author from a customer `.docx` alone, an IO register alone, or both — with hierarchy, states, alarms, IO, and original spec text all wired through.

**Architecture:** Five dependency-ordered workstreams. (A) Complete the ISA-88 hierarchy column rename so `contract.ts` aligns with the DB. (B) Store the ingested `.docx` as sections and inject relevant ones into FDS prompts. (C) Synthesize an instrument register from the ingested hierarchy. (D) Hydrate `spec_projects.confirmed_*` from the ingested contract after commit. (E) Deterministically merge an uploaded register's IO into the spec hierarchy.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RPC + RLS), Zod, TanStack Query, vitest, `xlsx`, `mammoth`.

**Design:** `Docs/superpowers/specs/2026-06-16-fds-foreign-spec-integration-design.md`

**Resolved during planning:**
- The draft-immutability trigger (migration 065) is on `spec_project_revisions`, **not** `spec_projects`. Hydrating `spec_projects.confirmed_*` via `writeSpecContract` has no trigger conflict — Gap 1 is a plain frontend write after commit.
- `writeSpecContract` (`contract.ts:1049-1080`) already persists `confirmed_units`/`confirmed_states`/`alarm_tiers`; its top doc-comment ("non-alarm keys deferred/ignored") is stale and gets corrected in Task A3.
- Register-derived IO signals use `source: "wired"` (`IoSignalSourceSchema = "wired" | "network_telegram"`).

---

## File Structure

| File | Responsibility | Workstream |
|---|---|---|
| `supabase/migrations/093_isa88_column_rename.sql` (new) | Rename `confirmed_subsystems→confirmed_units`, `subsystems→units`; update RPC bodies | A |
| `supabase/migrations/094_spec_source_sections.sql` (new) | New `spec_source_sections` table + RLS; add `instrument_registers.source` | B/C |
| `src/hooks/use-spec-projects.ts` | Drop `units→subsystems` insert shim | A |
| `src/lib/spec-builder/contract.ts` | Correct stale doc-comment; confirm `confirmed_units` alignment | A |
| `src/lib/spec-builder/instrument-parser.ts` | Export `extractDevicePrefix` for merge matching | E |
| `src/lib/spec-builder/source-section-select.ts` (new) | Pure: select relevant `.docx` sections per equipment module | B |
| `src/lib/spec-builder/synthesize-register.ts` (new) | Pure: `SpecContractV2` hierarchy → `InstrumentTag[]` + unit summary | C |
| `src/lib/spec-builder/merge-register-hierarchy.ts` (new) | Pure: merge register IO into spec hierarchy + report | E |
| `src/lib/spec-builder/fds-prompts.ts` | `buildFdsInterviewSystemPrompt` gains `sourceSections` param + context block | B |
| `src/hooks/use-fds-conversation.ts` | Load + select sections, pass to prompt builder | B |
| `src/hooks/use-source-sections.ts` (new) | Query `spec_source_sections` for a project | B |
| `src/lib/spec-builder/ai-ingest.ts`, `docx-ingest.ts` | Capture `.docx` sections + filename at ingest | B |
| `src/hooks/use-spec-ingest.ts` / `src/routes/spec-builder-ingest-review.tsx` | After commit: hydrate (`useUpdateSpecProject`) + insert sections + synthesize register | B/C/D |
| `src/routes/spec-co-author.tsx` | Run merge at entry (`useUpdateSpecProject` write-back); show `MergeReport` | E |

**Suggested execution order:** A → (B pure helpers, C pure helper, E pure helper in parallel) → D → integration tasks (B wiring, C wiring, E wiring). Pure-helper tasks (B1-pure, C1, E1) have no dependency on A and can be done first.

---

## Workstream A — Foundation: complete the column rename

### Task A1: Enumerate every reference to the old column names

**Files:** none (investigation, recorded in the migration comment).

- [ ] **Step 1: Find all DB-side references**

Run:
```bash
grep -rnE "confirmed_subsystems|\bsubsystems\b" supabase/migrations/
```
Expected: hits in `054`, `066`, `067`, `091` (at least). Record the exact files+lines — Task A2 must update each RPC body that reads/writes these columns.

- [ ] **Step 2: Find all code-side references**

Run:
```bash
grep -rnE "confirmed_subsystems|subsystems:" src/
```
Expected: the insert shim in `src/hooks/use-spec-projects.ts:173-176`. Record any others.

No commit (investigation only).

### Task A2: Write migration 093 — rename columns + update RPCs

**Files:**
- Create: `supabase/migrations/093_isa88_column_rename.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 093_isa88_column_rename.sql
-- Complete the ISA-88 rename: align DB column names with code (`units`).
-- 091 renamed code/types but left these two columns at their pre-ISA-88 names.

ALTER TABLE spec_projects        RENAME COLUMN confirmed_subsystems TO confirmed_units;
ALTER TABLE instrument_registers RENAME COLUMN subsystems           TO units;

-- Redefine every RPC that referenced the old column names. Bodies are copied
-- from their latest definition (066/067/091) with the column name swapped.
-- (Engineer: paste each affected CREATE OR REPLACE FUNCTION from the files found
--  in Task A1, replacing `confirmed_subsystems` → `confirmed_units`. Do NOT
--  invent new behavior — only the column identifier changes.)
```

Then, for each RPC found in Task A1 (`create_draft_from_ingest`, `revert_to_revision`, the `067` orchestration loader, and the `091` body), append a `CREATE OR REPLACE FUNCTION` that is byte-identical to its current definition except `confirmed_subsystems` is replaced with `confirmed_units`.

- [ ] **Step 2: Apply locally**

Run: `npx supabase db reset` (or `npx supabase db push` against a local stack)
Expected: migration applies with no error; `\d spec_projects` shows `confirmed_units`, `\d instrument_registers` shows `units`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/093_isa88_column_rename.sql
git commit -m "feat(db): rename confirmed_subsystems→confirmed_units, subsystems→units (093)"
```

### Task A3: Remove the insert shim + fix the stale doc-comment

**Files:**
- Modify: `src/hooks/use-spec-projects.ts:172-179`
- Modify: `src/lib/spec-builder/contract.ts:1000-1009`

- [ ] **Step 1: Update the insert to pass `units` directly**

In `useSaveInstrumentRegister`, replace the shim:
```ts
      // (was) Map 'units' → 'subsystems' to match DB column name
      const { units, ...rest } = input;
      const { data, error } = await supabase
        .from("instrument_registers")
        .insert({ ...rest, subsystems: units })
        .select()
        .single();
```
with:
```ts
      const { data, error } = await supabase
        .from("instrument_registers")
        .insert(input)        // column is now `units`
        .select()
        .single();
```

- [ ] **Step 2: Correct the stale `writeSpecContract` doc-comment**

In `contract.ts`, replace the "concrete persistence … is deferred to later waves … accepted and ignored" paragraph with:
```ts
 * Persists hierarchy (`confirmed_units`), `confirmed_states`, `alarm_tiers`,
 * `confirmed_modes`, `configuration_parameters`, `section_overrides`,
 * `process_model`, and `confirmation_status` onto `spec_projects`, plus alarm
 * rows via `spec_alarms` and equipment-module/unit/section upserts. Patch is
 * Zod-validated before any write occurs.
```

- [ ] **Step 3: Verify no stale references remain**

Run:
```bash
grep -rnE "confirmed_subsystems|subsystems:" src/
```
Expected: no matches.

- [ ] **Step 4: Run the existing spec-builder suite**

Run: `npx vitest run src/lib/spec-builder src/types`
Expected: PASS (no regressions from the rename).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-spec-projects.ts src/lib/spec-builder/contract.ts
git commit -m "refactor: drop units→subsystems shim; align contract with confirmed_units"
```

---

## Workstream B — Gap 2: source sections in FDS prompts

### Task B1: Migration 094 — `spec_source_sections` table + `instrument_registers.source`

**Files:**
- Create: `supabase/migrations/094_spec_source_sections.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 094_spec_source_sections.sql

CREATE TABLE IF NOT EXISTS spec_source_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  heading         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  order_index     int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spec_source_sections_project
  ON spec_source_sections (spec_project_id, order_index);

ALTER TABLE spec_source_sections ENABLE ROW LEVEL SECURITY;

-- Owner access mirrors instrument_registers: the owning spec_projects row's creator.
CREATE POLICY spec_source_sections_owner ON spec_source_sections
  USING (EXISTS (
    SELECT 1 FROM spec_projects sp
    WHERE sp.id = spec_source_sections.spec_project_id
      AND sp.created_by = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM spec_projects sp
    WHERE sp.id = spec_source_sections.spec_project_id
      AND sp.created_by = auth.uid()
  ));

-- Provenance for synthesized vs uploaded registers (Workstream C).
ALTER TABLE instrument_registers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';
```

> Note: confirm `spec_projects.created_by` and the RLS pattern against `054_spec_builder.sql` / `instrument_registers` policies; copy the exact owner predicate those use.

- [ ] **Step 2: Apply locally**

Run: `npx supabase db reset`
Expected: applies clean; `\d spec_source_sections` and `\d instrument_registers` (has `source`) verified.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/094_spec_source_sections.sql
git commit -m "feat(db): spec_source_sections table + instrument_registers.source (094)"
```

### Task B2: Pure helper — `selectRelevantSections`

**Files:**
- Create: `src/lib/spec-builder/source-section-select.ts`
- Test: `src/lib/spec-builder/__tests__/source-section-select.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectRelevantSections } from "@/lib/spec-builder/source-section-select";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";
import type { EquipmentModuleConfig } from "@/types/spec-builder";

const sections: SourceSection[] = [
  { heading: "System Overview", body: "The line conveys product end to end.", order_index: 0 },
  { heading: "Conveyor CV01", body: "CV01 runs forward when M1 is commanded.", order_index: 1 },
  { heading: "Lift Table LFT01", body: "Raises pallets via M5.", order_index: 2 },
];

const em: EquipmentModuleConfig = {
  equipment_module_id: "em1",
  equipment_module_name: "Conveyor CV01",
  description: "",
  control_modules: [
    { control_module_id: "M1", control_module_name: "Drive M1", control_module_class: "motor",
      description: "", is_safety: false,
      io_signals: [{ tag: "CV01_M1_CMD", signal_type: "DO", io_address: "%Q0.0", description: "run" }] },
  ],
};

describe("selectRelevantSections", () => {
  it("includes the EM-matched section and global overview, not the unrelated EM", () => {
    const out = selectRelevantSections(sections, em, { maxChars: 10_000 });
    const headings = out.map((s) => s.heading);
    expect(headings).toContain("Conveyor CV01");
    expect(headings).toContain("System Overview"); // global keyword
    expect(headings).not.toContain("Lift Table LFT01");
  });

  it("respects the maxChars budget (drops lowest-priority first)", () => {
    const out = selectRelevantSections(sections, em, { maxChars: 40 });
    const total = out.reduce((n, s) => n + s.heading.length + s.body.length, 0);
    expect(total).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/source-section-select.test.ts`
Expected: FAIL ("selectRelevantSections is not a function").

- [ ] **Step 3: Implement the helper**

```ts
import type { EquipmentModuleConfig } from "@/types/spec-builder";

export interface SourceSection {
  heading: string;
  body: string;
  order_index: number;
}

export interface SelectOptions {
  /** Max total chars (heading+body) across returned sections. */
  maxChars?: number;
}

const GLOBAL_HEADING_RE = /overview|control philosophy|scope|introduction|general/i;
const DEFAULT_MAX_CHARS = 6_000;

/**
 * Deterministically pick the source sections relevant to one equipment module:
 * sections whose heading/body mention the EM name, a control-module id/name, or
 * a tag — plus "global" sections (overview / control philosophy / scope).
 * Global sections rank first; then EM-matched by document order. Truncated to
 * the char budget, dropping lowest-priority sections whole.
 */
export function selectRelevantSections(
  sections: SourceSection[],
  em: EquipmentModuleConfig,
  opts: SelectOptions = {},
): SourceSection[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const needles = new Set<string>();
  needles.add(em.equipment_module_name.toLowerCase());
  for (const cm of em.control_modules) {
    needles.add(cm.control_module_id.toLowerCase());
    needles.add(cm.control_module_name.toLowerCase());
    for (const sig of cm.io_signals) needles.add(sig.tag.toLowerCase());
  }

  const matched: SourceSection[] = [];
  const global: SourceSection[] = [];
  for (const s of sections) {
    const hay = `${s.heading}\n${s.body}`.toLowerCase();
    if (GLOBAL_HEADING_RE.test(s.heading)) {
      global.push(s);
    } else if ([...needles].some((n) => n.length > 1 && hay.includes(n))) {
      matched.push(s);
    }
  }

  const ranked = [
    ...global.sort((a, b) => a.order_index - b.order_index),
    ...matched.sort((a, b) => a.order_index - b.order_index),
  ];

  const out: SourceSection[] = [];
  let used = 0;
  for (const s of ranked) {
    const size = s.heading.length + s.body.length;
    if (used + size > maxChars) continue;
    out.push(s);
    used += size;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/source-section-select.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/source-section-select.ts src/lib/spec-builder/__tests__/source-section-select.test.ts
git commit -m "feat(spec-builder): deterministic per-EM source-section selection"
```

### Task B3: Add `sourceSections` to the FDS prompt builder

**Files:**
- Modify: `src/lib/spec-builder/fds-prompts.ts:44-51` (signature) + return template
- Modify: `src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts` (call sites pass `[]`)

- [ ] **Step 1: Write the failing test**

Add to `fds-prompts-v2.test.ts`:
```ts
it("renders a Customer Specification Context block when sections are passed", () => {
  const prompt = buildFdsInterviewSystemPrompt(
    sampleEquipmentModule, sampleUnit, sampleTags, {}, {}, sampleStates,
    [{ heading: "Conveyor CV01", body: "Runs forward on M1 command.", order_index: 1 }],
  );
  expect(prompt).toContain("## Customer Specification Context");
  expect(prompt).toContain("Runs forward on M1 command.");
});
```
(Reuse the existing `sample*` fixtures already defined in this test file for the other cases.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts -t "Customer Specification Context"`
Expected: FAIL — builder takes 6 args / no such block.

- [ ] **Step 3: Add the parameter and rendered block**

In `fds-prompts.ts`, extend the signature (new last param, defaulted so existing callers stay valid):
```ts
import type { SourceSection } from "./source-section-select";

export function buildFdsInterviewSystemPrompt(
  equipment_module: EquipmentModuleConfig,
  unit: UnitConfig,
  tags: InstrumentTag[],
  staticStates: Record<string, ControlModuleStateEntry[]>,
  completedSequentialStates: Record<string, SequentialStateV2>,
  allStates: OperatingStateV2[],
  sourceSections: SourceSection[] = [],
): string {
```
Build the block near the other data-gathering vars:
```ts
  const sourceContext = sourceSections.length === 0
    ? ""
    : `\n## Customer Specification Context\n` +
      `Reference the original customer specification below. Treat it as the source\n` +
      `of intent for process, sequence, fault, and interlock requirements.\n\n` +
      sourceSections
        .map((s) => `### ${s.heading || "(untitled)"}\n${s.body}`)
        .join("\n\n") + "\n";
```
Insert `${sourceContext}` into the returned template string (after the IMMUTABLE IDENTIFIERS / device context, before the interview protocol).

- [ ] **Step 4: Update the existing test call sites**

The three existing `buildFdsInterviewSystemPrompt(...)` calls in `fds-prompts-v2.test.ts` omit the new arg — that's valid (defaulted). Re-run the whole file. If the snapshot test fails because the template gained a (empty) seam, update the snapshot intentionally: `npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts -u`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts`
Expected: PASS (incl. the new case + refreshed snapshot).

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/fds-prompts.ts src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts
git commit -m "feat(fds): inject Customer Specification Context into interview prompt"
```

### Task B4: Query hook for source sections

**Files:**
- Create: `src/hooks/use-source-sections.ts`

- [ ] **Step 1: Implement the query hook**

Follow the pattern of `useInstrumentRegister` in `src/hooks/use-spec-projects.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";

export const sourceSectionsKey = (specProjectId: string) =>
  ["source-sections", specProjectId] as const;

export function useSourceSections(specProjectId: string | undefined) {
  return useQuery({
    queryKey: sourceSectionsKey(specProjectId ?? ""),
    enabled: !!specProjectId,
    queryFn: async (): Promise<SourceSection[]> => {
      const { data, error } = await supabase
        .from("spec_source_sections")
        .select("heading, body, order_index")
        .eq("spec_project_id", specProjectId)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SourceSection[];
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-source-sections.ts
git commit -m "feat(spec-builder): useSourceSections query hook"
```

### Task B5: Wire sections into the conversation prompt

**Files:**
- Modify: `src/hooks/use-fds-conversation.ts:70-79`

- [ ] **Step 1: Load sections and pass the selected subset**

At the top of the hook, load sections (the hook already receives `specId`/project context — use it; if not in scope, thread `specProjectId` in from the caller `fds-co-author.tsx`):
```ts
import { useSourceSections } from "@/hooks/use-source-sections";
import { selectRelevantSections } from "@/lib/spec-builder/source-section-select";
// ...
const { data: sourceSections = [] } = useSourceSections(specProjectId);
```
Update `buildSystemPrompt`:
```ts
  const buildSystemPrompt = useCallback(() => {
    const relevant = selectRelevantSections(sourceSections, equipment_module);
    return buildFdsInterviewSystemPrompt(
      equipment_module, unit, allTags,
      session.static_states,
      session.sequential_states,
      allStates,
      relevant,
    );
  }, [equipment_module, unit, allTags, session.static_states, session.sequential_states, allStates, sourceSections]);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: exit 0. (If `specProjectId` is not available in this hook, add it to the hook's params and pass from `fds-co-author.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-fds-conversation.ts
git commit -m "feat(fds): feed relevant customer-spec sections into the co-author prompt"
```

### Task B6: Capture `.docx` sections at ingest and persist on commit

**Files:**
- Modify: `src/lib/spec-builder/ai-ingest.ts` (return sections + filename)
- Modify: `src/lib/spec-builder/docx-ingest.ts` (thread through the `ai` result variant)
- Modify: `src/hooks/use-spec-ingest.ts` (`ParkedAiIngest` carries them; `parkAi` passes them)
- Modify: `src/routes/spec-builder-ingest-review.tsx` (insert rows on commit)

> Only the AI/foreign-spec path captures sections — the deterministic markup path is for pac-authored structured docs that don't need customer-spec context.

- [ ] **Step 1: Return sections + filename from `aiIngestDocx`**

In `ai-ingest.ts`, after `const specText = extract.value ?? "";`, build sections and widen the return:
```ts
import { splitIntoSections } from "@/lib/document-sections";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";
// ...
export async function aiIngestDocx(
  file: File,
  abortSignal: AbortSignal,
): Promise<{ draft: SpecContractV2; warnings: Warning[]; sourceSections: SourceSection[]; sourceFilename: string }> {
  // ... existing extraction + AI call producing `draft`, `warnings` ...
  const sourceSections: SourceSection[] = splitIntoSections(specText).map((s) => ({
    heading: s.heading,
    body: s.content,
    order_index: s.index,
  }));
  return { draft, warnings, sourceSections, sourceFilename: file.name };
}
```

- [ ] **Step 2: Thread through `ingestDocx`’s `ai` variant**

In `docx-ingest.ts`, extend the `ai` variant of `IngestResult` and pass the new fields:
```ts
// IngestResult ai variant:
//   { kind: "ai"; draft: SpecContractV2; warnings: Warning[];
//     sourceSections: SourceSection[]; sourceFilename: string }
const { draft, warnings, sourceSections, sourceFilename } = await aiIngestDocx(file, abort.signal);
return { kind: "ai", draft, warnings, sourceSections, sourceFilename };
```
(Import `SourceSection`. Other `IngestResult` variants are unchanged.)

- [ ] **Step 3: Carry them in the parked store**

In `use-spec-ingest.ts`, extend `ParkedAiIngest`:
```ts
interface ParkedAiIngest {
  specProjectId: string;
  draft: SpecContractV2;
  warnings: Warning[];
  sourceSections: SourceSection[];
  sourceFilename: string;
}
```
and at the `parkAi({...})` call (the `kind === "ai"` branch) pass `sourceSections: result.sourceSections, sourceFilename: result.sourceFilename`.

- [ ] **Step 4: Insert section rows on commit**

In `spec-builder-ingest-review.tsx` commit handler, after the draft commit + hydration (D1):
```ts
import { supabase } from "@/lib/supabase";
// ...
if (parked.sourceSections?.length) {
  await supabase.from("spec_source_sections").delete().eq("spec_project_id", specProjectId);
  const { error } = await supabase.from("spec_source_sections").insert(
    parked.sourceSections.map((s, i) => ({
      spec_project_id: specProjectId,
      source_filename: parked.sourceFilename ?? "ingest.docx",
      heading: s.heading,
      body: s.body,
      order_index: s.order_index ?? i,
    })),
  );
  if (error) throw error;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/ai-ingest.ts src/lib/spec-builder/docx-ingest.ts src/hooks/use-spec-ingest.ts src/routes/spec-builder-ingest-review.tsx
git commit -m "feat(spec-builder): capture .docx sections at ingest and persist on commit"
```

---

## Workstream C — Gap 3: synthesize a register from ingest

### Task C1: Pure helper — `synthesizeRegisterFromContract`

**Files:**
- Create: `src/lib/spec-builder/synthesize-register.ts`
- Test: `src/lib/spec-builder/__tests__/synthesize-register.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { synthesizeRegisterFromContract } from "@/lib/spec-builder/synthesize-register";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const contract = {
  hierarchy: {
    units: [{
      unit_id: "u1", unit_name: "Infeed", equipment_type: "Conveyor",
      description: "", excluded: false,
      equipment_modules: [{
        equipment_module_id: "em1", equipment_module_name: "Conveyor CV01", description: "",
        control_modules: [{
          control_module_id: "cm1", control_module_name: "Drive M1",
          control_module_class: "motor", is_safety: false, description: "",
          io_signals: [
            { tag: "CV01_M1_CMD", signal_type: "DO", io_address: "%Q0.0", description: "run", source: "wired" },
            { tag: "CV01_M1_FB",  signal_type: "DI", io_address: "%I0.0", description: "fb",  source: "wired" },
          ],
        }],
      }],
    }],
  },
} as unknown as SpecContractV2;

describe("synthesizeRegisterFromContract", () => {
  it("flattens io_signals into InstrumentTag[] with ISA-88 fields", () => {
    const { tags } = synthesizeRegisterFromContract(contract);
    expect(tags).toHaveLength(2);
    const cmd = tags.find((t) => t.tag === "CV01_M1_CMD")!;
    expect(cmd.unit).toBe("Infeed");
    expect(cmd.equipment_module).toBe("Conveyor CV01");
    expect(cmd.control_module).toBe("Drive M1");
    expect(cmd.signal_direction).toBe("DO");
    expect(cmd.control_module_class).toBe("motor");
    expect(cmd.io_address).toBe("%Q0.0");
  });

  it("builds a unit summary grouped by unit", () => {
    const { units } = synthesizeRegisterFromContract(contract);
    expect(units).toHaveLength(1);
    expect(units[0].unit_name).toBe("Infeed");
  });

  it("returns empty for a contract with no io_signals", () => {
    const empty = { hierarchy: { units: [] } } as unknown as SpecContractV2;
    const { tags, units } = synthesizeRegisterFromContract(empty);
    expect(tags).toHaveLength(0);
    expect(units).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/synthesize-register.test.ts`
Expected: FAIL ("synthesizeRegisterFromContract is not a function").

- [ ] **Step 3: Implement**

```ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { InstrumentTag, UnitSummary, ControlModuleClass, SignalDirection } from "@/types/spec-builder";
import { groupSubsystems } from "@/lib/spec-builder/instrument-parser";

const DIRECTIONS: ReadonlySet<string> = new Set(["DI", "DO", "AI", "AO"]);

function toDirection(signalType: string): SignalDirection {
  const s = signalType.trim().toUpperCase();
  return (DIRECTIONS.has(s) ? s : "internal") as SignalDirection;
}

/**
 * Flatten an ingested SpecContractV2 hierarchy into the same shapes the
 * instrument-register upload path produces, so a register can be synthesized
 * for projects that only have a customer .docx. The contract already carries
 * classification (control_module_class, is_safety), so no AI/heuristic pass.
 */
export function synthesizeRegisterFromContract(
  contract: SpecContractV2,
): { tags: InstrumentTag[]; units: UnitSummary[] } {
  const tags: InstrumentTag[] = [];
  for (const unit of contract.hierarchy?.units ?? []) {
    for (const em of unit.equipment_modules ?? []) {
      for (const cm of em.control_modules ?? []) {
        for (const sig of cm.io_signals ?? []) {
          tags.push({
            tag: sig.tag,
            device_type: cm.control_module_class,
            description: sig.description,
            signal_type: sig.signal_type,
            io_address: sig.io_address,
            control_module_class: cm.control_module_class as ControlModuleClass,
            signal_direction: toDirection(sig.signal_type),
            unit_prefix: unit.unit_name,
            is_safety: cm.is_safety,
            process_cell: "",
            unit: unit.unit_name,
            equipment_module: em.equipment_module_name,
            control_module: cm.control_module_name,
          });
        }
      }
    }
  }
  return { tags, units: groupSubsystems(tags) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/synthesize-register.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/synthesize-register.ts src/lib/spec-builder/__tests__/synthesize-register.test.ts
git commit -m "feat(spec-builder): synthesize InstrumentTag[] from ingested contract"
```

### Task C2: Persist synthesized register on ingest commit (when no upload exists)

**Files:**
- Modify: `src/routes/spec-builder-ingest-review.tsx` (commit handler) **or** the `onSuccess` of `useCreateDraftFromIngest` in `src/hooks/use-spec-revisions.ts`
- Modify: `src/hooks/use-spec-projects.ts` (`useSaveInstrumentRegister` input gains optional `source`)
- Modify: `src/types/spec-builder.ts` (`InstrumentRegister` gains `source`)

- [ ] **Step 0: Add `source` to the `InstrumentRegister` type**

In `src/types/spec-builder.ts`, add to the `InstrumentRegister` interface:
```ts
  source: "upload" | "ingest";
```

- [ ] **Step 1: Allow the save hook to set provenance**

In `useSaveInstrumentRegister`, extend the input type:
```ts
    mutationFn: async (input: {
      spec_project_id: string;
      raw_filename: string;
      tags: unknown[];
      units: unknown[];
      parse_warnings: unknown[];
      haiku_usage: unknown;
      source?: "upload" | "ingest";
    }) => {
      // Only replace a register of the SAME provenance, so a synthesized
      // 'ingest' register never clobbers an uploaded one and vice-versa.
      const source = input.source ?? "upload";
      await supabase.from("instrument_registers")
        .delete()
        .eq("spec_project_id", input.spec_project_id)
        .eq("source", source);
      const { data, error } = await supabase
        .from("instrument_registers")
        .insert({ ...input, source })
        .select().single();
      if (error) throw error;
      return data as InstrumentRegister;
    },
```

- [ ] **Step 2: Synthesize after commit when no upload register exists**

In the ingest-review commit success path, after `create_draft_from_ingest` resolves and the hydration (Task D1) runs:
```ts
import { synthesizeRegisterFromContract } from "@/lib/spec-builder/synthesize-register";
// ...
// Only synthesize when the project has no uploaded register.
const { data: existing } = await supabase
  .from("instrument_registers")
  .select("id, source")
  .eq("spec_project_id", specProjectId)
  .eq("source", "upload")
  .maybeSingle();

if (!existing) {
  const { tags, units } = synthesizeRegisterFromContract(reviewedContract);
  if (tags.length > 0) {
    await saveRegister.mutateAsync({
      spec_project_id: specProjectId,
      raw_filename: "Synthesized from customer spec",
      tags, units, parse_warnings: [], haiku_usage: {}, source: "ingest",
    });
  }
}
```
(Adapt `reviewedContract.meta?.title` to the actual SpecContractV2 meta field name; fall back to `"ingest"`.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-spec-projects.ts src/routes/spec-builder-ingest-review.tsx
git commit -m "feat(spec-builder): synthesize instrument register from ingest when none uploaded"
```

---

## Workstream D — Gap 1: hydrate spec_projects after commit

### Task D1: Hydrate `confirmed_*` from the reviewed contract

**Files:**
- Modify: `src/routes/spec-builder-ingest-review.tsx` (commit handler)

> **Why `useUpdateSpecProject`, not `writeSpecContract`:** `writeSpecContract` runs strict Zod (control-module ids must be UUIDs), calls `assertBuilderContext()`, and upserts normalized equipment-module/unit rows. The co-author reads the hierarchy from `confirmed_units` directly, and the skeleton wizard already persists it via `useUpdateSpecProject` (`spec-skeleton-wizard.tsx:132-138`). Mirror that proven path — a plain JSONB update of the three inline columns.

- [ ] **Step 1: Hydrate the inline columns after the draft commit**

In the commit handler, immediately after `create_draft_from_ingest` succeeds (and before Task C2's synthesis):
```ts
import { useUpdateSpecProject } from "@/hooks/use-spec-projects";
// const updateSpec = useUpdateSpecProject();  // near the other hooks
// ...
await createDraft.mutateAsync(/* existing args */);

// Hydrate the live spec_projects row so the wizard + co-author consume the
// ingested hierarchy/states/alarms instead of starting empty. (The 065
// immutability trigger guards spec_project_revisions, NOT spec_projects.)
await updateSpec.mutateAsync({
  id: specProjectId,
  confirmed_units: reviewedContract.hierarchy.units,
  // confirmed_states is JSONB; V2 shape is a structural superset of the
  // SpecProjectUpdate.confirmed_states type — cast as the wizard does.
  confirmed_states: reviewedContract.states as unknown as SpecProjectUpdate["confirmed_states"],
  alarm_tiers: reviewedContract.alarm_tiers,
});
```
(Import `SpecProjectUpdate` from `@/types/spec-builder` if not already; pass only keys present on `reviewedContract`.)

- [ ] **Step 2: Manual verification (documented)**

Run the app, ingest a `.docx`, confirm on the review page. Then query:
```sql
select jsonb_array_length(confirmed_units)  as units,
       jsonb_array_length(confirmed_states) as states
from spec_projects where id = '<project>';
```
Expected: both > 0.

- [ ] **Step 3: Confirm the wizard pre-populates**

Open the skeleton wizard for that project. Expected: the hierarchy is the ingested one (it reads `spec.confirmed_units` before `buildHierarchyFromTags` — `spec-skeleton-wizard.tsx:87-92`). No code change expected here; if empty, the `confirmed_units` shape mismatch must be debugged.

- [ ] **Step 4: Commit**

```bash
git add src/routes/spec-builder-ingest-review.tsx
git commit -m "feat(spec-builder): hydrate spec_projects.confirmed_* from ingest commit"
```

---

## Workstream E — Merge: spec structure + register IO

### Task E1a: Export `extractDevicePrefix`

**Files:**
- Modify: `src/lib/spec-builder/instrument-parser.ts` (the `function extractDevicePrefix` declaration)

- [ ] **Step 1: Add `export`**

Change `function extractDevicePrefix(` to `export function extractDevicePrefix(`.

- [ ] **Step 2: Verify existing parser tests still pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/spec-builder/instrument-parser.ts
git commit -m "refactor(spec-builder): export extractDevicePrefix for merge matching"
```

### Task E1b: Pure helper — `mergeRegisterIntoHierarchy`

**Files:**
- Create: `src/lib/spec-builder/merge-register-hierarchy.ts`
- Test: `src/lib/spec-builder/__tests__/merge-register-hierarchy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mergeRegisterIntoHierarchy } from "@/lib/spec-builder/merge-register-hierarchy";
import type { UnitConfig, InstrumentTag } from "@/types/spec-builder";

function tag(t: string, unit: string, control_module: string, addr: string, dir: string): InstrumentTag {
  return {
    tag: t, device_type: "", description: t, signal_type: dir, io_address: addr,
    control_module_class: "motor", signal_direction: dir as InstrumentTag["signal_direction"],
    unit_prefix: unit, is_safety: false, process_cell: "", unit,
    equipment_module: "", control_module,
  };
}

const units: UnitConfig[] = [{
  unit_id: "Infeed", unit_name: "Infeed", equipment_type: "Conveyor", description: "", excluded: false,
  equipment_modules: [{
    equipment_module_id: "CV01", equipment_module_name: "Conveyor CV01", description: "",
    control_modules: [{
      control_module_id: "M1", control_module_name: "Drive M1", control_module_class: "motor",
      description: "", is_safety: false,
      io_signals: [{ tag: "CV01_M1_CMD", signal_type: "DO", io_address: "", description: "run" }],
    }],
  }],
}];

describe("mergeRegisterIntoHierarchy", () => {
  it("fills IO address on a matched control module from the register", () => {
    const tags = [tag("CV01_M1_CMD", "Infeed", "M1", "%Q0.0", "DO")];
    const { units: out, report } = mergeRegisterIntoHierarchy(units, tags);
    const sig = out[0].equipment_modules[0].control_modules[0].io_signals.find((s) => s.tag === "CV01_M1_CMD")!;
    expect(sig.io_address).toBe("%Q0.0");
    expect(report.matched).toBe(1);
  });

  it("places an unmatched register device under an Unassigned EM in its unit", () => {
    const tags = [tag("LFT01_M9_CMD", "Infeed", "M9", "%Q9.0", "DO")];
    const { units: out, report } = mergeRegisterIntoHierarchy(units, tags);
    const unassigned = out[0].equipment_modules.find((e) => e.equipment_module_id === "Unassigned");
    expect(unassigned).toBeTruthy();
    expect(report.addedUnassigned).toBe(1);
  });

  it("flags spec control modules that received no register IO", () => {
    const { report } = mergeRegisterIntoHierarchy(units, []);
    expect(report.specModulesWithoutIo).toContain("M1");
  });

  it("is idempotent", () => {
    const tags = [tag("CV01_M1_CMD", "Infeed", "M1", "%Q0.0", "DO")];
    const once = mergeRegisterIntoHierarchy(units, tags).units;
    const twice = mergeRegisterIntoHierarchy(once, tags).units;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/merge-register-hierarchy.test.ts`
Expected: FAIL ("mergeRegisterIntoHierarchy is not a function").

- [ ] **Step 3: Implement**

```ts
import type { UnitConfig, ControlModuleConfig, IoSignal, InstrumentTag } from "@/types/spec-builder";
import { extractDevicePrefix } from "@/lib/spec-builder/instrument-parser";

export interface MergeReport {
  matched: number;
  addedUnassigned: number;
  specModulesWithoutIo: string[];
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Spec hierarchy is the skeleton; the register supplies authoritative IO.
 * Deterministic: match each register tag to a spec control module by exact
 * control_module id / existing io-signal tag, else by normalized device prefix.
 * Matched → register io_address + signal_type fill/override that module's signal.
 * Unmatched → an "Unassigned" EM under the tag's unit. Spec-only modules with no
 * register tag are kept and reported.
 */
export function mergeRegisterIntoHierarchy(
  units: UnitConfig[],
  registerTags: InstrumentTag[],
): { units: UnitConfig[]; report: MergeReport } {
  const out = deepClone(units);

  // Index spec control modules by id and by existing io-signal tag.
  interface Ref { cm: ControlModuleConfig; unitName: string; }
  const byId = new Map<string, Ref>();
  const byTag = new Map<string, Ref>();
  const touched = new Set<ControlModuleConfig>();

  for (const u of out) {
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        byId.set(cm.control_module_id.toLowerCase(), { cm, unitName: u.unit_name });
        for (const sig of cm.io_signals) byTag.set(sig.tag.toLowerCase(), { cm, unitName: u.unit_name });
      }
    }
  }

  const report: MergeReport = { matched: 0, addedUnassigned: 0, specModulesWithoutIo: [] };

  const ensureUnassignedEm = (unitName: string): ControlModuleConfig[] => {
    let unit = out.find((u) => u.unit_name === unitName);
    if (!unit) {
      unit = { unit_id: unitName, unit_name: unitName, equipment_type: "Other",
               description: "", excluded: false, equipment_modules: [] };
      out.push(unit);
    }
    let em = unit.equipment_modules.find((e) => e.equipment_module_id === "Unassigned");
    if (!em) {
      em = { equipment_module_id: "Unassigned", equipment_module_name: "Unassigned",
             description: "", control_modules: [] };
      unit.equipment_modules.push(em);
    }
    return em.control_modules;
  };

  const applySignal = (cm: ControlModuleConfig, t: InstrumentTag) => {
    const sig: IoSignal = { tag: t.tag, signal_type: t.signal_type || t.signal_direction,
                            io_address: t.io_address, description: t.description };
    const existing = cm.io_signals.find((s) => s.tag === t.tag);
    if (existing) { existing.io_address = sig.io_address; existing.signal_type = sig.signal_type; }
    else cm.io_signals.push(sig);
    touched.add(cm);
  };

  for (const t of registerTags) {
    let ref = (t.control_module && byId.get(t.control_module.toLowerCase()))
      || byTag.get(t.tag.toLowerCase());
    if (!ref) {
      const prefix = extractDevicePrefix(t.tag, t.unit).toLowerCase();
      ref = byId.get(prefix);
    }
    if (ref) {
      applySignal(ref.cm, t);
      report.matched++;
    } else {
      const cms = ensureUnassignedEm(t.unit || (out[0]?.unit_name ?? "Unassigned"));
      const cmId = t.control_module || extractDevicePrefix(t.tag, t.unit);
      let cm = cms.find((c) => c.control_module_id === cmId);
      if (!cm) {
        cm = { control_module_id: cmId, control_module_name: t.description || cmId,
               control_module_class: t.control_module_class, description: t.description,
               is_safety: t.is_safety, io_signals: [] };
        cms.push(cm);
      }
      applySignal(cm, t);
      report.addedUnassigned++;
    }
  }

  // Spec-only modules that received no register IO at all (no touched signal and
  // no pre-existing addressed signal).
  for (const u of out) {
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        const hasIo = cm.io_signals.some((s) => s.io_address) || touched.has(cm);
        if (!hasIo) report.specModulesWithoutIo.push(cm.control_module_id);
      }
    }
  }

  return { units: out, report };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/merge-register-hierarchy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/merge-register-hierarchy.ts src/lib/spec-builder/__tests__/merge-register-hierarchy.test.ts
git commit -m "feat(spec-builder): deterministic merge of register IO into spec hierarchy"
```

### Task E2: Run the merge at co-author entry + surface the report

**Files:**
- Modify: `src/routes/spec-co-author.tsx` (after `register` + `spec` resolve, before render)

- [ ] **Step 1: Compute the merged hierarchy and persist when an upload register exists**

After the `if (!register)` gate passes (persist via the same `useUpdateSpecProject` plain-JSONB path as D1 — the merge produces app-shaped `UnitConfig[]` with non-UUID ids like `"Unassigned"`, which `writeSpecContract`'s Zod would reject):
```ts
import { mergeRegisterIntoHierarchy } from "@/lib/spec-builder/merge-register-hierarchy";
import { useUpdateSpecProject } from "@/hooks/use-spec-projects";
// const updateSpec = useUpdateSpecProject();
// const [mergeReport, setMergeReport] = useState<MergeReport | null>(null);
// ...
useEffect(() => {
  if (!register || register.source !== "upload" || !spec?.confirmed_units?.length) return;
  const { units, report } = mergeRegisterIntoHierarchy(
    spec.confirmed_units as UnitConfig[],
    register.tags as InstrumentTag[],
  );
  // Only write back when the merge changed something (avoids loops / churn).
  if (report.matched > 0 || report.addedUnassigned > 0) {
    void updateSpec.mutateAsync({ id: specId, confirmed_units: units });
  }
  setMergeReport(report);
  // Depend on stable identifiers only; register.tags/spec.confirmed_units are
  // referentially stable per query result.
}, [register, spec, specId]);
```
Add a small `MergeReport` banner (matched / added-unassigned / spec-modules-without-IO counts) using existing card/badge components; non-blocking.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 3: Manual verification (documented)**

Project with both an uploaded register and a confirmed (ingested) hierarchy → open co-author → banner shows matched count > 0; spot-check that a control module now shows the register's IO address.

- [ ] **Step 4: Commit**

```bash
git add src/routes/spec-co-author.tsx
git commit -m "feat(fds): merge uploaded register IO into spec hierarchy at co-author entry"
```

---

## Final verification

- [ ] **Full typecheck:** `npx tsc -b` → exit 0
- [ ] **Full test suite (changed domains green):** `npx vitest run src/lib/spec-builder src/types src/hooks` → spec-builder/types pass; pre-existing quote/issue/variation failures unchanged (out of scope).
- [ ] **Manual smoke — three entry paths each reach the co-author:**
  1. `.docx` only → ingest → review → confirm → co-author opens (synthesized register + hydrated hierarchy + source sections in prompt).
  2. Register `.xlsx` only → upload → wizard → co-author opens.
  3. Both → upload register + ingest `.docx` → co-author shows merge report with register IO mapped onto spec modules.

---

## Notes for the implementer

- **DRY:** `synthesize-register`, `merge-register-hierarchy`, and `source-section-select` are pure and independently tested — keep all side effects (Supabase, writeSpecContract) in the hooks/routes that call them.
- **YAGNI:** no AI passes anywhere in this plan; section selection and merge matching are deterministic. An AI topic-extraction upgrade for Gap 2 is explicitly deferred.
- **Shape note:** `confirmed_units` is read in the app as `UnitConfig[]` and validated on write as `UnitV2[]`; the only field gap is `io_signals[].source` (required by V2), handled by the adapter in Task E2 and present already on synthesized/ingested signals.
- **Migrations** can't be unit-tested in vitest (no live DB); rely on `supabase db reset` applying clean + the documented manual checks.
