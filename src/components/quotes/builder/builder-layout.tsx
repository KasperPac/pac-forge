import type { ReactNode } from "react";
import { SectionNavigator } from "./section-navigator";
import { BuilderFooter } from "./builder-footer";
import { PreviewPane } from "@/components/quotes/preview-pane";

interface BuilderLayoutProps {
  editor: ReactNode;
  snapshot: unknown | null;
  total: number;
  status?: string | null;
  header?: ReactNode;
}

export function BuilderLayout({
  editor,
  snapshot,
  total,
  status,
  header,
}: BuilderLayoutProps) {
  return (
    <div className="grid grid-rows-[auto_1fr_auto] h-full min-h-0">
      {header ? (
        <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-3">
          {header}
        </div>
      ) : (
        <div />
      )}
      <div className="grid grid-cols-[220px_minmax(0,1fr)_520px] min-h-0">
        <aside className="border-r border-zinc-800 bg-zinc-950 overflow-y-auto">
          <SectionNavigator />
        </aside>
        <main className="overflow-y-auto p-6 bg-zinc-950" data-testid="builder-editor">
          {editor}
        </main>
        <PreviewPane snapshot={snapshot} />
      </div>
      <BuilderFooter total={total} status={status} />
    </div>
  );
}
