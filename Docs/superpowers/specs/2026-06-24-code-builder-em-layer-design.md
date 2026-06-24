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

### 4.5 UI (reviewed via visual companion 2026-06-24)

The Code Builder shell from A+B (`code-builder.tsx`: header + `BuilderStepper` + 3-pane `list | ArtifactViewer | ArtifactPanel`) is reused. The EM layer adds three things, all confirmed against a wireframe:

1. **Clickable stepper = layer switch.** `BuilderStepper` steps become buttons. Selecting `Device` or `EM` sets an `active` layer state in `code-builder.tsx`; the left list and the persisted/compiled layer follow it. `Unit`/`Export` stay disabled until D/F. (Replaces today's hardcoded `active="device"`.) The selected layer is the single source for `filterByLayer`.

2. **EM list grouped by Unit.** A list (parameterise `control-module-list.tsx` by layer, or a sibling `equipment-module-list.tsx`) shows one row **per EM**, grouped under its Unit, with `generated` / `matched` pills plus the existing `drift` / `approved` badges. One row per EM — not one per artifact.

3. **EM viewer = State Diagram default + artifact tabs.** The viewer tabs become the EM's own artifacts: **State Diagram** (default) · Code · State UDT · Cmd DB · Map FC · Inst DB. "Related" artifacts continue to group by `owner_id` (today's mechanism) so all five surface under one EM row.
   - **State Diagram** is a *new dedicated renderer* (`em-state-diagram.tsx`) drawing nodes = states (safe/home styled distinctly) and edges = guarded transitions, sourced from the **EM contract** (`states` + `transitions`), not from parsing SCL. Linear SFC states show a step count; the generic `FbFlowRenderer`/`parseFbFlow` is *not* reused for the state view.
   - **Right panel** additionally surfaces the EM's **coordination inputs** (the unwired `ilk_*` / `mode` / `enable` pins) and its dependency artifacts (State UDT, Cmd DB, Map FC), so the D hand-off is visible.

Approve/Edit/Save in `ArtifactPanel` are unchanged and act on the currently-selected tab's artifact (per-artifact approval, as today).

---

## 4.6 FB lifecycle (decided 2026-06-24)

The plumbing above produces an FB; this section governs **how** that FB is generated, how it reads, how it is revised, how it is reused, and how it is gated. Four decisions, all generic across machine types (CLAUDE.md).

### 4.6.1 Generation — Hybrid: deterministic skeleton + AI fill

The EM FB is built in two stages with a clean seam:

1. **Deterministic skeleton** (`em-builder` → `em-writer`, pure, no AI): the entire interface (VAR_INPUT/OUTPUT/STATIC), the `CASE state OF` dispatch, the state constants, the transition `advance` guards (via `serializeAdvance`), and the static-state command assignments (via `isActiveCommand`). This is fully reproducible from the contract and is the audit backbone — re-running it on an unchanged contract yields byte-identical output.

2. **AI fill, confined to marked regions** (`use-em-generate` → Edge Function): inside each **sequential (SFC) step body** only, between explicit region markers, the AI fills the procedural action logic the contract cannot express deterministically (ramp profiles, timed dwell sequencing, conditional actuator choreography). The AI never touches the interface, the CASE frame, the guards, or the state constants — those are skeleton-owned.

   ```scl
   // === STEP 2: Accelerate (AI-FILL:EM_Carriage_Drive:step2) ===
   //   contract action: "ramp drive to target speed, hold brake released"
   //   <ai-fill>
   "M01".cmd_run := TRUE;
   "M01".speed_sp := #ramp_out;
   //   </ai-fill>
   // === END STEP 2 ===
   ```

   - Region markers are stable and machine-derived (EM id + step id) so a re-fill replaces exactly its own region and nothing else — drift detection (4.6.2) diffs per-region.
   - If AI is unavailable or returns nothing, the region stays as a deterministic stub (the contract action prose as a comment + a `// TODO` no-op) — the FB still compiles. AI fill is an **enhancement over** a always-valid skeleton, never a hard dependency.
   - The fill prompt is a **new generic builder** (`em-fill-prompt.ts`) — machine-agnostic, contract-driven, no project-specific names. It is covered by the `*-prompt*.ts` pipeline-auditor hook.

### 4.6.2 Revision — Drift detection + per-FB version log

