// src/lib/spec-builder/custom-region-carryover.ts
//
// G5-4 §3 — when a spec revision bumps, the previous revision's hand-authored
// custom region in each FC_<Unit>_Process must survive into the fresh
// generation. The row loader is injected (Supabase in the hooks) so this
// stays pure and testable.
import { supabase } from "@/lib/supabase";
import { mergeCustomRegion } from "./codegen/custom-region";

export interface PriorEditRow { artifact_name: string; edited_content: string }
export type PriorEditLoader = (specId: string, beforeRevision: number, artifactNames: string[]) => Promise<PriorEditRow[]>;

const PROCESS_FC = /^FC_.+_Process$/;

export async function carryOverCustomRegions(
  artifacts: { name: string; content: string }[],
  specId: string,
  revision: number,
  loadPriorEdits: PriorEditLoader,
): Promise<{ contents: Map<string, string>; warnings: string[] }> {
  const contents = new Map<string, string>();
  const warnings: string[] = [];
  const processFcs = artifacts.filter((a) => PROCESS_FC.test(a.name));
  if (!processFcs.length) return { contents, warnings };
  const prior = await loadPriorEdits(specId, revision, processFcs.map((a) => a.name));
  const byName = new Map(prior.map((r) => [r.artifact_name, r.edited_content]));
  for (const a of processFcs) {
    const prev = byName.get(a.name);
    if (!prev) continue;
    const { content, warning } = mergeCustomRegion(a.content, prev);
    if (warning) warnings.push(`${a.name}: ${warning}`);
    else if (content !== a.content) contents.set(a.name, content);
  }
  return { contents, warnings };
}

/** Supabase-backed loader: the latest prior-revision edit (if any) for each
 *  named artifact, deduplicated to the most recent revision per name. */
export const loadPriorEditsSupabase: PriorEditLoader = async (specId, beforeRevision, artifactNames) => {
  const { data } = await supabase
    .from("code_builder_artifacts")
    .select("artifact_name, edited_content, revision")
    .eq("spec_id", specId).lt("revision", beforeRevision)
    .in("artifact_name", artifactNames).not("edited_content", "is", null)
    .order("revision", { ascending: false });
  const seen = new Set<string>();
  return (data ?? []).filter((r) => (seen.has(r.artifact_name) ? false : (seen.add(r.artifact_name), true)))
    .map((r) => ({ artifact_name: r.artifact_name as string, edited_content: r.edited_content as string }));
};
