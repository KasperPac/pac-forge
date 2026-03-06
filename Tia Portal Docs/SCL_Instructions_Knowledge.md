# SCL Built-In Instructions Reference (S7-1200 / S7-1500)

Source: Siemens TIA Portal Information System — SCL (S7-1200, S7-1500), Manual 11/2024

This document covers ALL built-in SCL instructions, their parameters, data types, and correct call syntax. Use this as the authoritative reference when generating SCL code.

---

## CRITICAL: Parameter Wiring Rules

- **Input parameters** use `:=` assignment: `IN := "Tag"`
- **Output parameters** use `=>` assignment: `Q => "Tag"`
- **InOut parameters** use `:=` assignment: `DEST_VARIABLE := #myVar`
- **Function return values** are assigned with `:=` on the left: `"Result" := FUNC_NAME(...);`
- EVERY input and output parameter MUST be wired — do not omit outputs
- Timer/Counter/Edge instances MUST be declared in VAR (Static), NEVER in VAR_TEMP

---

## 1. Bit Logic — Edge Detection

### R_TRIG: Detect positive signal edge (rising edge)

Detects a 0→1 transition at CLK. Output Q is TRUE for exactly one cycle on detection.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| CLK | Input | BOOL | Signal to monitor for rising edge |
| Q | Output | BOOL | TRUE for one cycle on positive edge |

**Declaration** (multi-instance in VAR Static):
```scl
VAR
    instRisingEdge : R_TRIG;
END_VAR
```

**Call syntax:**
```scl
// Multi-instance (inside FB):
#instRisingEdge(CLK := "TagIn", Q => "TagOut");

// Single instance (separate DB):
"R_TRIG_DB"(CLK := "TagIn", Q => "TagOut");
```

### F_TRIG: Detect negative signal edge (falling edge)

Detects a 1→0 transition at CLK. Output Q is TRUE for exactly one cycle on detection.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| CLK | Input | BOOL | Signal to monitor for falling edge |
| Q | Output | BOOL | TRUE for one cycle on negative edge |

**Declaration** (multi-instance in VAR Static):
```scl
VAR
    instFallingEdge : F_TRIG;
END_VAR
```

**Call syntax:**
```scl
// Multi-instance (inside FB):
#instFallingEdge(CLK := "TagIn", Q => "TagOut");

// Single instance (separate DB):
"F_TRIG_DB"(CLK := "TagIn", Q => "TagOut");
```

---

## 2. Timer Operations (IEC Timers)

**CRITICAL**: IEC timers MUST be declared in VAR (Static section) as multi-instance, or in a separate instance DB. NEVER declare in VAR_TEMP.

### Timer Data Types for Declaration

| Timer | S7-1200 Multi-Instance | S7-1500 Multi-Instance | Shared DB Type |
|-------|----------------------|----------------------|----------------|
| TP | TP_TIME | TP_TIME, TP_LTIME | IEC_TIMER, IEC_LTIMER |
| TON | TON_TIME | TON_TIME, TON_LTIME | IEC_TIMER, IEC_LTIMER |
| TOF | TOF_TIME | TOF_TIME, TOF_LTIME | IEC_TIMER, IEC_LTIMER |
| TONR | TONR_TIME | TONR_TIME, TONR_LTIME | IEC_TIMER, IEC_LTIMER |

### TP: Generate pulse

Sets Q to TRUE for the duration PT, starting on a rising edge at IN. Once started, the pulse runs for the full PT duration regardless of IN changes.

| Parameter | Direction | Type (S7-1200) | Type (S7-1500) | Description |
|-----------|-----------|-----------------|-----------------|-------------|
| IN | Input | BOOL | BOOL | Start input (rising edge triggers) |
| PT | Input | TIME | TIME, LTIME | Pulse duration (must be positive) |
| Q | Output | BOOL | BOOL | Pulse output (TRUE during PT) |
| ET | Output | TIME | TIME, LTIME | Elapsed time (0 to PT) |

**Declaration & Call:**
```scl
VAR
    instPulse : TP_TIME;
END_VAR

// Multi-instance call:
#instPulse(IN := "Tag_Start", PT := T#5s, Q => "Tag_Status", ET => "Tag_Elapsed");

// Single instance (separate DB):
"TP_DB".TP(IN := "Tag_Start", PT := T#5s, Q => "Tag_Status", ET => "Tag_Elapsed");
```

### TON: Generate on-delay

Delays setting Q by duration PT after IN goes TRUE. Q stays TRUE while IN remains TRUE. Resets when IN goes FALSE.

