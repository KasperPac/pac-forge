import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateCitation } from "@/hooks/use-variation-citations";
import type {
  CitationTargetSection,
  Quote,
  QuoteRevision,
  Variation,
  DocScopeItem,
  DocAssumption,
  DocLineItem,
} from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variationId: string;
  projectId: string;
  targetSection: CitationTargetSection;
  targetDocId: string;
  onCreated: () => void;
}

const SECTION_TABLE: Record<CitationTargetSection, string> = {
  scope: "doc_scope_items",
  inclusion: "doc_inclusions",
  exclusion: "doc_exclusions",
  assumption: "doc_assumptions",
  line_item: "doc_line_items",
};

type SourceKind = "quote_revision" | "variation";

interface SourceOption {
  kind: SourceKind;
  id: string;
  label: string;
}

type ContentRow = DocScopeItem | DocAssumption | DocLineItem;

function originalVerbatim(
  row: ContentRow | undefined,
  section: CitationTargetSection,
): string {
  if (!row) return "";
  if (section === "assumption") {
    const a = row as DocAssumption;
    return [a.title, a.value, a.notes].filter(Boolean).join(" — ");
  }
  if (section === "line_item") {
    const li = row as DocLineItem;
    return li.customer_doc_label ?? li.description;
  }
  const s = row as DocScopeItem;
  return s.body ? `${s.title}\n\n${s.body}` : s.title;
}

export function CitationPickerDialog({
  open,
  onOpenChange,
  variationId,
  projectId,
  targetSection,
  targetDocId,
  onCreated,
}: Props) {
  const project = useQuery({
    queryKey: ["project-for-citation", projectId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as { id: string; awarded_quote_id: string | null };
    },
  });

  const revs = useQuery({
    queryKey: ["issued-revs-for-project", projectId],
    enabled: open,
    queryFn: async () => {
      const { data: revRows, error } = await supabase
        .from("quote_revisions")
        .select("*")
        .eq("status", "issued");
      if (error) throw error;
      const allRevs = (revRows as QuoteRevision[]) ?? [];
      if (allRevs.length === 0) return [] as { rev: QuoteRevision; quote: Quote }[];
      const quoteIds = Array.from(new Set(allRevs.map((r) => r.quote_id)));
      const { data: qs } = await supabase
        .from("quotes")
        .select("*")
        .in("id", quoteIds);
      const projectQuotes = ((qs as Quote[]) ?? []).filter(
        (q) => q.project_id === projectId,
      );
      const projectQuoteIds = new Set(projectQuotes.map((q) => q.id));
      return allRevs
        .filter((r) => projectQuoteIds.has(r.quote_id))
        .map((rev) => ({
          rev,
          quote: projectQuotes.find((q) => q.id === rev.quote_id)!,
        }));
    },
  });

  const variations = useQuery({
    queryKey: ["issued-variations-for-project", projectId, variationId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variations")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "issued");
      if (error) throw error;
      return ((data as Variation[]) ?? []).filter((v) => v.id !== variationId);
    },
  });

  const sources: SourceOption[] = useMemo(() => {
    const r = (revs.data ?? []).map(({ rev, quote }) => ({
      kind: "quote_revision" as const,
      id: rev.id,
      label: `${quote.number} Rev ${rev.rev_number}`,
    }));
    const v = (variations.data ?? []).map((variation) => ({
      kind: "variation" as const,
      id: variation.id,
      label: `V${variation.variation_number}`,
    }));
    return [...r, ...v];
  }, [revs.data, variations.data]);

  const [pickedId, setPickedId] = useState<string | null>(null);

  const effectivePicked: SourceOption | null = useMemo(() => {
    if (pickedId) {
      const found = sources.find((s) => s.id === pickedId);
      if (found) return found;
    }
    const awarded = project.data?.awarded_quote_id;
    if (awarded) {
      const m = sources.find(
        (s) => s.kind === "quote_revision" && s.id === awarded,
      );
      if (m) return m;
    }
    return sources[0] ?? null;
  }, [pickedId, project.data, sources]);

  const items = useQuery({
    queryKey: [
      "citation-items",
      effectivePicked?.kind,
      effectivePicked?.id,
      targetSection,
    ],
    enabled: !!effectivePicked,
    queryFn: async () => {
      const parent_type = effectivePicked!.kind;
      const parent_id = effectivePicked!.id;
      const { data, error } = await supabase
        .from(SECTION_TABLE[targetSection])
        .select("*")
        .eq("parent_type", parent_type)
        .eq("parent_id", parent_id)
        .order("ordering");
      if (error) throw error;
      return ((data as ContentRow[]) ?? []);
    },
  });

  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const itemRow = (items.data ?? []).find((r) => r.id === pickedItem);
  const create = useCreateCitation();

  async function confirm() {
    if (!effectivePicked || !itemRow) return;
    await create.mutateAsync({
      variation_id: variationId,
      target_section: targetSection,
      target_doc_id: targetDocId,
      source_kind: effectivePicked.kind,
      source_id: effectivePicked.id,
      source_section: targetSection,
      source_item_id: itemRow.id,
      original_text_verbatim: originalVerbatim(itemRow, targetSection),
    });
    onCreated();
    onOpenChange(false);
    setPickedId(null);
    setPickedItem(null);
  }

  function pickSource(s: SourceOption) {
    setPickedId(s.id);
    setPickedItem(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Cite an original item</DialogTitle>
          <DialogDescription className="font-mono text-xs text-zinc-400">
            Pick the document and section item this row amends.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3">
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Source
            </div>
            <ul className="space-y-1">
              {sources.map((s) => (
                <li key={`${s.kind}-${s.id}`}>
                  <button
                    type="button"
                    onClick={() => pickSource(s)}
                    className={cn(
                      "w-full text-left text-xs font-mono px-2 py-1.5 rounded border",
                      effectivePicked?.kind === s.kind &&
                        effectivePicked?.id === s.id
                        ? "border-[#3050A0] bg-[#3050A0]/15 text-white"
                        : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
              {sources.length === 0 && (
                <li className="text-xs text-zinc-500">
                  No issued documents on this project.
                </li>
              )}
            </ul>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              {targetSection} items
            </div>
            <ul className="space-y-1 max-h-96 overflow-y-auto">
              {(items.data ?? []).map((row) => {
                const label = originalVerbatim(row, targetSection);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setPickedItem(row.id)}
                      className={cn(
                        "w-full text-left text-xs px-2 py-1.5 rounded border whitespace-pre-wrap",
                        pickedItem === row.id
                          ? "border-[#3050A0] bg-[#3050A0]/15 text-white"
                          : "border-zinc-800 text-zinc-300 hover:bg-zinc-900",
                      )}
                    >
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!itemRow || create.isPending}
            onClick={confirm}
            className="text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
          >
            {create.isPending ? "Saving…" : "Confirm"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
