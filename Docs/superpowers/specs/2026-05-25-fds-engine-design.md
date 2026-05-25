# FDS Engine — Design

**Date:** 2026-05-25
**Status:** Design. Implementation plan follows.
**Brief:** `Docs/superpowers/research/2026-05-13-fds-engine-research-brief.md`
**Findings:** `Docs/superpowers/research/2026-05-13-fds-engine-findings.md`
**Author:** Kasper Simonsen + Claude (brainstorming session)

---

## 1. Goal & non-goals

### Goal

Make the FDS engine fit complex Pac Technologies projects without rigidity, while preserving the matrix-table authoring affordance and the existing four codegen paths. Achieve this by **completing the V2 contract design that has already shipped at the data-model level** — not by redesigning.

The felt rigidity traces to three load-bearing failures identified in the findings doc §§3–5:

1. The assembly-interview prompt emits flat v1-shaped JSON that does not exercise V2 SFC primitives.
2. The subsystem orchestration layer is prose (`InterAssemblyInterlock.effect: string`) while the system layer one level up is structured.
3. The compose path melts inter-assembly interlocks into per-assembly prose permissives, destroying structural information.

The schema is rich enough; the authoring and compose layers haven't kept up.

### Non-goals

- **No recursion / fractal SFC.** Rejected in findings §8.1.
- **No S7-GRAPH codegen.** Rejected in findings §8.5. SCL state machines stay the codegen target.
- **No full S88 recipe binding.** Rejected in findings §8.4.
- **No matrix-as-canonical-data.** Rejected in findings §8.2. Matrix remains a *render* of the contract.
- **No new UI framework.** React 19 + Vite + Tailwind v3 + shadcn/ui only.
- **No change to the four codegen paths' inputs beyond what the V2 contract already provides.**
- **No DOCX markup ingest rework.** `ingest_markup_draft` stays stubbed.
- **No parallel-branch authoring UI in v1.**
- **No fifth example spec before locking.** Four-spec corpus covers the discrete-machine portfolio.

---

## 2. Architecture

### 2.1 Four-level layered model — ISA-88 vocabulary (internal terminology only)

| Layer | ISA-88 analogue | Schema home |
|---|---|---|
| System orchestration | Procedure | `fds_system_orchestrations` |
| Subsystem orchestration | Operation | `fds_subsystem_orchestrations` |
| Assembly contract | Equipment module | `fds_assembly_sessions` |
| Sequential state (`StepV2` / `BranchV2`) | Phase | inside assembly session |

The ISA-88 mapping is **documentation and internal naming only**. No schema renames; no breaking changes to identifier names that have shipped. The analogy makes the layered intent explicit in prompts, docs, and future onboarding material.

### 2.2 Canonical artefact

`loadSpecContract(specProjectId)` → `SpecContractV2` is the single source of truth. Authoring writes route through `writeSpecContract`. Everything else is a view:

- **Matrix UI** — render of the contract.
- **`spec_sections`** — materialised view, rebuilt on every contract write (see §4.4).
- **DOCX export** — render of the contract.
- **DOCX markup ingest** — deferred (out of scope).

### 2.3 Boundary lint

The existing `assertBuilderContext` stub becomes an active lint rule in v1. **Forge modules import readers only; only spec-builder modules import writers.** Catches the dual-write class of bug that the compose path embodied.

---

## 3. Data model changes

Five additions/changes to V2 schema. All ride Release N+1.

### 3.1 Modes axis

**Schema.**

```ts
// spec_projects (new column)
confirmed_modes: OperatorMode[]

interface OperatorMode {
  mode_id: string;            // "auto" | "manual" | "service" | ...
  name: string;               // display name
  description?: string;
  is_default: boolean;        // exactly one mode has is_default=true
}
```

Every existing key that was `state_id` becomes `(mode_id, state_id)`:

- `SubsystemStateSequence` keyed by `(mode_id, state_id)`
- `SystemStateSequence` keyed by `(mode_id, state_id)`
- `AssemblyContract.sequential_states` keyed by `(mode_id, state_id)`
- `MonitorV2` conditions and `TransitionV2` guards may reference mode via expressions

Single-mode projects get a default `auto` mode; every existing row migrates to `(auto, <state_id>)`. Multi-mode projects (CVL-2129 shape) author per-mode sequence overrides as separate `(mode_id, state_id)` rows.

