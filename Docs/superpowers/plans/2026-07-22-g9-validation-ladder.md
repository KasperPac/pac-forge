# G9 Validation Ladder — FDS → running PLC, complexity ramp

> **Task:** G9-1 → G9-4 (Monday phase 3056329989)
> **Date:** 2026-07-22 · **Status:** PLAN (execution needs Kasper + TIA Portal)
> **Principle:** every level is authored **through the app** (Fable co-author +
> Controls Data panels) — we are testing the product, not just the compiler.
> Nothing is seeded by hand; every gap found becomes a board row (G9-4 protocol).

## Pre-flight (once)

1. TIA Portal open, scratch project, PLC_1 (S7-1500) offline. Bridge running —
   accept the Openness whitelist re-prompt (new v1.3.0 exe).
2. App `npm run dev`; bridge `GET /tia/status` shows connected after first call.
3. Warm-up: Random FDS → Code Builder → **Send to TIA** → expect a compile
   shakeout round; fix via compile-fix loop. This burns off SCL syntax quirks
   before any real authoring. (Also: HMI panel → Build in TIA; try creating a
   text list + a role manually in Unified while there → answers G8-3/G8-4.)

## The ladder

Each level: author FDS via co-author → Controls Data → confirm → Code Builder
review → Send to TIA → compile clean → download → exercise on PLC-SIM or the
bench rig → record gaps. **Do not advance a level until the current one runs.**

### Level 1 — "It compiles and runs" (G9-1 core)

Simple machine, digital IO only, one unit, no drives/axes/maintenance.

**Brief to paste into the co-author:**
> A parts-washing station with a single unit. One equipment module "Wash
> Chamber" with: a door solenoid (SOL1, DO command + closed feedback DI), a
> wash pump (P1, DO run command + running feedback DI + overload fault DI,
> N/C wired), and a level switch (LS1, DI). Behavior: from idle, START closes
> the door, starts the pump for a timed wash, stops the pump, opens the door,
> returns to idle. Pump overload aborts the cycle. E-stop circuit (ES1,
> healthy-when-TRUE DI) as the machine safety gate.

**Exercises:** co-author Stage A/B on Fable · synthesized EM + steps (structured
assigns → real bodies) · N/C inversion · UC with safety-healthy + PackML SM ·
OB1 · HMI (overview/alarms lists) · Send to TIA · compile-fix loop.
**Accept when:** compiles clean; cycle runs on PLC-SIM via UN St_Cmd writes
(watch table); E-stop drop forces abort + STOP-all; alarm appears on the panel
(or watch table).

### Level 2 — Coordination + maintenance depth

Add a second unit, operator modes, maintenance layer, conditioning.

**Additions via Controls Data:** second unit (e.g. "Unload Conveyor", DOL
motor); modes Production/Maintenance/Seq-Test (kinds!); maintenance override
on the pump DO; blanket DI debounce 20 ms + a functional 5 s off-delay on the
level switch; routing row + two-detent is N/A (no pendant) — instead a routing
row feeding a physical RUN pushbutton to the conveyor's ilk pin.
**Exercises:** mode manager + mode-kind gating · Maintenance_CMD/override FC
(OB1-last) · IO_Cond layer (first) · conditioned routing reads · multi-unit OB1.
**Accept when:** maintenance mode STOPs drives + enables the override; seq-test
releases command pins; conditioned input demonstrably delayed.

### Level 3 — PROFINET drive + envelope (the analog frontier)

Add a G120-driven axis with geometry — the least-field-exercised codegen area.

**Additions:** conveyor CM becomes a G120 (telegram 1, %-of-p2000, signed);
tier-2: RefSpeed + HW ids + IW/QW start bytes from the real HW config; a linear
axis from a position transmitter with the four gates; setpoints screen; encoder
preset if the rig has one.
**Exercises:** SINA_SPEED emission + rpm scaling + fault-ack via reset ·
telegram-word addressing · CFG/STAT DBs · envelope gates live in routing ·
HMI setpoints with limits.
**Accept when:** drive follows the speed setpoint; envelope gate blocks motion
past the soft limit; drive fault alarm raises and Reset acks it.

### Level 4 — Library FBs + external vendors (G9-4 proper)

A genuinely different machine type using the FB library and non-Siemens gear.

**Additions:** import/assign a library FB (fb_assignments: forced template +
pin bindings; verify the coverage gate and the wiring); one vendor device
(ABB/SEW — expect the library path, since no deterministic FB exists by
design); an appliance if available (scanner/robot handshake — G0-11 model).
**Exercises:** G6 instantiate path end-to-end · assignment precedence + hard
block on coverage mismatch · vendor-family TODO honesty · appliance modeling.
**Accept when:** the machine runs with hand-authoring delta ≈ 0, and every
hand-touch is recorded (below).

## The G9-4 gap protocol (non-negotiable)

Every hand edit, manual TIA step, or "the app couldn't express this" moment
gets recorded **at the moment it happens**: a board row (generic phrasing, per
the board scope rule) + which level surfaced it. The Code Builder's edit
tracking captures SCL deltas automatically (that corpus also feeds G9-3, the
regen-vs-hand-edit strategy, which stays open and should be designed after
Level 2's data exists).

## Roles

- **Kasper:** everything TIA-side (whitelist, HW config, download, rig), the
  co-author interviews, judgment calls on gaps.
- **Claude (any session):** compile-fix diagnosis, gap → board rows, codegen
  fixes between levels, G9-3 design once edit data exists.
