# SCL (Structured Control Language) Reference — S7-1200/S7-1500

> For TIA Portal V17–V20 with S7-1200 and S7-1500 CPUs.
> Optimized block access is the default and recommended setting.
> All examples use symbolic addressing only — absolute addressing (M0.0, I0.0, DB20.DW3) is NOT used.

---

## 1. Character Set and Lexical Rules

### 1.1 Permitted Characters

- **Letters**: A-Z, a-z (case-insensitive for keywords and identifiers)
- **Digits**: 0-9
- **Space** (ASCII 32) and control characters including end-of-line
- **Special characters**: `+ - * / = < > [ ] ( ) . , : ; $ # " ' { }`

### 1.2 Free Format

SCL source is free-format: spaces, tabs, and line breaks can appear between tokens. Within a single token (identifier, number), no whitespace is allowed.

### 1.3 Case Insensitivity

All keywords, predefined names, and user-defined identifiers are **not** case-sensitive. `Motor` and `MOTOR` are identical.

---

## 2. Identifiers

### 2.1 Rules

```
IDENTIFIER ::= (Letter | '_') { Letter | Digit | '_' }
```

- First character must be a letter or underscore `_`
- Must not be a reserved keyword
- Case-insensitive

**Valid**: `x`, `y12`, `Sum`, `Temperature`, `statCounter`, `tempCalc`
**Invalid**: `4th` (starts with digit), `Array` (keyword), `S Value` (contains space)

### 2.2 Quoted Identifiers

Identifiers with special characters must be enclosed in double quotes:

```scl
"Motor Control"
"Input 1.1"
"Controller.B1&U2"
```

### 2.3 Local Variable Prefix

In TIA Portal, local variables (declared in VAR, VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR_TEMP) are accessed with the `#` prefix:

```scl
#statCounter := #statCounter + 1;
#tempCalc := INT_TO_REAL(#inputValue);
```

---

## 3. Reserved Words (Keywords)

All keywords are case-insensitive.

### Block Structure Keywords

| Keyword | Purpose |
|---|---|
| `ORGANIZATION_BLOCK` / `END_ORGANIZATION_BLOCK` | OB boundaries |
| `FUNCTION_BLOCK` / `END_FUNCTION_BLOCK` | FB boundaries |
| `FUNCTION` / `END_FUNCTION` | FC boundaries |
| `DATA_BLOCK` / `END_DATA_BLOCK` | DB boundaries |
| `TYPE` / `END_TYPE` | UDT boundaries |
| `BEGIN` | Starts code/assignment section |

### Declaration Keywords

| Keyword | Purpose |
|---|---|
| `VAR` / `END_VAR` | Static variables (FB) |
| `VAR_TEMP` / `END_VAR` | Temporary variables |
| `VAR_INPUT` / `END_VAR` | Input parameters |
| `VAR_OUTPUT` / `END_VAR` | Output parameters |
| `VAR_IN_OUT` / `END_VAR` | In/out parameters |
| `CONST` / `END_CONST` | Constants |
| `STRUCT` / `END_STRUCT` | Structure definition |

### Data Type Keywords

| Keyword | Bits | Description |
|---|---|---|
| `BOOL` | 1 | Boolean |
| `BYTE` | 8 | Byte (bit pattern) |
| `WORD` | 16 | Word (bit pattern) |
| `DWORD` | 32 | Double word (bit pattern) |
| `LWORD` | 64 | Long word (bit pattern) |
| `SINT` | 8 | Short integer (-128 to 127) |
| `USINT` | 8 | Unsigned short integer (0 to 255) |
| `INT` | 16 | Integer (-32768 to 32767) |
| `UINT` | 16 | Unsigned integer (0 to 65535) |
| `DINT` | 32 | Double integer (-2147483648 to 2147483647) |
| `UDINT` | 32 | Unsigned double integer (0 to 4294967295) |
| `LINT` | 64 | Long integer |
| `ULINT` | 64 | Unsigned long integer |
| `REAL` | 32 | IEEE 32-bit float |
| `LREAL` | 64 | IEEE 64-bit float |
| `CHAR` | 8 | Single ASCII character |
| `WCHAR` | 16 | Single Unicode character |
| `STRING` | variable | ASCII string (up to 254 chars) |
| `WSTRING` | variable | Unicode string |
| `TIME` | 32 | IEC time duration (ms resolution) |
| `LTIME` | 64 | Long time duration (ns resolution) |
| `DATE` | 16 | IEC date |
| `TIME_OF_DAY` / `TOD` | 32 | Time of day |
| `LTOD` | 64 | Long time of day |
| `DATE_AND_TIME` / `DT` | 64 | Date and time |
| `LDT` | 64 | Long date and time |
| `DTL` | 96 | Date and time long (12 bytes, preferred for S7-1500) |
| `ARRAY` | variable | Fixed-size collection |
| `VOID` | - | No return value (for functions) |
| `VARIANT` | variable | Runtime type-flexible parameter |

### Control Flow Keywords

