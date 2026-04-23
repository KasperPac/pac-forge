# Assembly FB Library — Phase 0 Library Audit

**Status:** COMPLETE
**Owner:** Kasper
**Date:** 2026-04-23
**Branch / worktree:** `feature/assembly-fb-library`
**Plan reference:** `Docs/ASSEMBLY_FB_LIBRARY_PLAN.md` §6 step 0
**Snapshot:** `Docs/_phase0_fb_templates_snapshot.tsv` (raw enumeration; 105 rows)

## 1. Purpose

Per plan §6 step 0: enumerate every FbTemplate currently in the production Supabase `fb_templates` table, categorise device-level vs assembly-capable, and produce a retrofit (Mode A) / TIA-import (Mode B) / author-from-scratch (Mode C) split per slot of the v1 catalog (plan §5). Output feeds Phase 4's content plan and right-sizes the Phase 4 t-shirt estimate.

## 2. Method

- Pulled live `fb_templates` rows via Supabase REST (`/rest/v1/fb_templates`) — anon read works (RLS `fb_templates_select` policy permits read).
- For the 5 `source = custom` templates (Pac-authored), fetched full `description` + `ai_summary` to assess scope.
- For the 100 `source = library, library_name = "Open Library V19 PLC_V20"` templates, used name + auto-generated descriptions; `fb_template_blocks` SCL was not retrievable via anon (separate RLS policy `TO authenticated`). Categorisation relied on naming convention (Open Library V19 = the published Siemens "OL"/LGF-style open library; well-known shapes).
- Mapped each existing template to the v1 catalog slots (plan §5.1–§5.10) and assigned a Mode A/B/C verdict.

**Auth gap (minor):** Ground-truth SCL inspection of the 100 OL-imported FBs would tighten the mapping in §5 below. Not blocking — naming + library provenance gave high-confidence calls. Flag if Phase 4 wants byte-level certainty before committing to a Mode label.

## 3. Headline numbers

- **105 templates** in `fb_templates`. All `is_enabled = true`. `version` distribution unsurveyed (assumed mostly v1).
- **0 templates with `is_assembly = true`.** Confirms plan §2 "Zero seeded `is_assembly=true` templates."
- **Source split:** 100 from `Open Library V19 PLC_V20` (single bulk import; Siemens OL primitives + utilities), 5 `custom` (Pac-authored in-app).
- **`device_category` histogram:**

| Category | Count | Notes |
|---|---:|---|
| Supplementary | 50 | Utility FCs/FBs/UDTs (string ops, bit manipulation, Modbus, ramps, timers, queues) — not assembly-relevant |
| vfd | 14 | Vendor VFD wrappers (Sinamics G/V20, Danfoss, ABB, Honeywell, Yaskawa, Servo Unidrive, Simocode, parameter RW) — all device-level |
| process_control | 9 | PID, FIFO, integrators, level monitors, hopper-level, totalisers, rate calc — utilities + 1 borderline (`fbHopperLevel`) |
| Motor | 6 | DOL/soft-starter/reversing/airlock motor — all device-level except `fbAirlock_Motor` (borderline assembly) |
| instrument | 5 | Siwarex weighing variants — device-level |
| Safety | 4 | Custom `ControlEStop` + 3 OL utilities (interlock, permissive, alarm/warning) |
| system | 4 | `fbStepSequencer` (sequence engine), `Automatic_systems_AS1320` (vendor), 2 HMI UDTs |
| Valve | 4 | Solenoid / hydraulic / analog / Auma — all device-level |
| analog_io | 2 | OL AI/AO wrappers |
| digital_io | 2 | OL DI/DO wrappers |
| io | 2 | `fbPulser`, `fbPWM` |
| Conveyor | 1 | `Conveyor No ZPA` (custom) — only conveyor-named template; assessed in §4 |
| Pushbutton | 1 | Custom |
| Sensor | 1 | Custom `PE_Sensor` |

## 4. Categorisation: device vs assembly-capable

Three tiers emerge:

