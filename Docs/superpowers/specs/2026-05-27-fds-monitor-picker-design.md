# FDS Monitor Picker (Phase 4)

**Status:** Design. Implementation plan follows.
**Branch:** `master` (cut a `feature/fds-monitor-picker` branch at implementation start).
**Related:** [Phase 1 schema](2026-05-25-fds-engine-phase1-schema.md) · [Phase 2 wizard](2026-05-25-fds-engine-phase2-wizard.md) · [Phase 3 V2 prompts](2026-05-25-fds-engine-phase3-v2-prompt-design.md) · [Random builder V2](2026-05-26-fds-random-builder-v2-design.md)

## 1. Goal & non-goals

### Goal

Surface `MonitorV2` authoring in the spec-builder matrix view so engineers can attach watchdog conditions to a sequential state (state-monitors) and to individual steps (step-monitors). Schema slots already exist from Phase 1 (`SequentialStateV2.state_monitors[]`, `StepV2.monitors[]`) — Phase 4 is purely UI + persistence wiring on top of that schema.

### Non-goals

- **Routing the write through `writeSpecContract`.** That's Phase 5's job — Phase 4 follows the matrix pane's existing direct-supabase update pattern.
- **Dangling `target_step_id` validation across writes.** Within-state snapshot covers the single-tab case; cross-write detection is Phase 5 contract-validator territory.
- **`manual_ack` / `placeholder` condition kinds.** Don't fit watchdog semantics (manual_ack is interactive; placeholder is a TBD-marker).
- **Optimistic UI / mid-write rollback.** Save → invalidate → refetch is fast enough.
- **Visual / a11y test pass.** Smoke-tested manually before merge.

## 2. Architecture

One reusable dialog (`MonitorPicker`) used from two entry points in `fds-table-pane.tsx`:

```
fds-table-pane.tsx (matrix view, existing)
  ├── state header
  │     └── <Button onClick={openStateMonitors}> State Monitors (N) </Button>
  ├── step row × N
  │     └── <Button onClick={() => openStepMonitors(stepIdx)}> Monitors (N) </Button>
  └── <MonitorPicker
        open
        title
        monitors
        availableStepIds   (sibling step_ids — for branch_to target picker)
        availableAlarmTiers
        availableTags      (from instrument register)
        onChange={next => saveSequentialState(stateId, mutated)}
        onClose
      />
```

The picker is pure UI — it does not know about supabase. It owns a local `monitors` state initialised from props on open so Cancel is real cancel. On Save it calls `onChange(monitors)` and closes; the pane handles persistence.

### 2.1 Code layout

New files under `src/components/spec-builder/monitors/`:

| File | Responsibility |
|---|---|
| `monitor-picker.tsx` | Dialog shell, list + selected-active behaviour, Save/Cancel/Add/Delete |
| `monitor-condition-form.tsx` | Kind picker + per-kind body (`tag_equals` / `tag_compare` / `expression`) + optional `within_ms` |
| `monitor-effect-form.tsx` | Effect radio + per-effect extras (`fault_ref` / `target_step_id`) + `auto_clear` + `priority` |
| `monitor-helpers.ts` | Pure helpers: `createDefaultMonitor()`, `summariseMonitor()`, `validateMonitor()` |
| `__tests__/` | Unit tests per file + a pane-integration test mocking supabase |

The matrix pane (`src/components/spec-builder/fds-table-pane.tsx`) gains two small additions:
- A button on each step row + the state header that opens the picker.
- A `handleMonitorsChange(scope, nextMonitors)` callback that mutates the local `SequentialStateV2`, runs `SequentialStateV2Schema.safeParse` (belt-and-braces), and persists via the existing supabase update path.

No other components change.

## 3. Components

### 3.1 `MonitorPicker`

Dialog with a 2-pane layout:
- **Left:** scrollable list of existing monitors. Each row = effect-coloured chip (alarm=amber, fault=red, hold=blue, branch_to=purple) + `summariseMonitor()` one-liner. Selected row highlights. `+ Add` button at the top.
- **Right:** form for the selected monitor (Condition + Effect sections). Empty state when nothing is selected.
- **Footer:** Cancel (discards local edits) / Save (calls `onChange(monitors)` + closes).

Props:

```ts
interface MonitorPickerProps {
  open: boolean;
  title: string;                              // "Step Monitors" | "State Monitors"
  monitors: MonitorV2[];                      // initial — copied into local state on open
  availableStepIds: string[];                 // for branch_to target picker
  availableTags: string[];                    // for tag autocomplete
  availableAlarmTiers: AlarmTier[];           // currently informational — severity stays hard-coded enum
  onChange: (next: MonitorV2[]) => void;      // called on Save with the mutated array
  onClose: () => void;                        // called on Cancel + after Save
}
```

### 3.2 `MonitorConditionForm`

Three controls stacked:
- `kind` Select: `tag_equals` / `tag_compare` / `expression`
- Kind-specific body:
  - `tag_equals`: tag picker (autocomplete from `availableTags`) + value field (boolean Switch / number Input / string Input — discriminated by value type)
  - `tag_compare`: tag picker + op Select (`<`, `<=`, `>`, `>=`, `==`) + numeric value Input
  - `expression`: text textarea + `referenced_tags` chip multi-select (autocomplete from `availableTags`)
- Optional `within_ms` numeric Input ("Timeout (ms)" — empty = no timeout)

### 3.3 `MonitorEffectForm`

Effect radio (`alarm` / `fault` / `hold` / `branch_to`) + per-effect extras:

| Effect | Extras |
|---|---|
| `alarm` | `fault_ref` group: `fault_code` Input (uppercase coerced) + `severity` Select (`warning` / `fault` / `critical`) |
| `fault` | Same as alarm |
| `hold` | None |
| `branch_to` | `target_step_id` Select populated from `availableStepIds` (sibling steps in the same branch) |

Always-shown:
- `auto_clear` Checkbox ("Automatically reset when condition clears")
- `priority` number Input (default 0, hint: "higher fires first when multiple monitors match")

### 3.4 `monitor-helpers.ts`

```ts
createDefaultMonitor(): MonitorV2
  // { monitor_id: crypto.randomUUID(), condition: { kind: "tag_equals", tag: "", value: true },
  //   effect: "fault", fault_ref: { fault_code: "F_NEW", severity: "fault" },
  //   auto_clear: false, priority: 0 }

summariseMonitor(m: MonitorV2): string
  // "TEMP > 90 → fault F_OVERTEMP", "E_STOP_PB = false → hold", etc.

validateMonitor(m: MonitorV2): { ok: true } | { ok: false, errors: string[] }
  // MonitorV2Schema.safeParse wrapper, plus effect-specific business rules
  // (alarm/fault require fault_ref; branch_to requires target_step_id).
```

## 4. Data flow

