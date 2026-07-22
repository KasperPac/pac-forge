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

/** A discrete alarm (G7-2). `triggerValue` respects fail-safe semantics:
 *  healthy-signal tags (safety-gate healthy conditions) and N/C wired inputs
 *  alarm on 0; everything else on 1. */
export interface HmiDiscreteAlarm {
  /** Symbolic PLC binding (plain tag or DB.member). */
  tag: string;
  triggerValue: 0 | 1;
  className: string;
  text: string;
}

/** A writable numeric field on the Setpoints screen (G7-3). */
export interface HmiSetpointField {
  /** Symbolic PLC binding, e.g. "Belt_CMD.sp_RUN_SPEED" / "CFG_Unit.length_mm". */
  tag: string;
  label: string;
  /** Grouping header (owning EM or unit name). */
  group: string;
  /** G0-10 access: minimum role level; absent = lowest writable level. */
  requiredLevel?: number;
  limits?: { min?: number; max?: number };
}

/** One HMI tag definition (G7-4): symbolic binding, dots → underscores. */
export interface HmiTag {
  name: string;
  plcTag: string;
}

/** A Unified role derived from the G0-10 ladder (G7-5). */
export interface HmiRole {
  name: string;
  level: number;
}

/** Typed screen items (G7-8). Lowered per-kind by hmi-bridge-spec. */
export type HmiScreenItem =
  | { kind: "state_field"; label: string; tag: string; textList: string }
  | {
      kind: "numeric_field";
      label: string;
      tag: string;
      writable: boolean;
      requiredLevel?: number;
      limits?: { min?: number; max?: number };
      unit?: string;
    }
  | { kind: "lamp"; label: string; tag: string; onValue: 0 | 1 }
  | { kind: "toggle"; label: string; tag: string; requiredLevel?: number }
  | { kind: "button_momentary"; label: string; tag: string; requiredLevel?: number }
  | { kind: "alarm_control"; label: string };

export interface HmiScreen {
  name: string;
  title: string;
  /** Minimum role level = max of the items' required levels (G0-10 rule:
   *  screens DERIVE from item levels). Absent = open. */
  requiredLevel?: number;
  items: HmiScreenItem[];
}

export interface HmiIr {
  tags: HmiTag[];
  textLists: HmiTextList[];
  alarmClasses: HmiAlarmClass[];
  alarms: HmiDiscreteAlarm[];
  setpoints: HmiSetpointField[];
  roles: HmiRole[];
  screens: HmiScreen[];
}
