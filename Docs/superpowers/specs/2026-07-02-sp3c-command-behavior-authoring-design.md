# Design: SP-3c — Stage B command_behavior Authoring

**Date:** 2026-07-02
**Status:** Design approved — ready for implementation plan
**Scope:** The Stage B slice of SP-3 ("PackML everywhere"). Lets the co-author's behavior interview author `command_behavior` — command-conditional device holds for acting PackML states — and adds the full persistence pipe (session column, contract read/write, DOCX rendering, validation). **No codegen changes (SP-4). No Stage A changes (shipped in SP-3b).**

## Why

SP-3b evicted manual motions from the Stage A state list: "Drive Forward" is no longer a state — it is behaviour performed *while in* `execute`, driven by command inputs. SP-3a gave the contract the construct to hold that model (`command_behavior?: Record<state_id, CommandBehaviorV2>` on `EquipmentModuleContract`), but nothing authors, persists, reads, or renders it:

- `fds_operation_sessions` has no `command_behavior` column; `OperationSession` has no field.
- `upgradeEquipmentModuleContracts` (contract.ts:365) builds contracts without it; `writeSpecContract` (contract.ts:980) does not persist it.
- Stage B (`fds-prompts.ts`) only authors ordered `steps` into `sequential_states`.
- The DOCX operating-sequence view renders only steps — an authored command state would be invisible in the exported FDS.

SP-3c closes that loop end to end. SP-4 then reads `command_behavior["execute"]` to emit the command-branched Execute `CASE`.

## Decisions (locked during brainstorming)

1. **Integrated into Stage B, not a new stage.** The behavior interview handles both natures: for a command-driven acting state it authors `command_behavior` branches; for an automatic state it authors ordered steps exactly as today. Routed by the emitted JSON shape.
2. **Steps XOR branches per state.** A given acting state is EITHER an automatic step-sequence OR a command-driven motion set — never both. The emitted block carries either `steps` (existing) or `command_behavior` (new); mutual exclusion is enforced at persist.
3. **New jsonb column + migration.** `command_behavior jsonb` (nullable, additive) on `fds_operation_sessions`, mirroring how `em_states`/`em_transitions` are stored. Requires `npx supabase db push` at deploy — flagged, not run, by the implementation.
4. **Any sequential state may carry it; the interview focuses on `execute`.** The SP-3a validator already enforces sequential-only keys. Nothing hardcodes the `execute` slug.
5. **DOCX rendering is in scope** — a minimal row-per-branch table (label + when-condition + holds), so authored manual motions do not silently vanish from the exported FDS.

## Non-Goals (this slice)

- **Codegen (SP-4)** — emitting the command-branched Execute `CASE` from `command_behavior`.
- **Segment Wagon re-author (SP-3d).**
- **PackML slug enforcement in `validateSpecContractPatch`** — the SP-3b Stage-A-only boundary stands. The new `validateCommandBehavior` wiring is safe (see Validation): it only fires when `command_behavior` is present, which pre-SP-3c specs never have.
- **Editing UI for command_behavior** in the Structured Spec Editor beyond read-only DOCX-view parity — authoring happens through the co-author conversation.
- **HMI/faceplate implications** of command inputs.

---

## 1. The authoring model

A **`CommandBranch`** (SP-3a shape, unchanged) models one commanded motion:

```ts
{ branch_id: "drive_fwd", label: "Drive Forward",
  when: [ { tag: "CAR_CMD_FWD", operator: "=", value: true },       // command input
          { tag: "CAR_LS_FWD",  operator: "=", value: false } ],    // interlock guard, AND-ed
  control_modules: [ { tag: "CAR_M01_FWD", description: "...", state: "on" } ] }  // holds while `when` is true
```

**`CommandBehaviorV2`** per state = `{ branches: CommandBranch[], default_hold: ControlModuleStateEntry[] }`. `default_hold` is what the devices hold when no branch's `when` is active — typically the safe/off values. Both leaf shapes reuse existing types (`PermissiveCondition`, `ControlModuleStateEntry`); no new leaf types.

Interlocks fold into `when` (AND-ed with the command condition). Branch mutual exclusion is expressed through the `when` conditions themselves (e.g. FWD and REV command tags cannot both be true); the runtime evaluation discipline is SP-4's concern.

## 2. Persistence layer

**a) Migration** — `supabase/migrations/<timestamp>_command_behavior.sql`:

```sql
alter table fds_operation_sessions
  add column if not exists command_behavior jsonb;
```

Nullable, additive, zero backfill. Existing rows read `NULL` → treated as absent, matching SP-3a's `.optional()` schema decision.

**b) Type** — `OperationSession` (src/types/spec-builder.ts:567) gains:

```ts
  // Command-conditional device holds per acting PackML state (SP-3c).
  // Keyed by EM-local state_id. Absent until Stage B authors one.
  command_behavior?: Record<string, CommandBehaviorV2>;
```

