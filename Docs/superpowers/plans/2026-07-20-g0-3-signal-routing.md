# G0-3 Signal Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This repo's recorded preference:** inline execution (executing-plans), no subagent dispatch.

**Goal:** Add `SignalRoutingV1` (routing rows, two-detent, safety-healthy term, command-routing policy, first-out flag) as an optional `signal_routing` key on `UnitCoordinationV1`, with a pure validator wired into the per-unit patch loop.

**Architecture:** Same additive pattern as G0-1/G0-2. New schemas before `UnitCoordinationV1Schema` (`src/types/spec-contract-v2.ts:1109`); validator module `src/lib/spec-builder/signal-routing.ts`; wiring in the existing `patch.unit_coordination` loop in `contract.ts` (~line 1267). No migration. Spec: `Docs/superpowers/specs/2026-07-20-g0-3-signal-routing-design.md`.

**Tech Stack:** TypeScript 5.9 strict, Zod v4, vitest.

## Global Constraints

- All new keys optional / array-defaulted — stored G0-9 contracts parse unchanged.
- EM references use `z.string().min(1)` (matching `UnitCoordinationV1.unit_id`'s convention), NOT `UuidSchema` — spec amended accordingly.
- No project-specific values outside test fixtures.
- No DB migration; never `db push`.
- Per task: failing test → verify → implement → verify → commit with `(G0-3)` suffix.
- Final gate: 4 suites + `npx tsc -b` clean.

---

### Task 1: Schemas — `SignalRoutingV1` + `signal_routing` on `UnitCoordinationV1`

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (insert before `UnitCoordinationV1Schema` line 1109; add key after `em_command_overrides` line 1119)
- Test: `src/types/__tests__/spec-contract-v2.test.ts`

**Interfaces:**
- Produces: `SignalSourceRefSchema`/`SignalSourceRef`, `RoutingTargetSchema`/`RoutingTarget`, `RoutingRowSchema`/`RoutingRow`, `TwoDetentSchema`/`TwoDetent`, `SafetyHealthySchema`/`SafetyHealthy`, `CommandRoutingPolicySchema`, `CommandRoutingSchema`/`CommandRouting`, `SignalRoutingV1Schema`/`SignalRoutingV1`; `UnitCoordinationV1.signal_routing?`.

- [ ] **Step 1: Write the failing tests** (append; add `SignalRoutingV1Schema` to the types-test import):

```ts
describe("SignalRoutingV1 (G0-3)", () => {
  const row = {
    row_id: "r1",
    target: { equipment_module_id: "em_drive", pin: "ilk_Fwd_Fast" },
    source: { kind: "io_tag", tag: "Fwd_Fast" },
    gates: [
      { kind: "named_gate", gate_id: "fwd_fast_ok" },
      { kind: "em_status", equipment_module_id: "em_ind", member: "permit_travel" },
    ],
  };

  it("parses a full routing model and applies defaults", () => {
    const parsed = SignalRoutingV1Schema.parse({
      safety_healthy: { gate_ids: ["estop"] },
      routing_rows: [row],
      two_detent: [{ jog_row_id: "r2", fast_row_id: "r1" }],
      command_routing: { policy: "walk_to_execute_stop_on_unhealthy" },
      first_out: { enabled: false },
    });
    expect(parsed.safety_healthy?.exclude_maintenance).toBe(true);
    expect(parsed.two_detent[0].fallback).toBe(true);
    expect(parsed.command_routing?.seq_test_release).toBe(true);
    expect(parsed.routing_rows[0].gates).toHaveLength(2);
  });

  it("defaults arrays and rejects unknown source kind", () => {
    const parsed = SignalRoutingV1Schema.parse({});
    expect(parsed.routing_rows).toEqual([]);
    expect(parsed.two_detent).toEqual([]);
    expect(() =>
      SignalRoutingV1Schema.parse({
        routing_rows: [{ ...row, source: { kind: "plc_tag", tag: "X" } }],
      }),
    ).toThrow();
  });

  it("UnitCoordinationV1 accepts optional signal_routing (back-compat)", () => {
    const coord = {
      unit_id: "u1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
    };
    expect(UnitCoordinationV1Schema.parse(coord).signal_routing).toBeUndefined();
    const withRouting = UnitCoordinationV1Schema.parse({
      ...coord,
      signal_routing: { routing_rows: [row] },
    });
    expect(withRouting.signal_routing?.routing_rows[0].row_id).toBe("r1");
  });

  it("rejects empty safety_healthy.gate_ids", () => {
    expect(() =>
      SignalRoutingV1Schema.parse({ safety_healthy: { gate_ids: [] } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Verify failure** — `npx vitest run src/types/__tests__/spec-contract-v2.test.ts` → FAIL (`SignalRoutingV1Schema` not exported).

- [ ] **Step 3: Implement** — insert before `UnitCoordinationV1Schema` (full schema block from spec §2, with `z.string().min(1)` for EM refs):

```ts
// ============================================================
// Signal-routing intent (G0-3) — the unit coordinator's other half.
// Declarative model of UC_*.scl: routing rows, two-detent, safety-healthy
// term, PackML command routing, first-out capture. EM↔EM handshakes and
// product tracking are G0-3b.
// Design: Docs/superpowers/specs/2026-07-20-g0-3-signal-routing-design.md
// ============================================================

// Discriminated source reference for routing rows and gates.
//  io_tag     — conditioned physical/dashboard input (IO_Cond layer)
//  em_status  — one-way read of a member EM's status DB member (ISA-88
//               §5.4: EMs never talk directly; the UC routes)
//  named_gate — computed gate defined elsewhere (G0-4 envelope gates like
//               fwd_fast_ok / rot_at_home). Reference-only seam until G0-4
//               ships the registry; no existence check yet.
export const SignalSourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("io_tag"), tag: z.string().min(1) }),
  z.object({
    kind: z.literal("em_status"),
    equipment_module_id: z.string().min(1),
    member: z.string().min(1), // e.g. "permit_travel"
  }),
  z.object({ kind: z.literal("named_gate"), gate_id: z.string().min(1) }),
]);
export type SignalSourceRef = z.infer<typeof SignalSourceRefSchema>;

