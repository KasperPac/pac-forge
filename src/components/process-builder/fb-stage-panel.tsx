import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Blocks, Library } from "lucide-react";

/** Shows confirmed FB recommendations grouped by device type. */
export function FbStageContext() {
  const fbRecommendations = useProcessBuilderStore((s) => s.fbRecommendations);
  const confirmed = fbRecommendations.filter((r) => r.confirmed);

  if (confirmed.length === 0) {
    return (
      <div className="px-3 py-2 font-mono text-xs text-muted-foreground">
        No FBs confirmed from Q&A. The AI will generate FBs based on Q&A context.
      </div>
    );
  }

  // Group by device type
  const grouped = confirmed.reduce<Record<string, typeof confirmed>>((acc, r) => {
    if (!acc[r.deviceType]) acc[r.deviceType] = [];
    acc[r.deviceType].push(r);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <Blocks className="h-3 w-3" />
        FUNCTION BLOCKS BY DEVICE TYPE
      </div>
      <ScrollArea className="max-h-48">
        <div className="space-y-2 px-3 pb-2">
          {Object.entries(grouped).map(([deviceType, recs]) => (
            <div key={deviceType}>
              <div className="font-mono text-[11px] font-medium">{deviceType}</div>
              <div className="mt-0.5 space-y-0.5">
                {recs.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-sm bg-muted/50 px-2 py-1 font-mono text-[11px]"
                  >
                    <span>{r.templateName}</span>
                    <span className="text-muted-foreground">x{r.instanceCount}</span>
                    {r.templateId ? (
                      <span className="flex items-center gap-0.5 text-[10px] text-green-500">
                        <Library className="h-2.5 w-2.5" /> library
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-500">new</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
