# Fresh-Project Build from the FDS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Code Builder build a runnable TIA project (hardware + program) from scratch out of the FDS's `HardwareModelV1`, instead of only reimporting into an already-open project.

**Architecture:** The bridge's existing `ProvisionProject` (parameterized CPU + fallback ladder + module plugging + IO tags + WebSocket progress) gains optional `Sources` + `ImportOrder`, so it imports the generated SCL and compiles hardware **and** software in one call; the SCL-import block is extracted from `CreateProjectWithSources` into a shared private helper that both call, and `CreateProjectWithSources` is then marked `[Obsolete]`. On the frontend, a pure mapper turns `contract.hardware` into the bridge's provision inputs, `useSendCodeToTia` gains a `provisionFresh` action reusing the `sources`/`ioTags` `buildPlan` already assembles, and `SendToTiaPanel` gets a second **Create new project…** button. The everyday open-project reimport path is untouched.

**Tech Stack:** React 19 + Vite + TypeScript 5.9, Vitest + @testing-library/react, Zod (contract schemas), .NET Framework 4.8 / C# 7.3 (bridge), TIA Openness.

**Spec:** `Docs/superpowers/specs/2026-07-24-fresh-project-build-design.md` (status DECIDED)
**Depends on:** `HardwareModelV1` — shipped (G0-16).
**Monday:** board "Forja" `5099871231`, subitem **G9-W9** `3110138357`.

## Global Constraints

- **Genericity (repo non-negotiable):** nothing project-specific. The CPU order-number table is generic Siemens catalogue data; every other input derives from the project's own `contract.hardware` and generated program. Verify each change would work identically for a conveyor, a stamping cell, and a filling station.
- **TypeScript strictness:** `verbatimModuleSyntax` (type-only imports must use `import type`), `noUnusedLocals` / `noUnusedParameters` (build fails on unused vars), `erasableSyntaxOnly` (no enums — use `as const`).
- **Imports:** always the `@/` alias for `src/`.
- **Styling:** Tailwind v3 utility classes only. No inline styles, no new UI frameworks. shadcn/ui primitives from `@/components/ui/*`.
- **Bridge language level:** C# 7.3, .NET Framework 4.8. No target-typed `new`, no nullable reference types, no `record`.
- **Bridge versioning (MANDATORY):** any bridge change bumps `BridgeVersion` in `TiaPortalService.cs` (currently `"1.4.2"` at line 167) **and** adds a `bridge/PacForgeBridge/CHANGELOG.md` entry.
- **Bridge build:** build `bridge/PacForgeBridge/PacForgeBridge.csproj` **only** — the solution also builds a V18 twin whose exe is often running and locked.
- **Bridge field naming:** the request deserializer maps snake_case JSON to PascalCase properties (`io_modules` → `IoModules`). New fields follow the same convention: `sources` → `Sources`, `import_order` → `ImportOrder`, `compile_result` → `CompileResult`.
- **Gate before any task is done:** `npx tsc -b` clean **and** the task's vitest suite green. Do not start the next task on a red gate.

---

### Task 1: Pure contract → provision mapper

The one place that knows how a `HardwareModelV1` becomes bridge provision inputs. No React, no IO, fully unit-tested.

**Files:**
- Create: `src/lib/spec-builder/tia-provision-inputs.ts`
- Test: `src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts`

**Interfaces:**
- Consumes: `HardwareModelV1` (`@/types/spec-contract-v2` — `{ platform, tia_version?, cpu: { cpu_type, cpu_order_number?, firmware? }, racks: { rack: number, modules: { slot: number, module_type: string, order_number?, channel_count?, signal_type?, description? }[] }[], render_in_docx?, notes? }`); `IoModuleDto` / `IoTagDto` / `MigrationTagDto` (`@/lib/tia-bridge-contract`).
- Produces:
  - `cpuOrderNumberFromHardware(hardware: HardwareModelV1 | null | undefined): string | undefined`
  - `ioModulesFromHardware(hardware: HardwareModelV1 | null | undefined): ProvisionIoModules` where `interface ProvisionIoModules { modules: IoModuleDto[]; missingOrderNumbers: string[] }`
  - `ioTagsFromMigrationTags(tags: MigrationTagDto[]): IoTagDto[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts`:

```ts
// src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts
//
// contract.hardware → bridge provision inputs (G9-W9). Pure mapping only.
import { describe, expect, it } from "vitest";
import {
  cpuOrderNumberFromHardware,
  ioModulesFromHardware,
  ioTagsFromMigrationTags,
} from "../tia-provision-inputs";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

function hw(over: Partial<HardwareModelV1> = {}): HardwareModelV1 {
  return {
    platform: "SIEMENS_TIA",
    cpu: { cpu_type: "S7-1516" },
    racks: [],
    ...over,
  } as HardwareModelV1;
}

describe("cpuOrderNumberFromHardware", () => {
  it("prefers an explicitly authored order number", () => {
    const result = cpuOrderNumberFromHardware(
      hw({ cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0/V2.9" } }),
    );
    expect(result).toBe("6ES7 516-3AN02-0AB0/V2.9");
  });

  it("appends firmware to an unsuffixed order number", () => {
    const result = cpuOrderNumberFromHardware(
      hw({ cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0", firmware: "V2.9" } }),
    );
    expect(result).toBe("6ES7 516-3AN02-0AB0/V2.9");
  });

  it("leaves an already-suffixed order number alone", () => {
    const result = cpuOrderNumberFromHardware(
      hw({ cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0/V2.8", firmware: "V2.9" } }),
    );
    expect(result).toBe("6ES7 516-3AN02-0AB0/V2.8");
  });

  it("falls back to the catalogue lookup by CPU type", () => {
    expect(cpuOrderNumberFromHardware(hw({ cpu: { cpu_type: "S7-1513" } })))
      .toBe("6ES7 513-1AL02-0AB0/V2.9");
    // A descriptive type string still resolves by family substring.
    expect(cpuOrderNumberFromHardware(hw({ cpu: { cpu_type: "CPU S7-1511-1 PN" } })))
      .toBe("6ES7 511-1AK02-0AB0/V2.9");
  });

  it("returns undefined when no hardware is authored or the type is unknown", () => {
    expect(cpuOrderNumberFromHardware(undefined)).toBeUndefined();
    expect(cpuOrderNumberFromHardware(null)).toBeUndefined();
    expect(cpuOrderNumberFromHardware(hw({ cpu: { cpu_type: "Allen-Bradley 5069" } }))).toBeUndefined();
  });
});

describe("ioModulesFromHardware", () => {
  it("flattens racks into IoModuleDto[] and collects modules that cannot be plugged", () => {
    const result = ioModulesFromHardware(
      hw({
        racks: [
          {
            rack: 0,
            modules: [
              { slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 521-1BH50-0AA0" },
              { slot: 2, module_type: "DQ 16x24VDC" }, // no order number
            ],
          },
          {
            rack: 1,
            modules: [{ slot: 1, module_type: "AI 8xU/I", order_number: "6ES7 531-7KF00-0AB0" }],
          },
        ],
      }),
    );
    expect(result.modules).toEqual([
      { mlfb: "6ES7 521-1BH50-0AA0", rack: 0, slot: 1, description: "DI 16x24VDC" },
      { mlfb: "6ES7 531-7KF00-0AB0", rack: 1, slot: 1, description: "AI 8xU/I" },
    ]);
    expect(result.missingOrderNumbers).toEqual(["DQ 16x24VDC"]);
  });

  it("returns empty results for absent hardware", () => {
    expect(ioModulesFromHardware(undefined)).toEqual({ modules: [], missingOrderNumbers: [] });
  });
});

describe("ioTagsFromMigrationTags", () => {
  it("maps the send plan's tag shape onto the provision tag shape", () => {
    expect(
      ioTagsFromMigrationTags([
        { name: "M01_Run", dataType: "Bool", address: "%Q0.0" },
        { name: "LT_Level", dataType: "Word", address: "%IW64" },
      ]),
    ).toEqual([
      { name: "M01_Run", data_type: "Bool", logical_address: "%Q0.0" },
      { name: "LT_Level", data_type: "Word", logical_address: "%IW64" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts`
