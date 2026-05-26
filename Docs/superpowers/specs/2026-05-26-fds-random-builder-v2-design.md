# FDS Random Builder — V2 Rewrite

**Status:** Design. Implementation plan follows.
**Branch:** `feature/fds-engine-phase3` (continues the V2 work).
**Related:** [Phase 1 schema](2026-05-25-fds-engine-phase1-schema.md) · [Phase 2 wizard](2026-05-25-fds-engine-phase2-wizard.md) · [Phase 3 V2 prompts](2026-05-25-fds-engine-phase3-v2-prompt-design.md)

## 1. Goal & non-goals

### Goal

Replace the current random FDS builder so that every spec it produces is V2 by construction — numeric `state_id`, structured `CompletionCriterion`, `StepV2`, `SharedPermissive[]`, `InterAssemblyInterlock[]` — and passes `validateSpecContractPatch` end-to-end. The builder must always produce a fully complete spec (wizard data + sections + assembly sessions + orchestration) in one click.

### Non-goals

- **V1 emission path.** Deleted, not migrated. There are no real V1 projects in the system.
- **AI authoring of validator-bound structure.** The AI never produces a `state_id`, a `CompletionCriterion`, an interlock, or anything the V2 schema constrains.
- **Variety of spec structure.** Every generated spec uses the same canonical state machine and the same interlock patterns. Naming and prose vary; structure does not. This is intentional for the dev-fixture use case.
- **Replacing the live wizard/orchestration prompts.** Phase 3 already shipped those; the random builder is a separate path.
- **Reusing the existing `generateSpec` orchestrator for functional descriptions.** The random path renders those sections deterministically from V2 step tables; the live wizard keeps using `generateSpec` unchanged.

## 2. Architecture

Two-stage pipeline:

```
Stage 1 (AI, ~1k output tokens) ──► RandomFdsTheme
  • title, system_description, plc_model, hmi_type
  • fault_philosophy, design_principles[]
  • machine_theme (free-form flavour string)
  • subsystem_names[], assembly_names[], device_specs[]
    (names + device_class only — NO state machine, NO IO, NO sequences)
       │
       ▼
Stage 2 (deterministic, all in code) ──► V2 SpecContractPatch
  • Hierarchy with UUIDs + IO addressing (per-subsystem byte ranges)
  • Canonical V2 state machine (numeric state_id 1..N, PackML-aligned)
  • Alarm tiers + small canonical alarm set
  • Per-assembly StepV2[] from device-class templates
  • CompletionCriterion[] (tag_equals / tag_compare, structured)
  • SharedPermissive[] + InterAssemblyInterlock[] from canonical rules
       │
       ▼
Validator gate (writeSpecContract → Zod safeParse + validateSpecContractPatch)
       │
       ▼
Direct DB writes for tables the writer doesn't cover yet:
  • instrument_register, spec_sections (rendered from step tables),
    fds_assembly_sessions (V2-shaped), fds_subsystem_orchestrations (V2-shaped)
```

The AI is fenced into "name and flavour"; it cannot produce schema-breaking output. The deterministic builder owns every shape the validator checks.

### 2.1 Code layout

New files under `src/lib/spec-builder/random/`:

| File | Responsibility |
|---|---|
| `theme-prompt.ts` | Stage 1 system prompt (~80 lines, returns the small JSON above) |
| `theme-schema.ts` | Zod schema for `RandomFdsTheme` |
| `state-machine.ts` | Canonical V2 state machine (5–7 states, all numeric IDs) |
| `io-allocator.ts` | Per-subsystem byte ranges for `%I/%Q/%IW/%QW` allocation |
| `device-templates.ts` | `Map<DeviceClass, { ioSignals[], stepTemplate }>` — heart of structural variety |
| `sequence-builder.ts` | Walks assemblies/devices, emits V2 `StepV2[]` per sequential state |
| `orchestration-builder.ts` | Emits `SharedPermissive[]` + `InterAssemblyInterlock[]` from canonical rules |
| `section-renderer.ts` | Renders `spec_sections.functional_description.content_json` from V2 step tables (so DOCX export stays correct) |
| `assemble.ts` | Top-level orchestrator: theme → V2 patch → write |
| `__tests__/` | Unit tests per file + one end-to-end test that asserts a generated spec passes `validateSpecContractPatch` |

`useRandomFdsGenerate` becomes a thin wrapper over `assemble.ts`. The `RandomFdsDialog` component stays — only the `autoComplete` checkbox is removed.

## 3. Data flow & V2 surfaces touched

