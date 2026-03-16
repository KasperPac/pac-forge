The Devices tab in the forge hardware-io step needs a major rework. Currently it's a read-only display. It needs to become the PRIMARY input for this step, with hardware and IO derived from the device list.

## New flow: Devices → Hardware → IO

### 1. Device List Builder (Devices tab — should be the DEFAULT tab)

Add an "Add Device" button that opens a small inline form or row with:
- Device Type dropdown: Motor DOL, Motor VFD, Solenoid 2-pos, Solenoid 3-pos, Pneumatic Cylinder, Photoelectric Sensor, Proximity Sensor, Temperature Sensor (Analog), Pressure Sensor (Analog), Flow Meter (Analog), Level Switch, Level Transmitter (Analog), E-Stop Circuit, Safety Light Curtain, Valve Motorised, Valve Pneumatic
- Device Name (text input, e.g. "Conv1_Motor")
- Device Tag (text input, e.g. "M101")
- Subsystem (text input, optional)
- Description (text input)
- Quantity (number input, default 1 — for adding multiple of the same type like "6x Proximity Sensor")

When a device type is selected, the system should know its STANDARD IO signals. Define these in a new file src/lib/device-type-io-defaults.ts:
```typescript
export const DEVICE_TYPE_IO_DEFAULTS: Record<string, { signal_type: "DI" | "DQ" | "AI" | "AQ"; suffix: string; description: string }[]> = {
  "Motor DOL": [
    { signal_type: "DQ", suffix: "_CMD", description: "Start command" },
    { signal_type: "DI", suffix: "_RUN", description: "Running feedback" },
    { signal_type: "DI", suffix: "_FLT", description: "Fault" },
  ],
  "Motor VFD": [
    { signal_type: "AQ", suffix: "_SPD_REF", description: "Speed reference" },
    { signal_type: "DI", suffix: "_RUN", description: "Running feedback" },
    { signal_type: "DI", suffix: "_FLT", description: "Fault" },
    { signal_type: "AI", suffix: "_SPD_ACT", description: "Speed actual" },
    { signal_type: "DQ", suffix: "_ENA", description: "Enable" },
  ],
  "Solenoid 2-pos": [
    { signal_type: "DQ", suffix: "_CMD", description: "Energize" },
    { signal_type: "DI", suffix: "_POS_A", description: "Position A feedback" },
    { signal_type: "DI", suffix: "_POS_B", description: "Position B feedback" },
  ],
  "Solenoid 3-pos": [
    { signal_type: "DQ", suffix: "_CMD_A", description: "Position A command" },
    { signal_type: "DQ", suffix: "_CMD_B", description: "Position B command" },
    { signal_type: "DI", suffix: "_POS_A", description: "Position A feedback" },
    { signal_type: "DI", suffix: "_POS_B", description: "Position B feedback" },
    { signal_type: "DI", suffix: "_POS_C", description: "Position C / centre feedback" },
  ],
  "Pneumatic Cylinder": [
    { signal_type: "DQ", suffix: "_EXT", description: "Extend command" },
    { signal_type: "DQ", suffix: "_RET", description: "Retract command" },
    { signal_type: "DI", suffix: "_EXT_FB", description: "Extended feedback" },
    { signal_type: "DI", suffix: "_RET_FB", description: "Retracted feedback" },
  ],
  "Photoelectric Sensor": [
    { signal_type: "DI", suffix: "_DET", description: "Detection" },
  ],
  "Proximity Sensor": [
    { signal_type: "DI", suffix: "_DET", description: "Detection" },
  ],
  "Temperature Sensor (Analog)": [
    { signal_type: "AI", suffix: "_VAL", description: "Temperature value" },
  ],
  "Pressure Sensor (Analog)": [
    { signal_type: "AI", suffix: "_VAL", description: "Pressure value" },
  ],
  "Flow Meter (Analog)": [
    { signal_type: "AI", suffix: "_VAL", description: "Flow value" },
  ],
  "Level Switch": [
    { signal_type: "DI", suffix: "_HIGH", description: "High level" },
    { signal_type: "DI", suffix: "_LOW", description: "Low level" },
  ],
  "Level Transmitter (Analog)": [
    { signal_type: "AI", suffix: "_LVL", description: "Level value" },
  ],
  "E-Stop Circuit": [
    { signal_type: "DI", suffix: "_OK", description: "E-Stop OK (NC)" },
  ],
  "Safety Light Curtain": [
    { signal_type: "DI", suffix: "_OK", description: "Curtain clear" },
    { signal_type: "DI", suffix: "_MUTE", description: "Mute active" },
  ],
  "Valve Motorised": [
    { signal_type: "DQ", suffix: "_OPEN", description: "Open command" },
    { signal_type: "DQ", suffix: "_CLOSE", description: "Close command" },
    { signal_type: "DI", suffix: "_OPENED", description: "Open feedback" },
    { signal_type: "DI", suffix: "_CLOSED", description: "Closed feedback" },
    { signal_type: "DI", suffix: "_FLT", description: "Fault" },
  ],
  "Valve Pneumatic": [
    { signal_type: "DQ", suffix: "_CMD", description: "Energize" },
    { signal_type: "DI", suffix: "_OPEN", description: "Open feedback" },
    { signal_type: "DI", suffix: "_CLOSED", description: "Closed feedback" },
  ],
};
```

When a device is added, auto-generate its IO signals using the tag + suffix (e.g. tag "M101" + suffix "_CMD" = "M101_CMD"). The engineer can edit or add custom signals per device after adding.

Each device in the list should be expandable to show/edit its IO signals.

### 2. IO Summary Banner

Above the tabs, show a live IO point summary: "Total: X DI, Y DQ, Z AI, W AQ" calculated from all devices' IO signals. This updates as devices are added/removed.

### 3. Hardware Recommendation (Hardware tab)

Add a "Recommend Modules" button to the hardware tab. When clicked, calculate:
- Total DI needed → suggest DI modules (e.g. 24 DI needed → 2x DI 16x24VDC)
- Total DQ needed → suggest DQ modules
- Total AI needed → suggest AI modules
- Total AQ needed → suggest AQ modules

Use the existing module catalog (src/lib/module-catalog.ts) to pick appropriate Siemens modules. Display the recommendation and let the engineer accept or modify.

### 4. Auto-Generate IO List (IO tab)

Add a "Generate IO List from Devices" button to the IO tab. When clicked:
- Use the hardware config (rack/slot/module assignments) and the device IO signals
- Use the address calculator (src/lib/address-calculator.ts) to assign addresses
- Populate the IO list with proper addresses, tags, and module/slot references
- Use the existing IoListEditor component to display and allow editing

### 5. Tab order change

Reorder tabs to: Devices | Hardware | IO List (was Hardware | IO List | Devices)

Devices is now the starting point, hardware is configured based on device needs, IO list is generated last.

Commit with: "forge-ui: device-first hardware/IO workflow with recommendations and auto-generation"