# G0-1 Drive/VSD Parameter Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This repo's recorded preference:** inline execution (executing-plans), no subagent dispatch.

**Goal:** Teach `SpecContractV2` the drive/VSD parameters the G1 MAP writer needs — tier-1 signable `DriveModelV1` on control modules, tier-2 record-only `EngineeringDataV1.drives` at project level — with validation, persistence, and back-compat seeding.

**Architecture:** Follows the shipped G0-9 wave commit-for-commit: additive optional Zod schemas in `src/types/spec-contract-v2.ts`, a pure validator module in `src/lib/spec-builder/drive-model.ts`, patch + persistence wiring in `src/lib/spec-builder/contract.ts`, one `jsonb` column migration. Spec: `Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md`.

**Tech Stack:** TypeScript 5.9 strict (`verbatimModuleSyntax`, no enums), Zod v4, vitest, Supabase migration SQL.

## Global Constraints

- All new contract keys optional — every stored pre-G0-1 contract must parse unchanged.
- No project-specific values outside test fixtures (CLAUDE.md "All Changes Must Be Generic").
- `import type` for type-only imports; no unused locals (build fails otherwise).
- Do NOT `supabase db push` — remote history is drifted; author the migration file only.
- Verification per task: `npx vitest run <suite>`; final gate `npx tsc -b` clean.
- Commit messages carry `(G0-1)` suffix like the G0-9 wave.

---

### Task 1: Tier-1 schema — `DriveModelV1` on ControlModuleV2

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (insert new section after `NetworkConfig` block ending line 251; add key to `ControlModuleV2Schema` line 283–291)
- Test: `src/types/__tests__/spec-contract-v2.test.ts`

**Interfaces:**
- Consumes: existing `VfdFamilySchema`, `TelegramStandardSchema` (same file).
- Produces: `SpeedRefUnitSchema`/`SpeedRefUnit`, `DriveEnablePolicySchema`/`DriveEnablePolicy`, `DriveModelV1Schema`/`DriveModelV1`; `ControlModuleV2.drive?: DriveModelV1`.

