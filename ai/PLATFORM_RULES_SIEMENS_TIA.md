# Siemens TIA Platform Rules (S7-1200/1500, TIA Portal V17–V20)

Version: 3.0 — Siemens Programming Style Guide V2.1 conventions

## Scope

All generated SCL must compile without errors when imported as external source files (.scl) via TIA Portal Openness. Follow Siemens Programming Style Guide V2.1 conventions throughout.

---

## 1. NAMING CONVENTIONS (Siemens Style Guide)

**Blocks** — UpperCamelCase, start with a verb describing the function:
```
ControlMotor, MonitorConveyor, ScaleAnalog, CalcChecksum, GetMachineState
```

**Formal parameters** (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, return) — lowerCamelCase, NO prefix:
```scl
VAR_INPUT
  start : Bool;          // NOT i_Start
  stop : Bool;           // NOT i_Stop
  feedbackRun : Bool;    // NOT i_FeedbackRun
  config : "typeMotorConfig";
END_VAR
VAR_OUTPUT
  runCmd : Bool;         // NOT o_RunCmd
  faulted : Bool;        // NOT o_Faulted
  state : Int;
  status : Word;         // Standard status output (see Section 10)
  error : Bool;          // Standard error flag
END_VAR
VAR_IN_OUT
  diagnostics : "typeDiagnostics";  // Complex types use InOut (pass by reference)
END_VAR
```

**Internal variables** — lowerCamelCase with prefix indicating scope:

| Prefix | Scope | Example | Notes |
|--------|-------|---------|-------|
| `stat` | Static (persistent in instance DB) | `statState`, `statAlarmLatch` | State machines, latches, flags |
| `temp` | Temporary (reset every scan) | `tempRunPermit`, `tempIndex` | Intermediate values |
| `inst` | Multi-instance (FB/timer/counter/trigger in VAR) | `instStartDelay`, `instRisingEdge` | Sub-FBs, IEC timers, edge triggers |
| `ext` | Static exposed to HMI/external | `extCurrentSpeed`, `extAlarmActive` | Readable/writable from outside |

**PLC data types (UDTs)** — lowerCamelCase with `type` prefix on the type declaration:
```scl
TYPE "typeMotorConfig"    // type prefix on declaration
  ...
END_TYPE

TYPE "typeDiagnostics"
  ...
END_TYPE
```

**Instance DBs** — UpperCamelCase with `Inst` prefix:
```
InstMotor1, InstMotor2, InstConveyorFeed, InstZoneControl
```

**Global DBs** — UpperCamelCase, NO prefix:
```
Configuration, HmiData, RecipeStore, AlarmHistory
```

**Constants** — UPPER_SNAKE_CASE:
```scl
VAR CONSTANT
  MAX_SPEED : Real := 100.0;
  BUFFER_SIZE : DInt := 50;
  FEEDBACK_TIMEOUT : Time := T#5s;
END_VAR
```

**Booleans** — use `is`, `has`, `can` for state-indicating booleans:
```
isConnected, hasError, canStart, isRunning, hasFeedback
```

**Arrays** — use plural form:
```
motors, conveyors, alarmStates, sensorValues
```

---

## 2. FUNCTION BLOCKS AND INSTANCE DATA BLOCKS (CRITICAL)

**Every FB needs an instance DB.** When generating code, you MUST produce a separate instance DB artifact for each FB that is called from an OB or from outside a multi-instance context. Failure to do this is the #1 source of compile errors.

