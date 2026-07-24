# Hardware in the FDS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `SpecContractV2` a manually-authored hardware model (CPU + racks/modules), authored at the skeleton stage with early IO-fit validation, so codegen can later build a runnable project from scratch.

**Architecture:** A new optional `hardware` key on `SpecContractV2` (Zod schema in `spec-contract-v2.ts`, sibling to `EngineeringDataV1`), stored in a new `spec_projects.hardware` jsonb column and assembled by `loadSpecContract`. Authored in a dedicated "Hardware" step in the Spec Skeleton Wizard, where a pure `validateHardwareFit` function warns (non-blocking) when the instrument register's IO doesn't fit the declared modules. An optional flag renders a hardware BOM into the DOCX.

**Tech Stack:** React 19 + TypeScript 5.9 (strict), Zod, Vitest, Supabase (jsonb column), `docx` library.

**Spec:** `Docs/superpowers/specs/2026-07-24-hardware-in-fds-design.md`

## Global Constraints

- **TS strict** — `import type { … }` for type-only imports; no enums (use `as const` / unions); no unused locals/params. `npx tsc -b` must pass clean.
- **Generic across machine types** — no project-specific device names, module lists, or CPU choices anywhere. Everything is driven by the project's own register + the engineer's entry.
- **Dialect** — hardware data stays in **IEC** (`DI` / `DO` / `AI` / `AO`); Siemens `DQ` / `AQ` appears only at code-emission sites (none in this cut). Normalize register signal-type strings with `convertSignalDirection()` from `src/lib/spec-builder/dialect.ts`.
- **Refinements from planning review** (supersede the spec where they differ): (1) address-range fit check is **deferred** to the auto-addressing follow-on — declare-only modules carry no start address; (2) the schema lives in `spec-contract-v2.ts`, **no separate `hardware.ts`**; (3) `validateHardwareFit`'s `FitSignal` has no `address` field.
- **Testing** — Vitest. Run a single suite with `npx vitest run <path>`. Worktrees need `.env.local` copied in for any suite that transitively imports `src/lib/supabase.ts` (schema/pure suites here do not).
- **Commits** — commit steps assume the user has authorized execution. Under the standing "no commit until asked" rule, `git add` to stage and let the user run the commit.

---

### Task 1: `HardwareModelV1` schema, types, and contract key

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (add schemas near the other `*V1` siblings, ~line 1712; add the `hardware` key to `SpecContractV2Schema`, ~line 1748)
- Modify: `src/types/spec-builder.ts` (add `hardware` to `SpecProject` ~line 90 and `SpecProjectUpdate` ~line 139)
- Test: `src/types/__tests__/hardware-model.test.ts` (create)

**Interfaces:**
- Produces: `HardwareModelV1`, `HardwareModule`, `HardwareRack`, `HardwareCpu`, `HardwareSignalType` types + `HardwareModelV1Schema` (and the member schemas), all exported from `@/types/spec-contract-v2`. `SpecContractV2.hardware?: HardwareModelV1`. `SpecProject.hardware?: HardwareModelV1 | null`, `SpecProjectUpdate.hardware?: HardwareModelV1`.

- [ ] **Step 1: Write the failing schema test**

Create `src/types/__tests__/hardware-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HardwareModelV1Schema } from "@/types/spec-contract-v2";

describe("HardwareModelV1Schema", () => {
  it("accepts a minimal CPU-only model", () => {
    const parsed = HardwareModelV1Schema.parse({
      platform: "SIEMENS_TIA",
      cpu: { cpu_type: "CPU 1515-2 PN" },
    });
    expect(parsed.cpu.cpu_type).toBe("CPU 1515-2 PN");
    expect(parsed.racks).toEqual([]); // default
  });

  it("accepts a full multi-module model", () => {
    const parsed = HardwareModelV1Schema.parse({
      platform: "SIEMENS_TIA",
      tia_version: "V20",
      cpu: { cpu_type: "CPU 1515-2 PN", cpu_order_number: "6ES7 515-2AM03-0AB0", firmware: "V3.1" },
      racks: [
        { rack: 0, modules: [
          { slot: 1, module_type: "DI 16x24VDC", channel_count: 16, signal_type: "DI" },
          { slot: 2, module_type: "AI 8xU/I/RTD", channel_count: 8, signal_type: "AI" },
        ] },
      ],
      render_in_docx: true,
    });
    expect(parsed.racks[0].modules).toHaveLength(2);
    expect(parsed.render_in_docx).toBe(true);
  });

  it("rejects an unknown platform", () => {
    expect(() =>
      HardwareModelV1Schema.parse({ platform: "ROCKWELL", cpu: { cpu_type: "x" } }),
    ).toThrow();
  });

  it("rejects a Siemens-dialect module signal_type (data stays IEC)", () => {
    expect(() =>
      HardwareModelV1Schema.parse({
        platform: "SIEMENS_TIA",
        cpu: { cpu_type: "x" },
        racks: [{ rack: 0, modules: [{ slot: 1, module_type: "DQ 16", signal_type: "DQ" }] }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/__tests__/hardware-model.test.ts`
