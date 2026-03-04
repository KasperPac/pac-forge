import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database } from "lucide-react";

/** Shows context for the DB generation stage — FBs that need Instance DBs. */
export function DbStageContext() {
  const fbRecommendations = useProcessBuilderStore((s) => s.fbRecommendations);
  const stageArtifacts = useProcessBuilderStore((s) => s.stageArtifacts);
  const confirmed = fbRecommendations.filter((r) => r.confirmed);
  const fbArtifacts = stageArtifacts.fb ?? [];

  const totalInstances = confirmed.reduce((sum, r) => sum + r.instanceCount, 0);

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <Database className="h-3 w-3" />
        DATA BLOCK INPUTS
      </div>
      <ScrollArea className="max-h-36">
        <div className="space-y-1 px-3 pb-2">
          <div className="font-mono text-[11px] text-muted-foreground">
            {fbArtifacts.length > 0
              ? `${fbArtifacts.length} FB artifact(s) from previous stage`
              : "No FB artifacts yet — run FB stage first"}
          </div>
          {confirmed.length > 0 && (
            <div className="font-mono text-[11px] text-muted-foreground">
              {totalInstances} Instance DB(s) expected across {confirmed.length} FB type(s)
            </div>
          )}
          {fbArtifacts.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {fbArtifacts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-sm bg-muted/50 px-2 py-1 font-mono text-[11px]"
                >
                  <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{a.type}</span>
                  <span>{a.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