| Surface | Path | Shape |
|---|---|---|
| `spec_projects` row | `useCreateSpecProject` (existing) | unchanged |
| `confirmed_subsystems` (hierarchy) | `writeSpecContract({ hierarchy })` | V2 hierarchy with UUIDs |
| `confirmed_states` | `writeSpecContract({ states })` | V2 `OperatingStateV2[]` — numeric `state_id`, canonical PackML names |
| `alarm_tiers` | `writeSpecContract({ alarm_tiers })` | V2 `AlarmTier[]` |
| `alarms` (per-device) | `writeSpecContract({ alarms })` | V2 `Alarm[]` — canonical: each motor gets "fault", each safety device gets "tripped" |
| `confirmed_modes` | `writeSpecContract({ modes })` | Single default mode (matches Phase 3 single-mode emission) |
| `instrument_register` + tags | `useSaveInstrumentRegister` (existing) | unchanged shape; addresses allocated by `io-allocator.ts` |
| `spec_sections` (doc_control, system_overview, control_philosophy, io_list, alarm_spec, hmi, testing) | direct insert | rendered deterministically from theme + state machine + hierarchy — no AI |
| `spec_sections.functional_description` (per-state) | direct insert | rendered by `section-renderer.ts` from V2 step tables; `content_json` matches existing `generateSpec` output so DOCX export is unchanged |
| `fds_assembly_sessions` | direct insert | V2-shaped: `static_states_v2` (real V2 shape, not a V1 mirror), `sequential_states` with V2 `StepV2[]` + structured `CompletionCriterion`, `status: "complete"`, `static_confirmed: true` |
| `fds_subsystem_orchestrations` | direct insert | V2 `state_sequences` per sequential state: `assembly_order[]`, structured `SharedPermissive[]`, structured `InterAssemblyInterlock[]` |

### 3.1 V2 shape examples the deterministic builder produces

```ts
// CompletionCriterion (from src/types/spec-contract-v2.ts)
{
  kind: "tag_equals",
  tag: "LFT01_LS_TOP",
  value: true,
  within_ms: 5000,
  on_fail: { fault_code: "F_LFT01_TIMEOUT", severity: "fault" }
}

// StepV2
{
  step_id: 1,
  step_name: "Raise lift",
  actions: [/* ... */],
  completion_criteria: [/* <CompletionCriterion> */],
  transitions: [
    { kind: "default", target_step_id: 2, priority: 1, is_default: true }
  ]
}

// InterAssemblyInterlock (effects: hold | block_transition | trigger | enable | disable)
{
  interlock_id: "...",
  source_assembly: "<uuid>",
  source_condition: { kind: "tag_equals", tag: "...", value: true },
  target_assembly: "<uuid>",
  effect: "enable",
  effect_target: { assembly: "<uuid>", state_id: 3 },
  prose: "..."
}

// StepV2 — during the shim window BOTH v1 and v2 fields must be populated
// (step, action, completion_criteria, completion_criteria_text are required;
// step_id, branch_id, actions, transitions are SFC additions).
```

### 3.2 Canonical patterns

These are the only "magic" — kept small and explicit:

- **State machine** (numeric `state_id` = PackML `packml_id`): `IDLE(4, static)` → `STARTING(3, sequential)` → `EXECUTE(6, sequential)` → `COMPLETE(17, static)` → `STOPPING(7, sequential)` → back to `IDLE`, plus `E_STOP(8, static, mapped to PackML ABORTING)` reachable from anywhere.
- **Shared permissive (1 per subsystem)**: `E_STOP_CLEAR` — required for STARTING and EXECUTE.
- **Inter-assembly interlock (1 per pair of adjacent assemblies in declaration order)**: `effect: "enable"`, `source_condition: tag_equals(assembly[n].AT_HOME, true)`, `effect_target: { assembly: assembly[n+1], state_id: STARTING }`.
- **Device-class step templates**: ~6 templates (motor, valve, cylinder, sensor, conveyor, transporter) covering the device_class enum the existing prompt already lists.

The `parseCompletionCriteria` regex hybrid in the current hook is **deleted entirely**.

## 4. Error handling

| Failure | Handling |
|---|---|
| **Stage 1 AI failure** (network, abort, malformed JSON, Zod safeParse of `RandomFdsTheme` fails) | Surface `error`, clean up orphaned `spec_projects` row via `useDeleteSpecProject`. No retry — Stage 1 is cheap; user clicks again. |
| **Stage 2 deterministic failure** (`writeSpecContract` throws `ContractValidationError`) | This is a bug in our deterministic code, not user-fixable. Surface a loud error with the issue list, dump the offending patch JSON to the console, clean up the orphaned spec row, throw. Treat as a test-suite gap. |
| **Direct DB write failure** (instrument_register, spec_sections, assembly_sessions, orchestrations) | Surface error, clean up spec row, throw. Same `try/catch` pattern as today. |

