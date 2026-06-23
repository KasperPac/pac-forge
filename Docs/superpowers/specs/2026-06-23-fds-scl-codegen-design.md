# FDS → SCL Code Generation — Design

**Date:** 2026-06-23
**Status:** Approved design (pending user sign-off)
**Module:** Spec-builder code generation

## Problem

We have a confirmed, unambiguous FDS (`SpecContractV2`). We need to turn it into
compilable Siemens SCL. The FDS is "the bible": every generated line must be
derived from a field in the contract. No AI is used at code-generation time — the
compiler is pure and deterministic. (AI is only used, where it already exists, to
match a device to a library FB.)

The house automation pattern is the **S/A (Step/Action) sealed-step sequencer**:
parallel `S[]` (step active) and `A[]` (action active) bit arrays, where step bits
seal forward on advance conditions and actions are driven from step bits and wired
to device/FB inputs. We reproduce that pattern in SCL.

## Confirmed decisions

1. **Start clean, FDS-first.** Do not inherit the old 7-stage Process Builder
   (`use-process-pipeline.ts`, `forge-process-compiler-v2.ts`). New module.
2. **Deterministic.** No AI at codegen. FDS is the single source of truth.
3. **Pre-built library FBs.** Control Modules (motors, VSDs, sensors, buttons) and
   Equipment Modules (conveyors, etc.) already have FBs in the library
   (`fb_templates`). The compiler instantiates and wires them — it does **not**
   generate their bodies, and it does **not** generate EM state machines (the EM FB
   owns its state machine).
4. **The engine is sequence logic, not an FB.** One **S/A sequencer per Unit**,
   backed by a UDT + sequence DB + an SCL FC.
5. **Output language = SCL.**
6. **Missing FB → emit a stub FB** with the correct IO interface so the project
   compiles end-to-end; the body is filled in later. Stubs are listed in a report.
7. **Step order follows EM transitions** (walk from the safe/home state through
   reachable states in transition order), not raw declaration order.

## Where the per-Unit sequence comes from

