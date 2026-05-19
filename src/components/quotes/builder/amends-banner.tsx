import type { VariationCitation } from "@/types";

interface Props {
  citation: VariationCitation;
  sourceLabel: string;
}

export function AmendsBanner({ citation, sourceLabel }: Props) {
  return (
    <div className="rounded border-l-4 border-[#3050A0] bg-[#3050A0]/10 p-3 mb-2 space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#94AEDF]">
        Amends {sourceLabel}
      </div>
      <div className="text-xs font-mono text-zinc-300 whitespace-pre-wrap">
        {citation.original_text_verbatim}
      </div>
    </div>
  );
}
