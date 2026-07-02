# SP-3c Stage B command_behavior Authoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Stage B of the FDS co-author author `command_behavior` (command-conditional device holds for acting PackML states — where SP-3b's evicted manual motions land) and plumb it end-to-end: session column, contract read/write, validation, prompt, hook routing, and DOCX/editor rendering.

**Architecture:** Five isolated tasks. (1) Persistence pipe: `command_behavior jsonb` column + `OperationSession` field + contract read/write passthrough. (2) Pure `validateCommandBehavior` wired into `validateSpecContractPatch` (safe for old specs — returns `[]` when the field is absent). (3) Stage B prompt reframe: nature question + command-shape protocol + XOR MUST NOTs. (4) Hook routing in `processAiResponse`: blocks route on shape, steps XOR branches enforced at persist. (5) Compose + operating-sequence rendering: command states get a section row with serialized branches; `summarizeAction` renders row-per-branch lines that both DOCX and editor pick up with zero renderer changes.

**Tech Stack:** TypeScript 5.9 strict (`import type`, no enums, `noUnusedLocals`), Zod, Vitest (supabase `vi.mock` pattern from `contract-em-roundtrip.test.ts`), Supabase migration (SQL only — `npx supabase db push` is a DEPLOY step flagged for the user, never run by the implementation).

**Spec:** `Docs/superpowers/specs/2026-07-02-sp3c-command-behavior-authoring-design.md`

**Non-goals (fenced):** Codegen (SP-4), Segment Wagon re-author (SP-3d), PackML slug enforcement in `validateSpecContractPatch` (SP-3b boundary stands), command_behavior editing UI beyond DOCX-view parity, HMI implications.

