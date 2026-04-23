# Assembly FB Library — Design Plan

**Status:** DRAFT
**Owner:** Kasper
**Created:** 2026-04-23
**Related triage:** PILOT-001-009 (architecture shift, connect existing Forge infrastructure to Spec Builder)

## 1. Goal

Replace today's greenfield assembly authoring (engineer describes sequence to the Co-Author, AI invents steps and handshakes from scratch) with a **library-first** model:

- Assembly = instance of an FbTemplate record with a typed interface contract.
- Engineer picks the template, wires instance parameters (which IO signals connect to which interface input), sets instance overrides. No sequence authoring for standard assemblies.
- Forge generates code by copying the template + injecting instance params (existing path, per PILOT-001-009 fb-researcher audit).
- Subsystem orchestration (SFC) is where the cross-assembly sequence logic lives, operating on assembly inputs/outputs.

This plan covers the Assembly FB Library itself — the catalog, the schema, the authoring UX, and the wire-through to Spec Builder. The ProcessLogic / ProcessState UDT work + the subsystem SFC authoring + the Co-Author prompt rewrite are adjacent workstreams tracked under PILOT-001-009; this plan scopes deliberately to the library layer they depend on.

## 2. Current state

Per code audit (fb-researcher, team `pilot-triage-research`, 2026-04-23):

**What exists:**
- `FbTemplate.is_assembly: boolean` column on `fb_templates` (migration 058).
- `FbTemplate` carries: `name`, `device_category`, `plc_brand`, `description`, `tags`, `source` (custom/library/standard), `library_name`, `is_enabled`, `documentation`, `hmi_faceplate_type`, `version`, and a `blocks[]` array of `FbTemplateBlock` records (each with `block_name`, `block_type`, `scl_code`, `block_xml`, `programming_language`, `sort_order`).
- `FbTemplate` profile linkage via `profile_ids[]`.
- FB Library UI (`src/routes/fb-library.tsx`) distinguishes assembly vs device templates in the authoring surface, with assembly-specific labelling.
- Forge `matchAssembliesToTemplates()` in `src/lib/forge-device-matcher.ts:141-190` — name + summary affinity scoring, same confidence thresholds as device matching.
- Forge `use-forge-assembly-generate.ts` — FDS-driven or standalone assembly generation via `copyTemplateAsAssemblyArtifacts()` + AI supplementation.
- Forge `forge-assembly-fb.tsx` — per-assembly gen + approval UI.
- PM agent `SPEC_ANALYSIS_SCHEMA` (`src/lib/forge-prompts.ts:120-129`) extracts assemblies from specs with 7 fields + `device_ids[]` linkage.
- `buildAssemblyContractPrompt()` (`src/lib/forge-prompts.ts:258-377`) teaches interface contract semantics.

**What's missing:**
- **Zero seeded `is_assembly=true` templates.** Library is empty of assembly content. All matching returns "none" → AI-generated-from-scratch every time.
- **No structured interface-contract declaration.** `documentation` field is free-text prose. Nothing to drive a form-based "wire the inputs" UX in the Co-Author.
- **Spec Builder Co-Author has zero FbTemplate awareness.** Grep `FbTemplate` in `src/hooks/use-fds-conversation.ts`, `fds-prompts.ts`, `fds-co-author.tsx` = zero matches.
- **No UDT member declarations on templates.** Templates can consume/produce ProcessLogic and ProcessState bits, but there's no structured field saying which.
- **Authoring path is custom-SCL only.** `source: library` implies "imported from TIA library doc" but the import path isn't productised (no TIA-import UI, no automated interface extraction).

## 3. Architectural decisions

### 3.1 Interface contract — structured schema, not prose

Add a structured `interface_contract` jsonb column to `fb_templates`:

```ts
type FbInterfaceContract = {
  // Function-block inputs the orchestration writes to this instance
  inputs: Array<{
    name: string;                    // "AutoRun"
    tia_name: string;                // "AutoRun" (exact SCL var name, may differ if aliased)
    data_type: "BOOL" | "INT" | "DINT" | "REAL" | "TIME" | "WORD" | "DWORD" | "STRING" | "UDT";
    udt_name?: string;               // only when data_type = "UDT"
    role: InterfaceInputRole;        // see enum below
    description: string;
    default_value?: string;
    required: boolean;
  }>;

  // Function-block outputs the orchestration reads
  outputs: Array<{
    name: string;
    tia_name: string;
    data_type: ...;                  // same enum
    udt_name?: string;
    role: InterfaceOutputRole;
    description: string;
  }>;

  // ProcessState / ProcessLogic members this FB reads or writes.
  // Template declares its bus contract so subsystem orchestration can wire.
  process_state_reads: string[];     // e.g. ["ProcessLogic.SAFETY_HEALTHY", "ProcessState_INFEED.TT_IN_AtHome"]
  process_state_writes: string[];    // e.g. ["ProcessState_INFEED.CV_IN_01_PackageReady"]

  // IO-signal role slots the instance must wire to. Drives the Co-Author's
  // "pick a tag from the instrument register" form.
  io_slots: Array<{
    slot_name: string;               // "discharge_photoeye"
    signal_type: "DI" | "DO" | "AI" | "AO";
    role: IoSlotRole;                // "discharge_sensor", "run_command", "fault_input", etc.
    description: string;
    cardinality: "one" | "zero_or_one" | "one_or_more";
  }>;
};
```

Role enums (closed sets, extended over time):

- `InterfaceInputRole` — `auto_run`, `start_cmd`, `reset_cmd`, `emergency_stop_in`, `permissive`, `upstream_ready`, `downstream_ready`, `setpoint`, `other`.
- `InterfaceOutputRole` — `running`, `at_home`, `at_target`, `faulted`, `fault_code`, `package_delivered`, `cycle_complete`, `ready`, `other`.
- `IoSlotRole` — `discharge_sensor`, `home_sensor`, `position_sensor`, `run_command`, `direction_command`, `fault_feedback`, `interlock_input`, `other`.

Rationale: role tags are what make the library composable. Subsystem orchestration can say "every conveyor assembly's `auto_run` input is driven by this step's action" — works regardless of how the conveyor template spells that input name internally.

### 3.2 Authoring workflow — four modes, ranked

**Mode A — Retrofit existing library entries (highest leverage).** Pac's FB library already contains useful templates (device-level and, likely, assembly-capable — Conveyor FB, Motor, Sensor, Solenoid, etc.). For each of these, the SCL is already in the DB; what's missing is the structured `interface_contract` + IO-slot labelling (and, for those that coordinate multiple devices, flipping `is_assembly = true`). The retrofit workflow:
  - Library UI gets a new "label interface contract" mode on any existing `FbTemplate`.
  - Engineer opens an existing entry, reviews the SCL's `VAR_INPUT` / `VAR_OUTPUT` declarations (parsed and shown as a starter table), assigns semantic roles to each (auto_run, start_cmd, ready, faulted…), declares IO slots, declares ProcessState reads/writes. Saves.
  - Same productive outcome as Mode B (inline authoring) but with zero authoring cost — the code already exists and is battle-tested.
  - This is the fastest path to a populated library with interface contracts. Probably covers 60–80% of the v1 seed catalog (§5).

**Mode B — TIA import.** For templates that exist in Pac's TIA library project but aren't yet in the Pac-Forge FB library. Engineer exports a known-good FB from TIA Portal (SCL + declaration). Upload flow runs a parser that extracts `VAR_INPUT` / `VAR_OUTPUT` blocks and pre-fills the interface-contract table. Engineer reviews/labels roles + IO slots, saves. Same productive endpoint as Mode A; different starting data source.

**Mode C — Inline authoring from scratch.** Engineer writes the SCL inline in the FB Library editor, fills the interface-contract form manually. Useful for custom templates that don't exist anywhere else yet.

**Mode D — AI-assisted.** Engineer provides a description ("single-motor VSD conveyor with discharge photoeye"), AI generates SCL + interface-contract scaffolding. Engineer reviews + edits. Quality depends heavily on catch-rate of the review layer (PILOT-001-010). Lowest priority.

Priority: **A first, B second, C third, D last**. Phase 0's library audit (§6) determines how much of the v1 catalog lands via retrofit vs TIA import vs fresh authoring — expect retrofit to dominate.

### 3.3 Spec Builder integration — the missing wire

Today `AssemblyConfig` (spec-builder wizard shape) + `AssemblyV2` (SpecContractV2 shape) have `devices[]` but no template reference. Add:

```ts
interface AssemblyConfig {
  // existing
  assembly_id: string;
  assembly_name: string;
  description: string;
  devices: DeviceConfig[];
  // new — library binding
  fb_template_id: string | null;                  // picked by engineer (or AI-matched)
  fb_template_version: number | null;             // pinned at pick time
  instance_params: Record<string, string>;        // role-slot-name → register tag name
  instance_overrides?: Record<string, unknown>;   // optional per-instance parameter overrides
  // new — intent hook (see §3.7 and PILOT-001-011)
  process_intent: string | null;                  // 1-2 sentences: "what does this assembly do in the overall process?"
}
```

