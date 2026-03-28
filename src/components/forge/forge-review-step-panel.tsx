/**
 * forge-review-step-panel.tsx
 *
 * Reusable panel for the human-in-the-loop review cycle:
 *   1. Agent runs review → shows findings
 *   2. User selects which findings to fix (checkboxes)
 *   3. Selected findings sent to Code Architect for rewrite
 *   4. Re-review: flags repeat findings as "unresolved"
 *   5. User accepts and moves on
 *
 * Used by Standards Review, IO Validation, and Safety Audit steps.
 */

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Send,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TrackedFinding, ReviewStepStatus } from "@/lib/forge-review-helpers";

export type { TrackedFinding, ReviewStepStatus };

export interface ReviewStepPanelProps {
  /** Display name: "Standards Review", "IO Validation", etc. */
  title: string;
  /** Agent colour */
  accentColor: "blue" | "amber" | "red" | "green";
  /** Current step status */
  status: ReviewStepStatus;
  /** Tracked findings from the review */
  findings: TrackedFinding[];
  /** Whether the agent is currently loading */
  loading: boolean;
  /** Error message if the step failed */
  error: string | null;
  /** Called when user clicks "Run Review" */
  onRunReview: () => void;
  /** Called when user toggles a finding's selected state */
  onToggleFinding: (id: string) => void;
  /** Called to select/deselect all findings */
  onSelectAll: (selected: boolean) => void;
  /** Called when user clicks "Fix Selected" — sends selected findings to rewrite */
  onFixSelected: () => void;
  /** Called when user clicks "Accept & Continue" — moves to next step */
  onAccept: () => void;
  /** Called when user clicks "Skip" — skips this review step */
  onSkip: () => void;
  /** Whether this agent is enabled */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Colour presets
// ---------------------------------------------------------------------------

const ACCENT_STYLES = {
  blue: { border: "border-blue-500/30", bg: "bg-blue-500/5", text: "text-blue-400", headerBg: "bg-blue-500/10" },
  amber: { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400", headerBg: "bg-amber-500/10" },
  red: { border: "border-red-500/30", bg: "bg-red-500/5", text: "text-red-400", headerBg: "bg-red-500/10" },
  green: { border: "border-green-500/30", bg: "bg-green-500/5", text: "text-green-400", headerBg: "bg-green-500/10" },
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "border-red-500/50 text-red-400",
  WARNING: "border-amber-500/50 text-amber-400",
  INFO: "border-blue-500/50 text-blue-400",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewStepPanel({
  title,
  accentColor,
  status,
  findings,
  loading,
  error,
  onRunReview,
  onToggleFinding,
  onSelectAll,
  onFixSelected,
  onAccept,
  onSkip,
  enabled,
}: ReviewStepPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const accent = ACCENT_STYLES[accentColor];

  const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
  const warningCount = findings.filter((f) => f.severity === "WARNING").length;
  const infoCount = findings.filter((f) => f.severity === "INFO").length;
  const selectedCount = findings.filter((f) => f.selected).length;
  const unresolvedCount = findings.filter((f) => f.unresolved).length;
  const totalIssues = criticalCount + warningCount;

  if (!enabled) {
    return (
      <Card className="border-border/30 opacity-50">
        <CardHeader className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">{title}</span>
            <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={cn("transition-colors", accent.border, status === "clean" && "border-green-500/30")}>
      {/* Header */}
      <CardHeader
        className={cn("px-4 py-2.5 cursor-pointer", status === "reviewing" || status === "rewriting" || status === "re-reviewing" ? accent.headerBg : "")}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}

          {/* Status icon */}
          {loading ? (
            <Loader2 className={cn("h-4 w-4 animate-spin", accent.text)} />
          ) : status === "clean" || status === "accepted" ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : totalIssues > 0 ? (
            <AlertTriangle className={cn("h-4 w-4", accent.text)} />
          ) : (
            <div className={cn("h-4 w-4 rounded-full border-2", accent.border)} />
          )}

          <span className={cn("text-sm font-medium", status === "clean" || status === "accepted" ? "text-green-400" : accent.text)}>
            {title}
          </span>

          {/* Counts */}
          <div className="flex items-center gap-1.5 ml-2">
            {status === "idle" && (
              <Badge variant="outline" className="text-xs text-muted-foreground">Not run</Badge>
            )}
            {status === "skipped" && (
              <Badge variant="outline" className="text-xs text-muted-foreground">Skipped</Badge>
            )}
            {(status === "clean" || status === "accepted") && findings.length === 0 && (
              <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">Clean</Badge>
            )}
            {criticalCount > 0 && (
              <Badge variant="outline" className="text-xs text-red-400 border-red-500/30">
                {criticalCount} critical
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">
                {warningCount} warning{warningCount > 1 ? "s" : ""}
              </Badge>
            )}
            {infoCount > 0 && (
              <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">
                {infoCount} info
              </Badge>
            )}
            {unresolvedCount > 0 && (
              <Badge variant="outline" className="text-xs text-red-400 border-red-500/30 bg-red-500/10">
                {unresolvedCount} unresolved
              </Badge>
            )}
          </div>

          {/* Actions — right side */}
          <div className="flex items-center gap-1.5 ml-auto" onClick={(e) => e.stopPropagation()}>
            {status === "idle" && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRunReview} disabled={loading}>
                <RefreshCw className="h-3 w-3" />
                Run
              </Button>
            )}
            {status === "findings" && selectedCount > 0 && (
              <Button size="sm" variant="outline" className={cn("h-7 gap-1.5 text-xs", accent.text)} onClick={onFixSelected} disabled={loading}>
                <Send className="h-3 w-3" />
                Fix {selectedCount} Selected
              </Button>
            )}
            {(status === "findings" || status === "accepted") && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRunReview} disabled={loading}>
                <RefreshCw className="h-3 w-3" />
                Re-run
              </Button>
            )}
            {(status === "findings" || status === "clean") && (
              <Button size="sm" variant="default" className="h-7 gap-1.5 text-xs" onClick={onAccept}>
                <CheckCircle2 className="h-3 w-3" />
                Accept
              </Button>
            )}
            {status === "idle" && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={onSkip}>
                <SkipForward className="h-3 w-3" />
                Skip
              </Button>
            )}
          </div>
        </div>

        {/* Loading status text */}
        {loading && (
          <div className="mt-1.5 text-xs text-muted-foreground">
            {status === "reviewing" && "Running review..."}
            {status === "rewriting" && "Code Architect fixing selected issues..."}
            {status === "re-reviewing" && "Re-checking for remaining issues..."}
          </div>
        )}
      </CardHeader>

      {/* Findings list */}
      {expanded && findings.length > 0 && (status === "findings" || status === "accepted") && (
        <CardContent className="px-4 pb-3 pt-0">
          {/* Select all bar */}
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/30">
            <Checkbox
              checked={selectedCount === findings.length}
              onCheckedChange={(checked) => onSelectAll(!!checked)}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs text-muted-foreground">
              {selectedCount === 0 ? "Select findings to fix" : `${selectedCount} of ${findings.length} selected`}
            </span>
          </div>

          <div className={cn("overflow-y-auto space-y-1.5", findings.length > 5 ? "max-h-80" : "")}>
            <div className="space-y-1.5">
              {findings.map((finding) => (
                <div
                  key={finding.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-3 py-2 transition-colors",
                    finding.selected ? accent.bg : "hover:bg-muted/30",
                    finding.unresolved && "border border-red-500/20 bg-red-500/5",
                  )}
                >
                  <Checkbox
                    checked={finding.selected}
                    onCheckedChange={() => onToggleFinding(finding.id)}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 text-xs px-1.5 py-0", SEVERITY_COLORS[finding.severity])}
                      >
                        {finding.severity}
                      </Badge>
                      <span className="text-xs font-mono text-muted-foreground shrink-0">
                        {finding.artifactName}
                      </span>
                      {finding.unresolved && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 text-red-400 border-red-500/30 bg-red-500/10">
                          Unresolved
                        </Badge>
                      )}
                      {finding.round > 1 && !finding.unresolved && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground">
                          Round {finding.round}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-foreground/80 mt-1">{finding.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action bar below findings */}
          {selectedCount > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2">
              <Button size="sm" className={cn("gap-1.5 text-xs", accent.text)} onClick={onFixSelected} disabled={loading}>
                <Send className="h-3.5 w-3.5" />
                Fix {selectedCount} Selected Finding{selectedCount > 1 ? "s" : ""}
              </Button>
              <span className="text-xs text-muted-foreground">
                Send to Code Architect for rewrite, then re-review
              </span>
            </div>
          )}
        </CardContent>
      )}

      {/* Error */}
      {error && (
        <CardContent className="px-4 pb-3 pt-0">
          <div className="text-xs text-red-400">{error}</div>
        </CardContent>
      )}
    </Card>
  );
}