| Parameter | Direction | Type (S7-1200) | Type (S7-1500) | Description |
|-----------|-----------|-----------------|-----------------|-------------|
| IN | Input | BOOL | BOOL | Start input |
| PT | Input | TIME | TIME, LTIME | On-delay duration (must be positive) |
| Q | Output | BOOL | BOOL | Delayed output (TRUE after PT expires while IN=TRUE) |
| ET | Output | TIME | TIME, LTIME | Elapsed time (0 to PT, resets when IN=FALSE) |

**Declaration & Call:**
```scl
VAR
    instOnDelay : TON_TIME;
END_VAR

// Multi-instance call:
#instOnDelay(IN := "Tag_Start", PT := T#3s, Q => "Tag_Status", ET => "Tag_Elapsed");

// Single instance (separate DB):
"TON_DB".TON(IN := "Tag_Start", PT := T#3s, Q => "Tag_Status", ET => "Tag_Elapsed");
```

### TOF: Generate off-delay

Delays resetting Q by duration PT after IN goes FALSE. Q is set immediately when IN goes TRUE.

| Parameter | Direction | Type (S7-1200) | Type (S7-1500) | Description |
|-----------|-----------|-----------------|-----------------|-------------|
| IN | Input | BOOL | BOOL | Start input |
| PT | Input | TIME | TIME, LTIME | Off-delay duration (must be positive) |
| Q | Output | BOOL | BOOL | Delayed-off output |
| ET | Output | TIME | TIME, LTIME | Elapsed time |

**Declaration & Call:**
```scl
VAR
    instOffDelay : TOF_TIME;
END_VAR

#instOffDelay(IN := "Tag_Start", PT := T#2s, Q => "Tag_Status", ET => "Tag_Elapsed");
```

### TONR: Time accumulator

Accumulates elapsed time while IN is TRUE. Retains accumulated value when IN goes FALSE. R input resets the accumulator. Q is set when accumulated time reaches PT.

| Parameter | Direction | Type (S7-1200) | Type (S7-1500) | Description |
|-----------|-----------|-----------------|-----------------|-------------|
| IN | Input | BOOL | BOOL | Start input (accumulates while TRUE) |
| R | Input | BOOL | BOOL | Reset input (resets accumulated time) |
| PT | Input | TIME | TIME, LTIME | Maximum duration |
| Q | Output | BOOL | BOOL | TRUE when accumulated time >= PT |
| ET | Output | TIME | TIME, LTIME | Accumulated time |

**Declaration & Call:**
```scl
VAR
    instAccumTimer : TONR_TIME;
END_VAR

#instAccumTimer(IN := "Tag_Start", R := "Tag_Reset", PT := T#10s,
                Q => "Tag_Status", ET => "Tag_AccumTime");

// Single instance (separate DB):
"TONR_DB".TONR(IN := "Tag_Start", R := "Tag_Reset", PT := T#10s,
               Q => "Tag_Status", ET => "Tag_AccumTime");
```

### RESET_TIMER: Reset timer

Resets all structure components of an IEC timer to 0. Must be called inside an IF statement.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| TIMER | InOut | IEC_TIMER / any timer type | IEC timer to reset |

```scl
IF #resetCondition THEN
    RESET_TIMER(TIMER := #instOnDelay);
END_IF;

// Or with separate DB:
IF #resetCondition THEN
    RESET_TIMER(TIMER := "TON_DB");
END_IF;
```

### PRESET_TIMER: Load time duration

Overwrites the PT value of a running IEC timer. Executes every cycle while its condition is TRUE.

| Parameter | Direction | Type (S7-1200) | Type (S7-1500) | Description |
|-----------|-----------|-----------------|-----------------|-------------|
| PT | Input | TIME | TIME, LTIME | New time duration |
| TIMER | InOut | Any IEC timer type | Any IEC timer type | Target IEC timer |

```scl
IF #instOnDelay.ET < T#10s THEN
    PRESET_TIMER(PT := T#25s, TIMER := #instOnDelay);
END_IF;
```

### Accessing Timer Members Directly

You can read timer outputs without calling the timer:
```scl
IF #instOnDelay.Q THEN          // Read Q status
    // timer has expired
END_IF;
tempElapsed := #instOnDelay.ET;  // Read elapsed time
```

---

## 3. Counter Operations (IEC Counters)

**CRITICAL**: IEC counters MUST be declared in VAR (Static section) as multi-instance, or in a separate instance DB. NEVER declare in VAR_TEMP.

### Counter Data Types for Declaration

| Counter | S7-1200 Multi-Instance | S7-1500 Multi-Instance |
|---------|----------------------|----------------------|
| CTU | CTU_INT, CTU_DINT, CTU_SINT, CTU_UINT, CTU_UDINT, CTU_USINT | + CTU_LINT, CTU_ULINT |
| CTD | CTD_INT, CTD_DINT, CTD_SINT, CTD_UINT, CTD_UDINT, CTD_USINT | + CTD_LINT, CTD_ULINT |
| CTUD | CTUD_INT, CTUD_DINT, CTUD_SINT, CTUD_UINT, CTUD_UDINT, CTUD_USINT | + CTUD_LINT, CTUD_ULINT |