- **Drift** (already in the shell as a `drift` pill) is computed per-region: skeleton-vs-persisted and AI-region-vs-persisted, so an edited step shows drift without the whole FB being flagged.
- **Version log**: every Approve (or explicit "Save version") snapshots the FB artifact set (FB + State UDT + Cmd DB + Map FC) into a per-EM history with author, timestamp, and a short note. Reuses the existing `FbTemplateVersion` shape conceptually but stored against the code-builder artifact (new `code_builder_versions` rows, jsonb payload, keyed by `owner_id` + layer). The viewer gets a **History** affordance: list versions, diff against current (reuse `diff-engine.ts`), restore.
- Restore writes the chosen snapshot back as the working artifact (a new version entry, never destructive).

### 4.6.3 Categorisation — Promote to library (core path)

A reviewed, approved EM FB can be **promoted to the FB Library** so future specs match it instead of regenerating:

- New **"Promote to Library"** action in `ArtifactPanel` (enabled only when the EM is `approved` and review-passed).
- Builds an `FbTemplate` with `is_equipment_module = true`, `source = "custom"`, a user-chosen `device_category` + `tags`, the SCL blocks, and an **auto-derived `interface_contract`**: run `parseFbInterface` → `interfacePins` on the FB, then infer each pin's `role` from naming convention (`cmd_*`→cmd, `ilk_*`→interlock, `fb_*`→sensor_in, `mode`→mode, `cmd_<act>` out→actuator_out, `state`/`done`/`fault`→status) and `default_binding.source` (em/io_input/io_output). `reviewed` starts `false` until a human confirms the derived contract in the existing FB Library editor.
- Once promoted, `pickTemplate` (4.2) will score and match it for the same EM class in future specs — closing the loop from generated → library → matched.
- Categorisation metadata (`device_category`, `tags`, `library_name`) is chosen at promote time via a small dialog; nothing is invented from the spec.

### 4.6.4 Quality gates — Safety analyzer + standards review (in-builder, no TIA compile)

Before an EM FB can be approved or promoted, it passes two in-builder gates (TIA compile stays in F):

- **Safety analyzer** — reuse `safety-analyzer.ts`'s rule-based checks against the generated FB; surfaced as a gate panel with pass/warn/fail per rule. Fails block Approve; warns are acknowledgeable.
- **Standards review** — an AI review pass reusing the existing **Standards Reviewer** agent (`review-prompt-builder.ts` / `review-response-parser.ts`) scoped to a single EM FB. Findings render in the right panel; the EM shows a `review` badge (pass / findings). Reuses the Pac-ST review machinery — no new review engine.

Both gates run on demand and on Approve; results persist with the artifact so the badge survives reload.

---

## 5. File structure

**New**
- `src/lib/spec-builder/codegen/em-builder.ts` — pure: EM contract → `EmSequence` IR (states ordered, static commands, linear SFC steps, transition advances, coordination-tag set, sensor-input set).
- `src/lib/spec-builder/codegen/em-writer.ts` — pure: `EmSequence` → artifacts (`EM_<Name>` FB, `EM_<Name>_State` UDT, `<EM>_CMD` interface DB, `MAP_<EM>` FC).
- `src/lib/spec-builder/codegen/__tests__/em-builder.test.ts`, `em-writer.test.ts`, plus a `compile-contract` EM-layer case.
- `src/components/code-builder/equipment-module-list.tsx` — EM list grouped by Unit (or parameterise `control-module-list.tsx` by layer).
- `src/components/code-builder/em-state-diagram.tsx` — dedicated state-machine renderer (nodes = states, edges = guarded transitions) from the EM contract.
- `src/lib/spec-builder/em-fill-prompt.ts` — generic, contract-driven AI-fill prompt for SFC step bodies (covered by the `*-prompt*.ts` pipeline-auditor hook).
- `src/hooks/use-em-generate.ts` — orchestrates skeleton → AI fill of marked regions via the `generate` Edge Function; always falls back to the deterministic stub.
- `src/lib/spec-builder/codegen/em-fill-regions.ts` — pure: parse/replace `<ai-fill>` regions by stable marker id; per-region drift diff.
- `src/components/code-builder/fb-quality-gates.tsx` — safety-analyzer + standards-review gate panel (pass/warn/fail badges).
- `src/components/code-builder/fb-version-history.tsx` — version list + diff (via `diff-engine.ts`) + restore.
- `src/components/code-builder/promote-to-library-dialog.tsx` — category/tags picker; builds `FbTemplate` with auto-derived `interface_contract`.
- `supabase/migrations/0xx_code_builder_versions.sql` — `code_builder_versions` (id, owner_id, layer, payload jsonb, note, author, created_at).

