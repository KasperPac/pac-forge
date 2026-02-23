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
