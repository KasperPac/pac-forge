// ---------------------------------------------------------------------------
// Interface Contract types — defines how equipment_modules communicate
// ---------------------------------------------------------------------------

/** A single signal that an equipment_module exposes or consumes */
export interface InterfaceSignal {
  id: string;
  /** Parameter name in lowerCamelCase — becomes VAR_INPUT or VAR_OUTPUT */
  name: string;
  /** SCL data type: Bool, Int, Word, Real, Time, etc. */
  dataType: string;
  direction: "expose" | "consume";
  /** Intent comment explaining purpose + who reads/writes this signal.
   *  e.g. "TRUE when lift cylinder fully extended — read by CV01 sequence to start transfer" */
  intentComment: string;
  /** For consumed signals: which equipment_module provides it */
  sourceAssemblyTag?: string;
  /** For consumed signals: which exposed signal name from the source equipment_module */
  sourceSignalName?: string;
}

/** Contract for a single equipment_module — what it exposes, consumes, and its state machine */
export interface EquipmentModuleContract {
  equipment_moduleId: string;
  equipment_moduleTag: string;
  /** Signals this equipment_module outputs to other equipment_modules / process sequences */
  exposed: InterfaceSignal[];
  /** Signals this equipment_module needs from other equipment_modules */
  consumed: InterfaceSignal[];
  /** State machine state names — the CASE must implement exactly these.
   *  e.g. ["IDLE", "MOVING_UP", "AT_UPPER", "MOVING_DOWN", "AT_LOWER", "FAULT"] */
  stateDefinitions: string[];
  /** Whether the engineer has approved this contract */
  approved: boolean;
}

/** All equipment_module contracts in a session, keyed by equipment_moduleId */
export type InterfaceContractMap = Record<string, EquipmentModuleContract>;
