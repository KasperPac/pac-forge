import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, Loader2, Brain, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabase";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import type { AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";

interface AuditReviewProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

interface AnalyzedBlock {
  id: string;
  block_id: string;
  name: string;
  block_type: string;
  programming_language: string;
  purpose: string | null;
  category: string | null;
  detailed_notes: string | null;
  analysis_confidence: string | null;
  confidence_notes: string | null;
  has_state_machine: boolean;
  code_quality: { risks?: string[]; deviations_from_conventions?: string[] } | null;
}

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  device_control:   "text-blue-400 border-blue-500/40",
  process_logic:    "text-cyan-400 border-cyan-500/40",
  hmi:              "text-purple-400 border-purple-500/40",
  comms:            "text-orange-400 border-orange-500/40",
  safety:           "text-red-400 border-red-500/40",
  data_management:  "text-zinc-400 border-zinc-500/40",
  utility:          "text-gray-400 border-gray-500/40",
  timing:           "text-amber-400 border-amber-500/40",
  unknown:          "text-muted-foreground border-border/40",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   "text-green-400 border-green-500/40 bg-green-500/5",
  medium: "text-amber-400 border-amber-500/40 bg-amber-500/5",
  low:    "text-red-400 border-red-500/40 bg-red-500/5",
};

const TYPE_COLORS: Record<string, string> = {
  FB: "text-blue-400", FC: "text-cyan-400", OB: "text-amber-400",
  DB: "text-zinc-400", UDT: "text-green-400",
};

// ---------------------------------------------------------------------------
// Block row
// ---------------------------------------------------------------------------

