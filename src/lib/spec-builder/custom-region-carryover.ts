// src/lib/spec-builder/custom-region-carryover.ts
//
// G5-4 §3 — when a spec revision bumps, the previous revision's hand-authored
// custom region in each FC_<Unit>_Process must survive into the fresh
// generation. The row loader is injected (Supabase in the hooks) so this
// stays pure and testable.
//
// `warnings` (flat, prefixed with the artifact name) feeds the send-to-TIA
// plan's warnings list. `warningsByArtifact` feeds the Code Builder view:
// `use-code-builder.ts` attaches it per-artifact via `reconcileArtifacts`'s
// `artifactWarnings` so a mangled-region warning renders on (and is
// acknowledgeable against) the SPECIFIC affected FC_*_Process artifact —
// the same `acknowledged_warnings`/`acknowledgeWarning` mechanism already
// used for safety-gate warnings, generalized to any artifact.
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
): Promise<{ contents: Map<string, string>; warnings: string[]; warningsByArtifact: Map<string, string[]> }> {
  const contents = new Map<string, string>();
  const warnings: string[] = [];
  const warningsByArtifact = new Map<string, string[]>();
  const processFcs = artifacts.filter((a) => PROCESS_FC.test(a.name));
  if (!processFcs.length) return { contents, warnings, warningsByArtifact };
  const prior = await loadPriorEdits(specId, revision, processFcs.map((a) => a.name));
  const byName = new Map(prior.map((r) => [r.artifact_name, r.edited_content]));
  for (const a of processFcs) {
    const prev = byName.get(a.name);
    if (!prev) continue;
    const { content, warning } = mergeCustomRegion(a.content, prev);
    if (warning) {
      warnings.push(`${a.name}: ${warning}`);
      warningsByArtifact.set(a.name, [...(warningsByArtifact.get(a.name) ?? []), warning]);
    } else if (content !== a.content) contents.set(a.name, content);
  }
  return { contents, warnings, warningsByArtifact };
}

/**
 * Build a SEPARATE, homogeneous upsert batch containing ONLY the rows that
 * carried over a custom region, each carrying the SAME key set (every row
 * has `edited_content`). This must be issued as its own `.upsert()` call —
 * never merged into a batch where some rows have `edited_content` and others
 * don't: supabase-js computes the upserted column list as the union of keys
 * across the whole array (`defaultToNull: true`), so a heterogeneous batch
 * would write `edited_content: null` over sibling rows' saved hand edits.
 * Each input row must already be insert-complete (spec_id/revision/
 * artifact_name + base columns) since the artifact may not exist yet.
 */
export function buildCarryOverUpserts<T extends { artifact_name: string }>(
  upserts: readonly T[],
  contents: Map<string, string>,
): (T & { edited_content: string })[] {
  const out: (T & { edited_content: string })[] = [];
  for (const u of upserts) {
    const merged = contents.get(u.artifact_name);
    if (merged !== undefined) out.push({ ...u, edited_content: merged });
  }
  return out;
}

/** Supabase-backed loader: the latest prior-revision edit (if any) for each
 *  named artifact, deduplicated to the most recent revision per name. */
export const loadPriorEditsSupabase: PriorEditLoader = async (specId, beforeRevision, artifactNames) => {
  const { data, error } = await supabase
    .from("code_builder_artifacts")
    .select("artifact_name, edited_content, revision")
    .eq("spec_id", specId).lt("revision", beforeRevision)
    .in("artifact_name", artifactNames).not("edited_content", "is", null)
    .order("revision", { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  return (data ?? []).filter((r) => (seen.has(r.artifact_name) ? false : (seen.add(r.artifact_name), true)))
    .map((r) => ({ artifact_name: r.artifact_name as string, edited_content: r.edited_content as string }));
};
