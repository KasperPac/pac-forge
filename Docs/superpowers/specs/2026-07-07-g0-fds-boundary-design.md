# G0-6 — The FDS Boundary: what the app models vs commissioning engineering

**Date:** 2026-07-07 · **Status:** DECIDED (Kasper + Claude) · **Roadmap:** `Docs/ROADMAP-RUNNABLE-CODE-HMI.md` G0-6
**Evidence base:** every hand-authored artifact in the golden master `exports/SRL-1427-500802-PACKML/`
(UC_*.scl, MAP_*_Drive.scl, MAINT_*.scl, Rail_Config/Rail_Status/Maintenance_CMD/Indicators_Config DBs,
Main.ob ordering, hand-added EM pins) plus `Docs/COMMISSIONING-NOTES.md`.

## Why this decision exists

The deterministic writers can only emit what a contract models. Everything hand-authored during
HRE commissioning is controls-engineering data the FDS does not capture today. Before building
G0-1…G0-5 (and the G1–G8 writers on top), we must decide **where each kind of data lives** —
otherwise the FDS document either bloats with commissioning minutiae a customer would never sign,
or the writers stay starved and the hand-authoring delta never closes.

## The three-tier boundary (the decision)

| Tier | Test | Lives where | Examples |
|---|---|---|---|
| **1. FDS** | Describes *what the machine does / how it must behave*. A customer could reasonably sign it. | `SpecContractV2` proper; rendered in DOCX; co-author AI may ask about it | IO list incl. fail-safe polarity; drive family + telegram type per CM; coordination intent (signal→EM-pin routing policy); named config parameters with semantics + defaults; maintenance *capabilities* (which outputs overridable, which encoders presettable); alarms/faults |
| **2. Engineering Data** | Describes *how this delivery realizes the behavior*. Needed by codegen or the commissioning pack, but not customer-signable. | New optional top-level key `engineering` in the same contract JSON (see Realization) — **never rendered in DOCX, never mentioned by co-author prompts** | HW identifiers (HWIDSTW/ZSW); agreed RefSpeed/p2000 values; encoder scaling constants (mm/rev, counts/360); telegram word addresses (IW/QW); override output tag list; preset IO channels (ctrl/value/status); network/IP plan; drive parameter checklist |
| **3. Commissioning engineering** | Physically *doing* it on site. | Out of app scope. The app records intent/values (tier 2); humans execute. | DCP device-name/IP assignment clicks; entering p2000 in the drive expert list; Openness whitelist acceptance; panel user accounts; watch-table forcing |

**Rule of thumb:** if a different contractor delivered the same machine, tier 1 must not change;
tier 2 may; tier 3 is their site work.

## Realization — Approach A (embedded key)

`EngineeringDataV1` is a new Zod schema exposed as one **optional top-level key `engineering`** on
`SpecContractV2`. Rationale:

- Zero new plumbing: `loadSpecContract()` already feeds the deterministic compiler; codegen output
  stays a pure function of one document, and engineering data travels with spec revisions.
- No migration: the contract already lives in a jsonb column.
- The FDS/engineering boundary is **presentational**: the DOCX exporter and Stage A/B co-author
  prompts are forbidden from reading `engineering`. It gets its own editor surface later.

Rejected: separate `engineering_data` table (migration + second fetch path + revision-sync story
for a distinction an export-exclusion rule achieves); per-domain sidecar JSON blobs (unvalidated,
fragmenting).

## Inventory → classification (complete, from the golden master)

### A. Drive/telegram integration (`MAP_*_Drive.scl`) → G1
| Item | Tier | Notes |
|---|---|---|
| Drive FB family + telegram type per drive CM (SINA_SPEED/Std Tg 1, later SINA_POS) | 1 | G0-1 FDS side |
| Speed-reference unit convention (% of p2000, signed) | 1 | G0-1 FDS side |
| HWIDSTW/ZSW hardware identifiers | 2 | from TIA HW config; future: bridge lookup (record-only for now) |
| RefSpeed value (must equal drive p2000) | 2 | coupled to drive checklist row |
| ConfigAxis word | 2 | default 16#003F, overridable |
| Fault-ack source routing (`AckError := Reset_PB`) | 1 | coordination intent row |
| Enable policy (enable-on-nonzero-reference) | 1 | policy enum on the drive model |
| Setpoint %→rpm scaling + feedback rpm→% scaling | derived | writer emits from RefSpeed (tier 2) + unit convention (tier 1) |

