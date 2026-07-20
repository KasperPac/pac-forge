# G0-4 — Envelope Geometry & Scaling Model (AxisV1) — Design

> **Task:** G0-4 (roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`, Monday subitem 3056350498)
> **Depends on:** G0-6 boundary rows 81–95 (tier split: semantics 1 / commissioned constants 2 / scaling math derived); G0-3 (`named_gate` seam), G0-1 (`EngineeringDataV1`)
> **Consumed by:** G2-5 (unit-writer: encoder scaling, envelope gates, config DB, status readbacks), G0-3 `signal_routing` (gate registry)
> **Evidence:** `UC_Carriage.scl` geometry math + `Rail_Config.db` (RETAIN params + readbacks)
> **Shape decision (2026-07-20, with Kasper):** fixed semantic roles per axis kind
> (evidenced), not a generic zones list — zones[] noted as v2 if a pilot machine
> needs mid-travel zones.

## Goal

Model the geometry the golden master hand-authors: encoder→EU scaling (linear mm;
rotary counts/360 → deg×10 with preset offset), the growing operational envelope
(rail length, end margin, ramp zone), home/straight windows, and the named envelope
gates (`fwd_ok`, `fwd_fast_ok`, …) that G0-3 routing rows already reference. This
wave **activates the named-gate existence check** in `validateSignalRouting`.

## Non-goals

- G2-5 emission (scaling math, gate logic, config DB, `Rail_Status` readbacks — all
  derived; the writer emits from these params).
- Generic zones list (v2 if needed — mid-travel slow zones etc.).
- Encoder-preset capability/channels — G0-5 (capability) + tier-2 rows.
- Runtime *values* of operator-set parameters (live in the PLC's RETAIN DB, not the
  contract); commissioned constants are recorded tier-2.

## 1. Schema — `AxisV1` on `UnitCoordinationV1` (tier 1)

Axes live per-unit next to `signal_routing` — same construct the G2 writer consumes,
same patch path, rides the `unit_coordination` jsonb column. **No migration.**
EM/gate/id refs are plain `z.string().min(1)` per the host convention.

```ts
// One emitted config-DB member: name, seed default, retention, who sets it.
// The VALUE at runtime lives in the PLC (operator/commissioning); the
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
  fwd_ok: z.string().min(1).optional(), // beyond end margin? blocked
  fwd_fast_ok: z.string().min(1).optional(), // inside ramp zone? fast falls back
  rev_ok: z.string().min(1).optional(),
  rev_fast_ok: z.string().min(1).optional(),
});

export const LinearAxisSchema = z.object({
  axis_id: z.string().min(1),
  kind: z.literal("linear"),
  encoder_tag: z.string().min(1), // e.g. "Carriage_Encoder_Pos"
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
  center_deg10: z.number().int().min(-1799).max(1800), // 0 = home, 1800 = 180°
  band_deg10: z.number().int().positive(), // ± band
});
export type HomeWindow = z.infer<typeof HomeWindowSchema>;

export const RotaryAxisSchema = z.object({
  axis_id: z.string().min(1),
  kind: z.literal("rotary"),
  encoder_tag: z.string().min(1),
  // Calibration constant K (counts per 360°). default 0 = uncalibrated ⇒
  // raw treated as direct 0.1° (legacy direct-mount), per golden master.
  counts_per_rev: GeometryParamDefSchema,
  // Raw preset applied at "straight" so the unsigned encoder never
  // underflows (HRE: 500000). Writer subtracts it before scaling.
  preset_offset: z.number().int().nonnegative().default(0),
  // Multi-window covers "straight at 0° OR 180°" (FD rev B).
  home_windows: z.array(HomeWindowSchema).min(1),
  gates: z.object({ at_home: z.string().min(1).optional() }).default({}),
});
export type RotaryAxis = z.infer<typeof RotaryAxisSchema>;

export const AxisV1Schema = z.discriminatedUnion("kind", [
  LinearAxisSchema,
  RotaryAxisSchema,
]);
export type AxisV1 = z.infer<typeof AxisV1Schema>;

// on UnitCoordinationV1Schema (after signal_routing):
axes: z.array(AxisV1Schema).optional(),
```

## 2. Tier-2 — `engineering.axis_constants`

Commissioned constants recorded per axis (boundary row 81 "tier 2 constants"):

```ts
export const AxisConstantEntrySchema = z.object({
  unit_id: z.string().min(1),
  axis_id: z.string().min(1),
  // db_member → commissioned value (e.g. { mm_per_rev_x10: 157,
  // rot_counts_per_360: 40960 }). Keys must be members the axis declares.
  values: z.record(z.string(), z.number()),
  notes: z.string().optional(),
});
export type AxisConstantEntry = z.infer<typeof AxisConstantEntrySchema>;

// on EngineeringDataV1Schema:
axis_constants: z.array(AxisConstantEntrySchema).default([]),
```

## 3. Validation

**New `src/lib/spec-builder/axis-model.ts`** — `validateAxes(coord: Pick<UnitCoordinationV1, "unit_id" | "axes">): string[]`:
- Duplicate `axis_id` within the unit.
- Duplicate gate id across the unit's axes (each gate name defined once).
- Duplicate `db_member` among one axis's param defs (linear: scale/length/
  end_margin/ramp_zone; rotary: counts_per_rev).
- `band_deg10 > 1800` (window wider than the half-circle it lives on).

**`validateSignalRouting` gains `namedGateIds?: Set<string>` in ctx** — when
provided, every `named_gate` ref must exist (the deferred G0-3 check activates).
`contract.ts` builds the set from `coord.axes` gate ids when `axes` is present;
absent axes ⇒ check skipped (context convention preserved).

**`validateDriveModels` untouched.** Engineering cross-check for `axis_constants`
joins the patch gate: when `patch.unit_coordination` present, each entry's
`(unit_id, axis_id)` must resolve and its `values` keys ⊆ that axis's declared
`db_member`s; engineering-only patches skip.

## 4. Persistence & back-compat

Rides `unit_coordination` + `engineering` columns — **no migration**. All new keys
optional/defaulted ⇒ stored contracts parse unchanged. No seeding.

## 5. Testing (vitest)

- Types suite: linear + rotary parse with defaults (retain=true,
  unconfigured_open=true, preset_offset=0); union rejects unknown kind;
  `axis_constants` on engineering; back-compat absent keys.
- `axis-model.test.ts`: each validator error + clean pass.
- `signal-routing.test.ts`: named_gate check fires with `namedGateIds`, skips
  without (existing tests unchanged).
- `contract.test.ts`: patch gate rejects unknown named_gate when axes present;
  axis_constants cross-check.
- Golden fixture: the HRE Carriage unit — rail linear axis (`mm_per_rev_x10`
  set-once, `rail_length_mm` operator-settable growing, `end_margin_mm` default
  500, `ramp_zone_mm` default 2000, four gates) + rotator rotary axis
  (`rot_counts_per_360` default 0, preset 500000, windows 0±20 and 1800±20,
  `rot_at_home`) — then the G0-3 golden routing fixture re-validated WITH
  `namedGateIds` from these axes, proving the two models join. Engineering entry
  with commissioned `rot_counts_per_360`. Values in tests only.

## 6. Genericity check

Linear covers any travel/height/feed envelope (conveyor, lift, stamping feed);
rotary covers turntables/rotators with arbitrary window sets; param names, gate
ids, defaults are data. HRE constants live only in fixtures.
