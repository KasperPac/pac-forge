/**
 * Spec Contract V2 — canonical shape for a functional specification.
 *
 * The Zod schemas below are the source of truth. TypeScript types are
 * derived via `z.infer`. All writers / readers / migrations should
 * validate against these schemas.
 *
 * This file is NEW and does not replace `src/types/spec-builder.ts`.
 * Legacy types remain until a later wave migrates callers.
 *
 * MIGRATION NOTE (wave 3):
 * `sections` was narrowed to `Record<SpecSectionType, SpecSectionRow>` in
 * wave 1 (one row per section_type). This does not fit `functional_description`
 * where a single spec holds one row per (assembly_id, state_id). The container
 * has been widened to `Record<SpecSectionType, SpecSectionRow[]>` so per-
 * (subsystem, state) rows coexist. `SpecSectionRowSchema` itself is unchanged;
 * only the container widens. Callers must iterate — the single-row reducer in
 * `contract.ts#indexSections()` was retired.
 */
import { z } from "zod";

// ============================================================
// Section-type union (mirrors legacy SpecSectionType)
// ============================================================

export const SpecSectionTypeSchema = z.enum([
  // V2 industry-standard FDS sections
  "document_control",
  "system_overview",
  "control_philosophy",
  "functional_description",
  "io_list",
  "alarm_specification",
  "hmi_specification",
  "interfaces",
  "testing_fat",
  "audit_report",
  // Legacy V1 types (kept for backward compatibility)
  "introduction",
  "equipment_description",
  "functional_state",
  "alarm_table",
  "settings_table",
]);
export type SpecSectionType = z.infer<typeof SpecSectionTypeSchema>;

// ============================================================
// Primitives
// ============================================================

export const UuidSchema = z.string().uuid();
export const StateIdSchema = z.string().min(1); // e.g. "ST03"

