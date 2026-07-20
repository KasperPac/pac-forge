# G0-3 — Coordination / Signal-Routing Intent Model (SignalRoutingV1) — Design

> **Task:** G0-3 (roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`, Monday subitem 3056349158)
> **Depends on:** G0-6 boundary decision — table C; G0-9 (`UnitCoordinationV1` host construct)
> **Consumed by:** G2 (UC writer — routing/command emission), G0-4 (defines the named gates this model references)
> **Precedent:** G0-9/G0-1/G0-2 waves — additive schema + pure validator + patch gate
> **Scope decision (2026-07-20, with Kasper):** evidenced core only. EM↔EM handshake
> links + product tracking split to **G0-3b** (Monday subitem 3096811470) — boundary
> doc flags them "not evidenced in the golden master"; they'll be designed against the
> G9-4 second-project pilot.

## Goal

`UC_Carriage.scl` is 100% hand-authored coordination: a safety-healthy term, per-EM
`ilk_` routing rows with gate expressions, two-detent fast/jog suppression, cross-EM
status reads, and PackML command routing released by seq-test mode. G0-3 gives the
contract a declarative model of that *intent* so the G2 unit-writer can emit the UC
FC deterministically.

## Non-goals

- G2 emission (writer wave).
- G0-4 gate *definitions* (envelope/geometry gates like `fwd_fast_ok`) — only the
  `named_gate` **reference** seam lands now; existence validation activates when
  G0-4 adds the registry.
- EM↔EM handshakes + product tracking — G0-3b.
- Cross-unit (UC-to-UC) routing — coordination between units lands with the
  cell-level layer; v1 rejects `em_status` sources outside the unit.
- Authoring UI / co-author prompts.

## 1. Home: `signal_routing` on `UnitCoordinationV1`

G0-9 made `UnitCoordinationV1` the per-unit coordination construct (state machine,
EM command map, mode gating). The routing layer is the same coordinator's other
half — one construct for the G2 writer, one patch path. New optional key ⇒ every
stored G0-9 contract parses unchanged. Rides the existing `unit_coordination` jsonb
column — **no migration**.

## 2. Schema (`src/types/spec-contract-v2.ts`)

```ts
// Discriminated source reference for routing rows and gates.
//  io_tag     — conditioned physical/dashboard input (IO_Cond layer)
//  em_status  — one-way read of a member EM's status DB member (ISA-88 §5.4:
//               EMs never talk directly; the UC routes)
//  named_gate — computed gate defined elsewhere (G0-4 envelope gates like
//               fwd_fast_ok / rot_at_home). Reference-only seam until G0-4
//               ships the registry; no existence check yet.
export const SignalSourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("io_tag"), tag: z.string().min(1) }),
  z.object({
    kind: z.literal("em_status"),
    equipment_module_id: UuidSchema,
    member: z.string().min(1), // e.g. "permit_travel"
  }),
  z.object({ kind: z.literal("named_gate"), gate_id: z.string().min(1) }),
]);
export type SignalSourceRef = z.infer<typeof SignalSourceRefSchema>;

export const RoutingTargetSchema = z.object({
  equipment_module_id: UuidSchema,
  pin: z.string().min(1), // e.g. "ilk_Fwd_Fast_Carriage"
});
export type RoutingTarget = z.infer<typeof RoutingTargetSchema>;

// One `target.pin := source AND gates...` row. The golden master's
// `ilk_Fwd_Fast_Carriage := s_fwd_f AND rot_home AND fwd_fast_ok AND permit`
// is source=io_tag(Fwd_Fast_Carriage), gates=[named_gate(rot_at_home),
// named_gate(fwd_fast_ok), em_status(Travel_Indicators, permit_travel)].
export const RoutingRowSchema = z.object({
  row_id: z.string().min(1),
  target: RoutingTargetSchema,
  source: SignalSourceRefSchema,
  gates: z.array(SignalSourceRefSchema).default([]),
  description: z.string().optional(),
});
export type RoutingRow = z.infer<typeof RoutingRowSchema>;

