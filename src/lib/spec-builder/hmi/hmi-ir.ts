// src/lib/spec-builder/hmi/hmi-ir.ts
//
// G7 — typed intermediate representation for the FDS → HMI compiler.
// Built by hmi-compiler.ts, lowered by hmi-bridge-spec.ts (bridge JSON) and
// the build-pack markdown renderer. Grows per G7 wave; W1 carries text lists
// and alarm classes.
// Design: Docs/superpowers/specs/2026-07-22-g7-hmi-compiler-design.md

/** An index→text list bound to one state word (EM `.state` / unit `.Cur_St`). */
export interface HmiTextList {
  /** Unified text-list name, e.g. "Belt_Drive_States". */
  name: string;
  /** Symbolic PLC binding the consuming state field reads, e.g.
   *  "EM_Belt_Drive_DB.state". */
  stateTag: string;
  /** Dispatch-order entries — index MUST equal the PLC's runtime state value. */
  entries: { index: number; text: string }[];
}

/** An alarm class (G7-6). Bridge creates missing classes (G8-2). */
export interface HmiAlarmClass {
  name: string;
  /** TRUE = operator acknowledgement required (Fault); FALSE = state-only (Warning). */
  acknowledgement: boolean;
}

export interface HmiIr {
  textLists: HmiTextList[];
  alarmClasses: HmiAlarmClass[];
}
