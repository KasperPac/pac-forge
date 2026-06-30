# Handover — Herrenknecht Segment Wagon FDS Session

**Date:** 2026-06-03  
**Status:** Mid-session — skeleton wizard completed but hierarchy is wrong, needs redo

---

## What We Were Doing

Walking through the FDS builder end-to-end with a real client spec (Herrenknecht Segment Wagon) to validate the builder is ready for production use.

---

## Project Details

| Field | Value |
|-------|-------|
| Project | sre-2601 (SRE Electrical) |
| Project UUID | `01d1f5b5-8d00-4d69-a04e-dea8ff77976b` |
| Spec title | Herrenknecht Segment Wagon SRL S-1427/28 |
| Spec doc code | SRE-2601-500801 |
| Spec UUID | Unknown — navigate to `/specs?projectId=01d1f5b5-8d00-4d69-a04e-dea8ff77976b` to find it |
| Dev server | `http://localhost:5174` |
| Login | kasper.simonsen@pac-technologies.com.au / 123456 |

---

## What Was Completed

- [x] Project created (sre-2601)
- [x] Spec created (SRE-2601-500801)
- [x] Phase 1: Instrument register CSV uploaded and AI-parsed
- [x] Phase 2: Skeleton wizard completed and confirmed (PLC: S7-1200, HMI: WinCC Unified, Comms: PROFINET)
- [ ] **Phase 3: Co-author NOT started yet** — user opened it but we stopped

---

## Known Problem: Machine Hierarchy is Wrong

**Root cause:** The IO register CSV we generated had no `subsystem` column. The parser put all 43 tags into "UNGROUPED" and `buildHierarchyFromTags` created nonsensical groupings (e.g. "Carriage Brake K1 Open" as an assembly, which is just an IO signal).

**Fix required:**
1. Delete the current spec and start fresh (or update `confirmed_subsystems` directly in Supabase)
2. Regenerate the CSV with proper `subsystem` assignments (see below)
3. Re-upload register → re-run skeleton wizard → confirm

---

## Correct Machine Hierarchy

```
System: SRL Segment Wagon
│
├── Subsystem: Carriage
│   └── Assembly: Carriage Drive
│       ├── Device: VSD1 (Carriage Drive)    → VSD1_ENABLE, VSD1_FWD, VSD1_REV, VSD1_CB_TRIP, CARR_BRAKE_RES_FAULT
│       ├── Device: Motor M1                 → CARR_M1_FAULT, CARR_M1_THERM
│       ├── Device: Motor M2                 → CARR_M2_FAULT, CARR_M2_THERM
│       ├── Device: Motor M3                 → CARR_M3_FAULT, CARR_M3_THERM
│       ├── Device: Motor M4                 → CARR_M4_FAULT, CARR_M4_THERM
│       ├── Device: Brake K1                 → CARR_BRAKE_OPEN, CARR_BRAKE_FAULT, CARR_BRAKE_REL
│       └── Device: Encoder ENC1             → (Profinet — no hardwired IO signals)
│
├── Subsystem: Rotator
│   └── Assembly: Rotator Drive
│       ├── Device: VSD2 (Rotator Drive)     → VSD2_ENABLE, VSD2_LEFT, VSD2_RIGHT, VSD2_CB_TRIP, ROT_BRAKE_RES_FAULT
│       ├── Device: Motor M5                 → ROT_M5_THERM
│       ├── Device: Brake K2                 → ROT_BRAKE_OPEN, ROT_BRAKE_FAULT, ROT_BRAKE_REL
│       └── Device: Encoder ENC2             → (Profinet — no hardwired IO signals)
│
├── Subsystem: Safety & Control
│   └── Assembly: Safety System
│       ├── Device: Safety Relay SR1         → SR1_HEALTHY, RESET_SR1
│       ├── Device: E-Stop ES1               → ESTOP_HEALTHY
│       ├── Device: Maintenance Switch MS1   → MS1_HEALTHY
│       └── Device: ECB Distribution Board  → ECB_TRIP, RESET_ECB
│
└── Subsystem: Operator Interface
    └── Assembly: Controls
        ├── Device: Carriage Controls        → CARR_FWD, CARR_FWD_FAST, CARR_REV, CARR_REV_FAST, RESET_PB
        ├── Device: Rotator Controls         → ROT_LEFT, ROT_LEFT_FAST, ROT_RIGHT, ROT_RIGHT_FAST
        ├── Device: Travel Horn              → TRAVEL_HORN
        └── Device: Travel Strobe           → TRAVEL_STROBE
```