export const SignalTypeSchema = z.enum(["DI", "DO", "AI", "AO", "internal"]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const IoSignalSourceSchema = z.enum(["wired", "network_telegram"]);

export const TelegramDataTypeSchema = z.enum(["BOOL", "WORD", "INT", "REAL"]);
export type TelegramDataType = z.infer<typeof TelegramDataTypeSchema>;

export const TelegramOffsetSchema = z.object({
  word: z.number().int().nonnegative(),
  bit: z.number().int().min(0).max(15).optional(),
  data_type: TelegramDataTypeSchema,
});
export type TelegramOffset = z.infer<typeof TelegramOffsetSchema>;

// ============================================================
// Network configuration (VFD / bus-level devices)
// ============================================================

export const NetworkProtocolSchema = z.enum([
  "profinet",
  "ethernet_ip",
  "modbus_tcp",
]);
export type NetworkProtocol = z.infer<typeof NetworkProtocolSchema>;

export const GsdmlRefSchema = z.object({
  filename: z.string(),
  sha256: z.string(),
  storage_path: z.string(),
});

export const EdsRefSchema = z.object({
  filename: z.string(),
  sha256: z.string(),
  storage_path: z.string(),
});

export const TelegramStandardSchema = z.union([
  z.literal(1),
  z.literal(20),
  z.literal(102),
  z.literal(105),
  z.literal(350),
  z.literal(352),
  z.literal(353),
]);
export type TelegramStandard = z.infer<typeof TelegramStandardSchema>;

export const ProfinetTelegramSchema = z.object({
  standard: TelegramStandardSchema,
  custom_words: z.number().int().nonnegative().optional(),
});

export const EthernetIpAssemblySchema = z.object({
  input_instance: z.number().int().nonnegative(),
  output_instance: z.number().int().nonnegative(),
  config_instance: z.number().int().nonnegative(),
  rpi_ms: z.number().int().positive(),
});

export const IrtClassSchema = z.enum(["rt", "irt_high", "irt_high_perf"]);
export type IrtClass = z.infer<typeof IrtClassSchema>;

export const VfdFamilySchema = z.enum([
  "sinamics_g120",
  "sinamics_s210",
  "abb_acs880",
  "sew_movidrive",
  "other",
]);
export type VfdFamily = z.infer<typeof VfdFamilySchema>;

export const MotorNameplateSchema = z.object({
  kw: z.number(),
  amps: z.number(),
  rpm: z.number(),
  voltage: z.number(),
});
export type MotorNameplate = z.infer<typeof MotorNameplateSchema>;

export const VfdParamsSchema = z.object({
  freq_min_hz: z.number(),
  freq_max_hz: z.number(),
  ramp_up_s: z.number(),
  ramp_down_s: z.number(),
  motor_nameplate: MotorNameplateSchema,
});
export type VfdParams = z.infer<typeof VfdParamsSchema>;

export const NetworkConfigSchema = z.object({
  protocol: NetworkProtocolSchema,
  ip_address: z.string(),
  subnet_mask: z.string().optional(),
  gateway: z.string().optional(),
  station_name: z.string(),
  gsdml_ref: GsdmlRefSchema.optional(),
  eds_ref: EdsRefSchema.optional(),
  telegram: ProfinetTelegramSchema.optional(),
  assembly: EthernetIpAssemblySchema.optional(),
  update_cycle_ms: z.number().int().positive(),
  irt_class: IrtClassSchema.optional(),
  topology_neighbours: z.array(z.string()).optional(),
  vfd_family: VfdFamilySchema.optional(),
  vfd_params: VfdParamsSchema.optional(),
});
export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;

// ============================================================
// IO signals / devices / assemblies / subsystems
// ============================================================

export const IoSignalDirectionOverlaySchema = z.enum([
  "to_drive",
  "from_drive",
]);

export const IoSignalV2Schema = z.object({
  tag: z.string(),
  signal_type: SignalTypeSchema,
  io_address: z.string(),
  description: z.string(),
  source: IoSignalSourceSchema,
  telegram_offset: TelegramOffsetSchema.optional(),
  direction_overlay: IoSignalDirectionOverlaySchema.optional(),
});
export type IoSignalV2 = z.infer<typeof IoSignalV2Schema>;

export const DeviceV2Schema = z.object({
  device_id: UuidSchema,
  device_name: z.string(),
  device_class: z.string(),
  is_safety: z.boolean(),
  description: z.string(),
  io_signals: z.array(IoSignalV2Schema),
  network_config: NetworkConfigSchema.optional(),
});
export type DeviceV2 = z.infer<typeof DeviceV2Schema>;

export const AssemblyV2Schema = z.object({
  assembly_id: UuidSchema,
  assembly_name: z.string(),
  description: z.string(),
  devices: z.array(DeviceV2Schema),
});
export type AssemblyV2 = z.infer<typeof AssemblyV2Schema>;

export const SubsystemV2Schema = z.object({
  subsystem_id: UuidSchema,
  subsystem_name: z.string(),
  equipment_type: z.string(),
  description: z.string(),
  excluded: z.boolean(),
  assemblies: z.array(AssemblyV2Schema),
});
export type SubsystemV2 = z.infer<typeof SubsystemV2Schema>;

export const HierarchySchema = z.object({
  subsystems: z.array(SubsystemV2Schema),
});
export type Hierarchy = z.infer<typeof HierarchySchema>;

// ============================================================
// Operating states + alarm tiers
// ============================================================

export const StatePatternSchema = z.enum(["static", "sequential"]);
export type StatePattern = z.infer<typeof StatePatternSchema>;

export const OperatingStateV2Schema = z.object({
  state_id: StateIdSchema,
  state_name: z.string(),
  description: z.string(),
  state_pattern: StatePatternSchema,
});
export type OperatingStateV2 = z.infer<typeof OperatingStateV2Schema>;

export const AlarmTierSchema = z.object({
  tier_id: z.string(),
  tier_name: z.string(),
  description: z.string(),
});
export type AlarmTier = z.infer<typeof AlarmTierSchema>;

// ============================================================
// Assembly contract: static + sequential states
// ============================================================

export const DeviceStateEntrySchema = z.object({
  tag: z.string(),
  description: z.string(),
  state: z.string(),
});
export type DeviceStateEntry = z.infer<typeof DeviceStateEntrySchema>;

export const FaultSeveritySchema = z.enum(["warning", "fault"]);
export type FaultSeverity = z.infer<typeof FaultSeveritySchema>;

export const FaultRefSchema = z.object({
  fault_code: z.string(),
  severity: FaultSeveritySchema,
});
export type FaultRef = z.infer<typeof FaultRefSchema>;

// Completion criteria — discriminated union on `kind`
const TagEqualsSchema = z.object({
  kind: z.literal("tag_equals"),
  tag: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  within_ms: z.number().int().nonnegative().optional(),
  on_fail: FaultRefSchema.optional(),
});

const TagCompareSchema = z.object({
  kind: z.literal("tag_compare"),
  tag: z.string(),
  op: z.enum(["<", "<=", ">", ">=", "=="]),
  value: z.number(),
  within_ms: z.number().int().nonnegative().optional(),
  on_fail: FaultRefSchema.optional(),
});

const ExpressionCriterionSchema = z.object({
  kind: z.literal("expression"),
  text: z.string(),
  referenced_tags: z.array(z.string()),
  within_ms: z.number().int().nonnegative().optional(),
  on_fail: FaultRefSchema.optional(),
});

const ManualAckSchema = z.object({
  kind: z.literal("manual_ack"),
  prompt: z.string(),
});

export const CompletionCriterionSchema = z.discriminatedUnion("kind", [
  TagEqualsSchema,
  TagCompareSchema,
  ExpressionCriterionSchema,
  ManualAckSchema,
]);
export type CompletionCriterion = z.infer<typeof CompletionCriterionSchema>;

export const StepV2Schema = z.object({
  step: z.number().int().positive(),
  action: z.string(),
  completion_criteria: z.array(CompletionCriterionSchema),
  completion_criteria_text: z.string(),
  on_fail: FaultRefSchema.optional(),
});
export type StepV2 = z.infer<typeof StepV2Schema>;

export const SequentialStateV2Schema = z.object({
  permissives: z.array(z.string()),
  steps: z.array(StepV2Schema),
  notes: z.string().nullable(),
});
export type SequentialStateV2 = z.infer<typeof SequentialStateV2Schema>;

export const AssemblyContractSchema = z.object({
  assembly_id: UuidSchema,
  subsystem_id: UuidSchema,
  // Keyed by state_id
  static_states: z.record(z.string(), z.array(DeviceStateEntrySchema)),
  sequential_states: z.record(z.string(), SequentialStateV2Schema),
});
export type AssemblyContract = z.infer<typeof AssemblyContractSchema>;

// ============================================================
// Subsystem orchestration (how assemblies coordinate inside a state)
// ============================================================

export const InterAssemblyInterlockSchema = z.object({
  source_assembly: z.string(),
  source_condition: z.string(),
  target_assembly: z.string(),
  effect: z.string(),
});
export type InterAssemblyInterlock = z.infer<typeof InterAssemblyInterlockSchema>;

export const SubsystemStateSequenceSchema = z.object({
  assembly_order: z.array(z.string()), // assembly_ids
  shared_permissives: z.array(z.string()),
  inter_assembly_interlocks: z.array(InterAssemblyInterlockSchema),
  notes: z.string().nullable(),
});
export type SubsystemStateSequence = z.infer<typeof SubsystemStateSequenceSchema>;

// ============================================================
// Alarms / IO list / faults / sections
// ============================================================

export const AlarmRowSchema = z.object({
  id: z.string(),
  tier_id: z.string(),
  device_id: z.string().nullable(),
  assembly_id: z.string().nullable(),
  subsystem_id: z.string().nullable(),
  tag: z.string(),
  description: z.string(),
  action: z.string(),
  setpoint: z.string().optional(),
  delay: z.string().optional(),
  cause_effect: z.unknown().optional(),
});
export type AlarmRow = z.infer<typeof AlarmRowSchema>;

export const IoListEntrySchema = z.object({
  tag: z.string(),
  device_type: z.string(),
  description: z.string(),
  signal_type: SignalTypeSchema,
  io_address: z.string(),
  normal_state: z.string(),
  failsafe_state: z.string(),
  assembly_id: z.string().optional(),
  device_id: z.string().optional(),
});
export type IoListEntry = z.infer<typeof IoListEntrySchema>;

export const FaultRowSchema = z.object({
  fault_code: z.string(),
  description: z.string(),
  triggered_by_tag: z.string(),
  severity: FaultSeveritySchema,
  affected_devices: z.array(z.string()), // device_ids
  action_text: z.string(),
});
export type FaultRow = z.infer<typeof FaultRowSchema>;

export const SpecSectionRowSchema = z.object({
  id: UuidSchema,
  spec_project_id: UuidSchema,
  section_type: SpecSectionTypeSchema,
  subsystem_id: z.string().nullable(),
  assembly_id: UuidSchema.nullable(),
  state_id: z.string().nullable(),
  state_pattern: StatePatternSchema.nullable(),
  granularity: z.enum(["assembly_state", "subsystem", "project"]),
  content_json: z.record(z.string(), z.unknown()),
  content_markdown: z.string().nullable(),
  model_used: z.string().nullable(),
  generation_prompt: z.string().nullable(),
  token_usage: z.record(z.string(), z.unknown()),
  reviewed_by: z.string().nullable(),
  review_notes: z.string().nullable(),
  approved: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SpecSectionRow = z.infer<typeof SpecSectionRowSchema>;

// ============================================================
// Project header
// ============================================================

export const SpecProjectHeaderSchema = z.object({
  id: UuidSchema,
  doc_code: z.string(),
  title: z.string(),
  client_name: z.string(),
  project_number: z.string().nullable(),
  plc_model: z.string().nullable(),
  hmi_type: z.string().nullable(),
  comms_protocol: z.string().nullable(),
  safety_classification: z.string().nullable(),
  fault_philosophy: z.string().nullable(),
  design_principles: z.array(z.string()),
  scope_exclusions: z.array(z.string()),
});
export type SpecProjectHeader = z.infer<typeof SpecProjectHeaderSchema>;

// ============================================================
// Top-level contract
// ============================================================

export const SpecContractV2Schema = z.object({
  schema_version: z.literal(2),
  project: SpecProjectHeaderSchema,
  hierarchy: HierarchySchema,
  states: z.array(OperatingStateV2Schema),
  alarm_tiers: z.array(AlarmTierSchema),
  // Keyed by assembly_id
  assemblies: z.record(z.string(), AssemblyContractSchema),
  // orchestrations[subsystem_id][state_id] -> SubsystemStateSequence
  orchestrations: z.record(
    z.string(),
    z.record(z.string(), SubsystemStateSequenceSchema),
  ),
  alarms: z.array(AlarmRowSchema),
  io_list: z.array(IoListEntrySchema),
  faults: z.array(FaultRowSchema),
  sections: z.record(SpecSectionTypeSchema, z.array(SpecSectionRowSchema)),
});
export type SpecContractV2 = z.infer<typeof SpecContractV2Schema>;