export const RoutingTargetSchema = z.object({
  equipment_module_id: z.string().min(1),
  pin: z.string().min(1), // e.g. "ilk_Fwd_Fast_Carriage"
});
export type RoutingTarget = z.infer<typeof RoutingTargetSchema>;

// One `target.pin := source AND gates...` row.
export const RoutingRowSchema = z.object({
  row_id: z.string().min(1),
  target: RoutingTargetSchema,
  source: SignalSourceRefSchema,
  gates: z.array(SignalSourceRefSchema).default([]),
  description: z.string().optional(),
});
export type RoutingRow = z.infer<typeof RoutingRowSchema>;

// Declared two-detent relationship: fast wins; a fast request that fails
// its gates falls back to the jog row (fallback=true). The writer emits
// the suppression pattern from this — never hand-authored.
export const TwoDetentSchema = z.object({
  jog_row_id: z.string().min(1),
  fast_row_id: z.string().min(1),
  fallback: z.boolean().default(true),
});
export type TwoDetent = z.infer<typeof TwoDetentSchema>;

// The `#ok` aggregation term: AND of the referenced safety-gate outputs,
// optionally excluding maintenance mode. References the existing
// safety_gates model — deterministic, no free expressions.
export const SafetyHealthySchema = z.object({
  gate_ids: z.array(z.string().min(1)).min(1), // SafetyGateV2.gate_id refs
  exclude_maintenance: z.boolean().default(true),
});
export type SafetyHealthy = z.infer<typeof SafetyHealthySchema>;

// v1 ships the single canonical policy the golden master runs: while
// safety-healthy, walk all member EMs to Execute; on unhealthy, STOP.
// seq_test_release skips command routing in seq-test mode.
export const CommandRoutingPolicySchema = z.enum([
  "walk_to_execute_stop_on_unhealthy",
]);
export const CommandRoutingSchema = z.object({
  policy: CommandRoutingPolicySchema,
  seq_test_release: z.boolean().default(true),
});
export type CommandRouting = z.infer<typeof CommandRoutingSchema>;

export const SignalRoutingV1Schema = z.object({
  safety_healthy: SafetyHealthySchema.optional(),
  routing_rows: z.array(RoutingRowSchema).default([]),
  two_detent: z.array(TwoDetentSchema).default([]),
  command_routing: CommandRoutingSchema.optional(),
  // First-out fault capture — writer emits first-trip latch logic.
  first_out: z.object({ enabled: z.boolean() }).optional(),
});
export type SignalRoutingV1 = z.infer<typeof SignalRoutingV1Schema>;
```

Add inside `UnitCoordinationV1Schema` after `em_command_overrides`:

```ts
  // G0-3: the routing layer. Absent until authored.
  signal_routing: SignalRoutingV1Schema.optional(),
