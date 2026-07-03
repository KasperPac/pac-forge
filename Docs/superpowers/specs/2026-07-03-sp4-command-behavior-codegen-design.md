# SP-4 — Command-Behavior Codegen (Design)

**Date:** 2026-07-03
**Slice:** SP-4 of the PackML EM-state initiative (final slice). Predecessors SP-1 → SP-3d all shipped (`Docs/HANDOVER-PACKML-INITIATIVE-2026-07-03.md`).
**Scope decision:** SP-4 codegen only. Open tickets #3 (Generate Spec Sections button) and #4 (granularity CHECK-constraint violation) are explicitly out of scope — sequence them as a follow-up slice.

## Problem

The deterministic Code Builder ignores `command_behavior`. A command-driven PackML state (Carriage Drive / Rotator Drive `execute`) authored per SP-3c has no steps — its behaviour is command-conditional device holds — so `buildEmSequence` lowers it to an empty `CASE #step OF … END_CASE` and nothing emits the branches. `src/lib/spec-builder/codegen/` contains zero references to `command_behavior` today.

Carry-in from the SP-3b final review: codegen branches on the authored `EmStateV2.kind`, but nothing verifies it matches the canonical PackML `state_pattern` (Segment Wagon's brake EM has `execute` authored `static`, with its holds in `static_states`).

## Goal

`compileContract` emits, for every state with `command_behavior`, a deterministic branch-conditional hold body (IF command+guards THEN holds … defaults otherwise) inside that state's CASE branch — replacing the empty CASE / ai-fill gap — and `kind` is derived from the PackML slug rather than trusted.

## Decisions (user-approved)

1. **Scope**: codegen only; tickets #3/#4 deferred.
2. **Symbolic setpoint values** (e.g. `VSD2_Speed_Ref: JOG_SPEED_CW` on an Int pin): become **`sp_<name> : Int` VAR_INPUT pins**, driven from the CMD DB via the existing command seam, so commissioning values are set in the data block, not code. Signed numeric literals assign directly.
3. **Kind**: **derive in codegen** from `packmlStateBySlug(state_id)?.state_pattern` (authored kind is the fallback for legacy non-PackML slugs) **and** add the kind-matches-pattern check to `validateEmPackmlConformance` so Stage A rejects future mismatches. `validateSpecContractPatch` stays untouched — existing specs keep loading.
4. **Architecture**: extend the IR (approach A). Builder (`em-builder.ts`) is the only reader of the contract; writer (`em-writer.ts`) stays a pure IR serializer. Rejected: rendering from the contract inside the writer (breaks the IR boundary), and encoding branches as synthetic steps (branches are mutually-evaluated holds, not a sequenced SFC).

## Design

### 1. Lowering (`em-builder.ts`)

Per state, rendering is **data-driven** with this precedence:

1. `command_behavior[state_id]` present (any branches or default_hold) → **command rendering** (new)
2. `sequential_states[state_id]` has steps → step CASE (existing)
3. `static_states[state_id]` has entries → static holds (existing — keeps brake's mis-authored `execute` rendering, now with a kind-mismatch warning)
4. nothing → empty branch (existing `;` fallback)

`kind` no longer solely picks the rendering; the derived kind still drives `#step`-reset-on-entry semantics and warnings.

Lowering one `CommandBranch`:
- `when` → SCL condition via the existing `serializeGuard(when, pinRef)` (own inputs → `#fb_`, own outputs → `#cmd_`, foreign tags → `#ilk_`).
- Each `control_modules` entry `{tag, state}` → an assignment to the actuator pin:
  - **Bool pin**: `isActiveCommand(state)` → `TRUE`/`FALSE` (existing token table).
  - **Int pin**, `state` parses as a signed number → the numeric literal.
  - **Int pin**, symbolic name → `#sp_<sclIdent(state)>` setpoint pin, deduped per EM.

**Anti-latch rule**: compute the union of all tags across all branches + default_hold. Emit every union tag's default assignment first (default_hold value if present, else inactive `FALSE`/`0`), then the IF/ELSIF chain overrides per active branch. Sequential last-write-wins gives one clean scan, no ELSE clause, and no actuator ever latches a stale branch's value.

**Defensive XOR**: authoring enforces steps-XOR-branches, but if a contract carries both, command rendering wins + a warning.

IR additions (`types.ts`):
- `EmSeqState.commandBranches: { label: string; condition: string; holds: { pin: string; value: string }[] }[]` and `EmSeqState.commandDefaults: { pin: string; value: string }[]` — both required, empty arrays for non-command states (mirrors how `steps`/`staticCommands` are always present).
- `EmSequence.setpointPins: string[]` (deduped, insertion-ordered).

### 2. Emission (`em-writer.ts`)

Command-state CASE branch shape:

```scl
6:   // Execute
   // command-conditional holds (defaults first, active branch overrides)
   #cmd_CM1_Run := FALSE;
   #cmd_VSD1_Speed_Ref := 0;
   IF (#fb_Fwd = TRUE) AND (#fb_Brake_Open = TRUE) THEN
      // Drive Forward (Jog)
      #cmd_CM1_Run := TRUE;
      #cmd_VSD1_Speed_Ref := #sp_JOG_SPEED_FWD;
   ELSIF ... THEN
      ...
   END_IF;
   IF #cmd_stop THEN #state := 7; #done := FALSE; END_IF;
```

- Branch `label` becomes a comment — the FDS-to-code audit thread.
- **No ai-fill region** in command states: fully deterministic. Regions only ever came from steps, so `use-em-generate` / the fill prompt need zero changes.
- **`#done` is never set** in a command state (hold-until-commanded); exits remain the contract transitions, emitted by the existing exit machinery unchanged.
- `sp_*` pins render in `VAR_INPUT` after the fixed cmd pins and flow into the CMD DB + OB1 call bindings via the existing `buildCommandSeam` (Int already supported — `mode`).
- Warning per EM listing generated setpoint pins: `EM <name>: setpoint pins sp_A, sp_B — set commissioning values in EM_<name>_CMD`.

### 3. Stage-A conformance (`em-state-machine.ts`)

`validateEmPackmlConformance` gains: for each state whose `state_id` is a PackML slug, authored `kind` must equal the canonical `state_pattern`, else an issue. Runs only in the existing Stage-A hard gate (`validateEmStateMachineAndPackml`); `validateSpecContractPatch` untouched.

### 4. Testing & verification

- `em-builder.test.ts`: branch lowering; precedence order (command > steps > static); XOR-conflict warning; anti-latch union defaults; bool vs numeric vs symbolic hold values; setpoint dedup; kind derivation (PackML slug overrides authored kind; legacy slug keeps authored kind).
- `em-writer.test.ts`: IF/ELSIF shape; defaults-first emission; sp_ pins in interface, CMD DB, and call bindings; no ai-fill markers in command states; `#done` untouched.
- `em-state-machine.test.ts`: conformance check accepts matched kinds, rejects mismatches, ignores non-PackML slugs.
- Fixtures are **generic** (per the non-negotiable rule): one command-driven EM with bool holds + one with setpoint-only holds (no motor DO) — modeled on but not named after the Segment Wagon devices.
- Bar: `npx tsc -b` clean; full `npx vitest run src/lib/spec-builder` green; live Code Builder check on the PACKML spec (`8913bad6-7040-4908-bbb3-67f16a501802`) — Carriage Drive + Rotator Drive `execute` show branch chains, only the expected setpoint-commissioning warnings appear.

## Files touched

| File | Change |
|---|---|
| `src/lib/spec-builder/codegen/types.ts` | IR: `commandBranches`/`commandDefaults` on `EmSeqState`, `setpointPins` on `EmSequence` |
| `src/lib/spec-builder/codegen/em-builder.ts` | Data-driven rendering precedence, kind derivation, branch/hold lowering, setpoint pin collection, anti-latch defaults |
| `src/lib/spec-builder/codegen/em-writer.ts` | Command-branch emission, sp_ pins in interface + command seam |
| `src/lib/spec-builder/em-state-machine.ts` | Kind-matches-pattern check in `validateEmPackmlConformance` |
| Tests co-located in `__tests__/` | Per section 4 |

Non-goals: matched library EMs (Cases A/B — the library FB owns its internals), the Unit coordinator (sub-project D), tickets #3/#4, any renderer/DOCX change (SP-3c already renders branches).
