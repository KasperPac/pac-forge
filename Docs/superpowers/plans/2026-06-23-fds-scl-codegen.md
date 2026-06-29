# FDS → SCL Code Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministically compile a confirmed `SpecContractV2` FDS into Siemens SCL — a per-Unit S/A (Step/Action) sealed-step sequencer plus library CM/EM FB instantiation + IO wiring.

**Architecture:** A pure, AI-free module under `src/lib/spec-builder/codegen/`. It reads the confirmed contract, derives a per-Unit S/A sequence from the per-EM state machines (states → steps, transitions → advance conditions, static-state device holds → action wiring), emits a UDT + sequence DB + `UC_<Unit>` FC, instantiates matched library FBs (stub on no match), and produces OB1. Output flows through the existing `manifest-builder` / `tia-export` plumbing.

**Tech Stack:** TypeScript (strict: `import type`, no enums, no unused locals), Vitest, Zod-typed `SpecContractV2`.

**Conventions:**
- New files live in `src/lib/spec-builder/codegen/` — deliberately OUTSIDE the pipeline-auditor globs (`use-forge-*`, `use-pipeline-*`, `*-prompt*`, `forge-*`, `pipeline.ts`).
- Pure functions only in the compiler; the one hook (`use-spec-codegen.ts`) does IO.
- Conditions are machine-language SCL (`AND`/`OR`/`NOT`, `TRUE`/`FALSE`) — never prose.
- All logic GENERIC across machine types; tests use synthetic conveyor/lift fixtures, never the live HRE spec names.
- Typecheck: `npx tsc -b`. Tests: `npx vitest run <path>`.

---

### Task 1: Condition serializer

**Goal:** Turn raw `PermissiveCondition` / `EmTrigger` contract values into machine-language SCL boolean strings.

**Files:**
- Create: `src/lib/spec-builder/codegen/serialize-condition.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/serialize-condition.test.ts`

**Acceptance Criteria:**
- [ ] Boolean permissive → `tag = TRUE` / `tag = FALSE`.
- [ ] Numeric permissive uses SCL operators (`<>` for `!=`).
- [ ] Edge values `P_TRIG`/`N_TRIG` render as bare `tag` / `NOT tag`.
- [ ] Empty guard → `TRUE`; multi-term guard AND-joined with parens.
- [ ] `command` trigger ANDs its expr with the guard; `completion` trigger yields the guard alone.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/serialize-condition.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/serialize-condition.test.ts
import { describe, it, expect } from "vitest";
import { serializeCondition, serializeGuard, serializeAdvance } from "../serialize-condition";
import type { PermissiveCondition, EmTrigger } from "@/types/spec-contract-v2";

const cond = (tag: string, operator: PermissiveCondition["operator"], value: PermissiveCondition["value"]): PermissiveCondition => ({ tag, operator, value });

describe("serializeCondition", () => {
  it("renders boolean permissives as tag = TRUE/FALSE", () => {
    expect(serializeCondition(cond("Brake_Open", "=", true))).toBe("Brake_Open = TRUE");
    expect(serializeCondition(cond("E_Stop", "=", false))).toBe("E_Stop = FALSE");
  });
  it("renders numeric permissives with SCL operators", () => {
    expect(serializeCondition(cond("Level", ">=", 5))).toBe("Level >= 5");
    expect(serializeCondition(cond("Count", "!=", 0))).toBe("Count <> 0");
  });
  it("renders edge values as bare tag / NOT tag", () => {
    expect(serializeCondition(cond("Start_PB", "=", "P_TRIG"))).toBe("Start_PB");
    expect(serializeCondition(cond("Stop_PB", "=", "N_TRIG"))).toBe("NOT Stop_PB");
  });
});

describe("serializeGuard", () => {
  it("returns TRUE for an empty guard", () => {
    expect(serializeGuard([])).toBe("TRUE");
  });
  it("AND-joins multiple terms with parens", () => {
    expect(serializeGuard([cond("A", "=", true), cond("B", "=", false)]))
      .toBe("(A = TRUE) AND (B = FALSE)");
  });
});