Shared DB types: IEC_COUNTER, IEC_DCOUNTER, IEC_SCOUNTER (and unsigned variants IEC_UCOUNTER, etc.)

### CTU: Count up

Increments CV on each rising edge at CU. Q is TRUE when CV >= PV. R resets CV to 0.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| CU | Input | BOOL | Count up input (rising edge) |
| R | Input | BOOL | Reset input (resets CV to 0) |
| PV | Input | INT (or matching integer type) | Preset value (threshold for Q) |
| Q | Output | BOOL | TRUE when CV >= PV |
| CV | Output | INT (or matching integer type) | Current counter value |

**Declaration & Call:**
```scl
VAR
    instCountUp : CTU_INT;
END_VAR

#instCountUp(CU := "Tag_CountPulse", R := "Tag_Reset", PV := 10,
             Q => "Tag_CountReached", CV => "Tag_CurrentCount");

// Single instance (separate DB):
"IEC_COUNTER_DB".CTU(CU := "Tag_CountPulse", R := "Tag_Reset", PV := 10,
                     Q => "Tag_CountReached", CV => "Tag_CurrentCount");
```

### CTD: Count down

Decrements CV on each rising edge at CD. Q is TRUE when CV <= 0. LD loads PV into CV.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| CD | Input | BOOL | Count down input (rising edge) |
| LD | Input | BOOL | Load input (loads PV into CV) |
| PV | Input | INT (or matching integer type) | Preset/load value |
| Q | Output | BOOL | TRUE when CV <= 0 |
| CV | Output | INT (or matching integer type) | Current counter value |

**Declaration & Call:**
```scl
VAR
    instCountDown : CTD_INT;
END_VAR

#instCountDown(CD := "Tag_CountPulse", LD := "Tag_Load", PV := 100,
               Q => "Tag_CountZero", CV => "Tag_CurrentCount");
```

### CTUD: Count up and down

Combines count up and count down. CU increments, CD decrements. R resets to 0, LD loads PV.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| CU | Input | BOOL | Count up input (rising edge) |
| CD | Input | BOOL | Count down input (rising edge) |
| R | Input | BOOL | Reset input (resets CV to 0) |
| LD | Input | BOOL | Load input (loads PV into CV) |
| PV | Input | INT (or matching integer type) | Preset value |
| QU | Output | BOOL | Up counter status (TRUE when CV >= PV) |
| QD | Output | BOOL | Down counter status (TRUE when CV <= 0) |
| CV | Output | INT (or matching integer type) | Current counter value |

**Declaration & Call:**
```scl
VAR
    instUpDown : CTUD_INT;
END_VAR

#instUpDown(CU := "Tag_Up", CD := "Tag_Down", R := "Tag_Reset", LD := "Tag_Load",
            PV := 50, QU => "Tag_UpStatus", QD => "Tag_DownStatus",
            CV => "Tag_CurrentCount");

// Single instance (separate DB):
"IEC_COUNTER_DB".CTUD(CU := "Tag_Up", CD := "Tag_Down", R := "Tag_Reset",
                      LD := "Tag_Load", PV := 50, QU => "Tag_UpStatus",
                      QD => "Tag_DownStatus", CV => "Tag_CurrentCount");
```

---

## 4. Comparator Operations

### TypeOf: Query data type of a tag

Returns the data type of a tag. Used with VARIANT parameters. Compare with data type keywords.

```scl
IF TypeOf(#myVariant) = BOOL THEN
    // handle BOOL
ELSIF TypeOf(#myVariant) = INT THEN
    // handle INT
ELSIF TypeOf(#myVariant) = REAL THEN
    // handle REAL
END_IF;
```

Valid comparison types: BOOL, BYTE, WORD, DWORD, LWORD, SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT, REAL, LREAL, CHAR, WCHAR, STRING, WSTRING, TIME, LTIME, DATE, TOD, LTOD, DT, LDT, DTL, S5TIME

### TypeOfElements: Query data type of ARRAY elements

Returns the data type of elements in a VARIANT that points to an ARRAY.

```scl
IF TypeOfElements(#myVariantArray) = INT THEN
    // ARRAY elements are INT
END_IF;
```

### IS_ARRAY: Check if VARIANT is an ARRAY

Returns TRUE if the VARIANT operand points to an ARRAY, FALSE otherwise.

```scl
IF IS_ARRAY(#myVariant) THEN
    // operand is an ARRAY
END_IF;
```

### TypeOfDB: Query data type of a data block (S7-1500 only)

