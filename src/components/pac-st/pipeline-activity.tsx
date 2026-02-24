import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Clock, MinusCircle, ChevronDown, ChevronRight } from "lucide-react";
import { usePacStStore } from "@/stores/pac-st-store";
import { AgentAvatar } from "@/components/agent-avatar";
import type { PipelineStepStatus } from "@/lib/pipeline";

const STATUS_ICONS: Record<PipelineStepStatus, typeof Loader2> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
};

const STATUS_COLORS: Record<PipelineStepStatus, string> = {
  pending: "text-muted-foreground/50",
  running: "text-blue-500 animate-spin",
  completed: "text-green-500",
  failed: "text-red-500",
  skipped: "text-muted-foreground/40",
};

const ROLE_LABELS: Record<string, string> = {
  plan: "Planning",
  generate: "Generating",
  review: "Reviewing",
  patterns: "Analyzing",
  summary: "Summarizing",
};

interface PipelineActivityProps {
  defaultCollapsed?: boolean;
}

export function PipelineActivity({ defaultCollapsed = false }: PipelineActivityProps) {
  const execution = usePacStStore((s) => s.pipelineExecution);
  const activeAgent = usePacStStore((s) => s.activeAgentName);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!execution || execution.steps.length === 0) return null;

  const isComplete = !!execution.completedAt;
  const totalDuration = execution.steps.reduce((sum, s) => sum + s.durationMs, 0);
  const completedCount = execution.steps.filter((s) => s.status === "completed").length;
  const artifactCount = execution.steps.reduce(
    (sum, s) => sum + (s.artifactsModified?.length ?? 0),
    0,
  );

  if (collapsed && isComplete) {
    return (
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/30"
        onClick={() => setCollapsed(false)}
      >
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono text-[10px] text-muted-foreground">
          Pipeline: {completedCount} agents, {artifactCount} artifacts, {(totalDuration / 1000).toFixed(1)}s
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-1 px-3 py-2">
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          onClick={() => isComplete && setCollapsed(true)}
        >
          {isComplete && <ChevronDown className="h-3 w-3" />}
          Pipeline {isComplete ? "Complete" : "Running"}
        </button>
        {isComplete && totalDuration > 0 && (
          <div className="font-mono text-[10px] text-muted-foreground">
            {(totalDuration / 1000).toFixed(1)}s total
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        {execution.steps.map((step, i) => {
          const Icon = STATUS_ICONS[step.status];
          const colorClass = STATUS_COLORS[step.status];
          const isActive = step.agentName === activeAgent || step.agentName === activeAgent?.replace(" (Summary)", "");
          const duration = step.durationMs > 0 ? `${(step.durationMs / 1000).toFixed(1)}s` : "";

          return (
            <div
              key={`${step.agentId}-${i}`}
              className={`flex items-center gap-2 rounded px-2 py-1 transition-colors ${
                isActive ? "bg-accent/50" : ""
              }`}
            >
              <AgentAvatar
                displayName={step.agentName.replace(" (Summary)", "")}
                size="xs"
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs font-medium">
                    {step.agentName}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {step.status === "running"
                      ? `${ROLE_LABELS[step.role] ?? step.role}...`
                      : ""}
                  </span>
                </div>
                {step.status === "completed" && step.summary && (
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {step.summary.slice(0, 80)}
                  </div>
                )}
                {step.status === "failed" && step.error && (
                  <div className="truncate font-mono text-[10px] text-destructive">
                    {step.error.slice(0, 80)}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {duration && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {duration}
                  </span>
                )}
                <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
