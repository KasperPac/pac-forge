# Code Builder EM Layer — C1 (Generation Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic + hybrid-AI generation of per-EM state-machine Function Blocks (the 5-artifact EM bundle) to the Code Builder codegen engine, wire matched library EMs by their `interface_contract`, and supersede the flattened per-Unit sequence with a thin coordination stub.

**Architecture:** Extend the existing pure codegen engine at `src/lib/spec-builder/codegen/`. A new deterministic `em-builder` lowers the hierarchy EM (`EquipmentModuleV2`, for IO) plus its state-machine contract (`EquipmentModuleContract`) into an `EmSequence` IR. `em-writer` serializes that IR into 5 SCL artifacts (EM FB, State UDT, CMD DB, MAP FC, instance DB). The EM FB body interleaves a deterministic CASE skeleton with AI-fill regions delimited by stable markers (`em-fill-regions`); each region pre-fills a deterministic stub so output always compiles. A separate AI path (`em-fill-prompt` + `use-em-generate`) can later replace region bodies without touching the skeleton. Matched library EMs are wired by role from their `interface_contract` instead of the DI/AI address heuristic. `compile-contract` is updated to emit EM artifacts for unmatched EMs that have a contract, and to replace the old flattened per-Unit sequencer with a `UC_<unit>` coordination stub.

**Tech Stack:** TypeScript 5.9 strict (`import type`, no enums, `noUnusedLocals`), vitest, pure functions (no React, no IO) in the codegen library. Verify with `npx vitest run <path>` and `npx tsc -b`.

**Scope (C1 only):** em-builder + em-writer deterministic skeleton, hybrid AI-fill regions (em-fill-regions, em-fill-prompt, use-em-generate), matched-FB `interface_contract` wiring, `MAP_<EM>` + `<EM>_CMD` DB seam, supersede the flattened per-Unit sequence in compile-contract. **Deferred:** C2 (EM-layer UI), C3 (quality + versioning), C4 (promote-to-library).

**Generic-design rule (CLAUDE.md, non-negotiable):** Every prompt/builder change MUST be generic across machine types — no project-specific device names, sequences, or fault conditions. The Functional Specs in `Docs/Functional Specs/` are examples only.

---

## File Structure

**Create:**
- `src/lib/spec-builder/codegen/serialize-completion.ts` — lower `CompletionCriterion[]` → SCL boolean (the inner-SFC analogue of the existing `serialize-condition.ts`, which only handles `PermissiveCondition`).
- `src/lib/spec-builder/codegen/em-builder.ts` — `buildEmSequence(em, contract)` → `EmSequence` IR.
- `src/lib/spec-builder/codegen/em-fill-regions.ts` — AI-fill marker parse / replace / drift helpers.
- `src/lib/spec-builder/codegen/em-writer.ts` — `writeEmArtifacts(seq)` → 5 `CodegenArtifact`s + OB1 call line.
- `src/lib/spec-builder/em-fill-prompt.ts` — generic, contract-driven AI fill prompt builder.
- `src/hooks/use-em-generate.ts` — orchestrator `fillEmFb()` + thin React hook.
- Tests: `serialize-completion.test.ts`, `em-builder.test.ts`, `em-fill-regions.test.ts`, `em-writer.test.ts`, `em-fill-prompt.test.ts` (all under `src/lib/spec-builder/codegen/__tests__/` except the prompt test under `src/lib/spec-builder/__tests__/`).

**Modify:**
- `src/lib/spec-builder/codegen/types.ts` — add `EmSeqStep`, `EmSeqState`, `EmSequence`.
- `src/lib/spec-builder/codegen/sa-builder.ts` — `export` the existing local `staticEntries`.
- `src/lib/spec-builder/codegen/index.ts` — re-export EM IR types + `buildEmSequence` + `writeEmArtifacts`.
- `src/lib/spec-builder/codegen/fb-instantiate.ts` — role-based contract wiring + `warnings` on result.
- `src/lib/spec-builder/codegen/compile-contract.ts` — EM-writer integration + coordination stub.
- `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` — rewrite assertions for the new output.
- `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts` — add contract-wiring cases.

---

### Task 1: EM IR + completion serializer + em-builder

**Goal:** Lower a hierarchy EM + its state-machine contract into an `EmSequence` IR, with a new `CompletionCriterion → SCL` serializer and pin-mapped condition support.

**Files:**
- Modify: `src/lib/spec-builder/codegen/sa-builder.ts` (export `staticEntries`)
- Modify: `src/lib/spec-builder/codegen/serialize-condition.ts` (optional pin mapper)
- Create: `src/lib/spec-builder/codegen/serialize-completion.ts`
- Modify: `src/lib/spec-builder/codegen/types.ts` (EM IR types)
- Create: `src/lib/spec-builder/codegen/em-builder.ts`
- Modify: `src/lib/spec-builder/codegen/index.ts` (re-exports)
- Test: `src/lib/spec-builder/codegen/__tests__/serialize-completion.test.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`

**Acceptance Criteria:**
- [ ] `serializeCompletion`/`serializeCompletionGuard` lower every `CompletionCriterion` kind; `manual_ack`/`placeholder` → `FALSE` and are flagged unevaluable.
- [ ] `serializeCondition`/`serializeGuard`/`serializeAdvance` accept an optional pin mapper; existing identity behaviour unchanged.
- [ ] `buildEmSequence` produces ordered states (home/safe first), `fb_`/`cmd_`/`ilk_` pins for every referenced tag, static commands, linear steps with `fillId` + advance SCL, and state exits.
- [ ] Manual/placeholder steps and out-of-EM/parallel transitions add warnings, never throw.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/serialize-completion.test.ts src/lib/spec-builder/codegen/__tests__/em-builder.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Export `staticEntries`; add optional pin mapper to serialize-condition**

In `src/lib/spec-builder/codegen/sa-builder.ts`, change the `staticEntries` declaration to export it:

```ts
/** Static-state rows are either a bare entry array (legacy) or a StaticStateV2. */
export function staticEntries(
  value: ControlModuleStateEntry[] | StaticStateV2 | undefined,
): ControlModuleStateEntry[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.control_modules;
}
```

In `src/lib/spec-builder/codegen/serialize-condition.ts`, replace the three functions with pin-mapper-aware versions (default identity → existing callers unaffected):

```ts
export function serializeCondition(
  c: PermissiveCondition,
  pin: (tag: string) => string = (t) => t,
): string {
  if (c.value === "P_TRIG") return pin(c.tag);
  if (c.value === "N_TRIG") return `NOT ${pin(c.tag)}`;
  const op = OP_MAP[c.operator];
  if (typeof c.value === "boolean") return `${pin(c.tag)} ${op} ${c.value ? "TRUE" : "FALSE"}`;
  return `${pin(c.tag)} ${op} ${c.value}`;
}

/** AND-join a guard list, each term parenthesised. Empty guard → `TRUE`. */
export function serializeGuard(
  guard: PermissiveCondition[],
  pin: (tag: string) => string = (t) => t,
): string {
  if (!guard.length) return "TRUE";
  return guard.map((c) => `(${serializeCondition(c, pin)})`).join(" AND ");
}

/**
 * A transition's full advance condition. A `command` trigger ANDs its
 * expression with the guard; a `completion` trigger contributes no extra term,
 * so the guard alone is the advance.
 */
export function serializeAdvance(
  trigger: EmTrigger,
  guard: PermissiveCondition[],
  pin: (tag: string) => string = (t) => t,
): string {
  const guardStr = serializeGuard(guard, pin);
  if (trigger.kind === "completion") return guardStr;
  const trig = `(${serializeCondition(trigger.expr, pin)})`;
  return guardStr === "TRUE" ? trig : `${trig} AND ${guardStr}`;
}
```

- [ ] **Step 2: Write `serialize-completion.ts`**

Create `src/lib/spec-builder/codegen/serialize-completion.ts`:

```ts
import type { CompletionCriterion } from "@/types/spec-contract-v2";

/** tag_compare op → SCL operator (`==` becomes `=`). */
const CMP_OP: Record<"<" | "<=" | ">" | ">=" | "==", string> = {
  "<": "<", "<=": "<=", ">": ">", ">=": ">=", "==": "=",
};

/** Render a literal for an SCL equality term. */
function literal(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return value;
}

/** True when a criterion cannot be evaluated deterministically. */
export function isUnevaluable(c: CompletionCriterion): boolean {
  return c.kind === "manual_ack" || c.kind === "placeholder";
}

/**
 * Lower ONE completion criterion to an SCL boolean term. `pin` maps a contract
 * tag to its FB-local pin reference (e.g. `brake_open` → `#fb_brake_open`);
 * unmapped tags pass through. `manual_ack`/`placeholder` cannot be evaluated
 * deterministically → render `FALSE`; callers should record a warning so the
 * step is never silently auto-advanced.
 */
export function serializeCompletion(
  c: CompletionCriterion,
  pin: (tag: string) => string = (t) => t,
): string {
  switch (c.kind) {
    case "tag_equals":
      return `${pin(c.tag)} = ${literal(c.value)}`;
    case "tag_compare":
      return `${pin(c.tag)} ${CMP_OP[c.op]} ${c.value}`;
    case "expression":
      return `(${c.text})`;
    case "manual_ack":
    case "placeholder":
      return "FALSE";
  }
}

/** AND-join a criteria list, each term parenthesised. Empty → `TRUE`. */
export function serializeCompletionGuard(
  cs: CompletionCriterion[],
  pin: (tag: string) => string = (t) => t,
): string {
  if (!cs.length) return "TRUE";
  return cs.map((c) => `(${serializeCompletion(c, pin)})`).join(" AND ");
}
```

Create `src/lib/spec-builder/codegen/__tests__/serialize-completion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CompletionCriterion } from "@/types/spec-contract-v2";
import {
  serializeCompletion, serializeCompletionGuard, isUnevaluable,
} from "../serialize-completion";