function BlockRow({ block }: { block: AnalyzedBlock }) {
  const [expanded, setExpanded] = useState(false);
  const hasRisks = (block.code_quality?.risks?.length ?? 0) > 0;
  const confidenceKey = block.analysis_confidence ?? "unknown";

  return (
    <div className={cn(
      "rounded-md border transition-colors",
      expanded ? "border-border/60 bg-card/40" : "border-border/30 bg-muted/5 hover:bg-muted/10"
    )}>
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2.5 px-3 py-2 text-left"
      >
        {expanded
          ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        }
        <span className={cn("w-7 shrink-0 font-mono text-[10px] font-semibold", TYPE_COLORS[block.block_type] ?? "text-muted-foreground")}>
          {block.block_type}
        </span>
        <span className="w-40 shrink-0 truncate font-mono text-xs font-medium">
          {block.name}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {block.purpose ?? <span className="italic">no purpose</span>}
        </span>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {block.has_state_machine && (
            <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 text-purple-400 border-purple-500/40">
              FSM
            </Badge>
          )}
          {hasRisks && (
            <AlertTriangle className="h-3 w-3 text-amber-400" />
          )}
          {block.category && (
            <Badge variant="outline" className={cn("font-mono text-[9px] px-1.5 py-0", CATEGORY_COLORS[block.category] ?? CATEGORY_COLORS.unknown)}>
              {block.category.replace("_", " ")}
            </Badge>
          )}
          {block.analysis_confidence && (
            <Badge variant="outline" className={cn("font-mono text-[9px] px-1.5 py-0", CONFIDENCE_COLORS[confidenceKey] ?? "")}>
              {block.analysis_confidence}
            </Badge>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/30 px-4 py-2.5 space-y-2">
          {block.detailed_notes && (
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              {block.detailed_notes}
            </p>
          )}
          {block.confidence_notes && (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 font-mono text-[10px] text-amber-300">
              {block.confidence_notes}
            </div>
          )}
          {hasRisks && (
            <div className="space-y-0.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400/70">Risks</div>
              {block.code_quality!.risks!.map((r, i) => (
                <div key={i} className="font-mono text-[10px] text-amber-300/80">• {r}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuditReview({ session, onSessionUpdate }: AuditReviewProps) {
  const store = useAuditStore();
  const updateProject = useUpdateAuditProject();
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<string | null>(null);

  const { data: understandings, isLoading } = useQuery({
    queryKey: ["audit-understanding", session.id],
    queryFn: async () => {
      // Fetch understandings + join block metadata
      // analysis_confidence + confidence_notes live inside code_quality jsonb, not as top-level columns
      const { data: us, error: uErr } = await supabase
        .from("audit_block_understanding")
        .select("id, block_id, purpose, category, detailed_notes, has_state_machine, code_quality")
        .eq("audit_project_id", session.id)
        .eq("is_current", true);
      if (uErr) throw uErr;

      const blockIds = (us ?? []).map((u) => u.block_id as string);
      if (blockIds.length === 0) return [];

      const { data: blocks, error: bErr } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type, programming_language")
        .in("id", blockIds);
      if (bErr) throw bErr;

      const blockMap = new Map((blocks ?? []).map((b) => [b.id as string, b]));

      return (us ?? []).map((u): AnalyzedBlock => {
        const b = blockMap.get(u.block_id as string);
        return {
          id: u.id as string,
          block_id: u.block_id as string,
          name: (b?.name as string) ?? "unknown",
          block_type: (b?.block_type as string) ?? "?",
          programming_language: (b?.programming_language as string) ?? "?",
          purpose: u.purpose as string | null,
          category: u.category as string | null,
          detailed_notes: u.detailed_notes as string | null,
          analysis_confidence:
            ((u.code_quality as Record<string, unknown> | null)?.analysis_confidence as string | null) ?? null,
          confidence_notes:
            ((u.code_quality as Record<string, unknown> | null)?.confidence_notes as string | null) ?? null,
          has_state_machine: (u.has_state_machine as boolean) ?? false,
          code_quality: u.code_quality as AnalyzedBlock["code_quality"],
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  async function handleProceed() {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "ready" },
      });
      store.setStepStatus("review", "completed");
      store.setCurrentStep("ready");
      store.setStepStatus("ready", "active");
      onSessionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const all = understandings ?? [];

  // Category breakdown
  const categoryCounts = all.reduce<Record<string, number>>((acc, b) => {
    const k = b.category ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  // Confidence breakdown
  const confidenceCounts = all.reduce<Record<string, number>>((acc, b) => {
    const k = b.analysis_confidence ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  const riskyCount = all.filter((b) => (b.code_quality?.risks?.length ?? 0) > 0).length;
  const fsmCount = all.filter((b) => b.has_state_machine).length;

  const filtered = all.filter((b) => {
    if (categoryFilter && (b.category ?? "unknown") !== categoryFilter) return false;
    if (confidenceFilter && (b.analysis_confidence ?? "unknown") !== confidenceFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2">
          <div className="font-mono text-xs text-muted-foreground">Analyzed</div>
          <div className="font-mono text-lg font-semibold">{all.length}</div>
        </div>
        <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2">
          <div className="font-mono text-xs text-muted-foreground">State Machines</div>
          <div className="font-mono text-lg font-semibold text-purple-400">{fsmCount}</div>
        </div>
        <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2">
          <div className="font-mono text-xs text-muted-foreground">Low Confidence</div>
          <div className="font-mono text-lg font-semibold text-amber-400">{confidenceCounts.low ?? 0}</div>
        </div>
        <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2">
          <div className="font-mono text-xs text-muted-foreground">Risks Flagged</div>
          <div className="font-mono text-lg font-semibold text-red-400">{riskyCount}</div>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">Category:</span>
        <button
          onClick={() => setCategoryFilter(null)}
          className={cn("rounded px-2 py-0.5 font-mono text-[10px] transition-colors",
            categoryFilter === null ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          All
        </button>
        {Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
            className={cn(
              "rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
              cat === categoryFilter
                ? "border-current bg-accent/30"
                : "border-transparent hover:border-border/50",
              CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.unknown
            )}
          >
            {cat.replace("_", " ")} {count}
          </button>
        ))}
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">Confidence:</span>
        {(["high", "medium", "low"] as const).map((c) => (
          confidenceCounts[c] ? (
            <button
              key={c}
              onClick={() => setConfidenceFilter(c === confidenceFilter ? null : c)}
              className={cn(
                "rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                c === confidenceFilter ? "border-current bg-accent/30" : "border-transparent hover:border-border/50",
                CONFIDENCE_COLORS[c]
              )}
            >
              {c} {confidenceCounts[c]}
            </button>
          ) : null
        ))}
      </div>

      {/* Block list */}
      <div className="rounded-lg border border-border/70 bg-card/40">
        <div className="border-b border-border/40 px-3 py-1.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            {filtered.length} block{filtered.length !== 1 ? "s" : ""}
            {(categoryFilter || confidenceFilter) ? " (filtered)" : ""}
          </span>
        </div>
        <ScrollArea className="h-[440px]">
          <div className="space-y-0.5 p-2">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Brain className="h-4 w-4" />
                  <span className="font-mono text-sm">No analyzed blocks yet</span>
                </div>
              </div>
            ) : (
              filtered.map((block) => <BlockRow key={block.id} block={block} />)
            )}
          </div>
        </ScrollArea>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void handleProceed()} disabled={all.length === 0} className="gap-2">
          <ArrowRight className="h-3.5 w-3.5" />
          Proceed to Ready
        </Button>
      </div>
    </div>
  );
}
