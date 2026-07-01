# PackML EM-State Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the fixed PackML 17-state vocabulary as a canonical module and let EM FB templates declare those states as metadata, so C5's Case A state-coverage check can engage.

**Architecture:** SP-1 adds a pure `packml-states.ts` module (the PackML Base State Model — the ISA-TR88.00.02 collapse of ISA-88 Part 1 Annex D). SP-2 adds an `FbStatesGrid` to the FB Library detail view (EM templates only) that declares those states into `interface_contract.states` via the existing save hook. Coverage (`checkStateCoverage`) already reads that field — no compiler change.

**Tech Stack:** TypeScript 5.9 (strict, `import type`, no enums), React 19, Vitest + Testing Library, existing `@/lib/spec-builder` + `@/components/fb-library` patterns.

**Spec:** `Docs/superpowers/specs/2026-07-01-packml-em-state-foundation-design.md`

**Non-goals (fenced):** Stage A/B reframe (SP-3), codegen alignment (SP-4), random-builder `estop`→`aborted` reconciliation, splitting the `reviewed` flag. Verification is deliberately vacuous until SP-3 (real specs still emit free slugs); this slice makes the FB side PackML-correct.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/spec-builder/packml-states.ts` | **New.** Canonical PackML 17-state data + slug/id lookups + `defaultFbStates()`. Pure, no deps beyond the `FbInterfaceState` shape. | 1 |
| `src/lib/spec-builder/__tests__/packml-states.test.ts` | **New.** Unit tests for the module. | 1 |
| `src/components/fb-library/fb-states-grid.tsx` | **New.** EM-only states-declaration grid; self-guards on `is_equipment_module`; saves merged contract via `useSaveFbInterface`. | 2 |
| `src/components/fb-library/__tests__/fb-states-grid.test.tsx` | **New.** Component tests (mock the save hook). | 2 |
| `src/routes/fb-library.tsx` | **Modify.** Render `<FbStatesGrid>` after `<FbInterfaceGrid>` in the template detail view; add import. | 3 |
| `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts` | **Modify.** Regression locking the SP-1 ↔ coverage contract. | 3 |

---

### Task 1: Canonical PackML state module (SP-1)

**Goal:** A pure module exposing the fixed PackML 17-state vocabulary, lookups, and the EM-FB default-states helper.

**Files:**
- Create: `src/lib/spec-builder/packml-states.ts`
- Test: `src/lib/spec-builder/__tests__/packml-states.test.ts`

**Acceptance Criteria:**
- [ ] `PACKML_STATES` has 17 entries, unique `packml_id` 1..17, unique lowercase `slug`, exactly one `is_safe` (`aborted`, id 9).
- [ ] PackML naming: `execute` present, `running`/`pausing`/`paused` absent.
- [ ] `packmlStateBySlug` is trim/case-insensitive; `isPackmlSlug` rejects free slugs (`driving_fwd`, `estop`).
- [ ] `defaultFbStates()` returns all 17 as `FbInterfaceState` with exactly one safe.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts` → all pass. Then `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/packml-states.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PACKML_STATES,
  PACKML_STATE_SLUGS,
  packmlStateBySlug,
  packmlStateById,
  isPackmlSlug,
  defaultFbStates,
} from "@/lib/spec-builder/packml-states";

describe("PACKML_STATES", () => {
  it("has 17 states with unique 1..17 ids and unique slugs", () => {
    expect(PACKML_STATES).toHaveLength(17);
    const ids = PACKML_STATES.map((s) => s.packml_id);
    expect(new Set(ids).size).toBe(17);
    expect(Math.min(...ids)).toBe(1);
    expect(Math.max(...ids)).toBe(17);
    expect(new Set(PACKML_STATES.map((s) => s.slug)).size).toBe(17);
  });

  it("marks exactly one safe state — aborted (id 9)", () => {
    const safe = PACKML_STATES.filter((s) => s.is_safe);
    expect(safe).toHaveLength(1);
    expect(safe[0].slug).toBe("aborted");
    expect(safe[0].packml_id).toBe(9);
  });

  it("uses PackML naming: execute present; running/pausing/paused absent", () => {
    expect(PACKML_STATE_SLUGS.has("execute")).toBe(true);
    expect(PACKML_STATE_SLUGS.has("running")).toBe(false);
    expect(PACKML_STATE_SLUGS.has("pausing")).toBe(false);
    expect(PACKML_STATE_SLUGS.has("paused")).toBe(false);
  });

  it("covers the pragmatic random-builder slugs, except non-canonical estop", () => {
    for (const slug of ["idle", "starting", "execute", "stopping", "complete"]) {
      expect(isPackmlSlug(slug)).toBe(true);
    }
    expect(isPackmlSlug("estop")).toBe(false);
  });
});

describe("lookups", () => {
  it("packmlStateBySlug is trim/case-insensitive", () => {
    expect(packmlStateBySlug("  EXECUTE ")?.packml_id).toBe(6);
    expect(packmlStateBySlug("nope")).toBeUndefined();
  });

  it("packmlStateById resolves by number", () => {
    expect(packmlStateById(9)?.slug).toBe("aborted");
    expect(packmlStateById(99)).toBeUndefined();
  });

  it("isPackmlSlug rejects free EM slugs", () => {
    expect(isPackmlSlug("driving_fwd")).toBe(false);
  });
});

describe("defaultFbStates", () => {
  it("returns all 17 as FbInterfaceState with exactly one safe", () => {
    const states = defaultFbStates();
    expect(states).toHaveLength(17);
    expect(states.filter((s) => s.is_safe)).toHaveLength(1);
    expect(states.find((s) => s.is_safe)?.slug).toBe("aborted");
    expect(states.every((s) => typeof s.slug === "string" && typeof s.name === "string")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts`
