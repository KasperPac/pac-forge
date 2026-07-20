/**
 * Spec Contract V3 (ISA-88) — canonical shape for a functional specification.
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
 * where a single spec holds one row per (equipment_module_id, state_id). The container
 * has been widened to `Record<SpecSectionType, SpecSectionRow[]>` so per-
 * (subsystem, state) rows coexist. `SpecSectionRowSchema` itself is unchanged;
 * only the container widens. Callers must iterate — the single-row reducer in
 * `contract.ts#indexSections()` was retired.
 *
 * WAVE A (SFC + system orchestration):
 * - `PhaseStepSchema` widened with SFC-shaped fields (`step_id`, `branch_id`,
 *   `actions`, `monitors`, `transitions`, `timeout_ms`). Legacy fields
 *   (`step`, `action`, `completion_criteria*`, `on_fail`) remain — they are
 *   read during the shim window. Sequence model version is declared on
 *   `SequentialStateV2Schema.sequence_model_version` (1 = legacy, 2 = SFC).
 * - `ActionV2Schema` / `ExpressionSchema` — discriminated unions for
 *   structured actions and value sources. Every variant carries a `prose`
 *   field so DOCX rendering stays stable.
 * - `CompletionCriterionSchema` now admits a `placeholder` arm for
 *   TBD guards/permissives.
 * - `IoSignalV2Schema` gained `tier` — `"wired"` (instrument register) vs
 *   `"fb_instance"` (resolved once a device's FB template is assigned).
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
// Project-level sections (§3.5 — new in FDS Engine Phase 1)
// The six section types that are not keyed by (assembly_id, state_id).
// Their editable content lives in spec_projects.section_overrides.
// ============================================================

export const ProjectSectionTypeSchema = z.enum([
  "document_control",
  "system_overview",
  "control_philosophy",
  "interfaces",
  "testing_fat",
  "hmi_specification",
]);
export type ProjectSectionType = z.infer<typeof ProjectSectionTypeSchema>;

export const ProjectSectionContentSchema = z
  .object({
    content_markdown: z.string().optional(),
    content_json: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((c) => c.content_markdown !== undefined || c.content_json !== undefined, {
    message: "ProjectSectionContent must have content_markdown or content_json",
  });
export type ProjectSectionContent = z.infer<typeof ProjectSectionContentSchema>;

// ============================================================
// Primitives
// ============================================================

export const UuidSchema = z.string().uuid();

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
// Operator modes (§3.1 — new in FDS Engine Phase 1)
// Project-level operating mode axis. Every state and orchestration
// row is keyed by (mode_id, state_id).
// ============================================================

// Semantic mode kinds (G0-9). Writer/coordinator behavior keys off `kind`,
// never off mode names — generic across machine types:
//   production   — the normal mode; full authored state model.
//   maintenance  — drives commanded to Stopped; override/preset seams (G3).
//   manual       — operator-paced motion.
//   engineering  — never exposed on the HMI; coordinator releases command pins.
//   custom       — no writer-attached behavior beyond the authored masks.
export const ModeKindSchema = z.enum([
  "production",
  "maintenance",
  "manual",
  "engineering",
  "custom",
]);
export type ModeKind = z.infer<typeof ModeKindSchema>;

export const OperatorModeSchema = z.object({
  mode_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  is_default: z.boolean(),
  // .default("custom") so contracts stored before G0-9 parse unchanged.
  kind: ModeKindSchema.default("custom"),
});
export type OperatorMode = z.infer<typeof OperatorModeSchema>;

// ============================================================
// Configuration parameters (§3.4 — new in FDS Engine Phase 1)
// Discrete-enum project-level switches. Substituted as string
// literals at expression evaluation time.
// ============================================================

export const ConfigParameterSchema = z
  .object({
    parameter_id: z.string().min(1),
    name: z.string().min(1),
    allowed_values: z.array(z.string()).min(1),
    default: z.string(),
    description: z.string().optional(),
  })
  .refine((p) => p.allowed_values.includes(p.default), {
    message: "default must be one of allowed_values",
    path: ["default"],
  });
export type ConfigParameter = z.infer<typeof ConfigParameterSchema>;

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
// Drive/VSD model (G0-1) — tier-1 signable FDS content.
// Tier-2 record-only commissioning values (HW ids, RefSpeed=p2000,
// ConfigAxis) live in EngineeringDataV1.drives, keyed by CM id.
// Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md
// ============================================================

// "percent_ref_speed": setpoints/feedback are percent of the tier-2
// ref_speed_rpm (drive p2000) — the golden-master convention. "rpm"/"hz"
// mean raw engineering units (writer emits no scaling).
export const SpeedRefUnitSchema = z.enum(["percent_ref_speed", "rpm", "hz"]);
export type SpeedRefUnit = z.infer<typeof SpeedRefUnitSchema>;

export const DriveEnablePolicySchema = z.enum([
  "enable_on_nonzero_ref", // EnableAxis := ref <> 0
  "explicit_enable", // enable pin driven by the EM command seam
]);
export type DriveEnablePolicy = z.infer<typeof DriveEnablePolicySchema>;

export const DriveModelV1Schema = z.object({
  family: VfdFamilySchema,
  // PROFINET-telegram families (Siemens) carry it; assembly/vendor-profile
  // families (ABB EtherNet/IP, SEW) must not — enforced in drive-model.ts.
  telegram: TelegramStandardSchema.optional(),
  speed_ref: z.object({
    unit: SpeedRefUnitSchema,
    signed: z.boolean(),
  }),
  enable_policy: DriveEnablePolicySchema,
});
export type DriveModelV1 = z.infer<typeof DriveModelV1Schema>;

// ============================================================
// IO signals / control modules / equipment modules / units
// ============================================================

export const IoSignalDirectionOverlaySchema = z.enum([
  "to_drive",
  "from_drive",
]);

// ============================================================
// Per-IO signal model (G0-2) — tier-1 signable FDS content.
// Blanket no-meaning conditioning defaults are tier 2
// (EngineeringDataV1.io_conditioning_defaults).
// Design: Docs/superpowers/specs/2026-07-20-g0-2-io-signal-model-design.md
// ============================================================

// Digital wiring polarity. "nc" = normally-closed fail-safe wiring: the
// healthy/untripped state reads TRUE at the terminal, so the MAP writer
// (G1-4) emits a NOT inversion to hand the EM a TRUE=abnormal signal —
// the golden master's `:= NOT "IO_Cond".CM1_Therm` lines.
export const IoPolaritySchema = z.enum(["no", "nc"]);
export type IoPolarity = z.infer<typeof IoPolaritySchema>;

// Functionally significant conditioning ONLY (e.g. "absent 5 s before
// fault" => off_delay_ms: 5000). Blanket filter times belong in
// engineering.io_conditioning_defaults (tier 2), not here.
export const IoConditioningSchema = z.object({
  on_delay_ms: z.number().int().nonnegative().optional(),
  off_delay_ms: z.number().int().nonnegative().optional(),
});
export type IoConditioning = z.infer<typeof IoConditioningSchema>;

export const RawSignalUnitSchema = z.enum(["mA", "V", "counts"]);
export type RawSignalUnit = z.infer<typeof RawSignalUnitSchema>;

// Raw electrical range ↔ engineering-unit range. Signable: FDS behavior
// (alarm setpoints, permissives, envelope limits) is written in eu units.
// EU range may be inverted; raw min≠max enforced in io-signal-model.ts.
export const AnalogScalingSchema = z.object({
  raw: z.object({
    min: z.number(),
    max: z.number(),
    unit: RawSignalUnitSchema,
  }),
  eu: z.object({
    min: z.number(),
    max: z.number(),
    unit: z.string().min(1), // °C, bar, %, mm …
  }),
});
export type AnalogScaling = z.infer<typeof AnalogScalingSchema>;

/**
 * `tier` distinguishes signals that exist at the wired instrument layer
 * (from the hardware IO register — always present) from those that only
 * resolve once a device FB template is assigned (e.g. VFD status bits
 * exposed via an instance DB). Resolution logic lives in a later wave.
 */
