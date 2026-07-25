# Re-address IO from hardware (G0-18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the deterministic IO layout computed from the declared rack back onto the spec, behind an explicit diff-and-apply action in the skeleton wizard, so generated tags and SCL match the cards that get plugged.

**Architecture:** A new pure adapter module (`io-addressing-apply.ts`) bridges the legacy `UnitConfig[]` shape and the existing `planIoAddressing` engine — collecting the addressable signals and applying assignments back immutably. A presentational panel renders the diff on the wizard's Hardware step. The wizard owns the state and persists through its existing Confirm & Save; no new write path, no DB migration.

**Tech Stack:** TypeScript 5.9, React 19, Vitest + @testing-library/react, Tailwind v3, shadcn/ui.

**Spec:** `Docs/superpowers/specs/2026-07-25-io-readdress-design.md`

## Global Constraints

- **Generic only.** No device names, tag prefixes, machine types or sequences may appear in logic or tests as behaviour switches. The layout is a function of the declared rack and signal classes alone. (`CLAUDE.md` — "All Changes Must Be Generic".)
- **`npx tsc -b` must pass clean.** `noUnusedLocals` / `noUnusedParameters` are on — an unused import fails the build.
- **`verbatimModuleSyntax` is on** — type-only imports must use `import type { ... }`.
- **No enums** (`erasableSyntaxOnly`) — use `as const` objects.
- **Tailwind utility classes only.** No inline styles, no new UI libraries. Amber warning styling follows `hardware-step.tsx:108-115` verbatim.
- **Imports use the `@/` alias**, never relative paths across directories.
- **Pure modules stay pure** — `src/lib/spec-builder/**` must not import React or Supabase.
- **Pre-existing test baseline: 33 failing** in quote/variation/issue suites. Those are unrelated; do not attempt to fix them. Any *new* failure is a regression.

---

### Task 1: Signal collector

Collects the set of signals that need a physical channel from the legacy hierarchy. It must select **exactly** the same set `deriveIoTags` turns into TIA tags — divergence silently shifts every address after the point of disagreement.

**Files:**
- Create: `src/lib/spec-builder/io-addressing-apply.ts`
- Modify: `src/types/spec-builder.ts:239-249` (add `source` to `IoSignal`)
- Test: `src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`

**Interfaces:**
- Consumes: `planIoAddressing`, `AddressableSignal`, `IoAssignment` from `@/lib/spec-builder/io-addressing`; `convertSignalDirection` from `@/lib/spec-builder/dialect` (signature: `(sig: string) => IecSignalType`, where `IecSignalType = "DI" | "DO" | "AI" | "AO" | "internal"`, unknown input → `"internal"`); `UnitConfig` from `@/types/spec-builder`.
- Produces: `collectAddressableSignals(units: UnitConfig[]): AddressableSignal[]`

Reference shapes (already exist, do not redefine):

```ts
// @/lib/spec-builder/io-addressing
export interface AddressableSignal {
  tag: string;
  signal_type: HardwareSignalType;   // "DI" | "DO" | "AI" | "AO"
  io_address?: string | null;
}
export interface IoAssignment {
  tag: string;
  signal_type: HardwareSignalType;
  from: string | null;
  to: string;
  changed: boolean;
}
```

- [ ] **Step 1: Add `source` to the legacy `IoSignal` interface**

The field already rides `confirmed_units` at runtime (`contract.ts:340` reads it) — it was never declared. In `src/types/spec-builder.ts`, inside `export interface IoSignal`, add below `description: string;`:

```ts
  // Rides confirmed_units already (contract.ts reads it); declared here so the
  // addressing collector can exclude telegram signals type-safely. Absent
  // means "wired" — the same default contract.ts applies.
  source?: "wired" | "network_telegram";
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`:

