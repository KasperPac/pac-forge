import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Cpu } from "lucide-react";

/** Shows confirmed IO module recommendations for the IO generation stage. */
export function IoStageContext() {
  const ioRecommendations = useProcessBuilderStore((s) => s.ioRecommendations);
  const confirmed = ioRecommendations.filter((r) => r.confirmed);

  if (confirmed.length === 0) {
    return (
      <div className="px-3 py-2 font-mono text-xs text-muted-foreground">
        No IO modules confirmed from Q&A. The AI will generate IO based on Q&A context.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <Cpu className="h-3 w-3" />
        CONFIRMED IO MODULES ({confirmed.length})
      </div>
      <ScrollArea className="max-h-36">
        <div className="space-y-0.5 px-3 pb-2">
          {confirmed.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-sm bg-muted/50 px-2 py-1 font-mono text-[11px]"
            >
              <span className="font-medium">{r.mlfb}</span>
              <span className="text-muted-foreground">
                R{r.rack}/S{r.slot}
              </span>
              <span className="truncate text-muted-foreground">{r.description}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