export const IoSignalTierSchema = z.enum(["wired", "fb_instance"]);
export type IoSignalTier = z.infer<typeof IoSignalTierSchema>;

export const IoSignalV2Schema = z.object({
  tag: z.string(),
  signal_type: SignalTypeSchema,
  io_address: z.string(),
  description: z.string(),
  source: IoSignalSourceSchema,
  tier: IoSignalTierSchema.optional(),
  telegram_offset: TelegramOffsetSchema.optional(),
  direction_overlay: IoSignalDirectionOverlaySchema.optional(),
  // G0-2 per-signal model — kind constraints enforced in io-signal-model.ts.
  polarity: IoPolaritySchema.optional(),
  conditioning: IoConditioningSchema.optional(),
  scaling: AnalogScalingSchema.optional(),
});
export type IoSignalV2 = z.infer<typeof IoSignalV2Schema>;

export const ControlModuleV2Schema = z.object({
  control_module_id: UuidSchema,
  control_module_name: z.string(),
  control_module_class: z.string(),
  is_safety: z.boolean(),
  description: z.string(),
  io_signals: z.array(IoSignalV2Schema),
  network_config: NetworkConfigSchema.optional(),
  drive: DriveModelV1Schema.optional(),
});
export type ControlModuleV2 = z.infer<typeof ControlModuleV2Schema>;

export const EquipmentModuleV2Schema = z.object({
  equipment_module_id: UuidSchema,
  equipment_module_name: z.string(),
  description: z.string(),
  control_modules: z.array(ControlModuleV2Schema),
});
export type EquipmentModuleV2 = z.infer<typeof EquipmentModuleV2Schema>;