Expected: FAIL — cannot resolve module `@/lib/spec-builder/packml-states`.

- [ ] **Step 3: Write the module**

Create `src/lib/spec-builder/packml-states.ts`:

```ts
// src/lib/spec-builder/packml-states.ts
// Canonical PackML state model — the fixed vocabulary every Equipment Module FB
// implements. This is the PackML "Base State Model" (ISA-TR88.00.02), which
// ISA-88 Part 1 Annex D.1 defines as a sanctioned COLLAPSE of its full Reference
// Procedural State Model. PackML renames Annex D's RUNNING -> EXECUTE and omits
// PAUSING/PAUSED. IDs are the OMAC/PLCopen packml_id (1..17). Recovered from the
// project's deleted migrate/packml-canonical.ts (git a9942fb). Generic across all
// machine types — never device-specific. Pure: no React/IO.
import type { FbInterfaceState } from "@/types/fb-interface";

export type PackmlStatePattern = "static" | "sequential";

export interface PackmlState {
  /** OMAC/PLCopen state number, 1..17. */
  packml_id: number;
  /** Lowercase canonical id — matches EmStateV2.state_id and FbInterfaceState.slug. */
  slug: string;
  /** Canonical display name. */
  name: string;
  /** static = waiting state; sequential = acting state. */
  state_pattern: PackmlStatePattern;
  /** The single safe / fault-landing state (Aborted). Exactly one is true. */
  is_safe: boolean;
}

export const PACKML_STATES: readonly PackmlState[] = [
  { packml_id: 1,  slug: "clearing",     name: "Clearing",     state_pattern: "sequential", is_safe: false },
  { packml_id: 2,  slug: "stopped",      name: "Stopped",      state_pattern: "static",     is_safe: false },
  { packml_id: 3,  slug: "starting",     name: "Starting",     state_pattern: "sequential", is_safe: false },
  { packml_id: 4,  slug: "idle",         name: "Idle",         state_pattern: "static",     is_safe: false },
  { packml_id: 5,  slug: "suspended",    name: "Suspended",    state_pattern: "static",     is_safe: false },
  { packml_id: 6,  slug: "execute",      name: "Execute",      state_pattern: "sequential", is_safe: false },
  { packml_id: 7,  slug: "stopping",     name: "Stopping",     state_pattern: "sequential", is_safe: false },
  { packml_id: 8,  slug: "aborting",     name: "Aborting",     state_pattern: "sequential", is_safe: false },
  { packml_id: 9,  slug: "aborted",      name: "Aborted",      state_pattern: "static",     is_safe: true  },
  { packml_id: 10, slug: "holding",      name: "Holding",      state_pattern: "sequential", is_safe: false },
  { packml_id: 11, slug: "held",         name: "Held",         state_pattern: "static",     is_safe: false },
  { packml_id: 12, slug: "unholding",    name: "Unholding",    state_pattern: "sequential", is_safe: false },
  { packml_id: 13, slug: "suspending",   name: "Suspending",   state_pattern: "sequential", is_safe: false },
  { packml_id: 14, slug: "unsuspending", name: "Unsuspending", state_pattern: "sequential", is_safe: false },
  { packml_id: 15, slug: "resetting",    name: "Resetting",    state_pattern: "sequential", is_safe: false },
  { packml_id: 16, slug: "completing",   name: "Completing",   state_pattern: "sequential", is_safe: false },
  { packml_id: 17, slug: "complete",     name: "Complete",     state_pattern: "static",     is_safe: false },
] as const;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export const PACKML_STATE_SLUGS: ReadonlySet<string> = new Set(PACKML_STATES.map((s) => s.slug));

const BY_SLUG = new Map<string, PackmlState>(PACKML_STATES.map((s) => [s.slug, s]));
const BY_ID = new Map<number, PackmlState>(PACKML_STATES.map((s) => [s.packml_id, s]));

export function packmlStateBySlug(slug: string): PackmlState | undefined {
  return BY_SLUG.get(norm(slug));
}

export function packmlStateById(id: number): PackmlState | undefined {
  return BY_ID.get(id);
}

export function isPackmlSlug(slug: string): boolean {
  return PACKML_STATE_SLUGS.has(norm(slug));
}

/** The full canonical set an EM FB declares by default, as FbInterfaceState. */
export function defaultFbStates(): FbInterfaceState[] {
  return PACKML_STATES.map((s) => ({ slug: s.slug, name: s.name, is_safe: s.is_safe }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts`