describe("serializeCompletion", () => {
  it("lowers tag_equals with boolean and pin mapping", () => {
    const c: CompletionCriterion = { kind: "tag_equals", tag: "brake_open", value: true };
    expect(serializeCompletion(c, (t) => `#fb_${t}`)).toBe("#fb_brake_open = TRUE");
  });
  it("lowers tag_equals with numeric and string literals", () => {
    expect(serializeCompletion({ kind: "tag_equals", tag: "pos", value: 5 })).toBe("pos = 5");
    expect(serializeCompletion({ kind: "tag_equals", tag: "mode", value: "AUTO" })).toBe("mode = AUTO");
  });
  it("maps tag_compare == to SCL =", () => {
    const c: CompletionCriterion = { kind: "tag_compare", tag: "speed", op: "==", value: 100 };
    expect(serializeCompletion(c)).toBe("speed = 100");
  });
  it("passes tag_compare numeric operators through", () => {
    expect(serializeCompletion({ kind: "tag_compare", tag: "p", op: ">=", value: 3 })).toBe("p >= 3");
  });
  it("wraps expression text in parens", () => {
    const c: CompletionCriterion = { kind: "expression", text: "a AND b", referenced_tags: ["a", "b"] };
    expect(serializeCompletion(c)).toBe("(a AND b)");
  });
  it("renders unevaluable criteria as FALSE", () => {
    expect(serializeCompletion({ kind: "manual_ack", prompt: "ok?" })).toBe("FALSE");
    expect(serializeCompletion({ kind: "placeholder", criterion_id: "x", prompt: "tbd" })).toBe("FALSE");
  });
});

describe("isUnevaluable", () => {
  it("flags manual_ack and placeholder only", () => {
    expect(isUnevaluable({ kind: "manual_ack", prompt: "p" })).toBe(true);
    expect(isUnevaluable({ kind: "placeholder", criterion_id: "x", prompt: "p" })).toBe(true);
    expect(isUnevaluable({ kind: "tag_equals", tag: "t", value: true })).toBe(false);
  });
});

describe("serializeCompletionGuard", () => {
  it("returns TRUE for an empty guard", () => {
    expect(serializeCompletionGuard([])).toBe("TRUE");
  });
  it("AND-joins parenthesised terms with pin mapping", () => {
    const cs: CompletionCriterion[] = [
      { kind: "tag_equals", tag: "a", value: true },
      { kind: "tag_compare", tag: "b", op: ">", value: 2 },
    ];
    expect(serializeCompletionGuard(cs, (t) => `#fb_${t}`))
      .toBe("(#fb_a = TRUE) AND (#fb_b > 2)");
  });
});
```

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/serialize-completion.test.ts`
Expected: PASS (10 assertions).

- [ ] **Step 3: Add EM IR types to `types.ts` and re-export from `index.ts`**

Append to `src/lib/spec-builder/codegen/types.ts`:

```ts
/** A sensor/actuator pin declared on a generated EM FB. */
export interface EmPin {
  /** Bare SCL identifier, e.g. `fb_brake_open` (no leading `#`). */
  name: string;
  /** Original contract tag this pin mirrors. */
  tag: string;
  scl_type: "Bool" | "Int";
  /** Physical IO address for the MAP FC (empty when none is known). */
  address: string;
}

/** One linear SFC step inside a sequential EM state. */
export interface EmSeqStep {
  /** 1-based step counter within its state. */
  step: number;
  /** Stable region id `${stateId}.${step}` — drives the AI-fill markers. */
  fillId: string;
  /** Action prose (deterministic stub body + AI brief). */
  actionProse: string;
  /** SCL boolean that advances PAST this step; `TRUE` when none. */
  advance: string;
  /** True when any completion criterion is manual/placeholder. */
  manual: boolean;
}

/** One state in the ordered EM state machine. */
export interface EmSeqState {
  stateId: string;
  name: string;
  /** 0-based dispatch index; 0 is the home/safe state. */
  index: number;
  kind: "static" | "sequential";
  isSafe: boolean;
  /** Static-state actuator commands: pin + whether driven active. */
  staticCommands: { pin: string; active: boolean }[];
  /** Linear SFC steps (sequential states only). */
  steps: EmSeqStep[];
  /** Outgoing edges to other state indices. */
  exits: { toIndex: number; condition: string; viaCompletion: boolean }[];
}

/** Lowered, serialization-ready IR for one EM Function Block. */
export interface EmSequence {
  emId: string;
  emName: string;
  sclName: string;
  states: EmSeqState[];
  /** Fixed command inputs every EM FB exposes. */
  cmdPins: string[];
  /** Coordination interlock inputs (unwired in C1; Unit layer wires them). */
  interlockPins: string[];
  /** Sensor feedback inputs (own DI/AI). */
  sensors: EmPin[];
  /** Actuator command outputs (carry their physical address for the MAP FC). */
  actuators: EmPin[];
  warnings: string[];
}
```

Replace the type re-export block in `src/lib/spec-builder/codegen/index.ts`. For Task 1, export only `buildEmSequence` (the `writeEmArtifacts` line is deferred to Task 3, which creates that module — adding it here would break `tsc -b`):

```ts
export { compileContract } from "./compile-contract";
export { filterByLayer } from "./layer-filter";
export { buildEmSequence } from "./em-builder";
export type {
  CodegenArtifact, CodegenArtifactType, CodegenLayer, CodegenResult, StubReport,
  SaSequence, SaStep, EmSequence, EmSeqState, EmSeqStep, EmPin,
} from "./types";
```

- [ ] **Step 4: Write `em-builder.ts` + test**

Create `src/lib/spec-builder/codegen/em-builder.ts`:

```ts
import type {
  EquipmentModuleV2, EquipmentModuleContract, IoSignalV2,
  PhaseStep, CompletionCriterion,
} from "@/types/spec-contract-v2";
import { orderStates } from "./step-order";
import { sclIdent, isActiveCommand, staticEntries } from "./sa-builder";
import { serializeAdvance } from "./serialize-condition";
import { serializeCompletionGuard, isUnevaluable } from "./serialize-completion";
import type { EmPin, EmSeqState, EmSeqStep, EmSequence } from "./types";

const INPUT_TYPES = new Set<string>(["DI", "AI"]);
const OUTPUT_TYPES = new Set<string>(["DO", "AO"]);
const ANALOG_TYPES = new Set<string>(["AI", "AO"]);
const CMD_PINS = ["cmd_start", "cmd_stop", "cmd_hold", "cmd_reset"];

/** Pick legacy action prose, else the first structured action's prose. */
function stepProse(s: PhaseStep): string {
  if (s.action && s.action.trim()) return s.action.trim();
  const a = s.actions?.[0];
  return a?.prose?.trim() || `Step ${s.step}`;
}

/** Criteria that advance past a step: first single-transition guard, else the
 *  legacy completion criteria. */
function stepCriteria(s: PhaseStep): CompletionCriterion[] {
  const single = s.transitions?.find((t) => t.kind === "single");
  if (single && single.guard.length) return single.guard;
  return s.completion_criteria ?? [];
}

/**
 * Lower a hierarchy EM (for IO) plus its state-machine contract into the
 * EmSequence IR consumed by em-writer. Pure, deterministic, never throws —
 * structural problems are reported via `warnings`. Generic across machine
 * types: no device names or sequences are special-cased.
 */
export function buildEmSequence(
  em: EquipmentModuleV2,
  contract: EquipmentModuleContract,
): EmSequence {
  const warnings: string[] = [];

  // classify own IO
  const io: IoSignalV2[] = em.control_modules.flatMap((c) => c.io_signals);
  const ownInput = new Map<string, IoSignalV2>();
  const ownOutput = new Map<string, IoSignalV2>();
  for (const s of io) {
    if (INPUT_TYPES.has(s.signal_type)) ownInput.set(s.tag, s);
    else if (OUTPUT_TYPES.has(s.signal_type)) ownOutput.set(s.tag, s);
  }

  // pin registries (insertion-ordered)
  const sensors = new Map<string, EmPin>();
  const actuators = new Map<string, EmPin>();
  const interlocks = new Map<string, string>();

  const sensorPin = (tag: string): string => {
    const name = `fb_${sclIdent(tag)}`;
    if (!sensors.has(name)) {
      const sig = ownInput.get(tag);
      sensors.set(name, {
        name, tag,
        scl_type: sig && ANALOG_TYPES.has(sig.signal_type) ? "Int" : "Bool",
        address: sig?.io_address ?? "",
      });
    }
    return name;
  };
  const actuatorPin = (tag: string): string => {
    const name = `cmd_${sclIdent(tag)}`;
    if (!actuators.has(name)) {
      const sig = ownOutput.get(tag);
      actuators.set(name, {
        name, tag,
        scl_type: sig && ANALOG_TYPES.has(sig.signal_type) ? "Int" : "Bool",
        address: sig?.io_address ?? "",
      });
    }
    return name;
  };
  const interlockPin = (tag: string): string => {
    const name = `ilk_${sclIdent(tag)}`;
    if (!interlocks.has(name)) interlocks.set(name, tag);
    return name;
  };

  /** Map a referenced tag to its FB-local `#pin`. Own inputs → `#fb_`, own
   *  outputs → `#cmd_`, everything else is a coordination input `#ilk_`. */
  const pinRef = (tag: string): string => {
    if (ownInput.has(tag)) return `#${sensorPin(tag)}`;
    if (ownOutput.has(tag)) return `#${actuatorPin(tag)}`;
    return `#${interlockPin(tag)}`;
  };

  // order states; first is home/safe
  const ordered = orderStates(contract.states, contract.transitions);
  const indexOf = new Map<string, number>();
  ordered.forEach((s, i) => indexOf.set(s.state_id, i));

  const states: EmSeqState[] = ordered.map((st, index) => {
    const staticCommands = staticEntries(contract.static_states[st.state_id]).map((e) => ({
      pin: actuatorPin(e.tag),
      active: isActiveCommand(e.state),
    }));

    const steps: EmSeqStep[] = [];
    if (st.kind === "sequential") {
      const seq = contract.sequential_states[st.state_id];
      const sorted = [...(seq?.steps ?? [])].sort((a, b) => a.step - b.step);
      if (sorted.some((ps) => ps.transitions?.some((t) => t.kind === "parallel"))) {
        warnings.push(`EM ${em.equipment_module_name}: state ${st.state_id} has parallel branches — collapsed to a linear sequence`);
      }
      sorted.forEach((ps, i) => {
        const criteria = stepCriteria(ps);
        const manual = criteria.some(isUnevaluable);
        if (manual) {
          warnings.push(`EM ${em.equipment_module_name}: step ${st.state_id}.${i + 1} has a manual/placeholder completion — will not auto-advance`);
        }
        steps.push({
          step: i + 1,
          fillId: `${st.state_id}.${i + 1}`,
          actionProse: stepProse(ps),
          advance: serializeCompletionGuard(criteria, pinRef),
          manual,
        });
      });
    }

    return { stateId: st.state_id, name: st.name, index, kind: st.kind, isSafe: st.is_safe_state, staticCommands, steps, exits: [] };
  });

  for (const t of contract.transitions) {
    const from = indexOf.get(t.from_state_id);
    const to = indexOf.get(t.to_state_id);
    if (from === undefined || to === undefined) {
      warnings.push(`EM ${em.equipment_module_name}: transition ${t.transition_id} targets an unknown state — skipped`);
      continue;
    }
    states[from].exits.push({
      toIndex: to,
      condition: serializeAdvance(t.trigger, t.guard, pinRef),
      viaCompletion: t.trigger.kind === "completion",
    });
  }

  return {
    emId: em.equipment_module_id,
    emName: em.equipment_module_name,
    sclName: sclIdent(em.equipment_module_name),
    states,
    cmdPins: [...CMD_PINS],
    interlockPins: [...interlocks.keys()],
    sensors: [...sensors.values()],
    actuators: [...actuators.values()],
    warnings,
  };
}
```

Create `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type {
  EquipmentModuleV2, EquipmentModuleContract,
} from "@/types/spec-contract-v2";
import { buildEmSequence } from "../em-builder";

