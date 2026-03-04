import { PROCESS_STAGE_LABELS } from "@/types/process-builder";
import type { ProcessBuilderSession } from "@/types/process-builder";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Play } from "lucide-react";

interface ResumeSessionDialogProps {
  open: boolean;
  session: ProcessBuilderSession;
  onResume: () => void;
  onStartOver: () => void;
}

export function ResumeSessionDialog({
  open,
  session,
  onResume,
  onStartOver,
}: ResumeSessionDialogProps) {
  const completedStages = session.stage_statuses
    .filter((s) => s.status === "completed")
    .map((s) => PROCESS_STAGE_LABELS[s.stage]);

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Incomplete Process Session Found
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            You have an in-progress process builder session at stage{" "}
            <strong>{PROCESS_STAGE_LABELS[session.current_stage]}</strong>.
          </DialogDescription>
        </DialogHeader>

        {completedStages.length > 0 && (
          <div className="rounded-md border p-2">
            <div className="font-mono text-[10px] text-muted-foreground">COMPLETED STAGES</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {completedStages.map((label) => (
                <span
                  key={label}
                  className="rounded bg-green-950/30 px-1.5 py-0.5 font-mono text-[10px] text-green-500"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onStartOver}>
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Start Over
          </Button>
          <Button size="sm" onClick={onResume}>
            <Play className="mr-1.5 h-3 w-3" />
            Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