Expected: PASS (all 8 tests). Then `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/packml-states.ts src/lib/spec-builder/__tests__/packml-states.test.ts
git commit -m "feat(spec-builder): canonical PackML 17-state model (SP-1)"
```

---

### Task 2: FbStatesGrid component (SP-2)

**Goal:** An EM-only grid that declares which PackML states an FB implements + marks the safe state, saving a merged `interface_contract` via the existing hook.

**Files:**
- Create: `src/components/fb-library/fb-states-grid.tsx`
- Test: `src/components/fb-library/__tests__/fb-states-grid.test.tsx`

**Acceptance Criteria:**
- [ ] EM template with no contract → 17 rows, all "implemented" checked, `aborted` safe, "needs review" badge.
- [ ] Non-EM template → renders nothing.
- [ ] Unticking a state and saving calls `useSaveFbInterface` with `states` excluding it and pins preserved; `reviewed: true`.
- [ ] Changing the safe marker yields exactly one `is_safe: true` in the saved contract.

**Verify:** `npx vitest run src/components/fb-library/__tests__/fb-states-grid.test.tsx` → all pass. Then `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/components/fb-library/__tests__/fb-states-grid.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultFbStates } from "@/lib/spec-builder/packml-states";
import type { FbTemplate } from "@/types/fb-template";

const mutate = vi.fn();
vi.mock("@/hooks/use-save-fb-interface", () => ({
  useSaveFbInterface: () => ({ mutate, isPending: false }),
}));

// Imported after the mock so the component picks up the mocked hook.
import { FbStatesGrid } from "../fb-states-grid";

function emTemplate(overrides: Partial<FbTemplate> = {}): FbTemplate {
  return {
    id: "t1", name: "EM_CarriageDrive", device_category: "cat", plc_brand: "SIEMENS_TIA",
    description: null, ai_summary: null, diagram_chart: null, diagram_generated_at: null,
    flow_diagram_json: null, flow_diagram_generated_at: null, version: 1, tags: [],
    source: "custom", library_name: null, is_enabled: true, is_equipment_module: true,
    documentation: null, hmi_faceplate_type: null, interface_contract: null,
    created_by: null, updated_at: "", created_at: "",
    blocks: [{
      id: "b1", template_id: "t1", block_name: "EM_CarriageDrive", block_type: "FB",
      scl_code: 'FUNCTION_BLOCK "EM_CarriageDrive"\nVAR_INPUT\n iStart : Bool;\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK',
      block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "",
    }],
    ...overrides,
  };
}

beforeEach(() => mutate.mockClear());

describe("FbStatesGrid", () => {
  it("declares all 17 PackML states, aborted safe, needs-review when no contract", () => {
    render(<FbStatesGrid template={emTemplate()} />);
    const impl = screen.getAllByTestId(/^impl-/);
    expect(impl).toHaveLength(17);
    expect(impl.every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText(/needs review/i)).toBeInTheDocument();
    expect((screen.getByTestId("safe-aborted") as HTMLInputElement).checked).toBe(true);
  });

  it("renders nothing for a non-equipment-module template", () => {
    const { container } = render(<FbStatesGrid template={emTemplate({ is_equipment_module: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("save excludes an unticked state and preserves pins", () => {
    const template = emTemplate({
      interface_contract: {
        block_name: "EM_CarriageDrive",
        pins: [{ name: "iStart", scl_type: "Bool", direction: "input", role: "cmd", default_binding: "hmi", exposed: false, description: "" }],
        states: defaultFbStates(),
        reviewed: false,
        generated_at: "2026-01-01T00:00:00Z",
      },
    });
    render(<FbStatesGrid template={template} />);
    fireEvent.click(screen.getByTestId("impl-held"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const arg = mutate.mock.calls[0][0];
    expect(arg.templateId).toBe("t1");
    expect(arg.contract.states).toHaveLength(16);
    expect(arg.contract.states.map((s: { slug: string }) => s.slug)).not.toContain("held");
    expect(arg.contract.pins).toHaveLength(1);
    expect(arg.contract.pins[0].name).toBe("iStart");
    expect(arg.contract.reviewed).toBe(true);
  });

  it("marks exactly one state safe when the safe marker changes", () => {
    render(<FbStatesGrid template={emTemplate()} />);
    fireEvent.click(screen.getByTestId("safe-stopped"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const arg = mutate.mock.calls[0][0];
    const safe = arg.contract.states.filter((s: { is_safe?: boolean }) => s.is_safe);
    expect(safe).toHaveLength(1);
    expect(safe[0].slug).toBe("stopped");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fb-library/__tests__/fb-states-grid.test.tsx`
