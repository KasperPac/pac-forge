import { Check, Circle, Loader2, X } from "lucide-react";
import { FORGE_STEP_LABELS } from "@/types/forge";
import { cn } from "@/lib/utils";
import type { ForgeStep } from "@/types/forge";
import type { ForgeStepStatus } from "@/stores/forge-store";

interface ForgeStepBarProps {
  steps: ForgeStep[];
  currentStep: ForgeStep;
  stepStatuses: Record<ForgeStep, ForgeStepStatus>;
  onStepClick: (step: ForgeStep) => void;
}

function StepStatusIcon({ status }: { status: ForgeStepStatus }) {
  switch (status) {
    case "completed":
      return <Check className="h-3.5 w-3.5" />;
    case "active":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "failed":
      return <X className="h-3.5 w-3.5" />;
    default:
      return <Circle className="h-3.5 w-3.5" />;
  }
}

function getStatusClasses(status: ForgeStepStatus, isCurrent: boolean) {
  if (status === "completed") {
    return isCurrent
      ? "border-green-500/60 bg-green-500/15 text-green-400"
      : "border-green-500/40 bg-green-500/10 text-green-500";
  }

  if (status === "active") {
    return "border-blue-500/50 bg-blue-500/10 text-blue-400";
  }

  if (status === "failed") {
    return "border-red-500/50 bg-red-500/10 text-red-400";
  }

  return isCurrent
    ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
    : "border-border/70 bg-background/40 text-muted-foreground";
}

export function ForgeStepBar({
  steps,
  currentStep,
  stepStatuses,
  onStepClick,
}: ForgeStepBarProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-3">
      <div className="grid gap-2 xl:grid-cols-[repeat(7,minmax(0,1fr))]">
        {steps.map((step, index) => {
          const status = stepStatuses[step];
          const isCurrent = step === currentStep;
          const isClickable = step === currentStep || status === "completed";

          return (
            <div key={step} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => isClickable && onStepClick(step)}
                disabled={!isClickable}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                  getStatusClasses(status, isCurrent),
                  isClickable
                    ? "cursor-pointer hover:bg-accent/60 hover:text-foreground"
                    : "cursor-not-allowed opacity-80"
                )}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-current/30 bg-background/40 font-mono text-[11px]">
                  {status === "completed" ? <StepStatusIcon status={status} /> : index + 1}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] uppercase tracking-[0.16em]">
                    Step {index + 1}
                  </div>
                  <div className="truncate text-sm font-medium">
                    {FORGE_STEP_LABELS[step]}
                  </div>
                </div>
                {status !== "completed" && (
                  <div className="shrink-0">
                    <StepStatusIcon status={status} />
                  </div>
                )}
              </button>
              {index < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    "hidden h-px flex-1 xl:block",
                    stepStatuses[step] === "completed" ? "bg-green-500/40" : "bg-border/70"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
