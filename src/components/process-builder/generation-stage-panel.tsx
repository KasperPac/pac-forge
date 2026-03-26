import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { PROCESS_STAGE_LABELS, PROCESS_STAGE_DESCRIPTIONS, PROCESS_STAGE_ORDER } from "@/types/forge-matrix";
import type { ProcessStage } from "@/types/forge-matrix";
import type { CompileError, IoEntry } from "@/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Play,
  Square,
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { useState } from "react";
import type { PipelineStepResult } from "@/lib/pipeline";
import { IoComparisonPanel } from "./io-comparison-panel";

interface GenerationStagePanelProps {
  stage: ProcessStage;
  onRunStage: () => void;
  onCancel: () => void;
  isRunning: boolean;
  compileResult?: { success: boolean; errors: CompileError[] } | null;
  tiaImporting?: boolean;
  existingIoList?: IoEntry[];
  onIoListApply?: (mergedIoList: IoEntry[]) => void;
}

function PipelineStepRow({ step }: { step: PipelineStepResult }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />,
    running: <Loader2 className="h-3 w-3 animate-spin text-blue-400" />,
    completed: <Check className="h-3 w-3 text-green-500" />,
    failed: <X className="h-3 w-3 text-red-500" />,
    skipped: <span className="h-3 w-3 text-muted-foreground">-</span>,
  }[step.status];

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/30"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        {statusIcon}
        <span className="font-mono text-xs">{step.agentName}</span>
        <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          {step.role}
        </span>
        {step.durationMs != null && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {(step.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </button>
      {expanded && (
        <div className="space-y-2 px-3 pb-2">
          {step.summary && (
            <div className="font-mono text-[11px] text-muted-foreground">{step.summary}</div>
          )}
          {step.artifactsModified && step.artifactsModified.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {step.artifactsModified.map((name) => (
                <span key={name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  {name}
                </span>
              ))}
            </div>
          )}
          {step.rawResponse && (
            <details className="text-[10px]">
              <summary className="cursor-pointer font-mono text-muted-foreground hover:text-foreground">
                Raw response ({step.rawResponse.length.toLocaleString()} chars)
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[10px]">
                {step.rawResponse}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function GenerationStagePanel({
  stage,
  onRunStage,
  onCancel,
  isRunning,
  compileResult,
  tiaImporting,
  existingIoList,
  onIoListApply,
}: GenerationStagePanelProps) {
  const stageStatuses = useProcessBuilderStore((s) => s.stageStatuses);
  const pipelineExecution = useProcessBuilderStore((s) => s.pipelineExecution);
  const activeAgentName = useProcessBuilderStore((s) => s.activeAgentName);
  const streamingContent = useProcessBuilderStore((s) => s.streamingContent);
  const stageArtifacts = useProcessBuilderStore((s) => s.stageArtifacts);
  const suggestedIoList = useProcessBuilderStore((s) => s.suggestedIoList);
  const ioComparisonSummary = useProcessBuilderStore((s) => s.ioComparisonSummary);

  const stageStatus = stageStatuses.find((s) => s.stage === stage);
  const statusValue = stageStatus?.status ?? "pending";
  const artifacts = stageArtifacts[stage] ?? [];
  const steps = pipelineExecution?.steps ?? [];

  const stageIdx = PROCESS_STAGE_ORDER.indexOf(stage);
  const completedPrevious = PROCESS_STAGE_ORDER.slice(0, stageIdx).every((s) => {
    const ss = stageStatuses.find((st) => st.stage === s);
    return ss?.status === "completed" || ss?.status === "skipped";
  });
  // Allow re-run if the next stage hasn't started yet
  const nextStageIdx = stageIdx + 1;
  const nextNotStarted = nextStageIdx >= PROCESS_STAGE_ORDER.length
    || (() => {
      const ns = stageStatuses.find((st) => st.stage === PROCESS_STAGE_ORDER[nextStageIdx]);
      return !ns || ns.status === "pending";
    })();
  const canRun =
    (statusValue === "pending" || statusValue === "completed" || statusValue === "failed")
    && completedPrevious && !isRunning && nextNotStarted;

  return (
    <div className="flex h-full flex-col">
      {/* Stage header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <div className="font-mono text-sm font-medium">
            {PROCESS_STAGE_LABELS[stage]}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {PROCESS_STAGE_DESCRIPTIONS[stage]}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusValue === "completed" && (
            <span className="flex items-center gap-1 font-mono text-xs text-green-500">
              <Check className="h-3 w-3" /> Complete
            </span>
          )}
          {statusValue === "failed" && (
            <span className="flex items-center gap-1 font-mono text-xs text-red-500">
              <X className="h-3 w-3" /> Failed
            </span>
          )}
          {isRunning ? (
            <Button size="sm" variant="destructive" onClick={onCancel}>
              <Square className="mr-1.5 h-3 w-3" /> Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onRunStage}
              disabled={!canRun}
            >
              <Play className="mr-1.5 h-3 w-3" />
              {statusValue === "failed" ? "Retry" : statusValue === "completed" ? "Re-run" : "Run"}
            </Button>
          )}
        </div>
      </div>

      {/* Active agent indicator */}
      {activeAgentName && (
        <div className="flex items-center gap-2 border-b bg-accent/30 px-4 py-1.5">
          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
          <span className="font-mono text-xs">{activeAgentName}</span>
        </div>
      )}

      {/* Error display */}
      {stageStatus?.error && (
        <div className="border-b bg-red-950/20 px-4 py-2 font-mono text-xs text-red-400">
          {stageStatus.error}
        </div>
      )}

      {/* TIA import status */}
      {tiaImporting && (
        <div className="flex items-center gap-2 border-b bg-accent/20 px-4 py-2">
          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
          <span className="font-mono text-xs text-blue-400">Importing to TIA Portal...</span>
        </div>
      )}

      {/* Compile results */}
      {compileResult && !tiaImporting && (
        <div className={cn(
          "border-b px-4 py-2",
          compileResult.success ? "bg-green-950/20" : "bg-red-950/20",
        )}>
          <div className="flex items-center gap-1.5">
            {compileResult.success ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                <span className="font-mono text-xs text-green-500">Compiled successfully</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                <span className="font-mono text-xs text-red-400">
                  {compileResult.errors.length} compile error{compileResult.errors.length !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
          {compileResult.errors.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {compileResult.errors.slice(0, 10).map((err, i) => (
                <div key={i} className="font-mono text-[10px] text-red-400/80">
                  <span className="text-red-400">{err.artifact_name}</span>
                  {err.line != null && <span className="text-muted-foreground">:{err.line}</span>}
                  {" — "}{err.error_text}
                </div>
              ))}
              {compileResult.errors.length > 10 && (
                <div className="font-mono text-[10px] text-muted-foreground">
                  ...and {compileResult.errors.length - 10} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* IO Review/Comparison Panel — shown when IO stage produces a suggested IO list */}
      {stage === "io" && suggestedIoList && onIoListApply && (
        <IoComparisonPanel
          existingIoList={existingIoList ?? []}
          suggestedIoList={suggestedIoList}
          summaryText={ioComparisonSummary}
          onApply={(merged) => {
            onIoListApply(merged);
            useProcessBuilderStore.getState().clearSuggestedIoList();
          }}
          onDismiss={() => {
            useProcessBuilderStore.getState().clearSuggestedIoList();
          }}
        />
      )}

      {/* Content area — hidden when IO comparison is active */}
      <div className={cn(
        "flex min-h-0 flex-1",
        stage === "io" && suggestedIoList && "hidden",
      )}>
        {/* Left: streaming + pipeline steps */}
        <div className="flex min-h-0 flex-1 flex-col border-r">
          {/* Streaming output */}
          {streamingContent && (
            <div className="border-b">
              <div className="px-3 py-1 font-mono text-[10px] text-muted-foreground">
                STREAMING OUTPUT
              </div>
              <ScrollArea className="h-48">
                <pre className="whitespace-pre-wrap px-3 pb-2 font-mono text-[11px]">
                  {streamingContent}
                </pre>
              </ScrollArea>
            </div>
          )}

          {/* Pipeline steps */}
          {steps.length > 0 && (
            <div className="min-h-0 flex-1">
              <div className="px-3 py-1 font-mono text-[10px] text-muted-foreground">
                PIPELINE STEPS
              </div>
              <ScrollArea className="h-full max-h-[400px]">
                {steps.map((step) => (
                  <PipelineStepRow key={step.agentId} step={step} />
                ))}
              </ScrollArea>
            </div>
          )}

          {/* Empty state */}
          {!streamingContent && steps.length === 0 && statusValue === "pending" && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="font-mono text-xs text-muted-foreground">
                  Click &ldquo;Run&rdquo; to execute this stage
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: artifact list */}
        <div className={cn("w-64 min-h-0", artifacts.length === 0 && "hidden")}>
          <div className="px-3 py-1 font-mono text-[10px] text-muted-foreground">
            ARTIFACTS ({artifacts.length})
          </div>
          <ScrollArea className="h-full">
            {artifacts.map((a) => (
              <div
                key={a.id}
                className="border-b border-border/50 px-3 py-1.5"
              >
                <div className="font-mono text-xs">{a.name}</div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                    {a.type}
                  </span>
                  {a.destination_folder && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {a.destination_folder}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