| Keyword | Purpose |
|---|---|
| `IF` / `THEN` / `ELSIF` / `ELSE` / `END_IF` | Conditional branch |
| `CASE` / `OF` / `END_CASE` | Selection by value |
| `FOR` / `TO` / `BY` / `DO` / `END_FOR` | Counted loop |
| `WHILE` / `DO` / `END_WHILE` | Condition-first loop |
| `REPEAT` / `UNTIL` / `END_REPEAT` | Condition-last loop |
| `CONTINUE` | Skip to next loop iteration |
| `EXIT` | Exit current loop |
| `RETURN` | Exit current block |

### Operator Keywords

| Keyword | Purpose |
|---|---|
| `AND` / `&` | Logical AND |
| `OR` | Logical OR |
| `XOR` | Logical exclusive OR |
| `NOT` | Logical negation |
| `MOD` | Modulus (remainder) |

### Other Reserved Words

| Keyword | Purpose |
|---|---|
| `TRUE` / `FALSE` | Boolean constants |
| `EN` / `ENO` | Implicit enable input / enable out |
| `REF_TO` | Reference data type |

---

## 4. Number Formats

### 4.1 Integers

```
0     1     +1     -1     743     -5280     600_00     -32_211
```

Underscore `_` allowed for visual separation. No commas or spaces.

### 4.2 Binary / Octal / Hexadecimal

```
2#1111          // Binary = 15
8#17            // Octal = 15
16#F            // Hexadecimal = 15
16#1A2B         // Hexadecimal
```

### 4.3 Real Numbers

Must contain either a decimal point or an exponent (or both). Decimal point must be between two digits.

```
0.0     1.0     -0.2     827.602     50000.0
3.0E+10     3e+10     0.3E+11     4e2
```

**Invalid**: `1.` (need digit after point), `.3333` (need digit before point)

---

## 5. Data Types

### 5.1 Elementary Data Types

| Type | Keyword | Bits | Value Range |
|---|---|---|---|
| Bit | `BOOL` | 1 | `FALSE`, `TRUE` |
| Short Int | `SINT` | 8 | -128 to 127 |
| Unsigned Short | `USINT` | 8 | 0 to 255 |
| Integer | `INT` | 16 | -32768 to 32767 |
| Unsigned Int | `UINT` | 16 | 0 to 65535 |
| Double Int | `DINT` | 32 | -2147483648 to 2147483647 |
| Unsigned DInt | `UDINT` | 32 | 0 to 4294967295 |
| Long Int | `LINT` | 64 | Full 64-bit signed range |
| Unsigned LInt | `ULINT` | 64 | Full 64-bit unsigned range |
| Real | `REAL` | 32 | IEEE 754 single-precision float |
| Long Real | `LREAL` | 64 | IEEE 754 double-precision float |
| Byte | `BYTE` | 8 | Bit pattern (no numeric range) |
| Word | `WORD` | 16 | Bit pattern |
| Double Word | `DWORD` | 32 | Bit pattern |
| Long Word | `LWORD` | 64 | Bit pattern |
| Character | `CHAR` | 8 | Single ASCII character |
| Wide Character | `WCHAR` | 16 | Single Unicode character |

### 5.2 Time Types

| Type | Keyword | Bits | Format Example |
|---|---|---|---|
| Time duration | `TIME` | 32 | `T#1h20m10s30ms` |
| Long time | `LTIME` | 64 | `LT#1h20m10s30ms` |
| Date | `DATE` | 16 | `D#2024-01-15` |
| Time of day | `TOD` | 32 | `TOD#12:30:00` |
| Long TOD | `LTOD` | 64 | `LTOD#12:30:00.000000000` |
| Date and time | `DT` | 64 | `DT#2024-01-15-12:30:00` |
| Long DT | `LDT` | 64 | `LDT#2024-01-15-12:30:00` |
| Date time long | `DTL` | 96 | 12-byte structure (preferred for S7-1500) |

### 5.3 String Types

| Type | Keyword | Max Length | Description |
|---|---|---|---|
| ASCII String | `STRING[n]` | 254 chars | Always specify length: `STRING[80]` |
| Unicode String | `WSTRING[n]` | variable | Unicode characters |

**Important**: Always specify the string length explicitly: `STRING[80]`, not just `STRING`.

### 5.4 Complex Data Types

| Type | Keyword | Description |
|---|---|---|
| Array | `ARRAY[lo..hi] OF type` | Fixed-size collection of same-type elements |
| Structure | `STRUCT ... END_STRUCT` | Group of named components |
| UDT | `TYPE "name" ... END_TYPE` | User-defined reusable structure |

### 5.5 Implicit Type Conversion Order

Within `ANY_BIT`: `BOOL` → `BYTE` → `WORD` → `DWORD` → `LWORD`
Within `ANY_NUM`: `SINT` → `INT` → `DINT` → `REAL` → `LREAL`

**Important**: Explicit type conversion functions are ALWAYS required in TIA Portal SCL. There are no implicit conversions across type groups.

```scl
// WRONG — implicit conversion does NOT compile:
#tempReal := #inputInt;

// CORRECT — explicit conversion:
#tempReal := INT_TO_REAL(#inputInt);
```

---

## 6. Constants and Literals

### 6.1 Symbolic Constants (CONST block)

```scl
CONST
    MAX_SPEED := 1500;
    SCALE_FACTOR := 2.5;
    DEVICE_NAME := 'Motor 1';
END_CONST
```

Constant expressions with `+`, `-`, `*`, `/`, `DIV`, `MOD` are allowed.