**FB declaration:**
```scl
FUNCTION_BLOCK "ControlMotor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_INPUT
    start : Bool;
    stop : Bool;
    feedbackRun : Bool;
    config : "typeMotorConfig";
  END_VAR
  VAR_OUTPUT
    runCmd : Bool;
    faulted : Bool;
    state : Int;
    busy : Bool;
    error : Bool;
    status : Word := 16#7000;       // Initial: no command executing
  END_VAR
  VAR
    statState : Int;
    statAlarmLatch : Bool;
    instStartDelay : TON;           // IEC timer — multi-instance (inst prefix)
    instFeedbackTimer : TON;
    instStartEdge : R_TRIG;         // Edge trigger — multi-instance
  END_VAR
  VAR_TEMP
    tempRunPermit : Bool;
  END_VAR
BEGIN
  REGION IO Mapping
    #instStartEdge(CLK := #start);
    #tempRunPermit := #start AND NOT #stop AND NOT #statAlarmLatch;
  END_REGION

  REGION State Machine
    CASE #statState OF
      0:  // IDLE
        #runCmd := FALSE;
        #busy := FALSE;
        IF #instStartEdge.Q THEN
          #statState := 1;
          #status := 16#7001;   // First call after new command
        END_IF;

      1:  // STARTING
        #busy := TRUE;
        #instStartDelay(IN := TRUE, PT := #config.startDelay);
        IF #instStartDelay.Q THEN
          #runCmd := TRUE;
          #statState := 2;
          #status := 16#7002;   // Follow-up during execution
        END_IF;

      2:  // RUNNING
        #runCmd := #tempRunPermit;
        #busy := TRUE;
        IF NOT #feedbackRun THEN
          #instFeedbackTimer(IN := TRUE, PT := #config.feedbackTimeout);
          IF #instFeedbackTimer.Q THEN
            #statAlarmLatch := TRUE;
            #statState := 99;
            #status := 16#8400;   // External error during execution
          END_IF;
        ELSE
          #instFeedbackTimer(IN := FALSE, PT := T#0s);
        END_IF;
        IF #stop THEN
          #statState := 0;
          #status := 16#0000;   // Command finished
        END_IF;

      99: // FAULT
        #runCmd := FALSE;
        #busy := FALSE;

    ELSE
      // Undefined state — report error
      #statState := 99;
      #status := 16#8600;        // Internal error
    END_CASE;
  END_REGION

  REGION Alarm Handling
    IF #statAlarmLatch THEN
      #faulted := TRUE;
      #error := TRUE;
    END_IF;
  END_REGION

  REGION Output Mapping
    #state := #statState;
  END_REGION
END_FUNCTION_BLOCK
```

**Instance DB for the FB above** (MUST be generated as a separate artifact):
```scl
DATA_BLOCK "InstMotor1"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlMotor"
BEGIN
END_DATA_BLOCK
```

The instance DB references the FB by name. TIA creates the DB structure automatically from the FB interface. Do NOT redeclare the FB's variables inside the DB — just reference the FB name.

**For each physical device, generate a separate instance DB:**
- Motor 1 → `"InstMotor1"` of type `"ControlMotor"`
- Motor 2 → `"InstMotor2"` of type `"ControlMotor"`
- Conveyor → `"InstConveyor1"` of type `"ControlConveyor"`

**Calling an FB from the Process FC** (call the instance DB name ONLY, NOT "FBName"."InstDBName"):
```scl
// Inside the Process FC — call Device FBs via their instance DBs
"InstMotor1"(
  start := "startButtonM1",
  stop := "stopButtonM1",
  feedbackRun := "motor1Running",
  config := "Configuration".motor1Config,
  runCmd => "motor1Cmd",
  faulted => "HmiData".motor1Fault,
  state => "HmiData".motor1State,
  status => "HmiData".motor1Status
);
```

**Multi-instance** — when one FB contains another FB in its VAR section, the inner FB's data is stored in the outer FB's instance DB. NO separate instance DB is needed:
```scl
FUNCTION_BLOCK "ControlConveyorZone"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR
    instMotor1 : "ControlMotor";    // Multi-instance — inst prefix
    instMotor2 : "ControlMotor";
    instZoneTimer : TON;
    instRisingEdge : R_TRIG;
  END_VAR
BEGIN
  // Call multi-instances with # prefix, NO separate DB reference
  #instMotor1(start := #zoneStart, stop := #zoneStop, feedbackRun := #m1Running);
  #instMotor2(start := #zoneStart, stop := #zoneStop, feedbackRun := #m2Running);
END_FUNCTION_BLOCK
```

**When to use each pattern:**
- **Separate instance DB**: When calling an FB from an OB, or when HMI/other blocks need access to the FB's data
- **Multi-instance**: When an FB is used internally by another FB (timers, counters, edge triggers, sub-FBs). Preferred — reduces number of DBs
- **NEVER access another FB's instance DB directly** from outside — pass data through interfaces

---

## 3. BLOCK DECLARATION TEMPLATES

