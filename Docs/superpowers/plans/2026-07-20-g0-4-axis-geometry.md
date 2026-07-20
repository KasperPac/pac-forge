# G0-4 Axis Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This repo's recorded preference:** inline execution (executing-plans), no subagent dispatch.

**Goal:** Add `AxisV1` (linear/rotary envelope geometry with fixed semantic roles) to `UnitCoordinationV1`, `axis_constants` to `EngineeringDataV1`, a pure `validateAxes` validator, and activate G0-3's deferred `named_gate` existence check.

**Architecture:** Same additive pattern as G0-1..G0-3. Schemas before `UnitCoordinationV1Schema`; validator `src/lib/spec-builder/axis-model.ts`; `validateSignalRouting` ctx gains `namedGateIds`; patch-gate cross-check for `axis_constants`. No migration. Spec: `Docs/superpowers/specs/2026-07-20-g0-4-axis-geometry-design.md`.

**Tech Stack:** TypeScript 5.9 strict, Zod v4, vitest.

## Global Constraints

- All new keys optional/defaulted — stored contracts parse unchanged.
- Plain-string ids (host-construct convention). No project-specific values outside fixtures.
- No DB migration; never `db push`.
- Red → green → commit per task, `(G0-4)` suffix; final gate 6 suites + `npx tsc -b`.

---

### Task 1: Schemas — `AxisV1` + `axes` + `engineering.axis_constants`

**Files:**
- Modify: `src/types/spec-contract-v2.ts` (axis block before the G0-3 signal-routing section; `axes` key after `signal_routing` in `UnitCoordinationV1Schema`; `AxisConstantEntrySchema` before `EngineeringDataV1Schema` + key inside it)
- Test: `src/types/__tests__/spec-contract-v2.test.ts`

**Interfaces:**
- Produces: `GeometryParamDefSchema`/`GeometryParamDef`, `LinearAxisGatesSchema`, `LinearAxisSchema`/`LinearAxis`, `HomeWindowSchema`/`HomeWindow`, `RotaryAxisSchema`/`RotaryAxis`, `AxisV1Schema`/`AxisV1`, `AxisConstantEntrySchema`/`AxisConstantEntry`; `UnitCoordinationV1.axes?`, `EngineeringDataV1.axis_constants` (default []).

- [ ] **Step 1: Failing tests** (append; add `AxisV1Schema` to the types-test import):

```ts
describe("AxisV1 + axis_constants (G0-4)", () => {
  const rail = {
    axis_id: "rail",
    kind: "linear",
    encoder_tag: "Carriage_Encoder_Pos",
    eu_unit: "mm",
    scale: { db_member: "mm_per_rev_x10" },
    length: { db_member: "rail_length_mm", operator_settable: true },
    end_margin: { db_member: "end_margin_mm", default: 500 },
    ramp_zone: { db_member: "ramp_zone_mm", default: 2000 },
    gates: { fwd_ok: "fwd_ok", fwd_fast_ok: "fwd_fast_ok" },
  };
  const rotator = {
    axis_id: "rotator",
    kind: "rotary",
    encoder_tag: "Rotator_Encoder_Pos",
    counts_per_rev: { db_member: "rot_counts_per_360", default: 0 },
    preset_offset: 500000,
    home_windows: [
      { center_deg10: 0, band_deg10: 20 },
      { center_deg10: 1800, band_deg10: 20 },
    ],
    gates: { at_home: "rot_at_home" },
  };

  it("parses linear + rotary axes with defaults", () => {
    const lin = AxisV1Schema.parse(rail);
    expect(lin.kind).toBe("linear");
    if (lin.kind === "linear") {
      expect(lin.scale.retain).toBe(true);
      expect(lin.scale.operator_settable).toBe(false);
      expect(lin.unconfigured_open).toBe(true);
    }
    const rot = AxisV1Schema.parse(rotator);
    if (rot.kind === "rotary") {
      expect(rot.home_windows).toHaveLength(2);
      expect(rot.preset_offset).toBe(500000);
    }
  });

  it("rejects unknown axis kind and empty home_windows", () => {
    expect(() => AxisV1Schema.parse({ ...rail, kind: "belt" })).toThrow();
    expect(() =>
      AxisV1Schema.parse({ ...rotator, home_windows: [] }),
    ).toThrow();
  });

  it("UnitCoordinationV1 accepts optional axes (back-compat)", () => {
    const coord = {
      unit_id: "u1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
    };
    expect(UnitCoordinationV1Schema.parse(coord).axes).toBeUndefined();
    expect(
      UnitCoordinationV1Schema.parse({ ...coord, axes: [rail] }).axes,
    ).toHaveLength(1);
  });

  it("EngineeringDataV1 carries axis_constants with empty default", () => {
    expect(EngineeringDataV1Schema.parse({}).axis_constants).toEqual([]);
    const parsed = EngineeringDataV1Schema.parse({
      axis_constants: [
        { unit_id: "u1", axis_id: "rotator", values: { rot_counts_per_360: 40960 } },
      ],
    });
    expect(parsed.axis_constants[0].values.rot_counts_per_360).toBe(40960);
  });
});
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — insert directly before the G0-3 signal-routing divider comment:

```ts
// ============================================================
// Envelope geometry & scaling (G0-4) — per-unit axes with fixed
// semantic roles (evidenced by UC_Carriage.scl + Rail_Config.db).
// Gate ids defined here are the registry G0-3 named_gate refs resolve
// against. Scaling math / gate logic / config-DB emission are derived
// (G2-5 writer). Generic zones[] is v2 if a pilot machine needs it.
// Design: Docs/superpowers/specs/2026-07-20-g0-4-axis-geometry-design.md
// ============================================================

