# Code Builder C2 — EM-Layer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface C1's EM-layer artifacts in the Code Builder UI — a clickable layer switch, EMs grouped by Unit, a dedicated state-machine diagram, and a layer-aware artifact viewer.

**Architecture:** C1 already compiles the 5-artifact EM bundle (EM FB + State UDT + CMD DB + MAP FC + instance DB, all `layer: "em"`) plus per-Unit `UC_` stubs. C2 is UI-only: it does NOT change codegen. Two facts the EM-layer UI needs live in the **contract**, not the generated artifacts — (1) which Unit owns each EM, and (2) the EM's states/transitions for the diagram. A single pure derivation (`buildEmUiModel`) extracts both from the confirmed `SpecContractV2`, and the Code Builder hook exposes it alongside the existing artifact query. The artifact filter becomes layer-parameterised so switching the stepper compiles + persists the active layer.

**Tech Stack:** React 19, TypeScript 5.9 (strict, `verbatimModuleSyntax`, no enums), TanStack Query, Vitest + Testing Library (jsdom), deterministic inline SVG (no new deps).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/lib/spec-builder/code-builder-em-ui-model.ts` | Pure: derive Unit→EM groups + per-EM state/transition info from the contract | Create |
| `src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts` | Tests for the derivation | Create |
| `src/components/code-builder/em-state-diagram.tsx` | Deterministic SVG state-machine renderer + transition-label formatter | Create |
| `src/components/code-builder/__tests__/em-state-diagram.test.tsx` | Tests for the diagram + formatter | Create |
| `src/components/code-builder/builder-stepper.tsx` | Clickable layer switch; enable the EM step | Modify |
| `src/components/code-builder/__tests__/builder-stepper.test.tsx` | Tests for click/disabled behaviour | Create |
| `src/hooks/use-code-builder.ts` | Layer-parameterised compile/persist + expose the EM UI model | Modify |
| `src/components/code-builder/control-module-list.tsx` | `layer` prop; EM rows grouped under collapsible Unit headers | Modify |
| `src/components/code-builder/__tests__/control-module-list.test.tsx` | Tests for device + EM/Unit-grouping paths | Create |
| `src/components/code-builder/artifact-viewer.tsx` | Layer-conditional tabs: EM → Code · State · Map · UDT · Inst DB | Modify |
| `src/components/code-builder/__tests__/artifact-viewer.test.tsx` | Tests for EM vs device tab sets | Create |
| `src/routes/code-builder.tsx` | `activeLayer` state; wire stepper/list/viewer/hook | Modify |
| `src/routes/__tests__/code-builder.test.tsx` | Extend: layer switch renders EM rows | Modify |

**Out of scope (deferred):** real Unit coordinator logic (Sub-Project D), Export tab (F), editing the state machine from the diagram, parallel/branching SFC, surfacing the CMD DB as its own tab.

---

### Task 1: EM UI model derivation

**Goal:** A pure function that turns a confirmed `SpecContractV2` into the Unit→EM grouping and per-EM state/transition info the EM-layer UI needs.

**Files:**
- Create: `src/lib/spec-builder/code-builder-em-ui-model.ts`
- Test: `src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts`

**Acceptance Criteria:**
- [ ] `buildEmUiModel(contract)` returns `unitGroups` (one per non-excluded Unit, EM ids in declared order) and `emById` (every EM mapped to its name + states + transitions).
- [ ] Excluded units are skipped.
- [ ] An EM with no contract entry yields empty `states`/`transitions` arrays (never throws).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts
import { describe, it, expect } from "vitest";
import { buildEmUiModel } from "@/lib/spec-builder/code-builder-em-ui-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

function fixture(): SpecContractV2 {
  return {
    hierarchy: {
      units: [
        {
          unit_id: "u1", unit_name: "Carriage Unit", excluded: false,
          equipment_modules: [
            { equipment_module_id: "em1", equipment_module_name: "Carriage", control_modules: [] },
            { equipment_module_id: "em2", equipment_module_name: "Clamp", control_modules: [] },
          ],
        },
        {
          unit_id: "u2", unit_name: "Excluded Unit", excluded: true,
          equipment_modules: [
            { equipment_module_id: "em3", equipment_module_name: "Ghost", control_modules: [] },
          ],
        },
      ],
    },
    equipment_modules: {
      em1: {
        equipment_module_id: "em1", unit_id: "u1",
        states: [
          { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
          { state_id: "active", name: "Active", kind: "static", allowed_modes: [], is_safe_state: false },
        ],
        transitions: [
          {
            transition_id: "t1", from_state_id: "idle", to_state_id: "active",
            trigger: { kind: "command", expr: { tag: "start_cmd", operator: "=", value: true } },
            guard: [{ tag: "enable", operator: "=", value: true }],
          },
        ],
        static_states: {}, sequential_states: {},
      },
      // em2 intentionally absent → must yield empty arrays
    },
  } as unknown as SpecContractV2;
}

describe("buildEmUiModel", () => {
  it("groups EMs by their non-excluded Unit in declared order", () => {
    const m = buildEmUiModel(fixture());
    expect(m.unitGroups).toHaveLength(1);
    expect(m.unitGroups[0]).toMatchObject({ unitId: "u1", unitName: "Carriage Unit", emIds: ["em1", "em2"] });
  });

  it("maps every EM to its state machine, empty when no contract entry", () => {
    const m = buildEmUiModel(fixture());
    expect(m.emById.em1.emName).toBe("Carriage");
    expect(m.emById.em1.states).toHaveLength(2);
    expect(m.emById.em1.transitions).toHaveLength(1);
    expect(m.emById.em2.states).toEqual([]);
    expect(m.emById.em2.transitions).toEqual([]);
  });

  it("skips excluded units and their EMs", () => {
    const m = buildEmUiModel(fixture());
    expect(m.emById.em3).toBeUndefined();
    expect(m.unitGroups.find((g) => g.unitId === "u2")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts`
