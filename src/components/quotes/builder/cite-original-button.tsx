import { Link as LinkIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CitationTargetSection } from "@/types";

interface Props {
  variationId: string;
  targetSection: CitationTargetSection;
  targetDocId: string;
  hasCitation: boolean;
  sourceLabelShort?: string;
  onClick: () => void;
  onClear: () => void;
}

export function CiteOriginalButton({
  hasCitation,
  sourceLabelShort,
  onClick,
  onClear,
}: Props) {
  if (hasCitation) {
    return (
      <div className="inline-flex items-center gap-2 text-[11px] font-mono">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded",
            "bg-[#3050A0]/20 text-[#94AEDF] border border-[#3050A0]",
          )}
        >
          <LinkIcon className="h-3 w-3" />
          {sourceLabelShort ?? "Cited"}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-zinc-500 hover:text-red-400 inline-flex items-center gap-1"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-mono text-zinc-500 hover:text-[#94AEDF] inline-flex items-center gap-1"
    >
      <LinkIcon className="h-3 w-3" />
      Cite original…
    </button>
  );
}
