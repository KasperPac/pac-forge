import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UnresolvedFinding } from "@/lib/pipeline";
import { MAX_REVIEW_ROUNDS } from "@/lib/pipeline";

interface UnresolvedFindingsBannerProps {
  findings: UnresolvedFinding[];
  onDismiss: () => void;
}

export function UnresolvedFindingsBanner({ findings, onDismiss }: UnresolvedFindingsBannerProps) {
  if (findings.length === 0) return null;

  return (
    <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-xs font-medium text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {findings.length} Unresolved Finding{findings.length > 1 ? "s" : ""} After {MAX_REVIEW_ROUNDS} Review Rounds
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {findings.map((finding, i) => (
        <div
          key={`${finding.artifactName}-${i}`}
          className="flex items-start justify-between gap-2 rounded bg-amber-500/5 px-2 py-1.5"
        >
          <div className="min-w-0">
            <div className="font-mono text-xs font-medium text-amber-400">
              {finding.artifactName}
            </div>
            <div className="text-xs text-muted-foreground">
              {finding.description}
            </div>
          </div>
          <div className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {finding.reviewerName}
          </div>
        </div>
      ))}
    </div>
  );
}
