import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Terminal,
  Loader2,
  Maximize2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPipelineLog } from "@/lib/pipeline";
import type { PipelineStepResult } from "@/lib/pipeline";
import { PROCESS_STAGE_LABELS } from "@/types/process-builder";
import type { ProcessStage } from "@/types/process-builder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  plan: "Plan",
  generate: "Generate",
  review: "Review",
  rewrite: "Rewrite",
  patterns: "Patterns",
  summary: "Summary",
  compile_fix: "Compile Fix",
};

const ROLE_COLORS: Record<string, string> = {
  plan: "bg-violet-500/20 text-violet-400",
  generate: "bg-blue-500/20 text-blue-400",
  review: "bg-amber-500/20 text-amber-400",
  rewrite: "bg-cyan-500/20 text-cyan-400",
  patterns: "bg-emerald-500/20 text-emerald-400",
  summary: "bg-violet-500/20 text-violet-400",
  compile_fix: "bg-orange-500/20 text-orange-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />;
  if (status === "failed")
    return <span className="inline-block h-2 w-2 rounded-full bg-red-500" />;
  if (status === "running")
    return <Loader2 className="h-3 w-3 animate-spin text-blue-400" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  label,
  content,
  defaultOpen = false,
  expanded = false,
}: {
  label: string;
  content: string;
  defaultOpen?: boolean;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!content) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" />
        )}
        {label}
        <span className="text-muted-foreground/70">
          ({content.length.toLocaleString()} chars)
        </span>
      </button>
      {open && (
        <pre
          className={`mt-1 overflow-auto rounded bg-muted/30 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words ${
            expanded ? "" : "max-h-60"
          }`}
        >
          {content}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Entry
// ---------------------------------------------------------------------------

function StepEntry({
  step,
  expanded = false,
}: {
  step: PipelineStepResult;
  expanded?: boolean;
}) {
  return (
    <div className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <StatusDot status={step.status} />
        <span className="text-xs font-semibold">{step.agentName}</span>
        <Badge
          variant="outline"
          className={`px-1.5 py-0 text-[10px] font-medium ${ROLE_COLORS[step.role] ?? ""}`}
        >
          {ROLE_LABELS[step.role] ?? step.role}
        </Badge>
        {step.durationMs > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {step.tokenUsage && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {(step.tokenUsage.input + step.tokenUsage.output).toLocaleString()} tk
          </span>
        )}
        {step.status === "failed" && step.error && (
          <span className="truncate font-mono text-[10px] text-red-400">
            {step.error.slice(0, 80)}
          </span>
        )}
      </div>

      {step.summary && step.status !== "running" && (
        <p className="mt-0.5 pl-4 font-mono text-[10px] italic text-muted-foreground/70">
          {step.summary.length > 200
            ? `${step.summary.slice(0, 200)}\u2026`
            : step.summary}
        </p>
      )}

      <div className="pl-4">
        <CollapsibleSection
          label="System Prompt"
          content={step.systemPrompt}
          expanded={expanded}
        />
        <CollapsibleSection
          label="User Message"
          content={step.userMessage}
          expanded={expanded}
        />
        <CollapsibleSection
          label="Response"
          content={step.rawResponse}
          defaultOpen={step.role === "summary"}
          expanded={expanded}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage Group
// ---------------------------------------------------------------------------

function StageGroup({
  stage,
  steps,
  defaultOpen,
  expanded,
}: {
  stage: string;
  steps: PipelineStepResult[];
  defaultOpen: boolean;
  expanded: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label =
    PROCESS_STAGE_LABELS[stage as ProcessStage] ?? stage.toUpperCase();
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalDuration = steps.reduce((s, st) => s + st.durationMs, 0);

  return (
    <div className="border-b border-border/30">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent/20"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold">{label}</span>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {completedCount}/{steps.length}
          </Badge>
        </div>
        {totalDuration > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatDuration(totalDuration)}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border/20 bg-accent/5">
          {steps.map((step, i) => (
            <StepEntry
              key={`${step.agentId}-${i}`}
              step={step}
              expanded={expanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Log Panel
// ---------------------------------------------------------------------------

interface PipelineLogPanelProps {
  steps: PipelineStepResult[];
  isRunning: boolean;
}

export function PipelineLogPanel({ steps, isRunning }: PipelineLogPanelProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new steps appear
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [steps.length]);

  function handleDownloadLog() {
    const markdown = formatPipelineLog(steps);
    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `process-pipeline-log_${timestamp}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Group steps by stage
  const stageGroups: { stage: string; steps: PipelineStepResult[] }[] = [];
  const stageMap = new Map<string, PipelineStepResult[]>();
  const stageOrder: string[] = [];

  for (const step of steps) {
    const stageKey = step.stage ?? "unknown";
    if (!stageMap.has(stageKey)) {
      stageMap.set(stageKey, []);
      stageOrder.push(stageKey);
    }
    stageMap.get(stageKey)!.push(step);
  }

  for (const stage of stageOrder) {
    stageGroups.push({ stage, steps: stageMap.get(stage)! });
  }

  const headerBadge = isRunning ? (
    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      Running
    </Badge>
  ) : steps.length > 0 ? (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
      {steps.filter((s) => s.status === "completed").length}/{steps.length} steps
    </Badge>
  ) : null;

  const renderContent = (expanded: boolean) => {
    if (steps.length === 0 && isRunning) {
      return (
        <div className="flex items-center justify-center py-8 font-mono text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Starting pipeline...
        </div>
      );
    }

    if (steps.length === 0) {
      return (
        <div className="flex items-center justify-center py-8 font-mono text-xs text-muted-foreground">
          No pipeline steps yet. Run a generation stage to see agent conversations.
        </div>
      );
    }

    return stageGroups.map((group) => (
      <StageGroup
        key={group.stage}
        stage={group.stage}
        steps={group.steps}
        defaultOpen={true}
        expanded={expanded}
      />
    ));
  };

  return (
    <>
      <div className="flex h-full flex-col border-r">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-[10px] font-medium text-muted-foreground">
              PIPELINE LOG
            </span>
            {headerBadge}
          </div>
          <div className="flex items-center gap-1">
            {steps.length > 0 && !isRunning && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
                onClick={handleDownloadLog}
              >
                <Download className="h-3 w-3" />
                Log
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground"
              onClick={() => setFullscreen(true)}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="min-h-0 flex-1">
          <ScrollArea className="h-full">{renderContent(false)}</ScrollArea>
        </div>
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b bg-accent/30 px-4 py-3">
            <div className="flex items-center justify-between pr-8">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <DialogTitle className="text-sm font-semibold uppercase tracking-wide">
                  Pipeline Log
                </DialogTitle>
                {headerBadge}
              </div>
              {steps.length > 0 && !isRunning && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
                  onClick={handleDownloadLog}
                >
                  <Download className="h-3 w-3" />
                  Log
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {renderContent(true)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
