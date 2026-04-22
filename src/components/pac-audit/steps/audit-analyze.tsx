import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  SkipForward,
  Brain,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabase";
import { callNonStreaming } from "@/hooks/use-generation";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import {
  analyzeBlocks,
  type BlockUnderstandingResult,
  type OrchestratorBlockInput,
} from "@/lib/audit-analysis/analysis-orchestrator";
import type { AuditCrossReference, AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";

const ANALYSIS_CONCURRENCY = 4;
const ANALYSIS_MODEL_ID = "claude-sonnet-4-6";
const ANALYSIS_MAX_TOKENS = 4096;

interface AuditAnalyzeProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

type BlockStatus = "pending" | "skipped" | "analyzing" | "done" | "failed";

interface BlockState {
  id: string;
  name: string;
  blockType: string;
  language: string;
  lineCount: number | null;
  sourceCode: string | null;
  folderPath: string | null;
  status: BlockStatus;
  error?: string;
}


type Phase = "idle" | "running" | "complete" | "cancelled";

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function BlockStatusIcon({ status }: { status: BlockStatus }) {
  switch (status) {
    case "analyzing":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
    case "skipped":
      return <SkipForward className="h-3.5 w-3.5 text-zinc-500" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border border-border/40 bg-muted/20" />;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuditAnalyze({ session, onSessionUpdate }: AuditAnalyzeProps) {
  const store = useAuditStore();
  const updateProject = useUpdateAuditProject();

  const [blocks, setBlocks] = useState<BlockState[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load selected blocks + folders from Supabase
  const selectedIds = [...store.selectedBlockIds];

  const { data: dbFolders } = useQuery({
    queryKey: ["audit-folders-analyze", session.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("audit_folders")
        .select("id, path")
        .eq("audit_project_id", session.id);
      if (qErr) throw qErr;
      return (data ?? []) as Array<{ id: string; path: string }>;
    },
  });

  const { data: dbBlocks, isLoading } = useQuery({
    queryKey: ["audit-blocks-full", session.id, selectedIds.join(",")],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const { data, error: qErr } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type, programming_language, line_count, source_code, folder_id, analysis_status")
        .in("id", selectedIds)
        .order("name");
      if (qErr) throw qErr;
      return data ?? [];
    },
    enabled: selectedIds.length > 0,
  });

  // Build folder lookup map
  const folderPathMap = useCallback((): Map<string, string> => {
    const m = new Map<string, string>();
    for (const f of dbFolders ?? []) m.set(f.id, f.path);
    return m;
  }, [dbFolders]);

  // Project block name set — used post-analysis to classify called_blocks.kind deterministically
  const { data: allDbBlocks } = useQuery({
    queryKey: ["audit-blocks-names", session.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("audit_blocks")
        .select("name")
        .eq("audit_project_id", session.id);
      if (qErr) throw qErr;
      return (data ?? []) as Array<{ name: string }>;
    },
  });

  const projectBlockNames = useCallback((): Set<string> => {
    const s = new Set<string>();
    for (const b of allDbBlocks ?? []) s.add(b.name);
    return s;
  }, [allDbBlocks]);

  // Initialise block states once data loads
  useEffect(() => {
    if (!dbBlocks || blocks.length > 0) return;
    const fm = folderPathMap();
    setBlocks(
      dbBlocks.map((b) => ({
        id: b.id as string,
        name: b.name as string,
        blockType: b.block_type as string,
        language: b.programming_language as string,
        lineCount: b.line_count as number | null,
        sourceCode: b.source_code as string | null,
        folderPath: b.folder_id ? (fm.get(b.folder_id as string) ?? null) : null,
        // Null source = F-block or otherwise unextracted — skip silently
        status: b.source_code == null ? "skipped" : ("pending" as BlockStatus),
      }))
    );
  }, [dbBlocks, blocks.length, folderPathMap]);

  // Scroll active block into view
  useEffect(() => {
    if (phase === "running") {
      scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [phase, blocks]);

  function updateBlock(id: string, patch: Partial<BlockState>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  const runAnalysis = useCallback(async () => {
    if (blocks.length === 0) return;
    setPhase("running");
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const projectNames = projectBlockNames();

    // Gather cross-refs for every selected block up front — the
    // data-flow extractor keys off `source_block_id`.
    const analyzableBlockIds = blocks
      .filter((b) => b.status !== "skipped")
      .map((b) => b.id);

    const xrefByBlock = new Map<string, AuditCrossReference[]>();
    if (analyzableBlockIds.length > 0) {
      const { data: xrefRows, error: xrefErr } = await supabase
        .from("audit_cross_references")
        .select("*")
        .eq("audit_project_id", session.id)
        .in("source_block_id", analyzableBlockIds);
      if (xrefErr) {
        setError(`Failed to load cross-references: ${xrefErr.message}`);
        setPhase("idle");
        return;
      }
      for (const row of (xrefRows ?? []) as AuditCrossReference[]) {
        const list = xrefByBlock.get(row.source_block_id) ?? [];
        list.push(row);
        xrefByBlock.set(row.source_block_id, list);
      }
    }

    const orchestratorInputs: OrchestratorBlockInput[] = blocks
      .filter((b) => b.status !== "skipped")
      .map((b) => ({
        id: b.id,
        name: b.name,
        block_type: b.blockType,
        programming_language: b.language,
        source_code: b.sourceCode,
        folder_path: b.folderPath,
        line_count: b.lineCount,
      }));

    let doneCount = 0;
    let failCount = 0;
    const skippedCount = blocks.filter((b) => b.status === "skipped").length;

    const persistResult = async (result: BlockUnderstandingResult) => {
      const u = result.understanding;

      await supabase
        .from("audit_block_understanding")
        .update({ is_current: false })
        .eq("block_id", result.blockId)
        .eq("is_current", true);

      const { error: insertErr } = await supabase
        .from("audit_block_understanding")
        .insert({
          block_id: result.blockId,
          audit_project_id: session.id,
          purpose: u.purpose,
          category: u.category,
          complexity_rating: null,
          has_state_machine: u.has_state_machine,
          state_machine: u.state_machine,
          data_flow: u.data_flow,
          timing_analysis: u.timing_analysis,
          fault_handling: u.fault_handling,
          interface_contract: u.interface_contract,
          code_quality: u.code_quality,
          detailed_notes: u.detailed_notes,
          model_used: u.model_used,
          token_usage: u.token_usage,
          is_current: true,
        });
      if (insertErr) throw new Error(insertErr.message);

      await supabase
        .from("audit_blocks")
        .update({ analysis_status: "understood", analyzed_at: new Date().toISOString() })
        .eq("id", result.blockId);
    };

    await analyzeBlocks(
      orchestratorInputs,
      {
        crossReferencesByBlockId: xrefByBlock,
        projectBlockNames: projectNames,
        modelId: ANALYSIS_MODEL_ID,
        aiCall: async (system, user, signal) => {
          const r = await callNonStreaming(
            system,
            [{ role: "user", content: user }],
            signal,
            ANALYSIS_MAX_TOKENS,
          );
          return { content: r.content, usage: r.usage };
        },
      },
      ctrl.signal,
      ANALYSIS_CONCURRENCY,
      async (event) => {
        if (event.status === "started") {
          updateBlock(event.blockId, { status: "analyzing" });
          return;
        }
        if (event.status === "completed" && event.result) {
          try {
            await persistResult(event.result);
            updateBlock(event.blockId, { status: "done" });
            doneCount++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await supabase
              .from("audit_blocks")
              .update({ analysis_status: "failed", analysis_error: msg })
              .eq("id", event.blockId);
            updateBlock(event.blockId, { status: "failed", error: msg });
            failCount++;
          }
          return;
        }
        if (event.status === "failed") {
          const msg = event.error ?? "analysis failed";
          await supabase
            .from("audit_blocks")
            .update({ analysis_status: "failed", analysis_error: msg })
            .eq("id", event.blockId);
          updateBlock(event.blockId, { status: "failed", error: msg });
          failCount++;
          return;
        }
      },
    );

    if (ctrl.signal.aborted) {
      setPhase("cancelled");
      return;
    }

    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: {
          analysis_progress: {
            total_blocks: blocks.length - skippedCount,
            analyzed: doneCount,
            pending: 0,
            failed: failCount,
          },
        },
      });
    } catch {
      // non-fatal
    }

    setPhase("complete");
  }, [blocks, session.id, updateProject, projectBlockNames]);

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleProceed() {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "classify" },
      });
      store.setStepStatus("analyze", "completed");
      store.setCurrentStep("classify");
      store.setStepStatus("classify", "active");
      onSessionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Derived counts
  const analyzable = blocks.filter((b) => b.status !== "skipped").length;
  const skipped = blocks.filter((b) => b.status === "skipped").length;
  const done = blocks.filter((b) => b.status === "done").length;
  const failed = blocks.filter((b) => b.status === "failed").length;
  const progress = analyzable > 0 ? Math.round(((done + failed) / analyzable) * 100) : 0;

  // Currently analyzing block (for scroll anchor)
  const activeBlock = blocks.find((b) => b.status === "analyzing");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="font-mono text-sm text-muted-foreground">No blocks selected.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Header card */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Block Analysis
          </span>
          <div className="flex items-center gap-3">
            {skipped > 0 && (
              <span className="font-mono text-[10px] text-zinc-500">
                {skipped} skipped (no source)
              </span>
            )}
            <span className="font-mono text-xs text-muted-foreground">
              {done}/{analyzable} analyzed
            </span>
          </div>
        </div>

        {phase !== "idle" && (
          <Progress value={progress} className="mb-3 h-1.5" />
        )}

        {/* Block list */}
        <ScrollArea className="h-[380px]">
          <div className="space-y-0.5 pr-1">
            {blocks.map((block) => (
              <div
                key={block.id}
                ref={block.id === activeBlock?.id ? scrollRef : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors",
                  block.status === "analyzing"
                    ? "border-blue-500/30 bg-blue-500/5"
                    : block.status === "done"
                    ? "border-green-500/20 bg-green-500/5"
                    : block.status === "failed"
                    ? "border-red-500/20 bg-red-500/5"
                    : "border-border/30 bg-muted/5",
                )}
              >
                <BlockStatusIcon status={block.status} />
                <span
                  className={cn(
                    "w-8 shrink-0 font-mono text-[10px] font-medium",
                    block.status === "skipped"
                      ? "text-zinc-600"
                      : "text-muted-foreground"
                  )}
                >
                  {block.blockType}
                </span>
                <span
                  className={cn(
                    "flex-1 truncate font-mono text-xs",
                    block.status === "skipped" ? "text-zinc-600" : ""
                  )}
                >
                  {block.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                  {block.language}
                </span>
                {block.lineCount != null && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">
                    {block.lineCount}L
                  </span>
                )}
                {block.status === "failed" && block.error && (
                  <span className="max-w-[160px] truncate font-mono text-[10px] text-red-400" title={block.error}>
                    {block.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Stats when complete */}
      {phase === "complete" && (
        <div className="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-green-400" />
            <span className="font-mono text-xs text-green-400">
              Analysis complete — {done} blocks understood
              {failed > 0 && (
                <span className="text-amber-400">, {failed} failed</span>
              )}
              {skipped > 0 && (
                <span className="text-zinc-500">, {skipped} skipped</span>
              )}
            </span>
          </div>
        </div>
      )}

      {phase === "cancelled" && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-xs text-amber-400">
          Analysis cancelled. {done} blocks analyzed before stopping.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {phase === "idle" && (
          <Button onClick={() => void runAnalysis()} className="gap-2">
            <Brain className="h-3.5 w-3.5" />
            Analyze {analyzable} Block{analyzable !== 1 ? "s" : ""}
          </Button>
        )}
        {phase === "running" && (
          <Button variant="outline" onClick={handleCancel} className="gap-2">
            <StopCircle className="h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
        {(phase === "complete" || phase === "cancelled") && done > 0 && (
          <>
            {phase === "cancelled" && (
              <Button variant="outline" onClick={() => void runAnalysis()} className="gap-2">
                <Brain className="h-3.5 w-3.5" />
                Resume
              </Button>
            )}
            <Button onClick={() => void handleProceed()} className="gap-2">
              <ArrowRight className="h-3.5 w-3.5" />
              Proceed to Classify
            </Button>
          </>
        )}
        {phase === "complete" && done === 0 && (
          <Button variant="outline" onClick={() => void runAnalysis()} className="gap-2">
            <Brain className="h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