Expected: FAIL — `Failed to resolve import "../tia-provision-inputs"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/spec-builder/tia-provision-inputs.ts`:

```ts
/**
 * contract.hardware → TIA bridge provision inputs (G9-W9).
 *
 * Pure mapping, no React and no IO, so the fresh-project build is auditable
 * and unit-tested. The CPU table is generic Siemens catalogue data — never
 * add project-specific entries here.
 * Design: Docs/superpowers/specs/2026-07-24-fresh-project-build-design.md
 */
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { IoModuleDto, IoTagDto, MigrationTagDto } from "@/lib/tia-bridge-contract";

/**
 * CPU family → MLFB order number, firmware-suffixed. Matched by substring so
 * descriptive types ("CPU S7-1511-1 PN") resolve. The generic "S7-1500" entry
 * is last: no specific family string contains it, so it only catches types
 * that name no model.
 */
const CPU_ORDER_NUMBERS: Record<string, string> = {
  "S7-1511": "6ES7 511-1AK02-0AB0/V2.9",
  "S7-1512": "6ES7 512-1DK01-0AB0/V2.9",
  "S7-1513": "6ES7 513-1AL02-0AB0/V2.9",
  "S7-1515": "6ES7 515-2AM02-0AB0/V2.9",
  "S7-1516": "6ES7 516-3AN02-0AB0/V2.9",
  "S7-1517": "6ES7 517-3AP00-0AB0/V2.9",
  "S7-1518": "6ES7 518-4AP00-0AB0/V2.9",
  "S7-1500": "6ES7 516-3AN02-0AB0/V2.9", // generic fallback → S7-1516
};

export interface ProvisionIoModules {
  modules: IoModuleDto[];
  /** module_type of every module with no order number — cannot be plugged. */
  missingOrderNumbers: string[];
}

/**
 * The CPU the bridge should create. An authored order number always wins;
 * `firmware` is appended only when the order number carries no `/Vx.y` suffix
 * of its own. `undefined` means no CPU is resolvable — the caller must block
 * the fresh build rather than guess a default.
 */
export function cpuOrderNumberFromHardware(
  hardware: HardwareModelV1 | null | undefined,
): string | undefined {
  const cpu = hardware?.cpu;
  if (!cpu) return undefined;

  const explicit = cpu.cpu_order_number?.trim();
  if (explicit) {
    const firmware = cpu.firmware?.trim().replace(/^\//, "");
    return firmware && !explicit.includes("/") ? `${explicit}/${firmware}` : explicit;
  }

  const cpuType = cpu.cpu_type?.trim() ?? "";
  for (const [family, mlfb] of Object.entries(CPU_ORDER_NUMBERS)) {
    if (cpuType.includes(family)) return mlfb;
  }
  return undefined;
}

/** Flatten racks → modules the bridge can plug, reporting the ones it can't. */
export function ioModulesFromHardware(
  hardware: HardwareModelV1 | null | undefined,
): ProvisionIoModules {
  const modules: IoModuleDto[] = [];
  const missingOrderNumbers: string[] = [];
  for (const rack of hardware?.racks ?? []) {
    for (const mod of rack.modules ?? []) {
      const mlfb = mod.order_number?.trim();
      if (mlfb) {
        modules.push({ mlfb, rack: rack.rack, slot: mod.slot, description: mod.module_type });
      } else {
        missingOrderNumbers.push(mod.module_type);
      }
    }
  }
  return { modules, missingOrderNumbers };
}

/** The send plan carries MigrationTagDto; provisioning wants IoTagDto. */
export function ioTagsFromMigrationTags(tags: MigrationTagDto[]): IoTagDto[] {
  return tags.map((t) => ({
    name: t.name,
    data_type: t.dataType,
    logical_address: t.address,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: clean, no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/tia-provision-inputs.ts src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts
git commit -m "feat(tia): pure contract.hardware -> provision inputs mapper (G9-W9)"
```

---

### Task 2: Bridge contract types + `buildPlan` computes provision inputs

Teach the TS bridge contract about the new request/response fields, and have `buildPlan` derive the provision inputs from the contract it already loads.

**Files:**
- Modify: `src/lib/tia-bridge-contract.ts:370-385` (`ProvisionProjectRequest`, `ProvisionProjectResponse`)
- Modify: `src/hooks/use-send-code-to-tia.ts` (`CodeSendPlan` at :21-33, `buildPlan` body at :102-110)
- Test: `src/hooks/__tests__/use-send-code-to-tia.test.tsx` (existing file — add cases)

**Interfaces:**
- Consumes: `cpuOrderNumberFromHardware`, `ioModulesFromHardware`, `ProvisionIoModules` (Task 1).
- Produces: `ProvisionInputs` on `CodeSendPlan` — `plan.provision: { cpuOrderNumber?: string; ioModules: IoModuleDto[]; missingOrderNumbers: string[] }`; `ProvisionProjectRequest.sources?: Record<string, string>`, `.import_order?: string[]`; `ProvisionProjectResponse.compile_result?: CompileResult`.

- [ ] **Step 1: Write the failing test**

Append to `src/hooks/__tests__/use-send-code-to-tia.test.tsx`, inside the existing `describe("useSendCodeToTia", ...)` block. The file's shared `contract` fixture has no `hardware` key, so the absent-hardware case is covered by the existing fixture; the authored case re-mocks the loader per test:

```ts
  it("derives provision inputs from contract.hardware", async () => {
    const { loadSpecContract } = await import("@/lib/spec-builder/contract");
    vi.mocked(loadSpecContract).mockResolvedValueOnce({
      ...contract,
      hardware: {
        platform: "SIEMENS_TIA",
        cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0", firmware: "V2.9" },
        racks: [
          {
            rack: 0,
            modules: [
              { slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 521-1BH50-0AA0" },
              { slot: 2, module_type: "DQ 16x24VDC" },
            ],
          },
        ],
      },
    } as unknown as SpecContractV2);

    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });

    expect(plan.provision.cpuOrderNumber).toBe("6ES7 516-3AN02-0AB0/V2.9");
    expect(plan.provision.ioModules).toEqual([
      { mlfb: "6ES7 521-1BH50-0AA0", rack: 0, slot: 1, description: "DI 16x24VDC" },
    ]);
    expect(plan.provision.missingOrderNumbers).toEqual(["DQ 16x24VDC"]);
    // The un-pluggable module is surfaced to the operator, not swallowed.
    expect(plan.warnings.some((w) => w.includes("DQ 16x24VDC"))).toBe(true);
  });

  it("leaves cpuOrderNumber undefined when no hardware is authored", async () => {
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    expect(plan.provision.cpuOrderNumber).toBeUndefined();
    expect(plan.provision.ioModules).toEqual([]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-send-code-to-tia.test.tsx`
Expected: FAIL — `plan.provision` is undefined (`Cannot read properties of undefined (reading 'cpuOrderNumber')`).

- [ ] **Step 3: Extend the bridge contract types**

In `src/lib/tia-bridge-contract.ts`, add the import at the top of the file alongside the existing imports:

```ts
import type { CompileResult } from "@/types/tia";
```

Then replace the `ProvisionProjectRequest` and `ProvisionProjectResponse` interfaces (currently at :370-385) with:

```ts
export interface ProvisionProjectRequest {
  tia_project_path: string;  // Folder path
  project_name?: string;     // Defaults to folder basename
  cpu_order_number?: string; // e.g. "6ES7 516-3AN02-0AB0/V2.9"
  provision_id?: string;     // Correlation ID for WS progress events
  io_modules?: IoModuleDto[];
  io_tags?: IoTagDto[];
  /** name → SCL. When present the bridge imports the program and compiles HW+SW. */
  sources?: Record<string, string>;
  /** Import order — dependency-ordered (UDT → FB → FC → DB → OB). */
  import_order?: string[];
}

export interface ProvisionProjectResponse {
  success: boolean;
  created: boolean;           // true = new project created, false = existing opened
  project_file_path: string;
  message: string;
  warnings: string[];
  /** Present when `sources` were supplied — the HW+SW compile outcome. */
  compile_result?: CompileResult;
}
```

If `npx tsc -b` reports a circular import between `@/types/tia` and `@/lib/tia-bridge-contract`, it is type-only and erased — confirm the error text; a genuine cycle here would be a new one, since `src/types/tia.ts` does not import the bridge contract.

- [ ] **Step 4: Populate `plan.provision` in `buildPlan`**

In `src/hooks/use-send-code-to-tia.ts`, add to the imports:

```ts
import {
  cpuOrderNumberFromHardware,
  ioModulesFromHardware,
} from "@/lib/spec-builder/tia-provision-inputs";
import type { IoModuleDto } from "@/lib/tia-bridge-contract";
```

Add the interface above `CodeSendPlan` and the new field to it:

```ts
/** What a fresh-project build needs from the FDS's hardware model (G9-W9). */
export interface ProvisionInputs {
  /** undefined ⇒ no CPU resolvable; the fresh build must stay disabled. */
  cpuOrderNumber?: string;
  ioModules: IoModuleDto[];
  /** module_type of modules with no order number — reported, not plugged. */
  missingOrderNumbers: string[];
}

export interface CodeSendPlan {
  // ...existing fields unchanged...
  /** Fresh-project build inputs derived from contract.hardware (G9-W9). */
  provision: ProvisionInputs;
  warnings: string[];
}
```

In `buildPlan`, after the existing `const ioTagDerivation = deriveIoTags(contract);` line, insert:

```ts
      const provisionIo = ioModulesFromHardware(contract.hardware);
      const provisionWarnings = provisionIo.missingOrderNumbers.length
        ? [
            `Hardware: ${provisionIo.missingOrderNumbers.join(", ")} have no order number and cannot be plugged into a fresh project.`,
          ]
        : [];
```

and replace the `const next: CodeSendPlan = {...}` literal with:

```ts
      const next: CodeSendPlan = {
        sources,
        folders,
        countsByType,
        editedBlocks,
        ioTags: ioTagDerivation.tags,
        provision: {
          cpuOrderNumber: cpuOrderNumberFromHardware(contract.hardware),
          ioModules: provisionIo.modules,
          missingOrderNumbers: provisionIo.missingOrderNumbers,
        },
        warnings: [
          ...result.warnings,
          ...ioTagDerivation.warnings,
          ...carryOver.warnings,
          ...provisionWarnings,
        ],
      };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/use-send-code-to-tia.test.tsx`
Expected: PASS — 6 tests (4 pre-existing + 2 new). The pre-existing cases must stay green; `plan.provision` is additive.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tia-bridge-contract.ts src/hooks/use-send-code-to-tia.ts src/hooks/__tests__/use-send-code-to-tia.test.tsx
git commit -m "feat(tia): provision inputs on the send plan + sources/compile_result on the bridge contract (G9-W9)"
```

---

### Task 3: Provision progress reducer

The WS progress mechanism as a pure reducer plus a thin socket wrapper, so step accumulation is unit-tested. The retiring `use-forge-provision.ts` keeps its own inline copy — **do not modify it**; it is being retired and touching it risks a regression in the Forge wizard.

**Files:**
- Create: `src/lib/tia-provision-progress.ts`
- Test: `src/lib/__tests__/tia-provision-progress.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_BRIDGE_CONFIG.wsUrl` (`@/lib/tia-bridge-contract`).
- Produces:
  - `interface ProvisionStep { label: string; progress: number; state: "active" | "done" | "error" }`
  - `interface ProvisionProgressEvent { provision_id?: string; step?: string; progress?: number; complete?: boolean; failed?: boolean; error?: string }`
  - `applyProvisionEvent(steps: ProvisionStep[], evt: ProvisionProgressEvent): ProvisionStep[]`
  - `connectProvisionWs(provisionId: string, onSteps: (next: (prev: ProvisionStep[]) => ProvisionStep[]) => void): Promise<WebSocket>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/tia-provision-progress.test.ts`:

```ts
// src/lib/__tests__/tia-provision-progress.test.ts
//
// Provision WS progress accumulation (G9-W9) — pure reducer.
import { describe, expect, it } from "vitest";
import { applyProvisionEvent, type ProvisionStep } from "../tia-provision-progress";

