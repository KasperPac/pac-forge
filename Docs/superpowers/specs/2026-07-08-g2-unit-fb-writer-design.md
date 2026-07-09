# G2 — Unit-FB Writer (G0-9 consumer wave)

**Date:** 2026-07-08 · **Status:** DESIGN APPROVED (Kasper + Claude) · **Scope:** G2-1 + G2-2 + G2-3
**Consumes:** `Docs/superpowers/specs/2026-07-08-g0-9-modes-cell-state-design.md` (unit_coordination schema, shipped 98c6dde…c20eb8f)
**Board:** Forja G2 (item 3056337764; subitems G2-1 3056350526, G2-2 3056348622, G2-3 3056348345)

## Purpose

`compile-contract.ts` emits a comment-only `UC_<unit>` stub; the real coordinators on the HRE
machine (`exports/SRL-1427-500802-PACKML/UC_*.scl`) were fully hand-authored. G0-9 gave units a
modeled PackML state machine (`unit_coordination`), mode kinds, a canonical EM command map, and
PackTags semantics. This wave turns that model into generated code: a deterministic unit FB that
owns the state machine, the mode manager, and command assertion into member EMs.

## Scope boundary (decided)

- **In:** G2-1 (UC writer replacing the stub), G2-2 (safety-healthy aggregation), G2-3 (PackML
  command routing gated on ok/maintenance/engineering), plus the G0-9 consumer surface the old
  rows don't name: mode manager, `UN_<Unit>` PackTags DB, real OB1 call.
- **Parked (explicitly, until G0-3/G0-4 schemas exist):** G2-4 physical signal→EM `ilk_` routing,
  G2-5 envelope/limit zones, G2-6 closed-loop one-shots. Hand-authored routing FCs coexist with
  the generated FB; when G0-3/G0-4 land, the same writer extends — nothing is redone.
- Units **without** authored `unit_coordination` keep today's stub plus a compile warning
  ("unit X has no unit_coordination — emitting placeholder"). Fully additive.
- **Preliminary step:** commit the currently-uncommitted codegen working-tree changes
  (typed static-holds + symbolic MAP wiring in em-builder/em-writer/types) before this wave —
  they are finished prior work and this wave builds on them.

## Decision 1 — EM command seam: make the fixed `cmd_*` pins real

The generated EM FBs declare `cmd_start/stop/hold/reset` (em-builder.ts `CMD_PINS`) but no
generated state body ever reads them; real transitions fire on authored trigger tags routed to
`ilk_*` pins. Chosen over driving authored `ilk_*` tags (needs an unmodeled tag-role convention)
and over an Int command word (opaque in watch tables):

- Seam grows to **6 Bool level pins**: `cmd_start, cmd_stop, cmd_hold, cmd_reset, cmd_abort,
  cmd_clear`. They remain part of the command seam bound from the `<EM>_CMD` DB in the OB1
  instance call — the CMD DB stays the single shared command surface (UC writes it when it owns
  the machine; HMI/manual writes it when the UC releases in engineering mode).
- em-builder ORs each pin into the EM's **command-triggered** transitions (`trigger.kind ===
  "command"` only — completion transitions stay automatic) by canonical **to-state family**:

| Transition lands in | Pin OR'd into its trigger |
|---|---|
| starting, execute, unholding, unsuspending | `cmd_start` |
| stopping, stopped | `cmd_stop` |
| holding, held | `cmd_hold` |
| resetting | `cmd_reset` |
| aborting, aborted | `cmd_abort` |
| clearing | `cmd_clear` |
| idle, complete, completing, suspending, suspended | none (authored trigger only) |

  Example: `IF #cmd_start OR #ilk_CD_CMD_START THEN` — authored operator/HMI triggers keep
  working unchanged; the unit gains a structural handle with zero tag-name conventions.
- EM states are canonical PackML slugs (SP-3 Stage-A gate enforces `isPackmlSlug`), so the
  family mapping is total for conformant EMs. Non-canonical (pre-SP-3) state ids: no pin OR'd,
  and the writer emits a warning naming the EM + state.
