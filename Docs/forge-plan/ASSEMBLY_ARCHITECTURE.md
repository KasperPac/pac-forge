# Equipment Module FB Architecture Plan

## Machine Hierarchy

```
System (the full machine / production line)
  └── Unit (functional station)
        └── Equipment Module (coordinated group of devices)
              └── Device (single physical thing with IO)
```

**Example: Pallet Transfer Line**
```
System: Pallet Transfer Line
├── Unit: Infeed Station
│   ├── Equipment Module: CV01 Infeed Conveyor
│   │   ├── Device: M01 (Motor DOL)
│   │   ├── Device: PE01 (Photoelectric Sensor)
│   │   └── Device: PE02 (Photoelectric Sensor)
│   └── Equipment Module: LFT01 Lift Table
│       ├── Device: M02 (Motor DOL - hydraulic pump)
│       ├── Device: SOL_UP (Solenoid 2-pos)
│       ├── Device: SOL_DOWN (Solenoid 2-pos)
│       ├── Device: LS_TOP (Limit Switch)
│       ├── Device: LS_BOT (Limit Switch)
│       ├── Device: LS_OT_TOP (Overtravel Switch)
│       └── Device: LS_OT_BOT (Overtravel Switch)
├── Unit: Processing Station
│   └── Equipment Module: PRESS01 Stamping Press
│       ├── Device: SOL_PRESS (Solenoid)
│       ├── Device: LS_HOME (Limit Switch)
│       └── Device: LS_EXTEND (Limit Switch)
└── Unit: Safety
    ├── Device: ESTOP1 (E-Stop)
    └── Device: ESTOP2 (E-Stop)
```

## Core Principles

1. **The functional spec defines the hierarchy** — the AI extracts it, never invents it
2. **Only devices have IO signals** — they get device FBs, instance DBs, and IO wiring
3. **Equipment Modules get their own FBs** — coordination logic, fault handling, HMI UDT
4. **Process sequences command equipment modules** — not individual devices
5. **Units are organisational** — each typically has its own process sequence(s)
6. **System is the top-level** — array in schema but assumed single for now

## Equipment Module FB Design

Each equipment module FB:
- **Inputs:** command signals (`cmdRaise`, `cmdLower`, `cmdStop`, `reset`, `enable`, `config`)
- **Outputs:** status signals (`atUpper`, `atLower`, `busy`, `done`, `error`, `faultCode`, `stateNumber`)
- **Internal:** calls device FBs or reads ProcessState fields from device call FCs
- **Fault detection:** travel timeout, overtravel, motor fault, position loss — all internal
- **HMI UDT:** `VAR_IN_OUT` for HMI faceplate (e.g. `udtHMI_LiftTable`)
- **State machine:** IDLE → MOVING_UP → AT_UPPER → MOVING_DOWN → AT_LOWER → FAULT

### Equipment Module FB Interface Example (Lift Table)

```
FUNCTION_BLOCK "ControlLiftTable"
  VAR_INPUT
    enable : Bool;
    cmdRaise : Bool;
    cmdLower : Bool;
    cmdStop : Bool;
    reset : Bool;
    config : "typeLiftTableConfig";
  END_VAR
  VAR_OUTPUT
    atUpper : Bool;
    atLower : Bool;
    busy : Bool;
    done : Bool;
    error : Bool;
    faultCode : Word;
    stateNumber : Int;
    motorRunning : Bool;
    solUpActive : Bool;
    solDownActive : Bool;
  END_VAR
  VAR_IN_OUT
    hmi : "udtHMI_LiftTable";
  END_VAR
  VAR
    // Device status inputs (read from ProcessState, written by device call FCs)
    statMotorRunning : Bool;
    statMotorFault : Bool;
    statSolUpActive : Bool;
    statSolDownActive : Bool;
    statLsTop : Bool;
    statLsBot : Bool;
    statLsOtTop : Bool;
    statLsOtBot : Bool;
    // Internal state
    statState : Int;
    statFaultCode : Word;
    instTravelTimer : TON_TIME;
    instMotorStartTimer : TON_TIME;
  END_VAR
```

### Process Sequence Using Equipment Module

```
Step 0:  PB_UP pressed → set ProcessCommands.lft01CmdRaise = TRUE
Step 10: Wait ProcessState.lft01Busy = TRUE (equipment module acknowledged)
Step 20: Wait ProcessState.lft01AtUpper = TRUE (equipment module done)
         Timeout: stepTimer.Q → FAULT
Step 30: ProcessCommands.lft01CmdRaise = FALSE
         Return to IDLE
```

vs. the old approach (7+ steps commanding individual devices).

## Changes Required

### Phase 1: Schema & Spec Analysis

**Files:**
- `src/types/forge.ts` — Add `SpecAnalysisEquipmentModule`, update `SpecAnalysis` with hierarchy
- `src/types/forge-matrix.ts` — Add equipment module linkage to matrix types
- `src/lib/forge-prompts.ts` — Update spec analysis prompt/schema for hierarchy extraction
- `src/hooks/use-forge-spec-analysis.ts` — Handle new schema fields

