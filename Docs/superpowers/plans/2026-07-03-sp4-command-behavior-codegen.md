# SP-4 Command-Behavior Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deterministic Code Builder consumes `command_behavior["execute"]` and emits command-branched device holds inside the state's CASE branch, with `kind` derived from the PackML slug.

**Architecture:** Extend the codegen IR (approach A from the spec): `em-builder.ts` stays the only reader of the contract and lowers command behavior into new IR fields (`commandBranches`/`commandDefaults` on `EmSeqState`, `setpointPins` on `EmSequence`); `em-writer.ts` stays a pure IR serializer and renders the IF/ELSIF hold chain. Symbolic setpoint values become `sp_* : Int` VAR_INPUT pins flowing through the existing command seam (CMD DB + OB1 bindings). A kind-matches-PackML-pattern check is added to the Stage-A gate.

**Tech Stack:** TypeScript 5.9 (strict, `import type`, no enums), vitest, pure libs under `src/lib/spec-builder/codegen/` (no React/IO).

**Spec:** `Docs/superpowers/specs/2026-07-03-sp4-command-behavior-codegen-design.md`

**Repo conventions:** commits go directly to `master` (established convention). Every task must pass `npx tsc -b` and its vitest suite before commit. All logic MUST be generic across machine types — fixtures use generic names, never Segment-Wagon-specific behavior.

---

### Task 1: Kind derivation + data-driven rendering fallback

**Goal:** `buildEmSequence` derives `kind` from the PackML slug (authored kind survives only for legacy non-PackML slugs) and rendering becomes data-driven, so a mis-authored `static` execute with static-state holds still renders them instead of producing an empty `CASE #step OF`.

**Files:**
- Modify: `src/lib/spec-builder/codegen/em-builder.ts`
- Modify: `src/lib/spec-builder/codegen/em-writer.ts` (stateBranch decision only)
- Test: `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`

**Acceptance Criteria:**
- [ ] A PackML slug whose authored kind mismatches the canonical `state_pattern` gets the canonical kind + a warning
- [ ] A non-PackML (legacy) slug keeps its authored kind, no warning
- [ ] A step-less state with static entries renders static holds even when its derived kind is sequential (brake case)
- [ ] A state with no steps, no static commands, no exits renders `;`
- [ ] All existing em-builder/em-writer tests still pass unchanged

**Verify:** `npx vitest run src/lib/spec-builder/codegen` → all pass; `npx tsc -b` → clean

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts` (inside the existing `describe`):

```ts
  it("derives kind from the PackML slug and warns on mismatch", () => {
    const c = contract();
    // "execute" is PackML sequential; author it static with a hold (brake pattern)
    c.states.push({ state_id: "execute", name: "Execute", kind: "static", allowed_modes: [], is_safe_state: false });
    c.static_states["execute"] = [{ tag: "run_cmd", description: "hold open", state: "on" }];
    const seq = buildEmSequence(em(), c);
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    expect(ex.kind).toBe("sequential");
    expect(ex.staticCommands).toEqual([{ pin: "cmd_run_cmd", active: true }]);
    expect(seq.warnings.some((w) => w.includes("execute") && w.includes("sequential"))).toBe(true);
  });

  it("keeps the authored kind for legacy non-PackML slugs", () => {
    const seq = buildEmSequence(em(), contract());
    // "running" is not a PackML slug — authored sequential kind survives, no warning
    expect(seq.states.find((s) => s.stateId === "running")!.kind).toBe("sequential");
    expect(seq.warnings).toHaveLength(0);
  });

  it("lowers steps for a state regardless of authored kind", () => {
    const c = contract();
    // author "running" as static but give it steps — data wins
    c.states = c.states.map((s) => (s.state_id === "running" ? { ...s, kind: "static" as const } : s));
    const seq = buildEmSequence(em(), c);
    expect(seq.states.find((s) => s.stateId === "running")!.steps).toHaveLength(1);
  });
