import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, Loader2, Brain } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuditStore } from "@/stores/audit-store";
import { cn } from "@/lib/utils";
import type { AuditBlock, AuditFolder } from "@/types/audit";

interface BlockTreeProps {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const BLOCK_TYPE_COLORS: Record<string, string> = {
  FB:  "text-blue-400",
  FC:  "text-cyan-400",
  OB:  "text-amber-400",
  DB:  "text-zinc-400",
  UDT: "text-green-400",
};

const CATEGORY_DOT: Record<string, string> = {
  device_control:  "bg-blue-400",
  process_logic:   "bg-cyan-400",
  hmi:             "bg-purple-400",
  comms:           "bg-orange-400",
  safety:          "bg-red-400",
  data_management: "bg-zinc-400",
  utility:         "bg-gray-400",
  timing:          "bg-amber-400",
};

const CONFIDENCE_DOT: Record<string, string> = {
  high:   "bg-green-400",
  medium: "bg-amber-400",
  low:    "bg-red-400",
};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface BlockWithUnderstanding extends AuditBlock {
  understanding?: {
    category: string | null;
    analysis_confidence: string | null;
    purpose: string | null;
    has_state_machine: boolean;
  } | null;
}

interface FolderNode {
  folder: AuditFolder;
  children: FolderNode[];
  blocks: BlockWithUnderstanding[];
}

// ---------------------------------------------------------------------------
// Build tree
// ---------------------------------------------------------------------------

function buildFolderTree(
  folders: AuditFolder[],
  blocks: BlockWithUnderstanding[]
): { roots: FolderNode[]; orphans: BlockWithUnderstanding[] } {
  const folderMap = new Map<string, FolderNode>();
  for (const f of folders) {
    folderMap.set(f.id, { folder: f, children: [], blocks: [] });
  }

  const roots: FolderNode[] = [];
  for (const f of folders) {
    const node = folderMap.get(f.id)!;
    if (f.parent_folder_id && folderMap.has(f.parent_folder_id)) {
      folderMap.get(f.parent_folder_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const orphans: BlockWithUnderstanding[] = [];
  for (const b of blocks) {
    if (b.folder_id && folderMap.has(b.folder_id)) {
      folderMap.get(b.folder_id)!.blocks.push(b);
    } else {
      orphans.push(b);
    }
  }

  return { roots, orphans };
}

// ---------------------------------------------------------------------------
// Block row
// ---------------------------------------------------------------------------

function BlockRow({ block, active }: { block: BlockWithUnderstanding; active: boolean }) {
  const store = useAuditStore();
  const u = block.understanding;
  const catDot = u?.category ? (CATEGORY_DOT[u.category] ?? "bg-muted-foreground") : null;
  const confDot = u?.analysis_confidence ? (CONFIDENCE_DOT[u.analysis_confidence] ?? null) : null;

  return (
    <button
      type="button"
      onClick={() => store.openBlock(block.id)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors",
        active
          ? "bg-accent/50 text-foreground"
          : "text-muted-foreground hover:bg-accent/20 hover:text-foreground"
      )}
    >
      <span className={cn("w-6 shrink-0 font-mono text-[10px] font-semibold", BLOCK_TYPE_COLORS[block.block_type] ?? "text-muted-foreground")}>
        {block.block_type}
      </span>
      <span className="flex-1 truncate font-mono text-[11px]">{block.name}</span>
      <div className="flex shrink-0 items-center gap-1">
        {confDot && <span className={cn("h-1.5 w-1.5 rounded-full", confDot)} />}
        {catDot && <span className={cn("h-1.5 w-1.5 rounded-full", catDot)} />}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Folder node
// ---------------------------------------------------------------------------

function FolderNodeRow({
  node,
  activeBlockId,
  searchQuery,
}: {
  node: FolderNode;
  activeBlockId: string | null;
  searchQuery: string;
}) {
  const [open, setOpen] = useState(true);

  // Filter blocks by search
  const visibleBlocks = searchQuery
    ? node.blocks.filter((b) => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : node.blocks;

  // Recursively check if any children match
  const hasVisibleContent =
    !searchQuery ||
    visibleBlocks.length > 0 ||
    node.children.some((c) => hasMatchInSubtree(c, searchQuery));

  if (!hasVisibleContent) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left hover:bg-accent/20"
      >
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        }
        <span className="font-mono text-[10px] text-muted-foreground/80 truncate">{node.folder.name}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/30 pl-1.5">
          {node.children.map((child) => (
            <FolderNodeRow
              key={child.folder.id}
              node={child}
              activeBlockId={activeBlockId}
              searchQuery={searchQuery}
            />
          ))}
          {visibleBlocks.map((b) => (
            <BlockRow key={b.id} block={b} active={b.id === activeBlockId} />
          ))}
        </div>
      )}
    </div>
  );
}

function hasMatchInSubtree(node: FolderNode, query: string): boolean {
  if (node.blocks.some((b) => b.name.toLowerCase().includes(query.toLowerCase()))) return true;
  return node.children.some((c) => hasMatchInSubtree(c, query));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function BlockTree({ sessionId }: BlockTreeProps) {
  const store = useAuditStore();
  const { activeBlockId, blockSearchQuery: searchQuery, setBlockSearchQuery } = store;

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-blocks", sessionId],
    queryFn: async () => {
      const [blocksRes, foldersRes, understRes] = await Promise.all([
        supabase
          .from("audit_blocks")
          .select("id, name, block_type, programming_language, folder_id, line_count, analysis_status")
          .eq("audit_project_id", sessionId),
        supabase
          .from("audit_folders")
          .select("id, name, parent_folder_id, depth, path, folder_type")
          .eq("audit_project_id", sessionId),
        supabase
          .from("audit_block_understanding")
          .select("block_id, category, code_quality, has_state_machine, purpose")
          .eq("audit_project_id", sessionId)
          .eq("is_current", true),
      ]);

      const understandingMap = new Map(
        (understRes.data ?? []).map((u) => [
          u.block_id as string,
          {
            category: u.category as string | null,
            analysis_confidence: ((u.code_quality as Record<string, unknown> | null)?.analysis_confidence as string | null),
            purpose: u.purpose as string | null,
            has_state_machine: (u.has_state_machine as boolean) ?? false,
          },
        ])
      );

      const blocks: BlockWithUnderstanding[] = (blocksRes.data ?? []).map((b) => ({
        ...(b as unknown as AuditBlock),
        understanding: understandingMap.get(b.id as string) ?? null,
      }));

      return {
        blocks,
        folders: (foldersRes.data ?? []) as unknown as AuditFolder[],
      };
    },
    staleTime: 30_000,
  });

  const { roots, orphans } = useMemo(() => {
    if (!data) return { roots: [], orphans: [] };
    return buildFolderTree(data.folders, data.blocks);
  }, [data]);

  const filteredOrphans = useMemo(() => {
    if (!searchQuery) return orphans;
    return orphans.filter((b) => b.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [orphans, searchQuery]);

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b border-border/40 p-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/10 px-2 py-1">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setBlockSearchQuery(e.target.value)}
            placeholder="Search blocks…"
            className="flex-1 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {roots.map((node) => (
              <FolderNodeRow
                key={node.folder.id}
                node={node}
                activeBlockId={activeBlockId}
                searchQuery={searchQuery}
              />
            ))}
            {filteredOrphans.map((b) => (
              <BlockRow key={b.id} block={b} active={b.id === activeBlockId} />
            ))}
            {roots.length === 0 && orphans.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Brain className="h-6 w-6 text-muted-foreground/40" />
                <span className="font-mono text-xs text-muted-foreground">No blocks found</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer legend */}
      <div className="border-t border-border/40 px-2 py-1.5">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <LegendDot color="bg-green-400" label="high" />
          <LegendDot color="bg-amber-400" label="med" />
          <LegendDot color="bg-red-400" label="low" />
          <span className="mx-1 text-border/60">·</span>
          <LegendDot color="bg-blue-400" label="ctrl" />
          <LegendDot color="bg-cyan-400" label="logic" />
          <LegendDot color="bg-red-400" label="safety" />
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-0.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      <span className="font-mono text-[9px] text-muted-foreground/60">{label}</span>
    </div>
  );
}