**Plan-level notes (deviations within the spec's intent, decided during planning):**
- **DOCX rendering lands entirely in the shared builder** (`summarizeAction` in `operating-sequence.ts`) — `docx-exporter.ts` and `spec-editor.tsx` need NO change because they already render `EmStepView.action: string[]` lines. This satisfies the spec's "fix once, both update" via strictly fewer files.
- **`SEQUENTIAL STATES REMAINING` annotates rather than excludes** authored command states. The REMAINING list doubles as the prompt's `state_id` whitelist ("state_id MUST be one of the EM-LOCAL state ids from the SEQUENTIAL STATES REMAINING list") — excluding a completed command state would forbid the model from ever re-emitting a refinement for it. Annotation ("command-driven, N branch(es) authored") honors the spec's intent (no re-interrogation) without breaking refinement.
- **`fds-prompts-v2.test.ts` is a snapshot test** — the prompt change requires regenerating the snapshot (`-u`) and REVIEWING the diff, not just rerunning.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20260702000000_command_behavior.sql` | **New.** Nullable jsonb column on `fds_operation_sessions`. | 1 |
| `src/types/spec-builder.ts` | **Modify.** `OperationSession.command_behavior?` (Task 1); `CommandBranchEntry` + `FunctionalDescriptionContent.command_branches?/default_hold?` (Task 5). | 1, 5 |
| `src/lib/spec-builder/contract.ts` | **Modify.** Read passthrough in `upgradeEquipmentModuleContracts` (+ export it and `buildUpgradeContext` for tests), write column in `writeSpecContract` (Task 1); `validateCommandBehavior` wiring in `validateSpecContractPatch` (Task 2). | 1, 2 |
| `src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts` | **Modify.** Read + write round-trip tests. | 1 |
| `src/lib/spec-builder/em-state-machine.ts` | **Modify.** New pure `validateCommandBehavior`. | 2 |
| `src/lib/spec-builder/__tests__/em-state-machine.test.ts` | **Modify.** Validator tests. | 2 |
| `src/lib/spec-builder/__tests__/contract-em-validation.test.ts` | **Modify.** Patch-validator wiring tests. | 2 |
| `src/lib/spec-builder/fds-prompts.ts` | **Modify.** Nature question, COMMAND-DRIVEN STATES section, second response shape + example, MUST NOTs, completed/remaining rendering, new trailing `commandBehavior` param. | 3 |
| `src/lib/spec-builder/__tests__/fds-prompts-command.test.ts` | **New.** Prompt-content tests. | 3 |
| `src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap` | **Regenerate** (`-u`) + review. | 3 |
| `src/hooks/use-fds-conversation.ts` | **Modify.** `processAiResponse` routing + XOR + command persist; pass `session.command_behavior` to prompt builder. | 4 |
| `src/lib/spec-builder/fds-compose.ts` | **Modify.** Command states get a section row with serialized branches (currently skipped by `if (!data) continue`). | 5 |
| `src/lib/spec-builder/operating-sequence.ts` | **Modify.** `summarizeAction` renders row-per-branch lines. | 5 |
| `src/lib/spec-builder/__tests__/operating-sequence.test.ts` | **Modify.** Branch-rendering + regression tests. | 5 |
| `src/lib/spec-builder/__tests__/fds-compose-command.test.ts` | **New.** Compose insert-payload test (supabase mock). | 5 |

**Dependencies:** Task 4 blockedBy 1, 2, 3. Task 5 blockedBy 1. Tasks 1–3 are mutually independent (1 and 2 touch different regions of `contract.ts`; execute serially anyway).

---

### Task 1: Persistence pipe (migration + type + contract read/write)

**Goal:** `command_behavior` can be stored on the session and round-trips through the contract read/write paths.

**Files:**
- Create: `supabase/migrations/20260702000000_command_behavior.sql`
- Modify: `src/types/spec-builder.ts` (~line 582, after `em_transitions`)
- Modify: `src/lib/spec-builder/contract.ts` (read ~line 365, write ~line 980, exports)
- Test: `src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts`

**Acceptance Criteria:**
- [ ] Migration adds nullable `command_behavior jsonb` to `fds_operation_sessions` (additive, no backfill).
- [ ] `OperationSession.command_behavior?: Record<string, CommandBehaviorV2>` exists.
- [ ] A session row with `command_behavior` populates `EquipmentModuleContract.command_behavior`; a row without it yields `undefined`.
- [ ] `writeSpecContract`'s per-EM upsert row carries `command_behavior` (`?? null`).
- [ ] `npx tsc -b` clean.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts` → pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the migration.** Create `supabase/migrations/20260702000000_command_behavior.sql`:

```sql
-- SP-3c: command-conditional device holds per acting PackML state, authored by
-- Stage B of the FDS co-author. Record<state_id, CommandBehaviorV2>. Nullable,
-- additive — existing rows read NULL (treated as absent by the app).
alter table fds_operation_sessions
  add column if not exists command_behavior jsonb;

comment on column fds_operation_sessions.command_behavior is
  'Command-conditional device holds per acting PackML state (SP-3c). Record<state_id, CommandBehaviorV2>.';
```

Do NOT run `npx supabase db push` — that is a deploy step for the user. Local tests mock supabase and do not need the column.

- [ ] **Step 2: Write the failing round-trip tests.** In `src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts`, extend the import from `../contract` to `import { writeSpecContract, upgradeEquipmentModuleContracts, buildUpgradeContext } from "../contract";` and append:

```ts
describe("command_behavior persistence (SP-3c)", () => {
  const CB = {
    execute: {
      branches: [
        { branch_id: "drive_fwd", label: "Drive Forward",
          when: [{ tag: "CAR_CMD_FWD", operator: "=", value: true }],
          control_modules: [{ tag: "CAR_M01_FWD", description: "", state: "on" }] },
      ],
      default_hold: [{ tag: "CAR_M01_FWD", description: "", state: "off" }],
    },
  };

  it("upgradeEquipmentModuleContracts passes command_behavior through to the contract", () => {
    const ctx = buildUpgradeContext({});
    const out = upgradeEquipmentModuleContracts(
      [{ equipment_module_id: "em1", unit_id: "u1", static_states_v2: {}, sequential_states: {}, em_states: [], em_transitions: [], command_behavior: CB }],
      ctx,
    );
    expect(out.em1.command_behavior).toEqual(CB);
  });

  it("upgradeEquipmentModuleContracts yields undefined when the row has none (backward-compat)", () => {
    const ctx = buildUpgradeContext({});
    const out = upgradeEquipmentModuleContracts(
      [{ equipment_module_id: "em1", unit_id: "u1", static_states_v2: {}, sequential_states: {}, em_states: [], em_transitions: [] }],
      ctx,
    );
    expect(out.em1.command_behavior).toBeUndefined();
  });

  it("writeSpecContract persists command_behavior on the fds_operation_sessions upsert", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      equipment_modules: {
        em1: {
          equipment_module_id: "00000000-0000-4000-8000-000000000001",
          unit_id: "00000000-0000-4000-8000-000000000002",
          states: [
            { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
            { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
          ],
          transitions: [], static_states: {}, sequential_states: {},
          command_behavior: CB,
        },
      },
    });
    const s = writeCalls.find((c) => c.table === "fds_operation_sessions" && c.op === "upsert");
    expect(s?.payload).toMatchObject({ command_behavior: { execute: expect.any(Object) } });
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts`
Expected: FAIL — `upgradeEquipmentModuleContracts`/`buildUpgradeContext` are not exported; the upsert payload lacks `command_behavior`.

> If `buildUpgradeContext({})` throws in Step 4 because it reads required fields, read the function (contract.ts:224) and pass the minimal `projectRow` it needs instead of `{}` — the two functions are pure, so no mocking is required beyond the file's existing supabase mock.

- [ ] **Step 3: Add the type field.** In `src/types/spec-builder.ts`, add `CommandBehaviorV2` to the existing `import type { ... } from "@/types/spec-contract-v2"` list, then inside `interface OperationSession` directly after the `em_transitions?: EmTransitionV2[];` line (~582):

```ts
  // Command-conditional device holds per acting PackML state (SP-3c).
  // Keyed by EM-local state_id. Absent until Stage B authors one.
  command_behavior?: Record<string, CommandBehaviorV2>;
```

- [ ] **Step 4: Wire the contract read/write.** In `src/lib/spec-builder/contract.ts`:

  (a) Export the two pure upgrade helpers (needed by the tests; add a note):

  - change `function buildUpgradeContext(` (~line 224) to `export function buildUpgradeContext(`
  - change `function upgradeEquipmentModuleContracts(` (~line 336) to `export function upgradeEquipmentModuleContracts(`
  - add above `upgradeEquipmentModuleContracts`'s existing doc comment closing line: ` * Exported for unit tests (pure).`

  (b) In `upgradeEquipmentModuleContracts`, extend the `out[equipment_module_id] = {` literal (~line 365) after `sequential_states: sequentialStates,`:

```ts
      // SP-3c: command-conditional Execute-behavior — pass the session column
      // through verbatim; absent stays absent (schema field is .optional()).
      command_behavior:
        s.command_behavior && typeof s.command_behavior === "object"
          ? (s.command_behavior as EquipmentModuleContract["command_behavior"])
          : undefined,
```

  (c) In `writeSpecContract`'s per-EM upsert row (~line 980), after `em_transitions: asm.transitions,`:

```ts
        command_behavior: asm.command_behavior ?? null,
```

- [ ] **Step 5: Verify.** `npx vitest run src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts` → PASS (existing 2 + new 3). `npx tsc -b` → clean.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/20260702000000_command_behavior.sql src/types/spec-builder.ts src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts
git commit -m "feat(spec-builder): command_behavior persistence pipe (SP-3c)"
```

---

### Task 2: `validateCommandBehavior` + patch-validator wiring

**Goal:** A pure structural validator for `command_behavior` (duplicate branch_ids, key must name a sequential state) wired into `validateSpecContractPatch` — inert for every pre-SP-3c spec.

**Files:**
- Modify: `src/lib/spec-builder/em-state-machine.ts` (after `validateEmStateMachineAndPackml`)
- Test: `src/lib/spec-builder/__tests__/em-state-machine.test.ts`
- Modify: `src/lib/spec-builder/contract.ts` (~line 1184 loop + import)
- Test: `src/lib/spec-builder/__tests__/contract-em-validation.test.ts`

**Acceptance Criteria:**
- [ ] Absent/empty `command_behavior` → `[]` (old specs unaffected).
- [ ] Duplicate `branch_id` within a state flagged; key on a static state flagged; key on an unknown state flagged.
- [ ] Key-kind check skipped when `em.states` is empty (patch without states).
- [ ] `validateSpecContractPatch` surfaces the issues (wiring test).
- [ ] NO PackML slug enforcement added anywhere (SP-3b boundary).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts` → pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing validator tests.** Append to `src/lib/spec-builder/__tests__/em-state-machine.test.ts` (add `validateCommandBehavior` to the existing import from `@/lib/spec-builder/em-state-machine`; `em`, `defaultEmStates` already imported):

```ts
describe("validateCommandBehavior", () => {
  const branch = (id: string, tag: string) => ({
    branch_id: id, label: id,
    when: [{ tag, operator: "=" as const, value: true }],
    control_modules: [],
  });

  it("returns [] when command_behavior is absent", () => {
    expect(validateCommandBehavior(em("none", { states: defaultEmStates() }))).toEqual([]);
  });

  it("passes canonical command_behavior on execute", () => {
    const issues = validateCommandBehavior(em("ok", {
      states: defaultEmStates(),
      command_behavior: { execute: { branches: [branch("fwd", "C_F"), branch("rev", "C_R")], default_hold: [] } },
    }));
    expect(issues).toEqual([]);
  });

  it("flags duplicate branch_ids within a state", () => {
    const issues = validateCommandBehavior(em("dup", {
      states: defaultEmStates(),
      command_behavior: { execute: { branches: [branch("fwd", "C_F"), branch("fwd", "C_R")], default_hold: [] } },
    }));
    expect(issues.some((i) => i.includes('duplicate branch_id "fwd"'))).toBe(true);
  });

  it("flags a key on a static state", () => {
    const issues = validateCommandBehavior(em("static", {
      states: defaultEmStates(),
      command_behavior: { idle: { branches: [branch("x", "C")], default_hold: [] } },
    }));
    expect(issues.some((i) => /command_behavior on non-acting state "idle"/.test(i))).toBe(true);
  });

  it("flags a key on an unknown state", () => {
    const issues = validateCommandBehavior(em("unknown", {
      states: defaultEmStates(),
      command_behavior: { ghost: { branches: [], default_hold: [] } },
    }));
    expect(issues.some((i) => /command_behavior for unknown state "ghost"/.test(i))).toBe(true);
  });

  it("skips the key-kind check when states are empty (patch without states)", () => {
    expect(validateCommandBehavior(em("skel", {
      command_behavior: { execute: { branches: [], default_hold: [] } },
    }))).toEqual([]);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts` → FAIL (`validateCommandBehavior` not exported).

- [ ] **Step 2: Implement.** In `src/lib/spec-builder/em-state-machine.ts`, directly after `validateEmStateMachineAndPackml`:

```ts
/**
 * Structural checks for one EM's command_behavior (SP-3c) — the command-
 * conditional device holds authored by Stage B. Runs inside
 * validateSpecContractPatch, safely for pre-SP-3c specs: absent/empty
 * command_behavior → []. The key-must-be-a-sequential-state rule mirrors
 * validateEmPackmlConformance's check but is re-applied here because the two
 * validators fire on different gates (Stage A persist vs Stage B patch); it is
 * skipped when the EM's states are absent from the patch. No PackML slug
 * enforcement here — the SP-3b Stage-A-only boundary stands.
 */
export function validateCommandBehavior(em: EquipmentModuleContract): string[] {
  const issues: string[] = [];
  const where = `equipment_module ${em.equipment_module_id}`;
  const byId = new Map(em.states.map((s) => [s.state_id, s]));

  for (const [stateId, behavior] of Object.entries(em.command_behavior ?? {})) {
    const seen = new Set<string>();
    for (const b of behavior.branches) {
      if (seen.has(b.branch_id)) {
        issues.push(`${where}: duplicate branch_id "${b.branch_id}" in command_behavior["${stateId}"]`);
      }
      seen.add(b.branch_id);
    }
    if (em.states.length > 0) {
      const st = byId.get(stateId);
      if (!st) {
        issues.push(`${where}: command_behavior for unknown state "${stateId}"`);
      } else if (st.kind !== "sequential") {
        issues.push(`${where}: command_behavior on non-acting state "${stateId}" (must be a sequential state)`);
      }
    }
  }
  return issues;
}
```

Run the suite → PASS.

- [ ] **Step 3: Write the failing wiring test.** In `src/lib/spec-builder/__tests__/contract-em-validation.test.ts`, ensure `validateSpecContractPatch` and `SpecContractPatchSchema` are imported (reuse the file's existing imports from `../contract`; add whichever is missing), then append:

```ts
describe("validateSpecContractPatch — command_behavior wiring (SP-3c)", () => {
  const emPatch = (commandBehavior: Record<string, unknown>) => ({
    equipment_modules: {
      em1: {
        equipment_module_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        unit_id: "9b2e4c6a-8f3d-4a1b-b2c7-1e5f7a9d0c3e",
        states: [
          { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
          { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
        ],
        transitions: [], static_states: {}, sequential_states: {},
        command_behavior: commandBehavior,
      },
    },
  });
  const dupBranch = (label: string, tag: string) => ({
    branch_id: "dup", label,
    when: [{ tag, operator: "=", value: true }],
    control_modules: [],
  });

  it("surfaces duplicate branch_ids through the patch validator", () => {
    const parsed = SpecContractPatchSchema.parse(
      emPatch({ execute: { branches: [dupBranch("A", "T1"), dupBranch("B", "T2")], default_hold: [] } }),
    );
    const issues = validateSpecContractPatch(parsed);
    expect(issues.some((i) => i.includes('duplicate branch_id "dup"'))).toBe(true);
  });

  it("accepts a clean command_behavior patch", () => {
    const parsed = SpecContractPatchSchema.parse(
      emPatch({ execute: { branches: [{ branch_id: "fwd", label: "Fwd", when: [{ tag: "T", operator: "=", value: true }], control_modules: [] }], default_hold: [] } }),
    );
    const issues = validateSpecContractPatch(parsed);
    expect(issues.filter((i) => i.includes("command_behavior"))).toEqual([]);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/contract-em-validation.test.ts` → the duplicate-branch test FAILS (not wired yet).

- [ ] **Step 4: Wire it.** In `src/lib/spec-builder/contract.ts`, add `validateCommandBehavior` to the existing import from `@/lib/spec-builder/em-state-machine` (which already imports `validateEmStateMachine`), then in the per-EM loop (~line 1181–1186) after the `validateEmStateMachine` push:

```ts
      // SP-3c: command_behavior structural checks. Returns [] when the field is
      // absent, so pre-SP-3c specs are unaffected (no PackML enforcement here —
      // the SP-3b Stage-A-only boundary stands).
      issues.push(...validateCommandBehavior(contract as EquipmentModuleContract));
```

- [ ] **Step 5: Verify.** `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts` → all pass. `npx tsc -b` → clean.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/spec-builder/em-state-machine.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts
git commit -m "feat(spec-builder): validateCommandBehavior + patch wiring (SP-3c)"
```

---

### Task 3: Stage B prompt reframe

**Goal:** `buildFdsInterviewSystemPrompt` determines each state's nature (automatic vs command-driven), documents the `command_behavior` response shape with a worked example, forbids mixing shapes, and renders authored command states as completed.

**Files:**
- Modify: `src/lib/spec-builder/fds-prompts.ts`
- Test: `src/lib/spec-builder/__tests__/fds-prompts-command.test.ts` (new)
- Regenerate: `src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap`

**Acceptance Criteria:**
- [ ] New trailing param `commandBehavior: Record<string, CommandBehaviorV2> = {}` — existing callers/tests compile unchanged.
- [ ] INTERVIEW PROTOCOL gains step 0 (nature determination).
- [ ] `# COMMAND-DRIVEN STATES` section with gathering order + JSON shape + worked drive-fwd/rev example (generic illustrative tags).
- [ ] MUST NOTs: never both shapes for one state; commanded motion is a branch, not steps; never invent command tags.
- [ ] A state present in `commandBehavior` renders in ALREADY COMPLETED (branch count) and is annotated — NOT removed — in SEQUENTIAL STATES REMAINING (whitelist reason, see plan notes).
- [ ] `fds-prompts-v2` snapshot regenerated and reviewed; `fds-prompts-emlocal` + `ground-then-refine` still pass.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/fds-prompts-command.test.ts src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts src/lib/spec-builder/__tests__/fds-prompts-emlocal.test.ts src/lib/spec-builder/__tests__/ground-then-refine.test.ts` → pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing tests.** Create `src/lib/spec-builder/__tests__/fds-prompts-command.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFdsInterviewSystemPrompt } from "@/lib/spec-builder/fds-prompts";
import type { EquipmentModuleConfig, UnitConfig, InstrumentTag } from "@/types/spec-builder";
import type { EmStateV2 } from "@/types/spec-contract-v2";

const unit = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false, equipment_modules: [],
} as unknown as UnitConfig;