// Declared two-detent relationship: fast wins; a fast request that fails its
// gates falls back to the jog row (fallback=true, HRE FD rev B behavior).
// The writer emits the suppression pattern from this — never hand-authored.
export const TwoDetentSchema = z.object({
  jog_row_id: z.string().min(1),
  fast_row_id: z.string().min(1),
  fallback: z.boolean().default(true),
});
export type TwoDetent = z.infer<typeof TwoDetentSchema>;

// The `#ok` aggregation term: AND of the referenced safety-gate outputs,
// optionally excluding maintenance mode (golden master: EStop_Healthy AND
// SR1_Healthy AND NOT maintenance_mode). References the existing
// safety_gates model — deterministic, no free expressions.
export const SafetyHealthySchema = z.object({
  gate_ids: z.array(z.string().min(1)).min(1), // SafetyGateV2.gate_id refs
  exclude_maintenance: z.boolean().default(true),
});
export type SafetyHealthy = z.infer<typeof SafetyHealthySchema>;

// v1 ships the single canonical policy the golden master runs: while
// safety-healthy, walk all member EMs to Execute (CLEAR/RESET/START := ok);
// on unhealthy, STOP. seq_test_release skips command routing in seq-test
// mode (maintenance EM-level testing).
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
  // First-out fault capture (which trip came first) — writer emits latch logic.
  first_out: z.object({ enabled: z.boolean() }).optional(),
});
export type SignalRoutingV1 = z.infer<typeof SignalRoutingV1Schema>;

// on UnitCoordinationV1Schema:
signal_routing: SignalRoutingV1Schema.optional(),
```

## 3. Validation — `validateSignalRouting` in new `src/lib/spec-builder/signal-routing.ts`

Signature mirrors `validateUnitCoordination`; called from the same per-unit loop in
`validateSpecContractPatch`, with `ctx` extended by `safetyGateIds` (from
`patch.safety_gates` when present). Context-absent convention throughout.

```ts
export function validateSignalRouting(
  coord: Pick<UnitCoordinationV1, "unit_id" | "signal_routing">,
  ctx: { memberEmIds?: Set<string>; safetyGateIds?: Set<string> },
): string[]
```

Errors:
- Duplicate `row_id` across `routing_rows`.
- Duplicate `(target.equipment_module_id, target.pin)` — two rows driving one pin.
- `target.equipment_module_id` not in `memberEmIds` (when ctx present).
- `em_status` source/gate `equipment_module_id` not in `memberEmIds` (when ctx
  present) — rejects cross-unit reads in v1.
- `two_detent` entry whose `jog_row_id`/`fast_row_id` resolves to no routing row, or
  where jog and fast reference the same row.
- `safety_healthy.gate_ids` entry not in `safetyGateIds` (when ctx present).

No warnings in v1 (`named_gate` existence intentionally unchecked until G0-4).

## 4. Persistence & back-compat

- Rides `spec_projects.unit_coordination` jsonb — **no migration**.
- All new keys optional with array defaults ⇒ stored G0-9 contracts parse unchanged.
- No seeding (nothing to seed from — UC files are hand-authored SCL, out of app).

## 5. Testing (vitest)

- `src/types/__tests__/spec-contract-v2.test.ts`: SignalRoutingV1 round-trip on a
  UnitCoordinationV1; absent key back-compat; discriminated-union rejects unknown
  `kind`; defaults (`gates: []`, `fallback: true`, `exclude_maintenance: true`).
- `src/lib/spec-builder/__tests__/signal-routing.test.ts`: every validator error +
  clean pass; context-absent skips.
- `src/lib/spec-builder/__tests__/contract.test.ts`: patch gate rejects a
  unit_coordination patch with a duplicate target pin; safety-gate cross-check runs
  when the patch carries `safety_gates`.
- Golden fixture: the HRE Carriage routing table — 4 pendant rows
  (source io_tag, gates: rot_at_home / fwd_fast_ok / rev_fast_ok named gates +
  permit_travel em_status), `Long_Limit_Stop` fanned to two EMs, one two-detent pair
  per direction, `safety_healthy` over EStop+SR1 gates, `command_routing` with
  seq_test_release, `first_out` disabled. Values in tests only.

## 6. Genericity check

No project-specific tags/pins in schema or validator — the model expresses any
unit's routing (conveyor start interlocks, filler level permissives, stamping die
guards). Pin names are data; policies are enums; HRE values live only in fixtures.
