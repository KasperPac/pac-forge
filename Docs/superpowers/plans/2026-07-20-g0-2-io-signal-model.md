# G0-2 Per-IO Signal Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This repo's recorded preference:** inline execution (executing-plans), no subagent dispatch.

**Goal:** Add per-signal polarity, functional conditioning, and analog raw↔EU scaling to `IoSignalV2` (tier 1) plus blanket conditioning defaults to `EngineeringDataV1` (tier 2), with validation, patch gating, and `deriveIoList` rendering.

**Architecture:** Mirrors the shipped G0-1 wave: additive optional Zod schemas in `src/types/spec-contract-v2.ts`, pure validator module `src/lib/spec-builder/io-signal-model.ts`, wiring inside the existing `if (patch.hierarchy)` gate in `contract.ts`, no DB migration. Spec: `Docs/superpowers/specs/2026-07-20-g0-2-io-signal-model-design.md`.

**Tech Stack:** TypeScript 5.9 strict (`verbatimModuleSyntax`, no enums), Zod v4, vitest.

## Global Constraints

- All new contract keys optional — every stored pre-G0-2 contract must parse unchanged.
- No project-specific values outside test fixtures (CLAUDE.md "All Changes Must Be Generic").
- `import type` for type-only imports; no unused locals.
- No DB migration this wave; never `supabase db push`.
- Test fixture UUIDs must satisfy Zod's UUID check — use the `00000000-0000-4000-8000-xxxxxxxxxxxx` form.
- Verification per task: `npx vitest run <suite>`; final gate `npx tsc -b` clean.
- Commit messages carry `(G0-2)` suffix.

---

### Task 1: Tier-1 schemas — polarity / conditioning / scaling on `IoSignalV2`

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (insert new section directly before `IoSignalTierSchema`; add 3 keys to `IoSignalV2Schema`)
- Test: `src/types/__tests__/spec-contract-v2.test.ts`

**Interfaces:**
- Consumes: existing `z` import.
- Produces: `IoPolaritySchema`/`IoPolarity`, `IoConditioningSchema`/`IoConditioning`, `RawSignalUnitSchema`/`RawSignalUnit`, `AnalogScalingSchema`/`AnalogScaling`; `IoSignalV2.polarity?/conditioning?/scaling?`.

- [ ] **Step 1: Write the failing tests** (append to `src/types/__tests__/spec-contract-v2.test.ts`; add `AnalogScalingSchema`, `IoSignalV2Schema` to the existing import from `../spec-contract-v2`):

```ts
describe("IoSignalV2 per-signal model (G0-2)", () => {
  const baseSig = {
    tag: "CM1_Therm",
    signal_type: "DI",
    io_address: "%I1.1",
    description: "Motor 1 thermistor",
    source: "wired",
  };

  it("parses a signal without any G0-2 field (back-compat)", () => {
    const parsed = IoSignalV2Schema.parse(baseSig);
    expect(parsed.polarity).toBeUndefined();
    expect(parsed.conditioning).toBeUndefined();
    expect(parsed.scaling).toBeUndefined();
  });

  it("parses an N/C fail-safe digital input with conditioning", () => {
    const parsed = IoSignalV2Schema.parse({
      ...baseSig,
      polarity: "nc",
      conditioning: { off_delay_ms: 5000 },
    });
    expect(parsed.polarity).toBe("nc");
    expect(parsed.conditioning?.off_delay_ms).toBe(5000);
  });

  it("parses an analog signal with raw↔EU scaling (inverted EU allowed)", () => {
    const parsed = IoSignalV2Schema.parse({
      ...baseSig,
      tag: "PT01",
      signal_type: "AI",
      scaling: {
        raw: { min: 4, max: 20, unit: "mA" },
        eu: { min: 10, max: 0, unit: "bar" },
      },
    });
    expect(parsed.scaling?.eu.unit).toBe("bar");
  });

  it("rejects unknown polarity and empty eu unit", () => {
    expect(() =>
      IoSignalV2Schema.parse({ ...baseSig, polarity: "inverted" }),
    ).toThrow();
    expect(() =>
      AnalogScalingSchema.parse({
        raw: { min: 4, max: 20, unit: "mA" },
        eu: { min: 0, max: 100, unit: "" },
      }),
    ).toThrow();
  });

  it("rejects negative conditioning delays", () => {
    expect(() =>
      IoSignalV2Schema.parse({ ...baseSig, conditioning: { on_delay_ms: -1 } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → FAIL: `AnalogScalingSchema`/`IoSignalV2Schema` not exported (IoSignalV2Schema may exist unexported — export it if so).

- [ ] **Step 3: Implement.** In `src/types/spec-contract-v2.ts`, directly before the `IoSignalTierSchema` comment block, insert:

```ts
// ============================================================
// Per-IO signal model (G0-2) — tier-1 signable FDS content.
// Blanket no-meaning conditioning defaults are tier 2
// (EngineeringDataV1.io_conditioning_defaults).
// Design: Docs/superpowers/specs/2026-07-20-g0-2-io-signal-model-design.md
// ============================================================

