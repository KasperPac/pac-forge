import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePdfPreview } from "@/hooks/use-pdf-preview";

interface PreviewPaneProps {
  snapshot: unknown | null;
  className?: string;
}

export function PreviewPane({ snapshot, className }: PreviewPaneProps) {
  const { url, isLoading, error, refresh } = usePdfPreview(snapshot);

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-zinc-950 border-l border-zinc-800",
        className,
      )}
      data-testid="preview-pane"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-400">
          Preview{isLoading ? " · rendering…" : ""}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading || !snapshot}
          aria-label="Refresh preview"
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:hover:bg-zinc-800"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div
          className="p-4 text-xs font-mono text-red-400 whitespace-pre-wrap"
          role="alert"
        >
          {error}
        </div>
      )}

      {!error && url && (
        <iframe
          src={url}
          title="Quote PDF preview"
          className="flex-1 w-full bg-white"
        />
      )}

      {!error && !url && (
        <div className="flex-1 flex items-center justify-center p-6 text-xs font-mono text-zinc-500">
          {snapshot
            ? isLoading
              ? "Rendering preview…"
              : "Preview will appear here."
            : "No content to preview yet."}
        </div>
      )}
    </div>
  );
}
