import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type BuilderStep = "device" | "em" | "unit" | "export";

const STEPS: { id: BuilderStep; label: string; enabled: boolean }[] = [
  { id: "device", label: "Device", enabled: true },
  { id: "em", label: "EM", enabled: true },
  { id: "unit", label: "Unit", enabled: true },
  { id: "export", label: "Export", enabled: false },
];

export function BuilderStepper({
  active, onSelect,
}: {
  active: BuilderStep;
  onSelect?: (step: BuilderStep) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="builder-stepper">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          {i > 0 && <span className="text-muted-foreground">›</span>}
          <button
            type="button"
            data-testid={`step-${s.id}`}
            disabled={!s.enabled}
            onClick={() => { if (s.enabled) onSelect?.(s.id); }}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium",
              s.id === active && "bg-primary text-primary-foreground",
              s.id !== active && s.enabled && "bg-muted text-foreground hover:bg-accent",
              !s.enabled && "bg-muted/50 text-muted-foreground/60 cursor-not-allowed",
            )}
            title={s.enabled ? undefined : "Coming next"}
            aria-disabled={!s.enabled}
          >
            {s.id === active && <Check className="h-3 w-3" />}
            {i + 1} {s.label}
          </button>
        </div>
      ))}
    </div>
  );
}
