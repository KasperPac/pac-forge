import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Circle, Flag, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DiffView } from "@/components/pac-st/diff-view";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useMigratePipeline } from "@/hooks/use-migrate-pipeline";
import { useUpdateMigrationSession } from "@/hooks/use-migrate-session";
import { cn } from "@/lib/utils";
import type { MigrationSession, MigratedBlock, FlaggedDecision } from "@/types";

interface MigrateTransformProps {
  session: MigrationSession;
  onSessionUpdate: () => void;
}

export function MigrateTransform({ session, onSessionUpdate }: MigrateTransformProps) {
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [blocks, setBlocks] = useState<MigratedBlock[]>(session.migrated_blocks ?? []);
  const [view, setView] = useState<"diff" | "flags">("diff");
  // Naming flags are advisory style-guide suggestions — default off for migration-only work.
  // Engineers can enable them when a naming cleanup is also in scope.
  const [showNaming, setShowNaming] = useState(false);

  const { running, currentBlockName, scanProgress, totalBlocks, error, runTransform } = useMigratePipeline();
  const updateSession = useUpdateMigrationSession();

  // Sync blocks when session data refreshes after a transform run
  useEffect(() => {
    if (session.migrated_blocks && session.migrated_blocks.length > 0) {
      setBlocks(session.migrated_blocks);
    }
  }, [session.migrated_blocks]);

  // All flagged decisions across all blocks
  const allFlags: Array<FlaggedDecision & { block_name: string }> = blocks.flatMap((b) =>
    (b.flagged_decisions ?? []).map((f) => ({ ...f, block_name: b.name }))
  );

  // NAMING flags are advisory style-guide suggestions — filterable independently
  const isNamingFlag = (f: FlaggedDecision) =>
    /\[NAMING\]/i.test(f.location ?? "") || /\[NAMING\]/i.test(f.id ?? "");

  const namingFlagCount = allFlags.filter(isNamingFlag).length;
  const visibleFlags = showNaming ? allFlags : allFlags.filter((f) => !isNamingFlag(f));

  const pendingFlags = visibleFlags.filter((f) => f.accepted === null);
  const hasPendingFlags = pendingFlags.length > 0;

  async function handleRunTransform() {
    try {
      await runTransform(session);
      await onSessionUpdate();
      // blocks will sync automatically via the useEffect above
    } catch {
      // error shown in state
    }
  }

  function toggleApprove(idx: number) {
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { ...b, approved: !b.approved } : b)));
  }

  function approveAll() {
    setBlocks((prev) => prev.map((b) => ({ ...b, approved: true })));
  }

  function resolveFlag(blockName: string, flagId: string, accepted: boolean) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.name !== blockName) return b;
        const updatedFlags = (b.flagged_decisions ?? []).map((f) =>
          f.id === flagId ? { ...f, accepted } : f
        );
        // When accepting a flag on a DB block, auto-exclude it from import —
        // S7-300 instance DBs / timer DBs cannot be imported as SCL; they must be
        // recreated in TIA Portal from the FB interface.
        const autoExclude = accepted && b.block_type === "DB";
        return {
          ...b,
          flagged_decisions: updatedFlags,
          ...(autoExclude ? { approved: false } : {}),
        };
      })
    );
  }

  function resolveAllFlags(accepted: boolean) {
    setBlocks((prev) =>
      prev.map((b) => {
        const updatedFlags = (b.flagged_decisions ?? []).map((f) =>
          f.accepted === null ? { ...f, accepted } : f
        );
        const autoExclude = accepted && b.block_type === "DB" &&
          updatedFlags.some((f) => f.accepted === true);
        return {
          ...b,
          flagged_decisions: updatedFlags,
          ...(autoExclude ? { approved: false } : {}),
        };
      })
    );
  }

  async function handleProceed() {
    await updateSession.mutateAsync({
      id: session.id,
      updates: { migrated_blocks: blocks, current_step: "compile" },
    });
    await onSessionUpdate();
  }

  const approvedCount = blocks.filter((b) => b.approved).length;
  const selected = blocks[selectedIdx] ?? null;
  const hasBlocks = blocks.length > 0;
  const progressPct = totalBlocks > 0 ? Math.round((scanProgress / totalBlocks) * 100) : 0;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Running state */}
      {running && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-30" />
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-blue-300">Migration Engine</span>
                {totalBlocks > 0 && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {scanProgress} / {totalBlocks}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-foreground/70">
                {currentBlockName ? `Transforming: ${currentBlockName}` : "Preparing…"}
              </div>
            </div>
          </div>
          {totalBlocks > 0 && (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-blue-500/15">
              <div
                className="h-full rounded-full bg-blue-400/70 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Flagged decisions banner */}
      {hasBlocks && allFlags.length > 0 && !running && (
        <div className={cn(
          "rounded-md border px-4 py-3",
          hasPendingFlags
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-green-500/30 bg-green-500/5"
        )}>
          <div className="flex items-center gap-2 flex-wrap">
            <Flag className={cn("h-3.5 w-3.5 shrink-0", hasPendingFlags ? "text-amber-400" : "text-green-400")} />
            <span className={cn("text-xs font-medium", hasPendingFlags ? "text-amber-300" : "text-green-400")}>
              {hasPendingFlags
                ? `${pendingFlags.length} flagged decision${pendingFlags.length !== 1 ? "s" : ""} require your review`
                : "All flagged decisions resolved"}
            </span>
            {namingFlagCount > 0 && (
              <button
                onClick={() => setShowNaming((v) => !v)}
                className={cn(
                  "rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                  showNaming
                    ? "border-blue-500/50 bg-blue-500/15 text-blue-300"
                    : "border-border/40 bg-muted/10 text-muted-foreground hover:text-foreground"
                )}
              >
                {showNaming ? "✓" : ""} NAMING ({namingFlagCount})
              </button>
            )}
            <div className="ml-auto flex gap-2">
              {hasPendingFlags && (
                <>
                  <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10px]"
                    onClick={() => resolveAllFlags(true)}>
                    <ThumbsUp className="h-3 w-3" /> Accept All
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10px]"
                    onClick={() => resolveAllFlags(false)}>
                    <ThumbsDown className="h-3 w-3" /> Reject All
                  </Button>
                </>
              )}
              <Button
                variant={view === "flags" ? "secondary" : "outline"}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setView(view === "flags" ? "diff" : "flags")}
              >
                {view === "flags" ? "Show Diff" : `Review Flags (${visibleFlags.length}${namingFlagCount > 0 && !showNaming ? `+${namingFlagCount} naming` : ""})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {hasBlocks && (
        <>
          {view === "flags" ? (
            /* Flagged decisions panel */
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border/60">
              <div className="space-y-3 p-3">
                {visibleFlags.map((flag) => (
                  <div
                    key={`${flag.block_name}-${flag.id}`}
                    className={cn(
                      "rounded-md border p-3",
                      flag.accepted === null
                        ? "border-amber-500/30 bg-amber-500/5"
                        : flag.accepted
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-border/40 bg-muted/5 opacity-60"
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{flag.block_name}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">{flag.location}</span>
                      <div className="ml-auto flex gap-1.5">
                        {flag.accepted === null ? (
                          <>
                            <button
                              onClick={() => resolveFlag(flag.block_name, flag.id, true)}
                              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors"
                            >
                              <ThumbsUp className="h-2.5 w-2.5" /> Accept
                            </button>
                            <button
                              onClick={() => resolveFlag(flag.block_name, flag.id, false)}
                              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono border border-border/50 text-muted-foreground hover:bg-muted/20 transition-colors"
                            >
                              <ThumbsDown className="h-2.5 w-2.5" /> Reject
                            </button>
                          </>
                        ) : (
                          <span className={cn("font-mono text-[10px]", flag.accepted ? "text-green-400" : "text-muted-foreground")}>
                            {flag.accepted ? "Accepted" : "Rejected"}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mb-1.5 text-xs text-destructive/80">{flag.issue}</p>
                    <div className="rounded border border-border/40 bg-muted/20 p-2 font-mono text-[10px] text-muted-foreground">
                      <div className="mb-1 text-[9px] uppercase tracking-wider text-muted-foreground/60">Original code</div>
                      <pre className="whitespace-pre-wrap break-all">{flag.original_code}</pre>
                    </div>
                    {flag.accepted !== false && (
                      <div className="mt-2 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-[11px] text-blue-300">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-blue-400/60 block mb-0.5">Proposed solution</span>
                        {flag.proposed_solution}
                      </div>
                    )}
                    {flag.accepted === true && blocks.find(b => b.name === flag.block_name)?.block_type === "DB" && (
                      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-amber-400/80">
                        <span>⊘</span>
                        <span>Block excluded from import — see Manual Setup checklist in Compile step</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            /* Diff view */
            <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-md border border-border/70">
              <ResizablePanel defaultSize={25} minSize={18}>
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Blocks</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={approveAll}>
                      Approve All
                    </Button>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="space-y-0.5 p-2">
                      {blocks.map((block, idx) => {
                        const blockFlags = block.flagged_decisions ?? [];
                        const pendingBlockFlags = blockFlags.filter((f) => f.accepted === null).length;
                        return (
                          <button
                            key={block.name}
                            onClick={() => setSelectedIdx(idx)}
                            className={`group/row flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${selectedIdx === idx ? "bg-primary/15 text-foreground" : "hover:bg-muted/40 text-muted-foreground"}`}
                          >
                            <button onClick={(e) => { e.stopPropagation(); toggleApprove(idx); }} className="shrink-0">
                              {block.approved
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                : <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />}
                            </button>
                            <span className="min-w-0 flex-1 truncate font-mono">{block.name}</span>
                            {pendingBlockFlags > 0 && (
                              <Flag className="h-3 w-3 shrink-0 text-amber-400" />
                            )}
                            {block.original_language && (
                              <Badge variant="outline" className="font-mono text-[9px] shrink-0 border-blue-500/40 text-blue-400/80">{block.original_language}</Badge>
                            )}
                            <Badge variant="outline" className="font-mono text-[9px] shrink-0">{block.block_type}</Badge>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={75}>
                <div className="flex h-full flex-col">
                  {selected ? (
                    <>
                      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                        <span className="font-mono text-xs text-muted-foreground">{selected.name}</span>
                        {selected.original_language && (
                          <Badge variant="outline" className="font-mono text-[10px] border-blue-500/50 text-blue-400">
                            {selected.original_language}
                          </Badge>
                        )}
                        {selected.changes_applied.length > 0 && (
                          <Badge variant="outline" className="font-mono text-[10px] border-green-500/50 text-green-400">
                            {selected.changes_applied.length} changes
                          </Badge>
                        )}
                        {(selected.flagged_decisions?.length ?? 0) > 0 && (
                          <Badge variant="outline" className="font-mono text-[10px] border-amber-500/50 text-amber-400">
                            <Flag className="mr-1 h-2.5 w-2.5" />
                            {selected.flagged_decisions?.length} flagged
                          </Badge>
                        )}
                      </div>
                      <div className="min-h-0 flex-1 overflow-auto">
                        {["LAD", "FBD", "GRAPH"].includes(selected.original_language ?? "") ? (
                          <pre className="h-full whitespace-pre-wrap break-words p-4 font-mono text-xs text-foreground/80">
                            {selected.migrated_scl}
                          </pre>
                        ) : (
                          <DiffView original={selected.original_scl} modified={selected.migrated_scl} />
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Select a block to view changes
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleRunTransform} disabled={running} className="gap-2">
              {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Re-run Transform
            </Button>
            <div className="flex-1" />
            <span className="font-mono text-xs text-muted-foreground">
              {approvedCount}/{blocks.length} approved
            </span>
            <Button onClick={handleProceed} disabled={approvedCount === 0 || hasPendingFlags}>
              {hasPendingFlags ? `Resolve ${pendingFlags.length} flags first` : "Proceed to Compile"}
            </Button>
          </div>
        </>
      )}

      {!hasBlocks && !running && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-md border border-border/50 bg-muted/10 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Process {Object.keys(session.source_blocks ?? {}).length} exported blocks — SCL/STL
            converted to S7-1500 SCL, LAD/GRAPH analysed and flagged for TIA Portal recompile.
          </p>
          <Button onClick={handleRunTransform} disabled={running} className="gap-2">
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Run Transformation
          </Button>
        </div>
      )}
    </div>
  );
}
