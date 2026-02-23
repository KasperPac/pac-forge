# SCL (Structured Control Language) Complete Reference

> Extracted from "Structured Control Language (SCL) for S7-300/S7-400 Programming" (6ES7811-1CA02-8BA0).
> The SCL language fundamentals apply to S7-1500 in TIA Portal V18 as well, with some modernization.

---

## 1. Character Set and Lexical Rules

### 1.1 Permitted Characters

- **Letters**: A-Z, a-z (case-insensitive for keywords and identifiers)
- **Digits**: 0-9
- **Space** (ASCII 32) and all control characters (ASCII 0-31) including end-of-line (ASCII 13)
- **Special characters with meaning**: `+ - * / = < > [ ] ( ) . , : ; $ # " ' { }`

### 1.2 Free Format

SCL source is free-format: you can insert spaces, tabs, page breaks, and comments between rule blocks (tokens). However, within a single token (e.g., an identifier or number), no whitespace is allowed.

### 1.3 Case Insensitivity

All keywords, predefined names, user-defined names, and symbol table names are **not** case-sensitive. `Anna` and `AnNa` are identical.

---

## 2. Identifiers

### 2.1 Rules

An identifier is a name assigned to an SCL language object (constant, variable, function, block).

```
IDENTIFIER ::= (Letter | '_') { Letter | Digit | '_' }
```

- First character must be a letter or underscore `_`
- Maximum length: **24 characters**
- Must not be a reserved keyword
- Case-insensitive

**Valid**: `x`, `y12`, `Sum`, `Temperature`, `C_CONTROLLER3`, `_A_FIELD`, `_100_3_3_10`
**Invalid**: `4th` (starts with digit), `Array` (keyword), `S Value` (contains space)

### 2.2 Symbols (from STEP 7 symbol table)

Symbols defined in the STEP 7 symbol table can use additional characters if enclosed in double quotes:

```
"Input 1.1"
"Controller.B1&U2"
```

---

## 3. Reserved Words (Keywords)

All keywords are case-insensitive. The complete list:

### Block Structure Keywords

| Keyword | Purpose |
|---|---|
| `ORGANIZATION_BLOCK` | Begins an OB |
| `END_ORGANIZATION_BLOCK` | Ends an OB |
| `FUNCTION_BLOCK` | Begins an FB |
| `END_FUNCTION_BLOCK` | Ends an FB |
| `FUNCTION` | Begins an FC |
| `END_FUNCTION` | Ends an FC |
| `DATA_BLOCK` | Begins a DB |
| `END_DATA_BLOCK` | Ends a DB |
| `TYPE` | Begins a UDT |
| `END_TYPE` | Ends a UDT |
| `BEGIN` | Starts code/assignment section |

### Declaration Keywords

| Keyword | Purpose |
|---|---|
| `VAR` | Static variables subsection |
| `VAR_TEMP` | Temporary variables subsection |
| `VAR_INPUT` | Input parameters subsection |
| `VAR_OUTPUT` | Output parameters subsection |
| `VAR_IN_OUT` | In/out parameters subsection |
| `END_VAR` | Ends any VAR subsection |
| `CONST` | Constants subsection |
| `END_CONST` | Ends constants subsection |
| `LABEL` | Jump labels subsection |
| `END_LABEL` | Ends jump labels subsection |
| `STRUCT` | Begins structure definition |
| `END_STRUCT` | Ends structure definition |

### Data Type Keywords

| Keyword | Purpose |
|---|---|
| `BOOL` | Boolean (1 bit) |
| `BYTE` | Byte (8 bits) |
| `WORD` | Word (16 bits) |
| `DWORD` | Double word (32 bits) |
| `CHAR` | Single character (8 bits) |
| `INT` | Integer (16 bits) |
| `DINT` | Double integer (32 bits) |
| `REAL` | IEEE floating point (32 bits) |
| `S5TIME` | S5 time format (16 bits) |
| `TIME` | IEC time (32 bits) |
| `DATE` | IEC date (16 bits) |
| `TIME_OF_DAY` / `TOD` | Time of day (32 bits) |
| `DATE_AND_TIME` / `DT` | Date and time (64 bits) |
| `STRING` | Character string (up to 254 chars) |
| `ARRAY` | Array type |
| `VOID` | No return value (for functions) |
| `ANY` | Any data type (parameter type) |
| `POINTER` | Pointer (parameter type, 6 bytes) |
| `TIMER` | Timer parameter type |
| `COUNTER` | Counter parameter type |
| `BLOCK_FB` | FB parameter type |
| `BLOCK_FC` | FC parameter type |
| `BLOCK_DB` | DB parameter type |
| `BLOCK_SDB` | SDB parameter type |
| `NIL` | Null/zero pointer |

### Control Flow Keywords

| Keyword | Purpose |
|---|---|
| `IF` | Conditional branch |
| `THEN` | Follows IF/ELSIF condition |
| `ELSIF` | Alternative condition |
| `ELSE` | Default branch |
| `END_IF` | Ends IF statement |
| `CASE` | Selection by value |
| `OF` | Follows CASE expression / ARRAY type |
| `END_CASE` | Ends CASE statement |
| `FOR` | Counted loop |
| `TO` | Final value in FOR |
| `BY` | Increment in FOR |
| `DO` | Follows FOR/WHILE condition |
| `END_FOR` | Ends FOR loop |
| `WHILE` | Condition-first loop |
| `END_WHILE` | Ends WHILE loop |
| `REPEAT` | Condition-last loop |
| `UNTIL` | Break condition for REPEAT |
| `END_REPEAT` | Ends REPEAT loop |
| `CONTINUE` | Skip to next loop iteration |
| `EXIT` | Exit current loop |
| `GOTO` | Jump to label |
| `RETURN` | Exit current block |

### Operator Keywords

| Keyword | Purpose |
|---|---|
| `AND` / `&` | Logical AND |
| `OR` | Logical OR |
| `XOR` | Logical exclusive OR |
| `NOT` | Logical negation |
| `MOD` | Modulus (remainder) |
| `DIV` | Integer division |

### Other Reserved Words

| Keyword | Purpose |
|---|---|
| `TRUE` | Boolean constant (1) |
| `FALSE` | Boolean constant (0) |
| `EN` | Implicit input parameter (enable) |
| `ENO` | Implicit output parameter (enable out) |
| `OK` | Error flag |

---

## 4. Standard Identifiers (Block Keywords)

Used for absolute addressing of blocks:

| Mnemonic | Identifies | Number Range |
|---|---|---|
| `DB`x | Data Block | 0-65533 |
| `FB`x | Function Block | 0-65533 |
| `FC`x | Function | 0-65533 |
| `OB`x | Organization Block | 0-65533 |
| `SDB`x | System Data Block | 0-65533 |
| `SFC`x | System Function | 0-65533 |
| `SFB`x | System Function Block | 0-65533 |
| `T`x | Timer | 0-65533 |
| `UDT`x | User-Defined Data Type | 0-65533 |
| `C`x (IEC) / `Z`x (SIMATIC) | Counter | 0-65533 |

---

## 5. Address Identifiers (CPU Memory Areas)

### 5.1 Memory Prefixes

