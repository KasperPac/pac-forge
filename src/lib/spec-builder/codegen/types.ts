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

/** One command-conditional hold branch inside a command-driven state (SP-4).
 *  Branches are mutually-evaluated holds, NOT a sequenced SFC — see the
 *  SP-3/SP-4 PackML design. */
export interface EmCommandBranch {
  /** FDS branch label — emitted as the audit comment above the holds. */
  label: string;
  /** Serialized SCL boolean for the branch's `when` permissives. */
  condition: string;
  /** Pin assignments applied while this branch is active. `value` is a
   *  ready-to-emit SCL rvalue (e.g. `"TRUE"`, `"-50"`, `"#sp_X"`) — it already
   *  carries the `#` sigil where needed; the writer must not re-prefix. */
  holds: { pin: string; value: string }[];
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
  /** Static-state actuator holds: pin + ready-to-emit SCL rvalue, typed like
   *  command holds (`"TRUE"`, `"0"`, `"#sp_X"`) — the writer must not re-prefix. */
  staticCommands: { pin: string; value: string }[];
  /** Linear SFC steps (rendered whenever present, regardless of kind). */
  steps: EmSeqStep[];
  /** Command-conditional hold branches (command-driven states only). */
  commandBranches: EmCommandBranch[];
  /** Anti-latch defaults assigned before the branch chain: the union of all
   *  pins any branch or the default_hold touches. `value` is a ready-to-emit
   *  SCL rvalue (e.g. `"TRUE"`, `"-50"`, `"#sp_X"`) — it already carries the
   *  `#` sigil where needed; the writer must not re-prefix. */
  commandDefaults: { pin: string; value: string }[];
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
  /** Symbolic setpoint inputs (Int) generated from non-numeric hold values;
   *  exposed on the command seam so commissioning sets them in the CMD DB. */
  setpointPins: string[];
  /** Coordination interlock inputs (unwired in C1; Unit layer wires them). */
  interlockPins: string[];
  /** Sensor feedback inputs (own DI/AI). */
  sensors: EmPin[];
  /** Actuator command outputs (carry their physical address for the MAP FC). */
  actuators: EmPin[];
  /** Drive CMs detected from the G0-1 model (G1-1); consumed by the MAP
   *  writer's telegram-FB emission (G1-2/G1-3). */
  drives: import("./drive-detect").DriveInstance[];
  warnings: string[];
}
