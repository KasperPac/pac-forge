/**
 * Canonical PackML-aligned state machine for the random FDS builder.
 * IDs use PackML packml_id values so writeSpecContract's validator
 * accepts them (numeric state_id 1..17 must equal packml_id).
 */
import type { OperatingStateV2 } from "@/types/spec-contract-v2";

export const STATE_ID_STARTING = 3;
export const STATE_ID_IDLE = 4;
export const STATE_ID_EXECUTE = 6;
export const STATE_ID_STOPPING = 7;
export const STATE_ID_E_STOP = 9;
export const STATE_ID_COMPLETE = 17;

export const SEQUENTIAL_STATE_IDS = [
  STATE_ID_STARTING,
  STATE_ID_EXECUTE,
  STATE_ID_STOPPING,
] as const;

export const CANONICAL_STATES: OperatingStateV2[] = [
  {
    state_id: STATE_ID_IDLE,
    packml_id: STATE_ID_IDLE,
    display_name: "Idle",
    description: "All outputs de-energised; awaiting start command.",
    state_pattern: "static",
  },
  {
    state_id: STATE_ID_STARTING,
    packml_id: STATE_ID_STARTING,
    display_name: "Starting",
    description: "Sequential start-up of devices until the machine is ready to execute.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_EXECUTE,
    packml_id: STATE_ID_EXECUTE,
    display_name: "Execute",
    description: "Primary production cycle.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_STOPPING,
    packml_id: STATE_ID_STOPPING,
    display_name: "Stopping",
    description: "Sequential shutdown of devices to a safe resting state.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_COMPLETE,
    packml_id: STATE_ID_COMPLETE,
    display_name: "Complete",
    description: "Cycle finished; awaiting reset.",
    state_pattern: "static",
  },
  {
    state_id: STATE_ID_E_STOP,
    packml_id: STATE_ID_E_STOP,
    display_name: "E-Stop",
    description: "Emergency stop active; all motion inhibited.",
    state_pattern: "static",
  },
];