Expected: FAIL — `HardwareModelV1Schema` is not exported.

- [ ] **Step 3: Add the schemas to `spec-contract-v2.ts`**

Insert immediately after `EngineeringDataV1Schema` / its type export (~line 1712), before the `// ===` separator that precedes `SpecContractV2Schema`:

```ts
// ============================================================
// Hardware model (G0-16) — CPU + racks/modules, authored manually at the
// skeleton stage. Tier-2 realization data. Signal types are IEC (dialect.ts
// rule); Siemens DQ/AQ only appear at emission sites. Design:
// Docs/superpowers/specs/2026-07-24-hardware-in-fds-design.md
// ============================================================

export const HardwareSignalTypeSchema = z.enum(["DI", "DO", "AI", "AO"]);
export type HardwareSignalType = z.infer<typeof HardwareSignalTypeSchema>;

export const HardwareModuleSchema = z.object({
  slot: z.number().int().nonnegative(),
  module_type: z.string().min(1),
  order_number: z.string().optional(),
  channel_count: z.number().int().positive().optional(),
  signal_type: HardwareSignalTypeSchema.optional(),
  description: z.string().optional(),
});
export type HardwareModule = z.infer<typeof HardwareModuleSchema>;

export const HardwareRackSchema = z.object({
  rack: z.number().int().nonnegative(),
  modules: z.array(HardwareModuleSchema).default([]),
});
export type HardwareRack = z.infer<typeof HardwareRackSchema>;

export const HardwareCpuSchema = z.object({
  cpu_type: z.string().min(1),
  cpu_order_number: z.string().optional(),
  firmware: z.string().optional(),
});
export type HardwareCpu = z.infer<typeof HardwareCpuSchema>;

export const HardwareModelV1Schema = z.object({
  platform: z.literal("SIEMENS_TIA"),
  tia_version: z.string().optional(),
  cpu: HardwareCpuSchema,
  racks: z.array(HardwareRackSchema).default([]),
  render_in_docx: z.boolean().optional(),
  notes: z.string().optional(),
});
export type HardwareModelV1 = z.infer<typeof HardwareModelV1Schema>;
```

Then add the key to `SpecContractV2Schema` (alongside `engineering`, ~line 1748):

```ts
  // G0-16: hardware model. Absent until authored.
  hardware: HardwareModelV1Schema.optional(),
```

- [ ] **Step 4: Add `hardware` to the SpecProject types**

In `src/types/spec-builder.ts`, add the import to the existing `spec-contract-v2` type import group near the top:

```ts
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
```

Add to `interface SpecProject` (after the `engineering?` line, ~90):

```ts
  // G0-16 hardware model (jsonb column; authored in the skeleton wizard)
  hardware?: HardwareModelV1 | null;
```

Add to `interface SpecProjectUpdate` (after `comms_protocol?`, ~129):

```ts
  hardware?: HardwareModelV1;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/types/__tests__/hardware-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/spec-builder.ts src/types/__tests__/hardware-model.test.ts
git commit -m "feat(hardware): HardwareModelV1 schema + contract/SpecProject keys (G0-16)"
```

---

### Task 2: Migration + contract assembly

**Files:**
- Create: `supabase/migrations/20260724000000_hardware_model.sql`
- Modify: `src/lib/spec-builder/contract.ts` (`loadSpecContract`, ~line 864)

