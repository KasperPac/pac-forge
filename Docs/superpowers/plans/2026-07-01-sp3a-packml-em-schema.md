# SP-3a PackML EM-State Schema + Validation Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FDS contract the ability to hold the PackML EM-state model — a command-conditional Execute-behavior construct, a PackML EM-state seed, and a standalone PackML conformance validator — without breaking any existing flow.

**Architecture:** Four isolated additions: (1) `command_behavior` schema on `EquipmentModuleContract` (`.optional()` for zero blast radius); (2) `defaultEmStates()` seed in `packml-states.ts`; (3) a NEW standalone `validateEmPackmlConformance()` (deliberately NOT wired into the live `validateEmStateMachine`/co-author — that happens in SP-3b); (4) reconcile the random builder's non-canonical `estop` safe slug to `aborted`.

**Tech Stack:** TypeScript 5.9 strict (`import type`, no enums, `noUnusedLocals`), Zod, Vitest. `@/` = `src/`.

**Spec:** `Docs/superpowers/specs/2026-07-01-sp3a-packml-em-schema-design.md`

**Non-goals (fenced):** Stage A/B prompt reframes (SP-3b/c), codegen (SP-4), Segment Wagon re-author (SP-3d), any UI, wiring conformance into the global validator, hard Zod rejection.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/types/spec-contract-v2.ts` | **Modify.** Add `CommandBranchSchema`, `CommandBehaviorV2Schema`, and the `command_behavior` field on `EquipmentModuleContractSchema`. | 1 |
| `src/lib/spec-builder/__tests__/command-behavior-schema.test.ts` | **New.** Round-trip + backward-compat tests for the schema. | 1 |
| `src/lib/spec-builder/packml-states.ts` | **Modify.** Add `defaultEmStates()`. | 2 |
| `src/lib/spec-builder/__tests__/packml-states.test.ts` | **Modify.** Append `defaultEmStates` tests. | 2 |
| `src/lib/spec-builder/em-state-machine.ts` | **Modify.** Add standalone `validateEmPackmlConformance()` (leave `validateEmStateMachine` untouched). | 3 |
| `src/lib/spec-builder/__tests__/em-state-machine.test.ts` | **Modify.** Append `validateEmPackmlConformance` tests. | 3 |
| `src/lib/spec-builder/random/state-machine.ts` + `random/em-state-machine-builder.ts` | **Modify.** `estop` → `aborted`. | 4 |
| `src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts` | **Modify.** Regression: safe state is `aborted` + conformance-clean. | 4 |

---

### Task 1: `command_behavior` schema construct

**Goal:** Add the command-conditional Execute-behavior schema to the EM contract, backward-compatibly.

**Files:**
- Modify: `src/types/spec-contract-v2.ts`
- Test: `src/lib/spec-builder/__tests__/command-behavior-schema.test.ts`

**Acceptance Criteria:**
- [ ] `CommandBranchSchema` parses `{branch_id, label, when: PermissiveCondition[], control_modules: ControlModuleStateEntry[]}`; rejects an empty `when`.
- [ ] `CommandBehaviorV2Schema` defaults `branches`/`default_hold` to `[]`.
- [ ] `EquipmentModuleContractSchema` gains `command_behavior?: Record<string, CommandBehaviorV2>`; a contract omitting it parses to `undefined`; one with `command_behavior.execute` round-trips.
- [ ] `npx tsc -b` is clean (the `.optional()` field forces no existing construction site to change).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/command-behavior-schema.test.ts` → pass; then `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing test** — create `src/lib/spec-builder/__tests__/command-behavior-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CommandBranchSchema,
  CommandBehaviorV2Schema,
  EquipmentModuleContractSchema,
} from "@/types/spec-contract-v2";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "9b2e4c6a-8f3d-4a1b-b2c7-1e5f7a9d0c3e";

