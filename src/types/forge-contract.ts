// ---------------------------------------------------------------------------
// Interface Contract types — defines how assemblies communicate
// ---------------------------------------------------------------------------

/** A single signal that an assembly exposes or consumes */
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
  /** For consumed signals: which assembly provides it */
  sourceAssemblyTag?: string;
  /** For consumed signals: which exposed signal name from the source assembly */
  sourceSignalName?: string;
}

/** Contract for a single assembly — what it exposes, consumes, and its state machine */
export interface AssemblyContract {
  assemblyId: string;
  assemblyTag: string;
  /** Signals this assembly outputs to other assemblies / process sequences */
  exposed: InterfaceSignal[];
  /** Signals this assembly needs from other assemblies */
  consumed: InterfaceSignal[];
  /** State machine state names — the CASE must implement exactly these.
   *  e.g. ["IDLE", "MOVING_UP", "AT_UPPER", "MOVING_DOWN", "AT_LOWER", "FAULT"] */
  stateDefinitions: string[];
  /** Whether the engineer has approved this contract */
  approved: boolean;
}

/** All assembly contracts in a session, keyed by assemblyId */
export type InterfaceContractMap = Record<string, AssemblyContract>;
