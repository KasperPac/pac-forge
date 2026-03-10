import { useState, useCallback } from "react";
import {
  Loader2,
  Library,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileBox,
  Save,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { parseLibraryTypeXml, renderThumbnail } from "@/lib/hmi-xml-parser";
import type {
  LibraryContentsResponse,
  LibraryExportResponse,
  LibraryItemInfo,
} from "@/lib/tia-bridge-contract";

/** A cataloged library item for AI prompt injection */
export interface HmiLibraryCatalogItem {
  name: string;
  path: string;
  kind: string;
  category: "type" | "master_copy";
  description?: string;
  /** Base64 PNG thumbnail rendered from exported XML */
  thumbnail?: string;
}

export interface HmiLibraryCatalog {
  libraryName: string;
  libraryPath: string;
  items: HmiLibraryCatalogItem[];
}

interface TiaLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveCatalog: (catalog: HmiLibraryCatalog) => void;
  currentCatalog?: HmiLibraryCatalog | null;
}

export function TiaLibraryDialog({
  open,
  onOpenChange,
  onSaveCatalog,
  currentCatalog,
}: TiaLibraryDialogProps) {
  const [libraryPath, setLibraryPath] = useState(currentCatalog?.libraryPath ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contents, setContents] = useState<LibraryContentsResponse | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);

  const callBridge = async <T,>(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> => {
    const res = await fetch(
      `${DEFAULT_BRIDGE_CONFIG.baseUrl}${endpoint}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "{}",
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };

  const handleOpenLibrary = useCallback(async () => {
    if (!libraryPath.trim()) return;
    setLoading(true);
    setError(null);
    setContents(null);
    setSaved(false);

    try {
      // Ensure TIA Portal is connected first
      const statusRes = await fetch(`${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (statusRes.ok) {
        const status = await statusRes.json();
        if (!status.connected) {
          const connectResult = await callBridge<{ success: boolean; message?: string }>("/tia/connect", { mode: "attach" });
          if (!connectResult.success) throw new Error(connectResult.message ?? "Failed to connect to TIA Portal");
        }
      } else {
        throw new Error("Bridge is not running. Start it with: dotnet run --project bridge/PacForgeBridge");
      }

      const result = await callBridge<LibraryContentsResponse>("/tia/library/open", {
        library_path: libraryPath.trim(),
      });
      if (!result.success) throw new Error(result.message);
      setContents(result);
      // Auto-expand top-level sections
      setExpandedFolders(new Set(["library_types", "master_copies"]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open library");
    } finally {
      setLoading(false);
    }
  }, [libraryPath]);

  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [thumbProgress, setThumbProgress] = useState("");

  const handleSaveCatalog = useCallback(async () => {
    if (!contents) return;

    const items: HmiLibraryCatalogItem[] = [
      ...contents.types.map((t) => ({
        name: t.name,
        path: t.path,
        kind: t.kind,
        category: "type" as const,
        description: t.description,
      })),
      ...contents.master_copies.map((m) => ({
        name: m.name,
        path: m.path,
        kind: m.kind,
        category: "master_copy" as const,
        description: m.description,
      })),
    ];

    // Save catalog immediately (without thumbnails)
    const catalog: HmiLibraryCatalog = {
      libraryName: contents.library_name,
      libraryPath: contents.library_path,
      items,
    };
    onSaveCatalog(catalog);
    setSaved(true);

    // Generate thumbnails in background by exporting type XML
    const typePaths = items.filter((i) => i.category === "type").map((i) => i.path);
    if (typePaths.length === 0) return;

    setGeneratingThumbs(true);
    setThumbProgress(`Exporting ${typePaths.length} types...`);

    try {
      const exportResult = await callBridge<LibraryExportResponse>("/tia/library/export", {
        library_path: contents.library_path,
        item_paths: typePaths,
      });

      if (exportResult.success && exportResult.items) {
        let count = 0;
        for (const item of items) {
          const xml = exportResult.items[item.path];
          if (!xml) continue;

          try {
            const spec = parseLibraryTypeXml(xml);
            if (spec && spec.elements.length > 0) {
              item.thumbnail = renderThumbnail(spec, 160, 100);
              count++;
            }
          } catch (err) {
            console.warn(`[TIA] Failed to render thumbnail for ${item.path}:`, err);
          }
        }

        setThumbProgress(`Generated ${count} preview(s)`);

        // Update catalog with thumbnails
        if (count > 0) {
          onSaveCatalog({ ...catalog, items: [...items] });
        }
      }
    } catch (err) {
      console.warn("[TIA] Thumbnail generation failed:", err);
      setThumbProgress("Preview generation failed");
    } finally {
      setGeneratingThumbs(false);
    }
  }, [contents, onSaveCatalog]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setError(null);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="h-5 w-5" />
            HMI Component Library
          </DialogTitle>
          <DialogDescription>
            Load a TIA Portal library (.al18) to catalog available HMI templates, faceplates, and controls for AI-assisted screen design
          </DialogDescription>
        </DialogHeader>

        {/* Current catalog badge */}
        {currentCatalog && !contents && (
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <Check className="h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{currentCatalog.libraryName}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {currentCatalog.items.length} component(s) cataloged — AI will reference these when designing screens
              </div>
            </div>
          </div>
        )}

        {/* Library path input */}
        {!contents && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {currentCatalog
                ? "Load a different library, or close to keep the current one."
                : "Enter the path to a TIA Portal library file (.al18) to catalog its components."}
            </div>
            <Input
              placeholder="C:\path\to\library.al18"
              value={libraryPath}
              onChange={(e) => setLibraryPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpenLibrary()}
              className="font-mono text-xs"
              autoFocus
              disabled={loading}
            />
            <Button
              onClick={handleOpenLibrary}
              disabled={!libraryPath.trim() || loading}
              className="w-full gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
              {loading ? "Connecting & Loading..." : "Load Library"}
            </Button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Library contents */}
        {contents && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{contents.library_name}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {contents.types.length} type(s), {contents.master_copies.length} master copy/copies
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setContents(null);
                  setSaved(false);
                }}
              >
                Change Library
              </Button>
            </div>

            <Separator />

            <ScrollArea className="h-[350px]">
              <div className="space-y-1 pr-3">
                {contents.types.length > 0 && (
                  <ItemSection
                    title="Library Types"
                    sectionKey="library_types"
                    subtitle="Reusable screen templates, faceplates, and controls"
                    items={contents.types}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                  />
                )}
                {contents.master_copies.length > 0 && (
                  <ItemSection
                    title="Master Copies"
                    sectionKey="master_copies"
                    subtitle="Pre-built screen objects and configurations"
                    items={contents.master_copies}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                  />
                )}
              </div>
            </ScrollArea>

            <Separator />

            {/* Save catalog action */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {generatingThumbs
                  ? thumbProgress
                  : saved
                    ? "Catalog saved — the AI will use these components when designing screens"
                    : "Save this catalog so the AI knows what components are available"}
              </div>
              <Button
                onClick={handleSaveCatalog}
                disabled={saved || generatingThumbs}
                size="sm"
                className="gap-1.5"
              >
                {generatingThumbs ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {generatingThumbs ? "Generating Previews..." : saved ? "Catalog Saved" : "Save & Generate Previews"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemSection({
  title,
  sectionKey,
  subtitle,
  items,
  expandedFolders,
  onToggleFolder,
}: {
  title: string;
  sectionKey: string;
  subtitle: string;
  items: LibraryItemInfo[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(sectionKey);
  const tree = buildTree(items);

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent/30"
        onClick={() => onToggleFolder(sectionKey)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
          <span className="ml-2 text-[10px] text-muted-foreground/60">{subtitle}</span>
        </div>
        <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
          {items.length}
        </Badge>
      </button>

      {isExpanded && (
        <div className="ml-2 border-l border-border/50 pl-2">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeNodeData {
  name: string;
  path: string;
  item?: LibraryItemInfo;
  children: TreeNodeData[];
}

function buildTree(items: LibraryItemInfo[]): TreeNodeData[] {
  const root: TreeNodeData[] = [];

  for (const item of items) {
    const parts = item.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");
      let existing = current.find((n) => n.path === partPath);

      if (!existing) {
        existing = {
          name: parts[i],
          path: partPath,
          item: isLeaf ? item : undefined,
          children: [],
        };
        current.push(existing);
      } else if (isLeaf) {
        existing.item = item;
      }

      current = existing.children;
    }
  }

  return root;
}

function TreeNode({
  node,
  expandedFolders,
  onToggleFolder,
}: {
  node: TreeNodeData;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  const isFolder = node.children.length > 0 && !node.item;
  const isExpanded = expandedFolders.has(node.path);

  if (isFolder) {
    return (
      <div>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent/30"
          onClick={() => onToggleFolder(node.path)}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <FolderOpen className="h-3 w-3 shrink-0 text-yellow-500/70" />
          <span className="truncate font-mono">{node.name}</span>
          <span className="ml-auto text-[9px] text-muted-foreground">
            {countLeaves(node)}
          </span>
        </button>
        {isExpanded && (
          <div className="ml-2 border-l border-border/30 pl-2">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Leaf item — read-only display
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs">
      <FileBox className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
      {node.item && (
        <Badge variant="outline" className="shrink-0 px-1 py-0 font-mono text-[8px]">
          {node.item.kind}
        </Badge>
      )}
      {node.item?.description && (
        <span className="shrink-0 truncate text-[9px] text-muted-foreground max-w-[180px]">
          {node.item.description}
        </span>
      )}
    </div>
  );
}

function countLeaves(node: TreeNodeData): number {
  if (node.item && node.children.length === 0) return 1;
  return (node.item ? 1 : 0) + node.children.reduce((s, c) => s + countLeaves(c), 0);
}
