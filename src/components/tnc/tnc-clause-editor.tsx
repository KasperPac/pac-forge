import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  useTncClauses,
  useCreateTncClause,
  useUpdateTncClause,
  useDeleteTncClause,
  useReorderTncClauses,
} from "@/hooks/use-tnc-clauses";

interface Props {
  templateId: string;
}

export function TncClauseEditor({ templateId }: Props) {
  const { data: clauses = [], isLoading } = useTncClauses(templateId);
  const create = useCreateTncClause();
  const update = useUpdateTncClause();
  const remove = useDeleteTncClause();
  const reorder = useReorderTncClauses();

  const sorted = [...clauses].sort((a, b) => a.ordering - b.ordering);

  function addClause() {
    create.mutate({
      template_id: templateId,
      clause_number: String(sorted.length + 1),
      title: "New clause",
      body_markdown: "",
      ordering: sorted.length,
    });
  }

  function swap(aIdx: number, bIdx: number) {
    const a = sorted[aIdx];
    const b = sorted[bIdx];
    if (!a || !b) return;
    reorder.mutate({
      template_id: templateId,
      ordered: [
        { id: a.id, ordering: b.ordering },
        { id: b.id, ordering: a.ordering },
      ],
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">
          Clauses ({sorted.length})
        </h2>
        <button
          type="button"
          onClick={addClause}
          disabled={create.isPending}
          className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          Add clause
        </button>
      </div>

      {isLoading && (
        <p className="text-xs font-mono text-zinc-500">Loading clauses…</p>
      )}

      {!isLoading && sorted.length === 0 && (
        <p className="text-xs font-mono text-zinc-500 rounded border border-dashed border-zinc-700 bg-zinc-900/40 p-4">
          No clauses yet. Add the first one to start the template.
        </p>
      )}

      <ul className="space-y-2">
        {sorted.map((c, idx) => (
          <li
            key={c.id}
            className="rounded border border-zinc-800 bg-zinc-900 p-3"
          >
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-0.5 pt-1">
                <button
                  type="button"
                  aria-label="Move up"
                  onClick={() => swap(idx, idx - 1)}
                  disabled={idx === 0 || reorder.isPending}
                  className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  onClick={() => swap(idx, idx + 1)}
                  disabled={idx === sorted.length - 1 || reorder.isPending}
                  className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Clause number"
                    defaultValue={c.clause_number}
                    onBlur={(e) => {
                      if (e.target.value !== c.clause_number) {
                        update.mutate({
                          id: c.id,
                          updates: { clause_number: e.target.value },
                        });
                      }
                    }}
                    className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-[#3050A0] outline-none"
                  />
                  <input
                    aria-label="Clause title"
                    defaultValue={c.title}
                    onBlur={(e) => {
                      if (e.target.value !== c.title) {
                        update.mutate({
                          id: c.id,
                          updates: { title: e.target.value },
                        });
                      }
                    }}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:border-[#3050A0] outline-none"
                  />
                </div>
                <textarea
                  aria-label="Clause body"
                  defaultValue={c.body_markdown}
                  rows={3}
                  onBlur={(e) => {
                    if (e.target.value !== c.body_markdown) {
                      update.mutate({
                        id: c.id,
                        updates: { body_markdown: e.target.value },
                      });
                    }
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-300 focus:border-[#3050A0] outline-none"
                />
              </div>
              <button
                type="button"
                aria-label="Delete clause"
                onClick={() => remove.mutate({ id: c.id, template_id: templateId })}
                disabled={remove.isPending}
                className="text-zinc-500 hover:text-red-400 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