Same additions to `AssemblyV2Schema` in SpecContractV2.

Co-Author flow for each assembly:
1. **Phase 2 Machine Hierarchy** already runs `matchAssembliesToTemplates()` on confirmed assemblies. When confidence ≥ probable, pre-select the `fb_template_id`. When confidence = none, flag the assembly and ask the engineer to pick manually.
2. **Phase 3 Co-Author** opens the assembly and shows the template's interface contract as a form — one row per `io_slots` entry, each with a picker scoped to this assembly's devices + signals.
3. Engineer wires slots, reviews any instance parameters, clicks Done.
4. No sequential-state authoring for template-backed assemblies. The "sequence" is the template's SCL.
5. Complex assemblies (e.g. a transfer table with mode machine) can expose parameter overrides (timeouts, ramp rates) rather than editable steps.
6. Fallback for unmatched assemblies: today's authoring flow remains as an escape hatch until the library gets seeded further.

### 3.4 UDT declarations on the template

Each template's `process_state_reads[]` and `process_state_writes[]` are the source of truth for what ProcessState members it touches. Subsystem ProcessState UDTs are **assembled** from the union of all member assemblies' declarations at spec time, not authored manually.

Example: if `INFEED` subsystem contains two `conveyor_standard_vsd` templates + one `transfer_table_2axis` template, the `ProcessState_INFEED` UDT is auto-built from:
- each conveyor's declared writes (`CV_IN_01_PackageReady`, `CV_IN_02_PackageReady`)
- the transfer table's declared reads/writes (`TT_IN_AtHome`, `TT_IN_PackageDelivered`)

Plus engineer-authored members for anything the templates don't cover.

### 3.5 Versioning + evolution

`FbTemplate.version` already exists. Policy:

- **Pin on pick.** When a spec binds an assembly to a template, the template's version is pinned. Later library edits don't silently retrofit.
- **Upgrade prompt.** When the library has a newer version of a pinned template, the spec detail view shows an "Upgrade available" indicator with a diff view. Engineer chooses whether to upgrade.
- **Breaking changes.** Interface-contract changes (adding/removing roles, changing required fields) bump the major version. Projects on a prior major stay on it; explicit migration step required to upgrade.
- **Deprecation.** Templates can be marked `deprecated: true` (future column). New specs can't bind to them; existing ones keep working.

### 3.7 Process-intent hook (minimal, for later expansion)

Carry one nullable prose field per assembly — `process_intent: string | null`. Co-Author asks one question during the library-wiring interview: *"In 1-2 sentences, what is this assembly's role in the overall process? Why does it exist?"*

DOCX exporter ignores the field for v1. Why include it at all in v1? Because the richer intent-narrative work (full Catodo-style intent-before-structure at system/subsystem/state/assembly layers; DOCX exporter changes; Co-Author rewrite to lead with intent) is tracked as its own triage item (**PILOT-001-011**) and deliberately scheduled *after* the library lands. If we ship the library without this hook, every existing assembly needs re-interviewing when PILOT-001-011 gets worked; with the hook, the data is already there and the later work just wires the field into the exporter + Co-Author flow. Zero-cost insurance against backfill debt.

### 3.6 Migration for existing projects

`PILOT-001-v1` and any other in-flight projects authored pre-library stay on the current free-form sequence model. A migration helper can, for each of their assemblies, attempt to match a library template and propose the mapping — but migration is engineer-triggered, not automatic. New projects default to library-first.

## 4. Data model changes

One migration: `074_assembly_fb_library.sql`.

### 4.1 Columns added to `fb_templates`

```sql
ALTER TABLE fb_templates
  ADD COLUMN interface_contract jsonb NOT NULL DEFAULT '{}',   -- structured shape per §3.1
  ADD COLUMN deprecated boolean NOT NULL DEFAULT false;
```

`interface_contract` defaults to `{}` so existing custom templates don't break; Co-Author falls back to today's flow when the contract is empty.

### 4.2 Columns added to spec-builder tables

```sql
-- Per assembly in the wizard
ALTER TABLE fds_assembly_sessions
  ADD COLUMN fb_template_id uuid REFERENCES fb_templates(id),
  ADD COLUMN fb_template_version int,
  ADD COLUMN instance_params jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN instance_overrides jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN process_intent text;     -- §3.7 hook; 1-2 sentences per assembly
```