### 6.2 Integer Literals

```
1000                    // Decimal
+1_120_200              // Decimal with separator
2#1111                  // Binary (= 15)
8#17                    // Octal (= 15)
16#F                    // Hexadecimal (= 15)
```

### 6.3 Real Number Literals

```
0.0     1.0     -0.2     827.602
3.0E+10     3e+10     4e2
```

### 6.4 String and Character Literals

```scl
'B'                     // Character
'RED'                   // String
'Hello World'           // String
```

**Escape sequences** using `$`:
| Code | Meaning |
|---|---|
| `$$` | Dollar sign |
| `$'` | Single quote |
| `$L` / `$l` | Line feed |
| `$R` / `$r` | Carriage return |
| `$T` / `$t` | Tab |

### 6.5 Time Literals

```scl
T#20ms                  // 20 milliseconds
T#1s                    // 1 second
T#1h20m10s30ms          // Complex time
TIME#300ms              // Alternate prefix
```

### 6.6 Date and Time Literals

```scl
DATE#2024-01-15         // Date
D#2024-01-15            // Short form

TOD#12:30:00            // Time of day
TOD#23:59:59.999        // With milliseconds

DT#2024-01-15-12:30:00  // Date and time
```

### 6.7 BOOL Literals

```
TRUE     FALSE
```

### 6.8 Typed Hex Constants

```scl
W#16#FFAA               // WORD hex constant
B#16#FF                 // BYTE hex constant
DW#16#AABBCCDD          // DWORD hex constant
```

---

## 7. SCL Source File Structure

### 7.1 Block Ordering Rules

Called blocks must precede calling blocks in the source file:

1. **UDTs** must precede blocks that use them
2. **FBs/FCs** must precede blocks that call them
3. **Global DBs** must precede blocks that access them
4. **FBs** must precede their instance DBs
5. **Instance DBs** come after their FB
6. **OB1** (which calls other blocks) comes at the very end

**Ordering example**:
```
UDT → FC → FB → Global DB → Instance DB → OB1
```

### 7.2 General Block Structure

Every block consists of:
1. Block start keyword + block name (in quotes)
2. Pragmas (e.g., `{ S7_Optimized_Access := 'TRUE' }`)
3. `VERSION : 0.1`
4. Declaration section (VAR blocks)
5. `BEGIN` keyword
6. Code section
7. Block end keyword

---

## 8. Block Syntax

### 8.1 Function Block (FB)

```scl
FUNCTION_BLOCK "ControlMotor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

VAR_INPUT
    start : Bool;
    stop : Bool;
    speedSetpoint : Real;
END_VAR

VAR_OUTPUT
    running : Bool;
    currentSpeed : Real;
    error : Bool;
END_VAR

VAR_IN_OUT
    diagnostics : "typeDiagnostics";
END_VAR

VAR
    statState : Int;
    statLastSpeed : Real;
    instStartDelay : TON;       // IEC timer as multi-instance
    instStopDelay : TON;
    instStartEdge : R_TRIG;    // Edge detection as multi-instance
END_VAR

VAR_TEMP
    tempCalc : Real;
    tempSpeedDiff : Real;
END_VAR

BEGIN
    // Code section
    #instStartEdge(CLK := #start);

    CASE #statState OF
        0:  // Idle
            #running := FALSE;
            IF #instStartEdge.Q THEN
                #statState := 1;
            END_IF;
        1:  // Starting
            #instStartDelay(IN := TRUE, PT := T#2s);
            IF #instStartDelay.Q THEN
                #statState := 2;
                #running := TRUE;
            END_IF;
        2:  // Running
            #currentSpeed := #speedSetpoint;
            IF #stop THEN
                #statState := 0;
                #running := FALSE;
            END_IF;
        ELSE
            #statState := 0;
            #error := TRUE;
    END_CASE;
END_FUNCTION_BLOCK
```

**Key points**:
- Block name in double quotes
- `{ S7_Optimized_Access := 'TRUE' }` pragma required
- Has persistent memory via instance DB
- Static variables (VAR) retain values across calls
- Timers, counters, edge triggers MUST be in VAR (static), NEVER in VAR_TEMP
- All local variables accessed with `#` prefix

### 8.2 Function (FC)

```scl
FUNCTION "ScaleAnalog" : Real
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

VAR_INPUT
    rawValue : Int;
    minScale : Real;
    maxScale : Real;
END_VAR

VAR_TEMP
    tempNormalized : Real;
END_VAR

BEGIN
    #tempNormalized := INT_TO_REAL(#rawValue) / 27648.0;
    #ScaleAnalog := #tempNormalized * (#maxScale - #minScale) + #minScale;
END_FUNCTION
```

**Key points**:
- Return type after colon (or `VOID` for no return)
- No instance DB, no persistent state
- Return value assigned by `#FunctionName := expression;`
- All parameters MUST be supplied when called
- VAR declarations are temporary (not persistent)
- Return type can be any elementary type, STRING, or UDT — but NOT STRUCT or ARRAY

### 8.3 Organization Block (OB)

