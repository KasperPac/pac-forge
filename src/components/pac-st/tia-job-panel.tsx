import { useState } from "react";
import { Play, Loader2, AlertCircle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import type { TiaManifest, TiaJobType, TiaJob, CompileError } from "@/types";

interface TiaJobPanelProps {
  projectId: string;
  sessionId: string;
  manifest: TiaManifest | null;
  currentJob: TiaJob | null;
  onErrorClick?: (artifactName: string, line: number) => void;
  onRegenerateAffected?: (errorArtifacts: string[]) => void;
  onSubmitRequest?: (jobType: TiaJobType) => void;
  submitting?: boolean;
}

const JOB_TYPE_LABELS: Record<TiaJobType, string> = {
  IMPORT_ONLY: "Import Only",
  IMPORT_AND_COMPILE: "Import & Compile",
  COMPILE_ONLY: "Compile Only",
  EXPORT_REPORT: "Export Report",
};

const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  PENDING: { className: "bg-amber-500/10 text-amber-400", label: "Pending" },
  RUNNING: { className: "bg-blue-500/10 text-blue-400", label: "Running" },
  COMPLETED: { className: "bg-green-500/10 text-green-400", label: "Completed" },
  FAILED: { className: "bg-red-500/10 text-red-400", label: "Failed" },
  CANCELLED: { className: "bg-neutral-500/10 text-neutral-400", label: "Cancelled" },
};

export function TiaJobPanel({
  manifest,
  currentJob,
  onErrorClick,
  onRegenerateAffected,
  onSubmitRequest,
  submitting,
}: TiaJobPanelProps) {
  const { data: bridgeStatus } = useBridgeStatus();
  const [selectedJobType, setSelectedJobType] = useState<TiaJobType>("IMPORT_AND_COMPILE");

  const isConnected = bridgeStatus?.connected ?? false;

  function handleSubmit() {
    if (!manifest) return;
    onSubmitRequest?.(selectedJobType);
  }

  // Collect compile errors from current job
  const compileErrors: CompileError[] = currentJob?.compile_results?.errors ?? [];
  const compileWarnings: CompileError[] = currentJob?.compile_results?.warnings ?? [];
  const errorArtifacts = [...new Set(compileErrors.map((e) => e.artifact_name))];

  return (
    <div className="flex h-full flex-col">
      {/* Bridge status + submit */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-1 font-mono text-[10px] text-green-400">
              <Wifi className="h-3 w-3" />
              Bridge Online
            </div>
          ) : (
            <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <WifiOff className="h-3 w-3" />
              Bridge Offline
            </div>
          )}

          {/* Job type selector */}
          <select
            value={selectedJobType}
            onChange={(e) => setSelectedJobType(e.target.value as TiaJobType)}
            className="h-6 rounded border bg-background px-1.5 font-mono text-[10px]"
          >
            {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <Button
          size="sm"
          className="h-6 px-2 font-mono text-[10px]"
          onClick={handleSubmit}
          disabled={!manifest || submitting}
        >
          {submitting ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          Submit Job
        </Button>
      </div>

      {/* Current job status */}
      {currentJob && (
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`font-mono text-[9px] ${STATUS_STYLES[currentJob.status]?.className ?? ""}`}
            >
              {STATUS_STYLES[currentJob.status]?.label ?? currentJob.status}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">
              {currentJob.job_type}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">
              {new Date(currentJob.created_at).toLocaleTimeString()}
            </span>
          </div>
          {currentJob.status === "RUNNING" && (
            <Progress value={50} className="mt-1.5 h-1" />
          )}
        </div>
      )}

      {/* Compile results */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {compileErrors.length === 0 && compileWarnings.length === 0 && (
            <div className="py-4 text-center font-mono text-[10px] text-muted-foreground">
              {currentJob
                ? currentJob.status === "COMPLETED"
                  ? "Compilation successful — no errors."
                  : "Waiting for results..."
                : "Submit a TIA job to see compile results."}
            </div>
          )}

          {compileErrors.length > 0 && (
            <div className="space-y-1">
              <div className="font-mono text-[10px] font-medium text-red-400">
                Errors ({compileErrors.length})
              </div>
              {compileErrors.map((err, i) => (
                <button
                  key={i}
                  onClick={() => err.line && onErrorClick?.(err.artifact_name, err.line)}
                  className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left hover:bg-red-500/5"
                >
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                  <div>
                    <span className="font-mono text-[10px] text-red-400">
                      {err.artifact_name}
                      {err.line ? `:${err.line}` : ""}
                      {err.column ? `:${err.column}` : ""}
                    </span>
                    <div className="font-mono text-[9px] text-muted-foreground">
                      {err.error_text}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {compileWarnings.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="font-mono text-[10px] font-medium text-amber-400">
                Warnings ({compileWarnings.length})
              </div>
              {compileWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 px-2 py-1">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                  <div>
                    <span className="font-mono text-[10px] text-amber-400">
                      {w.artifact_name}{w.line ? `:${w.line}` : ""}
                    </span>
                    <div className="font-mono text-[9px] text-muted-foreground">
                      {w.error_text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Regenerate affected artifacts */}
      {errorArtifacts.length > 0 && onRegenerateAffected && (
        <div className="border-t px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-full font-mono text-[10px]"
            onClick={() => onRegenerateAffected(errorArtifacts)}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Regenerate {errorArtifacts.length} Affected Artifact{errorArtifacts.length !== 1 ? "s" : ""}
          </Button>
        </div>
      )}
    </div>
  );
}