const em = {
  equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
  control_modules: [
    { control_module_id: "d1", control_module_name: "Drive M01", control_module_class: "motor", is_safety: false, description: "",
      io_signals: [
        { tag: "CAR_M01_FWD", signal_type: "DO", io_address: "Q0.0", description: "Fwd" },
        { tag: "CAR_CMD_FWD", signal_type: "DI", io_address: "I0.0", description: "Pendant fwd" },
      ] },
  ],
} as unknown as EquipmentModuleConfig;

const tags = [
  { tag: "CAR_M01_FWD", description: "Fwd", signal_direction: "DO" },
  { tag: "CAR_CMD_FWD", description: "Pendant fwd", signal_direction: "DI" },
] as unknown as InstrumentTag[];

const emStates: EmStateV2[] = [
  { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
  { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
];

const CB = {
  execute: {
    branches: [{ branch_id: "drive_fwd", label: "Drive Forward", when: [{ tag: "CAR_CMD_FWD", operator: "=" as const, value: true }], control_modules: [] }],
    default_hold: [],
  },
};

describe("buildFdsInterviewSystemPrompt — command_behavior (SP-3c)", () => {
  it("asks the nature question before permissives/steps", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toMatch(/0\.\s+\*\*Nature\*\*/);
    expect(p).toContain("COMMAND-DRIVEN");
  });

  it("documents the command_behavior response shape with a worked example", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toContain("# COMMAND-DRIVEN STATES");
    expect(p).toContain('"command_behavior"');
    expect(p).toContain('"default_hold"');
    expect(p).toContain('"drive_fwd"');
  });

  it("forbids mixing steps and command_behavior for one state", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toMatch(/BOTH "steps" and "command_behavior"/);
  });

  it("renders an authored command state as completed with its branch count", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, [], CB);
    expect(p).toContain("Command-driven — 1 branch(es) authored");
    expect(p).toMatch(/- execute\s+\(Execute\)\s+— command-driven, 1 branch\(es\) authored/);
  });

  it("does not annotate unauthored states", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).not.toContain("command-driven, ");
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/fds-prompts-command.test.ts` → FAIL (content absent; 8th arg unused).

- [ ] **Step 2: Edit the prompt builder.** In `src/lib/spec-builder/fds-prompts.ts`:

  (a) Add `CommandBehaviorV2` to the `import type { ... } from "@/types/spec-contract-v2"` list.

  (b) Signature — add the trailing parameter (after `sourceSections`):

```ts
  sourceSections: SourceSection[] = [],
  commandBehavior: Record<string, CommandBehaviorV2> = {},