The confirmed FDS holds **per-EM** state machines only (`equipment_modules[emId]`
with `states[]`, `transitions[]`, `static_states`, `sequential_states`). There is
**no** hand-authored unit-level step list (the old `unit_procedures` layer was
removed in the hybrid merge). Cross-EM relationships live in transition `guard`
permissives (which may reference other EMs' tags).

Therefore the per-Unit S/A sequencer is **compiled from existing per-EM data** — no
extra authoring required:

| S/A element | Derived from |
|---|---|
| Steps (per EM) | `EmStateV2[]`, ordered by walking `EmTransitionV2[]` from the safe/home state |
| Advance condition `S[n]→S[n+1]` | the transition's `trigger` (command `expr` or `completion`) **AND** its `guard[]` permissives, serialized machine-language (`AND`/`OR`, no prose) |
| Action `A[n]` held outputs | `static_states[state_id].control_modules[]` device states; sequential states' `steps[].actions[]` |
| Action → FB input wiring | each held device state maps to the matched FB's input pin |

The same machine-language serialization rule we just applied to the
operating-sequence view applies here, but read from the **raw contract**
(`PermissiveCondition.{tag,operator,value}`), not the display strings.

## Architecture

New module tree (deliberately **outside** the pipeline-auditor globs —
`use-forge-*`, `use-pipeline-*`, `*-prompt*`, `forge-*`, `pipeline.ts`):

```
src/lib/spec-builder/codegen/
  types.ts              # CodegenArtifact, CodegenResult, StubReport, SaSequence (internal IR)
  serialize-condition.ts# PermissiveCondition[] / EmTrigger → machine-language SCL boolean string
  step-order.ts         # walk EmTransitionV2[] from safe state → ordered EmStateV2[]
  sa-builder.ts         # EquipmentModuleContract[] (one Unit) → SaSequence IR
  udt-writer.ts         # SaSequence → UDT_<unit> SCL (S[]/A[] arrays + control bits)
  db-writer.ts          # SaSequence → DB_<unit> instance DB of the UDT
  fc-writer.ts          # SaSequence → UC_<unit> FC SCL (3 network groups)
  fb-instantiate.ts     # ControlModule/EM → matched library FB call + IO wiring (or stub)
  ob1-writer.ts         # OB1 call tree (CM → EM → UC), manifest topo order
  compile-contract.ts   # top-level: SpecContractV2 → CodegenResult (orchestrates the above)
  __tests__/...
```

A thin hook (e.g. `src/hooks/use-spec-codegen.ts`) loads the confirmed contract via
`loadSpecContract`, calls `compileContract`, and hands the artifacts to the existing
`artifact-parser → manifest-builder → tia-export` plumbing for the TIA bundle. A
button on the spec/co-author page triggers it.

## Generated artifacts (per Unit)

### 1. UDT — `UDT_<Unit>`
```
TYPE "UDT_<Unit>"
STRUCT
   S   : ARRAY[0..N] OF BOOL;   // step active
   A   : ARRAY[0..M] OF BOOL;   // action active
   Stop      : BOOL;
   Running   : BOOL;
   Resume    : BOOL;
   Reset     : BOOL;
   StartReject : BOOL;
END_STRUCT
END_TYPE
```
N = number of steps for the Unit (sum of its EMs' steps), M = number of actions.

### 2. Sequence DB — `DB_<Unit>`
An instance DB of `UDT_<Unit>` holding the live S/A state.

### 3. Sequence FC — `UC_<Unit>` (three network groups)
- **Step transitions** (one assignment per step):
  `S[n] := ((S[n-1] AND <advance>) OR S[n]) AND NOT S[n+1];`
  `S[0]` (safe/home step) held live at rail. `Reset` forces back to `S[0]`.
- **Actions:** `A[n] := S[n];` (an action OR'd from multiple steps where the same
  output is held in several states).
- **Action → FB-input wiring:** `<EM_FB>.<input> := A[n] [AND <gate>] [AND <TON>];`
  device-held outputs from `static_states` map onto the matched FB's input pins.

### 4. CM/EM FB instances + IO wiring
For each Control Module: instantiate its matched library FB (`CM_` prefix), wire
`io_signals[]` (DI/DO/AI/AO + `io_address`) to FB pins. For each Equipment Module:
instantiate its matched library FB (`EM_` prefix). Missing match → **stub FB** with
the correct interface, recorded in `StubReport`.

### 5. OB1
Calls in `manifest-builder` topological order: CM FBs → EM FBs → `UC_` sequencers.

## Reuse (no changes needed)

- `loadSpecContract` — load confirmed FDS.
- `forge-device-matcher` / `use-forge-ai-device-match` — device → library FB match.
- `fb_templates` (`use-fb-templates`) — library FB source.
- `artifact-parser`, `manifest-builder`, `simatic-xml-builder`, `tia-export` —
  output plumbing to the TIA bundle.

## Out of scope (this pass)

- LAD output (SCL only for now).
- A separate, hand-authored unit-level step list (we compile from EM data).
- Regenerating EM state machines (library EM FBs own them).
- Editing the S/A in the UI (compiled artifact, not authored).

## Testing

Pure functions → unit tests with synthetic `EquipmentModuleContract` fixtures:
- `serialize-condition` — permissive/trigger → exact SCL boolean (AND/OR/NOT, no prose).
- `step-order` — transition walk yields safe-state-first ordering; handles cycles.
- `sa-builder` — EM contracts → expected `SaSequence` IR (steps, advances, actions).
- `fc-writer` — seal-in line shape `S[n] := ((S[n-1] AND adv) OR S[n]) AND NOT S[n+1]`.
- `fb-instantiate` — matched FB wiring + stub fallback + `StubReport`.
- A golden end-to-end test compiling a small 2-EM fixture to SCL.

## Risks / notes

- **Generic, not project-specific.** No HRE/Segment-Wagon names in the compiler.
  Tests use synthetic machines (conveyor + lift, not the live spec) to prove this.
- **Inter-EM guards** reference other EMs' tags — serialized verbatim from the
  contract; resolution is the PLC's job at runtime, not the compiler's.
- **Parallel transitions** (`kind:"parallel"`, AND-split) in sequential states are
  handled in `sa-builder` by emitting concurrent step lanes; first pass may flatten
  to sequential if a Unit has none (HRE is digital-IO, simple flows).
