/**
 * TIA Bridge API Contract
 *
 * TypeScript types defining the REST API that the Windows .NET bridge must implement.
 * The bridge runs locally on the engineer's machine and communicates with TIA Portal
 * via the TIA Openness API.
 *
 * Implemented by the .NET bridge in bridge/PacForgeBridge/.
 */

import type { TiaManifest, TiaJobType, TiaJobStatus, CompileResult } from "@/types";

// --- REST API Endpoints ---

/**
 * POST /tia/jobs
 * Submit a new TIA job for execution.
 */
export interface SubmitJobRequest {
  /** Supabase job ID — bridge uses this as its own job ID for consistent tracking */
  job_id: string;
  job_type: TiaJobType;
  manifest: TiaManifest;
  /** Base64-encoded zip of artifact files (for IMPORT jobs) */
  artifact_bundle?: string;
  /** TIA Portal project path on the local machine */
  tia_project_path: string;
}

export interface SubmitJobResponse {
  job_id: string;
  status: TiaJobStatus;
  created_at: string;
}

/**
 * GET /tia/jobs/:id
 * Get current job status and progress.
 */
export interface JobStatusResponse {
  job_id: string;
  status: TiaJobStatus;
  progress: number; // 0-100
  current_step: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

/**
 * GET /tia/jobs/:id/results
 * Get compile results for a completed job.
 */
export interface JobResultsResponse {
  job_id: string;
  compile_result: CompileResult | null;
  imported_artifacts: string[];
  skipped_artifacts: string[];
}

/**
 * POST /tia/jobs/:id/cancel
 * Cancel a running or pending job.
 */
export interface CancelJobResponse {
  job_id: string;
  status: TiaJobStatus;
  cancelled_at: string;
}

// --- WebSocket Events ---

/**
 * WebSocket endpoint: ws://localhost:<port>/tia/ws
 * For real-time job progress updates.
 */

export type BridgeEventType =
  | "job_started"
  | "job_progress"
  | "job_completed"
  | "job_failed"
  | "artifact_imported"
  | "compile_started"
  | "compile_error"
  | "compile_completed"
  | "bridge_status"
  | "provision_progress";

export interface BridgeEvent {
  type: BridgeEventType;
  job_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface JobProgressEvent extends BridgeEvent {
  type: "job_progress";
  data: {
    progress: number;
    current_step: string;
    current_artifact: string | null;
  };
}

export interface ArtifactImportedEvent extends BridgeEvent {
  type: "artifact_imported";
  data: {
    artifact_name: string;
    success: boolean;
    error: string | null;
  };
}

export interface CompileErrorEvent extends BridgeEvent {
  type: "compile_error";
  data: {
    artifact_name: string;
    line: number | null;
    column: number | null;
    error_text: string;
    severity: "ERROR" | "WARNING" | "INFO";
  };
}

export interface BridgeStatusEvent {
  type: "bridge_status";
  timestamp: string;
  data: {
    connected: boolean;
    tia_version: string | null;
    tia_project_open: boolean;
    bridge_version: string;
    source_plc_family: string | null;   // e.g. "SIMATIC 300"
    source_cpu_type_id: string | null;  // e.g. "OrderNumber:6ES7 317-2EK14-0AB0/V3.3"
  };
}

/**
 * POST /tia/export-sources
 * Export current PLC block sources from TIA Portal.
 */
export interface ExportSourcesResponse {
  success: boolean;
  message: string;
  sources: Record<string, string>;
  /** Block language per block name: "SCL" | "STL" | "LAD" | "FBD" | "GRAPH" | "DB" */
  source_languages?: Record<string, string>;
  warnings: string[];
}

// --- File Browse ---

/**
 * POST /tia/browse-file
 * Open a native Windows file dialog and return the selected path.
 */
export interface BrowseFileRequest {
  /** Dialog title */
  title?: string;
  /** File filter (Windows format, e.g. "TIA Libraries (*.zal18;*.al18)|*.zal18;*.al18|All Files (*.*)|*.*") */
  filter?: string;
  /** Initial directory to open the dialog in */
  initial_directory?: string;
}

export interface BrowseFileResponse {
  success: boolean;
  /** Full path of selected file, or empty if cancelled */
  file_path: string;
  /** File name only */
  file_name: string;
}

// --- Block XML Export ---

/**
 * POST /tia/export-block-xml
 * Export a single block's raw SimaticML XML from the open TIA Portal project.
 */
export interface ExportBlockXmlRequest {
  /** Name of the block to export (must exist in open TIA project) */
  block_name: string;
  /** Optional sub-folder path within Program blocks (e.g. "Pac-LAD") */
  folder?: string;
}

export interface ExportBlockXmlResponse {
  success: boolean;
  message: string;
  block_name: string;
  /** Raw SimaticML XML content of the exported block */
  xml_content: string;
}

// --- Library Endpoints ---

/**
 * POST /tia/library/open
 * Open a TIA Portal global library (.al18) and enumerate its contents.
 */
export interface OpenLibraryRequest {
  library_path: string;
}

export interface LibraryItemInfo {
  name: string;
  path: string;
  kind: string;
  guid?: string;
  description?: string;
}

export interface LibraryContentsResponse {
  success: boolean;
  message: string;
  library_name: string;
  library_path: string;
  types: LibraryItemInfo[];
  master_copies: LibraryItemInfo[];
}

/**
 * POST /tia/library/export
 * Export selected types/master copies from a library as XML.
 */
export interface ExportLibraryRequest {
  library_path: string;
  item_paths?: string[];
}

export interface LibraryExportResponse {
  success: boolean;
  message: string;
  items: Record<string, string>; // path → XML content
  warnings: string[];
}

/**
 * POST /tia/library/copy-to-project
 * Copy master copies and/or library types from a global library into the open project.
 */
export interface LibraryCopyToProjectRequest {
  library_path: string;
  /** Optional project path — if no project is open, the bridge opens it first. */
  project_path?: string;
  /** Master copy paths to paste into PLC block group (e.g. "04 Electrical Drives/fbMotor_Reversing") */
  master_copy_paths?: string[];
  /** Library type paths to import into PLC type group (e.g. "04 Electrical Drives/udtHMI_MotorControl") */
  type_paths?: string[];
}

export interface LibraryCopyToProjectResponse {
  success: boolean;
  message: string;
  copied_blocks: string[];
  skipped_blocks: string[];
  warnings: string[];
  errors: string[];
}

// --- HMI Import Endpoints ---

/**
 * POST /tia/import-hmi
 * Import HMI screens, tag tables, text lists, and graphic lists into TIA project.
 */
export interface ImportHmiRequest {
  /** TIA Portal project path on the local machine */
  tia_project_path: string;
  /** Screen XML documents to import (name → XML content) */
  screens?: Record<string, string>;
  /** Tag table XML documents to import (name → XML content) */
  tag_tables?: Record<string, string>;
  /** Text list XML documents to import (name → XML content) */
  text_lists?: Record<string, string>;
  /** Graphic list XML documents to import (name → XML content) */
  graphic_lists?: Record<string, string>;
}

export interface ImportHmiResponse {
  success: boolean;
  message: string;
  imported_screens: string[];
  imported_tag_tables: string[];
  imported_text_lists: string[];
  imported_graphic_lists: string[];
  warnings: string[];
}

// --- LAD Import ---

/**
 * POST /tia/import-lad
 * Import a SimaticML LAD block into the open TIA Portal project and optionally compile.
 */
export interface ImportLadRequest {
  /** Path to the TIA Portal project (.ap18 etc.) — opens it if not already open. */
  tia_project_path?: string;
  /** SimaticML XML content of the LAD block. */
  xml_content: string;
  /** Block name (used for logging). */
  block_name: string;
  /** Block type: "FB", "FC", or "OB". */
  block_type: "FB" | "FC" | "OB";
  /** If true, compiles the PLC after import. */
  compile: boolean;
  /** Optional sub-folder inside Program blocks (e.g. "Pac-LAD"). */
  destination_folder?: string;
}

export interface ImportLadResponse {
  success: boolean;
  message: string;
  imported_blocks: string[];
  warnings: string[];
  compile_result: import("@/types").CompileResult | null;
}

// --- Bridge Configuration ---

export interface BridgeConfig {
  /** Bridge REST API base URL (default: http://localhost:5100) */
  baseUrl: string;
  /** WebSocket URL for real-time events */
  wsUrl: string;
  /** Connection timeout in ms */
  timeout: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  baseUrl: "http://localhost:5102",
  wsUrl: "ws://localhost:5102/tia/ws",
  timeout: 5000,
};

export const BRIDGE_CONFIG_V18: BridgeConfig = {
  baseUrl: "http://localhost:5103",
  wsUrl: "ws://localhost:5103/tia/ws",
  timeout: 5000,
};

/** Return the correct bridge config for a given TIA Portal version string (e.g. "V18", "V20"). */
export function getBridgeConfigForVersion(tiaVersion: string | null | undefined): BridgeConfig {
  if (tiaVersion && tiaVersion.includes("18")) return BRIDGE_CONFIG_V18;
  return DEFAULT_BRIDGE_CONFIG;
}

// --- Provision Project ---

/**
 * GET /tia/hardware-catalog?filter=X&typeIdentifier=Y (G0-17)
 * Browse TIA's installed hardware catalogue. Needs an attached portal only —
 * no project has to be open. `filter` is a substring match over article number
 * AND type name; passing `typeIdentifier` restricts results to parts pluggable
 * into that type (e.g. only the modules a given CPU accepts).
 */
export interface CatalogEntryDto {
  article_number: string;
  type_name: string;
  description: string;
  catalog_path: string;
  /** `OrderNumber:6ES7 516-3AN00-0AB0/V1.0` — what CreateWithItem expects. */
  type_identifier: string;
  version: string;
}

export interface HardwareCatalogResponse {
  success: boolean;
  message: string;
  count: number;
  entries: CatalogEntryDto[];
}

export interface IoModuleDto {
  mlfb: string;     // Order number, e.g. "6ES7 521-1BH50-0AA0"
  rack: number;
  slot: number;
  description?: string;
}

export interface IoTagDto {
  name: string;
  data_type: string;         // e.g. "Bool", "Int", "Word"
  logical_address: string;   // e.g. "%I0.0", "%Q1.3"
  comment?: string;
}

/**
 * POST /tia/provision-project
 * Create a new TIA project (with CPU + IO) if it doesn't exist, or open it if it does.
 */
export interface ProvisionProjectRequest {
  tia_project_path: string;  // Folder path
  project_name?: string;     // Defaults to folder basename
  cpu_order_number?: string; // e.g. "6ES7 516-3AN02-0AB0/V2.9"
  provision_id?: string;     // Correlation ID for WS progress events
  io_modules?: IoModuleDto[];
  io_tags?: IoTagDto[];
  /** name → SCL. When present the bridge imports the program and compiles HW+SW. */
  sources?: Record<string, string>;
  /** Import order — dependency-ordered (UDT → FB → FC → DB → OB). */
  import_order?: string[];
}

export interface ProvisionProjectResponse {
  success: boolean;
  created: boolean;           // true = new project created, false = existing opened
  project_file_path: string;
  message: string;
  warnings: string[];
  /** Present when `sources` were supplied — the HW+SW compile outcome. */
  compile_result?: CompileResult;
}

// --- PLCSIM Advanced Endpoints ---

/**
 * POST /tia/plcsim/start
 * Register and power on a PLCSIM Advanced virtual controller.
 */
export interface PlcsimStartRequest {
  instance_name?: string;  // Default: "PacForge_Test"
  cpu_type?: number;       // ECPUType enum value (default: S7-1515)
  timeout_ms?: number;     // Default: 30000
}

export interface PlcsimStartResponse {
  success: boolean;
  message: string;
  operating_state?: string;
}

/**
 * GET /tia/plcsim/status
 * Check PLCSIM connection status and operating state.
 */
export interface PlcsimStatusResponse {
  connected: boolean;
  instance_name: string | null;
  operating_state: string;
  has_instance: boolean;
}

/**
 * POST /tia/plcsim/plc-mode
 * Set PLC to RUN or STOP mode.
 */
export interface PlcsimModeRequest {
  mode: "run" | "stop";
  timeout_ms?: number;
}

/**
 * POST /tia/plcsim/write-tag
 * Write a single tag by symbolic name.
 */
export interface PlcsimWriteTagRequest {
  tag_name: string;
  value: boolean | number | string;
  data_type?: string;  // "Bool" | "Int" | "DInt" | "Real" — default "Bool"
}

/**
 * POST /tia/plcsim/read-tags
 * Read multiple tags by symbolic name.
 * Request body: array of PlcsimReadTagRequest.
 */
export interface PlcsimReadTagRequest {
  tag_name: string;
  data_type: string;
}

export interface PlcsimReadTagValue {
  tag_name: string;
  data_type: string;
  value: boolean | number | string | null;
  success: boolean;
  error?: string;
}

export interface PlcsimReadTagsResponse {
  success: boolean;
  message: string;
  values: PlcsimReadTagValue[];
}

/** POST /tia/plcsim/stop — Shutdown PLCSIM instance */
export type PlcsimStopResponse = PlcsimStartResponse;

/** POST /tia/plcsim/download — Download compiled project to PLCSIM instance */
export interface PlcsimDownloadResponse {
  success: boolean;
  message: string;
  warnings?: number;
  errors?: number;
}

// ─── Migration: tag creation + block reimport ──────────────────────────────────

export interface MigrationTagDto {
  name: string;
  dataType: string;
  /** TIA Portal absolute address notation e.g. %M10.0, %MW10 */
  address: string;
}

/** POST /tia/migration/create-tags */
export interface CreateMigrationTagsRequest {
  tags: MigrationTagDto[];
  /** Tag table name — defaults to "Migration Tags" */
  tableName?: string;
}

export interface CreateMigrationTagsResponse {
  success: boolean;
  message: string;
  created: string[];
  skipped: string[];
  errors: string[];
}

/** POST /tia/migration/reimport-blocks */
export interface ReimportMigrationBlocksRequest {
  /** blockName → fixed SimaticML XML */
  blocks: Record<string, string>;
  compile?: boolean;
}

export interface ReimportMigrationBlocksResponse {
  success: boolean;
  message: string;
  imported: string[];
  errors: string[];
}

// ============================================================
// Directory listing (local filesystem via bridge)
// ============================================================

/**
 * POST /tia/list-directory
 * List subdirectories of a local path.
 */
export interface ListDirectoryRequest {
  path: string;
}

export interface ListDirectoryResponse {
  success: boolean;
  message: string;
  entries: DirectoryEntry[];
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "directory" | "file";
}

// ============================================================
// Pac-Audit: Full project extraction
// ============================================================

/**
 * GET /tia/project-info
 * Quick metadata about the open TIA project.
 */
export interface ProjectInfoResponse {
  success: boolean;
  message?: string;
  project_name: string;
  project_path: string;
  tia_version: string | null;
  cpu_family: string | null;
  cpu_order_number: string | null;
  block_count: number;
  udt_count: number;
  tag_table_count: number;
  hmi_screen_count: number;
  control_module_count: number;
  /** ISO-8601 UTC from `_project.LastModified` (V18-confirmed). Used for stale-snapshot detection. Omitted when unreadable. */
  last_modified_at?: string;
}

/**
 * POST /tia/extract-project
 * Full project extraction — blocks with folder hierarchy, UDTs, tags, HW, cross-refs.
 */
export interface ExtractProjectResponse {
  success: boolean;
  message: string;
  folders: ExtractedFolder[];
  blocks: ExtractedBlock[];
  tag_tables: ExtractedTagTable[];
  hardware: ExtractedHardware;
  cross_references: ExtractedCrossReference[];
  /** Per-channel IO detail — one row per channel, unrolled from module StartAddress. Persists to audit_module_channels. */
  module_channels: ExtractedModuleChannel[];
  /** HMI panels linked to the project with nested screen inventory. */
  hmi_targets: ExtractedHmiTarget[];
  /**
   * Per-drive Sinamics detail — nameplate, ramps, telegrams. One row per drive device
   * classified as `drive.sinamics.*` in `ExtractedDevice.category`. See §12.6 / §16 step 4.
   */
  drive_details: ExtractedDriveDetail[];
  /** ISO-8601 UTC timestamp at extract time — persists to audit_projects.tia_project_modified_at. Omitted when unreadable. */
  last_modified_at?: string;
  warnings: string[];
}

export interface ExtractedFolder {
  id: string;
  parent_id: string | null;
  name: string;
  folder_type: string;
  path: string;
  depth: number;
}

export interface ExtractedBlock {
  name: string;
  block_type: string;
  block_number: number | null;
  programming_language: string;
  source_code: string | null;
  source_format: string;
  folder_path: string;
  folder_id: string;
  line_count: number | null;
}

export interface ExtractedTagTable {
  name: string;
  tags: ExtractedTag[];
}

export interface ExtractedTag {
  name: string;
  data_type: string;
  address: string | null;
  comment: string | null;
}

export interface ExtractedHardware {
  control_modules: ExtractedDevice[];
  io_modules: ExtractedIoModule[];
  networks: ExtractedNetwork[];
}

export interface ExtractedDevice {
  name: string;
  type_id: string;
  order_number?: string;
  firmware_version?: string;
  /**
   * Engineer's physical-device label from `DeviceItem.GetAttribute("Comment")` —
   * e.g. "FREEZER Pallet Chain conveyor 1500L-01A Ground Level". Primary source
   * for §12.6 physical-device attribution on drives.
   */
  comment?: string | null;
  /**
   * Classification label from GSDML VendorName + family heuristics (§16 step 4).
   * Dot-notation: "drive.sinamics.g120c" / "roller_card.interroll" /
   * "load_cell.siwarex" / "hmi" / "io_module.generic" / "other.pn_device".
   * Null when no classification rule matched.
   */
  category?: string | null;
  /** Vendor name from matched GSDML. Null when no GSDML matched. */
  vendor_name?: string | null;
  /** GSDML filename the device resolved to. Null when TypeIdentifier is `OrderNumber:` (catalog-only). */
  gsdml_filename?: string | null;
  /** Primary IP address on the device's PROFINET interface. */
  ip_address?: string | null;
  /** PROFINET station name. */
  station_name?: string | null;
}

export interface ExtractedIoModule {
  name: string;
  type_id: string;
  /** Parsed catalog number from `type_id` (e.g. "6ES7 521-1BH50-0AA0"). Primary handle for GSDML / HSP lookup. */
  mlfb?: string;
  /** Parsed firmware version from `type_id` (e.g. "V1.2"). */
  firmware_version?: string;
  rack: number;
  slot: number;
}

export interface ExtractedNetwork {
  name: string;
  type: string;
  control_modules: string[];
}

/**
 * One row per (source-block → referenced-object → location) triple, flattened from
 * Openness `CrossReferenceService.GetCrossReferences(AllObjects)`. Rows persist to
 * `audit_cross_references`. See PAC_AUDIT_DERIVED_SPEC.md §12.0 + §12.2.
 */
export interface ExtractedCrossReference {
  source_name: string | null;
  source_path: string | null;
  source_address: string | null;
  source_type_name: string | null;
  source_device: string | null;