```

  (c) Replace the `completedText` construction with:

```ts
  const completedText = [
    ...Object.entries(completedSequentialStates).map(([stateId, data]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      // SequentialStateV2 permissives are structured; render their tag for the summary.
      const perms = data.permissives.map((p) => `    - ${p.tag} ${p.operator} ${String(p.value)}`).join("\n");
      const stepCount = data.steps.length;
      return `  ${stateName}:\n    Permissives:\n${perms || "    (none)"}\n    Steps: ${stepCount} V2 step(s)`;
    }),
    // SP-3c: command-driven states count as completed once their
    // command_behavior is authored.
    ...Object.entries(commandBehavior).map(([stateId, cb]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      return `  ${stateName}:\n    Command-driven — ${cb.branches.length} branch(es) authored`;
    }),
  ].join("\n");
```

  (d) Replace the `sequentialStatesTable` construction with (annotate, don't exclude — the list doubles as the state_id whitelist, and excluding an authored command state would forbid re-emitting a refinement for it):

```ts
  const sequentialStatesTable = sequentialStatesList
    .map((s) => {
      const cb = commandBehavior[s.state_id];
      const suffix = cb ? `  — command-driven, ${cb.branches.length} branch(es) authored` : "";
      return `  - ${s.state_id}  (${stateLabel(s)})${suffix}`;
    })
    .join("\n");
