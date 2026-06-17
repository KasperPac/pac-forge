# Register-Aware Foreign-Spec Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer `.docx` is ingested for a project that already has an IO register, build one coherent hierarchy from the register's real structure + IO, with the document's process content bound to the correct equipment modules by a constrained AI mapping pass — no invented duplicate IO, no post-hoc reconciliation.

**Architecture:** Two ingest modes chosen by whether the project has an `upload` register. Register-present: structure is built deterministically from the register (`buildHierarchyFromTags` + minted UUIDs); an Opus mapping pass binds the `.docx` narrative onto each equipment module (by id we provide) and extracts machine-level states/faults/process. `.docx`-only: today's AI-structure path, hardened with deterministic UUID minting. The brittle co-author merge is removed.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RPC + RLS), Zod, vitest, `mammoth`, the `generate` edge function (Anthropic).

**Design:** `Docs/superpowers/specs/2026-06-17-register-aware-ingest-design.md`

**Completion bar (non-negotiable):** "done" means the both-sources path was run on the **real Segment Wagon `.docx` + 51-tag register** (project `ff8fd8cf-cae9-4f93-b8f5-5176ca8d0bb3`, register `564c1795-9fa3-4b45-b2c1-66234ede5835`) and produced a hierarchy whose modules carry the right `.docx` requirements — not just green unit tests.

---

## File Structure

| File | Responsibility | Workstream |
|---|---|---|
| `src/lib/spec-builder/mint-uuids.ts` (new) | `mintHierarchyUuids` — deterministic UUID minting over a V2 hierarchy | A |
| `src/lib/spec-builder/register-to-hierarchy.ts` (new) | `registerToHierarchy(tags)` — register tags → `HierarchyV2` (real IO, minted UUIDs) | A |
| `src/lib/spec-builder/register-mapping.ts` (new) | mapping-pass prompt + `runRegisterMappingPass()` + Zod response schema + id-validation | B |
| `src/lib/spec-builder/assemble-register-contract.ts` (new) | `assembleContractFromRegister(hierarchy, mapping, header)` → `SpecContractV2` + per-EM requirements | A/B |
| `src/lib/spec-builder/ai-ingest.ts` | `.docx`-only hardening: mint UUIDs + force `schema_version=3` in post-process | C |
| `src/lib/spec-builder/docx-ingest.ts` | route register-aware vs `.docx`-only; thread register in | C |
| `src/hooks/use-spec-ingest.ts` | load the project's `upload` register, pass to `ingestDocx` | C |
| `src/routes/spec-builder-ingest-review.tsx` | register-present rendering + coverage; persist per-EM requirements | C/E |
| `supabase/migrations/<ts>_source_sections_em_binding.sql` (new) | add `spec_source_sections.equipment_module_id` | D |
| `src/hooks/use-source-sections.ts` | query sections by `equipment_module_id` | D |
| `src/lib/spec-builder/source-section-select.ts` | delete (name-matching no longer used) | D |
| `src/hooks/use-fds-conversation.ts` | fetch EM-bound sections by id instead of name-select | D |
| `src/routes/spec-co-author.tsx` | remove merge `useEffect` + banner | D |
| `src/lib/spec-builder/merge-register-hierarchy.ts` (+ test) | delete | D |

**Execution order:** A (pure helpers) → B (mapping pass) → C (ingest wiring) → D (remove/rekey) → E (review UX) → real-data validation. A's helpers have no dependencies and come first.

---

## Workstream A — Deterministic helpers

### Task A1: `mintHierarchyUuids`

