import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Brain, AlertTriangle, CheckCircle2, Cpu, Tag, Database, FolderTree, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import type { AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface AuditReadyProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  device_control:  "text-blue-400 border-blue-500/40 bg-blue-500/5",
  process_logic:   "text-cyan-400 border-cyan-500/40 bg-cyan-500/5",
  hmi:             "text-purple-400 border-purple-500/40 bg-purple-500/5",
  comms:           "text-orange-400 border-orange-500/40 bg-orange-500/5",
  safety:          "text-red-400 border-red-500/40 bg-red-500/5",
  data_management: "text-zinc-400 border-zinc-500/40 bg-zinc-500/5",
  utility:         "text-gray-400 border-gray-500/40 bg-gray-500/5",
  timing:          "text-amber-400 border-amber-500/40 bg-amber-500/5",
  unknown:         "text-muted-foreground border-border/40 bg-muted/5",
};

export function AuditReady({ session, onSessionUpdate }: AuditReadyProps) {
  const navigate = useNavigate();
  const store = useAuditStore();
  const updateProject = useUpdateAuditProject();
  const [error, setError] = useState<string | null>(null);

  // Fetch summary stats
  const { data: stats, isLoading } = useQuery({
    queryKey: ["audit-ready-stats", session.id],
    queryFn: async () => {
      const [understRes, blockRes, tagRes, hwRes] = await Promise.all([
        supabase
          .from("audit_block_understanding")
          .select("id, category, has_state_machine, code_quality")
          .eq("audit_project_id", session.id)
          .eq("is_current", true),
        supabase
          .from("audit_blocks")
          .select("id, block_type, programming_language")
          .eq("audit_project_id", session.id),
        supabase
          .from("audit_tag_tables")
          .select("id, tag_count")
          .eq("audit_project_id", session.id),
        supabase
          .from("audit_hardware_config")
          .select("id, devices")
          .eq("audit_project_id", session.id)
          .maybeSingle(),
      ]);

      const understandings = understRes.data ?? [];
      const blocks = blockRes.data ?? [];
      const tagTables = tagRes.data ?? [];
      const hw = hwRes.data;

      const categoryCounts = understandings.reduce<Record<string, number>>((acc, u) => {
        const k = (u.category as string | null) ?? "unknown";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});

      const riskyCount = understandings.filter((u) => {
        const cq = u.code_quality as { risks?: string[] } | null;
        return (cq?.risks?.length ?? 0) > 0;
      }).length;

      const fsmCount = understandings.filter((u) => u.has_state_machine).length;
      const analyzedCount = understandings.length;
      const totalBlocks = blocks.length;

      const blockTypeCounts = blocks.reduce<Record<string, number>>((acc, b) => {
        const k = (b.block_type as string) ?? "?";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});

      const languageCounts = blocks.reduce<Record<string, number>>((acc, b) => {
        const k = (b.programming_language as string) ?? "?";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});

      const totalTags = tagTables.reduce((sum, t) => sum + ((t.tag_count as number) ?? 0), 0);
      const deviceCount = (hw?.devices as unknown[])?.length ?? 0;

      return {
        analyzedCount,
        totalBlocks,
        fsmCount,
        riskyCount,
        categoryCounts,
        blockTypeCounts,
        languageCounts,
        totalTags,
        deviceCount,
        tagTableCount: tagTables.length,
      };
    },
  });

  async function handleEnterWorkspace() {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "ready" },
      });
      store.setStepStatus("ready", "completed");
      onSessionUpdate();
      navigate(`/pac-audit/${session.id}/workspace`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* Header */}
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="font-mono text-sm text-green-400">Analysis complete — ready to enter workspace</span>
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {s.analyzedCount} of {s.totalBlocks} blocks analyzed. Open the workspace to inspect, modify, and test.
        </p>
      </div>

      {/* Summary stats grid */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={<Database className="h-4 w-4 text-blue-400" />} label="Blocks" value={s.totalBlocks} />
        <StatCard icon={<Brain className="h-4 w-4 text-cyan-400" />} label="Analyzed" value={s.analyzedCount} accent="text-cyan-400" />
        <StatCard icon={<Tag className="h-4 w-4 text-muted-foreground" />} label="Tags" value={s.totalTags} />
        <StatCard icon={<Cpu className="h-4 w-4 text-muted-foreground" />} label="HW Devices" value={s.deviceCount} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Block breakdown */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Block Types</span>
          </div>
          <div className="space-y-1">
            {Object.entries(s.blockTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="w-8 font-mono text-[11px] text-blue-400">{type}</span>
                <div className="flex-1 rounded-sm bg-muted/20">
                  <div
                    className="h-1.5 rounded-sm bg-blue-500/40"
                    style={{ width: `${Math.round((count / s.totalBlocks) * 100)}%` }}
                  />
                </div>
                <span className="w-6 text-right font-mono text-[10px] text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-border/30 pt-2 space-y-1">
            {Object.entries(s.languageCounts).sort((a, b) => b[1] - a[1]).map(([lang, count]) => (
              <div key={lang} className="flex items-center gap-2">
                <span className="w-10 font-mono text-[10px] text-muted-foreground">{lang}</span>
                <span className="font-mono text-[10px] text-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category breakdown */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Categories</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(s.categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
              <Badge
                key={cat}
                variant="outline"
                className={cn("font-mono text-[9px] px-1.5 py-0", CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.unknown)}
              >
                {cat.replace(/_/g, " ")} {count}
              </Badge>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 border-t border-border/30 pt-2">
            {s.fsmCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-purple-400">State machines detected</span>
                <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 text-purple-400 border-purple-500/40">{s.fsmCount}</Badge>
              </div>
            )}
            {s.riskyCount > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                <span className="font-mono text-[10px] text-amber-300">
                  {s.riskyCount} block{s.riskyCount !== 1 ? "s" : ""} with flagged risks
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void handleEnterWorkspace()} className="gap-2">
          <ArrowRight className="h-3.5 w-3.5" />
          Enter Workspace
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-card/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="font-mono text-xs">{label}</span>
      </div>
      <div className={cn("font-mono text-lg font-semibold mt-0.5", accent ?? "text-foreground")}>{value}</div>
    </div>
  );
}
