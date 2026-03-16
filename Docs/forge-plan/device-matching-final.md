# Fix: Device matching accuracy + ensure all device types are represented

## Replaces: device-matching-and-composites.md and device-matching-and-composites-v2.md
## Discard both previous versions — this is the correct approach.

## Key Architecture Principle

Device FBs are INDEPENDENT building blocks. They don't know about each other. ALL wiring between FBs happens in the Process FC, as defined by the Linkage Matrix.

Examples of how FBs connect (all done in the Process FC via matrix wiring):
- SensorFB.detected → ConveyorFB.endSensorForward
- SensorFB.detected → ConveyorFB.jamSensor
- ConveyorFB.runForward → MotorFB.autoRun
- ConveyorFB.runReverse → MotorFB.autoRun + MotorFB.direction
- PushButtonFB.startPressed → ProcessSequence start trigger
- MotorFB.generalFault → ProcessSequence fault logic
- ProcessSequence outputs → StackLightFB inputs
- ESTOP_OK → ConveyorFB.eStop AND MotorFB.eStop

The device list is FLAT — no parent/child relationships. The matrix defines ALL connections. The Process FC implements those connections.

**DO NOT add `related_device_ids` or `parent_device_id` to ForgeDeviceEntry.** These are wrong. All relationships are in the matrix.

---

## Problem 1: Exact matches showing as "Probable"

Same fix as before — improve normalization in `src/lib/forge-device-matcher.ts`:

Add word-order-independent comparison:
```typescript
function normaliseWords(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
```

Add synonym map:
```typescript
const DEVICE_TYPE_SYNONYMS: Record<string, string[]> = {
  "motor dol": ["dol motor", "direct on line motor"],
  "motor vfd": ["vfd motor", "variable frequency drive motor", "variable speed motor"],
  "photoelectric sensor": ["photoelectric", "photo sensor", "pe sensor", "photo eye"],
  "proximity sensor": ["proximity", "prox sensor", "inductive sensor"],
  "push button": ["pushbutton", "push button station", "control station", "operator station"],
  "solenoid 2-pos": ["2 position solenoid", "solenoid valve 2 pos"],
  "e-stop circuit": ["emergency stop", "e-stop", "estop"],
  "stack light": ["signal tower", "indicator light", "tower light"],
  "conveyor": ["conveyor dol", "belt conveyor", "conveyor belt"],
};
```

Update `exactMatch()` to try: direct → word-order → synonym. Only fall to `probableMatch()` if all fail.

---

## Problem 2: Missing device types in the device list

The spec analysis extracts motors and sensors but often misses the SYSTEM-LEVEL devices that tie them together (conveyors, stations). The fix is twofold:

### A) Update spec analysis prompt

In `src/lib/forge-prompts.ts`, update `buildSpecAnalysisPrompt()`:

```
- Extract devices at ALL levels of the system:
  - ACTUATORS: Motors, Solenoids, Valves — these have physical DQ outputs
  - SENSORS: Photoelectric, Proximity, Temperature, Pressure, Level — these have physical DI/AI inputs
  - SYSTEM DEVICES: Conveyors, Pumps, Mixers — these are logical control entities that coordinate actuators and sensors
  - OPERATOR DEVICES: Push buttons, HMI panels, Stack lights, Selector switches
  - SAFETY DEVICES: E-stop circuits, Safety light curtains, Guard switches

- IMPORTANT: If the spec describes "Conveyor CV01 driven by motor M01 with sensors PE01 and PE02", extract THREE separate devices:
  1. CV01 as "Conveyor" — the system device that handles direction, sequencing, and sensor logic
  2. M01 as "Motor DOL" — the actuator that physically drives the belt
  3. PE01, PE02 as "Photoelectric Sensor" — the sensors that detect product

- Each device type has its OWN FB. They are wired together in the Process FC, not nested inside each other.
- The Conveyor FB does NOT contain a Motor FB — they are peers connected via the Process FC.

- For each device, only list the IO signals that belong to THAT device:
  - Motor: CMD (DQ), RUN feedback (DI), Overload (DI)
  - Conveyor: NO physical IO of its own — it receives sensor and motor status as FB inputs
  - Sensor: Detection signal (DI) or analog value (AI)
  - Push Button: Button press (DI) per button
  - Stack Light: Lamp outputs (DQ) per colour
  - E-Stop: Circuit OK signal (DI)
```

### B) Add missing device types to IO defaults

In `src/lib/device-type-io-defaults.ts`, add:

```typescript
"Conveyor": [],
// Conveyor has NO direct physical IO — it receives everything through FB inputs
// Its FB inputs come from: Sensor FBs, Motor FBs (feedback), Process FC (commands)
// Its FB outputs go to: Motor FBs (run commands), Process FC (status)

"Stack Light": [
  { signal_type: "DQ", suffix: "_GREEN", description: "Green lamp - running" },
  { signal_type: "DQ", suffix: "_AMBER", description: "Amber lamp - warning" },
  { signal_type: "DQ", suffix: "_RED", description: "Red lamp - fault" },
],

"Push Button Station": [
  { signal_type: "DI", suffix: "_START", description: "Start button (NO, momentary)" },
  { signal_type: "DI", suffix: "_STOP", description: "Stop button (NC, maintained)" },
  { signal_type: "DI", suffix: "_RESET", description: "Reset button (NO, momentary)" },
],

"Selector Switch": [
  { signal_type: "DI", suffix: "_POS1", description: "Position 1" },
  { signal_type: "DI", suffix: "_POS2", description: "Position 2" },
],
```

