/**
 * FB Template Interface Contract — structured declaration of how a library
 * FbTemplate is parameterised and wired when it becomes an assembly instance
 * in a spec.
 *
 * Per Docs/ASSEMBLY_FB_LIBRARY_PLAN.md §3.1.
 *
 * Stored as jsonb in fb_templates.interface_contract (migration 075). An empty
 * `{}` (or missing arrays) means the contract is not yet authored — the
 * Co-Author falls back to today's free-form authoring.
 */

// ---------------------------------------------------------------------------
// Role enums (closed sets — extended over time; custom:* escape hatch below)
// ---------------------------------------------------------------------------

export const INTERFACE_INPUT_ROLES = [
  "auto_run",
  "start_cmd",
  "reset_cmd",
  "emergency_stop_in",
  "permissive",
  "upstream_ready",
  "downstream_ready",
  "setpoint",
  "command_mode",
  "command_position",
  "command_level",
  "command_lane",
  "command_extend",
  "other",
] as const;
export type CustomRoleValue = `custom:${string}`;

export type InterfaceInputRole =
  | (typeof INTERFACE_INPUT_ROLES)[number]
  | CustomRoleValue;

export const INTERFACE_OUTPUT_ROLES = [
  "running",
  "at_home",
  "at_target",
  "at_position",
  "at_speed",
  "at_level",
  "extended",
  "retracted",
  "in_transit",
  "moving",
  "lifted",
  "lowered",
  "faulted",
  "fault_code",
  "package_at_discharge",
  "package_delivered",
  "cycle_complete",
  "ready",
  "full",
  "empty",
  "package_count",
  "emergency_descend_active",
  "other",
] as const;
export type InterfaceOutputRole =
  | (typeof INTERFACE_OUTPUT_ROLES)[number]
  | CustomRoleValue;

export const IO_SLOT_ROLES = [
  "discharge_sensor",
  "infeed_sensor",
  "home_sensor",
  "position_sensor",
  "level_sensor",
  "end_of_travel_sensor",
  "run_command",
  "direction_command",
  "fault_feedback",
  "running_feedback",
  "interlock_input",
  "actuator_command",
  "extend_command",
  "retract_command",
  "lift_command",
  "lower_command",
  "rotate_command",
  "vsd_drive",
  "motor_contactor",
  "overload_relay",
  "brake_release",
  "other",
] as const;
export type IoSlotRole =
  | (typeof IO_SLOT_ROLES)[number]
  | CustomRoleValue;

// ---------------------------------------------------------------------------
// Data types accepted in interface declarations
// ---------------------------------------------------------------------------

export const INTERFACE_DATA_TYPES = [
  "BOOL",
  "INT",
  "DINT",
  "REAL",
  "TIME",
  "WORD",
  "DWORD",
  "STRING",
  "UDT",
] as const;
export type InterfaceDataType = (typeof INTERFACE_DATA_TYPES)[number];