```

- [ ] **Step 4: Verify pass** — same suite → PASS.
- [ ] **Step 5: Commit** — `feat(spec-contract): SignalRoutingV1 on UnitCoordinationV1 (G0-3)`

---

### Task 2: Validator — `validateSignalRouting`

**Files:**
- Create: `src/lib/spec-builder/signal-routing.ts`
- Test: `src/lib/spec-builder/__tests__/signal-routing.test.ts` (new)

**Interfaces:**
- Produces: `validateSignalRouting(coord: Pick<UnitCoordinationV1, "unit_id" | "signal_routing">, ctx: { memberEmIds?: Set<string>; safetyGateIds?: Set<string> }): string[]`. Task 3 consumes it.

- [ ] **Step 1: Failing tests** — create the test file:

```ts
import { describe, expect, it } from "vitest";
import { validateSignalRouting } from "@/lib/spec-builder/signal-routing";
import type { SignalRoutingV1 } from "@/types/spec-contract-v2";

function coord(signal_routing: SignalRoutingV1) {
  return { unit_id: "u1", signal_routing };
}

const row = (id: string, em: string, pin: string): SignalRoutingV1["routing_rows"][number] => ({
  row_id: id,
  target: { equipment_module_id: em, pin },
  source: { kind: "io_tag", tag: `${pin}_src` },
  gates: [],
});

const ems = new Set(["em_drive", "em_ind"]);

