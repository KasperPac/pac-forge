import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import {
  useAuditClassifications,
  useOverrideClassificationRole,
  useUpdateAuditClassification,
} from "@/hooks/use-audit-classifications";
import { useRunAuditClassify } from "@/hooks/use-audit-classify-run";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import {
  FB_ROLES,
  type AuditBlockUnderstanding,
  type AuditFbClassification,
  type AuditProject,
  type FbRole,
} from "@/types/audit";
import { cn } from "@/lib/utils";

interface AuditClassifyProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

type FilterMode = "analyzed" | "all" | "unresolved" | "overridden";

const ROLE_COLORS: Record<FbRole, string> = {
  device:     "text-blue-400 border-blue-500/40",
  io_mapper:  "text-sky-400 border-sky-500/40",
  dispatcher: "text-teal-400 border-teal-500/40",
  assembly:   "text-cyan-400 border-cyan-500/40",
  subsystem:  "text-violet-400 border-violet-500/40",
  sequence:   "text-emerald-400 border-emerald-500/40",
  utility:    "text-gray-400 border-gray-500/40",
  safety:     "text-red-400 border-red-500/40",
  comms:      "text-orange-400 border-orange-500/40",
  fault:      "text-rose-400 border-rose-500/40",
  logic:      "text-indigo-400 border-indigo-500/40",
  ob:         "text-amber-400 border-amber-500/40",
  unknown:    "text-muted-foreground border-border/50",
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  FB: "text-blue-400",
  FC: "text-cyan-400",
  OB: "text-amber-400",
};

// ---------------------------------------------------------------------------
// Supplementary queries — join tables for the review panel
// ---------------------------------------------------------------------------

interface ClassifyRowExtras {
  name: string;
  block_type: string;
  programming_language: string;
  folder_path: string | null;
  source_code: string | null;
  /** True when the block has a current entry in audit_block_understanding
   *  — used by the "analyzed only" filter (default ON for targeted audits). */
  analyzed: boolean;
}

interface ClassifyRow extends AuditFbClassification, ClassifyRowExtras {}

