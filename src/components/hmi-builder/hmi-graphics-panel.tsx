import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { cn } from "@/lib/utils";

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

interface HmiGraphicsPanelProps {
  onAdd: (entry: { name: string; path: string; category: string }) => void;
}

const FORMAT_PRIORITY: Record<string, number> = {
  ".png": 0,
  ".svg": 1,
  ".jpg": 2,
  ".jpeg": 2,
  ".gif": 3,
  ".bmp": 4,
};

function deduplicateEntries(entries: IndexEntry[]): IndexEntry[] {
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

function graphicUrl(path: string): string {
  return `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/wincc-graphic?path=${encodeURIComponent(path)}`;
}

export function HmiGraphicsPanel({ onAdd }: HmiGraphicsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<IndexEntry[]>([]);
  const [tree, setTree] = useState<CategoryNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/wincc-graphics-index`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const deduped = deduplicateEntries(data.entries as IndexEntry[]);
        if (cancelled) return;
        setEntries(deduped);
        const built = buildTree(deduped);
        setTree(built);
        setExpanded(new Set(built.children.map((c) => c.path)));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Bridge unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const visibleEntries = useMemo(() => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return entries
        .filter((e) => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))
        .slice(0, 200);
    }
    if (activeCategory) {
      return entries.filter((e) => e.category === activeCategory || e.category.startsWith(activeCategory + "/"));
    }
    return [];
  }, [entries, search, activeCategory]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/50 p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search graphics..."
            className="h-7 pl-7 font-mono text-xs"
          />
        </div>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">Loading index...</span>
        </div>
      )}

      {error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
          <AlertCircle className="h-5 w-5 text-red-400" />
          <div className="font-mono text-[10px] text-red-400">{error}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            Start the bridge, or check TIA Portal is installed at
            <br />
            <code>Portal V20/lib/Graphics/Graphics_All.zip</code>
          </div>
        </div>
      )}

      {!loading && !error && tree && (
        <div className="flex min-h-0 flex-1">
          {/* Category tree */}
          <ScrollArea className="w-40 flex-shrink-0 border-r border-border/50">
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setActiveCategory(null);
                  setSearch("");
                }}
                className={cn(
                  "w-full px-2 py-1 text-left font-mono text-[10px] hover:bg-neutral-800/50",
                  activeCategory === null && !search && "bg-amber-500/10 text-amber-400",
                )}
              >
                All ({entries.length})
              </button>
              {tree.children.map((node) => (
                <CategoryRow
                  key={node.path}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  active={activeCategory}
                  onSelect={(path) => {
                    setActiveCategory(path);
                    setSearch("");
                  }}
                />
              ))}
            </div>
          </ScrollArea>

          {/* Thumbnail grid */}
          <ScrollArea className="flex-1">
            {visibleEntries.length === 0 ? (
              <div className="p-4 text-center font-mono text-[10px] text-muted-foreground">
                {search ? "No matches" : "Select a category"}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 p-1">
                {visibleEntries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => onAdd(entry)}
                    title={`${entry.name}\n${entry.category}`}
                    className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded border border-neutral-700/50 bg-neutral-900/40 p-1 hover:border-amber-500/40 hover:bg-amber-500/10"
                  >
                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                      <img
                        src={graphicUrl(entry.path)}
                        alt={entry.name}
                        draggable={false}
                        className="max-h-full max-w-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <span className="line-clamp-1 w-full break-all text-center font-mono text-[8px] text-muted-foreground">
                      {entry.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  node,
  depth,
  expanded,
  active,
  onToggle,
  onSelect,
}: {
  node: CategoryNode;
  depth: number;
  expanded: Set<string>;
  active: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const isActive = active === node.path;
  return (
    <>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-0.5 pr-1 hover:bg-neutral-800/50",
          isActive && "bg-amber-500/10 text-amber-400",
        )}
        style={{ paddingLeft: depth * 8 + 2 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
            }}
            className="flex-shrink-0 text-muted-foreground"
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <div className="w-3 flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className="flex-1 py-0.5 text-left font-mono text-[10px]"
        >
          {node.name}
        </button>
      </div>
      {isExpanded &&
        node.children.map((child) => (
          <CategoryRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            active={active}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}
