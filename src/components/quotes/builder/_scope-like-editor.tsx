import { useParams } from "react-router";
import {
  scopeItems,
  inclusions,
  exclusions,
  type ParentRef,
} from "@/hooks/use-doc-content";
import { OrderedListEditor } from "./_ordered-list-editor";
import type { DocScopeItem } from "@/types";

type CrudFactory = typeof scopeItems | typeof inclusions | typeof exclusions;

interface ScopeLikeEditorProps {
  crud: CrudFactory;
  title: string;
  description: string;
  emptyHint: string;
  addLabel: string;
  defaultTitle: string;
}

/**
 * Shared editor for scope / inclusions / exclusions. All three are
 * structurally identical (title + body markdown, ordered list) so the only
 * difference is the table and the labels.
 */
export function ScopeLikeEditor({
  crud,
  title,
  description,
  emptyHint,
  addLabel,
  defaultTitle,
}: ScopeLikeEditorProps) {
  const { revId } = useParams<{ revId: string }>();
  const ref: ParentRef = {
    parent_type: "quote_revision",
    parent_id: revId ?? "",
  };

  const { data: rows = [] } = crud.useList(revId ? ref : undefined);
  const create = crud.useCreate();
  const update = crud.useUpdate();
  const remove = crud.useDelete();

  const isPending = create.isPending || update.isPending || remove.isPending;

  return (
    <OrderedListEditor<DocScopeItem>
      title={title}
      description={description}
      emptyHint={emptyHint}
      addLabel={addLabel}
      rows={rows}
      isPending={isPending}
      onAdd={() => {
        if (!revId) return;
        create.mutate({
          ...ref,
          title: defaultTitle,
          body: null,
          ordering: rows.length,
        });
      }}
      onDelete={(row) => {
        remove.mutate({ id: row.id, ref });
      }}
      onSwap={(a, b) => {
        update.mutate({ id: a.id, updates: { ordering: b.ordering }, ref });
        update.mutate({ id: b.id, updates: { ordering: a.ordering }, ref });
      }}
      renderRow={(row) => (
        <div className="space-y-2">
          <input
            aria-label="Title"
            defaultValue={row.title}
            placeholder="Title"
            className="w-full bg-transparent border-b border-zinc-700 focus:border-[#3050A0] text-sm text-zinc-100 py-1 outline-none"
            onBlur={(e) => {
              const value = e.target.value;
              if (value !== row.title) {
                update.mutate({ id: row.id, updates: { title: value }, ref });
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
              const value = e.target.value;
              const next = value === "" ? null : value;
              if (next !== row.body) {
                update.mutate({ id: row.id, updates: { body: next }, ref });
              }
            }}
          />
        </div>
      )}
    />
  );
}
