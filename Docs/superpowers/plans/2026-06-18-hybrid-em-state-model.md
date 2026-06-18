# Hybrid Per-Equipment-Module State Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the FDS state machine from a single global `OperatingStateV2[]` to per-Equipment-Module state machines, with the machine level reduced to extensible modes + safety gates, and delete the now-obsolete `unit_procedures` / system-orchestration coordination layer.

**Architecture:** Three layers. (1) MACHINE owns extensible `modes` + `safety_gates` (condition → force scoped EMs to their safe state). (2) Each EQUIPMENT MODULE owns its own `states[]` (kind `static`|`sequential`) + `transitions[]` (trigger command/completion + permissive guard); its existing `static_states`/`sequential_states` behavior maps re-key from the global state id to the EM-local state id. (3) CONTROL MODULE is unchanged (basic control, IO only). Inter-EM coordination is expressed as permissive guards on EM transitions — there is no separate orchestration layer.

**Tech Stack:** TypeScript 5.9, Zod (schema source of truth), React 19 + Vite, TanStack Query, Supabase (Postgres + jsonb), Vitest (test runner; config inline in `vite.config.ts`, script `npm test`).

---

## Known-red baseline (investigated 2026-06-18, pre-existing on base commit `680d49d`)

The base commit has **43 pre-existing test failures**, root-caused into three independent causes. None are caused by this plan. Gating rule for every task: **my new tests pass + `npm run build` passes + no NEW failures beyond this baseline.**