Note: Conveyor has EMPTY IO defaults because it has no direct physical IO. All its inputs and outputs are FB-to-FB connections defined in the matrix. This is correct — the Conveyor FB receives sensor data and motor feedback through its interface parameters, not through direct IO wiring.

### C) Add "Suggest Missing Devices" to Hardware/IO devices tab

Instead of suggesting "composite" devices (wrong concept), suggest MISSING device types that the system likely needs based on what IS in the list:

```typescript
interface MissingDeviceSuggestion {
  suggestedType: string;
  suggestedName: string;
  suggestedTag: string;
  reason: string;
}

function suggestMissingDevices(devices: ForgeDeviceEntry[]): MissingDeviceSuggestion[] {
  const suggestions: MissingDeviceSuggestion[] = [];
  const types = new Set(devices.map(d => d.device_type.toLowerCase()));

  // If there are motors described as driving conveyors but no Conveyor devices
  const conveyorMotors = devices.filter(d =>
    d.device_type.toLowerCase().includes("motor") &&
    (d.description.toLowerCase().includes("conveyor") ||
     d.description.toLowerCase().includes("belt"))
  );
  
  if (conveyorMotors.length > 0 && !types.has("conveyor")) {
    for (const motor of conveyorMotors) {
      const num = motor.tag.match(/\d+/)?.[0] ?? "";
      suggestions.push({
        suggestedType: "Conveyor",
        suggestedName: `CV${num}`,
        suggestedTag: `CV${num}`,
        reason: `Motor "${motor.tag}" drives a conveyor. Add a Conveyor device for direction control, sensor monitoring, and jam detection. The Conveyor FB and Motor FB are separate — the Matrix defines how they connect.`,
      });
    }
  }

  // If there are sensors but no system-level device to use them
  // (this is informational — sensors can be wired directly in the Process FC)

  return suggestions;
}
```

Display as a non-blocking suggestion banner:
```
💡 Suggestion: Add Conveyor devices for direction control and sensor coordination
  - CV01 for Motor M01 | CV02 for Motor M02 | CV03 for Motor M03
  Conveyors and Motors are separate FBs — the Matrix defines how they wire together.
  [Add Suggested] [Dismiss]
```

### D) Matrix handles ALL wiring

The Linkage Matrix (from the matrix-review-step task) is where ALL inter-FB connections are defined. For the packaging infeed example, the matrix would contain:

```json
{
  "deviceLinkage": [
    {
      "name": "CV01",
      "fbName": "ControlConveyor",
      "instanceDbName": "InstCV01",
      "wiring": [
        { "param": "endSensorForward", "direction": "in", "source": "InstPE02.detected", "type": "fb" },
        { "param": "jamSensor", "direction": "in", "source": "InstPE03.detected", "type": "fb" },
        { "param": "eStop", "direction": "in", "source": "tag_ESTOP_OK", "type": "io" },
        { "param": "runForward", "direction": "out", "source": "InstM01.autoRun", "type": "fb" }
      ]
    },
    {
      "name": "M01",
      "fbName": "ControlMotor",
      "instanceDbName": "InstM01",
      "wiring": [
        { "param": "autoRun", "direction": "in", "source": "InstCV01.runForward", "type": "fb" },
        { "param": "runFeedback", "direction": "in", "source": "tag_M01_RUN", "type": "io" },
        { "param": "eStop", "direction": "in", "source": "tag_ESTOP_OK", "type": "io" },
        { "param": "extFault", "direction": "in", "source": "tag_M01_OL", "type": "io" },
        { "param": "fwdRun", "direction": "out", "source": "tag_M01_CMD", "type": "io" }
      ]
    },
    {
      "name": "PE02",
      "fbName": "MonitorSensor",
      "instanceDbName": "InstPE02",
      "wiring": [
        { "param": "rawInput", "direction": "in", "source": "tag_PE02_DET", "type": "io" },
        { "param": "detected", "direction": "out", "source": "InstCV01.endSensorForward", "type": "fb" }
      ]
    }
  ]
}
```

The Process FC reads this matrix wiring and generates the correct FB calls with the correct parameter assignments. No hardcoded device relationships needed.

### E) Update matrix generation prompt

When the matrix generation prompt (from matrix-review-step task) is built, include the FB template interfaces so the AI knows the exact parameter names:

For ControlConveyor:
```
VAR_INPUT: run, direction, endSensorForward, endSensorReverse, jamSensor, eStop, reset, timeoutDuration, jamDetectionTime
VAR_OUTPUT: runForward, runReverse, busy, idle, faulted, eStopActive, runningForward, runningReverse, timeoutFault, jamFault, endSensorFault, remainingTimeout, currentDirection, error, status
```

For ControlMotor:
```
VAR_INPUT: enable, mode, autoRun, semiAutoRun, manRun, maintRun, direction, enableFeedback, runFeedback, faultDelay_Run, faultDelay_Stop, eStop, extFault, faultReset
VAR_OUTPUT: fwdRun, revRun, runFault, stopFault, generalFault, status
```

This way the AI generates matrix wiring with the correct parameter names from the actual FB interfaces, not guessed names.

---

## Implementation order

1. Fix matcher normalization and synonyms (quick win)
2. Add Conveyor, Stack Light, Push Button Station to device type IO defaults
3. Add missing device suggestions to Hardware/IO devices tab
4. Update spec analysis prompt to extract all device levels
5. Ensure matrix generation prompt includes FB interfaces for correct wiring

Commit with: "forge-logic: improve device matching + missing device suggestions"
