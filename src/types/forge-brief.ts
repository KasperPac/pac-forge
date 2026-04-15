// ---------------------------------------------------------------------------
// Assembly Behavioral Brief — FDS-derived data for assembly FB generation
// ---------------------------------------------------------------------------

import type { DeviceStateEntry, StepEntry, OperatingState } from "@/types/spec-builder";

/** Alarm condition relevant to an assembly's devices */
export interface AssemblyAlarm {
  code: string;
  name: string;
  severity: string;
  description: string;
  triggerCondition: string;
  action: string;
}

/**
 * Per-assembly behavioral brief derived from FDS data.
 * This is what the engineer reviews before assembly FB generation.
 * When spec_project_id is set: populated from fds_assembly_sessions.
 * When standalone: populated from SpecAnalysis + AI contract suggestion.
 */
export interface AssemblyBrief {
  assemblyId: string;
  assemblyTag: string;
  assemblyName: string;
  assemblyType: string;
  subsystemName: string;
  /** Device IDs belonging to this assembly */
  deviceIds: string[];

  /** Operating states from spec_projects.confirmed_states */
  operatingStates: OperatingState[];

  /** Static state device tables — what every output does in IDLE, E-STOP, etc.
   *  Keyed by state_id. From fds_assembly_sessions.static_states */
  staticStates: Record<string, DeviceStateEntry[]>;

  /** Sequential state step sequences — STARTING, EXECUTE, STOPPING, etc.
   *  Keyed by state_id. From fds_assembly_sessions.sequential_states */
  sequentialStates: Record<string, {
    permissives: string[];
    steps: StepEntry[];
    notes: string | null;
  }>;

  /** Alarm conditions relevant to this assembly's devices */
  alarmConditions: AssemblyAlarm[];

  /** Engineer annotations — clarifications, overrides, missing info */
  annotations: string[];

  /** Whether the engineer has reviewed and approved this brief */
  approved: boolean;

  /** Source: "fds" when from FDS tables, "standalone" when from SpecAnalysis/AI */
  source: "fds" | "standalone";
}

/** All assembly briefs for a session, keyed by assemblyId */
export type AssemblyBriefMap = Record<string, AssemblyBrief>;

// ---------------------------------------------------------------------------
// Device FB Brief — enriched IO for device FB generation
// ---------------------------------------------------------------------------

import type { ForgeDeviceIoSignal } from "@/types/forge";

/** IO signal enriched with intent and consumer info */
export interface EnrichedIoSignal extends ForgeDeviceIoSignal {
  /** Intent comment: "confirms upper position — read by LFT01 assembly" */
  intentComment: string;
  /** Assembly tags that read/write this signal */
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