export const UnitV2Schema = z.object({
  unit_id: UuidSchema,
  unit_name: z.string(),
  equipment_type: z.string(),
  description: z.string(),
  excluded: z.boolean(),
  equipment_modules: z.array(EquipmentModuleV2Schema),
});
export type UnitV2 = z.infer<typeof UnitV2Schema>;

export const HierarchySchema = z.object({
  units: z.array(UnitV2Schema),
});
export type Hierarchy = z.infer<typeof HierarchySchema>;

// ============================================================
// Operating states + alarm tiers
// ============================================================

// `state_pattern` scopes a per-(EM, state) section row and the EM-local state
// machine (see EmStateKindSchema). The legacy GLOBAL operating-states layer
// (OperatingStateV2) was removed once states moved per-equipment-module.
export const StatePatternSchema = z.enum(["static", "sequential"]);
export type StatePattern = z.infer<typeof StatePatternSchema>;

export const AlarmTierSchema = z.object({
  tier_id: z.string(),
  tier_name: z.string(),
  description: z.string(),
});
export type AlarmTier = z.infer<typeof AlarmTierSchema>;

// ============================================================
// Equipment Module contract: static + sequential states
// ============================================================

export const ControlModuleStateEntrySchema = z.object({
  tag: z.string(),
  description: z.string(),
  state: z.string(),
});
export type ControlModuleStateEntry = z.infer<typeof ControlModuleStateEntrySchema>;

export const FaultSeveritySchema = z.enum(["warning", "fault", "critical"]);
export type FaultSeverity = z.infer<typeof FaultSeveritySchema>;

export const FaultRefSchema = z.object({
  fault_code: z.string(),
  severity: FaultSeveritySchema,
});
export type FaultRef = z.infer<typeof FaultRefSchema>;

/**
 * Optional field that also tolerates an explicit `null`.
 *
 * AI authors routinely emit `"on_fail": null` (and similar) for "no value" on
 * optional fields; a plain `.optional()` accepts only omitted/`undefined` and
 * rejects explicit `null`, which poisons validation for every project. This
 * coerces `null` → `undefined` BEFORE the inner schema runs, so incoming null
 * is accepted while the parsed output stays clean (`T | undefined`, never
 * null) — no downstream consumer or type changes. Generic across all EMs.
 */
function nullableOptional<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((v) => (v === null ? undefined : v), inner.optional());
}

// Completion criteria — discriminated union on `kind`
const TagEqualsSchema = z.object({
  kind: z.literal("tag_equals"),
  tag: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  within_ms: nullableOptional(z.number().int().nonnegative()),
  on_fail: nullableOptional(FaultRefSchema),
});

const TagCompareSchema = z.object({
  kind: z.literal("tag_compare"),
  tag: z.string(),
  op: z.enum(["<", "<=", ">", ">=", "=="]),
  value: z.number(),
  within_ms: nullableOptional(z.number().int().nonnegative()),
  on_fail: nullableOptional(FaultRefSchema),
});

const ExpressionCriterionSchema = z.object({
  kind: z.literal("expression"),
  text: z.string(),
  referenced_tags: z.array(z.string()),
  within_ms: nullableOptional(z.number().int().nonnegative()),
  on_fail: nullableOptional(FaultRefSchema),
});

const ManualAckSchema = z.object({
  kind: z.literal("manual_ack"),
  prompt: z.string(),
});

// Placeholder inferred-type domain — shared by ExpressionSchema and
// PlaceholderCriterionSchema. Keeps the set of legal "what am I" hints
// consistent across expressions and criteria.
export const PlaceholderInferredTypeSchema = z.enum([
  "tag",
  "control_module",
  "equipment_module",
  "unit",
  "state",
  "value",
]);
export type PlaceholderInferredType = z.infer<
  typeof PlaceholderInferredTypeSchema
>;

const PlaceholderCriterionSchema = z.object({
  kind: z.literal("placeholder"),
  criterion_id: z.string(),
  prompt: z.string(),
  inferred_type: PlaceholderInferredTypeSchema.optional(),
});

export const CompletionCriterionSchema = z.discriminatedUnion("kind", [
  TagEqualsSchema,
  TagCompareSchema,
  ExpressionCriterionSchema,
  ManualAckSchema,
  PlaceholderCriterionSchema,
]);
export type CompletionCriterion = z.infer<typeof CompletionCriterionSchema>;

// ============================================================
// Expressions — discriminated union on `kind`
// Used in structured actions and (via CompletionCriterion.placeholder)
// as a TBD authoring value.
// ============================================================