```scl
ORGANIZATION_BLOCK "Main"
TITLE = "Main Program Sweep"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

VAR_TEMP
    tempStatus : Int;
END_VAR

BEGIN
    // Call FB instances using their instance DB name ONLY
    "InstMotor1"(start := "TagStartMotor1",
                 stop := "TagStopMotor1",
                 speedSetpoint := 1500.0);

    "InstMotor2"(start := "TagStartMotor2",
                 stop := "TagStopMotor2",
                 speedSetpoint := 750.0);

    "InstConveyor1"(start := "TagStartConv1",
                    stop := "TagStopConv1");
END_ORGANIZATION_BLOCK
```

**Key points**:
- Called by CPU operating system (cyclic for OB1)
- Only `VAR_TEMP` allowed (no VAR_INPUT/OUTPUT/IN_OUT, no VAR static)
- No parameters
- FB calls use **instance DB name only** — NOT `"FBName"."InstDBName"(...)`

### 8.4 Data Block (DB) — Global

```scl
DATA_BLOCK "Configuration"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN

STRUCT
    maxSpeed : Real := 1500.0;
    enabled : Bool := TRUE;
    deviceName : String[32] := 'Motor 1';
    limits : STRUCT
        upper : Real := 100.0;
        lower : Real := 0.0;
    END_STRUCT;
END_STRUCT;

BEGIN
END_DATA_BLOCK
```

### 8.5 Data Block (DB) — Instance DB

Every FB called from OB1 needs a separate instance DB:

```scl
DATA_BLOCK "InstMotor1"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlMotor"

BEGIN
END_DATA_BLOCK
```

**Key points**:
- The FB name (in quotes) on its own line references the FB type
- Instance DB inherits the FB's interface (all VAR_INPUT, VAR_OUTPUT, VAR, etc.)
- One instance DB per physical device (e.g., `InstMotor1`, `InstMotor2`)
- Instance DB name is what you use to call the FB from OB1

### 8.6 User-Defined Data Type (UDT)

```scl
TYPE "typeMotorConfig"
VERSION : 0.1
STRUCT
    maxSpeed : Real;
    minSpeed : Real;
    rampUpTime : Time := T#5s;
    rampDownTime : Time := T#3s;
    enabled : Bool := TRUE;
END_STRUCT;
END_TYPE
```

**Usage**:
```scl
VAR_INPUT
    config : "typeMotorConfig";
END_VAR
```

---

## 9. Declaration Section

### 9.1 Declaration Subsections by Block Type

| Subsection | FB | FC | OB | DB | UDT |
|---|---|---|---|---|---|
| `CONST ... END_CONST` | Yes | Yes | Yes | - | - |
| `VAR_TEMP ... END_VAR` | Yes | Yes | Yes | - | - |
| `VAR ... END_VAR` (static) | Yes | - | - | - | - |
| `VAR_INPUT ... END_VAR` | Yes | Yes | - | - | - |
| `VAR_OUTPUT ... END_VAR` | Yes | Yes | - | - | - |
| `VAR_IN_OUT ... END_VAR` | Yes | Yes | - | - | - |
| `STRUCT ... END_STRUCT` | - | - | - | Yes | Yes |

Each subsection may appear only **once**. No fixed order required.

### 9.2 Variable Declaration Syntax

```scl
variableName : DataType [:= InitialValue] ;
```

Multiple variables of the same type:
```scl
var1, var2, var3 : Int;
```

**Note**: Initialization of a list (`a1, a2, a3 : Int := 5`) is **not** possible. Initialize individually.

### 9.3 Initialization Rules

| Category | Initialization Allowed? |
|---|---|
| Static Variables (FB VAR) | Yes |
| Temporary Variables (VAR_TEMP) | No |
| Input Parameters (FB VAR_INPUT) | Yes |
| Output Parameters (FB VAR_OUTPUT) | Yes |
| In/Out Parameters (VAR_IN_OUT) | No |
| FC Parameters | No |

### 9.4 Array Declaration and Initialization

```scl
VAR
    // Simple array
    values : Array[1..10] of Int;

    // Initialized array
    defaults : Array[1..5] of Real := [1.0, 2.0, 3.0, 4.0, 5.0];

    // 2D array
    matrix : Array[1..4, 1..4] of Int;
END_VAR
```

### 9.5 Structure Declaration

```scl
VAR
    generator : Struct
        data : Real := 100.5;
        name : String[32] := 'Default';
        values : Array[1..12] of Real;
    END_STRUCT;
END_VAR
```

### 9.6 Multi-Instance Declaration (FB only)

Declare FB/timer/counter/edge instances inside another FB's VAR section:

```scl
VAR
    instMotor1 : "ControlMotor";    // FB as multi-instance
    instMotor2 : "ControlMotor";
    instStartDelay : TON;           // IEC timer
    instStopDelay : TOF;
    instStartEdge : R_TRIG;        // Edge detection
    instCounter : CTU;             // Counter
END_VAR
```

Multi-instance data is stored in the parent FB's instance DB — no separate instance DB needed.

---

## 10. Comments

### 10.1 Line Comments

```scl
// This is a line comment
#statCounter := #statCounter + 1;  // Inline comment
```

### 10.2 Block Comments

```scl
(* This is a block comment
   that can span multiple lines *)
```

---

## 11. Expressions and Operators

### 11.1 Operator Precedence (1 = highest)

