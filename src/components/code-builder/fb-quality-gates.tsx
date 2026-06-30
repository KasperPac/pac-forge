import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { warningKey } from "@/lib/spec-builder/fb-quality-gate";
import type { SafetyWarning } from "@/types";
import type { ReviewFinding } from "@/lib/forge-review-parser";

export function FbQualityGates({
  warnings, blocked, acknowledged, reviewStatus, findings, reviewing, onAcknowledge, onRunReview,
}: {
  warnings: SafetyWarning[];
  blocked: boolean;
  acknowledged: string[];
  reviewStatus: "pass" | "findings" | null;
  findings: ReviewFinding[];
  reviewing: boolean;
  onAcknowledge: (key: string) => void;
  onRunReview: () => void;
}) {
  const ackSet = new Set(acknowledged);

  return (
    <div className="flex flex-col gap-3 p-3 text-[11px]" data-testid="fb-quality-gates">
      <section data-testid="safety-gate" className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Safety</span>
          {warnings.length === 0 ? (
            <Badge variant="outline" className="text-[9px]">Safe — no warnings</Badge>
          ) : blocked ? (
            <Badge variant="destructive" className="text-[9px]">Blocked — {warnings.length} warning(s)</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px]">Acknowledged</Badge>
          )}
        </div>
        {warnings.map((w) => {
          const key = warningKey(w);
          const done = ackSet.has(key);
          return (
            <div key={w.id} className="flex items-start justify-between gap-2 rounded border px-2 py-1">
              <div>
                <span className="font-mono text-[9px] text-muted-foreground">{w.type}{w.line != null ? `:${w.line}` : ""}</span>
                <div>{w.description}</div>
              </div>
              {done ? (
                <span className="shrink-0 text-[9px] text-muted-foreground">acknowledged</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 text-[9px]"
                  data-testid={`ack-${key}`}
                  onClick={() => onAcknowledge(key)}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Standards Review</span>
          {reviewStatus && (
            <Badge
              variant={reviewStatus === "findings" ? "destructive" : "outline"}
              className="text-[9px]"
              data-testid="review-badge"
            >
              {reviewStatus === "findings" ? "Findings" : "Pass"}
            </Badge>
          )}
          <Button
            size="sm"
            className="ml-auto h-6 text-[9px]"
            data-testid="run-review"
            disabled={reviewing}
            onClick={onRunReview}
          >
            {reviewing ? "Reviewing…" : "Run Standards Review"}
          </Button>
        </div>
        {findings.map((f, i) => (
          <div key={i} className="rounded border px-2 py-1">
            <span className="font-mono text-[9px] text-muted-foreground">{f.severity}</span>
            <div>{f.message}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
