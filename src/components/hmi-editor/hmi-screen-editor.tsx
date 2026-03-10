import { useState, useRef, useCallback, useEffect } from "react";
import { Rnd } from "react-rnd";
import {
  RectangleHorizontal,
  MousePointer2,
  Type,
  ToggleLeft,
  Gauge,
  Image,
  Minus,
  Grid3x3,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Send,
  Loader2,
  X,
  Circle,
  BarChart3,
  SlidersHorizontal,
  ToggleRight,
  TrendingUp,
  AlertTriangle,
  Clock,
  Component,
  List,
  Trash2,
  Undo2,
  Redo2,
  Copy,
  Clipboard,
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from "lucide-react";
import { useHmiHistory } from "@/hooks/use-hmi-history";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  HmiElement,
  HmiElementType,
  HmiGraphic,
  HmiTemplate,
} from "@/types/hmi-screen";
import type { GeneratedSvgGraphic } from "@/lib/hmi-svg-generator";
import {
  HMI_ELEMENT_TYPES,
  HMI_ELEMENT_LABELS,
  DEFAULT_ELEMENT_SIZES,
  DEFAULT_ELEMENT_STYLES,
} from "@/types/hmi-screen";
import { HmiElementRenderer } from "./hmi-element-renderer";
import { HmiRightPanel } from "./hmi-right-panel";

const GRID_SIZE = 10;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;
const SNAP_THRESHOLD = 5; // px distance to trigger alignment guide

interface HmiScreenEditorProps {
  screen: import("@/types/hmi-screen").HmiScreenSpec;
  onChange: (screen: import("@/types/hmi-screen").HmiScreenSpec) => void;
  graphicUrls?: Map<string, string>;
  graphics: Map<string, HmiGraphic>;
  templates: HmiTemplate[];
  onApplyTemplate: (template: HmiTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onAiPrompt?: (prompt: string) => void;
  aiLoading?: boolean;
  scanGraphic: (name: string, dataUri: string) => Promise<Partial<import("@/types/hmi-screen").HmiGraphic>>;
  onUpdateGraphic: (name: string, patch: Partial<import("@/types/hmi-screen").HmiGraphic>) => void;
  onOpenWinccLibrary?: () => void;
  onOpenTiaLibrary?: () => void;
  onOpenTiaImport?: () => void;
  onSaveTemplate?: () => void;
  canSaveTemplate?: boolean;
  libraryCatalog?: import("@/components/hmi-editor/tia-library-dialog").HmiLibraryCatalog | null;
  onOpenSvgGenerator?: () => void;
  onAddGeneratedToCanvas?: (graphic: GeneratedSvgGraphic, stateName?: string) => void;
  generatedGraphicsRefreshKey?: number;
  onCreateVariant?: (graphic: GeneratedSvgGraphic) => void;
}

export function HmiScreenEditor({
  screen,
  onChange,
  graphicUrls,
  graphics,
  templates,
  onApplyTemplate,
  onDeleteTemplate,
  onAiPrompt,
  aiLoading,
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
}: HmiScreenEditorProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(0.55);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [dropHighlight, setDropHighlight] = useState(false);
  const [alignGuides, setAlignGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const clipboardRef = useRef<HmiElement[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // Undo/redo
  const { pushState, undo, redo, canUndo, canRedo } = useHmiHistory(screen, onChange);

  // Single selection for properties panel (first selected)
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  const selectedElement = selectedId ? (screen.elements.find((el) => el.id === selectedId) ?? null) : null;

  // Fit zoom to container on mount
  useEffect(() => {
    if (!canvasRef.current?.parentElement) return;
    const parent = canvasRef.current.parentElement;
    const scaleX = (parent.clientWidth - 32) / screen.width;
    const scaleY = (parent.clientHeight - 32) / screen.height;
    const fit = Math.min(scaleX, scaleY, 1);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(fit * 20) / 20)));
  }, [screen.width, screen.height]);

  const snap = useCallback(
    (v: number) => (snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : v),
    [snapToGrid],
  );

  const updateElement = useCallback(
    (id: string, patch: Partial<HmiElement>) => {
      pushState();
      onChange({
        ...screen,
        elements: screen.elements.map((el) =>
          el.id === id ? { ...el, ...patch } : el,
        ),
      });
    },
    [screen, onChange, pushState],
  );