  target_name: string | null;
  target_path: string | null;
  target_address: string | null;
  target_type_name: string | null;
  target_device: string | null;

  /** Kind of memory access — Read/Write/RW/Call/InstanceDB/Multiinstance/Interface/Definition/... */
  access: string | null;
  /** Relationship direction — Uses/UsedBy/TypeInstance/InstanceType/Assigns/... */
  reference_type: string | null;
  /** Human-readable location, e.g. "@CALL_SENSORS ▶ NW4 (Function Block SENSOR_FB)". */
  reference_location: string | null;
  referenced_as_name: string | null;
  location_address: string | null;
  /** Symbolic path at the occurrence, e.g. "DB_SENSORS.SENSOR_FB[15]._ClearDly". */
  location_name: string | null;
  location_type_name: string | null;
}

/**
 * One row per physical IO channel, produced by walking `Device.DeviceItems` and unrolling
 * each IO module's `StartAddress` across its channel count. See PAC_AUDIT_DERIVED_SPEC §12.6.
 * Persisted to `audit_module_channels`.
 */
export interface ExtractedModuleChannel {
  /** Parent IO module name — joins to `ExtractedIoModule.name`. */
  module_name: string;
  /** Parent module catalog number (e.g. "6ES7 521-1BH50-0AA0"). Copied from `ExtractedIoModule.mlfb`. */
  module_mlfb?: string;
  /** Zero-based channel index within the module. */
  channel_number: number;
  /** Absolute TIA address, e.g. "%I0.0", "%Q1.3", "%IW256", "%QW256". Null if unresolvable. */
  io_address: string | null;
  /** Inferred signal type — address-prefix driven. */
  signal_type: "DI" | "DO" | "AI" | "AO" | "DIQ" | "RS485" | "other";
  /** Symbolic tag joined from project tag tables by address. Null if no tag binds the address. */
  symbolic_tag: string | null;
  /** True when the module's TypeIdentifier/name marks it as F-I/O. */
  is_safety: boolean;
  /** Channel-level comment when available (often null on V18 for non-safety modules). */
  channel_comment: string | null;
  /** How the channel count was derived — for provenance/debug. */
  channel_count_source?: "length_in_bits" | "length_bytes" | "name_pattern" | "single_row";
  rack: number;
  slot: number;
}

/**
 * One row per HMI panel linked to the project. `_project.HmiTargets` is absent on V18
 * (spike §12.0), so the bridge walks all Devices + DeviceItems for an `HmiTarget` software
 * container — same path the legacy `GetHmiTarget()` already uses.
 */
export interface ExtractedHmiTarget {
  /** HmiTarget.Name. */
  name: string;
  /** Parent Device.Name. */
  control_module_name: string;
  /** Device.TypeIdentifier, e.g. "OrderNumber:6AV2124-0MC01-0AX0/15.1.0.0". */
  type_id: string | null;
  /** Parsed MLFB from type_id (e.g. "6AV2124-0MC01-0AX0"). */
  order_number?: string;
  /** Parsed firmware version from type_id. */
  firmware_version?: string;
  /** HmiTarget class name — "ComfortPanel" / "BasicPanel" / "UnifiedComfortPanel" etc. */
  panel_class: string | null;
  ip_address?: string;
  station_name?: string;
  screen_count: number;
  tag_table_count: number;
  screens: ExtractedHmiScreen[];
}

export interface ExtractedHmiScreen {
  name: string;
  /** Forward-slash separated folder path under ScreenFolder root. Empty for root-level screens. */
  folder_path: string;
  number: number | null;
}

/**
 * Per-drive Sinamics detail extracted via `Siemens.Engineering.MC.Drives.DriveObjectContainer`
 * — nameplate (P304/P305/P311), ramps (P1120/P1121/P1135), and PROFIdrive telegrams.
 * One row per drive device (joined to `ExtractedDevice.name`). All numeric fields are
 * nullable because Startdrive integration is optional; non-Startdrive projects return
 * nulls — `parameter_source` reflects that.
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §12.6.
 */
export interface ExtractedDriveDetail {
  /** Joins back to `ExtractedDevice.name`. */
  control_module_name: string;
  /** Engineer's physical-device label from the drive's `Comment` attribute. */
  comment: string | null;
  /** Drive family derived from MLFB/TypeIdentifier — "G120C"/"G120"/"S120"/"S210"/"V90"/null. */
  drive_family: string | null;
  /** MLFB / order number (e.g. "6SL3210-1KE18-8AF1"). */
  mlfb: string | null;
  firmware_version: string | null;
  ip_address: string | null;
  station_name: string | null;

