import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Snapshot, SnapshotTrigger } from "@/types";

const SNAPSHOTS_KEY = ["snapshots"] as const;

export function useSnapshots(artifactId: string | null) {
  return useQuery({
    queryKey: [...SNAPSHOTS_KEY, artifactId],
    queryFn: async (): Promise<Snapshot[]> => {
      const { data, error } = await supabase
        .from("snapshots")
        .select("*")
        .eq("artifact_id", artifactId!)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Snapshot[];
    },
    enabled: !!artifactId,
  });
}

export function useSaveSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      artifactId: string;
      content: string;
      trigger: SnapshotTrigger;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Get current max version number
      const { data: existing } = await supabase
        .from("snapshots")
        .select("version_number")
        .eq("artifact_id", input.artifactId)
        .order("version_number", { ascending: false })
        .limit(1);

      const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

      const { data, error } = await supabase
        .from("snapshots")
        .insert({
          project_id: input.projectId,
          artifact_id: input.artifactId,
          content: input.content,
          trigger: input.trigger,
          version_number: nextVersion,
          created_by: user?.id ?? "",
        })
        .select()
        .single();
      if (error) throw error;
      return data as Snapshot;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...SNAPSHOTS_KEY, variables.artifactId],
      });
    },
  });
}

export function useRollback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      snapshotId: string;
      artifactId: string;
      projectId: string;
    }) => {
      // Fetch the snapshot content
      const { data: snapshot, error: fetchError } = await supabase
        .from("snapshots")
        .select("*")
        .eq("id", input.snapshotId)
        .single();
      if (fetchError) throw fetchError;

      // Update the artifact's approved_content
      const { error: updateError } = await supabase
        .from("artifacts")
        .update({ approved_content: snapshot.content })
        .eq("id", input.artifactId);
      if (updateError) throw updateError;

      // Create a new snapshot for the rollback
      const { data: { user } } = await supabase.auth.getUser();
      const { data: existing } = await supabase
        .from("snapshots")
        .select("version_number")
        .eq("artifact_id", input.artifactId)
        .order("version_number", { ascending: false })
        .limit(1);

      const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;

      await supabase.from("snapshots").insert({
        project_id: input.projectId,
        artifact_id: input.artifactId,
        content: snapshot.content,
        trigger: "APPROVAL",
        version_number: nextVersion,
        created_by: user?.id ?? "",
      });

      return snapshot.content as string;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...SNAPSHOTS_KEY, variables.artifactId],
      });
      queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    },
  });
}