- **Cluster A — pac-quote `client`→`customer` rename drift (~34 tests; OUT OF SCOPE).** Committed half-finished rename: `src/lib/quote-snapshot.ts` (`BuildSnapshotInput.client`, reads `input.client.id`) and `src/lib/quote-validation.ts` (`input.project.client_id`) still use `client`, but tests/app use `customer`. Breaks `quote-snapshot*`, `quote-validation`, `use-issue-quote`, `use-issue-variation`, `issue-flow.integration`, `variation-flow.integration`. **Do not fix in this plan** — leave red.
- **Cluster D — `section-line-items.test.tsx` (1 test; OUT OF SCOPE).** Switching a line to Hours mode now also writes `hours:"0"`; test expects only `{qty,unit,unit_price}` cleared. Leave red.
- **Cluster B — stale `schema_version: 2` fixtures (8 tests; FIX IN-PLAN).** `src/types/__tests__/spec-contract-v2.test.ts` (4) and `src/lib/spec-builder/__tests__/migration-integration.test.ts` (4) use `schema_version: 2` + omit now-required fields against the `z.literal(3)` schema. **Handle inside this plan:**
  - `spec-contract-v2.test.ts` → refresh in **Wave 1 / Task 1** (bump fixtures to `schema_version: 3`; add the `safety_gates` default expectation; keep them green through the additive change).
  - `migration-integration.test.ts` → handle in **Wave 7 / Task 11**: it exercises the legacy global-state→V2 migration that Wave 7 deletes (spec non-goal #3 — no legacy migration). Remove the test (and the fixtures it loads) when that migration path is removed, rather than re-greening it.

Baseline-red files (A+D) to ignore when checking for regressions: `section-line-items.test.tsx`, `use-issue-quote.test.tsx`, `use-issue-variation.test.tsx`, `issue-flow.integration.test.tsx`, `quote-snapshot.sanity.test.ts`, `quote-snapshot.test.ts`, `quote-validation.test.ts`, `variation-flow.integration.test.tsx`.

---

## Pinned decisions (resolved from spec §7 "Open items")

1. **Expression type for `trigger.expr` and transition `guard`:** reuse the existing `PermissiveCondition` (`{ tag, operator, value }`). No new expression type. A transition's `guard` is `PermissiveCondition[]` (AND-ed; empty = always allowed), matching how `SequentialStateV2.permissives` already works. A command trigger carries a single `PermissiveCondition` as `expr`.
2. **`SafetyGateV2.condition`** is `PermissiveCondition[]` with **OR-of-faults** semantics: the gate is *violated* (forces scoped EMs to safe) when **any** listed condition evaluates true. This expresses `NOT EStop_Healthy OR NOT SR1_Healthy` as `[{tag:"EStop_Healthy",operator:"=",value:false},{tag:"SR1_Healthy",operator:"=",value:false}]`.
3. **`EmTransitionV2` carries a `transition_id`** (stable slug) in addition to the spec's `from/to/trigger/guard` — needed as a React key and for validator messages.
4. **Per-EM `states`/`transitions` live inline on the EM contract JSON** (matching `static_states`), persisted as two new jsonb columns on `fds_operation_sessions` (`em_states`, `em_transitions`). No new table.
5. **`safety_gates` persist** to a new `spec_projects.safety_gates jsonb` column.
6. **Co-author interview is staged** (spec §7): Stage A authors the EM's states + transitions (skeleton); Stage B fills per-state behavior (existing static/sequential interview, re-keyed to EM-local ids). This plan delivers Stage A as a new prompt builder; Stage B is the existing builder with the state list swapped to EM-local states.
7. **Removal is sequenced last.** Waves 1–6 are additive and keep the build green; Wave 7 deletes the global `states` field, `unit_procedures`, and the system-orchestration subsystem in one coordinated wave after all consumers are migrated.

## EM-local state ids vs global PackML ids

- Global `OperatingStateV2.state_id` was numeric (PackML 1..17 / custom >100) **or** legacy string. The **EM-local** `EmStateV2.state_id` is always a **string slug** (e.g. `"driving_fwd"`, `"idle"`, `"faulted"`). The behavior maps `static_states` / `sequential_states` are already `Record<string, …>` — only the *meaning* of the key changes (EM-local slug, not global state id). No schema change to those two maps.

---

## File map

**Schema / contract (core):**
- Modify `src/types/spec-contract-v2.ts` — add `EmStateV2Schema`, `EmTriggerSchema`, `EmTransitionV2Schema`, `SafetyGateV2Schema`; extend `EquipmentModuleContractSchema` (`states`, `transitions`); extend then later trim `SpecContractV2Schema` (`safety_gates` added; `states` + `unit_procedures` removed in Wave 7).
- Modify `src/lib/spec-builder/contract.ts` — read/write per-EM `em_states`/`em_transitions` + machine `safety_gates`; tolerate-absent `confirmed_states`/`unit_procedures`; delete `loadOrchestration`, `unit_procedures` plumbing, system-orchestration plumbing (Wave 7).

**New pure-logic libraries (Wave 2):**
- Create `src/lib/spec-builder/em-state-machine.ts` — `resolveAllowedStates`, `resolveForcedSafeStates`, `validateEmStateMachine`.
- Create `src/lib/spec-builder/__tests__/em-state-machine.test.ts`.

**DB (Wave 3):**
- Create `supabase/migrations/<timestamp>_hybrid_em_state_model.sql` (named to match the MCP-applied version).

**Wizard (Wave 4):**
- Modify `src/components/spec-builder/spec-skeleton-wizard.tsx` — replace `StepOperatingModes` (global states) with `StepMachineModes` + `StepSafetyGates`.
- Create `src/lib/spec-builder/__tests__/spec-skeleton-wizard-steps.test.ts` (pure helpers extracted from the wizard).

**Co-author (Wave 5):**
- Create `src/lib/spec-builder/em-state-machine-prompts.ts` — `buildEmStateMachineInterviewPrompt` (Stage A) + opening message.
- Modify `src/lib/spec-builder/fds-prompts.ts` — `buildFdsInterviewSystemPrompt` keys by EM-local states (Stage B).
- Modify `src/hooks/use-fds-conversation.ts` — feed EM-local states.
- Create `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts`.

**Random builder (Wave 6):**
- Modify `src/lib/spec-builder/random/state-machine.ts`, `random/assemble.ts`, `random/em-state-machine-builder.ts` (new) — emit per-EM states/transitions + safety gate; drop `unit_procedures`/global `states` from the patch.
- Delete `src/lib/spec-builder/random/orchestration-builder.ts` + its tests.

**Removal blast radius (Wave 7):** `src/lib/spec-builder/fds-compose.ts`, `src/hooks/use-fds-orchestration-conversation.ts`, `src/hooks/use-system-orchestration.ts`, `src/hooks/use-fds-system-orchestration-conversation.ts`, `src/lib/spec-builder/system-orchestration-prompts.ts`, `src/components/spec-builder/system-orchestration-*`, `src/routes/spec-system-orchestration.tsx`, `src/lib/spec-builder/migrate/*interlock*`, `supabase/migrations/<timestamp>_drop_unit_procedures.sql` (RPC `_build_contract_snapshot` rewrite).

---

# WAVE 1 — Additive schema (no removals; build stays green)

### Task 1: Add the four new Zod schemas + EM contract fields

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (insert after `EquipmentModuleContractSchema`, ~line 687)
- Modify: `src/types/spec-contract-v2.ts:938-970` (`SpecContractV2Schema`)
- Test: `src/lib/spec-builder/__tests__/em-schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/em-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  EmStateV2Schema,
  EmTransitionV2Schema,
  SafetyGateV2Schema,
  EquipmentModuleContractSchema,
  SpecContractV2Schema,
} from "@/types/spec-contract-v2";

describe("EmStateV2Schema", () => {
  it("parses a minimal static state and defaults allowed_modes/is_safe_state", () => {
    const s = EmStateV2Schema.parse({ state_id: "idle", name: "Idle", kind: "static" });
    expect(s.allowed_modes).toEqual([]);
    expect(s.is_safe_state).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(() => EmStateV2Schema.parse({ state_id: "x", name: "X", kind: "bogus" })).toThrow();
  });
});

describe("EmTransitionV2Schema", () => {
  it("parses a command-triggered transition with a permissive guard", () => {
    const t = EmTransitionV2Schema.parse({
      transition_id: "t1",
      from_state_id: "stopped",
      to_state_id: "running",
      trigger: { kind: "command", expr: { tag: "HMI_Start", operator: "=", value: true } },
    });
    expect(t.guard).toEqual([]);
  });

  it("parses a completion-triggered transition", () => {
    const t = EmTransitionV2Schema.parse({
      transition_id: "t2",
      from_state_id: "starting",
      to_state_id: "execute",
      trigger: { kind: "completion" },
      guard: [{ tag: "Other_EM_Idle", operator: "=", value: true }],
    });
    expect(t.trigger.kind).toBe("completion");
    expect(t.guard).toHaveLength(1);
  });
});

describe("SafetyGateV2Schema", () => {
  it("parses scope 'all' and an array condition", () => {
    const g = SafetyGateV2Schema.parse({
      gate_id: "estop",
      name: "E-Stop",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
      scope: "all",
    });
    expect(g.scope).toBe("all");
  });

  it("parses scope as an equipment-module id list", () => {
    const g = SafetyGateV2Schema.parse({
      gate_id: "sr1",
      name: "Zone 1",
      condition: [{ tag: "SR1_Healthy", operator: "=", value: false }],
      scope: ["em-a", "em-b"],
    });
    expect(g.scope).toEqual(["em-a", "em-b"]);
  });
});

describe("EquipmentModuleContractSchema — states/transitions", () => {
  it("defaults states and transitions to empty arrays when absent", () => {
    const c = EquipmentModuleContractSchema.parse({
      equipment_module_id: "00000000-0000-4000-8000-000000000001",
      unit_id: "00000000-0000-4000-8000-000000000002",
      static_states: {},
      sequential_states: {},
    });
    expect(c.states).toEqual([]);
    expect(c.transitions).toEqual([]);
  });
});

describe("SpecContractV2Schema — safety_gates", () => {
  it("accepts a contract with safety_gates absent (defaults to [])", () => {
    const base = minimalContract();
    const c = SpecContractV2Schema.parse(base);
    expect(c.safety_gates).toEqual([]);
  });
});

function minimalContract() {
  return {
    schema_version: 3,
    project: {
      id: "00000000-0000-4000-8000-0000000000aa",
      doc_code: "D", title: "T", client_name: "C",
      project_number: null, plc_model: null, hmi_type: null,
      comms_protocol: null, safety_classification: null, fault_philosophy: null,
      design_principles: [], scope_exclusions: [],
    },
    hierarchy: { units: [] },
    states: [],
    alarm_tiers: [],
    equipment_modules: {},
    unit_procedures: {},
    alarms: [],
    io_list: [],
    faults: [],
    sections: {},
  };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- em-schema`
Expected: FAIL — `EmStateV2Schema` (and the others) are not exported yet.

- [ ] **Step 3: Add the schemas**

In `src/types/spec-contract-v2.ts`, immediately **after** `EquipmentModuleContractSchema` / its type export (after line 687), insert:

```typescript
// ============================================================
// Per-Equipment-Module state machine (hybrid state model)
// EM-local states + transitions. state_id here is an EM-local
// string slug (e.g. "driving_fwd"), distinct from the global
// numeric PackML ids used by OperatingStateV2.
// ============================================================

export const EmStateKindSchema = z.enum(["static", "sequential"]);
export type EmStateKind = z.infer<typeof EmStateKindSchema>;

export const EmStateV2Schema = z.object({
  state_id: z.string().min(1),
  name: z.string().min(1),
  kind: EmStateKindSchema,
  // Machine modes this state is valid in. Empty = allowed in all modes.
  allowed_modes: z.array(z.string()).default([]),
  // Exactly one state per EM should be marked the safe state (validated
  // in validateEmStateMachine — see em-state-machine.ts).
  is_safe_state: z.boolean().default(false),
});
export type EmStateV2 = z.infer<typeof EmStateV2Schema>;

// Trigger: a command (operator/HMI/tag condition goes true → manual) or
// the completion of the `from` sequential state (automatic). Command
// triggers reuse PermissiveCondition as the expression type.
export const EmTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), expr: PermissiveConditionSchema }),
  z.object({ kind: z.literal("completion") }),
]);
export type EmTrigger = z.infer<typeof EmTriggerSchema>;

export const EmTransitionV2Schema = z.object({
  transition_id: z.string().min(1),
  from_state_id: z.string().min(1),
  to_state_id: z.string().min(1),
  trigger: EmTriggerSchema,
  // AND-ed permissive guard; may reference other EMs' tags for inter-EM
  // interlocks. Empty = no guard. Reuses PermissiveCondition.
  guard: z.array(PermissiveConditionSchema).default([]),
});
export type EmTransitionV2 = z.infer<typeof EmTransitionV2Schema>;

// ============================================================
// Machine-level safety gate. condition is OR-of-faults: the gate is
// VIOLATED (forces scoped EMs to their is_safe_state) when ANY listed
// condition evaluates true. effect is implied (force to safe).
// ============================================================

export const SafetyGateScopeSchema = z.union([
  z.literal("all"),
  z.array(z.string()), // equipment_module_id[]
]);
export type SafetyGateScope = z.infer<typeof SafetyGateScopeSchema>;

export const SafetyGateV2Schema = z.object({
  gate_id: z.string().min(1),
  name: z.string().min(1),
  condition: z.array(PermissiveConditionSchema).min(1),
  scope: SafetyGateScopeSchema,
});
export type SafetyGateV2 = z.infer<typeof SafetyGateV2Schema>;
```

Then extend `EquipmentModuleContractSchema` (lines 676-687). Replace it with:

```typescript
export const EquipmentModuleContractSchema = z.object({
  equipment_module_id: UuidSchema,
  unit_id: UuidSchema,
  // The EM's OWN state machine (hybrid state model).
  states: z.array(EmStateV2Schema).default([]),
  transitions: z.array(EmTransitionV2Schema).default([]),
  // Per-state behavior. Keyed by EM-LOCAL state_id (EmStateV2.state_id),
  // NOT a global state id. Legacy rows are bare ControlModuleStateEntry
  // arrays; post-confirmation rows use the StaticStateV2 container.
  static_states: z.record(
    z.string(),
    z.union([z.array(ControlModuleStateEntrySchema), StaticStateV2Schema]),
  ),
  sequential_states: z.record(z.string(), SequentialStateV2Schema),
});
export type EquipmentModuleContract = z.infer<typeof EquipmentModuleContractSchema>;
```

> Note: `EmTransitionV2Schema` references `PermissiveConditionSchema` (defined at line 648) and `EquipmentModuleContractSchema` references `EmStateV2Schema`/`EmTransitionV2Schema` — both are defined above their use, so ordering is correct.

Finally, in `SpecContractV2Schema` (line 938), add `safety_gates` **after** the `equipment_modules` line (line 945). Do **not** remove `states` or `unit_procedures` yet:

```typescript
  // Machine-level safety gates (hybrid state model). Optional during the
  // additive wave; defaults to [].
  safety_gates: z.array(SafetyGateV2Schema).default([]),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- em-schema`
Expected: PASS (all cases).

- [ ] **Step 5: Verify nothing else broke**

Run: `npm run build`
Expected: PASS — additions are backward-compatible (`.default([])` on new fields). If `tsc` flags `noUnusedLocals` on a new export, it is consumed by later tasks; that is fine because exports are not "unused locals".

- [ ] **Step 6: Commit**

```bash
git add src/types/spec-contract-v2.ts src/lib/spec-builder/__tests__/em-schema.test.ts
git commit -m "feat(spec-contract): add EM state-machine + safety-gate schemas (additive)"
```

---

# WAVE 2 — Pure logic: mode-gating, safety resolution, transition validation

### Task 2: `em-state-machine.ts` — mode gating + safety resolution

**Files:**
- Create: `src/lib/spec-builder/em-state-machine.ts`
- Test: `src/lib/spec-builder/__tests__/em-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/em-state-machine.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  resolveAllowedStates,
  resolveForcedSafeStates,
  validateEmStateMachine,
} from "@/lib/spec-builder/em-state-machine";
import type {
  EquipmentModuleContract,
  SafetyGateV2,
} from "@/types/spec-contract-v2";

function em(id: string, overrides: Partial<EquipmentModuleContract> = {}): EquipmentModuleContract {
  return {
    equipment_module_id: id,
    unit_id: "u1",
    states: [],
    transitions: [],
    static_states: {},
    sequential_states: {},
    ...overrides,
  };
}

describe("resolveAllowedStates", () => {
  it("returns states whose allowed_modes is empty or includes the mode", () => {
    const carriage = em("carriage", {
      states: [
        { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: false },
        { state_id: "jog", name: "Jog", kind: "static", allowed_modes: ["manual"], is_safe_state: false },
        { state_id: "auto_run", name: "AutoRun", kind: "sequential", allowed_modes: ["auto"], is_safe_state: false },
      ],
    });
    expect(resolveAllowedStates(carriage, "manual").map((s) => s.state_id)).toEqual(["idle", "jog"]);
    expect(resolveAllowedStates(carriage, "auto").map((s) => s.state_id)).toEqual(["idle", "auto_run"]);
  });
});

describe("resolveForcedSafeStates", () => {
  const carriage = em("carriage", {
    states: [
      { state_id: "running", name: "Running", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "faulted", name: "Faulted", kind: "static", allowed_modes: [], is_safe_state: true },
    ],
  });
  const rotator = em("rotator", {
    states: [{ state_id: "safe", name: "Safe", kind: "static", allowed_modes: [], is_safe_state: true }],
  });

  it("forces all EMs to their safe state when an 'all'-scope gate is violated", () => {
    const gate: SafetyGateV2 = {
      gate_id: "estop", name: "E-Stop",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
      scope: "all",
    };
    const forced = resolveForcedSafeStates([carriage, rotator], [gate], ["estop"]);
    expect(forced.get("carriage")).toBe("faulted");
    expect(forced.get("rotator")).toBe("safe");
  });

  it("forces only scoped EMs for a scoped gate", () => {
    const gate: SafetyGateV2 = {
      gate_id: "z1", name: "Zone1",
      condition: [{ tag: "SR1_Healthy", operator: "=", value: false }],
      scope: ["rotator"],
    };
    const forced = resolveForcedSafeStates([carriage, rotator], [gate], ["z1"]);
    expect(forced.has("carriage")).toBe(false);
    expect(forced.get("rotator")).toBe("safe");
  });

  it("returns empty when no gate is violated", () => {
    const gate: SafetyGateV2 = {
      gate_id: "estop", name: "E-Stop",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
      scope: "all",
    };
    expect(resolveForcedSafeStates([carriage, rotator], [gate], []).size).toBe(0);
  });
});

describe("validateEmStateMachine", () => {
  it("accepts a valid EM with exactly one safe state and resolvable transitions", () => {
    const carriage = em("carriage", {
      states: [
        { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "running", name: "Running", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
      transitions: [
        { transition_id: "t1", from_state_id: "stopped", to_state_id: "running",
          trigger: { kind: "command", expr: { tag: "Start", operator: "=", value: true } }, guard: [] },
      ],
    });
    expect(validateEmStateMachine(carriage)).toEqual([]);
  });

  it("flags zero and multiple safe states", () => {
    const none = em("a", { states: [{ state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: false }] });
    expect(validateEmStateMachine(none).some((i) => /exactly one is_safe_state/.test(i))).toBe(true);

    const two = em("b", {
      states: [
        { state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "y", name: "Y", kind: "static", allowed_modes: [], is_safe_state: true },
      ],
    });
    expect(validateEmStateMachine(two).some((i) => /exactly one is_safe_state/.test(i))).toBe(true);
  });

  it("flags a transition referencing an unknown state", () => {
    const bad = em("c", {
      states: [{ state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: true }],
      transitions: [
        { transition_id: "t1", from_state_id: "x", to_state_id: "ghost",
          trigger: { kind: "completion" }, guard: [] },
      ],
    });
    expect(validateEmStateMachine(bad).some((i) => /unknown.*ghost/.test(i))).toBe(true);
  });

  it("flags duplicate transition_ids", () => {
    const dup = em("d", {
      states: [
        { state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "y", name: "Y", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
      transitions: [
        { transition_id: "t", from_state_id: "x", to_state_id: "y", trigger: { kind: "completion" }, guard: [] },
        { transition_id: "t", from_state_id: "y", to_state_id: "x", trigger: { kind: "completion" }, guard: [] },
      ],
    });
    expect(validateEmStateMachine(dup).some((i) => /duplicate transition_id/.test(i))).toBe(true);
  });

  it("does not require a safe state when the EM has no states (skeleton not authored)", () => {
    expect(validateEmStateMachine(em("empty"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- em-state-machine`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `em-state-machine.ts`**

Create `src/lib/spec-builder/em-state-machine.ts`:

```typescript
/**
 * Pure logic for the hybrid per-Equipment-Module state model.
 *
 *  - resolveAllowedStates: given a machine mode, which of an EM's states
 *    are valid (allowed_modes empty = all modes).
 *  - resolveForcedSafeStates: given violated safety gates, which EMs are
 *    forced to their is_safe_state, respecting each gate's scope.
 *  - validateEmStateMachine: structural invariants on one EM's machine.
 *
 * No React, no IO. Deterministic and auditable (rules > AI).
 */
import type {
  EquipmentModuleContract,
  EmStateV2,
  SafetyGateV2,
} from "@/types/spec-contract-v2";

/** States valid in the given machine mode. Empty allowed_modes = all modes. */
export function resolveAllowedStates(
  em: EquipmentModuleContract,
  modeId: string,
): EmStateV2[] {
  return em.states.filter(
    (s) => s.allowed_modes.length === 0 || s.allowed_modes.includes(modeId),
  );
}

function gateAppliesToEm(gate: SafetyGateV2, emId: string): boolean {
  return gate.scope === "all" || gate.scope.includes(emId);
}

/**
 * For each EM in scope of a *violated* gate, resolve the EM-local state_id
 * it is forced into (its is_safe_state). Returns Map<emId, safeStateId>.
 * EMs with no marked safe state are skipped (validate separately).
 */
export function resolveForcedSafeStates(
  ems: EquipmentModuleContract[],
  gates: SafetyGateV2[],
  violatedGateIds: string[],
): Map<string, string> {
  const violated = new Set(violatedGateIds);
  const activeGates = gates.filter((g) => violated.has(g.gate_id));
  const out = new Map<string, string>();
  for (const em of ems) {
    const inScope = activeGates.some((g) => gateAppliesToEm(g, em.equipment_module_id));
    if (!inScope) continue;
    const safe = em.states.find((s) => s.is_safe_state);
    if (safe) out.set(em.equipment_module_id, safe.state_id);
  }
  return out;
}

/**
 * Structural invariants for one EM's state machine. Returns human-readable
 * issues (empty = valid). An EM with zero states is treated as
 * "skeleton not authored yet" and passes silently.
 */
export function validateEmStateMachine(em: EquipmentModuleContract): string[] {
  const issues: string[] = [];
  const where = `equipment_module ${em.equipment_module_id}`;
  if (em.states.length === 0) return issues;

  const safeCount = em.states.filter((s) => s.is_safe_state).length;
  if (safeCount !== 1) {
    issues.push(`${where}: exactly one is_safe_state required, found ${safeCount}`);
  }

  const stateIds = new Set(em.states.map((s) => s.state_id));
  const dupStateIds = em.states
    .map((s) => s.state_id)
    .filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set(dupStateIds)) {
    issues.push(`${where}: duplicate state_id "${id}"`);
  }

  const seenTransitionIds = new Set<string>();
  for (const t of em.transitions) {
    if (seenTransitionIds.has(t.transition_id)) {
      issues.push(`${where}: duplicate transition_id "${t.transition_id}"`);
    }
    seenTransitionIds.add(t.transition_id);
    if (!stateIds.has(t.from_state_id)) {
      issues.push(`${where}: transition ${t.transition_id} from unknown state "${t.from_state_id}"`);
    }
    if (!stateIds.has(t.to_state_id)) {
      issues.push(`${where}: transition ${t.transition_id} targets unknown state "${t.to_state_id}"`);
    }
  }

  return issues;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- em-state-machine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/em-state-machine.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts
git commit -m "feat(spec-builder): EM state-machine mode-gating + safety resolution + validation"
```

### Task 3: Wire EM-state-machine validation into `validateSpecContractPatch`

**Files:**
- Modify: `src/lib/spec-builder/contract.ts` (import + new check block in `validateSpecContractPatch`, ~line 1320)
- Test: `src/lib/spec-builder/__tests__/contract-em-validation.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/contract-em-validation.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateSpecContractPatch } from "../contract";

describe("validateSpecContractPatch — EM state machines", () => {
  it("flags an EM with states but no safe state", () => {
    const issues = validateSpecContractPatch({
      equipment_modules: {
        em1: {
          equipment_module_id: "00000000-0000-4000-8000-000000000001",
          unit_id: "00000000-0000-4000-8000-000000000002",
          states: [{ state_id: "run", name: "Run", kind: "static", allowed_modes: [], is_safe_state: false }],
          transitions: [],
          static_states: {},
          sequential_states: {},
        },
      },
    });
    expect(issues.some((i) => /exactly one is_safe_state/.test(i))).toBe(true);
  });

  it("flags a safety gate scoping an unknown equipment_module id", () => {
    const issues = validateSpecContractPatch({
      hierarchy: { units: [] },
      safety_gates: [
        {
          gate_id: "g1", name: "G1",
          condition: [{ tag: "E", operator: "=", value: false }],
          scope: ["does-not-exist"],
        },
      ],
    });
    expect(issues.some((i) => /unknown equipment_module/.test(i))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- contract-em-validation`
Expected: FAIL — patch schema does not yet accept `safety_gates`; EM check not present.

- [ ] **Step 3: Extend the patch type, schema, and validator**

In `src/lib/spec-builder/contract.ts`:

1. Add to the import from `@/types/spec-contract-v2` (around line 17): `SafetyGateV2Schema,` and `type SafetyGateV2,`.
2. Add to `SpecContractPatch` interface (after line 86 `unit_procedures?`): `safety_gates?: SafetyGateV2[];`.
3. Add to `SpecContractPatchSchema` (after the `unit_procedures` entry ~line 107): `safety_gates: z.array(SafetyGateV2Schema).optional(),`.
4. Add the import near the top: `import { validateEmStateMachine } from "@/lib/spec-builder/em-state-machine";`.
5. In `validateSpecContractPatch`, after the existing `patch.equipment_modules` override-kind block (after line 1351), insert:

```typescript
  // Hybrid state model: per-EM state-machine invariants.
  if (patch.equipment_modules !== undefined) {
    for (const contract of Object.values(patch.equipment_modules)) {
      issues.push(...validateEmStateMachine(contract));
    }
  }

  // Hybrid state model: safety gates must scope to known equipment modules.
  if (patch.safety_gates !== undefined) {
    const knownEmIds = new Set<string>();
    if (patch.hierarchy) {
      for (const sub of patch.hierarchy.units) {
        for (const asm of sub.equipment_modules) knownEmIds.add(asm.equipment_module_id);
      }
    }
    const gateIds = patch.safety_gates.map((g) => g.gate_id);
    const dupGateIds = gateIds.filter((id, i) => gateIds.indexOf(id) !== i);
    for (const id of new Set(dupGateIds)) {
      issues.push(`duplicate safety gate gate_id "${id}"`);
    }
    if (patch.hierarchy) {
      for (const g of patch.safety_gates) {
        if (g.scope === "all") continue;
        for (const emId of g.scope) {
          if (!knownEmIds.has(emId)) {
            issues.push(`safety gate ${g.gate_id} scopes unknown equipment_module "${emId}"`);
          }
        }
      }
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- contract-em-validation`
Expected: PASS.

- [ ] **Step 5: Run the full contract test suite (no regressions)**

Run: `npm test -- contract`
Expected: PASS (existing `contract.test.ts` still green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts
git commit -m "feat(spec-builder): validate EM state machines + safety gates in writeSpecContract"
```

---

# WAVE 3 — DB + contract read/write of the new fields

### Task 4: Migration — add `safety_gates`, `em_states`, `em_transitions` columns

**Files:**
- Create: `supabase/migrations/<timestamp>_hybrid_em_state_model.sql`

> **Apply procedure (per spec §6):** Apply the SQL via the Supabase MCP `apply_migration` (project `fsxfdkjjkbkzjntjxiyi`, name `hybrid_em_state_model`). Then **rename the repo file to the exact timestamp version the MCP recorded** (migration history is timestamp-based; a mismatched name makes `supabase db push` re-apply). Do not push to remote unless the user asks.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/<timestamp>_hybrid_em_state_model.sql`:

```sql
-- Hybrid per-EM state model.
-- Machine-level safety gates on the project; per-EM state machine on the
-- operation session rows. Nothing to backfill (only V2 test specs exist).

alter table public.spec_projects
  add column if not exists safety_gates jsonb not null default '[]'::jsonb;

alter table public.fds_operation_sessions
  add column if not exists em_states jsonb not null default '[]'::jsonb,
  add column if not exists em_transitions jsonb not null default '[]'::jsonb;

comment on column public.spec_projects.safety_gates is
  'SafetyGateV2[] — machine-level safety gates (force scoped EMs to safe).';
comment on column public.fds_operation_sessions.em_states is
  'EmStateV2[] — the EM''s own states (hybrid state model).';
comment on column public.fds_operation_sessions.em_transitions is
  'EmTransitionV2[] — the EM''s own transitions.';
```

- [ ] **Step 2: Apply via MCP and rename the file**

Apply with `apply_migration` (name: `hybrid_em_state_model`). Then rename the repo file so its leading timestamp matches the recorded version (e.g. `20260618HHMMSS_hybrid_em_state_model.sql`).

- [ ] **Step 3: Verify columns exist**

Use the Supabase MCP `execute_sql`:

```sql
select column_name from information_schema.columns
where table_name = 'fds_operation_sessions' and column_name in ('em_states','em_transitions');
select column_name from information_schema.columns
where table_name = 'spec_projects' and column_name = 'safety_gates';
```

Expected: all three rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): add safety_gates + per-EM em_states/em_transitions columns"
```

### Task 5: Contract loader/writer — read & write the new fields

**Files:**
- Modify: `src/lib/spec-builder/contract.ts`
  - `upgradeEquipmentModuleContracts` (lines 391-428) — populate `states`/`transitions` from session rows
  - `upgradeLegacyRow` (line 733) — populate `safety_gates` from `projectRow`
  - `writeSpecContract` (lines 1048-1102) — persist `safety_gates` + per-EM `em_states`/`em_transitions`
- Test: `src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const writeCalls: Array<{ table: string; op: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => ({ eq: () => { writeCalls.push({ table, op: "update", payload }); return Promise.resolve({ data: null, error: null }); } }),
      upsert: (payload: unknown) => { writeCalls.push({ table, op: "upsert", payload }); return Promise.resolve({ data: null, error: null }); },
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      insert: (payload: unknown) => { writeCalls.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
    }),
  },
}));