const ExpressionTagRefSchema = z.object({
  kind: z.literal("tag_ref"),
  tag: z.string(),
});
const ExpressionHmiRefSchema = z.object({
  kind: z.literal("hmi_ref"),
  hmi_tag: z.string(),
});
const ExpressionLiteralSchema = z.object({
  kind: z.literal("literal"),
  value: z.union([z.string(), z.number(), z.boolean()]),
  value_type: z.enum(["string", "number", "boolean"]),
});
const ExpressionTextSchema = z.object({
  kind: z.literal("expr_text"),
  text: z.string(),
  referenced_tags: z.array(z.string()),
});
const ExpressionPlaceholderSchema = z.object({
  kind: z.literal("placeholder"),
  prompt: z.string(),
  inferred_type: PlaceholderInferredTypeSchema.optional(),
});
const ExpressionParameterRefSchema = z.object({
  kind: z.literal("parameter_ref"),
  parameter_id: z.string().min(1),
});

export const ExpressionSchema = z.discriminatedUnion("kind", [
  ExpressionTagRefSchema,
  ExpressionHmiRefSchema,
  ExpressionLiteralSchema,
  ExpressionTextSchema,
  ExpressionPlaceholderSchema,
  ExpressionParameterRefSchema,
]);
export type Expression = z.infer<typeof ExpressionSchema>;

// ============================================================
// Actions — discriminated union on `kind`
// Every variant includes `action_id` + `prose` so the DOCX exporter
// can render a consistent sentence per action regardless of kind.
// ============================================================

const ActionAssignSchema = z.object({
  kind: z.literal("assign"),
  action_id: z.string(),
  target_tag: z.string(),
  source: ExpressionSchema,
  prose: z.string(),
});
const ActionCallFbSchema = z.object({
  kind: z.literal("call_fb"),
  action_id: z.string(),
  fb_template_id: z.string(),
  instance_name: z.string(),
  params: z.record(z.string(), ExpressionSchema),
  prose: z.string(),
});
const ActionStartTimerSchema = z.object({
  kind: z.literal("start_timer"),
  action_id: z.string(),
  timer_tag: z.string(),
  preset_ms: ExpressionSchema,
  prose: z.string(),
});
const ActionStopTimerSchema = z.object({
  kind: z.literal("stop_timer"),
  action_id: z.string(),
  timer_tag: z.string(),
  prose: z.string(),
});
const ActionResetTimerSchema = z.object({
  kind: z.literal("reset_timer"),
  action_id: z.string(),
  timer_tag: z.string(),
  prose: z.string(),
});
const ActionIncrCounterSchema = z.object({
  kind: z.literal("incr_counter"),
  action_id: z.string(),
  counter_tag: z.string(),
  by: ExpressionSchema.optional(),
  prose: z.string(),
});
const ActionResetCounterSchema = z.object({
  kind: z.literal("reset_counter"),
  action_id: z.string(),
  counter_tag: z.string(),
  prose: z.string(),
});
const ActionRaiseAlarmSchema = z.object({
  kind: z.literal("raise_alarm"),
  action_id: z.string(),
  alarm_tag: z.string(),
  prose: z.string(),
});
const ActionManualProseSchema = z.object({
  kind: z.literal("manual_prose"),
  action_id: z.string(),
  text: z.string(),
  referenced_tags: z.array(z.string()),
  prose: z.string(),
});

export const ActionV2Schema = z.discriminatedUnion("kind", [
  ActionAssignSchema,
  ActionCallFbSchema,
  ActionStartTimerSchema,
  ActionStopTimerSchema,
  ActionResetTimerSchema,
  ActionIncrCounterSchema,
  ActionResetCounterSchema,
  ActionRaiseAlarmSchema,
  ActionManualProseSchema,
]);
export type ActionV2 = z.infer<typeof ActionV2Schema>;

// ============================================================
// Monitors — watchdog-style condition handlers on a step or state.
// `priority` disambiguates simultaneous firings (higher wins).
// ============================================================

export const MonitorV2Schema = z.object({
  monitor_id: z.string(),
  condition: CompletionCriterionSchema,
  effect: z.enum(["alarm", "fault", "hold", "branch_to"]),
  fault_ref: nullableOptional(FaultRefSchema),
  target_step_id: z.string().optional(),
  auto_clear: z.boolean(),
  priority: z.number().int(),
});
export type MonitorV2 = z.infer<typeof MonitorV2Schema>;

// ============================================================
// Transitions — SFC-style, discriminated on `kind`.
// `single` = one outgoing edge; `parallel` = AND-split (≥2 targets).
// Cross-branch targets are rejected at write time by writeSpecContract.
// Pre-emption is done via a MonitorV2 with `effect: "fault"`.
// ============================================================