| SIMATIC | IEC | Memory Area |
|---|---|---|
| `E` | `I` | Input (process image) |
| `A` | `Q` | Output (process image) |
| `M` | `M` | Bit memory (Merker) |
| `PE` | `PI` | Peripheral input (direct I/O) |
| `PA` | `PQ` | Peripheral output (direct I/O) |

### 5.2 Size Prefixes

| Prefix | Size | Data Type |
|---|---|---|
| `X` (or none for bit) | Bit | BOOL |
| `B` | Byte | BYTE |
| `W` | Word | WORD |
| `D` | Double word | DWORD |

### 5.3 Address Format

```
MemoryPrefix [SizePrefix] ByteAddress [.BitAddress]
```

**IEC Examples**:
- `I1.0` - Input bit 1.0
- `IB10` - Input byte 10
- `IW20` - Input word 20
- `ID0` - Input double word 0
- `Q1.1` - Output bit 1.1
- `QB4` - Output byte 4
- `QW4` - Output word 4
- `MW10` - Memory word 10
- `MD0` - Memory double word 0
- `M0.0` - Memory bit 0.0
- `PIW256` - Peripheral input word 256
- `PQW5` - Peripheral output word 5

### 5.4 Data Block Addresses

```
DBidentifier.D [SizePrefix] Address
```

Examples:
- `DB20.DW3` - Data block 20, data word at byte 3
- `DB11.DX13.1` - Data block 11, bit 13.1
- `DB101.DB10` - Data block 101, data byte at byte 10

---

## 6. Number Formats

### 6.1 Integers

- No commas or spaces allowed
- Underscore `_` for visual separation
- Optional `+` or `-` sign
- Data type INT: -32768 to 32767
- Data type DINT: -2147483648 to 2147483647

```
0     1     +1     -1     743     -5280     600_00     -32_211
```

### 6.2 Binary / Octal / Hexadecimal Integers

```
2#1111          // Binary, decimal 15
8#17            // Octal, decimal 15
16#F            // Hexadecimal, decimal 15
2#0101          // Binary, decimal 5
16#1A2B         // Hexadecimal
```

### 6.3 Real Numbers

Must contain either a decimal point or an exponent (or both). Decimal point must be between two digits.

```
0.0     1.0     -0.2     827.602     50000.0     -0.000743     12.3
3.0E+10     3e+10     0.3E+11     30.0E+9     4e2     40_123E10
```

**Invalid**: `1.` (must have digit after point), `.3333` (must have digit before point)

---

## 7. Data Types

### 7.1 Elementary Data Types

| Type | Keyword | Bits | Value Range |
|---|---|---|---|
| Bit | `BOOL` | 1 | `FALSE`, `TRUE` (0, 1) |
| Byte | `BYTE` | 8 | Bit combination (no numeric range) |
| Word | `WORD` | 16 | Bit combination (no numeric range) |
| Double Word | `DWORD` | 32 | Bit combination (no numeric range) |
| Character | `CHAR` | 8 | Extended ASCII character set |
| Integer | `INT` | 16 | -32768 to 32767 |
| Double Integer | `DINT` | 32 | -2147483648 to 2147483647 |
| Real | `REAL` | 32 | +-1.175495E-38 to +-3.402822E+38, 0.0 |
| S5 Time | `S5TIME` | 16 | T#0H_0M_0S_10MS to T#2H_46M_30S |
| IEC Time | `TIME` | 32 | -T#24D_20H_31M_23S_647MS to T#24D_20H_31M_23S_647MS |
| Date | `DATE` | 16 | D#1990-01-01 to D#2168-12-31 |
| Time of Day | `TIME_OF_DAY` / `TOD` | 32 | TOD#0:0:0 to TOD#23:59:59.999 |

### 7.2 Complex Data Types

| Type | Keyword | Description |
|---|---|---|
| Date and Time | `DATE_AND_TIME` / `DT` | 64 bits (8 bytes), BCD-coded date + time |
| String | `STRING` | Up to 254 characters (256 bytes incl. 2-byte header) |
| Array | `ARRAY` | Fixed-size collection of same-type elements, max 6 dimensions |
| Structure | `STRUCT` | Group of named components of any type |

### 7.3 User-Defined Data Types (UDT)

Defined with `TYPE ... END_TYPE`, globally available. Used like any other data type.

### 7.4 Parameter Types

| Type | Size | Usage |
|---|---|---|
| `TIMER` | 2 bytes | Timer identifier (VAR_INPUT only) |
| `COUNTER` | 2 bytes | Counter identifier (VAR_INPUT only) |
| `BLOCK_FB` | 2 bytes | Function block identifier |
| `BLOCK_FC` | 2 bytes | Function identifier |
| `BLOCK_DB` | 2 bytes | Data block identifier |
| `BLOCK_SDB` | 2 bytes | System data block identifier |
| `ANY` | 10 bytes | Any data type |
| `POINTER` | 6 bytes | Memory area pointer |

### 7.5 Implicit Data Type Conversion Order

Within `ANY_BIT`: `BOOL` -> `BYTE` -> `WORD` -> `DWORD`
Within `ANY_NUM`: `INT` -> `DINT` -> `REAL`

---

## 8. Constants and Literals

### 8.1 Symbolic Constants (CONST block)

```
CONST
    FIGURE   := 10;
    TIME1    := TIME#1D_1H_10M_22S.2MS;
    NAME     := 'SIEMENS';
    FIG2     := 2 * 5 + 10 * 4;
    FIG3     := 3 + NUMBER2;
END_CONST
```

Expressions using `+`, `-`, `*`, `/`, `DIV`, `MOD` are allowed.

### 8.2 Integer Literals

```
1000                    // Decimal
+1_120_200              // Decimal with separator
-666_999_400_311        // Negative decimal
2#1111                  // Binary (= 15)
8#17                    // Octal (= 15)
16#F                    // Hexadecimal (= 15)
16#1A2B                 // Hexadecimal
```

### 8.3 Real Number Literals

```
0.0     1.0     -0.2     827.602
3.0E+10     3e+10     4e2     30.0E+9
```

### 8.4 Character Literals

Single character in single quotes:
```
'B'          // Character B
'$41'        // Hex representation of 'A'
'$20'        // Space character
```

### 8.5 String Literals

Up to 254 characters in single quotes:
```
'RED'
'7500 Karlsruhe'
'DM19.95'
'The correct answer is:'
```

**Escape sequences** using `$`:
| Code | Meaning |
|---|---|
| `$$` | Dollar sign `$` |
| `$'` | Single quote `'` |
| `$P` or `$p` | Page break (form feed) |
| `$L` or `$l` | Line feed |
| `$R` or `$r` | Carriage return |
| `$T` or `$t` | Tab |
| `$hh` | Hex ASCII code (e.g., `$41` = 'A') |

**String breaks** for multi-line strings:
```
'The FB$>
$<converts'     // Result: 'The FBconverts'
```

### 8.6 BOOL Literals

```
TRUE     FALSE
```

### 8.7 Date Literals

```
DATE#1995-11-11
D#1995-05-05
D#1990-01-01
```

Format: `DATE#YYYY-MM-DD` or `D#YYYY-MM-DD`

### 8.8 Time Period Literals

