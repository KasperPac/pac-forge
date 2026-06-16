import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Database, Cpu, Tag, Monitor, FolderTree, Network, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getBridgeConfigForVersion } from "@/lib/tia-bridge-contract";
import type { ExtractProjectResponse } from "@/lib/tia-bridge-contract";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import { supabase } from "@/lib/supabase";
import type { AuditProject } from "@/types/audit";
import { cn } from "@/lib/utils";

interface AuditExtractProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

interface CategoryStatus {
  label: string;
  icon: typeof Database;
  status: "pending" | "extracting" | "done" | "error";
  count?: number;
}

export function AuditExtract({ session, onSessionUpdate }: AuditExtractProps) {
  const store = useAuditStore();
  const queryClient = useQueryClient();
  const updateProject = useUpdateAuditProject();
  const bridgeCfg = getBridgeConfigForVersion(session.tia_version);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Live bridge log via WebSocket
  useEffect(() => {
    const ws = new WebSocket(bridgeCfg.wsUrl);
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string; message?: string };
        if (msg.type === "bridge_log" && msg.message) {
          setLogs((prev) => [...prev.slice(-199), msg.message!]);
        }
      } catch { /* ignore malformed */ }
    };
    return () => ws.close();
  }, [bridgeCfg.wsUrl]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extractResult, setExtractResult] = useState<ExtractProjectResponse | null>(null);

  const [categories, setCategories] = useState<CategoryStatus[]>([
    { label: "Folder Structure", icon: FolderTree, status: "pending" },
    { label: "Program Blocks", icon: Database, status: "pending" },
    { label: "UDTs", icon: Database, status: "pending" },
    { label: "Tag Tables", icon: Tag, status: "pending" },
    { label: "Hardware Config", icon: Cpu, status: "pending" },
    { label: "Module Channels", icon: Radio, status: "pending" },
    { label: "Cross-References", icon: Network, status: "pending" },
    { label: "HMI Screens", icon: Monitor, status: "pending" },
  ]);

  function updateCategory(label: string, update: Partial<CategoryStatus>) {
    setCategories((prev) =>
      prev.map((c) => (c.label === label ? { ...c, ...update } : c))
    );
  }

  const extractMutation = useMutation({
    mutationFn: async (): Promise<ExtractProjectResponse> => {
      // Animate categories as "extracting"
      for (const cat of categories) {
        updateCategory(cat.label, { status: "extracting" });
      }

      const res = await fetch(`${bridgeCfg.baseUrl}/tia/extract-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(300000), // 5 min timeout for large projects
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: "Extraction failed" }))) as {
          message?: string;
        };
        throw new Error(err.message ?? "Extraction failed");
      }

      return (await res.json()) as ExtractProjectResponse;
    },
    onSuccess: async (data) => {
      setExtractResult(data);
      setWarnings(data.warnings ?? []);

      // Update category statuses
      const blockCount = data.blocks?.length ?? 0;
      const udtCount = data.blocks?.filter((b) => b.block_type === "UDT").length ?? 0;
      const programBlockCount = blockCount - udtCount;
      const tagTableCount = data.tag_tables?.length ?? 0;
      const folderCount = data.folders?.length ?? 0;

      const moduleChannelCount = data.module_channels?.length ?? 0;
      const hmiScreenCount = data.hmi_targets?.reduce((sum, h) => sum + h.screen_count, 0) ?? 0;
      const crossRefInputCount = data.cross_references?.length ?? 0;

      updateCategory("Folder Structure", { status: "done", count: folderCount });
      updateCategory("Program Blocks", { status: "done", count: programBlockCount });
      updateCategory("UDTs", { status: "done", count: udtCount });
      updateCategory("Tag Tables", { status: "done", count: tagTableCount });
      updateCategory("Hardware Config", {
        status: "done",
        count: data.hardware?.control_modules?.length ?? 0,
      });
      updateCategory("Module Channels", { status: "done", count: moduleChannelCount });
      updateCategory("Cross-References", { status: "done", count: crossRefInputCount });
      updateCategory("HMI Screens", { status: "done", count: hmiScreenCount });

      // Persist extracted data to Supabase
      try {
        const persistStats = await persistExtraction(session.id, data);
        // Reflect actual persisted cross-ref count (may be < input when some sources don't resolve)
        updateCategory("Cross-References", {
          status: "done",
          count: persistStats.crossRefCount,
        });
        // Invalidate select-step queries so they refetch fresh data
        await queryClient.invalidateQueries({ queryKey: ["audit-blocks", session.id] });
        await queryClient.invalidateQueries({ queryKey: ["audit-folders", session.id] });
        await queryClient.invalidateQueries({ queryKey: ["audit_cross_references", session.id] });
        await updateProject.mutateAsync({
          id: session.id,
          updates: {
            extraction_status: "extracted",
            extracted_at: new Date().toISOString(),
            extraction_stats: {
              block_count: blockCount,
              udt_count: udtCount,
              tag_count: data.tag_tables?.reduce((sum, t) => sum + t.tags.length, 0) ?? 0,
              hw_control_module_count: data.hardware?.control_modules?.length ?? 0,
              hmi_screen_count: hmiScreenCount,
            },
          },
        });
      } catch (err) {
        setError(`Extraction succeeded but failed to save: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : String(err));
      setCategories((prev) => prev.map((c) => ({ ...c, status: "error" as const })));
    },
  });

  async function handleProceed() {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "select" },
      });
      store.setStepStatus("extract", "completed");
      store.setCurrentStep("select");
      store.setStepStatus("select", "active");
      onSessionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const isExtracting = extractMutation.isPending;
  const isDone = !!extractResult;
  const progress = isExtracting ? 50 : isDone ? 100 : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="rounded-lg border border-border/70 bg-card/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Project Extraction
          </span>
          {isDone && (
            <span className="font-mono text-xs text-green-400">
              {extractResult.blocks?.length ?? 0} blocks extracted
            </span>
          )}
        </div>

        {(isExtracting || isDone) && (
          <Progress value={progress} className="mb-4 h-1.5" />
        )}

        <div className="space-y-2">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-2"
            >
              <cat.icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 font-mono text-xs">{cat.label}</span>
              {cat.status === "pending" && (
                <span className="font-mono text-[10px] text-muted-foreground">Waiting</span>
              )}
              {cat.status === "extracting" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
              )}
              {cat.status === "done" && (
                <div className="flex items-center gap-1.5">
                  {cat.count !== undefined && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {cat.count}
                    </span>
                  )}
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                </div>
              )}
              {cat.status === "error" && (
                <AlertCircle className="h-3.5 w-3.5 text-red-400" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Live bridge log */}
      {(logs.length > 0) && (
        <div className="rounded-md border border-border/40 bg-black/30">
          <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Bridge Log</span>
            <button
              onClick={() => setLogs([])}
              className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto p-2">
            {logs.map((line, i) => (
              <div key={i} className={cn(
                "font-mono text-[11px] leading-5",
                line.includes("error") || line.includes("Error") || line.includes("failed") ? "text-red-400" :
                line.includes("warn") || line.includes("Warn") || line.includes("skip") ? "text-amber-400" :
                line.startsWith("[TIA]") ? "text-blue-300" :
                "text-muted-foreground"
              )}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-amber-400">
            Warnings ({warnings.length})
          </div>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {warnings.map((w, i) => (
              <div key={i} className="font-mono text-[10px] text-amber-300/80">
                {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {!isDone && (
          <Button
            onClick={() => extractMutation.mutate()}
            disabled={isExtracting}
            className="gap-2"
          >
            {isExtracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            {isExtracting ? "Extracting..." : "Extract Project"}
          </Button>
        )}
        {isDone && (
          <Button onClick={handleProceed} className="gap-2">
            <ArrowRight className="h-3.5 w-3.5" />
            Proceed to Select
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persist extracted data to Supabase tables
// ---------------------------------------------------------------------------

const KNOWN_BLOCK_TYPES = new Set(["FB", "FC", "OB", "DB", "UDT", "SFB", "SFC"]);
const KNOWN_LANGUAGES = new Set(["SCL", "LAD", "FBD", "STL", "GRAPH", "DB", "UDT"]);

function normalizeBlockType(raw: string): string {
  if (raw === "ArrayDB") return "DB";
  if (!KNOWN_BLOCK_TYPES.has(raw)) {
    console.warn(`[Audit] Unknown block_type from bridge: "${raw}" — storing as-is`);
  }
  return raw;
}

function normalizeLang(raw: string): string {
  // Safety block languages come prefixed with F_ (F_LAD, F_FBD, F_DB)
  const normalized = raw.startsWith("F_") ? raw.slice(2) : raw;
  if (!KNOWN_LANGUAGES.has(normalized)) {
    console.warn(`[Audit] Unknown programming_language from bridge: "${raw}" → "${normalized}" — storing as-is`);
  }
  return normalized;
}

interface PersistStats {
  crossRefCount: number;
  moduleChannelCount: number;
}

const XREF_CHUNK = 500;
const MODULE_CH_CHUNK = 500;

async function persistExtraction(
  auditProjectId: string,
  data: ExtractProjectResponse,
): Promise<PersistStats> {
  // Clear previous extraction data so re-runs don't leave stale rows.
  // Order: children before parents (FK-safe). audit_cross_references has FKs
  // into audit_blocks; audit_module_channels is independent.
  await supabase.from("audit_cross_references").delete().eq("audit_project_id", auditProjectId);
  await supabase.from("audit_module_channels").delete().eq("audit_project_id", auditProjectId);
  await supabase.from("audit_io_link_control_modules").delete().eq("audit_project_id", auditProjectId);

  const { error: delBlocksErr } = await supabase.from("audit_blocks").delete().eq("audit_project_id", auditProjectId);
  if (delBlocksErr) console.error("[Audit] Delete blocks error:", delBlocksErr.message);
  const { error: delFoldersErr } = await supabase.from("audit_folders").delete().eq("audit_project_id", auditProjectId);
  if (delFoldersErr) console.error("[Audit] Delete folders error:", delFoldersErr.message);
  const { error: delTagsErr } = await supabase.from("audit_tag_tables").delete().eq("audit_project_id", auditProjectId);
  if (delTagsErr) console.error("[Audit] Delete tag tables error:", delTagsErr.message);
  const { error: delHwErr } = await supabase.from("audit_hardware_config").delete().eq("audit_project_id", auditProjectId);
  if (delHwErr) console.error("[Audit] Delete hardware error:", delHwErr.message);

  // bridge folder ID → Supabase UUID
  const folderIdMap = new Map<string, string>();

  // 1. Insert folders sorted by depth so parents exist before children
  if (data.folders?.length) {
    const sorted = [...data.folders].sort((a, b) => a.depth - b.depth);

    for (const f of sorted) {
      const { data: inserted, error: folderErr } = await supabase
        .from("audit_folders")
        .insert({
          audit_project_id: auditProjectId,
          name: f.name,
          folder_type: f.folder_type || "program_blocks",
          path: f.path,
          depth: f.depth,
          parent_folder_id: f.parent_id ? (folderIdMap.get(f.parent_id) ?? null) : null,
        })
        .select("id")
        .single();

      if (folderErr) {
        console.error("[Audit] Folder insert error:", folderErr.message);
      } else if (inserted) {
        folderIdMap.set(f.id, inserted.id as string);
      }
    }
  }

  // 2. Insert blocks with remapped folder_id
  if (data.blocks?.length) {
    // Batch in chunks of 50 to avoid payload size limits
    const CHUNK = 50;
    for (let i = 0; i < data.blocks.length; i += CHUNK) {
      const chunk = data.blocks.slice(i, i + CHUNK);
      const blockRows = chunk.map((b) => ({
        audit_project_id: auditProjectId,
        name: b.name,
        block_type: normalizeBlockType(b.block_type),
        block_number: b.block_number,
        programming_language: normalizeLang(b.programming_language),
        source_code: b.source_code,
        source_format: b.source_format || "scl",
        analysis_status: "extracted",
        line_count: b.line_count,
        folder_id: b.folder_id ? (folderIdMap.get(b.folder_id) ?? null) : null,
      }));

      const { error: blockErr } = await supabase.from("audit_blocks").insert(blockRows);
      if (blockErr) console.error("[Audit] Block insert error:", blockErr.message);
    }
  }

  // 3. Insert tag tables
  if (data.tag_tables?.length) {
    const tagRows = data.tag_tables.map((t) => ({
      audit_project_id: auditProjectId,
      name: t.name,
      tags: t.tags,
      tag_count: t.tags.length,
    }));

    const { error: tagErr } = await supabase.from("audit_tag_tables").insert(tagRows);
    if (tagErr) console.error("[Audit] Tag table insert error:", tagErr.message);
  }

  // 4. Insert hardware config — drives[] and hmi_panels[] carry the widened
  //    shapes defined in PAC_AUDIT_DERIVED_SPEC §12.6 (drive_details with
  //    nameplate/ramps/telegrams; hmi_targets with nested screens).
  if (data.hardware) {
    const { error: hwErr } = await supabase.from("audit_hardware_config").insert({
      audit_project_id: auditProjectId,
      control_modules: data.hardware.control_modules ?? [],
      io_modules: data.hardware.io_modules ?? [],
      networks: data.hardware.networks ?? [],
      drives: data.drive_details ?? [],
      hmi_panels: data.hmi_targets ?? [],
      safety_config: {},
    });
    if (hwErr) console.error("[Audit] Hardware config insert error:", hwErr.message);
  }

  // 5. Module channels — batched; one row per physical channel.
  let moduleChannelCount = 0;
  if (data.module_channels?.length) {
    for (let i = 0; i < data.module_channels.length; i += MODULE_CH_CHUNK) {
      const chunk = data.module_channels.slice(i, i + MODULE_CH_CHUNK).map((c) => ({
        audit_project_id: auditProjectId,
        module_name: c.module_name,
        module_mlfb: c.module_mlfb ?? null,
        channel_number: c.channel_number,
        io_address: c.io_address,
        signal_type: c.signal_type,
        symbolic_tag: c.symbolic_tag,
        is_safety: c.is_safety,
        channel_comment: c.channel_comment,
        channel_count_source: c.channel_count_source ?? null,
        rack: c.rack,
        slot: c.slot,
      }));
      const { error } = await supabase.from("audit_module_channels").insert(chunk);
      if (error) console.error("[Audit] Module channel insert error:", error.message);
      else moduleChannelCount += chunk.length;
    }
  }

  // 6. Cross-references — requires name → block-UUID map built from the
  //    blocks we just inserted. Refs whose source doesn't resolve to a known
  //    block are dropped (external references, OB calls to system blocks,
  //    etc.). target_block_id is best-effort — null when the target is a
  //    tag/address/UDT rather than a block.
  let crossRefCount = 0;
  if (data.cross_references?.length) {
    const { data: insertedBlocks, error: selectBlocksErr } = await supabase
      .from("audit_blocks")
      .select("id, name")
      .eq("audit_project_id", auditProjectId);
    if (selectBlocksErr) {
      console.error("[Audit] Block select for xref mapping error:", selectBlocksErr.message);
    }
    const blockIdByName = new Map<string, string>();
    (insertedBlocks ?? []).forEach((b) => {
      blockIdByName.set(b.name as string, b.id as string);
    });
    const resolveBlock = (name: string | null): string | null =>
      name ? (blockIdByName.get(name) ?? null) : null;

    for (let i = 0; i < data.cross_references.length; i += XREF_CHUNK) {
      const chunk = data.cross_references.slice(i, i + XREF_CHUNK);
      const rows = chunk
        .map((xr) => {
          const source_block_id = resolveBlock(xr.source_name);
          if (!source_block_id) return null;
          return {
            audit_project_id: auditProjectId,
            source_block_id,
            target_block_id: resolveBlock(xr.target_name),
            access: xr.access,
            reference_type: xr.reference_type,
            source_name: xr.source_name,
            source_path: xr.source_path,
            source_address: xr.source_address,
            source_type_name: xr.source_type_name,
            source_device: xr.source_device,
            target_name: xr.target_name,
            target_path: xr.target_path,
            target_address: xr.target_address,
            target_type_name: xr.target_type_name,
            target_device: xr.target_device,
            reference_location: xr.reference_location,
            referenced_as_name: xr.referenced_as_name,
            location_address: xr.location_address,
            location_name: xr.location_name,
            location_type_name: xr.location_type_name,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length === 0) continue;
      const { error } = await supabase.from("audit_cross_references").insert(rows);
      if (error) console.error("[Audit] Cross-reference insert error:", error.message);
      else crossRefCount += rows.length;
    }
  }

  // 7. Stale-detection timestamps. See §12.5.
  const { error: projUpdErr } = await supabase
    .from("audit_projects")
    .update({
      tia_project_modified_at: data.last_modified_at ?? null,
      cross_refs_extracted_at: new Date().toISOString(),
    })
    .eq("id", auditProjectId);
  if (projUpdErr) console.error("[Audit] Project timestamp update error:", projUpdErr.message);

  return { crossRefCount, moduleChannelCount };
}
