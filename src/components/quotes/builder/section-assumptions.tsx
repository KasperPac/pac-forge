import { useState } from "react";
import { useParams } from "react-router";
import { Plus } from "lucide-react";
import { assumptions, type ParentRef } from "@/hooks/use-doc-content";
import { useAssumptionLibrary } from "@/hooks/use-assumption-library";
import { OrderedListEditor } from "./_ordered-list-editor";
import type { DocAssumption } from "@/types";

export function SectionAssumptions() {
  const { revId } = useParams<{ revId: string }>();
  const ref: ParentRef = {
    parent_type: "quote_revision",
    parent_id: revId ?? "",
  };

  const { data: rows = [] } = assumptions.useList(revId ? ref : undefined);
  const { data: library = [] } = useAssumptionLibrary();
  const create = assumptions.useCreate();
  const update = assumptions.useUpdate();
  const remove = assumptions.useDelete();

  const [pickerOpen, setPickerOpen] = useState(false);
  const isPending = create.isPending || update.isPending || remove.isPending;
  const usedKeys = new Set(
    rows.map((r) => r.assumption_key).filter((k): k is string => !!k),
  );

  function addFromLibrary(entryId: string) {
    if (!revId) return;
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
    if (!revId) return;
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
        onDelete={(row) => remove.mutate({ id: row.id, ref })}
        onSwap={(a, b) => {
          update.mutate({ id: a.id, updates: { ordering: b.ordering }, ref });
          update.mutate({ id: b.id, updates: { ordering: a.ordering }, ref });
        }}
        renderRow={(row) => (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                aria-label="Assumption title"
                defaultValue={row.title ?? ""}
                placeholder="Title"
                className="flex-1 bg-transparent border-b border-zinc-700 focus:border-[#3050A0] text-sm text-zinc-100 py-1 outline-none"
                onBlur={(e) => {
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
                const next = e.target.value === "" ? null : e.target.value;
                if (next !== row.value) {
                  update.mutate({ id: row.id, updates: { value: next }, ref });
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
                const next = e.target.value === "" ? null : e.target.value;
                if (next !== row.notes) {
                  update.mutate({ id: row.id, updates: { notes: next }, ref });
                }
              }}
            />
          </div>
        )}
      />

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
