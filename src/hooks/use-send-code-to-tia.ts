/**
 * useSendCodeToTia — assemble the FULL generated program (all layers, with
 * any Code Builder edits overlaid) into the bridge's reimport-compile
 * sources map, in dependency order (UDT → FB → FC → DB → OB). The bridge
 * deletes + reimports each block, then compiles everything; TIA must be
 * OFFLINE and open with the target project.
 */
import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract } from "@/lib/spec-builder/codegen";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useReimportCompile } from "@/hooks/use-reimport-compile";

const TYPE_ORDER: Record<string, number> = { UDT: 0, FB: 1, FC: 2, DB: 3, OB: 4 };

export interface CodeSendPlan {
  /** name → SCL, insertion-ordered for import (UDTs first, OB last). */
  sources: Record<string, string>;
  countsByType: Record<string, number>;
  /** Block names whose content is a Code Builder edit, not raw generation. */
  editedBlocks: string[];
  warnings: string[];
}

export function useSendCodeToTia(specId: string | undefined, revision: number | undefined) {
  const { data: templates = [] } = useFbTemplates();
  const reimport = useReimportCompile();
  const [plan, setPlan] = useState<CodeSendPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildPlan = useCallback(async (): Promise<CodeSendPlan> => {
    if (!specId || revision === undefined) throw new Error("spec/revision not ready");
    setPlanning(true);
    setError(null);
    try {
      const contract = await loadSpecContract(specId);
      const result = compileContract(contract, templates);
      const { data: rows, error: dbError } = await supabase
        .from("code_builder_artifacts")
        .select("artifact_name, edited_content")
        .eq("spec_id", specId)
        .eq("revision", revision);
      if (dbError) throw dbError;
      const edits = new Map(
        (rows ?? [])
          .filter((r) => r.edited_content)
          .map((r) => [r.artifact_name as string, r.edited_content as string]),
      );

      const sorted = [...result.artifacts].sort(
        (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9),
      );
      const sources: Record<string, string> = {};
      const countsByType: Record<string, number> = {};
      const editedBlocks: string[] = [];
      for (const a of sorted) {
        const edited = edits.get(a.name);
        sources[a.name] = edited ?? a.content;
        if (edited) editedBlocks.push(a.name);
        countsByType[a.type] = (countsByType[a.type] ?? 0) + 1;
      }
      const next: CodeSendPlan = { sources, countsByType, editedBlocks, warnings: result.warnings };
      setPlan(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setPlanning(false);
    }
  }, [specId, revision, templates]);

  const send = useCallback(
    (sources: Record<string, string>) => reimport.mutateAsync({ sources }),
    [reimport],
  );

  return {
    buildPlan,
    plan,
    planning,
    error,
    send,
    sending: reimport.isPending,
    compileResult: reimport.data ?? null,
    sendError: reimport.error ? String(reimport.error) : null,
  };
}
