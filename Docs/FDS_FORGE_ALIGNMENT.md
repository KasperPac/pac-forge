# FDS Builder ↔ Forge Wizard Alignment

## Purpose

This document captures the architectural alignment between the **FDS Builder** (spec creation) and the **Forge Wizard** (code generation). Both systems must agree on the data contract so the handoff from design engineer → coding engineer works seamlessly.

Written from the forge wizard side after analyzing both systems in depth.

---

## The Core Insight

**The FDS IS the engineering.** The forge wizard is the coding engineer receiving a complete handoff document. The wizard should NOT design — it should translate the FDS into PLC code faithfully.

A human automation engineer works like this:
1. Design engineer writes the FDS (operating states, step sequences, device state tables, alarms, interlocks)
2. Coding engineer reads the FDS and implements it in PLC code
3. Coding engineer picks standard FBs from their library for devices (motors, valves, sensors)
4. The creative work is in the assembly FBs — translating the FDS behavioral description into a state machine
5. They wire everything per the FDS
6. They verify the code matches the spec

The forge wizard is step 2-6. It should never ask the user to "design the interface" or "define the states" — that information is already in the FDS.

---

## What the Forge Wizard Needs From the FDS

### Per Assembly (CRITICAL — this drives assembly FB generation)

| Data | FDS Source | How Forge Uses It |
|------|-----------|------------------|
| Operating states list | `OperatingState[]` from skeleton wizard | Becomes the CASE state machine states |
| Static state behavior | `FunctionalDescriptionContent` (Pattern A) → `DeviceStateEntry[]` | Defines what every output does in IDLE, E-STOP, HELD etc. |
| Sequential state behavior | `FunctionalDescriptionContent` (Pattern B) → `StepEntry[]` + `permissives[]` | Becomes the step sequence logic (Starting, Execute, Stopping) |
| Completion criteria | `StepEntry.completion_criteria` | Becomes the transition condition to next step |
| Timeouts | Embedded in completion_criteria text (e.g. "within T#5s") | Becomes TON timer logic + fault on timeout |
| Permissives | `FunctionalDescriptionContent.permissives[]` | Becomes startup guard conditions |
| Fault conditions | `AlarmSpecificationContent.alarm_tiers[].alarms[]` | Becomes fault detection + fault code assignments |
| Fault philosophy | `ControlPhilosophyContent.fault_philosophy` | Drives fault handling pattern (auto-clear vs manual reset) |
| Device state tables | `DeviceStateEntry[]` per static state | Defines safe states for E-STOP, IDLE, HELD |
| Inter-assembly interlocks | From `SubsystemOrchestration` (fds-compose.ts) | Becomes consumed signals / permissive conditions |

### Per Device

| Data | FDS Source | How Forge Uses It |
|------|-----------|------------------|
| Device name, tag, class | `DeviceConfig` from hierarchy | Used for FB library matching |
| IO signals | `IoSignal[]` | Mapped to FB VAR_INPUT/VAR_OUTPUT |
| Signal direction | `SignalDirection` (DI/DO/AI/AO) | Determines input vs output mapping |
| Safety flag | `DeviceConfig.is_safety` | Flags safety-relevant FBs |
| Normal/failsafe state | `IoListEntry.normal_state`, `failsafe_state` | Defines safe output values |

### Global

| Data | FDS Source | How Forge Uses It |
|------|-----------|------------------|
| Operating states | `confirmed_states: OperatingState[]` | Master state list for all assemblies |
| State patterns | `StatePattern` (static vs sequential) | Determines code generation pattern |
| Safety classification | `SpecProject.safety_classification` | Drives safety FB selection |
| Design principles | `ControlPhilosophyContent.design_principles` | Injected into generation prompts |
| Alarm tiers | `AlarmTier[]` | Structures fault code numbering |

---

## The Data Handoff Format

Currently the forge wizard receives a `SpecAnalysis` (extracted by AI from uploaded spec text). This is a lightweight intermediate format.

**The ideal path:** When the FDS builder completes a spec, the forge wizard should be able to consume the FDS sections directly — not re-extract from prose. The structured `content_json` from each `SpecSection` contains exactly what the wizard needs.

### Proposed Handoff: `ForgeSpecHandoff`

```typescript
interface ForgeSpecHandoff {
  // From SpecProject
  project_name: string;
  plc_model: string;
  hmi_type: string;
  safety_classification: string | null;
  fault_philosophy: string | null;
  design_principles: string[];

  // From confirmed_states
  operating_states: OperatingState[];

  // From SubsystemConfig[]
  subsystems: Array<{
    subsystem_id: string;
    subsystem_name: string;
    equipment_type: string;
    description: string;
    assemblies: Array<{
      assembly_id: string;
      assembly_name: string;
      description: string;
      devices: DeviceConfig[];
    }>;
  }>;

  // From SpecSection (type: "functional_description")
  // Keyed by subsystem_id + state_name
  functional_descriptions: Array<{
    subsystem_id: string;
    state_name: string;
    pattern: "static" | "sequential";
    device_states?: DeviceStateEntry[];     // Pattern A
    permissives?: string[];                  // Pattern B
    steps?: StepEntry[];                     // Pattern B
    notes?: string;
  }>;

  // From SpecSection (type: "alarm_specification")
  alarms: Array<{
    tier_name: string;
    alarms: Array<{
      tag: string;
      description: string;
      action: string;
      setpoint: string;
      delay: string;
    }>;
  }>;

  // From SpecSection (type: "io_list")
  io_list: Array<{
    tag: string;
    device_type: string;
    description: string;
    signal_type: string;
    io_address: string;
    normal_state: string;
    failsafe_state: string;
  }>;

  // From control_philosophy
  control_philosophy: {
    state_list: Array<{ state_name: string; pattern: string; brief: string }>;
    mode_transitions: string;
    fault_philosophy: string;
  };
}
```

