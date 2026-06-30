import { useMemo, useState } from "react";
import { useTncTemplates } from "@/hooks/use-tnc-templates";
import { TncTemplateList } from "@/components/tnc/tnc-template-list";
import { TncTemplateForm } from "@/components/tnc/tnc-template-form";
import { TncClauseEditor } from "@/components/tnc/tnc-clause-editor";

export default function TncLibraryRoute() {
  const { data: templates = [] } = useTncTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default the selection to the first active template when one is available.
  const effectiveId = useMemo(() => {
    if (selectedId && templates.some((t) => t.id === selectedId)) {
      return selectedId;
    }
    return templates.find((t) => t.status === "active")?.id ?? null;
  }, [selectedId, templates]);

  const selected = templates.find((t) => t.id === effectiveId) ?? null;

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] h-full min-h-0 gap-px bg-border">
      <aside className="bg-card min-h-0">
        <TncTemplateList
          selectedId={effectiveId}
          onSelect={setSelectedId}
        />
      </aside>
      <main className="bg-background overflow-y-auto p-6 space-y-6">
        {selected ? (
          <>
            <TncTemplateForm
              template={selected}
              onDeleted={() => setSelectedId(null)}
            />
            <div className="border-t border-border pt-6">
              <TncClauseEditor templateId={selected.id} />
            </div>
          </>
        ) : (
          <p className="text-sm font-mono text-muted-foreground">
            Select a template on the left, or create a new one.
          </p>
        )}
      </main>
    </div>
  );
}
