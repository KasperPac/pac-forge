# Siemens TIA Platform Rules (Pac-ST)
Version: 1.1

## Scope
These rules apply to Siemens TIA Portal artifact generation and validation.
All generated SCL must compile without errors when imported as an external source
file in TIA Portal V17–V20.

---

## SCL Language Rules (MUST FOLLOW)

### CASE Statements
- CASE labels MUST be integer literals, NOT variables.
- Do NOT declare state constants as `VAR` and use them as CASE labels — TIA rejects this.
- Use `#region` comments to label states instead.
```scl
// CORRECT:
CASE #Data.State OF
    0:  // INIT
    1:  // IDLE
    2:  // RUN
    3:  // FAULT
    4:  // RESET
END_CASE;

// WRONG — will not compile:
VAR
    STATE_INIT : Int := 0;
END_VAR
CASE #Data.State OF
    STATE_INIT:   // ERROR: Invalid data type for CASE expression
END_CASE;
```

### Timer Calls (TON, TOF, TP)
- ALL IEC timer calls MUST include both `IN` and `PT` parameters. Omitting `PT` causes a compile error.
- When resetting a timer, still pass `PT`.
```scl
// CORRECT:
#MyTimer(IN := FALSE, PT := T#0s);
#MyTimer(IN := #RunCondition, PT := #Config.DelayTime);

// WRONG — will not compile:
#MyTimer(IN := FALSE);   // ERROR: Parameter 'PT' has to be used
```

### Variable Access
- Use `#` prefix for instance-local variables in FBs (e.g., `#Data.State`, `#l_IO`).
- Use `"DBName".Tag` for global DB access.
- Avoid absolute addressing (%I, %Q, %M) — use symbolic names.

### Data Types
- Use PLC data types (UDTs) instead of anonymous STRUCTs in block interfaces.
- ARRAY indices: use `ARRAY[1..n]` (1-based) unless hardware mapping dictates otherwise.
- STRING default length is 254; specify length when shorter is needed: `STRING[80]`.

### Block Structure
- Every FB/FC must have matching `FUNCTION_BLOCK "Name"` / `END_FUNCTION_BLOCK` or `FUNCTION "Name"` / `END_FUNCTION`.
- Use `{ S7_Optimized_Access := 'TRUE' }` for all blocks.
- VERSION format: `VERSION : 0.1`

---

## Block Types and Architecture

### Organization Block (OB)
- Event-driven entry points (program cycle, startup, interrupts).
- Program cycle OBs (e.g. OB1) execute cyclically at lowest priority; multiple allowed, run in numerical order.
- OBs only have VAR_TEMP — no persistent local data. Declare FB instances in OB's VAR section.

### Function Block (FB)
- Stateful: has an instance DB that persists Input, Output, InOut, and Static data between scans.
- Use for tasks that span multiple scan cycles (motors, valves, sequences, state machines).
- One generic FB can control multiple devices by using different instance DBs per call.
- Timers, counters, and triggers MUST be declared in VAR (static), NEVER in VAR_TEMP.

### Function (FC)
- Stateless: no instance DB, only VAR_TEMP (lost every scan).
- Use for reusable calculations, conversions, and transformations.
- To persist results, assign outputs to global memory (M memory or global DB).

### Data Block (DB)
- Global DB: accessible by any OB, FB, or FC.
- Instance DB: stores data for a specific FB call. Created automatically when an FB instance is declared.
- Data persists across scan cycles.

### UDT (User-Defined Type)
- Reusable STRUCT definition. Use instead of anonymous STRUCTs in block interfaces.

---

## Block Nesting and Calling
- Max nesting depth from cycle/startup OB: 16 levels.
- Max nesting depth from interrupt OB: 6 levels.
- Safety programs: max 4 levels for safety blocks.
- When calling an FB, always specify the instance: `#Motor1(i_Start := signal, i_Stop := FALSE);`

---

## Parameter Passing
- Use `:=` for input parameters, `=>` for output parameters.
- Simple types (INT, REAL, BOOL): passed by value (copied).
- Complex types (STRUCT, ARRAY, STRING): passed by reference for IN/OUT — use IN/OUT for these to avoid unnecessary copies.
- ALL parameters on native functions (LIMIT, TON, etc.) MUST use named syntax.

---

## Optimized Block Access
- Always use `{ S7_Optimized_Access := 'TRUE' }` for all blocks (default for S7-1500).
- FB and its instance DB MUST have matching optimization settings.
- Mismatched settings cause complex IN/OUT parameters to be copied instead of referenced, risking data loss from HMI writes or interrupt OBs.

---

## VAR Section Rules
- `VAR_INPUT`: Read-only inputs from caller.
- `VAR_OUTPUT`: Outputs written by the block, returned to caller.
- `VAR_IN_OUT`: Bidirectional — caller passes in, block modifies, value returned. Use for complex types.
- `VAR` (FB only): Static/persistent data stored in instance DB. Timers, counters, state variables go here.
- `VAR_STAT` (FC only): Static data that persists across calls (rarely used).
- `VAR_TEMP`: Temporary, reset every scan cycle. NEVER put timers/counters/triggers here.

---

## Core Requirements
- Deterministic CASE-based state machines with integer literal labels.
- Human-readable variable names and structure.
- Avoid copy/paste per zone; use arrays where applicable.
- Use clear separation with region comments:
  - IO mapping
  - State machine
  - Alarms/faults
  - Timer management
  - Output mapping

---

## Alarm Philosophy
- Latching alarms.
- No auto reset.
- Operator reset only.
- Reset only when fault condition is cleared.

---

## IO Indexing Rules
- IO mapping must be deterministic and explicit.
- Prefer UDT + arrays for IO structures.
- Validate index bounds before array access.
- Flag misalignment risk as high severity.

---

## Output / Artifact Rules
- Generate artifacts as separate files where practical:
  - UDTs (imported first — no dependencies)
  - FBs (depend on UDTs)
  - FCs (depend on UDTs)
  - DBs (depend on UDTs, may reference FBs)
  - OB (depends on FBs/FCs/DBs)
- Provide a manifest describing dependencies and import order.
- File naming: `UDT_Name.scl`, `FB_Name.scl`, `FC_Name.scl`, `DB_Name.scl`

---

## Unsafe Generation Alerts
Pac-ST may generate unsafe code if requested, but must:
- Clearly warn
- Require explicit confirmation before export/write
- Label safety-impacting outputs
