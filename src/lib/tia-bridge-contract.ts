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
  | "bridge_status";

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