Returns the number of the UDT/SDT that the DB is based on. Returns 0 if it is a global DB without a derived type.

```scl
tempDBType := TypeOfDB("MyDB");
```

---

## 5. Math Functions

All math functions return a value and are called as function expressions.

### ABS: Absolute value
```scl
"Tag_Result" := ABS("Tag_Value");
// Input/Output: Integers or floating-point numbers
```

### MIN / MAX: Minimum / Maximum of N values
```scl
"Tag_Result" := MIN(IN1 := "Tag_A", IN2 := "Tag_B", IN3 := "Tag_C");
"Tag_Result" := MAX(IN1 := "Tag_A", IN2 := "Tag_B");
// 2-32 inputs (IN1..IN32). Input/Output: Integers or floating-point numbers.
```

### LIMIT: Clamp value to range
```scl
"Tag_Result" := LIMIT(MN := "Tag_Min", IN := "Tag_Value", MX := "Tag_Max");
// Returns MN if IN < MN, MX if IN > MX, otherwise IN.
// Input/Output: Integers or floating-point numbers.
```

### SQR: Square
```scl
"Tag_Result" := SQR("Tag_Value");
// Input: Integer or floating-point. Output: Same type.
```

### SQRT: Square root
```scl
"Tag_Result" := SQRT("Tag_Value");
// Input/Output: Floating-point (REAL or LREAL).
```

### LN: Natural logarithm
```scl
"Tag_Result" := LN("Tag_Value");
// Input/Output: REAL or LREAL. Input must be > 0.
```

### EXP: Exponential (e^x)
```scl
"Tag_Result" := EXP("Tag_Value");
// Input/Output: REAL or LREAL.
```

### Trigonometric Functions

All take and return REAL or LREAL. Angles are in **radians**.

```scl
"Tag_Result" := SIN("Tag_Angle");   // Sine
"Tag_Result" := COS("Tag_Angle");   // Cosine
"Tag_Result" := TAN("Tag_Angle");   // Tangent
"Tag_Result" := ASIN("Tag_Value");  // Arc sine (returns radians)
"Tag_Result" := ACOS("Tag_Value");  // Arc cosine (returns radians)
"Tag_Result" := ATAN("Tag_Value");  // Arc tangent (returns radians)
```

### FRAC: Fractional part of floating-point
```scl
"Tag_Result" := FRAC("Tag_Value");
// Input/Output: REAL or LREAL. Returns the part after the decimal point.
// Example: FRAC(3.75) = 0.75, FRAC(-3.75) = -0.75
```

### Arithmetic Operators

Standard arithmetic uses operators, not function calls:
```scl
result := a + b;    // Addition
result := a - b;    // Subtraction
result := a * b;    // Multiplication
result := a / b;    // Division
result := a MOD b;  // Modulo (integers only)
result := a ** b;   // Exponentiation
```

---

## 6. Conversion Operations

### CONVERT: Explicit type conversion

SCL uses the pattern `<SourceType>_TO_<DestType>()` for explicit conversions. No implicit type conversions exist — you MUST use explicit conversion functions.

**Common conversions:**
```scl
// Integer ↔ Real
"Tag_INT"  := REAL_TO_INT("Tag_REAL");     // REAL → INT (rounds to nearest)
"Tag_REAL" := INT_TO_REAL("Tag_INT");      // INT → REAL
"Tag_REAL" := DINT_TO_REAL("Tag_DINT");    // DINT → REAL
"Tag_DINT" := REAL_TO_DINT("Tag_REAL");    // REAL → DINT

// Integer ↔ Integer
"Tag_DINT" := INT_TO_DINT("Tag_INT");      // INT → DINT
"Tag_INT"  := DINT_TO_INT("Tag_DINT");     // DINT → INT (may truncate)
"Tag_UINT" := INT_TO_UINT("Tag_INT");      // INT → UINT

// Word ↔ Integer (reinterprets bit pattern)
"Tag_INT"  := WORD_TO_INT("Tag_WORD");     // WORD → INT
"Tag_WORD" := INT_TO_WORD("Tag_INT");      // INT → WORD

// Time conversions
"Tag_DINT" := TIME_TO_DINT("Tag_TIME");    // TIME → DINT (milliseconds)
"Tag_TIME" := DINT_TO_TIME("Tag_DINT");    // DINT → TIME

// Bool/Byte
"Tag_BYTE" := BOOL_TO_BYTE("Tag_BOOL");
"Tag_INT"  := BYTE_TO_INT("Tag_BYTE");
```

**Available source/dest types:** BOOL, BYTE, WORD, DWORD, LWORD, SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT, REAL, LREAL, CHAR, WCHAR, STRING, WSTRING, TIME, LTIME, S5TIME, DATE, TOD, LTOD, DT, LDT, DTL, BCD16, BCD32

