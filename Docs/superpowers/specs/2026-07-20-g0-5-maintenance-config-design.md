# G0-5 — Maintenance Config Model — Design (+plan)

> **Task:** G0-5 (Monday subitem 3056337703) — P1/M
> **Evidence:** `Maintenance_CMD.db`, `MAINT_Output_Override.scl`, `MAINT_Encoder_Preset.scl`
> **Depends on:** G0-9 (absorbed the mode flags: `maintenance` ModeKind + `command_routing.seq_test_release`), G0-4 (`AxisV1` hosts preset capability), G0-1 (`EngineeringDataV1`)
> **Consumed by:** G3 (maintenance writer: override FC, preset sequencer)

## Goal

Model the maintenance *capabilities* the golden master hand-authors: which outputs
the commissioning override block may drive (incl. the wire-check-only distinction)
and which encoders are presettable with their run-interlock. The mode flags
themselves shipped with G0-9; the one-shot preset sequencer, last-in-OB1 override
placement, and trigger-pulse timing are G3 writer knowledge (derived).

## Tier 1 schemas

**Project-level `maintenance` key on `SpecContractV2Schema`** (new jsonb column —
migration authored, NOT pushed, per drift rule):

```ts
export const OverridableOutputSchema = z.object({
  tag: z.string().min(1), // DO tag (cross-checked vs hierarchy DOs)
  wire_check_only: z.boolean().default(false), // unused by logic — wire check
  description: z.string().optional(),
});
export const MaintenanceV1Schema = z.object({
  overridable_outputs: z.array(OverridableOutputSchema).default([]),
});
// SpecContractV2Schema / SpecContractPatch: maintenance: MaintenanceV1Schema.optional()
```

**`preset` on both `AxisV1` members** (additive optional):

```ts
export const AxisPresetSchema = z.object({
  // EM whose Execute state blocks the preset (e.g. the axis drive EM).
  blocked_while_em_execute: z.string().min(1).optional(),
});
// LinearAxisSchema + RotaryAxisSchema: preset: AxisPresetSchema.optional()
```

Presence of `preset` = the encoder is presettable.

## Tier 2 — `engineering.encoder_presets[]`

```ts
export const EncoderPresetEntrySchema = z.object({
  unit_id: z.string().min(1),
  axis_id: z.string().min(1), // must reference an axis declaring `preset`
  ctrl_address: z.string().min(1), // %QB
  value_address: z.string().min(1), // %QD
  status_address: z.string().min(1), // %IB
  notes: z.string().optional(),
});
// EngineeringDataV1Schema: encoder_presets: z.array(EncoderPresetEntrySchema).default([])
```

## Validation (context-absent convention throughout)

- Patch gate: `maintenance.overridable_outputs[].tag` must match a DO
  `io_signal` when the patch carries hierarchy.
- `validateAxes` gains optional ctx `{ memberEmIds?: Set<string> }`:
  `preset.blocked_while_em_execute` must be a unit member when ctx present.
- Patch gate: `engineering.encoder_presets[]` entries must resolve to an axis
  that declares `preset` when the patch carries the unit's coordination.

## Testing

Schema round-trips + defaults; each validation rule + skips; golden fixture from
the HRE `ov_*` list (Reset_ECB…Carriage_Brake_Rel with the two wire-check-only
rows) + rotator/rail preset entries (ctrl %QB70/%QB64 etc.) — values in tests only.

## Non-goals

Preset sequencer emission, override-FC emission and OB1 ordering (G3); preset
pulse timing; watch-table/HMI surface; mode flags (G0-9 owns them).