describe("serializeAdvance", () => {
  it("ANDs a command trigger with its guard", () => {
    const t: EmTrigger = { kind: "command", expr: cond("CMD_GO", "=", true) };
    expect(serializeAdvance(t, [cond("LS", "=", false)]))
      .toBe("(CMD_GO = TRUE) AND (LS = FALSE)");
  });
  it("yields the guard alone for a completion trigger", () => {
    const t: EmTrigger = { kind: "completion" };
    expect(serializeAdvance(t, [cond("Done", "=", true)])).toBe("(Done = TRUE)");
  });
  it("returns just the trigger when the guard is empty", () => {
    const t: EmTrigger = { kind: "command", expr: cond("CMD_GO", "=", true) };
    expect(serializeAdvance(t, [])).toBe("(CMD_GO = TRUE)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/serialize-condition.test.ts`
Expected: FAIL — cannot find module `../serialize-condition`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/serialize-condition.ts
import type { PermissiveCondition, EmTrigger } from "@/types/spec-contract-v2";

/** Contract operator → SCL operator (`!=` becomes `<>`). */
const OP_MAP: Record<PermissiveCondition["operator"], string> = {
  "=": "=",
  "!=": "<>",
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
};

/**
 * One permissive → an SCL boolean term. Booleans render as `tag = TRUE/FALSE`;
 * numerics use SCL operators; the edge sentinels render as a bare tag (rising)
 * or `NOT tag` (falling). Edge-detection instances are a later refinement.
 */
export function serializeCondition(c: PermissiveCondition): string {
  if (c.value === "P_TRIG") return c.tag;
  if (c.value === "N_TRIG") return `NOT ${c.tag}`;
  const op = OP_MAP[c.operator];
  if (typeof c.value === "boolean") return `${c.tag} ${op} ${c.value ? "TRUE" : "FALSE"}`;
  return `${c.tag} ${op} ${c.value}`;
}

/** AND-join a guard list, each term parenthesised. Empty guard → `TRUE`. */
export function serializeGuard(guard: PermissiveCondition[]): string {
  if (!guard.length) return "TRUE";
  return guard.map((c) => `(${serializeCondition(c)})`).join(" AND ");
}

/**
 * A transition's full advance condition. A `command` trigger ANDs its
 * expression with the guard; a `completion` trigger contributes no extra term,
 * so the guard alone is the advance.
 */
export function serializeAdvance(trigger: EmTrigger, guard: PermissiveCondition[]): string {
  const guardStr = serializeGuard(guard);
  if (trigger.kind === "completion") return guardStr;
  const trig = `(${serializeCondition(trigger.expr)})`;
  return guardStr === "TRUE" ? trig : `${trig} AND ${guardStr}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/serialize-condition.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/serialize-condition.ts src/lib/spec-builder/codegen/__tests__/serialize-condition.test.ts
git commit -m "feat(codegen): SCL condition serializer for FDS permissives/triggers"
```

---

### Task 2: Step ordering

**Goal:** Order an EM's states for the sequencer — safe/home state first, then transition-reachable states, with any unreached states appended so nothing is dropped.

**Files:**
- Create: `src/lib/spec-builder/codegen/step-order.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/step-order.test.ts`

**Acceptance Criteria:**
- [ ] Safe state (`is_safe_state`) comes first; falls back to first declared state when none flagged.
- [ ] States are emitted in breadth-first transition order from the home state.
- [ ] Cycles terminate (visited set) — no infinite loop, no duplicates.
- [ ] Unreachable states are appended in declaration order.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/step-order.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/step-order.test.ts
import { describe, it, expect } from "vitest";
import { orderStates } from "../step-order";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

const st = (id: string, safe = false): EmStateV2 => ({
  state_id: id, name: id, kind: "static", allowed_modes: [], is_safe_state: safe,
});
const tr = (from: string, to: string): EmTransitionV2 => ({
  transition_id: `${from}->${to}`, from_state_id: from, to_state_id: to,
  trigger: { kind: "completion" }, guard: [],
});

describe("orderStates", () => {
  it("puts the safe state first then follows transitions breadth-first", () => {
    const states = [st("driving"), st("stopped", true), st("faulted")];
    const trans = [tr("stopped", "driving"), tr("driving", "faulted"), tr("faulted", "stopped")];
    expect(orderStates(states, trans).map((s) => s.state_id))
      .toEqual(["stopped", "driving", "faulted"]);
  });
  it("falls back to the first declared state when none is flagged safe", () => {
    const states = [st("a"), st("b")];
    expect(orderStates(states, [tr("a", "b")]).map((s) => s.state_id)).toEqual(["a", "b"]);
  });
  it("terminates on cycles without duplicating", () => {
    const states = [st("a", true), st("b")];
    const trans = [tr("a", "b"), tr("b", "a")];
    expect(orderStates(states, trans).map((s) => s.state_id)).toEqual(["a", "b"]);
  });
  it("appends unreachable states in declaration order", () => {
    const states = [st("home", true), st("reachable"), st("orphan")];
    expect(orderStates(states, [tr("home", "reachable")]).map((s) => s.state_id))
      .toEqual(["home", "reachable", "orphan"]);
  });
  it("returns [] for no states", () => {
    expect(orderStates([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/step-order.test.ts`
Expected: FAIL — cannot find module `../step-order`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/step-order.ts
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

/**
 * Order an EM's states for the S/A sequencer: start at the safe/home state
 * (fallback: first declared), walk transitions breadth-first, then append any
 * states the walk never reached so the sequence covers every state. A visited
 * set makes cycles terminate.
 */
export function orderStates(
  states: EmStateV2[],
  transitions: EmTransitionV2[],
): EmStateV2[] {
  if (!states.length) return [];
  const byId = new Map(states.map((s) => [s.state_id, s]));
  const home = states.find((s) => s.is_safe_state) ?? states[0];

  const out: EmStateV2[] = [];
  const visited = new Set<string>();
  const queue: string[] = [home.state_id];
  while (queue.length) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    const state = byId.get(id);
    if (!state) continue;
    visited.add(id);
    out.push(state);
    for (const t of transitions) {
      if (t.from_state_id === id && !visited.has(t.to_state_id)) queue.push(t.to_state_id);
    }
  }
  for (const s of states) if (!visited.has(s.state_id)) out.push(s);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/step-order.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/step-order.ts src/lib/spec-builder/codegen/__tests__/step-order.test.ts
git commit -m "feat(codegen): breadth-first EM state ordering for the sequencer"
```

---

### Task 3: S/A sequence IR + builder

**Goal:** Define the internal IR and compile one Unit's EM contracts into an `SaSequence` — a flat step list where each step carries its incoming activation edges, its outgoing (leave) conditions, and the device tags it commands active.

**Files:**
- Create: `src/lib/spec-builder/codegen/types.ts`
- Create: `src/lib/spec-builder/codegen/sa-builder.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/sa-builder.test.ts`

**Acceptance Criteria:**
- [ ] Each EM's ordered states become steps with a Unit-global flat index.
- [ ] Each EM's first (home) state is flagged `isHome`.
- [ ] A transition produces an `incoming` edge on its target step `{ fromIndex, condition }` and adds its condition to the source step's `leave` list.
- [ ] A transition whose target is outside the EM is skipped and recorded as a warning (no crash).
- [ ] A static state's active-commanded device entries become the step's `wires` (one tag each); non-active commands are omitted.
- [ ] `sclName` is a sanitised SCL identifier derived from the unit name.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/sa-builder.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the IR types**

```typescript
// src/lib/spec-builder/codegen/types.ts

/** Artifact kinds this compiler emits. */
export type CodegenArtifactType = "UDT" | "FB" | "FC" | "DB" | "OB";

/** A generated SCL source unit, shaped for the TIA export plumbing. */
export interface CodegenArtifact {
  name: string;
  type: CodegenArtifactType;
  filename: string;
  content: string;
  dependencies: string[];
  folder: string;
}

/** An edge that activates a step: source step index + the SCL advance condition. */
export interface SaIncoming {
  fromIndex: number;
  condition: string;
}

/** A device output the step commands active (driven by this step's A[] bit). */
export interface SaWire {
  tag: string;
}

/** One step in a Unit's flat S/A sequence. */
export interface SaStep {
  index: number;
  emId: string;
  stateId: string;
  name: string;
  isHome: boolean;
  incoming: SaIncoming[];
  leave: string[];
  wires: SaWire[];
}

/** A Unit's complete S/A sequence IR. */
export interface SaSequence {
  unitId: string;
  unitName: string;
  sclName: string;
  steps: SaStep[];
}

/** Devices/EMs that had no library FB match and got a stub. */
export interface StubReport {
  controlModules: { id: string; name: string; reason: string }[];
  equipmentModules: { id: string; name: string; reason: string }[];
}

/** Full output of a compile run. */
export interface CodegenResult {
  artifacts: CodegenArtifact[];
  stubs: StubReport;
  warnings: string[];
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/sa-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildUnitSequence, sclIdent, isActiveCommand } from "../sa-builder";
import type {
  EquipmentModuleContract, EmStateV2, EmTransitionV2, ControlModuleStateEntry,
} from "@/types/spec-contract-v2";

const state = (id: string, kind: EmStateV2["kind"], safe = false): EmStateV2 => ({
  state_id: id, name: id, kind, allowed_modes: [], is_safe_state: safe,
});
const entry = (tag: string, s: string): ControlModuleStateEntry => ({ tag, description: tag, state: s });

/** A minimal one-EM "carriage" contract: Stopped <-> Driving, driving holds the motor. */
function carriageEm(): EquipmentModuleContract {
  return {
    equipment_module_id: "em-1",
    unit_id: "unit-1",
    states: [state("stopped", "static", true), state("driving", "static")],
    transitions: [
      {
        transition_id: "t1", from_state_id: "stopped", to_state_id: "driving",
        trigger: { kind: "command", expr: { tag: "CMD_FWD", operator: "=", value: true } },
        guard: [{ tag: "Brake_Open", operator: "=", value: true }],
      } as EmTransitionV2,
      {
        transition_id: "t2", from_state_id: "driving", to_state_id: "stopped",
        trigger: { kind: "command", expr: { tag: "CMD_FWD", operator: "=", value: false } },
        guard: [],
      } as EmTransitionV2,
    ],
    static_states: {
      stopped: [entry("Motor_Run", "STOP")],
      driving: [entry("Motor_Run", "RUN")],
    },
    sequential_states: {},
  };
}

describe("sclIdent", () => {
  it("sanitises a name into a legal SCL identifier", () => {
    expect(sclIdent("Carriage Unit #1")).toBe("Carriage_Unit_1");
    expect(sclIdent("3-Axis")).toBe("_3_Axis");
  });
});

describe("isActiveCommand", () => {
  it("treats RUN/ON/OPEN/EXTEND/TRUE as active", () => {
    expect(isActiveCommand("RUN")).toBe(true);
    expect(isActiveCommand("open")).toBe(true);
  });
  it("treats STOP/OFF/CLOSED as inactive", () => {
    expect(isActiveCommand("STOP")).toBe(false);
    expect(isActiveCommand("")).toBe(false);
  });
});

describe("buildUnitSequence", () => {
  const seq = buildUnitSequence("unit-1", "Carriage Unit", [carriageEm()]);

  it("flattens ordered states into indexed steps with the home flagged", () => {
    expect(seq.steps.map((s) => [s.index, s.stateId, s.isHome]))
      .toEqual([[0, "stopped", true], [1, "driving", false]]);
  });
  it("records the advance from stopped→driving as an incoming edge on driving", () => {
    expect(seq.steps[1].incoming).toEqual([
      { fromIndex: 0, condition: "(CMD_FWD = TRUE) AND (Brake_Open = TRUE)" },
    ]);
  });
  it("adds each transition's condition to its source step's leave list", () => {
    expect(seq.steps[0].leave).toEqual(["(CMD_FWD = TRUE) AND (Brake_Open = TRUE)"]);
    expect(seq.steps[1].leave).toEqual(["(CMD_FWD = FALSE)"]);
  });
  it("wires only the active-commanded device of each static state", () => {
    expect(seq.steps[0].wires).toEqual([]);                       // STOP → not driven
    expect(seq.steps[1].wires).toEqual([{ tag: "Motor_Run" }]);   // RUN → driven by A[1]
  });
});

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/sa-builder.test.ts`
Expected: FAIL — cannot find module `../sa-builder`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/sa-builder.ts
import type {
  EquipmentModuleContract, ControlModuleStateEntry, StaticStateV2,
} from "@/types/spec-contract-v2";
import { orderStates } from "./step-order";
import { serializeAdvance } from "./serialize-condition";
import type { SaSequence, SaStep } from "./types";

/** Tokens that mean "drive this output" when found in a static-state command. */
const ACTIVE_TOKENS = new Set([
  "run", "on", "open", "extend", "extended", "raise", "raised", "forward",
  "energize", "energized", "active", "true", "start", "advance", "advanced",
]);

/** True if a static-state command string means the device is driven active. */
export function isActiveCommand(state: string): boolean {
  return ACTIVE_TOKENS.has(state.trim().toLowerCase());
}

/** Sanitise an arbitrary name into a legal SCL identifier (letters/digits/_,
 *  leading digit prefixed with `_`). */
export function sclIdent(name: string): string {
  let s = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "X";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s;
}

/** Static-state rows are either a bare entry array (legacy) or a StaticStateV2. */
function staticEntries(
  value: ControlModuleStateEntry[] | StaticStateV2 | undefined,
): ControlModuleStateEntry[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.control_modules;
}

/**
 * Compile one Unit's EM contracts into a flat S/A sequence. Each EM contributes
 * its ordered states as steps; the EM's first (home) state is flagged. A
 * transition becomes an incoming edge on its target and a leave-condition on its
 * source. Active-commanded static outputs become the step's wires. Transitions
 * whose target is outside the EM are skipped and reported via the returned
 * warnings list on the caller side (here they are simply ignored safely).
 */
export function buildUnitSequence(
  unitId: string,
  unitName: string,
  ems: EquipmentModuleContract[],
  warnings: string[] = [],
): SaSequence {
  const steps: SaStep[] = [];
  // First pass: lay out steps and remember each EM-local state_id → flat index.
  const indexOf = new Map<string, number>(); // key: `${emId}:${stateId}`
  for (const em of ems) {
    const ordered = orderStates(em.states, em.transitions);
    ordered.forEach((s, i) => {
      const index = steps.length;
      indexOf.set(`${em.equipment_module_id}:${s.state_id}`, index);
      steps.push({
        index,
        emId: em.equipment_module_id,
        stateId: s.state_id,
        name: s.name,
        isHome: i === 0,
        incoming: [],
        leave: [],
        wires: staticEntries(em.static_states[s.state_id])
          .filter((e) => isActiveCommand(e.state))
          .map((e) => ({ tag: e.tag })),
      });
    });
  }
  // Second pass: wire transitions into incoming/leave conditions.
  for (const em of ems) {
    for (const t of em.transitions) {
      const fromIndex = indexOf.get(`${em.equipment_module_id}:${t.from_state_id}`);
      const toIndex = indexOf.get(`${em.equipment_module_id}:${t.to_state_id}`);
      if (fromIndex === undefined || toIndex === undefined) {
        warnings.push(
          `Unit ${unitName}: transition ${t.transition_id} targets a state outside EM ${em.equipment_module_id} — skipped`,
        );
        continue;
      }
      const condition = serializeAdvance(t.trigger, t.guard);
      steps[toIndex].incoming.push({ fromIndex, condition });
      steps[fromIndex].leave.push(condition);
    }
  }
  return { unitId, unitName, sclName: sclIdent(unitName), steps };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/sa-builder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/types.ts src/lib/spec-builder/codegen/sa-builder.ts src/lib/spec-builder/codegen/__tests__/sa-builder.test.ts
git commit -m "feat(codegen): S/A sequence IR + per-Unit builder from EM contracts"
```

---

### Task 4: UDT + sequence DB writers

**Goal:** Emit the per-Unit UDT (`S[]`/`A[]` arrays + control bits) and an instance DB of that UDT with home steps initialised TRUE.

**Files:**
- Create: `src/lib/spec-builder/codegen/udt-writer.ts`
- Create: `src/lib/spec-builder/codegen/db-writer.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/udt-db-writer.test.ts`

**Acceptance Criteria:**
- [ ] UDT declares `S : ARRAY[0..N-1] OF BOOL` and `A : ARRAY[0..N-1] OF BOOL` sized to the step count, plus `Stop, Running, Resume, Reset, StartReject : Bool`.
- [ ] UDT name is `UDT_<sclName>`; DB name `DB_<sclName>`; DB declares the UDT type.
- [ ] DB BEGIN block sets `S[i] := true;` for each home step index.
- [ ] Both artifacts return correct `type`, `filename` (`.udt` / `.db`), `dependencies` (DB depends on UDT), `folder`.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/udt-db-writer.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/udt-db-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeUdt } from "../udt-writer";
import { writeSequenceDb } from "../db-writer";
import type { SaSequence } from "../types";

const seq: SaSequence = {
  unitId: "u1", unitName: "Carriage Unit", sclName: "Carriage_Unit",
  steps: [
    { index: 0, emId: "em1", stateId: "stopped", name: "stopped", isHome: true, incoming: [], leave: [], wires: [] },
    { index: 1, emId: "em1", stateId: "driving", name: "driving", isHome: false, incoming: [], leave: [], wires: [{ tag: "Motor_Run" }] },
  ],
};

describe("writeUdt", () => {
  const a = writeUdt(seq);
  it("names and types the artifact", () => {
    expect(a.name).toBe("UDT_Carriage_Unit");
    expect(a.type).toBe("UDT");
    expect(a.filename).toBe("UDT_Carriage_Unit.udt");
  });
  it("sizes the S/A arrays to the step count and declares control bits", () => {
    expect(a.content).toContain("S : ARRAY[0..1] OF BOOL;");
    expect(a.content).toContain("A : ARRAY[0..1] OF BOOL;");
    expect(a.content).toContain("Stop : Bool;");
    expect(a.content).toContain("Reset : Bool;");
  });
});

describe("writeSequenceDb", () => {
  const a = writeSequenceDb(seq);
  it("declares the UDT type and depends on it", () => {
    expect(a.name).toBe("DB_Carriage_Unit");
    expect(a.type).toBe("DB");
    expect(a.dependencies).toContain("UDT_Carriage_Unit");
    expect(a.content).toContain('"UDT_Carriage_Unit"');
  });
  it("initialises home step bits TRUE", () => {
    expect(a.content).toContain("S[0] := true;");
    expect(a.content).not.toContain("S[1] := true;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/udt-db-writer.test.ts`
Expected: FAIL — cannot find module `../udt-writer`.

- [ ] **Step 3: Write the UDT writer**

```typescript
// src/lib/spec-builder/codegen/udt-writer.ts
import type { SaSequence, CodegenArtifact } from "./types";

const FOLDER = "PLC data types";

/** Emit the per-Unit UDT: parallel S/A bit arrays + sequencer control bits. */
export function writeUdt(seq: SaSequence): CodegenArtifact {
  const name = `UDT_${seq.sclName}`;
  const last = Math.max(0, seq.steps.length - 1);
  const content = [
    `TYPE "${name}"`,
    `VERSION : 0.1`,
    `   STRUCT`,
    `      S : ARRAY[0..${last}] OF BOOL;   // step active`,
    `      A : ARRAY[0..${last}] OF BOOL;   // action active`,
    `      Stop : Bool;`,
    `      Running : Bool;`,
    `      Resume : Bool;`,
    `      Reset : Bool;`,
    `      StartReject : Bool;`,
    `   END_STRUCT;`,
    `END_TYPE`,
    ``,
  ].join("\n");
  return { name, type: "UDT", filename: `${name}.udt`, content, dependencies: [], folder: FOLDER };
}
```

- [ ] **Step 4: Write the DB writer**

```typescript
// src/lib/spec-builder/codegen/db-writer.ts
import type { SaSequence, CodegenArtifact } from "./types";

const FOLDER = "Program blocks";

/** Emit the per-Unit sequence DB: an instance of the Unit UDT with home steps
 *  initialised TRUE so the sequencer powers up at its safe state(s). */
export function writeSequenceDb(seq: SaSequence): CodegenArtifact {
  const udt = `UDT_${seq.sclName}`;
  const name = `DB_${seq.sclName}`;
  const inits = seq.steps.filter((s) => s.isHome).map((s) => `   S[${s.index}] := true;`);
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `"${udt}"`,
    `BEGIN`,
    ...inits,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [udt], folder: FOLDER };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/udt-db-writer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/udt-writer.ts src/lib/spec-builder/codegen/db-writer.ts src/lib/spec-builder/codegen/__tests__/udt-db-writer.test.ts
git commit -m "feat(codegen): UDT + sequence DB writers"
```

---

### Task 5: Sequence FC writer

**Goal:** Emit the `UC_<Unit>` FC implementing the three S/A network groups: graph-generalised step seal-in, action mirror, and action→output wiring.

**Files:**
- Create: `src/lib/spec-builder/codegen/fc-writer.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/fc-writer.test.ts`

**Acceptance Criteria:**
- [ ] Each step emits `S[i] := ((S[f] AND cond) OR ... OR S[i]) AND NOT (leave1 OR leave2 ...);` from its incoming edges and leave conditions.
- [ ] A step with no incoming and no leave (isolated) emits `S[i] := S[i];` (held).
- [ ] A home step ORs `#db.Reset` into its activation so reset returns to safe.
- [ ] Actions emit `A[i] := S[i];` for every step.
- [ ] Output wiring aggregates a tag commanded by multiple steps into `tag := A[a] OR A[b];`.
- [ ] The FC takes the sequence DB by reference (`VAR_IN_OUT db : "UDT_<Unit>"`), uses `#db.S[...]`, and is named `UC_<sclName>`.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/fc-writer.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/fc-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeSequenceFc } from "../fc-writer";
import type { SaSequence } from "../types";

const seq: SaSequence = {
  unitId: "u1", unitName: "Carriage Unit", sclName: "Carriage_Unit",
  steps: [
    {
      index: 0, emId: "em1", stateId: "stopped", name: "stopped", isHome: true,
      incoming: [{ fromIndex: 1, condition: "(CMD_FWD = FALSE)" }],
      leave: ["(CMD_FWD = TRUE) AND (Brake_Open = TRUE)"], wires: [],
    },
    {
      index: 1, emId: "em1", stateId: "driving", name: "driving", isHome: false,
      incoming: [{ fromIndex: 0, condition: "(CMD_FWD = TRUE) AND (Brake_Open = TRUE)" }],
      leave: ["(CMD_FWD = FALSE)"], wires: [{ tag: "Motor_Run" }],
    },
  ],
};

describe("writeSequenceFc", () => {
  const a = writeSequenceFc(seq);
  it("names and types the FC and takes the DB in-out", () => {
    expect(a.name).toBe("UC_Carriage_Unit");
    expect(a.type).toBe("FC");
    expect(a.content).toContain('db : "UDT_Carriage_Unit";');
    expect(a.dependencies).toContain("UDT_Carriage_Unit");
  });
  it("emits a graph seal-in for each step", () => {
    expect(a.content).toContain(
      "#db.S[1] := ((#db.S[0] AND ((CMD_FWD = TRUE) AND (Brake_Open = TRUE))) OR #db.S[1]) AND NOT ((CMD_FWD = FALSE));",
    );
  });
  it("ORs Reset into the home step activation", () => {
    expect(a.content).toContain("OR #db.Reset)");
    expect(a.content).toMatch(/#db\.S\[0\] := \(\(#db\.S\[1\] AND \(\(CMD_FWD = FALSE\)\)\) OR #db\.Reset OR #db\.S\[0\]\) AND NOT \(\(CMD_FWD = TRUE\) AND \(Brake_Open = TRUE\)\);/);
  });
  it("mirrors actions and wires the active output", () => {
    expect(a.content).toContain("#db.A[0] := #db.S[0];");
    expect(a.content).toContain("#db.A[1] := #db.S[1];");
    expect(a.content).toContain('"Motor_Run" := #db.A[1];');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fc-writer.test.ts`
Expected: FAIL — cannot find module `../fc-writer`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/fc-writer.ts
import type { SaSequence, SaStep, CodegenArtifact } from "./types";

const FOLDER = "Program blocks";

/** The seal-in assignment for one step, generalised from a linear chain to a
 *  state graph: activate on ANY incoming edge firing, hold while none of the
 *  outgoing (leave) conditions are true. Home steps also activate on Reset. */
function stepLine(s: SaStep): string {
  const activations = s.incoming.map((e) => `(#db.S[${e.fromIndex}] AND ${e.condition})`);
  if (s.isHome) activations.push("#db.Reset");
  activations.push(`#db.S[${s.index}]`); // seal
  const onTerm = activations.join(" OR ");
  const leave = s.leave.length ? ` AND NOT (${s.leave.join(" OR ")})` : "";
  return `   #db.S[${s.index}] := (${onTerm})${leave};`;
}

/** Aggregate output wiring: a tag commanded active by several steps is driven
 *  by the OR of those steps' action bits. */
function wireLines(seq: SaSequence): string[] {
  const byTag = new Map<string, number[]>();
  for (const s of seq.steps) for (const w of s.wires) {
    const arr = byTag.get(w.tag) ?? [];
    arr.push(s.index);
    byTag.set(w.tag, arr);
  }
  return [...byTag.entries()].map(
    ([tag, idx]) => `   "${tag}" := ${idx.map((i) => `#db.A[${i}]`).join(" OR ")};`,
  );
}

/** Emit the per-Unit sequencer FC (step transitions, action mirror, wiring). */
export function writeSequenceFc(seq: SaSequence): CodegenArtifact {
  const udt = `UDT_${seq.sclName}`;
  const name = `UC_${seq.sclName}`;
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_IN_OUT`,
    `      db : "${udt}";`,
    `   END_VAR`,
    ``,
    `BEGIN`,
    `   // --- Step transitions (sealed-step sequencer) ---`,
    ...seq.steps.map(stepLine),
    ``,
    `   // --- Actions ---`,
    ...seq.steps.map((s) => `   #db.A[${s.index}] := #db.S[${s.index}];`),
    ``,
    `   // --- Action -> output wiring ---`,
    ...wireLines(seq),
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies: [udt], folder: FOLDER };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fc-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/fc-writer.ts src/lib/spec-builder/codegen/__tests__/fc-writer.test.ts
git commit -m "feat(codegen): per-Unit S/A sequencer FC writer"
```

---

### Task 6: FB instantiation, IO wiring + stubs

**Goal:** For each Control Module and Equipment Module, pick a library FB by name/class/category, emit its instance DB + an OB1 call with IO wired from `io_signals`; when no template matches, emit a stub FB with the correct interface and record it.

**Files:**
- Create: `src/lib/spec-builder/codegen/fb-instantiate.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`

**Acceptance Criteria:**
- [ ] `pickTemplate(name, deviceClass, isEm, templates)` returns the best `is_equipment_module`-matching enabled template by category/name/tag score, or `null`.
- [ ] A matched CM yields an instance DB artifact (type DB) plus call lines wiring DI/AI inputs from their `io_address` and DO/AO outputs to their `io_address`.
- [ ] An unmatched device yields a stub FB artifact (`CM_<name>` / `EM_<name>`, type FB) whose VAR_INPUT holds DI/AI tags and VAR_OUTPUT holds DO/AO tags, and is appended to `StubReport`.
- [ ] EM-level instantiation uses the `EM_` prefix and `isEm = true`.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts
import { describe, it, expect } from "vitest";
import { pickTemplate, instantiateControlModule } from "../fb-instantiate";
import type { ControlModuleV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";

const tmpl = (over: Partial<FbTemplate>): FbTemplate => ({
  id: "t1", name: "Motor_Std", device_category: "motor", plc_brand: "SIEMENS_TIA",
  description: null, ai_summary: null, diagram_chart: null, diagram_generated_at: null,
  flow_diagram_json: null, flow_diagram_generated_at: null, version: 1, tags: [],
  source: "library", library_name: null, is_enabled: true, is_equipment_module: false,
  documentation: null, hmi_faceplate_type: null, created_by: null,
  updated_at: "", created_at: "",
  blocks: [{ id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB", scl_code: "", block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" }],
  ...over,
});

const motorCm: ControlModuleV2 = {
  control_module_id: "cm1", control_module_name: "M01", control_module_class: "motor",
  is_safety: false, description: "drive motor",
  io_signals: [
    { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "run", source: "field" },
    { tag: "M01_Fault", signal_type: "DI", io_address: "I0.0", description: "fault", source: "field" },
  ] as ControlModuleV2["io_signals"],
};

describe("pickTemplate", () => {
  it("matches by device_category against the device class", () => {
    const t = pickTemplate("M01", "motor", false, [tmpl({}), tmpl({ id: "t2", device_category: "valve" })]);
    expect(t?.id).toBe("t1");
  });
  it("respects the equipment-module flag", () => {
    expect(pickTemplate("Conv", "conveyor", true, [tmpl({})])).toBeNull(); // t1 is CM-level
  });
  it("returns null when nothing scores", () => {
    expect(pickTemplate("Widget", "gizmo", false, [tmpl({ device_category: "valve", name: "Valve", tags: [] })])).toBeNull();
  });
});

describe("instantiateControlModule", () => {
  it("emits an instance DB + call when matched", () => {
    const r = instantiateControlModule(motorCm, [tmpl({})]);
    expect(r.stub).toBeNull();
    expect(r.artifacts.some((a) => a.type === "DB")).toBe(true);
    expect(r.callLines.join("\n")).toContain("(");
    expect(r.callLines.join("\n")).toContain('M01_Fault := "I0.0"');
    expect(r.callLines.join("\n")).toContain('"Q0.0" := #inst.M01_Run');
  });
  it("emits a stub FB with typed interface when unmatched", () => {
    const r = instantiateControlModule(motorCm, []);
    expect(r.stub).not.toBeNull();
    const fb = r.artifacts.find((a) => a.type === "FB");
    expect(fb?.name).toBe("CM_M01");
    expect(fb?.content).toContain("M01_Fault : Bool;");   // DI input
    expect(fb?.content).toContain("M01_Run : Bool;");     // DO output
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`
Expected: FAIL — cannot find module `../fb-instantiate`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/fb-instantiate.ts
import type { ControlModuleV2, EquipmentModuleV2, IoSignalV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact } from "./types";
import { sclIdent } from "./sa-builder";

const FOLDER = "Program blocks";
const ANALOG = new Set(["AI", "AO"]);
const INPUTS = new Set(["DI", "AI"]);

export interface InstantiateResult {
  artifacts: CodegenArtifact[];
  callLines: string[];
  stub: { id: string; name: string; reason: string } | null;
}

/** Score-pick the best library FB for a device. Category/class match dominates,
 *  then name and tag substring hits. Honours the equipment-module + enabled
 *  flags. Deterministic; no AI. */
export function pickTemplate(
  name: string, deviceClass: string, isEm: boolean, templates: FbTemplate[],
): FbTemplate | null {
  const hay = `${name} ${deviceClass}`.toLowerCase();
  let best: FbTemplate | null = null;
  let bestScore = 0;
  for (const t of templates) {
    if (!t.is_enabled || !!t.is_equipment_module !== isEm) continue;
    const cat = (t.device_category ?? "").toLowerCase();
    let score = 0;
    if (cat && deviceClass.toLowerCase() === cat) score += 5;
    else if (cat && hay.includes(cat)) score += 3;
    if (t.name && hay.includes(t.name.toLowerCase())) score += 2;
    for (const tag of t.tags ?? []) if (tag && hay.includes(tag.toLowerCase())) score += 1;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore > 0 ? best : null;
}

/** The FB block name a template imports as (first FB block, else template name). */
function templateBlockName(t: FbTemplate): string {
  const fb = (t.blocks ?? []).find((b) => b.block_type === "FB");
  return fb?.block_name ?? `CM_${sclIdent(t.name)}`;
}

function sclType(sig: IoSignalV2): string {
  return ANALOG.has(sig.signal_type) ? "Int" : "Bool";
}

/** Build the call: a header line, input params read from their address, then
 *  output copies (instance output -> physical address). */
function wiringLines(instance: string, io: IoSignalV2[]): string[] {
  const params = io
    .filter((s) => INPUTS.has(s.signal_type))
    .map((s) => `      ${s.tag} := "${s.io_address}"`);
  const lines = [`   "${instance}"(`, params.join(",\n"), `   );`];
  for (const s of io) {
    if (!INPUTS.has(s.signal_type)) lines.push(`   "${s.io_address}" := #inst.${s.tag};`);
  }
  return lines;
}

/** Emit a stub FB with the device's IO as a typed interface and an empty body. */
function stubFb(prefix: string, name: string, io: IoSignalV2[]): CodegenArtifact {
  const fbName = `${prefix}_${sclIdent(name)}`;
  const inputs = io.filter((s) => INPUTS.has(s.signal_type)).map((s) => `      ${s.tag} : ${sclType(s)};`);
  const outputs = io.filter((s) => !INPUTS.has(s.signal_type)).map((s) => `      ${s.tag} : ${sclType(s)};`);
  const content = [
    `FUNCTION_BLOCK "${fbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_INPUT`, ...inputs, `   END_VAR`,
    `   VAR_OUTPUT`, ...outputs, `   END_VAR`,
    `BEGIN`,
    `   // Stub - body to be implemented (no library FB matched this device).`,
    `END_FUNCTION_BLOCK`,
    ``,
  ].join("\n");
  return { name: fbName, type: "FB", filename: `${fbName}.scl`, content, dependencies: [], folder: FOLDER };
}

/** Shared instantiation for CM and EM. */
function instantiate(
  prefix: string, id: string, name: string, deviceClass: string, isEm: boolean,
  io: IoSignalV2[], templates: FbTemplate[],
): InstantiateResult {
  const t = pickTemplate(name, deviceClass, isEm, templates);
  if (!t) {
    const fb = stubFb(prefix, name, io);
    return {
      artifacts: [fb],
      callLines: wiringLines(`${fb.name}_DB`, io),
      stub: { id, name, reason: `no ${isEm ? "EM" : "CM"} template matched "${deviceClass}"` },
    };
  }
  const block = templateBlockName(t);
  const instance = `${block}_${sclIdent(name)}_DB`;
  const db: CodegenArtifact = {
    name: instance, type: "DB", filename: `${instance}.db`,
    content: [
      `DATA_BLOCK "${instance}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `"${block}"`,
      `BEGIN`,
      `END_DATA_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [block], folder: FOLDER,
  };
  return { artifacts: [db], callLines: wiringLines(instance, io), stub: null };
}

/** Instantiate one Control Module (basic-control FB). */
export function instantiateControlModule(cm: ControlModuleV2, templates: FbTemplate[]): InstantiateResult {
  return instantiate("CM", cm.control_module_id, cm.control_module_name, cm.control_module_class, false, cm.io_signals, templates);
}

/** Instantiate one Equipment Module (procedural-control FB). EM-level IO is the
 *  union of its control modules' signals. */
export function instantiateEquipmentModule(em: EquipmentModuleV2, templates: FbTemplate[]): InstantiateResult {
  const io = em.control_modules.flatMap((c) => c.io_signals);
  return instantiate("EM", em.equipment_module_id, em.equipment_module_name, em.equipment_module_name, true, io, templates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/fb-instantiate.ts src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts
git commit -m "feat(codegen): library FB instantiation, IO wiring + stub fallback"
```

---

### Task 7: OB1 writer

**Goal:** Emit OB1 that calls every device/EM instance wiring block and every per-Unit sequencer FC, in a deterministic order.

**Files:**
- Create: `src/lib/spec-builder/codegen/ob1-writer.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts`

**Acceptance Criteria:**
- [ ] OB1 contains the CM/EM call lines first, then a `UC_<Unit>(db := "DB_<Unit>")` call per Unit.
- [ ] Artifact is named `Main`, type `OB`, filename `Main.ob`, folder `Program blocks`.
- [ ] Dependencies include every `DB_<Unit>` and `UC_<Unit>` referenced.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeOb1 } from "../ob1-writer";

describe("writeOb1", () => {
  const a = writeOb1(
    ['   "CM_Motor_M01_DB"(\n      M01_Fault := "I0.0"\n   );'],
    [{ sclName: "Carriage_Unit" }],
  );
  it("names and types OB1", () => {
    expect(a.name).toBe("Main");
    expect(a.type).toBe("OB");
    expect(a.filename).toBe("Main.ob");
  });
  it("emits device calls then per-Unit sequencer calls", () => {
    expect(a.content).toContain('"CM_Motor_M01_DB"(');
    expect(a.content).toContain('"UC_Carriage_Unit"(db := "DB_Carriage_Unit");');
  });
  it("declares dependencies on the unit DB + FC", () => {
    expect(a.dependencies).toContain("UC_Carriage_Unit");
    expect(a.dependencies).toContain("DB_Carriage_Unit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts`
Expected: FAIL — cannot find module `../ob1-writer`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/ob1-writer.ts
import type { CodegenArtifact } from "./types";

const FOLDER = "Program blocks";

/** Minimal handle on a compiled Unit for the OB1 call tree. */
export interface UnitCallRef {
  sclName: string;
}

/** Emit OB1: device/EM instance calls first, then each Unit's S/A sequencer. */
export function writeOb1(deviceCallLines: string[], units: UnitCallRef[]): CodegenArtifact {
  const unitCalls = units.map((u) => `   "UC_${u.sclName}"(db := "DB_${u.sclName}");`);
  const deps: string[] = [];
  for (const u of units) { deps.push(`UC_${u.sclName}`, `DB_${u.sclName}`); }
  const content = [
    `ORGANIZATION_BLOCK "Main"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   // --- Control / Equipment module instances ---`,
    ...deviceCallLines,
    ``,
    `   // --- Unit sequencers ---`,
    ...unitCalls,
    `END_ORGANIZATION_BLOCK`,
    ``,
  ].join("\n");
  return { name: "Main", type: "OB", filename: "Main.ob", content, dependencies: deps, folder: FOLDER };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/ob1-writer.ts src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts
git commit -m "feat(codegen): OB1 call-tree writer"
```

---

### Task 8: Top-level compile orchestrator

**Goal:** Tie everything together — walk the contract's Unit hierarchy, build each Unit's sequence + artifacts, instantiate CM/EM FBs, write OB1, and return a `CodegenResult` (artifacts + stub report + warnings). Prove it end-to-end on a synthetic 2-EM fixture.

**Files:**
- Create: `src/lib/spec-builder/codegen/compile-contract.ts`
- Create: `src/lib/spec-builder/codegen/index.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`

**Acceptance Criteria:**
- [ ] For each non-excluded Unit, builds the S/A sequence from that Unit's EM contracts (looked up in `contract.equipment_modules` by id), and emits its UDT + DB + FC.
- [ ] Instantiates every Control Module (and Equipment Module) in the hierarchy, collecting artifacts, call lines, and stubs.
- [ ] Emits a single OB1 referencing all device calls + unit sequencers.
- [ ] Returns deduplicated artifacts (library FB instance DBs sharing a block are fine; identical names collapse).
- [ ] Golden test: a Process Cell with one Unit + two EMs (carriage + clamp) compiles to a non-empty artifact set including `UDT_*`, `DB_*`, `UC_*`, `Main`, and reports stubs for unmatched devices.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
import { describe, it, expect } from "vitest";
import { compileContract } from "../compile-contract";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

/** Build a minimal but valid-enough contract: 1 Process Cell → 1 Unit → 2 EMs,
 *  each EM a single control module, with a 2-state machine. We cast through
 *  unknown because the compiler only reads a subset of the full schema. */
function fixture(): SpecContractV2 {
  const io = (tag: string, st: "DI" | "DO", addr: string) => ({
    tag, signal_type: st, io_address: addr, description: tag, source: "field",
  });
  const cm = (id: string, name: string, cls: string) => ({
    control_module_id: id, control_module_name: name, control_module_class: cls,
    is_safety: false, description: name,
    io_signals: [io(`${name}_Run`, "DO", "Q0.0"), io(`${name}_FB`, "DI", "I0.0")],
  });
  const emContract = (emId: string) => ({
    equipment_module_id: emId, unit_id: "unit-1",
    states: [
      { state_id: "idle", name: "idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "active", name: "active", kind: "static", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: `${emId}-t1`, from_state_id: "idle", to_state_id: "active",
        trigger: { kind: "command", expr: { tag: "CMD_GO", operator: "=", value: true } }, guard: [] },
      { transition_id: `${emId}-t2`, from_state_id: "active", to_state_id: "idle",
        trigger: { kind: "command", expr: { tag: "CMD_GO", operator: "=", value: false } }, guard: [] },
    ],
    static_states: { idle: [{ tag: `${emId}_M_Run`, description: "m", state: "STOP" }],
                     active: [{ tag: `${emId}_M_Run`, description: "m", state: "RUN" }] },
    sequential_states: {},
  });
  return {
    schema_version: 3,
    project: { } as SpecContractV2["project"],
    hierarchy: { units: [{
      unit_id: "unit-1", unit_name: "Carriage Unit", equipment_type: "station",
      description: "", excluded: false,
      equipment_modules: [
        { equipment_module_id: "em-carriage", equipment_module_name: "Carriage", description: "",
          control_modules: [cm("cm1", "M01", "motor")] },
        { equipment_module_id: "em-clamp", equipment_module_name: "Clamp", description: "",
          control_modules: [cm("cm2", "SOL1", "solenoid")] },
      ],
    }] },
    alarm_tiers: [],
    equipment_modules: { "em-carriage": emContract("em-carriage"), "em-clamp": emContract("em-clamp") },
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

describe("compileContract", () => {
  const res = compileContract(fixture(), []); // no templates → all stubs

  it("emits the per-Unit sequencer artifacts", () => {
    const names = res.artifacts.map((a) => a.name);
    expect(names).toContain("UDT_Carriage_Unit");
    expect(names).toContain("DB_Carriage_Unit");
    expect(names).toContain("UC_Carriage_Unit");
    expect(names).toContain("Main");
  });

  it("reports a stub per unmatched control module", () => {
    expect(res.stubs.controlModules.map((s) => s.name).sort()).toEqual(["M01", "SOL1"]);
  });

  it("produces a sequence covering both EMs (4 steps total)", () => {
    const udt = res.artifacts.find((a) => a.name === "UDT_Carriage_Unit");
    expect(udt?.content).toContain("S : ARRAY[0..3] OF BOOL;");
  });

  it("produces no duplicate artifact names", () => {
    const names = res.artifacts.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`
Expected: FAIL — cannot find module `../compile-contract`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/spec-builder/codegen/compile-contract.ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact, CodegenResult, StubReport } from "./types";
import { buildUnitSequence } from "./sa-builder";
import { writeUdt } from "./udt-writer";
import { writeSequenceDb } from "./db-writer";
import { writeSequenceFc } from "./fc-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1, type UnitCallRef } from "./ob1-writer";

/**
 * Compile a confirmed FDS into deterministic SCL. Per Unit: derive the S/A
 * sequence from its EM contracts and emit UDT + DB + FC. Across the hierarchy:
 * instantiate each CM/EM library FB (stub on no match) and collect call lines.
 * Finally emit one OB1. Pure: no IO, no AI.
 */
export function compileContract(contract: SpecContractV2, templates: FbTemplate[]): CodegenResult {
  const artifacts: CodegenArtifact[] = [];
  const warnings: string[] = [];
  const stubs: StubReport = { controlModules: [], equipmentModules: [] };
  const deviceCallLines: string[] = [];
  const unitRefs: UnitCallRef[] = [];
  const seenArtifact = new Set<string>();

  const push = (a: CodegenArtifact) => {
    if (seenArtifact.has(a.name)) return;
    seenArtifact.add(a.name);
    artifacts.push(a);
  };

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;

    // --- Per-Unit S/A sequence from this unit's EM contracts ---
    const emContracts = unit.equipment_modules
      .map((em) => contract.equipment_modules[em.equipment_module_id])
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (emContracts.length) {
      const seq = buildUnitSequence(unit.unit_id, unit.unit_name, emContracts, warnings);
      push(writeUdt(seq));
      push(writeSequenceDb(seq));
      push(writeSequenceFc(seq));
      unitRefs.push({ sclName: seq.sclName });
    }

    // --- Instantiate EM-level + CM-level library FBs ---
    for (const em of unit.equipment_modules) {
      const emRes = instantiateEquipmentModule(em, templates);
      emRes.artifacts.forEach(push);
      deviceCallLines.push(...emRes.callLines);
      if (emRes.stub) stubs.equipmentModules.push(emRes.stub);

      for (const cm of em.control_modules) {
        const cmRes = instantiateControlModule(cm, templates);
        cmRes.artifacts.forEach(push);
        deviceCallLines.push(...cmRes.callLines);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
      }
    }
  }

  push(writeOb1(deviceCallLines, unitRefs));
  return { artifacts, stubs, warnings };
}
```

```typescript
// src/lib/spec-builder/codegen/index.ts
export { compileContract } from "./compile-contract";
export type {
  CodegenArtifact, CodegenArtifactType, CodegenResult, StubReport,
  SaSequence, SaStep,
} from "./types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the whole module**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/compile-contract.ts src/lib/spec-builder/codegen/index.ts src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
git commit -m "feat(codegen): top-level FDS->SCL compile orchestrator + golden test"
```

---

### Task 9: Hook + UI trigger (generate + download bundle)

**Goal:** Expose the compiler in the app — a `useSpecCodegen` hook that loads the confirmed contract + FB templates, runs `compileContract`, maps artifacts to the existing TIA export bundle, and a button on the co-author/spec page that triggers it and surfaces the stub report.

**Files:**
- Create: `src/hooks/use-spec-codegen.ts`
- Modify: the spec/co-author page that renders the confirmed FDS (locate with the grep in Step 1) — add a "Generate SCL" button.
- Test: `src/hooks/__tests__/use-spec-codegen.test.ts` (pure mapping helper only)

**Acceptance Criteria:**
- [ ] A pure `toExportArtifacts(result)` helper maps `CodegenArtifact[]` → the `Artifact[]` shape that `buildManifest` / `tia-export` consume (filling required fields with deterministic defaults).
- [ ] `useSpecCodegen` exposes `generate(specProjectId)` returning `{ result, bundleBlob }` and a `stubs` summary; uses `loadSpecContract` + the FB templates query.
- [ ] The button is disabled until the spec `confirmation_status === "confirmed"`.
- [ ] `npx tsc -b` clean; the mapping test passes.

**Verify:** `npx vitest run src/hooks/__tests__/use-spec-codegen.test.ts` && `npx tsc -b`

**Steps:**

- [ ] **Step 1: Locate the host page + confirm the export entry points**

Run:
```bash
grep -rn "confirmation_status\|co-author\|loadSpecContract" src/routes src/components/spec-builder | head -30
grep -n "export function buildManifest\|export .*buildTiaBundle\|export .*Export" src/lib/tia-export.ts src/lib/manifest-builder.ts
```
Expected: identifies the co-author/spec route component and the exact `tia-export` bundle function name (e.g. `buildTiaExportZip`). Use those names in Steps 3–4. If the export function differs from `buildTiaBundle` below, substitute the real name.

- [ ] **Step 2: Write the failing mapping test**

```typescript
// src/hooks/__tests__/use-spec-codegen.test.ts
import { describe, it, expect } from "vitest";
import { toExportArtifacts } from "../use-spec-codegen";
import type { CodegenResult } from "@/lib/spec-builder/codegen";

const result: CodegenResult = {
  artifacts: [
    { name: "UDT_U", type: "UDT", filename: "UDT_U.udt", content: "TYPE", dependencies: [], folder: "PLC data types" },
    { name: "DB_U", type: "DB", filename: "DB_U.db", content: "DATA_BLOCK", dependencies: ["UDT_U"], folder: "Program blocks" },
  ],
  stubs: { controlModules: [], equipmentModules: [] },
  warnings: [],
};

describe("toExportArtifacts", () => {
  const out = toExportArtifacts(result, "proj-1", "sess-1");
  it("maps codegen artifacts onto the Artifact shape", () => {
    expect(out).toHaveLength(2);
    const udt = out.find((a) => a.name === "UDT_U")!;
    expect(udt.type).toBe("UDT");
    expect(udt.content).toBe("TYPE");
    expect(udt.dependencies).toEqual([]);
    expect(udt.project_id).toBe("proj-1");
    expect(udt.destination_folder).toBe("PLC data types");
  });
  it("preserves dependency edges", () => {
    const db = out.find((a) => a.name === "DB_U")!;
    expect(db.dependencies).toEqual(["UDT_U"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-spec-codegen.test.ts`
Expected: FAIL — cannot find module `../use-spec-codegen`.

- [ ] **Step 4: Write the hook + mapping helper**

```typescript
// src/hooks/use-spec-codegen.ts
import { useCallback, useState } from "react";
import type { Artifact } from "@/types";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract, type CodegenResult } from "@/lib/spec-builder/codegen";
import { useFbTemplates } from "@/hooks/use-fb-templates";

/** Map the compiler's lightweight artifacts onto the full Artifact shape the
 *  TIA export plumbing consumes. Required fields get deterministic defaults. */
export function toExportArtifacts(
  result: CodegenResult, projectId: string, sessionId: string,
): Artifact[] {
  return result.artifacts.map((a) => ({
    id: a.name,
    project_id: projectId,
    session_id: sessionId,
    name: a.name,
    type: a.type,
    filename: a.filename,
    content: a.content,
    approved_content: a.content,
    destination_folder: a.folder,
    dependencies: a.dependencies,
    compile_after_import: true,
    overwrite_strategy: "CREATE_OR_UPDATE",
    safety_warnings: [],
    notes: "",
    created_at: new Date().toISOString(),
  }));
}

export interface CodegenRun {
  result: CodegenResult;
  artifacts: Artifact[];
}

/** Load the confirmed FDS + FB templates, compile to SCL, and return artifacts
 *  ready for the TIA export bundle. */
export function useSpecCodegen() {
  const { data: templates = [] } = useFbTemplates();
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<CodegenRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (specProjectId: string) => {
    setRunning(true);
    setError(null);
    try {
      const contract = await loadSpecContract(specProjectId);
      const result = compileContract(contract, templates);
      const artifacts = toExportArtifacts(result, specProjectId, specProjectId);
      const next = { result, artifacts };
      setRun(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setRunning(false);
    }
  }, [templates]);

  return { generate, running, run, error };
}
```

Note: verify `useFbTemplates`'s export name/return in `src/hooks/use-fb-templates.ts` during Step 1; adjust the import/destructure if it differs.

- [ ] **Step 5: Run the mapping test**

Run: `npx vitest run src/hooks/__tests__/use-spec-codegen.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the "Generate SCL" button to the host page**

In the co-author/spec page identified in Step 1, import the hook and render a button gated on confirmation:

```tsx
// inside the page component
import { useSpecCodegen } from "@/hooks/use-spec-codegen";
import { buildTiaBundle } from "@/lib/tia-export"; // use the real export name from Step 1

const { generate, running, run } = useSpecCodegen();

async function handleGenerate() {
  const { result, artifacts } = await generate(specProjectId);
  const blob = await buildTiaBundle(artifacts, {
    projectId: specProjectId, tiaVersion: "V18", cpuType: "S7-1500",
    userId: "spec-codegen", sessionId: specProjectId,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${specProjectId}-scl.zip`;
  link.click();
  URL.revokeObjectURL(url);
  // surface result.stubs in the UI (toast/list)
  void result;
}

<Button disabled={confirmationStatus !== "confirmed" || running} onClick={handleGenerate}>
  {running ? "Generating…" : "Generate SCL"}
</Button>
```

Adapt the `buildTiaBundle` signature to the real one from Step 1 (`manifest-builder.buildManifest` may need to run first — follow the existing TIA export call site as the pattern; search `grep -rn "buildManifest\|tia-export" src/hooks` for an example).

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b`
Expected: no errors. Fix any signature mismatches against the real export functions.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-spec-codegen.ts src/hooks/__tests__/use-spec-codegen.test.ts src/routes src/components/spec-builder
git commit -m "feat(codegen): useSpecCodegen hook + Generate SCL button"
```

---

## Self-Review

- **Spec coverage:** UDT/DB/FC (Tasks 4–5), S/A derived from EM machines (Tasks 2–3), machine-language conditions (Task 1), CM/EM instantiation + stubs (Task 6), OB1 (Task 7), orchestration + export reuse (Tasks 8–9). All design sections map to a task.
- **Generic guarantee:** every fixture is a synthetic motor/clamp/conveyor — no HRE/Segment-Wagon names. The compiler reads only contract fields.
- **Type consistency:** `CodegenArtifact`, `SaSequence`, `SaStep`, `StubReport`, `CodegenResult`, `InstantiateResult`, `UnitCallRef` defined once and reused; `sclIdent` exported from `sa-builder` and imported by `fb-instantiate`.
- **Integration caveats (flagged, not placeholders):** the exact `tia-export` bundle function name and `useFbTemplates` shape are verified in Task 9 Step 1 before use — these are real existing functions, located at execution time rather than guessed.

