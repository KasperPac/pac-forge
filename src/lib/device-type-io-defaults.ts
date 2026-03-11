/**
 * Standard IO signal definitions per device type.
 * Used by the Devices tab to auto-generate IO signals when a device is added.
 */

export interface DeviceIoDefault {
  signal_type: "DI" | "DQ" | "AI" | "AQ";
  suffix: string;
  description: string;
}

export const DEVICE_TYPE_IO_DEFAULTS: Record<string, DeviceIoDefault[]> = {
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
  // Conveyor has NO direct physical IO — receives everything through FB inputs
  // (sensor detections, motor feedback, process commands) wired via the Matrix
  "Conveyor": [],
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
};

export const DEVICE_TYPES = Object.keys(DEVICE_TYPE_IO_DEFAULTS);
