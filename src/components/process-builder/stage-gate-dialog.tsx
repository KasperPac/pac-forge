import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { PROCESS_STAGE_LABELS, PROCESS_STAGE_ORDER } from "@/types/process-builder";
import type { ProcessStage } from "@/types/process-builder";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, RotateCcw, ArrowRight } from "lucide-react";

interface StageGateDialogProps {
  open: boolean;
  completedStage: ProcessStage;
  onProceed: () => void;
  onRollback: () => void;
  onDismiss: () => void;
}

export function StageGateDialog({
  open,
  completedStage,
  onProceed,
  onRollback,
  onDismiss,
}: StageGateDialogProps) {
  const stageArtifacts = useProcessBuilderStore((s) => s.stageArtifacts);
  const artifacts = stageArtifacts[completedStage] ?? [];

  const nextIdx = PROCESS_STAGE_ORDER.indexOf(completedStage) + 1;
  const nextStage = nextIdx < PROCESS_STAGE_ORDER.length ? PROCESS_STAGE_ORDER[nextIdx] : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            <Check className="mr-1.5 inline h-4 w-4 text-green-500" />
            {PROCESS_STAGE_LABELS[completedStage]} Complete
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {artifacts.length > 0
              ? `Generated ${artifacts.length} artifact(s)`
              : completedStage === "folders"
                ? "Folder structure created"
                : "Stage completed"}
          </DialogDescription>
        </DialogHeader>

        {artifacts.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border p-2">
            {artifacts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 py-0.5 font-mono text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{a.type}</span>
                <span>{a.name}</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onRollback}>
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Roll Back
          </Button>
          {nextStage && (
            <Button size="sm" onClick={onProceed}>
              <ArrowRight className="mr-1.5 h-3 w-3" />
              Proceed to {PROCESS_STAGE_LABELS[nextStage]}
            </Button>
          )}
          {!nextStage && (
            <Button size="sm" onClick={onDismiss}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
