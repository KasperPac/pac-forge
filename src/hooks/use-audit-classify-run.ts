/**
 * Thin run/persist wrapper around `classifyBlocks` — fetches the four
 * inputs from Supabase, runs the deterministic engine, and upserts
 * results via `useUpsertAuditClassifications`.
 *
 * Phase 1 of step 11 — see Docs/PAC_AUDIT_DERIVED_SPEC.md §5, §16.
 * Phase 2 (review panel UI) will replace the minimal console-style
 * summary currently returned to the caller.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  classifyBlocks,
  countByRole,
  type ClassifyBlockInput,
  type ClassifyFolderInput,
  type ClassifyResult,
  type ClassifyUnderstandingInput,
} from "@/lib/audit-classify";
import { useUpsertAuditClassifications } from "@/hooks/use-audit-classifications";
import type { AuditCrossReference, FbRole, StateMachineAnalysis } from "@/types/audit";

export interface ClassifyRunSummary {
  results: ClassifyResult[];
  counts: Record<FbRole, number>;
  total: number;
  persisted: number;
}

export function useRunAuditClassify() {
  const upsert = useUpsertAuditClassifications();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (auditProjectId: string): Promise<ClassifyRunSummary> => {
      // 1. Blocks (logic blocks only — DBs/UDTs are skipped by the engine,
      //    but fetching a narrow set keeps the payload tight). `source_code`
      //    is needed by the fault-writes rule (R04b), which scans for
      //    fault-named LHS assignments the cross-ref index may not surface.
      const { data: blockRows, error: blockErr } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type, folder_id, source_code")
        .eq("audit_project_id", auditProjectId)
        .in("block_type", ["OB", "FB", "FC"]);
      if (blockErr) throw blockErr;
      const blocks: ClassifyBlockInput[] = (blockRows ?? []) as ClassifyBlockInput[];

      // 2. Folders
      const { data: folderRows, error: folderErr } = await supabase
        .from("audit_folders")
        .select("id, path")
        .eq("audit_project_id", auditProjectId);
      if (folderErr) throw folderErr;
      const folders: ClassifyFolderInput[] = (folderRows ?? []) as ClassifyFolderInput[];

      // 3. Cross-references
      const { data: xrefRows, error: xrefErr } = await supabase
        .from("audit_cross_references")
        .select("*")
        .eq("audit_project_id", auditProjectId);
      if (xrefErr) throw xrefErr;
      const crossReferences = (xrefRows ?? []) as AuditCrossReference[];

      // 4. Understandings — only `state_machine.mechanism` is used by rules.
      const { data: uRows, error: uErr } = await supabase
        .from("audit_block_understanding")
        .select("block_id, state_machine")
        .eq("audit_project_id", auditProjectId)
        .eq("is_current", true);
      if (uErr) throw uErr;
      const understandings: ClassifyUnderstandingInput[] = (uRows ?? []).map((r) => ({
        block_id: r.block_id as string,
        state_machine: (r.state_machine as StateMachineAnalysis | null) ?? null,
      }));

      // --- Run ---------------------------------------------------------
      const results = classifyBlocks({
        blocks,
        folders,
        crossReferences,
        understandings,
      });

      // --- Persist — auto_* fields only; engineer overrides preserved
      //     because they aren't in the payload (onConflict='block_id'
      //     updates only the columns sent). See §3.3 + hook docs. -----
      const persisted = await upsert.mutateAsync({
        auditProjectId,
        rows: results.map((r) => ({
          audit_project_id: auditProjectId,
          block_id: r.block_id,
          role: r.role,
          auto_reason: `[${r.rule_id}] ${r.auto_reason}`,
        })),
      });

      await queryClient.invalidateQueries({
        queryKey: ["audit_fb_classifications", auditProjectId],
      });

      return {
        results,
        counts: countByRole(results),
        total: results.length,
        persisted,
      };
    },
  });
}
