/**
 * Canonical PackML 17-state model. Sourced from OMAC PackML / PLCopen
 * state-model reference. Do NOT edit these names or IDs without a parallel
 * update to the parent design doc §3.2.
 */
export interface PackmlState {
  packml_id: number;     // 1..17
  name: string;          // canonical display name
  state_pattern: "static" | "sequential";
}

export const PACKML_STATES: readonly PackmlState[] = [
  { packml_id: 1, name: "Clearing", state_pattern: "sequential" },
  { packml_id: 2, name: "Stopped", state_pattern: "static" },
  { packml_id: 3, name: "Starting", state_pattern: "sequential" },
  { packml_id: 4, name: "Idle", state_pattern: "static" },
  { packml_id: 5, name: "Suspended", state_pattern: "static" },
  { packml_id: 6, name: "Execute", state_pattern: "sequential" },
  { packml_id: 7, name: "Stopping", state_pattern: "sequential" },
  { packml_id: 8, name: "Aborting", state_pattern: "sequential" },
  { packml_id: 9, name: "Aborted", state_pattern: "static" },
  { packml_id: 10, name: "Holding", state_pattern: "sequential" },
  { packml_id: 11, name: "Held", state_pattern: "static" },
  { packml_id: 12, name: "Unholding", state_pattern: "sequential" },
  { packml_id: 13, name: "Suspending", state_pattern: "sequential" },
  { packml_id: 14, name: "Unsuspending", state_pattern: "sequential" },
  { packml_id: 15, name: "Resetting", state_pattern: "sequential" },
  { packml_id: 16, name: "Completing", state_pattern: "sequential" },
  { packml_id: 17, name: "Complete", state_pattern: "static" },
] as const;

const BY_NAME = new Map<string, PackmlState>(
  PACKML_STATES.map((s) => [s.name.toLowerCase(), s]),
);
const BY_ID = new Map<number, PackmlState>(
  PACKML_STATES.map((s) => [s.packml_id, s]),
);

export function packmlByName(name: string): PackmlState | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function packmlById(id: number): PackmlState | undefined {
  return BY_ID.get(id);
}

export function isPackmlId(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= 17;
}
