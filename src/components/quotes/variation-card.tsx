import { Link } from "react-router";
import { FilePen, Eye } from "lucide-react";
import type { Variation, VariationStatus } from "@/types";
import { cn } from "@/lib/utils";

interface VariationCardProps {
  variation: Variation;
}

const STATUS_STYLES: Record<VariationStatus, string> = {
  draft: "bg-zinc-800 text-zinc-300 border-zinc-700",
  issued: "bg-[#3050A0]/30 text-[#94AEDF] border-[#3050A0]",
};

export function VariationCard({ variation }: VariationCardProps) {
  const isDraft = variation.status === "draft";
  const href = isDraft
    ? `/variations/${variation.id}/edit`
    : `/variations/${variation.id}/view`;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-zinc-100">
            V{variation.variation_number}
          </span>
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border",
              STATUS_STYLES[variation.status],
            )}
          >
            {variation.status}
          </span>
          {variation.issued_at ? (
            <span className="text-[11px] font-mono text-zinc-500">
              · {new Date(variation.issued_at).toLocaleDateString()}
            </span>
          ) : null}
        </div>
        {variation.summary ? (
          <div className="mt-1 text-xs font-mono text-zinc-400 truncate">
            {variation.summary}
          </div>
        ) : null}
      </div>
      <Link
        to={href}
        className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex-shrink-0"
      >
        {isDraft ? (
          <>
            <FilePen className="h-3 w-3" />
            Edit draft
          </>
        ) : (
          <>
            <Eye className="h-3 w-3" />
            View
          </>
        )}
      </Link>
    </div>
  );
}
