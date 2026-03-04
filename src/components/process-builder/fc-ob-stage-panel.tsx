import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Network } from "lucide-react";

/** Shows context for the FC+OB generation stage — all prior artifacts that will be wired together. */
export function FcObStageContext() {
  const stageArtifacts = useProcessBuilderStore((s) => s.stageArtifacts);
  const fbArtifacts = stageArtifacts.fb ?? [];
  const dbArtifacts = stageArtifacts.db ?? [];
  const ioArtifacts = stageArtifacts.io ?? [];

  const totalPrior = fbArtifacts.length + dbArtifacts.length + ioArtifacts.length;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <Network className="h-3 w-3" />
        PROCESS FC + OB1 INPUTS ({totalPrior} artifacts)
      </div>
      <ScrollArea className="max-h-48">
        <div className="space-y-2 px-3 pb-2">
          {ioArtifacts.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-muted-foreground">IO ({ioArtifacts.length})</div>
              {ioArtifacts.map((a) => (
                <div key={a.id} className="rounded-sm bg-muted/50 px-2 py-0.5 font-mono text-[11px]">
                  {a.name}
                </div>
              ))}
            </div>
          )}
          {fbArtifacts.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-muted-foreground">FBs ({fbArtifacts.length})</div>
              {fbArtifacts.map((a) => (
                <div key={a.id} className="rounded-sm bg-muted/50 px-2 py-0.5 font-mono text-[11px]">
                  {a.name}
                </div>
              ))}
            </div>
          )}
          {dbArtifacts.length > 0 && (
            <div>
              <div className="font-mono text-[10px] text-muted-foreground">DBs ({dbArtifacts.length})</div>
              {dbArtifacts.map((a) => (
                <div key={a.id} className="rounded-sm bg-muted/50 px-2 py-0.5 font-mono text-[11px]">
                  {a.name}
                </div>
              ))}
            </div>
          )}
          {totalPrior === 0 && (
            <div className="font-mono text-[11px] text-muted-foreground">
              No prior artifacts — run IO, FB, and DB stages first.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
