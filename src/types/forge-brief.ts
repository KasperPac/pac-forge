// ---------------------------------------------------------------------------
// Equipment Module Behavioral Brief — FDS-derived data for equipment_module FB generation
// ---------------------------------------------------------------------------

import type { ControlModuleStateEntry, StepEntry, OperatingState } from "@/types/spec-builder";

/** Alarm condition relevant to an equipment_module's control_modules */
export interface EquipmentModuleAlarm {
  code: string;
  name: string;
  severity: string;
  description: string;
  triggerCondition: string;
  action: string;
}

/**
 * Per-equipment_module behavioral brief derived from FDS data.
 * This is what the engineer reviews before equipment_module FB generation.
 * When spec_project_id is set: populated from fds_operation_sessions.
 * When standalone: populated from SpecAnalysis + AI contract suggestion.
 */
export interface EquipmentModuleBrief {
  equipment_moduleId: string;
  equipment_moduleTag: string;
  equipment_moduleName: string;
  equipment_moduleType: string;
  unitName: string;
  /** Device IDs belonging to this equipment_module */
  deviceIds: string[];

  /** This EM's OWN operating states (hybrid state model), derived from
   *  fds_operation_sessions.em_states. */
  operatingStates: OperatingState[];

  /** Static state device tables — what every output does in IDLE, E-STOP, etc.
   *  Keyed by state_id. From fds_operation_sessions.static_states */
  staticStates: Record<string, ControlModuleStateEntry[]>;

  /** Sequential state step sequences — STARTING, EXECUTE, STOPPING, etc.
   *  Keyed by state_id. From fds_operation_sessions.sequential_states */
  sequentialStates: Record<string, {
    permissives: string[];
    steps: StepEntry[];
    notes: string | null;
  }>;

  /** Alarm conditions relevant to this equipment_module's control_modules */
  alarmConditions: EquipmentModuleAlarm[];

  /** Engineer annotations — clarifications, overrides, missing info */
  annotations: string[];

  /** Whether the engineer has reviewed and approved this brief */
  approved: boolean;

  /** Source: "fds" when from FDS tables, "standalone" when from SpecAnalysis/AI */
  source: "fds" | "standalone";
}

/** All equipment_module briefs for a session, keyed by equipment_moduleId */
export type EquipmentModuleBriefMap = Record<string, EquipmentModuleBrief>;

// ---------------------------------------------------------------------------
// Device FB Brief — enriched IO for device FB generation
// ---------------------------------------------------------------------------

import type { ForgeDeviceIoSignal } from "@/types/forge";

/** IO signal enriched with intent and consumer info */
export interface EnrichedIoSignal extends ForgeDeviceIoSignal {
  /** Intent comment: "confirms upper position — read by LFT01 equipment_module" */
  intentComment: string;
  /** Equipment Module tags that read/write this signal */
  consumedBy: string[];
  /** Normal state from FDS IO list (e.g. "OPEN", "0V") */
  normalState?: string;
  /** Failsafe state from FDS IO list (e.g. "CLOSED", "0V") */
  failsafeState?: string;
}

/** Pre-generation brief for a device FB */
export interface DeviceFbBrief {
  deviceId: string;
  enrichedSignals: EnrichedIoSignal[];
  /** Operating modes extracted from spec/FDS */
  operatingModes: string[];
  /** Safety requirements */
  safetyRequirements: string[];
  /** Whether the engineer has reviewed this brief */
  approved: boolean;
}