**Read path** (every render of a state's matrix):

```
fds-table-pane reads sequential_states[stateId] from session
  ├── state.state_monitors[] → "State Monitors (N)" button label
  └── for each step:
        step.monitors[] → "Monitors (N)" button label on that row
```

**Write path** (user saves a monitor edit):

```
MonitorPicker.onSave(nextMonitors)
  → fds-table-pane.handleMonitorsChange(scope, nextMonitors)
       │
       ▼
  Build updated SequentialStateV2:
    - scope = "state"  → { ...state, state_monitors: nextMonitors }
    - scope = "step:N" → { ...state, steps: state.steps.with(N, { ...steps[N], monitors: nextMonitors }) }
       │
       ▼
  SequentialStateV2Schema.safeParse(updated)  ← belt-and-braces
       │  fail → throw, surface toast, do NOT write
       │  ok   → continue
       ▼
  supabase.from("fds_assembly_sessions")
    .update({ sequential_states: { ...session.sequential_states, [stateId]: updated } })
    .eq("id", session.id)
       │
       ▼
  queryClient.invalidateQueries(["fds_assembly_sessions", spec_project_id])
```

**Source snapshots taken at picker-open time:**
- `availableStepIds`: walked from `state.steps`
- `availableTags`: from `instrument_register.tags`
- `availableAlarmTiers`: from `spec.alarm_tiers`

Snapshot semantics mean an outside-the-dialog change (rare) doesn't reach into the open picker. Save still triggers a fresh schema parse so structurally-invalid mutations fail loudly.

**Cancel semantics:** the picker's local copy is dropped. Source of truth never touched until Save.

## 5. Error handling

| Failure | Where | Handling |
|---|---|---|
| Zod parse fails on Save (in-progress monitor structurally invalid) | inside picker, before `onChange` fires | Inline error summary above Save button listing Zod issue messages. Save disabled. No write attempted. |
| `SequentialStateV2Schema.safeParse` fails after the picker hands `monitors[]` back to the pane | `fds-table-pane.handleMonitorsChange` | Throw, surface destructive toast ("Monitor save failed: <issue>"), do NOT write. Treated as a builder bug, not user-fixable. |
| Supabase update fails | mutation `.catch` | Surface error toast with message. Picker is already closed — user reopens and tries again. |
| `target_step_id` references a deleted step (cross-tab race) | n/a in v1 | Out of scope. Phase 5's contract validator will detect cross-write. `availableStepIds` snapshot covers the single-tab common case. |
| Blank `fault_code` for alarm/fault effect | inline form validation | Inline error under field; Save disabled. `validateMonitor` returns the field-level error. |
| Picker closed via Escape / outside-click during edit | dialog `onOpenChange` | Treated as Cancel (drops local state). Standard shadcn dialog behaviour. |

No retry-on-failure flow — the user is the author and can correct directly.

## 6. Testing

| Test file | Coverage |
|---|---|
| `__tests__/monitor-helpers.test.ts` | `createDefaultMonitor()` returns a `MonitorV2Schema.parse()`-passing object. `summariseMonitor()` covers each effect × condition kind (~6 cases). `validateMonitor()` reports specific field errors (blank tag, blank fault_code, branch_to without target). |
| `__tests__/monitor-condition-form.test.tsx` | RTL: kind switch reveals correct fields. tag_equals with boolean value renders Switch; with number renders Input. tag_compare op Select updates kind body. Expression textarea updates `referenced_tags` chip list. `within_ms` field round-trips. |
| `__tests__/monitor-effect-form.test.tsx` | RTL: switching effect reveals correct extras (alarm/fault → fault_ref; branch_to → target_step_id Select populated from prop; hold → no extras). `auto_clear` toggle + `priority` input round-trip. |
| `__tests__/monitor-picker.test.tsx` | RTL integration: open dialog with seed monitors → list renders summaries → click row → form populates → edit field → Save → `onChange` called with mutated array. Cancel discards local edits. Add appends default. Delete removes selected. |
| `__tests__/monitor-pane-integration.test.tsx` | Mocked supabase: open picker from a step row → save → assert supabase `update` writes the expected `sequential_states[stateId].steps[N].monitors` shape. Same for state-level. Forced-malformed array triggers safeParse throw + error toast, no write fires. |

**Mocks:** supabase mocked at module level (same pattern as `src/lib/spec-builder/__tests__/contract.test.ts`). TanStack Query wrapped via a test `QueryClientProvider` helper.

**Not covered (deferred):**
- Visual / a11y testing of the dialog — manual smoke before merge.
- Cross-write `target_step_id` dangling reference — Phase 5 contract validator.
- Real DB round-trip — covered by the existing matrix pane integration paths.

## 7. Out of scope

- **Phase 5 writer refactor.** Persistence stays on the matrix pane's existing direct-supabase pattern.
- **Cross-state monitor authoring.** No "copy monitor to all steps" or "promote step-monitor to state-monitor" actions in v1. Add later if a real authoring pattern emerges.
- **Monitor templates / library.** No reusable monitor presets. Engineers author each from scratch in v1.
- **Visual indicator of monitor firing precedence.** The `priority` field exists but the matrix view doesn't show monitor-vs-monitor ordering.
- **DOCX export integration.** Monitors will appear in DOCX once the exporter is taught about them; out of Phase 4 scope.

## 8. Risks

### 8.1 Picker dialog gets large

The form combines a list, condition picker, effect picker, and footer — risk of growing beyond what fits in `monitor-picker.tsx`. The plan splits condition + effect into their own form files; if `monitor-picker.tsx` still grows past ~250 lines, extract a `monitor-list.tsx` for the left pane.

**Mitigation.** File-size budget noted in the implementation plan; reviewer flags growth.

### 8.2 SequentialStateV2 belt-and-braces is the only validator

Because Phase 5 hasn't routed the write through `writeSpecContract` yet, the `SequentialStateV2Schema.safeParse` call in `handleMonitorsChange` is the only structural check before insert. Anything the schema admits but the contract-level validator would reject (cross-references, etc.) slips through.

**Mitigation.** Acceptable for v1. Phase 5 retroactively gates this when the writer-refactor lands.

### 8.3 Branch_to target picker freezes a snapshot

The `availableStepIds` snapshot taken at picker-open time goes stale if the user reorders/deletes steps in another tab during the edit session. Save will still succeed if the picked id no longer exists.

**Mitigation.** Single-tab common case is covered. Phase 5 contract validator will catch cross-write dangling references when it lands.
