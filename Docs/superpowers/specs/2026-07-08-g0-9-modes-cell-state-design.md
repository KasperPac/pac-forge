# G0-9 — Modes & Cell-State Model (SpecContractV2)

**Date:** 2026-07-08 · **Status:** IMPLEMENTED (schema wave — see plans/2026-07-08-g0-9-modes-cell-state-schema.md) · **Scope:** schema + semantics only
**Parent decision:** `Docs/superpowers/specs/2026-07-07-g0-fds-boundary-design.md` §J (tier 1 unless noted)
**Board:** Forja G0-9 (subitem 3056974077) · Roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`

## Purpose

Nothing in the pipeline models the overall machine: `modes`/`allowed_modes` exist as dead schema
surface (zero consumers — grep shows only test fixtures), units have no state, and the Siemens
PackML HMI templates have nothing to bind. G0-9 defines the mode axis and the unit/cell state
machine so G2 can emit real coordinators and G7/G8-7/G0-12 have a binding target.

## Decisions (from the design forks)

1. **PackML-proper unit state machine** — each unit owns a generated state machine FB that
   commands its member EMs top-down (chosen over rollup; G2's writer becomes a unit-FB writer,
   and EM `ilk_CMD_*` pins become outputs of the unit SM rather than a blanket policy).
2. **Kind-tagged modes** — free-form list + required semantic `kind`.
3. **One SM per unit + mode annotations** — formally equivalent to the standard's per-mode state
   models because modes may only *disable* states from the canonical set, never add; this is how
   the OMAC/Siemens reference libraries implement ISA-TR88.00.02 themselves.
4. **PackTags v1 = core status + command** — full Admin/production tags deferred to
   G0-12/G0-14/G0-15 where they belong.
5. **Placement**: new top-level optional `unit_coordination: Record<unit_id, UnitCoordinationV1>`
   — mirrors the `equipment_modules` keyed-record pattern; `HierarchySchema` untouched.

## Schema (additive wave on `spec-contract-v2.ts`)

### Canonical PackML state set

```ts
export const UNIT_PACKML_STATES = [
  "idle","starting","execute","completing","complete","resetting",
  "holding","held","unholding","suspending","suspended","unsuspending",
  "stopping","stopped","aborting","aborted","clearing",
] as const;
export const UnitPackMLStateSchema = z.enum(UNIT_PACKML_STATES);
```

Unit states are drawn from this enum — the "modes disable, never invent" rule is structural.

### Modes

```ts
export const ModeKindSchema = z.enum(["production","maintenance","manual","engineering","custom"]);
// OperatorModeSchema gains:
kind: ModeKindSchema.default("custom"),   // default so existing stored contracts parse
```

Writer semantics keyed off `kind` (generic across machine types):
- `production` — the normal mode; full authored state model.
- `maintenance` — drives commanded to Stopped; override/preset seams (G3) enabled. **Folds in
  G0-5's ad-hoc `maintenance_mode` flag** — that flag becomes "current mode kind == maintenance".
- `manual` — operator-paced motion (pendant-class machines may make this their default).
- `engineering` — never exposed on the HMI; coordinator releases command pins (the HRE
  `seq_test_mode` pattern becomes "current mode kind == engineering").
- `custom` — no writer-attached behavior beyond the authored masks.

Seeding: new projects get Production (`is_default: true`) + Maintenance.

### Unit coordination

```ts
export const UnitStateV1Schema = z.object({
  state_id: UnitPackMLStateSchema,
  allowed_modes: z.array(z.string()).default([]),   // mode_ids; empty = all modes
  mode_change_allowed: z.boolean().default(false),  // authoring UI defaults true for stopped/idle/aborted
});

export const UnitTransitionTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("command"), command: z.enum([
    "start","stop","hold","unhold","suspend","unsuspend","reset","clear","abort"]) }),
  z.object({ type: z.literal("condition"), expr: z.array(PermissiveConditionSchema).min(1) }),
  z.object({ type: z.literal("em_aggregate"), em_scope: z.union([z.literal("all"), z.array(z.string())]),
             em_state: z.string().min(1) }),   // e.g. all member EMs report "idle"
]);

export const UnitTransitionV1Schema = z.object({
  transition_id: z.string().min(1),
  from_state_id: UnitPackMLStateSchema,
  to_state_id: UnitPackMLStateSchema,
  trigger: UnitTransitionTriggerSchema,
  guard: z.array(PermissiveConditionSchema).default([]),
  allowed_modes: z.array(z.string()).default([]),
});

export const EmCommandOverrideSchema = z.object({
  equipment_module_id: UuidSchema,
  command: z.enum(["CLEAR","RESET","START","STOP","HOLD","ABORT","NONE"]),
});

