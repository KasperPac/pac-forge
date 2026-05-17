import type { ReactNode } from "react";

interface SectionStubProps {
  title: string;
  description: string;
  taskRef?: string;
  children?: ReactNode;
}

export function SectionStub({
  title,
  description,
  taskRef,
  children,
}: SectionStubProps) {
  return (
    <section className="max-w-3xl">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
        <p className="text-xs font-mono text-zinc-500 mt-1">{description}</p>
      </header>
      <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-sm text-zinc-400">
        {children ?? (
          <p>
            Editor not yet wired{taskRef ? ` — see ${taskRef}` : ""}. The
            preview pane on the right will still reflect any data already saved
            for this section.
          </p>
        )}
      </div>
    </section>
  );
}