### B. IO signal conditioning & polarity (MAP-layer signal treatment) → G1
| Item | Tier | Notes |
|---|---|---|
| N/C vs N/O flag per IO signal (thermistors, CB trips, brake-resistor faults) | 1 | G0-2 field on `IoListEntry` (today `failsafe_state` is free text); emitted as `NOT` inversion in MAP FCs |
| Requirement that a signal be debounced/filtered + functionally significant times (e.g. "absent 5 s before fault") | 1 | per-IO optional conditioning field; `AlarmRow.delay` / criteria `within_ms` already carry the alarm-level cases |
| Default conditioning values with no functional meaning (blanket input filter times, hysteresis bands) | 2 | engineering defaults, overridable per signal |
| Analog scaling block per AI/AQ: raw signal range (e.g. 4–20 mA) ↔ engineering-unit range (e.g. 0–100) + unit string (°C, bar, %) | 1 | signable IO-list content — FDS behavior (alarm setpoints, permissives, envelope limits) is written in these units, so the mapping defines what those numbers mean |
| Platform ADC representation (4–20 mA = 5530–27648 counts on S7) | derived | fixed platform physics; the MAP writer emits `NORM_X`/`SCALE_X` from the tier-1 block |
| Analog channel addressing (IW/QW offsets) | 2 | pairs with telegram-word addressing (table A) |
| Conditioning logic emission (TON/TOF, scaling blocks) | derived | MAP-layer writer (G1) so EM FBs see clean signals — **not evidenced in the golden master** (clean contacts + PROFINET encoders); modeled because the class is generic |

### C. Coordination policy (`UC_*.scl`) → G2
| Item | Tier | Notes |
|---|---|---|
| Safety-healthy aggregation term (healthy inputs AND NOT maintenance) | 1 | G0-3 |
| PackML command routing policy (walk-to-Execute, STOP on unhealthy, seq-test release) | 1 | G0-3 policy enum, per unit |
| Per-EM `ilk_` signal routing rows (source signal → EM pin, with gates) | 1 | G0-3 core model |
| Two-detent jog/fast suppression relationship | 1 | routing-row modifier |
| Cross-EM status routing (e.g. travelling detection from speed ref/fb; horn on Reset_PB) | 1 | routing rows with EM-DB members as sources — one-way reads |
| **EM↔EM handshake links** (conveyor→conveyor transfer, conveyor→elevator): named link between an EM pair with direction + pattern (transfer ready/release/done, request/grant) | 1 | declared once, writer emits **both sides' pins + the routing** consistently; ties to the process model's product path; not evidenced in the golden master (no product transfer on HRE) but core for any multi-EM flow machine |
| Handshake placement: routed through the UC (same unit) or between UCs (cross-unit, e.g. conveyor unit → elevator unit) — EMs never talk directly (ISA-88 §5.4 coordination control) | derived | writer rule; cross-unit case lands in the unit/cell coordination layer |
| Handshake pin sets + naming per pattern | derived | standard pin pair set emitted per pattern type |
| Product tracking model: what is tracked, transfer points (= the handshake links), data carried per tracked item | 1 | for conveyor/sortation machines; payload typing reuses category K's data-signal kind |
| First-out fault capture (which trip came first) as an alarm-philosophy flag | 1 | per unit or fault group; writer emits latch logic |
| Cause & effect matrix | derived | a *presentation* of routing rows + alarms/faults — DOCX section, not a new model (`AlarmRow.cause_effect` placeholder exists) |
| Encoder→engineering-unit scaling math (linear mm; rotary deg×10 with preset offset + normalization) | derived | writer emits from G0-4 params (tier 1 semantics, tier 2 constants) |
| Straight/home window definition (0° OR 180° ± band) | 1 | G0-4 |
| Envelope gates (end margin, ramp zone, fast→jog fallback) | 1 | G0-4 semantics; values are operator-set retentive |
| Status readback writes (`Rail_Status`) | derived | G4-2 writer output |
| Closed-loop one-shots (Straighten-Up self-clearing request) | **stays hand-authored for now** | G2-6 NEEDS_DESIGN unchanged |

