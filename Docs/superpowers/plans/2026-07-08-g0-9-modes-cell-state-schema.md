# G0-9 Modes & Cell-State Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the G0-9 design (`Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md`): kind-tagged operator modes, the per-unit PackML state machine schema (`unit_coordination`), the canonical EM command map, the `isModeChangeLegal` rule, validation, persistence, and seeding — schema + semantics only (no G2 writer, no UI).

**Architecture:** Additive wave on `src/types/spec-contract-v2.ts` (new `ModeKind`, `OperatorMode.kind`, `UNIT_PACKML_STATES`, `UnitCoordinationV1` keyed record on `SpecContractV2`), pure semantics helpers in a new `src/lib/spec-builder/unit-coordination.ts` (mirrors `em-state-machine.ts`: exported pure functions returning `string[]` issues), persistence via a new `spec_projects.unit_coordination` jsonb column wired through `loadSpecContract`/`writeSpecContract` exactly like `safety_gates`/`modes`.

**Tech Stack:** TypeScript 5.9 strict, Zod v4 (`z.partialRecord` available), Vitest, Supabase migration SQL.

## Global Constraints

- ALL logic must be GENERIC across machine types — never hardcode project-specific device/EM/mode names in schema, helpers, or validators. HRE-shaped data may appear ONLY inside test fixtures.
- TS strict: `import type` for type-only imports (`verbatimModuleSyntax`); no enums — use `as const` arrays / `z.enum` (`erasableSyntaxOnly`); no unused locals/params.
- Path alias: always `@/` for `src/` imports.
- Optional fields that AI-authored JSON may hit use the `nullableOptional()` helper already defined in `spec-contract-v2.ts` (line ~346, file-private — new schemas live in the same file so it is in scope).
- Typecheck: `npx tsc -b`. Tests: `npx vitest run <path>`.
- 25 pre-existing failing suites on master (quote/variation family) are NOT yours — judge success by the suites named in each task plus `npx tsc -b`.
- Commit per task, directly to `master` (repo convention). Do NOT push.
- Design deviations already ratified in this plan (flag any others): legality check (c) below — current unit state must be in the target mode's mask — is an addition consistent with the design's "validation gate, not coercion" principle (the design's (a)+(b) alone could strand the unit in a masked-out state).

---

### Task 1: `ModeKind` + `OperatorMode.kind`

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (OperatorMode section, ~line 108–120)
- Modify: `src/lib/spec-builder/wizard-machine-layer.ts:8-14`
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx:434`
- Modify: `src/lib/spec-builder/random/assemble.ts:306`
- Test: `src/types/__tests__/spec-contract-v2.test.ts` (append)

**Interfaces:**
- Produces: `ModeKindSchema` (z.enum), `ModeKind` type, `OperatorModeSchema` gains `kind: ModeKindSchema.default("custom")`. Inferred `OperatorMode` type now has required `kind: ModeKind` — every literal construction site must supply it.

- [ ] **Step 1: Write the failing test**

Append to `src/types/__tests__/spec-contract-v2.test.ts` (match the file's existing import style — it already imports from the schema module; extend that import with `OperatorModeSchema` and `ModeKindSchema`):

```ts
describe("OperatorMode.kind (G0-9)", () => {
  it("defaults kind to 'custom' so pre-G0-9 stored contracts parse unchanged", () => {
    const parsed = OperatorModeSchema.parse({
      mode_id: "auto",
      name: "Auto",
      is_default: true,
    });
    expect(parsed.kind).toBe("custom");
  });

  it("accepts each semantic kind", () => {
    for (const kind of ["production", "maintenance", "manual", "engineering", "custom"]) {
      const parsed = OperatorModeSchema.parse({
        mode_id: "m",
        name: "M",
        is_default: false,
        kind,
      });
      expect(parsed.kind).toBe(kind);
    }
  });

  it("rejects unknown kinds", () => {
    const res = OperatorModeSchema.safeParse({
      mode_id: "m",
      name: "M",
      is_default: false,
      kind: "turbo",
    });
    expect(res.success).toBe(false);
  });

  it("ModeKindSchema exposes exactly the five kinds", () => {
    expect(ModeKindSchema.options).toEqual([
      "production",
      "maintenance",
      "manual",
      "engineering",
      "custom",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/__tests__/spec-contract-v2.test.ts`
Expected: FAIL — `ModeKindSchema` not exported / `kind` is `undefined`.

- [ ] **Step 3: Implement the schema change**

In `src/types/spec-contract-v2.ts`, replace the `OperatorModeSchema` block (in the "Operator modes" section) with:

```ts
// Semantic mode kinds (G0-9). Writer/coordinator behavior keys off `kind`,
// never off mode names — generic across machine types:
//   production   — the normal mode; full authored state model.
//   maintenance  — drives commanded to Stopped; override/preset seams (G3).
//   manual       — operator-paced motion.
//   engineering  — never exposed on the HMI; coordinator releases command pins.
//   custom       — no writer-attached behavior beyond the authored masks.
export const ModeKindSchema = z.enum([
  "production",
  "maintenance",
  "manual",
  "engineering",
  "custom",
]);
export type ModeKind = z.infer<typeof ModeKindSchema>;

export const OperatorModeSchema = z.object({
  mode_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  is_default: z.boolean(),
  // .default("custom") so contracts stored before G0-9 parse unchanged.
  kind: ModeKindSchema.default("custom"),
});
export type OperatorMode = z.infer<typeof OperatorModeSchema>;
```

- [ ] **Step 4: Fix the three literal construction sites (compiler-driven)**

`src/lib/spec-builder/wizard-machine-layer.ts` — add kinds to the existing seeds (the seed set itself changes in Task 7; here just keep it compiling with truthful kinds):

```ts
export function seedDefaultModes(): OperatorMode[] {
  return [
    { mode_id: "auto", name: "Auto", description: "Automatic production mode", is_default: true, kind: "production" },
    { mode_id: "maintenance", name: "Maintenance", description: "Service / maintenance mode", is_default: false, kind: "maintenance" },
    { mode_id: "manual", name: "Manual", description: "Manual / jog mode", is_default: false, kind: "manual" },
  ];
}
```

`src/components/spec-builder/spec-skeleton-wizard.tsx:434` — operator-added modes are semantic-free until the authoring surface lands (separate follow-up task):

```ts
onChange([...modes, { mode_id: id, name: "New Mode", is_default: false, kind: "custom" }]);
```

`src/lib/spec-builder/random/assemble.ts:306`:

```ts
modes: [{ mode_id: "auto", name: "Auto", description: "Single default mode", is_default: true, kind: "production" }],
```

- [ ] **Step 5: Verify tests pass and project compiles**

Run: `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → PASS
Run: `npx tsc -b` → clean. If tsc flags any further `OperatorMode` literal site this plan missed, add `kind: "custom"` there (mode literals only — do NOT touch step-transition `is_default` fields, e.g. `fds-table-pane.tsx:436` is a transition, not a mode).

- [ ] **Step 6: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts src/lib/spec-builder/wizard-machine-layer.ts src/components/spec-builder/spec-skeleton-wizard.tsx src/lib/spec-builder/random/assemble.ts
git commit -m "feat(spec-contract): kind-tagged operator modes (G0-9)"
```

---

### Task 2: Unit-coordination schemas + contract/patch placement

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (new section + `SpecContractV2Schema`)
- Modify: `src/lib/spec-builder/contract.ts` (`SpecContractPatchSchema`, ~line 99–124)
- Test: `src/types/__tests__/spec-contract-v2.test.ts` (append)

**Interfaces:**
- Consumes: `PermissiveConditionSchema`, `UuidSchema`, `nullableOptional` (all already in `spec-contract-v2.ts`).
- Produces (all exported from `@/types/spec-contract-v2`):
  - `UNIT_PACKML_STATES: readonly ["idle","starting","execute","completing","complete","resetting","holding","held","unholding","suspending","suspended","unsuspending","stopping","stopped","aborting","aborted","clearing"]`
  - `UnitPackMLStateSchema` (z.enum over it), type `UnitPackMLState`
  - `UnitStateV1Schema` / `UnitStateV1`, `UnitTransitionTriggerSchema` / `UnitTransitionTrigger`, `UnitTransitionV1Schema` / `UnitTransitionV1`, `EmCommandOverrideSchema` / `EmCommandOverride`, `UnitCoordinationV1Schema` / `UnitCoordinationV1`
  - `SpecContractV2Schema` gains `unit_coordination: z.record(z.string(), UnitCoordinationV1Schema).optional()`
  - `SpecContractPatchSchema` (contract.ts) gains the same field.

- [ ] **Step 1: Write the failing test**

Append to `src/types/__tests__/spec-contract-v2.test.ts`:

```ts
describe("UnitCoordinationV1 (G0-9)", () => {
  const minimalCoord = {
    unit_id: "unit_1",
    states: [{ state_id: "idle" }, { state_id: "execute" }, { state_id: "stopped" }],
    transitions: [
      {
        transition_id: "t_start",
        from_state_id: "idle",
        to_state_id: "execute",
        trigger: { type: "command", command: "start" },
      },
    ],
  };

  it("parses a minimal coordination with defaults applied", () => {
    const parsed = UnitCoordinationV1Schema.parse(minimalCoord);
    expect(parsed.states[0]).toEqual({
      state_id: "idle",
      allowed_modes: [],
      mode_change_allowed: false,
    });
    expect(parsed.transitions[0].guard).toEqual([]);
    expect(parsed.transitions[0].allowed_modes).toEqual([]);
    expect(parsed.em_command_overrides).toBeUndefined();
  });

  it("rejects state_ids outside the canonical PackML set", () => {
    const res = UnitCoordinationV1Schema.safeParse({
      ...minimalCoord,
      states: [{ state_id: "warp_speed" }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts all three trigger types", () => {
    const triggers = [
      { type: "command", command: "abort" },
      { type: "condition", expr: [{ tag: "X", operator: "=", value: true }] },
      { type: "em_aggregate", em_scope: "all", em_state: "idle" },
    ];
    for (const trigger of triggers) {
      const res = UnitCoordinationV1Schema.safeParse({
        ...minimalCoord,
        transitions: [
          { transition_id: "t", from_state_id: "idle", to_state_id: "stopped", trigger },
        ],
      });
      expect(res.success).toBe(true);
    }
  });

  it("rejects a condition trigger with an empty expr", () => {
    const res = UnitCoordinationV1Schema.safeParse({
      ...minimalCoord,
      transitions: [
        {
          transition_id: "t",
          from_state_id: "idle",
          to_state_id: "stopped",
          trigger: { type: "condition", expr: [] },
        },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("parses sparse em_command_overrides and tolerates explicit null (AI-authored JSON)", () => {
    const emId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const parsed = UnitCoordinationV1Schema.parse({
      ...minimalCoord,
      em_command_overrides: {
        stopped: [{ equipment_module_id: emId, command: "NONE" }],
      },
    });
    expect(parsed.em_command_overrides?.stopped?.[0].command).toBe("NONE");
    const nulled = UnitCoordinationV1Schema.parse({
      ...minimalCoord,
      em_command_overrides: null,
    });
    expect(nulled.em_command_overrides).toBeUndefined();
  });

  it("UNIT_PACKML_STATES is the 17-state canonical set", () => {
    expect(UNIT_PACKML_STATES).toHaveLength(17);
    expect(UNIT_PACKML_STATES).toContain("unsuspending");
  });

  it("SpecContractV2Schema accepts an absent unit_coordination (additive wave)", () => {
    // Reuse whatever minimal valid contract fixture this test file already
    // builds for SpecContractV2Schema tests; assert `unit_coordination`
    // stays undefined after parse and a keyed record round-trips.
  });
});
```

For the last test, locate the existing minimal `SpecContractV2Schema.parse` fixture already used in this test file and extend it — one assertion that a contract without `unit_coordination` parses with the field `undefined`, and one that `{ ...fixture, unit_coordination: { unit_1: minimalCoord } }` parses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/__tests__/spec-contract-v2.test.ts`
Expected: FAIL — `UnitCoordinationV1Schema` not exported.

- [ ] **Step 3: Implement the schemas**

In `src/types/spec-contract-v2.ts`, insert a new section immediately BEFORE the `SpecContractV2Schema` block (search for `hierarchy: HierarchySchema` and place the section above that schema's section header comment):

```ts
// ============================================================
// Unit coordination (G0-9 — PackML-proper unit state machine).
// Each unit owns a generated state machine FB that commands its member
// EMs top-down. One SM per unit; modes may only DISABLE states from the
// canonical set below, never add (`allowed_modes` masks) — formally
// equivalent to ISA-TR88.00.02 per-mode state models.
// Consumers: G2 unit-FB writer, G7 text lists, G8-7 faceplates, G0-12.
// ============================================================

export const UNIT_PACKML_STATES = [
  "idle",
  "starting",
  "execute",
  "completing",
  "complete",
  "resetting",
  "holding",
  "held",
  "unholding",
  "suspending",
  "suspended",
  "unsuspending",
  "stopping",
  "stopped",
  "aborting",
  "aborted",
  "clearing",
] as const;
export const UnitPackMLStateSchema = z.enum(UNIT_PACKML_STATES);
export type UnitPackMLState = z.infer<typeof UnitPackMLStateSchema>;

export const UnitStateV1Schema = z.object({
  state_id: UnitPackMLStateSchema,
  // mode_ids this state is active in; empty = all modes.
  allowed_modes: z.array(z.string()).default([]),
  // Authoring UI should default this true for stopped/idle/aborted.
  mode_change_allowed: z.boolean().default(false),
});
export type UnitStateV1 = z.infer<typeof UnitStateV1Schema>;

export const UnitTransitionTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.enum([
      "start",
      "stop",
      "hold",
      "unhold",
      "suspend",
      "unsuspend",
      "reset",
      "clear",
      "abort",
    ]),
  }),
  z.object({
    type: z.literal("condition"),
    expr: z.array(PermissiveConditionSchema).min(1),
  }),
  // e.g. all member EMs report EM-local state "idle".
  z.object({
    type: z.literal("em_aggregate"),
    em_scope: z.union([z.literal("all"), z.array(z.string())]),
    em_state: z.string().min(1),
  }),
]);
export type UnitTransitionTrigger = z.infer<typeof UnitTransitionTriggerSchema>;

export const UnitTransitionV1Schema = z.object({
  transition_id: z.string().min(1),
  from_state_id: UnitPackMLStateSchema,
  to_state_id: UnitPackMLStateSchema,
  trigger: UnitTransitionTriggerSchema,
  guard: z.array(PermissiveConditionSchema).default([]),
  allowed_modes: z.array(z.string()).default([]),
});
export type UnitTransitionV1 = z.infer<typeof UnitTransitionV1Schema>;

// Per-EM override of the canonical unit-state → EM-command map
// (see CANONICAL_EM_COMMAND_MAP in lib/spec-builder/unit-coordination.ts).
export const EmCommandOverrideSchema = z.object({
  equipment_module_id: UuidSchema,
  command: z.enum(["CLEAR", "RESET", "START", "STOP", "HOLD", "ABORT", "NONE"]),
});
export type EmCommandOverride = z.infer<typeof EmCommandOverrideSchema>;

export const UnitCoordinationV1Schema = z.object({
  unit_id: z.string().min(1),
  states: z.array(UnitStateV1Schema).min(1),
  transitions: z.array(UnitTransitionV1Schema).default([]),
  // Sparse per-unit-state overrides only — canonical defaults apply to
  // absent states. partialRecord: plain z.record over an enum key demands
  // exhaustiveness (same pattern as SpecContractV2.section_overrides).
  // nullableOptional: AI-authored JSON may emit explicit null.
  em_command_overrides: nullableOptional(
    z.partialRecord(UnitPackMLStateSchema, z.array(EmCommandOverrideSchema)),
  ),
});
export type UnitCoordinationV1 = z.infer<typeof UnitCoordinationV1Schema>;
```

Then add to `SpecContractV2Schema` (after the `modes:` line):

```ts
  // G0-9: keyed by unit_id — mirrors the equipment_modules keyed-record
  // pattern; HierarchySchema untouched. Absent until authored.
  unit_coordination: z.record(z.string(), UnitCoordinationV1Schema).optional(),
```

- [ ] **Step 4: Add the field to the patch schema**

In `src/lib/spec-builder/contract.ts`, add to `SpecContractPatchSchema` (after `modes:` at ~line 114) and extend the type-only import from `@/types/spec-contract-v2` with `UnitCoordinationV1Schema`:

```ts
  unit_coordination: z.record(z.string(), UnitCoordinationV1Schema).optional(),
```

(Also extend the plain-interface patch type near line 82 if one mirrors the schema — grep for `safety_gates?: SafetyGateV2[]` at contract.ts:82 and add `unit_coordination?: Record<string, UnitCoordinationV1>;` alongside, importing the type with `import type`.)

- [ ] **Step 5: Verify tests pass and project compiles**

Run: `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → PASS
Run: `npx tsc -b` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/spec-contract-v2.ts src/types/__tests__/spec-contract-v2.test.ts src/lib/spec-builder/contract.ts
git commit -m "feat(spec-contract): UnitCoordinationV1 schema — PackML unit state machine (G0-9)"
```

---

### Task 3: Canonical EM command map + `emCommandsForUnitState`

**Files:**
- Create: `src/lib/spec-builder/unit-coordination.ts`
- Test: `src/lib/spec-builder/__tests__/unit-coordination.test.ts` (create)

**Interfaces:**
- Consumes: `UnitPackMLState`, `UnitCoordinationV1`, `EmCommandOverride` from `@/types/spec-contract-v2`.
- Produces:
  - `export type EmCommand = "CLEAR" | "RESET" | "START" | "STOP" | "HOLD" | "ABORT" | "NONE"`
  - `export const CANONICAL_EM_COMMAND_MAP: Record<UnitPackMLState, EmCommand>`
  - `export function emCommandForState(coord: UnitCoordinationV1, unitState: UnitPackMLState, equipmentModuleId: string): EmCommand` — canonical default with per-EM override precedence.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/unit-coordination.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CANONICAL_EM_COMMAND_MAP,
  emCommandForState,
} from "@/lib/spec-builder/unit-coordination";
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";
import { UNIT_PACKML_STATES, UnitCoordinationV1Schema } from "@/types/spec-contract-v2";

const EM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeCoord(overrides?: UnitCoordinationV1["em_command_overrides"]): UnitCoordinationV1 {
  return UnitCoordinationV1Schema.parse({
    unit_id: "unit_1",
    states: [{ state_id: "idle" }, { state_id: "execute" }, { state_id: "stopped" }],
    transitions: [],
    em_command_overrides: overrides,
  });
}

describe("CANONICAL_EM_COMMAND_MAP", () => {
  it("covers every canonical PackML state", () => {
    for (const s of UNIT_PACKML_STATES) {
      expect(CANONICAL_EM_COMMAND_MAP[s]).toBeDefined();
    }
  });

  it("matches the design table", () => {
    expect(CANONICAL_EM_COMMAND_MAP.clearing).toBe("CLEAR");
    expect(CANONICAL_EM_COMMAND_MAP.resetting).toBe("RESET");
    expect(CANONICAL_EM_COMMAND_MAP.starting).toBe("START");
    expect(CANONICAL_EM_COMMAND_MAP.execute).toBe("START");
    expect(CANONICAL_EM_COMMAND_MAP.stopping).toBe("STOP");
    expect(CANONICAL_EM_COMMAND_MAP.stopped).toBe("STOP");
    expect(CANONICAL_EM_COMMAND_MAP.holding).toBe("HOLD");
    expect(CANONICAL_EM_COMMAND_MAP.held).toBe("HOLD");
    expect(CANONICAL_EM_COMMAND_MAP.aborting).toBe("ABORT");
    expect(CANONICAL_EM_COMMAND_MAP.aborted).toBe("ABORT");
    // idle / complete / all remaining acting states hold last (NONE)
    expect(CANONICAL_EM_COMMAND_MAP.idle).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.complete).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.completing).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.unholding).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.suspending).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.suspended).toBe("NONE");
    expect(CANONICAL_EM_COMMAND_MAP.unsuspending).toBe("NONE");
  });
});

describe("emCommandForState", () => {
  it("falls back to the canonical map when no override exists", () => {
    expect(emCommandForState(makeCoord(), "execute", EM_A)).toBe("START");
    expect(emCommandForState(makeCoord(), "aborting", EM_A)).toBe("ABORT");
  });

  it("applies a per-EM override for the matching state only", () => {
    const coord = makeCoord({
      execute: [{ equipment_module_id: EM_A, command: "NONE" }],
    });
    expect(emCommandForState(coord, "execute", EM_A)).toBe("NONE");
    expect(emCommandForState(coord, "execute", EM_B)).toBe("START"); // other EM: canonical
    expect(emCommandForState(coord, "starting", EM_A)).toBe("START"); // other state: canonical
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination.test.ts`
Expected: FAIL — module `@/lib/spec-builder/unit-coordination` not found.

- [ ] **Step 3: Implement**

Create `src/lib/spec-builder/unit-coordination.ts`:

```ts
/**
 * G0-9 unit-coordination semantics — pure helpers, no React/IO.
 * Single source of truth shared by patch validation (contract.ts), the
 * future G2 unit-FB writer, and UI display. Generic across machine types.
 * Design: Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md
 */
import type {
  EmStateV2,
  OperatorMode,
  UnitCoordinationV1,
  UnitPackMLState,
} from "@/types/spec-contract-v2";

export type EmCommand =
  | "CLEAR"
  | "RESET"
  | "START"
  | "STOP"
  | "HOLD"
  | "ABORT"
  | "NONE";

/**
 * Canonical unit-state → member-EM command map. `NONE` means the unit FB
 * asserts nothing; the EM stays where it is (hold last). Safety gates keep
 * their existing force-to-safe role and additionally map to the unit's
 * `aborting` transition — no duplication of the safety model here.
 */
export const CANONICAL_EM_COMMAND_MAP: Record<UnitPackMLState, EmCommand> = {
  idle: "NONE",
  starting: "START",
  execute: "START",
  completing: "NONE",
  complete: "NONE",
  resetting: "RESET",
  holding: "HOLD",
  held: "HOLD",
  unholding: "NONE",
  suspending: "NONE",
  suspended: "NONE",
  unsuspending: "NONE",
  stopping: "STOP",
  stopped: "STOP",
  aborting: "ABORT",
  aborted: "ABORT",
  clearing: "CLEAR",
};

/**
 * Command the unit asserts to one member EM while in `unitState`:
 * per-EM override when one exists for that state, else the canonical map.
 */
export function emCommandForState(
  coord: UnitCoordinationV1,
  unitState: UnitPackMLState,
  equipmentModuleId: string,
): EmCommand {
  const override = coord.em_command_overrides?.[unitState]?.find(
    (o) => o.equipment_module_id === equipmentModuleId,
  );
  return override?.command ?? CANONICAL_EM_COMMAND_MAP[unitState];
}
```

(The `EmStateV2`/`OperatorMode` imports are used by Task 4 — if implementing tasks strictly in order and tsc complains about unused imports, add them in Task 4 instead.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination.test.ts` → PASS
Run: `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/unit-coordination.ts src/lib/spec-builder/__tests__/unit-coordination.test.ts
git commit -m "feat(spec-builder): canonical EM command map + override precedence (G0-9)"
```

---

### Task 4: `isModeChangeLegal`

**Files:**
- Modify: `src/lib/spec-builder/unit-coordination.ts`
- Test: `src/lib/spec-builder/__tests__/unit-coordination.test.ts` (append)

**Interfaces:**
- Produces:
  - `export interface ModeChangeSpecView { modes?: OperatorMode[]; unit_coordination?: Record<string, UnitCoordinationV1>; equipment_modules: Record<string, { unit_id: string; states: EmStateV2[] }>; }` — a structural subset of `SpecContractV2`, so a full contract is directly assignable.
  - `export interface ModeChangeVerdict { legal: boolean; reasons: string[] }`
  - `export function isModeChangeLegal(spec: ModeChangeSpecView, unitId: string, targetModeId: string, currentUnitState: UnitPackMLState, emCurrentStates: Record<string, string>): ModeChangeVerdict`

Legality (v1, strict — validation gate, not coercion; no forced state changes):
- (pre) unit has a coordination entry; `targetModeId` exists in `modes` — else illegal with reason.
- (a) the unit's current state has `mode_change_allowed: true`.
- (b) every member EM (those with `unit_id === unitId`) whose current state is known via `emCurrentStates` is in an EM state whose `EmStateV2.allowed_modes` includes `targetModeId` (empty mask = always legal). Member EMs absent from `emCurrentStates` are skipped — the caller decides how much runtime state it has. An EM state id not found in the EM's declared states → illegal with reason (unknown state cannot be proven legal).
- (c) [plan addition, see Global Constraints] the current unit state's own `allowed_modes` includes `targetModeId` (empty = all modes) — a legal switch must not strand the unit in a masked-out state.
- All failures are collected — `reasons` lists every violated clause, not just the first.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/spec-builder/__tests__/unit-coordination.test.ts` (extend the vitest import line and add `isModeChangeLegal` plus type imports as needed):

```ts
import { isModeChangeLegal } from "@/lib/spec-builder/unit-coordination";
import type { ModeChangeSpecView } from "@/lib/spec-builder/unit-coordination";

function makeSpec(): ModeChangeSpecView {
  return {
    modes: [
      { mode_id: "production", name: "Production", is_default: true, kind: "production" },
      { mode_id: "maintenance", name: "Maintenance", is_default: false, kind: "maintenance" },
      { mode_id: "eng", name: "Engineering", is_default: false, kind: "engineering" },
    ],
    unit_coordination: {
      unit_1: UnitCoordinationV1Schema.parse({
        unit_id: "unit_1",
        states: [
          { state_id: "stopped", mode_change_allowed: true },
          { state_id: "execute", allowed_modes: ["production"] },
          { state_id: "idle", mode_change_allowed: true },
        ],
        transitions: [],
      }),
    },
    equipment_modules: {
      [EM_A]: {
        unit_id: "unit_1",
        states: [
          // empty mask = legal in all modes
          { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
          // production-only state
          { state_id: "running", name: "Running", kind: "sequential", allowed_modes: ["production"], is_safe_state: false },
        ],
      },
      [EM_B]: {
        unit_id: "other_unit", // not a member — must be ignored
        states: [],
      },
    },
  };
}

describe("isModeChangeLegal", () => {
  it("grants when state gate open and all member EM masks allow the target", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {
      [EM_A]: "stopped",
    });
    expect(v).toEqual({ legal: true, reasons: [] });
  });

  it("(a) rejects when the current unit state has mode_change_allowed=false", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "production", "execute", {
      [EM_A]: "stopped",
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/mode_change_allowed/);
  });

  it("(b) rejects when a member EM is in a state whose mask excludes the target", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {
      [EM_A]: "running", // allowed_modes: ["production"]
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.join(" ")).toContain(EM_A);
  });

  it("(b) empty EM mask means always legal (engineering-mode case)", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "eng", "stopped", {
      [EM_A]: "stopped",
    });
    expect(v.legal).toBe(true);
  });

  it("(b) skips member EMs with no runtime state provided", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {});
    expect(v.legal).toBe(true);
  });

  it("(b) rejects an EM state id not declared on the EM", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "stopped", {
      [EM_A]: "ghost_state",
    });
    expect(v.legal).toBe(false);
  });

  it("(c) rejects when the current unit state is masked out of the target mode", () => {
    // execute is production-only; even if it allowed mode changes, switching
    // to maintenance while in execute would strand the unit.
    const spec = makeSpec();
    spec.unit_coordination!.unit_1.states = spec.unit_coordination!.unit_1.states.map((s) =>
      s.state_id === "execute" ? { ...s, mode_change_allowed: true } : s,
    );
    const v = isModeChangeLegal(spec, "unit_1", "maintenance", "execute", {
      [EM_A]: "stopped",
    });
    expect(v.legal).toBe(false);
  });

  it("rejects unknown unit / unknown target mode with reasons", () => {
    expect(isModeChangeLegal(makeSpec(), "nope", "production", "stopped", {}).legal).toBe(false);
    expect(isModeChangeLegal(makeSpec(), "unit_1", "nope", "stopped", {}).legal).toBe(false);
  });

  it("collects ALL violated clauses, not just the first", () => {
    const v = isModeChangeLegal(makeSpec(), "unit_1", "maintenance", "execute", {
      [EM_A]: "running",
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2); // (a)+(c) on unit state, (b) on EM
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination.test.ts`
Expected: FAIL — `isModeChangeLegal` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/spec-builder/unit-coordination.ts`:

```ts
/**
 * Structural subset of SpecContractV2 needed for the legality rule — a full
 * contract is directly assignable. Keeps tests and non-contract callers light.
 */
export interface ModeChangeSpecView {
  modes?: OperatorMode[];
  unit_coordination?: Record<string, UnitCoordinationV1>;
  equipment_modules: Record<string, { unit_id: string; states: EmStateV2[] }>;
}

export interface ModeChangeVerdict {
  legal: boolean;
  reasons: string[];
}

/**
 * G0-9 mode-change legality (v1, strict). Validation gate, not coercion —
 * a grant never forces a state change. Request granted iff:
 *  (a) the unit's current state has mode_change_allowed, and
 *  (b) every member EM with a known current state is in an EM state whose
 *      allowed_modes includes the target mode (empty mask = always legal), and
 *  (c) the current unit state itself is in the target mode's mask
 *      (empty = all modes) — a legal switch must not strand the unit in a
 *      masked-out state.
 * Member EMs absent from `emCurrentStates` are skipped (caller supplies as
 * much runtime state as it has). All violations are collected into `reasons`.
 */
export function isModeChangeLegal(
  spec: ModeChangeSpecView,
  unitId: string,
  targetModeId: string,
  currentUnitState: UnitPackMLState,
  emCurrentStates: Record<string, string>,
): ModeChangeVerdict {
  const reasons: string[] = [];

  const coord = spec.unit_coordination?.[unitId];
  if (!coord) reasons.push(`unit ${unitId} has no unit_coordination entry`);
  if (!spec.modes?.some((m) => m.mode_id === targetModeId)) {
    reasons.push(`target mode ${targetModeId} is not a declared mode`);
  }
  if (reasons.length > 0) return { legal: false, reasons };

  const unitState = coord!.states.find((s) => s.state_id === currentUnitState);
  if (!unitState) {
    reasons.push(
      `unit ${unitId} state ${currentUnitState} is not declared in its coordination`,
    );
    return { legal: false, reasons };
  }

  // (a) state gate
  if (!unitState.mode_change_allowed) {
    reasons.push(
      `unit ${unitId} state ${currentUnitState} has mode_change_allowed=false`,
    );
  }

  // (c) the unit state must remain active in the target mode
  if (
    unitState.allowed_modes.length > 0 &&
    !unitState.allowed_modes.includes(targetModeId)
  ) {
    reasons.push(
      `unit ${unitId} state ${currentUnitState} is not in mode ${targetModeId}'s mask`,
    );
  }

  // (b) every member EM with known runtime state must allow the target mode
  for (const [emId, em] of Object.entries(spec.equipment_modules)) {
    if (em.unit_id !== unitId) continue;
    const currentEmStateId = emCurrentStates[emId];
    if (currentEmStateId === undefined) continue;
    const emState = em.states.find((s) => s.state_id === currentEmStateId);
    if (!emState) {
      reasons.push(
        `equipment_module ${emId} reports unknown state ${currentEmStateId}`,
      );
      continue;
    }
    if (
      emState.allowed_modes.length > 0 &&
      !emState.allowed_modes.includes(targetModeId)
    ) {
      reasons.push(
        `equipment_module ${emId} is in state ${currentEmStateId}, whose allowed_modes excludes ${targetModeId}`,
      );
    }
  }

  return { legal: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination.test.ts` → PASS
Run: `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/unit-coordination.ts src/lib/spec-builder/__tests__/unit-coordination.test.ts
git commit -m "feat(spec-builder): isModeChangeLegal — strict v1 mode-change gate (G0-9)"
```

---

### Task 5: `validateUnitCoordination` + patch-validator wiring

**Files:**
- Modify: `src/lib/spec-builder/unit-coordination.ts`
- Modify: `src/lib/spec-builder/contract.ts` (`validateSpecContractPatch`, ~line 1151)
- Test: `src/lib/spec-builder/__tests__/unit-coordination.test.ts` (append)
- Test: `src/lib/spec-builder/__tests__/contract-em-validation.test.ts` (append wiring case)

**Interfaces:**
- Produces: `export function validateUnitCoordination(coord: UnitCoordinationV1, ctx: { modes?: OperatorMode[]; memberEmIds?: Set<string> }): string[]` — human-readable issues, `[]` = valid. Context-dependent checks are SKIPPED when their context is absent (same convention as the safety-gates validator in `validateSpecContractPatch`, which only cross-checks EM ids when `patch.hierarchy` is present).

Checks (numbering from the design's Validation section; rule 3 — exactly one `is_default` mode — already lives in `validateSpecContractPatch` and is not duplicated here):
1. `states[].state_id` unique; every transition's `from_state_id`/`to_state_id` references a declared state. Also: `transition_id` unique (same convention as `validateEmStateMachine`).
2. (needs `ctx.modes`) every declared mode has ≥ 1 allowed unit state — a state whose `allowed_modes` is empty or includes the mode.
4. (needs `ctx.modes`) for every mode, at least one state in its mask has `mode_change_allowed: true` (no roach-motel modes).
5. (needs `ctx.memberEmIds`) every `em_command_overrides` EM id is a member of this unit.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/spec-builder/__tests__/unit-coordination.test.ts` (extend imports with `validateUnitCoordination`):

```ts
describe("validateUnitCoordination", () => {
  const modes = [
    { mode_id: "production", name: "Production", is_default: true, kind: "production" as const },
    { mode_id: "maintenance", name: "Maintenance", is_default: false, kind: "maintenance" as const },
  ];

  function coordOf(partial: Record<string, unknown>): UnitCoordinationV1 {
    return UnitCoordinationV1Schema.parse({
      unit_id: "unit_1",
      states: [
        { state_id: "stopped", mode_change_allowed: true },
        { state_id: "execute" },
      ],
      transitions: [],
      ...partial,
    });
  }

  it("passes a well-formed coordination", () => {
    expect(validateUnitCoordination(coordOf({}), { modes })).toEqual([]);
  });

  it("rule 1: flags duplicate state_ids", () => {
    const issues = validateUnitCoordination(
      coordOf({ states: [{ state_id: "stopped", mode_change_allowed: true }, { state_id: "stopped" }] }),
      {},
    );
    expect(issues.some((i) => i.includes("duplicate"))).toBe(true);
  });

  it("rule 1: flags transitions referencing undeclared states", () => {
    const issues = validateUnitCoordination(
      coordOf({
        transitions: [
          {
            transition_id: "t1",
            from_state_id: "stopped",
            to_state_id: "aborted", // not declared on this unit
            trigger: { type: "command", command: "abort" },
          },
        ],
      }),
      {},
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rule 1: flags duplicate transition_ids", () => {
    const t = {
      transition_id: "t1",
      from_state_id: "stopped",
      to_state_id: "execute",
      trigger: { type: "command", command: "start" },
    };
    const issues = validateUnitCoordination(coordOf({ transitions: [t, t] }), {});
    expect(issues.some((i) => i.includes("t1"))).toBe(true);
  });

  it("rule 2: flags a mode with no allowed unit state", () => {
    const issues = validateUnitCoordination(
      coordOf({
        states: [
          { state_id: "stopped", allowed_modes: ["production"], mode_change_allowed: true },
          { state_id: "execute", allowed_modes: ["production"] },
        ],
      }),
      { modes },
    );
    expect(issues.some((i) => i.includes("maintenance"))).toBe(true);
  });

  it("rule 4: flags a roach-motel mode (no mode_change_allowed state in its mask)", () => {
    const issues = validateUnitCoordination(
      coordOf({
        states: [
          { state_id: "stopped", allowed_modes: ["production"], mode_change_allowed: true },
          // maintenance's only state can't leave
          { state_id: "held", allowed_modes: ["maintenance"], mode_change_allowed: false },
        ],
      }),
      { modes },
    );
    expect(issues.some((i) => i.includes("maintenance") && i.includes("mode_change_allowed"))).toBe(true);
  });

  it("rule 5: flags overrides referencing non-member EMs; skipped without ctx", () => {
    const coord = coordOf({
      em_command_overrides: { stopped: [{ equipment_module_id: EM_A, command: "NONE" }] },
    });
    expect(validateUnitCoordination(coord, { memberEmIds: new Set([EM_B]) }).length).toBe(1);
    expect(validateUnitCoordination(coord, { memberEmIds: new Set([EM_A]) })).toEqual([]);
    expect(validateUnitCoordination(coord, {})).toEqual([]); // no ctx → skipped
  });

  it("skips mode rules when ctx.modes is absent", () => {
    const issues = validateUnitCoordination(
      coordOf({ states: [{ state_id: "stopped", allowed_modes: ["production"] }] }),
      {},
    );
    expect(issues).toEqual([]);
  });
});
```

Append to `src/lib/spec-builder/__tests__/contract-em-validation.test.ts` (this file already imports `validateSpecContractPatch` — follow its existing fixture conventions):

```ts
describe("validateSpecContractPatch — unit_coordination (G0-9)", () => {
  it("flags a record key that disagrees with coord.unit_id", () => {
    const issues = validateSpecContractPatch({
      unit_coordination: {
        unit_1: {
          unit_id: "unit_2",
          states: [{ state_id: "stopped", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
        },
      },
    } as never);
    expect(issues.some((i) => i.includes("unit_1") && i.includes("unit_2"))).toBe(true);
  });

  it("runs validateUnitCoordination per unit with modes from the same patch", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "production", name: "P", is_default: true, kind: "production" },
        { mode_id: "maintenance", name: "M", is_default: false, kind: "maintenance" },
      ],
      unit_coordination: {
        unit_1: {
          unit_id: "unit_1",
          states: [
            { state_id: "stopped", allowed_modes: ["production"], mode_change_allowed: true },
          ],
          transitions: [],
        },
      },
    } as never);
    expect(issues.some((i) => i.includes("maintenance"))).toBe(true); // rule 2
  });

  it("accepts a valid coordination patch", () => {
    const issues = validateSpecContractPatch({
      unit_coordination: {
        unit_1: {
          unit_id: "unit_1",
          states: [{ state_id: "stopped", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
        },
      },
    } as never);
    expect(issues).toEqual([]);
  });
});
```

NOTE: `validateSpecContractPatch` takes the ZOD-PARSED patch type. If the existing tests in that file parse via `SpecContractPatchSchema.parse(...)` first, follow that convention instead of `as never`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts`
Expected: FAIL — `validateUnitCoordination` not exported; wiring absent.

- [ ] **Step 3: Implement `validateUnitCoordination`**

Append to `src/lib/spec-builder/unit-coordination.ts`:

```ts
/**
 * Structural invariants over one unit's coordination (design §Validation).
 * Context-dependent checks are skipped when their context is absent —
 * callers pass whatever the patch carries (same convention as the
 * safety-gates validator in contract.ts). Rule 3 (exactly one default
 * mode) already lives in validateSpecContractPatch.
 */
export function validateUnitCoordination(
  coord: UnitCoordinationV1,
  ctx: { modes?: OperatorMode[]; memberEmIds?: Set<string> },
): string[] {
  const issues: string[] = [];
  const where = `unit_coordination[${coord.unit_id}]`;

  // Rule 1 — unique state ids; transitions reference declared states.
  const stateIds = coord.states.map((s) => s.state_id);
  const declared = new Set(stateIds);
  const dupStates = stateIds.filter((id, i) => stateIds.indexOf(id) !== i);
  if (dupStates.length > 0) {
    issues.push(`${where}: duplicate state_id(s): ${[...new Set(dupStates)].join(", ")}`);
  }
  const seenTransitions = new Set<string>();
  for (const t of coord.transitions) {
    if (seenTransitions.has(t.transition_id)) {
      issues.push(`${where}: duplicate transition_id ${t.transition_id}`);
    }
    seenTransitions.add(t.transition_id);
    for (const ref of [t.from_state_id, t.to_state_id]) {
      if (!declared.has(ref)) {
        issues.push(
          `${where}: transition ${t.transition_id} references undeclared state ${ref}`,
        );
      }
    }
  }

  // Rules 2 + 4 — need the mode list.
  if (ctx.modes) {
    for (const mode of ctx.modes) {
      const inMask = coord.states.filter(
        (s) => s.allowed_modes.length === 0 || s.allowed_modes.includes(mode.mode_id),
      );
      if (inMask.length === 0) {
        issues.push(
          `${where}: mode ${mode.mode_id} has no allowed unit state (empty machine)`,
        );
      } else if (!inMask.some((s) => s.mode_change_allowed)) {
        issues.push(
          `${where}: mode ${mode.mode_id} has no state with mode_change_allowed=true in its mask (cannot leave the mode)`,
        );
      }
    }
  }

  // Rule 5 — overrides must reference member EMs of this unit.
  if (ctx.memberEmIds && coord.em_command_overrides) {
    for (const [stateId, overrides] of Object.entries(coord.em_command_overrides)) {
      for (const o of overrides ?? []) {
        if (!ctx.memberEmIds.has(o.equipment_module_id)) {
          issues.push(
            `${where}: em_command_overrides[${stateId}] references equipment_module ${o.equipment_module_id} which is not a member of this unit`,
          );
        }
      }
    }
  }

  return issues;
}
```

- [ ] **Step 4: Wire into `validateSpecContractPatch`**

In `src/lib/spec-builder/contract.ts`, import (top of file, alongside the `validateEmStateMachine` import):

```ts
import { validateUnitCoordination } from "@/lib/spec-builder/unit-coordination";
```

Add inside `validateSpecContractPatch`, after the safety-gates block (find `if (patch.safety_gates !== undefined) {` at ~line 1223 and place after its closing brace):

```ts
  // G0-9: unit coordination invariants. Member-EM cross-check only runs when
  // the same patch carries the hierarchy (same convention as safety_gates);
  // mode rules only when the patch carries modes.
  if (patch.unit_coordination !== undefined) {
    for (const [key, coord] of Object.entries(patch.unit_coordination)) {
      if (key !== coord.unit_id) {
        issues.push(
          `unit_coordination key ${key} disagrees with its unit_id ${coord.unit_id}`,
        );
      }
      let memberEmIds: Set<string> | undefined;
      if (patch.hierarchy) {
        const unit = patch.hierarchy.units.find((u) => u.unit_id === coord.unit_id);
        memberEmIds = new Set(
          (unit?.equipment_modules ?? []).map((a) => a.equipment_module_id),
        );
      }
      issues.push(
        ...validateUnitCoordination(coord, { modes: patch.modes, memberEmIds }),
      );
    }
  }
```

NOTE: check the actual field names on the hierarchy unit type (`unit_id`, `equipment_modules[].equipment_module_id`) against the existing safety-gates block at contract.ts:1223-1236, which walks the same structure — copy its exact accessors.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts` → PASS
Run: `npx tsc -b` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/unit-coordination.ts src/lib/spec-builder/contract.ts src/lib/spec-builder/__tests__/unit-coordination.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts
git commit -m "feat(spec-builder): validateUnitCoordination + patch wiring (G0-9)"
```

---

### Task 6: Persistence — migration + load/write wiring

**Files:**
- Create: `supabase/migrations/20260708000000_unit_coordination.sql`
- Modify: `src/lib/spec-builder/contract.ts` (`loadSpecContract` ~line 802, `writeSpecContract` ~line 971)

**Interfaces:**
- Consumes: `UnitCoordinationV1` type (Task 2), `spec_projects` table.
- Produces: `spec_projects.unit_coordination` jsonb column; round-trip through `loadSpecContract`/`writeSpecContract`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260708000000_unit_coordination.sql`:

```sql
-- G0-9: per-unit PackML state machine + mode manager configuration.
-- Shape: Record<unit_id, UnitCoordinationV1> (see src/types/spec-contract-v2.ts).
-- Null = not authored (optional during the additive wave).
alter table public.spec_projects
  add column if not exists unit_coordination jsonb;

comment on column public.spec_projects.unit_coordination is
  'G0-9 unit coordination: Record<unit_id, UnitCoordinationV1> — PackML unit state machines, mode masks, EM command overrides. Null = not authored.';
```

Do NOT run `npx supabase db push` — remote deploy is a separate user-approved step (migration-history drift precedent; see CLAUDE.md).

- [ ] **Step 2: Wire the read path**

In `loadSpecContract` (contract.ts ~line 802), add to the final `SpecContractV2Schema.parse({...})` object, after the `modes:` line:

```ts
    unit_coordination:
      (projectRow.unit_coordination as Record<string, UnitCoordinationV1> | null) ??
      undefined,
```

Add `UnitCoordinationV1` to the existing `import type` from `@/types/spec-contract-v2`.

(Revision snapshots: `loadRevisionSnapshot` returns the stored whole-contract JSON and parses it through `SpecContractV2Schema`, so the optional field flows automatically — verify with a quick read of `loadRevisionSnapshot` that it parses the full contract rather than field-picking; if it field-picks, add the field there too.)

- [ ] **Step 3: Wire the write path**

In `writeSpecContract` (contract.ts, the `projectUpdate` block ~line 971), after the `modes` case:

```ts
  if (parsed.unit_coordination !== undefined) {
    projectUpdate.unit_coordination = parsed.unit_coordination;
  }
```

Update the `writeSpecContract` doc comment (~line 927) to include `unit_coordination` in the list of fields persisted onto `spec_projects`.

- [ ] **Step 4: Verify**

Run: `npx tsc -b` → clean.
Run: `npx vitest run src/lib/spec-builder/__tests__/contract.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts` → PASS (no regressions). If `contract.test.ts` has round-trip tests with a mocked supabase client, add a case asserting `unit_coordination` lands in the `spec_projects` update payload — follow the file's existing mock pattern; if it has no such pattern, the wiring is covered by the Task 5 validator tests plus Task 8's golden parse and that is acceptable.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260708000000_unit_coordination.sql src/lib/spec-builder/contract.ts
git commit -m "feat(spec-builder): persist unit_coordination on spec_projects (G0-9)"
```

---

### Task 7: Seeding — Production + Maintenance with kinds

**Files:**
- Modify: `src/lib/spec-builder/wizard-machine-layer.ts`
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx` (comment at line 97 only)
- Test: `src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts`

**Interfaces:**
- Produces: `seedDefaultModes()` now returns exactly 2 modes: Production (`kind: "production"`, `is_default: true`) + Maintenance (`kind: "maintenance"`). Seeding only applies when a project has no stored modes (`spec-skeleton-wizard.tsx:98-101` guards on `existing.length > 0`), so existing projects are untouched.

- [ ] **Step 1: Update the test**

In `src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts`, replace the `seedDefaultModes` describe block's expectations:

```ts
describe("seedDefaultModes", () => {
  it("seeds Production (default) + Maintenance with semantic kinds (G0-9)", () => {
    const modes = seedDefaultModes();
    expect(modes).toEqual([
      {
        mode_id: "production",
        name: "Production",
        description: "Normal production mode",
        is_default: true,
        kind: "production",
      },
      {
        mode_id: "maintenance",
        name: "Maintenance",
        description: "Service / maintenance mode",
        is_default: false,
        kind: "maintenance",
      },
    ]);
  });

  it("seeds exactly one default mode", () => {
    expect(seedDefaultModes().filter((m) => m.is_default)).toHaveLength(1);
  });
});
```

(Keep any other existing assertions in the file that still hold; delete ones asserting the old Auto/Maintenance/Manual triple.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts`
Expected: FAIL — still returns 3 modes led by Auto.

- [ ] **Step 3: Implement**

In `src/lib/spec-builder/wizard-machine-layer.ts`:

```ts
/**
 * G0-9 seed: Production (default) + Maintenance. Manual/engineering/custom
 * modes are added per-project by the engineer. Only applies to projects
 * with no stored modes — existing projects keep theirs.
 */
export function seedDefaultModes(): OperatorMode[] {
  return [
    {
      mode_id: "production",
      name: "Production",
      description: "Normal production mode",
      is_default: true,
      kind: "production",
    },
    {
      mode_id: "maintenance",
      name: "Maintenance",
      description: "Service / maintenance mode",
      is_default: false,
      kind: "maintenance",
    },
  ];
}
```

Also update the file's header comment (line 3: "seed Auto/Maintenance/Manual" → "seed Production/Maintenance") and the wizard comment at `spec-skeleton-wizard.tsx:97` ("seed Auto/Maintenance/Manual" → "seed Production/Maintenance (G0-9)").

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts` → PASS
Run: `npx tsc -b` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/wizard-machine-layer.ts src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts src/components/spec-builder/spec-skeleton-wizard.tsx
git commit -m "feat(spec-builder): seed Production+Maintenance modes with kinds (G0-9)"
```

---

### Task 8: Golden HRE-shaped fixture test

**Files:**
- Test: `src/lib/spec-builder/__tests__/unit-coordination-golden.test.ts` (create)

**Interfaces:**
- Consumes: everything produced in Tasks 1–5. No production code changes — this task proves the model expresses the hand-written HRE UC behavior (Production / Maintenance / SeqTest as production / maintenance / engineering kinds). The fixture is HRE-SHAPED but lives only in the test; all logic under test is generic.

- [ ] **Step 1: Write the test**

Create `src/lib/spec-builder/__tests__/unit-coordination-golden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  UnitCoordinationV1Schema,
  UNIT_PACKML_STATES,
} from "@/types/spec-contract-v2";
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";
import {
  emCommandForState,
  isModeChangeLegal,
  validateUnitCoordination,
} from "@/lib/spec-builder/unit-coordination";
import type { ModeChangeSpecView } from "@/lib/spec-builder/unit-coordination";

// HRE-shaped golden fixture (Segment Wagon–like machine). Fixture-only —
// the model under test is generic across machine types.
const EM_DRIVE = "11111111-1111-4111-8111-111111111111";
const EM_BRAKE = "22222222-2222-4222-8222-222222222222";

const MODES = [
  { mode_id: "production", name: "Production", is_default: true, kind: "production" as const },
  { mode_id: "maintenance", name: "Maintenance", is_default: false, kind: "maintenance" as const },
  { mode_id: "seq_test", name: "Sequence Test", is_default: false, kind: "engineering" as const },
];

const CARRIAGE_UNIT: UnitCoordinationV1 = UnitCoordinationV1Schema.parse({
  unit_id: "carriage_unit",
  states: [
    { state_id: "stopped", mode_change_allowed: true },
    { state_id: "resetting" },
    { state_id: "idle", mode_change_allowed: true },
    { state_id: "starting", allowed_modes: ["production"] },
    { state_id: "execute", allowed_modes: ["production"] },
    { state_id: "holding", allowed_modes: ["production"] },
    { state_id: "held", allowed_modes: ["production"] },
    { state_id: "unholding", allowed_modes: ["production"] },
    { state_id: "stopping" },
    { state_id: "aborting" },
    { state_id: "aborted", mode_change_allowed: true },
    { state_id: "clearing" },
  ],
  transitions: [
    { transition_id: "t_reset", from_state_id: "stopped", to_state_id: "resetting",
      trigger: { type: "command", command: "reset" } },
    { transition_id: "t_reset_done", from_state_id: "resetting", to_state_id: "idle",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    { transition_id: "t_start", from_state_id: "idle", to_state_id: "starting",
      trigger: { type: "command", command: "start" }, allowed_modes: ["production"] },
    { transition_id: "t_started", from_state_id: "starting", to_state_id: "execute",
      trigger: { type: "em_aggregate", em_scope: [EM_DRIVE], em_state: "driving" } },
    { transition_id: "t_hold", from_state_id: "execute", to_state_id: "holding",
      trigger: { type: "command", command: "hold" } },
    { transition_id: "t_held", from_state_id: "holding", to_state_id: "held",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    { transition_id: "t_unhold", from_state_id: "held", to_state_id: "unholding",
      trigger: { type: "command", command: "unhold" } },
    { transition_id: "t_unheld", from_state_id: "unholding", to_state_id: "execute",
      trigger: { type: "em_aggregate", em_scope: [EM_DRIVE], em_state: "driving" } },
    { transition_id: "t_stop", from_state_id: "execute", to_state_id: "stopping",
      trigger: { type: "command", command: "stop" } },
    { transition_id: "t_stopped", from_state_id: "stopping", to_state_id: "stopped",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    // Safety-gate violation maps to the aborting transition (design: no
    // duplication of the safety model — the gate condition drives this).
    { transition_id: "t_abort", from_state_id: "execute", to_state_id: "aborting",
      trigger: { type: "condition", expr: [{ tag: "SAFETY_OK", operator: "=", value: false }] } },
    { transition_id: "t_aborted", from_state_id: "aborting", to_state_id: "aborted",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
    { transition_id: "t_clear", from_state_id: "aborted", to_state_id: "clearing",
      trigger: { type: "command", command: "clear" } },
    { transition_id: "t_cleared", from_state_id: "clearing", to_state_id: "stopped",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "stopped" } },
  ],
  // Maintenance semantics: while held, keep the brake EM commanded to STOP
  // rather than HOLD (hand-written UC behavior).
  em_command_overrides: {
    held: [{ equipment_module_id: EM_BRAKE, command: "STOP" }],
  },
});

const SPEC: ModeChangeSpecView = {
  modes: MODES,
  unit_coordination: { carriage_unit: CARRIAGE_UNIT },
  equipment_modules: {
    [EM_DRIVE]: {
      unit_id: "carriage_unit",
      states: [
        { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "driving", name: "Driving", kind: "sequential", allowed_modes: ["production"], is_safe_state: false },
      ],
    },
    [EM_BRAKE]: {
      unit_id: "carriage_unit",
      states: [
        { state_id: "applied", name: "Applied", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "released", name: "Released", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
    },
  },
};

describe("G0-9 golden: HRE-shaped unit coordination", () => {
  it("parses and passes all structural validation", () => {
    const issues = validateUnitCoordination(CARRIAGE_UNIT, {
      modes: MODES,
      memberEmIds: new Set([EM_DRIVE, EM_BRAKE]),
    });
    expect(issues).toEqual([]);
  });

  it("every fixture state is canonical PackML", () => {
    for (const s of CARRIAGE_UNIT.states) {
      expect(UNIT_PACKML_STATES).toContain(s.state_id);
    }
  });

  it("canonical command map drives the EMs through a production cycle", () => {
    expect(emCommandForState(CARRIAGE_UNIT, "resetting", EM_DRIVE)).toBe("RESET");
    expect(emCommandForState(CARRIAGE_UNIT, "execute", EM_DRIVE)).toBe("START");
    expect(emCommandForState(CARRIAGE_UNIT, "stopping", EM_DRIVE)).toBe("STOP");
    expect(emCommandForState(CARRIAGE_UNIT, "aborting", EM_BRAKE)).toBe("ABORT");
    expect(emCommandForState(CARRIAGE_UNIT, "idle", EM_DRIVE)).toBe("NONE");
  });

  it("held-state brake override wins over the canonical HOLD", () => {
    expect(emCommandForState(CARRIAGE_UNIT, "held", EM_BRAKE)).toBe("STOP");
    expect(emCommandForState(CARRIAGE_UNIT, "held", EM_DRIVE)).toBe("HOLD");
  });

  it("mode change to maintenance is legal when stopped with EMs safe", () => {
    const v = isModeChangeLegal(SPEC, "carriage_unit", "maintenance", "stopped", {
      [EM_DRIVE]: "stopped",
      [EM_BRAKE]: "applied",
    });
    expect(v).toEqual({ legal: true, reasons: [] });
  });

  it("mode change is refused mid-execute (state gate + drive EM mask)", () => {
    const v = isModeChangeLegal(SPEC, "carriage_unit", "maintenance", "execute", {
      [EM_DRIVE]: "driving",
      [EM_BRAKE]: "released",
    });
    expect(v.legal).toBe(false);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("seq_test (engineering kind) behaves as a normal mode in the legality rule", () => {
    // engineering semantics (release command pins, no HMI exposure) are
    // writer-side (G2/G7); the schema/legality layer treats it uniformly.
    const v = isModeChangeLegal(SPEC, "carriage_unit", "seq_test", "idle", {
      [EM_DRIVE]: "stopped",
      [EM_BRAKE]: "applied",
    });
    expect(v.legal).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/lib/spec-builder/__tests__/unit-coordination-golden.test.ts`
Expected: PASS (Tasks 1–5 already shipped the behavior). If any case fails, the production code is wrong — fix it there, not in the fixture.

- [ ] **Step 3: Commit**

```bash
git add src/lib/spec-builder/__tests__/unit-coordination-golden.test.ts
git commit -m "test(spec-builder): HRE-shaped golden fixture for unit coordination (G0-9)"
```

---

### Task 9: Final verification + doc closeout

**Files:**
- Modify: `Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md` (status line only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 2: Full affected-suite run**

Run:
```bash
npx vitest run src/types/__tests__/spec-contract-v2.test.ts src/lib/spec-builder/__tests__/unit-coordination.test.ts src/lib/spec-builder/__tests__/unit-coordination-golden.test.ts src/lib/spec-builder/__tests__/contract-em-validation.test.ts src/lib/spec-builder/__tests__/contract.test.ts src/lib/spec-builder/__tests__/wizard-machine-layer.test.ts src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/sequence-legacy-shim.test.ts
```
Expected: all PASS.

- [ ] **Step 3: Generic check (CLAUDE.md Post-Task Self-Check)**

Confirm: no project-specific device/EM/mode names outside test fixtures; `unit-coordination.ts`, schema changes, and validators contain zero HRE references. Mentally re-test the model against a different machine type (e.g. a filling station with dosing + capping EMs: canonical map, masks, and legality rule all apply unchanged).

- [ ] **Step 4: Update the design doc status**

In `Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md` line 3, change `**Status:** DESIGN APPROVED (Kasper + Claude)` to `**Status:** IMPLEMENTED (schema wave — see plans/2026-07-08-g0-9-modes-cell-state-schema.md)`.

- [ ] **Step 5: Commit**

```bash
git add Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md
git commit -m "docs: mark G0-9 schema wave implemented"
```

(Monday board sync — G0-9 status/progress/update — is handled by the orchestrating session, not by task subagents.)