Also flow into `AssemblyV2Schema` / the stored SpecContractV2 jsonb.

### 4.3 No changes to existing FB library blocks

`fb_template_blocks` stays exactly as-is — the `blocks[]` array still holds the SCL / LAD / SimaticML artefacts. The new interface-contract column is metadata about how the blocks are parameterised and wired; the blocks themselves don't change.

## 5. Canonical v1 catalog (8 assembly templates)

Starting seed, tuned to Pac's typical machine domain. Each has: interface contract sketch, IO slot list, ProcessState interaction.

### 5.1 `conveyor_standard_vsd`
- Single VSD-driven conveyor (Sinamics G120C or equivalent). PROFINET telegram 352 + safety 30.
- **Inputs:** `AutoRun` (BOOL), `SpeedSetpoint` (REAL, Hz), `Permissive_SafetyHealthy` (BOOL), `Permissive_DriveReady` (BOOL), `Reset` (BOOL, edge).
- **Outputs:** `Running` (BOOL), `AtSpeed` (BOOL), `Faulted` (BOOL), `FaultCode` (WORD), `PackageAtDischarge` (BOOL, mirrored from PE).
- **IO slots:** `discharge_photoeye` (DI), `vsd_drive` (UDT drive telegram reference).
- **ProcessState writes:** `<subsystem>_<assembly>_PackageAtDischarge`.

### 5.2 `conveyor_standard_dol`
- Fixed-speed direct-on-line conveyor. Motor contactor + overload input.
- **Inputs:** `AutoRun`, `Reset`, `Permissive_SafetyHealthy`.
- **Outputs:** `Running`, `Faulted`, `FaultCode`, `PackageAtDischarge`.
- **IO slots:** `discharge_photoeye` (DI), `motor_contactor_cmd` (DO), `motor_running_feedback` (DI), `overload_relay_fault` (DI).
- **ProcessState writes:** `<subsystem>_<assembly>_PackageAtDischarge`.

### 5.3 `transfer_table_2axis`
- Lift + traverse transfer table (like PILOT-001 TT_IN). 1 lift solenoid, 1 traverse motor (fwd/rev contactors), 4 position proxes.
- **Inputs:** `AutoRun`, `CommandMode` (INT enum: Home / Receive / Transfer / Return), `Reset`, `Permissive_SafetyHealthy`.
- **Outputs:** `AtHome`, `AtEndB`, `Lifted`, `Lowered`, `Running`, `Faulted`, `FaultCode`, `CycleComplete`.
- **IO slots:** `lift_solenoid` (DO), `traverse_fwd_cmd` (DO), `traverse_rev_cmd` (DO), `prox_up` (DI), `prox_down` (DI), `prox_end_a` (DI), `prox_end_b` (DI).
- Internal mode machine handled within the FB (per §3.1); orchestration commands the mode, reads the complete bits.

### 5.4 `turntable_single_stop`
- Rotate between two fixed positions (e.g. 0° and 90°). 1 rotation motor, 1 brake solenoid, 2-4 position proxes.
- **Inputs:** `AutoRun`, `CommandPosition` (BOOL: Home / Rotated), `Reset`.
- **Outputs:** `AtHome`, `AtRotated`, `Running`, `Faulted`, `FaultCode`.
- **IO slots:** `rotation_fwd_cmd`, `rotation_rev_cmd`, `brake_release`, `prox_home`, `prox_rotated`.

### 5.5 `pusher_linear_cylinder`
- Pneumatic or hydraulic linear pusher with 2 end-of-stroke sensors. For package diversion / load handling.
- **Inputs:** `AutoRun`, `CommandExtend` (BOOL), `Reset`.
- **Outputs:** `Extended`, `Retracted`, `InTransit`, `Faulted`, `FaultCode`.
- **IO slots:** `extend_solenoid`, `retract_solenoid` (optional for double-acting), `prox_extended`, `prox_retracted`.

### 5.6 `diverter_swing_gate`
- 2-way sortation node. Steers package to lane A or lane B.
- **Inputs:** `AutoRun`, `CommandLane` (BOOL: A / B), `Reset`.
- **Outputs:** `AtLaneA`, `AtLaneB`, `Moving`, `Faulted`, `FaultCode`.
- **IO slots:** `gate_actuator_cmd_a`, `gate_actuator_cmd_b`, `prox_at_a`, `prox_at_b`.