This could be:
1. A direct DB join (forge wizard reads spec_sections for the linked spec_project)
2. A materialized JSON handoff stored on the forge_session
3. A function that composes it from SpecProject + SpecSections

Option 1 is cleanest — the forge wizard queries the spec builder tables directly when linked to a project.

---

## How the Forge Wizard Steps Should Map to FDS Content

### Current Forge Step Flow (being refactored):

```
spec_upload → qa_review → project_setup → hardware_io → interface_contract → device_fb → assembly_fb → logic_check → matrix_review → device_code → process_code → hmi → tia_export
```

### Proposed FDS-Driven Flow:

```
1. FDS Link        — Select which spec_project to implement (or upload standalone spec)
2. Project Setup   — CPU, TIA version, design profile, language choices
3. Hardware & IO   — Confirm rack layout, IO addresses (from FDS Section 4)
4. Device FB       — Library-first selection. AI generation only for gaps. Flag missing templates.
5. Assembly Brief  — Show FDS behavioral spec per assembly:
                     - Operating states (from control philosophy)
                     - Step sequences (from functional descriptions)
                     - Permissives, completion criteria, timeouts
                     - Device FBs it commands + their interfaces
                     - Fault conditions from alarm spec
                     Engineer confirms: "implement this"
                     Adds annotations where FDS is ambiguous
6. Assembly FB     — AI generates code FROM the FDS behavioral spec
                     Not "design a state machine" but "implement this exact spec in SCL"
7. Logic Check     — Verify code matches FDS:
                     Does code implement every operating state?
                     Does every step sequence match the FDS?
                     Are all permissives checked?
                     Are all completion criteria implemented?
                     Are all faults handled per alarm spec?
8. Matrix/Wiring   — Connect device FBs ↔ assembly FBs ↔ process
9. Device Code     — Call FCs, IO linking
10. Process Code   — Orchestration across assemblies
11. HMI            — Screen generation from HMI spec
12. TIA Export     — Bundle for import
```

### Key Difference: Step 5 (Assembly Brief)

This replaces the "interface contract" concept. Instead of asking the engineer to define signals in a table, we show them the FDS content and ask them to confirm the implementation approach.

The step shows per assembly:
- **States**: "The FDS defines these operating states: IDLE, STARTING, EXECUTE, STOPPING, E-STOP, FAULT"
- **Sequences**: "During STARTING: Step 1: Open inlet valve → completion: valve open feedback within T#3s. Step 2: Start motor → completion: motor running within T#5s."
- **Static states**: "During E-STOP: Motor = STOP, Valve = DE-ENERGISED"
- **Faults**: "F001: Motor overload (CONTROLLED_SHUTDOWN), F002: Valve timeout (WARNING)"
- **Device FBs**: "This assembly uses: ControlMotorDol (from library), ControlValve2Pos (from library)"

The engineer can:
- Approve as-is
- Add annotations ("this motor needs jog mode in manual")
- Flag FDS gaps ("timeout not specified for step 3, use T#10s")

---

## What the FDS Builder Should Ensure

For the forge wizard to work well, the FDS sections need:

1. **Structured step sequences** — `StepEntry[]` with parseable completion criteria. The forge AI needs to extract conditions from these. Consider making completion criteria more structured:
   ```
   Current: "motor running feedback within T#5s"
   Better:  { condition: "M01_RUN = TRUE", timeout: "T#5s", timeout_action: "Fault F001" }
   ```

2. **Explicit device tag references in steps** — When a step says "start motor", which motor tag? The forge wizard needs to map step actions to specific device FBs.

3. **Assembly-level functional descriptions** — Currently functional_descriptions are per-subsystem × state. The forge wizard needs them per-assembly (since each assembly gets its own FB). If a subsystem has 3 assemblies, the wizard needs to know which steps apply to which assembly.

4. **Inter-assembly dependencies** — From `SubsystemOrchestration` in fds-compose.ts. The forge wizard needs to know: "Assembly A must complete step X before Assembly B can start step Y."

5. **Failsafe states per device** — The IO list has `normal_state` and `failsafe_state`. These must match the static state device tables. The forge wizard uses both.

---

## Open Questions for Alignment

1. **Granularity of functional descriptions**: Should the FDS produce functional descriptions per-assembly (ideal for forge) or per-subsystem (current)? A subsystem with multiple assemblies needs assembly-level behavioral descriptions.

2. **Structured completion criteria**: Should `StepEntry` gain structured fields (`condition_tag`, `timeout_value`, `timeout_action`) alongside the prose `completion_criteria`? This would eliminate the forge wizard needing to regex-parse conditions.

3. **Assembly orchestration data**: How does `SubsystemOrchestration` from fds-compose.ts get passed to the forge wizard? Is it a separate section type or embedded in functional_descriptions?

4. **Operating modes (Auto/Manual/Service)**: The FDS has `OperatingState[]` which covers machine states (Idle, Execute, etc.) but does it cover operator modes? The assembly FB needs to handle Manual (jog), Auto (sequence), and possibly Service mode.

5. **Linking mechanism**: How does a forge session link to a spec_project? Currently forge has `spec_text` (uploaded doc). Should it also have `spec_project_id` (direct link to FDS builder output)?

---

## Summary

The FDS builder and forge wizard are two halves of the same workflow:
- **FDS builder** = design engineer creating the behavioral specification
- **Forge wizard** = coding engineer implementing that specification in PLC code

The handoff must be seamless. The forge wizard should consume FDS structured data directly, not re-extract from prose. The assembly FB generation step should receive the exact FDS behavioral description and implement it faithfully — not design from scratch.
