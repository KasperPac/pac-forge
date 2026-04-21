import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckSquare, Square, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabase";
import { useUpdateAuditProject } from "@/hooks/use-audit-session";
import { useAuditStore } from "@/stores/audit-store";
import type { AuditProject, AuditBlock, AuditFolder, AuditBlockTreeNode } from "@/types/audit";
import { cn } from "@/lib/utils";

interface AuditSelectProps {
  session: AuditProject;
  onSessionUpdate: () => void;
}

const LANG_COLORS: Record<string, string> = {
  SCL: "text-blue-400 border-blue-500/40",
  LAD: "text-amber-400 border-amber-500/40",
  FBD: "text-purple-400 border-purple-500/40",
  STL: "text-orange-400 border-orange-500/40",
  GRAPH: "text-cyan-400 border-cyan-500/40",
  DB: "text-zinc-400 border-zinc-500/40",
  UDT: "text-green-400 border-green-500/40",
};

const TYPE_COLORS: Record<string, string> = {
  FB: "text-blue-400",
  FC: "text-cyan-400",
  OB: "text-amber-400",
  DB: "text-zinc-400",
  UDT: "text-green-400",
  SFB: "text-purple-400",
  SFC: "text-purple-400",
};

export function AuditSelect({ session, onSessionUpdate }: AuditSelectProps) {
  const store = useAuditStore();
  const updateProject = useUpdateAuditProject();
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["root"]));

  const { data: blocks, isLoading: blocksLoading } = useQuery({
    queryKey: ["audit-blocks", session.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_blocks")
        .select("id, name, block_type, programming_language, line_count, analysis_status, folder_id")
        .eq("audit_project_id", session.id)
        .order("name");
      if (error) throw error;
      return data as Pick<
        AuditBlock,
        "id" | "name" | "block_type" | "programming_language" | "line_count" | "analysis_status" | "folder_id"
      >[];
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["audit-folders", session.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_folders")
        .select("id, name, path, depth, parent_folder_id, folder_type")
        .eq("audit_project_id", session.id)
        .order("path");
      if (error) throw error;
      return data as Pick<
        AuditFolder,
        "id" | "name" | "path" | "depth" | "parent_folder_id" | "folder_type"
      >[];
    },
  });

  // Build tree from flat folders + blocks
  const tree = useMemo(() => {
    if (!blocks || !folders) return [];
    return buildTree(folders, blocks);
  }, [blocks, folders]);

  // Sync selection to current blocks — reset whenever the DB blocks change
  useEffect(() => {
    if (!blocks) return;
    const currentIds = new Set(blocks.map((b) => b.id));
    const storeIds = store.selectedBlockIds;
    const hasStale = [...storeIds].some((id) => !currentIds.has(id));
    if (storeIds.size === 0 || hasStale) {
      store.selectAllBlocks(blocks.map((b) => b.id));
    }
  }, [blocks]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCount = store.selectedBlockIds.size;
  const totalCount = blocks?.length ?? 0;
  const allSelected = selectedCount === totalCount && totalCount > 0;

  function toggleAll() {
    if (allSelected) {
      store.deselectAllBlocks();
    } else if (blocks) {
      store.selectAllBlocks(blocks.map((b) => b.id));
    }
  }

  function toggleFolder(folderPath: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }

  function selectFolderBlocks(node: AuditBlockTreeNode, select: boolean) {
    const ids = collectBlockIds(node);
    if (select) {
      const all = new Set(store.selectedBlockIds);
      for (const id of ids) all.add(id);
      store.selectAllBlocks([...all]);
    } else {
      const all = new Set(store.selectedBlockIds);
      for (const id of ids) all.delete(id);
      store.selectAllBlocks([...all]);
    }
  }

  async function handleProceed() {
    try {
      await updateProject.mutateAsync({
        id: session.id,
        updates: { current_step: "analyze" },
      });
      store.setStepStatus("select", "completed");
      store.setCurrentStep("analyze");
      store.setStepStatus("analyze", "active");
      onSessionUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (blocksLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Select blocks for analysis
          </span>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {selectedCount} of {totalCount} blocks selected
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={toggleAll} className="gap-1.5 font-mono text-xs">
          {allSelected ? (
            <CheckSquare className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
          {allSelected ? "Deselect All" : "Select All"}
        </Button>
      </div>

      {/* Tree */}
      <div className="rounded-lg border border-border/70 bg-card/60">
        <ScrollArea className="h-[400px]">
          <div className="p-2 space-y-0.5">
            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedIds={store.selectedBlockIds}
                expandedFolders={expandedFolders}
                onToggleBlock={(id) => store.toggleBlockSelection(id)}
                onToggleFolder={toggleFolder}
                onSelectFolder={selectFolderBlocks}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleProceed} disabled={selectedCount === 0} className="gap-2">
          <ArrowRight className="h-3.5 w-3.5" />
          Analyze {selectedCount} Block{selectedCount !== 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree node component
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  depth,
  selectedIds,
  expandedFolders,
  onToggleBlock,
  onToggleFolder,
  onSelectFolder,
}: {
  node: AuditBlockTreeNode;
  depth: number;
  selectedIds: Set<string>;
  expandedFolders: Set<string>;
  onToggleBlock: (id: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectFolder: (node: AuditBlockTreeNode, select: boolean) => void;
}) {
  if (node.type === "block") {
    const isSelected = selectedIds.has(node.id);
    return (
      <div
        className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleBlock(node.id)}
          className="h-3.5 w-3.5"
        />
        <span className={cn("font-mono text-[10px] font-medium", TYPE_COLORS[node.blockType ?? ""] ?? "text-muted-foreground")}>
          {node.blockType}
        </span>
        <span className="flex-1 font-mono text-xs">{node.name}</span>
        {node.language && (
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[9px] px-1.5 py-0",
              LANG_COLORS[node.language] ?? ""
            )}
          >
            {node.language}
          </Badge>
        )}
        {node.lineCount != null && (
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {node.lineCount}L
          </span>
        )}
      </div>
    );
  }

  // Folder
  const isExpanded = expandedFolders.has(node.id);
  const childBlockIds = collectBlockIds(node);
  const selectedChildCount = childBlockIds.filter((id) => selectedIds.has(id)).length;
  const allChildrenSelected = selectedChildCount === childBlockIds.length && childBlockIds.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/30 cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onToggleFolder(node.id)}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            isExpanded && "rotate-90"
          )}
        />
        <Checkbox
          checked={allChildrenSelected}
          onCheckedChange={(checked) => {
            onSelectFolder(node, !!checked);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5"
        />
        <span className="flex-1 font-mono text-xs font-medium">{node.name}</span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {selectedChildCount}/{childBlockIds.length}
        </span>
      </div>
      {isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              expandedFolders={expandedFolders}
              onToggleBlock={onToggleBlock}
              onToggleFolder={onToggleFolder}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectBlockIds(node: AuditBlockTreeNode): string[] {
  if (node.type === "block") return [node.id];
  return node.children.flatMap(collectBlockIds);
}

function buildTree(
  folders: Pick<AuditFolder, "id" | "name" | "path" | "depth" | "parent_folder_id" | "folder_type">[],
  blocks: Pick<AuditBlock, "id" | "name" | "block_type" | "programming_language" | "line_count" | "analysis_status" | "folder_id">[]
): AuditBlockTreeNode[] {
  // Create folder nodes indexed by DB id
  const folderNodes = new Map<string, AuditBlockTreeNode>();
  const rootNodes: AuditBlockTreeNode[] = [];

  for (const f of folders) {
    const node: AuditBlockTreeNode = {
      id: f.id,
      name: f.name,
      type: "folder",
      children: [],
    };
    folderNodes.set(f.id, node);
  }

  // Build parent-child relationships
  for (const f of folders) {
    const node = folderNodes.get(f.id)!;
    if (f.parent_folder_id && folderNodes.has(f.parent_folder_id)) {
      folderNodes.get(f.parent_folder_id)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Attach blocks to their folders (or root if no folder)
  for (const b of blocks) {
    const blockNode: AuditBlockTreeNode = {
      id: b.id,
      name: b.name,
      type: "block",
      blockType: b.block_type as AuditBlockTreeNode["blockType"],
      language: b.programming_language as AuditBlockTreeNode["language"],
      analysisStatus: b.analysis_status as AuditBlockTreeNode["analysisStatus"],
      lineCount: b.line_count ?? undefined,
      children: [],
    };

    if (b.folder_id && folderNodes.has(b.folder_id)) {
      folderNodes.get(b.folder_id)!.children.push(blockNode);
    } else {
      rootNodes.push(blockNode);
    }
  }

  return rootNodes;
}
