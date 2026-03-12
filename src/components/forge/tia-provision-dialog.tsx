import { CheckCircle2, XCircle, Loader2, Cpu } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProvisionStatus } from "@/hooks/use-forge-provision";

interface TiaProvisionDialogProps {
  open: boolean;
  status: ProvisionStatus;
  onClose: () => void;
}

const EXPECTED_STEPS = [
  "Connecting to TIA Portal",
  "Creating TIA project",
  "Adding PLC device",
  "Adding IO modules",
  "Creating IO tag table",
  "Saving project",
  "Compiling hardware",
  "Complete",
];

export function TiaProvisionDialog({ open, status, onClose }: TiaProvisionDialogProps) {
  const isDone = status.phase === "done" || status.phase === "error" || status.phase === "skipped";

  // Merge WS steps with expected steps list for display
  const displaySteps = EXPECTED_STEPS.map(label => {
    const wsStep = status.steps.find(s => s.label === label);
    if (wsStep) return wsStep;
    // If a later step is active/done, this one is done
    const latestDoneIndex = Math.max(...status.steps.map((s, i) => s.state !== "pending" ? i : -1));
    const expectedIndex = EXPECTED_STEPS.indexOf(label);
    const latestActiveStep = status.steps.find(s => s.state === "active");
    const latestActiveIndex = latestActiveStep ? EXPECTED_STEPS.indexOf(latestActiveStep.label) : -1;
    if (expectedIndex < latestActiveIndex) {
      return { label, progress: 100, state: "done" as const };
    }
    void latestDoneIndex;
    return { label, progress: 0, state: "pending" as const };
  });

  // If bridge is offline (skipped), show appropriate message
  if (status.phase === "skipped") {
    return (
      <Dialog open={open} onOpenChange={open ? undefined : onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              TIA Project Setup
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <XCircle className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">TIA Bridge is offline — project will be created at compile time.</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-md border border-border px-4 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-accent/30 transition-colors"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={isDone ? onClose : undefined}>
      <DialogContent className="max-w-md" onInteractOutside={e => { if (!isDone) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
            <Cpu className="h-4 w-4 text-primary" />
            TIA Project Setup
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1 py-2">
          {displaySteps.map((step, i) => (
            <StepRow key={i} label={step.label} state={step.state} />
          ))}
        </div>

        {status.phase === "error" && status.message && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
            {status.message}
          </div>
        )}

        {(status.warnings?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400 font-mono space-y-0.5">
            {status.warnings!.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}

        {isDone && (
          <div className="flex justify-end pt-1">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-4 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-accent/30 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ label, state }: { label: string; state: "pending" | "active" | "done" | "error" }) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
      state === "active" && "bg-primary/10",
      state === "done" && "opacity-60",
      state === "pending" && "opacity-30",
    )}>
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        {state === "done" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {state === "active" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {state === "error" && <XCircle className="h-4 w-4 text-destructive" />}
        {state === "pending" && <div className="h-2 w-2 rounded-full border border-border" />}
      </div>
      <span className={cn(
        "text-sm",
        state === "active" && "text-foreground font-medium",
        state === "pending" && "text-muted-foreground",
        state === "done" && "text-muted-foreground",
        state === "error" && "text-destructive",
      )}>
        {label}
      </span>
    </div>
  );
}
