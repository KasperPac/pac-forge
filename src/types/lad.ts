// ---------------------------------------------------------------------------
// Ladder Logic (LAD) Types for Siemens TIA Portal
// ---------------------------------------------------------------------------

export const LAD_ELEMENT_TYPES = {
  NO_CONTACT: "NO_CONTACT",
  NC_CONTACT: "NC_CONTACT",
  OUTPUT_COIL: "OUTPUT_COIL",
  SET_COIL: "SET_COIL",
  RESET_COIL: "RESET_COIL",
  TON: "TON",
  TOF: "TOF",
  CTU: "CTU",
  CTD: "CTD",
  CMP: "CMP",
  MATH: "MATH",
  MOVE: "MOVE",
  FB_CALL: "FB_CALL",
} as const;

export type LadElementType =
  (typeof LAD_ELEMENT_TYPES)[keyof typeof LAD_ELEMENT_TYPES];

export const LAD_CMP_OPERATORS = ["==", "!=", ">", "<", ">=", "<="] as const;
export type LadCmpOperator = (typeof LAD_CMP_OPERATORS)[number];

export const LAD_MATH_OPERATORS = ["ADD", "SUB", "MUL", "DIV"] as const;
export type LadMathOperator = (typeof LAD_MATH_OPERATORS)[number];

/** Labels for display */
export const LAD_ELEMENT_LABELS: Record<LadElementType, string> = {
  NO_CONTACT: "NO Contact",
  NC_CONTACT: "NC Contact",
  OUTPUT_COIL: "Coil",
  SET_COIL: "Set Coil",
  RESET_COIL: "Reset Coil",
  TON: "TON Timer",
  TOF: "TOF Timer",
  CTU: "Count Up",
  CTD: "Count Down",
  CMP: "Compare",
  MATH: "Math",
  MOVE: "Move",
  FB_CALL: "FB Call",
};

/** Whether an element type is a "box" (wide, multi-pin) vs simple contact/coil */
export function isBoxElement(type: LadElementType): boolean {
  return ["TON", "TOF", "CTU", "CTD", "CMP", "MATH", "MOVE", "FB_CALL"].includes(type);
}

/** Whether an element type is an output (coil-side) element */
export function isOutputElement(type: LadElementType): boolean {
  return ["OUTPUT_COIL", "SET_COIL", "RESET_COIL"].includes(type);
}

// ---------------------------------------------------------------------------
// FB Call parameter wiring
// ---------------------------------------------------------------------------

export interface FbCallParam {
  /** Parameter name on the FB interface (e.g. "start", "speed") */
  name: string;
  /** Direction: input, output, or inout */
  direction: "in" | "out" | "inout";
  /** Connected tag/operand (e.g. "Inputs.startButton", "HmiData.cv01Run") */
  value: string;
  /** Data type (e.g. "Bool", "Int", "Real", "Time", "Word") */
  dataType?: string;
}

// ---------------------------------------------------------------------------
// Element (leaf node in the logic tree)
// ---------------------------------------------------------------------------

export interface LadElement {
  id: string;
  type: LadElementType;
  /** Primary operand (tag name) — e.g. "start", "Motor1.Run" */
  operand: string;
  /** Data type — e.g. "Bool", "Int", "Time" */
  dataType?: string;
  /** For CMP: the comparison operator */
  cmpOperator?: LadCmpOperator;
  /** For CMP/MATH: second operand */
  operand2?: string;
  /** For MATH: output operand */
  outputOperand?: string;
  /** For MATH: the math operation */
  mathOperator?: LadMathOperator;
  /** For TON/TOF: preset time value e.g. "T#5s" */
  presetTime?: string;
  /** For CTU/CTD: preset count value */
  presetCount?: number;
  /** For timer/counter boxes: instance DB name */
  instanceDb?: string;
  /** For FB_CALL: name of the FB being called (e.g. "CONVEYOR_FB") */
  fbName?: string;
  /** For FB_CALL: name of the instance DB (e.g. "InstCV01") */
  fbInstanceDb?: string;
  /** For FB_CALL: parameter wiring list */
  callParams?: FbCallParam[];
  /** Optional comment */
  comment?: string;
}

// ---------------------------------------------------------------------------
// Logic Tree (series = AND, parallel = OR)
// ---------------------------------------------------------------------------

/** A chain of nodes connected in series (AND logic) */
export interface LadSeriesChain {
  type: "series";
  nodes: LadNode[];
}

/** A parallel branch group (OR logic) — contains 2+ series chains */
export interface LadParallelBranch {
  type: "parallel";
  id: string;
  branches: LadSeriesChain[];
}

/** A single node is either an element or a parallel group */
export type LadNode =
  | { type: "element"; element: LadElement }
  | LadParallelBranch;

// ---------------------------------------------------------------------------
// Rung / Network
// ---------------------------------------------------------------------------

export interface LadRung {
  id: string;
  /** Network title (shows in TIA Portal) */
  title: string;
  /** Comment for the network */
  comment?: string;
  /** The logic chain: powerrail → series → output */
  logic: LadSeriesChain;
}

// ---------------------------------------------------------------------------
// Variable / Interface
// ---------------------------------------------------------------------------

export interface LadVariable {
  name: string;
  dataType: string;
  section: "Input" | "Output" | "InOut" | "Static" | "Temp";
  initialValue?: string;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Full Program
// ---------------------------------------------------------------------------

export interface LadProgram {
  id: string;
  name: string;
  blockType: "OB" | "FB" | "FC";
  blockNumber?: number;
  variables: LadVariable[];
  rungs: LadRung[];
}

// ---------------------------------------------------------------------------
// Layout types (for rendering)
// ---------------------------------------------------------------------------

export interface LadLayoutNode {
  element?: LadElement;
  parallelId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  branches?: LadLayoutBranch[];
}

export interface LadLayoutBranch {
  nodes: LadLayoutNode[];
  y: number;
  height: number;
}

export interface LadLayoutRung {
  rungId: string;
  title: string;
  y: number;
  height: number;
  totalWidth: number;
  nodes: LadLayoutNode[];
}