// Digital wiring polarity. "nc" = normally-closed fail-safe wiring: the
// healthy/untripped state reads TRUE at the terminal, so the MAP writer
// (G1-4) emits a NOT inversion to hand the EM a TRUE=abnormal signal —
// the golden master's `:= NOT "IO_Cond".CM1_Therm` lines.
export const IoPolaritySchema = z.enum(["no", "nc"]);
export type IoPolarity = z.infer<typeof IoPolaritySchema>;

// Functionally significant conditioning ONLY (e.g. "absent 5 s before
// fault" => off_delay_ms: 5000). Blanket filter times belong in
// engineering.io_conditioning_defaults (tier 2), not here.
export const IoConditioningSchema = z.object({
  on_delay_ms: z.number().int().nonnegative().optional(),
  off_delay_ms: z.number().int().nonnegative().optional(),
});
export type IoConditioning = z.infer<typeof IoConditioningSchema>;

export const RawSignalUnitSchema = z.enum(["mA", "V", "counts"]);
export type RawSignalUnit = z.infer<typeof RawSignalUnitSchema>;

// Raw electrical range ↔ engineering-unit range. Signable: FDS behavior
// (alarm setpoints, permissives, envelope limits) is written in eu units.
// EU range may be inverted; raw min≠max enforced in io-signal-model.ts.
export const AnalogScalingSchema = z.object({
  raw: z.object({
    min: z.number(),
    max: z.number(),
    unit: RawSignalUnitSchema,
  }),
  eu: z.object({
    min: z.number(),
    max: z.number(),
    unit: z.string().min(1), // °C, bar, %, mm …
  }),
});
export type AnalogScaling = z.infer<typeof AnalogScalingSchema>;
```

Then add to `IoSignalV2Schema` after `direction_overlay`:

```ts
  // G0-2 per-signal model — kind constraints enforced in io-signal-model.ts.
  polarity: IoPolaritySchema.optional(),
  conditioning: IoConditioningSchema.optional(),
  scaling: AnalogScalingSchema.optional(),
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(spec-contract): per-IO polarity, conditioning, analog scaling on IoSignalV2 (G0-2)"
```

---

### Task 2: Tier-2 — `io_conditioning_defaults` on `EngineeringDataV1`

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (insert before `EngineeringDataV1Schema`; add key inside it)
- Test: `src/types/__tests__/spec-contract-v2.test.ts`

**Interfaces:**
- Produces: `IoConditioningDefaultsSchema`/`IoConditioningDefaults`; `EngineeringDataV1.io_conditioning_defaults?`.

- [ ] **Step 1: Write the failing tests** (append inside the `EngineeringDataV1 (G0-1)` describe or a new one; `EngineeringDataV1Schema` already imported):

```ts
describe("EngineeringDataV1.io_conditioning_defaults (G0-2)", () => {
  it("parses blanket defaults and stays optional", () => {
    expect(EngineeringDataV1Schema.parse({}).io_conditioning_defaults).toBeUndefined();
    const parsed = EngineeringDataV1Schema.parse({
      io_conditioning_defaults: { di_debounce_ms: 10, ai_filter_ms: 100 },
    });
    expect(parsed.io_conditioning_defaults?.di_debounce_ms).toBe(10);
    expect(parsed.drives).toEqual([]); // G0-1 default untouched
  });

  it("rejects negative defaults", () => {
    expect(() =>
      EngineeringDataV1Schema.parse({
        io_conditioning_defaults: { di_debounce_ms: -5 },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → FAIL: unknown key stripped, `io_conditioning_defaults` undefined on second assertion.

- [ ] **Step 3: Implement.** Before `EngineeringDataV1Schema`:

```ts
// Blanket engineering defaults with no functional meaning (tier 2).
// Per-signal tier-1 `conditioning` overrides them where present —
// precedence is a G1-4 writer rule; the contract records both.
export const IoConditioningDefaultsSchema = z.object({
  di_debounce_ms: z.number().int().nonnegative().optional(),
  ai_filter_ms: z.number().int().nonnegative().optional(),
});
export type IoConditioningDefaults = z.infer<typeof IoConditioningDefaultsSchema>;
```

Inside `EngineeringDataV1Schema` after `drives`:

```ts
  io_conditioning_defaults: IoConditioningDefaultsSchema.optional(),
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts
git commit -m "feat(spec-contract): tier-2 io_conditioning_defaults on EngineeringDataV1 (G0-2)"
```

---

### Task 3: Validator — `validateIoSignals` in `io-signal-model.ts`

**Files:**
- Create: `src/lib/spec-builder/io-signal-model.ts`
- Test: `src/lib/spec-builder/__tests__/io-signal-model.test.ts` (new)

**Interfaces:**
- Consumes: `ControlModuleV2`, `IoSignalV2` types.
- Produces: `IoSignalIssues { errors: string[]; warnings: string[] }`, `validateIoSignals(control_modules: Pick<ControlModuleV2, "control_module_id" | "control_module_name" | "io_signals">[]): IoSignalIssues`. Task 4 consumes `validateIoSignals`.

- [ ] **Step 1: Write the failing tests** — create `src/lib/spec-builder/__tests__/io-signal-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateIoSignals } from "@/lib/spec-builder/io-signal-model";
import type { IoSignalV2 } from "@/types/spec-contract-v2";

function cm(io_signals: IoSignalV2[]) {
  return [
    {
      control_module_id: "00000000-0000-4000-8000-000000000001",
      control_module_name: "VSD1",
      io_signals,
    },
  ];
}

const di: IoSignalV2 = {
  tag: "CM1_Therm",
  signal_type: "DI",
  io_address: "%I1.1",
  description: "",
  source: "wired",
};
const ai: IoSignalV2 = {
  tag: "PT01",
  signal_type: "AI",
  io_address: "%IW96",
  description: "",
  source: "wired",
};

describe("validateIoSignals — kind constraints", () => {
  it("accepts a correctly annotated mixed set (no errors)", () => {
    const out = validateIoSignals(
      cm([
        { ...di, polarity: "nc", conditioning: { off_delay_ms: 5000 } },
        {
          ...ai,
          scaling: {
            raw: { min: 4, max: 20, unit: "mA" },
            eu: { min: 0, max: 10, unit: "bar" },
          },
        },
      ]),
    );
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("errors on polarity on an analog signal", () => {
    const out = validateIoSignals(cm([{ ...ai, polarity: "nc" }]));
    expect(out.errors.some((e) => e.includes("polarity"))).toBe(true);
  });

  it("errors on scaling on a digital signal", () => {
    const out = validateIoSignals(
      cm([
        {
          ...di,
          scaling: {
            raw: { min: 4, max: 20, unit: "mA" },
            eu: { min: 0, max: 1, unit: "x" },
          },
        },
      ]),
    );
    expect(out.errors.some((e) => e.includes("scaling"))).toBe(true);
  });

  it("errors on conditioning on an analog signal", () => {
    const out = validateIoSignals(
      cm([{ ...ai, conditioning: { on_delay_ms: 10 } }]),
    );
    expect(out.errors.some((e) => e.includes("conditioning"))).toBe(true);
  });

  it("errors on any G0-2 field on an internal signal", () => {
    const internal: IoSignalV2 = { ...di, signal_type: "internal", polarity: "no" };
    expect(validateIoSignals(cm([internal])).errors).toHaveLength(1);
  });

  it("errors on raw.min === raw.max", () => {
    const out = validateIoSignals(
      cm([
        {
          ...ai,
          scaling: {
            raw: { min: 4, max: 4, unit: "mA" },
            eu: { min: 0, max: 10, unit: "bar" },
          },
        },
      ]),
    );
    expect(out.errors.some((e) => e.includes("raw range"))).toBe(true);
  });

  it("errors on an empty conditioning object", () => {
    const out = validateIoSignals(cm([{ ...di, conditioning: {} }]));
    expect(out.errors.some((e) => e.includes("empty"))).toBe(true);
  });

  it("warns on AI without scaling", () => {
    const out = validateIoSignals(cm([ai]));
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w) => w.includes("scaling"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/__tests__/io-signal-model.test.ts` → FAIL: module unresolved.

- [ ] **Step 3: Implement** — create `src/lib/spec-builder/io-signal-model.ts`:

```ts
/**
 * G0-2 per-IO signal model semantics — pure helpers, no React/IO.
 * Kind constraints: polarity/conditioning are digital-only, scaling is
 * analog-only, internal signals accept none (no terminal wiring/raw range).
 * Design: Docs/superpowers/specs/2026-07-20-g0-2-io-signal-model-design.md
 */
import type { ControlModuleV2, IoSignalV2 } from "@/types/spec-contract-v2";

export interface IoSignalIssues {
  errors: string[];
  warnings: string[];
}

function isDigital(sig: IoSignalV2): boolean {
  return sig.signal_type === "DI" || sig.signal_type === "DO";
}

function isAnalog(sig: IoSignalV2): boolean {
  return sig.signal_type === "AI" || sig.signal_type === "AO";
}

export function validateIoSignals(
  control_modules: Pick<
    ControlModuleV2,
    "control_module_id" | "control_module_name" | "io_signals"
  >[],
): IoSignalIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const cm of control_modules) {
    for (const sig of cm.io_signals) {
      const where = `control_modules[${cm.control_module_name}].io_signals[${sig.tag}]`;

      if (sig.polarity !== undefined && !isDigital(sig)) {
        errors.push(
          `${where}: polarity only applies to digital signals (signal_type ${sig.signal_type})`,
        );
      }
      if (sig.conditioning !== undefined && !isDigital(sig)) {
        errors.push(
          `${where}: conditioning only applies to digital signals — analog filtering is a tier-2 default (signal_type ${sig.signal_type})`,
        );
      }
      if (sig.scaling !== undefined && !isAnalog(sig)) {
        errors.push(
          `${where}: scaling only applies to analog signals (signal_type ${sig.signal_type})`,
        );
      }
      if (
        sig.conditioning !== undefined &&
        sig.conditioning.on_delay_ms === undefined &&
        sig.conditioning.off_delay_ms === undefined
      ) {
        errors.push(`${where}: conditioning is empty — set a delay or remove it`);
      }
      if (sig.scaling && sig.scaling.raw.min === sig.scaling.raw.max) {
        errors.push(`${where}: scaling raw range is empty (min === max)`);
      }
      if (isAnalog(sig) && sig.scaling === undefined) {
        warnings.push(
          `${where}: analog signal without scaling — setpoints referencing it have undefined units`,
        );
      }
    }
  }

  return { errors, warnings };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/spec-builder/__tests__/io-signal-model.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/io-signal-model.ts src/lib/spec-builder/__tests__/io-signal-model.test.ts
git commit -m "feat(spec-builder): validateIoSignals — per-IO kind constraints (G0-2)"
```

---

### Task 4: Patch gate wiring + `deriveIoList` rendering

**Files:**
- Modify: `src/lib/spec-builder/contract.ts` — the G0-1 `if (patch.hierarchy)` block in `validateSpecContractPatch`; `deriveIoList` (~line 540)
- Test: `src/lib/spec-builder/__tests__/contract.test.ts`

**Interfaces:**
- Consumes: `validateIoSignals` (Task 3), existing `hierarchyWithDrive` test helper shape.
- Produces: patch-level rejection of kind violations; `deriveIoList` renders `normal_state`/`failsafe_state` from polarity.

- [ ] **Step 1: Write the failing tests** — append to the G0-1 describe in `contract.test.ts` (reuse its `hierarchyWithDrive` helper by generalizing: the helper already builds a CM; pass a CM override). Add a new describe:

```ts
describe("validateSpecContractPatch + deriveIoList — per-IO model (G0-2)", () => {
  const hierarchyWithSignal = (signal: object) => ({
    units: [
      {
        unit_id: "00000000-0000-4000-8000-000000000aaa",
        unit_name: "Unit",
        equipment_type: "cell",
        description: "",
        excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "00000000-0000-4000-8000-000000000bbb",
            equipment_module_name: "EM",
            description: "",
            control_modules: [
              {
                control_module_id: "00000000-0000-4000-8000-000000000001",
                control_module_name: "VSD1",
                control_module_class: "drive",
                is_safety: false,
                description: "",
                io_signals: [signal],
              },
            ],
          },
        ],
      },
    ],
  });

  it("rejects a hierarchy patch with polarity on an analog signal", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: hierarchyWithSignal({
        tag: "PT01",
        signal_type: "AI",
        io_address: "%IW96",
        description: "",
        source: "wired",
        polarity: "nc",
      }),
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("polarity")),
    ).toBe(true);
  });
});
```

For `deriveIoList` rendering: it is not exported. Test through its exported consumer if one exists; otherwise export it as internal-for-test. Check `contract.ts` — if `deriveIoList` is module-private, add `export` (it is deterministic and pure) and test directly:

```ts
describe("deriveIoList polarity rendering (G0-2)", () => {
  it("renders N/C polarity into normal_state/failsafe_state", () => {
    const hierarchy = {
      units: [
        {
          unit_id: "u1",
          unit_name: "U",
          equipment_type: "cell",
          description: "",
          excluded: false,
          equipment_modules: [
            {
              equipment_module_id: "em1",
              equipment_module_name: "EM",
              description: "",
              control_modules: [
                {
                  control_module_id: "cm1",
                  control_module_name: "VSD1",
                  control_module_class: "drive",
                  is_safety: false,
                  description: "",
                  io_signals: [
                    {
                      tag: "CM1_Therm",
                      signal_type: "DI",
                      io_address: "%I1.1",
                      description: "",
                      source: "wired",
                      polarity: "nc",
                    },
                    {
                      tag: "Start_PB",
                      signal_type: "DI",
                      io_address: "%I0.0",
                      description: "",
                      source: "wired",
                      polarity: "no",
                    },
                    {
                      tag: "Spare",
                      signal_type: "DI",
                      io_address: "%I0.1",
                      description: "",
                      source: "wired",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as never;
    const rows = deriveIoList(hierarchy);
    expect(rows[0].normal_state).toBe("N/C");
    expect(rows[0].failsafe_state).toBe("fail-safe (healthy = TRUE)");
    expect(rows[1].normal_state).toBe("N/O");
    expect(rows[1].failsafe_state).toBe("");
    expect(rows[2].normal_state).toBe("");
  });
});
```

Add `deriveIoList` to the import from `"../contract"`.
(Note: this hierarchy is passed directly to the pure function, not through Zod — plain string ids are fine.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts` → FAIL: `deriveIoList` not exported; polarity violation not reported.

- [ ] **Step 3: Implement.** In `contract.ts`:

(a) Import: add `validateIoSignals`:

```ts
import { validateIoSignals } from "@/lib/spec-builder/io-signal-model";
```

(b) Extend the G0-1 hierarchy gate in `validateSpecContractPatch`:

```ts
  // G0-1 drive models + G0-2 per-IO model: both need hierarchy context
  // (CMs live there); an engineering-only patch skips — same convention
  // as the blocks above.
  if (patch.hierarchy) {
    const control_modules = patch.hierarchy.units.flatMap((u) =>
      u.equipment_modules.flatMap((em) => em.control_modules),
    );
    issues.push(
      ...validateDriveModels({ control_modules, engineering: patch.engineering })
        .errors,
    );
    issues.push(...validateIoSignals(control_modules).errors);
  }
```

(c) `deriveIoList`: add `export` and render polarity:

```ts
export function deriveIoList(hierarchy: Hierarchy): IoListEntry[] {
  // ... loop unchanged, entry becomes:
          out.push({
            tag: sig.tag,
            device_type: dev.control_module_class,
            description: sig.description,
            signal_type: convertSignalDirection(String(sig.signal_type)),
            io_address: sig.io_address,
            // G0-2: render structured polarity into the signable view.
            normal_state:
              sig.polarity === "nc" ? "N/C" : sig.polarity === "no" ? "N/O" : "",
            failsafe_state:
              sig.polarity === "nc" ? "fail-safe (healthy = TRUE)" : "",
            equipment_module_id: asm.equipment_module_id,
            control_module_id: dev.control_module_id,
          });
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract.test.ts
git commit -m "feat(spec-builder): per-IO patch gate + deriveIoList polarity rendering (G0-2)"
```

---

### Task 5: Golden fixture + full verification + tracker/board sync

**Files:**
- Test: `src/types/__tests__/spec-contract-v2.test.ts`
- Modify: `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` (G0-2 row), `Docs/ROADMAP-RUNNABLE-CODE-HMI.tasks.json` (G0-2 state)

- [ ] **Step 1: Write the golden fixture test** (HRE values from `MAP_Carriage_Drive.scl` in tests ONLY; `validateIoSignals` imported alongside the existing `validateDriveModels` import):

```ts
describe("G0-2 golden fixture — HRE N/C inputs + generic analog", () => {
  it("expresses the MAP-layer signal treatment hand-authored on HRE", () => {
    const signals = [
      { tag: "CM1_Therm", io_address: "%I1.1" },
      { tag: "VSD1_CB_Trip", io_address: "%I0.4" },
      { tag: "BR1_Fault", io_address: "%I0.3" },
    ].map((s) => ({
      ...s,
      signal_type: "DI" as const,
      description: "N/C fail-safe input",
      source: "wired" as const,
      polarity: "nc" as const,
    }));
    const analog = {
      tag: "PT01",
      signal_type: "AI" as const,
      io_address: "%IW96",
      description: "Pressure transmitter",
      source: "wired" as const,
      scaling: {
        raw: { min: 4, max: 20, unit: "mA" as const },
        eu: { min: 0, max: 10, unit: "bar" },
      },
    };
    const out = validateIoSignals([
      {
        control_module_id: "00000000-0000-4000-8000-000000000c02",
        control_module_name: "Carriage_Drive_VSD",
        io_signals: [...signals.map((s) => IoSignalV2Schema.parse(s)), IoSignalV2Schema.parse(analog)],
      },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});
```

(Import `validateIoSignals` from `@/lib/spec-builder/io-signal-model` in the types test file.)

- [ ] **Step 2: Run all affected suites**

```
npx vitest run src/types/__tests__/spec-contract-v2.test.ts src/lib/spec-builder/__tests__/io-signal-model.test.ts src/lib/spec-builder/__tests__/contract.test.ts src/lib/spec-builder/__tests__/drive-model.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Typecheck** — `npx tsc -b` → clean.

- [ ] **Step 4: Genericity check** — no HRE tags/addresses outside test files: `grep -rn "CM1_Therm\|VSD1_CB_Trip\|BR1_Fault" src --include=*.ts` → hits only in `__tests__`.

- [ ] **Step 5: Update trackers.** `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` G0-2 row `🔴` → `✅`, evidence `SHIPPED 2026-07-20 <first>..<last>: polarity/conditioning/scaling on IoSignalV2, io_conditioning_defaults, io-signal-model.ts validator, deriveIoList rendering; placement amended to IoSignalV2 (spec 2026-07-20)`. Mirror in `.tasks.json` (`"state": "DONE"`).

- [ ] **Step 6: Commit**

```bash
git add src/types/__tests__/spec-contract-v2.test.ts Docs/ROADMAP-RUNNABLE-CODE-HMI.md Docs/ROADMAP-RUNNABLE-CODE-HMI.tasks.json
git commit -m "test(spec-builder): G0-2 golden fixture + tracker G0-2 DONE (G0-2)"
```

- [ ] **Step 7: Monday sync** — G0-2 subitem 3056337957: Status → `Done`, timeline end → completion date, `create_update` with commit range + summary; append plan summary already on the item Doc.

---

## Self-Review Notes

- Spec §1 → Task 1; §2 → Task 2; §3 → Tasks 3–4; §4 → Task 4; §5 (no migration) → constraint; §6 → per-task tests + Task 5 fixture; §7 → Task 5 Step 4. No gaps.
- Names consistent: `IoPolaritySchema`, `IoConditioningSchema`, `AnalogScalingSchema`, `IoConditioningDefaultsSchema`, `validateIoSignals`, `deriveIoList`.
- `IoSignalV2Schema` export status unknown — Task 1 Step 2 notes to export it if currently unexported.
