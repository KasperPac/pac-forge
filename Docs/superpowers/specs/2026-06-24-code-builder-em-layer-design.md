# Code Builder — Sub-Project C: EM Layer (State-Machine FBs) — Design

**Date:** 2026-06-24
**Status:** Draft — pending user review
**Roadmap position:** A (shell ✓) → B (device layer ✓) → **C (EM layer — NOW)** → D (Unit/coordination) → E (Hardware/IO) → F (Export/compile)

---

## 1. Goal

Make the **EM step** of the Code Builder produce real, compilable equipment-module logic. Today `instantiateEquipmentModule` emits only an interface stub (no body) and the actual sequencing lives in a *flattened per-Unit* sequence that never reads the rich per-EM behaviour. After C:

- Every Equipment Module compiles to a **procedural-control FB** (`EM_` prefix) that owns its own PackML-style state machine, derived from the EM contract's `states` / `transitions` / `static_states` / `sequential_states`.
- A **matched library EM FB** is *not* regenerated — it keeps its own state machine and is wired by its `interface_contract` role-tagged pins.
- EM→CM commands flow through a **command/status interface DB**, with a generated **mapping FC** as the resolution layer for context-dependent signal bindings (the "forward sensor depends on mode" case) and OR/AND aggregation.
- Coordination inputs (inter-EM interlocks, mode, safety gates) are **exposed as input pins but left unwired** — sub-project D wires them.
- The EM step becomes interactive in the shell (list, viewer, approve/edit), exactly like the device step.

---

## 2. Background — current state (verified in code)

| Concern | Today | File |
|---|---|---|
| EM instantiation | Stub FB (IO interface, empty body) **or** matched instance DB only | `codegen/fb-instantiate.ts` |
| Matched-vs-stub pick | `pickTemplate(name, class, isEm, templates)` honours `is_equipment_module` + `is_enabled` | `fb-instantiate.ts:20` |
| Matched-FB wiring | Crude `wiringLines()` DI/AI-vs-output heuristic — **ignores `interface_contract`** | `fb-instantiate.ts:52` |
| Sequencing | **Flattened to per-Unit**: every EM's states concatenated into ONE S/A sequence (UDT+DB+FC at `"unit"` layer) | `codegen/sa-builder.ts`, `compile-contract.ts` |
| Rich behaviour | `sequential_states` (Stage-B SFC: permissives, steps, monitors, transitions) is **authored but never compiled** | — |
| Interface contract | `FbTemplate.interface_contract` (role-tagged pins) exists on master but **no codegen consumes it** | `types/fb-interface.ts` |

