import { useState } from "react";
import { Plus, Star, Archive, RotateCcw } from "lucide-react";
import {
  useTncTemplates,
  useCreateTncTemplate,
  useUpdateTncTemplate,
  useSetDefaultTncTemplate,
} from "@/hooks/use-tnc-templates";
import type { TncTemplate } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function TncTemplateList({ selectedId, onSelect }: Props) {
  const { data: templates = [], isLoading } = useTncTemplates();
  const create = useCreateTncTemplate();
  const update = useUpdateTncTemplate();
  const setDefault = useSetDefaultTncTemplate();

  const [showArchived, setShowArchived] = useState(false);

  const visible = templates
    .filter((t) => showArchived || t.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Templates
        </span>
        <button
          type="button"
          onClick={async () => {
            const t = await create.mutateAsync({ name: "New template" });
            onSelect(t.id);
          }}
          disabled={create.isPending}
          className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded bg-pac-blue-600 text-pac-paper hover:bg-pac-blue-700 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <label className="text-[11px] font-mono text-muted-foreground cursor-pointer flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="accent-pac-blue-600"
          />
          Show archived
        </label>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {isLoading && (
          <li className="px-3 py-4 text-xs font-mono text-muted-foreground">Loading…</li>
        )}
        {!isLoading && visible.length === 0 && (
          <li className="px-3 py-4 text-xs font-mono text-muted-foreground">
            No templates yet.
          </li>
        )}
        {visible.map((t) => (
          <li key={t.id}>
            <TemplateRow
              template={t}
              isActive={selectedId === t.id}
              onSelect={() => onSelect(t.id)}
              onSetDefault={() => setDefault.mutate(t.id)}
              onArchive={() =>
                update.mutate({
                  id: t.id,
                  updates: { status: t.status === "active" ? "archived" : "active" },
                })
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateRow({
  template,
  isActive,
  onSelect,
  onSetDefault,
  onArchive,
}: {
  template: TncTemplate;
  isActive: boolean;
  onSelect: () => void;
  onSetDefault: () => void;
  onArchive: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-3 py-2 flex items-center gap-2 border-l-2 transition-colors",
        isActive
          ? "bg-pac-blue-50 border-l-pac-blue-600"
          : "border-l-transparent hover:bg-accent",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {template.is_default && (
            <Star
              className="h-3 w-3 text-pac-signal-amber fill-pac-signal-amber flex-shrink-0"
              aria-label="Default template"
            />
          )}
          <span
            className={cn(
              "text-sm truncate",
              template.status === "archived"
                ? "text-muted-foreground line-through"
                : "text-foreground",
            )}
          >
            {template.name}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            v{template.version}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {!template.is_default && template.status === "active" && (
          <span
            role="button"
            aria-label="Set as default"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault();
            }}
            className="p-1 rounded hover:bg-accent"
          >
            <Star className="h-3 w-3 text-muted-foreground hover:text-pac-signal-amber" />
          </span>
        )}
        <span
          role="button"
          aria-label={template.status === "active" ? "Archive" : "Unarchive"}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="p-1 rounded hover:bg-accent"
        >
          {template.status === "active" ? (
            <Archive className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          ) : (
            <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          )}
        </span>
      </div>
    </button>
  );
}