### ROUND: Round to nearest integer
```scl
"Tag_Result" := ROUND("Tag_Value");
// Input: Floating-point (REAL/LREAL)
// Output: Integer (default DINT) or floating-point
// Rounds to nearest even on .5 (banker's rounding)
// Example: ROUND(1.5) = 2, ROUND(2.5) = 2
```

### CEIL: Round up (next higher integer)
```scl
"Tag_Result" := CEIL("Tag_Value");         // Returns DINT by default
"Tag_Result" := CEIL_REAL("Tag_Value");    // Returns REAL
"Tag_Result" := CEIL_SINT("Tag_Value");    // Returns SINT
"Tag_Result" := CEIL_INT("Tag_Value");     // Returns INT
"Tag_Result" := CEIL_DINT("Tag_Value");    // Returns DINT
"Tag_Result" := CEIL_LINT("Tag_Value");    // Returns LINT
// Input: REAL or LREAL. Example: CEIL(0.5) = 1, CEIL(-0.5) = 0
```

### FLOOR: Round down (next lower integer)
```scl
"Tag_Result" := FLOOR("Tag_Value");        // Returns DINT by default
"Tag_Result" := FLOOR_REAL("Tag_Value");   // Returns REAL
// Input: REAL or LREAL. Example: FLOOR(0.5) = 0, FLOOR(-0.5) = -1
```

### TRUNC: Truncate toward zero
```scl
"Tag_Result" := TRUNC("Tag_Value");        // Returns DINT by default
"Tag_Result" := TRUNC_INT("Tag_Value");    // Returns INT
"Tag_Result" := TRUNC_REAL("Tag_Value");   // Returns REAL
// Input: REAL or LREAL. Example: TRUNC(1.9) = 1, TRUNC(-1.9) = -1
```

---

## 7. Scaling Operations

### SCALE_X: Scale (normalized value → engineering range)

Maps a floating-point value (typically 0.0–1.0 from NORM_X) to an engineering value range [MIN..MAX].

Formula: `OUT = VALUE * (MAX - MIN) + MIN`

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| MIN | Input | Integer or floating-point | Low limit of output range |
| VALUE | Input | Floating-point (REAL/LREAL) | Value to scale (typically 0.0–1.0) |
| MAX | Input | Integer or floating-point | High limit of output range |
| Return | Output | Integer or floating-point (default INT) | Scaled result |

```scl
// Scale 0.0-1.0 to 0-100:
"Tag_Scaled" := SCALE_X(MIN := 0, VALUE := "Tag_Normalized", MAX := 100);

// Scale to REAL output:
"Tag_Scaled" := SCALE_X_REAL(MIN := 0.0, VALUE := "Tag_Normalized", MAX := 100.0);
```

### NORM_X: Normalize (engineering value → 0.0–1.0)

Maps a value from range [MIN..MAX] to a normalized floating-point value (0.0–1.0).

Formula: `OUT = (VALUE - MIN) / (MAX - MIN)`

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| MIN | Input | Integer or floating-point | Low limit of input range |
| VALUE | Input | Integer or floating-point | Value to normalize |
| MAX | Input | Integer or floating-point | High limit of input range |
| Return | Output | Floating-point (default REAL) | Normalized result (0.0–1.0) |

```scl
// Normalize raw analog 0-27648 to 0.0-1.0:
"Tag_Normalized" := NORM_X(MIN := 0, VALUE := "Tag_RawAnalog", MAX := 27648);

// LREAL output:
"Tag_Normalized" := NORM_X_LREAL(MIN := 0, VALUE := "Tag_RawAnalog", MAX := 27648);
```

### Common NORM_X + SCALE_X Pattern (Analog Scaling)
```scl
// Scale raw analog input (0–27648) to engineering units (0.0–100.0):
tempNormalized := NORM_X(MIN := 0, VALUE := "IW64", MAX := 27648);
"Tag_Temperature" := SCALE_X_REAL(MIN := 0.0, VALUE := tempNormalized, MAX := 100.0);
```

---

## 8. Move Operations

### MOVE_BLK: Move block (copy ARRAY elements)

Copies COUNT elements from source ARRAY starting at specified index to destination ARRAY.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| IN | Input | ARRAY element | First element of source range |
| COUNT | Input | UINT/UDINT | Number of elements to copy |
| OUT | Output | ARRAY element | First element of destination range |

```scl
MOVE_BLK(IN := #sourceArray[2], COUNT := 5, OUT => #destArray[0]);
// Copies sourceArray[2..6] to destArray[0..4]
```

### UMOVE_BLK: Uninterruptible move block

Same as MOVE_BLK but cannot be interrupted by higher-priority OBs. Use for data consistency.

