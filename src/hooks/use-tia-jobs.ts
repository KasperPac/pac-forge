import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { TiaJob, TiaJobType, TiaManifest } from "@/types";
import type { SubmitJobResponse, JobStatusResponse } from "@/lib/tia-bridge-contract";

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

      // Attempt to call the bridge — graceful failure if offline
      try {
        const response = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_type: input.jobType,
            manifest: input.manifest,
            tia_project_path: "",
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
 * Check if the TIA bridge is reachable.
 */
export function useBridgeStatus() {
  return useQuery({
    queryKey: ["tia-bridge-status"],
    queryFn: async (): Promise<{ connected: boolean; version: string | null }> => {
      try {
        const response = await fetch(
          `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/status`,
          { signal: AbortSignal.timeout(DEFAULT_BRIDGE_CONFIG.timeout) }
        );
        if (response.ok) {
          const data: JobStatusResponse = await response.json();
          return { connected: true, version: data.current_step };
        }
      } catch {
        // Bridge offline
      }
      return { connected: false, version: null };
    },
    refetchInterval: 30_000, // Check every 30s
    retry: false,
  });
}
