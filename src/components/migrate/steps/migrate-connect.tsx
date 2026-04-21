import { useState, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, CheckCircle2, Plug, ArrowRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBridgeStatus } from "@/hooks/use-tia-jobs";
import { useExportFromTia } from "@/hooks/use-export-from-tia";
import { useUpdateMigrationSession } from "@/hooks/use-migrate-session";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { useMigrateStore } from "@/stores/migrate-store";
import { getRecommendedTargets } from "@/lib/migrate-cpu-mapping";
import { cn } from "@/lib/utils";
import type { MigrationSession } from "@/types";

interface MigrateConnectProps {
  session: MigrationSession;
  onSessionUpdate: () => void;
}

export function MigrateConnect({ session, onSessionUpdate }: MigrateConnectProps) {
  const store = useMigrateStore();
  const [exportedBlocks, setExportedBlocks] = useState<Record<string, string>>(
    session.source_blocks ?? {}
  );
  const [exportedLangs, setExportedLangs] = useState<Record<string, string>>(
    session.source_block_languages ?? {}
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { data: bridgeStatus } = useBridgeStatus();
  const exportMutation = useExportFromTia();
  const updateSession = useUpdateMigrationSession();

  // Manually upload SimaticML XML files for blocks that couldn't be auto-exported
  const handleManualXmlUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: Record<string, string> = {};
    const addedLangs: Record<string, string> = {};

    await Promise.all(Array.from(files).map((file) => new Promise<void>((resolve) => {
      const name = file.name.replace(/\.xml$/i, "");
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        added[name] = content;
        if (content.includes("FlgNet") || content.includes("LADSource")) addedLangs[name] = "LAD";
        else if (content.includes("FBDSource") || content.includes("FBNetwork")) addedLangs[name] = "FBD";
        else addedLangs[name] = "LAD";
        resolve();
      };
      reader.readAsText(file);
    })));

    const mergedBlocks = { ...exportedBlocks, ...added };
    const mergedLangs = { ...exportedLangs, ...addedLangs };
    setExportedBlocks(mergedBlocks);
    setExportedLangs(mergedLangs);
    void updateSession.mutateAsync({
      id: session.id,
      updates: {
        source_blocks: mergedBlocks,
        source_block_count: Object.keys(mergedBlocks).length,
        source_block_languages: mergedLangs,
      },
    });
  }, [session.id, exportedBlocks, exportedLangs, updateSession]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "attach" }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Connect failed" })) as { message?: string };
        throw new Error(err.message ?? "Connect failed");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tia-bridge-status"] });
    },
  });

  const bridgeOnline = bridgeStatus?.bridgeOnline ?? false;
  const tiaConnected = bridgeStatus?.tiaConnected ?? false;
  const projectOpen = bridgeStatus?.projectOpen ?? false;

  const statusDot = !bridgeOnline
    ? "bg-zinc-500"
    : !tiaConnected
    ? "bg-amber-500"
    : projectOpen
    ? "bg-green-500"
    : "bg-amber-500";

  const statusLabel = !bridgeOnline
    ? "Bridge offline"
    : !tiaConnected
    ? "Bridge online — TIA not connected"
    : projectOpen
    ? "TIA connected — project open"
    : "TIA connected — no project open";

  const blockNames = Object.keys(exportedBlocks);
  const canExport = bridgeOnline && tiaConnected && projectOpen;

  async function handleExport() {
    setExportError(null);
    setSaveError(null);
    setExportWarnings([]);
    let blocks: Record<string, string> = {};
    let exportResult: Awaited<ReturnType<typeof exportMutation.mutateAsync>> | null = null;
    try {
      exportResult = await exportMutation.mutateAsync();
      blocks = exportResult.sources ?? {};
      setExportedBlocks(blocks);
      setExportedLangs(exportResult.source_languages ?? {});
      if (exportResult.warnings?.length) setExportWarnings(exportResult.warnings);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setExportError(msg);
      return;
    }
    try {
      await updateSession.mutateAsync({
        id: session.id,
        updates: {
          source_blocks: blocks,
          source_block_count: Object.keys(blocks).length,
          source_block_languages: exportResult?.source_languages ?? {},
          // Capture source PLC hardware info so compile step can recommend target
          source_plc_family: bridgeStatus?.sourcePlcFamily ?? null,
          source_cpu_type_id: bridgeStatus?.sourceCpuTypeId ?? null,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setSaveError(`Blocks exported but failed to save: ${msg}`);
    }
  }

  async function handleProceed() {
    try {
      await updateSession.mutateAsync({
        id: session.id,
        updates: { current_step: "analyse" },
      });
      // Update store directly — don't rely on refetch→useEffect chain
      store.setCurrentStep("analyse");
      store.setStepStatus("connect", "completed");
      store.setStepStatus("analyse", "active");
      onSessionUpdate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(`Failed to proceed: ${msg}`);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Bridge status card */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-4">
        <div className="flex items-center gap-3">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            TIA Bridge Status
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-full", statusDot)} />
            <span className="font-mono text-xs text-muted-foreground">{statusLabel}</span>
          </div>
        </div>

        {bridgeStatus && (
          <div className="mt-3 border-t border-border/40 pt-3 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Bridge
                </div>
                <div className={cn("mt-1 font-mono text-xs", bridgeOnline ? "text-green-400" : "text-zinc-500")}>
                  {bridgeOnline ? "Online" : "Offline"}
                </div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  TIA Portal
                </div>
                <div className={cn("mt-1 font-mono text-xs", tiaConnected ? "text-green-400" : "text-zinc-500")}>
                  {tiaConnected ? "Connected" : "Not connected"}
                </div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Project
                </div>
                <div className={cn("mt-1 font-mono text-xs", projectOpen ? "text-green-400" : "text-zinc-500")}>
                  {projectOpen ? "Open" : "No project"}
                </div>
              </div>
            </div>
            {(bridgeStatus.sourcePlcFamily || bridgeStatus.sourceCpuTypeId) && (() => {
              const rec = getRecommendedTargets(bridgeStatus.sourceCpuTypeId);
              const rawTypeId = bridgeStatus.sourceCpuTypeId?.replace("OrderNumber:", "") ?? "";
              // Detect generic/wildcard TIA Portal placeholder (e.g. "6ES7 3xx-xxxx")
              const isGenericCpu = /x{2,}/i.test(rawTypeId);
              return (
                <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                      Source CPU
                    </span>
                    <span className="font-mono text-xs text-amber-300">
                      {bridgeStatus.sourcePlcFamily ?? ""}
                      {rawTypeId && !isGenericCpu ? ` — ${rawTypeId}` : ""}
                    </span>
                    {isGenericCpu && (
                      <span className="font-mono text-[10px] text-amber-500 italic">
                        — generic placeholder ({rawTypeId}) — exact model unknown
                      </span>
                    )}
                    {rec.matched && (
                      <Badge variant="outline" className="ml-auto font-mono text-[9px] border-amber-500/40 text-amber-400">
                        {rec.sourceName}
                      </Badge>
                    )}
                  </div>
                  {isGenericCpu && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      TIA Portal reported a generic CPU type. This happens when the hardware
                      wasn't fully specified after migration. You can select the target CPU
                      manually in the Compile step.
                    </p>
                  )}
                  <div className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    <div className="flex-1">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Recommended Target{rec.targets.length > 1 ? "s" : ""}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {rec.targets.map((t) => (
                          <div key={t.orderNumber} className="rounded border border-green-500/30 bg-green-500/5 px-2 py-1">
                            <div className="font-mono text-xs text-green-400">{t.cpuName}</div>
                            <div className="font-mono text-[10px] text-muted-foreground/70">{t.orderNumber.replace("OrderNumber:", "")}</div>
                          </div>
                        ))}
                        {!rec.matched && (
                          <span className="font-mono text-[10px] text-muted-foreground italic">
                            (no exact match — showing safe default)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Connect / Disconnect actions */}
      {bridgeOnline && (
        <div className="flex items-center gap-3">
          {!tiaConnected ? (
            <Button
              variant="outline"
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="gap-2"
            >
              {connectMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Plug className="h-3.5 w-3.5" />}
              Connect to TIA Portal
            </Button>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-green-500/50 font-mono text-[10px] text-green-400">
              <Plug className="h-3 w-3" />
              TIA Portal connected
            </Badge>
          )}
          {connectMutation.isError && (
            <span className="font-mono text-xs text-destructive">
              {connectMutation.error instanceof Error ? connectMutation.error.message : "Connect failed"}
            </span>
          )}
        </div>
      )}

      {/* Instructions */}
      {!canExport && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <strong>Prerequisites:</strong>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Start the PacForgeBridge on this machine (<code>dotnet run --project bridge/PacForgeBridge</code>)</li>
                <li>Open TIA Portal and attach the bridge (or let it auto-attach)</li>
                <li>Open the S7-300/400 project you want to migrate</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Export action */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={!canExport || exportMutation.isPending}
          className="gap-2"
        >
          {exportMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Export Blocks from TIA Portal
        </Button>

        {blockNames.length > 0 && (
          <Badge variant="outline" className="font-mono text-[10px] border-green-500/50 text-green-400">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {blockNames.length} blocks exported
          </Badge>
        )}
      </div>

      {/* Errors */}
      {exportError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{exportError}</span>
        </div>
      )}
      {saveError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{saveError}</span>
        </div>
      )}

      {/* Export warnings — blocks that failed to export */}
      {exportWarnings.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
              {exportWarnings.length} block{exportWarnings.length > 1 ? "s" : ""} could not be auto-exported
            </span>
          </div>
          <ul className="space-y-0.5 pl-5">
            {exportWarnings.map((w, i) => (
              <li key={i} className="font-mono text-[10px] text-amber-300/80 break-all">{w}</li>
            ))}
          </ul>
          <div className="border-t border-amber-500/20 pt-2 space-y-1.5">
            <p className="font-mono text-[10px] text-muted-foreground">
              <strong className="text-amber-300">Standard library blocks</strong> (DEADBAND, INTEG etc.) — know-how protected, skip these.
              Equivalent S7-1500 blocks exist in the TIA Portal library catalog.
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              <strong className="text-amber-300">Inconsistent custom blocks</strong> (SEQ blocks etc.) — export manually from TIA Portal:
              right-click the block → <em>Export</em> → choose SimaticML format → upload the .xml file below.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 font-mono text-[10px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              onClick={() => xmlInputRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              Upload block .xml files manually
            </Button>
            <input
              ref={xmlInputRef}
              type="file"
              accept=".xml"
              multiple
              className="hidden"
              onChange={(e) => handleManualXmlUpload(e.target.files)}
            />
          </div>
        </div>
      )}

      {/* Manual XML upload — also available when no auto-export warnings */}
      {exportWarnings.length === 0 && blockNames.length > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 font-mono text-[10px] text-muted-foreground"
            onClick={() => xmlInputRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            Add missing blocks via .xml
          </Button>
          <input
            ref={xmlInputRef}
            type="file"
            accept=".xml"
            multiple
            className="hidden"
            onChange={(e) => handleManualXmlUpload(e.target.files)}
          />
        </div>
      )}

      {/* Exported block list */}
      {blockNames.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border/60 bg-muted/10">
          <div className="shrink-0 border-b border-border/40 px-3 py-2 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Exported Blocks ({blockNames.length})
            </span>
            {(() => {
              const langCounts: Record<string, number> = {};
              for (const name of blockNames) {
                const l = exportedLangs[name] ?? "SCL";
                langCounts[l] = (langCounts[l] ?? 0) + 1;
              }
              return Object.entries(langCounts).sort(([a], [b]) => a.localeCompare(b)).map(([l, n]) => (
                <span key={l} className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase",
                  l === "STL" ? "bg-blue-500/20 text-blue-300" :
                  l === "DB"  ? "bg-zinc-500/20 text-zinc-400" :
                  l === "SCL" ? "bg-green-500/15 text-green-400" :
                  "bg-amber-500/20 text-amber-300"
                )}>
                  {n} {l}
                </span>
              ));
            })()}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5 p-2">
              {blockNames.map((name) => {
                const lang = exportedLangs[name] ?? "SCL";
                const isNonScl = lang !== "SCL" && lang !== "DB";
                return (
                  <div
                    key={name}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md border px-2.5 py-2 hover:bg-muted/30",
                      isNonScl
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-border/40 bg-background/40"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-foreground/80">{name}</span>
                      {lang !== "SCL" && (
                        <span className={cn(
                          "shrink-0 rounded px-1 font-mono text-[9px] uppercase",
                          lang === "STL" ? "bg-blue-500/20 text-blue-300" :
                          lang === "DB"  ? "bg-zinc-500/20 text-zinc-400" :
                          "bg-amber-500/20 text-amber-300"
                        )}>
                          {lang}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {Math.round((exportedBlocks[name]?.length ?? 0) / 1000 * 10) / 10}k chars
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Proceed */}
      <div className="flex justify-end">
        <Button
          onClick={handleProceed}
          disabled={blockNames.length === 0}
        >
          Proceed to Analysis ({blockNames.length} blocks)
        </Button>
      </div>
    </div>
  );
}
