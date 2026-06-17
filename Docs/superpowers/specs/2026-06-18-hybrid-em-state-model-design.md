# Design: Hybrid State Model — Per-Equipment-Module State Machines

**Date:** 2026-06-18
**Status:** Design approved — ready for implementation plan

---

## Why

Today the FDS contract has **one global state machine**: `spec_projects.confirmed_states` is a single
PackML `OperatingStateV2[]`, and every `EquipmentModuleContract.static_states` / `sequential_states`
is keyed by that **global `state_id`**. `unit_procedures[unit_id][state_id]` coordinates per the same
global state.

That assumes the whole machine moves in **lockstep** — fine for a packaging line where every module is
in "Execute" together, wrong for machines whose modules run independently. On the Segment Wagon the
Carriage (one pendant) can be *Driving* while the Rotator (separate pendant) is *Idle*; a single global
state cannot represent two concurrent independent states.

ISA-88 (per `ai/ISA88_PHYSICAL_MODEL.md` §5) actually places the **state machine at the Equipment
Module** (procedural control, §5.3), with the **Unit coordinating** (§5.4) and the **Control Module**
having no state machine (basic control, §5.2). PackML, too, scopes *mode* to the machine and *state* to
the module. The current model inverts that.

## Decisions (locked during brainstorming)

1. **The Equipment Module owns the state machine** — each EM has its own states (ISA-88 §5.3).
2. **Mixed EM behavior** — an EM's states can be *manual* (command-driven + interlocks) or *sequenced*
   (automatic steps); both must be expressible, even within one EM.
3. **Machine level = mode + safety gating only** — no machine-wide orchestration/sequencer. The machine
   mode permits/forces EM states; safety gates force EMs to a safe state.
4. **Modes are machine-level and extensible** — not limited to Auto/Maintenance/Manual; seed those three,
   but the list is open. EMs have **states, not modes**.
5. **No per-EM modes or per-EM isolation** — the whole machine shares one mode.
6. **Clean V2 evolution, no migration** — only V2 test specs exist; the builder emits the new shape
   directly. (Per the project note: V2 is the only target.)

## Non-Goals

- A machine-wide coordination state machine / startup sequencer (explicitly out — machine is mode+safety).
- Per-EM modes or local/maintenance isolation of individual modules.
- Migrating legacy global-state specs (no production data to preserve).
- Changing the physical hierarchy (units → EMs → CMs → IO) or the register-aware ingest.

---

## Architecture — three layers

```
MACHINE (process cell)        ── modes + safety gating ──┐
  └─ modes: Auto / Manual / Maintenance / … (extensible) │ permit / force
  └─ safety_gates: condition → force scoped EMs to safe  │
                                                         ▼
EQUIPMENT MODULE (owns its state machine)   ◄── each EM independent
  └─ states[]      : the EM's OWN states (kind: static | sequential)
  └─ behavior      : static holds | sequential steps  (reused)
  └─ transitions[] : from→to, trigger (command|completion), guard (permissive)
        ▲
        │ inter-EM coordination = permissive guards referencing other EMs
        ▼
CONTROL MODULE  ── basic control, IO only, no state machine (unchanged)
```

The core shift: the per-EM behavior maps stop being keyed by a **global** `state_id` and re-key to each
**EM's own** state ids. The project's global `confirmed_states` is replaced by the machine layer.

---

## 1. The EM state machine

Each `EquipmentModuleContract` gains:

### `states: EmStateV2[]`
Each state:
- `state_id` — **EM-local** id (unique within the EM).
- `name` — display name (e.g. "DrivingFwd", "Idle", "Execute").
- `kind` — `static` (devices held at fixed values — manual/holding) or `sequential` (runs steps to
  completion — automatic). Both kinds may coexist in one EM ("mix per module").
- `allowed_modes` — `mode_id[]`: which machine modes this state is valid in (e.g. a jog state only in
  Manual; a sequence only in Auto). Empty = allowed in all modes.
- `is_safe_state` — boolean; marks the single state a safety gate forces the EM into. Exactly one per EM
  should be marked (validated).

### Per-state behavior (reused, re-keyed)
- `static_states: Record<em_state_id, ControlModuleStateEntry[] | StaticStateV2>` — held device values.
- `sequential_states: Record<em_state_id, SequentialStateV2>` — permissives + steps.

These already exist on the EM contract; the only change is the key (EM-local state id, not global).

### `transitions: EmTransitionV2[]`
Each transition:
- `from_state_id`, `to_state_id` — EM-local.
- `trigger` — `{ kind: "command", expr: <ConditionExpr> }` (operator command/tag goes true — manual)
  or `{ kind: "completion" }` (the `from` sequential state finished — automatic).
- `guard` — optional `PermissiveCondition` (reused type) that must hold to allow the transition; may
  reference other EMs' states/tags for inter-EM interlocks.

### Templates (seed-then-edit)
When an EM's state machine is first authored, seed from a template, then edit:
- **Manual** — `Stopped ⇄ Running ⇄ … + Faulted(safe)` with command transitions.
- **Sequenced** — `Idle → Starting → Execute → Complete` with completion transitions.
- **Blank** — empty.

