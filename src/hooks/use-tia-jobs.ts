import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
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
export function useBridgeStatus() {
  return useQuery({
    queryKey: ["tia-bridge-status"],
    queryFn: async (): Promise<{
      connected: boolean;        // legacy — true when bridge is reachable (kept for compat)
      bridgeOnline: boolean;
      tiaConnected: boolean;
      projectOpen: boolean;
      version: string | null;
      bridgeVersion: string | null;
    }> => {
      try {
        const response = await fetch(
          `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/status`,
          { signal: AbortSignal.timeout(DEFAULT_BRIDGE_CONFIG.timeout) }
        );
        if (response.ok) {
          const data = (await response.json()) as BridgeStatusEvent["data"];
          return {
            connected: true,
            bridgeOnline: true,
            tiaConnected: data.connected ?? false,
            projectOpen: data.tia_project_open ?? false,
            version: data.tia_version,
            bridgeVersion: data.bridge_version ?? null,
          };
        }
      } catch {
        // Bridge offline
      }
      return {
        connected: false,
        bridgeOnline: false,
        tiaConnected: false,
        projectOpen: false,
        version: null,
        bridgeVersion: null,
      };
    },
    refetchInterval: 10_000, // Check every 10s for snappier status updates
    retry: false,
  });
}