### 3.2 PackML state vocabulary

**Schema.**

```ts
// spec_projects (new column shape replaces confirmed_states open-set names)
confirmed_states: OperatingStateV2[]

interface OperatingStateV2 {
  state_id: number;                // 1..17 for PackML; >100 reserved for custom_states
  packml_id?: 1..17;               // null if state_id is in custom_states range
  custom_name?: string;            // only used when state is outside PackML 17
  display_name: string;            // engineer-facing label
  state_pattern: "static" | "sequential";
  description?: string;
}
```

PackML closed set is the canonical 17-state model defined by OMAC / PLCopen (Aborting, Aborted, Stopping, Stopped, Resetting, Idle, Starting, Execute, Holding, Held, Unholding, Suspending, Suspended, Unsuspending, Completing, Complete, Clearing). The implementation MUST source state IDs and names from the canonical PackML state-model reference cited in the findings doc; no hand-maintained table lives in this design.

`custom_states` extension (state IDs > 100) covers genuinely-not-PackML cases — typically site-specific control modes flagged at migration time. Engineer-confirmed per project — see §5.

### 3.3 Subsystem orchestration lift

The subsystem layer adopts the system layer's primitive set. **The asymmetry findings §0.5 named as the load-bearing fault line goes away.**

```ts
// fds_subsystem_orchestrations.state_sequences[<mode>][<state>] becomes:
interface SubsystemStateSequence {
  assembly_order: string[];                              // unchanged
  shared_permissives: SharedPermissive[];                // STRUCTURED (was string[])
  inter_assembly_interlocks: InterAssemblyInterlock[];
}

interface InterAssemblyInterlock {
  interlock_id: string;
  source_assembly: string;
  source_condition: CompletionCriterion;                 // STRUCTURED (was string)
  target_assembly: string;
  effect: "hold" | "block_transition" | "trigger" | "enable" | "disable";  // CLOSED ENUM (was string)
  effect_target?: { assembly: string; state_id: number };
  prose: string;                                         // for DOCX rendering
}
```

`shared_permissives` and `inter_assembly_interlocks` schemas mirror the system layer. The structural validator in `writeSpecContract` gains the symmetric checks. **Legacy fields dropped** (deferred to Release N+2; see §6).

### 3.4 Configuration parameters

```ts
// spec_projects (new column)
configuration_parameters: ConfigParameter[]

interface ConfigParameter {
  parameter_id: string;
  name: string;                       // display label
  allowed_values: string[];           // discrete enum only
  default: string;                    // must be in allowed_values
  description?: string;
}
```

Expressions reference parameters by id (e.g. via a new `ExpressionSchema` variant `parameter_ref`). Substitution happens at evaluation as string literals. Covers Catodo's LFP/NMC switch and Norte's option switches. **Discrete enums only** — numeric thresholds get encoded as named bands until a real project needs more.

### 3.5 Section keying for project-level types

Six section types (`document_control`, `system_overview`, `control_philosophy`, `interfaces`, `testing_fat`, `hmi_specification`) are **one-row-per-project** in the materialised `spec_sections` view. No `(assembly_id, state_id)` keying.

**Contract home for editable content.** A single new JSONB column on `spec_projects`:

```ts
// spec_projects (new column)
section_overrides: Record<ProjectSectionType, ProjectSectionContent>
```

The structured editor's writes for these six section types route to `writeSpecContract`, which updates the corresponding key inside `section_overrides`. The materialised-view rebuild reads `section_overrides` and emits one `spec_sections` row per populated key, scoped by project. Editor UI is unchanged — it reads the materialised row as today.

This preserves Q10-B's "no per-section-type column proliferation" intent (one JSONB column, not six) while keeping the contract canonical.

---

## 4. Authoring changes

### 4.1 Rewrite `buildFdsInterviewSystemPrompt` to emit V2-shaped JSON

The single load-bearing prompt change. Replace the flat shape:

```jsonc
// OLD (v1-shaped)
{
  "outputs": [{"tag": "...", "value": "..."}],
  "branches": [{"conditions": [{"tag", "op", "value"}], "next_step": 20}]
}
```

with the V2-shaped emission:

