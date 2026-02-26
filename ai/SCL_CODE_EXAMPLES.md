# SCL Code Examples (S7-1200/S7-1500, TIA Portal V17-V20)

Working, compilable SCL examples demonstrating correct patterns for code generation. Every example here compiles without errors when imported as an external source file (.scl) via TIA Portal Openness.

---

## 1. Complete FB with State Machine

Shows REGION blocks, IEC timers as multi-instances, edge detection, CASE with integer literals, and PLCopen status reporting.

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
    status : Word := 16#7000;
  END_VAR
  VAR
    statState : Int;
    statAlarmLatch : Bool;
    instStartDelay : TON;
    instFeedbackTimer : TON;
    instStartEdge : R_TRIG;
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
        #instStartDelay(IN := FALSE, PT := T#0s);
        IF #instStartEdge.Q THEN
          #statState := 1;
          #status := 16#7001;
        END_IF;

      1:  // STARTING
        #busy := TRUE;
        #instStartDelay(IN := TRUE, PT := #config.startDelay);
        IF #instStartDelay.Q THEN
          #runCmd := TRUE;
          #statState := 2;
          #status := 16#7002;
        END_IF;

      2:  // RUNNING
        #runCmd := #tempRunPermit;
        #busy := TRUE;
        IF NOT #feedbackRun THEN
          #instFeedbackTimer(IN := TRUE, PT := #config.feedbackTimeout);
          IF #instFeedbackTimer.Q THEN
            #statAlarmLatch := TRUE;
            #statState := 99;
            #status := 16#8400;
          END_IF;
        ELSE
          #instFeedbackTimer(IN := FALSE, PT := T#0s);
        END_IF;
        IF #stop THEN
          #statState := 0;
          #status := 16#0000;
        END_IF;

      99: // FAULT
        #runCmd := FALSE;
        #busy := FALSE;

    ELSE
      #statState := 99;
      #status := 16#8600;
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

Key points:
- CASE labels are **integer literals only** (0, 1, 2, 99) — never variables or constants
- CASE always has an **ELSE** branch for undefined states
- Timers and edge triggers declared in **VAR** (static), never VAR_TEMP
- All use **inst** prefix (instStartDelay, instFeedbackTimer, instStartEdge)
- Timer calls always include both **IN** and **PT** parameters
- Reset a timer by calling it with `IN := FALSE, PT := T#0s`

---

## 2. UDT (PLC Data Type)

UDTs are imported before FBs. Use `type` prefix.

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

---

## 3. Instance DB for an FB

Every FB called from an OB needs its own instance DB. The DB references the FB by name — do NOT redeclare variables inside it.

```scl
DATA_BLOCK "InstMotor1"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlMotor"
BEGIN
END_DATA_BLOCK
```

For multiple instances of the same FB, create separate instance DBs:

```scl
DATA_BLOCK "InstMotor2"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlMotor"
BEGIN
END_DATA_BLOCK
```

---

## 4. Calling FBs from OB1 (Main)

Call the **instance DB name only**. Never use `"FBName"."InstDBName"(...)` — that syntax does not compile.

```scl
ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep (Cycle)'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_TEMP
    tempFirstScan : Bool;
  END_VAR
BEGIN
  // Call FBs via their instance DB name — this is the ONLY correct syntax
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

  "InstMotor2"(
    start := "startButtonM2",
    stop := "stopButtonM2",
    feedbackRun := "motor2Running",
    config := "Configuration".motor2Config,
    runCmd => "motor2Cmd",
    faulted => "HmiData".motor2Fault,
    state => "HmiData".motor2State,
    status => "HmiData".motor2Status
  );

  // Call FCs — no instance DB needed
  "ScaleAnalog"(
    rawValue := "aiTemperature1",
    rawMin := 0,
    rawMax := 27648,
    scaleMin := 0.0,
    scaleMax := 100.0,
    scaledValue => "HmiData".temperature1,
    error => "HmiData".tempScaleError
  );
END_ORGANIZATION_BLOCK
```

Parameter syntax:
- **Input**: `paramName := value`
- **Output**: `paramName => variable`
- **InOut**: `paramName := variable`

---

## 5. Multi-Instance Calls (FB inside FB)

When an FB contains another FB in its VAR section, the inner FB's data is stored in the outer FB's instance DB. No separate instance DB is needed.

```scl
FUNCTION_BLOCK "ControlConveyorZone"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_INPUT
    zoneStart : Bool;
    zoneStop : Bool;
    m1Running : Bool;
    m2Running : Bool;
  END_VAR
  VAR_OUTPUT
    zoneActive : Bool;
    zoneFaulted : Bool;
  END_VAR
  VAR
    instMotor1 : "ControlMotor";
    instMotor2 : "ControlMotor";
    instZoneTimer : TON;
    instStartEdge : R_TRIG;
  END_VAR
BEGIN
  // Call multi-instances with # prefix — no separate DB reference
  #instMotor1(
    start := #zoneStart,
    stop := #zoneStop,
    feedbackRun := #m1Running
  );
  #instMotor2(
    start := #zoneStart,
    stop := #zoneStop,
    feedbackRun := #m2Running
  );

  #zoneActive := #instMotor1.busy OR #instMotor2.busy;
  #zoneFaulted := #instMotor1.faulted OR #instMotor2.faulted;
END_FUNCTION_BLOCK
```

