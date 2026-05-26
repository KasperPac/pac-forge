/**
 * Per-device-class IO + step shape library. The sequence builder
 * resolves the semantic slot suffixes to real tag names per device
 * (e.g. "{CMD}" → "CV01_M01_CMD") and uses these step templates to
 * populate sequential states deterministically.
 */
import type { IoSignalKind } from "./io-allocator";
import type { RandomFdsDeviceClass } from "./theme-schema";

export type StateKey = "STARTING" | "EXECUTE" | "STOPPING";

export interface IoSlot {
  /** Tag suffix appended to the device prefix, e.g. "CMD" → "<dev>_CMD". */
  suffix: string;
  kind: IoSignalKind;
  description: string;
}

export interface DeviceStepTemplate {
  name: string;
  action: string;
  /** Suffixes referenced by this step — used by sequence builder to
   *  produce completion_criteria and validated by device-templates.test. */
  referencedSuffixes: string[];
  /**
   * Optional completion criterion shape. The sequence builder uses
   * "tag_equals" against the named suffix and the given value.
   */
  completion: {
    suffix: string;
    value: boolean;
    within_ms: number;
  };
}

export interface DeviceTemplate {
  ioSlots: IoSlot[];
  /** Empty list = no contribution from this device class in that state. */
  stepTemplates: Record<StateKey, DeviceStepTemplate[]>;
}

// ---------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------

const motor: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Run command" },
    { suffix: "FB_RUN", kind: "DI", description: "Running feedback" },
    { suffix: "FAULT", kind: "DI", description: "Drive fault" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise motor",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: true, within_ms: 3000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise motor",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: false, within_ms: 3000 },
      },
    ],
  },
};

const valve: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Solenoid command" },
    { suffix: "FB_OPEN", kind: "DI", description: "Open position feedback" },
    { suffix: "FB_CLOSED", kind: "DI", description: "Closed position feedback" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Open valve",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_OPEN"],
        completion: { suffix: "FB_OPEN", value: true, within_ms: 2000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "Close valve",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_CLOSED"],
        completion: { suffix: "FB_CLOSED", value: true, within_ms: 2000 },
      },
    ],
  },
};

const conveyor: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Belt run command" },
    { suffix: "FB_RUN", kind: "DI", description: "Belt running feedback" },
    { suffix: "FAULT", kind: "DI", description: "Drive fault" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Start belt",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: true, within_ms: 3000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "Stop belt",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: false, within_ms: 3000 },
      },
    ],
  },
};

const transporter: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Run command" },
    { suffix: "FB_RUN", kind: "DI", description: "Running feedback" },
    { suffix: "AT_DEST", kind: "DI", description: "Reached destination" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise transporter",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: true, within_ms: 5000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise transporter",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: false, within_ms: 5000 },
      },
    ],
  },
};

const dryer: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Heater command" },
    { suffix: "TEMP", kind: "AI", description: "Temperature feedback" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise heater",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: true, within_ms: 1000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise heater",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: false, within_ms: 1000 },
      },
    ],
  },
};

const cooler: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Cooler command" },
    { suffix: "TEMP", kind: "AI", description: "Temperature feedback" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise cooler",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: true, within_ms: 1000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise cooler",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: false, within_ms: 1000 },
      },
    ],
  },
};

// Sensors / passive devices contribute IO only, no step templates.
const sensorDi = (descr: string): DeviceTemplate => ({
  ioSlots: [{ suffix: "STATE", kind: "DI", description: descr }],
  stepTemplates: { STARTING: [], EXECUTE: [], STOPPING: [] },
});

const sensorAi = (descr: string): DeviceTemplate => ({
  ioSlots: [{ suffix: "PV", kind: "AI", description: descr }],
  stepTemplates: { STARTING: [], EXECUTE: [], STOPPING: [] },
});

const passiveDo = (descr: string): DeviceTemplate => ({
  ioSlots: [{ suffix: "CMD", kind: "DO", description: descr }],
  stepTemplates: { STARTING: [], EXECUTE: [], STOPPING: [] },
});

// ---------------------------------------------------------------------
// Registry — every RandomFdsDeviceClass enum value must appear here
// ---------------------------------------------------------------------

export const DEVICE_TEMPLATES: Record<RandomFdsDeviceClass, DeviceTemplate> = {
  valve,
  motor,
  sensor_level: sensorAi("Level transmitter reading"),
  sensor_pressure: sensorAi("Pressure transmitter reading"),
  sensor_temperature: sensorAi("Temperature transmitter reading"),
  sensor_weight: sensorAi("Load cell reading"),
  sensor_flow: sensorAi("Flow transmitter reading"),
  sensor_position: sensorDi("Position switch state"),
  indicator: passiveDo("Indicator output"),
  transmitter: sensorAi("Process value transmitter"),
  filter: sensorDi("Filter differential pressure switch"),
  conveyor,
  hopper: sensorDi("Hopper low-level switch"),
  transporter,
  dryer,
  cooler,
  push_button: sensorDi("Push-button state"),
  emergency_stop: sensorDi("E-stop circuit state"),
  other: sensorDi("Generic input"),
};
