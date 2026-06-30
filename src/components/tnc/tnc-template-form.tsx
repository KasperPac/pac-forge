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
        <h2 className="text-sm font-semibold text-foreground">Template metadata</h2>
        <div className="flex items-center gap-2">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-xs font-mono px-2 py-1 rounded border border-border text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-pac-signal-red text-pac-paper hover:bg-pac-signal-red/90 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                {remove.isPending ? "Deleting…" : "Confirm delete"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-border text-foreground hover:bg-accent"
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
          className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
        >
          Name
        </label>
        <input
          id={`tpl-name-${template.id}`}
          key={`${template.id}-name`}
          defaultValue={template.name}
          onBlur={(e) => saveField("name", e.target.value)}
          className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:border-pac-blue-600 outline-none"
        />

        <label
          htmlFor={`tpl-version-${template.id}`}
          className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
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
          className="bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:border-pac-blue-600 outline-none w-24"
        />

        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Status
        </span>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span
            className={`px-2 py-0.5 rounded border ${
              template.status === "active"
                ? "bg-pac-signal-green-bg text-pac-signal-green border-pac-signal-green/30"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {template.status}
          </span>
          {template.is_default && (
            <span className="px-2 py-0.5 rounded bg-pac-signal-amber-bg text-pac-signal-amber border border-pac-signal-amber/30">
              default
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