| Priority | Operator | Description |
|---|---|---|
| 1 | `( )` | Parentheses |
| 2 | `**` | Exponentiation |
| 3 | `+` `-` `NOT` | Unary plus, unary minus, negation |
| 4 | `*` `/` `MOD` | Multiply, divide, modulus |
| 5 | `+` `-` | Addition, subtraction |
| 6 | `<` `>` `<=` `>=` | Comparison |
| 7 | `=` `<>` | Equal, not equal |
| 8 | `AND` / `&` | Logical AND |
| 9 | `XOR` | Logical exclusive OR |
| 10 | `OR` | Logical OR |
| 11 | `:=` | Assignment |

### 11.2 Mathematical Operators

| Operation | Operator | Operand Types | Result |
|---|---|---|---|
| Exponent | `**` | ANY_NUM, INT | REAL |
| Multiply | `*` | ANY_NUM | ANY_NUM |
| Divide | `/` | ANY_NUM | ANY_NUM |
| Modulus | `MOD` | ANY_INT | ANY_INT |
| Add | `+` | ANY_NUM | ANY_NUM |
| Subtract | `-` | ANY_NUM | ANY_NUM |

Where `ANY_INT` = SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT
Where `ANY_NUM` = ANY_INT + REAL, LREAL

**Time arithmetic**:
- `TIME + TIME = TIME`
- `TIME - TIME = TIME`
- `TOD + TIME = TOD`
- `TOD - TIME = TOD`
- `TIME * ANY_INT = TIME`
- `TIME / ANY_INT = TIME`

### 11.3 Comparison Operators

| Operator | Meaning |
|---|---|
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal |
| `>=` | Greater than or equal |
| `=` | Equal to |
| `<>` | Not equal to |

Comparable types: numeric (same group), BOOL, BYTE/WORD/DWORD, CHAR, STRING (same type only), DATE, TIME, TOD, DT.

### 11.4 Logical Operators

| Operation | Operator | Operand Types |
|---|---|---|
| Negation | `NOT` | ANY_BIT |
| AND | `AND` / `&` | ANY_BIT |
| Exclusive OR | `XOR` | ANY_BIT |
| OR | `OR` | ANY_BIT |

Where `ANY_BIT` = BOOL, BYTE, WORD, DWORD, LWORD.

### 11.5 Expression Rules

- Same-priority operators evaluate left-to-right
- Unary minus: `a * (-b)` — NOT `a * -b` (operators must not follow directly)
- Parentheses override priority

---

## 12. Value Assignments

### 12.1 Basic Syntax

```scl
#variable := expression;
```

### 12.2 Elementary Types

```scl
#statCounter := 17;
#tempSetpoint := 100.5;
#running := TRUE;
#tempDuration := T#1h20m10s;
#tempDate := D#2024-01-15;
```

### 12.3 STRUCT / UDT

```scl
// Complete structure assignment (types must match)
#outputData := #inputData;

// Component access
#outputData.voltage := #inputData.voltage;
#tempValue := #inputData.resistance;
#outputData.resistance := 4.5;
```

### 12.4 ARRAY

```scl
// Complete array assignment (types and limits must match)
#setpoints := #processValues;

// Element access
#setpoints[3] := 100.0;
#tempVal := #processValues[#statIndex];
```

### 12.5 STRING

```scl
#statMessage := 'Error in module 1';
#tempName := #config.deviceName;
```

---

## 13. Control Statements

### 13.1 IF Statement

```scl
IF #condition THEN
    // statements
ELSIF #otherCondition THEN
    // statements
ELSE
    // statements
END_IF;
```

- ELSIF and ELSE are optional
- Any number of ELSIF branches allowed
- Note: `ELSIF` — NOT `ELSEIF`
- **Must end with semicolon after `END_IF`**

### 13.2 CASE Statement

```scl
CASE #statState OF
    0:  // Idle
        #running := FALSE;
    1:  // Starting
        #running := TRUE;
    2, 3:  // Running or Stopping (multiple values)
        #tempActive := TRUE;
    10..19:  // Error range
        #error := TRUE;
    ELSE
        #statState := 0;
        #error := TRUE;
END_CASE;
```

**CRITICAL RULES**:
- Selection expression must evaluate to INT or DINT
- **Case labels MUST be integer literals** (0, 1, 2, 99) — variables, constants, and symbolic names are NOT allowed as labels
- Each value may only appear once
- CASE MUST always have an ELSE branch
- **Must end with semicolon after `END_CASE`**

### 13.3 FOR Statement

```scl
FOR #tempIndex := 1 TO 50 BY 2 DO
    IF #dataArray[#tempIndex] = 0 THEN
        EXIT;
    END_IF;
END_FOR;
```

- Control variable must be local INT or DINT
- If `BY` is omitted, increment defaults to +1
- Initial, final, and increment values evaluated once at loop start
- **Do NOT modify the control variable inside the loop body**
- **Must end with semicolon after `END_FOR`**

### 13.4 WHILE Statement

```scl
#tempIndex := 1;
WHILE #tempIndex <= 50 AND #dataArray[#tempIndex] <> 0 DO
    #tempIndex := #tempIndex + 1;
END_WHILE;
```

- Condition checked **before** each iteration
- May execute zero times
- **Must end with semicolon after `END_WHILE`**

### 13.5 REPEAT Statement