- **Coverage warning:** when an EM has a state from which an asserted STOP or ABORT reaches no
  command transition (the command "can't land"), emit a warning on the existing warnings channel
  (same spirit as SP-4's unfireable-exit warnings). Warning only — authoring reality, not an error.

## Decision 2 — Artifacts per unit (with authored coordination)

| Artifact | Type | Layer | Content |
|---|---|---|---|
| `UC_<Unit>` | FB | unit | state machine + mode manager + command assertion (below) |
| `UC_<Unit>_DB` | instance DB | unit | statics (`Cur_St`, `Cur_Mode`, edge/one-scan memories) |
| `UN_<Unit>` | global DB | unit | PackTags v1: `Cur_St:Int`, `Cur_Mode:Int`, `St_Cmd:Int`, `Mode_Req:Int`, `Mode_Change_Legal:Bool`, `EM_St: Array[0..n-1] of Int` |

OB1 calls `"UC_<Unit>_DB"();` **before** that unit's EM/CM calls (hand-written coordinator
ordering: route/command first, EMs execute same scan). `ob1-writer.ts`'s stale
`"UC_x"(db := "DB_x")` template is replaced.

## Decision 3 — Unit FB internals (scan order)

1. **Safety aggregation (G2-2).** `#gates_ok := NOT (<OR of safety_gates conditions scoped to
   this unit's EMs or "all">)`. Gate conditions serialize via the existing condition serializer
   against global tags. Maintenance does NOT appear here — it is a mode kind, not a flag
   (G0-9 folded `maintenance_mode` away).
2. **Safety override (pre-CASE, structural).** `IF NOT #gates_ok AND Cur_St NOT IN {aborting,
   aborted} THEN Cur_St := <target idx>` — the G0-9 "safety gate → aborting" rule is enforced
   by the writer, never dependent on authored transitions. Target = the unit's declared
   `aborting` state, else `aborted`, else `stopped`; if none of the three is declared, emit a
   warning and skip the override (EM-level force-to-safe still applies). (EM-level force-to-safe via
   `is_safe_state` continues to exist independently; no duplication — the unit mirrors the event
   into its own SM.)
3. **Mode manager.** Consumes `UN_<Unit>.Mode_Req` (mode index+1; 0 = none): validates with a
   **compile-time expansion of `isModeChangeLegal`** — (a) current unit state's
   `mode_change_allowed`, (b) each member EM's current `state` Int ∈ that EM's allowed-index set
   for the target mode (indices resolved at compile time from `EmStateV2.allowed_modes`; empty
   mask = always legal), (c) current unit state in target mode's mask. Grant → `Cur_Mode`
   update; request always cleared. `Mode_Change_Legal` (live HMI bool) = current state's
   `mode_change_allowed` — v1 simplification; the full per-target check runs on the actual
   request. The TS helper stays the single source of truth for UI/validation; the writer emits
   its ST equivalent.
4. **State CASE (G2-1).** `Cur_St : Int`, indexing the unit's declared states ordered per the
   canonical `UNIT_PACKML_STATES` order (G0-9 PackTags rule; G7-1 text lists share this order).
   Per-state transition guards:
   - `command` triggers ← `UN_<Unit>.St_Cmd` word (constants: 1 start, 2 stop, 3 hold,
     4 unhold, 5 suspend, 6 unsuspend, 7 reset, 8 clear, 9 abort; consumed + cleared each scan).
   - `condition` triggers ← serialized `PermissiveCondition[]` against global tags.
   - `em_aggregate` triggers ← `"EM_<x>_DB".state = <idx>` comparisons, `em_scope` "all" = AND
     over members, array = AND over the listed EMs; the PackML slug in `em_state` resolves to
     each EM's own dispatch index at compile time. Unknown slug for an EM → compile warning +
     guard rendered FALSE (never silently true).
   - `guard` arrays AND onto the trigger; transition/state `allowed_modes` masks compile to
     `Cur_Mode` membership guards (empty = all modes).