**Simple format** (single time unit):
```
TIME#20.5D              // 20.5 days
TIME#45.12M             // 45.12 minutes
T#300MS                 // 300 milliseconds
```

**Complex format** (multiple time units, order: D, H, M, S, MS):
```
TIME#20D_12H
TIME#20D_10H_25M_10S
TIME#200S_20MS
T#1H_20M_10S_30MS
T#2D_1H_20M_10S_30MS
```

### 8.9 S5TIME Literals

```
S5T#1h30m30s
S5T#1h20m10s
S5TIME#25S
T#1s                    // when used in timer function context
```

Time base is 10ms, 100ms, 1s, or 10s (compiler rounds values accordingly).

### 8.10 Time of Day Literals

```
TIME_OF_DAY#12:12:12.2
TOD#11:11:11.7
TOD#0:0:0
TOD#23:59:59.999
```

Format: `TOD#HH:MM:SS.mmm`

### 8.11 Date and Time Literals

```
DATE_AND_TIME#1995-01-01-12:12:12.2
DT#1995-02-02-11:11:11
DT#1995-10-20-12:20:30.10
```

Format: `DT#YYYY-MM-DD-HH:MM:SS.mmm`

### 8.12 WORD / BYTE Constant Prefixes (used in DBs/UDTs)

```
W#16#FFAA           // WORD hex constant
B#16#FF             // BYTE hex constant
```

---

## 9. SCL Source File Structure

### 9.1 Block Ordering Rules

Called blocks must precede calling blocks in the source file:

1. **UDTs** must precede blocks that use them
2. **DBs with assigned UDT** must follow the UDT
3. **Global DBs** (accessed by all blocks) must precede blocks that access them
4. **FBs** must precede their instance DBs
5. **Instance DBs** for an FB come after the FB
6. **Called FCs/FBs** must precede calling blocks
7. **OB1** (which calls other blocks) comes at the very end

**Ordering example**:
```
UDT -> DB from UDT -> FB3 -> Instance DB for FB3 -> FC5 -> OB1
```

### 9.2 General Block Structure

Every block consists of:
1. Block start keyword + block identifier
2. Block attributes (optional)
3. Declaration section
4. Code section (begins with `BEGIN`, ends with block end keyword)
5. Block end keyword

---

## 10. Block Syntax

### 10.1 Function Block (FB)

```scl
FUNCTION_BLOCK FB10        // or FUNCTION_BLOCK SymbolicName
// Block attributes (optional)
TITLE = 'Block Title'
VERSION : '1.0'
AUTHOR : AuthName
NAME : BlkName
FAMILY : FamName

// Declaration section
VAR_INPUT
    InputParam1 : INT := 0;
    InputParam2 : REAL;
END_VAR

VAR_OUTPUT
    OutputParam1 : BOOL;
END_VAR

VAR_IN_OUT
    InOutParam1 : REAL;
END_VAR

VAR
    StaticVar1 : INT;
    StaticVar2 : ARRAY[1..10] OF REAL;
    LocalInstance1 : FB20;     // Local instance declaration
END_VAR

VAR_TEMP
    TempVar1 : INT;
    TempVar2 : REAL;
END_VAR

CONST
    MY_CONST := 100;
END_CONST

LABEL
    LABEL1, LABEL2;
END_LABEL

BEGIN
    // Code section
    StaticVar1 := InputParam1 * 2;
    OutputParam1 := StaticVar1 > MY_CONST;
END_FUNCTION_BLOCK
```

**Key points**:
- Has its own memory (instance DB)
- Static variables retain values across calls
- Input/output parameter assignment is optional on call
- Requires instance DB when called

### 10.2 Function (FC)

```scl
FUNCTION FC100 : REAL       // Return type after colon
// or FUNCTION FC100 : VOID  // No return value
// Block attributes (optional)

VAR_INPUT
    X1 : REAL;
    X2 : REAL;
END_VAR

VAR_OUTPUT
    Q2 : REAL;
END_VAR

VAR_IN_OUT
    InOut1 : INT;
END_VAR

VAR_TEMP
    TempVar : INT;
END_VAR

CONST
    PI := 3.14159;
END_CONST

BEGIN
    // Must assign return value using function name
    FC100 := SQRT((X2 - X1)**2);
    Q2 := X1 + X2;
END_FUNCTION
```

**Key points**:
- No static memory (no instance DB needed)
- Returns a function value (except VOID)
- Return value assigned by `FunctionName := expression;`
- All parameters must be supplied when called
- VAR declarations are treated as temporary (shifted to temp area during compilation)
- Return type can be any data type except STRUCT and ARRAY

### 10.3 Organization Block (OB)

```scl
ORGANIZATION_BLOCK OB1
// Block attributes (optional)

VAR_TEMP
    HEADER : ARRAY[1..20] OF BYTE;  // 20 bytes for start info (required)
    // Additional temp variables
END_VAR

CONST
    // Optional constants
END_CONST

BEGIN
    // Code section - called by operating system
    FB10.DB10(InputParam1 := 5);
END_ORGANIZATION_BLOCK
```

**Key points**:
- Called by operating system (cyclic, event-driven, etc.)
- Requires minimum 20 bytes of local data for start information
- Only VAR_TEMP, CONST, and LABEL subsections allowed
- No parameters (VAR_INPUT/OUTPUT/IN_OUT not allowed)

### 10.4 Data Block (DB)

**With STRUCT declaration**:
```scl
DATA_BLOCK DB20
// Block attributes (optional)

STRUCT
    VALUE : ARRAY[1..100] OF INT := 100(1);
    MARKER : BOOL := TRUE;
    S_WORD : WORD := W#16#FFAA;
    S_BYTE : BYTE := B#16#FF;
    S_TIME : S5TIME := S5T#1h30m30s;
    DIGIT : INT := 1;
    DIGIT1 : STRUCT
        DIGIT2 : INT := 256;
    END_STRUCT;
END_STRUCT

BEGIN
    // Assignment section (override initialization values)
    VALUE[1] := 5;
    VALUE[5] := -1;
END_DATA_BLOCK
```

**With UDT assignment**:
```scl
DATA_BLOCK DB20
UDT1               // Assign UDT as template

BEGIN
    // Assignment section
END_DATA_BLOCK
```

**Instance DB (for FB)**:
```scl
// Instance DBs are automatically generated from the FB declaration
// They follow the FB in the source file ordering
DATA_BLOCK DB10
FB10                // Assign to FB10

BEGIN
END_DATA_BLOCK
```

### 10.5 User-Defined Data Type (UDT)

```scl
TYPE UDT10                   // or TYPE SymbolicName
STRUCT
    BIPOL_1 : INT;
    BIPOL_2 : WORD := W#16#AFAL;
    BIPOL_3 : BYTE := B#16#FF;
    BIPOL_5 : INT := 25;
    S_TIME  : S5TIME := S5T#1h20m10s;
    READING : STRUCT
        BIPOLAR_10V      : REAL;
        UNIPOLAR_4_20MA  : REAL;
    END_STRUCT;
END_STRUCT
END_TYPE
```

**Usage in blocks**:
```scl
VAR
    MEAS_RANGE : UDT10;       // or symbolic UDT name
END_VAR
```

---

## 11. Block Attributes

Placed after block identifier, before declaration section:

```scl
FUNCTION_BLOCK FB10
TITLE = 'Average Calculator'
VERSION : '2.1'
KNOW_HOW_PROTECT
AUTHOR : AUT1
NAME : B12
FAMILY : ANALOG
{S7_m_c := 'true'; S7_blockview := 'big'}
```

| Attribute | Syntax | Description |
|---|---|---|
| `TITLE` | `TITLE = 'text'` | Block title (printable chars) |
| `VERSION` | `VERSION : 'major.minor'` | Version number |
| `KNOW_HOW_PROTECT` | `KNOW_HOW_PROTECT` | Protects block from viewing |
| `AUTHOR` | `AUTHOR : name` | Author (max 8 chars) |
| `NAME` | `NAME : name` | Block name (max 8 chars) |
| `FAMILY` | `FAMILY : name` | Block family (max 8 chars) |

### System Attributes for Blocks

```scl
{S7_m_c := 'true'; S7_blockview := 'big'}
```

| Attribute | Values | Block Types |
|---|---|---|
| `S7_m_c` | `true`, `false` | FB |
| `S7_tasklist` | task names | FB, FC |
| `S7_blockview` | `big`, `small` | FB, FC |

### System Attributes for Parameters

Placed in VAR_INPUT/OUTPUT/IN_OUT before the declaration:

```scl
VAR_INPUT
    in1 {S7_server := 'alarm_archiv'; S7_a_type := 'ar_send'} : DWORD;
END_VAR
```

---

## 12. Declaration Section

### 12.1 Declaration Subsections by Block Type

| Subsection | Syntax | FB | FC | OB | DB | UDT |
|---|---|---|---|---|---|---|
| Constants | `CONST ... END_CONST` | Yes | Yes | Yes | - | - |
| Jump labels | `LABEL ... END_LABEL` | Yes | Yes | Yes | - | - |
| Temp variables | `VAR_TEMP ... END_VAR` | Yes | Yes | Yes | - | - |
| Static variables | `VAR ... END_VAR` | Yes | Yes* | - | - | - |
| Input params | `VAR_INPUT ... END_VAR` | Yes | Yes | - | - | - |
| Output params | `VAR_OUTPUT ... END_VAR` | Yes | Yes | - | - | - |
| In/out params | `VAR_IN_OUT ... END_VAR` | Yes | Yes | - | - | - |
| Structure | `STRUCT ... END_STRUCT` | - | - | - | Yes | Yes |

*In FCs, `VAR ... END_VAR` declarations are shifted to the temporary area during compilation.

**No fixed order** for subsections. Each subsection may appear only **once**.

### 12.2 Variable Declaration Syntax

```scl
VariableName : DataType [:= InitialValue] ;
// or multiple variables of same type:
Var1, Var2, Var3 : INT;
```

**Note**: Initialization of a list (`A1, A2, A3 : INT := 5`) is **not** possible. Variables must be initialized individually.

### 12.3 Initialization Rules

| Data Category | Initialization |
|---|---|
| Static Variables (FB) | Possible |
| Temporary Variables | Not possible |
| Input Parameters (FB) | Possible |
| Output Parameters (FB) | Possible |
| In/Out Parameters | Not possible |
| FC Parameters | Not possible |

### 12.4 Array Initialization

```scl
VAR
    // Simple array init
    VALUES : ARRAY[1..10] OF INT := 10(0);       // 10 elements, all 0

    // 2D array init
    CTRL : ARRAY[1..4, 1..4] OF INT :=
        -54, 736, -83, 77,
        -1289, 10362, 385, 2,
        60, -37, -7, 103,
        4(60);                                     // Last row: four 60s

    // 2D array with repeat factor
    MATRIX : ARRAY[1..10, 1..100] OF INT := 10(100(0));
END_VAR
```

The repeat factor syntax: `count(value)` - repeats `value` `count` times.

### 12.5 Structure Initialization

```scl
VAR
    GENERATOR : STRUCT
        DATA : REAL := 100.5;
        A1   : INT := 10;
        A2   : STRING[6] := 'FACTOR';
        A3   : ARRAY[1..12] OF REAL := 12(100.0);
    END_STRUCT;
END_VAR
```

### 12.6 Instance Declaration (in FB only)

```scl
VAR
    Supply1            : FB10;
    Supply2, Supply3   : FB100;
    Motor1             : Motor;    // Symbolic name from symbol table
END_VAR
```

Local instance data is stored in the parent FB's instance DB. No local-instance-specific initialization.

---

## 13. Comments

### 13.1 Line Comments

```scl
// This is a line comment (max 253 chars including //)
SWITCH := 3;  // Inline comment
```

### 13.2 Block Comments

```scl
(* This is a block comment
   that can span multiple lines *)

(* Nested comments (* like this *) are permitted by default *)
```

**Rules**:
- In data blocks, use `//` notation
- Comments must not be placed inside a symbolic name or constant
- Nesting of block comments is permitted (can be disabled)

---

## 14. Expressions and Operators

### 14.1 Operator Precedence (1 = highest)

| Priority | Operator | Description |
|---|---|---|
| 1 | `( )` | Parentheses |
| 2 | `**` | Exponentiation |
| 3 | `+` `-` `NOT` | Unary plus, unary minus, negation |
| 4 | `*` `/` `DIV` `MOD` | Multiplication, division, int division, modulus |
| 5 | `+` `-` | Addition, subtraction |
| 6 | `<` | Less than |
| 6 | `>` | Greater than |
| 6 | `<=` | Less than or equal |
| 6 | `>=` | Greater than or equal |
| 7 | `=` | Equal |
| 7 | `<>` | Not equal |
| 8 | `AND` / `&` | Logical AND |
| 9 | `XOR` | Logical exclusive OR |
| 10 | `OR` | Logical OR |
| 11 | `:=` | Assignment |

### 14.2 Mathematical Operators

| Operation | Operator | Operand 1 | Operand 2 | Result |
|---|---|---|---|---|
| Exponent | `**` | ANY_NUM | INT | REAL |
| Unary plus | `+` | ANY_NUM | - | ANY_NUM |
| Unary minus | `-` | ANY_NUM | - | ANY_NUM |
| Multiply | `*` | ANY_NUM | ANY_NUM | ANY_NUM |
| Divide | `/` | ANY_NUM | ANY_NUM | ANY_NUM |
| Int division | `DIV` | ANY_INT | ANY_INT | ANY_INT |
| Modulus | `MOD` | ANY_INT | ANY_INT | ANY_INT |
| Add | `+` | ANY_NUM | ANY_NUM | ANY_NUM |
| Subtract | `-` | ANY_NUM | ANY_NUM | ANY_NUM |

Where `ANY_INT` = INT, DINT and `ANY_NUM` = INT, DINT, REAL.

**Time arithmetic** is also supported:
- `TIME + TIME = TIME`
- `TIME - TIME = TIME`
- `TOD + TIME = TOD`
- `TOD - TIME = TOD`
- `DT + TIME = DT`
- `DT - TIME = DT`
- `DATE - DATE = TIME`
- `TOD - TOD = TIME`
- `DT - DT = TIME`
- `TIME * ANY_INT = TIME`
- `TIME / ANY_INT = TIME`
- `TIME DIV ANY_INT = TIME`