---

## 2. Machine layer

### `modes: OperatorMode[]` (exists)
Machine-level, extensible. Seed Auto / Maintenance / Manual with exactly one `is_default`. The machine is
in one mode at a time; modes gate EM states via each state's `allowed_modes`.

### `safety_gates: SafetyGateV2[]` (new)
Each gate:
- `gate_id`, `name`.
- `condition` — expression over safety tags (e.g. `NOT EStop_Healthy OR NOT SR1_Healthy`). Auto-suggested
  from the register's `is_safety` tags at authoring time.
- `scope` — `"all"` or an `equipment_module_id[]`.
- `effect` — forces the scoped EMs to their `is_safe_state` while the condition is violated.

This is the entire safety/coordination layer — force-to-safe, no orchestration.

### Inter-EM coordination
Expressed as **permissive guards on EM transitions** that reference other EMs' states or tags. No separate
orchestration layer.

---

## 3. Schema changes (`src/types/spec-contract-v2.ts`)

| Change | Detail |
|---|---|
| **Add** `EmStateV2Schema` | `{ state_id, name, kind: enum(static, sequential), allowed_modes: string[], is_safe_state: boolean }` |
| **Add** `EmTransitionV2Schema` | `{ from_state_id, to_state_id, trigger: {kind, expr?}, guard?: PermissiveCondition }` |
| **Add** `SafetyGateV2Schema` | `{ gate_id, name, condition, scope: "all" \| string[], }` (effect implied: force to safe) |
| **`EquipmentModuleContractSchema`** | add `states: EmStateV2[]`, `transitions: EmTransitionV2[]`; keep `static_states`/`sequential_states` but document they are keyed by EM-local `state_id` |
| **`SpecContractV2Schema`** | add `safety_gates: SafetyGateV2[]`; **remove** `states` (global); **remove** `unit_procedures` |
| **DB** | `spec_projects.confirmed_states` deprecated/unused; add `spec_projects.safety_gates jsonb`; EM state/transition data lives on the existing EM contract rows. (Migration adds the column; nothing to backfill.) |
| **`contract.ts`** | `loadSpecContract` / `writeSpecContract` stop reading/writing global `confirmed_states` + `unit_procedures`; load tolerates their absence; read/write the new per-EM `states`/`transitions` and machine `safety_gates` |

No data migration of content — only V2 test specs exist.

---

## 4. Wizard & co-author UX

- **Skeleton wizard** — the single global "Operating Modes/States" step is replaced by two machine-level
  steps: **Machine Modes** (seed Auto/Maintenance/Manual, editable, pick default) and **Safety Gates**
  (conditions + scoped EMs, auto-suggested from `is_safety` tags). The global-states step is removed.
- **Co-author (per EM)** — now authors the EM's **own state machine**: pick a template → define states
  (kind, `allowed_modes`, safe flag) and transitions (trigger + guard) → fill per-state behavior (static
  holds / sequential steps, as today). The interview prompt (`buildFdsInterviewSystemPrompt`) shifts from
  "what does this EM do in global state X" to "what states does this EM have and what drives the
  transitions, gated by which modes," using the register IO + the spec requirements (from register-aware
  ingest) as context.

---

## 5. Testing

- **Schema/contract (vitest)** — Zod for `EmStateV2` / `EmTransitionV2` / `SafetyGateV2`; round-trip
  through `writeSpecContract`/`loadSpecContract`; re-keyed `static_states`/`sequential_states`;
  `loadSpecContract` tolerates absent `confirmed_states` / `unit_procedures`.
- **Pure logic (vitest)** —
  - mode-gating: given a mode, resolve the allowed EM states (respecting `allowed_modes`).
  - safety resolution: given a violated gate condition, resolve which EMs are forced to their
    `is_safe_state` (respecting `scope`).
  - transition validation: `from`/`to` exist in the EM's `states`; exactly one `is_safe_state` per EM;
    guard parses.
- **Co-author** — prompt builder emits the EM-state-machine interview (mock AI).
- **Manual smoke** — build the Segment Wagon: Carriage EM (`Stopped ⇄ Fwd ⇄ Rev`, limit/safety guards,
  static/manual) and Rotator EM holding **independent** states; a safety gate (E-Stop → all EMs to safe);
  Local/Remote/Maintenance modes. Confirm two EMs can be in different states simultaneously.

---

## 6. Open items deferred to the plan

- Exact shape of the `trigger.expr` / `condition` expression type — reuse `PermissiveCondition` /
  existing condition schema vs a thin new expression type; pin in the plan.
- Whether per-EM `states` lives inline on the EM contract JSON or in its own table; the plan decides
  (inline JSON on the existing EM contract row is the default, matching `static_states`).
- Co-author interview prompt rewrite is sizeable — the plan should stage it (states/transitions first,
  then behavior) rather than one monolithic prompt change.
- Removal of `unit_procedures` touches `fds_system_orchestrations` / orchestration UI — the plan must
  enumerate every consumer before deleting.
