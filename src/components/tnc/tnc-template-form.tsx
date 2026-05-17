import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  useUpdateTncTemplate,
  useDeleteTncTemplate,
} from "@/hooks/use-tnc-templates";
import type { TncTemplate } from "@/types";

interface Props {
  template: TncTemplate;
  onDeleted: () => void;
}

export function TncTemplateForm({ template, onDeleted }: Props) {
  const update = useUpdateTncTemplate();
  const remove = useDeleteTncTemplate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function saveField<K extends keyof TncTemplate>(
    key: K,
    value: TncTemplate[K],
  ) {
    if (template[key] === value) return;
    update.mutate({
      id: template.id,
      updates: { [key]: value } as Partial<TncTemplate>,
    });
  }

  async function handleDelete() {
    await remove.mutateAsync(template.id);
    onDeleted();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Template metadata</h2>
        <div className="flex items-center gap-2">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-red-900 text-white hover:bg-red-800 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                {remove.isPending ? "Deleting…" : "Confirm delete"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 items-center">
        <label
          htmlFor={`tpl-name-${template.id}`}
          className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
        >
          Name
        </label>
        <input
          id={`tpl-name-${template.id}`}
          key={`${template.id}-name`}
          defaultValue={template.name}
          onBlur={(e) => saveField("name", e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:border-[#3050A0] outline-none"
        />

        <label
          htmlFor={`tpl-version-${template.id}`}
          className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
        >
          Version
        </label>
        <input
          id={`tpl-version-${template.id}`}
          key={`${template.id}-version`}
          type="number"
          min="1"
          defaultValue={template.version}
          onBlur={(e) => saveField("version", Number(e.target.value) || 1)}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:border-[#3050A0] outline-none w-24"
        />

        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          Status
        </span>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span
            className={`px-2 py-0.5 rounded ${
              template.status === "active"
                ? "bg-emerald-900/40 text-emerald-300 border border-emerald-800"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            }`}
          >
            {template.status}
          </span>
          {template.is_default && (
            <span className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">
              default
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