### D. Config/status DBs → G4
| Item | Tier | Notes |
|---|---|---|
| Config parameter definitions (name, type, unit, semantics, default, RETAIN) | 1 | G0-4; `configuration_parameters` exists but is unused by codegen |
| Authorization role ladder (project-configurable; default: 0 View read-only · 1 Operator · 2 Supervisor · 3 Maintenance · 4 Engineer) | 1 | customers sign who may change what; new G0-10 |
| `required_level` per config parameter / setpoint / maintenance capability | 1 | authorization attaches to *items*, not screens; G7-5 screen-role assignment **derives** from item levels |
| Validity limits (min/max) + write-state preconditions per parameter (e.g. no scaling change while owning EM in Execute) | 1 | enforcement split: **HMI enforces who** (Unified access levels, G8-3); **PLC enforces what/when** (limits + state guards — also protects against dashboards/watch tables that bypass HMI auth). Identity checks in the PLC deliberately rejected (needs login-state interface, not worth it). Safety functions rely on neither — hardwired layer |
| Config DB initial values (e.g. ramp_zone := 2000) | 1 | defaults on the parameter |
| Status readback member definitions | derived | from envelope model |
| RETAIN on CMD `sp_` pins | 1 | flag on setpoint model (hand-added during commissioning) |

### E. Maintenance layer (`MAINT_*.scl`, `Maintenance_CMD.db`) → G3
| Item | Tier | Notes |
|---|---|---|
| Maintenance/seq-test mode capability flags | 1 | G0-5 |
| Overridable-output list | 1 (which outputs) | tag names come from the IO list |
| Encoder-preset capability per encoder | 1 | G0-5 |
| Preset IO channels (ctrl %QB / value %QD / status %IB) | 2 | per-encoder engineering rows |
| Preset state-guard rule (not while owning EM in Execute) + pulse timing | derived | writer policy |
| Override FC OB1-last mandate | derived | G5-3 guard |
| IO simulation capability per CM (force/simulate field values when hardware absent) | 1 (capability) | commissioning/FAT aid alongside seq-test mode; emission derived |

### F. OB1 orchestration (`Main.ob`) → G5
UC-first → MAINT preset → EM+MAP pairs → override-last: **all derived** — writer ordering rules,
no new contract data beyond G2/G3 existence.

### G. Hand-edits inside generated EM FBs → G9-3
New pins added by hand (`ilk_Straighten`, `sp_STRAIGHTEN_SPEED`, `fb_Rot_Pos_deg10`,
`cfg_Pre_Travel_Horn`, `permit_travel`). Not a G0 modeling gap — it is the regeneration
round-trip problem. Absorbed by G9-3; boundary doc adds no schema for it.

### I. Device-FB assignment & behavior appendix → G6 + DOCX exporter
| Item | Tier | Notes |
|---|---|---|
| FB assignment per CM/EM (library template id + version, pin-binding overrides where role/tag wiring is ambiguous) | 2 | `engineering.fb_assignments`; makes G6 instantiation deterministic — pins come from the template's reviewed `interface_contract`, no guessing; feeds G6-2 (explicit "use library" selection) + G6-4 (binding layer); closes the C5 manual-link-naming gap |
| Standard device-type behavior descriptions (states, interlock response, fault handling, flow diagram) as an FDS appendix — one per *assigned FB type*, deduped | 1 | customer signs behavior, never template IDs. **Must be derived from the FB library template** (description, `states`, flow via `fb-flow-diagram.ts`), never hand-written per project — otherwise it drifts from the real FB |

### J. Modes & cell-level state model → G2 + G7/G8
| Item | Tier | Notes |
|---|---|---|
| Mode set per unit/cell (Production/Maintenance/Manual/seq-test…) + legal mode-transition states | 1 | `modes` (`OperatorModeSchema`) exists but is consumed by nothing; the hand-authored `maintenance_mode`/`seq_test_mode` flags (category E) are an ad-hoc realization — unify them into this model |
| Mode × state interaction: which commands/branches/permissives are active per mode | 1 | mode becomes a first-class gate dimension on G0-3 routing rows (G0-3 already names "mode gating") |
| Unit/cell aggregate state machine: PackML-proper unit state machine commanding EMs, or a declared aggregation policy (worst-of/priority rollup) | 1 | the FDS must say which; today the pipeline is EM-centric bottom-up with no overall state anywhere |
| PackTags-style interface DB per unit (current state/mode, command words) for HMI/MES | derived | layout follows ISA-TR88/Siemens template conventions; UC writer (G2) emits it; Siemens PackML HMI templates/faceplates bind to unit-level state+mode tags — the binding target G7 overview + G8-7 faceplates need |

### K. Third-party intelligent appliances (Interroll cards, KUKA robots, RFID/barcode scanners…) → G1 (generalized) + G6
*Category A (drives) is retroactively the first instance of this class: intelligent fieldbus device
+ driver FB + telegram. K names the general model.*

