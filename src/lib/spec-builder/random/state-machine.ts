/**
 * Canonical PackML-aligned state machine for the random FDS builder.
 * IDs use PackML packml_id values so writeSpecContract's validator
 * accepts them (numeric state_id 1..17 must equal packml_id).
 */
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

// EM-local canonical state ids (hybrid state model). String slugs, distinct
// from the numeric PackML ids above. Used as keys for static_states /
// sequential_states in the random builder's per-EM state machine.
export const EM_LOCAL_IDLE = "idle";
export const EM_LOCAL_STARTING = "starting";
export const EM_LOCAL_EXECUTE = "execute";
export const EM_LOCAL_STOPPING = "stopping";
export const EM_LOCAL_COMPLETE = "complete";
export const EM_LOCAL_ABORTED = "aborted";

export const EM_LOCAL_SEQUENTIAL_IDS = [
  EM_LOCAL_STARTING,
  EM_LOCAL_EXECUTE,
  EM_LOCAL_STOPPING,
] as const;