```

Append to `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts` (inside the existing `describe`):

```ts
  it("renders static holds for a step-less sequential state instead of an empty step CASE", () => {
    const s = seq();
    s.states[1].steps = [];
    s.states[1].staticCommands = [{ pin: "cmd_run", active: true }];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    expect(fb).not.toContain("CASE #step OF");
    expect(fb.split("\n").filter((l) => l.includes("#cmd_run := TRUE;"))).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-builder.test.ts src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`
Expected: the 4 new tests FAIL (kind stays "static", steps not lowered for static kind, empty CASE emitted); existing tests pass.

- [ ] **Step 3: Implement in em-builder.ts**

Add import at the top of `src/lib/spec-builder/codegen/em-builder.ts`:

```ts
import { packmlStateBySlug } from "../packml-states";
```

Replace the `states` mapping body (currently `const states: EmSeqState[] = ordered.map((st, index) => { ... })`) with:

```ts
  const states: EmSeqState[] = ordered.map((st, index) => {
    // PackML slugs own their pattern; the authored kind is only trusted for
    // legacy non-PackML slugs (pre-SP-3b specs).
    const canonical = packmlStateBySlug(st.state_id);
    const kind = canonical?.state_pattern ?? st.kind;
    if (canonical && st.kind !== canonical.state_pattern) {
      warnings.push(
        `EM ${em.equipment_module_name}: state ${st.state_id} authored as "${st.kind}" but PackML ${canonical.name} is "${canonical.state_pattern}" — using "${canonical.state_pattern}"`,
      );
    }

    const staticCommands = staticEntries(contract.static_states[st.state_id]).map((e) => ({
      pin: actuatorPin(e.tag),
      active: isActiveCommand(e.state),
    }));

    // Steps are lowered from the data, not the kind, so a mis-authored kind
    // never drops authored behavior.
    const seqSteps = contract.sequential_states[st.state_id]?.steps ?? [];
    const steps: EmSeqStep[] = [];
    if (seqSteps.length) {
      const sorted = [...seqSteps].sort((a, b) => a.step - b.step);
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

    return { stateId: st.state_id, name: st.name, index, kind, isSafe: st.is_safe_state, staticCommands, steps, exits: [] };
  });
```

(The step-lowering body is the existing code — only the `st.kind === "sequential"` gate is replaced by `seqSteps.length`, and the kind derivation is new. `staticCommands` was already computed unconditionally.)

- [ ] **Step 4: Implement in em-writer.ts**

In `src/lib/spec-builder/codegen/em-writer.ts`, replace `stateBranch` with a data-driven decision:

```ts
/** Lower one state to its CASE branch lines. The body is chosen by the data
 *  the state carries (steps → step CASE, else static holds), not its kind —
 *  a mis-authored kind never drops authored behavior. */
function stateBranch(seq: EmSequence, st: EmSeqState, states: EmSeqState[]): string[] {
  const out: string[] = [`${pad(6)}${st.index}:   // ${st.name}${st.isSafe ? " (safe)" : ""}`];
  if (st.steps.length) {
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
  if (!st.steps.length && !st.staticCommands.length && !st.exits.length) {
    out.push(`${pad(9)};`);
  }
  return out;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen` → all pass (new + existing)
Run: `npx tsc -b` → clean

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/em-builder.ts src/lib/spec-builder/codegen/em-writer.ts "src/lib/spec-builder/codegen/__tests__/em-builder.test.ts" "src/lib/spec-builder/codegen/__tests__/em-writer.test.ts"
git commit -m "feat(codegen): derive EM state kind from PackML slug, data-driven state rendering (SP-4)"
```

---

### Task 2: IR types + command-behavior lowering in em-builder

**Goal:** `buildEmSequence` lowers `command_behavior[state_id]` into new IR fields: branch conditions via `serializeGuard`, hold assignments with bool/numeric/symbolic value handling, anti-latch union defaults, deduped `sp_*` setpoint pins, and the commissioning warning.

**Files:**
- Modify: `src/lib/spec-builder/codegen/types.ts`
- Modify: `src/lib/spec-builder/codegen/em-builder.ts`
- Modify: `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts` (fixture gains new required fields only)
- Test: `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`

**Acceptance Criteria:**
- [ ] Branch `when` → serialized condition via `serializeGuard(when, pinRef)`; branch `label` preserved
- [ ] Bool pin holds → `TRUE`/`FALSE` via `isActiveCommand`; Int pin + signed numeric string → literal; Int pin + symbolic name → `#sp_<name>` with the pin recorded once in `setpointPins`
- [ ] `commandDefaults` = union of all pins across branches + default_hold; default_hold value wins, else `FALSE`/`0` by pin type
- [ ] A state with both steps and command_behavior lowers the branches, drops the steps, and warns
- [ ] EMs with setpoint pins get one warning naming them and the `<EM>_CMD` DB
- [ ] States without command_behavior get empty `commandBranches`/`commandDefaults`; EMs without symbolic setpoints get empty `setpointPins`

**Verify:** `npx vitest run src/lib/spec-builder/codegen` → all pass; `npx tsc -b` → clean

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`. First extend the fixtures — add an AO signal to the `em()` helper's `io_signals` array (after the existing two entries):

```ts
        { tag: "speed_ref", signal_type: "AO", io_address: "QW64", description: "", source: "wired" },
```

Then add a new describe block at the end of the file:

```ts
describe("buildEmSequence command_behavior lowering", () => {
  function commandContract(): EquipmentModuleContract {
    const c = contract();
    c.states.push({ state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false });
    c.command_behavior = {
      execute: {
        branches: [
          { branch_id: "b1", label: "Drive Forward (Jog)",
            when: [{ tag: "brake_open", operator: "=", value: true }],
            control_modules: [
              { tag: "run_cmd", description: "", state: "run" },
              { tag: "speed_ref", description: "", state: "JOG_SPEED_FWD" },
            ] },
          { branch_id: "b2", label: "Creep Reverse",
            when: [{ tag: "rev_sel", operator: "=", value: true }],
            control_modules: [{ tag: "speed_ref", description: "", state: "-50" }] },
        ],
        default_hold: [{ tag: "run_cmd", description: "", state: "off" }],
      },
    };
    return c;
  }

  it("lowers branches with serialized conditions, labels, and typed hold values", () => {
    const seq = buildEmSequence(em(), commandContract());
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    expect(ex.commandBranches).toHaveLength(2);
    expect(ex.commandBranches[0]).toEqual({
      label: "Drive Forward (Jog)",
      condition: "(#fb_brake_open = TRUE)",
      holds: [
        { pin: "cmd_run_cmd", value: "TRUE" },
        { pin: "cmd_speed_ref", value: "#sp_JOG_SPEED_FWD" },
      ],
    });
    // signed numeric literal on an Int pin assigns directly
    expect(ex.commandBranches[1].holds).toEqual([{ pin: "cmd_speed_ref", value: "-50" }]);
    expect(seq.setpointPins).toEqual(["sp_JOG_SPEED_FWD"]);
  });

  it("builds anti-latch defaults from the union of branch + default_hold pins", () => {
    const seq = buildEmSequence(em(), commandContract());
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    // default_hold wins for run_cmd ("off" → FALSE); speed_ref falls to inactive 0
    expect(ex.commandDefaults).toEqual([
      { pin: "cmd_run_cmd", value: "FALSE" },
      { pin: "cmd_speed_ref", value: "0" },
    ]);
  });

  it("prefers command branches over steps and warns (XOR guard)", () => {
    const c = commandContract();
    c.sequential_states["execute"] = {
      permissives: [], notes: null,
      steps: [{ step: 1, action: "should be dropped", completion_criteria: [], completion_criteria_text: "" }],
    };
    const seq = buildEmSequence(em(), c);
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    expect(ex.commandBranches).toHaveLength(2);
    expect(ex.steps).toHaveLength(0);
    expect(seq.warnings.some((w) => w.includes("execute") && w.includes("command"))).toBe(true);
  });

  it("warns once per EM naming the setpoint pins and CMD DB", () => {
    const seq = buildEmSequence(em(), commandContract());
    const w = seq.warnings.filter((x) => x.includes("setpoint"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("sp_JOG_SPEED_FWD");
    expect(w[0]).toContain("Carriage_Drive_CMD");
  });

  it("leaves non-command states and EMs untouched", () => {
    const seq = buildEmSequence(em(), contract());
    expect(seq.setpointPins).toEqual([]);
    for (const s of seq.states) {
      expect(s.commandBranches).toEqual([]);
      expect(s.commandDefaults).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`
Expected: FAIL — `commandBranches`/`setpointPins` do not exist yet (type errors surface at runtime as undefined comparisons in vitest; tsc would also fail).

- [ ] **Step 3: Extend the IR types**

In `src/lib/spec-builder/codegen/types.ts`, add above `EmSeqState`:

```ts
/** One command-conditional hold branch inside a command-driven state (SP-4).
 *  Branches are mutually-evaluated holds, NOT a sequenced SFC — see the
 *  SP-3/SP-4 PackML design. */
export interface EmCommandBranch {
  /** FDS branch label — emitted as the audit comment above the holds. */
  label: string;
  /** Serialized SCL boolean for the branch's `when` permissives. */
  condition: string;
  /** Pin assignments applied while this branch is active. */
  holds: { pin: string; value: string }[];
}
```

Add to `EmSeqState` (after `steps`):

```ts
  /** Command-conditional hold branches (command-driven states only). */
  commandBranches: EmCommandBranch[];
  /** Anti-latch defaults assigned before the branch chain: the union of all
   *  pins any branch or the default_hold touches. */
  commandDefaults: { pin: string; value: string }[];
```

Add to `EmSequence` (after `cmdPins`):

```ts
  /** Symbolic setpoint inputs (Int) generated from non-numeric hold values;
   *  exposed on the command seam so commissioning sets them in the CMD DB. */
  setpointPins: string[];
```

- [ ] **Step 4: Implement the lowering in em-builder.ts**

Update imports: add `serializeGuard` and the branch/entry types.

```ts
import type {
  EquipmentModuleV2, EquipmentModuleContract, IoSignalV2,
  PhaseStep, CompletionCriterion, ControlModuleStateEntry,
} from "@/types/spec-contract-v2";
import { serializeAdvance, serializeGuard } from "./serialize-condition";
import type { EmPin, EmSeqState, EmSeqStep, EmSequence, EmCommandBranch } from "./types";
```

Inside `buildEmSequence`, after the `pinRef` helper, add the hold-lowering helpers:

```ts
  // symbolic setpoint pins (Int inputs), deduped per EM in insertion order
  const setpoints = new Map<string, string>();

  /** Lower one hold entry {tag, state} to a pin assignment. Bool pins use the
   *  active-token table; Int pins take signed numeric literals directly and
   *  route symbolic names through a generated sp_ input pin. */
  const holdAssign = (entry: ControlModuleStateEntry): { pin: string; value: string } => {
    const pin = actuatorPin(entry.tag);
    if (actuators.get(pin)?.scl_type === "Int") {
      const raw = entry.state.trim();
      if (/^[+-]?\d+$/.test(raw)) return { pin, value: String(parseInt(raw, 10)) };
      const sp = `sp_${sclIdent(raw)}`;
      if (!setpoints.has(sp)) setpoints.set(sp, raw);
      return { pin, value: `#${sp}` };
    }
    return { pin, value: isActiveCommand(entry.state) ? "TRUE" : "FALSE" };
  };

  /** Inactive value for a pin: FALSE for Bool, 0 for Int. */
  const inactiveValue = (pin: string): string =>
    actuators.get(pin)?.scl_type === "Int" ? "0" : "FALSE";
```

Inside the `ordered.map` state body (from Task 1), gate the step lowering on command behavior and lower the branches. Replace the `const seqSteps ...` / `if (seqSteps.length) { ... }` block with:

```ts
    const behavior = contract.command_behavior?.[st.state_id];
    const hasCommand = !!behavior && (behavior.branches.length > 0 || behavior.default_hold.length > 0);

    const seqSteps = contract.sequential_states[st.state_id]?.steps ?? [];
    const steps: EmSeqStep[] = [];
    if (hasCommand && seqSteps.length) {
      // authoring enforces steps XOR branches; tolerate legacy/hand-edited
      // contracts by letting the command branches win
      warnings.push(`EM ${em.equipment_module_name}: state ${st.state_id} has both steps and command_behavior — command branches win`);
    } else if (seqSteps.length) {
      const sorted = [...seqSteps].sort((a, b) => a.step - b.step);
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

    let commandBranches: EmCommandBranch[] = [];
    let commandDefaults: { pin: string; value: string }[] = [];
    if (hasCommand) {
      commandBranches = behavior.branches.map((b) => ({
        label: b.label,
        condition: serializeGuard(b.when, pinRef),
        holds: b.control_modules.map(holdAssign),
      }));
      // anti-latch union: every pin any branch touches defaults to inactive,
      // then default_hold entries override (and add their own pins)
      const defaults = new Map<string, string>();
      for (const b of commandBranches) {
        for (const h of b.holds) if (!defaults.has(h.pin)) defaults.set(h.pin, inactiveValue(h.pin));
      }
      for (const e of behavior.default_hold) {
        const h = holdAssign(e);
        defaults.set(h.pin, h.value);
      }
      commandDefaults = [...defaults.entries()].map(([pin, value]) => ({ pin, value }));
    }

    return { stateId: st.state_id, name: st.name, index, kind, isSafe: st.is_safe_state, staticCommands, steps, commandBranches, commandDefaults, exits: [] };
```

After the transitions loop (before the final `return`), add the commissioning warning, and add `setpointPins` to the returned object:

```ts
  if (setpoints.size) {
    warnings.push(
      `EM ${em.equipment_module_name}: setpoint pins ${[...setpoints.keys()].join(", ")} — set commissioning values in ${sclIdent(em.equipment_module_name)}_CMD`,
    );
  }

  return {
    emId: em.equipment_module_id,
    emName: em.equipment_module_name,
    sclName: sclIdent(em.equipment_module_name),
    states,
    cmdPins: [...CMD_PINS],
    setpointPins: [...setpoints.keys()],
    interlockPins: [...interlocks.keys()],
    sensors: [...sensors.values()],
    actuators: [...actuators.values()],
    warnings,
  };
```

- [ ] **Step 5: Fix the em-writer test fixture (new required fields)**

In `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`, the `seq()` fixture must satisfy the extended types: add `setpointPins: [],` after `cmdPins`, and `commandBranches: [], commandDefaults: [],` to BOTH state literals (after `staticCommands`). Also update the Task-1 test that clears steps — no change needed beyond the fixture fields.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen` → all pass
Run: `npx tsc -b` → clean (this catches any other EmSequence/EmSeqState construction site — `sa-builder.ts` builds `SaStep`, not `EmSeqState`, so only the em-writer test fixture should need fixing)

- [ ] **Step 7: Commit**

```bash
git add src/lib/spec-builder/codegen/types.ts src/lib/spec-builder/codegen/em-builder.ts "src/lib/spec-builder/codegen/__tests__/em-builder.test.ts" "src/lib/spec-builder/codegen/__tests__/em-writer.test.ts"
git commit -m "feat(codegen): lower command_behavior into EM IR — branches, anti-latch defaults, setpoint pins (SP-4)"
```

---

### Task 3: Command-branch emission + setpoint pins on the seam (em-writer)

**Goal:** `writeEmArtifacts` renders the command IF/ELSIF hold chain (defaults first, branch labels as comments, no ai-fill regions, `#done` untouched) and exposes `sp_*` pins in VAR_INPUT, the CMD DB, and the OB1 call bindings.

**Files:**
- Modify: `src/lib/spec-builder/codegen/em-writer.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`

**Acceptance Criteria:**
- [ ] Command state renders: comment header, default assignments, `IF cond THEN // label` + holds, `ELSIF` for subsequent branches, single `END_IF;`
- [ ] Defaults-only (no branches) renders just the assignments, no IF
- [ ] A branch with empty holds renders `;` under its label (SCL branch must hold a statement)
- [ ] Command states contain NO `<ai-fill` markers and never assign `#done`
- [ ] `sp_*` pins appear in VAR_INPUT (Int, after cmd pins), in the `<EM>_CMD` DB STRUCT, and in the OB1 call bindings
- [ ] Command rendering wins over steps/static when both present in the IR

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/em-writer.test.ts` → all pass; `npx tsc -b` → clean

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`:

```ts
describe("writeEmArtifacts command-driven states", () => {
  function commandSeq(): EmSequence {
    const s = seq();
    s.setpointPins = ["sp_JOG_SPEED_FWD"];
    s.actuators.push({ name: "cmd_speed_ref", tag: "speed_ref", scl_type: "Int", address: "QW64" });
    s.states[1] = {
      stateId: "execute", name: "Execute", index: 1, kind: "sequential", isSafe: false,
      staticCommands: [], steps: [],
      commandDefaults: [
        { pin: "cmd_run", value: "FALSE" },
        { pin: "cmd_speed_ref", value: "0" },
      ],
      commandBranches: [
        { label: "Drive Forward (Jog)", condition: "(#fb_brake_open = TRUE)",
          holds: [{ pin: "cmd_run", value: "TRUE" }, { pin: "cmd_speed_ref", value: "#sp_JOG_SPEED_FWD" }] },
        { label: "Creep Reverse", condition: "(#ilk_rotator_safe = TRUE)",
          holds: [{ pin: "cmd_speed_ref", value: "-50" }] },
      ],
      exits: [{ toIndex: 0, condition: "(#ilk_rotator_safe = FALSE)", viaCompletion: false }],
    };
    return s;
  }

  it("renders defaults first, then the labelled IF/ELSIF branch chain", () => {
    const fb = writeEmArtifacts(commandSeq()).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toContain("// command-conditional holds (defaults first, active branch overrides)");
    // defaults precede the IF
    expect(body.indexOf("#cmd_run := FALSE;")).toBeLessThan(body.indexOf("IF (#fb_brake_open = TRUE) THEN"));
    expect(body).toContain("IF (#fb_brake_open = TRUE) THEN");
    expect(body).toContain("// Drive Forward (Jog)");
    expect(body).toContain("#cmd_speed_ref := #sp_JOG_SPEED_FWD;");
    expect(body).toContain("ELSIF (#ilk_rotator_safe = TRUE) THEN");
    expect(body).toContain("#cmd_speed_ref := -50;");
    expect(body).toContain("END_IF;");
  });

  it("emits no ai-fill markers and never assigns #done in a command state", () => {
    const fb = writeEmArtifacts(commandSeq()).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).not.toContain("<ai-fill");
    expect(body).not.toContain("#done := TRUE");
  });

  it("exposes setpoint pins in VAR_INPUT, the CMD DB, and the call bindings", () => {
    const { artifacts, callLines } = writeEmArtifacts(commandSeq());
    expect(artifacts[0].content).toContain("sp_JOG_SPEED_FWD : Int;");
    expect(artifacts[2].content).toContain("sp_JOG_SPEED_FWD : Int;");
    expect(callLines[0]).toContain(`sp_JOG_SPEED_FWD := "Carriage_Drive_CMD".sp_JOG_SPEED_FWD`);
  });

  it("renders defaults-only command behavior without an IF chain", () => {
    const s = commandSeq();
    s.states[1].commandBranches = [];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toContain("#cmd_run := FALSE;");
    expect(body).not.toContain("IF (#fb_brake_open");
  });

  it("emits a bare statement for a branch with no holds", () => {
    const s = commandSeq();
    s.states[1].commandBranches = [{ label: "Signal only", condition: "(#fb_brake_open = TRUE)", holds: [] }];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toMatch(/\/\/ Signal only\r?\n\s*;/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`
Expected: the 5 new tests FAIL (no command rendering, no sp pins); existing tests pass.

- [ ] **Step 3: Implement command rendering in stateBranch**

In `src/lib/spec-builder/codegen/em-writer.ts`, extend `stateBranch`'s decision chain (from Task 1) so command data wins:

```ts
function stateBranch(seq: EmSequence, st: EmSeqState, states: EmSeqState[]): string[] {
  const out: string[] = [`${pad(6)}${st.index}:   // ${st.name}${st.isSafe ? " (safe)" : ""}`];
  const isCommand = st.commandBranches.length > 0 || st.commandDefaults.length > 0;
  if (isCommand) {
    // command-driven hold state: fully deterministic, no ai-fill region, no
    // #done — it holds until a contract transition exits it
    out.push(`${pad(9)}// command-conditional holds (defaults first, active branch overrides)`);
    for (const d of st.commandDefaults) out.push(`${pad(9)}#${d.pin} := ${d.value};`);
    st.commandBranches.forEach((b, i) => {
      out.push(`${pad(9)}${i === 0 ? "IF" : "ELSIF"} ${b.condition} THEN`);
      out.push(`${pad(12)}// ${b.label}`);
      if (!b.holds.length) out.push(`${pad(12)};`);
      for (const h of b.holds) out.push(`${pad(12)}#${h.pin} := ${h.value};`);
    });
    if (st.commandBranches.length) out.push(`${pad(9)}END_IF;`);
  } else if (st.steps.length) {
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
  if (!isCommand && !st.steps.length && !st.staticCommands.length && !st.exits.length) {
    out.push(`${pad(9)};`);
  }
  return out;
}
```

- [ ] **Step 4: Expose setpoint pins on the interface and command seam**

In `writeFb`, add after the cmd-pin inputs line:

```ts
    ...seq.setpointPins.map((p) => `      ${p} : Int;`),
```

(so `inputs` reads: enable, mode, cmdPins, setpointPins, interlockPins, sensors).

In `commandPins`, add the setpoint pins so the CMD DB and call bindings pick them up:

```ts
function commandPins(seq: EmSequence): CommandSeamPin[] {
  return [
    { name: "enable", scl_type: "Bool" },
    { name: "mode", scl_type: "Int" },
    ...seq.cmdPins.map((p) => ({ name: p, scl_type: "Bool" as const })),
    ...seq.setpointPins.map((p) => ({ name: p, scl_type: "Int" as const })),
  ];
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen` → all pass
Run: `npx tsc -b` → clean

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/em-writer.ts "src/lib/spec-builder/codegen/__tests__/em-writer.test.ts"
git commit -m "feat(codegen): emit command-branched holds + setpoint pins through the command seam (SP-4)"
```

---

### Task 4: Stage-A kind-conformance check

**Goal:** `validateEmPackmlConformance` rejects a state whose authored `kind` mismatches the canonical PackML `state_pattern`, so Stage A blocks future mis-authored kinds at the source. Stage-A gate only — `validateSpecContractPatch` untouched.

**Files:**
- Modify: `src/lib/spec-builder/em-state-machine.ts`
- Test: `src/lib/spec-builder/__tests__/em-state-machine.test.ts`

**Acceptance Criteria:**
- [ ] PackML slug + matching kind → no issue
- [ ] PackML slug + mismatched kind → issue naming the state, expected pattern, and authored kind
- [ ] Non-PackML slug → no kind issue (only the existing non-PackML-slug issue)
- [ ] `validateSpecContractPatch` behavior unchanged (no new wiring)

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → all pass; `npx tsc -b` → clean

**Steps:**

- [ ] **Step 1: Write the failing tests**

The suite `src/lib/spec-builder/__tests__/em-state-machine.test.ts` already has a `validateEmPackmlConformance` describe block (line ~244) and a fixture helper `em(id: string, overrides: Partial<EquipmentModuleContract> = {})` (line ~19). Append inside that describe block:

```ts
  it("rejects a PackML state whose kind mismatches the canonical pattern", () => {
    const issues = validateEmPackmlConformance(em("kind-mismatch", { states: [
      { state_id: "execute", name: "Execute", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ] }));
    expect(issues.some((i) => i.includes('"execute"') && i.includes('"sequential"') && i.includes('"static"'))).toBe(true);
  });

  it("accepts matching kinds and ignores non-PackML slugs for the kind check", () => {
    const issues = validateEmPackmlConformance(em("kind-ok", { states: [
      { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: false },
    ] }));
    expect(issues.some((i) => i.includes("must be kind"))).toBe(false);
    // the legacy slug still gets the existing non-PackML issue
    expect(issues.some((i) => i.includes("driving_fwd"))).toBe(true);
  });
```

(The existing "all-17-defaults pass" test at line ~246 uses `defaultEmStates()`, whose kinds come from `state_pattern` — it stays green under the new check by construction.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts`
Expected: first new test FAILS (no kind issue emitted); second may pass its negative assertion — confirm the first fails.

- [ ] **Step 3: Implement the check**

In `src/lib/spec-builder/em-state-machine.ts`, ensure `packmlStateBySlug` is imported from `./packml-states` (alongside the existing `isPackmlSlug` import). Then in `validateEmPackmlConformance`, extend the states loop:

```ts
  for (const s of em.states) {
    if (!isPackmlSlug(s.state_id)) {
      issues.push(`${where}: non-PackML state_id "${s.state_id}" (expected a PackML slug)`);
      continue;
    }
    const canonical = packmlStateBySlug(s.state_id);
    if (canonical && s.kind !== canonical.state_pattern) {
      issues.push(
        `${where}: state "${s.state_id}" must be kind "${canonical.state_pattern}" (PackML ${canonical.name} is ${canonical.state_pattern === "sequential" ? "an acting" : "a waiting"} state), got "${s.kind}"`,
      );
    }
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → all pass
Run: `npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/em-state-machine.ts "src/lib/spec-builder/__tests__/em-state-machine.test.ts"
git commit -m "feat(spec-builder): Stage-A gate rejects kind/PackML-pattern mismatches (SP-4)"
```

---

### Task 5: Full verification + docs/memory

**Goal:** Whole-initiative verification bar passes and the handover/memory record SP-4 as shipped.

**Files:**
- Modify: `Docs/HANDOVER-PACKML-INITIATIVE-2026-07-03.md` (status lines)
- Modify: `C:\Users\kaspe\.claude\projects\C--dev-pac-forge\memory\packml-em-state-initiative.md` (+ MEMORY.md hook if wording changes)

**Acceptance Criteria:**
- [ ] `npx tsc -b` clean
- [ ] `npx vitest run src/lib/spec-builder` fully green (baseline was 358+; only pre-existing quote/variation failures outside this path are tolerated)
- [ ] Generic check (CLAUDE.md post-task self-check): no project-specific names in any prompt/logic change — fixtures verified generic
- [ ] Handover doc + memory updated: SP-4 shipped, live-verification checklist item for the PACKML spec

**Verify:** `npx tsc -b && npx vitest run src/lib/spec-builder` → clean/green

**Steps:**

- [ ] **Step 1: Run the full verification bar**

Run: `npx tsc -b`
Expected: clean
Run: `npx vitest run src/lib/spec-builder`
Expected: all green

- [ ] **Step 2: Generic self-check**

Re-read the changed files for the "All Changes Must Be Generic" rule: no device names (Carriage/Rotator/VSD) in `src/` logic — only in test fixtures where they're generic-shaped (motor + speed-ref pattern applies to any machine). Confirm the setpoint pattern works for a conveyor (belt speed), filler (flow setpoint), stamper (press force).

- [ ] **Step 3: Update handover + memory**

In `Docs/HANDOVER-PACKML-INITIATIVE-2026-07-03.md`: update the header status line ("SP-4 shipped") and checklist item 13 (command-driven states now render deterministic branch chains; expect the setpoint-commissioning warnings on Rotator Drive).

In memory `packml-em-state-initiative.md`: mark SP-4 ✅ with commit ids, note the new IR fields, the sp_ pin seam behavior, kind derivation, the Stage-A kind check, and that live Code Builder verification on the PACKML spec (`8913bad6-7040-4908-bbb3-67f16a501802`) is the remaining manual step (Carriage Drive + Rotator Drive execute should show branch chains).

- [ ] **Step 4: Commit**

```bash
git add Docs/HANDOVER-PACKML-INITIATIVE-2026-07-03.md
git commit -m "docs: SP-4 shipped — command-behavior codegen complete (PackML initiative)"
```

- [ ] **Step 5: Live verification (manual, browser)**

Open Code Builder on the PACKML spec (`/…/8913bad6-7040-4908-bbb3-67f16a501802`), EM layer:
- Carriage Drive → `EM_Carriage_Drive` FB: Execute case shows the 4-branch IF/ELSIF chain with labels, defaults first, no ai-fill markers in that state.
- Rotator Drive → sp_ pins in VAR_INPUT + `Rotator_Drive_CMD`, one setpoint-commissioning warning.
- Any other EM (e.g. Carriage Limits): unchanged step CASE rendering.

---

## Self-Review Notes

- Spec coverage: lowering precedence + kind derivation (Task 1–2), emission + seam (Task 3), Stage-A check (Task 4), verification bar + fixtures-generic rule (Task 5). Non-goals untouched.
- Type consistency: `EmCommandBranch{label,condition,holds}`, `commandBranches`/`commandDefaults` (required, default empty), `setpointPins` — used identically in Tasks 2 and 3.
- Known intra-plan ordering: Task 2 extends required IR fields, so the em-writer test fixture is updated in the same task — `tsc -b` stays clean at every task boundary (unlike the C2 plan's T5–T7 gap).