| Item | Tier | Notes |
|---|---|---|
| Appliance inventory: vendor/model/function + ISA-88 placement (CM-like: scanner trigger→result; own EM: robot whose PackML states wrap the job handshake; hybrid: conveyor card — FDS must say who owns zone logic, PLC or card) | 1 | customer signs that the appliance exists and what it does |
| Functional comms interface: protocol family + handshake semantics (job request/ack/busy/done; trigger→result+valid; zone release/occupied) | 1 | PLC↔appliance analogue of the EM↔EM handshake patterns (category C) |
| Data payload signals: typed payloads (String/record), validity flags, use in permissives/criteria ("scanned code matches expected") | 1 | **new signal kind** — IO list is Bool/analog only today; criteria model must allow data comparisons, not just tag booleans |
| Driver FB per appliance (mxAutomation, Interroll lib, vendor blocks, company wrappers) | 2 | rides G0-8 `fb_assignments` unchanged; appliance driver templates belong in the FB library (G6) |
| Telegram/byte layouts, GSDML file refs, HW identifiers, IP/device names | 2 | extends table A addressing rows + H network plan |
| Vendor-side configuration (robot program, card web config, scanner codepage) | 3 | commissioning-pack reference; the robot program is a separate deliverable — the FDS signs only the interface to it |

### L. Upstream comms — SCADA / MES / historian → G2 (PackTags) + new writer surface
| Item | Tier | Notes |
|---|---|---|
| Which plant systems exist + what data crosses (production counts, unit states/modes, alarm forwarding, order/job data) | 1 | signable interface list; J's PackTags DB and the S7-1500 OPC UA server are the natural emission targets |
| Endpoints, node IDs, tag-exposure lists, protocol bindings | 2 | engineering data |
| Certificates, server hardening, network segregation | 3 | commissioning pack reference |

### M. Safety layer inventory (record, never generate) → DOCX + feeds C's aggregation
| Item | Tier | Notes |
|---|---|---|
| Safety function list: function, zone, initiators, actuation path (STO/contactor), PL/SIL rating, reset policy (manual/auto, reset point) | 1 | customers sign this; `safety_gates` covers only the *control-side reaction* — this records the functions themselves |
| Effect-on-control mapping: safety function → affected EMs/units (abort/stop class) | 1 | what C's safety-healthy aggregation term derives from |
| Safety logic generation (F-logic, safety relay internals) | **out of scope — never generated** | hardwired / F-PLC engineering; the app records and documents only |

### N. Product / recipe parameters → G4 (extended) + HMI recipe screen
| Item | Tier | Notes |
|---|---|---|
| Whether the machine is recipe/format-driven + named parameter sets (recipe = subset of config parameters with per-product values) | 1 | D's config model is one global set today; format-changeover machines need this |
| Recipe selection + changeover policy (legal only in declared states/modes) | 1 | ties to J's mode/state gating |
| Recipe DB structure + HMI recipe screen | derived | WinCC Unified has native recipe controls to bind |

### O. Diagnostics & condition monitoring → new P2 writer surface
| Item | Tier | Notes |
|---|---|---|
| Which metrics are kept: runtime hours, cycle/start counters, service intervals ("service due" warning) | 1 | per CM/EM capability flags |
| Platform diagnostics: module/rack/device-failure OBs → alarm rows | derived | pure platform pattern (OB82/86 family), emitted from platform rules |
| Counter/hour DB + HMI diagnostics view | derived | |

### H. Pure commissioning engineering → record-only (new G0-7)
Recorded as structured commissioning-pack sections in `engineering`; **no automation committed**:
drive parameter checklist (p2000 etc.), network/IP + device-name plan, PLC tag table w/ absolute
addresses, panel user accounts, time-sync/NTP plan. Future automation (e.g. bridge tag-table
creation, HW-ID lookup) would be new board items once value is proven.

*Sweep kills (checked, deliberately not modeled):* energy monitoring = an appliance instance (K);
HMI screen inventory = derived from the other models (G7's thesis); cause & effect matrix =
derived DOCX presentation of routing + alarms.

## Board / roadmap decomposition (the restructure this decision drives)

- **G0 gains G0-7** "Engineering Data commissioning-pack sections (record-only)" (P1/S).
- **G0 gains G0-8** "Device-FB assignment model (CM/EM → library template + pin bindings) + derived
  device-behavior DOCX appendix" (P1/M) — consumed by G6-2/G6-4 and the DOCX exporter.
- **G0 gains G0-9** "Modes & cell-state model: unit mode set + mode-transition rules, mode×state
  gating on routing rows, unit/cell aggregate state machine or rollup policy, PackTags exposure"
  (P0/M) — consumed by G2 (UC writer emits mode manager + unit state + PackTags DB), G7 (overview
  binds cell state/mode), G8-7 (PackML faceplates). G0-5's mode flags fold into this model.
  - G2 sub-sub tasks gain: unit mode manager emission; aggregate-state/PackTags DB emission.
  - G7-4 gains: unit-level state/mode tag bindings (not just per-EM `EM_*_DB.state`).
- **G0 gains G0-10** "Authorization model: role ladder (default 0 View / 1 Operator / 2 Supervisor /
  3 Maintenance / 4 Engineer) + `required_level` per config parameter/setpoint/maintenance
  capability + validity limits & write-state preconditions" (P1/M) — HMI enforces *who* (G7-5
  derives screen-role assignment from item levels; G8-3 automates role creation), PLC enforces
  *what/when* (G2/G4 writers emit limit + state-guard checks).