describe("CommandBranchSchema", () => {
  it("parses a command branch with a when-condition and holds", () => {
    const res = CommandBranchSchema.safeParse({
      branch_id: "drive_fwd",
      label: "Drive Forward",
      when: [{ tag: "cmd_fwd", operator: "=", value: true }],
      control_modules: [{ tag: "motor_fwd", description: "Motor forward", state: "on" }],
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty when array", () => {
    const res = CommandBranchSchema.safeParse({
      branch_id: "x", label: "X", when: [], control_modules: [],
    });
    expect(res.success).toBe(false);
  });
});

describe("CommandBehaviorV2Schema", () => {
  it("defaults branches and default_hold to empty arrays", () => {
    const res = CommandBehaviorV2Schema.parse({});
    expect(res.branches).toEqual([]);
    expect(res.default_hold).toEqual([]);
  });
});

describe("EquipmentModuleContract command_behavior", () => {
  const base = {
    equipment_module_id: UUID_A,
    unit_id: UUID_B,
    states: [],
    transitions: [],
    static_states: {},
    sequential_states: {},
  };

  it("is optional — a contract without it parses to undefined (backward-compat)", () => {
    const res = EquipmentModuleContractSchema.parse(base);
    expect(res.command_behavior).toBeUndefined();
  });

  it("round-trips command_behavior keyed by execute", () => {
    const res = EquipmentModuleContractSchema.safeParse({
      ...base,
      command_behavior: {
        execute: {
          branches: [{
            branch_id: "drive_fwd",
            label: "Drive Forward",
            when: [{ tag: "cmd_fwd", operator: "=", value: true }],
            control_modules: [{ tag: "motor_fwd", description: "", state: "on" }],
          }],
          default_hold: [{ tag: "motor_fwd", description: "", state: "off" }],
        },
      },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.command_behavior?.execute.branches[0].branch_id).toBe("drive_fwd");
    }
  });
});
```

Run `npx vitest run src/lib/spec-builder/__tests__/command-behavior-schema.test.ts` → FAIL (schemas not exported). If `UUID_A`/`UUID_B` are rejected by `UuidSchema`, they are valid v4 UUIDs — leave them; the failure at this step must be the missing exports, not UUIDs.

- [ ] **Step 2: Add the schemas.** In `src/types/spec-contract-v2.ts`, immediately BEFORE `export const EquipmentModuleContractSchema = z.object({` (currently ~line 737), add:

```ts
// A device-hold branch active while an operator/EM command condition holds.
// Manual motions (Drive Fwd/Rev) are branches under command_behavior["execute"],
// NOT states — see the SP-3 PackML design. Generic across machine types.
export const CommandBranchSchema = z.object({
  branch_id: z.string().min(1),
  label: z.string().min(1),
  when: z.array(PermissiveConditionSchema).min(1),
  control_modules: z.array(ControlModuleStateEntrySchema),
});
export type CommandBranch = z.infer<typeof CommandBranchSchema>;

// Command-conditional behavior for one acting PackML state (primarily execute):
// mutually-evaluated command branches + the hold applied when no branch is active.
export const CommandBehaviorV2Schema = z.object({
  branches: z.array(CommandBranchSchema).default([]),
  default_hold: z.array(ControlModuleStateEntrySchema).default([]),
});
export type CommandBehaviorV2 = z.infer<typeof CommandBehaviorV2Schema>;
```

- [ ] **Step 3: Add the field.** Inside `EquipmentModuleContractSchema`, after the `sequential_states: z.record(z.string(), SequentialStateV2Schema),` line, add:

```ts
  // Command-conditional device holds for acting PackML states (primarily
  // "execute"), keyed by EM state_id. Optional so the existing
  // EquipmentModuleContract construction sites need not add `command_behavior: {}`;
  // consumers treat absent as {}.
  command_behavior: z.record(z.string(), CommandBehaviorV2Schema).optional(),
```

- [ ] **Step 4: Verify.** Run `npx vitest run src/lib/spec-builder/__tests__/command-behavior-schema.test.ts` → PASS. Run `npx tsc -b` → clean (confirms no construction site broke). If tsc reports a missing `command_behavior` on some literal, that means `.optional()` was not used — re-check Step 3 uses `.optional()`, NOT `.default(...)`.

- [ ] **Step 5: Commit.**

```bash
git add src/types/spec-contract-v2.ts src/lib/spec-builder/__tests__/command-behavior-schema.test.ts
git commit -m "feat(spec-contract): command_behavior construct on EM contract (SP-3a)"
```

---

### Task 2: `defaultEmStates()` PackML seed

**Goal:** A helper that produces the canonical PackML 17 states as `EmStateV2[]` for Stage A seeding.

**Files:**
- Modify: `src/lib/spec-builder/packml-states.ts`
- Test: `src/lib/spec-builder/__tests__/packml-states.test.ts`

**Acceptance Criteria:**
- [ ] `defaultEmStates()` returns 17 `EmStateV2`, exactly one `is_safe_state` (`aborted`), `kind` mapped from `state_pattern`, `allowed_modes: []`.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts` → pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Append the failing test** to `src/lib/spec-builder/__tests__/packml-states.test.ts`. Add to the imports at the top the name `defaultEmStates` (the file already imports from `@/lib/spec-builder/packml-states`), then append:

```ts
describe("defaultEmStates", () => {
  it("returns all 17 as EmStateV2 with aborted safe and kinds mapped from state_pattern", () => {
    const states = defaultEmStates();
    expect(states).toHaveLength(17);
    expect(states.filter((s) => s.is_safe_state)).toHaveLength(1);
    expect(states.find((s) => s.is_safe_state)?.state_id).toBe("aborted");
    expect(states.find((s) => s.state_id === "execute")?.kind).toBe("sequential");
    expect(states.find((s) => s.state_id === "idle")?.kind).toBe("static");
    expect(states.every((s) => s.allowed_modes.length === 0)).toBe(true);
  });
});
```

Run `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts` → FAIL (`defaultEmStates` not exported).

- [ ] **Step 2: Implement.** In `src/lib/spec-builder/packml-states.ts`, add the type import near the top (with the existing `import type { FbInterfaceState }` line):

```ts
import type { EmStateV2 } from "@/types/spec-contract-v2";
```

Then add at the end of the file (after `defaultFbStates`):

```ts
/** The full canonical PackML set as EM state-machine states (Stage A seed). */
export function defaultEmStates(): EmStateV2[] {
  return PACKML_STATES.map((s) => ({
    state_id: s.slug,
    name: s.name,
    kind: s.state_pattern, // "static" | "sequential" == EmStateKind
    allowed_modes: [],
    is_safe_state: s.is_safe,
  }));
}
```

- [ ] **Step 3: Verify.** `npx vitest run src/lib/spec-builder/__tests__/packml-states.test.ts` → PASS. `npx tsc -b` → clean (confirms no import cycle; `EmStateV2` is a type-only import).

- [ ] **Step 4: Commit.**

```bash
git add src/lib/spec-builder/packml-states.ts src/lib/spec-builder/__tests__/packml-states.test.ts
git commit -m "feat(spec-builder): defaultEmStates PackML EM-state seed (SP-3a)"
```

---

### Task 3: `validateEmPackmlConformance()` standalone validator

**Goal:** A NEW pure validator flagging non-PackML slugs, wrong safe state, and misplaced `command_behavior` — WITHOUT touching `validateEmStateMachine` or the co-author.

**Files:**
- Modify: `src/lib/spec-builder/em-state-machine.ts`
- Test: `src/lib/spec-builder/__tests__/em-state-machine.test.ts`

**Acceptance Criteria:**
- [ ] `validateEmPackmlConformance(em)` returns `[]` for a machine seeded from `defaultEmStates()`.
- [ ] Flags a `driving_fwd` state ("non-PackML state_id"), a non-`aborted` safe state ("safe state must be \"aborted\""), and a `command_behavior` key on a non-acting/unknown state.
- [ ] Returns `[]` for an empty-states skeleton.
- [ ] `validateEmStateMachine` is UNCHANGED — its existing tests still pass.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → all pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Append the failing test** to `src/lib/spec-builder/__tests__/em-state-machine.test.ts`. Add `validateEmPackmlConformance` to the existing import block from `@/lib/spec-builder/em-state-machine`, add `import { defaultEmStates } from "@/lib/spec-builder/packml-states";` and `import type { EmStateV2 } from "@/types/spec-contract-v2";` (if `EmStateV2` is not already imported), then append (reusing the file's existing `em(id, overrides)` factory):

```ts
describe("validateEmPackmlConformance", () => {
  it("passes for a machine seeded from defaultEmStates", () => {
    expect(validateEmPackmlConformance(em("cm", { states: defaultEmStates() }))).toEqual([]);
  });

  it("returns [] for an empty skeleton", () => {
    expect(validateEmPackmlConformance(em("empty"))).toEqual([]);
  });

  it("flags a non-PackML state_id", () => {
    const states: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const issues = validateEmPackmlConformance(em("a", { states }));
    expect(issues.some((i) => i.includes('non-PackML state_id "driving_fwd"'))).toBe(true);
  });

  it("flags a safe state that is not aborted", () => {
    const states: EmStateV2[] = [
      { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const issues = validateEmPackmlConformance(em("b", { states }));
    expect(issues.some((i) => i.includes('safe state must be "aborted"'))).toBe(true);
  });

  it("flags command_behavior on a non-acting (static) state", () => {
    const issues = validateEmPackmlConformance(em("c", {
      states: defaultEmStates(),
      command_behavior: { idle: { branches: [], default_hold: [] } }, // idle is static → non-acting
    }));
    expect(issues.some((i) => /command_behavior.*"idle"/.test(i))).toBe(true);
  });
});
```

Run `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → FAIL (`validateEmPackmlConformance` not exported).

- [ ] **Step 2: Implement.** In `src/lib/spec-builder/em-state-machine.ts`, add the import (near the existing imports):

```ts
import { isPackmlSlug } from "@/lib/spec-builder/packml-states";
```

Then add this NEW function directly after the existing `validateEmStateMachine` function (do NOT modify `validateEmStateMachine`):

```ts
/**
 * PackML conformance for one EM's state machine — SEPARATE from the structural
 * validateEmStateMachine so it can be adopted incrementally. NOT yet wired into
 * validateSpecContractPatch / the co-author (that is SP-3b, once Stage A emits
 * PackML slugs). Soft issues; never blocks Zod parsing. Empty machine → [].
 */
export function validateEmPackmlConformance(em: EquipmentModuleContract): string[] {
  const issues: string[] = [];
  const where = `equipment_module ${em.equipment_module_id}`;
  if (em.states.length === 0) return issues;

  for (const s of em.states) {
    if (!isPackmlSlug(s.state_id)) {
      issues.push(`${where}: non-PackML state_id "${s.state_id}" (expected a PackML slug)`);
    }
  }

  const safe = em.states.filter((s) => s.is_safe_state);
  if (safe.length === 1 && safe[0].state_id !== "aborted") {
    issues.push(`${where}: safe state must be "aborted", found "${safe[0].state_id}"`);
  }

  const byId = new Map(em.states.map((s) => [s.state_id, s]));
  for (const key of Object.keys(em.command_behavior ?? {})) {
    const st = byId.get(key);
    if (!st) {
      issues.push(`${where}: command_behavior for unknown state "${key}"`);
    } else if (st.kind !== "sequential") {
      issues.push(`${where}: command_behavior on non-acting state "${key}" (must be a sequential state)`);
    }
  }

  return issues;
}
```

- [ ] **Step 3: Verify.** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → all pass (new + existing, since `validateEmStateMachine` is untouched). `npx tsc -b` → clean.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/spec-builder/em-state-machine.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts
git commit -m "feat(spec-builder): standalone validateEmPackmlConformance (SP-3a)"
```

---

### Task 4: Random-builder `estop` → `aborted`

**Goal:** Reconcile the random builder's non-canonical `estop` safe-state slug to the canonical PackML `aborted`.

**Files:**
- Modify: `src/lib/spec-builder/random/state-machine.ts`
- Modify: `src/lib/spec-builder/random/em-state-machine-builder.ts`
- Test: `src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts`

**Acceptance Criteria:**
- [ ] `buildEmCanonicalStateMachine()` emits a safe state with `state_id: "aborted"`, `name: "Aborted"`.
- [ ] The built machine passes BOTH `validateEmStateMachine` (unchanged) and `validateEmPackmlConformance` (no issues).
- [ ] No stray `estop` EM **state** slug remains in the random-builder path (IO/tag names like `EStop_Healthy` are NOT state slugs — leave them).

**Verify:** `npx vitest run src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts` → pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Find all `estop` EM-state references.** Run:

```bash
grep -rn "EM_LOCAL_ESTOP\|\"estop\"\|'estop'" src/lib/spec-builder/random
```

Expect hits in `state-machine.ts` (the constant) and `em-state-machine-builder.ts` (import + usage). Note each site.

- [ ] **Step 2: Update the failing regression test.** In `src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts`, add `import { validateEmPackmlConformance } from "@/lib/spec-builder/em-state-machine";` (alongside the existing `validateEmStateMachine` import) and append a test:

```ts
it("uses the canonical PackML 'aborted' safe state and is conformance-clean", () => {
  const { states, transitions } = buildEmCanonicalStateMachine();
  const safe = states.filter((s) => s.is_safe_state);
  expect(safe).toHaveLength(1);
  expect(safe[0].state_id).toBe("aborted");
  expect(safe[0].name).toBe("Aborted");
  expect(states.some((s) => s.state_id === "estop")).toBe(false);

  const em = {
    equipment_module_id: "em1", unit_id: "u1",
    states, transitions, static_states: {}, sequential_states: {},
  };
  expect(validateEmPackmlConformance(em)).toEqual([]);
});
```

Run `npx vitest run src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts` → the new test FAILS (still `estop`).

- [ ] **Step 3: Rename the constant.** In `src/lib/spec-builder/random/state-machine.ts`, change:

```ts
export const EM_LOCAL_ESTOP = "estop";
```

to:

```ts
export const EM_LOCAL_ABORTED = "aborted";
```

- [ ] **Step 4: Update the builder.** In `src/lib/spec-builder/random/em-state-machine-builder.ts`:
  - Update the import: replace `EM_LOCAL_ESTOP` with `EM_LOCAL_ABORTED` in the `from "./state-machine"` import list.
  - Change the safe-state entry from:
    ```ts
    { state_id: EM_LOCAL_ESTOP, name: "E-Stop", kind: "static", allowed_modes: [], is_safe_state: true },
    ```
    to:
    ```ts
    { state_id: EM_LOCAL_ABORTED, name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ```

- [ ] **Step 5: Reconcile any other hits** from Step 1 in the random-builder path (e.g. if a static_states key or a transition references `EM_LOCAL_ESTOP`, update it to `EM_LOCAL_ABORTED`). Do NOT touch `STATE_ID_E_STOP` (the numeric packml_id `9`) or any IO/tag string like `EStop_Healthy`. If `grep -rn "EM_LOCAL_ESTOP" src` still returns hits after your edits, fix them.

- [ ] **Step 6: Verify.** Run:

```bash
npx vitest run src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts
npx tsc -b
```
Expect the regression suite green and tsc clean.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/spec-builder/random/state-machine.ts src/lib/spec-builder/random/em-state-machine-builder.ts src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts
git commit -m "fix(random): canonical PackML 'aborted' safe state, not 'estop' (SP-3a)"
```

---

## Self-Review

**Spec coverage:**
- §1 command_behavior schema → Task 1. ✓
- §2 defaultEmStates → Task 2. ✓
- §3 standalone validateEmPackmlConformance (NOT wired, `validateEmStateMachine` untouched) → Task 3. ✓
- §4 random estop→aborted → Task 4. ✓
- Non-goals (no prompt/UI/codegen, no global-validator wiring, `.optional()` not `.default`) → respected. ✓

**Placeholder scan:** No TBD/TODO; all code + test bodies concrete; grep commands explicit. ✓

**Type consistency:** `CommandBranch`/`CommandBehaviorV2` fields consistent across Task 1 schema + Task 3 test literals (`{branch_id,label,when,control_modules}`, `{branches,default_hold}`). `EmStateV2` shape (`state_id,name,kind,allowed_modes,is_safe_state`) consistent in Tasks 2/3/4. `validateEmPackmlConformance(em): string[]` signature consistent across Task 3 (def) and Task 4 (use). `command_behavior?: Record<string, CommandBehaviorV2>` (optional) consistent between Task 1 (schema) and Task 3 (`em.command_behavior ?? {}`). ✓

**Ordering safety:** Task 3 reads `em.command_behavior` (needs Task 1) and `defaultEmStates` (needs Task 2) → blockedBy [1,2]. Task 4 asserts `validateEmPackmlConformance` (needs Task 3) → blockedBy [3]. `validateEmStateMachine` untouched, so no existing live-path or test regression. ✓
