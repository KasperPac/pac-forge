import { AlertCircle, CheckCircle2, Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMigratePipeline } from "@/hooks/use-migrate-pipeline";
import { useMigrateStore } from "@/stores/migrate-store";
import { useNavigate } from "react-router";
import type { MigrationSession } from "@/types";

interface MigrateReportProps {
  session: MigrationSession;
  onSessionUpdate: () => void;
}

export function MigrateReport({ session, onSessionUpdate }: MigrateReportProps) {
  const { running, currentBlockName, error, runReport } = useMigratePipeline();
  const store = useMigrateStore();
  const navigate = useNavigate();

  async function handleGenerateReport() {
    try {
      await runReport(session);
      onSessionUpdate();
    } catch (err) {
      console.error("Report generation failed", err);
    }
  }

  function handleDownload() {
    if (!session.report_markdown) return;
    const blob = new Blob([session.report_markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-report-${session.name.replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleNewMigration() {
    store.reset();
    navigate("/migrate");
  }

  const blockCount = session.migrated_blocks.length;
  const criticalCount = session.review_findings.filter((f) => f.severity === "CRITICAL").length;
  const warningCount = session.review_findings.filter((f) => f.severity === "WARNING").length;
  const compileSuccess =
    session.compile_result &&
    (session.compile_result as { success?: boolean }).success === true;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Agent running state */}
      {running && (
        <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-3">
          <div className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-30" />
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          </div>
          <div>
            <div className="text-xs font-medium text-blue-300">Report Generator</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {currentBlockName ?? "Generating report…"}
            </div>
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

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-md border border-border/60 bg-card/60 p-3 text-center">
          <div className="font-mono text-2xl font-bold text-foreground">{blockCount}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Blocks Migrated
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-card/60 p-3 text-center">
          <div className={`font-mono text-2xl font-bold ${criticalCount > 0 ? "text-destructive" : "text-green-400"}`}>
            {criticalCount}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Critical
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-card/60 p-3 text-center">
          <div className={`font-mono text-2xl font-bold ${warningCount > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
            {warningCount}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Warnings
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-card/60 p-3 text-center">
          {compileSuccess !== null ? (
            <>
              <div className={`font-mono text-2xl font-bold ${compileSuccess ? "text-green-400" : "text-destructive"}`}>
                {compileSuccess ? "✓" : "✗"}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Compile
              </div>
            </>
          ) : (
            <>
              <div className="font-mono text-2xl font-bold text-muted-foreground">—</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Compile
              </div>
            </>
          )}
        </div>
      </div>

      {/* Report content */}
      {session.report_markdown ? (
        <ScrollArea className="flex-1 rounded-md border border-border/60 bg-muted/10">
          <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-foreground/80 leading-relaxed">
            {session.report_markdown}
          </pre>
        </ScrollArea>
      ) : (
        !running && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-border/50 bg-muted/10 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Generate a detailed migration report summarising all changes, findings,
              and testing recommendations.
            </p>
          </div>
        )
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={handleGenerateReport}
          disabled={running}
          className="gap-2"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {session.report_markdown ? "Regenerate Report" : "Generate Report"}
        </Button>

        {session.report_markdown && (
          <>
            <Button variant="outline" onClick={handleDownload} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              Download Report
            </Button>

            <Badge variant="outline" className="font-mono text-[10px] border-green-500/50 text-green-400">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Migration Complete
            </Badge>
          </>
        )}

        <div className="flex-1" />

        <Button variant="outline" onClick={handleNewMigration} className="gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Start New Migration
        </Button>
      </div>
    </div>
  );
}
