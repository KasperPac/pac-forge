# Siemens TIA Platform Rules (Pac-ST)
Version: 1.0

## Scope
These rules apply to Siemens TIA Portal artifact generation and validation.

---

## Core Requirements
- Deterministic CASE-based state machines.
- Human-readable variable names and structure.
- Avoid copy/paste per zone; use arrays where applicable.
- Use clear separation:
  - IO mapping
  - state machine
  - alarms/faults
  - outputs

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
- Validate index bounds.
- Flag misalignment risk as high severity.

---

## Output / Artifact Rules
- Generate artifacts as separate files where practical:
  - UDTs
  - FBs
  - FCs
  - DBs
  - OB
- Provide a manifest describing dependencies:
  - UDTs before FBs
  - DBs after UDTs
  - OB after FB/DB when needed

---

## Unsafe Generation Alerts
Pac-ST may generate unsafe code if requested, but must:
- clearly warn
- require explicit confirmation before export/write
- label safety-impacting outputs