import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OrderedRow {
  id: string;
  ordering: number;
}

interface OrderedListEditorProps<T extends OrderedRow> {
  title: string;
  description?: string;
  rows: T[];
  emptyHint: string;
  renderRow: (row: T) => ReactNode;
  onAdd: () => void;
  onDelete: (row: T) => void;
  onSwap: (a: T, b: T) => void;
  isPending?: boolean;
  addLabel?: string;
}

export function OrderedListEditor<T extends OrderedRow>({
  title,
  description,
  rows,
  emptyHint,
  renderRow,
  onAdd,
  onDelete,
  onSwap,
  isPending,
  addLabel = "Add",
}: OrderedListEditorProps<T>) {
  const sorted = [...rows].sort((a, b) => a.ordering - b.ordering);

  return (
    <section className="space-y-4 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          {description ? (
            <p className="text-xs font-mono text-zinc-500 mt-1">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={isPending}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white",
            "hover:bg-[#3F61B0] disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Plus className="h-3 w-3" aria-hidden />
          {addLabel}
        </button>
      </header>

      {sorted.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-sm text-zinc-400">
          {emptyHint}
        </p>
      )}

      <ul className="space-y-2">
        {sorted.map((row, idx) => {
          const above = idx > 0 ? sorted[idx - 1] : null;
          const below = idx < sorted.length - 1 ? sorted[idx + 1] : null;
          return (
            <li
              key={row.id}
              className="rounded-md border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1 pt-1">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => above && onSwap(row, above)}
                    disabled={!above || isPending}
                    className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => below && onSwap(row, below)}
                    disabled={!below || isPending}
                    className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">{renderRow(row)}</div>
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => onDelete(row)}
                  disabled={isPending}
                  className="text-zinc-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