**Files:**
- Create: `src/lib/spec-builder/mint-uuids.ts`
- Test: `src/lib/spec-builder/__tests__/mint-uuids.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mintHierarchyUuids, isUuid } from "@/lib/spec-builder/mint-uuids";
import type { Hierarchy } from "@/types/spec-contract-v2";

const UUID = "00000000-0000-4000-8000-000000000001";

function hier(): Hierarchy {
  return {
    units: [{
      unit_id: "UNGROUPED", unit_name: "Segment Wagon", equipment_type: "Other",
      description: "", excluded: false,
      equipment_modules: [{
        equipment_module_id: "Carriage Drive", equipment_module_name: "Carriage Drive", description: "",
        control_modules: [{
          control_module_id: "CM1", control_module_name: "CM1", control_module_class: "motor",
          is_safety: false, description: "",
          io_signals: [{ tag: "CM1_Run", signal_type: "DI", io_address: "%I0.0", description: "run", source: "wired" }],
        }],
      }],
    }],
  } as unknown as Hierarchy;
}

describe("mintHierarchyUuids", () => {
  it("replaces non-UUID ids with UUIDs and keeps names + IO", () => {
    const out = mintHierarchyUuids(hier());
    const u = out.units[0];
    expect(isUuid(u.unit_id)).toBe(true);
    expect(u.unit_name).toBe("Segment Wagon");
    const em = u.equipment_modules[0];
    expect(isUuid(em.equipment_module_id)).toBe(true);
    expect(em.equipment_module_name).toBe("Carriage Drive");
    const cm = em.control_modules[0];
    expect(isUuid(cm.control_module_id)).toBe(true);
    expect(cm.io_signals[0].tag).toBe("CM1_Run");
  });

  it("leaves already-valid UUID ids untouched (idempotent on UUIDs)", () => {
    const h = hier();
    h.units[0].unit_id = UUID;
    const out = mintHierarchyUuids(h);
    expect(out.units[0].unit_id).toBe(UUID);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/spec-builder/__tests__/mint-uuids.test.ts` (not a function).

- [ ] **Step 3: Implement**

```ts
import type { Hierarchy } from "@/types/spec-contract-v2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}

const mint = (v: string) => (isUuid(v) ? v : crypto.randomUUID());

/** Deterministically ensure every unit/EM/CM id in a V2 hierarchy is a UUID.
 *  Idempotent: ids that are already valid UUIDs are preserved. Names + IO untouched. */
export function mintHierarchyUuids(hierarchy: Hierarchy): Hierarchy {
  return {
    units: hierarchy.units.map((u) => ({
      ...u,
      unit_id: mint(u.unit_id),
      equipment_modules: u.equipment_modules.map((em) => ({
        ...em,
        equipment_module_id: mint(em.equipment_module_id),
        control_modules: em.control_modules.map((cm) => ({
          ...cm,
          control_module_id: mint(cm.control_module_id),
        })),
      })),
    })),
  };
}
```