- [ ] **Step 1: Write the failing tests** (append a new `describe` to `src/types/__tests__/spec-contract-v2.test.ts`, matching the file's existing vitest imports):

```ts
describe("DriveModelV1 (G0-1)", () => {
  const goldenDrive = {
    family: "sinamics_g120",
    telegram: 1,
    speed_ref: { unit: "percent_ref_speed", signed: true },
    enable_policy: "enable_on_nonzero_ref",
  };

  it("parses the golden-master drive model", () => {
    expect(DriveModelV1Schema.parse(goldenDrive)).toEqual(goldenDrive);
  });

  it("telegram is optional (assembly/vendor-profile families)", () => {
    const abb = { ...goldenDrive, family: "abb_acs880" } as Record<string, unknown>;
    delete abb.telegram;
    expect(DriveModelV1Schema.parse(abb).telegram).toBeUndefined();
  });

  it("rejects unknown enable_policy", () => {
    expect(() =>
      DriveModelV1Schema.parse({ ...goldenDrive, enable_policy: "always_on" }),
    ).toThrow();
  });

  it("ControlModuleV2 accepts an optional drive key and parses without one", () => {
    const cm = {
      control_module_id: "00000000-0000-0000-0000-000000000001",
      control_module_name: "VSD1",
      control_module_class: "drive",
      is_safety: false,
      description: "Rail motors VSD",
      io_signals: [],
    };
    expect(ControlModuleV2Schema.parse(cm).drive).toBeUndefined();
    expect(ControlModuleV2Schema.parse({ ...cm, drive: goldenDrive }).drive).toEqual(
      goldenDrive,
    );
  });
});
```

Add `DriveModelV1Schema` and `ControlModuleV2Schema` to the test file's import from `@/types/spec-contract-v2` if absent.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → FAIL: `DriveModelV1Schema` not exported.

- [ ] **Step 3: Implement.** In `src/types/spec-contract-v2.ts`, directly after the `NetworkConfig` block (after line 251 `export type NetworkConfig = ...`), insert:

```ts
// ============================================================
// Drive/VSD model (G0-1) — tier-1 signable FDS content.
// Tier-2 record-only commissioning values (HW ids, RefSpeed=p2000,
// ConfigAxis) live in EngineeringDataV1.drives, keyed by CM id.
// Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md
// ============================================================

// "percent_ref_speed": setpoints/feedback are percent of the tier-2
// ref_speed_rpm (drive p2000) — the golden-master convention. "rpm"/"hz"
// mean raw engineering units (writer emits no scaling).
export const SpeedRefUnitSchema = z.enum(["percent_ref_speed", "rpm", "hz"]);
export type SpeedRefUnit = z.infer<typeof SpeedRefUnitSchema>;

export const DriveEnablePolicySchema = z.enum([
  "enable_on_nonzero_ref", // EnableAxis := ref <> 0
  "explicit_enable", // enable pin driven by the EM command seam
]);
export type DriveEnablePolicy = z.infer<typeof DriveEnablePolicySchema>;

export const DriveModelV1Schema = z.object({
  family: VfdFamilySchema,
  // PROFINET-telegram families (Siemens) carry it; assembly/vendor-profile
  // families (ABB EtherNet/IP, SEW) must not — enforced in drive-model.ts.
  telegram: TelegramStandardSchema.optional(),
  speed_ref: z.object({
    unit: SpeedRefUnitSchema,
    signed: z.boolean(),
  }),
  enable_policy: DriveEnablePolicySchema,
});
export type DriveModelV1 = z.infer<typeof DriveModelV1Schema>;
```

Then add to `ControlModuleV2Schema` after `network_config` (line 290):

```ts
  drive: DriveModelV1Schema.optional(),
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(spec-contract): DriveModelV1 tier-1 drive model on control modules (G0-1)"
```

---

### Task 2: Tier-2 schema — `EngineeringDataV1` project container

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (insert before `SpecContractV2Schema` line 1045; add key inside it after `unit_coordination` line 1063)
- Test: `src/types/__tests__/spec-contract-v2.test.ts`

**Interfaces:**
- Consumes: `UuidSchema` (same file).
- Produces: `DriveEngineeringEntrySchema`/`DriveEngineeringEntry`, `EngineeringDataV1Schema`/`EngineeringDataV1`; `SpecContractV2.engineering?: EngineeringDataV1`.

- [ ] **Step 1: Write the failing tests** (same describe block file):

```ts
describe("EngineeringDataV1 (G0-1)", () => {
  it("applies the 16#003F config_axis default and parses half-filled entries", () => {
    const parsed = EngineeringDataV1Schema.parse({
      drives: [{ control_module_id: "00000000-0000-0000-0000-000000000001" }],
    });
    expect(parsed.drives[0].config_axis).toBe(0x003f);
    expect(parsed.drives[0].ref_speed_rpm).toBeUndefined();
  });

  it("defaults drives to an empty array", () => {
    expect(EngineeringDataV1Schema.parse({}).drives).toEqual([]);
  });

  it("parses the golden-master engineering entry", () => {
    const entry = {
      control_module_id: "00000000-0000-0000-0000-000000000001",
      hw_id_stw: 322,
      hw_id_zsw: 322,
      ref_speed_rpm: 1500.0,
      config_axis: 0x003f,
    };
    expect(EngineeringDataV1Schema.parse({ drives: [entry] }).drives[0]).toEqual(entry);
  });

  it("rejects negative ref_speed_rpm", () => {
    expect(() =>
      EngineeringDataV1Schema.parse({
        drives: [
          {
            control_module_id: "00000000-0000-0000-0000-000000000001",
            ref_speed_rpm: -1500,
          },
        ],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → FAIL: `EngineeringDataV1Schema` not exported.

- [ ] **Step 3: Implement.** Before `SpecContractV2Schema` (line 1043 `// ====` divider), insert:

```ts
// ============================================================
// Engineering Data (G0-1) — tier-2 record-only container from the
// boundary decision (2026-07-07). Never signable, never HMI-exposed;
// commissioning fills values in. G0-2/G0-4/G0-7 add sibling keys here.
// ============================================================

export const DriveEngineeringEntrySchema = z.object({
  control_module_id: UuidSchema, // must reference a CM carrying `drive`
  hw_id_stw: z.number().int().nonnegative().optional(), // HWIDSTW from TIA HW config
  hw_id_zsw: z.number().int().nonnegative().optional(), // HWIDZSW
  ref_speed_rpm: z.number().positive().optional(), // MUST equal drive p2000
  config_axis: z.number().int().nonnegative().default(0x003f),
  notes: z.string().optional(),
});
export type DriveEngineeringEntry = z.infer<typeof DriveEngineeringEntrySchema>;

export const EngineeringDataV1Schema = z.object({
  drives: z.array(DriveEngineeringEntrySchema).default([]),
});
export type EngineeringDataV1 = z.infer<typeof EngineeringDataV1Schema>;
```

Inside `SpecContractV2Schema` after `unit_coordination` (line 1063):

```ts
  // G0-1: tier-2 Engineering Data. Absent until authored.
  engineering: EngineeringDataV1Schema.optional(),
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → PASS (including any existing full-contract fixture tests — proves back-compat).

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(spec-contract): EngineeringDataV1 tier-2 container with drives section (G0-1)"
```

---

### Task 3: Validator — `validateDriveModels` in `drive-model.ts`

**Files:**
- Create: `src/lib/spec-builder/drive-model.ts`
- Test: `src/lib/spec-builder/__tests__/drive-model.test.ts` (new)

**Interfaces:**
- Consumes: `ControlModuleV2`, `EngineeringDataV1`, `VfdFamily` types from `@/types/spec-contract-v2`.
- Produces: `DriveModelSpecView`, `DriveModelIssues { errors: string[]; warnings: string[] }`, `validateDriveModels(view: DriveModelSpecView): DriveModelIssues`. Task 4 consumes `validateDriveModels`; Task 6 adds a second export to this module.

- [ ] **Step 1: Write the failing tests** — create `src/lib/spec-builder/__tests__/drive-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  validateDriveModels,
  type DriveModelSpecView,
} from "@/lib/spec-builder/drive-model";
import type { DriveModelV1 } from "@/types/spec-contract-v2";

const CM_ID = "00000000-0000-0000-0000-000000000001";

const g120: DriveModelV1 = {
  family: "sinamics_g120",
  telegram: 1,
  speed_ref: { unit: "percent_ref_speed", signed: true },
  enable_policy: "enable_on_nonzero_ref",
};

function view(overrides: Partial<DriveModelSpecView> = {}): DriveModelSpecView {
  return {
    control_modules: [
      { control_module_id: CM_ID, control_module_name: "VSD1", drive: g120 },
    ],
    engineering: { drives: [{ control_module_id: CM_ID, config_axis: 0x003f }] },
    ...overrides,
  };
}

describe("validateDriveModels — telegram/family table", () => {
  it("accepts the golden-master G120 + Tg1 pairing", () => {
    expect(validateDriveModels(view()).errors).toEqual([]);
  });

  it("errors on a telegram outside the family's supported set", () => {
    const v = view();
    v.control_modules[0].drive = { ...g120, telegram: 105 };
    expect(validateDriveModels(v).errors).toHaveLength(1);
  });

  it("errors when a non-telegram family carries a telegram", () => {
    const v = view();
    v.control_modules[0].drive = { ...g120, family: "abb_acs880" };
    expect(validateDriveModels(v).errors).toHaveLength(1);
  });

  it("warns (not errors) on a Siemens family with telegram absent", () => {
    const v = view();
    const { telegram: _telegram, ...rest } = g120;
    v.control_modules[0].drive = rest;
    const out = validateDriveModels(v);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w) => w.includes("no telegram"))).toBe(true);
  });

  it("family 'other' is unconstrained", () => {
    const v = view();
    v.control_modules[0].drive = { ...g120, family: "other", telegram: 350 };
    expect(validateDriveModels(v).errors).toEqual([]);
  });
});

describe("validateDriveModels — engineering cross-refs", () => {
  it("errors on an entry referencing an unknown control module", () => {
    const v = view({
      engineering: {
        drives: [
          { control_module_id: "00000000-0000-0000-0000-00000000dead", config_axis: 0x003f },
        ],
      },
    });
    expect(validateDriveModels(v).errors.some((e) => e.includes("unknown"))).toBe(true);
  });

  it("errors on an entry for a CM without a drive model", () => {
    const v = view();
    v.control_modules[0].drive = undefined;
    expect(validateDriveModels(v).errors.some((e) => e.includes("no drive"))).toBe(true);
  });

  it("errors on duplicate entries for one CM", () => {
    const v = view();
    v.engineering = {
      drives: [
        { control_module_id: CM_ID, config_axis: 0x003f },
        { control_module_id: CM_ID, config_axis: 0x003f },
      ],
    };
    expect(validateDriveModels(v).errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("warns when a drive CM has no engineering entry (pre-commissioning)", () => {
    const v = view({ engineering: { drives: [] } });
    expect(validateDriveModels(v).errors).toEqual([]);
    expect(validateDriveModels(v).warnings.some((w) => w.includes("engineering"))).toBe(true);
  });

  it("no engineering context at all → warnings only, no errors", () => {
    const v = view({ engineering: undefined });
    expect(validateDriveModels(v).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/__tests__/drive-model.test.ts` → FAIL: cannot resolve `@/lib/spec-builder/drive-model`.

- [ ] **Step 3: Implement** — create `src/lib/spec-builder/drive-model.ts`:

```ts
/**
 * G0-1 drive/VSD model semantics — pure helpers, no React/IO.
 * The telegram-support table is deliberately local: vfd-fb-family.ts stays
 * AI-prompt-only until G1-6 refactors it for deterministic consumption.
 * Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md
 */
import type {
  ControlModuleV2,
  EngineeringDataV1,
  VfdFamily,
} from "@/types/spec-contract-v2";

/** Allowed telegrams per family; "none" = must be absent; "any" = unconstrained. */
const FAMILY_TELEGRAMS: Record<VfdFamily, readonly number[] | "none" | "any"> = {
  sinamics_g120: [1, 20, 352],
  sinamics_s210: [102, 105],
  abb_acs880: "none", // EtherNet/IP assembly — telegram n/a
  sew_movidrive: "none", // vendor profile
  other: "any",
};

export interface DriveModelSpecView {
  control_modules: Pick<
    ControlModuleV2,
    "control_module_id" | "control_module_name" | "drive"
  >[];
  engineering?: EngineeringDataV1;
}

export interface DriveModelIssues {
  errors: string[];
  warnings: string[];
}

/**
 * Structural invariants over drive models + engineering entries (design §3).
 * Context-dependent checks skip when their context is absent — callers pass
 * whatever the patch carries (same convention as validateUnitCoordination).
 */
export function validateDriveModels(view: DriveModelSpecView): DriveModelIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(view.control_modules.map((cm) => [cm.control_module_id, cm]));

  for (const cm of view.control_modules) {
    if (!cm.drive) continue;
    const where = `control_modules[${cm.control_module_name}].drive`;
    const rule = FAMILY_TELEGRAMS[cm.drive.family];
    if (cm.drive.telegram !== undefined) {
      if (rule === "none") {
        errors.push(
          `${where}: family "${cm.drive.family}" does not use PROFINET telegrams — remove telegram`,
        );
      } else if (rule !== "any" && !rule.includes(cm.drive.telegram)) {
        errors.push(
          `${where}: telegram ${cm.drive.telegram} not supported by family "${cm.drive.family}" (supported: ${rule.join(", ")})`,
        );
      }
    } else if (rule !== "none" && rule !== "any") {
      warnings.push(
        `${where}: family "${cm.drive.family}" has no telegram selected — spec incomplete`,
      );
    }
  }

  const seen = new Set<string>();
  for (const entry of view.engineering?.drives ?? []) {
    const where = `engineering.drives[${entry.control_module_id}]`;
    const cm = byId.get(entry.control_module_id);
    if (!cm) {
      errors.push(`${where}: references unknown control module`);
    } else if (!cm.drive) {
      errors.push(
        `${where}: control module "${cm.control_module_name}" has no drive model`,
      );
    }
    if (seen.has(entry.control_module_id)) {
      errors.push(`${where}: duplicate entry for control module`);
    }
    seen.add(entry.control_module_id);
  }

  if (view.engineering) {
    for (const cm of view.control_modules) {
      if (cm.drive && !seen.has(cm.control_module_id)) {
        warnings.push(
          `control_modules[${cm.control_module_name}]: drive has no engineering.drives entry — HW ids / RefSpeed pending commissioning`,
        );
      }
    }
  }

  return { errors, warnings };
}
```

Note the missing-engineering-entry warning loop is gated on `view.engineering` being present (context-absent convention): the "warns when a drive CM has no engineering entry" test passes `{ drives: [] }` (present but empty) so the warning fires, while the "no engineering context at all" test passes `undefined` so the check is skipped. The telegram-absence warning is independent of engineering context.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/spec-builder/__tests__/drive-model.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/drive-model.ts src/lib/spec-builder/__tests__/drive-model.test.ts
git commit -m "feat(spec-builder): validateDriveModels — telegram table + engineering cross-refs (G0-1)"
```

---

### Task 4: Patch wiring — `engineering` key + drive validation in `contract.ts`

**Files:**
- Modify: `src/lib/spec-builder/contract.ts` — `SpecContractPatch` interface (~line 95), `SpecContractPatchSchema` (~line 119), `validateSpecContractPatch` (after the unit-coordination block, ~line 1280)
- Test: `src/lib/spec-builder/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: `validateDriveModels` (Task 3), `EngineeringDataV1Schema`/`EngineeringDataV1` (Task 2).
- Produces: `SpecContractPatch.engineering?: EngineeringDataV1`; `validateSpecContractPatch` returns drive-model errors in its `string[]`.

- [ ] **Step 1: Write the failing tests** — append to the `validateSpecContractPatch`-focused describe in `src/lib/spec-builder/__tests__/contract.test.ts` (or a new describe using the file's existing imports):

```ts
describe("validateSpecContractPatch — drive models (G0-1)", () => {
  const CM_ID = "00000000-0000-0000-0000-000000000001";
  const hierarchyWithDrive = (drive: object | undefined) => ({
    units: [
      {
        unit_id: "00000000-0000-0000-0000-000000000aaa",
        unit_name: "Unit",
        equipment_type: "cell",
        description: "",
        excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "00000000-0000-0000-0000-000000000bbb",
            equipment_module_name: "Drive EM",
            description: "",
            control_modules: [
              {
                control_module_id: CM_ID,
                control_module_name: "VSD1",
                control_module_class: "drive",
                is_safety: false,
                description: "",
                io_signals: [],
                ...(drive ? { drive } : {}),
              },
            ],
          },
        ],
      },
    ],
  });

  it("rejects a hierarchy patch whose drive telegram mismatches its family", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: hierarchyWithDrive({
        family: "sinamics_g120",
        telegram: 105,
        speed_ref: { unit: "percent_ref_speed", signed: true },
        enable_policy: "enable_on_nonzero_ref",
      }),
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("telegram 105")),
    ).toBe(true);
  });

  it("rejects engineering entries referencing unknown CMs when hierarchy present", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: hierarchyWithDrive(undefined),
      engineering: {
        drives: [{ control_module_id: "00000000-0000-0000-0000-00000000dead" }],
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("unknown control module")),
    ).toBe(true);
  });

  it("engineering-only patch skips referential checks (context absent)", () => {
    const patch = SpecContractPatchSchema.parse({
      engineering: {
        drives: [{ control_module_id: "00000000-0000-0000-0000-00000000dead" }],
      },
    });
    expect(validateSpecContractPatch(patch)).toEqual([]);
  });
});
```

Add `SpecContractPatchSchema` / `validateSpecContractPatch` to the test file's imports if absent.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts` → FAIL: Zod strips the unknown `engineering` key → third test's parse drops it (and first test fails because validation doesn't run).

- [ ] **Step 3: Implement.** In `contract.ts`:

(a) imports — add `EngineeringDataV1Schema` to the schema import block and `type EngineeringDataV1` to the type import block from `@/types/spec-contract-v2`; add:

```ts
import { validateDriveModels } from "@/lib/spec-builder/drive-model";
```

(b) `SpecContractPatch` interface, after `unit_coordination` (~line 95):

```ts
  engineering?: EngineeringDataV1;
```

(c) `SpecContractPatchSchema`, after `unit_coordination` (~line 119):

```ts
  engineering: EngineeringDataV1Schema.optional(),
```

(d) `validateSpecContractPatch`, after the unit-coordination block (the `issues.push(...validateUnitCoordination(...))` loop, ~line 1280):

```ts
  // G0-1 drive models: needs hierarchy context (CMs live there); an
  // engineering-only patch skips — same convention as the blocks above.
  if (patch.hierarchy) {
    const control_modules = patch.hierarchy.units.flatMap((u) =>
      u.equipment_modules.flatMap((em) => em.control_modules),
    );
    issues.push(
      ...validateDriveModels({ control_modules, engineering: patch.engineering })
        .errors,
    );
  }
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(spec-builder): engineering patch key + drive-model validation gate (G0-1)"
```

---

### Task 5: Persistence — migration + load/save wiring

**Files:**
- Create: `supabase/migrations/20260720000000_engineering_data.sql`
- Modify: `src/lib/spec-builder/contract.ts` — `loadSpecContract` (~line 807 parse block), `writeSpecContract` (~line 987 projectUpdate block + docstring ~line 934)
- Test: `src/lib/spec-builder/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: `EngineeringDataV1` type (already imported in Task 4).
- Produces: `spec_projects.engineering` jsonb round-trip; `loadSpecContract` returns `engineering` populated.

- [ ] **Step 1: Write the failing test** — in the `writeSpecContract patch routing — new keys` describe (pattern of the `unit_coordination` routing test at `contract.test.ts:47`):

```ts
  it("routes engineering patch to spec_projects.engineering", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      engineering: {
        drives: [
          {
            control_module_id: "00000000-0000-0000-0000-000000000001",
            ref_speed_rpm: 1500.0,
            config_axis: 0x003f,
          },
        ],
      },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      engineering: expect.any(Object),
    });
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts` → FAIL: payload lacks `engineering`.

- [ ] **Step 3: Implement.**

(a) Migration `supabase/migrations/20260720000000_engineering_data.sql`:

```sql
-- G0-1: tier-2 Engineering Data container (record-only commissioning values).
-- First section: drives (HWIDSTW/ZSW, RefSpeed = p2000, ConfigAxis).
-- Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md
alter table spec_projects add column if not exists engineering jsonb;
```

⚠️ Author the file only — do NOT `db push` (remote history drift; reconcile first, as with the G0-9 wave).

(b) `loadSpecContract` — in the `SpecContractV2Schema.parse({...})` object after `unit_coordination` (~line 810):

```ts
    engineering:
      (projectRow.engineering as EngineeringDataV1 | null) ?? undefined,
```

(c) `writeSpecContract` — after the `unit_coordination` projectUpdate block (~line 990):

```ts
  if (parsed.engineering !== undefined) {
    projectUpdate.engineering = parsed.engineering;
  }
```

(d) Update the `writeSpecContract` docstring list of persisted keys to include `engineering`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260720000000_engineering_data.sql src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(spec-builder): persist engineering data on spec_projects (G0-1)"
```

---

### Task 6: Back-compat seeding shim — `seedDrivesFromNetworkConfig`

**Files:**
- Modify: `src/lib/spec-builder/drive-model.ts` (add export), `src/lib/spec-builder/contract.ts` (`loadSpecContract` return)
- Test: `src/lib/spec-builder/__tests__/drive-model.test.ts`

**Interfaces:**
- Consumes: `SpecContractV2` type; `NetworkConfig.vfd_family` / `.telegram.standard` (existing fields).
- Produces: `seedDrivesFromNetworkConfig(contract: SpecContractV2): SpecContractV2` — pure; returns the same reference when nothing seeded.

- [ ] **Step 1: Write the failing tests** — append to `drive-model.test.ts`. Build a minimal full contract via the existing schema (reuse whatever minimal-contract fixture helper `spec-contract-v2.test.ts` uses if one exists; otherwise inline):

```ts
describe("seedDrivesFromNetworkConfig (G0-1 back-compat)", () => {
  const baseCm = {
    control_module_id: CM_ID,
    control_module_name: "VSD1",
    control_module_class: "drive",
    is_safety: false,
    description: "",
    io_signals: [],
  };
  const contractWith = (cm: object) =>
    ({
      hierarchy: {
        units: [
          {
            unit_id: "00000000-0000-0000-0000-000000000aaa",
            unit_name: "U",
            equipment_type: "cell",
            description: "",
            excluded: false,
            equipment_modules: [
              {
                equipment_module_id: "00000000-0000-0000-0000-000000000bbb",
                equipment_module_name: "EM",
                description: "",
                control_modules: [cm],
              },
            ],
          },
        ],
      },
    }) as never; // structural subset — seeding only touches hierarchy

  it("seeds drive from network_config.vfd_family with golden-master defaults", () => {
    const out = seedDrivesFromNetworkConfig(
      contractWith({
        ...baseCm,
        network_config: {
          protocol: "profinet",
          ip_address: "192.168.0.10",
          station_name: "vsd1",
          update_cycle_ms: 4,
          vfd_family: "sinamics_g120",
          telegram: { standard: 1 },
        },
      }),
    );
    const seeded =
      out.hierarchy.units[0].equipment_modules[0].control_modules[0].drive;
    expect(seeded).toEqual({
      family: "sinamics_g120",
      telegram: 1,
      speed_ref: { unit: "percent_ref_speed", signed: true },
      enable_policy: "enable_on_nonzero_ref",
    });
  });

  it("omits telegram when network_config has none", () => {
    const out = seedDrivesFromNetworkConfig(
      contractWith({
        ...baseCm,
        network_config: {
          protocol: "profinet",
          ip_address: "192.168.0.10",
          station_name: "vsd1",
          update_cycle_ms: 4,
          vfd_family: "sinamics_g120",
        },
      }),
    );
    expect(
      out.hierarchy.units[0].equipment_modules[0].control_modules[0].drive?.telegram,
    ).toBeUndefined();
  });

  it("never overwrites an authored drive and returns same ref when no-op", () => {
    const authored = contractWith({ ...baseCm, drive: g120 });
    expect(seedDrivesFromNetworkConfig(authored)).toBe(authored);
    const noVfd = contractWith(baseCm);
    expect(seedDrivesFromNetworkConfig(noVfd)).toBe(noVfd);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/__tests__/drive-model.test.ts` → FAIL: `seedDrivesFromNetworkConfig` not exported.

- [ ] **Step 3: Implement** — append to `drive-model.ts` (add `SpecContractV2` and `DriveModelV1` to the type import):

```ts
/**
 * Loader shim (design §5): seed an in-memory tier-1 drive model from legacy
 * network_config.vfd_family when `drive` is absent. Pure — returns a new
 * object only when something was seeded. Defaults are the company
 * convention evidenced by the golden master; authors can override.
 * Never persisted by itself: the seeded value round-trips like any
 * authored value on the next write.
 */
export function seedDrivesFromNetworkConfig(
  contract: SpecContractV2,
): SpecContractV2 {
  let changed = false;
  const units = contract.hierarchy.units.map((unit) => ({
    ...unit,
    equipment_modules: unit.equipment_modules.map((em) => ({
      ...em,
      control_modules: em.control_modules.map((cm) => {
        if (cm.drive || !cm.network_config?.vfd_family) return cm;
        changed = true;
        const drive: DriveModelV1 = {
          family: cm.network_config.vfd_family,
          ...(cm.network_config.telegram
            ? { telegram: cm.network_config.telegram.standard }
            : {}),
          speed_ref: { unit: "percent_ref_speed", signed: true },
          enable_policy: "enable_on_nonzero_ref",
        };
        return { ...cm, drive };
      }),
    })),
  }));
  return changed ? { ...contract, hierarchy: { units } } : contract;
}
```

(The `.map()` calls allocate fresh arrays even when nothing changes, so return the ORIGINAL `contract` unless `changed` — the tests assert reference equality for the no-op path.)

(b) `loadSpecContract` — wrap the return value:

```ts
  return seedDrivesFromNetworkConfig(
    SpecContractV2Schema.parse({
      /* ...existing object unchanged... */
    }),
  );
```

Add `seedDrivesFromNetworkConfig` to the `drive-model` import in `contract.ts`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/spec-builder/__tests__/drive-model.test.ts src/lib/spec-builder/__tests__/contract.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/drive-model.ts src/lib/spec-builder/__tests__/drive-model.test.ts src/lib/spec-builder/contract.ts
git commit -m "feat(spec-builder): seed drive model from legacy network_config on load (G0-1)"
```

---

### Task 7: Golden fixture + full verification + tracker/board sync

**Files:**
- Test: `src/types/__tests__/spec-contract-v2.test.ts` (golden fixture describe)
- Modify: `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` (G0-1 row), `Docs/ROADMAP-RUNNABLE-CODE-HMI.tasks.json` (G0-1 state)

**Interfaces:**
- Consumes: everything above.
- Produces: G0-1 marked done in both trackers; Monday sync (status, update, doc already attached).

- [ ] **Step 1: Write the golden fixture test** (values from `exports/SRL-1427-500802-PACKML/MAP_Carriage_Drive.scl` — HRE values live ONLY here, per the genericity rule):

```ts
describe("G0-1 golden fixture — HRE Carriage Drive", () => {
  it("expresses everything MAP_Carriage_Drive.scl hand-authored", () => {
    const cmId = "00000000-0000-0000-0000-000000000c01";
    const drive = DriveModelV1Schema.parse({
      family: "sinamics_g120",
      telegram: 1,
      speed_ref: { unit: "percent_ref_speed", signed: true },
      enable_policy: "enable_on_nonzero_ref",
    });
    const engineering = EngineeringDataV1Schema.parse({
      drives: [
        {
          control_module_id: cmId,
          hw_id_stw: 322,
          hw_id_zsw: 322,
          ref_speed_rpm: 1500.0,
          config_axis: 0x003f,
        },
      ],
    });
    const { errors, warnings } = validateDriveModels({
      control_modules: [
        { control_module_id: cmId, control_module_name: "Carriage_Drive_VSD", drive },
      ],
      engineering,
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    // the writer's %→rpm factor is derivable: 1500 / 100 = 15.0
    expect((engineering.drives[0].ref_speed_rpm ?? 0) / 100).toBe(15.0);
  });
});
```

(Import `validateDriveModels` into the types test file for this one describe.)

- [ ] **Step 2: Run the full affected suites**

```
npx vitest run src/types/__tests__/spec-contract-v2.test.ts src/lib/spec-builder/__tests__/drive-model.test.ts src/lib/spec-builder/__tests__/contract.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Typecheck** — `npx tsc -b` → clean (fix any `verbatimModuleSyntax` / unused-import fallout).

- [ ] **Step 4: Post-Task Self-Check (CLAUDE.md)** — generic check: no HRE values outside test fixtures (`grep -n "322\|1500" src/types/spec-contract-v2.ts src/lib/spec-builder/drive-model.ts src/lib/spec-builder/contract.ts` → no hits).

- [ ] **Step 5: Update trackers.** `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` G0-1 row: `🔴` → `✅`, evidence → `SHIPPED <first>..<last>: DriveModelV1 + EngineeringDataV1, drive-model.ts validator, migration 20260720000000_engineering_data`. Mirror in `Docs/ROADMAP-RUNNABLE-CODE-HMI.tasks.json` (`"state": "DONE"`, same evidence).

- [ ] **Step 6: Commit**

```bash
git add src/types/__tests__/spec-contract-v2.test.ts Docs/ROADMAP-RUNNABLE-CODE-HMI.md Docs/ROADMAP-RUNNABLE-CODE-HMI.tasks.json
git commit -m "test(spec-builder): HRE golden fixture + tracker G0-1 DONE (G0-1)"
```

- [ ] **Step 7: Monday sync** — G0-1 subitem 3056337958: Status → `Done`, `create_update` summarising the commit range; recompute G0 phase progress per board rules.

---

## Self-Review Notes

- Spec §1/§2 → Tasks 1–2; §3 → Task 3; §3-wiring+patch → Task 4; §4 → Task 5; §5 → Task 6; §6 golden fixture → Task 7; §7 genericity → Task 7 Step 4. No spec section uncovered.
- Type names consistent across tasks: `DriveModelV1`, `EngineeringDataV1`, `DriveModelSpecView`, `validateDriveModels`, `seedDrivesFromNetworkConfig`.
- Task 4's Step-2 failure mode (Zod strips unknown keys) verified against `SpecContractPatchSchema` being a plain `z.object` (strips by default).