function useClassifyRows(auditProjectId: string) {
  const { data: classifications, isLoading: loadingClass } =
    useAuditClassifications(auditProjectId);

  const { data: blocks, isLoading: loadingBlocks } = useQuery({
    queryKey: ["audit_blocks_for_classify", auditProjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type, programming_language, source_code, folder_id, analysis_status")
        .eq("audit_project_id", auditProjectId)
        .in("block_type", ["OB", "FB", "FC"]);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        block_type: string;
        programming_language: string;
        source_code: string | null;
        folder_id: string | null;
        analysis_status: string;
      }>;
    },
  });

  const { data: folders, isLoading: loadingFolders } = useQuery({
    queryKey: ["audit_folders_for_classify", auditProjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_folders")
        .select("id, path")
        .eq("audit_project_id", auditProjectId);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; path: string }>;
    },
  });

  const rows: ClassifyRow[] = useMemo(() => {
    if (!classifications || !blocks) return [];
    const blockById = new Map(blocks.map((b) => [b.id, b]));
    const folderPathById = new Map((folders ?? []).map((f) => [f.id, f.path]));
    return classifications
      .map((c) => {
        const b = blockById.get(c.block_id);
        if (!b) return null;
        return {
          ...c,
          name: b.name,
          block_type: b.block_type,
          programming_language: b.programming_language,
          source_code: b.source_code,
          folder_path: b.folder_id ? folderPathById.get(b.folder_id) ?? null : null,
          analyzed: b.analysis_status === "understood",
        } as ClassifyRow;
      })
      .filter((r): r is ClassifyRow => r !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [classifications, blocks, folders]);

  return {
    rows,
    isLoading: loadingClass || loadingBlocks || loadingFolders,
  };
}

// ---------------------------------------------------------------------------
// Inspector drawer
// ---------------------------------------------------------------------------

function ClassifyInspector({
  row,
  open,
  onOpenChange,
  onOverride,
}: {
  row: ClassifyRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOverride: (role: FbRole) => void;
}) {
  const { data: understanding } = useQuery({
    queryKey: ["audit_block_understanding_for_classify", row?.block_id ?? "none"],
    queryFn: async (): Promise<AuditBlockUnderstanding | null> => {
      if (!row) return null;
      const { data, error } = await supabase
        .from("audit_block_understanding")
        .select("*")
        .eq("block_id", row.block_id)
        .eq("is_current", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AuditBlockUnderstanding | null;
    },
    enabled: !!row,
  });

  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono">
            <span className={cn("text-xs", BLOCK_TYPE_COLORS[row.block_type] ?? "text-muted-foreground")}>
              {row.block_type}
            </span>
            <span className="truncate">{row.name}</span>
          </SheetTitle>
          <SheetDescription className="font-mono text-[10px]">
            {row.folder_path ?? "(root)"} · {row.programming_language}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Current classification */}
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Classification
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("font-mono text-[10px]", ROLE_COLORS[row.role])}>
                {row.role}
              </Badge>
              {row.engineer_override_role && (
                <Badge variant="outline" className="font-mono text-[10px] text-blue-400 border-blue-500/40">
                  engineer override
                </Badge>
              )}
              {row.engineer_confirmed && (
                <Badge variant="outline" className="font-mono text-[10px] text-green-400 border-green-500/40">
                  confirmed
                </Badge>
              )}
            </div>
            {row.auto_reason && (
              <p className="mt-2 font-mono text-[11px] leading-5 text-muted-foreground">
                {row.auto_reason}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Override role
              </span>
              <Select
                value={row.role}
                onValueChange={(v: FbRole) => onOverride(v)}
              >
                <SelectTrigger className="h-7 w-[170px] font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FB_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="font-mono text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Understanding — purpose + detailed notes */}
          {understanding && (
            <div className="rounded-md border border-border/60 bg-muted/10 p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Block Understanding
              </div>
              {understanding.purpose && (
                <div className="mb-2">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground/60">Purpose</div>
                  <p className="font-mono text-[11px] leading-5">{understanding.purpose}</p>
                </div>
              )}
              {understanding.category && (
                <div className="mb-2">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground/60">Category</div>
                  <p className="font-mono text-[11px]">{understanding.category}</p>
                </div>
              )}
              {understanding.detailed_notes && (
                <div className="mb-2">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground/60">Notes</div>
                  <p className="font-mono text-[11px] leading-5">{understanding.detailed_notes}</p>
                </div>
              )}
              {understanding.state_machine && (
                <div className="mb-2">
                  <div className="font-mono text-[9px] uppercase text-muted-foreground/60">State Machine</div>
                  <p className="font-mono text-[11px]">
                    {understanding.state_machine.mechanism}
                    {understanding.state_machine.state_variable
                      ? ` on ${understanding.state_machine.state_variable}`
                      : ""}
                    {understanding.state_machine.states.length > 0 &&
                      ` · ${understanding.state_machine.states.length} states`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Source */}
          {row.source_code && (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Source ({row.source_code.length} chars)
              </div>
              <ScrollArea className="h-[340px] rounded-md border border-border/60 bg-black/30">
                <pre className="p-3 font-mono text-[10px] leading-4 text-foreground/90">
                  {row.source_code.slice(0, 20000)}
                  {row.source_code.length > 20000 && "\n\n[truncated]"}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AuditClassify({ session, onSessionUpdate }: AuditClassifyProps) {
  const store = useAuditStore();
  const queryClient = useQueryClient();
  const updateProject = useUpdateAuditProject();
  const { rows, isLoading } = useClassifyRows(session.id);
  const runClassify = useRunAuditClassify();
  const overrideRole = useOverrideClassificationRole();
  const updateClassification = useUpdateAuditClassification();

  // Default filter: "analyzed" for targeted audits (only show what the
  // user explicitly asked about), "all" for full audits.
  const [filter, setFilter] = useState<FilterMode>(
    session.audit_type === "targeted" ? "analyzed" : "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorRow, setInspectorRow] = useState<ClassifyRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef(false);

  // Auto-run on first open if no classifications exist.
  useEffect(() => {
    if (autoRanRef.current) return;
    if (isLoading) return;
    autoRanRef.current = true;
    if (rows.length > 0) return;
    runClassify.mutate(session.id, {
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  }, [isLoading, rows.length, runClassify, session.id]);

  const filteredRows = useMemo(() => {
    if (filter === "analyzed") return rows.filter((r) => r.analyzed);
    if (filter === "unresolved") return rows.filter((r) => r.role === "unknown");
    if (filter === "overridden") return rows.filter((r) => r.engineer_override_role !== null);
    return rows;
  }, [rows, filter]);

  const analyzedCount = useMemo(() => rows.filter((r) => r.analyzed).length, [rows]);

  const counts = useMemo(() => {
    const c = {} as Record<FbRole, number>;
    for (const role of FB_ROLES) c[role] = 0;
    for (const r of rows) c[r.role] += 1;
    return c;
  }, [rows]);

  const confirmedCount = rows.filter((r) => r.engineer_confirmed).length;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of filteredRows) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of filteredRows) next.add(r.id);
        return next;
      });
    }
  };

  const bulkConfirm = async () => {
    const targets = rows.filter((r) => selectedIds.has(r.id) && !r.engineer_confirmed);
    for (const r of targets) {
      try {
        await updateClassification.mutateAsync({
          id: r.id,
          updates: { engineer_confirmed: true },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ["audit_fb_classifications", session.id] });
  };

  const handleOverride = async (row: ClassifyRow, role: FbRole) => {
    try {
      await overrideRole.mutateAsync({ id: row.id, role });
      await queryClient.invalidateQueries({ queryKey: ["audit_fb_classifications", session.id] });
      // Reflect new role in the open inspector without reopening.
      setInspectorRow((cur) => (cur && cur.id === row.id ? { ...cur, role, engineer_override_role: role, engineer_confirmed: true } : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleProceed = async () => {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "review" },
      });
      store.setStepStatus("classify", "completed");
      store.setCurrentStep("review");
      store.setStepStatus("review", "active");
      onSessionUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isBusy = runClassify.isPending || isLoading;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      {/* Header card — role counts + run action */}
      <div className="rounded-lg border border-border/70 bg-card/60 p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Classify
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {confirmedCount}/{rows.length} confirmed
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={runClassify.isPending}
              onClick={() =>
                runClassify.mutate(session.id, {
                  onError: (e) =>
                    setError(e instanceof Error ? e.message : String(e)),
                })
              }
              className="gap-2"
            >
              {runClassify.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              {rows.length === 0 ? "Run Classification" : "Re-run"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 md:grid-cols-7">
          {FB_ROLES.map((role) => {
            const n = counts[role];
            return (
              <button
                key={role}
                type="button"
                onClick={() => {
                  if (role === "unknown") setFilter("unresolved");
                }}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-left transition-colors",
                  n > 0
                    ? "border-border/50 bg-muted/10 hover:bg-muted/20"
                    : "border-border/20 bg-muted/5 opacity-50",
                  role === "unknown" && n > 0 && "border-amber-500/40 bg-amber-500/5",
                )}
              >
                <div className={cn("font-mono text-[9px] uppercase tracking-wider", ROLE_COLORS[role])}>
                  {role}
                </div>
                <div className="font-mono text-sm text-foreground">{n}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border/60 bg-card/60 p-0.5">
          {(["analyzed", "all", "unresolved", "overridden"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilter(mode)}
              className={cn(
                "rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                filter === mode
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode}
              {mode === "analyzed" && (
                <span className="ml-1 text-muted-foreground/70">({analyzedCount})</span>
              )}
              {mode === "unresolved" && counts.unknown > 0 && (
                <span className="ml-1 text-amber-400">({counts.unknown})</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {selectedIds.size > 0 && (
          <>
            <span className="font-mono text-[10px] text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              onClick={() => void bulkConfirm()}
              disabled={updateClassification.isPending}
              className="gap-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirm selected
            </Button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border/70 bg-card/60">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/70 bg-card/80 px-3 py-2 backdrop-blur">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={toggleAll}
            aria-label="Select all filtered"
          />
          <div className="grid flex-1 grid-cols-[8ch_1fr_1.2fr_160px_1fr_90px] gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Type</span>
            <span>Block</span>
            <span>Folder</span>
            <span>Role</span>
            <span>Reason</span>
            <span className="text-right">Status</span>
          </div>
        </div>
        <ScrollArea className="h-[460px]">
          {isBusy && rows.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isBusy && filteredRows.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <CircleDot className="h-5 w-5 text-muted-foreground/60" />
              <p className="font-mono text-xs text-muted-foreground">
                {rows.length === 0 ? "No classifications yet. Run the engine." : "No rows match this filter."}
              </p>
            </div>
          )}
          <div>
            {filteredRows.map((row) => {
              const checked = selectedIds.has(row.id);
              return (
                <div
                  key={row.id}
                  className={cn(
                    "group flex items-center gap-2 border-b border-border/30 px-3 py-1.5 transition-colors hover:bg-muted/20",
                    checked && "bg-muted/10",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleSelected(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => setInspectorRow(row)}
                    className="grid flex-1 grid-cols-[8ch_1fr_1.2fr_160px_1fr_90px] items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "font-mono text-[10px] font-medium",
                        BLOCK_TYPE_COLORS[row.block_type] ?? "text-muted-foreground",
                      )}
                    >
                      {row.block_type}
                    </span>
                    <span className="truncate font-mono text-xs">{row.name}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {row.folder_path ?? "(root)"}
                    </span>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={row.role}
                        onValueChange={(v: FbRole) => void handleOverride(row, v)}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-6 w-[150px] font-mono text-[10px]",
                            ROLE_COLORS[row.role],
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FB_ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="font-mono text-xs">
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <span
                      className="truncate font-mono text-[10px] text-muted-foreground/80"
                      title={row.auto_reason ?? ""}
                    >
                      {row.auto_reason ?? ""}
                    </span>
                    <div className="flex items-center justify-end gap-1.5">
                      {row.engineer_override_role && (
                        <Badge variant="outline" className="h-5 font-mono text-[9px] text-blue-400 border-blue-500/40">
                          override
                        </Badge>
                      )}
                      {row.engineer_confirmed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                      ) : (
                        <CircleDot className="h-3.5 w-3.5 text-muted-foreground/40" />
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          onClick={() => void handleProceed()}
          disabled={rows.length === 0 || runClassify.isPending}
          className="gap-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Proceed to Review
        </Button>
      </div>

      <ClassifyInspector
        row={inspectorRow}
        open={!!inspectorRow}
        onOpenChange={(open) => !open && setInspectorRow(null)}
        onOverride={(role) => inspectorRow && void handleOverride(inspectorRow, role)}
      />
    </div>
  );
}