(type-only import of `CommandBehaviorV2` from `@/types/spec-contract-v2`.)

**c) Read path** — `upgradeEquipmentModuleContracts` (src/lib/spec-builder/contract.ts:365) passes the session column through into the contract entry:

```ts
      command_behavior:
        s.command_behavior && typeof s.command_behavior === "object"
          ? (s.command_behavior as EquipmentModuleContract["command_behavior"])
          : undefined,
```

`loadSpecContract` Zod-parses the assembled contract; the field is `.optional()`, so absent stays absent — no shim work.

**d) Write path** — `writeSpecContract`'s per-EM upsert row (contract.ts:980) gains `command_behavior: asm.command_behavior ?? null`, so revision snapshots and register assembly round-trip the field instead of dropping it.

**e) DOCX / operating-sequence rendering** — `buildEmOperationView` (src/lib/spec-builder/operating-sequence.ts) is the shared pure builder for both the DOCX exporter and the Structured Spec Editor (fix once, both update). It gains a per-command-state section: one row per branch — branch label, the `when` conditions joined with ` AND ` (machine-boolean convention, no natural language), and the holds (`tag: state` pairs) — plus a final `Default hold` row. Step-sequence states render exactly as today.

## 3. Stage B prompt reframe (`src/lib/spec-builder/fds-prompts.ts`)

**a) Nature determination.** The INTERVIEW PROTOCOL gains step 0, before permissives/steps: *"Is this state an automatic step sequence that runs to completion, or command-driven manual behaviour (operator holds a command, devices respond)?"* In grounded mode, PHASE 1 infers the nature from the customer spec and tags it "(assumption — confirm)".

**b) Command-driven path.** A new protocol section for command states — gather in order: the command input tags (operator/HMI/pendant); one branch per command (`branch_id`, `label`, `when` conditions including interlock guards, device holds while active); the `default_hold`. Tag-direction reuses the existing HARD RULE: `when` conditions reference INPUT tags; holds target OUTPUT tags.

**c) Response format.** The JSON array now admits two state-object shapes, discriminated by content:

- existing (unchanged): `{ "state_id": ..., "override_kind": "override", "permissives": [...], "steps": [...], "notes": ... }`
- new: `{ "state_id": ..., "command_behavior": { "branches": [ { "branch_id", "label", "when": [...], "control_modules": [...] } ], "default_hold": [...] } }`

with a full worked example: drive-forward/drive-reverse branches on generic illustrative command tags, mutual exclusion expressed in `when`, `default_hold` = outputs off.

**d) MUST NOT additions:** never emit both `steps` and `command_behavior` for the same state; never model a commanded motion as steps ("wait for operator to press X" is a branch, not a step); never invent command tag names.

**e) Completion semantics.** `ALREADY COMPLETED SEQUENTIAL STATES` and `SEQUENTIAL STATES REMAINING` treat a state as completed when it appears in **either** `sequential_states` or the session's `command_behavior` (the prompt builder gains the session's `command_behavior` record as an input). A completed command state renders its branch count instead of step count. The opening message is unchanged (nature determination happens inside the interview).

## 4. Persist routing (`src/hooks/use-fds-conversation.ts` — `processAiResponse`)

Each extracted JSON block routes on shape:

- **`block.command_behavior` present** → new path:
  1. `CommandBehaviorV2Schema.safeParse(block.command_behavior)` — shape gate.
  2. Patch-level gate through the existing two-stage machinery: build a per-EM patch whose `command_behavior` is `{ ...session.command_behavior, [stateId]: parsed }` (alongside the session's existing states/transitions/static/sequential), `SpecContractPatchSchema.safeParse`, then `validateSpecContractPatch` — which now includes `validateCommandBehavior` (see §5).
  3. **Mutual exclusion:** if the state already has authored `steps` in `session.sequential_states[stateId]` (or a steps-block for the same state arrives in the same response), reject with a validation-failure turn telling the engineer to clear the other shape first. Symmetrically, a steps-block for a state with persisted `command_behavior` is rejected.
  4. Failures → the existing `buildValidationFailureTurn` path. Valid → merge into the session's `command_behavior` column (same merge pattern as `sequential_states`).
- **otherwise** → the existing steps path, byte-for-byte unchanged.

`resolveStateId` applies to both shapes (command blocks name a sequential state too).

## 5. Validation

Three additive layers:

- **Zod shape** — shipped in SP-3a (`CommandBehaviorV2Schema`, `when.min(1)`).
- **New pure `validateCommandBehavior(em): string[]`** in `src/lib/spec-builder/em-state-machine.ts`:
  - duplicate `branch_id` within a state's `branches` → issue;
  - when `em.states` is non-empty: each `command_behavior` key must match an existing state with `kind === "sequential"` (same rule `validateEmPackmlConformance` enforces at Stage A — re-checked here so the Stage B path is guarded even though the two validators fire on different gates);
  - a branch with empty `control_modules` is legal (a "hold nothing" branch) — no check;
  - `em.command_behavior` absent/empty → `[]`.
- **Wired into `validateSpecContractPatch`'s per-EM loop** (contract.ts ~1184, beside the existing `validateEmStateMachine` call). **SP-3b boundary safety:** this adds NO PackML slug enforcement; `validateCommandBehavior` returns `[]` whenever `command_behavior` is absent, which is true for every pre-SP-3c spec — existing free-slug specs' Stage B is untouched.
- **Mutual exclusion lives at the hook persist** (§4.3), not in the pure validator — the validator sees one contract, not the which-shape-came-first session state.

## Architecture / data flow

```
fds-prompts.ts  Stage B interview (nature: automatic | command-driven)
      │ automatic                          │ command-driven
      ▼                                    ▼
{ state_id, steps[] }              { state_id, command_behavior: {branches[], default_hold[]} }
      │                                    │
use-fds-conversation.ts processAiResponse — routes on shape; XOR enforced
      │                                    │  CommandBehaviorV2Schema → patch gate
      ▼                                    ▼  (incl. validateCommandBehavior)
fds_operation_sessions.sequential_states   fds_operation_sessions.command_behavior  (NEW column)
      └────────────────┬───────────────────┘
                       ▼
contract.ts  upgradeEquipmentModuleContracts → EquipmentModuleContract.command_behavior
             writeSpecContract → round-trips the column
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
operating-sequence.ts / docx-exporter  SP-4 codegen (future): command-branched Execute CASE
  row-per-branch table
```

## Files

- **New:** `supabase/migrations/<timestamp>_command_behavior.sql` — nullable jsonb column.
- **Edit:** `src/types/spec-builder.ts` — `OperationSession.command_behavior?`.
- **Edit:** `src/lib/spec-builder/contract.ts` — read (upgrade), write (upsert row), `validateCommandBehavior` wiring in `validateSpecContractPatch`.
- **Edit:** `src/lib/spec-builder/em-state-machine.ts` — `validateCommandBehavior`.
- **Edit:** `src/lib/spec-builder/fds-prompts.ts` — nature question, command-shape protocol + response format + MUST NOTs, completion semantics (new `commandBehavior` parameter).
- **Edit:** `src/hooks/use-fds-conversation.ts` — block routing, merge, mutual exclusion; passes `session.command_behavior` to the prompt builder.
- **Edit:** `src/lib/spec-builder/operating-sequence.ts` + `docx-exporter.ts` — row-per-branch rendering (spec-editor.tsx picks it up via the shared builder if its view consumes the same structure; otherwise editor parity is limited to what the shared builder feeds it).
- **No change:** `spec-contract-v2.ts` (schema shipped in SP-3a), `em-state-machine-prompts.ts` (SP-3b), `codegen/*`.

## Testing

- **`validateCommandBehavior` (pure):** absent/empty → `[]`; duplicate `branch_id` flagged; key on a static state flagged (states present); key on unknown state flagged; canonical command_behavior on `execute` with PackML states → `[]`.
- **Prompt (pure):** nature-determination question present; command JSON shape + worked example present; XOR MUST NOT present; a state present in the passed `command_behavior` record renders as completed (branch count) and is absent from REMAINING.
- **Contract round-trip (pure/mocked):** a session row with `command_behavior` populates the contract field; a row without it yields `undefined`; `writeSpecContract` includes the column in the upsert row.
- **Operating-sequence view (pure):** a command state yields row-per-branch (+ default hold row) with ` AND `-joined conditions; a steps state renders unchanged (regression).
- **Hook-level routing:** verified at the pure/composition level (same accepted tradeoff as SP-3b — no Supabase/streaming mount).
- **Self-check:** `npx tsc -b` clean; suites green; `fds-prompts.ts` matches `*-prompt*.ts` → generic re-read (worked example must use illustrative tags only, valid for any machine type).

## Generic-rule compliance (CLAUDE.md)

The nature question, command-shape protocol, and worked example are machine-type-agnostic (a conveyor's jog, a carriage's drive, a filler's manual dose all fit branch/when/holds). No project/device names from `Docs/Functional Specs/`. Post-task self-check: generic re-read of `fds-prompts.ts` + `npx tsc -b` + suites.

## Verification

- `npx tsc -b` clean.
- `npx vitest run src/lib/spec-builder/__tests__/em-state-machine.test.ts src/lib/spec-builder/__tests__/fds-prompts.test.ts src/lib/spec-builder/__tests__/operating-sequence.test.ts` (plus the contract round-trip suite) green.
- Migration applies cleanly (`npx supabase db push` — deploy step, flagged for the user).
- Manual: co-author a fresh EM → Stage A produces PackML states → Stage B asks the nature question for `execute` → answering "command-driven" yields a branches interview → persisted `command_behavior` appears in the session row and in the exported DOCX as a branch table.