**Core tension this design resolves:** if C puts the real state machine *inside* each EM FB while the per-Unit flattened FC also drives the same CM outputs, two sequencers fight over the same coils. C therefore **relocates sequencing from Unit → EM** and supersedes the flattened per-Unit sequence at compile time (true Unit *coordination* — deciding which EM runs, in which mode — is D's job, not a copy of EM states).

---

## 3. Approaches considered

### Approach A — Generated EM FB owns the SFC; matched FB wired by contract *(chosen)*
Build a per-EM IR (`em-builder.ts`) from the EM contract, emit a full FB body (`em-writer.ts`) for unmatched EMs, and for matched EMs emit only the instance DB wired by `interface_contract` roles. Supersede the flattened per-Unit sequence. Command interface DB + mapping FC sit between EM and CM.

- **Pros:** ISA-88-clean (procedural control lives in the EM); reuses existing helpers (`orderStates`, `serializeAdvance`, `sclIdent`); matched library FBs are first-class; clear D hand-off (unwired coordination pins).
- **Cons:** Largest change; introduces the interface-DB + mapping-FC layer now.

### Approach B — Keep the flattened per-Unit FC, add EM FB as a thin wrapper
EM FB just forwards to the unit sequencer.
- **Pros:** Smallest diff.
- **Cons:** Keeps sequencing mis-scoped at the Unit; `sequential_states` still unused; doesn't match "generate all new EM FBs"; pushes the real problem to D. **Rejected.**

### Approach C — Generated EM FB, but drive CMs directly (no interface DB)
EM FB writes CM physical addresses inline.
- **Pros:** No interface-DB layer yet.
- **Cons:** No place for the mapping/resolution routine the user asked for; can't aggregate multiple FB outputs (OR/AND) into one input; couples EM body to physical addresses. **Rejected** (chosen design keeps the DB seam the user explicitly wanted).

---

## 4. Chosen architecture

### 4.1 Generated EM FB (`EM_<Name>`) — full **linear** SFC

```
FUNCTION_BLOCK "EM_<Name>"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      enable      : Bool;   // master enable           (unwired in C → TRUE-default)
      mode        : Int;    // PackML mode select       (unwired in C)
      cmd_start   : Bool;
      cmd_stop    : Bool;
      cmd_hold    : Bool;
      cmd_reset   : Bool;
      ilk_<tag>   : Bool;   // one per external/other-EM tag in any guard (unwired in C)
      fb_<sensor> : Bool/Int; // process feedback, resolved by the mapping FC
   END_VAR
   VAR_OUTPUT
      state       : Int;    // current state enum
      step        : Int;    // current SFC step within a sequential state
      done        : Bool;
      fault       : Bool;
      cmd_<act>   : Bool;   // actuator commands → command interface DB
   END_VAR
   VAR
      <stepTimers / edge memory as needed>
   END_VAR
BEGIN
   // 1. State dispatch (CASE state OF …)
   // 2. Static states  → drive cmd_<act> from static_states[state].control_modules (isActiveCommand)
   // 3. Sequential states → inner linear step counter from sequential_states[state].steps
   // 4. Transition evaluation → serializeAdvance(trigger, guard); guards referencing
   //    external tags read the ilk_* / fb_* input pins
   // 5. is_safe_state → home; safety gate / fault → forces safe state, sets fault
END_FUNCTION_BLOCK
```

- **State enum:** ordered by `orderStates(states, transitions)`; index 0 = home (safe) state. Emitted as named SCL constants in a per-EM **state UDT** (`EM_<Name>_State`) for readability + HMI.
- **Static state:** drives `cmd_<actuator>` from `static_states[state_id].control_modules` filtered by `isActiveCommand` (reuse existing helper).
- **Sequential state:** linear step counter over `sequential_states[state_id].steps` (ordered by legacy `step` field). Each step's `actions[]` drive commands; each step's `transitions[]`/`completion_criteria` advance via `serializeAdvance`/`serializeGuard`. **Parallel branches deferred** — `branches[].kind === "parallel"` is collapsed to linear with a warning in C; parallel is the fast-follow.
- **Timeouts:** `timeout_ms` / `on_timeout` → a per-step `TON` and a fault branch. (Edge sentinels already handled by `serializeCondition`.)

### 4.2 Matched library EM FB — wired by `interface_contract`
When `pickTemplate(... isEm=true ...)` matches, emit **only** the instance DB (as today) but replace the crude `wiringLines()` with **role-based wiring** from `interface_contract.pins`:

| Pin `role` | `default_binding` | Wired in C |
|---|---|---|
| `sensor_in` | `io_input` / `fb_output` | ← Input image DB member (via mapping FC) |
| `actuator_out` | `io_output` | → command interface DB / Output image member |
| `cmd` | `hmi` / `em` | ← command interface DB |
| `status` / `fault` | (exposed) | → become `fb_instance` tags |
| `mode` / `interlock` / `param` | `em` / `param` | **left unwired** (D / config) |

Fallback: if a matched template has `interface_contract === null`, fall back to today's `wiringLines()` heuristic and emit a warning (so nothing regresses).

### 4.3 Command/status interface DB + mapping FC (the signal-mapping routine)

Per EM, two seams:

1. **`<EM>_CMD` interface DB** — the EM FB writes `cmd_<actuator>` here; CM FBs read their command from it. (Status/feedback flows back through the input image.)
2. **`MAP_<EM>` mapping FC** — the **resolution layer** the user described. It populates the EM's `fb_<sensor>` inputs from physical/CM signals:
   - **Direct link (default in C):** `"<EM>_IN".fb_x := "DI_X";`
   - **Context-dependent (mechanism built, authoring deferred):** `"<EM>_IN".fwd_sensor := SEL(IN := (mode = FORWARD), IN0 := "DI_SensorA", IN1 := "DI_SensorB");`
   - **OR/AND aggregation:** `"<EM>_IN".any_estop := "DI_E1" OR "DI_E2";`

   > User requirement, verbatim: *"in forward mode a sensor may be the forward sensor, but in reverse, the other sensor is the forward sensor… a mapping routine that allows for such situations… an output that feeds an input db, that way you could have multiple outputs from fb's feeding an OR or AND to another fb input."*

   **Scope in C:** the FDS does not yet carry mode-dependent mapping data, so `MAP_<EM>` is generated with **direct 1:1 links** and stands as the extension point. Authoring context-dependent / OR-AND mappings is a co-author + D concern; C builds the mechanism and the DB seam, not the authoring UI.

### 4.4 Supersession of the flattened per-Unit sequence
In `compile-contract.ts`, when EM FBs own sequencing (always, in C), **do not emit** the per-Unit `writeUdt/writeSequenceDb/writeSequenceFc` artifacts. Replace with a minimal "Unit calls its enabled EMs" stub at the `"unit"` layer (placeholder for D's real coordinator). `sa-builder.ts` and its helpers stay in the tree (D may reuse parts) but are no longer wired into the compile path. This is a net behaviour change guarded by the EM-layer tests.

---

## 5. File structure

**New**
- `src/lib/spec-builder/codegen/em-builder.ts` — pure: EM contract → `EmSequence` IR (states ordered, static commands, linear SFC steps, transition advances, coordination-tag set, sensor-input set).
- `src/lib/spec-builder/codegen/em-writer.ts` — pure: `EmSequence` → artifacts (`EM_<Name>` FB, `EM_<Name>_State` UDT, `<EM>_CMD` interface DB, `MAP_<EM>` FC).
- `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`, `em-writer.test.ts`, plus a `compile-contract` EM-layer case.
- `src/components/code-builder/equipment-module-list.tsx` — EM list (or parameterise `control-module-list.tsx` by layer).

**Modified**
- `codegen/types.ts` — add `EmSequence` / `EmSeqState` / `EmSeqStep` IR types.
- `codegen/fb-instantiate.ts` — matched EM → `interface_contract` wiring (+ heuristic fallback); unmatched EM → delegate to `em-builder`/`em-writer`.
- `codegen/compile-contract.ts` — call the EM path; supersede the flattened unit sequence with a coordination stub.
- `src/components/code-builder/builder-stepper.tsx` — enable the `em` step.
- `src/routes/code-builder.tsx` — layer switch (device | em) driving list + viewer + persisted layer.
- `src/hooks/use-code-builder.ts` — compile + reconcile + persist the `"em"` layer (table already has the `layer` column).

---

## 6. Out of scope (deferred)
- **Parallel SFC branches** — linear only in C; parallel is the fast-follow (collapse + warn now).
- **Wiring coordination inputs** (interlocks, mode dispatch, safety-gate fan-in) — exposed as pins, wired in **D**.
- **Authoring context-dependent / OR-AND mappings** — `MAP_<EM>` mechanism only; authoring UI later.
- **Global Input/Output image DBs** as first-class artifacts — the command/input DBs are per-EM seams in C; the global image-DB consolidation is E.
- **Unit coordinator / OB1 orchestration** — D.

---

## 7. Testing strategy
- `em-builder.test.ts` — ordering (home first), static-command extraction, linear SFC step derivation, coordination-tag set captures external guard tags, parallel-collapse warning.
- `em-writer.test.ts` — FB compiles structurally (VAR sections, CASE dispatch, advances), state UDT constants, `<EM>_CMD` DB members, `MAP_<EM>` direct-link FC.
- `fb-instantiate` — matched EM with `interface_contract` wires by role; null-contract matched EM falls back + warns.
- `compile-contract` — EM layer emits FB+UDT+CMD+MAP per EM; flattened unit sequence no longer present; `filterByLayer(..., "em")` returns exactly the EM artifacts.
- All generic — no machine-specific names; verified mentally against conveyor / lift-table / stamping shapes per CLAUDE.md.
- `verifyCommand`: `npx vitest run src/lib/spec-builder/codegen && npx tsc -b`.

---

## 8. Risks / notes
- **Supersession is a behaviour change** — anything depending on the per-Unit `"unit"` artifacts shifts to the coordination stub. Bounded by tests + the fact that the unit layer step is still disabled in the shell until D.
- **`interface_contract` may be `null`** on real templates → heuristic fallback prevents regression.
- **Linear-collapse of parallel** must warn loudly so authored parallelism isn't silently lost.
- Reuses `orderStates`, `serializeAdvance/Guard/Condition`, `sclIdent`, `isActiveCommand`, `staticEntries` — no new condition/identifier logic invented.