**Modified**
- `codegen/types.ts` — add `EmSequence` / `EmSeqState` / `EmSeqStep` IR types.
- `codegen/fb-instantiate.ts` — matched EM → `interface_contract` wiring (+ heuristic fallback); unmatched EM → delegate to `em-builder`/`em-writer`.
- `codegen/compile-contract.ts` — call the EM path; supersede the flattened unit sequence with a coordination stub.
- `src/components/code-builder/builder-stepper.tsx` — steps clickable; `onSelect(layer)` + `active` prop.
- `src/components/code-builder/artifact-viewer.tsx` — add State Diagram / State UDT / Cmd DB / Map FC tabs for EM artifacts.
- `src/routes/code-builder.tsx` — `active` layer state; clickable stepper drives list + viewer + the layer passed to the hook.
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
- UI: `code-builder.test.tsx` — stepper switches device↔em layer; EM list shows one row per EM grouped by Unit; viewer renders State Diagram tab + the 5 artifact tabs; `em-state-diagram` renders nodes/edges from a contract fixture.
- `em-fill-regions.test.ts` — marker parse/replace is exact (a re-fill replaces only its own region), per-region drift diff, missing-AI fallback leaves a compiling stub.
- `em-fill-prompt.test.ts` — prompt is generic (no machine-specific tokens), includes only the contract action + interface context for the target step.
- Promote-to-library — `interface_contract` auto-derivation: role inference from naming convention and `default_binding.source` mapping, over conveyor / lift-table / stamping pin shapes.
- Quality gates — safety-analyzer surfaces fails on a known-bad FB fixture; standards-review parse maps findings to badges.
- Version log — snapshot → diff → restore round-trips without data loss; restore creates a new (non-destructive) version.
- All generic — no machine-specific names; verified mentally against conveyor / lift-table / stamping shapes per CLAUDE.md.
- `verifyCommand`: `npx vitest run src/lib/spec-builder src/routes/__tests__/code-builder.test.tsx && npx tsc -b`.

---

## 8. Risks / notes
- **Supersession is a behaviour change** — anything depending on the per-Unit `"unit"` artifacts shifts to the coordination stub. Bounded by tests + the fact that the unit layer step is still disabled in the shell until D.
- **`interface_contract` may be `null`** on real templates → heuristic fallback prevents regression.
- **Linear-collapse of parallel** must warn loudly so authored parallelism isn't silently lost.
- Reuses `orderStates`, `serializeAdvance/Guard/Condition`, `sclIdent`, `isActiveCommand`, `staticEntries` — no new condition/identifier logic invented.

---

## 9. Decomposition (approved 2026-06-24)

C is larger than one plan. It splits into four sequenced, independently-testable sub-plans. Each gets its own `writing-plans` pass.

| Plan | Scope | Depends on |
|------|-------|-----------|
| **C1 — Generation core** | `em-builder` + `em-writer` deterministic skeleton, hybrid AI-fill regions (`em-fill-regions`, `em-fill-prompt`, `use-em-generate`), matched-FB `interface_contract` wiring, `MAP_<EM>` + `<EM>_CMD` DB seam, supersede the flattened per-Unit sequence in `compile-contract`. | — |
| **C2 — EM-layer UI** | clickable `BuilderStepper` layer switch, `equipment-module-list`, `em-state-diagram`, the State Diagram + 5 artifact tabs in `artifact-viewer`, `active`-layer wiring in `code-builder.tsx`. | C1 (artifacts to render) |
| **C3 — Quality + versioning** | `fb-quality-gates` (safety-analyzer + Standards Reviewer), per-region drift, `code_builder_versions` migration, `fb-version-history` (diff + restore). | C1, C2 |
| **C4 — Promote to library** | `promote-to-library-dialog`, `interface_contract` auto-derivation (`parseFbInterface`/`interfacePins` + role inference), categorisation metadata, `pickTemplate` generated→library→matched loop. | C1, C3 |

**Build order:** C1 → C2 → C3 → C4. C1 is the foundation (no UI dependency); C2 renders C1's artifacts; C3/C4 act on approved FBs.

### "Look" confirmations (2026-06-24)
- **AI-fill scope:** AI fills **SFC step bodies only**. Interface, CASE frame, transition guards, and state constants are skeleton-owned and reproducible. (Confirmed.)
- **Naming convention is the contract:** `cmd_* / ilk_* / fb_* / cmd_<act>(out) / state·step·done·fault` — locked, and drives promote-time role inference for `interface_contract`. (Confirmed.)
