import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_BRIDGE_CONFIG, BRIDGE_CONFIG_V18 } from "@/lib/tia-bridge-contract";
import type { TiaJob, TiaJobType, TiaManifest, Artifact } from "@/types";
import type { SubmitJobResponse, BridgeStatusEvent } from "@/lib/tia-bridge-contract";
import { generateExportBundle } from "@/lib/tia-export";

const TIA_JOBS_KEY = ["tia-jobs"] as const;

export function useTiaJobs(projectId: string | undefined) {
  return useQuery({
    queryKey: [...TIA_JOBS_KEY, projectId],
    queryFn: async (): Promise<TiaJob[]> => {
      const { data, error } = await supabase
        .from("tia_jobs")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TiaJob[];
    },
    enabled: !!projectId,
  });
}

export function useTiaJob(jobId: string | null) {
  return useQuery({
    queryKey: [...TIA_JOBS_KEY, "detail", jobId],
    queryFn: async (): Promise<TiaJob> => {
      const { data, error } = await supabase
        .from("tia_jobs")
        .select("*")
        .eq("id", jobId!)
        .single();
      if (error) throw error;
      return data as TiaJob;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data;
      // Poll while job is running
      if (job && (job.status === "PENDING" || job.status === "RUNNING")) {
        return 3000;
      }
      return false;
    },
  });
}

export function useSubmitTiaJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      sessionId: string;
      jobType: TiaJobType;
      manifest: TiaManifest;
      tiaProjectPath?: string;
      /** Approved artifacts for building the import bundle */
      artifacts?: Artifact[];
    }): Promise<TiaJob> => {
      const { data: { user } } = await supabase.auth.getUser();

      // Create job record in Supabase
      const { data: job, error } = await supabase
        .from("tia_jobs")
        .insert({
          project_id: input.projectId,
          session_id: input.sessionId,
          job_type: input.jobType,
          manifest: input.manifest,
          status: "PENDING",
          created_by: user?.id ?? "",
        })
        .select()
        .single();
      if (error) throw error;

      // Build base64-encoded artifact bundle for IMPORT jobs
      let artifactBundle: string | undefined;
      const needsBundle = input.jobType === "IMPORT_ONLY" || input.jobType === "IMPORT_AND_COMPILE";
      if (needsBundle && input.artifacts && input.artifacts.length > 0) {
        const blob = await generateExportBundle(input.artifacts, input.manifest, { format: "scl" });
        const buffer = await blob.arrayBuffer();
        artifactBundle = btoa(
          new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), "")
        );
      }

      // Attempt to call the bridge — graceful failure if offline
      try {
        const response = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: job.id,
            job_type: input.jobType,
            manifest: input.manifest,
            artifact_bundle: artifactBundle,
            tia_project_path: input.tiaProjectPath ?? "",
          }),
          signal: AbortSignal.timeout(DEFAULT_BRIDGE_CONFIG.timeout),
        });

        if (response.ok) {
          const bridgeResult: SubmitJobResponse = await response.json();
          // Update job with bridge acknowledgment
          await supabase
            .from("tia_jobs")
            .update({ status: "RUNNING" })
            .eq("id", job.id);
          return { ...job, status: bridgeResult.status } as TiaJob;
        }
      } catch {
        // Bridge offline — job stays as PENDING in DB
        console.warn("TIA Bridge offline — job created but not submitted to bridge");
      }

      return job as TiaJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TIA_JOBS_KEY });
    },
  });
}

/**
 * Check if the TIA bridge is reachable, and whether TIA Portal is connected.
 *
 * - `bridgeOnline`: the .NET bridge HTTP server is responding
 * - `tiaConnected`: the bridge has attached to / started a TIA Portal instance
 * - `projectOpen`: a TIA project is currently open
 */
async function probeBridge(baseUrl: string): Promise<BridgeStatusEvent["data"] | null> {
  try {
    const response = await fetch(`${baseUrl}/tia/status`, { signal: AbortSignal.timeout(4_000) });
    if (response.ok) return (await response.json()) as BridgeStatusEvent["data"];
  } catch { /* offline */ }
  return null;
}