### UDT (PLC data type) — `type` prefix, imported before FBs

```scl
TYPE "typeMotorConfig"
VERSION : 0.1
  STRUCT
    startDelay : Time := T#2s;
    feedbackTimeout : Time := T#5s;
    maxSpeed : Real := 100.0;
    enableInterlock : Bool := TRUE;
  END_STRUCT;
END_TYPE
```

### Diagnostics UDT (standard pattern for error reporting)

```scl
TYPE "typeDiagnostics"
VERSION : 0.1
  STRUCT
    status : Word := 16#7000;
    subfunctionStatus : DWord := 16#00000000;
    stateNumber : DInt := 0;
  END_STRUCT;
END_TYPE
```

### Global Data Block — for configuration, HMI, recipe data

```scl
DATA_BLOCK "Configuration"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
  VAR
    motor1Config : "typeMotorConfig";
    motor2Config : "typeMotorConfig";
    systemEnabled : Bool := FALSE;
    lineSpeed : Real := 0.0;
  END_VAR
BEGIN
END_DATA_BLOCK
```

### Function (FC) — stateless, NO instance DB, NO timers/counters/edges

```scl
FUNCTION "ScaleAnalog" : Void
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_INPUT
    rawValue : Int;
    rawMin : Int;
    rawMax : Int;
    scaleMin : Real;
    scaleMax : Real;
  END_VAR
  VAR_OUTPUT
    scaledValue : Real;
    error : Bool;
  END_VAR
  VAR_TEMP
    tempNormalized : Real;
  END_VAR
BEGIN
  IF #rawMax = #rawMin THEN
    #scaledValue := 0.0;
    #error := TRUE;
    RETURN;
  END_IF;

  #tempNormalized := INT_TO_REAL(#rawValue - #rawMin) / INT_TO_REAL(#rawMax - #rawMin);
  #scaledValue := (#tempNormalized * (#scaleMax - #scaleMin)) + #scaleMin;
  #error := FALSE;
END_FUNCTION
```

### FC with return value

```scl
FUNCTION "ClampReal" : Real
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_INPUT
    value : Real;
    minLimit : Real;
    maxLimit : Real;
  END_VAR
BEGIN
  IF #value < #minLimit THEN
    "ClampReal" := #minLimit;
  ELSIF #value > #maxLimit THEN
    "ClampReal" := #maxLimit;
  ELSE
    "ClampReal" := #value;
  END_IF;
END_FUNCTION
```

### Process FC (Orchestrates Device FBs)

```scl
FUNCTION "ProcessLine1" : Void
TITLE = 'Line 1 Process Orchestration'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
BEGIN
  // Call Device FBs via their instance DBs
  "InstMotor1"(start := "startM1", stop := "stopM1", feedbackRun := "m1Running");
  "InstMotor2"(start := "startM2", stop := "stopM2", feedbackRun := "m2Running");
  "InstConveyor1"(enable := "Configuration".systemEnabled);

  // Call utility FCs — no instance DB needed
  "ScaleAnalog"(rawValue := "aiTemp1", rawMin := 0, rawMax := 27648,
                scaleMin := 0.0, scaleMax := 100.0,
                scaledValue => "HmiData".temperature1);
END_FUNCTION
```

### Organization Block (OB1 — Main)

```scl
ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep (Cycle)'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_TEMP
    tempFirstScan : Bool;
  END_VAR
BEGIN
  // Main calls the Process FC only — minimal OB1
  "ProcessLine1"();
END_ORGANIZATION_BLOCK
```

---

## 4. DATA TYPES AND TYPE CONVERSIONS

### Elementary types — use the correct type for the purpose