**Cleanup** stays as-is — `if (createdSpecId) deleteSpec.mutateAsync(...)` in the catch block. Verify FKs from `spec_projects` → child tables are `ON DELETE CASCADE` and lean on that; otherwise add explicit cleanup.

**Abort handling** stays as-is — `AbortController` checked between Stage 1 and Stage 2, and inside long-running DB inserts.

**No retry-on-validator-failure system turn** (unlike the interview/orchestration hooks). The AI doesn't author validator-bound structure here; if Stage 2 fails it's our bug.

## 5. Testing

Per-file unit tests + one end-to-end integration test:

| Test file | Coverage |
|---|---|
| `__tests__/theme-schema.test.ts` | Zod schema accepts well-formed theme, rejects missing fields. Snapshot a representative theme. |
| `__tests__/state-machine.test.ts` | Canonical state machine has numeric IDs, contains IDLE + E_STOP, has at least 2 sequential states. |
| `__tests__/io-allocator.test.ts` | Given N devices per subsystem, addresses don't overlap across subsystems and respect Siemens format (`%I0.0`, `%QW80`). |
| `__tests__/device-templates.test.ts` | Every `DeviceClass` enum value has a template. Each template's step actions reference tags that exist on its IO signal set. |
| `__tests__/sequence-builder.test.ts` | Built `StepV2[]` passes Zod parse against `StepV2Schema`. CompletionCriterion examples cover `tag_equals`, `tag_compare`, `expression`. |
| `__tests__/orchestration-builder.test.ts` | Multi-assembly subsystems get an interlock for every adjacent pair; single-assembly subsystems get none. `SharedPermissive` present in every sequential state. |
| `__tests__/section-renderer.test.ts` | Rendered `content_json` matches the shape `generateSpec` produces today (snapshot, so DOCX export stays compatible). |
| `__tests__/assemble.integration.test.ts` | **End-to-end gate.** Feed a stubbed theme through the full pipeline. Assert the built `SpecContractPatch` passes `validateSpecContractPatch` with zero issues. Run for at least 3 parameter combinations (1×1×3, 3×6×18, 8×20×60 — the slider extremes). |

**Mock the Stage 1 AI call** (`callNonStreaming`) at the hook level so the integration test is deterministic and offline. No e2e browser test — the dialog is a thin shell over the hook.

## 6. Migration / cleanup

- `src/lib/spec-builder/__tests__/` gains the new test files; no existing tests change behaviour.
- `parseCompletionCriteria` in `use-random-fds-generate.ts` is **deleted** (only caller is this hook).
- `autoComplete` checkbox removed from `random-fds-dialog.tsx`; props/state simplified.
- `fds-prompts_archive.ts` does not need to absorb the old `buildRandomFdsPrompt` (it's a fixture prompt, not a wizard/orchestration prompt with revision history).
- No DB migration — all V2 columns already exist from Phase 1.

## 7. Out of scope

- AI variety for structural content (state machine variants, novel interlock patterns).
- Per-mode authoring in the random builder — single default mode only, matching Phase 3.
- Routing the assembly-session / orchestration writes through `writeSpecContract`. Same gap exists for every authoring path today; closes when the writer migration covers those tables.
- Smoke tests for the dialog UI beyond manual pre-merge verification.

## 8. Risks

### 8.1 `content_json` shape drift between random renderer and `generateSpec`

If the DOCX exporter or any reader changes how it interprets `spec_sections.functional_description.content_json` and only `generateSpec` is updated, the random builder's output will silently render wrong.

**Mitigation.** The `section-renderer.test.ts` snapshot pins the shape. If `generateSpec` changes its output shape, that snapshot will fail and force a paired update. Document the dependency in the renderer's header comment.

### 8.2 Validator gap on assembly-session / orchestration tables

`writeSpecContract` doesn't yet route those tables, so the deterministic builder bypasses the validator for `sequential_states` and `state_sequences`. A bug here could produce structurally-invalid V2 that nothing catches at write time.

**Mitigation.** The integration test runs the equivalent shape through `validateSpecContractPatch` directly via the patch we build for `writeSpecContract` — but the data we insert into the child tables is constructed by the same code, so a failure there indicates the builder. Add direct Zod parses (`StepV2Schema.parse(...)`, `InterAssemblyInterlockSchema.parse(...)`) inside `sequence-builder.ts` and `orchestration-builder.ts` as belt-and-braces before insert.

### 8.3 IO address collisions across subsystems

`io-allocator.ts` partitions byte ranges per subsystem. If the partition strategy is wrong (e.g. two subsystems share a starting byte), the test will catch it — but only if the test covers the parameter combinations that trigger it.

**Mitigation.** Property-style test in `io-allocator.test.ts`: for every combination of subsystem count × device count up to slider max, assert zero address overlap.