### 14.3 Comparison Operators

| Operator | Meaning |
|---|---|
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal to |
| `>=` | Greater than or equal to |
| `=` | Equal to |
| `<>` | Not equal to |

**Comparable types**: INT/DINT/REAL, BOOL/BYTE/WORD/DWORD, CHAR, STRING (via IEC functions), DATE, TIME, TOD, DT (same type only). S5TIME variables cannot be compared.

### 14.4 Logical Operators

| Operation | Operator | Operand 1 | Operand 2 | Result |
|---|---|---|---|---|
| Negation | `NOT` | ANY_BIT | - | ANY_BIT |
| Conjunction | `AND` / `&` | ANY_BIT | ANY_BIT | ANY_BIT |
| Exclusive OR | `XOR` | ANY_BIT | ANY_BIT | ANY_BIT |
| Disjunction | `OR` | ANY_BIT | ANY_BIT | ANY_BIT |

Where `ANY_BIT` = BOOL, BYTE, WORD, DWORD.

Result is:
- 1 (TRUE) or 0 (FALSE) for BOOL operands
- Bit pattern for BYTE/WORD/DWORD operands

### 14.5 Expression Rules

- Operators of different priority: address binds to higher-priority operator
- Same priority: left-to-right evaluation
- Unary minus = multiply by -1
- Operators must not follow directly: `a * -b` is invalid; use `a * (-b)`
- Parentheses override priority
- Mathematical operators cannot be used with CHAR or logical data

---

## 15. Value Assignments

### 15.1 Basic Syntax

```scl
variable := expression;
```

### 15.2 Elementary Types

```scl
SWITCH_1 := -17;
SETPOINT_1 := 100.1;
QUERY_1 := TRUE;
TIME_1 := TIME#1H_20M_10S_30MS;
DATE_1 := DATE#1996-01-10;
SETPOINT_1 := SETPOINT_2;           // Variable to variable
SWITCH_2 := SWITCH_1 * 3;           // Expression to variable
```

### 15.3 STRUCT / UDT

```scl
// Complete structure assignment (types and names must match)
MEASVALUE := PROCVALUE;

// Component access
MEASVALUE.VOLTAGE := PROCVALUE.VOLTAGE;
AUXVAR := PROCVALUE.RESISTANCE;
MEASVALUE.RESISTANCE := 4.5;
MEASVALUE.SIMPLE_ARRAY[1,2] := 4;
```

### 15.4 ARRAY

```scl
// Complete array assignment (types and limits must match)
SETPOINTS := PROCVALUES;

// Row assignment
CTRLLR[2] := CTRLLR_1;

// Element access
CTRLLR[1,4] := CTRLLR_1[4];
```

### 15.5 STRING

```scl
DISPLAY_1 := 'error in module 1';
DISPLAY_1 := STRUCTURE1.DISPLAY_3;
```

### 15.6 DATE_AND_TIME

```scl
TIME_1 := DATE_AND_TIME#1995-01-01-12:12:12.2;
TIME_1 := DT#1995-02-02-11:11:11;
TIME_1 := STRUCTURE1.TIME_2;
```

### 15.7 Absolute Variables (CPU Memory)

```scl
STATUSWORD1 := IW4;                   // Simple access
STATUSWORD2 := Q1.1;
STATUSWORD3 := IB[ADDRESS];           // Indexed access
STATUSWORD4 := I[1,ADDRESS];          // Indexed bit access
QW4 := 16#0003;                       // Write to output word
```

### 15.8 Data Block Variables

```scl
// Absolute access
DB11.DW10 := 20;

// Structured access
CONTROLLER_1[1] := DB11.DIGIT;
STATUSWORD3 := DB11.DIGIT1.DIGIT2;

// Indexed access
STATUSWORD2[ADDRESS] := DB11.DW[ADDRESS];

// Dynamic DB access
STATUS_1 := WORD_TO_BLOCK_DB(INDEX).DW10;
STATUS_1 := WORD_TO_BLOCK_DB(INDEX).DW[COUNTER];
```

---

## 16. Control Statements

### 16.1 IF Statement

```scl
IF condition THEN
    // statements
ELSIF condition THEN
    // statements
ELSIF condition THEN
    // statements
ELSE
    // statements
END_IF;
```

- ELSIF and ELSE branches are optional
- Any number of ELSIF branches allowed
- Once a TRUE condition is found, remaining ELSIF branches are skipped
- **Must end with semicolon after `END_IF`**

```scl
IF I1.1 THEN
    N := 0;
    SUM := 0;
    OK := FALSE;
ELSIF START = TRUE THEN
    N := N + 1;
    SUM := SUM + N;
ELSE
    OK := FALSE;
END_IF;
```

### 16.2 CASE Statement

```scl
CASE expression OF
    value1 : // statements;
    value2 : // statements;
    value3, value4 : // statements (multiple values);
    value5..value6 : // statements (range);
    value7, value8..value9 : // statements (mixed);
    ELSE : // statements (default);
END_CASE;
```

- Selection expression must return INTEGER
- Values must be INTEGER constants
- Each value may only appear once
- ELSE branch is optional
- **Must end with semicolon after `END_CASE`**

```scl
CASE TW OF
    1:      DISPLAY := OVEN_TEMP;
    2:      DISPLAY := MOTOR_SPEED;
    3:      DISPLAY := GROSS_TARE;
            QW4 := 16#0003;
    4..10:  DISPLAY := INT_TO_DINT(TW);
            QW4 := 16#0004;
    11,13,19: DISPLAY := 99;
            QW4 := 16#0005;
    ELSE:   DISPLAY := 0;
            TW_ERROR := 1;
END_CASE;
```

### 16.3 FOR Statement

```scl
FOR control_var := initial_value TO final_value [BY increment] DO
    // statements
END_FOR;
```

- Control variable must be local INT or DINT
- If BY is omitted, increment defaults to +1
- Initial value, final value, and increment are evaluated once at loop start
- Cannot modify final value or increment during loop execution
- **Must end with semicolon after `END_FOR`**

```scl
FOR INDEX := 1 TO 50 BY 2 DO
    IF KEYWORD[INDEX] = 'KEY' THEN
        EXIT;
    END_IF;
END_FOR;
```

### 16.4 WHILE Statement

```scl
WHILE condition DO
    // statements
END_WHILE;
```

- Condition checked **before** each iteration
- Loop may execute zero times if condition is initially FALSE
- **Must end with semicolon after `END_WHILE`**

```scl
INDEX := 1;
WHILE INDEX <= 50 AND KEYWORD[INDEX] <> 'KEY' DO
    INDEX := INDEX + 2;
END_WHILE;
```

### 16.5 REPEAT Statement

```scl
REPEAT
    // statements
UNTIL condition
END_REPEAT;
```

- Condition checked **after** each iteration
- Loop executes at least once
- Exits when condition becomes TRUE
- **Must end with semicolon after `END_REPEAT`**

```scl
INDEX := 0;
REPEAT
    INDEX := INDEX + 2;
UNTIL INDEX > 50 OR KEYWORD[INDEX] = 'KEY'
END_REPEAT;
```

### 16.6 CONTINUE Statement

```scl
CONTINUE;
```

