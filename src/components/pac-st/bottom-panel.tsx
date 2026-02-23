import { useState } from "react";
import { ChevronDown, ChevronUp, Play, Loader2, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { CompileError, SafetyWarning, TiaJob, TiaJobType } from "@/types";

const JOB_TYPE_LABELS: Record<TiaJobType, string> = {
  IMPORT_ONLY: "Import Only",
  IMPORT_AND_COMPILE: "Import & Compile",
  COMPILE_ONLY: "Compile Only",
  EXPORT_REPORT: "Export Report",
};

interface BottomPanelProps {
  compileErrors: CompileError[];
  logs: string[];
  warnings: SafetyWarning[];
  onErrorClick?: (artifactName: string, line: number | null) => void;
  // TIA controls
  bridgeConnected?: boolean;
  onSubmitRequest?: (jobType: TiaJobType) => void;
  submitDisabled?: boolean;
  submitting?: boolean;
  currentJob?: TiaJob | null;
  onRegenerateAffected?: (errorArtifacts: string[]) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARNING: "text-amber-400",
  INFO: "text-blue-400",
};

export function BottomPanel({
  compileErrors,
  logs,
  warnings,
  onErrorClick,
  bridgeConnected,
  onSubmitRequest,
  submitDisabled,
  submitting,
  currentJob,
  onRegenerateAffected,
}: BottomPanelProps) {
  const { bottomPanelOpen, bottomPanelTab, setBottomPanelOpen, setBottomPanelTab } = useUiStore();
  const [selectedJobType, setSelectedJobType] = useState<TiaJobType>("IMPORT_AND_COMPILE");

  const tabs = [
    { id: "compile" as const, label: "Compile", count: compileErrors.length },
    { id: "logs" as const, label: "Logs", count: logs.length },
    { id: "warnings" as const, label: "Warnings", count: warnings.filter((w) => !w.acknowledged).length },
  ];

  // Collect error artifacts for regeneration
  const errorArtifacts = [...new Set(compileErrors.filter((e) => e.severity === "ERROR").map((e) => e.artifact_name))];

  return (
    <div className="border-t">
      {/* Tab bar + TIA controls */}
      <div className="flex items-center justify-between px-2 py-1">
        {/* Left: output tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setBottomPanelTab(tab.id);
                if (!bottomPanelOpen) setBottomPanelOpen(true);
              }}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs transition-colors",
                bottomPanelTab === tab.id && bottomPanelOpen
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <Badge
                  variant={tab.id === "compile" && tab.count > 0 ? "destructive" : "secondary"}
                  className="h-4 px-1 text-xs"
                >
                  {tab.count}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Right: TIA controls + collapse toggle */}
        <div className="flex items-center gap-2">
          {onSubmitRequest && (
            <div className="flex items-center gap-1.5">
              {bridgeConnected ? (
                <div className="flex items-center gap-1 font-mono text-xs text-green-400">
                  <Wifi className="h-3 w-3" />
                </div>
              ) : (
                <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <WifiOff className="h-3 w-3" />
                </div>
              )}

              <select
                value={selectedJobType}
                onChange={(e) => setSelectedJobType(e.target.value as TiaJobType)}
                className="h-6 rounded border bg-background px-1.5 font-mono text-xs"
              >
                {Object.entries(JOB_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              <Button
                size="sm"
                className="h-6 px-2 font-mono text-xs"
                onClick={() => onSubmitRequest(selectedJobType)}
                disabled={submitDisabled || submitting}
              >
                {submitting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-1 h-3 w-3" />
                )}
                Submit
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
          >
            {bottomPanelOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Job status banner */}
      {currentJob && currentJob.status === "RUNNING" && bottomPanelOpen && (
        <div className="flex items-center gap-2 border-t px-3 py-1.5">
          <Badge variant="outline" className="font-mono text-xs bg-blue-500/10 text-blue-400">
            Running
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{currentJob.job_type}</span>
          <Progress value={50} className="h-1 flex-1" />
        </div>
      )}

      {/* Panel content */}
      {bottomPanelOpen && (
        <ScrollArea className="h-48 border-t">
          <div className="p-2">
            {/* Compile Output */}
            {bottomPanelTab === "compile" && (
              <div className="space-y-0.5">
                {compileErrors.length === 0 ? (
                  <div className="py-4 text-center font-mono text-xs text-muted-foreground">
                    {currentJob?.status === "COMPLETED"
                      ? "Compilation successful — no errors."
                      : "No compile output."}
                  </div>
                ) : (
                  <>
                    {compileErrors.map((err, idx) => (
                      <button
                        key={idx}
                        className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-accent/50"
                        onClick={() => onErrorClick?.(err.artifact_name, err.line)}
                      >
                        <span className={cn("font-mono text-xs font-bold", SEVERITY_COLORS[err.severity])}>
                          {err.severity}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {err.artifact_name}
                          {err.line != null ? `:${err.line}` : ""}
                          {err.column != null ? `:${err.column}` : ""}
                        </span>
                        <span className="flex-1 font-mono text-xs">{err.error_text}</span>
                      </button>
                    ))}
                    {errorArtifacts.length > 0 && onRegenerateAffected && (
                      <div className="mt-2 px-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-full font-mono text-xs"
                          onClick={() => onRegenerateAffected(errorArtifacts)}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Regenerate {errorArtifacts.length} Affected Artifact{errorArtifacts.length !== 1 ? "s" : ""}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Logs */}
            {bottomPanelTab === "logs" && (
              <div className="space-y-0.5">
                {logs.length === 0 ? (
                  <div className="py-4 text-center font-mono text-xs text-muted-foreground">
                    No logs.
                  </div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="font-mono text-xs text-muted-foreground">
                      {log}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Warnings */}
            {bottomPanelTab === "warnings" && (
              <div className="space-y-0.5">
                {warnings.length === 0 ? (
                  <div className="py-4 text-center font-mono text-xs text-muted-foreground">
                    No warnings.
                  </div>
                ) : (
                  warnings.map((w) => (
                    <div
                      key={w.id}
                      className={cn(
                        "flex items-start gap-2 rounded px-2 py-1 font-mono text-xs",
                        w.acknowledged ? "text-muted-foreground" : "text-amber-400"
                      )}
                    >
                      <span className="font-bold">{w.type}</span>
                      <span className="text-muted-foreground">
                        {w.artifact_name}{w.line != null ? `:${w.line}` : ""}
                      </span>
                      <span className="flex-1">{w.description}</span>
                      {w.acknowledged && (
                        <Badge variant="outline" className="text-xs">ACK</Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