**Interfaces:**
- Consumes: `HardwareModelV1` (Task 1).
- Produces: `loadSpecContract()` now returns a contract whose `hardware` key is populated from `spec_projects.hardware`.

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260724000000_hardware_model.sql`:

```sql
-- G0-16: hardware model (CPU + racks/modules) authored at the skeleton stage.
-- Tier-2 realization data; read by loadSpecContract into contract.hardware.
-- Design: Docs/superpowers/specs/2026-07-24-hardware-in-fds-design.md
alter table spec_projects add column if not exists hardware jsonb;
```

- [ ] **Step 2: Wire the assembly read**

In `src/lib/spec-builder/contract.ts`, inside `loadSpecContract`, add one line to the `SpecContractV2Schema.parse({ … })` object (next to the `engineering:` line, ~864):

```ts
    hardware: (projectRow.hardware as HardwareModelV1 | null) ?? undefined,
```

Add `HardwareModelV1` to the existing `@/types/spec-contract-v2` import group at the top of the file.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors. (The read path mirrors the ten sibling keys; DB round-trip is verified manually after `npx supabase db push`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260724000000_hardware_model.sql src/lib/spec-builder/contract.ts
git commit -m "feat(hardware): spec_projects.hardware column + loadSpecContract assembly (G0-16)"
```

> **Deploy note:** the column is not live until someone runs `npx supabase db push`. Flag this to the user; do not assume it ran.

---

### Task 3: `validateHardwareFit` — pure fit validation

**Files:**
- Create: `src/lib/spec-builder/hardware-fit.ts`
- Test: `src/lib/spec-builder/__tests__/hardware-fit.test.ts` (create)

**Interfaces:**
- Consumes: `HardwareModelV1`, `HardwareSignalType` (Task 1); `convertSignalDirection` from `./dialect`.
- Produces:
  - `type FitSignal = { signal_type: string }`
  - `type HardwareFitWarning = { kind: "capacity" | "type_incompatibility"; signal_class: HardwareSignalType; message: string }`
  - `validateHardwareFit(hardware: HardwareModelV1 | null | undefined, signals: FitSignal[]): HardwareFitWarning[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/spec-builder/__tests__/hardware-fit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateHardwareFit } from "@/lib/spec-builder/hardware-fit";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

const hw = (modules: HardwareModelV1["racks"][number]["modules"]): HardwareModelV1 => ({
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1515-2 PN" },
  racks: [{ rack: 0, modules }],
});

describe("validateHardwareFit", () => {
  it("returns no warnings when nothing is declared", () => {
    expect(validateHardwareFit(null, [{ signal_type: "DI" }])).toEqual([]);
    expect(validateHardwareFit(undefined, [{ signal_type: "DI" }])).toEqual([]);
  });

  it("returns no warnings when capacity is sufficient", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI 16", channel_count: 16, signal_type: "DI" }]),
      [{ signal_type: "DI" }, { signal_type: "DI" }],
    );
    expect(w).toEqual([]);
  });

  it("warns when a class is short on channels", () => {
    const signals = Array.from({ length: 12 }, () => ({ signal_type: "DI" }));
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI 8", channel_count: 8, signal_type: "DI" }]),
      signals,
    );
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("capacity");
    expect(w[0].signal_class).toBe("DI");
    expect(w[0].message).toContain("12");
    expect(w[0].message).toContain("8");
  });

  it("warns type_incompatibility when a class has zero modules", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI 16", channel_count: 16, signal_type: "DI" }]),
      [{ signal_type: "AI" }],
    );
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("type_incompatibility");
    expect(w[0].signal_class).toBe("AI");
  });

  it("normalizes dialect + case: 'DQ'/'do' demand buckets to DO", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DO 8", channel_count: 8, signal_type: "DO" }]),
      [{ signal_type: "DQ" }, { signal_type: "do" }],
    );
    expect(w).toEqual([]); // both demand DO, 8 channels cover 2
  });

  it("ignores 'internal' signals (no physical channel needed)", () => {
    const w = validateHardwareFit(hw([]), [{ signal_type: "internal" }]);
    expect(w).toEqual([]);
  });

  it("treats a module with no channel_count as providing 0 channels", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI ?", signal_type: "DI" }]),
      [{ signal_type: "DI" }],
    );
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("capacity");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/__tests__/hardware-fit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `hardware-fit.ts`**

Create `src/lib/spec-builder/hardware-fit.ts`:

```ts
/**
 * Pure hardware-fit validation (G0-16). Compares the IO demanded by a project's
 * signals against the channels declared by the hardware model's modules, and
 * returns non-blocking warnings. No React, no IO.
 *
 * Data is IEC (dialect.ts): signals are normalized to DI/DO/AI/AO; "internal"
 * signals need no physical channel. Address-range checking is deferred to the
 * auto-addressing follow-on (declare-only modules carry no start address).
 */
