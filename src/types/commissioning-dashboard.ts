export type DashTagType = "Bool" | "Int" | "DInt" | "Real" | "Word" | "Time";

/**
 * What a signal means to the mimic, so a tile can be coloured without knowing
 * any project's naming. `fault` is taken from the contract's fault/alarm list
 * where possible rather than guessed from the tag text.
 */
export type DashSignalRole = "command" | "feedback" | "fault" | "value";

export interface DashTag {
  /** canonical symbolic name, UNQUOTED, e.g. "EM_Drive_DB.state" or "M01_Fbk" */
  id: string;
  type: DashTagType;
  label: string;
  role?: DashSignalRole;
}

export interface DashCommand {
  tag: string;
  type: DashTagType;
  label: string;
  /** momentary = write true then false after a short pulse; false = level toggle */
  momentary: boolean;
}

export interface DashDevice {
  id: string;
  name: string;
  tag: string;
  deviceType: string;
  /** ISA-88 placement — the mimic groups the plant by these. */
  unit: string;
  em: string;
  instanceDb: string | null;
  signals: DashTag[];
  commands: DashCommand[];
}

export interface DashEmState { index: number; name: string; }
export interface DashEmTransition { from: string; to: string; label: string; }

export interface DashEm {
  id: string;
  name: string;
  unit: string;
  stateTag: string;
  states: DashEmState[];
  transitions: DashEmTransition[];
  commands: DashCommand[];
}

export interface DashAlarm {
  tag: string;
  /** active when tag === true ("hi") or tag === false ("lo") */
  trigger: "hi" | "lo";
  class: "Fault" | "Warning";
  text: string;
}

export interface DashSetpoint {
  tag: string;
  type: DashTagType;
  label: string;
  min: number | null;
  max: number | null;
}

/** command→feedback rule; EMITTED in Plan 1, CONSUMED by the Plan 2 sim engine */
export interface DashSimRule {
  deviceId: string;
  triggerTag: string;
  triggerValue: boolean | number;
  responseTag: string;
  responseValue: boolean | number;
  responseType: DashTagType;
  delayMs: number;
  faultInjectable: boolean;
  description: string;
}

/**
 * One physical IO point, for the IO page. Carries the absolute address so the
 * page doubles as the commissioning check that the spec's addresses are the
 * ones actually in the PLC (G0-18).
 */
export interface DashIoPoint {
  tag: string;
  /** DI | DO | AI | AO — the IO class, used to group the page. */
  signalType: string;
  type: DashTagType;
  /** absolute address as authored, e.g. "%I16.0"; empty when unaddressed */
  address: string;
  label: string;
  deviceName: string;
}

export interface DashboardModel {
  project: { name: string; specId: string; revision: number; generatedNote: string };
  devices: DashDevice[];
  /** every wired physical point, ordered DI → DO → AI → AO */
  io: DashIoPoint[];
  ems: DashEm[];
  alarms: DashAlarm[];
  setpoints: DashSetpoint[];
  simRules: DashSimRule[];
  /** union of every tag the poll loop must read */
  readTags: DashTag[];
  warnings: string[];
}