```ts
// src/lib/spec-builder/__tests__/io-addressing-apply.test.ts
//
// Adapter between the legacy confirmed_units shape and the addressing engine
// (G0-18). The collector must select exactly the signals deriveIoTags turns
// into TIA tags — see Docs/superpowers/specs/2026-07-25-io-readdress-design.md
import { describe, expect, it } from "vitest";
import { collectAddressableSignals } from "../io-addressing-apply";
import type { IoSignal, UnitConfig } from "@/types/spec-builder";

/** One unit → one EM → one CM per signal group, so tests read as data. */
function units(
  groups: Array<{ signals: Partial<IoSignal>[]; excluded?: boolean }>,
): UnitConfig[] {
  return groups.map((g, i) => ({
    unit_id: `U${i}`,
    unit_name: `Unit ${i}`,
    equipment_type: "Other",
    description: "",
    excluded: g.excluded ?? false,
    equipment_modules: [
      {
        equipment_module_id: `EM${i}`,
        equipment_module_name: `EM ${i}`,
        description: "",
        control_modules: [
          {
            control_module_id: `CM${i}`,
            control_module_name: `CM ${i}`,
            control_module_class: "other",
            description: "",
            is_safety: false,
            io_signals: g.signals.map((s) => ({
              tag: "",
              signal_type: "DI",
              io_address: "",
              description: "",
              ...s,
            })) as IoSignal[],
          },
        ],
      },
    ],
  })) as UnitConfig[];
}

describe("collectAddressableSignals", () => {
  it("collects wired signals in hierarchy order", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I0.0" }, { tag: "B", signal_type: "DO" }] }]),
    );
    expect(result).toEqual([
      { tag: "A", signal_type: "DI", io_address: "%I0.0" },
      { tag: "B", signal_type: "DO", io_address: "" },
    ]);
  });

  it("skips excluded units", () => {
    const result = collectAddressableSignals(
      units([
        { signals: [{ tag: "A", signal_type: "DI" }] },
        { signals: [{ tag: "B", signal_type: "DI" }], excluded: true },
      ]),
    );
    expect(result.map((s) => s.tag)).toEqual(["A"]);
  });

  it("skips network telegram signals — they are addressed through the drive path", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "A", signal_type: "DI" }, { tag: "B", signal_type: "DI", source: "network_telegram" }] }]),
    );
    expect(result.map((s) => s.tag)).toEqual(["A"]);
  });

  it("skips blank placeholder rows", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "  ", signal_type: "DI" }, { tag: "A", signal_type: "DI" }] }]),
    );
    expect(result.map((s) => s.tag)).toEqual(["A"]);
  });

  it("skips signal types with no physical channel", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "A", signal_type: "internal" }, { tag: "B", signal_type: "" }, { tag: "C", signal_type: "DI" }] }]),
    );
    expect(result.map((s) => s.tag)).toEqual(["C"]);
  });

  it("normalises Siemens dialect to IEC classes", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "A", signal_type: "DQ" }, { tag: "B", signal_type: "aq" }] }]),
    );
    expect(result.map((s) => s.signal_type)).toEqual(["DO", "AO"]);
  });

  it("allocates one channel for a duplicated tag, first occurrence winning", () => {
    const result = collectAddressableSignals(
      units([
        { signals: [{ tag: "A", signal_type: "DI", io_address: "%I0.0" }] },
        { signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] },
      ]),
    );
    expect(result).toEqual([{ tag: "A", signal_type: "DI", io_address: "%I0.0" }]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`
Expected: FAIL — `Failed to resolve import "../io-addressing-apply"`.

- [ ] **Step 4: Write the collector**

Create `src/lib/spec-builder/io-addressing-apply.ts`:

```ts
/**
 * Adapter between the legacy `confirmed_units` hierarchy and the deterministic
 * addressing engine (G0-18).
 *
 * `io-addressing.ts` depends on `HardwareModelV1` alone; the legacy UnitConfig
 * shape stays here so the engine is reusable against the V2 contract later.
 *
 * The collector's selection rules MIRROR `deriveIoTags`
 * (src/lib/spec-builder/codegen/io-tag-table.ts) deliberately: a channel must
 * be allocated for precisely the signals that become TIA tags. If the two sets
 * ever diverge, every address after the point of disagreement silently shifts.
 *
 * Pure module: no React, no IO.
 * Design: Docs/superpowers/specs/2026-07-25-io-readdress-design.md
 */
import type { UnitConfig } from "@/types/spec-builder";
import type { AddressableSignal } from "@/lib/spec-builder/io-addressing";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";

/**
 * Walk unit → equipment module → control module → signal in array order and
 * collect everything needing a physical channel. Excluded units, telegram
 * signals, blank placeholder rows and non-physical classes are skipped; a
 * duplicated tag is collected once, first occurrence winning, matching
 * `deriveIoTags`' "keeping first" rule.
 */
export function collectAddressableSignals(units: UnitConfig[]): AddressableSignal[] {
  const out: AddressableSignal[] = [];
  const seen = new Set<string>();

  for (const unit of units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        for (const sig of cm.io_signals) {
          const tag = sig.tag?.trim();
          if (!tag || seen.has(tag)) continue;
          if (sig.source === "network_telegram") continue;

          // Tolerant of Siemens (DQ/AQ) and mixed case; unknown → "internal".
          const signal_type = convertSignalDirection(sig.signal_type);
          if (signal_type === "internal") continue;

          seen.add(tag);
          out.push({ tag, signal_type, io_address: sig.io_address });
        }
      }
    }
  }
  return out;
}
```