**SpecAnalysis schema changes:**
```typescript
interface SpecAnalysisEquipmentModule {
  id: string;
  name: string;
  tag: string;
  equipment_module_type: string;  // "LiftTable", "Conveyor", "StampingPress"
  description: string;
  unit: string;
  device_ids: string[];   // references to SpecAnalysisDevice.id
}

interface SpecAnalysis {
  // ... existing fields ...
  systems: Array<{ name: string; description: string }>;  // new (array, usually 1)
  units: Array<{ name: string; description: string }>;  // existing (renamed from subsystems)
  equipment_modules: SpecAnalysisEquipmentModule[];  // NEW
  devices: SpecAnalysisDevice[];  // existing — now leaf-level only
}
```

### Phase 2: Wizard Steps Update

**Hardware & IO (Step 4):**
- Show equipment modules as grouping headers, devices as children
- FB matching only applies to devices
- Equipment Module FB is always AI-generated (no library matching)

**Device FBs (Step 5):**
- Generate device FBs as today (for leaf devices only)

**NEW: Equipment Module FBs (Step 5.5 or merged into Step 5):**
- New wizard step or sub-step
- For each equipment module: generate Equipment Module FB + config UDT + HMI UDT + instance DB
- Prompt includes: equipment module description, list of constituent devices + their FB interfaces
- Output: equipment module FB with state machine, fault logic, device coordination

**Matrix Review (Step 6):**
- Process sequences reference equipment modules, not devices
- Device linkage: equipment module FB wiring to ProcessCommands/ProcessState
- Wiring map shows: equipment module → device chain

**Device Code (Step 7):**
- Device call FCs as today
- NEW: Equipment Module call FCs — call equipment module FBs with wiring from matrix

**Process Code (Step 9):**
- Sequences command equipment modules: `lft01CmdRaise`, `lft01AtUpper`, etc.
- Much simpler than today's device-level orchestration

### Phase 3: Equipment Module FB Generator

**New files:**
- `src/lib/forge-equipment-module-prompts.ts` — Equipment Module FB generation prompt builder
- `src/hooks/use-forge-equipment-module-generate.ts` — Equipment Module FB generation hook
- `src/types/forge-equipment-module.ts` — Equipment Module-specific types (if needed)

**Prompt inputs:**
- Equipment module description and tag
- List of constituent devices with their FB interfaces
- Device IO signals
- Interlocks and alarms relevant to this equipment module
- Design profile rules
- Platform rules

**Prompt outputs:**
- Equipment Module FB (SCL)
- Equipment Module config UDT (typeLiftTableConfig etc.)
- Equipment Module HMI UDT (udtHMI_LiftTable etc.)
- Equipment Module instance DB

### Phase 4: HMI Integration

- HMI faceplates per equipment module (not per device)
- Equipment Module HMI UDT on instance DB
- Screen generation references equipment modules

## What Stays the Same

- Device FBs — still generated from library templates or AI
- IO linking — still maps physical IO to/from DBs
- Pattern learning — still works on device and equipment module FBs
- FB library — still stores device-level templates (motor, sensor, valve, etc.)
- Safety checks — still run on generated code

## What Changes

| Aspect | Before | After |
|--------|--------|-------|
| Device list | Flat, includes equipment modules | Hierarchical, devices only |
| LFT01 | Device with fbPulser FB | Equipment Module with AI-generated FB |
| Process sequences | Command individual devices | Command equipment modules |
| Fault handling | In process sequences | In equipment module FBs |
| HMI | Per device | Per equipment module |
| Sequence step count | 7+ per motion | 3-4 per motion |

## Migration / Compatibility

- Existing specs will be scrapped and recreated
- No backward compatibility needed
- FB library stays device-level (motor, sensor, valve, pushbutton, etc.)
- Equipment Module FBs are always project-specific (AI generated, not library)

## Open Questions

1. Should equipment module FBs call device FBs directly (multi-instance) or read from ProcessState?
   - Direct call: cleaner, single scan, but means device FBs called from equipment module FC not device call FC
   - ProcessState: looser coupling, but scan-order dependent
   - **Recommendation:** ProcessState for now (simpler), migrate to direct call later

2. Equipment Module FB library — should we build a library of common equipment module patterns?
   - e.g. "Hydraulic Lift Table", "Belt Conveyor", "Pneumatic Cylinder"
   - Could be templates with customisable device lists
   - **Recommendation:** Start with AI generation, build library from approved outputs over time

3. Nested equipment modules — can an equipment module contain other equipment modules?
   - e.g. "Packaging Station" contains "Conveyor" + "Wrapper" + "Labeller"
   - **Recommendation:** Keep flat for now (equipment module contains only devices), add nesting later if needed