- **G0 gains G0-11** "Appliance model: inventory + ISA-88 placement, functional comms interface
  (handshake semantics), data payload signal kind + data-comparison criteria, engineering-side
  telegram/GSDML/addressing" (P1/L).
  - G1 retitles in spirit from "drive integration" to "intelligent device integration": sub-sub
    tasks gain appliance driver-FB emission + data-signal mapping (drives remain the first slice).
  - G6 gains: appliance driver FB templates as library citizens (interface contracts over vendor blocks).
- **G0 gains G0-12** "Upstream comms interface model (plant systems + data crossing; engineering
  endpoints/exposure lists)" (P1/M) — emission target: PackTags DB (G0-9/G2) + OPC UA exposure.
- **G0 gains G0-13** "Safety layer inventory (functions, zones, PL/SIL, reset policy, effect-on-control
  mapping) — record + DOCX, never generated" (P1/M) — feeds C's aggregation term and the safety FDS section.
- **G0 gains G0-14** "Recipe/format model: named parameter sets over config parameters + selection/
  changeover policy" (P1/M) — G4 writer emits recipe DBs; G7 gains a recipe screen (Unified native control).
- **G0 gains G0-15** "Diagnostics & condition-monitoring model (metrics capability flags; platform
  diagnostics derived)" (P2/M).
- **G0-1** is split FDS-side vs engineering-side per table A.
- **Sub-sub tasks** (generic phrasing, no HRE tag names) land under existing subitems:
  - G1-2 → telegram FB call w/ ConfigAxis default; HW-IDs from engineering data; fault-ack routing; enable policy
  - G1-3 → setpoint %→rpm scaling; feedback rpm→% scaling
  - G1-4 broadens to "IO signal conditioning": polarity inversion; debounce/filter emission; analog engineering-unit scaling (G0-2 correspondingly broadens to the per-IO conditioning model)
  - G2-3 → walk-to-Execute policy; STOP-on-unhealthy; seq-test release
  - G2-4 → two-detent suppression; routing-intent rows incl. EM-DB-member sources (cross-EM status); EM↔EM handshake emission (both sides' pins + UC routing, incl. cross-unit UC↔UC)
  - G2-5 → encoder scaling (linear + rotary w/ offset & normalization); straight-window; end-margin/ramp-zone gates w/ fast→jog fallback; status readback writes
  - G3-2 → overridable-output list from capability model; OB1-last guard link to G5-3
  - G3-3 → preset channel model; state-guard + pulse policy
  - G4-1 → parameter→DB emission w/ initial values; RETAIN flags incl. CMD `sp_` pins
- `ROADMAP-RUNNABLE-CODE-HMI.md` + `.tasks.json` updated to match; G0-6 marked DECIDED with a
  pointer to this doc.

## Consequences for G0-1…G0-5 (next plans)

Each schema task now has a decided home and shape: G0-1 drive model (split tiers), G0-2 per-IO signal model
(polarity enum + optional conditioning: debounce/filter times + analog scaling block
{raw range ↔ EU range, unit}) on `IoListEntry`,
G0-3 routing-intent rows + unit policy + EM↔EM handshake links, G0-4 envelope/config parameters
(reusing `configuration_parameters`), G0-5 maintenance capability model + engineering preset
channels, G0-8 FB-assignment model + derived behavior appendix, G0-9 modes & cell-state model
(unifying G0-5's flags and giving G2/G7/G8-7 their unit-level state+mode source), G0-10
authorization model (role ladder + per-item required levels + PLC-side validity/state guards),
G0-11 appliance model (inventory, handshake interfaces, data-payload signal kind), G0-12 upstream
comms, G0-13 safety inventory (record-only), G0-14 recipe model, G0-15 diagnostics model.
All land as one additive optional wave on `SpecContractV2` (`engineering` key + tier-1
field additions), Zod `nullableOptional` tolerance per the established pattern, no migration.
