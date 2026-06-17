import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { SourceSection } from "@/lib/spec-builder/source-section-select";

export const sourceSectionsKey = (specProjectId: string) =>
  ["source-sections", specProjectId] as const;

/** Customer-spec sections captured at ingest, ordered by document position. */
export function useSourceSections(specProjectId: string | undefined) {
  return useQuery({
    queryKey: sourceSectionsKey(specProjectId ?? ""),
    enabled: !!specProjectId,
    queryFn: async (): Promise<SourceSection[]> => {
      const { data, error } = await supabase
        .from("spec_source_sections")
        .select("heading, body, order_index")
        .eq("spec_project_id", specProjectId!)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SourceSection[];
    },
  });
}
