import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SafetyWarning } from "@/types";

interface SafetyBannerProps {
  warnings: SafetyWarning[];
  onAcknowledge: (id: string) => void;
}

const WARNING_LABELS: Record<string, string> = {
  UNSAFE_MOTOR: "Unsafe Motor Logic",
  MISSING_INTERLOCK: "Missing Interlock",
  IO_MISMATCH: "IO Index Mismatch",
  ALARM_RESET_VIOLATION: "Alarm Reset Violation",
  ARRAY_OOB: "Array Out of Bounds",
  UNINITIALIZED_STATE: "Uninitialized State",
};

export function SafetyBanner({ warnings, onAcknowledge }: SafetyBannerProps) {
  const unacknowledged = warnings.filter((w) => !w.acknowledged);
  if (unacknowledged.length === 0) return null;

  return (
    <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-2">
      <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        {unacknowledged.length} Safety Warning{unacknowledged.length > 1 ? "s" : ""}
      </div>
      {unacknowledged.map((warning) => (
        <div
          key={warning.id}
          className="flex items-start justify-between gap-2 rounded bg-destructive/5 px-2 py-1.5"
        >
          <div className="min-w-0">
            <div className="font-mono text-xs font-medium text-destructive">
              {WARNING_LABELS[warning.type] ?? warning.type}
            </div>
            <div className="text-xs text-muted-foreground">
              {warning.artifact_name}
              {warning.line != null ? `:${warning.line}` : ""} — {warning.description}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5"
            onClick={() => onAcknowledge(warning.id)}
            title="Acknowledge"
          >
            <Check className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
