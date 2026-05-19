import { useState } from "react";
import {
  scopeItems,
  inclusions,
  exclusions,
} from "@/hooks/use-doc-content";
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
import type { CitationTargetSection, DocScopeItem } from "@/types";

type CrudFactory = typeof scopeItems | typeof inclusions | typeof exclusions;

interface ScopeLikeEditorProps {
  crud: CrudFactory;
  title: string;
  description: string;
  emptyHint: string;
  addLabel: string;
  defaultTitle: string;
  targetSection: CitationTargetSection;
}

/**
 * Shared editor for scope / inclusions / exclusions. All three are
 * structurally identical (title + body markdown, ordered list) so the only
 * difference is the table and the labels.
 *
 * When mounted inside a VariationBuilderProvider, each row gains a
 * CiteOriginalButton + AmendsBanner that lets users link the row back to a
 * source item in a prior issued document.
 */
export function ScopeLikeEditor({
  crud,
  title,
  description,
  emptyHint,
  addLabel,
  defaultTitle,
  targetSection,
}: ScopeLikeEditorProps) {
  const ref = useBuilderParentRef();
  const variation = useVariationBuilderCtx();

  const { data: rows = [] } = crud.useList(ref ?? undefined);
  const create = crud.useCreate();
  const update = crud.useUpdate();
  const remove = crud.useDelete();

  const { data: citations = [] } = useCitationsForVariation(
    variation?.variationId,
  );
  const removeCitation = useDeleteCitation();

  const [openPickerForRowId, setOpenPickerForRowId] = useState<string | null>(
    null,
  );

  const isPending = create.isPending || update.isPending || remove.isPending;

  function citationFor(rowId: string) {
    return citations.find(
      (c) => c.target_section === targetSection && c.target_doc_id === rowId,
    );
  }

  return (
    <>
      <OrderedListEditor<DocScopeItem>
        title={title}
        description={description}
        emptyHint={emptyHint}
        addLabel={addLabel}
        rows={rows}
        isPending={isPending}
        onAdd={() => {
          if (!ref) return;
          create.mutate({
            ...ref,
            title: defaultTitle,
            body: null,
            ordering: rows.length,
          });
        }}
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
                    targetSection={targetSection}
                    targetDocId={row.id}
                    hasCitation={!!cite}
                    onClick={() => setOpenPickerForRowId(row.id)}
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
              <input
                aria-label="Title"
                defaultValue={row.title}
                placeholder="Title"
                className="w-full bg-transparent border-b border-zinc-700 focus:border-[#3050A0] text-sm text-zinc-100 py-1 outline-none"
                onBlur={(e) => {
                  if (!ref) return;
                  const value = e.target.value;
                  if (value !== row.title) {
                    update.mutate({
                      id: row.id,
                      updates: { title: value },
                      ref,
                    });
                  }
                }}
              />
              <textarea
                aria-label="Body"
                defaultValue={row.body ?? ""}
                placeholder="Optional details (markdown)…"
                rows={2}
                className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-300 focus:border-[#3050A0] outline-none"
                onBlur={(e) => {
                  if (!ref) return;
                  const value = e.target.value;
                  const next = value === "" ? null : value;
                  if (next !== row.body) {
                    update.mutate({
                      id: row.id,
                      updates: { body: next },
                      ref,
                    });
                  }
                }}
              />
            </div>
          );
        }}
      />

      {variation && openPickerForRowId && (
        <CitationPickerDialog
          open
          onOpenChange={(o) => !o && setOpenPickerForRowId(null)}
          variationId={variation.variationId}
          projectId={variation.projectId}
          targetSection={targetSection}
          targetDocId={openPickerForRowId}
          onCreated={() => setOpenPickerForRowId(null)}
        />
      )}
    </>
  );
}
