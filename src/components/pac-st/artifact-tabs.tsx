import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ArtifactType } from "@/types";

interface ArtifactTab {
  name: string;
  type: ArtifactType;
}

interface ArtifactTabsProps {
  artifacts: ArtifactTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const TYPE_COLORS: Record<ArtifactType, string> = {
  UDT: "bg-blue-500/20 text-blue-400",
  FB: "bg-purple-500/20 text-purple-400",
  FC: "bg-cyan-500/20 text-cyan-400",
  DB: "bg-amber-500/20 text-amber-400",
  OB: "bg-green-500/20 text-green-400",
  SCL_SOURCE: "bg-neutral-500/20 text-neutral-400",
  TAG_TABLE: "bg-orange-500/20 text-orange-400",
  HMI_SCREEN: "bg-teal-500/20 text-teal-400",
  HMI_TAG_TABLE: "bg-rose-500/20 text-rose-400",
};

export function ArtifactTabs({ artifacts, activeIndex, onSelect }: ArtifactTabsProps) {
  if (artifacts.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b px-1 py-1">
      {artifacts.map((artifact, idx) => (
        <button
          key={artifact.name}
          onClick={() => onSelect(idx)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
            idx === activeIndex
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          <Badge
            variant="secondary"
            className={cn("px-1 py-0 text-xs font-bold", TYPE_COLORS[artifact.type])}
          >
            {artifact.type}
          </Badge>
          {artifact.name}
        </button>
      ))}
    </div>
  );
}