```scl
UMOVE_BLK(IN := #sourceArray[0], COUNT := 3, OUT => #destArray[0]);
```

### FILL_BLK: Fill block (fill ARRAY with single value)

Fills COUNT elements of destination ARRAY with the value at IN.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| IN | Input | Any elementary | Fill value |
| COUNT | Input | UINT/UDINT | Number of elements to fill |
| OUT | Output | ARRAY element | First element of destination |

```scl
FILL_BLK(IN := 0, COUNT := 10, OUT => #myArray[0]);
// Fills myArray[0..9] with 0
```

### MOVE_BLK_VARIANT: Move block with VARIANT

Copies COUNT elements between VARIANT-addressed arrays. Supports different source/destination index offsets.

| Parameter | Direction | Type | Description |
|-----------|-----------|------|-------------|
| SRC | Input | VARIANT | Source array |
| COUNT | Input | UDINT | Number of elements to copy |
| SRC_INDEX | Input | DINT | Start index in source |
| DEST_INDEX | Input | DINT | Start index in destination |
| DEST | InOut | VARIANT | Destination array |
| Return | Output | INT | Error code (0 = OK) |

```scl
"Tag_Error" := MOVE_BLK_VARIANT(SRC := #srcField, COUNT := 5,
                                 SRC_INDEX := 0, DEST_INDEX := 2, DEST := #destField);
```

### Serialize / Deserialize

Convert structured data to/from byte arrays for communication.

**Serialize** (struct → byte array):
```scl
VAR_TEMP
    tempPos : DINT := 0;
    tempError : INT;
END_VAR

tempError := Serialize(SRC_VARIABLE := #myStruct, DEST_ARRAY := #byteBuffer, POS := tempPos);
// tempPos now points to next free byte
```

**Deserialize** (byte array → struct):
```scl
VAR_TEMP
    tempPos : DINT := 0;
    tempError : INT;
END_VAR

tempError := Deserialize(SRC_ARRAY := #byteBuffer, DEST_VARIABLE := #myStruct, POS := tempPos);
```

### SWAP: Swap byte order in a WORD/DWORD/LWORD
```scl
"Tag_Swapped" := SWAP("Tag_Value");
// Reverses byte order. Input/Output: WORD, DWORD, or LWORD.
```

### SCATTER: Unpack BYTE/WORD/DWORD into BOOL array (S7-1500)
```scl
SCATTER(IN := "Tag_Byte", OUT => #boolArray);
// Distributes bits of input into consecutive BOOL array elements
```

### GATHER: Pack BOOL array into BYTE/WORD/DWORD (S7-1500)
```scl
GATHER(IN := #boolArray, OUT => "Tag_Byte");
// Collects consecutive BOOL array elements into a single word
```

---

## 9. VARIANT Operations (S7-1500, S7-1200 FW4.0+)

### VariantGet: Read value from VARIANT
```scl
VariantGet(SRC := #myVariant, DST => "Tag_Destination");
// Copies value from VARIANT to a typed tag. Types must be compatible.
```

### VariantPut: Write value to VARIANT
```scl
VariantPut(SRC := "Tag_Source", DST := #myVariant);
// Writes a typed value into a VARIANT. Types must be compatible.
```

### CountOfElements: Count elements in VARIANT array
```scl
"Tag_Count" := CountOfElements(#myVariantArray);
// Returns UDINT: number of elements if VARIANT points to an ARRAY, otherwise 1.
```

---

## 10. ARRAY Operations

### LOWER_BOUND / UPPER_BOUND: Get ARRAY dimension limits
```scl
"Tag_Lower" := LOWER_BOUND(ARR := #myArray, DIM := 1);
"Tag_Upper" := UPPER_BOUND(ARR := #myArray, DIM := 1);
// DIM: dimension number (1 for first dimension, 2 for second, etc.)
// Returns DINT. Works with both static arrays and VARIANT pointing to arrays.
```

---

## 11. Word Logic Operations

### SEL: Binary selection (multiplexer, 2 inputs)
```scl
"Tag_Result" := SEL(G := "Tag_Switch", IN0 := "Tag_IfFalse", IN1 := "Tag_IfTrue");
// G=FALSE → returns IN0; G=TRUE → returns IN1
// All elementary data types. Both IN0 and IN1 are always evaluated.
```

### MUX: Multiplexer (N inputs)
```scl
"Tag_Result" := MUX(K := "Tag_Index",
                     IN0 := "Tag_Val0", IN1 := "Tag_Val1", IN2 := "Tag_Val2",
                     INELSE := "Tag_Default");
// K: selector index (integer). Returns INk for valid K, INELSE otherwise.
// Supports IN0..IN31. INELSE is optional but recommended.
```