---

## Correct IO Register CSV (with subsystem column)

The file `scripts/hk-segment-wagon-io.csv` needs a `subsystem` column added. Here's the corrected version:

```
tag,io_address,signal_type,description,subsystem
ECB_TRIP,%I0.0,DI,ECB distribution board trip,Safety & Control
SR1_HEALTHY,%I0.1,DI,Safety relay SR1 healthy feedback,Safety & Control
MS1_HEALTHY,%I0.2,DI,Maintenance switch MS1 healthy,Safety & Control
CARR_BRAKE_RES_FAULT,%I0.3,DI,Carriage braking resistor fault,Carriage
VSD1_CB_TRIP,%I0.4,DI,Carriage VSD1 circuit breaker trip,Carriage
CARR_M1_FAULT,%I0.5,DI,Carriage motor M1 overload fault,Carriage
CARR_M2_FAULT,%I0.6,DI,Carriage motor M2 overload fault,Carriage
CARR_M3_FAULT,%I0.7,DI,Carriage motor M3 overload fault,Carriage
CARR_M4_FAULT,%I1.0,DI,Carriage motor M4 overload fault,Carriage
CARR_M1_THERM,%I1.1,DI,Carriage motor M1 thermistor fault,Carriage
CARR_M2_THERM,%I1.2,DI,Carriage motor M2 thermistor fault,Carriage
CARR_M3_THERM,%I1.3,DI,Carriage motor M3 thermistor fault,Carriage
CARR_M4_THERM,%I1.4,DI,Carriage motor M4 thermistor fault,Carriage
CARR_BRAKE_OPEN,%I1.5,DI,Carriage brake K1 open feedback,Carriage
CARR_BRAKE_FAULT,%I2.0,DI,Carriage brake K1 fault,Carriage
ROT_LEFT,%I2.1,DI,Rotate left command (pendant/wireless),Operator Interface
ROT_LEFT_FAST,%I2.2,DI,Rotate left fast command,Operator Interface
RESET_PB,%I2.3,DI,Reset pushbutton,Operator Interface
ESTOP_HEALTHY,%I2.4,DI,E-Stop ES1 circuit healthy,Safety & Control
ROT_BRAKE_RES_FAULT,%I2.5,DI,Rotator braking resistor fault,Rotator
VSD2_CB_TRIP,%I2.6,DI,Rotator VSD2 circuit breaker trip,Rotator
ROT_M5_THERM,%I2.7,DI,Rotator motor M5 thermistor fault,Rotator
ROT_BRAKE_OPEN,%I3.0,DI,Rotator brake K2 open feedback,Rotator
ROT_BRAKE_FAULT,%I3.1,DI,Rotator brake K2 fault,Rotator
CARR_FWD,%I3.2,DI,Carriage forward command (pendant/wireless),Operator Interface
CARR_FWD_FAST,%I3.3,DI,Carriage forward fast command,Operator Interface
CARR_REV,%I3.4,DI,Carriage reverse command (pendant/wireless),Operator Interface
CARR_REV_FAST,%I3.5,DI,Carriage reverse fast command,Operator Interface
ROT_RIGHT,%I3.6,DI,Rotate right command (pendant/wireless),Operator Interface
ROT_RIGHT_FAST,%I3.7,DI,Rotate right fast command,Operator Interface
CARR_LIMIT_SW,%I4.0,DI,Carriage longitudinal limit switch,Carriage
RESET_ECB,%Q0.0,DO,Reset ECB distribution board,Safety & Control
RESET_SR1,%Q0.1,DO,Reset safety relay SR1,Safety & Control
TRAVEL_HORN,%Q0.2,DO,Travel warning horn,Operator Interface
TRAVEL_STROBE,%Q0.3,DO,Travel warning strobe light,Operator Interface
VSD1_ENABLE,%Q0.4,DO,Carriage VSD1 enable (K1 contactor),Carriage
VSD2_ENABLE,%Q0.5,DO,Rotator VSD2 enable (K2 contactor),Rotator
CARR_BRAKE_REL,%Q0.6,DO,Carriage brake K1 release,Carriage
ROT_BRAKE_REL,%Q0.7,DO,Rotator brake K2 release,Rotator
VSD1_FWD,%Q1.0,DO,Carriage VSD1 forward direction,Carriage
VSD1_REV,%Q1.1,DO,Carriage VSD1 reverse direction,Carriage
VSD2_LEFT,%Q1.2,DO,Rotator VSD2 left direction,Rotator
VSD2_RIGHT,%Q1.3,DO,Rotator VSD2 right direction,Rotator
```