function em(): EquipmentModuleV2 {
  return {
    equipment_module_id: "em-drive",
    equipment_module_name: "Carriage Drive",
    description: "",
    control_modules: [{
      control_module_id: "cm-1",
      control_module_name: "Drive",
      control_module_class: "motor",
      is_safety: false,
      description: "",
      io_signals: [
        { tag: "brake_open", signal_type: "DI", io_address: "I0.0", description: "", source: "wired" },
        { tag: "run_cmd", signal_type: "DO", io_address: "Q0.0", description: "", source: "wired" },
      ],
    }],
  };
}

function contract(): EquipmentModuleContract {
  return {
    equipment_module_id: "em-drive",
    unit_id: "u-1",
    states: [
      { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "running", name: "Running", kind: "sequential", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: "t1", from_state_id: "idle", to_state_id: "running",
        trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } },
        guard: [{ tag: "brake_open", operator: "=", value: true }] },
      { transition_id: "t2", from_state_id: "running", to_state_id: "idle",
        trigger: { kind: "completion" }, guard: [] },
    ],
    static_states: {
      idle: [{ tag: "run_cmd", description: "stop", state: "off" }],
    },
    sequential_states: {
      running: {
        permissives: [],
        notes: null,
        steps: [{
          step: 1, action: "Accelerate to speed",
          completion_criteria: [{ kind: "tag_compare", tag: "speed", op: ">=", value: 100 }],
          completion_criteria_text: "speed >= 100",
        }],
      },
    },
  };
}

describe("buildEmSequence", () => {
  it("orders states with the safe state first", () => {
    const seq = buildEmSequence(em(), contract());
    expect(seq.states.map((s) => s.stateId)).toEqual(["idle", "running"]);
    expect(seq.states[0].index).toBe(0);
    expect(seq.states[0].isSafe).toBe(true);
  });

  it("derives sensor/actuator/interlock pins from referenced tags", () => {
    const seq = buildEmSequence(em(), contract());
    expect(seq.sensors.map((p) => p.name)).toContain("fb_brake_open");
    expect(seq.sensors.find((p) => p.name === "fb_brake_open")!.address).toBe("I0.0");
    expect(seq.actuators.map((p) => p.name)).toContain("cmd_run_cmd");
    expect(seq.actuators.find((p) => p.name === "cmd_run_cmd")!.address).toBe("Q0.0");
    // cmd_start is not own IO → coordination interlock pin
    expect(seq.interlockPins).toContain("ilk_cmd_start");
  });

  it("emits a linear step with fillId and pin-mapped advance", () => {
    const seq = buildEmSequence(em(), contract());
    const running = seq.states.find((s) => s.stateId === "running")!;
    expect(running.steps).toHaveLength(1);
    expect(running.steps[0].fillId).toBe("running.1");
    expect(running.steps[0].advance).toBe("(speed >= 100)");
    expect(running.steps[0].actionProse).toBe("Accelerate to speed");
  });

  it("records static commands and state exits", () => {
    const seq = buildEmSequence(em(), contract());
    const idle = seq.states.find((s) => s.stateId === "idle")!;
    expect(idle.staticCommands).toEqual([{ pin: "cmd_run_cmd", active: false }]);
    expect(idle.exits).toEqual([
      { toIndex: 1, condition: "(#ilk_cmd_start = TRUE) AND (#fb_brake_open = TRUE)", viaCompletion: false },
    ]);
    const running = seq.states.find((s) => s.stateId === "running")!;
    expect(running.exits[0].viaCompletion).toBe(true);
  });

  it("warns on an out-of-EM transition target without throwing", () => {
    const c = contract();
    c.transitions.push({ transition_id: "t3", from_state_id: "idle", to_state_id: "ghost",
      trigger: { kind: "completion" }, guard: [] });
    const seq = buildEmSequence(em(), c);
    expect(seq.warnings.some((w) => w.includes("t3"))).toBe(true);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -b` (note: `index.ts` references `buildEmSequence` only — `writeEmArtifacts` is added in Task 3).
Expected: clean.

```bash
git add src/lib/spec-builder/codegen/serialize-completion.ts \
  src/lib/spec-builder/codegen/em-builder.ts \
  src/lib/spec-builder/codegen/sa-builder.ts \
  src/lib/spec-builder/codegen/serialize-condition.ts \
  src/lib/spec-builder/codegen/types.ts \
  src/lib/spec-builder/codegen/index.ts \
  src/lib/spec-builder/codegen/__tests__/serialize-completion.test.ts \
  src/lib/spec-builder/codegen/__tests__/em-builder.test.ts
git commit -m "feat(code-builder): EM sequence IR + completion serializer (C1 Task 1)"
```

---

### Task 2: AI-fill region markers

**Goal:** Stable marker helpers that let the AI replace only an SFC step body while the deterministic skeleton stays byte-identical.

**Files:**
- Create: `src/lib/spec-builder/codegen/em-fill-regions.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/em-fill-regions.test.ts`

**Acceptance Criteria:**
- [ ] `regionId(sclName, fillId)` and `renderRegion`/`defaultStub` produce stable `// <ai-fill id>` … `// </ai-fill id>` blocks.
- [ ] `parseRegions` round-trips every region body (handles `\r\n` and `\n`).
- [ ] `replaceRegion` swaps exactly one region's body, leaving markers and all other regions byte-identical; unknown id is a no-op.
- [ ] `regionDrift(a, b)` returns ids whose bodies differ between two versions.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/em-fill-regions.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write `em-fill-regions.ts`**

Create `src/lib/spec-builder/codegen/em-fill-regions.ts`:

```ts
/**
 * AI-fill region markers. A generated EM FB interleaves a deterministic
 * skeleton with AI-fillable regions delimited by stable comment markers:
 *
 *   // <ai-fill Carriage_Drive:running.1>
 *   ...region body (AI- or stub-filled)...
 *   // </ai-fill Carriage_Drive:running.1>
 *
 * The markers are the contract between the deterministic writer (em-writer)
 * and the AI fill path (use-em-generate): the AI may rewrite a body but never
 * the markers or the surrounding skeleton, so the audit backbone is
 * reproducible. Pure string helpers — no IO, no AI.
 */

/** Compose a region id from the FB SCL name and the step's fillId. */
export function regionId(sclName: string, fillId: string): string {
  return `${sclName}:${fillId}`;
}

/** Escape a region id for use inside a dynamic RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deterministic placeholder body for an unfilled region (valid SCL comment,
 *  so the FB always compiles even before any AI fill). */
export function defaultStub(prose: string, indent = ""): string {
  return `${indent}// TODO (AI-fill): ${prose}`;
}

/** Wrap a body in open/close markers at the given indent. `body` is emitted
 *  verbatim (callers pre-indent their body lines). */
export function renderRegion(id: string, body: string, indent = ""): string {
  return `${indent}// <ai-fill ${id}>\n${body}\n${indent}// </ai-fill ${id}>`;
}

/** Extract every region body keyed by id. Tolerant of `\r\n` and `\n`. */
export function parseRegions(scl: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\/\/ <ai-fill ([^>\n]+)>\r?\n([\s\S]*?)\r?\n[ \t]*\/\/ <\/ai-fill \1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scl)) !== null) out.set(m[1], m[2]);
  return out;
}

/** Replace exactly one region's body. Markers are preserved; an unknown id is
 *  a no-op (returns the input unchanged). */
export function replaceRegion(scl: string, id: string, body: string): string {
  const re = new RegExp(
    `(// <ai-fill ${esc(id)}>\\r?\\n)([\\s\\S]*?)(\\r?\\n[ \\t]*// <\\/ai-fill ${esc(id)}>)`,
  );
  return scl.replace(re, (_m, open: string, _old: string, close: string) => `${open}${body}${close}`);
}

/** Region ids whose bodies differ between two FB versions (present in both). */
export function regionDrift(a: string, b: string): string[] {
  const ra = parseRegions(a);
  const rb = parseRegions(b);
  const drift: string[] = [];
  for (const [id, body] of ra) if (rb.has(id) && rb.get(id) !== body) drift.push(id);
  return drift;
}
```

- [ ] **Step 2: Write the test**

Create `src/lib/spec-builder/codegen/__tests__/em-fill-regions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  regionId, defaultStub, renderRegion, parseRegions, replaceRegion, regionDrift,
} from "../em-fill-regions";

const ID = regionId("EM_Drive", "running.1");

function doc(body: string): string {
  return [
    "         10:",
    renderRegion(ID, body, "         "),
    "         20: ;",
  ].join("\n");
}