```scl
#tempIndex := 0;
REPEAT
    #tempIndex := #tempIndex + 1;
UNTIL #tempIndex > 50 OR #dataArray[#tempIndex] = 0
END_REPEAT;
```

- Condition checked **after** each iteration
- Executes at least once
- Exits when condition becomes TRUE
- **Must end with semicolon after `END_REPEAT`**

### 13.6 CONTINUE and EXIT

```scl
// CONTINUE — skip to next iteration
FOR #tempI := 1 TO 100 DO
    IF #values[#tempI] < 0 THEN
        CONTINUE;
    END_IF;
    #tempSum := #tempSum + #values[#tempI];
END_FOR;

// EXIT — break out of innermost loop
FOR #tempI := 1 TO 100 DO
    IF #values[#tempI] = #searchKey THEN
        #statFoundIndex := #tempI;
        EXIT;
    END_IF;
END_FOR;
```

### 13.7 RETURN Statement

```scl
RETURN;
```

Exits the current block and returns to the calling block.

---

## 14. Calling Functions and Function Blocks

### 14.1 Calling FBs from OB1 (with separate instance DB)

**Use the instance DB name ONLY — NOT the FB name:**

```scl
// CORRECT — instance DB name only:
"InstMotor1"(start := "TagStartMotor1",
             stop := "TagStopMotor1",
             speedSetpoint := 1500.0);

// WRONG — "FBName"."InstDBName" does NOT compile:
"ControlMotor"."InstMotor1"(start := "TagStartMotor1");

// WRONG — FB name without instance DB:
"ControlMotor"(start := "TagStartMotor1");
```

**Reading output values** — access via instance DB:
```scl
"TagMotor1Running" := "InstMotor1".running;
"TagMotor1Speed" := "InstMotor1".currentSpeed;
```

### 14.2 Calling FBs as Multi-Instance (inside another FB)

When an FB instance is declared in a parent FB's VAR section:

```scl
// In parent FB's VAR section:
VAR
    instMotor1 : "ControlMotor";
END_VAR

// In parent FB's code — use # prefix:
#instMotor1(start := #startSignal,
            stop := #stopSignal,
            speedSetpoint := #setpoint);

// Reading outputs:
#tempRunning := #instMotor1.running;
```

### 14.3 Calling Functions (FC)

```scl
// Capture return value:
#tempScaled := "ScaleAnalog"(rawValue := #inputRaw,
                              minScale := 0.0,
                              maxScale := 100.0);

// In an expression:
#tempResult := #offset + "ScaleAnalog"(rawValue := #inputRaw,
                                        minScale := 0.0,
                                        maxScale := 100.0);

// VOID function (no return value):
"LogEvent"(eventCode := 100, severity := 2);
```

**Rules**:
- **All** parameters must be supplied (input, output, in/out)
- Use `:=` for inputs, `=>` for outputs in the call
- Data types must match

### 14.4 Named Parameter Syntax

```scl
// Inputs use :=
// Outputs use => (for FCs with VAR_OUTPUT)
#tempResult := "Calculate"(inputA := 10,
                            inputB := 20,
                            resultB => #tempSecondResult);
```

### 14.5 EN and ENO (Enable In / Enable Out)

Every FB and FC has implicit parameters:
- **EN** (input, BOOL): If FALSE, block is not executed
- **ENO** (output, BOOL): TRUE if block executed without error

```scl
// Conditional execution:
"InstMotor1"(EN := #enableMotors,
             start := #startSignal);

// Check for errors:
"InstMotor1"(start := #startSignal);
IF "InstMotor1".ENO THEN
    // Block executed successfully
END_IF;
```

---

## 15. Type Conversion Functions

### 15.1 Numeric Conversions

| Function | Input → Output | Notes |
|---|---|---|
| `INT_TO_REAL` | INT → REAL | Value preserved |
| `INT_TO_DINT` | INT → DINT | Sign-extended |
| `DINT_TO_REAL` | DINT → REAL | Precision may be lost |
| `DINT_TO_INT` | DINT → INT | Overflow possible |
| `REAL_TO_INT` | REAL → INT | Rounds, overflow possible |
| `REAL_TO_DINT` | REAL → DINT | Rounds, overflow possible |
| `REAL_TO_LREAL` | REAL → LREAL | Value preserved |
| `LREAL_TO_REAL` | LREAL → REAL | Precision lost |

### 15.2 Bit/Word Conversions

| Function | Input → Output |
|---|---|
| `BOOL_TO_BYTE` | BOOL → BYTE |
| `BOOL_TO_WORD` | BOOL → WORD |
| `BYTE_TO_WORD` | BYTE → WORD |
| `BYTE_TO_DWORD` | BYTE → DWORD |
| `WORD_TO_DWORD` | WORD → DWORD |
| `WORD_TO_INT` | WORD → INT (bit reinterpret) |
| `INT_TO_WORD` | INT → WORD (bit reinterpret) |
| `DWORD_TO_DINT` | DWORD → DINT (bit reinterpret) |
| `DINT_TO_DWORD` | DINT → DWORD (bit reinterpret) |
| `DWORD_TO_REAL` | DWORD → REAL (bit reinterpret) |
| `REAL_TO_DWORD` | REAL → DWORD (bit reinterpret) |

### 15.3 Rounding and Truncating

