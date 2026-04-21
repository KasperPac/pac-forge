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
import { buildBlockAnalysisSystemPrompt } from "@/lib/audit-analysis-prompt";
import type { AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";

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
// JSON extraction helper
// ---------------------------------------------------------------------------

function extractJson(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();

  const start = raw.indexOf("{");
  if (start === -1) return raw;

  // Walk forward tracking brace depth to find the true root closing brace,
  // not just the last } in the string (which may be a nested closer in truncated output)
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  // Fully balanced — return exact slice
  if (end !== -1) return raw.slice(start, end + 1);

  // Truncated response — return what we have; caller will get a parse error
  // and the block will be marked failed, which is correct
  return raw.slice(start);
}

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

    // Build project name set once — used post-analysis to classify called_blocks.kind
    const projectNames = projectBlockNames();
    const systemPrompt = buildBlockAnalysisSystemPrompt();

    let doneCount = 0;
    let failCount = 0;
    const skippedCount = blocks.filter((b) => b.status === "skipped").length;

    for (const block of blocks) {
      if (ctrl.signal.aborted) {
        setPhase("cancelled");
        return;
      }
      if (block.status === "skipped") continue;

      updateBlock(block.id, { status: "analyzing" });

      try {
        // Cap source at 40KB — very large LAD/FBD blocks (10k+ lines of XML) consume
        // most of the context window and leave insufficient room for the JSON response.
        const MAX_SOURCE_CHARS = 40_000;
        const rawSource = block.sourceCode ?? "";
        const truncated = rawSource.length > MAX_SOURCE_CHARS;
        const source = truncated
          ? rawSource.slice(0, MAX_SOURCE_CHARS) +
            `\n\n[TRUNCATED: source is ${rawSource.length} chars, showing first ${MAX_SOURCE_CHARS}. Analyse what is visible; note truncation in confidence_notes.]`
          : rawSource;

        const userMessage = [
          `Block Name: ${block.name}`,
          `Block Type: ${block.blockType}`,
          `Programming Language: ${block.language}`,
          `Folder Path: ${block.folderPath ?? "Program blocks (root)"}`,
          `Line Count: ${block.lineCount ?? "unknown"}`,
          ``,
          `--- SOURCE CODE ---`,
          source,
        ].join("\n");

        const result = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          ctrl.signal,
          8192,
        );

        // Parse JSON from response
        let analysis: Record<string, unknown>;
        try {
          analysis = JSON.parse(extractJson(result.content)) as Record<string, unknown>;
        } catch {
          throw new Error(`JSON parse failed: ${result.content.slice(0, 200)}`);
        }

        // Mark any previous understanding as not current
        await supabase
          .from("audit_block_understanding")
          .update({ is_current: false })
          .eq("block_id", block.id)
          .eq("is_current", true);

        // Enrich called_blocks with kind — deterministic set lookup, no AI needed
        type CalledBlock = { name: string; call_context: string; kind?: string };
        const dataFlow = analysis.data_flow as { called_blocks?: CalledBlock[] } | null ?? {};
        if (dataFlow.called_blocks) {
          for (const cb of dataFlow.called_blocks) {
            cb.kind = projectNames.has(cb.name) ? "project" : "library";
          }
        }

        // Insert new understanding — map new prompt schema to DB columns
        // complexity_rating: not produced by new prompt, pass null (CHECK allows null)
        // has_state_machine: derived from state_machine field
        // fault_handling: new prompt returns string, wrap for jsonb column
        // timing: stored in timing_analysis column
        // members + confidence: folded into interface_contract and code_quality columns
        const stateMachine = analysis.state_machine as object | null ?? null;
        const interfaceContract = {
          ...(analysis.interface_contract as object ?? {}),
          // members for DB/UDT blocks lives alongside inputs/outputs/in_out
        };
        const codeQuality = {
          ...(analysis.code_quality as object ?? {}),
          analysis_confidence: (analysis.analysis_confidence as string) ?? null,
          confidence_notes: (analysis.confidence_notes as string) ?? null,
        };
        const faultHandling =
          typeof analysis.fault_handling === "string"
            ? { description: analysis.fault_handling }
            : (analysis.fault_handling as object) ?? {};

        const { error: insertErr } = await supabase.from("audit_block_understanding").insert({
          block_id: block.id,
          audit_project_id: session.id,
          purpose: (analysis.purpose as string) ?? null,
          category: (analysis.category as string) ?? null,
          complexity_rating: null,
          has_state_machine: stateMachine !== null,
          state_machine: stateMachine,
          data_flow: (dataFlow as object) ?? {},
          timing_analysis: (analysis.timing as object) ?? {},
          fault_handling: faultHandling,
          interface_contract: interfaceContract,
          code_quality: codeQuality,
          detailed_notes: (analysis.detailed_notes as string) ?? null,
          model_used: "claude-sonnet-4-6",
          token_usage: result.usage ?? {},
          is_current: true,
        });
        if (insertErr) throw new Error(insertErr.message);

        // Update block analysis status
        await supabase
          .from("audit_blocks")
          .update({ analysis_status: "understood", analyzed_at: new Date().toISOString() })
          .eq("id", block.id);

        updateBlock(block.id, { status: "done" });
        doneCount++;
      } catch (err) {
        if (ctrl.signal.aborted) {
          setPhase("cancelled");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        await supabase
          .from("audit_blocks")
          .update({ analysis_status: "failed", analysis_error: msg })
          .eq("id", block.id);

        updateBlock(block.id, { status: "failed", error: msg });
        failCount++;
      }
    }

    // Update analysis_progress on session
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
        updates: { current_step: "review" },
      });
      store.setStepStatus("analyze", "completed");
      store.setCurrentStep("review");
      store.setStepStatus("review", "active");
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
              Proceed to Review
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