```jsonc
// NEW (V2-shaped)
{
  "step_id": "step_<deterministic>",
  "branch_id": "main",
  "actions": [
    {"kind": "assign", "target": "M01.START", "value": {"kind": "literal", "value": true}, "prose": "..."},
    {"kind": "start_timer", "timer": "T_STARTUP", "preset": "T#5s", "prose": "..."}
  ],
  "transitions": [
    {"kind": "single", "target_step_id": "step_xxx",
     "guard": [{"kind": "tag_equals", "tag": "M01.RUNNING", "value": true, "within_ms": 5000,
                "on_fail": {"fault_code": "F101", "severity": "WARN"}}]}
  ],
  "monitors": [],                  // optional
  "branches": []                   // optional; legal in schema but no UI for hand editing in v1
}
```

The prompt's "schema rules" section explicitly lists:

- 9 `ActionV2` kinds (`assign`, `call_fb`, `start_timer`, `stop_timer`, `reset_timer`, `incr_counter`, `reset_counter`, `raise_alarm`, `manual_prose`)
- `CompletionCriterion` kinds (`tag_equals`, `tag_compare`, `expression`, `manual_ack`, `placeholder`)
- `TransitionV2.kind` (`single` | `parallel`)
- `MonitorV2.effect` (`alarm` | `fault` | `hold` | `branch_to`)
- Tag-direction rule (outputs vs inputs)
- Fault-severity enum
- **One step per command** (existing constraint from `c853f47`)

The merge path that persists AI emissions stops coercing flat shape into V2; it accepts V2 directly.

### 4.2 Monitor picker UI

New `monitor-builder.tsx` in `src/components/spec-builder/pickers/`:

- **Condition** — reuses `expression-builder.tsx`
- **Effect** — closed enum dropdown (`alarm` / `fault` / `hold` / `branch_to`)
- **Priority** — integer
- **`branch_to` step selector** — visible only when `effect === "branch_to"`; lists step_ids in current branch

Wired into `fds-table-pane.tsx` per sequential state. Covers 8466 Norte/Sur's "Line unblocking on low flow feedback" pattern.

### 4.3 Parallel-branch authoring deferred to v2

Schema fully supports `BranchV2`; AI co-author can emit it; the matrix shows a **"Parallel branches present"** badge per state where `BranchV2` rows exist. Hand editing requires direct contract patch via a developer-mode JSON view. Revisit with native picker UI in v2 once real authoring data exists.

### 4.4 Modes UI

New wizard step **between state confirmation and assembly authoring** confirms `confirmed_modes`. Behaviour:

- **Single-mode projects** — engineer accepts the `auto` default and moves on. One click.
- **Multi-mode projects** — wizard prompts for the mode set (id, name, description, is_default). Engineer can add/remove modes.

Per-mode sequence overrides in the matrix view: a **mode selector tab strip** at the top of `fds-table-pane.tsx` switches between modes.

**Fallback semantics — explicit, not implicit.** Each `(mode_id, state_id)` row carries an `override_kind`:

- `"inherit"` (default for non-default modes) — render the default-mode row for this state, with an "inherited" visual cue. No data stored.
- `"override"` — mode-specific authored content. Stored as a full `SequentialStateV2` (or `StaticStateV2`) row.
- `"suppressed"` — mode-specific *empty*. The state has no behaviour in this mode (e.g. Service mode has no Execute sequence). Stored as an explicit suppression marker.

The matrix UI exposes `inherit` / `override` / `suppressed` as a three-way toggle on each `(mode_id, state_id)` cell. The default mode (typically `auto`) can never be `inherit`. This removes the ambiguity of "empty cell = inherit vs. empty cell = empty".

### 4.5 Materialised `spec_sections` view

The structured spec editor's UI is unchanged — it reads from the `spec_sections` table as today. Its writes route through `writeSpecContract` instead of writing `spec_sections` directly. The materialised rebuild fires inside `writeSpecContract` after the contract validation passes:

- Per-changed-key rebuild (only affected sections rewrite, not full project)
- Transactional with the contract write
- Performance budget: **under 200ms on a project the size of Catodo** (~10 subsystems, ~30 assemblies, ~150 sequential steps total, ~80 alarms)
- Fallback to async rebuild if budget is missed (see §8.4)

---

## 5. Migration

**One engineer-confirm wizard step per project**, bundling all three structural migrations. Triggered the first time the project loads after Release N+1 lands.