describe("validateSignalRouting", () => {
  it("clean pass with full context", () => {
    const issues = validateSignalRouting(
      coord({
        safety_healthy: { gate_ids: ["estop"], exclude_maintenance: true },
        routing_rows: [row("r1", "em_drive", "ilk_Fwd"), row("r2", "em_drive", "ilk_Fwd_Fast")],
        two_detent: [{ jog_row_id: "r1", fast_row_id: "r2", fallback: true }],
        command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
        first_out: { enabled: false },
      }),
      { memberEmIds: ems, safetyGateIds: new Set(["estop"]) },
    );
    expect(issues).toEqual([]);
  });

  it("errors on duplicate row_id and duplicate target pin", () => {
    const issues = validateSignalRouting(
      coord({
        routing_rows: [row("r1", "em_drive", "ilk_X"), row("r1", "em_drive", "ilk_X")],
        two_detent: [],
      } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("duplicate row_id"))).toBe(true);
    expect(issues.some((i) => i.includes("duplicate target"))).toBe(true);
  });

  it("errors on target EM outside the unit (with context)", () => {
    const issues = validateSignalRouting(
      coord({ routing_rows: [row("r1", "em_foreign", "ilk_X")], two_detent: [] } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("em_foreign"))).toBe(true);
  });

  it("errors on em_status source outside the unit (with context)", () => {
    const r = row("r1", "em_drive", "ilk_X");
    r.source = { kind: "em_status", equipment_module_id: "em_other_unit", member: "m" };
    const issues = validateSignalRouting(
      coord({ routing_rows: [r], two_detent: [] } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("em_other_unit"))).toBe(true);
  });

  it("skips membership checks without context", () => {
    const issues = validateSignalRouting(
      coord({ routing_rows: [row("r1", "em_foreign", "ilk_X")], two_detent: [] } as never),
      {},
    );
    expect(issues).toEqual([]);
  });

  it("errors on unresolvable and self-referential two_detent", () => {
    const issues = validateSignalRouting(
      coord({
        routing_rows: [row("r1", "em_drive", "ilk_X")],
        two_detent: [
          { jog_row_id: "r1", fast_row_id: "r1", fallback: true },
          { jog_row_id: "missing", fast_row_id: "r1", fallback: true },
        ],
      } as never),
      { memberEmIds: ems },
    );
    expect(issues.some((i) => i.includes("same row"))).toBe(true);
    expect(issues.some((i) => i.includes("missing"))).toBe(true);
  });

  it("errors on unknown safety gate ids (with context), skips without", () => {
    const sr = {
      safety_healthy: { gate_ids: ["ghost"], exclude_maintenance: true },
      routing_rows: [],
      two_detent: [],
    } as never;
    expect(
      validateSignalRouting(coord(sr), { safetyGateIds: new Set(["estop"]) }).some(
        (i) => i.includes("ghost"),
      ),
    ).toBe(true);
    expect(validateSignalRouting(coord(sr), {})).toEqual([]);
  });

  it("no signal_routing → no issues", () => {
    expect(validateSignalRouting({ unit_id: "u1" } as never, {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure** — module unresolved.
- [ ] **Step 3: Implement** `src/lib/spec-builder/signal-routing.ts`:

```ts
/**
 * G0-3 signal-routing semantics — pure helpers, no React/IO.
 * Context-dependent checks skip when their context is absent (same
 * convention as validateUnitCoordination). named_gate existence is
 * intentionally unchecked until G0-4 ships the gate registry.
 * Design: Docs/superpowers/specs/2026-07-20-g0-3-signal-routing-design.md
 */
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";

export function validateSignalRouting(
  coord: Pick<UnitCoordinationV1, "unit_id" | "signal_routing">,
  ctx: { memberEmIds?: Set<string>; safetyGateIds?: Set<string> },
): string[] {
  const sr = coord.signal_routing;
  if (!sr) return [];
  const issues: string[] = [];
  const where = `unit_coordination[${coord.unit_id}].signal_routing`;

  const rowIds = new Set<string>();
  const targets = new Set<string>();
  for (const row of sr.routing_rows) {
    if (rowIds.has(row.row_id)) {
      issues.push(`${where}: duplicate row_id "${row.row_id}"`);
    }
    rowIds.add(row.row_id);

    const targetKey = `${row.target.equipment_module_id}::${row.target.pin}`;
    if (targets.has(targetKey)) {
      issues.push(
        `${where}: duplicate target ${row.target.pin} on EM ${row.target.equipment_module_id} — one row per pin`,
      );
    }
    targets.add(targetKey);

    if (ctx.memberEmIds && !ctx.memberEmIds.has(row.target.equipment_module_id)) {
      issues.push(
        `${where}[${row.row_id}]: target EM ${row.target.equipment_module_id} is not a member of this unit`,
      );
    }
    if (ctx.memberEmIds) {
      for (const ref of [row.source, ...row.gates]) {
        if (ref.kind === "em_status" && !ctx.memberEmIds.has(ref.equipment_module_id)) {
          issues.push(
            `${where}[${row.row_id}]: em_status source ${ref.equipment_module_id} is not a member of this unit (cross-unit reads are v2)`,
          );
        }
      }
    }
  }

  for (const td of sr.two_detent) {
    if (td.jog_row_id === td.fast_row_id) {
      issues.push(
        `${where}: two_detent references the same row for jog and fast ("${td.jog_row_id}")`,
      );
    }
    for (const id of [td.jog_row_id, td.fast_row_id]) {
      if (!rowIds.has(id)) {
        issues.push(`${where}: two_detent references unknown row "${id}"`);
      }
    }
  }

  if (sr.safety_healthy && ctx.safetyGateIds) {
    for (const gid of sr.safety_healthy.gate_ids) {
      if (!ctx.safetyGateIds.has(gid)) {
        issues.push(`${where}: safety_healthy references unknown safety gate "${gid}"`);
      }
    }
  }

  return issues;
}
```

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `feat(spec-builder): validateSignalRouting — routing invariants (G0-3)`

---

### Task 3: Patch wiring

**Files:**
- Modify: `src/lib/spec-builder/contract.ts` — the `patch.unit_coordination` per-unit loop (~line 1267)
- Test: `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Failing test** (new describe; imports already in place):

```ts
describe("validateSpecContractPatch — signal routing (G0-3)", () => {
  it("rejects a unit_coordination patch with a duplicate target pin", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          signal_routing: {
            routing_rows: [
              {
                row_id: "r1",
                target: { equipment_module_id: "em1", pin: "ilk_X" },
                source: { kind: "io_tag", tag: "A" },
              },
              {
                row_id: "r2",
                target: { equipment_module_id: "em1", pin: "ilk_X" },
                source: { kind: "io_tag", tag: "B" },
              },
            ],
          },
        },
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("duplicate target")),
    ).toBe(true);
  });

  it("cross-checks safety gates when the patch carries them", () => {
    const patch = SpecContractPatchSchema.parse({
      safety_gates: [
        {
          gate_id: "estop",
          name: "E-Stop",
          condition: [{ tag: "EStop_Healthy", operator: "=", value: true }],
          scope: "machine",
        },
      ],
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          signal_routing: { safety_healthy: { gate_ids: ["ghost"] } },
        },
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("ghost")),
    ).toBe(true);
  });
});
```

(If `SafetyGateV2Schema`'s `condition`/`scope` shapes differ from the guess above, read the schema and fix the fixture — the assertion is what matters.)

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — in the `patch.unit_coordination` loop, after the `validateUnitCoordination` push:

```ts
      issues.push(
        ...validateSignalRouting(coord, {
          memberEmIds,
          safetyGateIds: patch.safety_gates
            ? new Set(patch.safety_gates.map((g) => g.gate_id))
            : undefined,
        }),
      );
```

Import `validateSignalRouting` from `@/lib/spec-builder/signal-routing`.
(`memberEmIds` is already computed in the loop; it stays `undefined` without hierarchy — context-absent convention holds.)

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `feat(spec-builder): signal-routing patch gate (G0-3)`

---

### Task 4: Golden fixture + verification + tracker/board sync

**Files:**
- Test: `src/types/__tests__/spec-contract-v2.test.ts`
- Modify: roadmap md + tasks.json (G0-3 → DONE)

- [ ] **Step 1: Golden fixture** — the HRE Carriage routing table (values in tests ONLY; import `validateSignalRouting` in the types test):

```ts
describe("G0-3 golden fixture — HRE Carriage unit routing", () => {
  it("expresses the UC_Carriage.scl routing table", () => {
    const gate = (gate_id: string) => ({ kind: "named_gate" as const, gate_id });
    const permit = {
      kind: "em_status" as const,
      equipment_module_id: "em_travel_ind",
      member: "permit_travel",
    };
    const io = (tag: string) => ({ kind: "io_tag" as const, tag });
    const routing = SignalRoutingV1Schema.parse({
      safety_healthy: { gate_ids: ["estop_healthy", "sr1_healthy"] },
      routing_rows: [
        { row_id: "fwd_fast", target: { equipment_module_id: "em_drive", pin: "ilk_Fwd_Fast_Carriage" }, source: io("Fwd_Fast_Carriage"), gates: [gate("rot_at_home"), gate("fwd_fast_ok"), permit] },
        { row_id: "fwd", target: { equipment_module_id: "em_drive", pin: "ilk_Fwd_Carriage" }, source: io("Fwd_Carriage"), gates: [gate("fwd_ok"), permit] },
        { row_id: "rev_fast", target: { equipment_module_id: "em_drive", pin: "ilk_Rev_Fast_Carriage" }, source: io("Rev_Fast_Carriage"), gates: [gate("rot_at_home"), gate("rev_fast_ok"), permit] },
        { row_id: "rev", target: { equipment_module_id: "em_drive", pin: "ilk_Rev_Carriage" }, source: io("Rev_Carriage"), gates: [gate("rev_ok"), permit] },
        { row_id: "limit_drive", target: { equipment_module_id: "em_drive", pin: "ilk_Long_Limit_Stop" }, source: io("Long_Limit_Stop") },
        { row_id: "limit_lim", target: { equipment_module_id: "em_limits", pin: "ilk_CM_Sensor_LS1" }, source: io("Long_Limit_Stop") },
      ],
      two_detent: [
        { jog_row_id: "fwd", fast_row_id: "fwd_fast" },
        { jog_row_id: "rev", fast_row_id: "rev_fast" },
      ],
      command_routing: { policy: "walk_to_execute_stop_on_unhealthy" },
      first_out: { enabled: false },
    });
    const issues = validateSignalRouting(
      { unit_id: "carriage", signal_routing: routing },
      {
        memberEmIds: new Set(["em_drive", "em_limits", "em_travel_ind", "em_brake", "em_pendant"]),
        safetyGateIds: new Set(["estop_healthy", "sr1_healthy"]),
      },
    );
    expect(issues).toEqual([]);
    // Long_Limit_Stop legitimately fans to two different EM pins
    expect(routing.routing_rows.filter((r) => r.source.kind === "io_tag" && r.source.tag === "Long_Limit_Stop")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run 4 suites + `npx tsc -b`** — all green.
- [ ] **Step 3: Genericity grep** — `Fwd_Fast_Carriage|Long_Limit_Stop|permit_travel` in `src` hits tests only (plus any pre-existing prompt examples — note, don't touch).
- [ ] **Step 4: Trackers** — G0-3 → ✅ / DONE with commit range; spec placement note already there.
- [ ] **Step 5: Commit** — `test(spec-builder): HRE routing golden fixture + tracker G0-3 DONE (G0-3)`
- [ ] **Step 6: Monday** — G0-3 → Done + closeout update; timeline end today.

---

## Self-Review Notes

- Spec §2 → Task 1; §3 → Tasks 2–3; §5 fixtures → per-task + Task 4. No migration per §4 — nothing to cover.
- EM refs as plain strings (constraint) — spec amended in the same commit as this plan.
- Task 3 fixture guesses `SafetyGateV2.condition` shape — step instructs to verify against the schema before running.