### 5.7 `lift_station_vertical`
- Vertical lift with 2-3 fixed levels. Single motor or hydraulic.
- **Inputs:** `AutoRun`, `CommandLevel` (INT), `Reset`, `Permissive_LoadClear` (BOOL).
- **Outputs:** `AtLevel` (INT), `Moving`, `Faulted`, `FaultCode`, `EmergencyDescendActive`.
- **IO slots:** `up_cmd`, `down_cmd`, `level_proxes[]` (one-or-more cardinality).

### 5.8 `accumulator_buffer_conveyor`
- Conveyor with upstream blocking + downstream release logic. Holds a queue of N packages between stations.
- **Inputs:** `AutoRun`, `UpstreamReady` (BOOL, from feeder assembly), `DownstreamReady` (BOOL, from discharger), `Reset`.
- **Outputs:** `Full`, `Empty`, `Running`, `Faulted`, `PackageCount` (INT, optional).
- **IO slots:** `infeed_photoeye`, `discharge_photoeye`, `motor_contactor_cmd`, `motor_running_feedback`, `overload_relay_fault`.
- **ProcessState writes:** `<subsystem>_<assembly>_Full`, `<subsystem>_<assembly>_Empty`.

### 5.9 (Stretch) `indexing_conveyor_step`
- Run-forward-N-pitches-then-stop indexing behaviour. For stamping/stamp-and-forward, step-index filling.
- Deferred to v1.1 unless Pac has a template already that drops in easily.

### 5.10 (Stretch) `clamp_station_single`
- Two-position clamp (clamped / released) with force or position feedback.
- Deferred to v1.1 unless already templated.

**Out-of-scope for v1:** robotic cells, multi-axis coordinated motion, safety-rated motion, vision-integrated sortation. These deserve their own template category and authoring flow.

## 6. Implementation sequence (proposed phases)

Run on a dedicated worktree / branch — scope is big enough that main-branch stability matters. Rough phase sequence with t-shirt sizes:

0. **Phase 0 — Library audit (S).** Enumerate existing templates (device + assembly) in the DB, categorise, identify gaps vs the §5 catalog. For each existing template: is it already at assembly-level semantically (just flagged `is_assembly=false`)? Is it a genuine device-level primitive that needs to be composed into an assembly? How many of the v1 catalog (§5) slots does the current library already satisfy via retrofit (Mode A), vs need TIA import (Mode B) or authoring (Mode C)? Output: a retrofit/import/author-from-scratch split per v1 catalog slot.

1. **Phase 1 — Migration + type updates (M).** `074_assembly_fb_library.sql` + `FbInterfaceContract` type + update `FbTemplate` type in `src/types/fb-template.ts`. TypeScript types flow through; no UI changes yet.

2. **Phase 2 — FB Library UI for interface-contract editing (L).** Extend `src/routes/fb-library.tsx` with a structured interface-contract editor — rows for inputs/outputs/io_slots/process_state references. The editor is available on **any** FbTemplate record, not just new ones — this IS Mode A's UI (retrofit existing) and also the completion step for Modes B/C/D. Build once, all authoring paths use it.

3. **Phase 3 — TIA import path (M).** SCL parser for `VAR_INPUT` / `VAR_OUTPUT` blocks → interface contract scaffolding. For Mode A (retrofit) the parser runs against the stored `blocks[].scl_code` and pre-fills the Phase-2 editor form when the engineer opens an existing template. For Mode B (TIA import) same parser runs on uploaded `.scl` / `.xml` exports. One parser, two entry points.

4. **Phase 4 — Seed v1 catalog (L-parallelisable to M).** Build the 8 canonical templates (§5). Phase 0's audit determines the split — likely: retrofit N existing Pac library FBs with interface contracts (cheap, just labelling); import M more from TIA; author K from scratch. Content work, volume-parallelisable. Likely finishes faster than the L estimate if retrofit dominates.

5. **Phase 5 — Spec Builder integration (L).** Extend `AssemblyConfig` + `AssemblyV2` types + migrations for spec-builder tables. Phase 2 Machine Hierarchy runs template matching, displays picks. Phase 3 Co-Author renders the interface-contract form for template-backed assemblies; falls back to current authoring for unmatched. Also includes the minimal `process_intent` hook (§3.7 / PILOT-001-011 Phase A) — one textarea, one interview question, field persists. DOCX exporter untouched for v1; full intent-narrative work is its own later stream.