Expected: FAIL — cannot resolve `../fb-states-grid`.

- [ ] **Step 3: Write the component**

Create `src/components/fb-library/fb-states-grid.tsx`:

```tsx
// src/components/fb-library/fb-states-grid.tsx
// EM-only PackML state declaration grid. Every EM FB implements the fixed PackML
// state set (SP-1); this grid declares which states this FB implements + the safe
// state, into interface_contract.states. Mirrors fb-interface-grid.tsx (seed →
// edit → Save sets reviewed:true). Consumed by C5's checkStateCoverage.
import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PACKML_STATES, defaultFbStates } from "@/lib/spec-builder/packml-states";
import { parseFbInterface, interfacePins } from "@/lib/spec-builder/fb-interface";
import type { FbInterfaceContract, FbInterfacePin, FbInterfaceState } from "@/types/fb-interface";
import { useSaveFbInterface } from "@/hooks/use-save-fb-interface";
import type { FbTemplate } from "@/types/fb-template";

function mainBlock(t: FbTemplate) {
  return t.blocks?.find((b) => b.block_type === "FB") ?? t.blocks?.[0];
}

/** Seed pins from SCL so saving states before pins are authored preserves a pins layer. */
function seedPins(t: FbTemplate): FbInterfacePin[] {
  const block = mainBlock(t);
  if (!block?.scl_code) return [];
  return interfacePins(parseFbInterface(block.scl_code)).map((p) => ({
    name: p.name, scl_type: p.scl_type, direction: p.direction,
    role: (p.direction === "output" ? "status" : "sensor_in") as FbInterfacePin["role"],
    default_binding: (p.direction === "output" ? "io_output" : "io_input") as FbInterfacePin["default_binding"],
    exposed: false, description: p.description,
  }));
}

function initDeclared(c: FbInterfaceContract | null | undefined): Set<string> {
  const states = c?.states?.length ? c.states : defaultFbStates();
  return new Set(states.map((s) => s.slug));
}
function initSafe(c: FbInterfaceContract | null | undefined): string {
  const states = c?.states?.length ? c.states : defaultFbStates();
  return states.find((s) => s.is_safe)?.slug ?? "aborted";
}

export function FbStatesGrid({ template }: { template: FbTemplate }) {
  const save = useSaveFbInterface();
  const existing = template.interface_contract;
  const [declared, setDeclared] = useState<Set<string>>(() => initDeclared(existing));
  const [safeSlug, setSafeSlug] = useState<string>(() => initSafe(existing));

  // Re-seed when the persisted contract's states change (after Save invalidation).
  const persistedKey = JSON.stringify(existing?.states ?? null);
  useEffect(() => {
    setDeclared(initDeclared(existing));
    setSafeSlug(initSafe(existing));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey]);

  // The safe marker must always land on a declared state.
  const effectiveSafe = useMemo(() => {
    if (declared.has(safeSlug)) return safeSlug;
    return PACKML_STATES.find((s) => declared.has(s.slug))?.slug ?? "";
  }, [declared, safeSlug]);

  if (!template.is_equipment_module) return null;

  const reviewed = existing?.reviewed ?? false;

  function toggleDeclared(slug: string) {
    setDeclared((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function handleSave() {
    const states: FbInterfaceState[] = PACKML_STATES
      .filter((s) => declared.has(s.slug))
      .map((s) => ({ slug: s.slug, name: s.name, is_safe: s.slug === effectiveSafe }));
    const contract: FbInterfaceContract = {
      block_name: existing?.block_name ?? mainBlock(template)?.block_name ?? template.name,
      pins: existing?.pins ?? seedPins(template),
      states,
      reviewed: true,
      generated_at: existing?.generated_at ?? new Date().toISOString(),
    };
    save.mutate({ templateId: template.id, contract });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase text-muted-foreground">PackML States</span>
          {!reviewed && <Badge variant="outline" className="text-amber-600 border-amber-400/50">Needs review</Badge>}
        </div>
        <Button size="sm" variant="ghost" onClick={handleSave} disabled={save.isPending}>
          <Save className="h-3.5 w-3.5" /><span className="ml-1">Save</span>
        </Button>
      </div>

      <div className="rounded border border-border/40 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/30 bg-muted/30">
              {["Impl", "#", "State", "Kind", "Safe"].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PACKML_STATES.map((s) => {
              const isDeclared = declared.has(s.slug);
              return (
                <tr key={s.slug} className="border-b border-border/10 hover:bg-muted/20">
                  <td className="px-2 py-0.5">
                    <input type="checkbox" data-testid={`impl-${s.slug}`}
                      checked={isDeclared} onChange={() => toggleDeclared(s.slug)} />
                  </td>
                  <td className="px-2 py-0.5 font-mono text-muted-foreground">{s.packml_id}</td>
                  <td className="px-2 py-0.5 font-mono text-foreground">{s.name}</td>
                  <td className="px-2 py-0.5 font-mono text-muted-foreground">{s.state_pattern}</td>
                  <td className="px-2 py-0.5">
                    <input type="radio" name="fb-safe-state" data-testid={`safe-${s.slug}`}
                      disabled={!isDeclared}
                      checked={effectiveSafe === s.slug}
                      onChange={() => setSafeSlug(s.slug)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fb-library/__tests__/fb-states-grid.test.tsx`