  const addElement = useCallback(
    (type: HmiElementType) => {
      pushState();
      const size = DEFAULT_ELEMENT_SIZES[type];
      const style = { ...DEFAULT_ELEMENT_STYLES[type] };
      const maxZ = screen.elements.reduce(
        (max, el) => Math.max(max, el.zIndex),
        0,
      );
      const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const name = `${HMI_ELEMENT_LABELS[type]}_${screen.elements.filter((e) => e.type === type).length + 1}`;

      const newElement: HmiElement = {
        id,
        type,
        name,
        x: snap(screen.width / 2 - size.width / 2),
        y: snap(screen.height / 2 - size.height / 2),
        width: size.width,
        height: size.height,
        zIndex: maxZ + 1,
        style,
        text: type === "BUTTON" ? "Button" : type === "TEXT" ? "Label" : undefined,
      };

      onChange({ ...screen, elements: [...screen.elements, newElement] });
      setSelectedIds(new Set([id]));
    },
    [screen, onChange, snap, pushState],
  );

  /** Drop a graphic from the library panel onto the canvas */
  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropHighlight(false);

      // Calculate drop position relative to the canvas
      const canvasEl = canvasRef.current;
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      const rawX = (e.clientX - rect.left) / zoom;
      const rawY = (e.clientY - rect.top) / zoom;

      pushState();
      const maxZ = screen.elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
      const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // WinCC graphic drop
      const graphicData = e.dataTransfer.getData("application/x-hmi-graphic");
      if (graphicData) {
        try {
          const graphic: { name: string; url: string; category?: string } = JSON.parse(graphicData);
          const size = DEFAULT_ELEMENT_SIZES.GRAPHIC_VIEW;
          const x = snap(Math.max(0, Math.min(rawX - size.width / 2, screen.width - size.width)));
          const y = snap(Math.max(0, Math.min(rawY - size.height / 2, screen.height - size.height)));

          const newElement: HmiElement = {
            id,
            type: "GRAPHIC_VIEW",
            name: graphic.name,
            x, y,
            width: size.width,
            height: size.height,
            zIndex: maxZ + 1,
            style: { ...DEFAULT_ELEMENT_STYLES.GRAPHIC_VIEW },
            graphicName: graphic.name,
          };
          onChange({ ...screen, elements: [...screen.elements, newElement] });
          setSelectedIds(new Set([id]));
        } catch { /* ignore */ }
        return;
      }