export const SIGNAL_TYPES = ["DI", "DO", "AI", "AO"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SLOT_CARDINALITIES = ["one", "zero_or_one", "one_or_more"] as const;
export type SlotCardinality = (typeof SLOT_CARDINALITIES)[number];

// ---------------------------------------------------------------------------
// Field shapes
// ---------------------------------------------------------------------------

export interface FbInterfaceInput {
  /** Display name shown in the Co-Author wiring form */
  name: string;
  /** Exact SCL var name in the FB declaration (may differ from display `name` if aliased) */
  tia_name: string;
  data_type: InterfaceDataType;
  /** Required when data_type === "UDT" */
  udt_name?: string;
  role: InterfaceInputRole;
  description: string;
  /**
   * Long-form description used when the template is loaded into an
   * agent prompt — purpose, expected range, failure modes, etc. Optional.
   */
  agent_description?: string;
  /** SCL literal (e.g. "TRUE", "T#5s", "100"). Optional. */
  default_value?: string;
  required: boolean;
}

export interface FbInterfaceOutput {
  name: string;
  tia_name: string;
  data_type: InterfaceDataType;
  udt_name?: string;
  role: InterfaceOutputRole;
  description: string;
  /** Long-form description for agent prompts. Optional. */
  agent_description?: string;
}

export interface FbIoSlot {
  /** Slot name used as the key in instance_params (e.g. "discharge_photoeye") */
  slot_name: string;
  signal_type: SignalType;
  role: IoSlotRole;
  description: string;
  /** Long-form description for agent prompts. Optional. */
  agent_description?: string;
  cardinality: SlotCardinality;
}

export interface FbInterfaceContract {
  inputs: FbInterfaceInput[];
  outputs: FbInterfaceOutput[];
  /**
   * ProcessState / ProcessLogic UDT members this FB reads.
   * E.g. ["ProcessLogic.SAFETY_HEALTHY", "ProcessState_INFEED.TT_IN_AtHome"].
   * The subsystem orchestration uses these to wire the bus.
   */
  process_state_reads: string[];
  /**
   * ProcessState UDT members this FB writes.
   * E.g. ["ProcessState_INFEED.CV_IN_01_PackageReady"].
   * Per-subsystem ProcessState UDTs are auto-built from the union of all
   * member assemblies' writes (plan §3.4).
   */
  process_state_writes: string[];
  io_slots: FbIoSlot[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const EMPTY_INTERFACE_CONTRACT: FbInterfaceContract = {
  inputs: [],
  outputs: [],
  process_state_reads: [],
  process_state_writes: [],
  io_slots: [],
};

/**
 * Coerce arbitrary jsonb (which may be {}, partially-shaped, or fully-shaped)
 * into a fully-populated FbInterfaceContract with empty arrays for missing fields.
 * Use this at every read site so consumers don't need to defend against {}.
 */
export function normaliseInterfaceContract(
  raw: unknown,
): FbInterfaceContract {
  if (!raw || typeof raw !== "object") return { ...EMPTY_INTERFACE_CONTRACT };
  const r = raw as Partial<FbInterfaceContract>;
  return {
    inputs: Array.isArray(r.inputs) ? r.inputs : [],
    outputs: Array.isArray(r.outputs) ? r.outputs : [],
    process_state_reads: Array.isArray(r.process_state_reads) ? r.process_state_reads : [],
    process_state_writes: Array.isArray(r.process_state_writes) ? r.process_state_writes : [],
    io_slots: Array.isArray(r.io_slots) ? r.io_slots : [],
  };
}

/**
 * True when the contract has any populated declarations.
 * Used to decide whether the Co-Author renders the structured wiring form
 * vs falls back to today's free-form authoring (per plan §3.3).
 */
export function isContractPopulated(contract: FbInterfaceContract): boolean {
  return (
    contract.inputs.length > 0 ||
    contract.outputs.length > 0 ||
    contract.io_slots.length > 0 ||
    contract.process_state_reads.length > 0 ||
    contract.process_state_writes.length > 0
  );
}

// ---------------------------------------------------------------------------
// Custom role helpers
// ---------------------------------------------------------------------------

const CUSTOM_ROLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function isCustomRole(role: string): role is CustomRoleValue {
  return role.startsWith("custom:");
}

/** Format a custom role for display: "custom:my_thing" → "My Thing (custom)" */
export function customRoleLabel(role: CustomRoleValue): string {
  const name = role.slice("custom:".length);
  const titled = name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${titled} (custom)`;
}

/**
 * Validate and normalise a user-typed custom role name into a CustomRoleValue.
 * Returns null when the name is invalid (must match [a-z][a-z0-9_]*).
 */
export function buildCustomRoleValue(rawName: string): CustomRoleValue | null {
  const cleaned = rawName.trim().toLowerCase().replace(/\s+/g, "_");
  if (!CUSTOM_ROLE_NAME_RE.test(cleaned)) return null;
  return `custom:${cleaned}` as CustomRoleValue;
}
