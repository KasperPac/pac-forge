import { CheckCircle2, Circle, Loader2, XCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SubPipelineStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface SubPipelineStage {
  label: string;
  status: SubPipelineStageStatus;
  detail?: string;
}

interface ForgeSubPipelineProps {
  stages: SubPipelineStage[];
}

function StageIcon({ status }: { status: SubPipelineStageStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "skipped":
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/50" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/30" />;
  }
}

export function ForgeSubPipeline({ stages }: ForgeSubPipelineProps) {
  return (
    <div className="flex items-center gap-0">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center">
          {/* Stage pill */}
          <div
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-mono",
              stage.status === "running" && "bg-primary/10 text-primary",
              stage.status === "completed" && "text-green-400",
              stage.status === "failed" && "text-destructive",
              stage.status === "skipped" && "text-muted-foreground/40",
              stage.status === "pending" && "text-muted-foreground/50",
            )}
          >
            <StageIcon status={stage.status} />
            <span>{stage.label}</span>
            {stage.detail && (
              <span
                className={cn(
                  "ml-0.5",
                  stage.status === "failed" ? "text-destructive/80" : "text-muted-foreground/60",
                )}
              >
                ({stage.detail})
              </span>
            )}
          </div>

          {/* Connector */}
          {i < stages.length - 1 && (
            <div className="h-px w-3 bg-border/50" />
          )}
        </div>
      ))}
    </div>
  );
}