import { writeSpecContract } from "../contract";

describe("writeSpecContract — hybrid state model persistence", () => {
  beforeEach(() => { writeCalls.length = 0; });

  it("routes safety_gates to spec_projects.safety_gates", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      safety_gates: [
        { gate_id: "estop", name: "E-Stop", condition: [{ tag: "E", operator: "=", value: false }], scope: "all" },
      ],
    });
    const p = writeCalls.find((c) => c.table === "spec_projects" && c.op === "update");
    expect(p?.payload).toMatchObject({ safety_gates: expect.any(Array) });
  });

  it("persists em_states/em_transitions on the fds_operation_sessions upsert", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      equipment_modules: {
        em1: {
          equipment_module_id: "00000000-0000-4000-8000-000000000001",
          unit_id: "00000000-0000-4000-8000-000000000002",
          states: [{ state_id: "safe", name: "Safe", kind: "static", allowed_modes: [], is_safe_state: true }],
          transitions: [],
          static_states: {},
          sequential_states: {},
        },
      },
    });
    const s = writeCalls.find((c) => c.table === "fds_operation_sessions" && c.op === "upsert");
    expect(s?.payload).toMatchObject({ em_states: expect.any(Array), em_transitions: expect.any(Array) });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- contract-em-roundtrip`
Expected: FAIL — `safety_gates` not persisted; session upsert lacks `em_states`.

- [ ] **Step 3: Implement read + write**

In `src/lib/spec-builder/contract.ts`:

**(a) Read per-EM states/transitions** — in `upgradeEquipmentModuleContracts` (line 420-425), change the `out[...]` assignment to include the new fields:

```typescript
    out[equipment_module_id] = {
      equipment_module_id,
      unit_id,
      states: Array.isArray(s.em_states) ? (s.em_states as EquipmentModuleContract["states"]) : [],
      transitions: Array.isArray(s.em_transitions)
        ? (s.em_transitions as EquipmentModuleContract["transitions"])
        : [],
      static_states: staticStates,
      sequential_states: sequentialStates,
    };