// One emitted config-DB member: name, seed default, retention, who sets
// it. The runtime VALUE lives in the PLC (operator/commissioning); the
// commissioned constant is recorded tier-2 (engineering.axis_constants).
export const GeometryParamDefSchema = z.object({
  db_member: z.string().min(1), // e.g. "rail_length_mm"
  default: z.number().optional(), // seed in the DB begin-block
  retain: z.boolean().default(true),
  operator_settable: z.boolean().default(false), // dashboard/HMI-writable
  description: z.string().optional(),
});
export type GeometryParamDef = z.infer<typeof GeometryParamDefSchema>;

// Role-named gate ids this axis defines (the G0-3 named_gate registry).
// Absent role = axis doesn't expose that gate.
export const LinearAxisGatesSchema = z.object({
  fwd_ok: z.string().min(1).optional(),
  fwd_fast_ok: z.string().min(1).optional(),
  rev_ok: z.string().min(1).optional(),
  rev_fast_ok: z.string().min(1).optional(),
});

export const LinearAxisSchema = z.object({
  axis_id: z.string().min(1),
  kind: z.literal("linear"),
  encoder_tag: z.string().min(1),
  eu_unit: z.string().min(1), // "mm"
  scale: GeometryParamDefSchema, // EU-per-rev ×10 (fixed physics, set once)
  length: GeometryParamDefSchema, // envelope length — may GROW in service
  end_margin: GeometryParamDefSchema, // soft limit; hard limit stays wired
  ramp_zone: GeometryParamDefSchema, // fast→jog fallback distance from ends
  gates: LinearAxisGatesSchema.default({}),
  // Evidenced policy: scale/length = 0 ⇒ gates stay open (pre-commissioning).
  unconfigured_open: z.boolean().default(true),
});
export type LinearAxis = z.infer<typeof LinearAxisSchema>;

export const HomeWindowSchema = z.object({
  center_deg10: z.number().int().min(-1799).max(1800),
  band_deg10: z.number().int().positive(), // ± band; ≤1800 enforced in validator
});
export type HomeWindow = z.infer<typeof HomeWindowSchema>;

export const RotaryAxisSchema = z.object({
  axis_id: z.string().min(1),
  kind: z.literal("rotary"),
  encoder_tag: z.string().min(1),
  // Calibration constant K (counts per 360°). default 0 = uncalibrated ⇒
  // raw treated as direct 0.1° (legacy direct-mount).
  counts_per_rev: GeometryParamDefSchema,
  // Raw preset applied at "straight" so the unsigned encoder never
  // underflows. Writer subtracts it before scaling.
  preset_offset: z.number().int().nonnegative().default(0),
  // Multi-window covers "straight at 0° OR 180°".
  home_windows: z.array(HomeWindowSchema).min(1),
  gates: z.object({ at_home: z.string().min(1).optional() }).default({}),
});
export type RotaryAxis = z.infer<typeof RotaryAxisSchema>;