---

## 6. FC (Stateless Function)

FCs have no persistent state — only VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, and VAR_TEMP. No timers, counters, or edge triggers allowed.

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

FC with return value — assign to the function name:

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

---

## 7. Global Data Block

For configuration, HMI data, and shared parameters. Fields use UDTs where possible.

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

Access from any block using quoted name with dot notation:

```scl
"Configuration".systemEnabled := TRUE;
#tempSpeed := "Configuration".lineSpeed;
```

---

## 8. IEC Timer Patterns

All timers must be in **VAR** (static) with **inst** prefix. Never in VAR_TEMP.

**TON (On-Delay)** — output Q goes TRUE after PT elapses with IN = TRUE:

```scl
VAR
  instOnDelay : TON;
END_VAR

// Start timing
#instOnDelay(IN := #runCondition, PT := T#5s);
IF #instOnDelay.Q THEN
  // 5 seconds elapsed with runCondition continuously TRUE
END_IF;

// Reset the timer (IN and PT are both required)
#instOnDelay(IN := FALSE, PT := T#0s);
```

**TOF (Off-Delay)** — output Q stays TRUE for PT after IN goes FALSE:

```scl
VAR
  instOffDelay : TOF;
END_VAR

#instOffDelay(IN := #sensorSignal, PT := T#3s);
// Q stays TRUE for 3s after sensorSignal goes FALSE
#outputCmd := #instOffDelay.Q;
```

**TP (Pulse)** — output Q goes TRUE for exactly PT on rising edge of IN:

```scl
VAR
  instPulse : TP;
END_VAR

#instPulse(IN := #triggerInput, PT := T#500ms);
// Q is TRUE for exactly 500ms after rising edge of triggerInput
#pulseOutput := #instPulse.Q;
```

---

## 9. IEC Counter Patterns

Counters must also be in **VAR** (static) with **inst** prefix.

**CTU (Count Up):**

```scl
VAR
  instPartCounter : CTU;
END_VAR

#instPartCounter(CU := #partDetected, R := #resetCounter, PV := 100);
IF #instPartCounter.Q THEN
  // Counted to PV (100 parts)
END_IF;
#currentCount := #instPartCounter.CV;  // Current count value
```

**CTD (Count Down):**

```scl
VAR
  instDownCounter : CTD;
END_VAR

#instDownCounter(CD := #consumePulse, LD := #loadCounter, PV := 50);
IF #instDownCounter.Q THEN
  // Counted down to 0
END_IF;
#remaining := #instDownCounter.CV;
```

---

## 10. Edge Detection

R_TRIG and F_TRIG must be in **VAR** (static) — they need persistent state to detect transitions.

```scl
VAR
  instRisingStart : R_TRIG;
  instFallingStop : F_TRIG;
END_VAR

#instRisingStart(CLK := #startButton);
IF #instRisingStart.Q THEN
  // Rising edge — execute once per press
  #statState := 1;
END_IF;

#instFallingStop(CLK := #runSignal);
IF #instFallingStop.Q THEN
  // Falling edge — signal just went FALSE
  #statAlarmLatch := TRUE;
END_IF;
```

---

## 11. Type Conversions

TIA Portal with IEC check ON requires **explicit** conversions. Implicit conversion causes compile errors.

```scl
// Int to Real (most common — needed for analog scaling)
#tempReal := INT_TO_REAL(#rawValue);

// Real to Int (truncates — use for display/rounding)
#tempInt := REAL_TO_INT(#someReal);

// Int to DInt (widening — safe, no data loss)
#tempDInt := INT_TO_DINT(#someInt);

// DInt to Int (narrowing — may lose data)
#tempInt := DINT_TO_INT(#someDInt);

// DInt to Real (for calculations with loop counters)
#tempReal := DINT_TO_REAL(#loopIndex);

// Int to Word (for status codes)
#tempWord := INT_TO_WORD(#someInt);

// Bool to Int (for conditional arithmetic)
#tempInt := BOOL_TO_INT(#someFlag);
```

---

## 12. CASE Statement Rules

CASE labels **must be integer literals** — variables, constants, and symbolic names are NOT allowed as labels.

```scl
// CORRECT — integer literal labels with ELSE
CASE #statState OF
  0:  // IDLE
    #runCmd := FALSE;
    #busy := FALSE;

  1:  // STARTING
    #busy := TRUE;

  2:  // RUNNING
    #runCmd := TRUE;
    #busy := TRUE;

  99: // FAULT
    #runCmd := FALSE;
    #error := TRUE;

ELSE
  // Undefined state — recover to fault
  #statState := 99;
  #status := 16#8600;
END_CASE;
```