5. **Command assertion (G2-3).** By current mode kind:
   - **engineering** → release: skip the entire assertion block (`RETURN`-style guard placed so
     safety aggregation, SM, and PackTags mirror still run) — the HRE `seq_test_mode` pattern.
   - **maintenance** → assert STOP to every member EM (design rule "drives commanded to
     Stopped"), overrides ignored.
   - **otherwise** → canonical map by `Cur_St` (`CANONICAL_EM_COMMAND_MAP`) with
     `em_command_overrides` applied per EM. Writes each member's `<EM>_CMD` DB pins every scan:
     selected pin TRUE, the other five FALSE; NONE → all six FALSE (hold last).
   - **Matched library-FB EMs (C5 path):** no command contract exists yet → emit a clearly
     marked `// TODO: wire unit command to <EM> (library FB <template> — no command-role pins
     in its interface contract yet)` block + compile warning. Follow-up (parked): add command
     roles to `FbInterfaceContract` so library EMs join the seam.
6. **PackTags mirror.** `UN_<Unit>.Cur_St/Cur_Mode` ← statics; `EM_St[i]` ←
   `"EM_<x>_DB".state` in member declaration order = `hierarchy.units[].equipment_modules`
   array order (the same order G7-1's text-list generator must use).

## Decision 4 — Files

- **New:** `src/lib/spec-builder/codegen/unit-builder.ts` — pure IR builder: resolved state
  indices, per-state × per-EM command table (overrides applied), legality expressions, resolved
  triggers, warnings. `src/lib/spec-builder/codegen/unit-writer.ts` — SCL emission from the IR
  (mirrors the em-builder/em-writer split and its formatting conventions).
- **Modified:** `em-builder.ts` (+2 pins, OR-in mapping, coverage warnings), `em-writer.ts`
  (render OR'd triggers), `em-command-seam.ts` (6 pins), `compile-contract.ts` (real path when
  `unit_coordination[unit_id]` exists, stub + warning otherwise), `ob1-writer.ts` (UC call
  before the unit's EM calls; fixed call template).
- All pure (no React/IO); artifacts `layer: "unit"` — the Code Builder UI's existing unit layer
  displays them with zero UI changes.

## Non-goals / deferred

- G2-4/G2-5/G2-6 (need G0-3/G0-4). Hand-authored routing FCs remain the bridge.
- Command roles on `FbInterfaceContract` (library-EM seam) — follow-up.
- Suspend semantics for EMs (`EmCommand` has no SUSPEND; unit suspending/suspended assert NONE
  per canonical map — revisit with a real use case, per G0-9 final review note).
- Mode-kind backfill for pre-G0-9 projects (G0-9-F1, board row 3058757514) — MUST land with or
  before this wave's first real use on an existing project, since this writer is the first
  kind-consumer. The writer itself treats kinds structurally; backfill is a data concern.

## Testing

Vitest, all fixtures machine-generic except the named HRE parity fixture:
1. **Seam regression** (em-builder/em-writer): pins OR'd only into command-triggered transitions
   of matching to-state families; completion transitions untouched; non-canonical state → no OR
   + warning; 6 pins present in FB interface + CMD DB + seam bindings.
2. **unit-builder IR:** canonical-order state indexing, `em_aggregate` slug→index resolution
   (incl. unknown-slug FALSE + warning), mode-mask guards, legality expression expansion,
   command table with overrides, maintenance/engineering kind handling.
3. **unit-writer golden output:** stable SCL snapshot for a small generic 2-EM unit.
4. **compile-contract integration:** bundle contents + OB1 ordering (UC before EMs), stub
   fallback + warning when `unit_coordination` absent, library-EM TODO + warning.
5. **HRE parity fixture:** generated `UC_Carriage`-shaped command block asserts the same
   `EM_*_CMD` levels as the hand-written `UC_Carriage.scl` command-routing section for the
   ok / not-ok / engineering-mode cases (structural parity, not text parity).