| Function | Input | Output | Description |
|---|---|---|---|
| `ROUND` | REAL | DINT | Rounds to nearest integer |
| `TRUNC` | REAL | DINT | Truncates (drops fractional part) |

```scl
#tempRounded := ROUND(3.56);   // = 4
#tempTruncated := TRUNC(3.56); // = 3
```

---

## 16. Numeric Standard Functions

### 16.1 General Functions

| Function | Input | Output | Description |
|---|---|---|---|
| `ABS` | ANY_NUM | ANY_NUM | Absolute value |
| `SQR` | ANY_NUM | REAL | Square |
| `SQRT` | ANY_NUM | REAL | Square root |
| `MIN` | ANY_NUM, ANY_NUM | ANY_NUM | Minimum of two values |
| `MAX` | ANY_NUM, ANY_NUM | ANY_NUM | Maximum of two values |
| `LIMIT` | MN, IN, MX | ANY_NUM | Clamp value to range |

```scl
#tempAbs := ABS(-5);                       // = 5
#tempRoot := SQRT(81.0);                   // = 9.0
#tempClamped := LIMIT(MN := 0.0, IN := #inputVal, MX := 100.0);
```

### 16.2 Logarithmic Functions

| Function | Description |
|---|---|
| `EXP(x)` | e^x |
| `LN(x)` | Natural logarithm |
| `LOG(x)` | Base-10 logarithm |

### 16.3 Trigonometric Functions (radians)

| Function | Description |
|---|---|
| `SIN(x)` | Sine |
| `COS(x)` | Cosine |
| `TAN(x)` | Tangent |
| `ASIN(x)` | Arc sine |
| `ACOS(x)` | Arc cosine |
| `ATAN(x)` | Arc tangent |

### 16.4 Bit String Functions

| Function | Description |
|---|---|
| `ROL(IN := value, N := count)` | Rotate left by N bits |
| `ROR(IN := value, N := count)` | Rotate right by N bits |
| `SHL(IN := value, N := count)` | Shift left (fill with 0) |
| `SHR(IN := value, N := count)` | Shift right (fill with 0) |

Valid types for IN: BYTE, WORD, DWORD, LWORD.

---

## 17. REGION Blocks

TIA Portal supports REGION blocks for organizing code into collapsible sections:

```scl
REGION IO Mapping
    #tempStartCmd := #start AND NOT #stop;
    #tempFeedback := #feedbackRun;
END_REGION

REGION State Machine
    CASE #statState OF
        0:  // Idle
            // ...
        1:  // Running
            // ...
        ELSE
            #statState := 0;
    END_CASE;
END_REGION

REGION Output Mapping
    #running := (#statState = 2);
    #currentSpeed := #statLastSpeed;
END_REGION
```

**Recommended REGION structure for FBs**:
1. IO Mapping — read inputs into local variables
2. State Machine / Main Logic
3. Alarm/Error Handling
4. Output Mapping — write results to outputs

---

## 18. IEC Timers, Counters, and Edge Detection

These are declared as multi-instances in VAR (static) — **NEVER in VAR_TEMP**.

### 18.1 IEC Timers

| Type | Description |
|---|---|
| `TON` | On-delay timer — output ON after delay |
| `TOF` | Off-delay timer — output stays ON for delay after input goes OFF |
| `TP` | Pulse timer — output ON for fixed duration |

```scl
VAR
    instOnDelay : TON;
    instOffDelay : TOF;
    instPulse : TP;
END_VAR

// TON — on-delay: output Q goes TRUE after PT elapses while IN stays TRUE
#instOnDelay(IN := #startCondition, PT := T#2s);
IF #instOnDelay.Q THEN
    // 2 seconds have elapsed with startCondition TRUE
END_IF;

// TOF — off-delay: output Q stays TRUE for PT after IN goes FALSE
#instOffDelay(IN := #runSignal, PT := T#5s);

// TP — pulse: output Q goes TRUE for exactly PT duration on rising edge of IN
#instPulse(IN := #triggerSignal, PT := T#500ms);
```

**Timer outputs**:
- `.Q` (Bool) — timer output status
- `.ET` (Time) — elapsed time

### 18.2 IEC Counters

| Type | Description |
|---|---|
| `CTU` | Count up |
| `CTD` | Count down |
| `CTUD` | Count up/down |

```scl
VAR
    instCounter : CTU;
END_VAR

#instCounter(CU := #countPulse, R := #resetCounter, PV := 100);
IF #instCounter.Q THEN
    // Counter reached preset value
END_IF;
#tempCurrentCount := #instCounter.CV;
```

### 18.3 Edge Detection

| Type | Description |
|---|---|
| `R_TRIG` | Rising edge (FALSE → TRUE) |
| `F_TRIG` | Falling edge (TRUE → FALSE) |

```scl
VAR
    instStartEdge : R_TRIG;
    instStopEdge : F_TRIG;
END_VAR

#instStartEdge(CLK := #start);
IF #instStartEdge.Q THEN
    // Rising edge detected on #start
    #statState := 1;
END_IF;

#instStopEdge(CLK := #runFeedback);
IF #instStopEdge.Q THEN
    // Falling edge detected — motor stopped unexpectedly
    #error := TRUE;
END_IF;
```

---

## 19. Complete Source File Example

