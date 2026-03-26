import { useState } from "react";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { PROCESS_STAGE_ORDER, PROCESS_STAGE_LABELS } from "@/types/forge-matrix";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, FileCode, Package } from "lucide-react";
import type { Artifact } from "@/types";

function ArtifactRow({
  artifact,
  selected,
  onClick,
}: {
  artifact: Artifact;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/30",
        selected && "bg-accent/50",
      )}
    >
      <FileCode className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-xs">{artifact.name}</span>
      <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
        {artifact.type}
      </span>
    </button>
  );
}

/** Right panel showing all generated artifacts organized by stage. */
export function ArtifactAccumulator() {
  const stageArtifacts = useProcessBuilderStore((s) => s.stageArtifacts);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());

  const toggleStage = (stage: string) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const totalArtifacts = PROCESS_STAGE_ORDER.reduce(
    (sum, stage) => sum + (stageArtifacts[stage]?.length ?? 0),
    0,
  );

  // Find selected artifact for preview
  let selectedArtifact: Artifact | null = null;
  if (selectedArtifactId) {
    for (const stage of PROCESS_STAGE_ORDER) {
      const found = stageArtifacts[stage]?.find((a) => a.id === selectedArtifactId);
      if (found) {
        selectedArtifact = found;
        break;
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-xs font-medium">Artifacts</span>
        {totalArtifacts > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {totalArtifacts}
          </span>
        )}
      </div>

      {totalArtifacts === 0 ? (
        <div className="flex flex-1 items-center justify-center px-3">
          <div className="font-mono text-xs text-muted-foreground">
            No artifacts generated yet
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Artifact list */}
          <ScrollArea className={cn("min-h-0", selectedArtifact ? "h-1/3" : "flex-1")}>
            {PROCESS_STAGE_ORDER.map((stage) => {
              const artifacts = stageArtifacts[stage] ?? [];
              if (artifacts.length === 0) return null;
              const collapsed = collapsedStages.has(stage);

              return (
                <div key={stage}>
                  <button
                    onClick={() => toggleStage(stage)}
                    className="flex w-full items-center gap-1.5 bg-muted/30 px-3 py-1 text-left hover:bg-muted/50"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="font-mono text-[10px] font-medium">
                      {PROCESS_STAGE_LABELS[stage]}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      ({artifacts.length})
                    </span>
                  </button>
                  {!collapsed &&
                    artifacts.map((a) => (
                      <ArtifactRow
                        key={a.id}
                        artifact={a}
                        selected={a.id === selectedArtifactId}
                        onClick={() =>
                          setSelectedArtifactId(a.id === selectedArtifactId ? null : a.id)
                        }
                      />
                    ))}
                </div>
              );
            })}
          </ScrollArea>

          {/* Code preview */}
          {selectedArtifact && (
            <div className="min-h-0 flex-1 border-t">
              <div className="flex items-center justify-between px-3 py-1">
                <span className="font-mono text-[10px] font-medium">
                  {selectedArtifact.name}
                </span>
                <button
                  onClick={() => setSelectedArtifactId(null)}
                  className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  close
                </button>
              </div>
              <ScrollArea className="h-full max-h-64">
                <pre className="whitespace-pre-wrap px-3 pb-3 font-mono text-[11px]">
                  {selectedArtifact.content}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