### 5.1 Wizard step shape

Three-tab review of computed proposals:

| Tab | Proposal | Engineer action |
|---|---|---|
| **Modes** | "Default mode `auto` will be applied; every existing state and orchestration row will be keyed `(auto, <state_id>)`. Add modes now if this project has Manual/Service/etc." | Confirm default, or add modes before confirming |
| **State vocabulary** | Computed table: existing state name → proposed PackML id. Unmapped names flagged for `custom_states` or manual remap | Review row-by-row; remap or move-to-custom |
| **Interlock structure** | AI-classified table: each `InterAssemblyInterlock.effect` prose string → proposed structured `effect` enum + `source_condition: CompletionCriterion`. Confidence score per row | Review; accept or hand-correct |

**Until the engineer confirms, the project is read-only on every FDS-builder route** and contract reads return the legacy shape (legacy-shim path stays alive for unconfirmed projects). On confirm: one transactional migration writes the new shape and marks the project confirmed.

### 5.2 Database migration steps

1. **Release N+1 schema migration** — add new columns (`confirmed_modes`, `configuration_parameters`, structured interlock fields, PackML state columns) as nullable additions. No data rewrite at deploy time.
2. **Engineer-confirmation per project** — happens at wizard interaction; writes the new shape.
3. **Release N+2 cleanup migration** — once all production projects show `confirmation_status = "confirmed"` (telemetry-watched), drop legacy fields and remove the legacy-shim path.

### 5.3 Italian-spec handling

The 8466 Norte/Sur spec contains Italian state names. The state-vocabulary mapper ships with an **explicit Italian → PackML translation table** for the known terms in 8466. The migration is validated against 8466 *before* rolling out to that project's owner.

### 5.4 In-flight AI conversations

Any co-author conversation in progress at migration time gets **archived, not replayed**. The new V2-shaped prompt is incompatible with v1-shaped emission history. Engineer restarts authoring from the matrix view (which preserves the persisted state).

---

## 6. Sequencing

**Release N+1 Phase 1 status: complete as of 2026-05-25. Schema, validator, writer routing, reader branching, ESLint boundary lint. Phases 2-7 pending.**

Three releases. Each lands one coherent chunk of work.

### Release N — Assembly-FB-Library merge

The `feature/assembly-fb-library` branch ships to master first. `interface_contract` per assembly becomes a stable input. **No FDS engine work in this release** — it's clearing the deck so the FDS engine work doesn't fight a moving foundation.

### Release N+1 — FDS Engine core

All of §3 (schema changes), §4 (authoring changes), §5 (migration wizard). Single release. Engineer-confirms unlock the new features per project.

**Internal ordering** (the implementation plan honours this):

1. Schema additions + writer/validator rules (DB-first)
2. Migration wizard step + per-project confirmation flow
3. V2 interview prompt rewrite + co-author end-to-end test against the four real specs
4. Monitor picker UI
5. Materialised `spec_sections` rebuild logic + editor refactor to route through `writeSpecContract`
6. Modes wizard step + per-mode matrix tabs
7. ISA-88 docs/terminology pass (last — pure docs, no risk)

### Release N+2 — Legacy field drop

Once production projects are confirmed (telemetry watches `confirmation_status` rollout), the cleanup migration drops legacy fields, removes the legacy-shim path, and removes the `FLAGS.legacy_shim_enabled` toggle. No user-visible behaviour change.

---

## 7. Out of scope (explicit)

Anything in this list is intentionally deferred. Push back during planning or implementation if it surfaces.

- **Parallel-branch authoring UI.** Schema supports `BranchV2`; AI co-author can emit it; matrix shows a presence badge. No fork/join picker in v1. Revisit in v2 with real authoring data from at least one customer who has hit the case.
- **DOCX markup ingest.** `ingest_markup_draft` RPC stays stubbed. Foreign-spec AI ingest unchanged. Revisit only if customer-engineer markup workflow evidence emerges.
- **Full S88 recipe binding.** No runtime recipe selection. `configuration_parameters` covers project-time switches only.
- **S7-GRAPH codegen.** SCL state machines stay the codegen target. Bridge does not gain GRAPH import.
- **Numeric / typed / derived `configuration_parameters`.** Discrete enums only. Numeric thresholds get encoded as named bands until a real project needs more.
- **Continuous-process state model.** PackML 17-state covers the discrete-machine portfolio. A continuous-process product (Pac-Continuous?) would need its own design pass.
- **Recipe-multi-product fifth test spec.** Not added. Future recipe customers bring their own spec to a follow-on design.
- **Restructuring the six redundant section types into typed `spec_projects` columns.** Deferred. They stay as project-keyed section rows. Cleanup follows once the bigger release lands.
- **Forge codegen pipeline changes.** The forge reads the contract via `useSpecContract`; no forge-side rewrite. The forge benefits from richer contract input automatically.