Note: after the `"internal"` guard TypeScript narrows `IecSignalType` to exactly `HardwareSignalType`, so no cast is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: clean, no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/spec-builder/io-addressing-apply.ts src/lib/spec-builder/__tests__/io-addressing-apply.test.ts src/types/spec-builder.ts
git commit -m "feat(spec-builder): collect addressable signals from the hierarchy (G0-18)"
```

---

### Task 2: Address appliers

Write assignments back onto the hierarchy and onto the in-session register tags. Both immutable and keyed by tag, so a duplicated tag receives its single address everywhere it appears.

**Files:**
- Modify: `src/lib/spec-builder/io-addressing-apply.ts`
- Test: `src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`

**Interfaces:**
- Consumes: `IoAssignment` from `@/lib/spec-builder/io-addressing`; `InstrumentTag`, `UnitConfig` from `@/types/spec-builder`.
- Produces:
  - `applyIoAddresses(units: UnitConfig[], assignments: IoAssignment[]): UnitConfig[]`
  - `applyRegisterAddresses(tags: InstrumentTag[], assignments: IoAssignment[]): InstrumentTag[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`. Add `applyIoAddresses, applyRegisterAddresses` to the existing import from `../io-addressing-apply`, add `InstrumentTag` to the existing type import from `@/types/spec-builder`, then append:

```ts
const assign = (tag: string, to: string, from: string | null = null) =>
  ({ tag, signal_type: "DI" as const, from, to, changed: from !== to });

describe("applyIoAddresses", () => {
  it("writes the assigned address onto the matching signal", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] }]);
    const after = applyIoAddresses(before, [assign("A", "%I0.0", "%I9.9")]);
    expect(after[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I0.0");
  });

  it("leaves signals with no assignment untouched", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] }]);
    const after = applyIoAddresses(before, [assign("B", "%I0.0")]);
    expect(after[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I9.9");
  });

  it("rewrites every occurrence of a duplicated tag", () => {
    const before = units([
      { signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] },
      { signals: [{ tag: "A", signal_type: "DI", io_address: "%I8.8" }] },
    ]);
    const after = applyIoAddresses(before, [assign("A", "%I0.0")]);
    expect(after[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I0.0");
    expect(after[1].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I0.0");
  });

  it("does not mutate the input", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] }]);
    applyIoAddresses(before, [assign("A", "%I0.0")]);
    expect(before[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I9.9");
  });

  it("returns the input unchanged when there are no assignments", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI" }] }]);
    expect(applyIoAddresses(before, [])).toBe(before);
  });
});