Common mistakes that cause compile errors:

```scl
// WRONG — named constants as labels (does NOT compile)
CASE #statState OF
  STATE_IDLE:     // ERROR
  STATE_RUNNING:  // ERROR
END_CASE;

// WRONG — VAR CONSTANT as labels (does NOT compile)
CASE #statState OF
  #STATE_IDLE:    // ERROR — even VAR CONSTANT values cannot be used
  #STATE_RUNNING: // ERROR
END_CASE;

// WRONG — missing ELSE branch
CASE #statState OF
  0: ...
  1: ...
END_CASE;  // Undefined states silently ignored
```

Use comments after each integer label to document the state name: `0:  // IDLE`

---

## 13. Full Program Chain (UDT -> Global DB -> FB -> Instance DB -> OB1)

This shows the complete dependency chain for a minimal working program.

**Step 1 — UDT** (imported first, no dependencies):

```scl
TYPE "typePumpConfig"
VERSION : 0.1
  STRUCT
    startDelay : Time := T#1s;
    runTimeout : Time := T#10s;
    maxPressure : Real := 6.0;
  END_STRUCT;
END_TYPE
```

**Step 2 — FB** (depends on UDT):

```scl
FUNCTION_BLOCK "ControlPump"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_INPUT
    start : Bool;
    stop : Bool;
    feedbackRun : Bool;
    pressure : Real;
    config : "typePumpConfig";
  END_VAR
  VAR_OUTPUT
    pumpCmd : Bool;
    state : Int;
    error : Bool;
    status : Word := 16#7000;
  END_VAR
  VAR
    statState : Int;
    instStartDelay : TON;
    instStartEdge : R_TRIG;
  END_VAR
  VAR_TEMP
    tempPermit : Bool;
  END_VAR
BEGIN
  REGION IO Mapping
    #instStartEdge(CLK := #start);
    #tempPermit := #start AND NOT #stop AND (#pressure < #config.maxPressure);
  END_REGION

  REGION State Machine
    CASE #statState OF
      0:  // IDLE
        #pumpCmd := FALSE;
        #instStartDelay(IN := FALSE, PT := T#0s);
        IF #instStartEdge.Q AND #tempPermit THEN
          #statState := 1;
          #status := 16#7001;
        END_IF;

      1:  // STARTING
        #instStartDelay(IN := TRUE, PT := #config.startDelay);
        IF #instStartDelay.Q THEN
          #pumpCmd := TRUE;
          #statState := 2;
          #status := 16#7002;
        END_IF;

      2:  // RUNNING
        #pumpCmd := #tempPermit;
        IF #stop OR NOT #tempPermit THEN
          #statState := 0;
          #status := 16#0000;
        END_IF;

    ELSE
      #statState := 0;
      #status := 16#8600;
    END_CASE;
  END_REGION

  REGION Output Mapping
    #state := #statState;
    #error := #status >= 16#8000;
  END_REGION
END_FUNCTION_BLOCK
```

**Step 3 — Global DB** (depends on UDT):

```scl
DATA_BLOCK "Configuration"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
  VAR
    pump1Config : "typePumpConfig";
    pump2Config : "typePumpConfig";
    systemEnabled : Bool := FALSE;
  END_VAR
BEGIN
END_DATA_BLOCK
```

**Step 4 — Instance DBs** (depend on FB):

```scl
DATA_BLOCK "InstPump1"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlPump"
BEGIN
END_DATA_BLOCK
```

```scl
DATA_BLOCK "InstPump2"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlPump"
BEGIN
END_DATA_BLOCK
```

**Step 5 — OB1 Main** (depends on everything):

```scl
ORGANIZATION_BLOCK "Main"
TITLE = 'Main Program Sweep (Cycle)'
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
  VAR_TEMP
    tempFirstScan : Bool;
  END_VAR
BEGIN
  "InstPump1"(
    start := "startPump1",
    stop := "stopPump1",
    feedbackRun := "pump1Running",
    pressure := "HmiData".systemPressure,
    config := "Configuration".pump1Config,
    pumpCmd => "pump1Cmd",
    state => "HmiData".pump1State,
    error => "HmiData".pump1Error,
    status => "HmiData".pump1Status
  );

  "InstPump2"(
    start := "startPump2",
    stop := "stopPump2",
    feedbackRun := "pump2Running",
    pressure := "HmiData".systemPressure,
    config := "Configuration".pump2Config,
    pumpCmd => "pump2Cmd",
    state => "HmiData".pump2State,
    error => "HmiData".pump2Error,
    status => "HmiData".pump2Status
  );
END_ORGANIZATION_BLOCK
```

Import order: UDT -> FB -> Global DB -> Instance DBs -> OB1