import type { HardwareModelV1, HardwareSignalType } from "@/types/spec-contract-v2";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";

export type FitSignal = { signal_type: string };

export type HardwareFitWarning = {
  kind: "capacity" | "type_incompatibility";
  signal_class: HardwareSignalType;
  message: string;
};

const CLASSES: HardwareSignalType[] = ["DI", "DO", "AI", "AO"];
const LABEL: Record<HardwareSignalType, string> = {
  DI: "digital input",
  DO: "digital output",
  AI: "analog input",
  AO: "analog output",
};

/** IEC class for a signal, or null for internal/unknown (needs no channel). */
function classOf(signalType: string): HardwareSignalType | null {
  const iec = convertSignalDirection(signalType);
  return iec === "internal" ? null : iec;
}

export function validateHardwareFit(
  hardware: HardwareModelV1 | null | undefined,
  signals: FitSignal[],
): HardwareFitWarning[] {
  if (!hardware) return [];

  const demand: Record<HardwareSignalType, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const s of signals) {
    const cls = classOf(s.signal_type);
    if (cls) demand[cls] += 1;
  }

  const provided: Record<HardwareSignalType, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  const moduleCount: Record<HardwareSignalType, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const rack of hardware.racks) {
    for (const m of rack.modules) {
      if (!m.signal_type) continue;
      moduleCount[m.signal_type] += 1;
      provided[m.signal_type] += m.channel_count ?? 0;
    }
  }

  const warnings: HardwareFitWarning[] = [];
  for (const cls of CLASSES) {
    if (demand[cls] === 0) continue;
    if (moduleCount[cls] === 0) {
      warnings.push({
        kind: "type_incompatibility",
        signal_class: cls,
        message: `${demand[cls]} ${LABEL[cls]} signal(s) present, no ${cls} module declared.`,
      });
    } else if (demand[cls] > provided[cls]) {
      warnings.push({
        kind: "capacity",
        signal_class: cls,
        message: `${demand[cls]} ${cls} signals, ${provided[cls]} ${cls} channels declared — short ${demand[cls] - provided[cls]}.`,
      });
    }
  }
  return warnings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/hardware-fit.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/hardware-fit.ts src/lib/spec-builder/__tests__/hardware-fit.test.ts
git commit -m "feat(hardware): validateHardwareFit capacity + type-incompatibility checks (G0-16)"
```

---

### Task 4: `HardwareStep` component

**Files:**
- Create: `src/components/spec-builder/hardware-step.tsx`
- Test: `src/components/spec-builder/__tests__/hardware-step.test.tsx` (create)

**Interfaces:**
- Consumes: `HardwareModelV1`, `HardwareSignalType` (Task 1); `validateHardwareFit`, `FitSignal` (Task 3).
- Produces:
  - `emptyHardware(): HardwareModelV1` — seed `{ platform: "SIEMENS_TIA", cpu: { cpu_type: "" }, racks: [{ rack: 0, modules: [] }] }`
  - `plcModelFromHardware(h?: HardwareModelV1 | null): string`
  - `HardwareStep({ hardware, onChange, signals }: { hardware: HardwareModelV1; onChange: (h: HardwareModelV1) => void; signals: FitSignal[] })`

- [ ] **Step 1: Write the failing test**

Create `src/components/spec-builder/__tests__/hardware-step.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HardwareStep, emptyHardware, plcModelFromHardware } from "@/components/spec-builder/hardware-step";

describe("plcModelFromHardware", () => {
  it("derives plc_model from cpu_type, trimmed", () => {
    expect(plcModelFromHardware({ platform: "SIEMENS_TIA", cpu: { cpu_type: "  CPU 1515  " }, racks: [] })).toBe("CPU 1515");
    expect(plcModelFromHardware(null)).toBe("");
  });
});

