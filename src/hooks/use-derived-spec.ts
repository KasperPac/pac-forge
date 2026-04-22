import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  AuditProject,
  DerivedSpec,
  SpecProvenanceMap,
} from "@/types/audit";

const KEY = ["audit_derived_spec"] as const;

function projectKey(auditProjectId: string) {
  return [...KEY, auditProjectId] as const;
}

export interface DerivedSpecSnapshot {
  spec: DerivedSpec | Record<string, never>;
  version: number;
  provenance: SpecProvenanceMap;
  tiaProjectModifiedAt: string | null;
  crossRefsExtractedAt: string | null;
}

/**
 * Read-only hook over the derived-spec columns on `audit_projects`.
 * Patch RPC (`apply_derived_spec_patch`) lands in step 20 of §16 — UI
 * components can render + subscribe today and wire mutations later.
 */
export function useDerivedSpec(auditProjectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKey(auditProjectId ?? "none"),
    queryFn: async (): Promise<DerivedSpecSnapshot | null> => {
      const { data, error } = await supabase
        .from("audit_projects")
        .select(
          "derived_spec, derived_spec_version, spec_provenance, tia_project_modified_at, cross_refs_extracted_at",
        )
        .eq("id", auditProjectId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const row = data as Pick<
        AuditProject,
        | "derived_spec"
        | "derived_spec_version"
        | "spec_provenance"
        | "tia_project_modified_at"
        | "cross_refs_extracted_at"
      >;

      return {
        spec: row.derived_spec,
        version: row.derived_spec_version,
        provenance: row.spec_provenance,
        tiaProjectModifiedAt: row.tia_project_modified_at,
        crossRefsExtractedAt: row.cross_refs_extracted_at,
      };
    },
    enabled: !!auditProjectId,
  });
}

/**
 * Helper for the stale-snapshot banner (§12.5): returns true when the
 * bridge-reported `currentTiaModifiedAt` is newer than the persisted
 * `tia_project_modified_at` for this audit. Both may be null — treat null
 * as not-stale so the banner doesn't flicker while the bridge is
 * disconnected.
 */
export function isDerivedSpecStale(
  snapshot: DerivedSpecSnapshot | null | undefined,
  currentTiaModifiedAt: string | null | undefined,
): boolean {
  if (!snapshot?.tiaProjectModifiedAt || !currentTiaModifiedAt) return false;
  return new Date(currentTiaModifiedAt) > new Date(snapshot.tiaProjectModifiedAt);
}