### 4.1 Device-level primitives (single physical thing or single signal channel)

The vast majority. All Motor/vfd/Valve/instrument/digital_io/analog_io entries plus most Sensor/Safety/Pushbutton entries.

- **Custom (4):** `ControlMotor_DOL` (bidirectional 4-mode DOL motor controller with feedback supervision + 4 fault classes), `PE_Sensor` (debounced photoeye with on/off-delay timers + force mode), `Pushbutton` (short/long-press state machine), `ControlEStop` (latching NC-contact safety interlock with hold-to-reset).
- **OL library — drives (14):** `fbVFD_GSeries`, `fbVFD_GSeriesAdvanced`, `fbVFD_V20`, `fbVFD_Analog`, `fbVFD_Danfoss`, `fbServo_Unidrive`, `fbMotor_Simocode`, `fbAsyncParameterRW_VFD`, `Abb_ach_400_ac_drives`, `Danfoss_AquaDrive`, `Danfoss_VLT`, `Honeywell_variable_frequency_drives`, `Yaskawa_e7_drive`, `Automatic_systems_AS1320`. All are PROFIdrive / vendor telegram wrappers — control one drive each.
- **OL library — motors (5):** `fbMotor_Reversing`, `fbMotor_SoftStarter`, `fbMotor_SoftStarter_3RW44`, `fbMotorStarter_ET200`. Control one starter / motor each.
- **OL library — valves (4):** `fbValve_Solenoid`, `fbValve_Analog`, `fbValve_Hydraulic`, `Auma_valve`. Control one valve each.
- **OL library — IO (6):** `fbIO_DigitalInput`, `fbIO_DigitalOutput`, `fbIO_AnalogInput`, `fbIO_AnalogOutput`, `fbPulser`, `fbPWM`. Single-channel signal processing.
- **OL library — instruments (5):** Siwarex weighing variants. Single load-cell amplifier each.

### 4.2 Borderline / utility (could play a part in assemblies but aren't assembly templates themselves)

- **`Conveyor No ZPA` (custom).** Closest thing to an assembly template in the DB. Internal 4-state machine (IDLE / RUNNING_FORWARD / RUNNING_REVERSE / FAULT), pulse-triggered run + reset, configurable delivery + jam timeouts, latched faults, end-of-travel sensor monitoring. **However:** the operational model is *pulse-and-monitor* (one transport cycle per run pulse, completes on delivery sensor) rather than the *continuous AutoRun* model the v1 catalog assumes (plan §5.1, §5.2). It assumes the conveyor moves a single package between two end sensors and reports completion — a niche shape, not the general-purpose continuous conveyor. Could be retrofit to a *new* v1 slot ("transport-cycle conveyor") rather than retrofit `conveyor_standard_dol` directly.
- **`fbAirlock_Motor`, `fbAirlock_VFD_GSeries` (OL).** Airlock = door + lock + motor coordination. Out-of-scope for v1 catalog (no `airlock_*` slot); assembly-shaped though. Defer to v1.1 if Pac uses airlocks.
- **`fbHopperLevel` (OL).** Multi-sensor hopper level coordination + `fbLevelMonitor`. Borderline — could fold into a future `silo_level_monitor` assembly slot. Not in v1 catalog.
- **`fbStepSequencer` (OL).** Generic SFC engine — useful as the *implementation primitive* inside assemblies that have an internal mode machine (e.g. `transfer_table_2axis`). Building block, not a slot.
- **`fbInterlock`, `fbPermissive` (OL safety utilities).** Composable safety-interlock primitives. Building blocks for the `Permissive_*` interface inputs in v1 catalog templates. Not slots themselves.
- **`fbQueueHandshakes` (OL).** Inter-station handshake utility. Could underpin `accumulator_buffer_conveyor`'s upstream/downstream ready handshake. Building block.

### 4.3 Pure utility / non-assembly relevant (most of `Supplementary`)

The 50 `Supplementary` entries are time/bit/string/byte/word manipulation, Modbus stacks, FIFO, ramps, integrators, type converters, etc. None map to assembly slots. Will continue to be useful as inner primitives but don't change the audit shape.