export function useBridgeStatus() {
  return useQuery({
    queryKey: ["tia-bridge-status"],
    queryFn: async (): Promise<{
      connected: boolean;
      bridgeOnline: boolean;
      tiaConnected: boolean;
      projectOpen: boolean;
      version: string | null;
      bridgeVersion: string | null;
      sourcePlcFamily: string | null;
      sourceCpuTypeId: string | null;
      activePort: number | null;
    }> => {
      // Check V20 (5102) and V18 (5103) in parallel; prefer whichever responds
      const [v20, v18] = await Promise.all([
        probeBridge(DEFAULT_BRIDGE_CONFIG.baseUrl),
        probeBridge(BRIDGE_CONFIG_V18.baseUrl),
      ]);
      const data = v20 ?? v18;
      const activePort = v20 ? 5102 : v18 ? 5103 : null;
      if (data) {
        return {
          connected: true,
          bridgeOnline: true,
          tiaConnected: data.connected ?? false,
          projectOpen: data.tia_project_open ?? false,
          version: data.tia_version,
          bridgeVersion: data.bridge_version ?? null,
          sourcePlcFamily: data.source_plc_family ?? null,
          sourceCpuTypeId: data.source_cpu_type_id ?? null,
          activePort,
        };
      }
      return {
        connected: false,
        bridgeOnline: false,
        tiaConnected: false,
        projectOpen: false,
        version: null,
        bridgeVersion: null,
        sourcePlcFamily: null,
        sourceCpuTypeId: null,
        activePort: null,
      };
    },
    refetchInterval: 10_000,
    retry: false,
    // Keep the last known good status during long TIA Portal operations (project creation,
    // compile, import) — the bridge HTTP server may not respond within 5s while TIA is busy,
    // but the bridge is still alive. Don't flash "offline" while a job is running.
    placeholderData: (prev) => prev,
  });
}

/**
 * Check if a TIA project is currently open in the bridge.
 */
export async function isTiaProjectOpen(): Promise<boolean> {
  const { baseUrl, timeout } = DEFAULT_BRIDGE_CONFIG;
  try {
    const resp = await fetch(`${baseUrl}/tia/status`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (resp.ok) {
      const data = (await resp.json()) as BridgeStatusEvent["data"];
      return data.tia_project_open ?? false;
    }
  } catch {
    // Bridge offline
  }
  return false;
}

/**
 * Create a TIA project and import sources in one call via /tia/demo/create.
 * Used when no project exists yet — creates project, adds CPU, plugs IO modules, imports, compiles.
 */
export async function createProjectAndImport(
  tiaProjectPath: string,
  projectName: string,
  sources: Record<string, string>,
  importOrder: string[],
  ioModules?: { mlfb: string; rack: number; slot: number; description: string }[],
  ioTags?: { name: string; data_type: string; logical_address: string; comment?: string }[],
): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl } = DEFAULT_BRIDGE_CONFIG;

  // Parse path: TIA Projects.Create(dir, name) creates dir/name/name.ap18
  // If user gives "C:\Automation\TestProject\TestProject.ap18" → dir="C:\Automation", name="TestProject"
  // If user gives "C:\Automation\TestProject" → dir="C:\Automation", name="TestProject"
  const normalized = tiaProjectPath.replace(/\\/g, "/").replace(/\/$/, "");
  // Strip .ap17/.ap18/.ap19/.ap20 extension if present
  const withoutExt = normalized.replace(/\.ap\d{2}$/i, "");
  const parts = withoutExt.split("/");
  const derivedName = parts[parts.length - 1] || projectName || "PacForge_Project";
  let derivedDir = parts.slice(0, -1).join("/") || withoutExt;
  // TIA creates dir/name/name.ap18 — if dir already ends with name, go up one level
  const dirParts = derivedDir.split("/");
  if (dirParts[dirParts.length - 1]?.toLowerCase() === derivedName.toLowerCase()) {
    derivedDir = dirParts.slice(0, -1).join("/") || derivedDir;
  }

  try {
    const resp = await fetch(`${baseUrl}/tia/demo/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_path: derivedDir,
        project_name: derivedName,
        sources: sources,
        import_order: importOrder,
        io_modules: ioModules ?? [],
        io_tags: (ioTags ?? []).map((t) => ({
          name: t.name,
          data_type: t.data_type,
          logical_address: t.logical_address,
          comment: t.comment ?? "",
        })),
      }),
      // Long timeout — TIA project creation can take 30-60s
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: text };
    }

    const result = await resp.json();
    // Bridge uses snake_case serialization
    if (!result.success) {
      return { ok: false, error: result.message ?? "Project creation failed" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create project" };
  }
}
