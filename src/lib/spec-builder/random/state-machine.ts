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

// state_name + display_name are dual-populated so V1 readers
// (migrateOperatingState in spec-builder.ts, which only looks at
// state_name) render canonical labels rather than empty strings when
// reading a random-built spec.
export const CANONICAL_STATES: OperatingStateV2[] = [
  {
    state_id: STATE_ID_IDLE,
    packml_id: STATE_ID_IDLE,
    state_name: "Idle",
    display_name: "Idle",
    description: "All outputs de-energised; awaiting start command.",
    state_pattern: "static",
  },
  {
    state_id: STATE_ID_STARTING,
    packml_id: STATE_ID_STARTING,
    state_name: "Starting",
    display_name: "Starting",
    description: "Sequential start-up of control_modules until the machine is ready to execute.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_EXECUTE,
    packml_id: STATE_ID_EXECUTE,
    state_name: "Execute",
    display_name: "Execute",
    description: "Primary production cycle.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_STOPPING,
    packml_id: STATE_ID_STOPPING,
    state_name: "Stopping",
    display_name: "Stopping",
    description: "Sequential shutdown of control_modules to a safe resting state.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_COMPLETE,
    packml_id: STATE_ID_COMPLETE,
    state_name: "Complete",
    display_name: "Complete",
    description: "Cycle finished; awaiting reset.",
    state_pattern: "static",
  },
  {
    state_id: STATE_ID_E_STOP,
    packml_id: STATE_ID_E_STOP,
    state_name: "E-Stop",
    display_name: "E-Stop",
    description: "Emergency stop active; all motion inhibited.",
    state_pattern: "static",
  },
];

// EM-local canonical state ids (hybrid state model). String slugs, distinct
// from the numeric PackML ids above. Used as keys for static_states /
// sequential_states in the random builder's per-EM state machine.
export const EM_LOCAL_IDLE = "idle";
export const EM_LOCAL_STARTING = "starting";
export const EM_LOCAL_EXECUTE = "execute";
export const EM_LOCAL_STOPPING = "stopping";
export const EM_LOCAL_COMPLETE = "complete";
export const EM_LOCAL_ESTOP = "estop";

export const EM_LOCAL_SEQUENTIAL_IDS = [
  EM_LOCAL_STARTING,
  EM_LOCAL_EXECUTE,
  EM_LOCAL_STOPPING,
] as const;
