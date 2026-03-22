import { useState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useTiaBridgeWs } from "@/hooks/use-tia-bridge-ws";
import { useUpdateMigrationSession } from "@/hooks/use-migrate-session";
import { buildManifest } from "@/lib/manifest-builder";
import { generateExportBundle } from "@/lib/tia-export";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { supabase } from "@/lib/supabase";
import {
  getRecommendedTargets,
  detectSourceFamily,
  ALL_S7_1500_TARGETS,
} from "@/lib/migrate-cpu-mapping";
import { useMigratePipeline } from "@/hooks/use-migrate-pipeline";
import type { CompileErrorEntry } from "@/hooks/use-migrate-pipeline";
import type { MigrationSession, MigratedBlock } from "@/types";
import type { Artifact } from "@/types";
import type { ArtifactType } from "@/types";
import type { ProvisionProjectResponse } from "@/lib/tia-bridge-contract";

/** Extract the FB type name from a flag issue string, e.g. "typed as FB 'DOL'" → "DOL" */
function extractFbType(issue: string): string {
  const m = /typed as (?:FB|UDT)\s+['"]?(\w+)['"]?/i.exec(issue);
  if (m) return m[1];
  if (/\bTON\b/i.test(issue)) return "TON (timer)";
  if (/\bTOF\b/i.test(issue)) return "TOF (timer)";
  if (/\bTP\b/i.test(issue)) return "TP (timer)";
  if (/timer/i.test(issue)) return "Timer instance";
  if (/counter/i.test(issue)) return "Counter instance";
  return "Other";
}

const BLOCK_TYPE_MAP: Record<MigratedBlock["block_type"], ArtifactType> = {
  FB: "FB",
  FC: "FC",
  OB: "OB",
  DB: "DB",
  UDT: "UDT",
};

interface MigrateCompileProps {
  session: MigrationSession;
  onSessionUpdate: () => void;
}

export function MigrateCompile({ session, onSessionUpdate }: MigrateCompileProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState<string[]>([]);
  const [compileErrors, setCompileErrors] = useState<CompileErrorEntry[]>([]);
  // Ref mirrors compileErrors so WS event handlers see the current value synchronously
  const compileErrorsRef = useRef<CompileErrorEntry[]>([]);
  const [compileSuccess, setCompileSuccess] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [fixResult, setFixResult] = useState<{ fixedCount: number; patternsSaved: number; couldNotFix: string[] } | null>(null);

  const pipeline = useMigratePipeline();

  // Target project inputs
  const [projectFolder, setProjectFolder] = useState<string>(
    () => session.target_project_path
      ? session.target_project_path.replace(/[/\\][^/\\]+\.ap\d+$/, "")
      : "C:\\TIA_Projects"
  );
  const [projectName, setProjectName] = useState<string>(
    () => session.name.replace(/[^a-zA-Z0-9_-]/g, "_") + "_S7_1500"
  );

  // CPU selection
  const { matched, sourceName, targets } = getRecommendedTargets(session.source_cpu_type_id);
  const sourceFamily = detectSourceFamily(session.source_plc_family, session.source_cpu_type_id);
  const [selectedOrderNumber, setSelectedOrderNumber] = useState<string>(
    () => session.target_cpu_order_number ?? targets[0]?.orderNumber ?? "6ES7 516-3AN02-0AB0/V2.9"
  );
  const [showAllCpus, setShowAllCpus] = useState(false);

  const updateSession = useUpdateMigrationSession();
  const { data: bridgeStatus } = useBridgeStatus();

  /**
   * Fetch all compile errors from the /results endpoint in bulk.
   * More reliable than accumulating individual WS events — the bridge stores all
   * errors in job.CompileResult before broadcasting job_completed.
   */
  async function fetchAndApplyResults(jid: string): Promise<boolean> {
    try {
      const res = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/jobs/${jid}/results`);
      if (!res.ok) return compileErrorsRef.current.length === 0;
      type ResultsPayload = {
        compile_result?: {
          success?: boolean;
          errors?: Array<{ artifact_name?: string; error_text?: string; line?: number | null; column?: number | null }>;
          warnings?: Array<{ artifact_name?: string; error_text?: string; line?: number | null; column?: number | null }>;
        } | null;
      };
      const data = await res.json() as ResultsPayload;
      const allErrors = [
        ...(data.compile_result?.errors ?? []).map((e) => ({ ...e, severity: "ERROR" as const })),
        ...(data.compile_result?.warnings ?? []).map((e) => ({ ...e, severity: "WARNING" as const })),
      ].map((e) => ({
        artifactName: e.artifact_name ?? "?",
        errorText: e.error_text ?? "Error",
        line: e.line ?? null,
        column: e.column ?? null,
        severity: e.severity,
      }));
      if (allErrors.length > 0) {
        compileErrorsRef.current = allErrors;
        setCompileErrors(allErrors);
      }
      return allErrors.length === 0;
    } catch {
      return compileErrorsRef.current.length === 0;
    }
  }

  const { connected: wsConnected } = useTiaBridgeWs({
    enabled: !!jobId,
    jobId,
    onEvent: (event) => {
      if (event.type === "job_progress") {
        const data = event.data as { current_step?: string };
        if (data.current_step) setCompileLog((prev) => [...prev, data.current_step!]);
      }
      if (event.type === "compile_error") {
        // Individual WS events — accumulate as they arrive (best-effort)
        const data = event.data as { error_text?: string; artifact_name?: string; line?: number | null; column?: number | null; severity?: "ERROR" | "WARNING" | "INFO" };
        const err = { artifactName: data.artifact_name ?? "?", errorText: data.error_text ?? "Error", line: data.line ?? null, column: data.column ?? null, severity: data.severity };
        const updated = [...compileErrorsRef.current, err];
        compileErrorsRef.current = updated;
        setCompileErrors(updated);
      }
      if (event.type === "job_completed") {
        // Fetch results in bulk — don't rely on individual WS events being complete
        void fetchAndApplyResults(jobId!).then((success) => {
          setCompileSuccess(success);
          void handleSaveResult(success);
        });
      }
      if (event.type === "job_failed") {
        void fetchAndApplyResults(jobId!).then(() => {
          setCompileSuccess(false);
          void handleSaveResult(false);
        });
      }
    },
  });

  // Fallback polling — in case WS misses job_completed/job_failed events
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!jobId || compileSuccess !== null) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      return;
    }
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json() as { status?: string; error_message?: string };
        if (data.status === "COMPLETED" || data.status === "FAILED" || data.status === "CANCELLED") {
          clearInterval(pollingRef.current!); pollingRef.current = null;
          if (data.status === "COMPLETED") {
            const success = await fetchAndApplyResults(jobId!);
            setCompileSuccess(success);
            void handleSaveResult(success);
          } else {
            await fetchAndApplyResults(jobId!);
            if (data.error_message) {
              const updated = [...compileErrorsRef.current, { artifactName: "bridge", errorText: data.error_message }];
              compileErrorsRef.current = updated;
              setCompileErrors(updated);
            }
            setCompileSuccess(false);
            void handleSaveResult(false);
          }
        }
      } catch { /* bridge unreachable */ }
    }, 3000);
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, compileSuccess]);

  async function handleSaveResult(success: boolean) {
    const result = { success, compile_errors: compileErrors.map((e) => `${e.artifactName}: ${e.errorText}`) };
    await updateSession.mutateAsync({
      id: session.id,
      updates: { compile_result: result },
    });
    onSessionUpdate();
  }

  async function handleFixErrors() {
    setFixResult(null);
    try {
      const result = await pipeline.runCompileFix(session, compileErrors);
      setFixResult(result);
      onSessionUpdate(); // refresh session so blocks have new migrated_scl
    } catch {
      // error shown via pipeline.error
    }
  }

  async function handleCreateAndImport() {
    const approved = session.migrated_blocks.filter((b) => b.approved);
    if (approved.length === 0) return;

    setCompileLog([]);
    setCompileErrors([]);
    compileErrorsRef.current = [];
    setCompileSuccess(null);
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // ── Step 1: Create new S7-1500 project ──────────────────────────────
      setStatusMsg("Creating S7-1500 project…");
      const provisionRes = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/provision-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tia_project_path: projectFolder,
          project_name: projectName,
          cpu_order_number: selectedOrderNumber,
        }),
        signal: AbortSignal.timeout(120_000), // project creation can take ~60s
      });

      if (!provisionRes.ok) {
        const body = await provisionRes.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Provision failed: ${provisionRes.status}`);
      }

      const provision = await provisionRes.json() as ProvisionProjectResponse;
      if (!provision.success) {
        throw new Error(provision.message ?? "Project creation failed");
      }

      const newProjectPath = provision.project_file_path;
      setCompileLog([`Project created: ${newProjectPath}`]);

      // Save target path to session
      await updateSession.mutateAsync({
        id: session.id,
        updates: {
          target_cpu_order_number: selectedOrderNumber,
          target_project_path: newProjectPath,
        },
      });

      // ── Step 2: Build artifact bundle ────────────────────────────────────
      setStatusMsg("Preparing artifacts…");
      const artifacts: Artifact[] = approved.map((b) => ({
        id: b.name,
        project_id: session.id,
        session_id: session.id,
        name: b.name,
        type: BLOCK_TYPE_MAP[b.block_type] ?? "FB",
        filename: `${b.name}.scl`,
        content: b.migrated_scl,
        approved_content: b.migrated_scl,
        destination_folder: "Program blocks/Pac-Migration",
        dependencies: [],
        compile_after_import: true,
        overwrite_strategy: "CREATE_OR_UPDATE",
        safety_warnings: [],
        notes: "Migrated from S7-300/400",
        created_at: new Date().toISOString(),
      }));

      const { manifest } = buildManifest(artifacts, {
        projectId: session.id,
        tiaVersion: bridgeStatus?.version ?? "V18",
        cpuType: "S7-1500",
        userId: user?.id ?? "",
        sessionId: session.id,
      });

      const blob = await generateExportBundle(artifacts, manifest, { format: "scl" });
      const buffer = await blob.arrayBuffer();
      const artifactBundle = btoa(
        new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), "")
      );

      // ── Step 3: Submit import+compile job ────────────────────────────────
      setStatusMsg("Submitting import & compile job…");
      const migrationJobId = `migrate_${session.id}`;

      const jobRes = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: migrationJobId,
          job_type: "IMPORT_AND_COMPILE",
          manifest,
          artifact_bundle: artifactBundle,
          tia_project_path: newProjectPath,
        }),
        signal: AbortSignal.timeout(DEFAULT_BRIDGE_CONFIG.timeout),
      });

      if (!jobRes.ok) {
        const body = await jobRes.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Bridge error ${jobRes.status}`);
      }

      setStatusMsg("");
      setJobId(migrationJobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCompileErrors([{ artifactName: "bridge", errorText: msg }]);
      setStatusMsg("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProceed() {
    await updateSession.mutateAsync({
      id: session.id,
      updates: { current_step: "report" },
    });
    onSessionUpdate();
  }

  const approvedCount = session.migrated_blocks.filter((b) => b.approved).length;
  const isRunning = submitting || (!!jobId && compileSuccess === null);

  // Build manual checklist from accepted flags on excluded DB blocks
  const manualItems = session.migrated_blocks
    .filter((b) => b.block_type === "DB" && !b.approved &&
      (b.flagged_decisions ?? []).some((f) => f.accepted === true))
    .map((b) => {
      const flag = (b.flagged_decisions ?? []).find((f) => f.accepted === true);
      return {
        blockName: b.name,
        fbType: flag ? extractFbType(flag.issue) : "Other",
        proposedSolution: flag?.proposed_solution ?? "",
      };
    });

  // Group by FB type
  const manualGroups = manualItems.reduce<Record<string, typeof manualItems>>(
    (acc, item) => {
      if (!acc[item.fbType]) acc[item.fbType] = [];
      acc[item.fbType].push(item);
      return acc;
    },
    {}
  );

  const cpuListToShow = showAllCpus ? ALL_S7_1500_TARGETS : targets;

  return (
    <div className="flex h-full flex-col gap-4">

      {/* Source CPU detected */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Source Hardware
        </div>
        {session.source_plc_family || session.source_cpu_type_id ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs border-amber-500/50 text-amber-300">
              {session.source_plc_family ?? "Unknown family"}
            </Badge>
            {session.source_cpu_type_id && (
              <span className="font-mono text-xs text-muted-foreground">
                {session.source_cpu_type_id.replace("OrderNumber:", "")}
              </span>
            )}
            {sourceFamily && (
              <span className="font-mono text-xs text-muted-foreground">
                ({sourceFamily})
              </span>
            )}
            {matched && (
              <span className="font-mono text-xs text-muted-foreground">
                → matched as <span className="text-foreground">{sourceName}</span>
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              CPU type not detected — go back to Connect step and re-export to capture hardware info.
            </span>
          </div>
        )}
      </div>

      {/* Target CPU selection */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Target S7-1500 CPU
          {matched && (
            <span className="ml-2 text-green-400 normal-case">
              ✓ recommended from mapping table
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {cpuListToShow.map((t) => (
            <button
              key={t.orderNumber}
              onClick={() => setSelectedOrderNumber(t.orderNumber)}
              className={`rounded border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                selectedOrderNumber === t.orderNumber
                  ? "border-amber-500/70 bg-amber-500/10 text-amber-300"
                  : "border-border/50 bg-muted/10 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <div>{t.cpuName}</div>
              <div className="text-[9px] opacity-70">{t.orderNumber}</div>
            </button>
          ))}
          <button
            onClick={() => setShowAllCpus((v) => !v)}
            className="flex items-center gap-1 rounded border border-border/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showAllCpus ? "rotate-180" : ""}`} />
            {showAllCpus ? "Show recommended" : "Show all S7-1500 CPUs"}
          </button>
        </div>
        {/* Custom order number override */}
        <div className="mt-2">
          <label className="mb-1 block font-mono text-[10px] text-muted-foreground">
            Override order number (optional — use if above doesn&apos;t match your TIA Portal catalog)
          </label>
          <input
            type="text"
            value={selectedOrderNumber}
            onChange={(e) => setSelectedOrderNumber(e.target.value)}
            placeholder="6ES7 516-3AN02-0AB0/V2.9"
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* New project path */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Project Folder
          </label>
          <input
            type="text"
            value={projectFolder}
            onChange={(e) => setProjectFolder(e.target.value)}
            placeholder="C:\TIA_Projects"
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Project Name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Migration_S7_1500"
            className="w-full rounded-md border border-border/60 bg-background/50 px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Manual setup checklist — blocks excluded from import due to accepted flags */}
      {manualItems.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 border-b border-amber-500/20 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
              Manual Setup Required in TIA Portal ({manualItems.length} block{manualItems.length !== 1 ? "s" : ""})
            </span>
            <span className="ml-1 text-[10px] text-muted-foreground">
              — these blocks were excluded from SCL import and must be created manually
            </span>
          </div>
          <ScrollArea className="max-h-52">
            <div className="divide-y divide-border/20">
              {Object.entries(manualGroups).map(([fbType, items]) => (
                <div key={fbType} className="p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-amber-300">{fbType}</span>
                    <Badge variant="outline" className="border-amber-500/30 font-mono text-[9px] text-amber-400/70">
                      {items.length} block{items.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((item) => (
                      <div key={item.blockName} className="rounded border border-border/30 bg-muted/10 px-2 py-1.5">
                        <div className="flex items-start gap-2">
                          <Circle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/50" />
                          <div className="min-w-0 flex-1">
                            <span className="font-mono text-xs text-foreground">{item.blockName}</span>
                            {item.proposedSolution && (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">{item.proposedSolution}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Approved block list */}
      <div className="rounded-md border border-border/60 bg-muted/10">
        <div className="flex items-center gap-3 border-b border-border/40 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Blocks to Import ({approvedCount})
          </span>
          {manualItems.length > 0 && (
            <span className="font-mono text-[10px] text-amber-400/70">
              + {manualItems.length} excluded (manual setup)
            </span>
          )}
        </div>
        <ScrollArea className="max-h-32">
          <div className="space-y-0.5 p-2">
            {session.migrated_blocks.map((block) => (
              <div key={block.name} className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                {block.approved
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  : <Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />}
                <span className="font-mono">{block.name}</span>
                <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                  {block.block_type}
                </Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Status message during provisioning */}
      {statusMsg && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          {statusMsg}
        </div>
      )}

      {/* WebSocket status */}
      {jobId && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-zinc-500"}`} />
          Bridge: {wsConnected ? "Connected" : "Connecting…"}
        </div>
      )}

      {/* Compile log */}
      {compileLog.length > 0 && (
        <div className="rounded-md border border-border/60 bg-muted/10">
          <div className="border-b border-border/40 px-3 py-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Log</span>
          </div>
          <ScrollArea className="max-h-28">
            <div className="p-2 font-mono text-[10px] text-muted-foreground">
              {compileLog.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Compile errors + fix button */}
      {compileErrors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-destructive">
              Errors ({compileErrors.length})
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-6 gap-1.5 border-amber-500/50 px-2 font-mono text-[10px] text-amber-300 hover:border-amber-400 hover:text-amber-200"
              disabled={pipeline.running || isRunning}
              onClick={handleFixErrors}
            >
              {pipeline.running
                ? <><Loader2 className="h-3 w-3 animate-spin" />{pipeline.currentBlockName ?? "Fixing…"}</>
                : "Fix Compile Errors (AI)"}
            </Button>
          </div>
          <ScrollArea className="max-h-40">
            <div className="space-y-0.5 p-1">
              {compileErrors.map((e, i) => (
                <div key={i} className={`flex items-start gap-2 rounded px-1.5 py-1 text-xs ${e.severity === "WARNING" ? "text-amber-400/80" : "text-destructive"}`}>
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-medium">{e.artifactName}</span>
                    {(e.line != null) && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        line {e.line}{e.column != null ? `:${e.column}` : ""}
                      </span>
                    )}
                    <span className="ml-1.5 break-words">{e.errorText}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Fix result */}
      {fixResult && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400">Fix Complete</div>
          <div className="text-muted-foreground">
            Fixed <span className="text-foreground">{fixResult.fixedCount}</span> block(s).{" "}
            <span className="text-foreground">{fixResult.patternsSaved}</span> correction pattern(s) saved for review in the Pattern Library.
          </div>
          {fixResult.couldNotFix.length > 0 && (
            <div className="text-destructive/80">
              Could not fix: {fixResult.couldNotFix.join("; ")}
            </div>
          )}
          <div className="text-muted-foreground text-[10px]">
            Re-run "Create S7-1500 Project &amp; Import" to compile the fixed code.
          </div>
        </div>
      )}

      {/* Pipeline error */}
      {pipeline.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {pipeline.error}
        </div>
      )}

      {/* Success */}
      {compileSuccess && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Compilation successful — all blocks imported to new S7-1500 project.
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={handleCreateAndImport}
          disabled={isRunning || approvedCount === 0 || !projectFolder || !projectName || !selectedOrderNumber}
          className="gap-2"
        >
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create S7-1500 Project &amp; Import
        </Button>

        <Button onClick={handleProceed}>
          Proceed to Report
        </Button>
      </div>
    </div>
  );
}
