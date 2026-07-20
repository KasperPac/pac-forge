# G0-9-F1 — Mode-Kind Backfill + Mode Co-Send Requirement — Design (+plan)

> **Task:** G0-9-F1 (Monday subitem 3058757514) — Small follow-up to the shipped G0-9 wave
> **Scope correction (2026-07-20):** the random-FDS builder already co-sends a
> kind-tagged mode (`random/assemble.ts` `modes: [{... kind: "production"}]`) —
> the writer-side gap is instead the silent skip: a `unit_coordination` patch whose
> states REFERENCE mode ids validates without mode context. F1 closes both gaps.

## Gap 1 — backfill: pre-G0-9 stored modes load as all-`custom`

`ModeKindSchema.default("custom")` keeps old contracts parsing, but G0-9 gating and
G3 maintenance behavior key off `kind` — pre-G0-9 projects behave as inert customs
forever (the skeleton wizard keeps existing modes untouched).

**Fix:** pure `backfillModeKinds(modes: OperatorMode[]): OperatorMode[]` in
`wizard-machine-layer.ts`:
- Applies ONLY when every mode has `kind === "custom"` (the set predates kind
  authoring). A post-G0-9 set with any authored kind is never touched.
- Inference by `mode_id`/`name` (case-insensitive substring):
  `production`|`auto` → production · `maintenance`|`service` → maintenance ·
  `manual`|`jog` → manual · `engineering`|`commissioning` → engineering ·
  else stays custom.
- Returns the same array reference when nothing changes (no-op discipline, same as
  `seedDrivesFromNetworkConfig`).
- Wired into `loadSpecContract` right after parse (in-memory shim; round-trips as
  authored values on next write).

## Gap 2 — patch gate: mode-referencing coordination must co-send modes

`validateUnitCoordination` mode rules skip when `patch.modes` is absent (context
convention). But a coordination whose `states[].allowed_modes` actually name mode
ids is unverifiable without the mode set — the skip hides real breakage.

**Fix:** in `validateSpecContractPatch`, when `patch.unit_coordination` is present,
`patch.modes` is absent, and ANY unit's states carry a non-empty `allowed_modes`,
push an error: the writer must co-send `modes` in the same patch. Coordinations
with no mode references (all `allowed_modes` empty) keep the old skip — nothing
breaks for mode-agnostic patches.

## Testing

- `wizard-machine-layer.test.ts`: inference table; all-custom guard (authored set
  untouched); same-ref no-op; mixed names.
- `contract.test.ts`: unit_coordination with `allowed_modes: ["production"]` and no
  modes → error mentions co-send; with modes present → existing G0-9 rules run;
  empty `allowed_modes` without modes → no error (back-compat).

No schema change, no migration.