```scl
// ============================================
// UDT — Reusable motor configuration type
// ============================================
TYPE "typeMotorConfig"
VERSION : 0.1
STRUCT
    maxSpeed : Real := 1500.0;
    rampUpTime : Time := T#3s;
    rampDownTime : Time := T#2s;
END_STRUCT;
END_TYPE

// ============================================
// FC — Stateless utility function
// ============================================
FUNCTION "ScaleAnalog" : Real
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

VAR_INPUT
    rawValue : Int;
    minScale : Real;
    maxScale : Real;
END_VAR

VAR_TEMP
    tempNormalized : Real;
END_VAR

BEGIN
    #tempNormalized := INT_TO_REAL(#rawValue) / 27648.0;
    #ScaleAnalog := #tempNormalized * (#maxScale - #minScale) + #minScale;
END_FUNCTION

// ============================================
// FB — Stateful motor control block
// ============================================
FUNCTION_BLOCK "ControlMotor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

VAR_INPUT
    start : Bool;
    stop : Bool;
    config : "typeMotorConfig";
END_VAR

VAR_OUTPUT
    running : Bool;
    error : Bool;
    status : Word;
END_VAR

VAR
    statState : Int;
    instStartDelay : TON;
    instStartEdge : R_TRIG;
END_VAR

VAR_TEMP
    tempStartCmd : Bool;
END_VAR

BEGIN
    REGION IO Mapping
        #instStartEdge(CLK := #start);
        #tempStartCmd := #instStartEdge.Q AND NOT #stop;
    END_REGION

    REGION State Machine
        CASE #statState OF
            0:  // Idle
                #running := FALSE;
                #status := 16#7000;
                IF #tempStartCmd THEN
                    #statState := 1;
                END_IF;
            1:  // Start Delay
                #instStartDelay(IN := TRUE, PT := #config.rampUpTime);
                IF #instStartDelay.Q THEN
                    #statState := 2;
                    #instStartDelay(IN := FALSE, PT := #config.rampUpTime);
                END_IF;
            2:  // Running
                #running := TRUE;
                #status := 16#0000;
                IF #stop THEN
                    #statState := 0;
                END_IF;
            ELSE
                #statState := 0;
                #error := TRUE;
                #status := 16#8001;
        END_CASE;
    END_REGION

    REGION Output Mapping
        #running := (#statState = 2);
    END_REGION
END_FUNCTION_BLOCK

// ============================================
// Global DB — Configuration data
// ============================================
DATA_BLOCK "Configuration"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN

STRUCT
    motor1Config : "typeMotorConfig";
    motor2Config : "typeMotorConfig";
    systemEnabled : Bool := TRUE;
END_STRUCT;

BEGIN
END_DATA_BLOCK

// ============================================
// Instance DB — One per motor instance
// ============================================
DATA_BLOCK "InstMotor1"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlMotor"

BEGIN
END_DATA_BLOCK

DATA_BLOCK "InstMotor2"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
NON_RETAIN
"ControlMotor"

BEGIN
END_DATA_BLOCK

// ============================================
// OB1 Main — Last in source file
// ============================================
ORGANIZATION_BLOCK "Main"
TITLE = "Main Program Sweep"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1

VAR_TEMP
    tempStatus : Int;
END_VAR

BEGIN
    // Call each FB using its instance DB name ONLY
    "InstMotor1"(start := "TagStartMotor1",
                 stop := "TagStopMotor1",
                 config := "Configuration".motor1Config);

    "InstMotor2"(start := "TagStartMotor2",
                 stop := "TagStopMotor2",
                 config := "Configuration".motor2Config);
END_ORGANIZATION_BLOCK
```

---

## 20. Key Differences from S7-300/S7-400

This reference is written for S7-1200/S7-1500. If you encounter legacy documentation, be aware:

| Feature | S7-300/400 (Legacy) | S7-1200/1500 (Current) |
|---|---|---|
| Block addressing | Absolute numbers (`FB10`, `DB20`) | Symbolic names (`"ControlMotor"`) |
| Memory access | Absolute (`M0.0`, `I0.0`, `Q1.1`) | Symbolic tags only |
| DB access | Absolute (`DB20.DW3`) | Symbolic (`"DBName".fieldName`) |
| FB calls | `FB10.DB20(...)` | `"InstDBName"(...)` — instance DB name only |
| Timers | `S_ODT`, `S_PULSE`, `S_PEXT` with S5TIME | IEC: `TON`, `TOF`, `TP` with TIME |
| Counters | `S_CU`, `S_CD`, `S_CUD` with C_NO | IEC: `CTU`, `CTD`, `CTUD` |
| Data types | INT, DINT, REAL, S5TIME | + SINT, USINT, UINT, UDINT, LINT, ULINT, LREAL, LWORD, LTIME, DTL, WSTRING, VARIANT |
| Block access | Standard (fixed structure) | Optimized (symbolic, no fixed addresses) |
| OB start info | 20-byte ARRAY required | Not required |
| GOTO | Available | Deprecated/removed |
| Code folding | Not available | REGION/END_REGION blocks |
| Type flexibility | ANY, POINTER | VARIANT (preferred) |

**Do NOT use any S7-300/400 patterns** — they will cause compile errors in TIA Portal with S7-1200/1500.