const TransitionSingleSchema = z.object({
  transition_id: z.string(),
  kind: z.literal("single"),
  target_step_id: z.string(),
  guard: z.array(CompletionCriterionSchema),
  priority: z.number().int(),
  is_default: z.boolean(),
  on_fail: nullableOptional(FaultRefSchema),
  notes: z.string().nullable(),
});
const TransitionParallelSchema = z.object({
  transition_id: z.string(),
  kind: z.literal("parallel"),
  target_step_ids: z.array(z.string()).min(2),
  guard: z.array(CompletionCriterionSchema),
  priority: z.number().int(),
  is_default: z.boolean(),
  on_fail: nullableOptional(FaultRefSchema),
  notes: z.string().nullable(),
});
export const TransitionV2Schema = z.discriminatedUnion("kind", [
  TransitionSingleSchema,
  TransitionParallelSchema,
]);
export type TransitionV2 = z.infer<typeof TransitionV2Schema>;

// ============================================================
// Branches — per-sequential-state registry of concurrent flows.
// Every step carries `branch_id`; branches know their fork/join points.
// ============================================================

export const BranchV2Schema = z.object({
  branch_id: z.string(),
  name: z.string(),
  kind: z.enum(["main", "parallel", "monitor"]),
  parent_branch_id: z.string().optional(),
  fork_step_id: z.string(),
  join_step_id: z.string().optional(),
});
export type BranchV2 = z.infer<typeof BranchV2Schema>;

// ============================================================
// Step — legacy fields remain; SFC fields are additive.
// Sequence-model v1 callers ignore the new fields; v2 callers populate
// them and leave the legacy fields synced (action/completion_criteria_text
// are still used by DOCX rendering).
// ============================================================

export const PhaseStepSchema = z.object({
  // SFC (v2) — optional during the shim window so legacy callers that
  // only populate the v1 fields still type-check.
  step_id: z.string().optional(),
  branch_id: z.string().optional(),
  name: z.string().optional(),
  actions: z.array(ActionV2Schema).optional(),
  monitors: z.array(MonitorV2Schema).optional(),
  transitions: z.array(TransitionV2Schema).optional(),
  timeout_ms: z.number().optional(),
  on_timeout: nullableOptional(FaultRefSchema),

  // Legacy (v1) — preserved during the shim window
  step: z.number().int().positive(),
  action: z.string(),
  completion_criteria: z.array(CompletionCriterionSchema),
  completion_criteria_text: z.string(),
  on_fail: nullableOptional(FaultRefSchema),
});
export type PhaseStep = z.infer<typeof PhaseStepSchema>;

export const SequenceModelVersionSchema = z.union([
  z.literal(1),
  z.literal(2),
]);
export type SequenceModelVersion = z.infer<typeof SequenceModelVersionSchema>;

export const PermissiveOperatorSchema = z.enum(["=", "!=", ">", "<", ">=", "<="]);
export type PermissiveOperator = z.infer<typeof PermissiveOperatorSchema>;

export const PermissiveValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.literal("P_TRIG"),
  z.literal("N_TRIG"),
]);
export type PermissiveValue = z.infer<typeof PermissiveValueSchema>;

export const PermissiveConditionSchema = z.object({
  tag: z.string(),
  operator: PermissiveOperatorSchema,
  value: PermissiveValueSchema,
});
export type PermissiveCondition = z.infer<typeof PermissiveConditionSchema>;

export const OverrideKindSchema = z.enum(["inherit", "override", "suppressed"]);
export type OverrideKind = z.infer<typeof OverrideKindSchema>;

export const SequentialStateV2Schema = z.object({
  override_kind: OverrideKindSchema.optional(), // defaults to "override" in readers
  permissives: z.array(PermissiveConditionSchema),
  steps: z.array(PhaseStepSchema),
  branches: z.array(BranchV2Schema).optional(),
  state_monitors: z.array(MonitorV2Schema).optional(),
  sequence_model_version: SequenceModelVersionSchema.optional(),
  notes: z.string().nullable(),
});
export type SequentialStateV2 = z.infer<typeof SequentialStateV2Schema>;

export const StaticStateV2Schema = z.object({
  override_kind: OverrideKindSchema.optional(),
  control_modules: z.array(ControlModuleStateEntrySchema),
  notes: z.string().nullable().optional(),
});
export type StaticStateV2 = z.infer<typeof StaticStateV2Schema>;

// ============================================================
// Per-Equipment-Module state machine (hybrid state model)
// EM-local states + transitions. state_id here is an EM-local
// string slug (e.g. "driving_fwd"). This is the ONLY operating-state
// layer — the legacy global states array was removed.
// ============================================================

// Mirrors StatePatternSchema's values but kept separate: this scopes the
// EM-local state machine, while StatePattern scopes a section row.
export const EmStateKindSchema = z.enum(["static", "sequential"]);
export type EmStateKind = z.infer<typeof EmStateKindSchema>;

