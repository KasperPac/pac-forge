import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PatternReviewCard } from "@/components/pattern-review-card";
import {
  usePatternCandidates,
  useApprovePattern,
  useRejectPattern,
  useDeletePattern,
} from "@/hooks/use-patterns";
import { toast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import type { PatternStatus, CorrectionType } from "@/types";

const STATUS_TABS: Array<{ value: PatternStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const CORRECTION_FILTERS: Array<{ value: CorrectionType | "all"; label: string }> = [
  { value: "all", label: "All Types" },
  { value: "NAMING", label: "Naming" },
  { value: "IO_MAPPING", label: "IO Mapping" },
  { value: "STATE_LOGIC", label: "State Logic" },
  { value: "ALARM", label: "Alarm" },
  { value: "SAFETY", label: "Safety" },
  { value: "TIMING", label: "Timing" },
];

export default function PatternsPage() {
  const [statusFilter, setStatusFilter] = useState<PatternStatus | "all">("PENDING");
  const [typeFilter, setTypeFilter] = useState<CorrectionType | "all">("all");

  const { data: patterns, isLoading } = usePatternCandidates(
    statusFilter === "all" ? undefined : statusFilter
  );
  const approvePattern = useApprovePattern();
  const rejectPattern = useRejectPattern();
  const deletePattern = useDeletePattern();
  const auditLog = useAuditLog();

  const filteredPatterns = (patterns ?? []).filter(
    (p) => typeFilter === "all" || p.correction_type === typeFilter
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-muted-foreground">LEARNING SYSTEM</div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BookOpen className="h-5 w-5" />
            Pattern Library
          </h1>
        </div>
        <Badge variant="outline" className="font-mono text-xs">
          {filteredPatterns.length} pattern{filteredPatterns.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <Separator />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              onClick={() => setStatusFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {CORRECTION_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={typeFilter === f.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 font-mono text-[10px]"
              onClick={() => setTypeFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Pattern list */}
      {isLoading && (
        <div className="py-8 text-center font-mono text-sm text-muted-foreground">
          Loading patterns...
        </div>
      )}

      <ScrollArea className="h-[calc(100vh-14rem)]">
        <div className="space-y-3 pr-3">
          {filteredPatterns.length === 0 && !isLoading && (
            <div className="py-8 text-center font-mono text-sm text-muted-foreground">
              No patterns match the current filters.
            </div>
          )}
          {filteredPatterns.map((pattern) => (
            <PatternReviewCard
              key={pattern.id}
              pattern={pattern}
              onApprove={(id) => approvePattern.mutate(id, {
                onSuccess: () => {
                  toast({ title: "Pattern approved" });
                  auditLog.mutate({ action: "PATTERN_APPROVE", details: { patternId: id } });
                },
              })}
              onReject={(id) => rejectPattern.mutate(id, {
                onSuccess: () => {
                  toast({ title: "Pattern rejected" });
                  auditLog.mutate({ action: "PATTERN_REJECT", details: { patternId: id } });
                },
              })}
              onDelete={(id) => deletePattern.mutate(id, {
                onSuccess: () => {
                  toast({ title: "Pattern deleted" });
                  auditLog.mutate({ action: "PATTERN_REJECT", details: { patternId: id, action: "delete" } });
                },
              })}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