describe("applyProvisionEvent", () => {
  it("appends the first step as active", () => {
    expect(applyProvisionEvent([], { step: "Creating TIA project", progress: 15 })).toEqual([
      { label: "Creating TIA project", progress: 15, state: "active" },
    ]);
  });

  it("marks the previous active step done when a new one arrives", () => {
    const first = applyProvisionEvent([], { step: "Creating TIA project", progress: 15 });
    const second = applyProvisionEvent(first, { step: "Adding PLC device", progress: 35 });
    expect(second).toEqual([
      { label: "Creating TIA project", progress: 15, state: "done" },
      { label: "Adding PLC device", progress: 35, state: "active" },
    ]);
  });

  it("replaces a repeated label instead of duplicating it", () => {
    const steps: ProvisionStep[] = [{ label: "Importing program blocks", progress: 80, state: "active" }];
    const next = applyProvisionEvent(steps, { step: "Importing program blocks", progress: 85 });
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ label: "Importing program blocks", progress: 85, state: "active" });
  });

  it("marks a completed 100% step done and a failed step error", () => {
    expect(applyProvisionEvent([], { step: "Complete", progress: 100, complete: true })[0].state)
      .toBe("done");
    expect(applyProvisionEvent([], { step: "Adding PLC device", progress: 35, failed: true })[0].state)
      .toBe("error");
  });

  it("leaves an errored step errored when later steps arrive", () => {
    const failed = applyProvisionEvent([], { step: "Adding PLC device", progress: 35, failed: true });
    const next = applyProvisionEvent(failed, { step: "Saving project", progress: 90 });
    expect(next[0].state).toBe("error");
    expect(next[1].state).toBe("active");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/tia-provision-progress.test.ts`
Expected: FAIL — `Failed to resolve import "../tia-provision-progress"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/tia-provision-progress.ts`:

```ts
/**
 * Provision progress over the bridge WebSocket (G9-W9).
 *
 * The bridge emits `provision_progress` events throughout ProvisionProject.
 * The accumulation rule lives in a pure reducer so it is unit-tested; the
 * socket wrapper stays thin.
 */
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

export interface ProvisionStep {
  label: string;
  progress: number;
  state: "active" | "done" | "error";
}

export interface ProvisionProgressEvent {
  provision_id?: string;
  step?: string;
  progress?: number;
  complete?: boolean;
  failed?: boolean;
  error?: string;
}

/**
 * Fold one bridge event into the step list: a new label supersedes the
 * previously active step (which becomes done); a repeated label is updated in
 * place. Errored steps stay errored.
 */
export function applyProvisionEvent(
  steps: ProvisionStep[],
  evt: ProvisionProgressEvent,
): ProvisionStep[] {
  const { step = "", progress = 0, complete = false, failed = false } = evt;
  const next: ProvisionStep = {
    label: step,
    progress,
    state: failed ? "error" : complete && progress >= 100 ? "done" : "active",
  };
  const settled = steps.map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s));
  const existing = settled.findIndex((s) => s.label === step);
  if (existing >= 0) {
    settled[existing] = next;
    return settled;
  }
  return [...settled, next];
}

/**
 * Open the bridge WS and stream this provision's steps. Resolves once the
 * socket is open **or** immediately on error, so a bridge with no WS still
 * lets the HTTP POST fire. Caller closes the returned socket.
 */
export function connectProvisionWs(
  provisionId: string,
  onSteps: (next: (prev: ProvisionStep[]) => ProvisionStep[]) => void,
): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(DEFAULT_BRIDGE_CONFIG.wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => resolve(ws); // resolve anyway so the POST still fires
    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data as string) as {
          type: string;
          data: ProvisionProgressEvent;
        };
        if (parsed.type !== "provision_progress") return;
        if (parsed.data.provision_id !== provisionId) return;
        onSteps((prev) => applyProvisionEvent(prev, parsed.data));
      } catch {
        // Malformed frame — ignore; progress is advisory, the POST is truth.
      }
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/tia-provision-progress.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tia-provision-progress.ts src/lib/__tests__/tia-provision-progress.test.ts
git commit -m "feat(tia): pure provision-progress reducer + WS wrapper (G9-W9)"
```

---

### Task 4: `provisionFresh` action on `useSendCodeToTia`

The action that actually builds the project: opens the WS, POSTs the extended provision request with the plan's sources and tags, and exposes status.

**Files:**
- Modify: `src/hooks/use-send-code-to-tia.ts` (add the action + returned state)
- Test: `src/hooks/__tests__/use-send-code-to-tia.test.tsx` (add cases)

**Interfaces:**
- Consumes: `CodeSendPlan.provision` (Task 2); `ioTagsFromMigrationTags` (Task 1); `connectProvisionWs`, `ProvisionStep` (Task 3); `ProvisionProjectRequest`/`ProvisionProjectResponse` (Task 2).
- Produces, on the hook's return value:
  - `provisionFresh(plan: CodeSendPlan, opts: { projectPath: string; projectName: string }): Promise<ProvisionProjectResponse | null>`
  - `provisioning: boolean`
  - `provisionSteps: ProvisionStep[]`
  - `provisionResult: ProvisionProjectResponse | null`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("useSendCodeToTia", ...)` in `src/hooks/__tests__/use-send-code-to-tia.test.tsx`. Add this WebSocket stub near the existing `vi.stubGlobal("fetch", fetchMock)` at the top of the file:

```ts
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor() {
    // Open on the next microtask so `await connectProvisionWs(...)` resolves.
    queueMicrotask(() => this.onopen?.());
  }
}
vi.stubGlobal("WebSocket", FakeWebSocket);
```

and the cases:

```ts
  it("POSTs the plan's sources and tags to /tia/provision-project", async () => {
    const { loadSpecContract } = await import("@/lib/spec-builder/contract");
    vi.mocked(loadSpecContract).mockResolvedValueOnce({
      ...contract,
      hardware: {
        platform: "SIEMENS_TIA",
        cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0/V2.9" },
        racks: [{ rack: 0, modules: [{ slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 521-1BH50-0AA0" }] }],
      },
    } as unknown as SpecContractV2);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true, created: true, project_file_path: "C:\\TIA\\M1\\M1.ap20",
        message: "Created project 'M1' with PLC_1", warnings: [],
        compile_result: { success: true, errors: [], warnings: [], compiled_at: "" },
      }),
    });

    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    await act(async () => {
      await result.current.provisionFresh(plan, { projectPath: "C:\\TIA", projectName: "M1" });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5102/tia/provision-project",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tia_project_path).toBe("C:\\TIA");
    expect(body.project_name).toBe("M1");
    expect(body.cpu_order_number).toBe("6ES7 516-3AN02-0AB0/V2.9");
    expect(body.io_modules).toEqual([
      { mlfb: "6ES7 521-1BH50-0AA0", rack: 0, slot: 1, description: "DI 16x24VDC" },
    ]);
    // MigrationTagDto → IoTagDto
    expect(body.io_tags[0]).toEqual({ name: "M01_Run", data_type: "Bool", logical_address: "%Q0.0" });
    // The whole program rides along, in dependency order.
    expect(Object.keys(body.sources)).toContain("EM_Belt");
    expect(body.import_order).toEqual(Object.keys(body.sources));
    expect(body.import_order[body.import_order.length - 1]).toBe("Main");
    expect(typeof body.provision_id).toBe("string");
    expect(result.current.provisionResult?.created).toBe(true);
  });

  it("surfaces a bridge failure without throwing", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "TIA offline" });
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    let resp: unknown;
    await act(async () => {
      resp = await result.current.provisionFresh(plan, { projectPath: "C:\\TIA", projectName: "M1" });
    });
    expect(resp).toBeNull();
    expect(result.current.error).toContain("Fresh project build failed");
    expect(result.current.provisioning).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-send-code-to-tia.test.tsx`
