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