```

  (e) In the `# INTERVIEW PROTOCOL` block, insert a step 0 line directly before `1. **Permissives**`:

```
0. **Nature** — FIRST, determine whether this state is (a) an AUTOMATIC step sequence that runs to completion, or (b) COMMAND-DRIVEN manual behaviour (an operator holds a command input; devices respond while it is held). In grounded mode infer the nature from the customer spec and tag it "(assumption — confirm)". A command-driven state is authored as command_behavior (see COMMAND-DRIVEN STATES below), NOT as steps — skip the step interview for it.
```

  (f) Insert a new section between the `${completenessRule}` line and `## Questioning rules` (mind the template-literal backtick escapes — follow the file's existing `\`\`\`json` style):

```
# COMMAND-DRIVEN STATES (command_behavior)

When the engineer confirms a state is command-driven, do NOT author steps. Gather, in order:
1. The command input tags (operator / HMI / pendant inputs) that drive the motions.
2. One branch per command: a branch_id slug, a display label, the when-conditions (the command condition AND any interlock guards — all INPUT tags, permissive shape { tag, operator, value } with raw booleans), and the device holds while the when-conditions are true (OUTPUT tags with their held state).
3. The default_hold — what every commanded device holds when NO branch is active (typically the safe/off values).

Branch mutual exclusion is expressed through the when-conditions themselves. A branch with an empty holds list is legal.

For a command-driven state, emit this shape INSTEAD of steps:

\`\`\`json
[
  {
    "state_id": "execute",
    "command_behavior": {
      "branches": [
        { "branch_id": "drive_fwd", "label": "Drive Forward",
          "when": [ { "tag": "CAR_CMD_FWD", "operator": "=", "value": true }, { "tag": "CAR_LS_FWD", "operator": "=", "value": false } ],
          "control_modules": [ { "tag": "CAR_M01_FWD", "description": "Carriage motor forward", "state": "on" } ] },
        { "branch_id": "drive_rev", "label": "Drive Reverse",
          "when": [ { "tag": "CAR_CMD_REV", "operator": "=", "value": true }, { "tag": "CAR_LS_REV", "operator": "=", "value": false } ],
          "control_modules": [ { "tag": "CAR_M01_REV", "description": "Carriage motor reverse", "state": "on" } ] }
      ],
      "default_hold": [
        { "tag": "CAR_M01_FWD", "description": "Carriage motor forward", "state": "off" },
        { "tag": "CAR_M01_REV", "description": "Carriage motor reverse", "state": "off" }
      ]
    }
  }
]
\`\`\`

state_id must come from SEQUENTIAL STATES REMAINING. The example tags are illustrative — always use tags from OUTPUT TAGS / INPUT TAGS.
```

  (g) Append to the `# MUST NOT` list:

```
- ❌ Emitting BOTH "steps" and "command_behavior" for the same state — a state is one or the other.
- ❌ Modelling a commanded motion as steps ("wait for operator to press X" is a command branch, not a step).
- ❌ Inventing command tag names that don't appear in INPUT TAGS.
```

- [ ] **Step 3: Run the new suite + regenerate the snapshot.**

```bash
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-command.test.ts
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts -u
git diff src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap
```

New suite: PASS. REVIEW the snapshot diff — it must show ONLY the additions from Step 2 (step 0, new section, MUST NOTs); any other change means an accidental edit.

- [ ] **Step 4: Verify the full prompt suite set.**

```bash
npx vitest run src/lib/spec-builder/__tests__/fds-prompts-command.test.ts src/lib/spec-builder/__tests__/fds-prompts-v2.test.ts src/lib/spec-builder/__tests__/fds-prompts-emlocal.test.ts src/lib/spec-builder/__tests__/ground-then-refine.test.ts
npx tsc -b
```

All pass; tsc clean.

- [ ] **Step 5: Generic self-check (CLAUDE.md).** `fds-prompts.ts` matches `*-prompt*.ts`. Confirm: the nature question, the COMMAND-DRIVEN section, and the worked example are machine-type-agnostic (a conveyor jog, a carriage drive, a filler manual dose all fit); illustrative tags only, nothing from `Docs/Functional Specs/`.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/spec-builder/fds-prompts.ts src/lib/spec-builder/__tests__/fds-prompts-command.test.ts src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap
git commit -m "feat(spec-builder): Stage B command-driven state authoring prompt (SP-3c)"
```

---

### Task 4: Hook routing + mutual exclusion

**Goal:** `processAiResponse` routes blocks on shape (steps vs `command_behavior`), enforces steps-XOR-branches, validates command blocks through the patch gate, and persists them to the session's `command_behavior` column; the prompt builder receives `session.command_behavior`.

**Files:**
- Modify: `src/hooks/use-fds-conversation.ts`

**Acceptance Criteria:**
- [ ] A block with `command_behavior` is schema-validated (`CommandBehaviorV2Schema`) then patch-gated (`SpecContractPatchSchema` + `validateSpecContractPatch`, which includes Task 2's checks); failures become validation-failure turns.
- [ ] XOR enforced: command block for a state with persisted steps → failure; steps block for a state with persisted (or same-response) `command_behavior` → failure; a single block carrying both → failure. Nothing persists for a failed block; other valid blocks in the same response still merge.
- [ ] Valid command blocks merge into `update.command_behavior` (same merge pattern as `sequential_states`).
- [ ] `buildSystemPrompt` passes `session.command_behavior ?? {}` as the 8th argument.
- [ ] Stage A path (`handleStateMachineResponse`) untouched.

**Verify:** `npx tsc -b` → clean; `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/fds-prompts-command.test.ts` → still green. (Hook not mounted in tests — accepted tradeoff per spec; the routing's pure constituents are covered by Tasks 2–3.)

**Steps:**

- [ ] **Step 1: Imports.** In `src/hooks/use-fds-conversation.ts`, add a value import (the file currently imports only types from this module):

```ts
import { CommandBehaviorV2Schema } from "@/types/spec-contract-v2";
```

and add `CommandBehaviorV2` to the existing `import type { ... } from "@/types/spec-contract-v2"` list.

- [ ] **Step 2: Pass command_behavior to the prompt.** In `buildSystemPrompt` (~line 126), append the argument after `emSections` and extend the dependency array:

```ts
    return buildFdsInterviewSystemPrompt(
      equipment_module, unit, allTags,
      session.static_states,
      // Prompt builder now consumes SequentialStateV2 directly (Phase 3 Task 2).
      session.sequential_states,
      emStates,
      emSections,
      // SP-3c: authored command-driven states render as completed.
      session.command_behavior ?? {},
    );
  }, [equipment_module, unit, allTags, session.static_states, session.sequential_states, session.command_behavior, emStates, emSections]);
