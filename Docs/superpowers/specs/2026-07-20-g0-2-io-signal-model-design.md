# G0-2 — Per-IO Signal Model (polarity, conditioning, analog scaling) — Design

> **Task:** G0-2 (roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`, Monday subitem 3056337957)
> **Depends on:** G0-6 boundary decision — `Docs/superpowers/specs/2026-07-07-g0-fds-boundary-design.md` (table B); G0-1 (`EngineeringDataV1` container)
> **Consumed by:** G1-4 (N/C inversion + debounce/filter + `NORM_X`/`SCALE_X` emission)
> **Precedent:** G0-1 wave (`ec29d42..87d7a59`) — additive schema + pure validator + patch gate

## Goal

`IoSignalV2` today carries only tag/type/address/description. The golden master's MAP
layer hand-authors what that misses: `NOT` inversions for N/C fail-safe inputs
(`MAP_Carriage_Drive.scl` thermistors, CB trip, brake-resistor fault), functionally
significant delay requirements, and — on analog machines — the raw↔engineering-unit
mapping that gives every alarm setpoint its meaning. G0-2 adds those three per-signal
fields plus the tier-2 blanket-conditioning defaults, so the G1-4 writer can emit
signal treatment deterministically.

## Placement decision (amends boundary doc wording)

Boundary table B says "G0-2 field on `IoListEntry`". Decided 2026-07-20 with Kasper:
the model lives on **`IoSignalV2`** (per-CM `io_signals`) instead, because
`io_list` is *derived from* `io_signals` (`deriveIoList`, `contract.ts` — it
currently blanks `normal_state`/`failsafe_state`) and the deterministic codegen
consumes `IoSignalV2` exclusively. `io_list` remains the signable flat projection and
gets the polarity **rendered** into its existing free-text fields. Single source of
truth; `IoListEntry`'s shape is untouched.

## Non-goals

- G1-4 emission (`NOT`, TON/TOF, `NORM_X`/`SCALE_X`) — contract-only wave.
- Authoring UI / co-author prompt changes.
- Seeding from legacy `failsafe_state` free text (unreliable; derived lists have it
  blank anyway). No shim.
- Analog channel addressing — already modeled by the existing `io_address` field
  (boundary table B's tier-2 addressing row needs no new field).
- Platform ADC representation (5530–27648 counts etc.) — derived, fixed platform
  physics; lives in the G1-4 writer, never in the contract.

## 1. Tier-1 schema — three optional fields on `IoSignalV2`

```ts
// Digital wiring polarity. "nc" = normally-closed fail-safe wiring: the
// healthy/untripped state reads TRUE at the terminal, so the MAP writer
// (G1-4) emits a NOT inversion to hand the EM a TRUE=abnormal signal —
// exactly the golden master's `:= NOT "IO_Cond".CM1_Therm` lines.
export const IoPolaritySchema = z.enum(["no", "nc"]);
export type IoPolarity = z.infer<typeof IoPolaritySchema>;

// Functionally significant conditioning ONLY (e.g. "absent 5 s before
// fault" => off_delay_ms: 5000). Blanket no-meaning filter times belong in
// engineering.io_conditioning_defaults (tier 2), not here.
export const IoConditioningSchema = z.object({
  on_delay_ms: z.number().int().nonnegative().optional(),
  off_delay_ms: z.number().int().nonnegative().optional(),
});
export type IoConditioning = z.infer<typeof IoConditioningSchema>;

export const RawSignalUnitSchema = z.enum(["mA", "V", "counts"]);
export type RawSignalUnit = z.infer<typeof RawSignalUnitSchema>;

// Raw electrical range ↔ engineering-unit range. Signable: FDS behavior
// (alarm setpoints, permissives, envelope limits) is written in eu units,
// so this mapping defines what those numbers mean. EU range may be
// inverted; raw min≠max enforced in the validator.
export const AnalogScalingSchema = z.object({
  raw: z.object({
    min: z.number(),
    max: z.number(),
    unit: RawSignalUnitSchema,
  }),
  eu: z.object({
    min: z.number(),
    max: z.number(),
    unit: z.string().min(1), // °C, bar, %, mm …
  }),
});
export type AnalogScaling = z.infer<typeof AnalogScalingSchema>;

// on IoSignalV2Schema (all additive/optional):
polarity: IoPolaritySchema.optional(),        // digital signals only
conditioning: IoConditioningSchema.optional(), // digital signals only
scaling: AnalogScalingSchema.optional(),       // AI/AO only
```

## 2. Tier-2 schema — `engineering.io_conditioning_defaults`

New optional sibling on `EngineeringDataV1Schema` (G0-1's container, as designed):

```ts
export const IoConditioningDefaultsSchema = z.object({
  di_debounce_ms: z.number().int().nonnegative().optional(),
  ai_filter_ms: z.number().int().nonnegative().optional(),
});
export type IoConditioningDefaults = z.infer<typeof IoConditioningDefaultsSchema>;

// on EngineeringDataV1Schema:
io_conditioning_defaults: IoConditioningDefaultsSchema.optional(),
```

Blanket engineering defaults with no functional meaning. Per-signal tier-1
`conditioning` overrides them where present (precedence is a G1-4 writer rule; the
contract just records both).

## 3. Validation — `validateIoSignals` in new `src/lib/spec-builder/io-signal-model.ts`

Pure module, same pattern as `drive-model.ts`. Signal-kind partition:
digital = `DI`/`DO`, analog = `AI`/`AO`; `internal` signals accept none of the three
fields (error if any present — internal signals have no terminal wiring or raw range).

Errors:
- `polarity` present on an `AI`/`AO`/`internal` signal.
- `scaling` present on a `DI`/`DO`/`internal` signal.
- `conditioning` present on an `AI`/`AO`/`internal` signal (analog filtering is a
  tier-2 default, not per-signal delays).
- `scaling.raw.min === scaling.raw.max`.
- `conditioning` present but empty (neither delay set) — meaningless row.

Warnings:
- `AI`/`AO` signal without `scaling` — alarm setpoints/permissives referencing it
  have undefined units (spec incomplete, common pre-authoring state).

Signature mirrors G0-1:

```ts
export interface IoSignalIssues { errors: string[]; warnings: string[] }
export function validateIoSignals(
  control_modules: Pick<ControlModuleV2,
    "control_module_id" | "control_module_name" | "io_signals">[],
): IoSignalIssues
```

Wired into `validateSpecContractPatch` inside the existing `if (patch.hierarchy)`
block added by G0-1 (same CM flatten, errors only).

## 4. `deriveIoList` rendering

The derived signable rows stop being blank where polarity is authored:

```ts
normal_state: sig.polarity === "nc" ? "N/C" : sig.polarity === "no" ? "N/O" : "",
failsafe_state: sig.polarity === "nc" ? "fail-safe (healthy = TRUE)" : "",
```

`IoListEntry` schema untouched — these are the existing free-text fields, now
deterministically populated.

## 5. Persistence & back-compat

- **No migration.** `io_signals` persist inside the hierarchy JSON
  (`confirmed_units`); `engineering` got its jsonb column in G0-1.
- All new keys optional ⇒ every stored contract parses unchanged.
- No seeding shim (see Non-goals).

## 6. Testing (vitest)

- `src/types/__tests__/spec-contract-v2.test.ts`: field round-trips on IoSignalV2;
  `io_conditioning_defaults` on EngineeringDataV1; back-compat (signal without any
  new field parses; pre-G0-2 engineering blob parses).
- `src/lib/spec-builder/__tests__/io-signal-model.test.ts`: every validator error +
  the warning; clean pass for a correctly-annotated mixed DI/AI set.
- `src/lib/spec-builder/__tests__/contract.test.ts`: patch gate rejects a hierarchy
  patch with polarity on an AI; `deriveIoList` rendering (N/C strings appear).
- Golden fixture: HRE N/C inputs from `MAP_Carriage_Drive.scl` — `CM1_Therm`,
  `VSD1_CB_Trip`, `BR1_Fault` as `polarity: "nc"` (values in tests only) — plus a
  generic analog fixture (4–20 mA ↔ 0–10 bar) exercising scaling.

## 7. Genericity check

No project-specific values outside test fixtures. The model covers any machine's IO
treatment: N/C safety-adjacent inputs (thermistors, trips), debounced presence
sensors on conveyors/fillers, 4–20 mA / 0–10 V / encoder-count analogs with arbitrary
EU ranges (including inverted). `internal` signals are explicitly excluded rather
than silently accepted.