export const EmStateV2Schema = z.object({
  state_id: z.string().min(1),
  name: z.string().min(1),
  kind: EmStateKindSchema,
  // Machine modes this state is valid in. Empty = allowed in all modes.
  allowed_modes: z.array(z.string()).default([]),
  // Exactly one state per EM should be marked the safe state (validated
  // in validateEmStateMachine — see em-state-machine.ts).
  is_safe_state: z.boolean().default(false),
});
export type EmStateV2 = z.infer<typeof EmStateV2Schema>;

// Trigger: a command (operator/HMI/tag condition goes true → manual) or
// the completion of the `from` sequential state (automatic). Command
// triggers reuse PermissiveCondition as the expression type.
export const EmTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), expr: PermissiveConditionSchema }),
  z.object({ kind: z.literal("completion") }),
]);
export type EmTrigger = z.infer<typeof EmTriggerSchema>;

export const EmTransitionV2Schema = z.object({
  transition_id: z.string().min(1),
  from_state_id: z.string().min(1),
  to_state_id: z.string().min(1),
  trigger: EmTriggerSchema,
  // AND-ed permissive guard; may reference other EMs' tags for inter-EM
  // interlocks. Empty = no guard. Reuses PermissiveCondition.
  guard: z.array(PermissiveConditionSchema).default([]),
});
export type EmTransitionV2 = z.infer<typeof EmTransitionV2Schema>;

// ============================================================
// Machine-level safety gate. condition is OR-of-faults: the gate is
// VIOLATED (forces scoped EMs to their is_safe_state) when ANY listed
// condition evaluates true. effect is implied (force to safe).
// ============================================================

export const SafetyGateScopeSchema = z.union([
  z.literal("all"),
  z.array(z.string()), // equipment_module_id[]
]);
export type SafetyGateScope = z.infer<typeof SafetyGateScopeSchema>;

export const SafetyGateV2Schema = z.object({
  gate_id: z.string().min(1),
  name: z.string().min(1),
  condition: z.array(PermissiveConditionSchema).min(1),
  scope: SafetyGateScopeSchema,
});
export type SafetyGateV2 = z.infer<typeof SafetyGateV2Schema>;

// A device-hold branch active while an operator/EM command condition holds.
// Manual motions (Drive Fwd/Rev) are branches under command_behavior["execute"],
// NOT states — see the SP-3 PackML design. Generic across machine types.
// NB: fds-compose serializes this for rendering as CommandBranchEntry
// (types/spec-builder.ts — `when: string[]` via serializePermissive); keep the
// two shapes in sync when editing.
export const CommandBranchSchema = z.object({
  branch_id: z.string().min(1),
  label: z.string().min(1),
  when: z.array(PermissiveConditionSchema).min(1),
  control_modules: z.array(ControlModuleStateEntrySchema),
});
export type CommandBranch = z.infer<typeof CommandBranchSchema>;

// Command-conditional behavior for one acting PackML state (primarily
// execute): mutually-evaluated command branches + the hold applied when no
// branch is active.
export const CommandBehaviorV2Schema = z.object({
  branches: z.array(CommandBranchSchema).default([]),
  default_hold: z.array(ControlModuleStateEntrySchema).default([]),
});
export type CommandBehaviorV2 = z.infer<typeof CommandBehaviorV2Schema>;

export const EquipmentModuleContractSchema = z.object({
  equipment_module_id: UuidSchema,
  unit_id: UuidSchema,
  // The EM's OWN state machine (hybrid state model).
  states: z.array(EmStateV2Schema).default([]),
  transitions: z.array(EmTransitionV2Schema).default([]),
  // Per-state behavior. Keyed by EM-LOCAL state_id (EmStateV2.state_id),
  // NOT a global state id. Legacy rows are bare ControlModuleStateEntry
  // arrays; post-confirmation rows use the StaticStateV2 container.
  static_states: z.record(
    z.string(),
    z.union([z.array(ControlModuleStateEntrySchema), StaticStateV2Schema]),
  ),
  sequential_states: z.record(z.string(), SequentialStateV2Schema),
  // Command-conditional device holds for acting PackML states (primarily
  // "execute"), keyed by EM state_id. Optional so the existing
  // EquipmentModuleContract construction sites need not add `command_behavior: {}`;
  // consumers treat absent as {}.
  command_behavior: z.record(z.string(), CommandBehaviorV2Schema).optional(),
});
export type EquipmentModuleContract = z.infer<typeof EquipmentModuleContractSchema>;

// ============================================================
// Alarms / IO list / faults / sections
// ============================================================

export const AlarmRowSchema = z.object({
  id: z.string(),
  tier_id: z.string(),
  control_module_id: z.string().nullable(),
  equipment_module_id: z.string().nullable(),
  unit_id: z.string().nullable(),
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
  equipment_module_id: z.string().optional(),
  control_module_id: z.string().optional(),
});
export type IoListEntry = z.infer<typeof IoListEntrySchema>;

