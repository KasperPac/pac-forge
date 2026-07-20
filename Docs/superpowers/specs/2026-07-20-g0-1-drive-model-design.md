# G0-1 — Drive/VSD Parameter Model (DriveModelV1 + EngineeringDataV1) — Design

> **Task:** G0-1 (roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`, Monday subitem 3056337958)
> **Depends on:** G0-6 boundary decision — `Docs/superpowers/specs/2026-07-07-g0-fds-boundary-design.md` (table A)
> **Consumed by:** G1-1…G1-3 (drive FB selection, telegram FB emission, %↔rpm scaling), G1-6
> **Precedent:** G0-9 wave (`388d696..c20eb8f`) — schema + validator + persistence + golden fixture

## Goal

`SpecContractV2` today cannot express what `MAP_Carriage_Drive.scl` (golden master,
`exports/SRL-1427-500802-PACKML/`) needed by hand: which drive FB family and telegram a
drive CM uses, what unit convention its speed references follow, when the axis is
enabled, and the record-only commissioning values (HWIDSTW/ZSW, RefSpeed = p2000,
ConfigAxis). G0-1 adds exactly those fields, split across the two tiers the boundary
doc decided, so the G1 MAP writer can emit the telegram FB call deterministically.

## Non-goals

- G1 writer emission (G1-1…G1-3) — this wave is contract-only.
- Fault-ack routing (`AckError := Reset_PB`) — a G0-3 coordination-intent row.
- Authoring UI / co-author prompt changes — later wave, same as G0-9.
- Bridge lookup of HW identifiers from TIA HW config — future; values are record-only.
- Refactoring `vfd-fb-family.ts` for deterministic consumption — that is G1-6.
- Appliance generalization — G0-11 owns it; drives are retroactively its first instance.

## 1. Tier-1 schema — `DriveModelV1` (signable FDS content)

New optional `drive` key on `ControlModuleV2Schema` (`src/types/spec-contract-v2.ts`):

```ts
export const SpeedRefUnitSchema = z.enum(["percent_ref_speed", "rpm", "hz"]);

export const DriveEnablePolicySchema = z.enum([
  "enable_on_nonzero_ref", // golden master: EnableAxis := ref_pct <> 0
  "explicit_enable",       // enable pin driven by EM command seam
]);

export const DriveModelV1Schema = z.object({
  family: VfdFamilySchema,               // existing enum, reused
  // Optional: PROFINET-telegram families (Siemens) carry it; assembly/vendor-profile
  // families (ABB EtherNet/IP, SEW) must not.
  telegram: TelegramStandardSchema.optional(),
  speed_ref: z.object({
    unit: SpeedRefUnitSchema,
    signed: z.boolean(),
  }),
  enable_policy: DriveEnablePolicySchema,
});

// on ControlModuleV2Schema:
drive: DriveModelV1Schema.optional(),
```

Golden-master values: `family: "sinamics_g120"`, `telegram: 1`,
`speed_ref: { unit: "percent_ref_speed", signed: true }`,
`enable_policy: "enable_on_nonzero_ref"`.

`speed_ref.unit = "percent_ref_speed"` means setpoints/feedback are percent of the
tier-2 `ref_speed_rpm` (drive p2000). `rpm`/`hz` mean raw engineering units — the
writer then emits no scaling. Control mode (speed vs position) is implied by
`family` + `telegram` (e.g. Tg 105 ⇒ SINA_POS); no separate field (YAGNI).

## 2. Tier-2 schema — `EngineeringDataV1` (record-only Engineering Data)

New optional project-level `engineering` key on `SpecContractV2Schema`. This is THE
container from the boundary doc's tier 2; G0-2 (conditioning defaults), G0-4
(addressing) and G0-7 (commissioning-pack sections) later add sibling keys. G0-1
ships only `drives`:

```ts
export const DriveEngineeringEntrySchema = z.object({
  control_module_id: UuidSchema,          // must reference a CM with `drive` set
  hw_id_stw: z.number().int().nonnegative().optional(), // HWIDSTW from TIA HW config
  hw_id_zsw: z.number().int().nonnegative().optional(), // HWIDZSW
  ref_speed_rpm: z.number().positive().optional(),      // MUST equal drive p2000
  config_axis: z.number().int().nonnegative().default(0x003f),
  notes: z.string().optional(),
});

export const EngineeringDataV1Schema = z.object({
  drives: z.array(DriveEngineeringEntrySchema).default([]),
});

// on SpecContractV2Schema:
engineering: EngineeringDataV1Schema.optional(),
```

All value fields optional: entries legitimately exist half-filled during design
(commissioning fills them in). `config_axis` defaults to `16#003F` per boundary doc.

## 3. Validation — `validateDriveModel`

New module `src/lib/spec-builder/drive-model.ts` (pattern:
`unit-coordination.ts` / `validateUnitCoordination`), wired into the same patch
path. Deterministic telegram-support table lives here (NOT imported from
`vfd-fb-family.ts` — that stays AI-only until G1-6):

| family | telegram field |
|---|---|
| sinamics_g120 | 1, 20, 352 |
| sinamics_s210 | 102, 105 |
| abb_acs880 | must be absent (EtherNet/IP assembly, telegram n/a) |
| sew_movidrive | must be absent (vendor profile) |
| other | any or absent (no constraint) |

Errors:
- `drive.telegram` present but not in the family's supported set.
- `drive.telegram` present on a family where it must be absent (abb_acs880, sew_movidrive).
- `engineering.drives[]` entry whose `control_module_id` matches no CM, or matches a
  CM without `drive`.
- Duplicate `engineering.drives[]` entries for one CM.

Warnings:
- CM has `drive` but no `engineering.drives[]` entry (pre-commissioning state — the
  writer will emit `// TODO wire` placeholders until filled).
- Siemens family (`sinamics_*`) with `telegram` absent — spec incomplete but parseable
  (warning, not error, so `network_config`-seeded drives without telegram info don't
  hard-fail existing projects).
- `abb_acs880` family with PROFINET-style `network_config.protocol` mismatch is NOT
  checked here (network consistency is existing `network_config` territory).

## 4. Persistence

- `drive` lives inside the contract JSON where CMs already persist — no DB change.
- `engineering` gets its own `jsonb` column on `spec_projects`, exactly like
  `unit_coordination` (`20260708000000_unit_coordination.sql`):
  `supabase/migrations/20260720000000_engineering_data.sql` —
  `ALTER TABLE spec_projects ADD COLUMN IF NOT EXISTS engineering jsonb;`
- Load/save wiring in `src/lib/spec-builder/contract.ts` mirrors the
  `unit_coordination` load/save added in `0f37101`.
- ⚠️ **Remote DB drift**: author the migration file but reconcile remote migration
  history before any `db push` (see drift memory / G0-9 handling). Do not repair
  blindly.

## 5. Back-compat & seeding

- All new keys optional ⇒ every stored pre-G0-1 contract parses unchanged
  (same guarantee G0-9 gave via `.default("custom")`).
- Loader shim (in `contract.ts` load path): when a CM has `network_config.vfd_family`
  but no `drive`, seed `drive` in-memory as
  `{ family: vfd_family, telegram: network_config.telegram?.standard (omit if absent), speed_ref: { unit: "percent_ref_speed", signed: true }, enable_policy: "enable_on_nonzero_ref" }`
  and surface it as a normal patchable value. Defaults match the golden master and
  are the company convention; the co-author can override per project later.
- No automatic `engineering.drives[]` seeding — record-only data is entered, never
  invented.

## 6. Testing (vitest)

- `src/types/__tests__/spec-contract-v2.test.ts`: DriveModelV1 + EngineeringDataV1
  parse round-trips; pre-G0-1 fixture parses unchanged; `config_axis` default.
- `src/lib/spec-builder/__tests__/drive-model.test.ts`: every validator error and
  warning above, plus the telegram-support table.
- `src/lib/spec-builder/__tests__/contract.test.ts`: engineering load/save +
  `network_config` → `drive` seeding shim.
- Golden fixture (pattern `e02c352`): HRE-shaped Carriage Drive CM —
  G120 / Tg 1 / percent-signed / enable-on-nonzero + engineering entry
  `{ hw_id_stw: 322, hw_id_zsw: 322, ref_speed_rpm: 1500.0, config_axis: 0x003f }` —
  asserting exactly the values hand-authored in `MAP_Carriage_Drive.scl`.

## 7. Genericity check

No project-specific values in schema or validator: HRE values appear ONLY in test
fixtures. The model expresses any speed-controlled drive CM (conveyor, filler,
stamping feed) and positions S210/SINA_POS via the same fields. Non-Siemens families
carry family + speed-ref semantics; their telegram/assembly specifics stay in
`network_config` until G0-11 generalizes appliances.