describe("HardwareStep", () => {
  it("renders a fit warning when the register is short on channels", () => {
    const hardware = emptyHardware();
    hardware.racks[0].modules.push({ slot: 1, module_type: "DI 8", channel_count: 8, signal_type: "DI" });
    const signals = Array.from({ length: 12 }, () => ({ signal_type: "DI" }));
    render(<HardwareStep hardware={hardware} onChange={vi.fn()} signals={signals} />);
    expect(screen.getByText(/short 4/i)).toBeInTheDocument();
  });

  it("renders no warning banner when hardware fits", () => {
    const hardware = emptyHardware();
    hardware.racks[0].modules.push({ slot: 1, module_type: "DI 16", channel_count: 16, signal_type: "DI" });
    render(<HardwareStep hardware={hardware} onChange={vi.fn()} signals={[{ signal_type: "DI" }]} />);
    expect(screen.queryByTestId("hardware-fit-warnings")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spec-builder/__tests__/hardware-step.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `hardware-step.tsx`**

Create `src/components/spec-builder/hardware-step.tsx`:

```tsx
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { HardwareModelV1, HardwareSignalType } from "@/types/spec-contract-v2";
import { validateHardwareFit, type FitSignal } from "@/lib/spec-builder/hardware-fit";

const SIGNAL_TYPES: HardwareSignalType[] = ["DI", "DO", "AI", "AO"];

export function emptyHardware(): HardwareModelV1 {
  return { platform: "SIEMENS_TIA", cpu: { cpu_type: "" }, racks: [{ rack: 0, modules: [] }] };
}

export function plcModelFromHardware(h?: HardwareModelV1 | null): string {
  return h?.cpu.cpu_type?.trim() ?? "";
}

export function HardwareStep({
  hardware,
  onChange,
  signals,
}: {
  hardware: HardwareModelV1;
  onChange: (h: HardwareModelV1) => void;
  signals: FitSignal[];
}) {
  const warnings = validateHardwareFit(hardware, signals);
  const modules = hardware.racks[0]?.modules ?? [];

  const setCpu = (patch: Partial<HardwareModelV1["cpu"]>) =>
    onChange({ ...hardware, cpu: { ...hardware.cpu, ...patch } });

  const setModules = (next: HardwareModelV1["racks"][number]["modules"]) => {
    const racks = hardware.racks.length ? [...hardware.racks] : [{ rack: 0, modules: [] }];
    racks[0] = { ...racks[0], modules: next };
    onChange({ ...hardware, racks });
  };

  const addModule = () =>
    setModules([...modules, { slot: modules.length + 1, module_type: "" }]);
  const removeModule = (i: number) => setModules(modules.filter((_, j) => j !== i));
  const updateModule = (i: number, patch: Partial<(typeof modules)[number]>) =>
    setModules(modules.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <div className="space-y-4">
      {/* CPU */}
      <div className="grid gap-3 max-w-lg">
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU Model *" value={hardware.cpu.cpu_type}
            onChange={(v) => setCpu({ cpu_type: v })} placeholder="e.g. CPU 1515-2 PN" />
          <Field label="Order Number" mono value={hardware.cpu.cpu_order_number ?? ""}
            onChange={(v) => setCpu({ cpu_order_number: v || undefined })} placeholder="6ES7 …" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Firmware" mono value={hardware.cpu.firmware ?? ""}
            onChange={(v) => setCpu({ firmware: v || undefined })} placeholder="newest if blank" />
          <Field label="TIA Version" mono value={hardware.tia_version ?? ""}
            onChange={(v) => onChange({ ...hardware, tia_version: v || undefined })} placeholder="e.g. V20" />
        </div>
      </div>

      {/* Fit banner */}
      {warnings.length > 0 && (
        <Card data-testid="hardware-fit-warnings" className="p-3 border-amber-500/50 bg-amber-500/5 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Hardware does not cover all IO ({warnings.length})
          </div>
          <ul className="text-[11px] font-mono text-amber-800 space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </Card>
      )}

      {/* Module table */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          IO modules on the central rack. Warnings above are advisory — you can proceed regardless.
        </p>
        <Button variant="outline" size="sm" onClick={addModule}>
          <Plus className="h-3 w-3 mr-1" /> Add Module
        </Button>
      </div>
      <div className="grid gap-2">
        {modules.map((m, i) => (
          <Card key={i} className="p-2 grid grid-cols-[3rem_1fr_5rem_6rem_2rem] gap-2 items-center">
            <Input type="number" value={m.slot} className="h-7 text-xs"
              onChange={(e) => updateModule(i, { slot: Number(e.target.value) })} />
            <Input value={m.module_type} placeholder="Module type (e.g. DI 16x24VDC)" className="h-7 text-sm"
              onChange={(e) => updateModule(i, { module_type: e.target.value })} />
            <Input type="number" value={m.channel_count ?? ""} placeholder="ch" className="h-7 text-xs"
              onChange={(e) => updateModule(i, { channel_count: e.target.value ? Number(e.target.value) : undefined })} />
            <Select value={m.signal_type ?? ""}
              onValueChange={(v) => updateModule(i, { signal_type: v as HardwareSignalType })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="type" /></SelectTrigger>
              <SelectContent>
                {SIGNAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeModule(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </Card>
        ))}
      </div>

      {/* DOCX appendix toggle */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={hardware.render_in_docx ?? false}
          onCheckedChange={(v) => onChange({ ...hardware, render_in_docx: v === true })} />
        Include a hardware schedule in the exported FDS document
      </label>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} placeholder={placeholder}
        className={mono ? "text-sm font-mono" : "text-sm"}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
```

> If `@/components/ui/checkbox` is absent, add it first: `npx shadcn@latest add checkbox`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/spec-builder/__tests__/hardware-step.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b` → no errors.

```bash
git add src/components/spec-builder/hardware-step.tsx src/components/spec-builder/__tests__/hardware-step.test.tsx
git commit -m "feat(hardware): HardwareStep component with live fit banner (G0-16)"
```

---

### Task 5: Wire `HardwareStep` into the skeleton wizard

**Files:**
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx`

**Interfaces:**
- Consumes: `HardwareStep`, `emptyHardware`, `plcModelFromHardware` (Task 4); `HardwareModelV1` (Task 1).
- Produces: the wizard now authors + persists `hardware`, and derives `plc_model` from it on confirm.

- [ ] **Step 1: Add imports**

Add to `spec-skeleton-wizard.tsx`:

```tsx
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import { HardwareStep, emptyHardware, plcModelFromHardware } from "./hardware-step";
```

- [ ] **Step 2: Insert "Hardware" into the step list**

Change `WIZARD_STEPS` to insert `"Hardware"` after `"Control System"`:

```tsx
const WIZARD_STEPS = [
  "Document Metadata",
  "Control System",
  "Hardware",
  "Machine Hierarchy",
  "Machine Modes",
  "Safety Gates",
  "Alarm Configuration",
  "Review & Confirm",
] as const;
```

- [ ] **Step 3: Add hardware state (after the `control` state, ~line 82)**

```tsx
  // Step 3 — Hardware model (seed empty; existing value wins)
  const [hardware, setHardware] = useState<HardwareModelV1>(
    () => (spec.hardware as HardwareModelV1 | null) ?? emptyHardware(),
  );
```

- [ ] **Step 4: Update `canNext` for the shifted indices**

Replace the `canNext` IIFE body with (note: step-1 no longer requires `plc_model` — it moved to the Hardware step; step 2 Hardware is optional):

```tsx
  const canNext = (() => {
    if (step === 0) return meta.doc_code.trim() && meta.title.trim() && meta.client_name.trim();
    if (step === 1) return true; // control system fields optional
    if (step === 2) return true; // hardware optional (fit warnings are advisory)
    if (step === 3) return units.some((s) => !s.excluded && s.equipment_modules.length > 0);
    if (step === 4) return modes.length > 0 && modes.filter((m) => m.is_default).length === 1;
    if (step === 5) return true; // safety gates optional
    if (step === 6) return alarmTiers.length > 0;
    return true;
  })();
```

- [ ] **Step 5: Update `handleNext` (last index 6→7; add hardware + derived plc_model to the save)**

```tsx
  const handleNext = useCallback(async () => {
    if (step < 7) {
      setStep((s) => s + 1);
      return;
    }
    await updateSpec.mutateAsync({
      id: spec.id,
      ...meta,
      ...control,
      plc_model: plcModelFromHardware(hardware),
      hardware,
      confirmed_units: units,
      confirmed_modes: modes,
      safety_gates: safetyGates,
      alarm_tiers: alarmTiers,
      confirmation_status: "confirmed",
    });
    onComplete();
  }, [step, spec.id, meta, control, hardware, units, modes, safetyGates, alarmTiers, updateSpec, onComplete]);
```

- [ ] **Step 6: Update the nav button (last index 6→7)**

In the footer `<Button onClick={handleNext}>`, change both `step === 6` / `step < 6` to `step === 7` / `step < 7`.

- [ ] **Step 7: Update the step-content render block (shift 2..6 → 3..7, insert Hardware at 2)**

```tsx
        {step === 0 && <StepMetadata meta={meta} onChange={setMeta} />}
        {step === 1 && <StepControlSystem control={control} onChange={setControl} />}
        {step === 2 && (
          <HardwareStep
            hardware={hardware}
            onChange={setHardware}
            signals={register.tags.map((t) => ({ signal_type: t.signal_type }))}
          />
        )}
        {step === 3 && (
          <MachineHierarchyTable
            units={units}
            availableTags={register.tags}
            onChange={setSubsystems}
            onInferHierarchy={inferHierarchy}
            inferring={inferringHierarchy}
          />
        )}
        {step === 4 && <StepMachineModes modes={modes} onChange={setModes} />}
        {step === 5 && (
          <StepSafetyGates
            gates={safetyGates}
            onChange={setSafetyGates}
            safetyTags={register.tags.filter((t) => t.is_safety).map((t) => t.tag)}
            equipmentModules={units.flatMap((u) =>
              u.equipment_modules.map((e) => ({ id: e.equipment_module_id, name: e.equipment_module_name })),
            )}
          />
        )}
        {step === 6 && <StepAlarmConfig tiers={alarmTiers} onChange={setAlarmTiers} />}
        {step === 7 && (
          <StepReview
            meta={meta}
            control={control}
            units={units}
            modes={modes}
            safetyGates={safetyGates}
            alarmTiers={alarmTiers}
          />
        )}
```

- [ ] **Step 8: Remove the now-moved PLC Model field from `StepControlSystem`**

Delete the `<Field label="PLC Model *" … />` block in `StepControlSystem` (its value is now authored on the Hardware step and derived into `plc_model` on save). Leave HMI Type + Communications Protocol untouched.

- [ ] **Step 9: Typecheck + run the wizard-adjacent suite**

Run: `npx tsc -b` → no errors.
Run: `npx vitest run src/components/spec-builder/__tests__/hardware-step.test.tsx` → still PASS.

- [ ] **Step 10: Manual verification**

Start `npm run dev`, open a spec's skeleton wizard, confirm: the "Hardware" step appears after "Control System"; entering a CPU + modules shows/clears the fit banner as capacity changes; "Confirm & Save" persists and the project's `plc_model` reflects the CPU. (Requires the Task 2 column pushed to Supabase.)

- [ ] **Step 11: Commit**

```bash
git add src/components/spec-builder/spec-skeleton-wizard.tsx
git commit -m "feat(hardware): author hardware in a dedicated skeleton wizard step (G0-16)"
```

---

### Task 6: Optional DOCX hardware BOM

**Files:**
- Modify: `src/lib/spec-builder/docx-exporter.ts`
- Test: `src/lib/spec-builder/__tests__/docx-hardware-bom.test.ts` (create)

**Interfaces:**
- Consumes: `HardwareModelV1` (Task 1).
- Produces: `hardwareBomData(hardware: HardwareModelV1): { cpuLine: string; moduleRows: string[][] }` (pure, exported for test); `renderSystemOverview` gains an optional `hardware` parameter and renders a BOM table under "1.2 Hardware Configuration" when `hardware?.render_in_docx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/docx-hardware-bom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hardwareBomData } from "@/lib/spec-builder/docx-exporter";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

const hw: HardwareModelV1 = {
  platform: "SIEMENS_TIA",
  tia_version: "V20",
  cpu: { cpu_type: "CPU 1515-2 PN", cpu_order_number: "6ES7 515-2AM03-0AB0", firmware: "V3.1" },
  racks: [{ rack: 0, modules: [
    { slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 …", channel_count: 16, signal_type: "DI" },
  ] }],
};

describe("hardwareBomData", () => {
  it("summarizes the CPU and one row per module", () => {
    const { cpuLine, moduleRows } = hardwareBomData(hw);
    expect(cpuLine).toContain("CPU 1515-2 PN");
    expect(cpuLine).toContain("V3.1");
    expect(moduleRows).toHaveLength(1);
    expect(moduleRows[0]).toEqual(["0", "1", "DI 16x24VDC", "DI", "16", "6ES7 …"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/docx-hardware-bom.test.ts`
Expected: FAIL — `hardwareBomData` not exported.

- [ ] **Step 3: Add the pure data helper + import**

In `docx-exporter.ts`, add `HardwareModelV1` to the `@/types/spec-contract-v2` import group, then add near the other helpers (above `renderSystemOverview`):

```ts
export function hardwareBomData(hardware: HardwareModelV1): { cpuLine: string; moduleRows: string[][] } {
  const cpu = hardware.cpu;
  const cpuLine = [
    cpu.cpu_type,
    cpu.cpu_order_number ? `(${cpu.cpu_order_number})` : "",
    cpu.firmware ? `firmware ${cpu.firmware}` : "",
    hardware.tia_version ? `TIA ${hardware.tia_version}` : "",
  ].filter(Boolean).join(" · ");
  const moduleRows = hardware.racks.flatMap((r) =>
    r.modules.map((m) => [
      String(r.rack), String(m.slot), m.module_type,
      m.signal_type ?? "", m.channel_count != null ? String(m.channel_count) : "",
      m.order_number ?? "",
    ]),
  );
  return { cpuLine, moduleRows };
}
```

- [ ] **Step 4: Render the table + thread the param**

Change the `renderSystemOverview` signature:

```ts
function renderSystemOverview(section: SpecSection, hardware?: HardwareModelV1): (Paragraph | Table)[] {
```

Immediately after the existing `1.2 Hardware Configuration` prose push (~line 259), add:

```ts
  if (hardware?.render_in_docx) {
    const { cpuLine, moduleRows } = hardwareBomData(hardware);
    children.push(...prose(`CPU: ${cpuLine}`));
    if (moduleRows.length) {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TABLE_BORDERS,
        rows: [
          headerRow(["Rack", "Slot", "Module", "Type", "Ch", "Order No."]),
          ...moduleRows.map((r) => new TableRow({
            children: [
              tableCell(r[0], { width: 10 }), tableCell(r[1], { width: 10 }),
              tableCell(r[2], { width: 40 }), tableCell(r[3], { width: 12 }),
              tableCell(r[4], { width: 10 }), tableCell(r[5], { width: 18 }),
            ],
          })),
        ],
      }));
      children.push(spacer());
    }
  }
```

At the call site (~line 1116), pass the hardware from `spec`:

```ts
    if (sysOverview) children.push(...renderSystemOverview(sysOverview, spec.hardware ?? undefined));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/docx-hardware-bom.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b` → no errors.

```bash
git add src/lib/spec-builder/docx-exporter.ts src/lib/spec-builder/__tests__/docx-hardware-bom.test.ts
git commit -m "feat(hardware): optional hardware BOM in FDS DOCX export (G0-16)"
```

---

### Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 2: Run all new suites together**

Run: `npx vitest run src/types/__tests__/hardware-model.test.ts src/lib/spec-builder/__tests__/hardware-fit.test.ts src/components/spec-builder/__tests__/hardware-step.test.tsx src/lib/spec-builder/__tests__/docx-hardware-bom.test.ts`
Expected: all PASS.

- [ ] **Step 3: Generic self-check**

Confirm no project-specific device names, CPU models, or module lists were hardcoded in any non-test file. All fixtures live in test files only. Mentally verify the model + fit checks work identically for a conveyor, a stamping cell, and a filling station.

- [ ] **Step 4: Deploy reminder**

Remind the user to run `npx supabase db push` to add the `spec_projects.hardware` column before authoring hardware in the live app.

## Self-Review (plan vs spec)

- **Spec coverage:** model shape → Task 1; `spec_projects.hardware` storage + `loadSpecContract` assembly → Task 2; `validateHardwareFit` (capacity + type) → Task 3; skeleton "Hardware" step + live fit banner + `plc_model` sync + relaxed gate → Tasks 4–5; optional DOCX appendix → Task 6; genericity + testing → every task + Task 7. Deferred items (fresh-build, sim-match, auto-addressing, AI-suggest) are out of scope by design.
- **Deliberate spec refinements:** address-range fit check deferred (declare-only modules have no start address); no separate `hardware.ts`; `FitSignal` has no `address`. All noted in Global Constraints.
- **Type consistency:** `HardwareModelV1`, `HardwareSignalType`, `FitSignal`, `HardwareFitWarning`, `emptyHardware`, `plcModelFromHardware`, `hardwareBomData`, `validateHardwareFit` are used with identical signatures across tasks.