Expected: FAIL — `buildEmUiModel` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/spec-builder/code-builder-em-ui-model.ts
import type {
  SpecContractV2, EmStateV2, EmTransitionV2,
} from "@/types/spec-contract-v2";

/** The EMs under one Unit, for the EM-layer list grouping. */
export interface CodeBuilderUnitGroup {
  unitId: string;
  unitName: string;
  emIds: string[];
}

/** State-machine data for one EM, for the State Diagram tab. */
export interface CodeBuilderEmInfo {
  emId: string;
  emName: string;
  states: EmStateV2[];
  transitions: EmTransitionV2[];
}

/** Everything the EM-layer UI needs that lives in the contract rather than the
 *  generated artifacts: which Unit owns each EM, and each EM's state machine.
 *  Pure, deterministic, generic across machine types. */
export interface CodeBuilderEmUiModel {
  unitGroups: CodeBuilderUnitGroup[];
  emById: Record<string, CodeBuilderEmInfo>;
}

export function buildEmUiModel(contract: SpecContractV2): CodeBuilderEmUiModel {
  const unitGroups: CodeBuilderUnitGroup[] = [];
  const emById: Record<string, CodeBuilderEmInfo> = {};

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    const emIds: string[] = [];
    for (const em of unit.equipment_modules) {
      emIds.push(em.equipment_module_id);
      const c = contract.equipment_modules[em.equipment_module_id];
      emById[em.equipment_module_id] = {
        emId: em.equipment_module_id,
        emName: em.equipment_module_name,
        states: c?.states ?? [],
        transitions: c?.transitions ?? [],
      };
    }
    unitGroups.push({ unitId: unit.unit_id, unitName: unit.unit_name, emIds });
  }

  return { unitGroups, emById };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/code-builder-em-ui-model.ts src/lib/spec-builder/__tests__/code-builder-em-ui-model.test.ts
git commit -m "feat(code-builder): derive EM UI model (unit groups + state machines) from contract (C2 Task 1)"
```

---

### Task 2: EM State Diagram component

**Goal:** A dedicated, deterministic SVG that renders an EM state machine — states as stacked boxes (safe state highlighted), guarded transitions as labeled arrows — plus the pure transition-label formatter it uses.

**Files:**
- Create: `src/components/code-builder/em-state-diagram.tsx`
- Test: `src/components/code-builder/__tests__/em-state-diagram.test.tsx`

**Acceptance Criteria:**
- [ ] `formatTransition(t)` renders `command` triggers as `tag op VALUE`, `completion` triggers as `done`, AND-joins guards, and yields `""` for an unconditional transition.
- [ ] `<EmStateDiagram>` renders one labelled node per state (canonical order, safe state visually flagged) and one labelled edge per transition.
- [ ] Empty `states` renders a graceful "No state machine" placeholder (no crash).

**Verify:** `npx vitest run src/components/code-builder/__tests__/em-state-diagram.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/code-builder/__tests__/em-state-diagram.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmStateDiagram, formatTransition } from "@/components/code-builder/em-state-diagram";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

const states: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: "active", name: "Active", kind: "static", allowed_modes: [], is_safe_state: false },
];
const transitions: EmTransitionV2[] = [
  {
    transition_id: "t1", from_state_id: "idle", to_state_id: "active",
    trigger: { kind: "command", expr: { tag: "start_cmd", operator: "=", value: true } },
    guard: [{ tag: "enable", operator: "=", value: true }],
  },
  {
    transition_id: "t2", from_state_id: "active", to_state_id: "idle",
    trigger: { kind: "completion" }, guard: [],
  },
];

describe("formatTransition", () => {
  it("formats a command trigger with AND-joined guards", () => {
    expect(formatTransition(transitions[0])).toBe("start_cmd = TRUE AND enable = TRUE");
  });
  it("formats a completion trigger with no guard", () => {
    expect(formatTransition(transitions[1])).toBe("done");
  });
});