```

- [ ] **Step 3: Route in `processAiResponse`.** Change the return type and loop. Replace the function's result type annotation with:

```ts
    (fullText: string): {
      updates: Array<{ state_id: string; data: SequentialStateV2 }>;
      commandUpdates: Array<{ state_id: string; data: CommandBehaviorV2 }>;
      failures: Array<{ state_id: string; issues: string[]; stateLabel: string }>;
    } => {
```

initialize `const commandUpdates: Array<{ state_id: string; data: CommandBehaviorV2 }> = [];` beside `updates`, return `{ updates, commandUpdates, failures }` from both exits, and insert the routing at the TOP of the per-block loop, directly after the `if (!stateId) continue;` line:

```ts
        // SP-3c: route on shape. A block carrying command_behavior authors
        // command-conditional holds for the state; a steps block keeps the
        // existing path. A state is EITHER automatic (steps) OR command-driven
        // (command_behavior) — never both.
        if (block.command_behavior !== undefined) {
          if (block.steps !== undefined) {
            failures.push({
              state_id: stateId,
              issues: [`State "${stateId}": a block must carry EITHER steps OR command_behavior, not both.`],
              stateLabel: stateLabelFor(stateId),
            });
            continue;
          }
          if ((session.sequential_states[stateId]?.steps?.length ?? 0) > 0) {
            failures.push({
              state_id: stateId,
              issues: [`State "${stateId}" already has an authored step sequence. A state is either automatic (steps) or command-driven (command_behavior) — clear the steps first.`],
              stateLabel: stateLabelFor(stateId),
            });
            continue;
          }
          const parsedCb = CommandBehaviorV2Schema.safeParse(block.command_behavior);
          if (!parsedCb.success) {
            failures.push({
              state_id: stateId,
              issues: parsedCb.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
              stateLabel: stateLabelFor(stateId),
            });
            continue;
          }
          // Patch gate: same two-stage machinery as steps blocks. Includes the
          // EM's authored states/transitions so validateCommandBehavior's
          // key-must-be-sequential check engages.
          const cbPatch = {
            equipment_modules: {
              [equipment_module.equipment_module_id]: {
                equipment_module_id: equipment_module.equipment_module_id,
                unit_id: unit.unit_id,
                states: session.em_states ?? [],
                transitions: session.em_transitions ?? [],
                static_states: session.static_states,
                sequential_states: session.sequential_states,
                command_behavior: { ...(session.command_behavior ?? {}), [stateId]: parsedCb.data },
              },
            },
          };
          const cbParsed = SpecContractPatchSchema.safeParse(cbPatch);
          const cbIssues: string[] = [];
          if (!cbParsed.success) {
            for (const issue of cbParsed.error.issues) cbIssues.push(`${issue.path.join(".")}: ${issue.message}`);
          } else {
            cbIssues.push(...validateSpecContractPatch(cbParsed.data));
          }
          if (cbIssues.length > 0) {
            failures.push({ state_id: stateId, issues: cbIssues, stateLabel: stateLabelFor(stateId) });
            continue;
          }
          commandUpdates.push({ state_id: stateId, data: parsedCb.data });
          continue;
        }

        // Steps block for a command-driven state → XOR failure.
        if (
          session.command_behavior?.[stateId] !== undefined ||
          commandUpdates.some((u) => u.state_id === stateId)
        ) {
          failures.push({
            state_id: stateId,
            issues: [`State "${stateId}" is authored as command-driven (command_behavior). It cannot also carry steps — clear the command behaviour first.`],
            stateLabel: stateLabelFor(stateId),
          });
          continue;
        }
```

Extend the `useCallback` dependency array with `session.em_states, session.em_transitions, session.command_behavior`.

- [ ] **Step 4: Persist command updates.** In `sendMessage`'s Stage B branch, destructure the new field:

```ts
        const { updates: tableUpdates, commandUpdates, failures } = processAiResponse(fullText);
```

and after the existing `if (tableUpdates.length > 0) { ... }` block, add:

```ts
        if (commandUpdates.length > 0) {
          const existingCb = { ...(session.command_behavior ?? {}) };
          for (const { state_id, data } of commandUpdates) {
            existingCb[state_id] = data;
          }
          update.command_behavior = existingCb;
          if (session.status === "static_confirmed") update.status = "in_progress";
        }
```

Extend `sendMessage`'s dependency array with `session.command_behavior` (and `session.em_states`/`session.em_transitions` if the linter requires — `processAiResponse` is already a dep, so its own deps flow through it).

- [ ] **Step 5: Verify.**

```bash
npx tsc -b
npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/fds-prompts-command.test.ts
npm run lint -- src/hooks/use-fds-conversation.ts
```

tsc clean (confirms types + no unused locals); suites green; lint clean on the touched file (react-hooks/exhaustive-deps).

- [ ] **Step 6: Commit.**

```bash
git add src/hooks/use-fds-conversation.ts
git commit -m "feat(spec-builder): route + persist Stage B command_behavior blocks (SP-3c)"
```

---

### Task 5: Compose + operating-sequence rendering

**Goal:** A command-driven state gets a `functional_description` section row carrying serialized branches (today it is silently skipped), and the shared `summarizeAction` renders row-per-branch lines — so DOCX and the Structured Spec Editor both show authored manual motions with zero renderer changes.

**Files:**
- Modify: `src/types/spec-builder.ts` (`CommandBranchEntry` + `FunctionalDescriptionContent` fields, after `TransitionEntry` ~line 465)
- Modify: `src/lib/spec-builder/fds-compose.ts` (sequential loop, ~line 182)
- Modify: `src/lib/spec-builder/operating-sequence.ts` (`summarizeAction`)
- Test: `src/lib/spec-builder/__tests__/operating-sequence.test.ts`
- Test: `src/lib/spec-builder/__tests__/fds-compose-command.test.ts` (new)

**Acceptance Criteria:**
- [ ] `composeFdsToSections` inserts a row for a sequential state that has `command_behavior` (serialized `when` via `serializePermissive`), with `steps` absent — and still skips sequential states with neither steps data nor command_behavior.
- [ ] `summarizeAction` renders `"<label> — while <when AND-joined>: <tag: state, ...>"` per branch plus a `"Default — ..."` line; step-sequence and static states render unchanged.
- [ ] `docx-exporter.ts` and `spec-editor.tsx` need no edits (they consume `EmStepView.action: string[]`).

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/operating-sequence.test.ts src/lib/spec-builder/__tests__/fds-compose-command.test.ts` → pass; `npx tsc -b` → clean.

**Steps:**

- [ ] **Step 1: Write the failing view tests.** Append to `src/lib/spec-builder/__tests__/operating-sequence.test.ts` (the `fd()` factory already exists at the top of the file):

```ts
describe("buildEmOperationView — command-driven state (SP-3c)", () => {
  it("renders one action line per branch plus the default hold", () => {
    const view = buildEmOperationView([
      fd("Execute", {
        pattern: "sequential",
        command_branches: [
          { label: "Drive Forward", when: ["CMD_FWD = TRUE", "LS_FWD = FALSE"], control_modules: [{ tag: "M01_FWD", description: "", state: "on" }] },
          { label: "Drive Reverse", when: ["CMD_REV = TRUE", "LS_REV = FALSE"], control_modules: [{ tag: "M01_REV", description: "", state: "on" }] },
        ],
        default_hold: [{ tag: "M01_FWD", description: "", state: "off" }],
        transitions: [],
      }),
    ]);
    expect(view.steps[0].action).toEqual([
      "Drive Forward — while CMD_FWD = TRUE AND LS_FWD = FALSE: M01_FWD: on",
      "Drive Reverse — while CMD_REV = TRUE AND LS_REV = FALSE: M01_REV: on",
      "Default — M01_FWD: off",
    ]);
  });

  it("leaves step-sequence states unchanged (regression)", () => {
    const view = buildEmOperationView([
      fd("Auto", { pattern: "sequential", steps: [], transitions: [] }),
    ]);
    expect(view.steps[0].action).toEqual(["Sequenced — see steps below"]);
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/operating-sequence.test.ts` → the branch test FAILS (renders "Sequenced — see steps below"). (`command_branches` on the content literal may also need Step 3's type first for tsc; vitest transpiles per-file so the runtime failure shows regardless.)

- [ ] **Step 2: Write the failing compose test.** Create `src/lib/spec-builder/__tests__/fds-compose-command.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const writeCalls: Array<{ table: string; op: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: null }) }) }) }),
      insert: (payload: unknown) => { writeCalls.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
    }),
  },
}));

import { composeFdsToSections } from "../fds-compose";
import type { UnitConfig, OperationSession } from "@/types/spec-builder";

const unit = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false,
  equipment_modules: [{ equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "", control_modules: [] }],
} as unknown as UnitConfig;

const session = {
  id: "s1", spec_project_id: "proj", unit_id: "u1", equipment_module_id: "em1",
  status: "complete", static_confirmed: true,
  static_states: { aborted: [] },
  sequential_states: {},
  em_states: [
    { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
  ],
  em_transitions: [],
  command_behavior: {
    execute: {
      branches: [{
        branch_id: "drive_fwd", label: "Drive Forward",
        when: [{ tag: "CAR_CMD_FWD", operator: "=", value: true }],
        control_modules: [{ tag: "CAR_M01_FWD", description: "", state: "on" }],
      }],
      default_hold: [{ tag: "CAR_M01_FWD", description: "", state: "off" }],
    },
  },
  conversation: [],
} as unknown as OperationSession;

beforeEach(() => { writeCalls.length = 0; });

describe("composeFdsToSections — command-driven state (SP-3c)", () => {
  it("inserts a functional_description row carrying serialized command branches", async () => {
    await composeFdsToSections("proj", unit, [session]);
    const row = writeCalls.find(
      (c) => c.table === "spec_sections" && c.op === "insert" &&
        (c.payload as { state_id?: string }).state_id === "execute",
    );
    expect(row).toBeTruthy();
    const content = (row!.payload as { content_json: Record<string, unknown> }).content_json;
    expect(content.command_branches).toEqual([
      { label: "Drive Forward", when: ["CAR_CMD_FWD = TRUE"], control_modules: [{ tag: "CAR_M01_FWD", description: "", state: "on" }] },
    ]);
    expect(content.default_hold).toEqual([{ tag: "CAR_M01_FWD", description: "", state: "off" }]);
    expect(content.steps).toBeUndefined();
  });

  it("still skips sequential states with neither steps nor command_behavior", async () => {
    const bare = { ...session, command_behavior: undefined } as unknown as OperationSession;
    await composeFdsToSections("proj", unit, [bare]);
    const row = writeCalls.find(
      (c) => c.table === "spec_sections" && c.op === "insert" &&
        (c.payload as { state_id?: string }).state_id === "execute",
    );
    expect(row).toBeUndefined();
  });
});
```

Run: `npx vitest run src/lib/spec-builder/__tests__/fds-compose-command.test.ts` → first test FAILS (no row inserted for `execute`).

> If `composeFdsToSections` performs supabase calls the mock doesn't cover (chain mismatch), read the function's calls in `fds-compose.ts` (lines 96–158) and extend the mock's method chain accordingly — never change production code to fit the mock.

- [ ] **Step 3: Add the serialized types.** In `src/types/spec-builder.ts`, directly after the `TransitionEntry` interface (~line 465):

```ts
/** A serialized command branch rendered in the functional description (SP-3c). */
export interface CommandBranchEntry {
  label: string;
  /** Serialized AND-ed when-conditions, e.g. "CAR_CMD_FWD = TRUE". */
  when: string[];
  control_modules: ControlModuleStateEntry[];
}
```

and extend `FunctionalDescriptionContent` (after the `transitions?` field):

```ts
  // Pattern B variant (command-driven acting state, SP-3c) — command branches
  // instead of a step table. Present only when the state was authored as
  // command_behavior; steps/permissives are absent then.
  command_branches?: CommandBranchEntry[];
  default_hold?: ControlModuleStateEntry[];
```

- [ ] **Step 4: Compose the row.** In `src/lib/spec-builder/fds-compose.ts`, at the top of the sequential-states loop (~line 182), before `const data = session.sequential_states[state.state_id];`:

```ts
      // SP-3c: a command-driven acting state carries command_behavior instead
      // of a step table (steps XOR command_behavior per state). Serialize its
      // branches for the editor/DOCX and skip the steps path.
      const cb = session.command_behavior?.[state.state_id];
      if (cb) {
        await insertRow(session, state, {
          pattern: "sequential",
          command_branches: cb.branches.map((b) => ({
            label: b.label,
            when: b.when.map(serializePermissive),
            control_modules: b.control_modules,
          })),
          default_hold: cb.default_hold,
          transitions: outgoingTransitions(state.state_id, transitions, stateNameById),
        });
        continue;
      }
```

- [ ] **Step 5: Render the branches.** In `src/lib/spec-builder/operating-sequence.ts`, replace `summarizeAction` with:

```ts
/** The Action column for a step: device outputs held, or a sequence pointer. */
export function summarizeAction(fd: FunctionalDescriptionContent): string[] {
  // Command-driven acting state (SP-3c): one line per branch — label, the
  // AND-ed when-conditions, and the holds — plus the default hold. Machine
  // boolean, no prose. Both the DOCX exporter and the structured editor render
  // these lines verbatim, so no renderer change is needed.
  if (fd.command_branches?.length) {
    const holdText = (ds: { tag: string; state: string }[]) =>
      ds.map((d) => `${d.tag}: ${d.state}`).join(", ") || "—";
    const lines = fd.command_branches.map(
      (b) => `${b.label} — while ${b.when.join(" AND ")}: ${holdText(b.control_modules)}`,
    );
    if (fd.default_hold?.length) lines.push(`Default — ${holdText(fd.default_hold)}`);
    return lines;
  }
  if (fd.pattern === "sequential") return ["Sequenced — see steps below"];
  const ds = fd.control_module_states ?? [];
  if (!ds.length) return ["—"];
  return ds.map((d) => `${d.tag}: ${d.state}`);
}
```

- [ ] **Step 6: Verify.**

```bash
npx vitest run src/lib/spec-builder/__tests__/operating-sequence.test.ts src/lib/spec-builder/__tests__/fds-compose-command.test.ts
npx tsc -b
grep -rn "buildEmOperationView\|summarizeAction" src/lib/spec-builder/docx-exporter.ts src/components/spec-builder/spec-editor.tsx
```

Both suites pass; tsc clean; the grep confirms both consumers go through the shared builder (action lines render as-is — no renderer edits needed; if either consumer bypasses `summarizeAction` for the Action column, STOP and report rather than patching renderers unplanned).

- [ ] **Step 7: Commit.**

```bash
git add src/types/spec-builder.ts src/lib/spec-builder/fds-compose.ts src/lib/spec-builder/operating-sequence.ts src/lib/spec-builder/__tests__/operating-sequence.test.ts src/lib/spec-builder/__tests__/fds-compose-command.test.ts
git commit -m "feat(spec-builder): render command-driven states in compose + operating view (SP-3c)"
```

---

## Self-Review

**Spec coverage:**
- §2a migration → Task 1 Step 1. ✓
- §2b OperationSession type → Task 1 Step 3. ✓
- §2c read / §2d write → Task 1 Step 4. ✓
- §2e DOCX rendering → Task 5 (via shared `summarizeAction` — plan-level simplification noted in header; `docx-exporter.ts` verified untouched-safe in Task 5 Step 6). ✓
- §3a–d prompt (nature, command section, response shape, MUST NOTs) → Task 3 Step 2 e/f/g. ✓
- §3e completion semantics → Task 3 Step 2 c/d (annotate-not-exclude deviation documented with the whitelist reason). ✓
- §4 hook routing + XOR + merge → Task 4 Steps 3–4. ✓
- §5 `validateCommandBehavior` + `validateSpecContractPatch` wiring + SP-3b boundary → Task 2. ✓
- Spec Testing list → validator (T2), prompt (T3), contract round-trip (T1), operating view (T5), hook at pure level (T4 note). ✓
- Non-goals — untouched. ✓

**Placeholder scan:** No TBD/TODO; all code/test blocks complete; commands exact; the two look-before-you-leap contingencies (buildUpgradeContext arg, compose mock chain) give explicit resolution instructions, not hand-waves. ✓

**Type consistency:** `CommandBehaviorV2` (`{branches, default_hold}`) and `CommandBranch` (`{branch_id,label,when,control_modules}`) used identically in Tasks 1/2/3/4 (SP-3a schema). `validateCommandBehavior(em): string[]` defined T2, wired T2 Step 4, exercised via patch in T4. `CommandBranchEntry` (`{label, when: string[], control_modules}` — serialized) used in T5 types/compose/view/test consistently, distinct from the unserialized `CommandBranch` (`when: PermissiveCondition[]`) by design. `processAiResponse` return `{updates, commandUpdates, failures}` consistent within T4. Prompt param `commandBehavior: Record<string, CommandBehaviorV2> = {}` — 8th positional arg matches T3 tests (`..., [], CB`) and T4 Step 2 call. ✓

**Ordering:** T4 blockedBy 1 (session field), 2 (patch wiring), 3 (prompt param). T5 blockedBy 1 (`OperationSession.command_behavior`). ✓

**Deploy reminder:** after merge, `npx supabase db push` is required for the new column (user-run; local tests do not need it).
