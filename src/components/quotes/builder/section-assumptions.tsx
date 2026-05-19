import { useState } from "react";
import { Plus } from "lucide-react";
import { assumptions } from "@/hooks/use-doc-content";
import { useAssumptionLibrary } from "@/hooks/use-assumption-library";
import { OrderedListEditor } from "./_ordered-list-editor";
import {
  useCitationsForVariation,
  useDeleteCitation,
} from "@/hooks/use-variation-citations";
import { useVariationBuilderCtx } from "./variation-builder-context";
import { useBuilderParentRef } from "./use-builder-parent-ref";
import { CiteOriginalButton } from "./cite-original-button";
import { AmendsBanner } from "./amends-banner";
import { CitationPickerDialog } from "./citation-picker-dialog";
import type { DocAssumption } from "@/types";

export function SectionAssumptions() {
  const ref = useBuilderParentRef();
  const variation = useVariationBuilderCtx();

  const { data: rows = [] } = assumptions.useList(ref ?? undefined);
  const { data: library = [] } = useAssumptionLibrary();
  const create = assumptions.useCreate();
  const update = assumptions.useUpdate();
  const remove = assumptions.useDelete();

  const { data: citations = [] } = useCitationsForVariation(
    variation?.variationId,
  );
  const removeCitation = useDeleteCitation();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [citePickerRowId, setCitePickerRowId] = useState<string | null>(null);
  const isPending = create.isPending || update.isPending || remove.isPending;
  const usedKeys = new Set(
    rows.map((r) => r.assumption_key).filter((k): k is string => !!k),
  );

  function citationFor(rowId: string) {
    return citations.find(
      (c) => c.target_section === "assumption" && c.target_doc_id === rowId,
    );
  }

  function addFromLibrary(entryId: string) {
    if (!ref) return;
    const entry = library.find((e) => e.id === entryId);
    if (!entry) return;
    create.mutate({
      ...ref,
      assumption_key: entry.assumption_key,
      title: entry.title,
      value: entry.default_value,
      notes: null,
      ordering: rows.length,
    });
    setPickerOpen(false);
  }

  function addFreeform() {
    if (!ref) return;
    create.mutate({
      ...ref,
      assumption_key: null,
      title: "New assumption",
      value: null,
      notes: null,
      ordering: rows.length,
    });
    setPickerOpen(false);
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <OrderedListEditor<DocAssumption>
        title="Assumptions"
        description="Pre-conditions the quote relies on — defendable in dispute."
        emptyHint="No assumptions yet. Pull from the library or write a freeform one."
        addLabel={pickerOpen ? "Close" : "Add assumption"}
        rows={rows}
        isPending={isPending}
        onAdd={() => setPickerOpen((v) => !v)}
        onDelete={(row) => {
          if (!ref) return;
          remove.mutate({ id: row.id, ref });
        }}
        onSwap={(a, b) => {
          if (!ref) return;
          update.mutate({ id: a.id, updates: { ordering: b.ordering }, ref });
          update.mutate({ id: b.id, updates: { ordering: a.ordering }, ref });
        }}
        renderRow={(row) => {
          const cite = variation ? citationFor(row.id) : undefined;
          return (
            <div className="space-y-2">
              {variation && cite && (
                <AmendsBanner citation={cite} sourceLabel="(source)" />
              )}
              {variation && (
                <div className="flex justify-end">
                  <CiteOriginalButton
                    variationId={variation.variationId}
                    targetSection="assumption"
                    targetDocId={row.id}
                    hasCitation={!!cite}
                    onClick={() => setCitePickerRowId(row.id)}
                    onClear={() => {
                      if (cite)
                        removeCitation.mutate({
                          id: cite.id,
                          variation_id: variation.variationId,
                        });
                    }}
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  aria-label="Assumption title"
                  defaultValue={row.title ?? ""}
                  placeholder="Title"
                  className="flex-1 bg-transparent border-b border-zinc-700 focus:border-[#3050A0] text-sm text-zinc-100 py-1 outline-none"
                  onBlur={(e) => {
                    if (!ref) return;
                    const next = e.target.value === "" ? null : e.target.value;
                    if (next !== row.title) {
                      update.mutate({
                        id: row.id,
                        updates: { title: next },
                        ref,
                      });
                    }
                  }}
                />
                {row.assumption_key ? (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800">
                    {row.assumption_key}
                  </span>
                ) : null}
              </div>
              <input
                aria-label="Assumption value"
                defaultValue={row.value ?? ""}
                placeholder="Value (e.g. 415V 3-phase supply)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-300 focus:border-[#3050A0] outline-none"
                onBlur={(e) => {
                  if (!ref) return;
                  const next = e.target.value === "" ? null : e.target.value;
                  if (next !== row.value) {
                    update.mutate({
                      id: row.id,
                      updates: { value: next },
                      ref,
                    });
                  }
                }}
              />
              <textarea
                aria-label="Notes"
                defaultValue={row.notes ?? ""}
                placeholder="Optional notes…"
                rows={2}
                className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-400 focus:border-[#3050A0] outline-none"
                onBlur={(e) => {
                  if (!ref) return;
                  const next = e.target.value === "" ? null : e.target.value;
                  if (next !== row.notes) {
                    update.mutate({
                      id: row.id,
                      updates: { notes: next },
                      ref,
                    });
                  }
                }}
              />
            </div>
          );
        }}
      />

      {variation && citePickerRowId && (
        <CitationPickerDialog
          open
          onOpenChange={(o) => !o && setCitePickerRowId(null)}
          variationId={variation.variationId}
          projectId={variation.projectId}
          targetSection="assumption"
          targetDocId={citePickerRowId}
          onCreated={() => setCitePickerRowId(null)}
        />
      )}

      {pickerOpen && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              From library
            </span>
            <button
              type="button"
              onClick={addFreeform}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Plus className="h-3 w-3" />
              Freeform
            </button>
          </div>
          {library.length === 0 ? (
            <p className="text-xs text-zinc-500">Library is empty.</p>
          ) : (
            <ul className="space-y-1.5">
              {library.map((entry) => {
                const used = usedKeys.has(entry.assumption_key);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={used}
                      onClick={() => addFromLibrary(entry.id)}
                      className="w-full text-left px-3 py-2 rounded border border-zinc-800 hover:border-[#3050A0] disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-950"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-zinc-200">
                          {entry.title}
                        </span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                          {used ? "in use" : entry.assumption_key}
                        </span>
                      </div>
                      {entry.default_value ? (
                        <div className="text-xs font-mono text-zinc-400 mt-1">
                          {entry.default_value}
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