```

**(b) Read safety_gates** — in `upgradeLegacyRow` (the `contract` object literal, lines 733-749), add after `equipment_modules,`:

```typescript
    safety_gates: Array.isArray(projectRow.safety_gates)
      ? (projectRow.safety_gates as SpecContractV2["safety_gates"])
      : [],
```

(Import `type SpecContractV2` is already present at line 47.)

**(c) Write safety_gates** — in `writeSpecContract`, in the `projectUpdate` block (after line 1058 `alarm_tiers`), add:

```typescript
  if (parsed.safety_gates !== undefined) {
    projectUpdate.safety_gates = parsed.safety_gates;
  }
```

**(d) Write per-EM states/transitions** — in the `fds_operation_sessions` upsert `row` (lines 1085-1093), add the two columns:

```typescript
      const row = {
        spec_project_id: specProjectId,
        unit_id: asm.unit_id,
        equipment_module_id: asm.equipment_module_id,
        status: "complete",
        static_confirmed: true,
        em_states: asm.states,
        em_transitions: asm.transitions,
        static_states_v2: asm.static_states,
        sequential_states: asm.sequential_states,
      };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- contract-em-roundtrip`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test -- contract` then `npm run build`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/contract-em-roundtrip.test.ts
git commit -m "feat(spec-builder): persist + load safety_gates and per-EM state machines"
```

---

# WAVE 4 — Skeleton wizard: Machine Modes + Safety Gates steps

### Task 6: Extract + test the wizard step helpers

**Files:**
- Create: `src/lib/spec-builder/wizard-machine-layer.ts` (pure helpers)
- Test: `src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  seedDefaultModes,
  suggestSafetyGates,
} from "@/lib/spec-builder/wizard-machine-layer";
import type { OperatorMode } from "@/types/spec-contract-v2";

describe("seedDefaultModes", () => {
  it("seeds Auto/Maintenance/Manual with exactly one default", () => {
    const modes = seedDefaultModes();
    expect(modes.map((m) => m.mode_id)).toEqual(["auto", "maintenance", "manual"]);
    expect(modes.filter((m: OperatorMode) => m.is_default)).toHaveLength(1);
    expect(modes.find((m) => m.is_default)?.mode_id).toBe("auto");
  });
});