describe("EmStateDiagram", () => {
  it("renders a node per state and an edge label per transition", () => {
    render(<EmStateDiagram states={states} transitions={transitions} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("start_cmd = TRUE AND enable = TRUE")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("renders a placeholder when there are no states", () => {
    render(<EmStateDiagram states={[]} transitions={[]} />);
    expect(screen.getByText(/no state machine/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/em-state-diagram.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/code-builder/em-state-diagram.tsx
import type {
  EmStateV2, EmTransitionV2, PermissiveCondition, PermissiveValue,
} from "@/types/spec-contract-v2";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";

// --- label formatting (pure, exported for tests) ---------------------------

function formatValue(v: PermissiveValue): string {
  if (v === true) return "TRUE";
  if (v === false) return "FALSE";
  return String(v); // numbers, "P_TRIG", "N_TRIG"
}

function formatCondition(c: PermissiveCondition): string {
  return `${c.tag} ${c.operator} ${formatValue(c.value)}`;
}

/** Machine-boolean label for a transition: trigger first, then AND-ed guards.
 *  Empty string when fully unconditional. Generic — no device names. */
export function formatTransition(t: EmTransitionV2): string {
  const parts: string[] = [];
  if (t.trigger.kind === "command") parts.push(formatCondition(t.trigger.expr));
  else parts.push("done"); // completion
  for (const g of t.guard) parts.push(formatCondition(g));
  return parts.join(" AND ");
}

// --- layout constants ------------------------------------------------------

const BOX_W = 200;
const BOX_H = 46;
const V_GAP = 54;          // vertical gap between stacked state boxes
const PAD = 16;
const GUTTER_STEP = 26;    // horizontal stagger per transition in the right gutter
const LABEL_MAX = 40;

const SAFE = { fill: "#dcfce7", stroke: "#16a34a", text: "#166534" };
const NORMAL = { fill: "#eef2ff", stroke: "#3050A0", text: "#1e293b" };
const EDGE = "#64748b";

function truncate(s: string): string {
  return s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1) + "…" : s;
}

export function EmStateDiagram({
  states, transitions,
}: {
  states: EmStateV2[];
  transitions: EmTransitionV2[];
}) {
  if (states.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="font-mono text-xs text-muted-foreground/60">No state machine</span>
      </div>
    );
  }

  const ordered = orderStates(states, transitions);
  const indexOf = new Map(ordered.map((s, i) => [s.state_id, i]));
  const boxX = PAD;
  const yOf = (i: number) => PAD + i * (BOX_H + V_GAP);
  const midY = (i: number) => yOf(i) + BOX_H / 2;

  const gutterX = boxX + BOX_W + 8;
  const maxGutter = gutterX + (transitions.length + 1) * GUTTER_STEP;
  const totalW = Math.max(maxGutter + 8, boxX + BOX_W + 40);
  const totalH = yOf(ordered.length - 1) + BOX_H + PAD;

  return (
    <div className="h-full overflow-auto p-2" data-testid="em-state-diagram">
      <svg viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} style={{ maxWidth: "100%" }}>
        <defs>
          <marker id="em-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={EDGE} />
          </marker>
        </defs>

        {/* transitions first so boxes sit on top */}
        {transitions.map((t, i) => {
          const fi = indexOf.get(t.from_state_id);
          const ti = indexOf.get(t.to_state_id);
          if (fi === undefined || ti === undefined) return null;
          const gx = gutterX + i * GUTTER_STEP;
          const y1 = midY(fi);
          const y2 = midY(ti);
          const startX = boxX + BOX_W;
          const d = `M${startX} ${y1} L${gx} ${y1} L${gx} ${y2} L${startX} ${y2}`;
          const label = truncate(formatTransition(t));
          return (
            <g key={t.transition_id}>
              <path d={d} fill="none" stroke={EDGE} strokeWidth="1.5" markerEnd="url(#em-arrow)" />
              {label && (
                <text
                  x={gx + 4} y={(y1 + y2) / 2}
                  fontSize="9" fontFamily="JetBrains Mono, Consolas, monospace"
                  fill={EDGE} dominantBaseline="central"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* state boxes */}
        {ordered.map((s, i) => {
          const c = s.is_safe_state ? SAFE : NORMAL;
          const y = yOf(i);
          return (
            <g key={s.state_id}>
              <rect
                x={boxX} y={y} width={BOX_W} height={BOX_H} rx={8}
                fill={c.fill} stroke={c.stroke} strokeWidth="1.5"
              />
              <text
                x={boxX + BOX_W / 2} y={y + BOX_H / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize="12" fontFamily="Inter, sans-serif" fontWeight={600} fill={c.text}
              >
                {s.name}{s.is_safe_state ? "  (safe)" : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/em-state-diagram.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/em-state-diagram.tsx src/components/code-builder/__tests__/em-state-diagram.test.tsx
git commit -m "feat(code-builder): EM state-machine SVG diagram + transition formatter (C2 Task 2)"
```

---

### Task 3: Clickable BuilderStepper with EM enabled

**Goal:** Make the stepper steps clickable via an `onSelect` callback and enable the `EM` step (keep `Unit`/`Export` disabled for Sub-Projects D/F).

**Files:**
- Modify: `src/components/code-builder/builder-stepper.tsx`
- Test: `src/components/code-builder/__tests__/builder-stepper.test.tsx`

**Acceptance Criteria:**
- [ ] `Device` and `EM` steps are enabled; `Unit` and `Export` remain disabled.
- [ ] Clicking an enabled step calls `onSelect` with its id; clicking a disabled step does not.
- [ ] Each step exposes `data-testid="step-<id>"`.

**Verify:** `npx vitest run src/components/code-builder/__tests__/builder-stepper.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/code-builder/__tests__/builder-stepper.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuilderStepper } from "@/components/code-builder/builder-stepper";

describe("BuilderStepper", () => {
  it("enables Device and EM, disables Unit and Export", () => {
    render(<BuilderStepper active="device" />);
    expect(screen.getByTestId("step-device")).not.toBeDisabled();
    expect(screen.getByTestId("step-em")).not.toBeDisabled();
    expect(screen.getByTestId("step-unit")).toBeDisabled();
    expect(screen.getByTestId("step-export")).toBeDisabled();
  });

  it("calls onSelect for enabled steps only", () => {
    const onSelect = vi.fn();
    render(<BuilderStepper active="device" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("step-em"));
    expect(onSelect).toHaveBeenCalledWith("em");
    fireEvent.click(screen.getByTestId("step-unit"));
    expect(onSelect).toHaveBeenCalledTimes(1); // disabled click ignored
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/builder-stepper.test.tsx`
Expected: FAIL — `step-em` is currently disabled / no `onSelect`.

- [ ] **Step 3: Edit the component**

Replace the entire body of `src/components/code-builder/builder-stepper.tsx` with:

```tsx
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type BuilderStep = "device" | "em" | "unit" | "export";

const STEPS: { id: BuilderStep; label: string; enabled: boolean }[] = [
  { id: "device", label: "Device", enabled: true },
  { id: "em", label: "EM", enabled: true },
  { id: "unit", label: "Unit", enabled: false },
  { id: "export", label: "Export", enabled: false },
];

export function BuilderStepper({
  active, onSelect,
}: {
  active: BuilderStep;
  onSelect?: (step: BuilderStep) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="builder-stepper">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          {i > 0 && <span className="text-muted-foreground">›</span>}
          <button
            type="button"
            data-testid={`step-${s.id}`}
            disabled={!s.enabled}
            onClick={() => { if (s.enabled) onSelect?.(s.id); }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium",
              s.id === active && "bg-primary text-primary-foreground",
              s.id !== active && s.enabled && "bg-muted text-foreground hover:bg-accent",
              !s.enabled && "bg-muted/50 text-muted-foreground/60 cursor-not-allowed",
            )}
            title={s.enabled ? undefined : "Coming next"}
            aria-disabled={!s.enabled}
          >
            {s.id === active && <Check className="h-3 w-3" />}
            {i + 1} {s.label}
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/builder-stepper.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/builder-stepper.tsx src/components/code-builder/__tests__/builder-stepper.test.tsx
git commit -m "feat(code-builder): clickable BuilderStepper, enable EM step (C2 Task 3)"
```

---

### Task 4: Layer-parameterise the Code Builder hook + expose the EM UI model

**Goal:** `useCodeBuilder` compiles/persists the **active** layer (not hardcoded `device`) and exposes the contract-derived `unitGroups` + `emById` the EM UI needs.

**Files:**
- Modify: `src/hooks/use-code-builder.ts`

**Acceptance Criteria:**
- [ ] `useCodeBuilder(specId, layer)` accepts a `CodegenLayer` (default `"device"`); the artifact query filters/persists that layer and re-fetches when the layer changes.
- [ ] The hook returns `unitGroups: CodeBuilderUnitGroup[]` and `emById: Record<string, CodeBuilderEmInfo>` (defaulting to `[]` / `{}`).
- [ ] `approve`/`saveEdit` invalidation still refreshes the active layer (prefix-keyed invalidation).
- [ ] `npx tsc -b` is clean and the existing route test stays green.

**Verify:** `npx tsc -b && npx vitest run src/routes/__tests__/code-builder.test.tsx` → typecheck clean, tests pass.

**Steps:**

- [ ] **Step 1: Add imports**

At the top of `src/hooks/use-code-builder.ts`, extend the codegen import and add the model import:

```ts
import { compileContract, filterByLayer } from "@/lib/spec-builder/codegen";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import {
  buildEmUiModel,
  type CodeBuilderUnitGroup, type CodeBuilderEmInfo,
} from "@/lib/spec-builder/code-builder-em-ui-model";
```

- [ ] **Step 2: Parameterise `compileAndReconcile` by layer**

Change the signature and the two `filterByLayer(..., "device")` call sites:

```ts
async function compileAndReconcile(
  specId: string, revision: number, templates: FbTemplate[], layer: CodegenLayer,
): Promise<CodeBuilderArtifactView[]> {
  const existing = await loadRows(specId, revision);
  const contract = await loadSpecContract(specId);
  const result = compileContract(contract, templates);
  const compiled = filterByLayer(result.artifacts, layer);

  const upserts = toUpserts({ specId, revision, compiled, existing });
  if (upserts.length) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(upserts, { onConflict: "spec_id,revision,artifact_name" });
    if (error) throw error;
  }
  return reconcileArtifacts({ specId, revision, compiled, existing });
}
```

- [ ] **Step 3: Accept the `layer` arg and add the EM-UI-model query**

Change the hook signature and the artifact query key (append `layer`), and add a second query for the EM UI model:

```ts
export function useCodeBuilder(specId: string | undefined, layer: CodegenLayer = "device") {
  const qc = useQueryClient();
  const { data: templates = [] } = useFbTemplates();
  const { data: spec } = useSpecProject(specId);

  const revisionNum = spec ? Number(spec.revision) : NaN;
  const revision = Number.isFinite(revisionNum) ? revisionNum : undefined;
  const ready =
    !!specId &&
    revision !== undefined &&
    spec?.confirmation_status === "confirmed";

  const artifacts = useQuery({
    queryKey: [...codeBuilderKey(specId, revision), layer],
    enabled: ready,
    queryFn: () => compileAndReconcile(specId as string, revision as number, templates, layer),
  });

  const emUi = useQuery({
    queryKey: ["code_builder_em_ui", specId ?? "", revision ?? -1],
    enabled: ready,
    queryFn: async () => buildEmUiModel(await loadSpecContract(specId as string)),
  });

  // ...approve and saveEdit mutations unchanged...
```

- [ ] **Step 4: Extend the return value**

Update the final `return` of `useCodeBuilder`:

```ts
  const unitGroups: CodeBuilderUnitGroup[] = emUi.data?.unitGroups ?? [];
  const emById: Record<string, CodeBuilderEmInfo> = emUi.data?.emById ?? {};

  return { artifacts, approve, saveEdit, ready, revision, unitGroups, emById };
}
```

> Note: `approve`/`saveEdit` keep invalidating with `codeBuilderKey(specId, revision)` (the 3-element prefix). TanStack Query matches by prefix, so the 4-element `[...key, layer]` query is still invalidated. Leave those mutation bodies untouched.

- [ ] **Step 5: Verify typecheck + existing route test**

Run: `npx tsc -b`
Expected: exit 0, no errors.

Run: `npx vitest run src/routes/__tests__/code-builder.test.tsx`
Expected: PASS (the route still calls `useCodeBuilder(specId)`; `layer` defaults to `"device"`; the mock is unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-code-builder.ts
git commit -m "feat(code-builder): layer-parameterise compile/persist + expose EM UI model (C2 Task 4)"
```

---

### Task 5: EM/Unit grouping in the control-module list

**Goal:** Parameterise `ControlModuleList` with a `layer` prop. The `device` path is unchanged; the `em` path renders EM rows grouped under collapsible Unit headers.

**Files:**
- Modify: `src/components/code-builder/control-module-list.tsx`
- Test: `src/components/code-builder/__tests__/control-module-list.test.tsx`

**Acceptance Criteria:**
- [ ] `layer="device"` renders the existing flat owner rows (unchanged behaviour).
- [ ] `layer="em"` filters EM artifacts, groups them under Unit headers from `unitGroups`, and shows the per-EM pill + drift badge.
- [ ] Unit headers are collapsible (clicking hides/shows their EM rows).
- [ ] EM owners not present in any `unitGroups` entry fall under an "Ungrouped" header.

**Verify:** `npx vitest run src/components/code-builder/__tests__/control-module-list.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/code-builder/__tests__/control-module-list.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControlModuleList } from "@/components/code-builder/control-module-list";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { CodeBuilderUnitGroup } from "@/lib/spec-builder/code-builder-em-ui-model";

function view(p: Partial<CodeBuilderArtifactView>): CodeBuilderArtifactView {
  return {
    artifact_name: "X", layer: "device", owner_id: null, owner_name: null,
    type: "FB", filename: "X.scl", folder: "Program blocks", dependencies: [],
    generated_content: "", edited_content: null, status: "pending", drift: false,
    ...p,
  };
}

const emViews: CodeBuilderArtifactView[] = [
  view({ artifact_name: "EM_Carriage", type: "FB", layer: "em", owner_id: "em1", owner_name: "Carriage" }),
  view({ artifact_name: "EM_Carriage_DB", type: "DB", layer: "em", owner_id: "em1", owner_name: "Carriage" }),
  view({ artifact_name: "EM_Clamp", type: "FB", layer: "em", owner_id: "em2", owner_name: "Clamp", drift: true }),
];
const unitGroups: CodeBuilderUnitGroup[] = [
  { unitId: "u1", unitName: "Carriage Unit", emIds: ["em1", "em2"] },
];

describe("ControlModuleList — device layer", () => {
  it("renders flat device owner rows", () => {
    const views = [view({ artifact_name: "CM_M01", layer: "device", owner_id: "d1", owner_name: "M01" })];
    render(<ControlModuleList artifacts={views} layer="device" selected={null} onSelect={() => {}} />);
    expect(screen.getByText("M01")).toBeInTheDocument();
  });
});

describe("ControlModuleList — EM layer", () => {
  it("groups EM rows under a collapsible Unit header", () => {
    render(
      <ControlModuleList
        artifacts={emViews} layer="em" unitGroups={unitGroups}
        selected={null} onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Carriage Unit")).toBeInTheDocument();
    expect(screen.getByText("Carriage")).toBeInTheDocument();
    expect(screen.getByText("Clamp")).toBeInTheDocument();

    // collapse the unit → EM rows disappear
    fireEvent.click(screen.getByText("Carriage Unit"));
    expect(screen.queryByText("Carriage")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/control-module-list.test.tsx`
Expected: FAIL — `ControlModuleList` has no `layer`/`unitGroups` props; no Unit headers.

- [ ] **Step 3: Edit the component**

Replace the entire body of `src/components/code-builder/control-module-list.tsx` with:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import type { CodeBuilderUnitGroup } from "@/lib/spec-builder/code-builder-em-ui-model";

type Pill = "matched" | "stub" | "pending" | "approved";

/**
 * approved → the representative artifact is approved
 * stub     → group contains a FB artifact (stub generated, needs editing)
 * matched  → group has no FB (library template matched; only instance DB emitted)
 * pending  → fallback
 */
function pillForGroup(group: CodeBuilderArtifactView[]): Pill {
  const rep = group.find((a) => a.type === "FB") ?? group[0];
  if (rep.status === "approved") return "approved";
  if (group.some((a) => a.type === "FB")) return "stub";
  if (group.every((a) => a.type === "DB")) return "matched";
  return "pending";
}

const PILL_STYLE: Record<Pill, string> = {
  matched: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  stub: "bg-orange-100 text-orange-700",
  pending: "bg-muted text-muted-foreground",
};

interface Row {
  rep: CodeBuilderArtifactView;
  pill: Pill;
  hasDrift: boolean;
}

/** Collapse a layer's artifacts into one row per owner (rep = FB if present). */
function buildRows(views: CodeBuilderArtifactView[]): Row[] {
  const ownerMap = new Map<string, CodeBuilderArtifactView[]>();
  for (const a of views) {
    const key = a.owner_id ?? a.artifact_name;
    const existing = ownerMap.get(key);
    if (existing) existing.push(a);
    else ownerMap.set(key, [a]);
  }
  return Array.from(ownerMap.values()).map((group) => ({
    rep: group.find((a) => a.type === "FB") ?? group[0],
    pill: pillForGroup(group),
    hasDrift: group.some((a) => a.drift),
  }));
}

function RowButton({
  row, selected, onSelect,
}: {
  row: Row; selected: string | null; onSelect: (name: string) => void;
}) {
  const { rep, pill, hasDrift } = row;
  return (
    <button
      type="button"
      aria-current={selected === rep.artifact_name ? "true" : undefined}
      onClick={() => onSelect(rep.artifact_name)}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-accent",
        selected === rep.artifact_name && "bg-accent border-l-2 border-primary",
      )}
    >
      <span className="font-mono truncate">{rep.owner_name ?? rep.artifact_name}</span>
      <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[9px]", PILL_STYLE[pill])}>{pill}</span>
      {hasDrift && <Badge variant="destructive" className="text-[9px] px-1">drift</Badge>}
    </button>
  );
}

export function ControlModuleList({
  artifacts, layer, unitGroups = [], selected, onSelect,
}: {
  artifacts: CodeBuilderArtifactView[];
  layer: CodegenLayer;
  unitGroups?: CodeBuilderUnitGroup[];
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const layerArtifacts = artifacts.filter((a) => a.layer === layer);
  const rows = buildRows(layerArtifacts);

  // Device layer: unchanged flat list.
  if (layer !== "em") {
    return (
      <div className="flex flex-col divide-y" data-testid="cm-list">
        {rows.map((row) => (
          <RowButton key={row.rep.artifact_name} row={row} selected={selected} onSelect={onSelect} />
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No artifacts.</div>
        )}
      </div>
    );
  }

  // EM layer: bucket EM rows under their Unit.
  const rowByEm = new Map<string, Row>();
  for (const row of rows) rowByEm.set(row.rep.owner_id ?? row.rep.artifact_name, row);

  const claimed = new Set<string>();
  const sections = unitGroups.map((g) => {
    const groupRows = g.emIds.map((id) => rowByEm.get(id)).filter((r): r is Row => !!r);
    groupRows.forEach((r) => claimed.add(r.rep.owner_id ?? r.rep.artifact_name));
    return { id: g.unitId, name: g.unitName, rows: groupRows };
  });
  const ungrouped = rows.filter((r) => !claimed.has(r.rep.owner_id ?? r.rep.artifact_name));
  if (ungrouped.length) sections.push({ id: "__ungrouped__", name: "Ungrouped", rows: ungrouped });

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col" data-testid="cm-list">
      {sections.map((sec) => {
        const isCollapsed = collapsed.has(sec.id);
        return (
          <div key={sec.id} className="border-b">
            <button
              type="button"
              onClick={() => toggle(sec.id)}
              className="flex w-full items-center gap-1 bg-muted/40 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted"
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {sec.name}
            </button>
            {!isCollapsed && (
              <div className="flex flex-col divide-y">
                {sec.rows.map((row) => (
                  <RowButton key={row.rep.artifact_name} row={row} selected={selected} onSelect={onSelect} />
                ))}
                {sec.rows.length === 0 && (
                  <div className="px-3 py-3 text-center text-[10px] text-muted-foreground">No equipment modules.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {sections.length === 0 && (
        <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No EM artifacts.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/control-module-list.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/control-module-list.tsx src/components/code-builder/__tests__/control-module-list.test.tsx
git commit -m "feat(code-builder): EM rows grouped under collapsible Unit headers (C2 Task 5)"
```

---

### Task 6: Layer-conditional artifact-viewer tabs

**Goal:** When an EM artifact is selected, show **Code · State · Map · UDT · Inst DB** (the State diagram replaces the combinational Flow tab); device artifacts keep **Code · Flow · UDT · Inst DB**.

**Files:**
- Modify: `src/components/code-builder/artifact-viewer.tsx`
- Test: `src/components/code-builder/__tests__/artifact-viewer.test.tsx`

**Acceptance Criteria:**
- [ ] EM artifact (`layer === "em"`): tabs are Code, State (when states provided), Map (when a `MAP_*` FC is in `related`), UDT, Inst DB — and **no** Flow tab.
- [ ] Device artifact: tabs unchanged (Code, Flow, UDT, Inst DB).
- [ ] The State tab renders `<EmStateDiagram>`; the Map tab renders the `MAP_*` FC content; Inst DB resolves to the EM instance DB (`EM_*_DB`), not the CMD DB.
- [ ] Switching the selected artifact resets the active tab to Code.

**Verify:** `npx vitest run src/components/code-builder/__tests__/artifact-viewer.test.tsx` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/code-builder/__tests__/artifact-viewer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArtifactViewer } from "@/components/code-builder/artifact-viewer";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

// Monaco does not run under jsdom — stub it to a plain element.
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>,
}));

function view(p: Partial<CodeBuilderArtifactView>): CodeBuilderArtifactView {
  return {
    artifact_name: "X", layer: "device", owner_id: null, owner_name: null,
    type: "FB", filename: "X.scl", folder: "Program blocks", dependencies: [],
    generated_content: "", edited_content: null, status: "pending", drift: false,
    ...p,
  };
}

const states: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
];
const transitions: EmTransitionV2[] = [];

const emFb = view({ artifact_name: "EM_Carriage", type: "FB", layer: "em", owner_id: "em1", owner_name: "Carriage", generated_content: "FUNCTION_BLOCK" });
const emRelated: CodeBuilderArtifactView[] = [
  emFb,
  view({ artifact_name: "EM_Carriage_State", type: "UDT", layer: "em", owner_id: "em1" }),
  view({ artifact_name: "Carriage_CMD", type: "DB", layer: "em", owner_id: "em1" }),
  view({ artifact_name: "MAP_Carriage", type: "FC", layer: "em", owner_id: "em1", generated_content: "FUNCTION MAP" }),
  view({ artifact_name: "EM_Carriage_DB", type: "DB", layer: "em", owner_id: "em1" }),
];

describe("ArtifactViewer — EM artifact", () => {
  it("shows State/Map and hides Flow", () => {
    render(<ArtifactViewer artifact={emFb} related={emRelated} editable={false} onContentChange={() => {}} states={states} transitions={transitions} />);
    expect(screen.getByRole("tab", { name: "State" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Map" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Flow" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "State" }));
    expect(screen.getByTestId("em-state-diagram")).toBeInTheDocument();
  });
});

describe("ArtifactViewer — device artifact", () => {
  it("keeps Flow and has no State/Map", () => {
    const dev = view({ artifact_name: "CM_M01", type: "FB", layer: "device" });
    render(<ArtifactViewer artifact={dev} related={[dev]} editable={false} onContentChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Flow" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "State" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Map" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/artifact-viewer.test.tsx`
Expected: FAIL — no State/Map tabs; props `states`/`transitions` unknown.

- [ ] **Step 3: Edit the component**

Replace the entire body of `src/components/code-builder/artifact-viewer.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { parseFbFlow } from "@/lib/fb-flow-diagram";
import { FbFlowRenderer } from "@/components/forge/fb-flow-renderer";
import { EmStateDiagram } from "@/components/code-builder/em-state-diagram";
import type { CodeBuilderArtifactView } from "@/types/code-builder";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

type Tab = "code" | "flow" | "state" | "map" | "udt" | "instdb";

export function ArtifactViewer({
  artifact, related, editable, onContentChange, states = [], transitions = [],
}: {
  artifact: CodeBuilderArtifactView | null;
  /** Other artifacts owned by the same module (for UDT / Map / Inst DB tabs). */
  related: CodeBuilderArtifactView[];
  editable: boolean;
  onContentChange: (content: string) => void;
  /** EM state machine (only used/shown for EM-layer artifacts). */
  states?: EmStateV2[];
  transitions?: EmTransitionV2[];
}) {
  const [tab, setTab] = useState<Tab>("code");
  // Reset to the Code tab whenever the selected artifact changes so we never
  // land on a tab that the new artifact does not expose.
  useEffect(() => { setTab("code"); }, [artifact?.artifact_name]);

  const content = artifact ? (artifact.edited_content ?? artifact.generated_content) : "";
  const isEm = artifact?.layer === "em";

  const canFlow = !!artifact && !isEm && (artifact.type === "FB" || artifact.type === "FC");
  const diagrams = useMemo(() => (canFlow ? parseFbFlow(content) : []), [canFlow, content]);

  const hasState = isEm && states.length > 0;
  const mapFc = isEm ? related.find((r) => r.type === "FC" && r.artifact_name.startsWith("MAP_")) : undefined;
  const udt = related.find((r) => r.type === "UDT");
  const instDb = isEm
    ? related.find((r) => r.type === "DB" && r.artifact_name.startsWith("EM_") && r.artifact_name.endsWith("_DB"))
    : related.find((r) => r.type === "DB");

  if (!artifact) {
    return <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Select an artifact.</div>;
  }

  const TABS: { id: Tab; label: string; show: boolean }[] = [
    { id: "code", label: "Code", show: true },
    { id: "flow", label: "Flow", show: canFlow },
    { id: "state", label: "State", show: hasState },
    { id: "map", label: "Map", show: !!mapFc },
    { id: "udt", label: "UDT", show: !!udt },
    { id: "instdb", label: "Inst DB", show: !!instDb },
  ];

  return (
    <div className="flex h-full flex-col" data-testid="artifact-viewer">
      <div role="tablist" className="flex gap-1 border-b px-2 py-1.5">
        {TABS.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("rounded px-2 py-0.5 text-[10px]", tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "code" && (
          <Editor
            height="100%"
            language="scl"
            theme="vs-dark"
            value={content}
            options={{ readOnly: !editable, minimap: { enabled: false }, fontSize: 12 }}
            onChange={(v) => onContentChange(v ?? "")}
          />
        )}
        {tab === "flow" && <div className="h-full overflow-auto"><FbFlowRenderer diagrams={diagrams} /></div>}
        {tab === "state" && <EmStateDiagram states={states} transitions={transitions} />}
        {tab === "map" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{mapFc ? (mapFc.edited_content ?? mapFc.generated_content) : ""}</pre>}
        {tab === "udt" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{udt ? (udt.edited_content ?? udt.generated_content) : ""}</pre>}
        {tab === "instdb" && <pre className="h-full overflow-auto p-3 text-[11px] font-mono">{instDb ? (instDb.edited_content ?? instDb.generated_content) : ""}</pre>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/code-builder/__tests__/artifact-viewer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/artifact-viewer.tsx src/components/code-builder/__tests__/artifact-viewer.test.tsx
git commit -m "feat(code-builder): layer-conditional EM viewer tabs (State replaces Flow, Map FC) (C2 Task 6)"
```

---

### Task 7: Wire the active layer through the route

**Goal:** Add `activeLayer` state to the Code Builder page, drive the stepper/list/viewer/hook from it, and pass the selected EM's state machine to the viewer. Extend the route test for the layer switch.

**Files:**
- Modify: `src/routes/code-builder.tsx`
- Test (modify): `src/routes/__tests__/code-builder.test.tsx`

**Acceptance Criteria:**
- [ ] Clicking the EM step switches the list/viewer/hook to the `em` layer and clears the current selection.
- [ ] The stepper highlights the active layer.
- [ ] The viewer receives the selected EM's `states`/`transitions` (looked up by the artifact's `owner_id` in `emById`).
- [ ] `npx tsc -b` clean; full code-builder UI suite green.

**Verify:** `npx vitest run src/components/code-builder src/routes/__tests__/code-builder.test.tsx && npx tsc -b` → all pass, typecheck clean.

**Steps:**

- [ ] **Step 1: Extend the route test (write first)**

Replace `src/routes/__tests__/code-builder.test.tsx` with:

```tsx
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CodeBuilderPage from "../code-builder";

const mockSpec = vi.fn();
const mockCb = vi.fn();

vi.mock("@/hooks/use-spec-projects", () => ({ useSpecProject: () => mockSpec() }));
vi.mock("@/hooks/use-code-builder", () => ({ useCodeBuilder: () => mockCb() }));
vi.mock("react-router", async (orig) => {
  const actual = await orig<typeof import("react-router")>();
  return { ...actual, useParams: () => ({ projectId: "p1", specId: "s1" }) };
});
// Monaco does not run under jsdom.
vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>,
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function emView(p: Record<string, unknown>) {
  return {
    artifact_name: "X", layer: "em", owner_id: "em1", owner_name: "Carriage",
    type: "FB", filename: "X.scl", folder: "Program blocks", dependencies: [],
    generated_content: "", edited_content: null, status: "pending", drift: false,
    ...p,
  };
}

describe("CodeBuilderPage", () => {
  beforeEach(() => {
    mockCb.mockReturnValue({
      artifacts: { data: [emView({ artifact_name: "EM_Carriage" })] },
      approve: { mutate: vi.fn(), isPending: false },
      saveEdit: { mutate: vi.fn(), isPending: false },
      unitGroups: [{ unitId: "u1", unitName: "Carriage Unit", emIds: ["em1"] }],
      emById: { em1: { emId: "em1", emName: "Carriage", states: [], transitions: [] } },
    });
  });

  it("renders the locked state for an unconfirmed spec", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "unconfirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    expect(screen.getByTestId("code-builder-locked")).toBeInTheDocument();
  });

  it("renders the stepper + panes for a confirmed spec", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    expect(screen.getByTestId("code-builder-page")).toBeInTheDocument();
    expect(screen.getByTestId("builder-stepper")).toBeInTheDocument();
  });

  it("switches to the EM layer and groups EM rows under their Unit", () => {
    mockSpec.mockReturnValue({ data: { confirmation_status: "confirmed", doc_code: "DOC" } });
    wrap(<CodeBuilderPage />);
    // device layer initially → no Unit header
    expect(screen.queryByText("Carriage Unit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("step-em"));
    expect(screen.getByText("Carriage Unit")).toBeInTheDocument();
    expect(screen.getByText("Carriage")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/__tests__/code-builder.test.tsx`
Expected: FAIL — the page does not yet switch layers (`step-em` not wired; list has no `layer` prop).

- [ ] **Step 3: Edit the route**

In `src/routes/code-builder.tsx`:

(a) Add the layer-type import near the other imports:

```ts
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
```

(b) Replace the state + hook lines (currently lines 21–24) with:

```ts
  const [activeLayer, setActiveLayer] = useState<CodegenLayer>("device");
  const { artifacts, approve, saveEdit, unitGroups = [], emById = {} } = useCodeBuilder(specId, activeLayer);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
```

(c) Derive the selected EM's state machine just after the `related` memo:

```ts
  const emInfo = current?.owner_id ? emById[current.owner_id] : undefined;
```

(d) Replace the `<BuilderStepper active="device" />` line with:

```tsx
          <BuilderStepper
            active={activeLayer === "em" ? "em" : "device"}
            onSelect={(step) => {
              if (step === "device" || step === "em") {
                setActiveLayer(step);
                setSelected(null);
                setEditing(false);
              }
            }}
          />
```

(e) Replace the `<ControlModuleList ... />` usage with the layer-aware version:

```tsx
          <ControlModuleList
            artifacts={views}
            layer={activeLayer}
            unitGroups={unitGroups}
            selected={selected}
            onSelect={(n) => {
              setSelected(n);
              setEditing(false);
            }}
          />
```

(f) Pass the EM state machine to the viewer:

```tsx
          <ArtifactViewer
            artifact={current}
            related={related}
            editable={editing}
            onContentChange={setDraft}
            states={emInfo?.states}
            transitions={emInfo?.transitions}
          />
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/components/code-builder src/routes/__tests__/code-builder.test.tsx`
Expected: PASS (all code-builder component suites + 3 route tests).

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/routes/code-builder.tsx src/routes/__tests__/code-builder.test.tsx
git commit -m "feat(code-builder): wire active layer through the route (stepper/list/viewer) (C2 Task 7)"
```

---

## Final Verification

After all 7 tasks, run the full Code Builder surface + typecheck once more:

```bash
npx vitest run src/lib/spec-builder src/components/code-builder src/routes/__tests__/code-builder.test.tsx
npx tsc -b
```

Expected: all suites green, typecheck clean. Then complete via the **finishing-a-development-branch** skill.

## Generic-Change Self-Check (CLAUDE.md)

None of these files match the pipeline self-check globs (`use-forge-*`, `use-pipeline-*`, `*-prompt*`, `forge-*`, `pipeline.ts`), but the project's "All Changes Must Be Generic" rule still applies:
- `buildEmUiModel` iterates `contract.hierarchy.units` generically — no device names, sequence ids, or machine-type assumptions.
- `formatTransition` formats any `PermissiveCondition` mechanically — no special-casing.
- The diagram/list/viewer render whatever EMs/states/units the contract contains. Verified mentally against a conveyor (1 Unit, 1 EM), a stamping cell (multiple Units), and a filling station (collapsed-EM single Unit): all render correctly.