Terminates current loop iteration and restarts at condition check (WHILE/REPEAT) or increment (FOR).

```scl
WHILE INDEX <= 100 DO
    INDEX := INDEX + 1;
    IF ARRAY_1[INDEX] = INDEX THEN
        CONTINUE;
    END_IF;
    ARRAY_1[INDEX] := 0;
END_WHILE;
```

### 16.7 EXIT Statement

```scl
EXIT;
```

Immediately exits the innermost loop. Execution continues after the loop end keyword.

```scl
FOR INDEX_1 := 1 TO 51 BY 2 DO
    IF KEYWORD[INDEX_1] = 'KEY' THEN
        INDEX_2 := INDEX_1;
        EXIT;
    END_IF;
END_FOR;
INDEX_SEARCH := INDEX_2;   // Executed after EXIT or normal loop end
```

### 16.8 GOTO Statement

```scl
GOTO label_name;
```

Jumps to a declared label. Labels must be declared in `LABEL ... END_LABEL` section.

```scl
LABEL
    LABEL1, LABEL2, LABEL3;
END_LABEL

BEGIN
    IF A > B THEN GOTO LABEL1;
    ELSIF A > C THEN GOTO LABEL2;
    END_IF;

LABEL1: INDEX := 1;
        GOTO LABEL3;
LABEL2: INDEX := 2;
LABEL3: ;    // Empty statement after label
```

**Rules**:
- Destination must be in the same block
- Must be unambiguous
- Jumping into a loop is not permitted; jumping out is allowed
- Use sparingly (not recommended for structured programming)

### 16.9 RETURN Statement

```scl
RETURN;
```

Exits the current block and returns to the calling block (or OS for OBs). Redundant at end of code section.

---

## 17. Calling Functions and Function Blocks

### 17.1 Calling Function Blocks (FB)

**Global instance call (absolute)**:
```scl
FB10.DB20(InputParam := 5, InOutParam := MyVar);
```

**Global instance call (symbolic)**:
```scl
DRIVE.ON(InputParam := 5, InOutParam := MyVar);
```

**Local instance call**:
```scl
MOTOR(InputParam := 5, InOutParam := MyVar);
// Where MOTOR was declared: VAR MOTOR : FB20; END_VAR
```

**Rules**:
- Input parameter assignment is **optional** (values from last call are retained)
- In/out parameter must be assigned on first call, then optional
- Output parameters are **not** specified in the call
- Output values read via instance DB: `DB10.CONTROL` or `MOTOR.CONTROL`
- Assignments can be in any order, separated by commas

### 17.2 Calling Functions (FC)

```scl
// In a value assignment (capturing return value):
LENGTH := DISTANCE(X1 := -3, Y1 := 2, X2 := 8.9, Y2 := 7.4, Q2 := Digitsum);

// In an expression:
RADIUS + DISTANCE(X1 := -3, Y1 := 2, X2 := 8.9, Y2 := 7.4, Q2 := Digitsum)

// As a parameter to another call:
FB32(DIST := DISTANCE(X1 := -3, Y1 := 2, X2 := 8.9, Y2 := 7.4, Q2 := Digitsum));

// VOID function (no return value):
FC31(X := 5, S1 := Sumdigits);
```

**Rules**:
- **All** formal parameters (input, output, in/out) must be assigned actual parameters
- Assignments can be in any order, separated by commas
- Data types must match
- VOID functions cannot be used in expressions

### 17.3 Implicit Parameters EN and ENO

Every FB and FC has:
- **EN** (input, BOOL): If FALSE, block is not executed. Optional to supply.
- **ENO** (output, BOOL): After call, equals OK flag value. Check for errors.

```scl
// Conditional execution:
RESULT := FC85(EN := MY_ENABLE, PAR_1 := 27);

// Check for errors after call:
FB30.DB30(X1 := 10, X2 := 10.5);
IF ENO THEN
    // Everything OK
ELSE
    // Error occurred
END_IF;

// Chain EN/ENO:
FB30.DB30(X1 := 10, X2 := 10.5);
RESULT := FC85(EN := ENO, PAR_1 := 27);  // Only runs if FB30 succeeded
```

---

## 18. Counter Functions

Built-in functions, no declaration needed.

### 18.1 Counter Function Types

| Function | Name | Description |
|---|---|---|
| `S_CU` | Counter Up | Count up only |
| `S_CD` | Counter Down | Count down only |
| `S_CUD` | Counter Up/Down | Count both directions |

### 18.2 Counter Parameters

| Parameter | Type | Direction | Description |
|---|---|---|---|
| `C_NO` | COUNTER | Input | Counter number (e.g., C12) |
| `CU` | BOOL | Input | Count up edge |
| `CD` | BOOL | Input | Count down edge |
| `S` | BOOL | Input | Set (preset) on rising edge |
| `PV` | WORD | Input | Preset value (0-999, BCD: `16#0089`) |
| `R` | BOOL | Input | Reset (sets count to 0) |
| `Q` | BOOL | Output | Status (TRUE if count > 0) |
| `CV` | WORD | Output | Current count (binary) |

**Return value**: Current count in BCD format (WORD).

### 18.3 Counter Call Example

```scl
BCD_VALUE := S_CUD(
    C_NO := C12,
    CD   := I0.0,
    CU   := I0.1,
    S    := I0.2 & I0.3,
    PV   := 120,
    R    := FALSE,
    CV   := binVal,
    Q    := actFlag
);
```

**Dynamic counter number**:
```scl
FUNCTION_BLOCK COUNTER_BLOCK
VAR_INPUT
    MyCounter : COUNTER;
END_VAR
BEGIN
    currVal := S_CD(C_NO := MyCounter, ...);
END_FUNCTION_BLOCK
```

---

## 19. Timer Functions

Built-in functions, no declaration needed.

### 19.1 Timer Function Types

| Function | Name | Description |
|---|---|---|
| `S_PULSE` | Pulse Timer | Output ON for programmed time (max), resets if input goes OFF |
| `S_PEXT` | Extended Pulse | Output ON for full programmed time, retriggerable |
| `S_ODT` | On-Delay Timer | Output ON after delay if input still ON |
| `S_ODTS` | Retentive On-Delay | Output ON after delay regardless of input |
| `S_OFFDT` | Off-Delay Timer | Output stays ON for delay after input goes OFF |

### 19.2 Timer Parameters

| Parameter | Type | Direction | Description |
|---|---|---|---|
| `T_NO` | TIMER | Input | Timer number (e.g., T10) |
| `S` | BOOL | Input | Start input |
| `TV` | S5TIME | Input | Timer preset value |
| `R` | BOOL | Input | Reset input |
| `Q` | BOOL | Output | Timer status |
| `BI` | WORD | Output | Remaining time (binary) |

**Return value**: Remaining time in S5TIME format.

### 19.3 Timer Call Example

```scl
DELAY := S_ODT(
    T_NO := T10,
    S    := TRUE,
    TV   := T#1s,
    R    := FALSE,
    BI   := biVal,
    Q    := actFlag
);
```