6. **Phase 6 — Subsystem orchestration SFC authoring (L).** (Separate workstream per PILOT-001-009.) Orchestration editor extends to full SFC: steps, guards, actions writing to assembly inputs. Paired with Phase 5 so template-backed specs can actually drive their assemblies.

7. **Phase 7 — Forge wire-through verification (M).** `use-forge-assembly-generate.ts` already consumes FbTemplate.blocks; verify it picks up `interface_contract` + instance_params for parameterised generation. `use-forge-process-generate.ts` needs the assembly-awareness upgrade (per fb-researcher gap #1).

8. **Phase 8 — AI-assisted authoring (S).** Mode C — describe → generate scaffolding. Lower priority; only after modes A+B have real content.

9. **Phase 9 — Versioning + upgrade UI (M).** Template pinning, upgrade-available indicator, diff view, explicit upgrade action.

10. **Phase 10 — Pilot re-run on new flow (S).** Re-do PILOT-001 on the library-first path; compare to manual-authoring baseline.

Rough total: L×5 + M×4 + S×3 ≈ 6–8 focused weeks if one engineer + library-content volunteer. Phases 1–3 are serial (schema → UI → import); Phases 4 (content) and 5 (integration) can run in parallel from there.

## 7. Success criteria + exit bar

**v1 library ships when:**
- [ ] 8 of the §5 catalog templates are seeded, each with: documented interface contract, SCL code, compile-clean in TIA V18, at least one live-tested instance.
- [ ] Engineer can author a new spec project that binds assemblies to templates without writing any per-assembly sequence. PILOT-001 re-run exercises this.
- [ ] Forge generation on a template-backed spec produces compile-clean TIA code using the template's blocks + instance params.
- [ ] Pac-Audit round-trip on template-backed Forge output classifies all assembly FBs correctly and resolves their ProcessState references to the generated UDT members.
- [ ] ProcessLogic + per-subsystem ProcessState UDTs are auto-generated from template declarations during spec finalisation.

**v1 does NOT need (deferred to v1.1):**
- AI-assisted authoring (Mode C).
- TIA export back to a `.zap` library (we're consuming library; Pac still authors in TIA directly).
- HMI faceplate auto-generation from `hmi_faceplate_type` (separate HMI workstream).
- Versioning UI (pin behaviour lands in schema; upgrade UX deferred).

## 8. Open questions

1. **Do existing `is_assembly=false` device templates get the same interface-contract treatment?** The same schema applies (motor FB has `AutoRun` input, `Running` output, IO slots for contactor + feedback). Would be a logical extension. Recommend yes — one schema, two scopes. Verify by stress-testing with an existing device template during Phase 2.

2. **ProcessState UDT name scheme.** `ProcessState_INFEED` works for PILOT-001 but some subsystems may have nested groupings. Need a naming convention before Phase 4's seed content commits to anything fixed. Options: flat per-subsystem, or per-subsystem / per-state combined.

3. **Interface contract vs existing `buildAssemblyContractPrompt()` prompt.** The prompt teaches AI the abstract concept; the new column carries structured declarations. When both exist, which wins? Recommendation: prompt describes *how to fill* the contract; column *is* the contract. Prompt references the column when generating.

4. **Role-enum extensibility.** Closed enums are safer for validation but harder to evolve. Could we allow a `role: "custom:<engineer-defined-name>"` escape hatch? Decide before Phase 2 locks the UI.

5. **Template scoping to design profiles.** `FbTemplate.profile_ids[]` exists for profile-gated visibility. Does the assembly library respect it? Yes — should, same as device library.

6. **Where does the subsystem SFC UI live?** PILOT-001-007's orchestration editor was the wire for named-prose orchestrations. The SFC version needs a richer editor — same tab location, extended component, or a new Phase 4 in Spec Builder? Decide as part of Phase 6 before building.

7. **Pac-Audit classification rule for library-backed assembly FBs.** Today R09 fires on "instantiates ≥2 device FBs". Library-backed assemblies may not instantiate any (they own their logic). Need a new audit rule: R09b — "is a known library template instance". Data source: the generated project carries a reference back to `fb_template_id` (via `library_name` + block comment). Confirm reliability.

## 9. Next steps

1. Review + approve this plan (engineer signoff — Kasper).
2. Create worktree / feature branch: `feature/assembly-fb-library`.
3. Kick off Phase 0 (library audit) to ground the Phase 4 content plan.
4. Build Phase 1 (schema + types) — landing point for downstream Phase 2–3 work.
5. Pac's existing TIA library FBs are the seed material — confirm availability + access early.