Expected: PASS (4 tests). Then `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/fb-library/fb-states-grid.tsx src/components/fb-library/__tests__/fb-states-grid.test.tsx
git commit -m "feat(fb-library): EM PackML states declaration grid (SP-2)"
```

---

### Task 3: Wire grid into FB Library + coverage regression

**Goal:** Render the states grid in the template detail view and lock the SP-1 ↔ `checkStateCoverage` contract with a regression test.

**Files:**
- Modify: `src/routes/fb-library.tsx` (import + render after `<FbInterfaceGrid>` near line 1436)
- Modify: `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`

**Acceptance Criteria:**
- [ ] `<FbStatesGrid template={template} />` renders directly after `<FbInterfaceGrid>` in the detail view (self-guards on EM, so it renders unconditionally).
- [ ] Coverage test proves `defaultFbStates()` covers an FDS EM whose states are PackML slugs, and reports a non-PackML slug (`driving_fwd`) as missing.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts` → pass. Then `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Add the coverage regression test (failing import)**

At the top of `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`, ensure these imports exist (add the `defaultFbStates` import if absent — check existing imports of `checkStateCoverage` and `EmStateV2` first and reuse them):

```ts
import { defaultFbStates } from "@/lib/spec-builder/packml-states";
```

Append this describe block to the file:

```ts
describe("checkStateCoverage against the default PackML FB state set", () => {
  it("verifies an FDS EM whose states are PackML slugs", () => {
    const fds: EmStateV2[] = [
      { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
      { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const res = checkStateCoverage(fds, defaultFbStates());
    expect(res.ok).toBe(true);
    expect(res.missing).toHaveLength(0);
  });

  it("reports a non-PackML FDS slug as missing", () => {
    const fds: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Forward", kind: "static", allowed_modes: [], is_safe_state: false },
    ];
    const res = checkStateCoverage(fds, defaultFbStates());
    expect(res.ok).toBe(false);
    expect(res.missing.map((s) => s.state_id)).toContain("driving_fwd");
  });
});
```

> Note: `EmStateV2`, `checkStateCoverage`, `describe`/`it`/`expect` are already imported by the existing file. If `EmStateV2` is NOT already imported, add `import type { EmStateV2 } from "@/types/spec-contract-v2";` and `import { checkStateCoverage } from "../em-state-coverage";`.

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 3: Wire the grid into the route**

In `src/routes/fb-library.tsx`, add the import beside the existing `FbInterfaceGrid` import (near line 83):

```tsx
import { FbStatesGrid } from "@/components/fb-library/fb-states-grid";
```

Then render it immediately after the `<FbInterfaceGrid>` call (near line 1436). The component self-guards on `is_equipment_module`, so render it unconditionally:

```tsx
          {/* Variable table — parsed from SCL interface */}
          <FbInterfaceGrid template={template} />

          {/* PackML state declaration — EM templates only (component self-guards) */}
          <FbStatesGrid template={template} />
```

- [ ] **Step 4: Verify build + full slice suites**

Run:
```bash
npx tsc -b
npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts src/components/fb-library src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts
```
Expected: `tsc -b` clean; all listed suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/fb-library.tsx src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts
git commit -m "feat(fb-library): wire PackML states grid + coverage regression (SP-2)"
```

---

## Self-Review

**Spec coverage:**
- SP-1 canonical module → Task 1. ✓
- SP-1 helpers (`PACKML_STATES`, slug/id lookups, `defaultFbStates`) → Task 1. ✓
- SP-2 `FbStatesGrid` (EM-only, default-all, safe marker, merge-save, no AI) → Task 2. ✓
- SP-2 wire into `fb-library.tsx` → Task 3. ✓
- SP-2 coverage-needs-no-compiler-change, locked by regression → Task 3. ✓
- Non-goals (SP-3/SP-4, estop reconciliation, reviewed split) → not implemented, by design. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; test bodies concrete. ✓

**Type consistency:** `FbInterfaceState` = `{ slug, name, is_safe? }` used consistently in SP-1 output, component save, and tests. `FbInterfaceContract` fields (`block_name, pins, states, reviewed, generated_at`) match `src/types/fb-interface.ts`. `checkStateCoverage(fdsStates, declared)` signature matches `em-state-coverage.ts`. `useSaveFbInterface().mutate({ templateId, contract })` matches the hook. ✓

**Known caveat carried from spec:** verification is vacuous until SP-3 (free FDS slugs); the coverage regression deliberately asserts both the passing PackML case and the failing `driving_fwd` case to document it.