**Dynamic timer number**:
```scl
FUNCTION_BLOCK TIMER_BLOCK
VAR_INPUT
    MyTimer : TIMER;
END_VAR
BEGIN
    currTime := S_ODT(T_NO := MyTimer, S := TRUE, TV := T#1s, R := FALSE, BI := biVal, Q := actFlag);
END_FUNCTION_BLOCK
```

### 19.4 Timer Value Input Formats

```scl
TV := T#1s              // 1 second
TV := T#25s             // 25 seconds
TV := T#1h30m30s        // 1 hour 30 min 30 sec
TV := S5T#1h20m10s      // S5TIME format
```

Time base: 10ms, 100ms, 1s, 10s. Values rounded to fit base.

---

## 20. Standard Functions

### 20.1 Data Type Conversion Functions

#### Class A (Implicit / Always Defined)

| Function | Rule |
|---|---|
| `BOOL_TO_BYTE` | Adds leading zeros |
| `BOOL_TO_DWORD` | Adds leading zeros |
| `BOOL_TO_WORD` | Adds leading zeros |
| `BYTE_TO_DWORD` | Adds leading zeros |
| `BYTE_TO_WORD` | Adds leading zeros |
| `CHAR_TO_STRING` | Creates string of length 1 |
| `DINT_TO_REAL` | IEEE conversion (value may change due to precision) |
| `INT_TO_DINT` | Sign-extends (0xFFFF for negative, 0x0000 for positive) |
| `INT_TO_REAL` | IEEE conversion (value preserved) |
| `WORD_TO_DWORD` | Adds leading zeros |

#### Class B (Must Be Explicit, May Be Undefined)

| Function | Rule | Affects OK? |
|---|---|---|
| `BYTE_TO_BOOL` | Copies least significant bit | Y |
| `BYTE_TO_CHAR` | Copies bit string | N |
| `CHAR_TO_BYTE` | Copies bit string | N |
| `CHAR_TO_INT` | Lower byte copied, upper byte zeroed | N |
| `DATE_TO_DINT` | Copies bit string | N |
| `DINT_TO_DATE` | Copies bit string | Y |
| `DINT_TO_DWORD` | Copies bit string | N |
| `DINT_TO_INT` | Copies with sign; OK=FALSE if out of INT range | Y |
| `DINT_TO_TIME` | Copies bit string | N |
| `DINT_TO_TOD` | Copies bit string | Y |
| `DWORD_TO_BOOL` | Copies least significant bit | Y |
| `DWORD_TO_BYTE` | Copies 8 least significant bits | Y |
| `DWORD_TO_DINT` | Copies bit string | N |
| `DWORD_TO_REAL` | Copies bit string (reinterprets) | N |
| `DWORD_TO_WORD` | Copies 16 least significant bits | Y |
| `INT_TO_CHAR` | Copies bit string | Y |
| `INT_TO_WORD` | Copies bit string | N |
| `REAL_TO_DINT` | Rounds IEEE REAL to DINT; OK=FALSE if overflow | Y |
| `REAL_TO_DWORD` | Copies bit string (reinterprets) | N |
| `REAL_TO_INT` | Rounds IEEE REAL to INT; OK=FALSE if overflow | Y |
| `STRING_TO_CHAR` | Copies first char; OK=FALSE if length != 1 | Y |
| `TIME_TO_DINT` | Copies bit string | N |
| `TOD_TO_DINT` | Copies bit string | N |
| `WORD_TO_BOOL` | Copies least significant bit | Y |
| `WORD_TO_BYTE` | Copies least significant 8 bits | Y |
| `WORD_TO_INT` | Copies bit string | N |
| `WORD_TO_BLOCK_DB` | Bit pattern interpreted as DB number | N |
| `BLOCK_DB_TO_WORD` | DB number as WORD bit pattern | N |

#### Rounding and Truncating

| Function | Input | Output | Description |
|---|---|---|---|
| `ROUND` | REAL | DINT | Rounds to nearest integer |
| `TRUNC` | REAL | DINT | Truncates (drops fractional part) |

```scl
ROUND(3.14)   // = 3
ROUND(3.56)   // = 4
TRUNC(3.14)   // = 3
TRUNC(3.56)   // = 3
```

### 20.2 Numeric Standard Functions

#### General Functions

| Function | Input | Output | Description |
|---|---|---|---|
| `ABS` | ANY_NUM | ANY_NUM | Absolute value |
| `SQR` | ANY_NUM | REAL | Square |
| `SQRT` | ANY_NUM | REAL | Square root |

#### Logarithmic Functions

| Function | Input | Output | Description |
|---|---|---|---|
| `EXP` | ANY_NUM | REAL | e^IN |
| `EXPD` | ANY_NUM | REAL | 10^IN |
| `LN` | ANY_NUM | REAL | Natural logarithm |
| `LOG` | ANY_NUM | REAL | Common (base-10) logarithm |

#### Trigonometric Functions (radians)

| Function | Input | Output | Description |
|---|---|---|---|
| `SIN` | ANY_NUM | REAL | Sine |
| `COS` | ANY_NUM | REAL | Cosine |
| `TAN` | ANY_NUM | REAL | Tangent |
| `ASIN` | ANY_NUM | REAL | Arc sine |
| `ACOS` | ANY_NUM | REAL | Arc cosine |
| `ATAN` | ANY_NUM | REAL | Arc tangent |

Note: ANY_NUM input parameters are internally converted to REAL.

**Examples**:
```scl
RESULT := ABS(-5);           // = 5
RESULT := SQRT(81.0);        // = 9
RESULT := SQR(23);           // = 529
RESULT := EXP(4.1);          // = 60.340...
RESULT := EXPD(3);           // = 1000
RESULT := LN(2.718281);      // = 1
RESULT := LOG(245);          // = 2.389166...
RESULT := SIN(PI / 6);       // = 0.5
RESULT := ACOS(0.5);         // = 1.047197... (= PI/3)
```

### 20.3 Bit String Standard Functions

All take two parameters: `IN` (data) and `N` (shift/rotate count, INT).

| Function | Description |
|---|---|
| `ROL(IN := value, N := count)` | Rotate left by N bits |
| `ROR(IN := value, N := count)` | Rotate right by N bits |
| `SHL(IN := value, N := count)` | Shift left by N bits (fill with 0) |
| `SHR(IN := value, N := count)` | Shift right by N bits (fill with 0) |

Valid data types for IN: BOOL, BYTE, WORD, DWORD.

**Examples**:
```scl
RESULT := ROL(IN := 2#1101_0011, N := 5);  // = 2#0111_1010 (122)
RESULT := ROR(IN := 2#1101_0011, N := 2);  // = 2#1111_0100 (244)
RESULT := SHL(IN := 2#1101_0011, N := 3);  // = 2#1001_1000 (152)
RESULT := SHR(IN := 2#1101_0011, N := 2);  // = 2#0011_0100 (52)
```

---

## 21. Global Data Access

### 21.1 CPU Memory - Absolute Access

```scl
STATUSBYTE := IB10;        // Input byte 10
STATUS_3   := I1.1;        // Input bit 1.1
Measval    := IW20;        // Input word 20
```

### 21.2 CPU Memory - Symbolic Access

Requires symbols defined in STEP 7 symbol table:
```scl
STATUSBYTE := Input_byte1;
STATUS_3   := "Input 1.1";     // Quoted symbol
Measval    := Meas_channels;
```

