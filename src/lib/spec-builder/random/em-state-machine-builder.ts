/**
 * Build a canonical per-EM state machine (hybrid state model) for the random
 * FDS builder: Idle/Complete/E-Stop static + Starting/Execute/Stopping
 * sequential, with completion-driven transitions and E-Stop as the safe state.
 */
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";
import {
  EM_LOCAL_IDLE, EM_LOCAL_STARTING, EM_LOCAL_EXECUTE,
  EM_LOCAL_STOPPING, EM_LOCAL_COMPLETE, EM_LOCAL_ESTOP,
} from "./state-machine";

export function buildEmCanonicalStateMachine(): {
  states: EmStateV2[];
  transitions: EmTransitionV2[];
} {
  const states: EmStateV2[] = [
    { state_id: EM_LOCAL_IDLE, name: "Idle", kind: "static", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_STARTING, name: "Starting", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_EXECUTE, name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_STOPPING, name: "Stopping", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_COMPLETE, name: "Complete", kind: "static", allowed_modes: [], is_safe_state: false },
    { state_id: EM_LOCAL_ESTOP, name: "E-Stop", kind: "static", allowed_modes: [], is_safe_state: true },
  ];
  const t = (id: string, from: string, to: string): EmTransitionV2 => ({
    transition_id: id, from_state_id: from, to_state_id: to,
    trigger: { kind: "completion" }, guard: [],
  });
  const transitions: EmTransitionV2[] = [
    { transition_id: "idle_to_starting", from_state_id: EM_LOCAL_IDLE, to_state_id: EM_LOCAL_STARTING,
      trigger: { kind: "command", expr: { tag: "SYS_START", operator: "=", value: true } }, guard: [] },
    t("starting_to_execute", EM_LOCAL_STARTING, EM_LOCAL_EXECUTE),
    t("execute_to_stopping", EM_LOCAL_EXECUTE, EM_LOCAL_STOPPING),
    t("stopping_to_complete", EM_LOCAL_STOPPING, EM_LOCAL_COMPLETE),
    { transition_id: "complete_to_idle", from_state_id: EM_LOCAL_COMPLETE, to_state_id: EM_LOCAL_IDLE,
      trigger: { kind: "command", expr: { tag: "SYS_RESET", operator: "=", value: true } }, guard: [] },
  ];
  return { states, transitions };
}