      // TIA library component drop
      const tiaData = e.dataTransfer.getData("application/x-tia-library-item");
      if (tiaData) {
        try {
          const item: { name: string; kind: string; path: string } = JSON.parse(tiaData);
          const width = 200;
          const height = 120;
          const x = snap(Math.max(0, Math.min(rawX - width / 2, screen.width - width)));
          const y = snap(Math.max(0, Math.min(rawY - height / 2, screen.height - height)));

          const newElement: HmiElement = {
            id,
            type: "RECTANGLE",
            name: item.name,
            x, y,
            width,
            height,
            zIndex: maxZ + 1,
            style: {
              backgroundColor: "#1e293b",
              borderColor: "#3b82f6",
              borderWidth: 2,
              textColor: "#e2e8f0",
              fontSize: 12,
              fontWeight: "bold",
              textAlign: "center",
            },
            text: item.name,
            libraryPath: item.path,
          };
          onChange({ ...screen, elements: [...screen.elements, newElement] });
          setSelectedIds(new Set([id]));
        } catch { /* ignore */ }
        return;
      }
    },
    [screen, onChange, snap, zoom, pushState],
  );

  const deleteElement = useCallback(
    (id: string) => {
      pushState();
      onChange({
        ...screen,
        elements: screen.elements.filter((el) => el.id !== id),
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [screen, onChange, pushState],
  );

  /** Delete all selected elements */
  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushState();
    const ids = selectedIds;
    onChange({
      ...screen,
      elements: screen.elements.filter((el) => !ids.has(el.id) || el.locked),
    });
    setSelectedIds(new Set());
  }, [screen, onChange, selectedIds, pushState]);

  const duplicateElement = useCallback(
    (id: string) => {
      const el = screen.elements.find((e) => e.id === id);
      if (!el) return;
      pushState();
      const maxZ = screen.elements.reduce(
        (max, e) => Math.max(max, e.zIndex),
        0,
      );
      const newId = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const dup: HmiElement = {
        ...el,
        id: newId,
        name: `${el.name}_copy`,
        x: el.x + 20,
        y: el.y + 20,
        zIndex: maxZ + 1,
      };
      onChange({ ...screen, elements: [...screen.elements, dup] });
      setSelectedIds(new Set([newId]));
    },
    [screen, onChange, pushState],
  );

  /** Copy selected elements to clipboard */
  const copySelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    clipboardRef.current = screen.elements.filter((el) => selectedIds.has(el.id));
  }, [screen.elements, selectedIds]);

  /** Paste clipboard elements */
  const pasteElements = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    pushState();
    const maxZ = screen.elements.reduce((max, e) => Math.max(max, e.zIndex), 0);
    const newIds = new Set<string>();
    const pasted = clipboardRef.current.map((el, i) => {
      const newId = `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
      newIds.add(newId);
      return {
        ...el,
        id: newId,
        name: `${el.name}_copy`,
        x: snap(el.x + 20),
        y: snap(el.y + 20),
        zIndex: maxZ + 1 + i,
      };
    });
    onChange({ ...screen, elements: [...screen.elements, ...pasted] });
    setSelectedIds(newIds);
    // Shift clipboard for next paste
    clipboardRef.current = pasted;
  }, [screen, onChange, snap, pushState]);

  /** Compute alignment guides for a dragging element */
  const computeAlignGuides = useCallback(
    (dragId: string, dragX: number, dragY: number, dragW: number, dragH: number) => {
      const xGuides: number[] = [];
      const yGuides: number[] = [];
      const dragCx = dragX + dragW / 2;
      const dragCy = dragY + dragH / 2;
      const dragR = dragX + dragW;
      const dragB = dragY + dragH;

      for (const el of screen.elements) {
        if (el.id === dragId || selectedIds.has(el.id)) continue;
        const elCx = el.x + el.width / 2;
        const elCy = el.y + el.height / 2;
        const elR = el.x + el.width;
        const elB = el.y + el.height;

        // Vertical alignment guides (x-axis)
        if (Math.abs(dragX - el.x) < SNAP_THRESHOLD) xGuides.push(el.x);
        if (Math.abs(dragR - elR) < SNAP_THRESHOLD) xGuides.push(elR);
        if (Math.abs(dragCx - elCx) < SNAP_THRESHOLD) xGuides.push(elCx);
        if (Math.abs(dragX - elR) < SNAP_THRESHOLD) xGuides.push(elR);
        if (Math.abs(dragR - el.x) < SNAP_THRESHOLD) xGuides.push(el.x);

        // Horizontal alignment guides (y-axis)
        if (Math.abs(dragY - el.y) < SNAP_THRESHOLD) yGuides.push(el.y);
        if (Math.abs(dragB - elB) < SNAP_THRESHOLD) yGuides.push(elB);
        if (Math.abs(dragCy - elCy) < SNAP_THRESHOLD) yGuides.push(elCy);
        if (Math.abs(dragY - elB) < SNAP_THRESHOLD) yGuides.push(elB);
        if (Math.abs(dragB - el.y) < SNAP_THRESHOLD) yGuides.push(el.y);
      }

      setAlignGuides({ x: [...new Set(xGuides)], y: [...new Set(yGuides)] });
    },
    [screen.elements, selectedIds],
  );

  const moveZIndex = useCallback(
    (id: string, direction: "up" | "down") => {
      pushState();
      const sorted = [...screen.elements].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const swapIdx = direction === "up" ? idx + 1 : idx - 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;
      const thisZ = sorted[idx].zIndex;
      const otherZ = sorted[swapIdx].zIndex;
      onChange({
        ...screen,
        elements: screen.elements.map((el) => {
          if (el.id === id) return { ...el, zIndex: otherZ };
          if (el.id === sorted[swapIdx].id) return { ...el, zIndex: thisZ };
          return el;
        }),
      });
    },
    [screen, onChange, pushState],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA";

      // Undo/Redo (always active, even without selection)
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && !inInput) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey)) && !inInput) {
        e.preventDefault();
        redo();
        return;
      }

      // Copy/Paste (Ctrl+C / Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && !inInput) {
        e.preventDefault();
        copySelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && !inInput) {
        e.preventDefault();
        pasteElements();
        return;
      }

      // Select all (Ctrl+A)
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && !inInput) {
        e.preventDefault();
        setSelectedIds(new Set(screen.elements.map((el) => el.id)));
        return;
      }

      if (selectedIds.size === 0) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (inInput) return;
        e.preventDefault();
        deleteSelected();
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedId) duplicateElement(selectedId);
      }
      if (e.key === "Escape") {
        if (promptOpen) {
          setPromptOpen(false);
        } else {
          setSelectedIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, selectedIds, deleteSelected, duplicateElement, screen.elements, promptOpen, undo, redo, copySelected, pasteElements]);

  const handleSendPrompt = useCallback(() => {
    if (!promptText.trim() || !onAiPrompt) return;
    onAiPrompt(promptText.trim());
    setPromptText("");
  }, [promptText, onAiPrompt]);

  const PALETTE_ITEMS: { type: HmiElementType; icon: typeof RectangleHorizontal }[] = [
    { type: HMI_ELEMENT_TYPES.RECTANGLE, icon: RectangleHorizontal },
    { type: HMI_ELEMENT_TYPES.BUTTON, icon: ToggleLeft },
    { type: HMI_ELEMENT_TYPES.TEXT, icon: Type },
    { type: HMI_ELEMENT_TYPES.IO_FIELD, icon: MousePointer2 },
    { type: HMI_ELEMENT_TYPES.SYMBOLIC_IO_FIELD, icon: List },
    { type: HMI_ELEMENT_TYPES.GRAPHIC_VIEW, icon: Image },
    { type: HMI_ELEMENT_TYPES.CIRCLE, icon: Circle },
    { type: HMI_ELEMENT_TYPES.GAUGE, icon: Gauge },
    { type: HMI_ELEMENT_TYPES.BAR, icon: BarChart3 },
    { type: HMI_ELEMENT_TYPES.SLIDER, icon: SlidersHorizontal },
    { type: HMI_ELEMENT_TYPES.SWITCH, icon: ToggleRight },
    { type: HMI_ELEMENT_TYPES.LINE, icon: Minus },
    { type: HMI_ELEMENT_TYPES.TREND_VIEW, icon: TrendingUp },
    { type: HMI_ELEMENT_TYPES.ALARM_VIEW, icon: AlertTriangle },
    { type: HMI_ELEMENT_TYPES.DATE_TIME, icon: Clock },
    { type: HMI_ELEMENT_TYPES.FACEPLATE, icon: Component },
  ];

  return (
    <TooltipProvider>
    <div className="flex h-full overflow-hidden">
      {/* Left toolbar */}
      <div className="flex w-11 flex-col items-center gap-1 border-r bg-card py-2">
        {PALETTE_ITEMS.map(({ type, icon: Icon }) => (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => addElement(type)}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{HMI_ELEMENT_LABELS[type]}</TooltipContent>
          </Tooltip>
        ))}

        <Separator className="my-1 w-6" />

        {/* Undo / Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={!canUndo}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={!canRedo}>
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Redo (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>

        {/* Copy / Paste */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copySelected} disabled={selectedIds.size === 0}>
              <Copy className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Copy (Ctrl+C)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={pasteElements} disabled={clipboardRef.current.length === 0}>
              <Clipboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Paste (Ctrl+V)</TooltipContent>
        </Tooltip>

        <Separator className="my-1 w-6" />

        {/* Layer management */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", layerPanelOpen && "bg-accent")}
              onClick={() => setLayerPanelOpen(!layerPanelOpen)}
            >
              <Layers className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Layers</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", snapToGrid && "bg-accent")}
              onClick={() => setSnapToGrid(!snapToGrid)}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Snap to grid</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Zoom in</TooltipContent>
        </Tooltip>

        <span className="font-mono text-[10px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        {selectedIds.size > 1 && (
          <span className="font-mono text-[10px] text-blue-400">
            {selectedIds.size}sel
          </span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Zoom out</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* AI prompt toggle */}
        {onAiPrompt && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", promptOpen && "bg-accent text-primary")}
                onClick={() => {
                  setPromptOpen(!promptOpen);
                  if (!promptOpen) {
                    setTimeout(() => promptInputRef.current?.focus(), 100);
                  }
                }}
              >
                <Sparkles className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">AI Designer</TooltipContent>
          </Tooltip>
        )}

        {/* Clear screen */}
        {screen.elements.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  pushState();
                  setSelectedIds(new Set());
                  onChange({ ...screen, elements: [] });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Clear screen</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Canvas area */}
      <div
        className={cn(
          "relative flex-1 overflow-auto bg-neutral-950/80",
          dropHighlight && "ring-2 ring-inset ring-primary/50",
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvas) {
            setSelectedIds(new Set());
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-hmi-graphic") || e.dataTransfer.types.includes("application/x-tia-library-item")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropHighlight(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropHighlight(false);
          }
        }}
        onDrop={handleCanvasDrop}
      >
        {/* Scaled wrapper */}
        <div
          className="flex items-center justify-center p-4"
          style={{ minWidth: "100%", minHeight: "100%" }}
        >
          <div
            data-canvas="true"
            style={{
              width: screen.width * zoom,
              height: screen.height * zoom,
              flexShrink: 0,
            }}
          >
          <div
            ref={canvasRef}
            className="relative shadow-2xl origin-top-left"
            style={{
              width: screen.width,
              height: screen.height,
              transform: `scale(${zoom})`,
              backgroundColor: screen.backgroundColor,
            }}
          >
            {/* Grid overlay */}
            {snapToGrid && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)
                  `,
                  backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                }}
              />
            )}

            {/* Drop indicator */}
            {dropHighlight && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/5">
                <div className="rounded-lg border-2 border-dashed border-primary/40 px-6 py-3 text-sm font-medium text-primary/60">
                  Drop graphic here
                </div>
              </div>
            )}

            {/* Alignment guides */}
            {alignGuides.x.map((x, i) => (
              <div
                key={`gx-${i}`}
                className="pointer-events-none absolute top-0 z-[9999]"
                style={{ left: x, width: 1, height: screen.height, backgroundColor: "rgba(59,130,246,0.5)" }}
              />
            ))}
            {alignGuides.y.map((y, i) => (
              <div
                key={`gy-${i}`}
                className="pointer-events-none absolute left-0 z-[9999]"
                style={{ top: y, height: 1, width: screen.width, backgroundColor: "rgba(59,130,246,0.5)" }}
              />
            ))}

            {/* Elements */}
            {[...screen.elements]
              .filter((el) => el.visible !== false)
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((el) => (
                <Rnd
                  key={el.id}
                  position={{ x: el.x, y: el.y }}
                  size={{ width: el.width, height: el.height }}
                  onDragStart={() => {
                    pushState();
                  }}
                  onDrag={(_e, d) => {
                    computeAlignGuides(el.id, d.x, d.y, el.width, el.height);
                  }}
                  onDragStop={(_e, d) => {
                    const dx = snap(d.x) - el.x;
                    const dy = snap(d.y) - el.y;
                    setAlignGuides({ x: [], y: [] });
                    // Multi-select drag: move all selected elements together
                    if (selectedIds.has(el.id) && selectedIds.size > 1) {
                      onChange({
                        ...screen,
                        elements: screen.elements.map((e) =>
                          selectedIds.has(e.id) && !e.locked
                            ? { ...e, x: snap(e.x + dx), y: snap(e.y + dy) }
                            : e,
                        ),
                      });
                    } else {
                      onChange({
                        ...screen,
                        elements: screen.elements.map((e) =>
                          e.id === el.id ? { ...e, x: snap(d.x), y: snap(d.y) } : e,
                        ),
                      });
                    }
                  }}
                  onResizeStop={(_e, _dir, ref, _delta, pos) => {
                    pushState();
                    onChange({
                      ...screen,
                      elements: screen.elements.map((e) =>
                        e.id === el.id
                          ? {
                              ...e,
                              width: snap(parseInt(ref.style.width)),
                              height: snap(parseInt(ref.style.height)),
                              x: snap(pos.x),
                              y: snap(pos.y),
                            }
                          : e,
                      ),
                    });
                  }}
                  dragGrid={snapToGrid ? [GRID_SIZE, GRID_SIZE] : undefined}
                  resizeGrid={snapToGrid ? [GRID_SIZE, GRID_SIZE] : undefined}
                  bounds="parent"
                  disableDragging={el.locked}
                  enableResizing={!el.locked}
                  scale={zoom}
                  style={{ zIndex: el.zIndex }}
                  className={cn(
                    "group",
                    selectedIds.has(el.id) &&
                      "ring-2 ring-blue-500 ring-offset-1 ring-offset-transparent",
                  )}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) {
                      // Shift-click: toggle in selection
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(el.id)) next.delete(el.id);
                        else next.add(el.id);
                        return next;
                      });
                    } else if (!selectedIds.has(el.id)) {
                      setSelectedIds(new Set([el.id]));
                    }
                  }}
                >
                  <HmiElementRenderer element={el} isSelected={selectedIds.has(el.id)} graphicUrls={graphicUrls} />
                </Rnd>
              ))}
          </div>
          </div>
        </div>

        {/* Layer management panel */}
        {layerPanelOpen && (
          <div className="absolute bottom-4 left-4 z-50 w-64 max-h-72 rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Layers</span>
              <span className="text-[10px] text-muted-foreground">{screen.elements.length}</span>
              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLayerPanelOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="overflow-auto max-h-56 p-1">
              {[...screen.elements]
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((el) => (
                  <div
                    key={el.id}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-xs cursor-pointer hover:bg-accent/50",
                      selectedIds.has(el.id) && "bg-accent",
                    )}
                    onClick={() => setSelectedIds(new Set([el.id]))}
                  >
                    <button
                      className="shrink-0 p-0.5 hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateElement(el.id, { visible: el.visible === false ? undefined : false });
                      }}
                    >
                      {el.visible === false ? (
                        <EyeOff className="h-3 w-3 text-muted-foreground/50" />
                      ) : (
                        <Eye className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      className="shrink-0 p-0.5 hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateElement(el.id, { locked: !el.locked });
                      }}
                    >
                      {el.locked ? (
                        <Lock className="h-3 w-3 text-amber-500/70" />
                      ) : (
                        <Unlock className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    <span className={cn(
                      "truncate flex-1 font-mono",
                      el.visible === false && "text-muted-foreground/50 line-through",
                    )}>
                      {el.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{el.type.toLowerCase()}</span>
                  </div>
                ))}
              {screen.elements.length === 0 && (
                <div className="py-4 text-center text-xs text-muted-foreground">No elements</div>
              )}
            </div>
          </div>
        )}

        {/* AI Prompt overlay */}
        {promptOpen && onAiPrompt && (
          <div className="absolute bottom-4 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2">
            <div className="rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b px-3 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">HMI Designer</span>
                <span className="text-[10px] text-muted-foreground">
                  Describe the screen you want to create
                </span>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setPromptOpen(false)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex gap-2 p-2">
                <textarea
                  ref={promptInputRef}
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendPrompt();
                    }
                  }}
                  placeholder="e.g. Create a motor control faceplate with start/stop buttons, speed display, and status indicators..."
                  className="flex-1 resize-none rounded-md border-0 bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none"
                  rows={2}
                  disabled={aiLoading}
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0 self-end"
                  onClick={handleSendPrompt}
                  disabled={!promptText.trim() || aiLoading}
                >
                  {aiLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right panel */}
      <HmiRightPanel
        selectedElement={selectedElement}
        onUpdateElement={updateElement}
        onDeleteElement={deleteElement}
        onDuplicateElement={duplicateElement}
        onMoveZIndex={moveZIndex}
        elementCount={screen.elements.length}
        graphics={graphics}
        templates={templates}
        onApplyTemplate={onApplyTemplate}
        onDeleteTemplate={onDeleteTemplate}
        scanGraphic={scanGraphic}
        onUpdateGraphic={onUpdateGraphic}
        onOpenWinccLibrary={onOpenWinccLibrary}
        onOpenTiaLibrary={onOpenTiaLibrary}
        onOpenTiaImport={onOpenTiaImport}
        onSaveTemplate={onSaveTemplate}
        canSaveTemplate={canSaveTemplate}
        libraryCatalog={libraryCatalog}
        onOpenSvgGenerator={onOpenSvgGenerator}
        onAddGeneratedToCanvas={onAddGeneratedToCanvas}
        generatedGraphicsRefreshKey={generatedGraphicsRefreshKey}
        onCreateVariant={onCreateVariant}
      />
    </div>
    </TooltipProvider>
  );
}