export const FaultRowSchema = z.object({
  fault_code: z.string(),
  description: z.string(),
  triggered_by_tag: z.string(),
  severity: FaultSeveritySchema,
  affected_control_modules: z.array(z.string()), // device_ids
  action_text: z.string(),
});
export type FaultRow = z.infer<typeof FaultRowSchema>;

export const SpecSectionRowSchema = z.object({
  id: UuidSchema,
  spec_project_id: UuidSchema,
  section_type: SpecSectionTypeSchema,
  unit_id: z.string().nullable(),
  equipment_module_id: UuidSchema.nullable(),
  state_id: z.string().nullable(),
  state_pattern: StatePatternSchema.nullable(),
  granularity: z.enum(["equipment_module_state", "unit", "project"]),
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
// Co-author conversation turn
// ============================================================

/**
 * Free-form conversation turn for co-author interviews. Structured just
 * enough for the history log; builder UIs own the full shape elsewhere.
 */
export const FdsConversationTurnSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string(),
  state_context: z.string().optional(),
});
export type FdsConversationTurn = z.infer<typeof FdsConversationTurnSchema>;

// ============================================================
// Top-level contract
// ============================================================

export const ConfirmationStatusSchema = z.enum(["unconfirmed", "confirmed"]);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

// --- ISA-88 Process Model (§4.3) — product-centric hierarchy ---

export const ProcessActionSchema = z.object({
  action_id: z.string().min(1),
  action_name: z.string().min(1),
  description: z.string(),
  control_module_tag: z.string().optional(),
});
export type ProcessActionV2 = z.infer<typeof ProcessActionSchema>;

export const ProcessOperationSchema = z.object({
  operation_id: z.string().min(1),
  operation_name: z.string().min(1),
  description: z.string(),
  equipment_module_id: z.string().min(1),
  actions: z.array(ProcessActionSchema),
});
export type ProcessOperationV2 = z.infer<typeof ProcessOperationSchema>;

export const ProcessStageSchema = z.object({
  stage_id: z.string().min(1),
  stage_name: z.string().min(1),
  description: z.string(),
  unit_id: z.string().min(1),
  operations: z.array(ProcessOperationSchema),
  order: z.number().int().min(1),
});
export type ProcessStageV2 = z.infer<typeof ProcessStageSchema>;

export const ProcessModelSchema = z.object({
  process_name: z.string().min(1),
  process_description: z.string(),
  stages: z.array(ProcessStageSchema),
});
export type ProcessModelV2 = z.infer<typeof ProcessModelSchema>;

// ============================================================
// Unit coordination (G0-9 — PackML-proper unit state machine).
// Each unit owns a generated state machine FB that commands its member
// EMs top-down. One SM per unit; modes may only DISABLE states from the
// canonical set below, never add (`allowed_modes` masks) — formally
// equivalent to ISA-TR88.00.02 per-mode state models.
// Consumers: G2 unit-FB writer, G7 text lists, G8-7 faceplates, G0-12.
// ============================================================

export const UNIT_PACKML_STATES = [
  "idle",
  "starting",
  "execute",
  "completing",
  "complete",
  "resetting",
  "holding",
  "held",
  "unholding",
  "suspending",
  "suspended",
  "unsuspending",
  "stopping",
  "stopped",
  "aborting",
  "aborted",
  "clearing",
] as const;
export const UnitPackMLStateSchema = z.enum(UNIT_PACKML_STATES);
export type UnitPackMLState = z.infer<typeof UnitPackMLStateSchema>;

export const UnitStateV1Schema = z.object({
  state_id: UnitPackMLStateSchema,
  // mode_ids this state is active in; empty = all modes.
  allowed_modes: z.array(z.string()).default([]),
  // Authoring UI should default this true for stopped/idle/aborted.
  mode_change_allowed: z.boolean().default(false),
});
export type UnitStateV1 = z.infer<typeof UnitStateV1Schema>;

export const UnitTransitionTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.enum([
      "start",
      "stop",
      "hold",
      "unhold",
      "suspend",
      "unsuspend",
      "reset",
      "clear",
      "abort",
    ]),
  }),
  z.object({
    type: z.literal("condition"),
    expr: z.array(PermissiveConditionSchema).min(1),
  }),
  // e.g. all member EMs report EM-local state "idle".
  z.object({
    type: z.literal("em_aggregate"),
    em_scope: z.union([z.literal("all"), z.array(z.string())]),
    em_state: z.string().min(1),
  }),
]);
export type UnitTransitionTrigger = z.infer<typeof UnitTransitionTriggerSchema>;

export const UnitTransitionV1Schema = z.object({
  transition_id: z.string().min(1),
  from_state_id: UnitPackMLStateSchema,
  to_state_id: UnitPackMLStateSchema,
  trigger: UnitTransitionTriggerSchema,
  guard: z.array(PermissiveConditionSchema).default([]),
  allowed_modes: z.array(z.string()).default([]),
});
export type UnitTransitionV1 = z.infer<typeof UnitTransitionV1Schema>;

