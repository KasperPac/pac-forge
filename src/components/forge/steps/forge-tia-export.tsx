import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Plug,
  PlugZap,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useForgeTiaExport } from "@/hooks/use-forge-tia-export";
import type { ForgeSession, TiaForgeExportResult } from "@/types/forge";

export interface ForgeTiaExportProps {
  session: ForgeSession;
  onComplete: (result: TiaForgeExportResult) => void;
}

export function ForgeTiaExport({ session, onComplete }: ForgeTiaExportProps) {
  const { data: bridgeStatus } = useBridgeStatus();
  const { exportAll, loading, progress, error } = useForgeTiaExport();
  const [tiaPath, setTiaPath] = useState(session.tia_project_path ?? "");
  const [result, setResult] = useState<TiaForgeExportResult | null>(
    session.tia_export_result ?? null,
  );

  const approvedDevice = session.device_artifacts.filter(a => a.approved);
  const approvedProcess = session.process_artifacts.filter(a => a.approved);
  const approvedHmi = session.hmi_artifacts.filter(a => a.approved);
  const approvedScl = [...approvedDevice, ...approvedProcess].filter(a => a.language === "SCL");
  const approvedLad = [...approvedDevice, ...approvedProcess].filter(a => a.language === "LAD");

  const bridgeOnline = bridgeStatus?.bridgeOnline ?? false;
  const canExport = bridgeOnline && tiaPath.trim().length > 0 && !loading;

  const progressPct = loading
    ? Math.min(
        Math.round((progress.current / Math.max(progress.total, 1)) * 100),
        90,
      )
    : result
    ? 100
    : 0;

  const phaseLabel: Record<string, string> = {
    idle: "Ready",
    scl: "Importing SCL blocks…",
    lad: "Importing LAD blocks…",
    hmi: "Importing HMI screens…",
    compile: "Compiling…",
    done: "Complete",
    failed: "Failed",
  };

  async function handleExport() {
    try {
      const sessionWithPath = { ...session, tia_project_path: tiaPath };
      const exportResult = await exportAll(sessionWithPath, tiaPath);
      setResult(exportResult);
      onComplete(exportResult);
    } catch {
      // error handled by hook
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Pre-export summary */}
      {!result && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* Bridge status */}
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                {bridgeOnline
                  ? <PlugZap className="h-4 w-4 text-green-500" />
                  : <Plug className="h-4 w-4 text-muted-foreground" />}
                TIA Bridge
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Bridge server</span>
                <Badge
                  variant="outline"
                  className={`font-mono text-[10px] ${bridgeOnline ? "border-green-500/50 text-green-400" : "border-muted text-muted-foreground"}`}
                >
                  {bridgeOnline ? "Online" : "Offline"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">TIA Portal</span>
                <Badge
                  variant="outline"
                  className={`font-mono text-[10px] ${bridgeStatus?.tiaConnected ? "border-green-500/50 text-green-400" : "border-muted text-muted-foreground"}`}
                >
                  {bridgeStatus?.tiaConnected ? "Connected" : "Not connected"}
                </Badge>
              </div>
              {!bridgeOnline && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Start the bridge: <span className="font-mono">dotnet run --project bridge/PacForgeBridge</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Export summary */}
          <Card className="border-border/70 bg-card/70">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm">Export Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 pb-4">
              {[
                { label: "SCL blocks", count: approvedScl.length },
                { label: "LAD blocks", count: approvedLad.length },
                { label: "HMI screens", count: approvedHmi.length },
              ].map(({ label, count }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {count}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TIA project path */}
      {!result && (
        <div className="space-y-1.5">
          <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            TIA Portal Project Path
          </Label>
          <Input
            value={tiaPath}
            onChange={e => setTiaPath(e.target.value)}
            placeholder="C:\TIA_Projects\MyProject\MyProject.ap18"
            className="font-mono text-xs"
          />
        </div>
      )}

      {/* Progress */}
      {loading && (
        <div className="space-y-2 rounded-md border border-border/70 bg-card/70 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {phaseLabel[progress.phase] ?? progress.phase}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {progress.current}/{progress.total}
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="flex flex-1 flex-col gap-3">
          <div className={`flex items-center gap-3 rounded-md border p-4 ${result.success ? "border-green-500/40 bg-green-500/10" : "border-destructive/40 bg-destructive/10"}`}>
            {result.success
              ? <CheckCircle2 className="h-5 w-5 text-green-500" />
              : <XCircle className="h-5 w-5 text-destructive" />}
            <div>
              <p className="text-sm font-medium">
                {result.success ? "Export successful" : "Export completed with errors"}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {result.scl_imported} SCL · {result.lad_imported} LAD · {result.hmi_imported} HMI
              </p>
            </div>
          </div>

          {(result.compile_errors.length > 0 || result.compile_warnings.length > 0) && (
            <Card className="border-border/70 bg-card/70">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  Compile Results
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <ScrollArea className="max-h-48">
                  {result.compile_errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 py-1 text-xs text-destructive">
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="font-mono">{e}</span>
                    </div>
                  ))}
                  {result.compile_warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 py-1 text-xs text-yellow-500">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="font-mono">{w}</span>
                    </div>
                  ))}
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Action button */}
      <div className="mt-auto">
        {!result ? (
          <Button
            className="w-full gap-2"
            disabled={!canExport}
            onClick={handleExport}
          >
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Exporting…</>
              : "Export to TIA Portal"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setResult(null)}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
            {result.success && (
              <Button className="flex-1" onClick={() => onComplete(result)}>
                Done — Wizard Complete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