### DEMUX: Demultiplexer (route to N outputs)
```scl
DEMUX(K := "Tag_Index", IN := "Tag_Value",
      OUT0 => "Tag_Out0", OUT1 => "Tag_Out1", OUT2 => "Tag_Out2",
      OUTELSE => "Tag_Default");
// Routes IN to the output OUTk selected by K. OUTELSE receives IN if K is out of range.
```

### DECO: Decode (bit position → bit pattern)
```scl
"Tag_Result" := DECO("Tag_BitPosition");
// Input: integer (0-31). Output: DWORD/LWORD with single bit set at position.
// Example: DECO(3) = 16#0000_0008 (bit 3 set)
```

### ENCO: Encode (bit pattern → bit position)
```scl
"Tag_Result" := ENCO("Tag_BitPattern");
// Input: DWORD/LWORD. Output: integer = position of lowest set bit.
// Example: ENCO(16#0000_0008) = 3
```

---

## 12. Shift and Rotate Operations

All shift/rotate functions take an input value IN and shift count N, returning the result.

### SHR: Shift right
```scl
"Tag_Result" := SHR(IN := "Tag_Value", N := "Tag_ShiftCount");
// Shifts bits right by N positions. Vacated bits filled with 0 (unsigned) or sign bit (signed).
// Input/Output: BYTE, WORD, DWORD, LWORD
```

### SHL: Shift left
```scl
"Tag_Result" := SHL(IN := "Tag_Value", N := "Tag_ShiftCount");
// Shifts bits left by N positions. Vacated bits filled with 0.
```

### ROR: Rotate right
```scl
"Tag_Result" := ROR(IN := "Tag_Value", N := "Tag_RotateCount");
// Rotates bits right by N positions. Bits that fall off re-enter from the left.
```

### ROL: Rotate left
```scl
"Tag_Result" := ROL(IN := "Tag_Value", N := "Tag_RotateCount");
// Rotates bits left by N positions. Bits that fall off re-enter from the right.
```

---

## 13. Program Control

### IF / ELSIF / ELSE
```scl
IF condition1 THEN
    // ...
ELSIF condition2 THEN
    // ...
ELSE
    // ...
END_IF;
```

### CASE (integer selector)
```scl
CASE #selector OF
    0:
        // state 0
    1:
        // state 1
    2, 3:
        // states 2 or 3
    4..10:
        // states 4 through 10
    ELSE
        // default (ALWAYS include ELSE)
END_CASE;
```
**CRITICAL**: CASE labels must be **compile-time constants** (literal integers or named constants). Variables are NOT allowed as CASE labels.