---

## Recommended Next Steps

1. **Fix the CSV** — update `scripts/hk-segment-wagon-io.csv` with the subsystem column (content above)
2. **Delete the current spec** or go to Supabase and reset `confirmed_subsystems = []` and `confirmation_status = 'unconfirmed'`
3. **Re-upload the register** (Phase 1) with the corrected CSV
4. **Re-run the skeleton wizard** — this time the hierarchy will be properly grouped; also use the **"Infer Hierarchy"** AI button on Step 2 to let Claude further refine the groupings
5. **Confirm** the wizard → this unlocks Phase 3
6. **Open Co-Author** and run the interview

---

## Known Bugs to Fix (separate from HK work)

- **V1 badge on new specs**: `isUnconfirmed` check in `spec-builder.tsx` line ~371 fires on fresh specs too. Fix: add `&& spec.confirmed_subsystems.length > 0` to the condition.

---

## Machine Overview (for co-author context)

**Client:** Herrenknecht AG (TBM manufacturer)  
**Integrator:** SRE Electrical  
**Machine:** SRL Segment Wagon — tunnel construction support vehicle  
**Function:** Transports and positions concrete tunnel lining segments  
**Motion axes:** Carriage (forward/reverse along tunnel rail, 4×AC motors via VSD1, 11kW) + Rotator (left/right spin, 1×AC motor via VSD2, 0.75kW)  
**Control:** S7-1200 CPU 1214C, Profinet, SINAMICS CU250S-2 drives, absolute encoders  
**Operation:** Deadman switch — operator holds button to move, auto-stops at software/hardware limits  
**Axes:** One at a time (carriage OR rotator, not simultaneously)  
**Max speed:** 32 m/min (carriage), rotator speed configurable  
**Safety:** Pilz PSR safety relay, dual-channel E-Stop, fail-safe spring brakes  
**HMI:** Siemens MTP700 7" touchscreen + wired pendant + optional wireless remote  
**Source docs:** `Docs/Functional Specs/Herrenknecht/`

---

## Playwright Scripts (for automation)

All scripts in `scripts/`:
- `playwright-fds-demo.mjs` — login + project picker + create spec
- `playwright-fds-phase2.mjs` — upload IO register via file chooser intercept  
- `playwright-fds-wizard.mjs` — walk all 6 skeleton wizard steps with AI infer

To run any: `node scripts/<name>.mjs`  
Auto-logins with the credentials above. Screenshots saved to `scripts/playwright-shots/`.
