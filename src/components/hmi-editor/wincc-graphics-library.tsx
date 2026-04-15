import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import JSZip from "jszip";
import {
  Loader2,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ScanSearch,
  CheckCircle2,
  Image,
  X,
  Upload,
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import type { HmiGraphic } from "@/types/hmi-screen";

interface IndexEntry {
  name: string;
  path: string;
  category: string;
  size: number;
}

interface CategoryNode {
  name: string;
  path: string;
  children: CategoryNode[];
  entries: IndexEntry[];
}

interface WinccGraphicsLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddGraphic: (graphic: HmiGraphic) => void;
  onAddAll: (graphics: HmiGraphic[]) => void;
  scanGraphic: (name: string, dataUri: string) => Promise<Partial<HmiGraphic>>;
}

/** Deduplicate entries by name+category, preferring PNG > SVG > others */
function deduplicateEntries(entries: IndexEntry[]): IndexEntry[] {
  const FORMAT_PRIORITY: Record<string, number> = { ".png": 0, ".svg": 1, ".jpg": 2, ".jpeg": 2, ".gif": 3, ".bmp": 4 };
  const map = new Map<string, IndexEntry>();
  for (const entry of entries) {
    const ext = "." + entry.path.split(".").pop()?.toLowerCase();
    const key = `${entry.category}/${entry.name}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
    } else {
      const existingExt = "." + existing.path.split(".").pop()?.toLowerCase();
      if ((FORMAT_PRIORITY[ext] ?? 99) < (FORMAT_PRIORITY[existingExt] ?? 99)) {
        map.set(key, entry);
      }
    }
  }
  return Array.from(map.values());
}

/** Build a category tree from flat index entries */
function buildTree(entries: IndexEntry[]): CategoryNode {
  const root: CategoryNode = { name: "All", path: "", children: [], entries: [] };
  for (const entry of entries) {
    const cats = entry.category.split("/").map((s) => s.trim()).filter(Boolean);
    let node = root;
    let currentPath = "";
    for (const cat of cats) {
      currentPath = currentPath ? `${currentPath}/${cat}` : cat;
      let child = node.children.find((c) => c.name === cat);
      if (!child) {
        child = { name: cat, path: currentPath, children: [], entries: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.entries.push(entry);
  }
  const sortNode = (node: CategoryNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.entries.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function totalCount(node: CategoryNode): number {
  return node.entries.length + node.children.reduce((s, c) => s + totalCount(c), 0);
}

/** Get image URL from bridge */
function graphicUrl(path: string): string {
  return `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/wincc-graphic?path=${encodeURIComponent(path)}`;
}

/** Fetch a graphic as base64 data URI */
async function fetchGraphicAsDataUri(path: string): Promise<string> {
  const res = await fetch(graphicUrl(path), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function WinccGraphicsLibrary({
  open,
  onOpenChange,
  onAddGraphic,
  onAddAll,
  scanGraphic,
}: WinccGraphicsLibraryProps) {
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<CategoryNode | null>(null);
  const [allEntries, setAllEntries] = useState<IndexEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<IndexEntry | null>(null);
  const [selectedDataUri, setSelectedDataUri] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<Partial<HmiGraphic> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set());
  // "bridge" = images served from bridge, "local" = images loaded from zip into memory
  const [mode, setMode] = useState<"bridge" | "local" | null>(null);
  const [localGraphics, setLocalGraphics] = useState<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Try loading index from bridge when dialog opens
  useEffect(() => {
    if (!open || tree) return;

    (async () => {
      setLoading(true);
      setError(null);
      setLoadProgress("Connecting to bridge...");
      try {
        const res = await fetch(
          `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/wincc-graphics-index`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        const entries: IndexEntry[] = deduplicateEntries(data.entries);
        setAllEntries(entries);
        const builtTree = buildTree(entries);
        setTree(builtTree);
        setMode("bridge");
        setExpandedPaths(new Set(builtTree.children.map((c) => c.path)));
      } catch {
        // Bridge unavailable — show upload option (not an error)
        setError(null);
      } finally {
        setLoading(false);
        setLoadProgress("");
      }
    })();
  }, [open, tree]);

  /** Load graphics from a zip file uploaded by the user */
  const handleLoadZip = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);

    try {
      setLoadProgress("Reading zip file...");
      const zip = await JSZip.loadAsync(file);
      const imageExts = new Set([".png", ".svg", ".jpg", ".jpeg", ".gif", ".bmp"]);

      const fileNames = Object.keys(zip.files).filter((name) => {
        const ext = "." + name.split(".").pop()?.toLowerCase();
        return imageExts.has(ext) && !zip.files[name].dir;
      });

      setLoadProgress(`Processing ${fileNames.length} graphics...`);
      const entries: IndexEntry[] = [];
      const dataUris = new Map<string, string>();

      const BATCH = 50;
      for (let i = 0; i < fileNames.length; i += BATCH) {
        const batch = fileNames.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (path) => {
            try {
              const data = await zip.files[path].async("base64");
              const ext = path.split(".").pop()?.toLowerCase();
              const mime =
                ext === "svg" ? "image/svg+xml" :
                ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
                ext === "gif" ? "image/gif" :
                ext === "bmp" ? "image/bmp" :
                "image/png";

              const parts = path.split("/");
              const name = parts[parts.length - 1].replace(/\.[^.]+$/, "");
              const category = parts.slice(0, -1)
                .map((p) => p.replace(/\s*\[(EMF|SVG|PNG|WMF)\]\s*/gi, "").trim())
                .filter(Boolean)
                .join("/");

              const dataUri = `data:${mime};base64,${data}`;
              entries.push({ name, path, category, size: data.length });
              dataUris.set(path, dataUri);
            } catch { /* skip */ }
          }),
        );
        setLoadProgress(`Processed ${Math.min(i + BATCH, fileNames.length)} / ${fileNames.length}...`);
      }

      setLocalGraphics(dataUris);
      const dedupedEntries = deduplicateEntries(entries);
      setAllEntries(dedupedEntries);
      const builtTree = buildTree(dedupedEntries);
      setTree(builtTree);
      setMode("local");
      setExpandedPaths(new Set(builtTree.children.map((c) => c.path)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read zip file");
    } finally {
      setLoading(false);
      setLoadProgress("");
    }
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // When selecting a graphic, fetch or lookup its image data
  const handleSelect = useCallback(async (entry: IndexEntry) => {
    setSelectedEntry(entry);
    setScanResult(null);
    setSelectedDataUri(null);

    if (mode === "local") {
      setSelectedDataUri(localGraphics.get(entry.path) ?? null);
    } else {
      try {
        const dataUri = await fetchGraphicAsDataUri(entry.path);
        setSelectedDataUri(dataUri);
      } catch (err) {
        console.error("Failed to load graphic:", err);
      }
    }
  }, [mode, localGraphics]);

  const handleScan = useCallback(async () => {
    if (!selectedEntry || !selectedDataUri) return;
    setScanning(true);
    setScanResult(null);
    const result = await scanGraphic(selectedEntry.name, selectedDataUri);
    setScanResult(result);
    setScanning(false);
  }, [selectedEntry, selectedDataUri, scanGraphic]);

  const handleAddToLibrary = useCallback(() => {
    if (!selectedEntry || !selectedDataUri) return;
    const graphic: HmiGraphic = {
      name: selectedEntry.name,
      url: selectedDataUri,
      category: selectedEntry.category,
      description: scanResult?.description,
      tags: scanResult?.tags,
      visual: scanResult?.visual,
    };
    onAddGraphic(graphic);
    setAddedPaths((prev) => new Set(prev).add(selectedEntry.path));
  }, [selectedEntry, selectedDataUri, scanResult, onAddGraphic]);

  /** Bulk-add all loaded graphics to the editor library */
  const handleAddAll = useCallback(() => {
    if (mode !== "local" || localGraphics.size === 0) return;
    const all: HmiGraphic[] = [];
    for (const entry of allEntries) {
      const url = localGraphics.get(entry.path);
      if (url) {
        all.push({ name: entry.name, url, category: entry.category });
      }
    }
    onAddAll(all);
    setAddedPaths(new Set(allEntries.map((e) => e.path)));
  }, [mode, localGraphics, allEntries, onAddAll]);

  /** Get image src for a graphic path — local data URI or bridge URL */
  const imgSrc = useCallback(
    (path: string) =>
      mode === "local" ? (localGraphics.get(path) ?? "") : graphicUrl(path),
    [mode, localGraphics],
  );

  // Filter entries by search query
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return allEntries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q),
    ).slice(0, 100);
  }, [searchQuery, allEntries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            WinCC Graphics Library
          </DialogTitle>
          <DialogDescription>
            Browse standard Siemens WinCC graphics. AI-scan on demand for visual analysis.
          </DialogDescription>
          {tree && mode === "local" && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={handleAddAll}
                disabled={addedPaths.size === allEntries.length}
              >
                <Image className="h-3.5 w-3.5" />
                {addedPaths.size === allEntries.length
                  ? `All ${allEntries.length} Added`
                  : `Add All ${allEntries.length} to Library`}
              </Button>
              {addedPaths.size > 0 && addedPaths.size < allEntries.length && (
                <span className="text-[10px] text-muted-foreground">
                  {addedPaths.size} / {allEntries.length} added
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{loadProgress || "Loading..."}</span>
          </div>
        ) : !tree ? (
          // No tree loaded — show upload option
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
            <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-12 text-center">
              <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/30" />
              <p className="mt-3 text-sm font-medium">Load WinCC Graphics Archive</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Select Graphics_All.zip from your TIA Portal installation
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                Typical path: C:\Program Files\Siemens\Automation\Portal V20\lib\Graphics
              </p>
              <Button
                className="mt-4 gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Select ZIP File
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLoadZip(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <TooltipProvider>
            <div className="flex flex-1 min-h-0">
              {/* Left: Category tree + search */}
              <div className="flex w-72 shrink-0 flex-col border-r">
                <div className="border-b px-3 py-2">
                  <Input
                    placeholder="Search graphics..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {allEntries.length} graphics in {tree.children.length} categories
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  {searchQuery.trim() ? (
                    <div className="p-2">
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground">
                        {filteredEntries?.length ?? 0} results
                      </div>
                      {filteredEntries?.map((e) => (
                        <button
                          key={e.path}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent/50 ${
                            selectedEntry?.path === e.path ? "bg-accent" : ""
                          }`}
                          onClick={() => handleSelect(e)}
                        >
                          <img
                            src={imgSrc(e.path)}
                            alt={e.name}
                            className="h-6 w-6 shrink-0 rounded border border-border bg-white object-contain"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{e.name}</div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              {e.category}
                            </div>
                          </div>
                          {addedPaths.has(e.path) && (
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-1">
                      {tree.children.map((node) => (
                        <CategoryTreeNode
                          key={node.path}
                          node={node}
                          expandedPaths={expandedPaths}
                          selectedPath={selectedEntry?.path}
                          addedPaths={addedPaths}
                          onToggle={toggleExpand}
                          onSelect={handleSelect}
                          imgSrc={imgSrc}
                          depth={0}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {/* Right: Detail or grid */}
              <div className="flex flex-1 flex-col min-w-0">
                {selectedEntry ? (
                  <>
                    <div className="flex items-center gap-2 border-b px-4 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => {
                          setSelectedEntry(null);
                          setSelectedDataUri(null);
                          setScanResult(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                        Back
                      </Button>
                      <Separator orientation="vertical" className="h-4" />
                      <span className="truncate font-mono text-xs">
                        {selectedEntry.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {selectedEntry.category}
                      </span>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-6">
                        {/* Preview */}
                        <div className="mx-auto flex max-w-md items-center justify-center rounded-lg border border-border bg-white p-8">
                          {selectedDataUri ? (
                            <img
                              src={selectedDataUri}
                              alt={selectedEntry.name}
                              className="max-h-48 max-w-full object-contain"
                            />
                          ) : (
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          )}
                        </div>

                        {/* Actions */}
                        <div className="mt-4 flex items-center justify-center gap-2">
                          <Button
                            variant="outline"
                            className="gap-2"
                            onClick={handleScan}
                            disabled={scanning || !selectedDataUri}
                          >
                            {scanning ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ScanSearch className="h-4 w-4" />
                            )}
                            {scanResult ? "Re-scan" : "AI Scan"}
                          </Button>
                          <Button
                            className="gap-2"
                            onClick={handleAddToLibrary}
                            disabled={!selectedDataUri || addedPaths.has(selectedEntry.path)}
                          >
                            {addedPaths.has(selectedEntry.path) ? (
                              <>
                                <CheckCircle2 className="h-4 w-4" />
                                Added
                              </>
                            ) : (
                              <>
                                <Image className="h-4 w-4" />
                                Add to Library
                              </>
                            )}
                          </Button>
                        </div>

                        {/* Scan results */}
                        {scanning && (
                          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Analyzing graphic...
                          </div>
                        )}

                        {scanResult && (
                          <div className="mt-4 space-y-3 rounded-lg border bg-card p-4">
                            {scanResult.description && (
                              <div>
                                <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                  Description
                                </div>
                                <div className="mt-0.5 text-sm">
                                  {scanResult.description}
                                </div>
                              </div>
                            )}
                            {scanResult.tags && scanResult.tags.length > 0 && (
                              <div>
                                <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                  Tags
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {scanResult.tags.map((tag) => (
                                    <Badge key={tag} variant="secondary" className="text-xs">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {scanResult.visual && (
                              <div className="grid grid-cols-2 gap-3">
                                <VisualProp label="Shape" value={scanResult.visual.shape} />
                                <VisualProp label="Orientation" value={scanResult.visual.orientation} />
                                <VisualProp label="Background" value={scanResult.visual.background} />
                                <VisualProp label="Style" value={scanResult.visual.style} />
                                <VisualProp label="Use" value={scanResult.visual.suggestedUse} />
                                <VisualProp label="Size" value={scanResult.visual.suggestedSize} />
                                {scanResult.visual.dominantColors && (
                                  <div>
                                    <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                      Colors
                                    </div>
                                    <div className="mt-1 flex gap-1">
                                      {scanResult.visual.dominantColors.map((c) => (
                                        <Tooltip key={c}>
                                          <TooltipTrigger>
                                            <div
                                              className="h-5 w-5 rounded border border-border"
                                              style={{ backgroundColor: c }}
                                            />
                                          </TooltipTrigger>
                                          <TooltipContent>{c}</TooltipContent>
                                        </Tooltip>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {scanResult.visual.pairsWith && (
                                  <div>
                                    <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                      Pairs With
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {scanResult.visual.pairsWith.map((p) => (
                                        <Badge key={p} variant="outline" className="text-[10px]">
                                          {p}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {scanResult.visual.placementHint && (
                                  <div className="col-span-2">
                                    <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                      Placement
                                    </div>
                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                      {scanResult.visual.placementHint}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {!scanResult && !scanning && (
                          <div className="mt-4 rounded-lg border border-dashed bg-muted/20 p-4 text-center">
                            <p className="text-xs text-muted-foreground">
                              Click <strong>AI Scan</strong> to analyze visual properties,
                              colors, style, and generate placement hints.
                            </p>
                            <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                              {selectedEntry.name.replace(/[_-]/g, " ")} ({selectedEntry.category})
                            </p>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </>
                ) : (
                  <GraphicGrid
                    tree={tree}
                    expandedPaths={expandedPaths}
                    addedPaths={addedPaths}
                    onSelect={handleSelect}
                    imgSrc={imgSrc}
                  />
                )}
              </div>
            </div>
          </TooltipProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryTreeNode({
  node,
  expandedPaths,
  selectedPath,
  addedPaths,
  onToggle,
  onSelect,
  imgSrc,
  depth,
}: {
  node: CategoryNode;
  expandedPaths: Set<string>;
  selectedPath?: string;
  addedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (e: IndexEntry) => void;
  imgSrc: (path: string) => string;
  depth: number;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const count = totalCount(node);

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onToggle(node.path)}
      >
        {node.children.length > 0 ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <div className="w-3" />
        )}
        <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </button>

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              addedPaths={addedPaths}
              onToggle={onToggle}
              onSelect={onSelect}
              imgSrc={imgSrc}
              depth={depth + 1}
            />
          ))}
          {node.entries.length > 0 && (
            <div
              className="flex flex-wrap gap-1 px-1 py-1"
              style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
            >
              {node.entries.slice(0, 8).map((e) => (
                <button
                  key={e.path}
                  className={`relative rounded border bg-white p-0.5 hover:ring-1 hover:ring-primary ${
                    selectedPath === e.path ? "ring-2 ring-primary" : "border-border"
                  }`}
                  onClick={() => onSelect(e)}
                  title={e.name}
                >
                  <img
                    src={imgSrc(e.path)}
                    alt={e.name}
                    className="h-7 w-7 object-contain"
                    loading="lazy"
                  />
                  {addedPaths.has(e.path) && (
                    <CheckCircle2 className="absolute -right-1 -top-1 h-3 w-3 text-green-500" />
                  )}
                </button>
              ))}
              {node.entries.length > 8 && (
                <div className="flex h-8 items-center px-1 text-[10px] text-muted-foreground">
                  +{node.entries.length - 8} more
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GraphicGrid({
  tree,
  expandedPaths,
  addedPaths,
  onSelect,
  imgSrc,
}: {
  tree: CategoryNode;
  expandedPaths: Set<string>;
  addedPaths: Set<string>;
  onSelect: (e: IndexEntry) => void;
  imgSrc: (path: string) => string;
}) {
  const entries = useMemo(() => {
    const result: IndexEntry[] = [];
    const collect = (node: CategoryNode) => {
      if (expandedPaths.has(node.path)) {
        result.push(...node.entries);
        node.children.forEach(collect);
      }
    };
    tree.children.forEach(collect);
    return result.slice(0, 200);
  }, [tree, expandedPaths]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Expand a category to browse graphics
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2 p-4">
        {entries.map((e) => (
          <button
            key={e.path}
            className="group relative flex flex-col items-center gap-1 rounded-lg border border-border p-2 hover:bg-accent/30 hover:ring-1 hover:ring-primary"
            onClick={() => onSelect(e)}
          >
            <div className="flex h-12 w-12 items-center justify-center">
              <img
                src={imgSrc(e.path)}
                alt={e.name}
                className="max-h-12 max-w-12 object-contain"
                loading="lazy"
              />
            </div>
            <span className="w-full truncate text-center text-[10px] text-muted-foreground">
              {e.name}
            </span>
            {addedPaths.has(e.path) && (
              <CheckCircle2 className="absolute right-1 top-1 h-3 w-3 text-green-500" />
            )}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

function VisualProp({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <Badge variant="outline" className="mt-0.5 text-xs">
        {value}
      </Badge>
    </div>
  );
}