// Per-EM override of the canonical unit-state → EM-command map
// (see CANONICAL_EM_COMMAND_MAP in lib/spec-builder/unit-coordination.ts).
export const EmCommandOverrideSchema = z.object({
  equipment_module_id: UuidSchema,
  command: z.enum(["CLEAR", "RESET", "START", "STOP", "HOLD", "ABORT", "NONE"]),
});
export type EmCommandOverride = z.infer<typeof EmCommandOverrideSchema>;

export const UnitCoordinationV1Schema = z.object({
  unit_id: z.string().min(1),
  states: z.array(UnitStateV1Schema).min(1),
  transitions: z.array(UnitTransitionV1Schema).default([]),
  // Sparse per-unit-state overrides only — canonical defaults apply to
  // absent states. partialRecord: plain z.record over an enum key demands
  // exhaustiveness (same pattern as SpecContractV2.section_overrides).
  // nullableOptional: AI-authored JSON may emit explicit null.
  em_command_overrides: nullableOptional(
    z.partialRecord(UnitPackMLStateSchema, z.array(EmCommandOverrideSchema)),
  ),
});
export type UnitCoordinationV1 = z.infer<typeof UnitCoordinationV1Schema>;

// ============================================================
// Engineering Data (G0-1) — tier-2 record-only container from the
// boundary decision (2026-07-07). Never signable, never HMI-exposed;
// commissioning fills values in. G0-2/G0-4/G0-7 add sibling keys here.
// ============================================================

export const DriveEngineeringEntrySchema = z.object({
  control_module_id: UuidSchema, // must reference a CM carrying `drive`
  hw_id_stw: z.number().int().nonnegative().optional(), // HWIDSTW from TIA HW config
  hw_id_zsw: z.number().int().nonnegative().optional(), // HWIDZSW
  ref_speed_rpm: z.number().positive().optional(), // MUST equal drive p2000
  config_axis: z.number().int().nonnegative().default(0x003f),
  notes: z.string().optional(),
});
export type DriveEngineeringEntry = z.infer<typeof DriveEngineeringEntrySchema>;

// Blanket engineering defaults with no functional meaning (tier 2, G0-2).
// Per-signal tier-1 `conditioning` overrides them where present —
// precedence is a G1-4 writer rule; the contract records both.
export const IoConditioningDefaultsSchema = z.object({
  di_debounce_ms: z.number().int().nonnegative().optional(),
  ai_filter_ms: z.number().int().nonnegative().optional(),
});
export type IoConditioningDefaults = z.infer<typeof IoConditioningDefaultsSchema>;

export const EngineeringDataV1Schema = z.object({
  drives: z.array(DriveEngineeringEntrySchema).default([]),
  io_conditioning_defaults: IoConditioningDefaultsSchema.optional(),
});
export type EngineeringDataV1 = z.infer<typeof EngineeringDataV1Schema>;

// ============================================================

export const SpecContractV2Schema = z.object({
  schema_version: z.literal(3),
  project: SpecProjectHeaderSchema,
  hierarchy: HierarchySchema,
  alarm_tiers: z.array(AlarmTierSchema),
  // Keyed by equipment_module_id
  equipment_modules: z.record(z.string(), EquipmentModuleContractSchema),
  // Machine-level safety gates (hybrid state model). Optional during the
  // additive wave; defaults to [].
  safety_gates: z.array(SafetyGateV2Schema).default([]),
  alarms: z.array(AlarmRowSchema),
  io_list: z.array(IoListEntrySchema),
  faults: z.array(FaultRowSchema),
  sections: z.record(SpecSectionTypeSchema, z.array(SpecSectionRowSchema)),
  // FDS Engine Phase 1 additions — all optional during shim window
  modes: z.array(OperatorModeSchema).optional(),
  // G0-9: keyed by unit_id — mirrors the equipment_modules keyed-record
  // pattern; HierarchySchema untouched. Absent until authored.
  unit_coordination: z.record(z.string(), UnitCoordinationV1Schema).optional(),
  // G0-1: tier-2 Engineering Data. Absent until authored.
  engineering: EngineeringDataV1Schema.optional(),
  configuration_parameters: z.array(ConfigParameterSchema).optional(),
  // Sparse map — override only the project-level sections you want to
  // customise. Absent keys fall back to engine-generated content.
  section_overrides: z
    .partialRecord(ProjectSectionTypeSchema, ProjectSectionContentSchema)
    .optional(),
  confirmation_status: ConfirmationStatusSchema.default("unconfirmed"),
  // ISA-88 Process Model — optional, absent until authored
  process_model: ProcessModelSchema.nullable().optional(),
});
export type SpecContractV2 = z.infer<typeof SpecContractV2Schema>;
