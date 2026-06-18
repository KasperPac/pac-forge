import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DocOverride } from "@/types/doc-control";

const KEY = (projectId: string) => ["doc-overrides", projectId] as const;

export function useDocOverrides(projectId: string | undefined) {
  return useQuery({
    queryKey: KEY(projectId ?? ""),
    queryFn: async (): Promise<DocOverride[]> => {
      const { data, error } = await supabase
        .from("project_doc_overrides")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocOverride[];
    },
    enabled: !!projectId,
  });
}

export function useAddDocOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { projectId: string; relPath: string; note?: string }) => {
      const { error } = await supabase.from("project_doc_overrides").insert({
        project_id: p.projectId,
        rel_path: p.relPath,
        classification: "customer_supplied",
        note: p.note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: KEY(p.projectId) }),
  });
}

export function useRemoveDocOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; projectId: string }) => {
      const { error } = await supabase
        .from("project_doc_overrides")
        .delete()
        .eq("id", p.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: KEY(p.projectId) }),
  });
}