- [ ] **Step 4: Run → PASS** — same command. Then `npx tsc -b` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/mint-uuids.ts src/lib/spec-builder/__tests__/mint-uuids.test.ts
git commit -m "feat(spec-builder): deterministic UUID minting for V2 hierarchy"
```

### Task A2: `registerToHierarchy`

**Files:**
- Create: `src/lib/spec-builder/register-to-hierarchy.ts`
- Test: `src/lib/spec-builder/__tests__/register-to-hierarchy.test.ts`

Background: `buildHierarchyFromTags(tags)` (in `instrument-parser.ts`) returns `UnitConfig[]`
(unit → equipment_modules → control_modules → io_signals) grouping by the register's
`equipment_module` column and tag device-prefixes. `UnitConfig`/`EquipmentModuleConfig`/
`ControlModuleConfig` are structurally compatible with `UnitV2`/`EquipmentModuleV2`/
`ControlModuleV2` except `IoSignal` lacks the required `source` field. This helper converts +
mints UUIDs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { registerToHierarchy } from "@/lib/spec-builder/register-to-hierarchy";
import { isUuid } from "@/lib/spec-builder/mint-uuids";
import type { InstrumentTag } from "@/types/spec-builder";

function tag(t: string, em: string): InstrumentTag {
  return {
    tag: t, device_type: "", description: t, signal_type: "DI", io_address: "%I0.0",
    control_module_class: "motor", signal_direction: "DI", unit_prefix: "", is_safety: false,
    process_cell: "", unit: "", equipment_module: em, control_module: "",
  };
}

describe("registerToHierarchy", () => {
  it("builds real EMs/CMs from tags with minted UUIDs and source-tagged IO", () => {
    const tags = [tag("CM1_Run", "Carriage Drive"), tag("CM1_Fault", "Carriage Drive"), tag("VSD1_Speed_Ref", "Carriage Drive")];
    const h = registerToHierarchy(tags);
    const em = h.units[0].equipment_modules.find((e) => e.equipment_module_name === "Carriage Drive")!;
    expect(em).toBeTruthy();
    expect(isUuid(em.equipment_module_id)).toBe(true);
    // CM1_Run + CM1_Fault group onto one control module; VSD1 is its own
    const cmNames = em.control_modules.map((c) => c.control_module_id);
    expect(cmNames.every(isUuid)).toBe(true);
    const allSignals = em.control_modules.flatMap((c) => c.io_signals);
    expect(allSignals.every((s) => s.source === "wired")).toBe(true);
    expect(allSignals.map((s) => s.tag)).toContain("CM1_Run");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { InstrumentTag } from "@/types/spec-builder";
import type { Hierarchy } from "@/types/spec-contract-v2";
import { buildHierarchyFromTags } from "@/lib/spec-builder/instrument-parser";
import { mintHierarchyUuids } from "@/lib/spec-builder/mint-uuids";

/** Register tags → V2 hierarchy: real EMs/CMs/IO from buildHierarchyFromTags,
 *  IO tagged source="wired", all ids minted to UUIDs. */
export function registerToHierarchy(tags: InstrumentTag[]): Hierarchy {
  const units = buildHierarchyFromTags(tags);
  const v2: Hierarchy = {
    units: units.map((u) => ({
      unit_id: u.unit_id,
      unit_name: u.unit_name,
      equipment_type: u.equipment_type,
      description: u.description,
      excluded: u.excluded,
      equipment_modules: u.equipment_modules.map((em) => ({
        equipment_module_id: em.equipment_module_id,
        equipment_module_name: em.equipment_module_name,
        description: em.description,
        control_modules: em.control_modules.map((cm) => ({
          control_module_id: cm.control_module_id,
          control_module_name: cm.control_module_name,
          control_module_class: cm.control_module_class,
          is_safety: cm.is_safety,
          description: cm.description,
          io_signals: cm.io_signals.map((s) => ({
            tag: s.tag, signal_type: s.signal_type, io_address: s.io_address,
            description: s.description, source: "wired" as const,
          })),
        })),
      })),
    })),
  } as unknown as Hierarchy;
  return mintHierarchyUuids(v2);
}
```

- [ ] **Step 4: Run → PASS.** `npx tsc -b` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/register-to-hierarchy.ts src/lib/spec-builder/__tests__/register-to-hierarchy.test.ts
git commit -m "feat(spec-builder): build V2 hierarchy from register tags"
```

---

## Workstream B — Mapping pass

### Task B1: mapping-pass prompt, schema, and id-validation

**Files:**
- Create: `src/lib/spec-builder/register-mapping.ts`
- Test: `src/lib/spec-builder/__tests__/register-mapping.test.ts`

The pure, testable part is the **response parser + id-validation guard**. The model call
itself is thin and validated separately on real data.

Response shape the model must return:
```ts
// { unit_name?: string,
//   modules: Array<{ equipment_module_id: string; source_requirements: string }>,
//   states: OperatingStateV2[], faults: FaultRow[], process_model: ProcessModel | null }
```

- [ ] **Step 1: Write the failing test (parser + guard)**

```ts
import { describe, it, expect } from "vitest";
import { parseMappingResponse } from "@/lib/spec-builder/register-mapping";

const validIds = new Set(["em-uuid-1", "em-uuid-2"]);