describe("suggestSafetyGates", () => {
  it("proposes one 'all'-scope gate per distinct safety tag, condition = tag is false", () => {
    const gates = suggestSafetyGates([
      { tag: "EStop_Healthy", is_safety: true },
      { tag: "SR1_Healthy", is_safety: true },
      { tag: "Motor_Run", is_safety: false },
    ]);
    expect(gates).toHaveLength(2);
    expect(gates[0]).toMatchObject({
      scope: "all",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
    });
    expect(gates.every((g) => g.gate_id.length > 0)).toBe(true);
  });

  it("returns no gates when there are no safety tags", () => {
    expect(suggestSafetyGates([{ tag: "x", is_safety: false }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- wizard-machine-layer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/spec-builder/wizard-machine-layer.ts`:

```typescript
/**
 * Pure helpers for the skeleton wizard's machine-layer steps:
 * Machine Modes (seed Auto/Maintenance/Manual) and Safety Gates
 * (auto-suggested from is_safety register tags).
 */
import type { OperatorMode, SafetyGateV2 } from "@/types/spec-contract-v2";

export function seedDefaultModes(): OperatorMode[] {
  return [
    { mode_id: "auto", name: "Auto", description: "Automatic production mode", is_default: true },
    { mode_id: "maintenance", name: "Maintenance", description: "Service / maintenance mode", is_default: false },
    { mode_id: "manual", name: "Manual", description: "Manual / jog mode", is_default: false },
  ];
}

export interface SafetyTagLike {
  tag: string;
  is_safety: boolean;
}

/**
 * One machine-wide gate per distinct safety tag. The gate is violated when
 * the tag's "healthy" signal reads false (OR-of-faults). The engineer edits
 * scope/condition afterwards.
 */
export function suggestSafetyGates(tags: SafetyTagLike[]): SafetyGateV2[] {
  const seen = new Set<string>();
  const out: SafetyGateV2[] = [];
  for (const t of tags) {
    if (!t.is_safety || seen.has(t.tag)) continue;
    seen.add(t.tag);
    out.push({
      gate_id: `gate_${t.tag.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: t.tag,
      condition: [{ tag: t.tag, operator: "=", value: false }],
      scope: "all",
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- wizard-machine-layer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/wizard-machine-layer.ts src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts
git commit -m "feat(spec-builder): machine-modes + safety-gate seeding helpers"
```

### Task 7: Replace the wizard's Operating Modes step with Machine Modes + Safety Gates

**Files:**
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx`

> This is a UI edit. The wizard currently has 6 steps with `"Operating Modes"` at index 3 editing the **global states**. Replace that single step with two: `"Machine Modes"` and `"Safety Gates"`. Remove the global-states state + `StepOperatingModes` + the `inferStates` AI call + `upgradeLegacyStates`/`rawAiStatesToV2`/`buildV2State`/`isCustomState`/`isPackmlState`/`PACKML_PICKER_*` helpers (all only used by the removed step). The wizard stops writing `confirmed_states`; it writes `confirmed_modes` + `safety_gates` via `useUpdateSpecProject`.

- [ ] **Step 1: Update the steps array + imports**

Replace `WIZARD_STEPS` (lines 47-54) with:

```typescript
const WIZARD_STEPS = [
  "Document Metadata",
  "Control System",
  "Machine Hierarchy",
  "Machine Modes",
  "Safety Gates",
  "Alarm Configuration",
  "Review & Confirm",
] as const;
```

Replace the imports of the removed state helpers (lines 35-37) with:

```typescript
import type { OperatorMode, SafetyGateV2 } from "@/types/spec-contract-v2";
import { seedDefaultModes, suggestSafetyGates } from "@/lib/spec-builder/wizard-machine-layer";
```

(Remove the now-unused imports: `OperatingStateV2`, `CANONICAL_STATES`, `packmlByName`, `packmlById`, `getUnitControlModuleCount` stays if used in review, `inferStatePattern`. Verify each against `npm run build` in Step 6 and delete only the genuinely unused ones — `noUnusedLocals` will tell you.)

- [ ] **Step 2: Replace the step-4 state with modes + gates state**

Replace the `states`/`inferring` block (lines 100-106) with:

```typescript
  // Step 4 — Machine modes (extensible; seed Auto/Maintenance/Manual).
  const [modes, setModes] = useState<OperatorMode[]>(() => {
    const existing = (spec.confirmed_modes ?? []) as OperatorMode[];
    return existing.length > 0 ? existing : seedDefaultModes();
  });

  // Step 5 — Safety gates (auto-suggested from is_safety register tags).
  const [safetyGates, setSafetyGates] = useState<SafetyGateV2[]>(() => {
    const existing = (spec.safety_gates ?? []) as SafetyGateV2[];
    if (existing.length > 0) return existing;
    return suggestSafetyGates(
      register.tags.map((t) => ({ tag: t.tag, is_safety: Boolean(t.is_safety) })),
    );
  });
```

> If `SpecProject` (in `src/types/spec-builder.ts`) does not yet declare `confirmed_modes` / `safety_gates`, add them as optional fields there (`confirmed_modes?: OperatorMode[]; safety_gates?: SafetyGateV2[];`) and to `SpecProjectUpdate`.

- [ ] **Step 3: Update `canNext`, `handleNext`, and the step switch**

`canNext` (lines 120-127) — shift the indices and gate steps 3/4:

```typescript
  const canNext = (() => {
    if (step === 0) return meta.doc_code.trim() && meta.title.trim() && meta.client_name.trim();
    if (step === 1) return control.plc_model.trim();
    if (step === 2) return units.some((s) => !s.excluded && s.equipment_modules.length > 0);
    if (step === 3) return modes.length > 0 && modes.filter((m) => m.is_default).length === 1;
    if (step === 4) return true; // safety gates optional
    if (step === 5) return alarmTiers.length > 0;
    return true;
  })();
```

`handleNext` — the final step is now index 6, and it persists modes/gates instead of states:

```typescript
  const handleNext = useCallback(async () => {
    if (step < 6) { setStep((s) => s + 1); return; }
    await updateSpec.mutateAsync({
      id: spec.id,
      ...meta,
      ...control,
      confirmed_units: units,
      confirmed_modes: modes,
      safety_gates: safetyGates,
      alarm_tiers: alarmTiers,
    });
    onComplete();
  }, [step, spec.id, meta, control, units, modes, safetyGates, alarmTiers, updateSpec, onComplete]);
```

The step switch (lines 317-346) — replace the `step === 3` block and renumber 4/5:

```tsx
        {step === 3 && <StepMachineModes modes={modes} onChange={setModes} />}
        {step === 4 && (
          <StepSafetyGates
            gates={safetyGates}
            onChange={setSafetyGates}
            safetyTags={register.tags.filter((t) => t.is_safety).map((t) => t.tag)}
            equipmentModules={units.flatMap((u) =>
              u.equipment_modules.map((e) => ({ id: e.equipment_module_id, name: e.equipment_module_name })),
            )}
          />
        )}
        {step === 4 && null}
        {step === 5 && <StepAlarmConfig tiers={alarmTiers} onChange={setAlarmTiers} />}
        {step === 6 && (
          <StepReview meta={meta} control={control} units={units} modes={modes} safetyGates={safetyGates} alarmTiers={alarmTiers} />
        )}
```

> Fix the duplicate `step === 4` typo above by mapping: 3→modes, 4→gates, 5→alarms, 6→review (drop the `{step === 4 && null}` line — it was a transcription artifact; keep exactly one block per index).

Also update the two `step === 5` literals in the nav buttons (lines 360-366) to `step === 6`.

- [ ] **Step 4: Delete `StepOperatingModes` + `inferStates` + dead helpers; add the two new step components**

Delete: `inferStates` (lines 221-274), `StepOperatingModes` (lines 569-799), `upgradeLegacyStates`, `rawAiStatesToV2`, `buildV2State`, `isCustomState`, `isPackmlState`, `PACKML_PICKER_IDS`, `PACKML_PICKER_OPTIONS` (lines 461-567), and the `inferring` usages.

Add two new components (place where `StepOperatingModes` was):

```tsx
// ===========================================================================
// Step 4 — Machine Modes (extensible; exactly one default)
// ===========================================================================

function StepMachineModes({
  modes,
  onChange,
}: {
  modes: OperatorMode[];
  onChange: (m: OperatorMode[]) => void;
}) {
  const updateAt = (i: number, patch: Partial<OperatorMode>) => {
    const next = [...modes];
    next[i] = { ...next[i], ...patch };
    // Enforce single default.
    if (patch.is_default) next.forEach((m, j) => { if (j !== i) m.is_default = false; });
    onChange(next);
  };
  const add = () => {
    const id = `mode_${Date.now()}`;
    onChange([...modes, { mode_id: id, name: "New Mode", is_default: false }]);
  };
  const remove = (i: number) => onChange(modes.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Machine-level operating modes. States are scoped per equipment module, not here.
          Exactly one mode is the default.
        </p>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add Mode
        </Button>
      </div>
      <div className="grid gap-2">
        {modes.map((m, i) => (
          <Card key={m.mode_id} className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                value={m.name}
                onChange={(e) => updateAt(i, { name: e.target.value })}
                className="text-sm font-medium h-7"
              />
              <Button
                variant={m.is_default ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => updateAt(i, { is_default: true })}
              >
                {m.is_default ? "Default" : "Set default"}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove(i)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Input
              value={m.description ?? ""}
              onChange={(e) => updateAt(i, { description: e.target.value })}
              placeholder="Description…"
              className="text-xs h-7"
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Step 5 — Safety Gates (condition → force scoped EMs to safe)
// ===========================================================================

function StepSafetyGates({
  gates,
  onChange,
  safetyTags,
  equipmentModules,
}: {
  gates: SafetyGateV2[];
  onChange: (g: SafetyGateV2[]) => void;
  safetyTags: string[];
  equipmentModules: Array<{ id: string; name: string }>;
}) {
  const updateAt = (i: number, patch: Partial<SafetyGateV2>) => {
    const next = [...gates];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const add = () => {
    const tag = safetyTags[0] ?? "";
    onChange([
      ...gates,
      {
        gate_id: `gate_${Date.now()}`,
        name: tag || "New Gate",
        condition: [{ tag, operator: "=", value: false }],
        scope: "all",
      },
    ]);
  };
  const remove = (i: number) => onChange(gates.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          When a gate's condition is violated, the scoped equipment modules are forced to
          their safe state. Suggested from <code>is_safety</code> register tags.
        </p>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add Gate
        </Button>
      </div>
      {gates.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No safety gates. Add one, or proceed — gates are optional.
        </Card>
      ) : (
        <div className="grid gap-2">
          {gates.map((g, i) => (
            <Card key={g.gate_id} className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) => updateAt(i, { name: e.target.value })}
                  className="text-sm font-medium h-7"
                />
                <Select
                  value={g.scope === "all" ? "all" : "scoped"}
                  onValueChange={(v) =>
                    updateAt(i, { scope: v === "all" ? "all" : equipmentModules.map((e) => e.id) })
                  }
                >
                  <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All EMs</SelectItem>
                    <SelectItem value="scoped">Scoped…</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => remove(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground">
                Violated when: {g.condition.map((c) => `${c.tag} ${c.operator} ${String(c.value)}`).join(" OR ")}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update `StepReview` to show modes + gates instead of states**

Change `StepReview`'s props (lines 876-888) from `states: OperatingStateV2[]` to `modes: OperatorMode[]; safetyGates: SafetyGateV2[]`, and replace the "Operating States" card (lines 951-965) with two cards summarizing mode names and gate names. Remove `funcDescSections`/`totalSections` references to `states` (recompute scope using a fixed per-EM estimate, or drop the generation-scope card — it referenced the removed global `states`).

```tsx
      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Machine Modes ({modes.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {modes.map((m) => (
            <Badge key={m.mode_id} variant="outline" className="text-xs">
              {m.name}{m.is_default ? " · default" : ""}
            </Badge>
          ))}
        </div>
      </Card>
      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Safety Gates ({safetyGates.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {safetyGates.map((g) => (
            <Badge key={g.gate_id} variant="outline" className="text-xs">{g.name}</Badge>
          ))}
        </div>
      </Card>
```

- [ ] **Step 6: Build to find dead imports / type errors**

Run: `npm run build`
Expected: PASS. Fix any `noUnusedLocals` errors by deleting the genuinely-unused imports flagged (e.g. `CANONICAL_STATES`, `packmlByName`, `packmlById`, `OperatingStateV2`, `inferStatePattern`, `StatePattern`).

- [ ] **Step 7: Commit**

```bash
git add src/components/spec-builder/spec-skeleton-wizard.tsx src/types/spec-builder.ts
git commit -m "feat(spec-builder): wizard machine-modes + safety-gates steps replace global states"
```

---

# WAVE 5 — Co-author: EM state-machine interview (Stage A) + re-keyed behavior (Stage B)

### Task 8: Stage-A prompt builder — author the EM's states + transitions

**Files:**
- Create: `src/lib/spec-builder/em-state-machine-prompts.ts`
- Test: `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildEmStateMachineInterviewPrompt } from "@/lib/spec-builder/em-state-machine-prompts";
import type { EquipmentModuleConfig, UnitConfig } from "@/types/spec-builder";
import type { OperatorMode } from "@/types/spec-contract-v2";

const unit: UnitConfig = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false, equipment_modules: [],
} as unknown as UnitConfig;

const em: EquipmentModuleConfig = {
  equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "",
  control_modules: [
    { control_module_id: "d1", control_module_name: "Drive M01", control_module_class: "motor", is_safety: false, description: "",
      io_signals: [
        { tag: "CAR_M01_CMD", signal_type: "DO", io_address: "Q0.0", description: "Run fwd" },
        { tag: "CAR_M01_FB", signal_type: "DI", io_address: "I0.0", description: "Running" },
      ] },
  ],
} as unknown as EquipmentModuleConfig;

const modes: OperatorMode[] = [
  { mode_id: "auto", name: "Auto", is_default: true },
  { mode_id: "manual", name: "Manual", is_default: false },
];

describe("buildEmStateMachineInterviewPrompt", () => {
  it("includes the EM identity, the machine modes, and the EM's IO", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toContain("Carriage Drive");
    expect(p).toContain("em1");
    expect(p).toContain("auto");
    expect(p).toContain("manual");
    expect(p).toContain("CAR_M01_CMD");
  });

  it("instructs the model to emit EmStateV2[] + EmTransitionV2[] and to mark one safe state", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, []);
    expect(p).toMatch(/is_safe_state/);
    expect(p).toMatch(/allowed_modes/);
    expect(p).toMatch(/transitions/i);
    expect(p).toMatch(/"kind": ?"command"|completion/);
  });

  it("renders customer-spec source sections when provided", () => {
    const p = buildEmStateMachineInterviewPrompt(em, unit, modes, [
      { heading: "Carriage", body: "Driven by a pendant, forward and reverse." },
    ]);
    expect(p).toContain("Carriage");
    expect(p).toContain("pendant");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- em-state-machine-prompts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Stage-A prompt builder**

Create `src/lib/spec-builder/em-state-machine-prompts.ts`:

```typescript
/**
 * Stage A of the per-EM co-author interview (hybrid state model): author
 * the equipment module's OWN state machine — states (kind, allowed_modes,
 * is_safe_state) and transitions (trigger + permissive guard) — BEFORE the
 * per-state behavior interview (Stage B, fds-prompts.ts). The state ids
 * produced here are EM-local string slugs and become the keys of
 * static_states / sequential_states in Stage B.
 */
import type {
  EquipmentModuleConfig,
  UnitConfig,
} from "@/types/spec-builder";
import type { OperatorMode } from "@/types/spec-contract-v2";
import type { SourceSection } from "./source-section-select";

export function buildEmStateMachineInterviewPrompt(
  equipmentModule: EquipmentModuleConfig,
  unit: UnitConfig,
  modes: OperatorMode[],
  sourceSections: SourceSection[] = [],
): string {
  const deviceList = equipmentModule.control_modules
    .map((d) => {
      const sigs = d.io_signals.map((s) => `${s.tag} (${s.signal_type})`).join(", ");
      return `  - ${d.control_module_name} (${d.control_module_class}${d.is_safety ? ", SAFETY" : ""}): ${sigs}`;
    })
    .join("\n");

  const modeList = modes
    .map((m) => `  - ${m.mode_id} (${m.name}${m.is_default ? ", default" : ""})`)
    .join("\n");

  const sourceContext =
    sourceSections.length === 0
      ? ""
      : `\n## Customer Specification Context\nTreat the following as the source of intent for this equipment module's behavior.\n\n` +
        sourceSections.map((s) => `### ${s.heading || "(untitled)"}\n${s.body}`).join("\n\n") +
        "\n";

  return `You are a senior automation engineer co-authoring the STATE MACHINE for Equipment Module "${equipmentModule.equipment_module_name}" (equipment_module_id: "${equipmentModule.equipment_module_id}") within unit "${unit.unit_name}" (unit_id: "${unit.unit_id}").

Per ISA-88, the state machine belongs to the EQUIPMENT MODULE. This module runs INDEPENDENTLY of other modules — do not assume the whole machine moves in lockstep.

# IMMUTABLE IDENTIFIERS (echo verbatim)
- equipment_module_id: ${equipmentModule.equipment_module_id}
- unit_id: ${unit.unit_id}
${sourceContext}
# MACHINE MODES (states are gated by these; states have NO modes of their own)
${modeList}

# THIS MODULE'S DEVICES + IO
${deviceList}

# YOUR TASK
Interview the engineer to define THIS MODULE'S OWN states and the transitions between them. One question per turn. Gather, in order:
1. The list of states. For each: a short EM-local id slug (e.g. "driving_fwd", "idle", "faulted"), a display name, kind (static = devices held at fixed values / manual-holding; sequential = runs ordered steps to completion / automatic), allowed_modes (which machine modes the state is valid in — empty means all modes), and whether it is the single safe state (is_safe_state).
2. The transitions. For each: from_state_id, to_state_id, a trigger (either {kind:"command", expr: <permissive on an operator/HMI tag>} for manual, or {kind:"completion"} when a sequential state finishes), and an optional permissive guard (array of {tag, operator, value}); a guard may reference OTHER modules' tags for inter-module interlocks.

# HARD RULES
- EXACTLY ONE state must have is_safe_state = true (the state a safety gate forces this module into).
- state_id values are EM-local slugs, unique within this module. Never reuse a global/PackML number.
- A static state holds devices; a sequential state will get steps later (Stage B). Mark the kind correctly now.
- Mixed behavior is allowed: a module may have BOTH static (manual) and sequential (automatic) states.

# RESPONSE FORMAT
When you have a concrete proposal, end your message with ONE fenced JSON block holding { "states": EmStateV2[], "transitions": EmTransitionV2[] }:

\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": true },
    { "state_id": "driving_fwd", "name": "Driving Forward", "kind": "static", "allowed_modes": ["manual"], "is_safe_state": false },
    { "state_id": "auto_cycle", "name": "Auto Cycle", "kind": "sequential", "allowed_modes": ["auto"], "is_safe_state": false }
  ],
  "transitions": [
    {
      "transition_id": "stopped_to_fwd",
      "from_state_id": "stopped",
      "to_state_id": "driving_fwd",
      "trigger": { "kind": "command", "expr": { "tag": "CAR_PENDANT_FWD", "operator": "=", "value": true } },
      "guard": [ { "tag": "CAR_LS_FWD", "operator": "=", "value": false } ]
    },
    {
      "transition_id": "auto_cycle_done",
      "from_state_id": "auto_cycle",
      "to_state_id": "stopped",
      "trigger": { "kind": "completion" },
      "guard": []
    }
  ]
}
\`\`\`

Only include a JSON block when you have an update to persist. Keep prose concise — the engineer is an expert.`;
}

export function buildEmStateMachineOpeningMessage(
  equipmentModule: EquipmentModuleConfig,
): string {
  return `Generate the opening message for the state-machine interview of equipment module "${equipmentModule.equipment_module_name}". Ask, in 2-3 sentences ending with a clear question, what distinct states this module can be in (e.g. stopped, manually driving, running an automatic cycle, faulted) and which one is its safe state.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- em-state-machine-prompts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/em-state-machine-prompts.ts src/lib/spec-builder/__tests__/em-state-machine-prompts.test.ts
git commit -m "feat(spec-builder): Stage-A EM state-machine interview prompt"
```

### Task 9: Stage-B — key the behavior interview by EM-local states; wire the conversation hook

**Files:**
- Modify: `src/lib/spec-builder/fds-prompts.ts` — `buildFdsInterviewSystemPrompt` signature: accept the EM's own `EmStateV2[]` instead of the global `OperatingStateV2[]`
- Modify: `src/hooks/use-fds-conversation.ts` — pass the EM's states; expose Stage A vs Stage B
- Test: `src/lib/spec-builder/__tests__/fds-prompts-emlocal.test.ts` (create)

> The existing `fds-prompts-v2.test.ts` snapshot will change. Update it (Step 6) after confirming the new output is correct.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/fds-prompts-emlocal.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildFdsInterviewSystemPrompt } from "@/lib/spec-builder/fds-prompts";
import type { EquipmentModuleConfig, UnitConfig, InstrumentTag } from "@/types/spec-builder";
import type { EmStateV2 } from "@/types/spec-contract-v2";

const unit = { unit_id: "u1", unit_name: "U", equipment_type: "Other" } as unknown as UnitConfig;
const em = {
  equipment_module_id: "em1", equipment_module_name: "Drive",
  control_modules: [{ control_module_id: "d1", control_module_name: "M01", control_module_class: "motor", is_safety: false,
    io_signals: [{ tag: "M01_CMD", signal_type: "DO", io_address: "Q0.0", description: "" }] }],
} as unknown as EquipmentModuleConfig;
const tags: InstrumentTag[] = [{ tag: "M01_CMD", signal_direction: "DO", description: "" } as unknown as InstrumentTag];

const emStates: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: "auto_cycle", name: "Auto Cycle", kind: "sequential", allowed_modes: ["auto"], is_safe_state: false },
];

describe("buildFdsInterviewSystemPrompt — EM-local states", () => {
  it("lists the EM's own sequential states by their EM-local string ids", () => {
    const p = buildFdsInterviewSystemPrompt(em, unit, tags, {}, {}, emStates, []);
    expect(p).toContain("auto_cycle");
    expect(p).toContain("Auto Cycle");
    // The Stage-B interview only walks sequential states.
    expect(p).not.toContain("PackML 1..17");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- fds-prompts-emlocal`
Expected: FAIL — current `buildFdsInterviewSystemPrompt` takes `OperatingStateV2[]` and references PackML numeric ids.

- [ ] **Step 3: Update `buildFdsInterviewSystemPrompt`**

In `src/lib/spec-builder/fds-prompts.ts`:

1. Change the import (lines 35-38): replace `OperatingStateV2` with `EmStateV2`:

```typescript
import type {
  EmStateV2,
  SequentialStateV2,
} from "@/types/spec-contract-v2";
```

2. Change the parameter `allStates: OperatingStateV2[]` to `emStates: EmStateV2[]` (line 51).

3. Replace `stateLabel`, the `sequentialStatesList`/`sequentialStatesTable`/`firstSequentialStateId` derivations (lines 78-105) with EM-local equivalents:

```typescript
  function stateLabel(s: EmStateV2): string {
    return s.name || s.state_id;
  }

  const staticStatesText = Object.entries(staticStates)
    .map(([stateId, entries]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      const rows = entries.map((e) => `    ${e.tag} must hold value: ${e.state}`).join("\n");
      return `  ${stateName}:\n${rows}`;
    }).join("\n");

  const completedText = Object.entries(completedSequentialStates)
    .map(([stateId, data]) => {
      const match = emStates.find((s) => s.state_id === stateId);
      const stateName = match ? stateLabel(match) : stateId;
      const perms = data.permissives.map((p) => `    - ${p.tag} ${p.operator} ${String(p.value)}`).join("\n");
      return `  ${stateName}:\n    Permissives:\n${perms || "    (none)"}\n    Steps: ${data.steps.length} V2 step(s)`;
    }).join("\n");

  const sequentialStatesList = emStates.filter((s) => s.kind === "sequential");
  const sequentialStatesTable = sequentialStatesList
    .map((s) => `  - ${s.state_id}  (${stateLabel(s)})`)
    .join("\n");
  const firstSequentialStateId = sequentialStatesList[0]?.state_id ?? "";
```

4. In the template body, change the `state_id` guidance (line 124) and the `# SEQUENTIAL STATES REMAINING` framing so state_id is an **EM-local slug**, not a number. Replace line 124 with:

```typescript
- state_id: MUST be one of the EM-LOCAL state ids from the SEQUENTIAL STATES REMAINING list below (a string slug, e.g. "auto_cycle"). Never invent a state_id.
```

5. In the example JSON `"state_id": ${firstSequentialStateId || 6}` (line 238) → `"state_id": ${JSON.stringify(firstSequentialStateId || "auto_cycle")}`. Update the closing note (lines 401, 414) that say state_id is a NUMBER to say it is an EM-local string slug.

> Keep the rest of the step/transition SFC schema exactly as-is — only the *state keying* changed.

- [ ] **Step 4: Update the conversation hook**

In `src/hooks/use-fds-conversation.ts`, locate where `buildFdsInterviewSystemPrompt(...)` is called and where it sources the state list. Replace the global-states argument with the EM's own `states` (from the loaded `EquipmentModuleContract.states`, filtered as needed). If the hook also drives Stage A, add a branch that calls `buildEmStateMachineInterviewPrompt` when the EM has no `states` yet, and `buildFdsInterviewSystemPrompt` once states exist. Pass `useSourceSectionsForEm(specProjectId, equipmentModuleId)` data into both as the `sourceSections` arg.

> Exact call site varies — open the file, find the `buildFdsInterviewSystemPrompt(` call, and swap its 6th argument (was `allStates`) to the EM's `states`. Add the Stage-A import: `import { buildEmStateMachineInterviewPrompt } from "@/lib/spec-builder/em-state-machine-prompts";`.

- [ ] **Step 5: Run the new test + build**

Run: `npm test -- fds-prompts-emlocal` then `npm run build`
Expected: test PASS; build PASS.

- [ ] **Step 6: Refresh the prompt snapshot**

Run: `npm test -- fds-prompts-v2 -u`
Expected: snapshot updated. Open the updated `__snapshots__/fds-prompts-v2.test.ts.snap` diff and confirm the only changes are EM-local state ids replacing numeric PackML ids (no accidental structural loss). Then run `npm test -- fds-prompts-v2` (no `-u`) → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/spec-builder/fds-prompts.ts src/hooks/use-fds-conversation.ts src/lib/spec-builder/__tests__/fds-prompts-emlocal.test.ts src/lib/spec-builder/__tests__/__snapshots__/fds-prompts-v2.test.ts.snap
git commit -m "feat(spec-builder): key per-EM behavior interview by EM-local states"
```

---

# WAVE 6 — Random builder emits per-EM state machines + safety gate

### Task 10: Random per-EM state machine + safety gate; drop unit_procedures/global states from the patch

**Files:**
- Create: `src/lib/spec-builder/random/em-state-machine-builder.ts`
- Test: `src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts`
- Modify: `src/lib/spec-builder/random/assemble.ts`
- Modify: `src/lib/spec-builder/random/state-machine.ts` (add EM-local canonical state ids)

> Per project memory ("FDS Spec Builder V2 is the only target"), the random builder must emit the new shape directly.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/random/__tests__/em-state-machine-builder.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildEmCanonicalStateMachine } from "@/lib/spec-builder/random/em-state-machine-builder";
import { validateEmStateMachine } from "@/lib/spec-builder/em-state-machine";

describe("buildEmCanonicalStateMachine", () => {
  it("produces states + transitions that pass EM validation (exactly one safe state)", () => {
    const { states, transitions } = buildEmCanonicalStateMachine();
    const issues = validateEmStateMachine({
      equipment_module_id: "em1", unit_id: "u1",
      states, transitions, static_states: {}, sequential_states: {},
    });
    expect(issues).toEqual([]);
    expect(states.filter((s) => s.is_safe_state)).toHaveLength(1);
  });

  it("uses EM-local string ids that match the behavior-map keys", () => {
    const { states } = buildEmCanonicalStateMachine();
    expect(states.map((s) => s.state_id)).toContain("execute");
    expect(states.every((s) => typeof s.state_id === "string")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- em-state-machine-builder`
Expected: FAIL — module not found.

- [ ] **Step 3: Add EM-local canonical ids + the builder**

In `src/lib/spec-builder/random/state-machine.ts`, append EM-local string-id constants (used as behavior-map keys for the random shape):

```typescript
// EM-local canonical state ids (hybrid state model). String slugs, distinct
// from the numeric PackML ids above. Used as keys for static_states /
// sequential_states in the random builder's per-EM state machine.
export const EM_LOCAL_IDLE = "idle";
export const EM_LOCAL_STARTING = "starting";
export const EM_LOCAL_EXECUTE = "execute";
export const EM_LOCAL_STOPPING = "stopping";
export const EM_LOCAL_COMPLETE = "complete";
export const EM_LOCAL_ESTOP = "estop";

export const EM_LOCAL_SEQUENTIAL_IDS = [
  EM_LOCAL_STARTING,
  EM_LOCAL_EXECUTE,
  EM_LOCAL_STOPPING,
] as const;
```

Create `src/lib/spec-builder/random/em-state-machine-builder.ts`:

```typescript
/**
 * Build a canonical per-EM state machine (hybrid state model) for the random
 * FDS builder: Idle/Complete/E-Stop static + Starting/Execute/Stopping
 * sequential, with completion-driven transitions and E-Stop as the safe state.
 */
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";
import {
  EM_LOCAL_IDLE, EM_LOCAL_STARTING, EM_LOCAL_EXECUTE,
  EM_LOCAL_STOPPING, EM_LOCAL_COMPLETE, EM_LOCAL_ESTOP,
} from "./state-machine";

export function buildEmCanonicalStateMachine(): {
  states: EmStateV2[];
  transitions: EmTransitionV2[];
} {
  const states: EmStateV2[] = [
    { state_id: EM_LOCAL_IDLE, name: "Idle", kind: "static", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_STARTING, name: "Starting", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_EXECUTE, name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_STOPPING, name: "Stopping", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_COMPLETE, name: "Complete", kind: "static", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_ESTOP, name: "E-Stop", kind: "static", allowed_modes: [], is_safe_state: true },
  ];
  const t = (id: string, from: string, to: string): EmTransitionV2 => ({
    transition_id: id, from_state_id: from, to_state_id: to,
    trigger: { kind: "completion" }, guard: [],
  });
  const transitions: EmTransitionV2[] = [
    { transition_id: "idle_to_starting", from_state_id: EM_LOCAL_IDLE, to_state_id: EM_LOCAL_STARTING,
      trigger: { kind: "command", expr: { tag: "SYS_START", operator: "=", value: true } }, guard: [] },
    t("starting_to_execute", EM_LOCAL_STARTING, EM_LOCAL_EXECUTE),
    t("execute_to_stopping", EM_LOCAL_EXECUTE, EM_LOCAL_STOPPING),
    t("stopping_to_complete", EM_LOCAL_STOPPING, EM_LOCAL_COMPLETE),
    { transition_id: "complete_to_idle", from_state_id: EM_LOCAL_COMPLETE, to_state_id: EM_LOCAL_IDLE,
      trigger: { kind: "command", expr: { tag: "SYS_RESET", operator: "=", value: true } }, guard: [] },
  ];
  return { states, transitions };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- em-state-machine-builder`
Expected: PASS.

- [ ] **Step 5: Rewire `assemble.ts`**

In `src/lib/spec-builder/random/assemble.ts`:

1. Imports: remove `buildOrchestrations` (line 24) and `UnitProcedureSequence` (line 16). Add `import { buildEmCanonicalStateMachine } from "./em-state-machine-builder";` and import `EM_LOCAL_SEQUENTIAL_IDS, EM_LOCAL_IDLE, EM_LOCAL_COMPLETE, EM_LOCAL_ESTOP` from `./state-machine` (replacing the numeric `SEQUENTIAL_STATE_IDS`/`STATE_ID_*` imports where they keyed behavior maps). Add `SafetyGateV2` to the type import.

2. `buildEquipmentModuleContracts(flatAssemblies)` returns contracts keyed by `static_states`/`sequential_states`. The keys must now be EM-local ids. Update `sequence-builder.ts`'s `buildEquipmentModuleContracts` so its `static_states`/`sequential_states` are keyed by `EM_LOCAL_*` ids (replace numeric `String(stateId)` keys with the EM-local string ids), and attach `states`/`transitions` from `buildEmCanonicalStateMachine()` to each contract. (Open `sequence-builder.ts`; wherever it writes `static_states[String(STATE_ID_IDLE)]` etc., switch to `static_states[EM_LOCAL_IDLE]`, and add `const sm = buildEmCanonicalStateMachine(); ... states: sm.states, transitions: sm.transitions` to each returned `EquipmentModuleContract`.)

3. Delete `buildStates()` (lines 229-231) and the `buildOrchestrations` call (lines 289-302) and the `OrchestrationRow`/`unit_procedures` machinery (interface lines 66-73, `AssembleResult.unit_procedures` line 91, the `unit_procedures` array build lines 366-377). Replace the patch (lines 304-313):

```typescript
  const patch: SpecContractPatch = {
    hierarchy: buildHierarchy(resolved),
    alarm_tiers: buildAlarmTiers(),
    alarms: buildAlarms(resolved),
    modes: [{ mode_id: "auto", name: "Auto", description: "Single default mode", is_default: true }],
    safety_gates: buildSafetyGates(resolved),
    equipment_modules,
    confirmation_status: "confirmed",
  };
```

4. Add a `buildSafetyGates` helper (next to `buildAlarms`):

```typescript
function buildSafetyGates(resolved: ResolvedHierarchy): SafetyGateV2[] {
  const safetyTags: string[] = [];
  for (const sub of resolved.units)
    for (const asm of sub.equipment_modules)
      for (const dev of asm.control_modules)
        if (dev.is_safety)
          for (const sig of dev.io_signals) safetyTags.push(sig.tag);
  const seen = new Set<string>();
  const gates: SafetyGateV2[] = [];
  for (const tag of safetyTags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    gates.push({
      gate_id: `gate_${tag.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: tag,
      condition: [{ tag, operator: "=", value: false }],
      scope: "all",
    });
  }
  return gates;
}
```

5. Update the `AssemblySessionRow` interface (lines 55-64) to add `em_states`/`em_transitions`, and the session push (lines 352-361) to include `em_states: ctr.states, em_transitions: ctr.transitions`.

6. Update the `functionalDescriptionRows` builder (lines 379-415) to key by EM-local ids: iterate `EM_LOCAL_SEQUENTIAL_IDS` (sequential) and `[EM_LOCAL_IDLE, EM_LOCAL_COMPLETE, EM_LOCAL_ESTOP]` (static), and set `state_id` to those slugs.

7. Return value (lines 417-432): drop `unit_procedures`.

- [ ] **Step 6: Update the random-builder persistence hook + delete orchestration-builder**

The hook that consumes `AssembleResult` (search: `assembleRandomFds(`) must stop inserting `fds_unit_procedures` rows. Open the caller (likely `src/hooks/use-random-fds.ts` or similar — grep `equipment_moduleSessions` / `unit_procedures` consumer) and delete the `unit_procedures` insert loop. Delete `src/lib/spec-builder/random/orchestration-builder.ts` and `src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts`. Update `assemble.integration.test.ts` to assert per-EM `states`/`transitions` and `safety_gates` on the patch instead of `unit_procedures`.

- [ ] **Step 7: Build + run random tests**

Run: `npm test -- random` then `npm run build`
Expected: PASS both. Resolve any remaining references to the deleted `buildOrchestrations`/`OrchestrationRow`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/spec-builder/random/ src/hooks/
git rm src/lib/spec-builder/random/orchestration-builder.ts src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts
git commit -m "feat(spec-builder): random builder emits per-EM state machines + safety gates"
```

---

# WAVE 7 — Remove the global-state + unit_procedures + system-orchestration layer

> This wave deletes a large, interconnected subsystem. Do it as a single coherent wave so the build is broken only mid-wave. Run `npm run build` at the end of each task and only commit when green.

### Task 11: Remove `unit_procedures` + global `states` from schema, contract, and `fds-compose`

**Files:**
- Modify: `src/types/spec-contract-v2.ts` — remove `states` + `unit_procedures` from `SpecContractV2Schema`; remove `UnitProcedureSequenceSchema`/`InterEquipmentModule*`/`UnitProcedureSequence` if unused elsewhere after this wave
- Modify: `src/lib/spec-builder/contract.ts` — delete `fetchUnitProcedures`, `upgradeOrchestrations`, `loadOrchestration`, the `unit_procedures` patch field/schema/write block, validator rule 4; drop `states` from the assembled contract and the `confirmed_states` write
- Modify: `src/lib/spec-builder/fds-compose.ts` — drop the orchestration parameter + reads
- Test: update `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Make `contract.ts` tolerate absent `confirmed_states`/`unit_procedures` and stop emitting them**

In `src/lib/spec-builder/contract.ts`:
- Delete `fetchUnitProcedures` (206-215), `upgradeOrchestrations` (430-447), `loadOrchestration` (953-970).
- In `upgradeLegacyRow`: remove the `orchestrationRows` fetch from the `Promise.all` (715-720) and the `unit_procedures` assignment (724, 743). Remove `states: ctx.confirmedStates` (740) → the contract no longer has a global `states` key. Keep `buildUpgradeContext` only if still used by section/alarm upgrade; if `ctx.confirmedStates`/`stateNameToId` become unused, simplify `buildUpgradeContext` to just what `upgradeSections`/`resolveLegacyStateId` need (it still maps legacy section state ids).
- In `loadAssemblyStates` (865-917): it currently reads `contract.states` to get state metadata. Re-point it at the EM's own `states` (`asm.states`) for `state_pattern` (`kind`). Replace the `statesById` map (881-887) with a lookup over `asm.states` (find by `state_id`, use `.kind` for pattern).
- In `SpecContractPatch`/`SpecContractPatchSchema`: remove `states` and `unit_procedures` fields. Remove the `parsed.states` write block (1053-1055) and the entire `unit_procedures` upsert block (1104-1120). Remove validator rule 4 (1471-1493) and the PackML state-range validator block (1289-1316) (global states no longer exist).
- Delete `loadOperatingStates` (989-994) and `AssemblyStateView` references to global states as needed.

In `src/types/spec-contract-v2.ts`:
- In `SpecContractV2Schema`, delete the `states:` line (942) and the `unit_procedures:` block (946-950).
- Remove `OperatingStateV2Schema`/`OperatingStateV2` only if no remaining consumer needs them (the wizard no longer uses them; `spec-builder.ts` legacy types may still — check with grep before deleting). If still referenced, leave the schema defined but unused by the top-level contract.

In `src/lib/spec-builder/fds-compose.ts`:
- `composeFdsToSections` signature: drop the `orchestration` parameter (and `UnitProcedure` import). Delete the `seq`/`equipment_moduleOrder`/`interlocksByTarget`/`shared_permissives` logic (74-113); emit one row per (EM, state) using only the session's own permissives/steps. The `allStates` param can become the EM's states or be derived per-session — simplest: iterate each session's `static_states`/`sequential_states` keys directly.

- [ ] **Step 2: Fix callers + update `contract.test.ts`**

Grep for `loadOrchestration`, `unit_procedures`, `loadOperatingStates`, `composeFdsToSections(` and fix every caller (the Explore report lists them: `use-confirm-migration.ts`, `spec-migrate.tsx`, `fds-co-author.tsx`, etc.). For callers that passed orchestration into `composeFdsToSections`, drop the argument.

In `contract.test.ts`, delete tests asserting `unit_procedures`/`states` routing (if any) and keep the modes/params/section_overrides tests.

- [ ] **Step 3: Build until green**

Run: `npm run build`
Expected: PASS after all callers fixed. Then `npm test -- contract`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(spec-builder): remove global states + unit_procedures layer"
```

### Task 12: Delete the system-orchestration subsystem

**Files (delete):**
- `src/routes/spec-system-orchestration.tsx`
- `src/components/spec-builder/system-orchestration-graph.tsx`, `system-orchestration-permissive-form.tsx`, `system-orchestration-interlock-form.tsx`
- `src/hooks/use-system-orchestration.ts`, `src/hooks/use-fds-system-orchestration-conversation.ts`, `src/hooks/use-fds-orchestration-conversation.ts`
- `src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts`
- Migrate the two shared docs (`INTERLOCK_EFFECTS_DOC`, `COMPLETION_CRITERION_DOC`) before deleting `system-orchestration-prompts.ts` (they're imported by `fds-prompts.ts`).

- [ ] **Step 1: Preserve the two shared doc constants**

`src/lib/spec-builder/fds-prompts.ts` imports `INTERLOCK_EFFECTS_DOC, COMPLETION_CRITERION_DOC` from `./system-orchestration-prompts` (line 39-42), but only `buildFdsOrchestrationSystemPrompt` (which will also be deleted) uses `INTERLOCK_EFFECTS_DOC`. `COMPLETION_CRITERION_DOC` may be used elsewhere. Grep both. Move any still-needed constant into a small new `src/lib/spec-builder/completion-criterion-doc.ts` and update importers; then the orchestration-prompts file has no remaining importers.

- [ ] **Step 2: Delete the unit-orchestration prompt builders from `fds-prompts.ts`**

Delete `buildFdsOrchestrationSystemPrompt` (464-552) and `buildFdsOrchestrationOpeningMessage` (554-562) — inter-EM coordination is now permissive guards, not an orchestration interview. Remove the now-dead import line.

- [ ] **Step 3: Remove the route + nav entry**

Delete `src/routes/spec-system-orchestration.tsx` and remove its route registration (grep `system-orchestration` in `src/App.tsx` and any spec-builder nav/tab that links to it).

- [ ] **Step 4: Delete the components, hooks, and prompts files**

```bash
git rm src/routes/spec-system-orchestration.tsx \
  src/components/spec-builder/system-orchestration-graph.tsx \
  src/components/spec-builder/system-orchestration-permissive-form.tsx \
  src/components/spec-builder/system-orchestration-interlock-form.tsx \
  src/hooks/use-system-orchestration.ts \
  src/hooks/use-fds-system-orchestration-conversation.ts \
  src/hooks/use-fds-orchestration-conversation.ts \
  src/lib/spec-builder/system-orchestration-prompts.ts \
  src/lib/spec-builder/__tests__/system-orchestration-prompts.test.ts
```

- [ ] **Step 5: Decide on `system_procedure` / `fds_system_procedures`**

The top-level contract still has `system_procedure` (a *cross-unit* layer, distinct from `unit_procedures`). The spec's non-goals exclude machine-wide orchestration, so remove `system_procedure` too: delete `loadSystemProcedure`, `fetchSystemProcedureRow`, the `system_orchestration` patch field + write block in `contract.ts`, and `SystemProcedureSchema`/`SystemStateSequenceSchema`/`InterUnitInterlockSchema` from `spec-contract-v2.ts` if no other consumer remains (grep first). Drop `system_procedure` from `SpecContractV2Schema`.

- [ ] **Step 6: Build until green**

Run: `npm run build`
Expected: PASS. Fix every dangling import the deletions surface.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(spec-builder): delete system-orchestration subsystem"
```

### Task 13: Rewrite `_build_contract_snapshot` RPC; drop orchestration tables

**Files:**
- Create: `supabase/migrations/<timestamp>_drop_orchestration_layer.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/<timestamp>_drop_orchestration_layer.sql`. Redefine `_build_contract_snapshot` to (a) stop emitting `states`, `orchestrations`, `system_orchestration`; (b) add `safety_gates` (from `spec_projects`) and per-EM `em_states`/`em_transitions` into the `assemblies` object; then drop the now-unused tables.

```sql
-- Hybrid state model: rewrite the snapshot RPC and drop the orchestration
-- tables. Read migrations 066 / 067 first to copy the function body, then
-- remove the states/orchestrations/system_orchestration keys and add the
-- safety_gates + per-EM state-machine keys. (Body elided here — base it on
-- the current definition in supabase/migrations/067_fds_system_orchestrations.sql.)

create or replace function public._build_contract_snapshot(p_spec_project_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  -- Copy the current 067 body, then:
  --   * remove 'states', 'orchestrations', 'system_orchestration' keys
  --   * add 'safety_gates' from spec_projects.safety_gates
  --   * include em_states / em_transitions on each assembly row
  -- (Author the full body by reading 067 in the repo at implementation time.)
  raise exception 'fill in _build_contract_snapshot body from migration 067';
  return v_result;
end;
$$;

drop table if exists public.fds_unit_procedures cascade;
drop table if exists public.fds_system_procedures cascade;
drop table if exists public.fds_system_orchestrations cascade;
```

> **Implementation note (not a placeholder for the RPC body):** the actual function body must be copied verbatim from `supabase/migrations/067_fds_system_orchestrations.sql` (the current definition) and edited as the comments instruct. The reason it is not inlined here is that the 067 body is ~80 lines and must be read from the repo at implementation time to avoid drift — read it, transform it per the three bullet points, and paste the result into this migration before applying. Do **not** apply the migration with the `raise exception` stub.

- [ ] **Step 2: Apply via MCP and rename**

Apply with `apply_migration` (name `drop_orchestration_layer`); rename the repo file to the recorded timestamp version.

- [ ] **Step 3: Verify snapshot round-trips**

Pick a confirmed spec project id, then via MCP `execute_sql`:

```sql
select jsonb_object_keys(public._build_contract_snapshot('<spec_project_id>'::uuid));
```

Expected keys include `safety_gates`, `equipment_modules`/`assemblies`; exclude `states`, `orchestrations`, `system_orchestration`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): rewrite contract snapshot RPC; drop orchestration tables"
```

### Task 14: Remove migrate-flow interlock classifier (orphaned by removal)

**Files:**
- Delete (if now unused): `src/lib/spec-builder/migrate/interlock-classifier.ts`, `migrate/apply-structured-interlocks.ts`, `components/spec-builder/migrate/migrate-interlock-row.tsx`, and their tests.

- [ ] **Step 1: Confirm they're orphaned**

Grep `apply-structured-interlocks`, `interlock-classifier`, `migrate-interlock-row`. These applied `inter_equipment_module_interlocks` into `unit_procedures` — which no longer exists. If the only remaining consumers are each other + tests, delete them. If the migrate flow itself is still wired into a route, gate that decision with the user (the spec's non-goal #3 says migrating legacy specs is out of scope, so removal is consistent).

- [ ] **Step 2: Delete + build**

```bash
git rm src/lib/spec-builder/migrate/interlock-classifier.ts src/lib/spec-builder/migrate/apply-structured-interlocks.ts src/components/spec-builder/migrate/migrate-interlock-row.tsx src/lib/spec-builder/migrate/__tests__/apply-structured-interlocks.test.ts
```

Run: `npm run build` then `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(spec-builder): remove orphaned interlock-classifier migrate flow"
```

### Task 15: Pipeline-integrity audit (mandatory per CLAUDE.md)

This wave touched `src/lib/*-prompt*.ts`, `src/hooks/use-fds-*.ts`, and pipeline-adjacent spec-builder logic.

- [ ] **Step 1: Run the auditor**

Read `.claude/agents/pipeline-auditor.md` and execute its audit against the current codebase. Report findings.

- [ ] **Step 2: Block on FAIL**

If the audit FAILs, fix violations before proceeding. Do not continue to Wave 8 until it passes.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(spec-builder): resolve pipeline-auditor findings"
```

---

# WAVE 8 — Validation target (Segment Wagon manual smoke)

### Task 16: Full check + Segment Wagon smoke

**Files:** none (verification)

- [ ] **Step 1: Whole-suite green**

Run: `npm test` then `npm run build` then `npm run lint`
Expected: all PASS. Fix anything red before continuing.

- [ ] **Step 2: Reset a spec project's derived data (per spec §6)**

Using the Supabase MCP `execute_sql`, for the chosen Segment Wagon spec project id, clear derived data while keeping the uploaded register:

```sql
-- Replace :pid with the spec_project_id.
update public.spec_projects
  set confirmed_units = '[]'::jsonb, confirmed_states = '[]'::jsonb,
      safety_gates = '[]'::jsonb, confirmed_modes = '[]'::jsonb,
      current_revision_id = null
  where id = ':pid';
delete from public.fds_operation_sessions where spec_project_id = ':pid';
delete from public.spec_sections where spec_project_id = ':pid';
delete from public.spec_project_revisions where spec_project_id = ':pid';
delete from public.spec_source_sections where spec_project_id = ':pid';
delete from public.instrument_registers where spec_project_id = ':pid' and source = 'ingest';
-- keep the source = 'upload' register
```

> Confirm the exact revision-pointer column name(s) against the schema before running (`current_revision_id` and/or `confirmed_revision_id`); adjust the `update` accordingly.

- [ ] **Step 3: Drive the wizard + co-author for the Segment Wagon**

Start the app: kill stray node first, then `npm run dev`.

```bash
powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
npm run dev
```

In the app, for the Segment Wagon spec (register from `Docs/Functional Specs/Herrenknecht/`):
1. Run the skeleton wizard → hierarchy = Carriage / Rotator / Safety / Indicators; **Machine Modes** = Local / Remote / Maintenance (edit the seeded Auto/Maintenance/Manual to match); **Safety Gates** = one E-Stop gate, scope `all`.
2. Co-author the **Carriage** EM: states `Stopped ⇄ Driving Forward ⇄ Driving Reverse` + `Faulted` (safe), command transitions driven by pendant tags, limit-switch + safety guards.
3. Co-author the **Rotator** EM independently: its own states held separately.

- [ ] **Step 4: Confirm the done bar**

Verify (in the loaded contract / DB) that the **Carriage EM and Rotator EM hold different states simultaneously** — the capability the old global model lacked — that the E-Stop safety gate maps both EMs to their safe state, and that the three machine modes are present.

```sql
select equipment_module_id, em_states, em_transitions
from public.fds_operation_sessions where spec_project_id = ':pid';
select safety_gates, confirmed_modes from public.spec_projects where id = ':pid';
```

Expected: two EM rows with distinct, independent `em_states`; one safety gate; three modes.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test(spec-builder): Segment Wagon hybrid state-model smoke validated"
```

---

## Self-review (spec coverage check)

- **Spec §1 EM state machine (`states`, behavior re-keyed, `transitions`, templates):** Tasks 1 (schema), 5 (read/write), 8 (Stage-A interview + templates), 9 (re-keyed behavior), 10 (random templates). ✔
- **Spec §2 Machine layer (`modes`, `safety_gates`, inter-EM via guards):** Tasks 1 (safety_gates schema), 4/5 (persist), 6/7 (wizard), 3 (validation). Inter-EM coordination = `guard` on `EmTransitionV2` (Task 1). ✔
- **Spec §3 Schema changes (4 new schemas, EM contract fields, top-level `safety_gates` add + `states`/`unit_procedures` remove, DB columns, contract.ts):** Tasks 1, 3, 4, 5, 11. ✔
- **Spec §4 Wizard + co-author UX:** Tasks 6/7 (wizard two steps), 8/9 (co-author staged). ✔
- **Spec §5 Testing (schema/contract round-trip, mode-gating, safety resolution, transition validation, co-author prompt, manual smoke):** Tasks 1, 2, 3, 5, 8, 9, 16. ✔
- **Spec §6 Implementer context (Supabase MCP apply + rename, kill stray node, reset SQL, validation target):** Tasks 4, 13, 16. ✔
- **Spec §7 Open items (expr type, inline vs table, staged prompt, unit_procedures blast radius):** Pinned decisions section + Tasks 11–14. ✔

**Type-consistency check:** `EmStateV2.state_id`/`name`/`kind`/`allowed_modes`/`is_safe_state`, `EmTransitionV2.transition_id`/`from_state_id`/`to_state_id`/`trigger`/`guard`, `SafetyGateV2.gate_id`/`name`/`condition`/`scope`, and `EquipmentModuleContract.states`/`transitions` are used identically across Tasks 1, 2, 3, 5, 8, 10. Function names `resolveAllowedStates`/`resolveForcedSafeStates`/`validateEmStateMachine`/`buildEmCanonicalStateMachine`/`buildEmStateMachineInterviewPrompt`/`seedDefaultModes`/`suggestSafetyGates` are consistent between their defining task and their callers.