**Net categorisation:**
- Genuine assembly-level templates already in DB: **0**.
- Borderline / partial assembly with caveats: **1** (`Conveyor No ZPA` — wrong operational model for v1's `conveyor_standard_dol`, possible new niche slot).
- Useful device-level building blocks for composing v1 catalog: **~40** (motor controllers, drive wrappers, sensor processors, valves, IO wrappers, safety primitives, sequencers, queues).

## 5. v1 catalog — retrofit / import / author split

| # | Slot (plan §) | Closest existing | Mode | Confidence | Notes |
|---|---|---|---|---|---|
| 5.1 | `conveyor_standard_vsd` | None directly | **C — author** | high | Compose `fbVFD_GSeries` (or `_V20`/`_Advanced`) + `fbIO_DigitalInput` + new continuous-AutoRun orchestration with PROFINET telegram 352 fault decoding + safety telegram 30 hooks. Open question on whether to template-bind to one VFD family or keep VFD selection as an instance parameter. |
| 5.2 | `conveyor_standard_dol` | `ControlMotor_DOL` (custom, motor primitive) + `PE_Sensor` (custom). `Conveyor No ZPA` is *not* a fit — pulse-cycle model vs continuous AutoRun. | **C — author** | high | Compose `ControlMotor_DOL` + `PE_Sensor` with continuous AutoRun + overload-relay DI + run-feedback DI. |
| 5.3 | `transfer_table_2axis` | None | **C — author** | high | New build. Internal mode machine over `fbStepSequencer` is the natural primitive. PILOT-001 TT_IN is the reference shape. |
| 5.4 | `turntable_single_stop` | None | **C — author** | high | New build. Same shape as 5.3 but simpler (1 axis, 2 positions). |
| 5.5 | `pusher_linear_cylinder` | `fbValve_Solenoid` (OL) for the actuator | **C — author** | high | New build composing solenoid + 2 EOS sensors. |
| 5.6 | `diverter_swing_gate` | None | **C — author** | high | New build. Could share core with 5.4 (turntable) — both are 2-position rotary actuators. Worth designing them as a family. |
| 5.7 | `lift_station_vertical` | None | **C — author** | high | New build. Up/down commands + level proxes. `Permissive_LoadClear` interlock. |
| 5.8 | `accumulator_buffer_conveyor` | `fbQueueHandshakes` (OL utility), `fbFIFO` (OL utility) | **C — author** | high | New build. Same DOL conveyor primitive as 5.2 + queue logic on top. |
| 5.9 | `indexing_conveyor_step` (stretch) | `fbStepSequencer` + motor primitives | **C — author** | medium | Stretch. Defer to v1.1 per plan. |
| 5.10 | `clamp_station_single` (stretch) | None | **C — author** | medium | Stretch. Defer to v1.1 per plan. |

**Verdict: 8/8 v1 catalog slots → Mode C (author from scratch).** Mode A retrofit count: **0**. Mode B (TIA import) count: **unknown — see §6.**

## 6. Plan recalibration

Plan §3.2 hypothesised: *"Probably covers 60-80% of the v1 seed catalog via retrofit."*

**Reality contradicts this.** The Open Library V19 PLC_V20 import — Pac's bulk library source — is a Siemens-OL-style **device-primitive + utility** library. It deliberately stays at the device level so application engineers can compose it into project-specific orchestration. There are no assembly-coordination FBs in it. The 5 Pac-custom templates also stayed device-level (plus the one borderline pulse-cycle conveyor).

**Implications:**
1. Plan §6 Phase 4 ("Seed v1 catalog") needs to be **re-scoped from "L parallelisable to M"** (label-and-import-heavy) **to a dedicated authoring exercise** (closer to true L). 8 templates × full SCL authoring + interface-contract + ProcessState declarations. Not a labelling pass.
2. Plan §6 Phase 3 (TIA-import path) loses its primary justification *for the v1 catalog* — there's nothing to retrofit. It still has value for ongoing library growth (engineers exporting custom assembly FBs from TIA into Pac-Forge), but it's no longer on the critical path for v1 ship.
3. Plan §3.2 priority order ("A first, B second, C third, D last") is preserved as a *general* policy but for v1 specifically it's effectively "C for everything in v1; A becomes the policy for Phase 4+ as engineers extend the library; B remains the import doorway for new TIA-authored content".
4. Phase 0 has a new exit: **before scoping Phase 4, ask Kasper whether Pac's TIA library project (the .zap file the OL was extracted from, or a separate Pac-authored TIA library project) contains assembly-level FBs** that weren't part of the OL bulk import. If yes, Mode B becomes viable for some slots — would need a one-shot import pass against those source FBs. If no, confirm Mode C-everything.
5. `Conveyor No ZPA` (custom) deserves a decision: keep it (cycle-transport conveyor — niche but useful), formally retrofit it as a new v1.1 slot (`conveyor_cycle_transport`), or retire it. Not blocking v1.

## 7. Open questions for Kasper

1. **TIA library content.** Does Pac maintain a TIA library project containing **assembly-level** FBs (e.g. complete conveyor FBs, transfer-table FBs) that weren't part of the Open Library V19 import? If yes, can it be made available so Phase 3 (TIA import) can populate v1 slots via Mode B? Decision changes Phase 4's t-shirt size meaningfully.
2. **`Conveyor No ZPA` disposition.** Keep / retire / promote to a v1.1 slot? It's the only existing borderline-assembly artefact in the library.
3. **Airlock / hopper-level future.** OL provides assembly-shaped FBs for airlocks (`fbAirlock_Motor`, `fbAirlock_VFD_GSeries`) and hopper-level coordination (`fbHopperLevel`). Add to v1.1 catalog as `airlock_motor` and `silo_level_monitor` slots? Both have ready-made retrofit candidates.
4. **VFD family templating.** `conveyor_standard_vsd` (plan §5.1) is written assuming Sinamics G120C + telegram 352. Should the template hard-bind to that, or be parameterised so an instance can pick `fbVFD_V20` / `fbVFD_GSeriesAdvanced` / a Danfoss variant? Affects how `interface_contract.io_slots[].slot_name = "vsd_drive"` is typed.
5. **Auth surface for Phase 4 SCL inspection.** If we want to inspect existing `fb_template_blocks` SCL during Phase 4 (e.g. to be sure we're not duplicating logic), we'll need authenticated access. Currently anon RLS blocks `fb_template_blocks` reads. A short-lived service-role key for one-off audits, or a saved session token, would unblock — flag if you'd rather we avoid that.

## 8. Inputs to downstream phases

- **Phase 1 (migration + types):** unaffected by this audit. Schema design proceeds as planned (`interface_contract jsonb`, `deprecated boolean` on `fb_templates`; spec-builder columns).
- **Phase 2 (FB Library UI for interface-contract editing):** unaffected. The editor still gets used on retrofit candidates (the device-level templates listed in §4.1) once we want them to expose interface contracts to the spec-builder picker — same UI, smaller initial volume of assembly-level retrofit work.
- **Phase 3 (TIA import path):** still required, but its v1-critical-path role is conditional on Q1 above.
- **Phase 4 (seed v1 catalog):** all 8 slots are Mode C. Right-size the t-shirt to reflect authoring volume, not labelling. Authoring sequence suggestion: do `conveyor_standard_dol` first (highest reuse; PILOT-001 INFEED depends on it), then `conveyor_standard_vsd` (shares the assembly skeleton with DOL, swap motor primitive), then `transfer_table_2axis` (PILOT-001 TT_IN), then the rest.
- **Phase 7 (Forge wire-through):** unaffected at the audit level.

## 9. Recommendation

Proceed to Phase 1 (migration + types). The Mode-C-dominant outcome makes Phase 4 the heavy phase — shape that estimate before committing the project-level schedule, and answer Kasper's Q1 before locking it.