export const AxisV1Schema = z.discriminatedUnion("kind", [
  LinearAxisSchema,
  RotaryAxisSchema,
]);
export type AxisV1 = z.infer<typeof AxisV1Schema>;
```

Inside `UnitCoordinationV1Schema` after `signal_routing`:

```ts
  // G0-4: envelope geometry. Absent until authored.
  axes: z.array(AxisV1Schema).optional(),
```

Before `EngineeringDataV1Schema`:

```ts
// Commissioned axis constants (G0-4 tier 2): db_member → measured value
// (e.g. rot_counts_per_360 after on-site calibration). Keys must be
// members the axis declares — cross-checked in the patch gate.
export const AxisConstantEntrySchema = z.object({
  unit_id: z.string().min(1),
  axis_id: z.string().min(1),
  values: z.record(z.string(), z.number()),
  notes: z.string().optional(),
});
export type AxisConstantEntry = z.infer<typeof AxisConstantEntrySchema>;
```

Inside `EngineeringDataV1Schema` after `io_conditioning_defaults`:

```ts
  axis_constants: z.array(AxisConstantEntrySchema).default([]),
```

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `feat(spec-contract): AxisV1 geometry on UnitCoordinationV1 + axis_constants (G0-4)`

---

### Task 2: Validator — `validateAxes`

**Files:**
- Create: `src/lib/spec-builder/axis-model.ts`
- Test: `src/lib/spec-builder/__tests__/axis-model.test.ts` (new)

**Interfaces:**
- Produces: `validateAxes(coord: Pick<UnitCoordinationV1, "unit_id" | "axes">): string[]`; `collectGateIds(axes: AxisV1[]): Set<string>` (Task 3 uses it to build `namedGateIds`).

- [ ] **Step 1: Failing tests:**

```ts
import { describe, expect, it } from "vitest";
import { collectGateIds, validateAxes } from "@/lib/spec-builder/axis-model";
import type { AxisV1 } from "@/types/spec-contract-v2";

const rail: AxisV1 = {
  axis_id: "rail",
  kind: "linear",
  encoder_tag: "Enc1",
  eu_unit: "mm",
  scale: { db_member: "scale", retain: true, operator_settable: false },
  length: { db_member: "length", retain: true, operator_settable: true },
  end_margin: { db_member: "end_margin", retain: true, operator_settable: false },
  ramp_zone: { db_member: "ramp_zone", retain: true, operator_settable: false },
  gates: { fwd_ok: "fwd_ok", rev_ok: "rev_ok" },
  unconfigured_open: true,
};
const rotator: AxisV1 = {
  axis_id: "rot",
  kind: "rotary",
  encoder_tag: "Enc2",
  counts_per_rev: { db_member: "k", retain: true, operator_settable: false },
  preset_offset: 0,
  home_windows: [{ center_deg10: 0, band_deg10: 20 }],
  gates: { at_home: "at_home" },
};