describe("parseMappingResponse", () => {
  it("keeps modules whose ids were provided, drops unknown ids", () => {
    const raw = JSON.stringify({
      unit_name: "Segment Wagon",
      modules: [
        { equipment_module_id: "em-uuid-1", source_requirements: "Rail movement..." },
        { equipment_module_id: "HALLUCINATED", source_requirements: "nope" },
      ],
      states: [], faults: [], process_model: null,
    });
    const { mapping, droppedIds } = parseMappingResponse(raw, validIds);
    expect(mapping.modules.map((m) => m.equipment_module_id)).toEqual(["em-uuid-1"]);
    expect(droppedIds).toEqual(["HALLUCINATED"]);
    expect(mapping.unit_name).toBe("Segment Wagon");
  });

  it("tolerates fenced ```json and surrounding prose", () => {
    const raw = "Here:\n```json\n{\"modules\":[],\"states\":[],\"faults\":[],\"process_model\":null}\n```";
    const { mapping } = parseMappingResponse(raw, validIds);
    expect(mapping.modules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (`register-mapping.ts`) — prompt builder, response Zod schema, parser+guard, and the model call:

```ts
import { z } from "zod";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import { OperatingStateV2Schema, FaultRowSchema, ProcessModelSchema } from "@/types/spec-contract-v2";
import type { Hierarchy } from "@/types/spec-contract-v2";

const MappingResponseSchema = z.object({
  unit_name: z.string().optional(),
  modules: z.array(z.object({
    equipment_module_id: z.string(),
    source_requirements: z.string(),
  })),
  states: z.array(OperatingStateV2Schema).default([]),
  faults: z.array(FaultRowSchema).default([]),
  process_model: ProcessModelSchema.nullable().default(null),
});
export type MappingResponse = z.infer<typeof MappingResponseSchema>;

function stripFence(s: string): string {
  let c = s.trim().replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim();
  if (!c.startsWith("{")) { const i = c.indexOf("{"); if (i >= 0) c = c.slice(i); }
  return c;
}

/** Parse the model response and DROP any module id we did not provide. */
export function parseMappingResponse(
  raw: string, validIds: Set<string>,
): { mapping: MappingResponse; droppedIds: string[] } {
  const parsed = MappingResponseSchema.parse(JSON.parse(stripFence(raw)));
  const droppedIds: string[] = [];
  const modules = parsed.modules.filter((m) => {
    const ok = validIds.has(m.equipment_module_id);
    if (!ok) droppedIds.push(m.equipment_module_id);
    return ok;
  });
  return { mapping: { ...parsed, modules }, droppedIds };
}

export function buildMappingPrompt(hierarchy: Hierarchy, docText: string): { system: string; user: string } {
  const emList = hierarchy.units.flatMap((u) =>
    u.equipment_modules.map((em) => {
      const cms = em.control_modules.map((cm) =>
        `    - ${cm.control_module_name} [${cm.control_module_class}] tags: ${cm.io_signals.map((s) => s.tag).join(", ")}`,
      ).join("\n");
      return `  equipment_module_id "${em.equipment_module_id}" — ${em.equipment_module_name}\n${cms}`;
    }),
  ).join("\n");

  const system = `You map an industrial functional specification onto an EXISTING, FIXED equipment hierarchy.
RULES:
- The equipment modules and their ids below are FIXED. You MUST NOT invent modules, control modules, tags, or ids.
- For each equipment_module_id, extract the requirements from the document relevant to THAT module. Use the control-module names and tag codes (CM=contactor/motor, VSD=variable speed drive, BR=brake resistor, SR=safety relay, MS=maintenance switch, M#=motor) to decide what belongs where.
- Also extract machine-level operating states, faults, and (if present) a process_model, plus a suggested unit_name.
- Return ONLY JSON: { "unit_name": string, "modules": [{ "equipment_module_id": <one of the ids above>, "source_requirements": string }], "states": [...], "faults": [...], "process_model": null | {...} }.`;

  const user = `FIXED EQUIPMENT HIERARCHY:\n${emList}\n\n--- FUNCTIONAL SPECIFICATION ---\n${docText}\n--- END ---`;
  return { system, user };
}

const MAPPING_MODEL = "claude-opus-4-8";

export async function runRegisterMappingPass(
  hierarchy: Hierarchy, docText: string, abortSignal: AbortSignal,
): Promise<{ mapping: MappingResponse; droppedIds: string[] }> {
  const validIds = new Set(
    hierarchy.units.flatMap((u) => u.equipment_modules.map((em) => em.equipment_module_id)),
  );
  const { system, user } = buildMappingPrompt(hierarchy, docText);
  const { content } = await streamFromEdgeFunction(
    { system_prompt: system, messages: [{ role: "user", content: user }], stream: true, model: MAPPING_MODEL },
    abortSignal,
    () => {},
    16384,
    { prompt_name: "spec-register-mapping", agent_role: "spec_analysis", pipeline_step: "spec_ingest" },
  );
  return parseMappingResponse(content, validIds);
}
```

> Verify the exact `streamFromEdgeFunction` argument order against `use-generation.ts` when implementing (body, abortSignal, onChunk, maxTokens, plMeta) and adjust if it differs.

- [ ] **Step 4: Run → PASS** (parser test). `npx tsc -b` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/register-mapping.ts src/lib/spec-builder/__tests__/register-mapping.test.ts
git commit -m "feat(spec-builder): register-aware mapping pass (Opus) + validated parser"
```

### Task B2: `assembleContractFromRegister`

**Files:**
- Create: `src/lib/spec-builder/assemble-register-contract.ts`
- Test: `src/lib/spec-builder/__tests__/assemble-register-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assembleContractFromRegister } from "@/lib/spec-builder/assemble-register-contract";
import type { Hierarchy } from "@/types/spec-contract-v2";
import type { MappingResponse } from "@/lib/spec-builder/register-mapping";

const hierarchy = {
  units: [{
    unit_id: "u1", unit_name: "UNGROUPED", equipment_type: "Other", description: "", excluded: false,
    equipment_modules: [{
      equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
      control_modules: [], 
    }],
  }],
} as unknown as Hierarchy;

const mapping: MappingResponse = {
  unit_name: "Segment Wagon",
  modules: [{ equipment_module_id: "em1", source_requirements: "Driven by 4 Demag wheels..." }],
  states: [], faults: [], process_model: null,
};

describe("assembleContractFromRegister", () => {
  it("applies unit_name and returns per-EM requirements bound by id", () => {
    const { contract, emRequirements } = assembleContractFromRegister(hierarchy, mapping, { title: "Herrenknecht" });
    expect(contract.schema_version).toBe(3);
    expect(contract.hierarchy.units[0].unit_name).toBe("Segment Wagon");
    expect(emRequirements).toEqual([{ equipment_module_id: "em1", requirements: "Driven by 4 Demag wheels..." }]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { Hierarchy, SpecContractV2 } from "@/types/spec-contract-v2";
import type { MappingResponse } from "@/lib/spec-builder/register-mapping";

export interface EmRequirement { equipment_module_id: string; requirements: string; }

/** Combine the deterministic register hierarchy with the model mapping into a
 *  SpecContractV2 draft. Structure is never altered by the model: only unit_name,
 *  states, faults, process_model are taken from the mapping. Per-EM requirements
 *  are returned separately for storage in spec_source_sections. */
export function assembleContractFromRegister(
  hierarchy: Hierarchy,
  mapping: MappingResponse,
  header: { title: string },
): { contract: SpecContractV2; emRequirements: EmRequirement[] } {
  const units = hierarchy.units.map((u) => ({
    ...u,
    unit_name: mapping.unit_name?.trim() ? mapping.unit_name : u.unit_name,
  }));

  const contract = {
    schema_version: 3,
    project: { title: header.title, doc_code: "", revision: "", plc_model: null },
    hierarchy: { units },
    states: mapping.states,
    alarm_tiers: [],
    faults: mapping.faults,
    process_model: mapping.process_model,
  } as unknown as SpecContractV2;

  const emRequirements = mapping.modules.map((m) => ({
    equipment_module_id: m.equipment_module_id,
    requirements: m.source_requirements,
  }));

  return { contract, emRequirements };
}
```

> The `project` header fields must satisfy `SpecProjectHeaderSchema`. When implementing,
> open `src/types/spec-contract-v2.ts`, read `SpecProjectHeaderSchema`, and fill exactly its
> required fields (mirror what `ai-ingest.ts` builds for `project`). Adjust the literal above
> to match — do not leave fields the schema requires unset.

- [ ] **Step 4: Run → PASS.** `npx tsc -b` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/assemble-register-contract.ts src/lib/spec-builder/__tests__/assemble-register-contract.test.ts
git commit -m "feat(spec-builder): assemble SpecContractV2 from register + mapping"
```

---

## Workstream C — Ingest wiring

### Task C1: Migration — `spec_source_sections.equipment_module_id`

**Files:**
- Create: `supabase/migrations/<timestamp>_source_sections_em_binding.sql` (use a timestamp version like the existing `20260617*` files; apply via Supabase MCP `apply_migration` and name the file to match the recorded version)

- [ ] **Step 1: Write + apply**

```sql
ALTER TABLE spec_source_sections
  ADD COLUMN IF NOT EXISTS equipment_module_id uuid;
CREATE INDEX IF NOT EXISTS idx_spec_source_sections_em
  ON spec_source_sections (equipment_module_id);
```

Apply to the live Pac-Forge-v2 project (`fsxfdkjjkbkzjntjxiyi`) via `apply_migration`, then name the repo file to match the version it records.

- [ ] **Step 2: Verify** the column exists (`information_schema.columns`). 
- [ ] **Step 3: Commit** the migration file.

### Task C2: `.docx`-only hardening (mint UUIDs + schema_version)

**Files:**
- Modify: `src/lib/spec-builder/ai-ingest.ts` (the `postProcess` / pre-return section)

- [ ] **Step 1:** After `postProcess` produces the draft and before validation, mint UUIDs over `draft.hierarchy` and force `schema_version`:

```ts
import { mintHierarchyUuids } from "@/lib/spec-builder/mint-uuids";
// ... after postProcessed is built:
postProcessed.hierarchy = mintHierarchyUuids(postProcessed.hierarchy);
(postProcessed as { schema_version: number }).schema_version = 3;
```

- [ ] **Step 2:** `npx tsc -b` → 0. Run existing ingest-related tests (`npx vitest run src/lib/spec-builder`) — pre-existing failures (`migration-integration`, `spec-contract-v2`) unchanged; nothing new.
- [ ] **Step 3: Commit** — `fix(spec-builder): mint UUIDs + force schema_version=3 in docx ingest`.

### Task C3: Register-aware routing in `ingestDocx` + `useSpecIngest`

**Files:**
- Modify: `src/lib/spec-builder/docx-ingest.ts` (`ingestDocx` gains an optional register param; new `ai` result still carries `sourceSections`/`sourceFilename`; add `emRequirements` to the `ai` variant)
- Modify: `src/hooks/use-spec-ingest.ts` (load the `upload` register for the project, pass it in)

- [ ] **Step 1: Extend `ingestDocx`** to `ingestDocx(file, registerTags?: InstrumentTag[])`. In the AI branch, when `registerTags?.length`:
  - `const hierarchy = registerToHierarchy(registerTags);`
  - `const { mapping, droppedIds } = await runRegisterMappingPass(hierarchy, rawText, abort.signal);`
  - `const { contract, emRequirements } = assembleContractFromRegister(hierarchy, mapping, { title: file.name });`
  - return `{ kind: "ai", draft: contract, warnings: droppedIds.map(id => ({ path: "modules", message: \`dropped unknown id \${id}\` })), sourceSections, sourceFilename: file.name, emRequirements }`.
  When no register tags: the existing `aiIngestDocx` path (now hardened by C2), with `emRequirements: []`.

- [ ] **Step 2: In `use-spec-ingest`**, before `ingestDocx(file)`, load the project's upload register and pass its tags:
```ts
const { data: reg } = await supabase.from("instrument_registers")
  .select("tags").eq("spec_project_id", specProjectId).eq("source", "upload").maybeSingle();
const result = await ingestDocx(file, (reg?.tags ?? []) as InstrumentTag[]);
```
Thread `emRequirements` through the parked store (add to `ParkedAiIngest`).

- [ ] **Step 3:** `npx tsc -b` → 0.
- [ ] **Step 4: Commit** — `feat(spec-builder): register-aware ingest routing`.

### Task C4: Persist per-EM requirements on commit

**Files:**
- Modify: `src/routes/spec-builder-ingest-review.tsx` (commit handler)

- [ ] **Step 1:** Replace the existing whole-doc section insert with per-EM requirement rows when `parked.emRequirements?.length`:
```ts
await supabase.from("spec_source_sections").delete().eq("spec_project_id", specProjectId);
if (parked.emRequirements?.length) {
  await supabase.from("spec_source_sections").insert(
    parked.emRequirements.map((r, i) => ({
      spec_project_id: specProjectId,
      source_filename: parked.sourceFilename || "ingest.docx",
      equipment_module_id: r.equipment_module_id,
      heading: "", body: r.requirements, order_index: i,
    })),
  );
} else if (parked.sourceSections?.length) {
  // .docx-only fallback: raw sections, no EM binding
  await supabase.from("spec_source_sections").insert(/* existing mapping, equipment_module_id: null */);
}
```
Keep the existing hydrate (`useUpdateSpecProject` with `draft.hierarchy.units`/`states`/`alarm_tiers`) and synthesize-register-when-no-upload steps.

- [ ] **Step 2:** `npx tsc -b` → 0.
- [ ] **Step 3: Commit** — `feat(spec-builder): persist per-EM source requirements on commit`.

---

## Workstream D — Remove / rekey

### Task D1: Re-key source-section injection by EM id

**Files:**
- Modify: `src/hooks/use-source-sections.ts` (add a by-EM query)
- Modify: `src/hooks/use-fds-conversation.ts` (use EM-id query; drop `selectRelevantSections`)
- Delete: `src/lib/spec-builder/source-section-select.ts` + its test

- [ ] **Step 1:** In `use-source-sections.ts` add:
```ts
export function useSourceSectionsForEm(specProjectId: string | undefined, equipmentModuleId: string | undefined) {
  return useQuery({
    queryKey: ["source-sections-em", specProjectId, equipmentModuleId],
    enabled: !!specProjectId && !!equipmentModuleId,
    queryFn: async () => {
      const { data, error } = await supabase.from("spec_source_sections")
        .select("heading, body, order_index")
        .eq("spec_project_id", specProjectId!).eq("equipment_module_id", equipmentModuleId!)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { heading: string; body: string; order_index: number }[];
    },
  });
}
```
- [ ] **Step 2:** In `use-fds-conversation.ts`, replace the `selectRelevantSections(sourceSections, equipment_module)` call with `useSourceSectionsForEm(session.spec_project_id, equipment_module.equipment_module_id)` and pass those sections straight to `buildFdsInterviewSystemPrompt`. Remove the `selectRelevantSections` import.
- [ ] **Step 3:** Delete `source-section-select.ts` and `__tests__/source-section-select.test.ts`.
- [ ] **Step 4:** `npx tsc -b` → 0; `npx vitest run src/lib/spec-builder src/hooks` → no new failures.
- [ ] **Step 5: Commit** — `refactor(fds): bind co-author sections by equipment_module_id`.

### Task D2: Delete the co-author merge

**Files:**
- Modify: `src/routes/spec-co-author.tsx` (remove the merge `useMemo`/`useEffect`/banner + imports)
- Delete: `src/lib/spec-builder/merge-register-hierarchy.ts` + `__tests__/merge-register-hierarchy.test.ts`

- [ ] **Step 1:** Remove from `spec-co-author.tsx`: the `mergeRegisterIntoHierarchy`/`MergeReport`/`UnitConfig`/`InstrumentTag`/`SpecProjectUpdate` imports added for the merge, the `mergeResult` memo, the persist `useEffect`, and the "Register merge" banner block. Keep everything else.
- [ ] **Step 2:** Delete `merge-register-hierarchy.ts` + its test. (Note: `extractDevicePrefix` stays exported — `register-to-hierarchy`/`buildHierarchyFromTags` still rely on the parser; only the merge helper goes.)
- [ ] **Step 3:** `npx tsc -b` → 0; `npx eslint src/routes/spec-co-author.tsx` → clean; `npx vitest run src/lib/spec-builder` → no new failures.
- [ ] **Step 4: Commit** — `refactor(fds): remove brittle post-hoc register merge`.

---

## Workstream E — Review UX + validation

### Task E1: Register-present review rendering + coverage

**Files:**
- Modify: `src/routes/spec-builder-ingest-review.tsx`

- [ ] **Step 1:** When `parked.emRequirements?.length`, render under each EM a one-line summary of its bound requirements (first ~140 chars), and a coverage strip above the tree:
```
N mapped · M without document content · K document areas dropped
```
where `N = emRequirements.length`, `M = (total EMs) − N`, `K = parked` dropped-id warnings count.
Keep names editable. `.docx`-only rendering unchanged.
- [ ] **Step 2:** `npx tsc -b` → 0; `npx eslint src/routes/spec-builder-ingest-review.tsx` → clean.
- [ ] **Step 3: Commit** — `feat(spec-builder): register-present ingest review with coverage`.

### Task E2: Real-data validation (the completion bar)

**Files:** none (manual, documented in the PR/commit message).

- [ ] **Step 1:** Start the app (`npm run dev`). Open project `ff8fd8cf-cae9-4f93-b8f5-5176ca8d0bb3` (Herrenknecht / Segment Wagon, register present with 51 tags).
- [ ] **Step 2:** Import the real `.docx`: `Docs/Functional Specs/Herrenknecht/Updated Functional Description - Segment Wagon SRL S-1427_28 rev B.docx`.
- [ ] **Step 3:** On the review page, verify: the hierarchy is the **register's** EMs (Carriage Drive, Rotator Drive, E-Stop Circuit, Travel Indicators, Power Distribution, Spare…), the coverage line shows most EMs mapped, and `Carriage Drive` carries the Rail-Movement requirements, `Rotator Drive` the Segment-Rotator requirements, `E-Stop Circuit` the e-stop/maintenance/safety requirements.
- [ ] **Step 4:** Create draft. Verify with SQL: `confirmed_units` length > 0, and `spec_source_sections` has rows with non-null `equipment_module_id` matching the hierarchy EM ids.
- [ ] **Step 5:** Open the co-author for `Carriage Drive`; confirm the system prompt includes its Rail-Movement requirements (no "Unassigned" dumping of the 51 tags).
- [ ] **Step 6:** Record the outcome (pass/fail + screenshots) in the final commit message. Only then is the feature complete.

---

## Self-review checklist (author)

- **Spec coverage:** §1 register-present → A2/B1/B2/C3; §2 .docx-only hardening → C2; §3 removed merge → D2, Gap2 rekey → C1/C4/D1, UUID mint helper → A1, id-guard → B1; §4 review UX → E1; §5 model → B1 (`claude-opus-4-8`), tests → A/B tasks, real-data validation → E2. All covered.
- **No placeholders:** helper tasks carry full code; integration tasks carry concrete diffs. Two explicit "verify against the real schema/signature when implementing" notes (`SpecProjectHeaderSchema`, `streamFromEdgeFunction` arg order) are deliberate guards, not placeholders.
- **Type consistency:** `Hierarchy` (V2), `MappingResponse`, `EmRequirement`, `mintHierarchyUuids`, `registerToHierarchy`, `runRegisterMappingPass`, `parseMappingResponse`, `assembleContractFromRegister` names are used consistently across tasks.