---

## 8. Risks

### 8.1 AI interlock classifier accuracy

The migration step asks an AI to classify prose `effect` strings into the 5-effect enum. Confidence varies.

**Mitigation.** Engineer-confirm gate on every classified row; classifier never auto-applies. Verify accuracy against the 4 real specs *before* the migration ships. If any spec has effect prose the classifier can't handle, extend the classifier or surface a manual-only fallback for that row.

### 8.2 V2 interview prompt regression

The rewrite changes the AI's emission contract. Existing co-author conversations in progress will not be valid against the new schema.

**Mitigation.** In-flight conversations archived (not replayed) at migration. Engineer restarts from the matrix view.

### 8.3 Italian spec coverage

The 8466 Norte/Sur spec is partly Italian. PackML mapping for Italian state names was not built in the research pass.

**Mitigation.** Explicit Italian → PackML translation table in the migration mapper, validated against 8466 before rolling out to that project.

### 8.4 Materialised view performance

Rebuilding `spec_sections` on every contract write could be expensive for large projects.

**Mitigation.** Per-changed-key rebuild (not full-project). Performance budget: under 200ms on a Catodo-sized project. Profile during implementation; fall back to async rebuild if budget is missed.

### 8.5 Engineer-confirm wizard friction

Three review tabs is a real ask.

**Mitigation.** Wizard supports "save and resume later". Reads stay legacy-shape until confirmation lands. No production work is blocked.

---

## 9. Open follow-ups for the implementation plan

These are decisions the implementation plan needs to resolve. They were not blocking the design.

1. **Exact schema diff** for `OperatorMode`, `ConfigParameter`, structured `InterAssemblyInterlock`, `SharedPermissive` at the subsystem layer. The existing system-layer types are the template.
2. **Wizard placement** — new top-level wizard step vs modal banner on the spec-builder route.
3. **Legacy-shim home** — whether it lives in `loadSpecContract` or in a separate `loadSpecContractLegacy` reader. Affects how cleanly the legacy code drops in Release N+2.
4. **Integration test corpus** — run the 4 real specs through the full migration → write → render → DOCX export cycle.
5. **Telemetry for `confirmation_status` rollout** — gates Release N+2.

---

## 10. Decisions reference

For traceability — each design choice and the alternative it beat. Open questions are numbered as they appear in the findings doc §9.

| Decision | Choice | Alternatives considered |
|---|---|---|
| Frame | Accept findings §7 recommendation | Fractal SFC; matrix-as-primary; full S88; S7-GRAPH (all rejected in findings §8) |
| Mode keying (Q3) | Top-level orthogonal axis, default `auto` | Override map on base state; hybrid |
| State vocab migration (Q1) | Hard cutover with per-project engineer-confirm | Hard one-shot; soft/lazy |
| Section table fate (Q4) | Materialised view, rebuilt on contract write | Delete entirely (editor edits contract); user-edit overlay |
| Interlock deprecation (Q2) | Hard cutover, bundled with PackML/modes migration | Soft/additive parallel fields; deferred separate release |
| Sequencing vs FB library (Q5) | Merge FB library first; FDS engine on top | FDS first then rebase; interleaved |
| Config param expressiveness (Q6) | Discrete enums only | Typed primitives (enum/number/bool); full parametric with derived |
| Branches/monitors UI (Q7) | Monitor picker only; defer parallel-branch UI | Build both; both via direct contract edit only |
| DOCX markup ingest (Q8) | Out of scope | In scope; mark dead |
| Redundant section types (Q9) | Keep as sections, key only by project | Consolidate into typed `spec_projects` columns; leave as-is |
| Test corpus (Q10) | Four specs is enough | Add recipe-multi-product spec; add continuous-process spec |