describe("validateAxes", () => {
  it("clean pass + collectGateIds", () => {
    expect(validateAxes({ unit_id: "u1", axes: [rail, rotator] })).toEqual([]);
    expect(collectGateIds([rail, rotator])).toEqual(
      new Set(["fwd_ok", "rev_ok", "at_home"]),
    );
  });

  it("errors on duplicate axis_id", () => {
    const issues = validateAxes({ unit_id: "u1", axes: [rail, { ...rail }] });
    expect(issues.some((i) => i.includes("duplicate axis_id"))).toBe(true);
  });

  it("errors on duplicate gate id across axes", () => {
    const rot2: AxisV1 = { ...rotator, gates: { at_home: "fwd_ok" } };
    const issues = validateAxes({ unit_id: "u1", axes: [rail, rot2] });
    expect(issues.some((i) => i.includes("gate"))).toBe(true);
  });

  it("errors on duplicate db_member within an axis", () => {
    const bad: AxisV1 = {
      ...rail,
      length: { db_member: "scale", retain: true, operator_settable: false },
    };
    expect(
      validateAxes({ unit_id: "u1", axes: [bad] }).some((i) =>
        i.includes("db_member"),
      ),
    ).toBe(true);
  });

  it("errors on band_deg10 > 1800", () => {
    const wide: AxisV1 = {
      ...rotator,
      home_windows: [{ center_deg10: 0, band_deg10: 1801 }],
    };
    expect(
      validateAxes({ unit_id: "u1", axes: [wide] }).some((i) =>
        i.includes("band"),
      ),
    ).toBe(true);
  });

  it("no axes → no issues", () => {
    expect(validateAxes({ unit_id: "u1" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** `axis-model.ts`:

```ts
/**
 * G0-4 axis-geometry semantics — pure helpers, no React/IO.
 * Gate ids collected here form the named_gate registry consumed by
 * validateSignalRouting (G0-3 seam activation).
 * Design: Docs/superpowers/specs/2026-07-20-g0-4-axis-geometry-design.md
 */
import type { AxisV1, GeometryParamDef, UnitCoordinationV1 } from "@/types/spec-contract-v2";

function paramDefs(axis: AxisV1): GeometryParamDef[] {
  return axis.kind === "linear"
    ? [axis.scale, axis.length, axis.end_margin, axis.ramp_zone]
    : [axis.counts_per_rev];
}

function gateIds(axis: AxisV1): string[] {
  return Object.values(axis.gates).filter(
    (g): g is string => typeof g === "string",
  );
}

/** All gate ids a unit's axes define — the unit's named_gate registry. */
export function collectGateIds(axes: AxisV1[]): Set<string> {
  return new Set(axes.flatMap(gateIds));
}

export function validateAxes(
  coord: Pick<UnitCoordinationV1, "unit_id" | "axes">,
): string[] {
  const axes = coord.axes;
  if (!axes) return [];
  const issues: string[] = [];
  const where = `unit_coordination[${coord.unit_id}].axes`;

  const axisIds = new Set<string>();
  const seenGates = new Set<string>();
  for (const axis of axes) {
    if (axisIds.has(axis.axis_id)) {
      issues.push(`${where}: duplicate axis_id "${axis.axis_id}"`);
    }
    axisIds.add(axis.axis_id);

    const members = new Set<string>();
    for (const p of paramDefs(axis)) {
      if (members.has(p.db_member)) {
        issues.push(
          `${where}[${axis.axis_id}]: duplicate db_member "${p.db_member}"`,
        );
      }
      members.add(p.db_member);
    }

    for (const gid of gateIds(axis)) {
      if (seenGates.has(gid)) {
        issues.push(`${where}: gate "${gid}" defined by more than one axis`);
      }
      seenGates.add(gid);
    }

    if (axis.kind === "rotary") {
      for (const w of axis.home_windows) {
        if (w.band_deg10 > 1800) {
          issues.push(
            `${where}[${axis.axis_id}]: home window band ${w.band_deg10} exceeds 1800 (±180°)`,
          );
        }
      }
    }
  }

  return issues;
}
```

- [ ] **Step 4: Verify pass.**
- [ ] **Step 5: Commit** — `feat(spec-builder): validateAxes + gate registry collection (G0-4)`

---

### Task 3: Wiring — named-gate activation + `axis_constants` cross-check

**Files:**
- Modify: `src/lib/spec-builder/signal-routing.ts` (ctx gains `namedGateIds`), `src/lib/spec-builder/contract.ts` (per-unit loop: `validateAxes`, build registry, pass to `validateSignalRouting`; `axis_constants` cross-check)
- Test: `src/lib/spec-builder/__tests__/signal-routing.test.ts`, `src/lib/spec-builder/__tests__/contract.test.ts`

- [ ] **Step 1: Failing tests.** In `signal-routing.test.ts` append:

```ts
describe("validateSignalRouting — named_gate registry (G0-4 activation)", () => {
  const rowWithGate: SignalRoutingV1["routing_rows"][number] = {
    row_id: "r1",
    target: { equipment_module_id: "em_drive", pin: "ilk_X" },
    source: { kind: "io_tag", tag: "A" },
    gates: [{ kind: "named_gate", gate_id: "ghost_gate" }],
  };

  it("errors on unknown named_gate when registry provided", () => {
    const issues = validateSignalRouting(
      coord({ routing_rows: [rowWithGate], two_detent: [] } as never),
      { memberEmIds: ems, namedGateIds: new Set(["fwd_ok"]) },
    );
    expect(issues.some((i) => i.includes("ghost_gate"))).toBe(true);
  });

  it("skips named_gate check without registry (pre-G0-4 behavior)", () => {
    const issues = validateSignalRouting(
      coord({ routing_rows: [rowWithGate], two_detent: [] } as never),
      { memberEmIds: ems },
    );
    expect(issues).toEqual([]);
  });
});
```

In `contract.test.ts` append:

```ts
describe("validateSpecContractPatch — axes + constants (G0-4)", () => {
  const coordWithAxis = {
    unit_id: "u1",
    states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
    transitions: [],
    axes: [
      {
        axis_id: "rail",
        kind: "linear",
        encoder_tag: "Enc1",
        eu_unit: "mm",
        scale: { db_member: "scale" },
        length: { db_member: "length" },
        end_margin: { db_member: "end_margin" },
        ramp_zone: { db_member: "ramp_zone" },
        gates: { fwd_ok: "fwd_ok" },
      },
    ],
  };

  it("rejects a named_gate ref not defined by the unit's axes", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          ...coordWithAxis,
          signal_routing: {
            routing_rows: [
              {
                row_id: "r1",
                target: { equipment_module_id: "em1", pin: "ilk_X" },
                source: { kind: "io_tag", tag: "A" },
                gates: [{ kind: "named_gate", gate_id: "ghost_gate" }],
              },
            ],
          },
        },
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("ghost_gate")),
    ).toBe(true);
  });

  it("rejects axis_constants for unknown axis or undeclared member", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: { u1: coordWithAxis },
      engineering: {
        axis_constants: [
          { unit_id: "u1", axis_id: "ghost_axis", values: { scale: 1 } },
          { unit_id: "u1", axis_id: "rail", values: { not_a_member: 5 } },
        ],
      },
    });
    const issues = validateSpecContractPatch(patch);
    expect(issues.some((i) => i.includes("ghost_axis"))).toBe(true);
    expect(issues.some((i) => i.includes("not_a_member"))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.**

(a) `signal-routing.ts` — ctx type gains `namedGateIds?: Set<string>`; inside the per-row ref loop (make the loop unconditional, keeping the member check gated):

```ts
      for (const ref of [row.source, ...row.gates]) {
        if (
          ctx.memberEmIds &&
          ref.kind === "em_status" &&
          !ctx.memberEmIds.has(ref.equipment_module_id)
        ) {
          issues.push(
            `${where}[${row.row_id}]: em_status source ${ref.equipment_module_id} is not a member of this unit (cross-unit reads are v2)`,
          );
        }
        // G0-4 activation: check refs against the unit's axis gate registry.
        if (
          ctx.namedGateIds &&
          ref.kind === "named_gate" &&
          !ctx.namedGateIds.has(ref.gate_id)
        ) {
          issues.push(
            `${where}[${row.row_id}]: named_gate "${ref.gate_id}" is not defined by this unit's axes`,
          );
        }
      }
```

(b) `contract.ts` — import `validateAxes`, `collectGateIds` from `@/lib/spec-builder/axis-model`. In the per-unit loop:

```ts
      issues.push(...validateAxes(coord));
      issues.push(
        ...validateSignalRouting(coord, {
          memberEmIds,
          safetyGateIds: patch.safety_gates
            ? new Set(patch.safety_gates.map((g) => g.gate_id))
            : undefined,
          namedGateIds: coord.axes ? collectGateIds(coord.axes) : undefined,
        }),
      );
```

After the loop (still inside `if (patch.unit_coordination !== undefined)`), the constants cross-check:

```ts
    // G0-4 tier-2 cross-check: constants must land on declared members.
    for (const entry of patch.engineering?.axis_constants ?? []) {
      const coord = patch.unit_coordination[entry.unit_id];
      if (!coord) continue; // unit not in this patch — context absent
      const axis = coord.axes?.find((a) => a.axis_id === entry.axis_id);
      if (!axis) {
        issues.push(
          `engineering.axis_constants: axis "${entry.axis_id}" not found on unit "${entry.unit_id}"`,
        );
        continue;
      }
      const members = new Set(
        axis.kind === "linear"
          ? [axis.scale, axis.length, axis.end_margin, axis.ramp_zone].map((p) => p.db_member)
          : [axis.counts_per_rev.db_member],
      );
      for (const key of Object.keys(entry.values)) {
        if (!members.has(key)) {
          issues.push(
            `engineering.axis_constants[${entry.axis_id}]: "${key}" is not a declared member ("not_a_member" style typo?)`,
          );
        }
      }
    }
```

(Simplify the message — just name the key; the parenthetical is illustrative. Use: `` `engineering.axis_constants[${entry.axis_id}]: "${key}" is not a declared db_member of the axis` ``.)

- [ ] **Step 4: Verify pass** (both suites).
- [ ] **Step 5: Commit** — `feat(spec-builder): named-gate registry activation + axis_constants gate (G0-4)`

---

### Task 4: Golden fixture + verification + tracker/board sync

**Files:**
- Test: `src/types/__tests__/spec-contract-v2.test.ts`
- Modify: roadmap md + tasks.json (G0-4 → DONE)

- [ ] **Step 1: Golden fixture** — HRE axes, then re-validate the G0-3 routing fixture WITH the registry (import `collectGateIds`, `validateAxes` in the types test). The G0-3 fixture's gates are `rot_at_home`, `fwd_fast_ok`, `fwd_ok`, `rev_fast_ok`, `rev_ok` — the axes must define exactly those ids:

```ts
describe("G0-4 golden fixture — HRE axes + joined G0-3 routing", () => {
  const railAxis = {
    axis_id: "rail",
    kind: "linear",
    encoder_tag: "Carriage_Encoder_Pos",
    eu_unit: "mm",
    scale: { db_member: "mm_per_rev_x10", description: "fixed physics, set once" },
    length: { db_member: "rail_length_mm", operator_settable: true },
    end_margin: { db_member: "end_margin_mm", default: 500 },
    ramp_zone: { db_member: "ramp_zone_mm", default: 2000 },
    gates: {
      fwd_ok: "fwd_ok",
      fwd_fast_ok: "fwd_fast_ok",
      rev_ok: "rev_ok",
      rev_fast_ok: "rev_fast_ok",
    },
  };
  const rotatorAxis = {
    axis_id: "rotator",
    kind: "rotary",
    encoder_tag: "Rotator_Encoder_Pos",
    counts_per_rev: { db_member: "rot_counts_per_360", default: 0 },
    preset_offset: 500000,
    home_windows: [
      { center_deg10: 0, band_deg10: 20 },
      { center_deg10: 1800, band_deg10: 20 },
    ],
    gates: { at_home: "rot_at_home" },
  };

  it("HRE axes validate and their registry satisfies the G0-3 routing table", () => {
    const axes = [AxisV1Schema.parse(railAxis), AxisV1Schema.parse(rotatorAxis)];
    expect(validateAxes({ unit_id: "carriage", axes })).toEqual([]);
    const registry = collectGateIds(axes);
    expect(registry).toEqual(
      new Set(["fwd_ok", "fwd_fast_ok", "rev_ok", "rev_fast_ok", "rot_at_home"]),
    );
    // Re-validate the G0-3 golden routing WITH the registry — the join proof.
    const issues = validateSignalRouting(
      { unit_id: "carriage", signal_routing: hreRouting },
      {
        memberEmIds: new Set([
          "em_drive", "em_limits", "em_travel_ind", "em_brake", "em_pendant",
        ]),
        safetyGateIds: new Set(["estop_healthy", "sr1_healthy"]),
        namedGateIds: registry,
      },
    );
    expect(issues).toEqual([]);
  });
});
```

Refactor note: hoist the G0-3 fixture's parsed routing into a module-level `hreRouting` const shared by both describes (extract from the existing G0-3 describe; keep that describe's assertions unchanged).

- [ ] **Step 2: Run 6 suites** (`spec-contract-v2`, `axis-model`, `signal-routing`, `contract`, `drive-model`, `io-signal-model`) + `npx tsc -b` — all green.
- [ ] **Step 3: Genericity grep** — `mm_per_rev_x10|rot_counts_per_360|Carriage_Encoder_Pos` in `src` → tests + schema comments only.
- [ ] **Step 4: Trackers** — G0-4 → ✅/DONE with commit range; note "G0 P0 critical path complete".
- [ ] **Step 5: Commit** — `test(spec-builder): HRE axes golden fixture + tracker G0-4 DONE (G0-4)`
- [ ] **Step 6: Monday** — G0-4 → Done + closeout update + timeline; G0 phase update noting P0 path complete.

---

## Self-Review Notes

- Spec §1 → Task 1; §2 → Task 1; §3 → Tasks 2–3; §5 → per-task + Task 4. §4 no migration — constraint only.
- Names consistent: `AxisV1`, `GeometryParamDef`, `collectGateIds`, `validateAxes`, ctx key `namedGateIds`.
- Task 3(b) restructures the em_status loop to be unconditional — existing "skips membership checks without context" test still passes because both checks are ctx-gated inside the loop.
- Task 4 depends on hoisting the G0-3 fixture routing — mechanical, assertions unchanged.
