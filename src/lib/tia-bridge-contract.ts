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
}

export interface ProvisionProjectResponse {
  success: boolean;
  created: boolean;           // true = new project created, false = existing opened
  project_file_path: string;
  message: string;
  warnings: string[];
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
  device_count: number;
}

/**
 * POST /tia/extract-project
 * Full project extraction — blocks with folder hierarchy, UDTs, tags, HW.
 */
export interface ExtractProjectResponse {
  success: boolean;
  message: string;
  folders: ExtractedFolder[];
  blocks: ExtractedBlock[];
  tag_tables: ExtractedTagTable[];
  hardware: ExtractedHardware;
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
  devices: ExtractedDevice[];
  io_modules: ExtractedIoModule[];
  networks: ExtractedNetwork[];
}

export interface ExtractedDevice {
  name: string;
  type_id: string;
  order_number?: string;
  firmware_version?: string;
}

export interface ExtractedIoModule {
  name: string;
  type_id: string;
  rack: number;
  slot: number;
}

export interface ExtractedNetwork {
  name: string;
  type: string;
  devices: string[];
}

