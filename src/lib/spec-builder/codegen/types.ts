/** Artifact kinds this compiler emits. */
export type CodegenArtifactType = "UDT" | "FB" | "FC" | "DB" | "OB";

/** Which Phase-4 layer produced an artifact. Lets the Code Builder shell
 *  surface one layer at a time. */
export type CodegenLayer = "device" | "em" | "unit" | "ob1";

/** A generated SCL source unit, shaped for the TIA export plumbing. */
export interface CodegenArtifact {
  name: string;
  type: CodegenArtifactType;
  filename: string;
  content: string;
  dependencies: string[];
  folder: string;
  layer: CodegenLayer;
  ownerId?: string;
  ownerName?: string;
}

/** An edge that activates a step: source step index + the SCL advance condition. */
export interface SaIncoming {
  fromIndex: number;
  condition: string;
}

/** A device output the step commands active (driven by this step's A[] bit). */
export interface SaWire {
  tag: string;
}

/** One step in a Unit's flat S/A sequence. */
export interface SaStep {
  index: number;
  emId: string;
  stateId: string;
  name: string;
  isHome: boolean;
  incoming: SaIncoming[];
  leave: string[];
  wires: SaWire[];
}

/** A Unit's complete S/A sequence IR. */
export interface SaSequence {
  unitId: string;
  unitName: string;
  sclName: string;
  steps: SaStep[];
}

/** Devices/EMs that had no library FB match and got a stub. */
export interface StubReport {
  controlModules: { id: string; name: string; reason: string }[];
  equipmentModules: { id: string; name: string; reason: string }[];
}

/** Full output of a compile run. */
export interface CodegenResult {
  artifacts: CodegenArtifact[];
  stubs: StubReport;
  warnings: string[];
}

/** A sensor/actuator pin declared on a generated EM FB. */
export interface EmPin {
  /** Bare SCL identifier, e.g. `fb_brake_open` (no leading `#`). */
  name: string;
  /** Original contract tag this pin mirrors. */
  tag: string;
  scl_type: "Bool" | "Int";
  /** Physical IO address for the MAP FC (empty when none is known). */
  address: string;
}

/** One linear SFC step inside a sequential EM state. */
export interface EmSeqStep {
  /** 1-based step counter within its state. */
  step: number;
  /** Stable region id `${stateId}.${step}` — drives the AI-fill markers. */
  fillId: string;
  /** Action prose (deterministic stub body + AI brief). */
  actionProse: string;
  /** SCL boolean that advances PAST this step; `TRUE` when none. */
  advance: string;
  /** True when any completion criterion is manual/placeholder. */
  manual: boolean;
}

/** One state in the ordered EM state machine. */
export interface EmSeqState {
  stateId: string;
  name: string;
  /** 0-based dispatch index; 0 is the home/safe state. */
  index: number;
  /** Derived from the PackML state_pattern for canonical slugs; the authored
   *  kind only survives for legacy non-PackML slugs. */
  kind: "static" | "sequential";
  isSafe: boolean;
  /** Static-state actuator commands: pin + whether driven active. */
  staticCommands: { pin: string; active: boolean }[];
  /** Linear SFC steps (rendered whenever present, regardless of kind). */
  steps: EmSeqStep[];
  /** Outgoing edges to other state indices. */
  exits: { toIndex: number; condition: string; viaCompletion: boolean }[];
}

/** Lowered, serialization-ready IR for one EM Function Block. */
export interface EmSequence {
  emId: string;
  emName: string;
  sclName: string;
  states: EmSeqState[];
  /** Fixed command inputs every EM FB exposes. */
  cmdPins: string[];
  /** Coordination interlock inputs (unwired in C1; Unit layer wires them). */
  interlockPins: string[];
  /** Sensor feedback inputs (own DI/AI). */
  sensors: EmPin[];
  /** Actuator command outputs (carry their physical address for the MAP FC). */
  actuators: EmPin[];
  warnings: string[];
}