| Type | Size | Use for |
|------|------|---------|
| Bool | 1 bit | Digital signals, flags, states |
| Int | 16-bit signed | State numbers, small quantities (-32768..32767) |
| DInt | 32-bit signed | Loop counters, array indices, large quantities, encoder values |
| Real | 32-bit float | Analog values, temperatures, speeds, setpoints |
| LReal | 64-bit float | High-precision calculations |
| Time | 32-bit | Timer presets, delays (T#5s, T#100ms, T#1m30s) |
| Word | 16-bit | Status codes, bitfields, diagnostic words |
| DWord | 32-bit | Extended bitfields, raw data |
| String[n] | variable | Messages — ALWAYS specify length, e.g. String[80] |
| Byte | 8-bit | Raw byte data |

**Use DInt for all loop counters and array indices** — best performance, no conversion needed.

**Arrays start at 0** with upper bound as a symbolic constant:
```scl
VAR CONSTANT
  MAX_CONVEYORS : DInt := 10;
END_VAR
VAR
  statConveyors : Array[0..MAX_CONVEYORS] of "typeConveyorData";
END_VAR
```

### Type conversions — ALWAYS explicit, never implicit (IEC check is ON)

```scl
// CORRECT — explicit conversion
#tempReal := INT_TO_REAL(#rawValue);
#tempInt := REAL_TO_INT(#someReal);
#tempDInt := INT_TO_DINT(#someInt);
#tempInt := DINT_TO_INT(#someDInt);
#tempReal := DINT_TO_REAL(#someDInt);
#tempWord := INT_TO_WORD(#someInt);

// WRONG — implicit conversion causes compile errors with IEC check
#tempReal := #rawValue;             // ERROR: Int cannot assign to Real
#tempInt := #someReal;              // ERROR: Real cannot assign to Int
```

### Real/LReal comparison — NEVER use = for equality

```scl
// WRONG — IEEE754 rounding makes this unreliable:
IF #actualSpeed = #targetSpeed THEN ...

// CORRECT — tolerance-based comparison:
IF ABS(#actualSpeed - #targetSpeed) < 0.01 THEN ...
// Or use system function:
IF IN_RANGE(MIN := #targetSpeed - 0.01, VAL := #actualSpeed, MAX := #targetSpeed + 0.01) THEN ...
```

### STRING — always specify length with symbolic constant

```scl
VAR CONSTANT
  MAX_MSG_LEN : DInt := 80;
END_VAR
VAR
  statMessage : String[#MAX_MSG_LEN] := '';
END_VAR
```

### PLC data types (UDTs) — ALWAYS use instead of anonymous STRUCT

```scl
// CORRECT — reusable, centrally maintainable
VAR_INPUT
  config : "typeMotorConfig";
END_VAR

// WRONG — anonymous STRUCT
VAR_INPUT
  config : Struct
    startDelay : Time;
    maxSpeed : Real;
  END_STRUCT;
END_VAR
```

### Use VAR_IN_OUT for complex types (STRUCT, ARRAY, STRING) to pass by reference

```scl
// CORRECT — passed by reference, no copy:
VAR_IN_OUT
  processData : "typeProcessData";
  buffer : Array[0..99] of Real;
END_VAR

// AVOID for FB inputs with complex types — causes full copy every scan:
VAR_INPUT
  processData : "typeProcessData";  // Entire struct copied on every call
END_VAR
```

---

## 5. STATELESS FUNCTIONS (FC) VS STATEFUL FUNCTION BLOCKS (FB)

**Use FC when:**
- **Process orchestration** — the Process FC calls all Device FBs, wires data between them, and coordinates process logic. This is the primary use of FCs.
- Pure calculation with no memory between scans (scaling, clamping, conversion, checksums)
- Utility logic reused in many places
- No timers, counters, or edge triggers needed

**Use FB when:**
- State must persist between scans (state machines, sequences)
- Timers, counters, or edge triggers are needed
- Device control (motors, valves, conveyors) — always FB
- Multiple instances of same logic with different data

**FC local variables are stateless (no VAR static section, only VAR_TEMP).** However, an FC CAN read and write persistent data via Global DBs, Instance DBs, and global tags. A Process FC commonly reads/writes DB values to coordinate Device FBs — this is not "stateless" in the application sense, only the FC's own local variables are stateless.

**FC cannot declare internally:**
- Timers (TON, TOF, TP) — these require static storage
- Counters (CTU, CTD, CTUD)
- Edge triggers (R_TRIG, F_TRIG)
- VAR (static) section — FCs only have VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR_TEMP

---

## 6. IEC TIMERS, COUNTERS, AND EDGE TRIGGERS

**All MUST be declared in VAR (static) as multi-instances inside an FB. NEVER in VAR_TEMP. Use `inst` prefix.**

### TON (On-Delay Timer) — IN and PT are ALWAYS required

```scl
VAR
  instOnDelay : TON;
END_VAR
#instOnDelay(IN := #runCondition, PT := T#5s);
IF #instOnDelay.Q THEN
  // 5 seconds elapsed with runCondition = TRUE
END_IF;
// Reset — still need PT:
#instOnDelay(IN := FALSE, PT := T#0s);
```

### TOF (Off-Delay Timer)

```scl
VAR
  instOffDelay : TOF;
END_VAR
#instOffDelay(IN := #runCondition, PT := T#3s);
// Q stays TRUE for 3s after runCondition goes FALSE
```

### TP (Pulse Timer)

```scl
VAR
  instPulse : TP;
END_VAR
#instPulse(IN := #triggerCondition, PT := T#500ms);
// Q goes TRUE for exactly 500ms on rising edge of IN
```

### R_TRIG / F_TRIG (Edge Detection)

```scl
VAR
  instRising : R_TRIG;
  instFalling : F_TRIG;
END_VAR
#instRising(CLK := #startButton);
IF #instRising.Q THEN
  // Rising edge detected — execute once
END_IF;
```

### CTU (Count Up)

```scl
VAR
  instCounter : CTU;
END_VAR
#instCounter(CU := #countPulse, R := #resetCounter, PV := 10);
IF #instCounter.Q THEN
  // Counted to PV (10)
END_IF;
#currentCount := #instCounter.CV;
```

---

## 7. SCL SYNTAX RULES (CRITICAL — violations cause compile errors)

### CASE labels MUST be integer literals (0, 1, 2, 99...), NEVER variables or constants. CASE MUST always have ELSE branch.

This is the #1 most common compile error. TIA Portal SCL does NOT allow variables, constants, or symbolic names as CASE labels — only raw integer numbers.

```scl
// CORRECT — integer literal labels:
CASE #statState OF
  0:  // IDLE
  1:  // STARTING
  2:  // RUNNING
  99: // FAULT
ELSE
  #statState := 99;
  #status := 16#8600;
END_CASE;

// WRONG — named constants as CASE labels (does NOT compile):
CASE #statState OF
  STATE_IDLE:          // ERROR: not an integer literal
  STATE_RUNNING:       // ERROR: not an integer literal
  #STATE_START_DELAY:  // ERROR: not an integer literal
END_CASE;

// WRONG — VAR CONSTANT as CASE labels (does NOT compile):
CASE #statState OF
  #STATE_IDLE:    // ERROR: even constants declared in VAR CONSTANT cannot be used
  #STATE_RUNNING: // ERROR: TIA Portal requires raw integer numbers here
END_CASE;

// WRONG — missing ELSE:
CASE #statState OF
  0: ...
  1: ...
END_CASE;  // No ELSE — undefined states silently ignored
```

Use comments after each integer label to document the state name: `0:  // IDLE`

### # prefix — required for ALL local variables inside FB/FC body

```scl
#statState := 1;
#runCmd := #start AND NOT #stop;
#instTimer(IN := #enable, PT := #config.delay);
```

### Global DB access — quoted name with dot notation

```scl
"Configuration".systemEnabled := TRUE;
#tempValue := "HmiData".motor1Speed;
```

### Parameter passing syntax

- Input: `paramName := value`
- Output: `paramName => variable`
- InOut: `paramName := variable`

### No magic numbers — use symbolic constants

```scl
// WRONG:
IF #velocity < 100.0 THEN ...

// CORRECT:
IF #velocity < #MAX_SPEED THEN ...
```

---

## 8. CODE FORMATTING

**Indentation:** 2 spaces per level. NO tabs.

**Spaces around all operators:**
```scl
#tempResult := #enable AND NOT #hasError;       // CORRECT
#tempResult:=#enable AND NOT #hasError;          // WRONG — no spaces
```

**Use REGION blocks for code organization:**
```scl
REGION IO Mapping
  #tempRunPermit := #start AND NOT #stop AND NOT #statFaulted;
END_REGION

REGION State Machine
  CASE #statState OF
    0: // IDLE
    1: // RUNNING
    99: // FAULT
  ELSE
    #statState := 99;
  END_CASE;
END_REGION

REGION Alarm Handling
  // Latching alarms — set on fault, require explicit operator reset
  IF #statAlarmCondition AND NOT #statAlarmLatch THEN
    #statAlarmLatch := TRUE;
  END_IF;
  IF #resetAlarms AND NOT #statAlarmCondition THEN
    #statAlarmLatch := FALSE;
  END_IF;
END_REGION

REGION Output Mapping
  // Write outputs ONCE, collectively at end of block
  #runCmd := #statState = 2;
  #faulted := #statAlarmLatch;
  #state := #statState;
  #error := #statAlarmLatch;
END_REGION
```

**Line comments only (//) — no block comments.** Comments explain WHY, not WHAT:
```scl
// Debounce start signal to prevent accidental double-press
#instStartDebounce(IN := #start, PT := T#200ms);
```

**Multi-line conditions — operators at start of line, THEN on new line:**
```scl
IF #enable
  AND #isConnected
  AND (#turnLeft XOR #turnRight)
THEN
  // Statement
END_IF;
```

**Direct boolean assignment instead of IF/ELSE:**
```scl
// WRONG — unnecessary:
IF #start AND NOT #stop THEN
  #enabled := TRUE;
ELSE
  #enabled := FALSE;
END_IF;

// CORRECT — direct assignment:
#enabled := #start AND NOT #stop;
```

**Output parameters written ONCE per scan, collectively at end of block.** Do NOT read your own output parameters — use a temp or static variable instead.

---

## 9. PLCopen ASYNCHRONOUS BLOCK PATTERNS

### Enable pattern — for blocks that remain active while enabled (level-triggered)

```scl
VAR_INPUT
  enable : Bool;          // TRUE = active, FALSE = stop and reset
END_VAR
VAR_OUTPUT
  valid : Bool;           // Outputs are valid while enable = TRUE
  busy : Bool;            // Block is executing
  error : Bool;           // Error occurred
  status : Word := 16#7000;
END_VAR
```

### Execute pattern — for one-shot commands (edge-triggered)

```scl
VAR_INPUT
  execute : Bool;         // Rising edge starts command
END_VAR
VAR_OUTPUT
  done : Bool;            // Command completed successfully
  busy : Bool;            // Command in progress
  error : Bool;           // Error occurred
  status : Word := 16#7000;
END_VAR
```

---

## 10. STATUS AND ERROR REPORTING

**Every FB should report status via a Word output.** Use standardized ranges:

| Status | Value | Meaning |
|--------|-------|---------|
| Done, no warning | 16#0000 | Command finished successfully |
| Done with details | 16#0001..16#0FFF | Finished with additional info |
| No command (initial) | 16#7000 | Idle, no command executing |
| First call | 16#7001 | Rising edge on execute/enable detected |
| Executing | 16#7002 | Follow-up call during execution |
| Executing with details | 16#7003..16#7FFF | Executing with progress info |
| Wrong parameterization | 16#8200..16#83FF | Invalid input parameters |
| External error | 16#8400..16#85FF | External cause (sensor, feedback) |
| Internal error | 16#8600..16#87FF | Internal logic error |

Define status values as local constants:
```scl
VAR CONSTANT
  STATUS_DONE : Word := 16#0000;
  STATUS_IDLE : Word := 16#7000;
  STATUS_FIRST_CALL : Word := 16#7001;
  STATUS_BUSY : Word := 16#7002;
  ERR_INVALID_PARAM : Word := 16#8200;
  ERR_FEEDBACK_TIMEOUT : Word := 16#8400;
  ERR_UNDEFINED_STATE : Word := 16#8600;
END_VAR
```

The `error` output is the MSB (bit 15) of the status word — TRUE when status >= 16#8000.

---

## 11. ARTIFACT GENERATION RULES

**Always generate ALL required artifacts in this order:**
1. **UDTs** (`type` prefix) — imported first, no dependencies
2. **Device FBs** (verb-first name) — one per device type (motors, valves, conveyors, sensors). Depend on UDTs.
3. **Instance DBs** (`Inst` prefix) — one per Device FB instance, references the FB
4. **Process FC** (verb-first name) — **ALWAYS generate.** Orchestrates all Device FB calls, wires data between them, coordinates process logic. Called by Main.
5. **OB1 ("Main")** — **ALWAYS generate.** Calls the Process FC only. Main should be minimal.
6. **Global DBs** (no prefix) — for configuration, HMI interface if needed
7. **Utility FCs** — for stateless helpers (scaling, clamping) if needed

**Program hierarchy:**
- Main (OB1) → Process FC → Device FBs (via instance DBs)
- Device FBs do NOT call each other — the Process FC wires data between them
- Main does NOT call Device FBs directly

**Instance DB checklist:** For every Device FB you generate, generate a corresponding instance DB. The Process FC calls each Device FB via its instance DB.

**Every block MUST have:**
- `{ S7_Optimized_Access := 'TRUE' }` pragma
- `VERSION : 0.1`

**File naming:** `typeMotorConfig.scl`, `ControlMotor.scl`, `ScaleAnalog.scl`, `Configuration.scl`, `InstMotor1.scl`, `Main.scl`

---

## 12. COMMON MISTAKES — DO NOT MAKE THESE

**Missing instance DB** (most common error):
```
WRONG: Generate ControlMotor FB but no instance DB → Process FC cannot call it
CORRECT: Generate ControlMotor AND InstMotor1 (instance DB referencing ControlMotor)
```

**Missing Process FC** (second most common error):
```
WRONG: Main calls Device FBs directly → flat architecture, no process coordination
CORRECT: Main calls Process FC, Process FC calls Device FBs via instance DBs
```

**Calling FB incorrectly from OB:**
```scl
// WRONG — FB name without instance DB:
"ControlMotor"(start := signal);

// WRONG — "FBName"."InstDBName" syntax does NOT compile:
"ControlMotor"."InstMotor1"(start := signal);

// CORRECT — call using instance DB name ONLY:
"InstMotor1"(start := signal);
```

**Timer/counter/edge in VAR_TEMP (loses state every scan):**
```scl
// WRONG:
VAR_TEMP
  tempTimer : TON;  // Resets every scan — never times out
END_VAR

// CORRECT:
VAR
  instTimer : TON;  // Persistent in instance DB
END_VAR
```

**Missing type conversion:**
```scl
// WRONG:
#tempReal := #intValue;                    // ERROR: type mismatch
// CORRECT:
#tempReal := INT_TO_REAL(#intValue);
```

**CASE without ELSE:**
```scl
// WRONG:
CASE #statState OF
  0: ...
  1: ...
END_CASE;

// CORRECT:
CASE #statState OF
  0: ...
  1: ...
ELSE
  #statState := 0;
  #status := ERR_UNDEFINED_STATE;
END_CASE;
```

**FOR loop counter manipulation (no effect):**
```scl
// WRONG — counter change is ignored:
FOR #tempIndex := 0 TO 10 DO
  #tempIndex := #tempIndex + 1;  // Has NO effect
END_FOR;
// CORRECT — use WHILE if you need to adjust iteration:
#tempIndex := 0;
WHILE #tempIndex <= 10 DO
  #tempIndex := #tempIndex + 2;
END_WHILE;
```

**Comparing Real with = (unreliable due to IEEE754):**
```scl
// WRONG:
IF #speed = 50.0 THEN ...
// CORRECT:
IF ABS(#speed - 50.0) < 0.01 THEN ...
```

**Writing FALSE/0 to unused library FB outputs (breaks compile):**
When calling a library FB (Open Library, etc.), parameters that are not used by the process must be **self-assigned** — written back to their own instance DB value. Writing `FALSE` or `0` to an unused output forces a value that may conflict with the FB's internal logic or type.
```scl
// WRONG — forces FALSE on an output the process doesn't use:
"InstFAN01".bOutCommandReverse := FALSE;
"InstFAN01".rOutSpeedReference := 0.0;

// CORRECT — self-assign preserves the FB's internal state:
"InstFAN01".bOutCommandReverse := "InstFAN01".bOutCommandReverse;
"InstFAN01".rOutSpeedReference := "InstFAN01".rOutSpeedReference;

// CORRECT — if the parameter IS used by the process, assign normally:
"InstFAN01".bOutCommandRun := "DB_ProcessCommands".fan01Run;
```
This applies to ALL library FB parameters (inputs AND outputs) that are not wired in the linkage matrix. Only assign real process values to parameters that appear in the wiring map.