### FOR loop
```scl
FOR #i := 0 TO 9 BY 1 DO
    #myArray[#i] := 0;
END_FOR;
```
**CRITICAL**: Do NOT modify the loop counter variable (#i) inside the FOR body. Use WHILE if you need dynamic control.

### WHILE loop
```scl
WHILE #condition DO
    // body
END_WHILE;
```

### REPEAT...UNTIL loop
```scl
REPEAT
    // body (executes at least once)
UNTIL #exitCondition
END_REPEAT;
```

### CONTINUE / EXIT / RETURN
```scl
// CONTINUE: skip to next iteration
FOR #i := 0 TO 9 DO
    IF #skipCondition THEN CONTINUE; END_IF;
    // process
END_FOR;

// EXIT: break out of innermost loop
FOR #i := 0 TO 99 DO
    IF #foundCondition THEN EXIT; END_IF;
END_FOR;

// RETURN: exit current block immediately
IF #errorCondition THEN RETURN; END_IF;
```

### GOTO (avoid if possible)
```scl
GOTO MyLabel;
// ...
MyLabel:
// execution continues here
```

### REGION (code organization — no runtime effect)
```scl
REGION IO Mapping
    // input mapping code
END_REGION

REGION State Machine
    // state logic
END_REGION
```

---

## 14. Error Handling

### GET_ERROR: Get detailed error information (S7-1500)

Captures runtime errors locally. Must declare an error struct variable.

```scl
VAR_TEMP
    tempError : ErrorStruct;    // System type, not user-defined
END_VAR

GET_ERROR(#tempError);

IF #tempError.ERROR THEN
    // Handle error
    // Fields: .ERROR (BOOL), .ERROR_ID (WORD), .MODE (BYTE),
    //         .OPERAND_NUMBER (UINT), .BLOCK_TYPE (BYTE), .BLOCK_NUMBER (UINT),
    //         .LINE_NUMBER (DINT), .INTERNAL_ERROR (DWORD)
END_IF;
```

### GET_ERR_ID: Get error ID only (S7-1500)
```scl
VAR_TEMP
    tempErrWord : WORD;
END_VAR

#tempErrWord := GET_ERR_ID();

IF #tempErrWord <> W#16#0000 THEN
    // Error occurred, handle based on error code
END_IF;
```

---

## 15. REF: Create a reference (pointer) to a tag (S7-1500)
```scl
VAR
    myRefInt : REF_TO INT;
    myValue : INT;
END_VAR

#myRefInt := REF(#myValue);
#myRefInt^ := 42;             // Dereference and write
tempVal := #myRefInt^;        // Dereference and read
```

---

## 16. Runtime / System Functions

### RE_TRIGR: Retrigger cycle monitoring time
```scl
RE_TRIGR();
// Restarts the cycle monitoring timer. Use inside long-running loops to prevent watchdog timeout.
```

### STP: Stop the CPU
```scl
STP();
// Transitions the CPU to STOP mode. Use only for critical safety conditions.
```

### RUNTIME: Measure execution time (S7-1500)
```scl
VAR
    statMeasure : LREAL;
END_VAR

#statMeasure := RUNTIME(#statMeasure);
// ... code to measure ...
#statMeasure := RUNTIME(#statMeasure);
// statMeasure now contains elapsed time in seconds (LREAL)
```

---

## 17. Legacy Instructions (Avoid — Use IEC Equivalents)

These legacy instructions exist for backward compatibility. **Prefer IEC timers/counters** for new code.

### Legacy Timers (S7-1500 only): S_PULSE, S_PEXT, S_ODT, S_ODTS, S_OFFDT
- Use S5TIME data type (not TIME)
- Require separate timer number (T_NO)
- **Do not use in new code** — use TP, TON, TOF instead

### Legacy Counters (S7-1500 only): S_CU, S_CD, S_CUD
- Use C_NO (counter number)
- **Do not use in new code** — use CTU, CTD, CTUD instead

### Legacy Scaling: SCALE / UNSCALE
- **Do not use in new code** — use NORM_X + SCALE_X instead

### Legacy Move: BLKMOV, UBLKMOV, FILL
- **Do not use in new code** — use MOVE_BLK, UMOVE_BLK, FILL_BLK instead

---

## 18. Instructions NOT in This Document

The following instruction categories are covered in **separate Siemens manuals** and are NOT included here:

- **String operations** (CONCAT, LEFT, RIGHT, MID, LEN, FIND, REPLACE, INSERT, DELETE, S_CONV, Strg_TO_Chars, Chars_TO_Strg, MAX_LEN, etc.)
- **Date and Time operations** (RD_SYS_T, RD_LOC_T, WR_SYS_T, T_CONV, T_ADD, T_DIFF, T_COMBINE, T_SPLIT, etc.)
- **Communication instructions** (TCON, TDISCON, TSEND, TRCV, TUSEND, TURCV, T_CONFIG, etc.)
- **PID control** (PID_Compact, PID_3Step, PID_Temp)
- **Motion control** (MC_Power, MC_Home, MC_MoveAbsolute, MC_MoveRelative, etc.)
- **Alarm / Diagnostics** (Program_Alarm, Get_Alarm, Ack_Alarms, DeviceStates, ModuleStates, etc.)
- **Distributed I/O** (RDREC, WRREC, RALRM, DPRD_DAT, DPWR_DAT, etc.)
- **Recipe / Data logging** (RecipeExport, RecipeImport, DataLogCreate, etc.)

If you need to use any of these, ask the user for the relevant Siemens documentation or check the TIA Portal online help.

---

## Quick Reference: Most Common Patterns

### Analog Input Scaling (Raw → Engineering)
```scl
VAR_TEMP
    tempNorm : REAL;
END_VAR

tempNorm := NORM_X(MIN := 0, VALUE := "IW64", MAX := 27648);
"DB_HMI".Temperature := SCALE_X_REAL(MIN := 0.0, VALUE := tempNorm, MAX := 100.0);
```

### Timed Start with Edge Detection
```scl
VAR
    instStartEdge : R_TRIG;
    instStartDelay : TON_TIME;
END_VAR

#instStartEdge(CLK := "Tag_StartButton", Q => #tempStartPulse);
#instStartDelay(IN := #tempStartPulse, PT := T#3s, Q => "Tag_DelayedStart", ET => #tempElapsed);
```

### Parts Counter with Reset
```scl
VAR
    instPartCounter : CTU_DINT;
END_VAR

#instPartCounter(CU := "Tag_PartSensor", R := "Tag_ResetCount", PV := DINT#0,
                  Q => #tempDummy, CV => "DB_HMI".PartCount);
```

### Type-Safe Value Conversion
```scl
// ALWAYS use explicit conversion — no implicit casting
tempReal := INT_TO_REAL(#inputInt);
tempScaled := tempReal * 0.01;
tempOutput := REAL_TO_INT(tempScaled);
```