describe("applyRegisterAddresses", () => {
  const tag = (t: string, io_address: string) => ({ tag: t, io_address }) as InstrumentTag;

  it("rewrites matching register tags and leaves the rest alone", () => {
    const before = [tag("A", "%I9.9"), tag("B", "%I8.8")];
    const after = applyRegisterAddresses(before, [assign("A", "%I0.0", "%I9.9")]);
    expect(after[0].io_address).toBe("%I0.0");
    expect(after[1]).toBe(before[1]);
  });

  it("does not mutate the input", () => {
    const before = [tag("A", "%I9.9")];
    applyRegisterAddresses(before, [assign("A", "%I0.0")]);
    expect(before[0].io_address).toBe("%I9.9");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`
Expected: FAIL — `applyIoAddresses is not a function`.

- [ ] **Step 3: Write the appliers**

Append to `src/lib/spec-builder/io-addressing-apply.ts` (and add `IoAssignment` to the existing `import type` from `@/lib/spec-builder/io-addressing`, `InstrumentTag` to the one from `@/types/spec-builder`):

```ts
/** tag → assigned address. Shared by both appliers so they cannot disagree. */
function addressByTag(assignments: IoAssignment[]): Map<string, string> {
  return new Map(assignments.map((a) => [a.tag, a.to]));
}

/**
 * Write assignments onto the hierarchy. Immutable, and keyed by tag rather
 * than position, so a tag appearing in more than one place receives the one
 * address everywhere. Unchanged signals keep their identity, so React sees
 * the smallest possible diff.
 */
export function applyIoAddresses(
  units: UnitConfig[],
  assignments: IoAssignment[],
): UnitConfig[] {
  if (assignments.length === 0) return units;
  const byTag = addressByTag(assignments);

  return units.map((unit) => ({
    ...unit,
    equipment_modules: unit.equipment_modules.map((em) => ({
      ...em,
      control_modules: em.control_modules.map((cm) => ({
        ...cm,
        io_signals: cm.io_signals.map((sig) => {
          const to = byTag.get(sig.tag?.trim() ?? "");
          return to === undefined || sig.io_address === to ? sig : { ...sig, io_address: to };
        }),
      })),
    })),
  }));
}

/**
 * Same rewrite against the in-session instrument register, so a tag wired on
 * a later wizard step does not arrive carrying a stale address
 * (`assignTagToSignal` copies io_address straight off the register tag). The
 * `instrument_registers` row itself is never written — it is the as-received
 * import and keeps its provenance.
 */
export function applyRegisterAddresses(
  tags: InstrumentTag[],
  assignments: IoAssignment[],
): InstrumentTag[] {
  if (assignments.length === 0) return tags;
  const byTag = addressByTag(assignments);

  return tags.map((t) => {
    const to = byTag.get(t.tag?.trim() ?? "");
    return to === undefined || t.io_address === to ? t : { ...t, io_address: to };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/io-addressing-apply.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/io-addressing-apply.ts src/lib/spec-builder/__tests__/io-addressing-apply.test.ts
git commit -m "feat(spec-builder): apply computed IO addresses onto the hierarchy and register (G0-18)"
```

---

### Task 3: Round-trip guarantee

The property that actually matters: after applying, the tag table the bridge receives must carry the planned addresses. This is the contract with TIA and the thing that is broken today.

**Files:**
- Test: `src/lib/spec-builder/__tests__/io-addressing-roundtrip.test.ts` (create)

**Interfaces:**
- Consumes: `collectAddressableSignals`, `applyIoAddresses` (Tasks 1-2); `planIoAddressing` from `@/lib/spec-builder/io-addressing`; `buildHierarchyFromLegacy` from `@/lib/spec-builder/contract` (signature: `(projectRow: Record<string, unknown>) => Hierarchy`, reads `projectRow.confirmed_units`); `deriveIoTags` from `@/lib/spec-builder/codegen/io-tag-table` (signature: `(contract: Pick<SpecContractV2, "hierarchy">) => { tags: MigrationTagDto[]; warnings: string[] }`, where `MigrationTagDto = { name: string; dataType: string; address: string }`).
- Produces: nothing — this task is a test only.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/io-addressing-roundtrip.test.ts`:

```ts
// src/lib/spec-builder/__tests__/io-addressing-roundtrip.test.ts
//
// The property G0-18 exists to guarantee: after re-addressing, the tag table
// sent to TIA carries exactly the addresses the rack layout planned. Plan and
// tag derivation walk the hierarchy independently — this pins them together.
import { describe, expect, it } from "vitest";
import { planIoAddressing } from "../io-addressing";
import { collectAddressableSignals, applyIoAddresses } from "../io-addressing-apply";
import { buildHierarchyFromLegacy } from "../contract";
import { deriveIoTags } from "../codegen/io-tag-table";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

const hardware: HardwareModelV1 = {
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1511-1 PN" },
  racks: [
    {
      rack: 0,
      modules: [
        { slot: 2, module_type: "DQ 16", channel_count: 16, signal_type: "DO" },
        { slot: 3, module_type: "AI 8", channel_count: 8, signal_type: "AI" },
        { slot: 4, module_type: "DI 16", channel_count: 16, signal_type: "DI" },
      ],
    },
  ],
};

/** Two EMs of mixed classes, plus an excluded unit and a telegram signal. */
const legacyUnits = [
  {
    unit_id: "U1", unit_name: "Unit 1", equipment_type: "Other", description: "", excluded: false,
    equipment_modules: [
      {
        equipment_module_id: "EM1", equipment_module_name: "EM 1", description: "",
        control_modules: [
          {
            control_module_id: "CM1", control_module_name: "CM 1", control_module_class: "motor",
            description: "", is_safety: false,
            io_signals: [
              { tag: "T_DO_1", signal_type: "DO", io_address: "%Q16.0", description: "" },
              { tag: "T_DI_1", signal_type: "DI", io_address: "%I0.0", description: "" },
              { tag: "T_AI_1", signal_type: "AI", io_address: "%IW128", description: "" },
              { tag: "T_TEL_1", signal_type: "DI", io_address: "", description: "", source: "network_telegram" },
            ],
          },
        ],
      },
    ],
  },
  {
    unit_id: "U2", unit_name: "Unit 2", equipment_type: "Other", description: "", excluded: true,
    equipment_modules: [
      {
        equipment_module_id: "EM2", equipment_module_name: "EM 2", description: "",
        control_modules: [
          {
            control_module_id: "CM2", control_module_name: "CM 2", control_module_class: "other",
            description: "", is_safety: false,
            io_signals: [{ tag: "T_DI_X", signal_type: "DI", io_address: "%I5.5", description: "" }],
          },
        ],
      },
    ],
  },
] as unknown as UnitConfig[];

describe("IO re-addressing round trip", () => {
  it("makes the derived TIA tag table match the planned layout", () => {
    const plan = planIoAddressing(hardware, collectAddressableSignals(legacyUnits));
    const applied = applyIoAddresses(legacyUnits, plan.assignments);

    const hierarchy = buildHierarchyFromLegacy({ confirmed_units: applied });
    const { tags } = deriveIoTags({ hierarchy });

    const derived = new Map(tags.map((t) => [t.name, t.address]));
    for (const a of plan.assignments) {
      expect(derived.get(a.tag)).toBe(a.to);
    }
    // The excluded unit and the telegram signal never reach the tag table.
    expect(derived.has("T_DI_X")).toBe(false);
    expect(derived.has("T_TEL_1")).toBe(false);
  });

  it("computes the layout across the shared input space", () => {
    const plan = planIoAddressing(hardware, collectAddressableSignals(legacyUnits));
    const to = new Map(plan.assignments.map((a) => [a.tag, a.to]));
    // AI card sits at input byte 0 (16 bytes), so the DI card starts at 16.
    expect(to.get("T_AI_1")).toBe("%IW0");
    expect(to.get("T_DI_1")).toBe("%I16.0");
    expect(to.get("T_DO_1")).toBe("%Q0.0");
  });

  it("is idempotent — re-planning applied units yields no further moves", () => {
    const first = planIoAddressing(hardware, collectAddressableSignals(legacyUnits));
    const applied = applyIoAddresses(legacyUnits, first.assignments);
    const second = planIoAddressing(hardware, collectAddressableSignals(applied));
    expect(second.assignments.filter((a) => a.changed)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/lib/spec-builder/__tests__/io-addressing-roundtrip.test.ts`
Expected: PASS — 3 tests. Tasks 1-2 already provide the behaviour; this test exists to lock the two independent walks together.

If it FAILS, the collector and `deriveIoTags` disagree about which signals get channels. Fix the **collector** to match `deriveIoTags` — `deriveIoTags` is the downstream truth.

- [ ] **Step 3: Commit**

```bash
git add src/lib/spec-builder/__tests__/io-addressing-roundtrip.test.ts
git commit -m "test(spec-builder): pin re-addressed hierarchy to the derived TIA tag table (G0-18)"
```

---

### Task 4: The diff panel

**Files:**
- Create: `src/components/spec-builder/io-addressing-panel.tsx`
- Test: `src/components/spec-builder/__tests__/io-addressing-panel.test.tsx`

**Interfaces:**
- Consumes: `collectAddressableSignals` (Task 1); `planIoAddressing`, `IoAddressingPlan` from `@/lib/spec-builder/io-addressing`.
- Produces:
  - `useIoAddressingPlan(hardware: HardwareModelV1 | null | undefined, units: UnitConfig[]): IoAddressingPlan` — shared with Task 6's drift banner.
  - `IoAddressingPanel({ hardware, units, onApply }: { hardware: HardwareModelV1; units: UnitConfig[]; onApply: (plan: IoAddressingPlan) => void })`

`IoAddressingPlan` is `{ modules: ModuleAddressPlan[]; assignments: IoAssignment[]; warnings: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/spec-builder/__tests__/io-addressing-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IoAddressingPanel } from "@/components/spec-builder/io-addressing-panel";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

const hardware: HardwareModelV1 = {
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1511-1 PN" },
  racks: [{ rack: 0, modules: [{ slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" }] }],
};

const unitsWith = (signals: Array<{ tag: string; io_address: string }>) =>
  [
    {
      unit_id: "U1", unit_name: "Unit 1", equipment_type: "Other", description: "", excluded: false,
      equipment_modules: [
        {
          equipment_module_id: "EM1", equipment_module_name: "EM 1", description: "",
          control_modules: [
            {
              control_module_id: "CM1", control_module_name: "CM 1", control_module_class: "other",
              description: "", is_safety: false,
              io_signals: signals.map((s) => ({ ...s, signal_type: "DI", description: "" })),
            },
          ],
        },
      ],
    },
  ] as unknown as UnitConfig[];

describe("IoAddressingPanel", () => {
  it("summarises how many signals would move and lists them", () => {
    render(
      <IoAddressingPanel
        hardware={hardware}
        units={unitsWith([{ tag: "A", io_address: "%I9.9" }, { tag: "B", io_address: "%I0.1" }])}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("%I0.0")).toBeInTheDocument();
  });

  it("applies the plan when the button is pressed", () => {
    const onApply = vi.fn();
    render(
      <IoAddressingPanel hardware={hardware} units={unitsWith([{ tag: "A", io_address: "%I9.9" }])} onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].assignments).toEqual([
      { tag: "A", signal_type: "DI", from: "%I9.9", to: "%I0.0", changed: true },
    ]);
  });

  it("disables apply when every address already matches the rack", () => {
    render(
      <IoAddressingPanel hardware={hardware} units={unitsWith([{ tag: "A", io_address: "%I0.0" }])} onApply={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /match/i })).toBeDisabled();
  });

  it("surfaces engine warnings rather than dropping signals silently", () => {
    render(
      <IoAddressingPanel
        hardware={{ ...hardware, racks: [{ rack: 0, modules: [] }] }}
        units={unitsWith([{ tag: "A", io_address: "" }])}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId("io-addressing-warnings")).toHaveTextContent(/no DI channel left/i);
  });

  it("renders nothing when there is no hardware and no signals", () => {
    const { container } = render(
      <IoAddressingPanel hardware={{ platform: "SIEMENS_TIA", cpu: { cpu_type: "" }, racks: [] }} units={[]} onApply={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/spec-builder/__tests__/io-addressing-panel.test.tsx`
Expected: FAIL — cannot resolve `@/components/spec-builder/io-addressing-panel`.

- [ ] **Step 3: Write the panel**

Create `src/components/spec-builder/io-addressing-panel.tsx`:

```tsx
/**
 * Re-address IO from hardware (G0-18) — diff preview and explicit apply.
 *
 * Presentational: it computes the plan and reports it, and never writes. The
 * wizard owns the state and persists through its existing save.
 *
 * Apply is all-or-nothing by design — channel assignment is positional, so
 * skipping one signal does not free its channel and a partial apply would
 * describe a rack that does not exist.
 * Design: Docs/superpowers/specs/2026-07-25-io-readdress-design.md
 */
import { useMemo } from "react";
import { AlertTriangle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { planIoAddressing, type IoAddressingPlan } from "@/lib/spec-builder/io-addressing";
import { collectAddressableSignals } from "@/lib/spec-builder/io-addressing-apply";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

/** Shared by the panel and the Review-step drift banner. Pure and cheap. */
export function useIoAddressingPlan(
  hardware: HardwareModelV1 | null | undefined,
  units: UnitConfig[],
): IoAddressingPlan {
  return useMemo(
    () => planIoAddressing(hardware, collectAddressableSignals(units)),
    [hardware, units],
  );
}

interface Props {
  hardware: HardwareModelV1;
  units: UnitConfig[];
  onApply: (plan: IoAddressingPlan) => void;
}

export function IoAddressingPanel({ hardware, units, onApply }: Props) {
  const plan = useIoAddressingPlan(hardware, units);
  const changed = plan.assignments.filter((a) => a.changed);
  const total = plan.assignments.length;

  if (total === 0 && plan.warnings.length === 0) return null;

  return (
    <Card className="p-3 space-y-2" data-testid="io-addressing-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase">IO Addressing</p>
          <p className="text-xs text-muted-foreground">
            {changed.length === 0
              ? `All ${total} wired signals match the declared rack.`
              : `${changed.length} of ${total} wired signals would move.`}
          </p>
        </div>
        <Button size="sm" onClick={() => onApply(plan)} disabled={changed.length === 0}>
          <Wand2 className="h-3.5 w-3.5 mr-1" />
          {changed.length === 0
            ? "Addresses match hardware"
            : `Apply ${changed.length} move${changed.length === 1 ? "" : "s"}`}
        </Button>
      </div>

      {plan.warnings.length > 0 && (
        <Card
          data-testid="io-addressing-warnings"
          className="p-3 border-amber-500/50 bg-amber-500/5 space-y-1"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Not every signal could be addressed (
            {plan.warnings.length})
          </div>
          <ul className="text-[11px] font-mono text-amber-800 space-y-0.5">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      {changed.length > 0 && (
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-[11px] font-mono">
            <tbody>
              {changed.map((a) => (
                <tr key={a.tag} className="border-b border-border/50 last:border-0">
                  <td className="py-0.5 pr-2">{a.tag}</td>
                  <td className="py-0.5 pr-2 text-muted-foreground">{a.from ?? "—"}</td>
                  <td className="py-0.5 pr-1 text-muted-foreground">→</td>
                  <td className="py-0.5">{a.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/spec-builder/__tests__/io-addressing-panel.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/spec-builder/io-addressing-panel.tsx src/components/spec-builder/__tests__/io-addressing-panel.test.tsx
git commit -m "feat(spec-builder): IO re-addressing diff panel with explicit apply (G0-18)"
```

---

### Task 5: Wire the panel into the wizard

Hardware is `WIZARD_STEPS[2]`; Machine Hierarchy is `WIZARD_STEPS[3]`, and `assignTagToSignal` (`machine-hierarchy-table.tsx:290`) copies `io_address` straight off the register tag. So Apply must rewrite the in-session register too, or a tag wired afterwards arrives stale.

**Files:**
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx` (imports ~line 38; state after line 89; step-2 render block lines 281-287; `MachineHierarchyTable` props lines 288-296; `inferHierarchy` line 232)
- Test: `src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx` (create)

**Interfaces:**
- Consumes: `IoAddressingPanel` (Task 4); `applyIoAddresses`, `applyRegisterAddresses` (Task 2); `IoAddressingPlan` from `@/lib/spec-builder/io-addressing`.
- Produces: nothing consumed by later tasks except the `registerTags` state that Task 6 leaves alone.

- [ ] **Step 1: Add the imports**

In `src/components/spec-builder/spec-skeleton-wizard.tsx`, after the `HardwareStep` import (line 38):

```ts
import { IoAddressingPanel } from "./io-addressing-panel";
import { applyIoAddresses, applyRegisterAddresses } from "@/lib/spec-builder/io-addressing-apply";
import type { IoAddressingPlan } from "@/lib/spec-builder/io-addressing";
```

Add `InstrumentTag` to the existing `import type { ... } from "@/types/spec-builder"` block (lines 26-31).

- [ ] **Step 2: Hold the register tags in state**

Immediately after the `hardware` state declaration (line 87-89), add:

```ts
  // The register's addresses are seeded from the import, then re-addressed in
  // session by Apply below — `assignTagToSignal` copies io_address straight off
  // these tags, so a tag wired on the Hierarchy step must not arrive stale.
  // The instrument_registers row itself is never written: it is the as-received
  // import and keeps its provenance (G0-18).
  const [registerTags, setRegisterTags] = useState<InstrumentTag[]>(() => register.tags);
```

- [ ] **Step 3: Add the apply handler**

After the `hardware` / `registerTags` state, add:

```ts
  // Spec follows hardware: the declared rack is the source of truth. Explicit,
  // all-or-nothing, and applied to the hierarchy and the register together.
  const applyIoAddressing = useCallback((plan: IoAddressingPlan) => {
    setSubsystems((prev) => applyIoAddresses(prev, plan.assignments));
    setRegisterTags((prev) => applyRegisterAddresses(prev, plan.assignments));
  }, []);
```

- [ ] **Step 4: Render the panel and switch the hierarchy table to `registerTags`**

Replace the step-2 block (lines 281-287) with:

```tsx
        {step === 2 && (
          <div className="space-y-3">
            <HardwareStep
              hardware={hardware}
              onChange={setHardware}
              signals={registerTags.map((t) => ({ signal_type: t.signal_type }))}
            />
            <IoAddressingPanel hardware={hardware} units={units} onApply={applyIoAddressing} />
          </div>
        )}
```

In the step-3 block, change `availableTags={register.tags}` to `availableTags={registerTags}`.

In `inferHierarchy`, change the fallback `buildHierarchyFromTags(register.tags)` (line 232) to `buildHierarchyFromTags(registerTags)` — this one carries `io_address` into the rebuilt hierarchy, so it must read the re-addressed tags. Change the `tagSummary` source (line 171) to `registerTags` as well: it does not project `io_address` today, so this is behaviour-neutral, but it leaves `register.tags` referenced in exactly one place — the state seed — which is what stops the two copies drifting apart later. Update the `useCallback` dependency array (line 236) from `[register.tags]` to `[registerTags]`.

- [ ] **Step 5: Write the test**

Create `src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SpecSkeletonWizard } from "@/components/spec-builder/spec-skeleton-wizard";
import type { InstrumentRegister, SpecProject } from "@/types/spec-builder";

vi.mock("@/hooks/use-spec-projects", () => ({
  useUpdateSpecProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-hardware-catalog", () => ({
  MIN_FILTER_LENGTH: 3,
  useHardwareCatalog: () => ({ products: [], unavailable: false, searching: false, enabled: true }),
}));

const spec = {
  id: "s1", doc_code: "DOC-1", title: "T", client_name: "C", revision: "A",
  hardware: {
    platform: "SIEMENS_TIA",
    cpu: { cpu_type: "CPU 1511-1 PN" },
    racks: [{ rack: 0, modules: [{ slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" }] }],
  },
  confirmed_units: [
    {
      unit_id: "U1", unit_name: "Unit 1", equipment_type: "Other", description: "", excluded: false,
      equipment_modules: [
        {
          equipment_module_id: "EM1", equipment_module_name: "EM 1", description: "",
          control_modules: [
            {
              control_module_id: "CM1", control_module_name: "CM 1", control_module_class: "other",
              description: "", is_safety: false,
              io_signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9", description: "" }],
            },
          ],
        },
      ],
    },
  ],
} as unknown as SpecProject;

const register = {
  id: "r1", spec_project_id: "s1", tags: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }],
  units: [], parse_warnings: [], source: "upload",
} as unknown as InstrumentRegister;

describe("SpecSkeletonWizard — IO re-addressing", () => {
  it("applies the planned addresses to the hierarchy from the Hardware step", () => {
    render(<SpecSkeletonWizard spec={spec} register={register} onComplete={vi.fn()} />);

    // Step 1 → 2 → 3 (Hardware).
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByTestId("io-addressing-panel")).toBeInTheDocument();
    expect(screen.getByText(/1 of 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /apply 1 move/i }));

    // Re-planning after apply finds nothing left to move.
    expect(screen.getByRole("button", { name: /match/i })).toBeDisabled();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx`
Expected: PASS — 1 test.

`MachineHierarchyTable` imports only UI primitives, so no TanStack provider is needed — the two mocks above cover every hook in the render path. If an un-mocked hook does surface, the repo's fallback harness is a `QueryClientProvider` wrapper; copy the pattern from `controls-data-panel.test.tsx:44-50`. Do not change the component to suit the test.

- [ ] **Step 7: Run the neighbouring suites for regressions**

Run: `npx vitest run src/components/spec-builder src/lib/spec-builder`
Expected: no NEW failures against the 33-failure baseline (which lives in quote/variation/issue suites, not these).

- [ ] **Step 8: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/spec-builder/spec-skeleton-wizard.tsx src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx
git commit -m "feat(spec-builder): re-address IO from hardware in the skeleton wizard (G0-18)"
```

---

### Task 6: Drift banner on Review & Confirm

Catches addresses hand-edited on the Hierarchy step, or tags wired after Apply. It reports only — re-addressing stays on the Hardware step.

**Files:**
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx` (`StepReview`, from line 655)
- Test: `src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx`

**Interfaces:**
- Consumes: `useIoAddressingPlan` (Task 4). `StepReview` already receives `hardware` and `units` (lines 666-667) — no prop changes needed.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx`, inside the existing `describe`:

```tsx
  it("flags drift on Review when addresses no longer match the rack", () => {
    render(<SpecSkeletonWizard spec={spec} register={register} onComplete={vi.fn()} />);
    // Walk to Review & Confirm (step index 7) without applying.
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
    expect(screen.getByTestId("io-addressing-drift")).toHaveTextContent(/1 .*(signal|address)/i);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx -t "flags drift"`
Expected: FAIL — `Unable to find an element by: [data-testid="io-addressing-drift"]`.

If the walk stops early because a `Next` is disabled, the fixture needs a mode/tier that satisfies `canNext` (lines 131-140); adjust the fixture, not the guard.

- [ ] **Step 3: Add the banner**

Add the import to the `IoAddressingPanel` import line in `spec-skeleton-wizard.tsx`:

```ts
import { IoAddressingPanel, useIoAddressingPlan } from "./io-addressing-panel";
```

Inside `StepReview`, after the `totalDevices` computation (line 674-677):

```ts
  // Re-run the layout: pure and free, so Review always reflects the rack as
  // currently declared — catching hand-edited addresses and anything wired
  // after Apply (G0-18).
  const ioDrift = useIoAddressingPlan(hardware, units).assignments.filter((a) => a.changed);
```

Then, as the first child inside the returned `<div className="space-y-4 max-w-lg">` (line 680):

```tsx
      {ioDrift.length > 0 && (
        <Card
          data-testid="io-addressing-drift"
          className="p-3 border-amber-500/50 bg-amber-500/5 space-y-1"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {ioDrift.length} IO{" "}
            {ioDrift.length === 1 ? "signal does" : "signals do"} not match the declared hardware
          </div>
          <p className="text-[11px] text-amber-800">
            Go back to the Hardware step and re-address, or confirm as-is if the addresses are
            deliberate.
          </p>
        </Card>
      )}
```

`AlertTriangle` must be added to the `lucide-react` import at the top of the file (lines 2-9) if not already present.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Full self-check**

Run: `npx tsc -b` — expected clean.
Run: `npx vitest run src/components/spec-builder src/lib/spec-builder` — expected no new failures.
Run: `npm run lint` — expected no new errors.

Then re-read the "Generic check" in `CLAUDE.md`: confirm no device name, tag prefix or machine type appears as a behaviour switch anywhere in the diff. Mentally test the feature against a filling station and a stamping cell — the layout depends only on the declared rack and signal classes, so behaviour must be identical.

- [ ] **Step 6: Commit**

```bash
git add src/components/spec-builder/spec-skeleton-wizard.tsx src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx
git commit -m "feat(spec-builder): flag IO address drift on the wizard review step (G0-18)"
```

---

## Manual verification (after Task 6)

The unit tests prove the layout; this proves the loop end-to-end on the test spec from the handover, `5ac7b9c5-65b3-4cf0-91f4-926c2af70adf` (11 DI, 4 DO, 7 AI — 22 tags; expected moves: all 7 AI, 2 of 4 DO, 5 DI).

1. `npm run dev`, open the spec, enter the skeleton wizard, go to Hardware.
2. Confirm the panel reports **14 of 22** would move, and that the diff matches the handover's table: DQ 16 → `%Q0.0–%Q1.7`, AI 8 → `%IW0–%IW14`, DI 16 → `%I16.0–%I17.7`.
3. Apply, walk to Review & Confirm, verify no drift banner, and save.
4. Re-open the wizard and confirm the panel now reports everything matching (persistence + idempotence).
5. With the bridge running on 5102, run a fresh-project build and confirm in TIA that the tag addresses land inside each card's pinned range. This is the step that was failing before G0-18.

Note from the handover: `npm run dev` also starts the V18 bridge twin on 5103. The app talks to 5102 — the second console is expected.

## Board sync

On completion: G0-18 (`3112412991`) → **Awaiting Testing** until step 5 of the manual verification passes on live TIA, then **Done**, with a `create_update` recording the commits.