### 21.3 CPU Memory - Indexed Access

```scl
MEASWORD_1 := IW[COUNTER];           // WORD indexed by byte address
OUTMARKER  := I[BYTENUM, BITNUM];    // BOOL indexed by byte + bit
```

Rules:
- BYTE/WORD/DWORD: one index (byte address)
- BOOL: two indices (byte address, bit position)
- Index must be mathematical expression of type INT

### 21.4 Data Block - Absolute Access

```scl
STATUS_5   := DB11.DX13.1;    // DB11, bit at byte 13, bit 1
STATUSBYTE := DB101.DB10;     // DB101, byte at address 10
Measval    := DB25.DW20;      // DB25, word at byte 20
```

### 21.5 Data Block - Indexed Access

```scl
STATUS_1 := DB11.DW[COUNTER];
STATUS_2 := DB12.DX[WNUM, BITNUM];
STATUS_1 := WORD_TO_BLOCK_DB(INDEX).DW[COUNTER];
```

### 21.6 Data Block - Structured Access

```scl
TIME_1       := DB11.TIME_OF_DAY;
ERGWORD_A    := DB10.Result.ERG2;        // Nested structure
ERGWORD_B    := DB20.ERG2;               // UDT-based DB
```

---

## 22. OK Flag

The OK flag is a system variable of type BOOL (no declaration needed).

- Compiler option "OK Flag" must be selected
- Initially TRUE when block is called
- Set to FALSE if a runtime error occurs (overflow, etc.)
- Value is saved in ENO when block exits
- Can be read and set in code

```scl
OK := TRUE;
SUM := SUM + IN;
IF OK THEN
    // Addition succeeded
ELSE
    // Addition failed (overflow, etc.)
END_IF;
```

---

## 23. System Functions and Function Blocks (SFC/SFB)

Called identically to user FCs/FBs:

```scl
// System function call
Result := SFC31(OB_NR := 10, STATUS := MW100);

// System function block call (needs instance DB)
SFB4.DB4(IN := someVar);

// Using SFC20 for block move
ret := SFC20(DSTBLK := out, SCRBLK := in);
```

---

## 24. Complete Source File Example

```scl
// ============================================
// UDT Definition (must come first)
// ============================================
TYPE UDT10
STRUCT
    SETPOINT    : REAL := 0.0;
    ACTUAL      : REAL := 0.0;
    STATUS      : INT := 0;
END_STRUCT
END_TYPE

// ============================================
// Global Data Block (uses UDT, comes after UDT)
// ============================================
DATA_BLOCK DB10
STRUCT
    CONFIG : UDT10;
    PARAMS : ARRAY[1..10] OF REAL := 10(0.0);
END_STRUCT

BEGIN
    CONFIG.SETPOINT := 100.0;
    PARAMS[1] := 1.5;
END_DATA_BLOCK

// ============================================
// Function (called by FB, must come before it)
// ============================================
FUNCTION FC10 : REAL
VAR_INPUT
    Value1 : REAL;
    Value2 : REAL;
END_VAR

VAR_TEMP
    Diff : REAL;
END_VAR

BEGIN
    Diff := Value1 - Value2;
    FC10 := ABS(Diff);
END_FUNCTION

// ============================================
// Function Block (called by OB1)
// ============================================
FUNCTION_BLOCK FB10
TITLE = 'Process Controller'
VERSION : '1.0'
AUTHOR : PAC
FAMILY : CTRL

VAR_INPUT
    Enable   : BOOL := FALSE;
    Setpoint : REAL := 0.0;
END_VAR

VAR_OUTPUT
    Output   : REAL;
    Error    : BOOL;
END_VAR

VAR_IN_OUT
    Actual   : REAL;
END_VAR

VAR
    LastError : REAL;
    CycleCount : DINT;
END_VAR

VAR_TEMP
    TempCalc : REAL;
END_VAR

CONST
    MAX_OUTPUT := 100.0;
    MIN_OUTPUT := 0.0;
END_CONST

BEGIN
    IF Enable THEN
        CycleCount := CycleCount + 1;
        TempCalc := FC10(Value1 := Setpoint, Value2 := Actual);
        LastError := TempCalc;

        Output := TempCalc;

        IF Output > MAX_OUTPUT THEN
            Output := MAX_OUTPUT;
        ELSIF Output < MIN_OUTPUT THEN
            Output := MIN_OUTPUT;
        END_IF;

        Error := FALSE;
    ELSE
        Output := 0.0;
        Error := FALSE;
    END_IF;
END_FUNCTION_BLOCK

// ============================================
// Instance DB for FB10 (comes after the FB)
// ============================================
DATA_BLOCK DB20
FB10

BEGIN
END_DATA_BLOCK

// ============================================
// Organization Block (last in source file)
// ============================================
ORGANIZATION_BLOCK OB1
VAR_TEMP
    OB1_EV_CLASS    : BYTE;
    OB1_SCAN_1      : BYTE;
    OB1_PRIORITY    : BYTE;
    OB1_OB_NUMBR    : BYTE;
    OB1_RESERVED_1  : BYTE;
    OB1_RESERVED_2  : BYTE;
    OB1_PREV_CYCLE  : INT;
    OB1_MIN_CYCLE   : INT;
    OB1_MAX_CYCLE   : INT;
    OB1_DATE_TIME   : DATE_AND_TIME;
END_VAR

BEGIN
    FB10.DB20(
        Enable   := I0.0,
        Setpoint := 50.0,
        Actual   := MW10
    );

    // Read output from instance DB
    QW0 := REAL_TO_INT(DB20.Output);
END_ORGANIZATION_BLOCK
```

---

## 25. TIA Portal V18 Modernization Notes

While the above reference covers classic SCL (S7-300/400), TIA Portal V18 for S7-1500 introduces:

1. **No more absolute block numbers required**: Blocks can use only symbolic names
2. **Optimized DB access**: S7-1500 uses optimized data blocks by default (no absolute addressing within DBs)
3. **Extended data types**: `LREAL` (64-bit float), `LINT` (64-bit int), `LWORD` (64-bit), `LTIME`, `LTOD`, `LDT`, `WSTRING`, `ULINT`, `UDINT`, `UINT`, `USINT`, `SINT`
4. **Named constants in CASE**: Symbolic constants in CASE value lists
5. **FOR loop LREAL control variable**: Extended control variable types
6. **Regions**: `#region Name` / `#endregion` for code folding
7. **REF_TO**: Reference data type
8. **VARIANT**: Runtime type-flexible parameter
9. **IEC timers**: TON, TOF, TP function blocks instead of S_ODT, S_OFFDT, S_PULSE
10. **IEC counters**: CTU, CTD, CTUD instead of S_CU, S_CD, S_CUD
11. **No GOTO**: GOTO is deprecated/removed in TIA Portal
12. **External source import**: `.scl` files imported via `GenerateBlocksFromSource()`
13. **Pragmas**: `{...}` syntax for attributes, `{InstructionName := '...'}`, etc.
14. **Array of `[*]`**: Variable-length arrays in function parameters
15. **Multi-line string assignment**: Different from classic string break syntax

The fundamental block structure, declaration sections, control flow, operators, and expression rules remain the same.