Expected: FAIL — `result.current.provisionFresh is not a function`.

- [ ] **Step 3: Implement the action**

In `src/hooks/use-send-code-to-tia.ts` add to the imports:

```ts
import { useRef } from "react";
import { ioTagsFromMigrationTags } from "@/lib/spec-builder/tia-provision-inputs";
import { connectProvisionWs, type ProvisionStep } from "@/lib/tia-provision-progress";
import type { ProvisionProjectRequest, ProvisionProjectResponse } from "@/lib/tia-bridge-contract";
```

(`useRef` joins the existing `import { useCallback, useState } from "react";` — merge, don't duplicate the import.)

Inside `useSendCodeToTia`, after the existing `tagResult` state, add:

```ts
  const [provisioning, setProvisioning] = useState(false);
  const [provisionSteps, setProvisionSteps] = useState<ProvisionStep[]>([]);
  const [provisionResult, setProvisionResult] = useState<ProvisionProjectResponse | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  /**
   * Build a NEW TIA project (hardware + program) from the FDS in one bridge
   * call. Unlike `send`, this needs no open project — the bridge creates it.
   */
  const provisionFresh = useCallback(
    async (
      sendPlan: CodeSendPlan,
      opts: { projectPath: string; projectName: string },
    ): Promise<ProvisionProjectResponse | null> => {
      setProvisioning(true);
      setProvisionSteps([]);
      setProvisionResult(null);
      setError(null);

      const provisionId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      // Connect before the POST so no early progress events are missed.
      wsRef.current = await connectProvisionWs(provisionId, (next) => setProvisionSteps(next));

      const body: ProvisionProjectRequest = {
        tia_project_path: opts.projectPath,
        project_name: opts.projectName,
        cpu_order_number: sendPlan.provision.cpuOrderNumber,
        provision_id: provisionId,
        io_modules: sendPlan.provision.ioModules,
        io_tags: ioTagsFromMigrationTags(sendPlan.ioTags),
        sources: sendPlan.sources,
        // `sources` is insertion-ordered UDT → FB → FC → DB → OB (buildPlan).
        import_order: Object.keys(sendPlan.sources),
      };

      try {
        const response = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/provision-project`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          // Creating hardware + importing a full program + compiling runs to
          // minutes on Openness; matches the reimport path's ceiling.
          signal: AbortSignal.timeout(600_000),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Fresh project build failed (${response.status}): ${text}`);
        }
        const result = (await response.json()) as ProvisionProjectResponse;
        setProvisionResult(result);
        if (!result.success) setError(result.message);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          msg.includes("timed out") || msg.includes("TimeoutError")
            ? "TIA Portal is taking longer than expected. The project may still be building — check TIA Portal directly."
            : msg.startsWith("Fresh project build failed")
              ? msg
              : `Fresh project build failed: ${msg}`,
        );
        return null;
      } finally {
        wsRef.current?.close();
        wsRef.current = null;
        setProvisioning(false);
      }
    },
    [],
  );
```

Add to the hook's returned object:

```ts
    provisionFresh,
    provisioning,
    provisionSteps,
    provisionResult,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/use-send-code-to-tia.test.tsx`
Expected: PASS — 8 tests, all pre-existing cases still green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-send-code-to-tia.ts src/hooks/__tests__/use-send-code-to-tia.test.tsx
git commit -m "feat(tia): provisionFresh action builds a new project from the plan (G9-W9)"
```

---

### Task 5: "Create new project…" in `SendToTiaPanel`

A second, deliberate action beside the everyday reimport, with its own inline form, hardware guard, live progress, and result handling.

**Files:**
- Modify: `src/components/code-builder/send-to-tia-panel.tsx`
- Modify: `src/routes/code-builder.tsx:119` (pass the default project name)
- Test: `src/components/code-builder/__tests__/send-to-tia-panel.test.tsx` (create)

**Interfaces:**
- Consumes: `provisionFresh`, `provisioning`, `provisionSteps`, `provisionResult`, `plan.provision` (Tasks 2–4).
- Produces: `SendToTiaPanel` prop `defaultProjectName?: string`.

- [ ] **Step 1: Write the failing test**

Create `src/components/code-builder/__tests__/send-to-tia-panel.test.tsx`:

```tsx
// src/components/code-builder/__tests__/send-to-tia-panel.test.tsx
//
// Fresh-project build UI (G9-W9): the guard, the form, and the
// already-existed outcome. The open-project reimport path is untouched.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SendToTiaPanel } from "../send-to-tia-panel";
import type { CodeSendPlan } from "@/hooks/use-send-code-to-tia";
import type { ProvisionStep } from "@/lib/tia-provision-progress";
import type { ProvisionProjectResponse } from "@/lib/tia-bridge-contract";

const basePlan: CodeSendPlan = {
  sources: { EM_Belt: "FUNCTION_BLOCK\nEND_FUNCTION_BLOCK\n", Main: "ORGANIZATION_BLOCK\nEND_ORGANIZATION_BLOCK\n" },
  folders: {},
  countsByType: { FB: 1, OB: 1 },
  editedBlocks: [],
  ioTags: [],
  provision: { cpuOrderNumber: "6ES7 516-3AN02-0AB0/V2.9", ioModules: [], missingOrderNumbers: [] },
  warnings: [],
};

const hookState = {
  buildPlan: vi.fn(async () => basePlan),
  plan: basePlan as CodeSendPlan | null,
  planning: false,
  error: null as string | null,
  send: vi.fn(),
  sending: false,
  tagResult: null,
  compileResult: null,
  sendError: null,
  provisionFresh: vi.fn(async () => null),
  provisioning: false,
  provisionSteps: [] as ProvisionStep[],
  // Must be the real response type — the panel reads `compile_result` off it.
  provisionResult: null as ProvisionProjectResponse | null,
};

vi.mock("@/hooks/use-send-code-to-tia", () => ({
  useSendCodeToTia: () => hookState,
}));

beforeEach(() => {
  hookState.plan = basePlan;
  hookState.provisionResult = null;
  hookState.provisionFresh.mockClear();
});

function open(defaultProjectName = "SRL-1427") {
  render(<SendToTiaPanel specId="spec-1" revision={1} defaultProjectName={defaultProjectName} />);
  fireEvent.click(screen.getByRole("button", { name: /send to tia/i }));
}

describe("SendToTiaPanel fresh build", () => {
  it("passes the folder, name and plan to provisionFresh", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /create new project/i }));
    fireEvent.change(screen.getByLabelText(/folder/i), { target: { value: "C:\\TIA" } });
    expect(screen.getByLabelText(/project name/i)).toHaveValue("SRL-1427");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^build project$/i }));
    });
    expect(hookState.provisionFresh).toHaveBeenCalledWith(basePlan, {
      projectPath: "C:\\TIA",
      projectName: "SRL-1427",
    });
  });

  it("blocks the fresh build when no CPU is resolvable", () => {
    hookState.plan = { ...basePlan, provision: { ...basePlan.provision, cpuOrderNumber: undefined } };
    open();
    fireEvent.click(screen.getByRole("button", { name: /create new project/i }));
    expect(screen.getByRole("button", { name: /^build project$/i })).toBeDisabled();
    expect(screen.getByText(/author a cpu in the skeleton wizard/i)).toBeInTheDocument();
  });

  it("warns and redirects the user when the project already existed", () => {
    hookState.provisionResult = {
      success: true,
      created: false,
      project_file_path: "C:\\TIA\\M1\\M1.ap20",
      message: "Opened existing project: M1",
      warnings: ["Project already existed — program not imported."],
    };
    open();
    fireEvent.click(screen.getByRole("button", { name: /create new project/i }));
    expect(screen.getByText(/program was not imported/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/send-to-tia-panel.test.tsx`
Expected: FAIL — no button matching `/create new project/i`.

- [ ] **Step 3: Implement the panel changes**

In `src/components/code-builder/send-to-tia-panel.tsx`:

Extend the imports:

```tsx
import { useState } from "react";
import { FolderPlus, Hammer, Loader2, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
```

Change the signature and destructuring:

```tsx
const PROJECT_FOLDER_KEY = "pacforge.tia.projectFolder";

export function SendToTiaPanel({
  specId,
  revision,
  defaultProjectName,
}: {
  specId: string;
  revision: number | undefined;
  /** Seeds the fresh-build project name — the spec's doc code or title. */
  defaultProjectName?: string;
}) {
  const {
    buildPlan, plan, planning, error, send, sending, tagResult, compileResult, sendError,
    provisionFresh, provisioning, provisionSteps, provisionResult,
  } = useSendCodeToTia(specId, revision);

  const [showFresh, setShowFresh] = useState(false);
  const [projectPath, setProjectPath] = useState(
    () => localStorage.getItem(PROJECT_FOLDER_KEY) ?? "",
  );
  const [projectName, setProjectName] = useState(defaultProjectName ?? "");
  const canBuildFresh =
    !!plan?.provision.cpuOrderNumber && projectPath.trim().length > 0 && projectName.trim().length > 0;
```

Add the second button beside the existing *Import + compile* button — inside the `{plan && (<> ... </>)}` fragment, immediately after the existing `<Button ... >Import + compile</Button>`:

```tsx
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowFresh((v) => !v)}
              >
                <FolderPlus className="h-3 w-3" />
                Create new project…
              </Button>
```

The *Import + compile* button keeps its existing `className="ml-auto h-7 gap-1 text-xs"` — the `ml-auto` pushes it and the new button to the right edge as a pair, so no layout change is needed.

Then, directly after the closing `</div>` of that button row, add the form block:

```tsx
        {plan && showFresh && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Creates a NEW TIA project with the CPU and IO modules from the FDS
              hardware model, imports the whole program, and compiles hardware +
              software. TIA must be open and OFFLINE; nothing needs to be loaded.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="fresh-folder" className="text-[11px]">Folder</Label>
                <Input
                  id="fresh-folder"
                  className="h-7 font-mono text-xs"
                  placeholder="C:\TIA_Projects"
                  value={projectPath}
                  onChange={(e) => {
                    setProjectPath(e.target.value);
                    localStorage.setItem(PROJECT_FOLDER_KEY, e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fresh-name" className="text-[11px]">Project name</Label>
                <Input
                  id="fresh-name"
                  className="h-7 font-mono text-xs"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </div>
            </div>

            {!plan.provision.cpuOrderNumber && (
              <p className="text-xs text-amber-600">
                Author a CPU in the skeleton wizard&apos;s Hardware step first — a
                project is never built with a guessed default CPU.
              </p>
            )}
            {plan.provision.missingOrderNumbers.length > 0 && (
              <p className="text-xs text-amber-600">
                No order number for {plan.provision.missingOrderNumbers.join(", ")} — these
                modules will not be plugged.
              </p>
            )}

            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={!canBuildFresh || provisioning}
              onClick={() =>
                void provisionFresh(plan, {
                  projectPath: projectPath.trim(),
                  projectName: projectName.trim(),
                })
              }
            >
              {provisioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderPlus className="h-3 w-3" />}
              Build project
            </Button>

            {provisionSteps.length > 0 && (
              <ul className="space-y-0.5 text-[10px]">
                {provisionSteps.map((s) => (
                  <li
                    key={s.label}
                    className={
                      s.state === "error"
                        ? "text-destructive"
                        : s.state === "done"
                          ? "text-muted-foreground"
                          : "font-medium"
                    }
                  >
                    {s.progress}% · {s.label}
                  </li>
                ))}
              </ul>
            )}

            {provisionResult && (
              <div className="space-y-1">
                <p className="text-xs">{provisionResult.message}</p>
                {provisionResult.created === false && (
                  <p className="text-xs text-amber-600">
                    A project already existed at that path, so the program was not
                    imported. Use Import + compile against the now-open project, or
                    pick a different folder or name.
                  </p>
                )}
                {provisionResult.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600">{w}</p>
                ))}
              </div>
            )}
          </div>
        )}
```

Finally, render the fresh build's compile result through the panel's existing compile block rather than duplicating it. Declare the alias next to `canBuildFresh`:

```tsx
  // A fresh build's compile result renders through the same block as a reimport's.
  const shownCompile = compileResult ?? provisionResult?.compile_result ?? null;
```

Change the source-preview condition (currently `{plan && !compileResult && (`) to:

```tsx
        {plan && !shownCompile && (
```

and replace the whole compile block (currently `{compileResult && ( ... )}`, lines 119-142) with:

```tsx
        {shownCompile && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">
              Compile: {shownCompile.success ? "SUCCESS" : `${shownCompile.errors.length} error(s)`}
              {shownCompile.warnings.length ? ` · ${shownCompile.warnings.length} warning(s)` : ""}
            </p>
            <ScrollArea className="h-48 rounded-md border">
              <ul className="space-y-1 p-2 text-[10px]">
                {[...shownCompile.errors, ...shownCompile.warnings].map((e, i) => (
                  <li key={i} className={e.severity === "ERROR" ? "text-destructive" : "text-muted-foreground"}>
                    <span className="font-mono">
                      {e.artifact_name}
                      {e.line !== null ? `:${e.line}` : ""}
                    </span>{" "}
                    [{e.severity}] {e.error_text}
                  </li>
                ))}
                {shownCompile.success && shownCompile.errors.length === 0 && (
                  <li className="text-muted-foreground">All blocks compiled clean.</li>
                )}
              </ul>
            </ScrollArea>
          </div>
        )}
```

- [ ] **Step 4: Pass the default project name from the route**

In `src/routes/code-builder.tsx`, line 119, replace:

```tsx
          {specId && <SendToTiaPanel specId={specId} revision={revision} />}
```

with:

```tsx
          {specId && (
            <SendToTiaPanel
              specId={specId}
              revision={revision}
              defaultProjectName={spec?.doc_code ?? spec?.title}
            />
          )}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/send-to-tia-panel.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 6: Typecheck and run the touched suites**

Run: `npx tsc -b && npx vitest run src/components/code-builder src/hooks/__tests__/use-send-code-to-tia.test.tsx`
Expected: clean typecheck; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/code-builder/send-to-tia-panel.tsx src/components/code-builder/__tests__/send-to-tia-panel.test.tsx src/routes/code-builder.tsx
git commit -m "feat(tia): Create new project button builds a fresh TIA project from the FDS (G9-W9)"
```

---

### Task 6: Bridge — `ProvisionProject` imports sources and compiles HW+SW

The only C# change. Extract the SCL-import block from `CreateProjectWithSources` into a shared private helper, call it from `ProvisionProject`, return the compile result, guard the existing-project case, and deprecate the old entry point.

**Files:**
- Modify: `bridge/PacForgeBridge/Models.cs:136-153` (`ProvisionProjectRequest`, `ProvisionProjectResponse`)
- Modify: `bridge/PacForgeBridge/TiaPortalService.cs` — `BridgeVersion` (:167), `ProvisionProject` (:391-558), `CreateProjectWithSources` (:1547-1646)
- Modify: `bridge/PacForgeBridge/CHANGELOG.md`

**Interfaces:**
- Consumes: `sources` / `import_order` from the TS `ProvisionProjectRequest` (Task 2); existing `ImportArtifact`, `CompileAll`, `PlugIoModules`, `CreateIoTags`, `SaveProject`, `DemoResult`, `CompileResultDto`.
- Produces: `ProvisionProjectResponse.CompileResult` (serialized `compile_result`), consumed by Task 5's panel.

**No unit tests exist for the bridge** (C# + Openness). The gate for this task is a clean build plus the live FAT in the Verification section below. Do not claim it works without the live proof.

- [ ] **Step 1: Extend the request/response models**

In `bridge/PacForgeBridge/Models.cs`, add the two fields to `ProvisionProjectRequest` (after `IoTags`):

```csharp
        public Dictionary<string, string> Sources { get; set; }  // name → SCL; when present the program is imported too
        public List<string> ImportOrder { get; set; }            // dependency order: UDT → FB → FC → DB → OB
```

and the field to `ProvisionProjectResponse` (after `Warnings`):

```csharp
        public CompileResultDto CompileResult { get; set; }      // present when Sources were supplied
```

- [ ] **Step 2: Extract the shared source-import helper**

In `bridge/PacForgeBridge/TiaPortalService.cs`, add this private method immediately above `CreateProjectWithSources` (~:1547):

```csharp
        /// <summary>
        /// Delete the auto-created OB1, then write each source to a temp .scl and
        /// import it in ImportOrder. Shared by ProvisionProject (the current path)
        /// and CreateProjectWithSources (deprecated). Warnings are collected per
        /// block so one bad source does not abort the whole import.
        /// </summary>
        private void ImportSourcesIntoPlc(
            PlcSoftware plcSoftware,
            Dictionary<string, string> sources,
            List<string> importOrder,
            DemoResult result)
        {
            // The generated program supplies its own OB1; the auto-created Main
            // would collide on import.
            try
            {
                PlcBlock existingMain = plcSoftware.BlockGroup.Blocks.Find("Main");
                if (existingMain != null)
                {
                    Console.WriteLine("[TIA] Deleting auto-created OB1 (Main) before import...");
                    existingMain.Delete();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[TIA] Warning: Could not delete existing OB1: {ex.Message}");
            }

            string tempDir = Path.Combine(Path.GetTempPath(), "PacForge", "proj_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(tempDir);

            try
            {
                LastImportedSources.Clear();
                foreach (var kvp in sources)
                {
                    LastImportedSources[kvp.Key] = kvp.Value;
                }

                var order = (importOrder != null && importOrder.Count > 0)
                    ? importOrder
                    : new List<string>(sources.Keys);

                foreach (string name in order)
                {
                    if (!sources.ContainsKey(name))
                    {
                        result.Warnings.Add($"{name}: not found in sources, skipping");
                        continue;
                    }

                    string filePath = Path.Combine(tempDir, name + ".scl");
                    File.WriteAllText(filePath, sources[name], new UTF8Encoding(true));

                    try
                    {
                        var generated = ImportArtifact(plcSoftware, name, filePath, "Program blocks");
                        result.ImportedBlocks.AddRange(generated);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[TIA] Warning importing {name}: {ex.Message}");
                        result.Warnings.Add($"{name}: {ex.Message}");
                    }
                }
            }
            finally
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }
        }
```

Then replace the body of `CreateProjectWithSources` from `// Step 3d: Delete auto-created OB1` through the end of its `try { ... } finally { ... }` block with a call to the helper, so both paths share one implementation:

```csharp
            // Step 3d + 4: delete auto-OB1 and import the sources (shared helper)
            ImportSourcesIntoPlc(plcSoftware, sources, importOrder, result);

            // Step 5: Compile
            Console.WriteLine("[TIA] Compiling project...");
            result.CompileResult = CompileAll(plcSoftware);

            // Step 6: Save
            SaveProject();

            result.Success = true;
            result.ProjectPath = _project.Path?.FullName;

            return result;
```

and mark the method deprecated by adding this attribute directly above its signature:

```csharp
        [Obsolete("Use ProvisionProject with Sources/ImportOrder — parameterized CPU, module plugging and WS progress. Endpoint kept for back-compat.")]
```

- [ ] **Step 3: Import sources inside `ProvisionProject`**

In `ProvisionProject`, in the **existing-project early return** (currently :432-443), add the guard before `return response;`:

```csharp
                if (request.Sources != null && request.Sources.Count > 0)
                {
                    response.Warnings.Add(
                        "Project already existed — program NOT imported. Use Import + compile against the open project, or choose a different folder/name.");
                }
```

Then, after the IO-tag block and **before** `Emit("Saving project", 90);` (currently :533), insert:

```csharp
            // Import the generated program. Absent Sources ⇒ hardware-only
            // provision, exactly as before.
            bool hasSources = request.Sources != null && request.Sources.Count > 0;
            if (hasSources)
            {
                Emit("Importing program blocks", 80);
                ImportSourcesIntoPlc(plcSoftware, request.Sources, request.ImportOrder, demoResult);
                response.Warnings.AddRange(demoResult.Warnings);
            }
```

Note `demoResult.Warnings` accumulates across the module/tag steps, which already `AddRange` theirs; clear before reuse so warnings are not duplicated — insert `demoResult.Warnings.Clear();` as the first line inside the `if (hasSources)` block.

Finally, replace the compile block (currently :536-549) with:

```csharp
            // Compile hardware (and software, when a program was imported).
            Emit(hasSources ? "Compiling program" : "Compiling hardware", 95);
            try
            {
                var compileResult = CompileAll(plcSoftware);
                response.CompileResult = compileResult;
                if (!compileResult.Success)
                {
                    response.Warnings.Add($"Compile: {compileResult.Errors.Count} error(s), {compileResult.Warnings.Count} warning(s)");
                }
            }
            catch (Exception ex)
            {
                response.Warnings.Add($"Compile step skipped: {ex.Message}");
            }
```

and update the success message so the operator can tell a hardware-only provision from a full build — replace the existing `response.Message = ...` line with:

```csharp
            response.Message = hasSources
                ? $"Created project '{_project.Name}' with {device.Name} and {demoResult.ImportedBlocks.Count} block(s)"
                : $"Created project '{_project.Name}' with {device.Name}";
```

No routing change is needed — `/tia/provision-project` already binds `ProvisionProjectRequest` and the new fields ride along.

- [ ] **Step 4: Bump the version and write the changelog**

In `TiaPortalService.cs` line 167, change `BridgeVersion = "1.4.2"` to `BridgeVersion = "1.5.0"` (new capability ⇒ minor).

Add to the top of `bridge/PacForgeBridge/CHANGELOG.md`, directly under the intro paragraph and above `## 1.4.2`:

```markdown
## 1.5.0 — 2026-07-25

Fresh-project build — `ProvisionProject` now builds hardware **and** software:

- `ProvisionProjectRequest` gains optional `Sources` (name → SCL) and
  `ImportOrder`. When present, the generated program is imported after the IO
  tag step and the final compile covers HW + SW, so a runnable project is
  created from the FDS in one call (G9-W9).
- `ProvisionProjectResponse` gains `CompileResult`, so the app renders per-block
  compile errors from a fresh build the same way it does for a reimport.
- The SCL-import block (delete auto-OB1 → temp `.scl` → `ImportArtifact` in
  order) is extracted into the shared private `ImportSourcesIntoPlc`, used by
  both `ProvisionProject` and `CreateProjectWithSources`.
- Existing-project safety: when a project already exists at the target path the
  bridge still opens it and returns `Created=false`, and now adds a warning that
  the program was NOT imported. A pre-existing project is never partially
  updated through this path.
- `CreateProjectWithSources` marked `[Obsolete]` — it hardcodes the CPU and has
  no progress streaming. The endpoint stays for back-compat; new work uses
  `ProvisionProject`.
```

- [ ] **Step 5: Build the bridge**

Run: `dotnet build bridge/PacForgeBridge/PacForgeBridge.csproj`
Expected: build succeeded. `CreateProjectWithSources` will emit a CS0618 obsolete-usage warning at its call site in `BridgeServer.cs` — that is intended; suppress it at the call site with `#pragma warning disable 618` / `#pragma warning restore 618` around the call so the build stays warning-clean.

Build **only** this csproj — the solution also builds a V18 twin whose exe is often running and locked.

- [ ] **Step 6: Commit**

```bash
git add bridge/PacForgeBridge/Models.cs bridge/PacForgeBridge/TiaPortalService.cs bridge/PacForgeBridge/BridgeServer.cs bridge/PacForgeBridge/CHANGELOG.md
git commit -m "feat(bridge): ProvisionProject imports sources and compiles HW+SW; v1.5.0 (G9-W9)"
```

---

## Verification — live FAT (the real gate)

The bridge half has no unit tests. **Feature 2 is not done until this passes on a live TIA install.** Record the outcome on Monday G9-W9.

1. Restart the bridge (`dotnet run --project bridge/PacForgeBridge`). The exe checksum changed, so TIA re-prompts the Openness whitelist on first connect — click Accept. The bridge attaches lazily, so `/tia/status` shows `connected:false` until an endpoint is touched; confirm it reports `1.5.0`.
2. Open a spec that has a CPU + IO modules authored in the skeleton wizard's Hardware step. TIA must be open and **OFFLINE**.
3. Code Builder → **Send to TIA** → *Assemble program* → **Create new project…**. Enter an empty folder and a fresh project name. Confirm the *Build project* button is enabled (it must be disabled with the hint when no CPU is authored).
4. *Build project*. Expect live progress steps through Creating → Adding PLC device → Adding IO modules → Creating IO tag table → Importing program blocks → Compiling program → Complete.
5. In TIA, verify: the new project exists, the CPU matches the authored order number, the IO modules sit at their authored rack/slot, the IO tag table is populated, and the full generated program is present and compiles.
6. Re-run against the **same** folder and name. Expect `created=false`, no import, and the "project already existed" warning in the panel.

## Post-task self-check (repo rule)

`use-send-code-to-tia.ts` is a generation-adjacent hook, so before calling the work done:

1. **Generic check** — no project-specific device names, CPUs, or sequences. The CPU table is Siemens catalogue data; everything else derives from `contract.hardware`. Mentally re-run the flow for a filling station and a stamping cell.
2. **Typecheck** — `npx tsc -b` clean.
3. **Tests** — `npx vitest run src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts src/lib/__tests__/tia-provision-progress.test.ts src/hooks/__tests__/use-send-code-to-tia.test.tsx src/components/code-builder/__tests__/send-to-tia-panel.test.tsx`

## Deferred (own follow-on specs — do not build here)

1. **PLCSIM CPU auto-match** — `RegisterInstance(articleNumber)` from `hardware.cpu` so the sim CPU matches the built project (the original G9 pain).
2. **Module-firmware pinning** from the model (the bridge already ladder-tries firmware suffixes).