  // Motor nameplate — P304/P305/P311. Null when the drive isn't Startdrive-integrated.
  motor_rated_power_kw: number | null;   // P304
  motor_rated_current_a: number | null;  // P305
  motor_rated_speed_rpm: number | null;  // P311
  motor_rated_voltage_v: number | null;  // P304 sibling; null when unreadable

  // Ramps — seconds.
  ramp_up_seconds: number | null;        // P1120
  ramp_down_seconds: number | null;      // P1121
  ramp_off_stop_seconds: number | null;  // P1135

  /** PROFIdrive main telegram number (e.g. 352 = G120 Standard, 1 = Std msg 1). */
  main_telegram_number: number | null;
  /** PROFIsafe telegram number (30 = PROFIsafe standard). */
  safety_telegram_number: number | null;
  telegrams: ExtractedDriveTelegram[];

  /** Per-parameter snapshot (always probed: P304/P305/P311/P1120/P1121/P1135/P922). */
  selected_parameters: ExtractedDriveParameter[];

  /**
   * Completeness hint for nameplate / ramp reads:
   *   `"starter"` — all probed params had values (project downloaded with Startdrive)
   *   `"partial"` — some params had values, others null
   *   `"not_available"` — container missing or every probe returned null (post-download commissioning only)
   *   `"gsdml"` — reserved for future GSDML-only fallback
   */
  parameter_source: "starter" | "partial" | "not_available" | "gsdml" | null;

  /** Per-drive warnings from extraction. */
  warnings: string[];
}

export interface ExtractedDriveParameter {
  /** Parameter number (e.g. 304 for P304, 20 for r20). */
  number: number;
  /** Short name from Openness (e.g. "p304", "r18"). Null if the parameter wasn't found on the drive. */
  name: string | null;
  /** Human-readable description (e.g. "Rated motor power"). */
  text: string | null;
  /** Value as string (invariant culture); null when the parameter wasn't found. */
  value: string | null;
  /** Engineering unit (e.g. "kW", "A", "rpm", "V", "s", "Hz"); empty when unitless. */
  unit: string | null;
}

export interface ExtractedDriveTelegram {
  /** PROFIdrive telegram number (30 = PROFIsafe, 352 = G120 standard, …). */
  telegram_number: number;
  /** "MainTelegram" | "SafetyTelegram". */
  type: string | null;
  /** Formatted input address range (e.g. "%IW256..%IW267"). */
  input_address: string | null;
  /** Formatted output address range. */
  output_address: string | null;
}

