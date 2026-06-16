# ISA-88 Part 1 Physical & Procedural Model Reference

Condensed reference for AI prompt injection. Clause numbers reference IEC 61512-1 (ISA-88.01-1995).

---

## 1. Physical Model Definitions (§4.4)

The physical model decomposes equipment into a 4-level hierarchy (§4.4.3). Each level maps to a Pac-Forge concept.

| ISA-88 Level | Clause | Definition | Pac-Forge Mapping |
|---|---|---|---|
| Process Cell | §4.4.3.3 | Contains all equipment needed for one or more batches or processes | Full machine / production line |
| Unit | §4.4.3.4 | A collection of associated control modules and/or equipment modules that carries out a major processing activity | Functional station (e.g. Infeed Station, Hydraulic Lift Station) |
| Equipment Module | §4.4.3.5 | A functional group of control modules that can carry out a finite number of specific minor processing activities | Coordinated group of devices working together (e.g. Carriage Drive, Lift Table LFT01) |
| Control Module | §4.4.3.6 | Typically a collection of sensors, actuators, and other processing equipment that acts as a single entity from a control standpoint | Single physical device with IO signals (e.g. motor, solenoid, limit switch) |

---

## 2. Collapsibility Rules (§4.4.3.7)

The Equipment Module layer is **optional** and may be collapsed when simplicity permits.

- When collapsed, Control Modules belong **directly to the Unit** (no Equipment Module intermediate layer).
- Equipment Modules may be part of **other Equipment Modules** (nesting is allowed).
- Any level **below Process Cell** may be omitted when not needed.
- The Process Cell level is always present; Unit is always present; Equipment Module and Control Module layers are context-dependent.

Collapsibility means the hierarchy is never artificially forced. A simple station with individual devices and no coordinated groups may have no Equipment Modules at all — Control Modules go straight to the Unit.

---

## 3. Control Type Definitions (§5.2–5.4)

Three distinct types of control operate at different levels of the hierarchy.

| Control Type | Clause | Purpose | Equipment Entity | Generated Block |
|---|---|---|---|---|
| Basic Control | §5.2 | Dedicated to establishing and maintaining a specific state of equipment and process | Control Module | `CM_` prefix FB — no state machine |
| Procedural Control | §5.3 | Directs equipment-oriented actions to take place in an ordered sequence | Equipment Module | `EM_` prefix FB — PackML state machine |
| Coordination Control | §5.4 | Directs, initiates, and/or modifies the execution of procedural control and the utilization of equipment | Unit / Process Cell | `UC_` / `SC_` prefix FC |

**Key distinctions:**

- Basic control is **always active** — it maintains a state (e.g. a motor FB manages run/stop/fault continuously).
- Procedural control is **sequence-driven** — it steps through phases with a defined start and end.
- Coordination control is **orchestration** — it decides which procedures to run and when, based on the process state.

---

## 4. Process Model vs Procedural Control Model

These are two separate models that describe the same manufacturing activity from different perspectives.

### Process Model (§4.3) — Product-centric

Describes **what happens to the product**. Hierarchy:

```
Process
  └── Process Stage
        └── Process Operation
              └── Process Action
```

A Process Stage is a logically distinct part of the manufacturing process defined by what is done to the material (e.g. "Fill", "Heat", "Mix"). It does not reference equipment.

### Procedural Control Model (§5.3) — Equipment-centric

Describes **how the equipment does it**. Hierarchy:

```
Procedure
  └── Unit Procedure
        └── Operation
              └── Phase
```

A Procedure is the full sequence of steps to make one batch. A Phase is the lowest-level procedural element — it directly commands equipment actions.

### Linkage Between Models

| Process Model | links to | Procedural Model |
|---|---|---|
| Process Stage | ↔ | Unit Procedure |
| Process Operation | ↔ | Operation |
| Process Action | ↔ | Phase |

The process model drives product design; the procedural model drives automation code. AI generation works from the procedural model — device behaviors and sequences are always equipment-centric.

---

## 5. Naming Conventions

All generated PLC block names follow this convention derived from the physical model level.

| Physical Level | Block Type | Prefix Pattern | Example |
|---|---|---|---|
| Control Module | Function Block | `CM_{DeviceClass}_{Tag}` | `CM_Motor_M01` |
| Control Module | Instance DB | `CM_IDB_{Tag}` | `CM_IDB_M01` |
| Equipment Module | Function Block | `EM_{Name}` | `EM_CarriageDrive` |
| Equipment Module | Instance DB | `EM_IDB_{Name}` | `EM_IDB_CarriageDrive` |
| Unit | Function / OB call | `UC_{Name}` | `UC_Carriage` |
| Process Cell / System | OB or FC | `SC_{Name}` | `SC_SegmentWagon` |

Device class for CM blocks uses the generic device type (Motor, Valve, Cylinder, Sensor), not the specific tag name. The tag appears as the suffix so multiple instances of the same class are distinguishable.

---

## 6. Common Mistakes to Avoid

### Hierarchy Misclassification

- A **single motor** is a Control Module — it is one physical device with IO signals. It is NOT an Equipment Module.
- A **"Carriage Drive"** (motor + brake + VSD coordinated together) IS an Equipment Module — it groups related Control Modules into a minor processing activity.
- A **conveyor station** is a Unit — it contains Equipment Modules and Control Modules, and carries out a major processing activity.

### Control Type Misassignment

- Control Modules perform **basic control only** — they do not contain state machines or sequences.
- Equipment Modules perform **procedural control** — they contain a PackML or equivalent state machine to step through phases.
- Units perform **coordination control** — they call Equipment Module procedures; they do not do basic control directly.

### Naming Anti-patterns

- Do NOT use subsystem/assembly/device terminology in generated block names. Use Unit/Equipment Module/Control Module.
- Do NOT give a Control Module an `EM_` prefix. Do NOT give an Equipment Module a `CM_` prefix.
- Do NOT collapse all devices into flat FC calls at the Unit level — respect the hierarchy unless collapsibility rules (§4.4.3.7) explicitly permit it.

### Process Model Confusion

- The Process Model describes **product transformation** (what happens to the material), not equipment behavior.
- Never use Process Model terminology (Process Stage, Process Operation) to name PLC blocks or describe equipment sequences.
- Use Procedural Model terminology (Unit Procedure, Operation, Phase) when describing equipment control logic.
