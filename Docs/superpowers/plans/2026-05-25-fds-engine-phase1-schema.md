# FDS Engine — Phase 1 Implementation Plan: Schema + Writer/Validator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the new V2 contract schema (modes, PackML states, structured subsystem orchestration, configuration parameters, project-level section overrides, override-kind) along with writer/validator rules and the activated boundary lint. After this phase, the contract layer accepts the new shapes but no UI consumes them yet; the wizard, prompt rewrite, monitor picker, and materialised view come in later phases.

**Architecture:** Pure schema/library work. New nullable columns on `spec_projects`; Zod additions in `src/types/spec-contract-v2.ts`; validator + patch-routing extensions in `src/lib/spec-builder/contract.ts`. Legacy-shim path in `loadSpecContract` keeps unconfirmed projects readable on the legacy shape. ESLint flat-config gains a `no-restricted-imports` rule that blocks `writeSpecContract` from being imported by forge modules.

**Tech Stack:** TypeScript 5.9, Zod (existing), Supabase Postgres (SQL migration), Vitest (testing), ESLint flat config.

**Parent design:** `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` (§2.3, §3, §5 partially)

**Out of scope for Phase 1** (covered by later phases): migration wizard UI; AI interlock classifier; V2 interview prompt rewrite; monitor picker UI; materialised `spec_sections` rebuild; mode wizard UI + matrix tabs; ISA-88 docs pass.

---

## Pre-flight

Verify the working tree is clean and the test runner works before starting:

```bash
git status                                  # expect clean tree on a feature/* branch
npm test -- --run                           # expect existing tests to pass
```

If the assembly-FB-library branch has not yet merged to master (Release N), pause and resolve that first. Phase 1 builds on the post-merge schema; the migration number this plan uses (080) collides with that branch if it has not landed.

---

## File Structure

**Files to create:**

- `supabase/migrations/080_fds_engine_phase1.sql` — adds nullable columns to `spec_projects`; no data rewrite at deploy time
- `src/types/__tests__/spec-contract-v2.test.ts` — Zod schema tests for every new type
- `src/lib/spec-builder/__tests__/contract.test.ts` — validator and patch-routing tests

**Files to modify:**

- `src/types/spec-contract-v2.ts` — add `OperatorMode`, `ConfigParameter`, `ProjectSectionContent`; extend `OperatingStateV2` (PackML); lift `SubsystemStateSequence` + `InterAssemblyInterlock`; add `override_kind` discriminator; add `parameter_ref` to `ExpressionSchema`; extend `SpecContractV2Schema` top-level
- `src/lib/spec-builder/contract.ts` — extend `SpecContractPatch` type; extend `validateSpecContractPatch`; extend `writeSpecContract` patch routing; extend `loadSpecContract` to branch on `confirmation_status`
- `eslint.config.js` — add `no-restricted-imports` rule for forge modules
- `Docs/superpowers/plans/2026-05-25-fds-engine-phase1-schema.md.tasks.json` — created by the runner

---

## Conventions

- **Test colocation:** `__tests__/` directories next to source. File name = `<source>.test.ts`. Picked up automatically by the vitest config at `vitest.config.ts`.
- **Migration numbering:** the next free number on master after the assembly-FB-library merge. The plan uses `080`. If the merge has shifted this, rename the file and re-issue the migration in the wizard task.
- **Legacy-shim invariant:** during Phase 1, `legacy_shim_enabled` defaults `true`. Unconfirmed projects (`confirmation_status = 'unconfirmed'`) read through the shim and emit the legacy contract shape. Confirmed projects read the new shape. Phase 1 does NOT flip any project to confirmed (that's the wizard's job in Phase 2).
- **Commit cadence:** one commit per task. Commit messages use `feat(fds-engine):` for schema/validator additions, `test(fds-engine):` for test-only commits.

---

### Task 1: Migration — add nullable columns to `spec_projects`

**Files:**
- Create: `supabase/migrations/080_fds_engine_phase1.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/080_fds_engine_phase1.sql
-- FDS Engine Phase 1 — add nullable columns for modes, configuration parameters,
-- project-level section overrides, and per-project confirmation status.
-- No data rewrite. Existing projects remain on legacy shape until the
-- per-project confirmation wizard (Phase 2) lands and writes the new shape.

BEGIN;

-- Modes axis (§3.1 of design doc). NULL = legacy project; will be populated
-- with [{mode_id:"auto", name:"Auto", is_default:true}] by the wizard.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS confirmed_modes jsonb;

-- Configuration parameters (§3.4). NULL = legacy / no parameters.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS configuration_parameters jsonb;

-- Project-level section overrides (§3.5). One JSONB keyed by ProjectSectionType.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS section_overrides jsonb;

-- Per-project confirmation gate (§5). 'unconfirmed' (default) routes reads
-- through the legacy shim; 'confirmed' reads the new structured shape.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS confirmation_status text
    NOT NULL DEFAULT 'unconfirmed'
    CHECK (confirmation_status IN ('unconfirmed', 'confirmed'));

COMMENT ON COLUMN spec_projects.confirmed_modes IS
  'OperatorMode[]: project-level operating modes (auto/manual/service/...). NULL on unconfirmed projects.';
COMMENT ON COLUMN spec_projects.configuration_parameters IS
  'ConfigParameter[]: discrete-enum project-level switches referenced via Expression.parameter_ref.';
COMMENT ON COLUMN spec_projects.section_overrides IS
  'Record<ProjectSectionType, ProjectSectionContent>: editable content for the six project-level section types.';
COMMENT ON COLUMN spec_projects.confirmation_status IS
  'Per-project migration gate: unconfirmed reads legacy shape via shim, confirmed reads new structured shape.';

COMMIT;
```

- [ ] **Step 2: Apply the migration to the local Supabase**

```bash
npx supabase db push
```

Expected: migration applies cleanly. No row count changes; only DDL.

- [ ] **Step 3: Verify the columns exist**

```bash
npx supabase db diff --schema public
```

Expected: no remaining diff (migration already applied). Manually verify by querying:

```bash
npx supabase db query "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='spec_projects' AND column_name IN ('confirmed_modes','configuration_parameters','section_overrides','confirmation_status');"
```

Expected: 4 rows. `confirmation_status` is `text`, NOT NULL, default `'unconfirmed'`. The other three are `jsonb`, nullable.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/080_fds_engine_phase1.sql
git commit -m "feat(fds-engine): migration 080 — phase 1 nullable columns on spec_projects"
```

---

### Task 2: `OperatorMode` Zod schema + tests

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (add new schema)
- Create: `src/types/__tests__/spec-contract-v2.test.ts` (new test file)

- [ ] **Step 1: Write the failing test**

Create `src/types/__tests__/spec-contract-v2.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { OperatorModeSchema } from "../spec-contract-v2";