export const UnitCoordinationV1Schema = z.object({
  unit_id: z.string().min(1),
  states: z.array(UnitStateV1Schema).min(1),
  transitions: z.array(UnitTransitionV1Schema).default([]),
  // Per unit state: command asserted to member EMs. Canonical defaults apply
  // (see Semantics); entries here are per-EM overrides only.
  // partialRecord: sparse — only states with overrides appear (same pattern as
  // SpecContractV2.section_overrides; plain z.record over an enum key demands exhaustiveness)
  em_command_overrides: z.partialRecord(UnitPackMLStateSchema,
    z.array(EmCommandOverrideSchema)).optional(),
});

// SpecContractV2 gains:
unit_coordination: z.record(z.string(), UnitCoordinationV1Schema).optional(),
```

All fields follow the `nullableOptional` tolerance pattern where AI-authored JSON will hit them.

## Semantics

### Canonical EM command map (defaults; overrides per `em_command_overrides`)

| Unit state | Command to member EMs |
|---|---|
| clearing | CLEAR |
| resetting | RESET |
| starting / execute | START |
| stopping / stopped | STOP |
| holding / held | HOLD |
| aborting / aborted | ABORT |
| idle / complete / others | NONE (hold last) |

`NONE` means the unit FB asserts nothing; the EM stays where it is. Safety gates (`safety_gates`)
keep their existing force-to-safe role and are additionally mapped to the unit's `aborting`
transition — no duplication of the safety model.

### Mode manager (lives in the unit FB)

- `Cur_Mode` held per unit; mode change is **requested** via PackTags, **validated** then executed.
- **Legality rule (v1, strict):** request granted iff (a) unit's current state has
  `mode_change_allowed`, and (b) **every member EM is currently in a state whose
  `EmStateV2.allowed_modes` includes the target mode** (empty = always legal). Validation gate,
  not coercion — no hidden forced state changes on mode switch. (This finally gives
  `EmStateV2.allowed_modes` its consumer semantics.)
- On grant: `Cur_Mode` updates; states/transitions not in the new mode's mask become inactive.
  By construction (b), the machine is never *in* an illegal state after a legal switch.

### PackTags DB (`UN_<Unit>`, emitted per unit — derived layout)

| Member | Dir | Meaning |
|---|---|---|
| `Cur_St` (Int) | PLC→HMI | current unit state (index into the unit's state list, ordered per canonical set) |
| `Cur_Mode` (Int) | PLC→HMI | current mode (index into `modes`) |
| `St_Cmd` (Int) | HMI→PLC | state command word (start/stop/hold/…; FB consumes + clears) |
| `Mode_Req` (Int) | HMI→PLC | mode change request (FB validates + clears) |
| `Mode_Change_Legal` (Bool) | PLC→HMI | legality rule result, live |
| `EM_St[]` (Array of Int) | PLC→HMI | member EM states (mirrors `EM_*_DB.state`) |

Text lists for `Cur_St`/`Cur_Mode` come from G7-1's generator (same index-order source).

## Validation (Zod refinements + helper)

1. `states[].state_id` unique; transitions reference declared states.
2. Every declared mode has ≥ 1 allowed unit state (no mode with an empty machine).
3. Exactly one `is_default` mode per project (existing rule, now enforced).
4. For every mode: at least one state with `mode_change_allowed` is in its mask (no roach-motel modes).
5. `em_command_overrides` reference member EMs of that unit only.
6. Pure helper `isModeChangeLegal(contract, unitId, targetModeId, unitState, emStates)` — the
   single source of truth shared by validation, the future unit-FB writer (G2), and UI display.

## Consumers (out of scope here, unblocked by this)

- **G2** — unit FB writer: state CASE machine, mode manager, canonical command map, PackTags DB
  emission, safety-gate → aborting wiring.
- **G7-1/G7-4** — unit state/mode text lists + `UN_<Unit>` tag bindings.
- **G8-7** — PackML faceplate binding target.
- **G0-12** — upstream comms exposes the PackTags DB.
- **Co-author / spec-editor** — unit-SM authoring surface (Stage A analogue at unit level);
  separate follow-up task, not part of the G0-9 schema plan.
- **G0-5** — maintenance model consumes `kind == "maintenance"` instead of its own flag.

## Testing

Vitest over: schema refinements (each rule above, accept + reject cases), `isModeChangeLegal`
(state-gate, EM-mask-gate, empty-mask, engineering-mode cases), canonical command map defaults +
override precedence, and a golden-master-shaped fixture (HRE: Production/Maintenance/SeqTest as
production/maintenance/engineering kinds) proving the model expresses the hand-written UC behavior.
