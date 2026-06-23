/** Artifact kinds this compiler emits. */
export type CodegenArtifactType = "UDT" | "FB" | "FC" | "DB" | "OB";

/** A generated SCL source unit, shaped for the TIA export plumbing. */
export interface CodegenArtifact {
  name: string;
  type: CodegenArtifactType;
  filename: string;
  content: string;
  dependencies: string[];
  folder: string;
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