describe("OperatorModeSchema", () => {
  it("accepts a valid default mode", () => {
    const mode = {
      mode_id: "auto",
      name: "Auto",
      description: "Fully automatic",
      is_default: true,
    };
    expect(() => OperatorModeSchema.parse(mode)).not.toThrow();
  });

  it("accepts a non-default mode without description", () => {
    const mode = { mode_id: "manual", name: "Manual", is_default: false };
    expect(() => OperatorModeSchema.parse(mode)).not.toThrow();
  });

  it("rejects empty mode_id", () => {
    const mode = { mode_id: "", name: "X", is_default: true };
    expect(() => OperatorModeSchema.parse(mode)).toThrow();
  });

  it("rejects missing is_default", () => {
    const mode = { mode_id: "auto", name: "Auto" };
    expect(() => OperatorModeSchema.parse(mode)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — `OperatorModeSchema` does not exist (import error).

- [ ] **Step 3: Add the schema**

In `src/types/spec-contract-v2.ts`, locate the `Primitives` section (near the top, after `StateIdSchema`). After the existing primitives, add a new section:

```ts
// ============================================================
// Operator modes (§3.1 — new in FDS Engine Phase 1)
// Project-level operating mode axis. Every state and orchestration
// row is keyed by (mode_id, state_id).
// ============================================================

export const OperatorModeSchema = z.object({
  mode_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  is_default: z.boolean(),
});
export type OperatorMode = z.infer<typeof OperatorModeSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): OperatorMode Zod schema"
```

---

### Task 3: `ConfigParameter` Zod schema + tests

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/types/__tests__/spec-contract-v2.test.ts`:

```ts
import { ConfigParameterSchema } from "../spec-contract-v2";

describe("ConfigParameterSchema", () => {
  it("accepts a parameter with discrete enum values", () => {
    const param = {
      parameter_id: "battery_chemistry",
      name: "Battery chemistry",
      allowed_values: ["LFP", "NMC"],
      default: "LFP",
      description: "Cathode material selection",
    };
    expect(() => ConfigParameterSchema.parse(param)).not.toThrow();
  });

  it("rejects when default is not in allowed_values", () => {
    const param = {
      parameter_id: "x",
      name: "X",
      allowed_values: ["A", "B"],
      default: "C",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow(/default/i);
  });

  it("rejects empty allowed_values", () => {
    const param = {
      parameter_id: "x",
      name: "X",
      allowed_values: [],
      default: "C",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow();
  });

  it("rejects empty parameter_id", () => {
    const param = {
      parameter_id: "",
      name: "X",
      allowed_values: ["A"],
      default: "A",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — `ConfigParameterSchema` does not exist.

- [ ] **Step 3: Add the schema**

In `src/types/spec-contract-v2.ts`, right after the `OperatorMode` block from Task 2, add:

```ts
// ============================================================
// Configuration parameters (§3.4 — new in FDS Engine Phase 1)
// Discrete-enum project-level switches. Substituted as string
// literals at expression evaluation time.
// ============================================================

export const ConfigParameterSchema = z
  .object({
    parameter_id: z.string().min(1),
    name: z.string().min(1),
    allowed_values: z.array(z.string()).min(1),
    default: z.string(),
    description: z.string().optional(),
  })
  .refine((p) => p.allowed_values.includes(p.default), {
    message: "default must be one of allowed_values",
    path: ["default"],
  });
export type ConfigParameter = z.infer<typeof ConfigParameterSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (8 tests total — Task 2's 4 + Task 3's 4).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): ConfigParameter Zod schema with default-in-allowed refinement"
```

---

### Task 4: Add `parameter_ref` variant to `ExpressionSchema`

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/types/__tests__/spec-contract-v2.test.ts`:

```ts
import { ExpressionSchema } from "../spec-contract-v2";

describe("ExpressionSchema parameter_ref variant", () => {
  it("accepts a parameter_ref expression", () => {
    const expr = { kind: "parameter_ref", parameter_id: "battery_chemistry" };
    expect(() => ExpressionSchema.parse(expr)).not.toThrow();
  });

  it("rejects parameter_ref without parameter_id", () => {
    const expr = { kind: "parameter_ref" };
    expect(() => ExpressionSchema.parse(expr)).toThrow();
  });

  it("rejects empty parameter_id", () => {
    const expr = { kind: "parameter_ref", parameter_id: "" };
    expect(() => ExpressionSchema.parse(expr)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — `parameter_ref` is not a discriminator key.

- [ ] **Step 3: Add the variant**

In `src/types/spec-contract-v2.ts`, locate the `Expressions` section (search for `ExpressionTagRefSchema`). Before the `export const ExpressionSchema = z.discriminatedUnion(...)` call, add:

```ts
const ExpressionParameterRefSchema = z.object({
  kind: z.literal("parameter_ref"),
  parameter_id: z.string().min(1),
});
```

Then extend the discriminated union:

```ts
export const ExpressionSchema = z.discriminatedUnion("kind", [
  ExpressionTagRefSchema,
  ExpressionHmiRefSchema,
  ExpressionLiteralSchema,
  ExpressionTextSchema,
  ExpressionPlaceholderSchema,
  ExpressionParameterRefSchema,
]);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): add parameter_ref variant to ExpressionSchema"
```

---

### Task 5: Extend `OperatingStateV2Schema` for PackML

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

This task widens `state_id` to accept either a legacy string (during the shim window) or a numeric PackML ID. New fields are additive and optional so existing rows still validate.

- [ ] **Step 1: Append failing tests**

```ts
import { OperatingStateV2Schema } from "../spec-contract-v2";

describe("OperatingStateV2Schema PackML extensions", () => {
  it("accepts a legacy string state_id (shim window)", () => {
    const state = {
      state_id: "ST03",
      state_name: "Execute",
      description: "Running",
      state_pattern: "sequential",
    };
    expect(() => OperatingStateV2Schema.parse(state)).not.toThrow();
  });

  it("accepts a PackML numeric state_id with packml_id", () => {
    const state = {
      state_id: 6,
      packml_id: 6,
      display_name: "Execute",
      description: "Running",
      state_pattern: "sequential",
    };
    expect(() => OperatingStateV2Schema.parse(state)).not.toThrow();
  });

  it("accepts a custom state with custom_name and state_id > 100", () => {
    const state = {
      state_id: 101,
      custom_name: "Lubrication cycle",
      display_name: "Lubrication cycle",
      description: "Site-specific",
      state_pattern: "static",
    };
    expect(() => OperatingStateV2Schema.parse(state)).not.toThrow();
  });

  it("rejects packml_id outside 1..17", () => {
    const state = {
      state_id: 99,
      packml_id: 99,
      display_name: "Bad",
      description: "x",
      state_pattern: "static",
    };
    expect(() => OperatingStateV2Schema.parse(state)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — numeric `state_id` is rejected by current `StateIdSchema`.

- [ ] **Step 3: Widen the schema**

In `src/types/spec-contract-v2.ts`, locate `OperatingStateV2Schema` (around line 250). Replace it with:

```ts
// state_id accepts either legacy string (shim window) or numeric (PackML 1..17
// or custom_states > 100). New fields are optional; existing rows still validate.
export const OperatingStateV2Schema = z.object({
  state_id: z.union([StateIdSchema, z.number().int().positive()]),
  // Legacy field — kept during shim window.
  state_name: z.string().optional(),
  // New display field (preferred post-confirmation).
  display_name: z.string().optional(),
  description: z.string(),
  state_pattern: StatePatternSchema,
  // New PackML fields (optional during shim window).
  packml_id: z.number().int().min(1).max(17).optional(),
  custom_name: z.string().optional(),
});
export type OperatingStateV2 = z.infer<typeof OperatingStateV2Schema>;
```

**⚠ Breaking change for downstream readers.** Making `state_name` optional and widening `state_id` to `string | number` means any consumer that destructures `state.state_name` or treats `state.state_id` as a string will fail type checking after this task. Expect compile errors at Task 18 Step 1. The fix at each call site is a small helper:

```ts
function stateLabel(s: OperatingStateV2): string {
  return s.display_name ?? s.state_name ?? s.custom_name ?? String(s.state_id);
}
function stateIdKey(s: OperatingStateV2): string {
  return typeof s.state_id === "number" ? String(s.state_id) : s.state_id;
}
```

Apply these at each call site (rather than centralising into one helper file) so the migration intent is visible at the consumer. Do not silently coerce in downstream code without going through these helpers.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (15 tests total). If any pre-existing test breaks because `state_name` is now optional, update those tests to assert the new shape — leave a comment referencing this task.

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): extend OperatingStateV2 for PackML (numeric IDs, packml_id, custom_name, display_name)"
```

---

### Task 6: Lift `InterAssemblyInterlockSchema` to structured

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { InterAssemblyInterlockSchema } from "../spec-contract-v2";

describe("InterAssemblyInterlockSchema structured shape", () => {
  it("accepts a structured interlock with closed-set effect and CompletionCriterion source", () => {
    const interlock = {
      interlock_id: "il-1",
      source_assembly: "CV01",
      source_condition: {
        kind: "tag_equals",
        tag: "CV01.RUNNING",
        value: true,
      },
      target_assembly: "LFT01",
      effect: "hold",
      prose: "Hold lift until conveyor is running",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).not.toThrow();
  });

  it("accepts effect_target for targeted effects", () => {
    const interlock = {
      interlock_id: "il-2",
      source_assembly: "CV01",
      source_condition: {
        kind: "tag_equals",
        tag: "CV01.FAULT",
        value: true,
      },
      target_assembly: "LFT01",
      effect: "block_transition",
      effect_target: { assembly: "LFT01", state_id: 5 },
      prose: "Block lift execute on conveyor fault",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).not.toThrow();
  });

  it("rejects effect outside the closed enum", () => {
    const interlock = {
      interlock_id: "il-3",
      source_assembly: "A",
      source_condition: { kind: "tag_equals", tag: "T", value: true },
      target_assembly: "B",
      effect: "wave-hands",
      prose: "x",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).toThrow();
  });

  it("rejects prose source_condition (the old shape)", () => {
    const interlock = {
      interlock_id: "il-4",
      source_assembly: "A",
      source_condition: "CV01 is running",
      target_assembly: "B",
      effect: "hold",
      prose: "x",
    };
    expect(() => InterAssemblyInterlockSchema.parse(interlock)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — current schema accepts prose `source_condition` and any-string `effect`.

- [ ] **Step 3: Lift the schema**

In `src/types/spec-contract-v2.ts`, locate `InterAssemblyInterlockSchema` (search for `source_assembly: z.string()`). Replace the existing definition with:

```ts
// Closed-set effect enum mirrors InterSubsystemInterlock at the system layer.
export const InterAssemblyInterlockEffectSchema = z.enum([
  "hold",
  "block_transition",
  "trigger",
  "enable",
  "disable",
]);
export type InterAssemblyInterlockEffect = z.infer<
  typeof InterAssemblyInterlockEffectSchema
>;

export const InterAssemblyInterlockSchema = z.object({
  interlock_id: z.string().min(1),
  source_assembly: z.string().min(1),
  source_condition: CompletionCriterionSchema,
  target_assembly: z.string().min(1),
  effect: InterAssemblyInterlockEffectSchema,
  effect_target: z
    .object({
      assembly: z.string().min(1),
      state_id: z.union([z.string(), z.number().int()]),
    })
    .optional(),
  prose: z.string(),
});
export type InterAssemblyInterlock = z.infer<typeof InterAssemblyInterlockSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (19 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): lift InterAssemblyInterlock — closed-set effect enum, structured source_condition"
```

---

### Task 7: Lift `SubsystemStateSequenceSchema.shared_permissives` to structured

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { SubsystemStateSequenceSchema } from "../spec-contract-v2";

describe("SubsystemStateSequenceSchema structured shared_permissives", () => {
  it("accepts SharedPermissive[] structured shape", () => {
    const seq = {
      assembly_order: ["CV01", "LFT01"],
      shared_permissives: [
        {
          permissive_id: "p1",
          condition: { kind: "tag_equals", tag: "ESTOP_01", value: false },
          prose: "E-stop not active",
        },
      ],
      inter_assembly_interlocks: [],
      notes: null,
    };
    expect(() => SubsystemStateSequenceSchema.parse(seq)).not.toThrow();
  });

  it("rejects prose string[] shared_permissives (the old shape)", () => {
    const seq = {
      assembly_order: ["CV01"],
      shared_permissives: ["ESTOP_01 = TRUE"],
      inter_assembly_interlocks: [],
      notes: null,
    };
    expect(() => SubsystemStateSequenceSchema.parse(seq)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — current schema is `z.array(z.string())`.

- [ ] **Step 3: Lift the schema**

In `src/types/spec-contract-v2.ts`, locate `SubsystemStateSequenceSchema` (search for `shared_permissives: z.array(z.string())`). Replace with:

```ts
export const SubsystemStateSequenceSchema = z.object({
  assembly_order: z.array(z.string()),
  shared_permissives: z.array(SharedPermissiveSchema),
  inter_assembly_interlocks: z.array(InterAssemblyInterlockSchema),
  notes: z.string().nullable(),
});
export type SubsystemStateSequence = z.infer<typeof SubsystemStateSequenceSchema>;
```

Note: `SharedPermissiveSchema` is already defined in this file (used by `SystemStateSequenceSchema`). The lift reuses the same shape — that is the point.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): lift SubsystemStateSequence.shared_permissives to SharedPermissive[]"
```

---

### Task 8: Add `override_kind` to `SequentialStateV2Schema`

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

The `override_kind` field disambiguates per-mode state rows (§4.4 of design). Default mode rows always have `override_kind: "override"`; non-default modes can inherit, override, or suppress.

- [ ] **Step 1: Append failing tests**

```ts
import { SequentialStateV2Schema } from "../spec-contract-v2";

describe("SequentialStateV2Schema override_kind", () => {
  const baseRow = {
    permissives: [],
    steps: [],
    notes: null,
  };

  it("accepts override_kind: override with steps", () => {
    const row = { ...baseRow, override_kind: "override" };
    expect(() => SequentialStateV2Schema.parse(row)).not.toThrow();
  });

  it("accepts override_kind: inherit with empty content", () => {
    const row = { ...baseRow, override_kind: "inherit" };
    expect(() => SequentialStateV2Schema.parse(row)).not.toThrow();
  });

  it("accepts override_kind: suppressed with empty content", () => {
    const row = { ...baseRow, override_kind: "suppressed" };
    expect(() => SequentialStateV2Schema.parse(row)).not.toThrow();
  });

  it("accepts omitted override_kind (defaults to override for legacy reads)", () => {
    expect(() => SequentialStateV2Schema.parse(baseRow)).not.toThrow();
  });

  it("rejects override_kind outside the enum", () => {
    const row = { ...baseRow, override_kind: "ignore" };
    expect(() => SequentialStateV2Schema.parse(row)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — `override_kind` not a known field.

- [ ] **Step 3: Add the field**

In `src/types/spec-contract-v2.ts`, find `SequentialStateV2Schema` and add `override_kind`:

```ts
export const OverrideKindSchema = z.enum(["inherit", "override", "suppressed"]);
export type OverrideKind = z.infer<typeof OverrideKindSchema>;

export const SequentialStateV2Schema = z.object({
  override_kind: OverrideKindSchema.optional(),  // defaults to "override" in readers
  permissives: z.array(PermissiveConditionSchema),
  steps: z.array(StepV2Schema),
  branches: z.array(BranchV2Schema).optional(),
  state_monitors: z.array(MonitorV2Schema).optional(),
  sequence_model_version: SequenceModelVersionSchema.optional(),
  notes: z.string().nullable(),
});
export type SequentialStateV2 = z.infer<typeof SequentialStateV2Schema>;
```

Add the same `override_kind` field at the row shape used for static states. Static states currently use `z.array(DeviceStateEntrySchema)` directly inside `AssemblyContractSchema.static_states: z.record(z.string(), z.array(DeviceStateEntrySchema))`. Wrap that in a new container:

```ts
export const StaticStateV2Schema = z.object({
  override_kind: OverrideKindSchema.optional(),
  devices: z.array(DeviceStateEntrySchema),
  notes: z.string().nullable().optional(),
});
export type StaticStateV2 = z.infer<typeof StaticStateV2Schema>;
```

Then update `AssemblyContractSchema.static_states` to accept either the legacy array shape OR the new container:

```ts
export const AssemblyContractSchema = z.object({
  assembly_id: UuidSchema,
  subsystem_id: UuidSchema,
  static_states: z.record(
    z.string(),
    z.union([z.array(DeviceStateEntrySchema), StaticStateV2Schema]),
  ),
  sequential_states: z.record(z.string(), SequentialStateV2Schema),
});
```

The union here is the shim — legacy rows still parse as bare arrays; post-confirmation rows parse as `StaticStateV2`. A later phase will collapse to `StaticStateV2` only.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (26 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): add override_kind (inherit/override/suppressed) to per-mode state rows"
```

---

### Task 9: `ProjectSectionContent` + project-level section type union

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import {
  ProjectSectionTypeSchema,
  ProjectSectionContentSchema,
} from "../spec-contract-v2";

describe("ProjectSectionTypeSchema", () => {
  it("accepts the six project-level section types", () => {
    [
      "document_control",
      "system_overview",
      "control_philosophy",
      "interfaces",
      "testing_fat",
      "hmi_specification",
    ].forEach((t) => {
      expect(() => ProjectSectionTypeSchema.parse(t)).not.toThrow();
    });
  });

  it("rejects per-assembly-state section types", () => {
    expect(() => ProjectSectionTypeSchema.parse("functional_description")).toThrow();
  });
});

describe("ProjectSectionContentSchema", () => {
  it("accepts a content row with markdown + json", () => {
    const content = {
      content_markdown: "## Overview\nLine 1",
      content_json: { paragraphs: ["Line 1"] },
    };
    expect(() => ProjectSectionContentSchema.parse(content)).not.toThrow();
  });

  it("accepts markdown-only content", () => {
    const content = { content_markdown: "Plain text" };
    expect(() => ProjectSectionContentSchema.parse(content)).not.toThrow();
  });

  it("rejects an empty content shape", () => {
    expect(() => ProjectSectionContentSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — neither schema exists.

- [ ] **Step 3: Add the schemas**

In `src/types/spec-contract-v2.ts`, near the existing `SpecSectionTypeSchema`:

```ts
// ============================================================
// Project-level sections (§3.5 — new in FDS Engine Phase 1)
// The six section types that are not keyed by (assembly_id, state_id).
// Their editable content lives in spec_projects.section_overrides.
// ============================================================

export const ProjectSectionTypeSchema = z.enum([
  "document_control",
  "system_overview",
  "control_philosophy",
  "interfaces",
  "testing_fat",
  "hmi_specification",
]);
export type ProjectSectionType = z.infer<typeof ProjectSectionTypeSchema>;

export const ProjectSectionContentSchema = z
  .object({
    content_markdown: z.string().optional(),
    content_json: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((c) => c.content_markdown !== undefined || c.content_json !== undefined, {
    message: "ProjectSectionContent must have content_markdown or content_json",
  });
export type ProjectSectionContent = z.infer<typeof ProjectSectionContentSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (31 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): ProjectSectionType union + ProjectSectionContent schema"
```

---

### Task 10: Extend `SpecContractV2Schema` top-level

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Modify: `src/types/__tests__/spec-contract-v2.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { SpecContractV2Schema } from "../spec-contract-v2";

describe("SpecContractV2Schema new top-level fields", () => {
  // Minimal valid contract scaffolding — fill in the bare-minimum required
  // fields. Use existing schema docs to derive other defaults.
  function baseContract() {
    return {
      header: {
        id: "00000000-0000-0000-0000-000000000001",
        doc_code: "PAC-EFD-001",
        title: "Test",
        client_name: "Test Client",
        project_number: null,
        plc_model: null,
        hmi_type: null,
        comms_protocol: null,
        safety_classification: null,
        fault_philosophy: null,
        design_principles: [],
      },
      hierarchy: { subsystems: [] },
      states: [],
      alarm_tiers: [],
      assemblies: {},
      orchestrations: {},
      system_orchestration: {
        state_sequences: {},
      },
      alarms: [],
      io_list: [],
      faults: [],
      sections: {},
      confirmation_status: "unconfirmed",
    };
  }

  it("accepts a contract with no modes / params / overrides (legacy default)", () => {
    expect(() => SpecContractV2Schema.parse(baseContract())).not.toThrow();
  });

  it("accepts a contract with modes populated", () => {
    const c = baseContract();
    (c as Record<string, unknown>).modes = [
      { mode_id: "auto", name: "Auto", is_default: true },
    ];
    expect(() => SpecContractV2Schema.parse(c)).not.toThrow();
  });

  it("accepts a contract with configuration_parameters", () => {
    const c = baseContract();
    (c as Record<string, unknown>).configuration_parameters = [
      {
        parameter_id: "x",
        name: "X",
        allowed_values: ["A", "B"],
        default: "A",
      },
    ];
    expect(() => SpecContractV2Schema.parse(c)).not.toThrow();
  });

  it("accepts a contract with section_overrides", () => {
    const c = baseContract();
    (c as Record<string, unknown>).section_overrides = {
      system_overview: { content_markdown: "Hello" },
    };
    expect(() => SpecContractV2Schema.parse(c)).not.toThrow();
  });

  it("rejects confirmation_status outside the closed set", () => {
    const c = baseContract();
    (c as Record<string, unknown>).confirmation_status = "halfway";
    expect(() => SpecContractV2Schema.parse(c)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: FAIL — `modes`, `configuration_parameters`, `section_overrides`, `confirmation_status` not in `SpecContractV2Schema`.

- [ ] **Step 3: Extend the top-level schema**

In `src/types/spec-contract-v2.ts`, locate `SpecContractV2Schema` (search for `export const SpecContractV2Schema = z.object`). Add four new fields:

```ts
export const ConfirmationStatusSchema = z.enum(["unconfirmed", "confirmed"]);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

export const SpecContractV2Schema = z.object({
  header: SpecProjectHeaderSchema,
  hierarchy: HierarchySchema,
  states: z.array(OperatingStateV2Schema),
  alarm_tiers: z.array(AlarmTierSchema),
  assemblies: z.record(z.string(), AssemblyContractSchema),
  orchestrations: z.record(z.string(), z.record(z.string(), SubsystemStateSequenceSchema)),
  system_orchestration: SystemOrchestrationSchema,
  alarms: z.array(AlarmRowSchema),
  io_list: z.array(IoListEntrySchema),
  faults: z.array(FaultRowSchema),
  sections: z.record(SpecSectionTypeSchema, z.array(SpecSectionRowSchema)).default({}),

  // FDS Engine Phase 1 additions — all optional during shim window
  modes: z.array(OperatorModeSchema).optional(),
  configuration_parameters: z.array(ConfigParameterSchema).optional(),
  section_overrides: z.record(ProjectSectionTypeSchema, ProjectSectionContentSchema).optional(),
  confirmation_status: ConfirmationStatusSchema.default("unconfirmed"),
});
export type SpecContractV2 = z.infer<typeof SpecContractV2Schema>;
```

If the existing definition references fields that don't appear above (e.g. legacy fields kept during shim), preserve them — add the four new fields without removing anything else.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts
```

Expected: PASS (36 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(fds-engine): extend SpecContractV2 with modes, configuration_parameters, section_overrides, confirmation_status"
```

---

### Task 11: Extend `SpecContractPatch` + writer routing

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
- Create: `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Write the failing test (new test file)**

Create `src/lib/spec-builder/__tests__/contract.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Supabase to capture writes without hitting a real database.
const writeCalls: Array<{ table: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => ({
        eq: () => {
          writeCalls.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  },
}));

import { writeSpecContract } from "../contract";

describe("writeSpecContract patch routing — new keys", () => {
  beforeEach(() => {
    writeCalls.length = 0;
  });

  it("routes modes patch to spec_projects.confirmed_modes", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000001", {
      modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite).toBeDefined();
    expect(projectsWrite?.payload).toMatchObject({ confirmed_modes: expect.any(Array) });
  });

  it("routes configuration_parameters patch to spec_projects.configuration_parameters", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000001", {
      configuration_parameters: [
        { parameter_id: "x", name: "X", allowed_values: ["A"], default: "A" },
      ],
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      configuration_parameters: expect.any(Array),
    });
  });

  it("routes section_overrides patch to spec_projects.section_overrides", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000001", {
      section_overrides: {
        system_overview: { content_markdown: "Hello" },
      },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      section_overrides: expect.any(Object),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: FAIL — the `SpecContractPatch` type does not accept `modes` / `configuration_parameters` / `section_overrides`, so the test won't compile.

- [ ] **Step 3: Extend `SpecContractPatch` and patch routing**

In `src/lib/spec-builder/contract.ts`, locate the `SpecContractPatch` interface (top of file, after the imports). Add three fields:

```ts
export interface SpecContractPatch {
  hierarchy?: Hierarchy;
  alarms?: AlarmRow[];
  alarm_tiers?: AlarmTier[];
  assemblies?: Record<string, AssemblyContract>;
  states?: OperatingStateV2[];
  orchestrations?: Record<string, Record<string, SubsystemStateSequence>>;
  system_orchestration?: SystemOrchestration;
  io_list?: IoListEntry[];
  faults?: FaultRow[];
  sections?: Partial<Record<SpecSectionType, SpecSectionRow[]>>;

  // FDS Engine Phase 1
  modes?: OperatorMode[];
  configuration_parameters?: ConfigParameter[];
  section_overrides?: Partial<Record<ProjectSectionType, ProjectSectionContent>>;
  confirmation_status?: ConfirmationStatus;
}
```

Add the missing imports at the top of the file:

```ts
import {
  // ... existing imports ...
  OperatorMode,
  OperatorModeSchema,
  ConfigParameter,
  ConfigParameterSchema,
  ProjectSectionType,
  ProjectSectionTypeSchema,
  ProjectSectionContent,
  ProjectSectionContentSchema,
  ConfirmationStatus,
  ConfirmationStatusSchema,
} from "@/types/spec-contract-v2";
```

Extend the inner `SpecContractPatchSchema`:

```ts
const SpecContractPatchSchema = z.object({
  // ... existing keys ...
  modes: z.array(OperatorModeSchema).optional(),
  configuration_parameters: z.array(ConfigParameterSchema).optional(),
  section_overrides: z
    .record(ProjectSectionTypeSchema, ProjectSectionContentSchema)
    .optional(),
  confirmation_status: ConfirmationStatusSchema.optional(),
});
```

Find the patch-routing section inside `writeSpecContract` (where existing top-level keys route to tables). Add:

```ts
// Aggregate all spec_projects updates into one row update to avoid
// multiple roundtrips. Build the project patch as we go.
const projectPatch: Record<string, unknown> = {};

if (patch.modes !== undefined) {
  projectPatch.confirmed_modes = patch.modes;
}
if (patch.configuration_parameters !== undefined) {
  projectPatch.configuration_parameters = patch.configuration_parameters;
}
if (patch.section_overrides !== undefined) {
  projectPatch.section_overrides = patch.section_overrides;
}
if (patch.confirmation_status !== undefined) {
  projectPatch.confirmation_status = patch.confirmation_status;
}

if (Object.keys(projectPatch).length > 0) {
  const { error } = await supabase
    .from("spec_projects")
    .update(projectPatch)
    .eq("id", specProjectId);
  if (error) {
    throw new Error(`writeSpecContract: spec_projects update failed: ${error.message}`);
  }
}
```

If there's already a `spec_projects` update path for existing top-level keys, *merge* into that same aggregated update — do not double-update the row.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(fds-engine): extend SpecContractPatch + writer routing for modes, params, section_overrides, confirmation_status"
```

---

### Task 12: Validator — mode existence invariant

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
- Modify: `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/spec-builder/__tests__/contract.test.ts`:

```ts
import { validateSpecContractPatch } from "../contract";

describe("validateSpecContractPatch — mode existence", () => {
  it("rejects a patch where confirmed_modes lacks an is_default=true entry", () => {
    const issues = validateSpecContractPatch({
      modes: [{ mode_id: "auto", name: "Auto", is_default: false }],
    });
    expect(issues.some((i) => /default mode/i.test(i))).toBe(true);
  });

  it("rejects a patch with two is_default=true modes", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "auto", name: "Auto", is_default: true },
        { mode_id: "manual", name: "Manual", is_default: true },
      ],
    });
    expect(issues.some((i) => /exactly one/i.test(i))).toBe(true);
  });

  it("rejects duplicate mode_ids", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "auto", name: "Auto", is_default: true },
        { mode_id: "auto", name: "Auto 2", is_default: false },
      ],
    });
    expect(issues.some((i) => /duplicate/i.test(i))).toBe(true);
  });

  it("accepts a valid modes patch", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "auto", name: "Auto", is_default: true },
        { mode_id: "manual", name: "Manual", is_default: false },
      ],
    });
    expect(issues).toEqual([]);
  });
});
```

If `validateSpecContractPatch` is not exported today, export it from `contract.ts` so the test can import it.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: FAIL — the validator does not yet enforce mode invariants.

- [ ] **Step 3: Add the validator rule**

In `src/lib/spec-builder/contract.ts`, find `validateSpecContractPatch` (the function that returns `string[]` issues). Add a mode-validation block:

```ts
if (patch.modes !== undefined) {
  const ids = patch.modes.map((m) => m.mode_id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    issues.push(`duplicate mode_id(s): ${[...new Set(dupes)].join(", ")}`);
  }
  const defaults = patch.modes.filter((m) => m.is_default);
  if (defaults.length === 0) {
    issues.push("modes patch must include exactly one default mode (is_default=true)");
  } else if (defaults.length > 1) {
    issues.push(
      `modes patch must include exactly one default mode; found ${defaults.length}`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: PASS (7 tests total in this file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(fds-engine): validator — modes patch must have exactly one default and unique IDs"
```

---

### Task 13: Validator — PackML/custom_states ID range

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
- Modify: `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("validateSpecContractPatch — PackML state IDs", () => {
  it("rejects a numeric state_id between 18 and 100 (invalid range)", () => {
    const issues = validateSpecContractPatch({
      states: [
        {
          state_id: 50,
          packml_id: undefined,
          display_name: "Bad",
          description: "x",
          state_pattern: "static",
        } as never,
      ],
    });
    expect(issues.some((i) => /state_id/i.test(i))).toBe(true);
  });

  it("rejects custom state without custom_name", () => {
    const issues = validateSpecContractPatch({
      states: [
        {
          state_id: 101,
          display_name: "x",
          description: "x",
          state_pattern: "static",
        } as never,
      ],
    });
    expect(issues.some((i) => /custom_name/i.test(i))).toBe(true);
  });

  it("rejects PackML state where packml_id does not match state_id", () => {
    const issues = validateSpecContractPatch({
      states: [
        {
          state_id: 5,
          packml_id: 6,
          display_name: "x",
          description: "x",
          state_pattern: "static",
        } as never,
      ],
    });
    expect(issues.some((i) => /packml_id/i.test(i))).toBe(true);
  });

  it("accepts a valid PackML state (state_id 6, packml_id 6)", () => {
    const issues = validateSpecContractPatch({
      states: [
        {
          state_id: 6,
          packml_id: 6,
          display_name: "Execute",
          description: "Running",
          state_pattern: "sequential",
        } as never,
      ],
    });
    expect(issues.filter((i) => /state_id|packml_id|custom_name/i.test(i))).toEqual([]);
  });

  it("accepts a valid custom state (state_id 101, custom_name set)", () => {
    const issues = validateSpecContractPatch({
      states: [
        {
          state_id: 101,
          custom_name: "Lubrication",
          display_name: "Lubrication",
          description: "Site-specific",
          state_pattern: "static",
        } as never,
      ],
    });
    expect(issues.filter((i) => /state_id|packml_id|custom_name/i.test(i))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: FAIL — validator doesn't enforce these range rules.

- [ ] **Step 3: Add the validator rule**

In `validateSpecContractPatch`, after the modes block, add:

```ts
if (patch.states !== undefined) {
  patch.states.forEach((s, idx) => {
    const sid = s.state_id;
    if (typeof sid === "number") {
      // Numeric IDs: 1..17 = PackML; >100 = custom_states; everything else invalid.
      if (sid >= 1 && sid <= 17) {
        if (s.packml_id === undefined) {
          issues.push(`states[${idx}]: numeric state_id ${sid} requires packml_id`);
        } else if (s.packml_id !== sid) {
          issues.push(
            `states[${idx}]: packml_id (${s.packml_id}) must equal state_id (${sid})`,
          );
        }
      } else if (sid > 100) {
        if (!s.custom_name) {
          issues.push(`states[${idx}]: custom state_id ${sid} requires custom_name`);
        }
      } else {
        issues.push(
          `states[${idx}]: state_id ${sid} is invalid; must be 1..17 (PackML) or > 100 (custom)`,
        );
      }
    }
    // Legacy string state_ids are accepted as-is during the shim window;
    // post-confirmation projects should not contain them.
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(fds-engine): validator — PackML state_id range (1..17, >100 custom)"
```

---

### Task 14: Validator — `override_kind` invariants

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
- Modify: `src/lib/spec-builder/__tests__/contract.test.ts`

The rules per design §4.4:
- `inherit` rows must have empty content (no permissives, no steps, no monitors).
- `suppressed` rows must have empty content.
- `override` rows may have any content.
- Validation runs only on assemblies whose state map carries per-mode entries — handled by checking keys for `mode_id::state_id` shape.

**Note:** the keying format for per-mode entries is part of the design but the exact key encoding (`"mode_id::state_id"` vs separate nesting) is decided in Phase 2 / 6. For Phase 1, validate that *if* an override_kind is present, the content rules hold — regardless of keying.

- [ ] **Step 1: Append failing tests**

```ts
describe("validateSpecContractPatch — override_kind content rules", () => {
  function makeAssembly(seqOverride: Record<string, unknown>) {
    return {
      "00000000-0000-0000-0000-000000000aaa": {
        assembly_id: "00000000-0000-0000-0000-000000000aaa",
        subsystem_id: "00000000-0000-0000-0000-000000000bbb",
        static_states: {},
        sequential_states: {
          "auto::execute": {
            override_kind: "inherit",
            permissives: [],
            steps: [],
            notes: null,
            ...seqOverride,
          },
        },
      },
    };
  }

  it("rejects an inherit row with steps", () => {
    const issues = validateSpecContractPatch({
      assemblies: makeAssembly({
        steps: [
          {
            step: 10,
            action: "x",
            completion_criteria: [],
            completion_criteria_text: "",
          },
        ],
      } as never) as never,
    });
    expect(issues.some((i) => /inherit.*empty/i.test(i))).toBe(true);
  });

  it("rejects a suppressed row with permissives", () => {
    const issues = validateSpecContractPatch({
      assemblies: makeAssembly({
        override_kind: "suppressed",
        permissives: [{ tag: "X", operator: "=", value: true }],
      } as never) as never,
    });
    expect(issues.some((i) => /suppressed.*empty/i.test(i))).toBe(true);
  });

  it("accepts an inherit row with empty content", () => {
    const issues = validateSpecContractPatch({
      assemblies: makeAssembly({}) as never,
    });
    expect(issues.filter((i) => /inherit|suppressed/i.test(i))).toEqual([]);
  });

  it("accepts an override row with content", () => {
    const issues = validateSpecContractPatch({
      assemblies: makeAssembly({
        override_kind: "override",
        permissives: [{ tag: "X", operator: "=", value: true }],
      } as never) as never,
    });
    expect(issues.filter((i) => /inherit|suppressed/i.test(i))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the validator rule**

In `validateSpecContractPatch`, after the states block, add:

```ts
if (patch.assemblies !== undefined) {
  Object.entries(patch.assemblies).forEach(([assemblyId, contract]) => {
    Object.entries(contract.sequential_states ?? {}).forEach(([stateKey, seq]) => {
      const kind = (seq as { override_kind?: string }).override_kind;
      if (kind === "inherit" || kind === "suppressed") {
        const hasContent =
          (seq.permissives && seq.permissives.length > 0) ||
          (seq.steps && seq.steps.length > 0) ||
          (seq.state_monitors && seq.state_monitors.length > 0) ||
          (seq.branches && seq.branches.length > 0);
        if (hasContent) {
          issues.push(
            `assemblies[${assemblyId}].sequential_states[${stateKey}]: ${kind} rows must be empty (no permissives/steps/monitors/branches)`,
          );
        }
      }
    });
    // Static states share the same rule when wrapped in StaticStateV2.
    Object.entries(contract.static_states ?? {}).forEach(([stateKey, val]) => {
      if (Array.isArray(val)) return; // legacy shape, no override_kind
      const kind = (val as { override_kind?: string }).override_kind;
      if (kind === "inherit" || kind === "suppressed") {
        const devices = (val as { devices?: unknown[] }).devices;
        if (devices && devices.length > 0) {
          issues.push(
            `assemblies[${assemblyId}].static_states[${stateKey}]: ${kind} rows must have empty devices`,
          );
        }
      }
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(fds-engine): validator — override_kind inherit/suppressed rows must be empty"
```

---

### Task 15: Validator — `parameter_ref` references existing parameter

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
- Modify: `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("validateSpecContractPatch — parameter_ref existence", () => {
  it("rejects parameter_ref expression to an unknown parameter_id", () => {
    const issues = validateSpecContractPatch({
      configuration_parameters: [
        { parameter_id: "battery_chemistry", name: "X", allowed_values: ["LFP"], default: "LFP" },
      ],
      assemblies: {
        "00000000-0000-0000-0000-000000000aaa": {
          assembly_id: "00000000-0000-0000-0000-000000000aaa",
          subsystem_id: "00000000-0000-0000-0000-000000000bbb",
          static_states: {},
          sequential_states: {
            "auto::execute": {
              override_kind: "override",
              permissives: [],
              steps: [
                {
                  step_id: "s1",
                  branch_id: "main",
                  actions: [
                    {
                      kind: "assign",
                      action_id: "a1",
                      target_tag: "X",
                      source: { kind: "parameter_ref", parameter_id: "MISSING" },
                      prose: "x",
                    },
                  ],
                  transitions: [],
                  // legacy fields
                  step: 10,
                  action: "x",
                  completion_criteria: [],
                  completion_criteria_text: "",
                } as never,
              ],
              notes: null,
            },
          },
        },
      } as never,
    });
    expect(issues.some((i) => /parameter_ref.*MISSING/i.test(i))).toBe(true);
  });

  it("accepts parameter_ref to a known parameter_id", () => {
    const issues = validateSpecContractPatch({
      configuration_parameters: [
        { parameter_id: "battery_chemistry", name: "X", allowed_values: ["LFP"], default: "LFP" },
      ],
      assemblies: {
        "00000000-0000-0000-0000-000000000aaa": {
          assembly_id: "00000000-0000-0000-0000-000000000aaa",
          subsystem_id: "00000000-0000-0000-0000-000000000bbb",
          static_states: {},
          sequential_states: {
            "auto::execute": {
              override_kind: "override",
              permissives: [],
              steps: [
                {
                  step_id: "s1",
                  branch_id: "main",
                  actions: [
                    {
                      kind: "assign",
                      action_id: "a1",
                      target_tag: "X",
                      source: { kind: "parameter_ref", parameter_id: "battery_chemistry" },
                      prose: "x",
                    },
                  ],
                  transitions: [],
                  step: 10,
                  action: "x",
                  completion_criteria: [],
                  completion_criteria_text: "",
                } as never,
              ],
              notes: null,
            },
          },
        },
      } as never,
    });
    expect(issues.filter((i) => /parameter_ref/i.test(i))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the validator rule**

In `validateSpecContractPatch`, after the assemblies block:

```ts
// parameter_ref expressions must reference a known configuration parameter.
if (patch.assemblies !== undefined) {
  const knownParamIds = new Set(
    (patch.configuration_parameters ?? []).map((p) => p.parameter_id),
  );
  // NOTE: cross-patch validation (parameter_ref in patch.assemblies referring
  // to a parameter NOT in the patch but present in the persisted contract)
  // requires loading the current contract. Phase 1 validates within-patch
  // only; a follow-up wave extends this to cross-patch checks.
  Object.entries(patch.assemblies).forEach(([assemblyId, contract]) => {
    Object.entries(contract.sequential_states ?? {}).forEach(([stateKey, seq]) => {
      (seq.steps ?? []).forEach((step, sIdx) => {
        const actions = (step as { actions?: Array<{ source?: { kind: string; parameter_id?: string } }> }).actions ?? [];
        actions.forEach((a, aIdx) => {
          if (a.source?.kind === "parameter_ref") {
            const pid = a.source.parameter_id;
            if (pid && !knownParamIds.has(pid)) {
              issues.push(
                `assemblies[${assemblyId}].sequential_states[${stateKey}].steps[${sIdx}].actions[${aIdx}]: parameter_ref "${pid}" is not a known parameter`,
              );
            }
          }
        });
      });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(fds-engine): validator — parameter_ref must resolve to a known configuration_parameter (within-patch)"
```

---

### Task 16: Reader — branch on `confirmation_status`

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
- Modify: `src/lib/spec-builder/__tests__/contract.test.ts`

`loadSpecContract` already has a `schema_version` check that gates the legacy-shim path on the `legacy_shim_enabled` flag. This task adds a parallel branch on `confirmation_status`: confirmed projects skip the shim regardless of `schema_version`; unconfirmed projects route through the shim as today.

- [ ] **Step 1: Append failing tests**

The reader needs more elaborate mocking (multiple table queries). Create a focused mock at the top of `contract.test.ts` (extend existing mock):

```ts
describe("loadSpecContract — confirmation_status branching", () => {
  // Reset mocks each test; configure per-test fixtures.
  // The mock at the top of this file already mocks supabase.from; we need
  // to extend it for select() calls. The implementer chooses whether to
  // (a) replace the top-level mock with a shared fixture builder used by
  // both write and read tests, or (b) skip these tests in Phase 1 and add
  // them in Phase 2 where the read path actually changes user-visible
  // behaviour.
  //
  // For Phase 1, the minimum acceptance is: `loadSpecContract` is exported
  // from contract.ts and accepts the new column without throwing. A simple
  // smoke test:
  it("imports without throwing", async () => {
    const { loadSpecContract } = await import("../contract");
    expect(typeof loadSpecContract).toBe("function");
  });
});
```

- [ ] **Step 2: Read the existing `loadSpecContract` to understand the project-fetch query**

Open `src/lib/spec-builder/contract.ts` and locate `loadSpecContract`. Find the project fetch (`supabase.from("spec_projects").select(...)`). Extend the `.select(...)` column list to include `confirmation_status, confirmed_modes, configuration_parameters, section_overrides`.

- [ ] **Step 3: Add the branching logic**

Right after the existing project fetch + null check (the existing `schema_version` check), add:

```ts
// Phase 1: confirmation_status gates whether the legacy-shim path is even
// considered. Unconfirmed projects continue through the existing shim
// branch (legacy schema_version=1 or 2 handling). Confirmed projects
// require strict V2-shape rows and skip the shim entirely.
const confirmationStatus =
  (data as { confirmation_status?: ConfirmationStatus }).confirmation_status ??
  "unconfirmed";

if (confirmationStatus === "confirmed") {
  // Confirmed projects: strict V2 read path. The new top-level fields
  // populate from the new columns directly.
  // The existing assembly_sessions / orchestration / sections reads continue
  // unchanged — they already produce V2-shaped output (with new structured
  // shapes accepted post-lift).
} else {
  // Unconfirmed: continue through the legacy-shim path as today.
  if (data.schema_version === 1 && !FLAGS.legacy_shim_enabled) {
    throw new Error(
      `loadSpecContract: project ${specProjectId} is schema_version=1 but legacy_shim_enabled=false`,
    );
  }
}
```

At the end of the function, where the `SpecContractV2` object is assembled and validated, populate the new top-level fields:

```ts
const contract: SpecContractV2 = SpecContractV2Schema.parse({
  // ... existing fields ...
  modes: (data as { confirmed_modes?: OperatorMode[] }).confirmed_modes ?? undefined,
  configuration_parameters:
    (data as { configuration_parameters?: ConfigParameter[] }).configuration_parameters ??
    undefined,
  section_overrides:
    (data as { section_overrides?: Partial<Record<ProjectSectionType, ProjectSectionContent>> })
      .section_overrides ?? undefined,
  confirmation_status: confirmationStatus,
});
```

- [ ] **Step 4: Run test + the type checker**

```bash
npx vitest run src/lib/spec-builder/__tests__/contract.test.ts
npx tsc -b
```

Expected: vitest PASS (19 tests); `tsc` passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(fds-engine): loadSpecContract reads new columns + branches on confirmation_status"
```

---

### Task 17: Activate `assertBuilderContext` via ESLint `no-restricted-imports`

**Files:**
- Modify: `eslint.config.js`

The runtime `assertBuilderContext` stub stays as-is for now; this task adds the lint that catches forge modules importing the writer at static-analysis time. The runtime hook gets wired in a later phase if needed.

- [ ] **Step 1: Confirm the lint plugin is available**

```bash
npx eslint --version
```

Expected: a version number prints. `no-restricted-imports` is a core rule — no extra plugin needed.

- [ ] **Step 2: Add the rule**

In `eslint.config.js`, add a new entry to the exported `defineConfig([...])` array that scopes a rule to forge files:

```js
{
  files: [
    'src/lib/forge-**/*.{ts,tsx}',
    'src/lib/forge_*.{ts,tsx}',
    'src/hooks/use-forge-*.{ts,tsx}',
    'src/components/forge/**/*.{ts,tsx}',
    'src/routes/forge*.tsx',
  ],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: '@/lib/spec-builder/contract',
          importNames: ['writeSpecContract', 'SpecContractPatch'],
          message: 'Forge modules must not import the spec-builder writer. Use loadSpecContract (reader) only.',
        },
      ],
    }],
  },
},
```

The file globs MUST match where forge code actually lives. Verify by running `git ls-files src/ | grep -E '^(src/lib/forge|src/hooks/use-forge|src/components/forge|src/routes/forge)' | head` and adjust the globs if the paths differ. Do not invent paths.

- [ ] **Step 3: Verify the rule fires on a synthetic violation**

Create a temporary file `src/lib/forge-test-rule.ts` with:

```ts
import { writeSpecContract } from "@/lib/spec-builder/contract";
export const x = writeSpecContract;
```

Then run:

```bash
npx eslint src/lib/forge-test-rule.ts
```

Expected: an error reporting `no-restricted-imports` is triggered with the configured message.

Delete the test file:

```bash
rm src/lib/forge-test-rule.ts
```

- [ ] **Step 4: Verify the rule does NOT fire on builder code**

```bash
npx eslint src/lib/spec-builder/contract.ts
```

Expected: no `no-restricted-imports` errors (builder code is free to use the writer).

- [ ] **Step 5: Run the full lint to confirm no real existing violations**

```bash
npm run lint
```

Expected: any forge-code violations of the rule fail lint. If real violations exist, this is an existing bug — STOP, surface the list to the user, and ask whether to refactor those imports as part of this task or punt them to a separate cleanup commit. Do not silently disable the rule.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js
git commit -m "feat(fds-engine): ESLint rule — forge modules cannot import spec-builder writer"
```

---

### Task 18: Final integration — `tsc -b && npm test`

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

```bash
npx tsc -b
```

Expected: zero errors. If errors exist, they must be fixed before considering Phase 1 complete. Common cause: a downstream consumer of `OperatingStateV2` or `InterAssemblyInterlock` typed against the old shape. Fix the consumer to handle both shapes (legacy + lifted), or pin to a narrower legacy type if the consumer is unrelated to FDS.

- [ ] **Step 2: Full test suite**

```bash
npm test -- --run
```

Expected: all tests pass — Phase 1's new tests plus every existing test. If an existing test breaks because of the schema changes (e.g. a test that hand-constructs an old-shape `SubsystemStateSequence`), update the test to the new shape and reference this phase in the test comment.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Capture the Phase 1 status in the design doc**

Open `Docs/superpowers/specs/2026-05-25-fds-engine-design.md` and add a one-line status note at the top of §6 ("Sequencing"):

```markdown
**Release N+1 Phase 1 status: complete as of <YYYY-MM-DD>. Schema, validator, writer routing, reader branching, ESLint boundary lint. Phases 2-7 pending.**
```

- [ ] **Step 5: Commit**

```bash
git add Docs/superpowers/specs/2026-05-25-fds-engine-design.md
git commit -m "docs(fds-engine): mark Phase 1 (schema + writer/validator) complete"
```

---

## Phase 1 Done

After Task 18, the contract layer accepts the new V2 shapes. Confirmed projects (none in production yet — the wizard lands in Phase 2) get the new structured reads. Unconfirmed projects continue through the legacy-shim path with no behaviour change.

Nothing in the UI consumes the new shapes yet. The next phase (Phase 2 — migration wizard) builds on these schemas to land the per-project engineer-confirm flow that flips `confirmation_status` from `unconfirmed` to `confirmed`.
