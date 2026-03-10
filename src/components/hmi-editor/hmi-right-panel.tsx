import { useState, useRef, useMemo, useCallback } from "react";
import {
  Layers,
  Image,
  LayoutTemplate,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Search,
  GripVertical,
  ScanSearch,
  Loader2,
  X,
  ImagePlus,
  Library,
  Plug,
  Save,
  FileBox,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { HmiPropertiesPanel } from "./hmi-properties-panel";
import { Textarea } from "@/components/ui/textarea";
import type {
  HmiElement,
  HmiGraphic,
  HmiTemplate,
  ConnectionPoint,
} from "@/types/hmi-screen";
import type { HmiLibraryCatalog } from "./tia-library-dialog";
import { HMI_TEMPLATE_CATEGORIES } from "@/types/hmi-screen";
import { GeneratedGraphicsPanel } from "./generated-graphics-panel";
import type { GeneratedSvgGraphic } from "@/lib/hmi-svg-generator";

type Tab = "properties" | "library" | "templates";

interface HmiRightPanelProps {
  selectedElement: HmiElement | null;
  onUpdateElement: (id: string, patch: Partial<HmiElement>) => void;
  onDeleteElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  onMoveZIndex: (id: string, direction: "up" | "down") => void;
  elementCount: number;
  graphics: Map<string, HmiGraphic>;
  templates: HmiTemplate[];
  onApplyTemplate: (template: HmiTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  scanGraphic: (name: string, dataUri: string) => Promise<Partial<HmiGraphic>>;
  onUpdateGraphic: (name: string, patch: Partial<HmiGraphic>) => void;
  onOpenWinccLibrary?: () => void;
  onOpenTiaLibrary?: () => void;
  onOpenTiaImport?: () => void;
  onSaveTemplate?: () => void;
  canSaveTemplate?: boolean;
  libraryCatalog?: HmiLibraryCatalog | null;
  onOpenSvgGenerator?: () => void;
  onAddGeneratedToCanvas?: (graphic: GeneratedSvgGraphic, stateName?: string) => void;
  generatedGraphicsRefreshKey?: number;
  onCreateVariant?: (graphic: GeneratedSvgGraphic) => void;
}

/** Build a simple category tree from graphics */
interface CategoryNode {
  name: string;
  path: string;
  children: CategoryNode[];
  graphics: HmiGraphic[];
}

function buildGraphicTree(graphics: Map<string, HmiGraphic>): CategoryNode {
  const root: CategoryNode = { name: "All", path: "", children: [], graphics: [] };
  const uncategorized: HmiGraphic[] = [];

  for (const g of graphics.values()) {
    if (!g.category) {
      uncategorized.push(g);
      continue;
    }
    const parts = g.category.split("/").filter(Boolean);
    let node = root;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], graphics: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.graphics.push(g);
  }

  if (uncategorized.length > 0) {
    root.graphics.push(...uncategorized);
  }

  const sortNode = (n: CategoryNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.graphics.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function countGraphics(node: CategoryNode): number {
  return node.graphics.length + node.children.reduce((s, c) => s + countGraphics(c), 0);
}

export function HmiRightPanel({
  selectedElement,
  onUpdateElement,
  onDeleteElement,
  onDuplicateElement,
  onMoveZIndex,
  elementCount,
  graphics,
  templates,
  onApplyTemplate,
  onDeleteTemplate,
  scanGraphic,
  onUpdateGraphic,
  onOpenWinccLibrary,
  onOpenTiaLibrary,
  onOpenTiaImport,
  onSaveTemplate,
  canSaveTemplate,
  libraryCatalog,
  onOpenSvgGenerator,
  onAddGeneratedToCanvas,
  generatedGraphicsRefreshKey,
  onCreateVariant,
}: HmiRightPanelProps) {
  const [tab, setTab] = useState<Tab>("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedGraphic, setSelectedGraphic] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Auto-switch to properties when an element is selected
  const activeTab = selectedElement ? tab : tab === "properties" ? "library" : tab;

  const tree = useMemo(() => buildGraphicTree(graphics), [graphics]);

  // Expand top-level categories by default when tree changes
  useMemo(() => {
    if (tree.children.length > 0 && expandedPaths.size === 0) {
      setExpandedPaths(new Set(tree.children.slice(0, 5).map((c) => c.path)));
    }
  }, [tree.children.length]);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const filteredGraphics = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const results: HmiGraphic[] = [];
    for (const g of graphics.values()) {
      if (
        g.name.toLowerCase().includes(q) ||
        g.category?.toLowerCase().includes(q) ||
        g.tags?.some((t) => t.toLowerCase().includes(q)) ||
        g.description?.toLowerCase().includes(q)
      ) {
        results.push(g);
      }
      if (results.length >= 100) break;
    }
    return results;
  }, [searchQuery, graphics]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, graphic: HmiGraphic) => {
      e.dataTransfer.setData("application/x-hmi-graphic", JSON.stringify({
        name: graphic.name,
        url: graphic.url,
        category: graphic.category,
      }));
      e.dataTransfer.effectAllowed = "copy";
    },
    [],
  );

  const handleSelectGraphic = useCallback((name: string) => {
    setSelectedGraphic((prev) => (prev === name ? null : name));
  }, []);

  const handleScanGraphic = useCallback(async () => {
    if (!selectedGraphic) return;
    const g = graphics.get(selectedGraphic);
    if (!g) return;
    setScanning(true);
    try {
      const result = await scanGraphic(g.name, g.url);
      onUpdateGraphic(g.name, result);
    } finally {
      setScanning(false);
    }
  }, [selectedGraphic, graphics, scanGraphic, onUpdateGraphic]);

  const activeGraphic = selectedGraphic ? graphics.get(selectedGraphic) ?? null : null;
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-l bg-card pt-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCollapsed(false)}
          title="Expand panel"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </Button>
        <div className="mt-3 flex flex-col items-center gap-2">
          <button
            className={cn(
              "rounded p-1.5 transition-colors",
              activeTab === "properties" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => { setTab("properties"); setCollapsed(false); }}
            title="Properties"
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn(
              "rounded p-1.5 transition-colors",
              activeTab === "library" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => { setTab("library"); setCollapsed(false); }}
            title="Library"
          >
            <Image className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn(
              "rounded p-1.5 transition-colors",
              activeTab === "templates" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => { setTab("templates"); setCollapsed(false); }}
            title="Templates"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-72 flex-col border-l bg-card">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setCollapsed(true)}
          title="Collapse panel"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
        <TabButton
          active={activeTab === "properties"}
          onClick={() => setTab("properties")}
          disabled={!selectedElement}
        >
          <Layers className="h-3.5 w-3.5" />
          Props
        </TabButton>
        <TabButton
          active={activeTab === "library"}
          onClick={() => setTab("library")}
        >
          <Image className="h-3.5 w-3.5" />
          Library
          {graphics.size > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
              {graphics.size}
            </Badge>
          )}
        </TabButton>
        <TabButton
          active={activeTab === "templates"}
          onClick={() => setTab("templates")}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          Templates
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === "properties" && selectedElement && (
          <PropertiesTab
            element={selectedElement}
            onUpdate={(patch) => onUpdateElement(selectedElement.id, patch)}
            onDelete={() => onDeleteElement(selectedElement.id)}
            onDuplicate={() => onDuplicateElement(selectedElement.id)}
            onMoveZ={(dir) => onMoveZIndex(selectedElement.id, dir)}
          />
        )}

        {activeTab === "library" && (
          <LibraryTab
            graphics={graphics}
            tree={tree}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filteredGraphics={filteredGraphics}
            expandedPaths={expandedPaths}
            onToggleExpand={toggleExpand}
            onDragStart={handleDragStart}
            selectedGraphic={selectedGraphic}
            onSelectGraphic={handleSelectGraphic}
            activeGraphic={activeGraphic}
            scanning={scanning}
            onScan={handleScanGraphic}
            onUpdateGraphic={onUpdateGraphic}
            onOpenWinccLibrary={onOpenWinccLibrary}
            onOpenTiaLibrary={onOpenTiaLibrary}
            libraryCatalog={libraryCatalog}
            onOpenSvgGenerator={onOpenSvgGenerator}
            onAddGeneratedToCanvas={onAddGeneratedToCanvas}
            generatedGraphicsRefreshKey={generatedGraphicsRefreshKey}
            onCreateVariant={onCreateVariant}
          />
        )}

        {activeTab === "templates" && (
          <TemplatesTab
            templates={templates}
            onApply={onApplyTemplate}
            onDelete={onDeleteTemplate}
            onSaveTemplate={onSaveTemplate}
            canSaveTemplate={canSaveTemplate}
            onOpenTiaImport={onOpenTiaImport}
          />
        )}

        {activeTab === "properties" && !selectedElement && (
          <div className="flex flex-col items-center justify-center p-6 text-center h-full">
            <Layers className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Select an element to edit
            </p>
            <p className="mt-2 text-xs text-muted-foreground/60">
              {elementCount} element{elementCount !== 1 && "s"} on screen
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "flex flex-1 items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition-colors",
        active
          ? "border-b-2 border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-40 pointer-events-none",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function PropertiesTab({
  element,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveZ,
}: {
  element: HmiElement;
  onUpdate: (patch: Partial<HmiElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveZ: (dir: "up" | "down") => void;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Properties</h3>
          <div className="flex gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    onUpdate({ locked: !element.locked })
                  }
                >
                  {element.locked ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {element.locked ? "Unlock" : "Lock"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onMoveZ("up")}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Bring forward</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onMoveZ("down")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send backward</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onDuplicate}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicate</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={onDelete}
                  disabled={element.locked}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Separator />
        <HmiPropertiesPanel element={element} onChange={onUpdate} />
      </div>
    </ScrollArea>
  );
}

// ---- Library Tab ----

function LibraryTab({
  graphics,
  tree,
  searchQuery,
  onSearchChange,
  filteredGraphics,
  expandedPaths,
  onToggleExpand,
  onDragStart,
  selectedGraphic,
  onSelectGraphic,
  activeGraphic,
  scanning,
  onScan,
  onUpdateGraphic,
  onOpenWinccLibrary,
  onOpenTiaLibrary,
  libraryCatalog,
  onOpenSvgGenerator,
  onAddGeneratedToCanvas,
  generatedGraphicsRefreshKey,
  onCreateVariant,
}: {
  graphics: Map<string, HmiGraphic>;
  tree: CategoryNode;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filteredGraphics: HmiGraphic[] | null;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onDragStart: (e: React.DragEvent, g: HmiGraphic) => void;
  selectedGraphic: string | null;
  onSelectGraphic: (name: string) => void;
  activeGraphic: HmiGraphic | null;
  scanning: boolean;
  onScan: () => void;
  onUpdateGraphic: (name: string, patch: Partial<HmiGraphic>) => void;
  onOpenWinccLibrary?: () => void;
  onOpenTiaLibrary?: () => void;
  libraryCatalog?: HmiLibraryCatalog | null;
  onOpenSvgGenerator?: () => void;
  onAddGeneratedToCanvas?: (graphic: GeneratedSvgGraphic, stateName?: string) => void;
  generatedGraphicsRefreshKey?: number;
  onCreateVariant?: (graphic: GeneratedSvgGraphic) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Actions */}
      <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 gap-1 text-[10px]"
            onClick={onOpenWinccLibrary}
          >
            <ImagePlus className="h-3 w-3" />
            WinCC Library
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-1 gap-1 text-[10px]"
            onClick={onOpenTiaLibrary}
          >
            <Library className="h-3 w-3" />
            TIA Library
          </Button>
        </div>
        {onOpenSvgGenerator && (
          <Button
            size="sm"
            className="h-6 w-full gap-1 text-[10px]"
            onClick={onOpenSvgGenerator}
          >
            <Sparkles className="h-3 w-3" />
            Generate AI Graphic
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="shrink-0 border-b px-2 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search graphics..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {graphics.size} graphics{libraryCatalog ? ` · ${libraryCatalog.items.length} TIA components` : ""} · Drag onto canvas
        </div>
      </div>

      {/* Selected graphic detail */}
      {activeGraphic && (
        <GraphicDetail
          graphic={activeGraphic}
          scanning={scanning}
          onScan={onScan}
          onClose={() => onSelectGraphic(activeGraphic.name)}
          onUpdate={(patch) => onUpdateGraphic(activeGraphic.name, patch)}
          stateSiblings={
            activeGraphic.stateGroup
              ? [...graphics.values()].filter(
                  (g) => g.stateGroup === activeGraphic.stateGroup && g.category === activeGraphic.category,
                )
              : []
          }
          onSelectGraphic={onSelectGraphic}
        />
      )}

      {/* Graphics list */}
      <ScrollArea className="flex-1">
        {/* TIA Library components */}
        {libraryCatalog && libraryCatalog.items.length > 0 && !filteredGraphics && (
          <TiaLibrarySection catalog={libraryCatalog} searchQuery="" />
        )}
        {libraryCatalog && filteredGraphics && (
          <TiaLibrarySection catalog={libraryCatalog} searchQuery={searchQuery} />
        )}

        {graphics.size === 0 && !libraryCatalog ? (
          <div className="p-4 text-center">
            <Image className="mx-auto h-8 w-8 text-muted-foreground/30" />
            <p className="mt-2 text-xs text-muted-foreground">
              No graphics loaded
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/60">
              Use WinCC Library or upload graphics
            </p>
          </div>
        ) : filteredGraphics ? (
          <div className="p-1">
            <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
              {filteredGraphics.length} results
            </div>
            <div className="grid grid-cols-4 gap-1 px-1">
              {filteredGraphics.map((g) => (
                <GraphicTile
                  key={g.name}
                  graphic={g}
                  isSelected={selectedGraphic === g.name}
                  onDragStart={onDragStart}
                  onClick={() => onSelectGraphic(g.name)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-1">
            {tree.graphics.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  Uncategorized ({tree.graphics.length})
                </div>
                <div className="grid grid-cols-4 gap-1 px-1">
                  {tree.graphics.slice(0, 20).map((g) => (
                    <GraphicTile
                      key={g.name}
                      graphic={g}
                      isSelected={selectedGraphic === g.name}
                      onDragStart={onDragStart}
                      onClick={() => onSelectGraphic(g.name)}
                    />
                  ))}
                </div>
              </div>
            )}
            {tree.children.map((node) => (
              <CategoryFolder
                key={node.path}
                node={node}
                expandedPaths={expandedPaths}
                onToggle={onToggleExpand}
                onDragStart={onDragStart}
                selectedGraphic={selectedGraphic}
                onSelectGraphic={onSelectGraphic}
                depth={0}
              />
            ))}
          </div>
        )}

        {/* AI Generated Graphics */}
        {onAddGeneratedToCanvas && (
          <>
            <Separator />
            <div className="px-2 py-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                AI Generated
              </div>
            </div>
            <GeneratedGraphicsPanel
              onAddToCanvas={onAddGeneratedToCanvas}
              refreshKey={generatedGraphicsRefreshKey}
              onCreateVariant={onCreateVariant}
            />
          </>
        )}
      </ScrollArea>
    </div>
  );
}

/** Detail panel shown above the grid when a graphic is clicked */
function GraphicDetail({
  graphic,
  scanning,
  onScan,
  onClose,
  onUpdate,
  stateSiblings,
  onSelectGraphic,
}: {
  graphic: HmiGraphic;
  scanning: boolean;
  onScan: () => void;
  onClose: () => void;
  onUpdate: (patch: Partial<HmiGraphic>) => void;
  stateSiblings: HmiGraphic[];
  onSelectGraphic: (name: string) => void;
}) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [editingConnections, setEditingConnections] = useState(false);

  const connectionPoints = graphic.visual?.connectionPoints ?? [];

  const startEditDesc = () => {
    setDescDraft(graphic.description ?? "");
    setEditingDesc(true);
  };
  const saveDesc = () => {
    onUpdate({ description: descDraft.trim() || undefined });
    setEditingDesc(false);
  };
  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    const existing = graphic.tags ?? [];
    if (!existing.includes(tag)) {
      onUpdate({ tags: [...existing, tag] });
    }
    setTagInput("");
  };
  const removeTag = (tag: string) => {
    onUpdate({ tags: (graphic.tags ?? []).filter((t) => t !== tag) });
  };
  const addConnectionPoint = () => {
    const cp: ConnectionPoint = { label: "new-point", side: "left", position: 0.5, type: "flow" };
    const updated = [...connectionPoints, cp];
    onUpdate({ visual: { ...graphic.visual!, connectionPoints: updated } });
  };
  const updateConnectionPoint = (idx: number, patch: Partial<ConnectionPoint>) => {
    const updated = connectionPoints.map((cp, i) => (i === idx ? { ...cp, ...patch } : cp));
    onUpdate({ visual: { ...graphic.visual!, connectionPoints: updated } });
  };
  const removeConnectionPoint = (idx: number) => {
    const updated = connectionPoints.filter((_, i) => i !== idx);
    onUpdate({ visual: { ...graphic.visual!, connectionPoints: updated } });
  };

  return (
    <ScrollArea className="shrink-0 border-b max-h-[60%]">
      <div>
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
          <span className="flex-1 truncate font-mono text-[10px]">{graphic.name}</span>
          {graphic.stateName && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] shrink-0">
              {graphic.stateName}
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Preview with connection point overlay */}
        <ConnectionPointPreview
          graphic={graphic}
          connectionPoints={connectionPoints}
          onUpdatePoint={updateConnectionPoint}
          onAddPoint={(cp) => {
            const updated = [...connectionPoints, cp];
            onUpdate({ visual: { ...graphic.visual!, connectionPoints: updated } });
          }}
        />

        {/* State siblings strip */}
        {stateSiblings.length > 1 && (
          <div className="border-t px-2 py-1.5">
            <div className="text-[10px] font-medium text-muted-foreground mb-1">
              States ({stateSiblings.length})
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {stateSiblings.map((s) => (
                <button
                  key={s.name}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded border p-0.5 min-w-[42px]",
                    s.name === graphic.name
                      ? "border-primary bg-primary/10"
                      : "border-border bg-white hover:border-primary/50",
                  )}
                  onClick={() => onSelectGraphic(s.name)}
                  title={s.name}
                >
                  <img
                    src={s.url}
                    alt={s.stateName ?? s.name}
                    className="h-7 w-7 object-contain"
                  />
                  <span className="text-[8px] text-muted-foreground truncate max-w-[38px]">
                    {s.stateName ?? s.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions + info */}
        <div className="border-t px-2 py-2 space-y-2">
          {graphic.category && (
            <div className="text-[10px] text-muted-foreground truncate">
              {graphic.category}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 gap-1.5 text-xs"
            onClick={onScan}
            disabled={scanning}
          >
            {scanning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ScanSearch className="h-3 w-3" />
            )}
            {graphic.visual ? "Re-scan" : "AI Scan"}
          </Button>

          {/* Description — editable */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-medium text-muted-foreground">Description</span>
              {!editingDesc && (
                <button className="text-[9px] text-primary hover:underline" onClick={startEditDesc}>
                  {graphic.description ? "edit" : "add"}
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="space-y-1">
                <Textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  className="min-h-[48px] text-[11px] resize-none"
                  autoFocus
                />
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="sm" className="h-5 px-2 text-[9px]" onClick={() => setEditingDesc(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-5 px-2 text-[9px]" onClick={saveDesc}>
                    Save
                  </Button>
                </div>
              </div>
            ) : graphic.description ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{graphic.description}</p>
            ) : (
              <p className="text-[10px] italic text-muted-foreground/50">No description</p>
            )}
          </div>

          {/* Tags — editable */}
          <div>
            <span className="text-[10px] font-medium text-muted-foreground">Tags</span>
            <div className="flex flex-wrap gap-0.5 mt-0.5">
              {(graphic.tags ?? []).map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="h-4 px-1 text-[9px] gap-0.5 cursor-pointer hover:bg-destructive/10 hover:border-destructive/30"
                  onClick={() => removeTag(t)}
                  title="Click to remove"
                >
                  {t}
                  <X className="h-2 w-2" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              <Input
                placeholder="Add tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
                className="h-5 text-[10px] flex-1"
              />
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={addTag}>
                +
              </Button>
            </div>
          </div>

          {/* Visual properties */}
          {graphic.visual && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground">Visual</span>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] mt-0.5">
                <VisualField label="Shape" value={graphic.visual.shape} />
                <VisualField label="Style" value={graphic.visual.style} />
                <VisualField label="Background" value={graphic.visual.background} />
                <VisualField label="Size" value={graphic.visual.suggestedSize} />
                <VisualField label="Use" value={graphic.visual.suggestedUse} />
                <VisualField label="Orientation" value={graphic.visual.orientation} />
                {graphic.visual.dominantColors && (
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="text-muted-foreground">Colors</span>
                    {graphic.visual.dominantColors.map((c) => (
                      <div
                        key={c}
                        className="h-3 w-3 rounded-sm border border-border"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                )}
                {graphic.visual.placementHint && (
                  <div className="col-span-2 text-muted-foreground">
                    {graphic.visual.placementHint}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Connection Points — editable */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground">
                Connection Points {connectionPoints.length > 0 && `(${connectionPoints.length})`}
              </span>
              <div className="flex gap-1">
                {connectionPoints.length > 0 && (
                  <button
                    className="text-[9px] text-primary hover:underline"
                    onClick={() => setEditingConnections(!editingConnections)}
                  >
                    {editingConnections ? "done" : "edit"}
                  </button>
                )}
                <button className="text-[9px] text-primary hover:underline" onClick={addConnectionPoint}>
                  + add
                </button>
              </div>
            </div>
            {connectionPoints.length > 0 ? (
              <div className="space-y-1 mt-1">
                {connectionPoints.map((cp, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    {editingConnections ? (
                      <>
                        <Input
                          value={cp.label}
                          onChange={(e) => updateConnectionPoint(i, { label: e.target.value })}
                          className="h-5 text-[10px] w-16 flex-none"
                        />
                        <select
                          value={cp.side}
                          onChange={(e) => updateConnectionPoint(i, { side: e.target.value as ConnectionPoint["side"] })}
                          className="h-5 rounded border bg-background text-[10px] px-0.5"
                        >
                          <option value="left">L</option>
                          <option value="right">R</option>
                          <option value="top">T</option>
                          <option value="bottom">B</option>
                        </select>
                        <Input
                          type="number"
                          min={0}
                          max={1}
                          step={0.1}
                          value={cp.position}
                          onChange={(e) => updateConnectionPoint(i, { position: Number(e.target.value) })}
                          className="h-5 text-[10px] w-12"
                        />
                        <select
                          value={cp.type}
                          onChange={(e) => updateConnectionPoint(i, { type: e.target.value as ConnectionPoint["type"] })}
                          className="h-5 rounded border bg-background text-[10px] px-0.5"
                        >
                          <option value="flow">flow</option>
                          <option value="electrical">elec</option>
                          <option value="mechanical">mech</option>
                          <option value="generic">gen</option>
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => removeConnectionPoint(i)}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <ConnectionDot type={cp.type} />
                        <span className="font-medium">{cp.label}</span>
                        <span className="text-muted-foreground">
                          {cp.side} @{cp.position.toFixed(1)}
                        </span>
                        <Badge variant="outline" className="h-3.5 px-1 text-[8px] ml-auto">
                          {cp.type}
                        </Badge>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] italic text-muted-foreground/50 mt-0.5">
                No connection points — scan or add manually
              </p>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

const CONNECTION_COLORS: Record<ConnectionPoint["type"], string> = {
  flow: "#22d3ee",
  electrical: "#facc15",
  mechanical: "#a78bfa",
  generic: "#94a3b8",
};

function ConnectionDot({ type }: { type: ConnectionPoint["type"] }) {
  return (
    <div
      className="h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: CONNECTION_COLORS[type] }}
    />
  );
}

/** Convert connection point side+position to pixel coordinates within a container */
function cpToPixel(
  cp: ConnectionPoint,
  w: number,
  h: number,
): { x: number; y: number } {
  switch (cp.side) {
    case "left":
      return { x: 0, y: cp.position * h };
    case "right":
      return { x: w, y: cp.position * h };
    case "top":
      return { x: cp.position * w, y: 0 };
    case "bottom":
      return { x: cp.position * w, y: h };
  }
}

/** Convert pixel coordinates to the nearest side + position */
function pixelToCp(
  px: number,
  py: number,
  w: number,
  h: number,
): { side: ConnectionPoint["side"]; position: number } {
  // Distance to each side
  const dists: [ConnectionPoint["side"], number][] = [
    ["left", px],
    ["right", w - px],
    ["top", py],
    ["bottom", h - py],
  ];
  dists.sort((a, b) => a[1] - b[1]);
  const side = dists[0][0];
  let position: number;
  if (side === "left" || side === "right") {
    position = Math.max(0, Math.min(1, py / h));
  } else {
    position = Math.max(0, Math.min(1, px / w));
  }
  return { side, position: Math.round(position * 10) / 10 };
}

const DOT_SIZE = 10;

function ConnectionPointPreview({
  graphic,
  connectionPoints,
  onUpdatePoint,
  onAddPoint,
}: {
  graphic: HmiGraphic;
  connectionPoints: ConnectionPoint[];
  onUpdatePoint: (idx: number, patch: Partial<ConnectionPoint>) => void;
  onAddPoint: (cp: ConnectionPoint) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgSize({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(idx);
    const pt = cpToPixel(connectionPoints[idx], imgSize.w, imgSize.h);
    setDragPos(pt);
  }, [connectionPoints, imgSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(imgSize.w, e.clientX - rect.left - (rect.width - imgSize.w) / 2));
    const y = Math.max(0, Math.min(imgSize.h, e.clientY - rect.top - (rect.height - imgSize.h) / 2));
    setDragPos({ x, y });
  }, [dragging, imgSize]);

  const handleMouseUp = useCallback(() => {
    if (dragging === null || !dragPos) return;
    const result = pixelToCp(dragPos.x, dragPos.y, imgSize.w, imgSize.h);
    onUpdatePoint(dragging, { side: result.side, position: result.position });
    setDragging(null);
    setDragPos(null);
  }, [dragging, dragPos, imgSize, onUpdatePoint]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || imgSize.w === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left - (rect.width - imgSize.w) / 2;
    const py = e.clientY - rect.top - (rect.height - imgSize.h) / 2;
    if (px < 0 || px > imgSize.w || py < 0 || py > imgSize.h) return;
    const result = pixelToCp(px, py, imgSize.w, imgSize.h);
    onAddPoint({ label: "point", ...result, type: "flow" });
  }, [imgSize, onAddPoint]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center p-3 select-none"
      style={checkerboardStyle}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      title="Double-click to add a connection point"
    >
      <div className="relative inline-block">
        <img
          src={graphic.url}
          alt={graphic.name}
          className="max-h-32 max-w-full object-contain"
          onLoad={handleImgLoad}
          draggable={false}
        />
        {/* Connection point dots */}
        {imgSize.w > 0 && connectionPoints.map((cp, i) => {
          const pos = dragging === i && dragPos
            ? dragPos
            : cpToPixel(cp, imgSize.w, imgSize.h);
          return (
            <div
              key={i}
              className={cn(
                "absolute rounded-full border-2 border-white shadow-md cursor-grab z-10",
                dragging === i && "cursor-grabbing ring-2 ring-white/50 scale-125",
              )}
              style={{
                width: DOT_SIZE,
                height: DOT_SIZE,
                backgroundColor: CONNECTION_COLORS[cp.type],
                left: pos.x - DOT_SIZE / 2,
                top: pos.y - DOT_SIZE / 2,
              }}
              onMouseDown={(e) => handleMouseDown(e, i)}
              title={`${cp.label} (${cp.side} @${cp.position})`}
            />
          );
        })}
        {/* Side labels when dragging */}
        {dragging !== null && (
          <>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground font-mono">T</div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground font-mono">B</div>
            <div className="absolute top-1/2 -left-3 -translate-y-1/2 text-[8px] text-muted-foreground font-mono">L</div>
            <div className="absolute top-1/2 -right-3 -translate-y-1/2 text-[8px] text-muted-foreground font-mono">R</div>
          </>
        )}
      </div>
    </div>
  );
}

function VisualField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/** Checkerboard background for transparent images */
const checkerboardStyle: React.CSSProperties = {
  backgroundImage: `
    linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
    linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)
  `,
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
  backgroundColor: "#ffffff",
  borderRadius: "4px",
};

function CategoryFolder({
  node,
  expandedPaths,
  onToggle,
  onDragStart,
  selectedGraphic,
  onSelectGraphic,
  depth,
}: {
  node: CategoryNode;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onDragStart: (e: React.DragEvent, g: HmiGraphic) => void;
  selectedGraphic: string | null;
  onSelectGraphic: (name: string) => void;
  depth: number;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const count = countGraphics(node);

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 10 + 4}px` }}
        onClick={() => onToggle(node.path)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </button>

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <CategoryFolder
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onDragStart={onDragStart}
              selectedGraphic={selectedGraphic}
              onSelectGraphic={onSelectGraphic}
              depth={depth + 1}
            />
          ))}
          {node.graphics.length > 0 && (
            <div
              className="grid grid-cols-4 gap-1 px-1 py-1"
              style={{ paddingLeft: `${(depth + 1) * 10 + 8}px` }}
            >
              {node.graphics.slice(0, 40).map((g) => (
                <GraphicTile
                  key={g.name}
                  graphic={g}
                  isSelected={selectedGraphic === g.name}
                  onDragStart={onDragStart}
                  onClick={() => onSelectGraphic(g.name)}
                />
              ))}
              {node.graphics.length > 40 && (
                <div className="col-span-4 px-1 text-[10px] text-muted-foreground">
                  +{node.graphics.length - 40} more
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GraphicTile({
  graphic,
  isSelected,
  onDragStart,
  onClick,
}: {
  graphic: HmiGraphic;
  isSelected: boolean;
  onDragStart: (e: React.DragEvent, g: HmiGraphic) => void;
  onClick: () => void;
}) {
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          draggable
          onDragStart={(e) => onDragStart(e, graphic)}
          onClick={onClick}
          className={cn(
            "group relative flex cursor-grab items-center justify-center rounded border p-0.5 hover:ring-1 hover:ring-primary active:cursor-grabbing",
            isSelected
              ? "border-primary ring-1 ring-primary bg-primary/10"
              : "border-border bg-white",
          )}
        >
          <img
            src={graphic.url}
            alt={graphic.name}
            className="h-10 w-10 object-contain"
            loading="lazy"
            draggable={false}
          />
          {graphic.stateName && (
            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[7px] font-medium text-white leading-tight py-px rounded-b">
              {graphic.stateName}
            </span>
          )}
          <GripVertical className="absolute right-0 top-0 h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/40" />
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="w-56 p-0">
        {/* Large preview with checkerboard */}
        <div className="flex items-center justify-center p-4" style={checkerboardStyle}>
          <img
            src={graphic.url}
            alt={graphic.name}
            className="max-h-32 max-w-full object-contain"
          />
        </div>
        <div className="border-t px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-medium">{graphic.name}</span>
            {graphic.stateName && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px]">{graphic.stateName}</Badge>
            )}
          </div>
          {graphic.stateGroup && (
            <div className="text-[10px] text-muted-foreground">
              State group: <span className="font-mono">{graphic.stateGroup}</span>
            </div>
          )}
          {graphic.category && (
            <div className="text-[10px] text-muted-foreground">{graphic.category}</div>
          )}
          {graphic.description && (
            <p className="text-[10px] leading-snug text-muted-foreground">{graphic.description}</p>
          )}
          {graphic.tags && graphic.tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 pt-0.5">
              {graphic.tags.slice(0, 5).map((t) => (
                <Badge key={t} variant="outline" className="h-4 px-1 text-[9px]">{t}</Badge>
              ))}
            </div>
          )}
          {!graphic.description && !graphic.visual && (
            <div className="text-[10px] text-muted-foreground/50 italic">
              Click to select, then AI Scan for details
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function TemplatesTab({
  templates,
  onApply,
  onDelete,
  onSaveTemplate,
  canSaveTemplate,
  onOpenTiaImport,
}: {
  templates: HmiTemplate[];
  onApply: (t: HmiTemplate) => void;
  onDelete: (id: string) => void;
  onSaveTemplate?: () => void;
  canSaveTemplate?: boolean;
  onOpenTiaImport?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Actions */}
      <div className="flex shrink-0 gap-1 border-b px-2 py-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-6 flex-1 gap-1 text-[10px]"
          onClick={onSaveTemplate}
          disabled={!canSaveTemplate}
        >
          <Save className="h-3 w-3" />
          Save Current
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 flex-1 gap-1 text-[10px]"
          onClick={onOpenTiaImport}
        >
          <Plug className="h-3 w-3" />
          Import TIA
        </Button>
      </div>

      <ScrollArea className="flex-1">
      <div className="p-3">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <LayoutTemplate className="mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No templates yet</p>
            <p className="mt-1 text-[10px] text-muted-foreground/60">
              Save a screen or import from TIA Portal
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="group relative rounded-lg border border-border p-2 hover:bg-accent/30"
              >
                <button
                  className="flex w-full items-start gap-3 text-left"
                  onClick={() => onApply(t)}
                >
                  {t.thumbnail ? (
                    <img
                      src={t.thumbnail}
                      alt={t.name}
                      className="h-14 w-20 shrink-0 rounded border border-border bg-neutral-900 object-contain"
                    />
                  ) : (
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded border border-border bg-neutral-900">
                      <LayoutTemplate className="h-5 w-5 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{t.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="outline" className="text-[9px]">
                        {HMI_TEMPLATE_CATEGORIES[t.category]}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground">
                        {t.screen.elements.length} el
                      </span>
                    </div>
                    {t.referenceDocIds && t.referenceDocIds.length > 0 && (
                      <div className="mt-0.5">
                        <Badge variant="secondary" className="text-[8px] h-3.5 px-1">
                          {t.referenceDocIds.length} linked doc{t.referenceDocIds.length > 1 ? "s" : ""}
                        </Badge>
                      </div>
                    )}
                    {t.description && (
                      <div className="mt-1 text-[10px] leading-tight text-muted-foreground line-clamp-2">
                        {t.description}
                      </div>
                    )}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
    </div>
  );
}

/** Build a folder tree from TIA library item paths */
interface TiaTreeNode {
  name: string;
  fullPath: string;
  item?: import("./tia-library-dialog").HmiLibraryCatalogItem;
  children: TiaTreeNode[];
}

function buildTiaTree(items: import("./tia-library-dialog").HmiLibraryCatalogItem[]): TiaTreeNode[] {
  const root: TiaTreeNode[] = [];

  for (const item of items) {
    const parts = item.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");
      let existing = current.find((n) => n.fullPath === partPath);

      if (!existing) {
        existing = {
          name: parts[i],
          fullPath: partPath,
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

function countTiaLeaves(node: TiaTreeNode): number {
  if (node.item && node.children.length === 0) return 1;
  return (node.item ? 1 : 0) + node.children.reduce((s, c) => s + countTiaLeaves(c), 0);
}

/** Collapsible TIA Library section inside the Library tab */
function TiaLibrarySection({
  catalog,
  searchQuery,
}: {
  catalog: HmiLibraryCatalog;
  searchQuery: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  const items = searchQuery.trim()
    ? catalog.items.filter((item) => {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.kind.toLowerCase().includes(q) ||
          item.path.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q)
        );
      })
    : catalog.items;

  if (searchQuery.trim() && items.length === 0) return null;

  const tree = buildTiaTree(items);

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="border-b px-1 pb-1">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent/30 rounded"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Library className="h-3 w-3 shrink-0 text-primary/70" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          TIA Library
        </span>
        <Badge variant="outline" className="ml-auto px-1 py-0 text-[8px]">
          {items.length}
        </Badge>
      </button>

      {expanded && (
        <div className="ml-2">
          {tree.map((node) => (
            <TiaFolderNode
              key={node.fullPath}
              node={node}
              expandedPaths={expandedPaths}
              onToggle={togglePath}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TiaFolderNode({
  node,
  expandedPaths,
  onToggle,
  depth,
}: {
  node: TiaTreeNode;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}) {
  const isFolder = node.children.length > 0 && !node.item;
  const isExpanded = expandedPaths.has(node.fullPath);

  if (isFolder) {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] hover:bg-accent/30"
          onClick={() => onToggle(node.fullPath)}
        >
          {isExpanded ? (
            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
          )}
          <FolderOpen className="h-2.5 w-2.5 shrink-0 text-yellow-500/70" />
          <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
          <span className="ml-auto text-[9px] text-muted-foreground/60">
            {countTiaLeaves(node)}
          </span>
        </button>
        {isExpanded && (
          <div className="ml-3 border-l border-border/30 pl-1">
            {node.children.map((child) => (
              <TiaFolderNode
                key={child.fullPath}
                node={child}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Leaf item — draggable onto canvas
  const hasThumbnail = !!node.item?.thumbnail;

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            "flex cursor-grab items-center gap-1.5 rounded px-1.5 text-[10px] hover:bg-accent/30 active:cursor-grabbing",
            hasThumbnail ? "py-1" : "py-0.5",
          )}
          draggable
          onDragStart={(e) => {
            if (!node.item) return;
            e.dataTransfer.setData(
              "application/x-tia-library-item",
              JSON.stringify({ name: node.item.name, kind: node.item.kind, path: node.item.path }),
            );
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          <GripVertical className="h-2.5 w-2.5 shrink-0 text-muted-foreground/30" />
          {hasThumbnail ? (
            <img
              src={node.item!.thumbnail!}
              alt={node.name}
              className="h-6 w-10 shrink-0 rounded border border-border/50 bg-neutral-900 object-contain"
              draggable={false}
            />
          ) : (
            <FileBox className="h-2.5 w-2.5 shrink-0 text-primary/50" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
          {node.item && (
            <Badge variant="outline" className="shrink-0 px-1 py-0 font-mono text-[7px]">
              {node.item.kind}
            </Badge>
          )}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="left" className="w-56 p-2">
        <div className="space-y-1.5">
          {hasThumbnail && (
            <img
              src={node.item!.thumbnail!}
              alt={node.name}
              className="w-full rounded border border-border bg-neutral-900 object-contain"
              draggable={false}
            />
          )}
          <div className="font-mono text-[10px] font-medium">{node.item?.name}</div>
          <div className="text-[9px] text-muted-foreground">{node.item?.path}</div>
          {node.item?.description && (
            <div className="text-[10px] text-muted-foreground">{node.item.description}</div>
          )}
          <div className="text-[9px] text-muted-foreground/60">Drag onto canvas to place</div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
