import { AlertCircle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMigratePipeline } from "@/hooks/use-migrate-pipeline";
import { cn } from "@/lib/utils";
import type { MigrationSession } from "@/types";

interface MigrateAnalyseProps {
  session: MigrationSession;
  onSessionUpdate: () => void;
}

export function MigrateAnalyse({ session, onSessionUpdate }: MigrateAnalyseProps) {
  const { running, currentBlockName, currentBlockDescription, scanProgress, totalBlocks, error, runAnalysis } = useMigratePipeline();

  async function handleRunAnalysis() {
    try {
      await runAnalysis(session);
      onSessionUpdate();
    } catch {
      // error already set in pipeline state
    }
  }

  function handleProceed() {
    onSessionUpdate(); // session.current_step already set to "approve_plan" by runAnalysis
  }

  const hasPlan = session.migration_plan && session.migration_plan.length > 0;
  const breakingCount = session.migration_plan?.filter((s) => s.severity === "BREAKING").length ?? 0;
  const warningCount = session.migration_plan?.filter((s) => s.severity === "WARNING").length ?? 0;
  const infoCount = session.migration_plan?.filter((s) => s.severity === "INFO").length ?? 0;

  const progressPct = totalBlocks > 0 ? Math.round((scanProgress / totalBlocks) * 100) : 0;
  const isRefLookup = running && currentBlockName === "Looking up reference docs…";
  const isScanning = running && !isRefLookup && scanProgress < totalBlocks && !currentBlockName?.includes("batches");
  const isBatching = running && !!currentBlockName?.includes("batches");

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Agent running state */}
      {running && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-30" />
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-blue-300">
                  {isRefLookup ? "Reference Library" : isScanning ? "Pre-scanning blocks" : "Migration Analyst"}
                </span>
                {totalBlocks > 0 && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {scanProgress} / {totalBlocks} blocks
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-foreground/70">
                {currentBlockName ?? "Initialising…"}
              </div>
              {currentBlockDescription && (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {currentBlockDescription}
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {totalBlocks > 0 && (
            <div className="mt-3">
              <div className="h-1 w-full overflow-hidden rounded-full bg-blue-500/15">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    isBatching ? "bg-blue-400/80" : "bg-blue-500/50"
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {isBatching && (
                <div className="mt-1.5 text-[10px] text-muted-foreground">
                  Sending to AI for analysis — this may take a few minutes for large projects
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary card — shown when analysis is done */}
      {!running && hasPlan && session.analysis_summary && (
        <div className="rounded-lg border border-border/70 bg-card/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Analysis Complete
            </span>
          </div>
          <p className="text-sm text-foreground/80">{session.analysis_summary}</p>

          <div className="mt-4 flex gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive" className="cursor-default font-mono text-[10px]">
                    {breakingCount} BREAKING
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                  Will cause compile errors on S7-1500 if not changed. Must be resolved before the project will build.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-default font-mono text-[10px] border-amber-500/50 text-amber-400">
                    {warningCount} WARNING
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                  Will compile but may produce incorrect behaviour at runtime on S7-1500 hardware.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="cursor-default font-mono text-[10px]">
                    {infoCount} INFO
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                  Style improvements recommended by Siemens Programming Style Guide V2.1. Not required but advised.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Info when no analysis yet */}
      {!running && !hasPlan && (
        <div className="rounded-md border border-border/50 bg-muted/10 px-4 py-6 text-center">
          <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            Click <strong>Run Analysis</strong> to have the Migration Analyst examine your
            {" "}{Object.keys(session.source_blocks ?? {}).length} exported blocks and identify all
            required changes for S7-1500 compatibility.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={handleRunAnalysis}
          disabled={running}
          className="gap-2"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {hasPlan ? "Re-run Analysis" : "Run Analysis"}
        </Button>

        {hasPlan && !running && (
          <Button onClick={handleProceed}>
            Review Plan ({session.migration_plan.length} items)
          </Button>
        )}
      </div>
    </div>
  );
}