describe("region markers", () => {
  it("composes a stable region id", () => {
    expect(ID).toBe("EM_Drive:running.1");
  });

  it("renders open/close markers around a body", () => {
    const r = renderRegion(ID, "   #x := TRUE;", "");
    expect(r).toBe("// <ai-fill EM_Drive:running.1>\n   #x := TRUE;\n// </ai-fill EM_Drive:running.1>");
  });

  it("parses a region body back out", () => {
    const regions = parseRegions(doc(defaultStub("ramp drive", "            ")));
    expect(regions.get(ID)).toBe("            // TODO (AI-fill): ramp drive");
  });

  it("parses CRLF documents", () => {
    const crlf = doc("   #x := TRUE;").replace(/\n/g, "\r\n");
    expect(parseRegions(crlf).get(ID)).toBe("   #x := TRUE;");
  });

  it("replaces exactly one region body, preserving markers and siblings", () => {
    const before = doc(defaultStub("ramp drive", "            "));
    const after = replaceRegion(before, ID, "            #cmd_run := TRUE;");
    expect(after).toContain("// <ai-fill EM_Drive:running.1>");
    expect(after).toContain("            #cmd_run := TRUE;");
    expect(after).toContain("// </ai-fill EM_Drive:running.1>");
    expect(after).toContain("         20: ;");
    expect(parseRegions(after).get(ID)).toBe("            #cmd_run := TRUE;");
  });

  it("is a no-op for an unknown region id", () => {
    const before = doc("   #x := TRUE;");
    expect(replaceRegion(before, "EM_Drive:does.not.exist", "   #y := FALSE;")).toBe(before);
  });

  it("detects body drift between two versions", () => {
    const a = doc("   #x := TRUE;");
    const b = replaceRegion(a, ID, "   #x := FALSE;");
    expect(regionDrift(a, b)).toEqual([ID]);
    expect(regionDrift(a, a)).toEqual([]);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-fill-regions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc -b` → clean.

```bash
git add src/lib/spec-builder/codegen/em-fill-regions.ts \
  src/lib/spec-builder/codegen/__tests__/em-fill-regions.test.ts
git commit -m "feat(code-builder): AI-fill region markers (C1 Task 2)"
```

---

### Task 3: em-writer — the 5-artifact EM bundle

**Goal:** Serialize an `EmSequence` into the EM FB (with AI-fill regions), State UDT, CMD DB, MAP FC, and instance DB, plus the OB1 call lines.

**Files:**
- Create: `src/lib/spec-builder/codegen/em-writer.ts`
- Modify: `src/lib/spec-builder/codegen/index.ts` (add `writeEmArtifacts` export)
- Test: `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`

**Acceptance Criteria:**
- [ ] `writeEmArtifacts(seq)` returns 5 artifacts (FB, UDT, DB, FC, DB), all `layer:"em"` with `ownerId`/`ownerName` set to the EM.
- [ ] The FB body is a `CASE #state OF` with one branch per state; sequential states nest `CASE #step OF`; each step body is an AI-fill region pre-filled with a deterministic stub; advances bump `#step`/set `#done`.
- [ ] State exits compile to guarded transitions — completion edges gate on `#done`, command edges on their condition; sequential targets reset `#step`.
- [ ] `MAP_<EM>` wires sensors `instanceDB.pin := "<addr>"` and actuators `"<addr>" := instanceDB.pin`; missing addresses become `// TODO wire …` comments.
- [ ] `callLines` instantiate the FB from `<EM>_CMD` and call `MAP_<EM>`.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/em-writer.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write `em-writer.ts`**

Create `src/lib/spec-builder/codegen/em-writer.ts`:

```ts
import type { CodegenArtifact, EmSeqState, EmSeqStep, EmSequence } from "./types";
import { regionId, renderRegion, defaultStub } from "./em-fill-regions";

const PROGRAM = "Program blocks";
const DATA = "PLC data types";

function pad(n: number): string {
  return " ".repeat(n);
}

/** Entry assignment for a transition; sequential targets also reset #step. */
function enterStmt(toIndex: number, targetSequential: boolean): string {
  const base = `#state := ${toIndex}; #done := FALSE;`;
  return targetSequential ? `${base} #step := 1;` : base;
}

/** One outgoing edge as a guarded transition. Completion edges gate on #done;
 *  command edges gate on their serialized condition. */
function exitLine(
  exit: EmSeqState["exits"][number], states: EmSeqState[], indent: number,
): string {
  const enter = enterStmt(exit.toIndex, states[exit.toIndex].kind === "sequential");
  if (exit.viaCompletion) {
    const gate = exit.condition === "TRUE" ? "#done" : `#done AND ${exit.condition}`;
    return `${pad(indent)}IF ${gate} THEN ${enter} END_IF;`;
  }
  return `${pad(indent)}IF ${exit.condition} THEN ${enter} END_IF;`;
}

/** Advance after a step body: the last step sets #done, others bump #step. An
 *  always-true advance is emitted unconditionally. */
function advanceLine(step: EmSeqStep, isLast: boolean, indent: number): string {
  const target = isLast ? `#done := TRUE;` : `#step := ${step.step + 1};`;
  if (step.advance === "TRUE") return `${pad(indent)}${target}`;
  return `${pad(indent)}IF ${step.advance} THEN ${target} END_IF;`;
}

/** Lower one state to its CASE branch lines. */
function stateBranch(seq: EmSequence, st: EmSeqState, states: EmSeqState[]): string[] {
  const out: string[] = [`${pad(6)}${st.index}:   // ${st.name}${st.isSafe ? " (safe)" : ""}`];
  if (st.kind === "sequential") {
    out.push(`${pad(9)}CASE #step OF`);
    st.steps.forEach((step, i) => {
      out.push(`${pad(12)}${step.step}:`);
      out.push(renderRegion(regionId(seq.sclName, step.fillId), defaultStub(step.actionProse, pad(15)), pad(15)));
      out.push(advanceLine(step, i === st.steps.length - 1, 15));
    });
    out.push(`${pad(9)}END_CASE;`);
  } else {
    for (const c of st.staticCommands) {
      out.push(`${pad(9)}#${c.pin} := ${c.active ? "TRUE" : "FALSE"};`);
    }
  }
  for (const exit of st.exits) out.push(exitLine(exit, states, 9));
  // every CASE branch must hold at least one statement
  if (st.kind === "static" && !st.staticCommands.length && !st.exits.length) {
    out.push(`${pad(9)};`);
  }
  return out;
}

/** The procedural EM Function Block: typed interface + CASE state/step skeleton
 *  with AI-fill regions for the step bodies. */
function writeFb(seq: EmSequence): CodegenArtifact {
  const name = `EM_${seq.sclName}`;
  const inputs = [
    `      enable : Bool;`,
    `      mode : Int;`,
    ...seq.cmdPins.map((p) => `      ${p} : Bool;`),
    ...seq.interlockPins.map((p) => `      ${p} : Bool;`),
    ...seq.sensors.map((p) => `      ${p.name} : ${p.scl_type};`),
  ];
  const outputs = [
    `      state : Int;`,
    `      step : Int;`,
    `      done : Bool;`,
    `      fault : Bool;`,
    ...seq.actuators.map((p) => `      ${p.name} : ${p.scl_type};`),
  ];
  const body = seq.states.flatMap((st) => stateBranch(seq, st, seq.states));
  const content = [
    `FUNCTION_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_INPUT`, ...inputs, `   END_VAR`,
    `   VAR_OUTPUT`, ...outputs, `   END_VAR`,
    ``,
    `BEGIN`,
    `   CASE #state OF`,
    ...body,
    `   END_CASE;`,
    `END_FUNCTION_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "FB", filename: `${name}.scl`, content, dependencies: [], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** Status UDT mirroring the FB's status outputs. */
function writeStateUdt(seq: EmSequence): CodegenArtifact {
  const name = `EM_${seq.sclName}_State`;
  const content = [
    `TYPE "${name}"`,
    `VERSION : 0.1`,
    `   STRUCT`,
    `      state : Int;`,
    `      step : Int;`,
    `      done : Bool;`,
    `      fault : Bool;`,
    `   END_STRUCT;`,
    `END_TYPE`,
    ``,
  ].join("\n");
  return { name, type: "UDT", filename: `${name}.udt`, content, dependencies: [], folder: DATA, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** Command DB — the Unit/HMI seam that drives the EM's command inputs. */
function writeCmdDb(seq: EmSequence): CodegenArtifact {
  const name = `${seq.sclName}_CMD`;
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   STRUCT`,
    `      enable : Bool;`,
    `      mode : Int;`,
    ...seq.cmdPins.map((p) => `      ${p} : Bool;`),
    `   END_STRUCT;`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** MAP FC — the IO seam between physical addresses and the instance DB. */
function writeMapFc(seq: EmSequence): CodegenArtifact {
  const inst = `EM_${seq.sclName}_DB`;
  const name = `MAP_${seq.sclName}`;
  const sensorLines = seq.sensors.map((p) =>
    p.address
      ? `   "${inst}".${p.name} := "${p.address}";`
      : `   // TODO wire sensor ${p.name} (no address in spec)`,
  );
  const actuatorLines = seq.actuators.map((p) =>
    p.address
      ? `   "${p.address}" := "${inst}".${p.name};`
      : `   // TODO wire actuator ${p.name} (no address in spec)`,
  );
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   // sensor feedback: physical input -> instance DB`,
    ...sensorLines,
    `   // actuator commands: instance DB -> physical output`,
    ...actuatorLines,
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies: [inst], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** Instance DB for the EM FB. */
function writeInstanceDb(seq: EmSequence): CodegenArtifact {
  const fbName = `EM_${seq.sclName}`;
  const name = `EM_${seq.sclName}_DB`;
  const content = [
    `DATA_BLOCK "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `"${fbName}"`,
    `BEGIN`,
    `END_DATA_BLOCK`,
    ``,
  ].join("\n");
  return { name, type: "DB", filename: `${name}.db`, content, dependencies: [fbName], folder: PROGRAM, layer: "em", ownerId: seq.emId, ownerName: seq.emName };
}

/** OB1 call lines: instantiate the FB from its CMD DB, then run its MAP FC. */
function buildCallLines(seq: EmSequence): string[] {
  const inst = `EM_${seq.sclName}_DB`;
  const cmd = `${seq.sclName}_CMD`;
  const params = [
    `enable := "${cmd}".enable`,
    `mode := "${cmd}".mode`,
    ...seq.cmdPins.map((p) => `${p} := "${cmd}".${p}`),
  ].join(", ");
  return [`   "${inst}"(${params});`, `   "MAP_${seq.sclName}"();`];
}

/** Serialize an EmSequence into its 5 SCL artifacts plus OB1 call lines. Pure;
 *  no IO, no AI. The FB step bodies are deterministic stubs inside stable
 *  AI-fill regions, so the bundle always compiles before any AI fill. */
export function writeEmArtifacts(seq: EmSequence): {
  artifacts: CodegenArtifact[]; callLines: string[];
} {
  return {
    artifacts: [
      writeFb(seq),
      writeStateUdt(seq),
      writeCmdDb(seq),
      writeMapFc(seq),
      writeInstanceDb(seq),
    ],
    callLines: buildCallLines(seq),
  };
}
```

Now add the `writeEmArtifacts` re-export to `src/lib/spec-builder/codegen/index.ts` (the line deferred from Task 1):

```ts
export { compileContract } from "./compile-contract";
export { filterByLayer } from "./layer-filter";
export { buildEmSequence } from "./em-builder";
export { writeEmArtifacts } from "./em-writer";
export type {
  CodegenArtifact, CodegenArtifactType, CodegenLayer, CodegenResult, StubReport,
  SaSequence, SaStep, EmSequence, EmSeqState, EmSeqStep, EmPin,
} from "./types";
```

- [ ] **Step 2: Write the test**

Create `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { EmSequence } from "../types";
import { writeEmArtifacts } from "../em-writer";

function seq(): EmSequence {
  return {
    emId: "em-drive",
    emName: "Carriage Drive",
    sclName: "Carriage_Drive",
    cmdPins: ["cmd_start", "cmd_stop", "cmd_hold", "cmd_reset"],
    interlockPins: ["ilk_rotator_safe"],
    sensors: [{ name: "fb_brake_open", tag: "brake_open", scl_type: "Bool", address: "I0.0" }],
    actuators: [{ name: "cmd_run", tag: "run", scl_type: "Bool", address: "Q0.0" }],
    warnings: [],
    states: [
      { stateId: "idle", name: "Idle", index: 0, kind: "static", isSafe: true,
        staticCommands: [{ pin: "cmd_run", active: false }], steps: [],
        exits: [{ toIndex: 1, condition: "(#ilk_rotator_safe = TRUE)", viaCompletion: false }] },
      { stateId: "running", name: "Running", index: 1, kind: "sequential", isSafe: false,
        staticCommands: [],
        steps: [
          { step: 1, fillId: "running.1", actionProse: "release brake", advance: "(#fb_brake_open = TRUE)", manual: false },
          { step: 2, fillId: "running.2", actionProse: "ramp drive", advance: "TRUE", manual: false },
        ],
        exits: [{ toIndex: 0, condition: "TRUE", viaCompletion: true }] },
    ],
  };
}

describe("writeEmArtifacts", () => {
  it("emits the 5-artifact bundle with EM ownership and layer", () => {
    const { artifacts } = writeEmArtifacts(seq());
    expect(artifacts.map((a) => a.name)).toEqual([
      "EM_Carriage_Drive", "EM_Carriage_Drive_State", "Carriage_Drive_CMD",
      "MAP_Carriage_Drive", "EM_Carriage_Drive_DB",
    ]);
    expect(artifacts.map((a) => a.type)).toEqual(["FB", "UDT", "DB", "FC", "DB"]);
    expect(artifacts.every((a) => a.layer === "em")).toBe(true);
    expect(artifacts.every((a) => a.ownerId === "em-drive")).toBe(true);
  });

  it("builds a CASE state/step skeleton with AI-fill regions", () => {
    const fb = writeEmArtifacts(seq()).artifacts[0].content;
    expect(fb).toContain("CASE #state OF");
    expect(fb).toContain("0:   // Idle (safe)");
    expect(fb).toContain("#cmd_run := FALSE;");
    expect(fb).toContain("CASE #step OF");
    expect(fb).toContain("// <ai-fill Carriage_Drive:running.1>");
    expect(fb).toContain("// TODO (AI-fill): release brake");
    expect(fb).toContain("// </ai-fill Carriage_Drive:running.1>");
  });

  it("advances steps and gates exits correctly", () => {
    const fb = writeEmArtifacts(seq()).artifacts[0].content;
    // conditional advance off step 1
    expect(fb).toContain("IF (#fb_brake_open = TRUE) THEN #step := 2; END_IF;");
    // last step sets done unconditionally
    expect(fb).toContain("#done := TRUE;");
    // command exit into a sequential target resets #step
    expect(fb).toContain("IF (#ilk_rotator_safe = TRUE) THEN #state := 1; #done := FALSE; #step := 1; END_IF;");
    // completion exit gates on #done
    expect(fb).toContain("IF #done THEN #state := 0; #done := FALSE; END_IF;");
  });

  it("wires sensors and actuators through the MAP FC", () => {
    const map = writeEmArtifacts(seq()).artifacts[3];
    expect(map.content).toContain(`"EM_Carriage_Drive_DB".fb_brake_open := "I0.0";`);
    expect(map.content).toContain(`"Q0.0" := "EM_Carriage_Drive_DB".cmd_run;`);
    expect(map.dependencies).toContain("EM_Carriage_Drive_DB");
  });

  it("comments out wiring when an address is missing", () => {
    const s = seq();
    s.sensors[0].address = "";
    const map = writeEmArtifacts(s).artifacts[3];
    expect(map.content).toContain("// TODO wire sensor fb_brake_open");
  });

  it("references the FB type from the instance DB", () => {
    const inst = writeEmArtifacts(seq()).artifacts[4];
    expect(inst.content).toContain(`"EM_Carriage_Drive"`);
    expect(inst.dependencies).toContain("EM_Carriage_Drive");
  });

  it("instantiates the FB from the CMD DB and calls the MAP FC", () => {
    const { callLines } = writeEmArtifacts(seq());
    expect(callLines[0]).toContain(`"EM_Carriage_Drive_DB"(`);
    expect(callLines[0]).toContain(`enable := "Carriage_Drive_CMD".enable`);
    expect(callLines[0]).toContain(`cmd_reset := "Carriage_Drive_CMD".cmd_reset`);
    expect(callLines[1]).toBe(`   "MAP_Carriage_Drive"();`);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc -b` → clean.

```bash
git add src/lib/spec-builder/codegen/em-writer.ts \
  src/lib/spec-builder/codegen/index.ts \
  src/lib/spec-builder/codegen/__tests__/em-writer.test.ts
git commit -m "feat(code-builder): em-writer 5-artifact EM bundle (C1 Task 3)"
```

---

### Task 4: Hybrid AI-fill (em-fill-prompt + use-em-generate)

**Goal:** Generate the EM FB's SFC step bodies with the `generate` edge function, confined to the `// <ai-fill id>` regions, with deterministic stubs always retained as the compilable fallback.

**Files:**
- Create: `src/lib/spec-builder/em-fill-prompt.ts`
- Create: `src/hooks/use-em-generate.ts`
- Test: `src/lib/spec-builder/__tests__/em-fill-prompt.test.ts`
- Test: `src/hooks/__tests__/use-em-generate.test.ts`

**Acceptance Criteria:**
- [ ] `emFillBriefs(seq)` emits exactly one brief per sequential-state step, keyed by `regionId(sclName, fillId)`.
- [ ] System prompt is GENERIC (no machine-specific names) and forbids touching the interface, CASE frame, guards, state constants, and the step-advance line.
- [ ] User message lists the pin catalogue and one block per region with the exact marker template.
- [ ] `fillEmFb` replaces only valid, non-empty regions; invented or empty region ids are ignored; AI failure keeps stubs and records a warning.
- [ ] Result FB content always compiles (markers + stubs preserved when AI is skipped or fails).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/em-fill-prompt.test.ts src/hooks/__tests__/use-em-generate.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write `em-fill-prompt.ts`**

```typescript
import type { EmSequence, EmSeqState } from "./codegen/types";
import { regionId, renderRegion, defaultStub } from "./codegen/em-fill-regions";

export interface EmFillRegionBrief {
  /** Stable region id = regionId(sclName, fillId) — the AI must echo it verbatim in markers. */
  id: string;
  stateName: string;
  /** 1-based step number within the state. */
  step: number;
  /** Plain-language intent for this step (from the contract). */
  action: string;
  /** SCL guard that advances the step ("TRUE" when unconditional). */
  advance: string;
}

function sequentialStates(seq: EmSequence): EmSeqState[] {
  return seq.states.filter((s) => s.kind === "sequential");
}

/** One brief per sequential-state step. Pure — drives both the prompt and the test. */
export function emFillBriefs(seq: EmSequence): EmFillRegionBrief[] {
  const briefs: EmFillRegionBrief[] = [];
  for (const st of sequentialStates(seq)) {
    for (const step of st.steps) {
      briefs.push({
        id: regionId(seq.sclName, step.fillId),
        stateName: st.name,
        step: step.step,
        action: step.actionProse,
        advance: step.advance,
      });
    }
  }
  return briefs;
}

/** Generic, project-independent system prompt. NEVER mentions a specific machine. */
export function buildEmFillSystemPrompt(): string {
  return [
    "You write the body of a single SFC step inside a Siemens SCL FUNCTION_BLOCK.",
    "You are filling AI regions in a deterministic skeleton you must not otherwise change.",
    "",
    "HARD RULES (violating any one makes your output unusable):",
    "1. Output ONLY the regions you are asked to fill. Nothing before, between, or after them.",
    "2. Each region MUST be wrapped in the EXACT markers given to you:",
    "     // <ai-fill ID>",
    "     ...your step-body SCL...",
    "     // </ai-fill ID>",
    "   Echo every ID verbatim. Do not invent, rename, merge, or drop regions.",
    "3. NEVER emit the interface (VAR_INPUT/OUTPUT), the CASE frame, transition guards,",
    "   state constants, or the step-advance line — the skeleton owns all of those.",
    "4. Do NOT write `#step := ...`, `#state := ...`, `#done := ...` — advancing is the skeleton's job.",
    "5. Reference ONLY the pins listed in the pin catalogue, using the `#pin` syntax.",
    "6. Keep the supplied indentation (15 spaces). Plain assignments and IF/CASE only.",
    "7. If you cannot safely implement a step, return its stub body unchanged inside the markers.",
  ].join("\n");
}

/** Lists every pin the AI may reference, grouped by role. */
export function pinCatalogue(seq: EmSequence): string {
  const lines: string[] = [];
  lines.push("Status outputs (skeleton-owned, do NOT assign): #state, #step, #done, #fault");
  if (seq.cmdPins.length) lines.push(`Command inputs: ${seq.cmdPins.map((p) => `#${p}`).join(", ")}`);
  if (seq.interlockPins.length)
    lines.push(`Interlock inputs: ${seq.interlockPins.map((p) => `#${p}`).join(", ")}`);
  if (seq.sensors.length)
    lines.push(`Sensor inputs: ${seq.sensors.map((p) => `#${p.name}`).join(", ")}`);
  if (seq.actuators.length)
    lines.push(`Actuator outputs (you MAY assign): ${seq.actuators.map((p) => `#${p.name}`).join(", ")}`);
  return lines.join("\n");
}

/** Per-region prompt with the exact marker template the AI must reproduce. */
export function buildEmFillUserMessage(seq: EmSequence, briefs: EmFillRegionBrief[]): string {
  const blocks = briefs.map((b) => {
    const template = renderRegion(b.id, defaultStub(b.action, "               "), "               ");
    return [
      `Region ${b.id}`,
      `State: ${b.stateName}`,
      `Step ${b.step}`,
      `Intent: ${b.action}`,
      `complete when: ${b.advance}`,
      "Fill the marked region (replace the // stub line with real step-body SCL):",
      "```scl",
      template,
      "```",
    ].join("\n");
  });
  return [
    `FUNCTION_BLOCK: EM_${seq.sclName}`,
    "",
    "Pin catalogue:",
    pinCatalogue(seq),
    "",
    `Fill the following ${briefs.length} region(s):`,
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
```

Run: `npx tsc -b` → clean.

- [ ] **Step 2: Write `use-em-generate.ts`**

```typescript
import { useCallback, useState } from "react";
import type { EmSequence } from "@/lib/spec-builder/codegen/types";
import { writeEmArtifacts } from "@/lib/spec-builder/codegen";
import { parseRegions, replaceRegion } from "@/lib/spec-builder/codegen/em-fill-regions";
import {
  emFillBriefs,
  buildEmFillSystemPrompt,
  buildEmFillUserMessage,
} from "@/lib/spec-builder/em-fill-prompt";
import { callNonStreaming } from "./use-generation";

export interface EmFillResult {
  /** EM FB SCL with AI-filled regions where available, deterministic stubs everywhere else. */
  fbContent: string;
  /** Region ids that were replaced by AI output. */
  filledRegions: string[];
  warnings: string[];
}

/**
 * Deterministic skeleton + best-effort AI fill of SFC step bodies.
 * The returned FB ALWAYS compiles: on skip/failure the deterministic stubs are kept.
 */
export async function fillEmFb(seq: EmSequence, signal: AbortSignal): Promise<EmFillResult> {
  const { artifacts } = writeEmArtifacts(seq);
  const skeleton = artifacts[0].content; // artifacts[0] is the FB
  const briefs = emFillBriefs(seq);
  if (briefs.length === 0) {
    return { fbContent: skeleton, filledRegions: [], warnings: [] };
  }

  const validIds = new Set(briefs.map((b) => b.id));
  try {
    const { content } = await callNonStreaming(
      buildEmFillSystemPrompt(),
      [{ role: "user", content: buildEmFillUserMessage(seq, briefs) }],
      signal,
    );
    const regions = parseRegions(content);
    let fbContent = skeleton;
    const filledRegions: string[] = [];
    for (const [id, body] of regions) {
      if (!validIds.has(id)) continue; // ignore invented regions
      if (body.trim().length === 0) continue; // ignore empty bodies — keep stub
      fbContent = replaceRegion(fbContent, id, body);
      filledRegions.push(id);
    }
    return { fbContent, filledRegions, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      fbContent: skeleton,
      filledRegions: [],
      warnings: [`AI fill failed (${msg}); keeping deterministic stubs.`],
    };
  }
}

/** Thin React wrapper for the EM-layer UI (consumed in C2). */
export function useEmGenerate() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (seq: EmSequence): Promise<EmFillResult> => {
    const controller = new AbortController();
    setPending(true);
    try {
      return await fillEmFb(seq, controller.signal);
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, run };
}
```

Run: `npx tsc -b` → clean.

- [ ] **Step 3: Write `em-fill-prompt.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import {
  emFillBriefs,
  buildEmFillSystemPrompt,
  buildEmFillUserMessage,
  pinCatalogue,
} from "../em-fill-prompt";
import type { EmSequence } from "../codegen/types";

function seq(): EmSequence {
  return {
    emId: "em-drive",
    emName: "Carriage Drive",
    sclName: "Carriage_Drive",
    states: [
      {
        stateId: "idle",
        name: "Idle",
        index: 0,
        kind: "static",
        isSafe: true,
        staticCommands: [{ pin: "cmd_run", active: false }],
        steps: [],
        exits: [{ toIndex: 1, condition: "#cmd_start", viaCompletion: false }],
      },
      {
        stateId: "running",
        name: "Running",
        index: 1,
        kind: "sequential",
        isSafe: false,
        staticCommands: [],
        steps: [
          { step: 1, fillId: "running.1", actionProse: "release brake", advance: "#fb_brake_open", manual: false },
          { step: 2, fillId: "running.2", actionProse: "ramp to speed", advance: "TRUE", manual: false },
        ],
        exits: [{ toIndex: 0, condition: "TRUE", viaCompletion: true }],
      },
    ],
    cmdPins: ["cmd_start", "cmd_stop"],
    interlockPins: ["ilk_rotator_safe"],
    sensors: [{ name: "fb_brake_open", tag: "fb_brake_open", scl_type: "Bool", address: "I0.0" }],
    actuators: [{ name: "cmd_run", tag: "cmd_run", scl_type: "Bool", address: "Q0.0" }],
    warnings: [],
  };
}

describe("emFillBriefs", () => {
  it("emits one brief per sequential-state step only", () => {
    const briefs = emFillBriefs(seq());
    expect(briefs.map((b) => b.id)).toEqual([
      "Carriage_Drive:running.1",
      "Carriage_Drive:running.2",
    ]);
    expect(briefs[0].stateName).toBe("Running");
    expect(briefs[0].action).toBe("release brake");
    expect(briefs[1].advance).toBe("TRUE");
  });
});

describe("buildEmFillSystemPrompt", () => {
  it("is generic and forbids skeleton edits", () => {
    const p = buildEmFillSystemPrompt();
    expect(p).not.toMatch(/carriage|brake|drive/i); // no machine-specific names
    expect(p).toContain("// <ai-fill ID>");
    expect(p).toContain("NEVER emit the interface");
    expect(p).toMatch(/Do NOT write `#step/);
  });
});

describe("pinCatalogue + user message", () => {
  it("lists pins by role and one block per region with markers", () => {
    const s = seq();
    const cat = pinCatalogue(s);
    expect(cat).toContain("Command inputs: #cmd_start, #cmd_stop");
    expect(cat).toContain("Interlock inputs: #ilk_rotator_safe");
    expect(cat).toContain("Sensor inputs: #fb_brake_open");
    expect(cat).toContain("Actuator outputs (you MAY assign): #cmd_run");

    const msg = buildEmFillUserMessage(s, emFillBriefs(s));
    expect(msg).toContain("FUNCTION_BLOCK: EM_Carriage_Drive");
    expect(msg).toContain("// <ai-fill Carriage_Drive:running.1>");
    expect(msg).toContain("// </ai-fill Carriage_Drive:running.1>");
    expect(msg).toContain("complete when: #fb_brake_open");
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/em-fill-prompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Write `use-em-generate.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../use-generation", () => ({ callNonStreaming: vi.fn() }));

import { callNonStreaming } from "../use-generation";
import { fillEmFb } from "../use-em-generate";
import type { EmSequence } from "@/lib/spec-builder/codegen/types";

const mockCall = vi.mocked(callNonStreaming);

function seq(): EmSequence {
  return {
    emId: "em-drive",
    emName: "Carriage Drive",
    sclName: "Carriage_Drive",
    states: [
      {
        stateId: "running",
        name: "Running",
        index: 0,
        kind: "sequential",
        isSafe: false,
        staticCommands: [],
        steps: [
          { step: 1, fillId: "running.1", actionProse: "release brake", advance: "#fb_brake_open", manual: false },
        ],
        exits: [{ toIndex: 0, condition: "TRUE", viaCompletion: true }],
      },
    ],
    cmdPins: ["cmd_start"],
    interlockPins: [],
    sensors: [{ name: "fb_brake_open", tag: "fb_brake_open", scl_type: "Bool", address: "I0.0" }],
    actuators: [{ name: "cmd_run", tag: "cmd_run", scl_type: "Bool", address: "Q0.0" }],
    warnings: [],
  };
}

const sig = new AbortController().signal;
const ID = "Carriage_Drive:running.1";

beforeEach(() => mockCall.mockReset());

describe("fillEmFb", () => {
  it("replaces a valid region body from AI output", async () => {
    mockCall.mockResolvedValue({
      content: `// <ai-fill ${ID}>\n               #cmd_run := TRUE;\n               // </ai-fill ${ID}>`,
      usage: null,
    });
    const res = await fillEmFb(seq(), sig);
    expect(res.filledRegions).toEqual([ID]);
    expect(res.fbContent).toContain("#cmd_run := TRUE;");
    expect(res.warnings).toHaveLength(0);
  });

  it("keeps stubs and records a warning when the AI call fails", async () => {
    mockCall.mockRejectedValue(new Error("boom"));
    const res = await fillEmFb(seq(), sig);
    expect(res.filledRegions).toEqual([]);
    expect(res.warnings[0]).toContain("AI fill failed (boom)");
    expect(res.fbContent).toContain("// <ai-fill " + ID + ">");
  });

  it("ignores invented and empty regions", async () => {
    mockCall.mockResolvedValue({
      content:
        `// <ai-fill Carriage_Drive:does.not.exist>\n   #x := TRUE;\n   // </ai-fill Carriage_Drive:does.not.exist>\n` +
        `// <ai-fill ${ID}>\n   \n// </ai-fill ${ID}>`,
      usage: null,
    });
    const res = await fillEmFb(seq(), sig);
    expect(res.filledRegions).toEqual([]); // invented ignored, empty body keeps stub
  });
});
```

Run: `npx vitest run src/hooks/__tests__/use-em-generate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Manual pipeline-audit + commit**

`em-fill-prompt.ts` matches the CLAUDE.md post-task glob (`src/lib/*-prompt*.ts`). The referenced `.claude/agents/pipeline-auditor.md` does NOT exist in this repo, so perform the manual self-check instead:
1. **Generic check** — `buildEmFillSystemPrompt()` contains no machine-specific names (asserted by `not.toMatch(/carriage|brake|drive/i)`); the user message is built purely from `seq`. Confirmed generic across machine types.
2. **Typecheck** — `npx tsc -b` clean.
3. **Tests** — both new suites pass.

```bash
git add src/lib/spec-builder/em-fill-prompt.ts \
  src/hooks/use-em-generate.ts \
  src/lib/spec-builder/__tests__/em-fill-prompt.test.ts \
  src/hooks/__tests__/use-em-generate.test.ts
git commit -m "feat(code-builder): hybrid AI-fill for EM step bodies (C1 Task 4)"
```

---

### Task 5: Matched-FB interface_contract wiring (MAP/CMD seam)

**Goal:** When a matched library FB carries a reviewed `interface_contract`, wire its instance call by role (sensor_in pins ← input addresses, actuator_out pins → output addresses) instead of by raw tag; fall back to tag-wiring with a warning when no reviewed contract exists.

**Files:**
- Modify: `src/lib/spec-builder/codegen/fb-instantiate.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`

**Acceptance Criteria:**
- [ ] `InstantiateResult` gains `warnings: string[]` (every return path sets it).
- [ ] A reviewed contract wires inputs/outputs positionally by role; surplus signals/pins each add a warning.
- [ ] A null or unreviewed contract falls back to `wiringLines` (an unreviewed contract adds a "wired by tag" warning).
- [ ] Existing tag-wiring behaviour is unchanged when no contract is present.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Add contract wiring to `fb-instantiate.ts`**

Add the `FbInterfacePin` import to the existing type import line:

```typescript
import type { FbInterfacePin } from "@/types/fb-interface";
```

Add `warnings: string[]` to the result interface:

```typescript
export interface InstantiateResult {
  artifacts: CodegenArtifact[];
  callLines: string[];
  stub: { id: string; name: string; reason: string } | null;
  warnings: string[];
}
```

Add the contract wiring helpers after `wiringLines` (the existing tag-based function stays as the fallback):

```typescript
/** Wire an instance call by interface_contract role: sensor_in pins read input
 *  addresses, actuator_out pins write output addresses. Positional pairing in
 *  signal order; surplus signals or pins each raise a warning. */
function contractWiringLines(
  instance: string, pins: FbInterfacePin[], io: IoSignalV2[],
): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const inputs = io.filter((s) => INPUTS.has(s.signal_type));
  const outputs = io.filter((s) => !INPUTS.has(s.signal_type));
  const sensorPins = pins.filter((p) => p.role === "sensor_in");
  const actuatorPins = pins.filter((p) => p.role === "actuator_out");

  const params: string[] = [];
  sensorPins.forEach((p, i) => {
    const sig = inputs[i];
    if (sig) params.push(`      ${p.name} := "${sig.io_address}"`);
    else warnings.push(`${instance}: no input signal for sensor pin "${p.name}"`);
  });
  const lines = [`   "${instance}"(`, params.join(",\n"), `   );`];
  actuatorPins.forEach((p, i) => {
    const sig = outputs[i];
    if (sig) lines.push(`   "${sig.io_address}" := "${instance}".${p.name};`);
    else warnings.push(`${instance}: no output signal for actuator pin "${p.name}"`);
  });
  if (inputs.length > sensorPins.length)
    warnings.push(`${instance}: ${inputs.length - sensorPins.length} input signal(s) unmapped by contract`);
  if (outputs.length > actuatorPins.length)
    warnings.push(`${instance}: ${outputs.length - actuatorPins.length} output signal(s) unmapped by contract`);
  return { lines, warnings };
}

/** Choose contract wiring when the template carries a reviewed contract, else
 *  fall back to tag wiring (warning if a contract exists but is unreviewed). */
function buildWiring(
  instance: string, t: FbTemplate, io: IoSignalV2[],
): { lines: string[]; warnings: string[] } {
  const contract = t.interface_contract;
  if (contract && contract.reviewed && contract.pins.length) {
    return contractWiringLines(instance, contract.pins, io);
  }
  const warnings = contract && !contract.reviewed
    ? [`${instance}: interface_contract not reviewed; wired by tag name.`]
    : [];
  return { lines: wiringLines(instance, io), warnings };
}
```

Update `instantiate` so both return paths set `warnings` and the matched path uses `buildWiring`:

```typescript
function instantiate(
  prefix: string, id: string, name: string, deviceClass: string, isEm: boolean,
  io: IoSignalV2[], templates: FbTemplate[], layer: CodegenLayer,
): InstantiateResult {
  const tag = (a: CodegenArtifact): CodegenArtifact => ({ ...a, layer, ownerId: id, ownerName: name });
  const t = pickTemplate(name, deviceClass, isEm, templates);
  if (!t) {
    const fb = stubFb(prefix, name, io);
    const instanceName = `${fb.name}_DB`;
    return {
      artifacts: [fb, instanceDb(instanceName, fb.name)].map(tag),
      callLines: wiringLines(instanceName, io),
      stub: { id, name, reason: `no ${isEm ? "EM" : "CM"} template matched "${deviceClass}"` },
      warnings: [],
    };
  }
  const block = templateBlockName(t);
  const instance = `${block}_${sclIdent(name)}_DB`;
  const db = instanceDb(instance, block);
  const w = buildWiring(instance, t, io);
  return { artifacts: [db].map(tag), callLines: w.lines, stub: null, warnings: w.warnings };
}
```

Run: `npx tsc -b` → clean.

- [ ] **Step 2: Write `fb-instantiate.test.ts` contract cases**

```typescript
import { describe, it, expect } from "vitest";
import { instantiateControlModule } from "../fb-instantiate";
import type { ControlModuleV2, IoSignalV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { FbInterfaceContract } from "@/types/fb-interface";

const io: IoSignalV2[] = [
  { signal_id: "s1", signal_name: "open_fb", signal_type: "DI", io_address: "I0.0", tag: "open_fb", description: "" },
  { signal_id: "s2", signal_name: "run_cmd", signal_type: "DO", io_address: "Q0.0", tag: "run_cmd", description: "" },
];

function cm(): ControlModuleV2 {
  return {
    control_module_id: "cm1", control_module_name: "M01", control_module_class: "motor",
    io_signals: io, description: "",
  } as ControlModuleV2;
}

function tmpl(contract: FbInterfaceContract | null): FbTemplate {
  return {
    id: "t1", name: "Motor", device_category: "motor", plc_brand: "SIEMENS_TIA",
    is_enabled: true, is_equipment_module: false, tags: ["motor"],
    interface_contract: contract,
    blocks: [{ id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB", scl_code: "", block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" }],
  } as unknown as FbTemplate;
}

const reviewed: FbInterfaceContract = {
  block_name: "CM_Motor", reviewed: true, generated_at: "",
  pins: [
    { name: "open_fb", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "io", exposed: true, description: "" },
    { name: "run_cmd", scl_type: "Bool", direction: "output", role: "actuator_out", default_binding: "io", exposed: true, description: "" },
  ],
};

describe("instantiate contract wiring", () => {
  it("wires by role when the contract is reviewed", () => {
    const r = instantiateControlModule(cm(), [tmpl(reviewed)]);
    expect(r.callLines.join("\n")).toContain(`open_fb := "I0.0"`);
    expect(r.callLines.join("\n")).toContain(`"Q0.0" := "CM_Motor_M01_DB".run_cmd;`);
    expect(r.warnings).toHaveLength(0);
  });

  it("falls back to tag wiring with a warning when the contract is unreviewed", () => {
    const r = instantiateControlModule(cm(), [tmpl({ ...reviewed, reviewed: false })]);
    expect(r.callLines.join("\n")).toContain(`open_fb := "I0.0"`);
    expect(r.warnings[0]).toContain("not reviewed");
  });

  it("falls back silently when there is no contract", () => {
    const r = instantiateControlModule(cm(), [tmpl(null)]);
    expect(r.callLines.join("\n")).toContain(`open_fb := "I0.0"`);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns on surplus signals not covered by contract pins", () => {
    const extra: IoSignalV2[] = [...io, { signal_id: "s3", signal_name: "stop_fb", signal_type: "DI", io_address: "I0.1", tag: "stop_fb", description: "" } as IoSignalV2];
    const r = instantiateControlModule({ ...cm(), io_signals: extra } as ControlModuleV2, [tmpl(reviewed)]);
    expect(r.warnings.some((w) => w.includes("input signal(s) unmapped"))).toBe(true);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc -b` → clean.

```bash
git add src/lib/spec-builder/codegen/fb-instantiate.ts \
  src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts
git commit -m "feat(code-builder): role-based contract wiring for matched FBs (C1 Task 5)"
```

---

### Task 6: compile-contract — EM-layer path supersedes the flattened per-Unit sequence

**Goal:** Rewire `compileContract` so an unmatched EM that carries a state-machine contract emits the deterministic 5-artifact hybrid bundle (and subsumes its CMs' IO via `MAP_<EM>`), matched/no-contract EMs keep the device-layer instance + per-CM wiring, and the old flattened per-Unit S/A sequencer (`UDT_/DB_/UC_` from `sa-builder`) is replaced by a minimal `UC_<unit>` coordination stub. OB1 no longer calls per-unit sequencer DBs.

**Files:**
- Modify: `src/lib/spec-builder/codegen/compile-contract.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` (rewrite)

**Acceptance Criteria:**
- [ ] An unmatched EM with a contract emits exactly `EM_<EM>`, `EM_<EM>_State`, `<EM>_CMD`, `MAP_<EM>`, `EM_<EM>_DB` (all `layer:"em"`) and no per-CM artifacts/stubs for that EM.
- [ ] No `UDT_<unit>` / `DB_<unit>` sequencer artifacts are produced; each non-excluded unit yields one `UC_<unit>` FC stub (`layer:"unit"`) naming each EM.
- [ ] Matched or no-contract EMs still produce their device-layer instance + per-CM wiring (unchanged behaviour), and `warnings` from both layers propagate.
- [ ] `writeOb1` receives `[]` units (no `DB_<unit>` calls) and OB1 still calls each generated EM instance DB.
- [ ] `buildUnitSequence`, `writeUdt`, `writeSequenceDb`, `writeSequenceFc`, `UnitCallRef` are no longer imported by `compile-contract.ts`.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Rewrite the imports + compile body**

Replace the whole of `src/lib/spec-builder/codegen/compile-contract.ts` with:

```ts
// src/lib/spec-builder/codegen/compile-contract.ts
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { CodegenArtifact, CodegenResult, StubReport } from "./types";
import { sclIdent } from "./sa-builder";
import { buildEmSequence } from "./em-builder";
import { writeEmArtifacts } from "./em-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1 } from "./ob1-writer";

/**
 * Compile a confirmed FDS into deterministic SCL.
 *
 * EM-layer model (supersedes the old flattened per-Unit S/A sequence): each EM
 * owns its own procedural control. An unmatched EM that has a state-machine
 * contract is lowered to the hybrid 5-artifact bundle (EM FB + State UDT + CMD
 * DB + MAP FC + instance DB); its control modules' IO is subsumed by MAP_<EM>,
 * so they are NOT instantiated separately. A matched library EM (or an EM with
 * no contract) keeps the device-layer instance + per-CM wiring. Each Unit emits
 * a UC_<unit> coordination stub (the real coordinator is built in sub-project
 * D). Finally one OB1. Pure: no IO, no AI.
 */
export function compileContract(contract: SpecContractV2, templates: FbTemplate[]): CodegenResult {
  const artifacts: CodegenArtifact[] = [];
  const warnings: string[] = [];
  const stubs: StubReport = { controlModules: [], equipmentModules: [] };
  const deviceCallLines: string[] = [];
  const seenArtifact = new Set<string>();

  const push = (a: CodegenArtifact) => {
    if (seenArtifact.has(a.name)) return;
    seenArtifact.add(a.name);
    artifacts.push(a);
  };

  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;

    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      const emRes = instantiateEquipmentModule(em, templates);

      // Unmatched EM with a state-machine contract → generate the hybrid bundle.
      // The EM FB owns sequencing and its CMs' IO (via MAP_<EM>); CMs are not
      // instantiated separately here.
      if (emRes.stub && emContract) {
        const seq = buildEmSequence(em, emContract);
        const { artifacts: emArts, callLines } = writeEmArtifacts(seq);
        emArts.forEach(push);
        deviceCallLines.push(...callLines);
        warnings.push(...seq.warnings);
        continue;
      }

      // Matched library EM (or unmatched-with-no-contract) → device-layer
      // instance + per-CM wiring, unchanged.
      emRes.artifacts.forEach(push);
      deviceCallLines.push(...emRes.callLines);
      warnings.push(...emRes.warnings);
      if (emRes.stub) stubs.equipmentModules.push(emRes.stub);

      for (const cm of em.control_modules) {
        const cmRes = instantiateControlModule(cm, templates);
        cmRes.artifacts.forEach(push);
        deviceCallLines.push(...cmRes.callLines);
        warnings.push(...cmRes.warnings);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
      }
    }

    // Coordination stub replaces the flattened per-Unit sequencer.
    push(unitCoordinationStub(unit.unit_id, unit.unit_name, unit.equipment_modules.map((e) => e.equipment_module_name)));
  }

  // Pass [] units: OB1 must not call per-unit sequencer DBs (they no longer
  // exist). The UC_<unit> stub is uncalled until sub-project D wires it.
  push(writeOb1(deviceCallLines, []));
  return { artifacts, stubs, warnings };
}

/**
 * Minimal Unit coordinator placeholder. EM-owned sequencing supersedes the old
 * per-Unit S/A sequence; the real Unit coordinator (mode arbitration, interlock
 * routing, EM enables — ISA-88 §5.4) is built in sub-project D. Until then emit
 * a typed, parameterless stub so the Unit appears in the block tree.
 */
function unitCoordinationStub(unitId: string, unitName: string, emNames: string[]): CodegenArtifact {
  const name = `UC_${sclIdent(unitName)}`;
  const lines = emNames.length
    ? emNames.map((n) => `   // coordinate ${n}  (mode / enable / interlocks wired in D)`)
    : [`   // no equipment modules`];
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ``,
    `BEGIN`,
    `   // Unit coordination placeholder — D builds the real coordinator (ISA-88 §5.4).`,
    ...lines,
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return {
    name, type: "FC", filename: `${name}.scl`, content,
    dependencies: [], folder: "Program blocks", layer: "unit",
    ownerId: unitId, ownerName: unitName,
  };
}
```

Run: `npx tsc -b` → clean (the removed imports must leave no dangling references; `sa-builder`, `udt-writer`, `db-writer`, `fc-writer` stay in the tree — they are simply no longer wired into the compile path).

- [ ] **Step 2: Rewrite the test for the EM-layer path**

The old fixture asserted the per-Unit sequencer (`UDT_/DB_/UC_Carriage_Unit`, 4-step `S[]`) and CM stubs. Those are gone. Replace the whole of `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` with a fixture whose EMs are unmatched (`templates = []`) and carry contracts, so they take the generate path. The static-state command tag aligns with each CM's `_Run` output so the generated FB is coherent:

```ts
// src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
import { describe, it, expect } from "vitest";
import { compileContract } from "../compile-contract";
import { filterByLayer } from "../layer-filter";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

/** 1 Process Cell → 1 Unit → 2 EMs, each one control module with a Run output
 *  and a feedback input, plus a static 2-state machine that drives Run. EMs are
 *  unmatched (no templates) but carry contracts → they take the generate path.
 *  Cast through unknown: the compiler reads only a subset of the full schema. */
function fixture(): SpecContractV2 {
  const io = (tag: string, st: "DI" | "DO", addr: string) => ({
    tag, signal_type: st, io_address: addr, description: tag, source: "field",
  });
  const cm = (id: string, name: string, cls: string) => ({
    control_module_id: id, control_module_name: name, control_module_class: cls,
    is_safety: false, description: name,
    io_signals: [io(`${name}_Run`, "DO", "Q0.0"), io(`${name}_FB`, "DI", "I0.0")],
  });
  const emContract = (emId: string, runTag: string) => ({
    equipment_module_id: emId, unit_id: "unit-1",
    states: [
      { state_id: "idle", name: "idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "active", name: "active", kind: "static", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: `${emId}-t1`, from_state_id: "idle", to_state_id: "active",
        trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } }, guard: [] },
      { transition_id: `${emId}-t2`, from_state_id: "active", to_state_id: "idle",
        trigger: { kind: "command", expr: { tag: "cmd_stop", operator: "=", value: true } }, guard: [] },
    ],
    static_states: { idle: [{ tag: runTag, description: "run", state: "STOP" }],
                     active: [{ tag: runTag, description: "run", state: "RUN" }] },
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
    equipment_modules: {
      "em-carriage": emContract("em-carriage", "M01_Run"),
      "em-clamp": emContract("em-clamp", "SOL1_Run"),
    },
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

describe("compileContract — EM-layer path", () => {
  const res = compileContract(fixture(), []); // no templates → unmatched → generate
  const names = res.artifacts.map((a) => a.name);

  it("emits the 5-artifact bundle for each generated EM", () => {
    for (const em of ["Carriage", "Clamp"]) {
      expect(names).toContain(`EM_${em}`);
      expect(names).toContain(`EM_${em}_State`);
      expect(names).toContain(`EM_${em}_DB`);
      expect(names).toContain(`${em}_CMD`);
      expect(names).toContain(`MAP_${em}`);
    }
  });

  it("supersedes the flattened per-Unit sequencer", () => {
    expect(names).not.toContain("UDT_Carriage_Unit");
    expect(names).not.toContain("DB_Carriage_Unit");
  });

  it("emits one UC_<unit> coordination stub naming each EM", () => {
    const uc = res.artifacts.find((a) => a.name === "UC_Carriage_Unit");
    expect(uc?.type).toBe("FC");
    expect(uc?.layer).toBe("unit");
    expect(uc?.content).toContain("coordinate Carriage");
    expect(uc?.content).toContain("coordinate Clamp");
    expect(uc?.content).toContain("placeholder");
  });

  it("reports no CM or EM stubs (CMs subsumed, EMs generated)", () => {
    expect(res.stubs.controlModules).toHaveLength(0);
    expect(res.stubs.equipmentModules).toHaveLength(0);
  });

  it("tags all EM artifacts layer 'em' (5 per EM, 2 FBs)", () => {
    const em = filterByLayer(res.artifacts, "em");
    expect(em).toHaveLength(10);
    expect(em.every((a) => a.layer === "em")).toBe(true);
    expect(em.filter((a) => a.type === "FB")).toHaveLength(2);
  });

  it("emits one OB1 that calls the generated EM instances", () => {
    const ob = res.artifacts.find((a) => a.type === "OB");
    expect(ob?.layer).toBe("ob1");
    expect(ob?.content).toContain(`"EM_Carriage_DB"(`);
    expect(ob?.content).toContain(`"EM_Clamp_DB"(`);
  });

  it("produces no duplicate artifact names", () => {
    expect(new Set(names).size).toBe(names.length);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Full codegen regression + commit**

Run: `npx vitest run src/lib/spec-builder/codegen` → all green (no per-Unit-sequencer test references `compileContract` any more; `sa-builder`/`udt`/`db`/`fc` writer suites keep passing on their own).
Run: `npx tsc -b` → clean.

> **Manual generic self-check (no `pipeline-auditor.md` in repo):** `compile-contract.ts` is not under the `forge-*`/`pipeline`/`*-prompt*` globs, but re-read "All Changes Must Be Generic": the EM/CM/Unit branching keys only off contract presence + template match — no device names, sequences, or machine-type assumptions. Verify the same path compiles a conveyor (sequential EM, many CMs) and a static cell (static-only EM) identically.

```bash
git add src/lib/spec-builder/codegen/compile-contract.ts \
  src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
git commit -m "feat(code-builder): EM-layer compile path supersedes flattened unit sequence (C1 Task 6)"
```

---
