import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RectangleHorizontal,
  Circle,
  Minus,
  Type,
  Square,
  MousePointer2,
  Image as ImageIcon,
  Gauge,
  BarChart3,
  SlidersHorizontal,
  ToggleRight,
  CheckSquare,
  ListChecks,
  ChevronDown,
  TrendingUp,
  AlertTriangle,
  Clock,
  Component,
  Monitor,
  Palette,
  Send,
  Trash2,
  ZoomIn,
  ZoomOut,
  Grid3x3,
  Library,
  SlidersHorizontal as PropsIcon,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HMI_UNIFIED_PANELS,
  HMI_UNIFIED_THEMES,
  HMI_UNIFIED_THEME_LABELS,
  DEFAULT_UNIFIED_THEME,
  buildPanelConfig,
} from "@/types/hmi-panel";
import type { HmiPanelConfig, HmiUnifiedTheme } from "@/types/hmi-panel";
import {
  buildUnifiedScreenPayload,
  makeItem,
} from "@/lib/hmi-unified-payload-builder";
import type {
  HmiUnifiedItemPayload,
  HmiUnifiedScreenPayload,
  HmiAttributeValue,
  HmiFontConfig,
} from "@/lib/hmi-unified-payload-builder";
import { HMI_ITEM_TYPES } from "@/lib/hmi-unified-item-types";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";
import { HmiUnifiedCanvas } from "@/components/hmi-builder/hmi-unified-canvas";
import { HmiGraphicsPanel } from "@/components/hmi-builder/hmi-graphics-panel";
import { HmiWizardDialog } from "@/components/hmi-builder/hmi-wizard-dialog";
import { cn } from "@/lib/utils";

interface PaletteButton {
  type: string;
  label: string;
  icon: typeof RectangleHorizontal;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultText?: string;
}

const PALETTE: PaletteButton[] = [
  { type: "HmiRectangle", label: "Rectangle", icon: RectangleHorizontal, defaultWidth: 200, defaultHeight: 120 },
  { type: "HmiCircle", label: "Circle", icon: Circle, defaultWidth: 80, defaultHeight: 80 },
  { type: "HmiLine", label: "Line", icon: Minus, defaultWidth: 200, defaultHeight: 4 },
  { type: "HmiText", label: "Text", icon: Type, defaultWidth: 160, defaultHeight: 32, defaultText: "Text" },
  { type: "HmiTextBox", label: "Text Box", icon: Square, defaultWidth: 200, defaultHeight: 32, defaultText: "TextBox" },
  { type: "HmiButton", label: "Button", icon: MousePointer2, defaultWidth: 140, defaultHeight: 40, defaultText: "Button" },
  { type: "HmiIOField", label: "I/O Field", icon: MousePointer2, defaultWidth: 140, defaultHeight: 32 },
  { type: "HmiSymbolicIOField", label: "Symbolic I/O", icon: ListChecks, defaultWidth: 160, defaultHeight: 32 },
  { type: "HmiGraphicView", label: "Graphic View", icon: ImageIcon, defaultWidth: 120, defaultHeight: 120 },
  { type: "HmiGauge", label: "Gauge", icon: Gauge, defaultWidth: 160, defaultHeight: 160 },
  { type: "HmiBar", label: "Bar", icon: BarChart3, defaultWidth: 60, defaultHeight: 200 },
  { type: "HmiSlider", label: "Slider", icon: SlidersHorizontal, defaultWidth: 200, defaultHeight: 40 },
  { type: "HmiToggleSwitch", label: "Toggle", icon: ToggleRight, defaultWidth: 80, defaultHeight: 36 },
  { type: "HmiCheckBox", label: "Check Box", icon: CheckSquare, defaultWidth: 120, defaultHeight: 28 },
  { type: "HmiComboBox", label: "Combo Box", icon: ChevronDown, defaultWidth: 160, defaultHeight: 32 },
  { type: "HmiTrendView", label: "Trend", icon: TrendingUp, defaultWidth: 320, defaultHeight: 200 },
  { type: "HmiAlarmView", label: "Alarm View", icon: AlertTriangle, defaultWidth: 400, defaultHeight: 160 },
  { type: "HmiDateTimeField", label: "Date/Time", icon: Clock, defaultWidth: 180, defaultHeight: 32 },
  { type: "HmiFaceplateContainer", label: "Faceplate", icon: Component, defaultWidth: 180, defaultHeight: 120 },
];

const TEXT_BEARING_TYPES = new Set([
  "HmiText",
  "HmiTextBox",
  "HmiButton",
  "HmiLabel",
  "HmiIOField",
  "HmiSymbolicIOField",
]);

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const GRID_SIZE = 10;

type RightPaneTab = "properties" | "graphics";

interface BridgeResponse {
  success: boolean;
  message?: string;
  items_created?: number;
  warnings?: string[];
}

export default function HmiBuilderPage() {
  const [screenName, setScreenName] = useState("NewScreen");
  const [folderPath, setFolderPath] = useState("PacForge");
  const [panelId, setPanelId] = useState(HMI_UNIFIED_PANELS[5]?.id ?? HMI_UNIFIED_PANELS[0].id);
  const [theme, setTheme] = useState<HmiUnifiedTheme>(DEFAULT_UNIFIED_THEME);
  const [items, setItems] = useState<HmiUnifiedItemPayload[]>([]);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(0.7);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [rightTab, setRightTab] = useState<RightPaneTab>("properties");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<BridgeResponse | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const nextAutoPos = useRef(32);

  const panelModel = useMemo(
    () => HMI_UNIFIED_PANELS.find((p) => p.id === panelId) ?? HMI_UNIFIED_PANELS[0],
    [panelId],
  );
  const panelConfig: HmiPanelConfig = useMemo(
    () => buildPanelConfig(panelModel, theme),
    [panelModel, theme],
  );

  const selectedItem =
    selectedIndexes.size === 1 ? items[Array.from(selectedIndexes)[0]] : null;
  const selectedIndex = selectedIndexes.size === 1 ? Array.from(selectedIndexes)[0] : null;

  const payload: HmiUnifiedScreenPayload = useMemo(
    () =>
      buildUnifiedScreenPayload({
        name: screenName,
        panel: panelConfig,
        folderPath: folderPath || undefined,
        items,
      }),
    [screenName, panelConfig, folderPath, items],
  );

  const addItem = useCallback((spec: PaletteButton) => {
    const namePrefix = spec.type.replace(/^Hmi/, "").toLowerCase();
    const name = `${namePrefix}_${Math.random().toString(36).slice(2, 6)}`;
    const pos = nextAutoPos.current;
    nextAutoPos.current = pos + 20;
    const newItem = makeItem(
      spec.type,
      {
        name,
        left: pos,
        top: pos,
        width: spec.defaultWidth ?? 160,
        height: spec.defaultHeight ?? 60,
      },
      {},
    );
    if (spec.defaultText) newItem.text = spec.defaultText;
    setItems((prev) => {
      const next = [...prev, newItem];
      setSelectedIndexes(new Set([next.length - 1]));
      return next;
    });
  }, []);

  const applyWizardItems = useCallback((wizardItems: HmiUnifiedItemPayload[]) => {
    setItems((prev) => {
      const next = [...prev, ...wizardItems];
      // Select the newly added range
      const newIndexes = new Set<number>();
      for (let i = prev.length; i < next.length; i++) newIndexes.add(i);
      setSelectedIndexes(newIndexes);
      return next;
    });
  }, []);

  const addGraphicItem = useCallback((graphic: { name: string; path: string; category: string }) => {
    const base = graphic.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const name = `${base}_${Math.random().toString(36).slice(2, 4)}`;
    const pos = nextAutoPos.current;
    nextAutoPos.current = pos + 20;
    const item = makeItem(
      "HmiGraphicView",
      { name, left: pos, top: pos, width: 140, height: 140 },
      { Graphic: graphic.path },
    );
    setItems((prev) => {
      const next = [...prev, item];
      setSelectedIndexes(new Set([next.length - 1]));
      return next;
    });
  }, []);

  const updateItem = useCallback(
    (
      index: number,
      patch:
        | Partial<HmiUnifiedItemPayload>
        | ((it: HmiUnifiedItemPayload) => HmiUnifiedItemPayload),
    ) => {
      setItems((prev) =>
        prev.map((it, i) => {
          if (i !== index) return it;
          if (typeof patch === "function") return patch(it);
          return { ...it, ...patch };
        }),
      );
    },
    [],
  );

  const updateSelected = useCallback(
    (updater: (item: HmiUnifiedItemPayload) => HmiUnifiedItemPayload) => {
      if (selectedIndex === null) return;
      updateItem(selectedIndex, updater);
    },
    [selectedIndex, updateItem],
  );

  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      setItems((prev) =>
        prev.map((it, i) => {
          if (!selectedIndexes.has(i)) return it;
          const left = Number(it.attributes.Left ?? 0) + dx;
          const top = Number(it.attributes.Top ?? 0) + dy;
          return { ...it, attributes: { ...it.attributes, Left: left, Top: top } };
        }),
      );
    },
    [selectedIndexes],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIndexes.size === 0) return;
    setItems((prev) => prev.filter((_, i) => !selectedIndexes.has(i)));
    setSelectedIndexes(new Set());
  }, [selectedIndexes]);

  const clearCanvas = useCallback(() => {
    setItems([]);
    setSelectedIndexes(new Set());
    nextAutoPos.current = 32;
  }, []);

  // Global delete key handler
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIndexes.size > 0) {
          e.preventDefault();
          deleteSelected();
        }
      }
      if (e.key === "Escape") {
        setSelectedIndexes(new Set());
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIndexes, deleteSelected]);

  async function pushToTia() {
    setPushing(true);
    setPushResult(null);
    setPushError(null);
    try {
      const response = await fetch(
        `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/hmi/create-screen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(120_000),
        },
      );
      const raw = (await response.json()) as Record<string, unknown>;
      setPushResult({
        success: Boolean(raw.success ?? raw.Success),
        message: String(raw.message ?? raw.Message ?? ""),
        items_created: Number(raw.items_created ?? raw.ItemsCreated ?? 0),
        warnings: (raw.warnings ?? raw.Warnings ?? []) as string[],
      });
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col gap-2">
        {/* Top bar */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border/50 bg-card px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Screen</Label>
            <Input
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              className="h-7 w-40 font-mono text-xs"
              placeholder="NewScreen"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Folder</Label>
            <Input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              className="h-7 w-32 font-mono text-xs"
              placeholder="PacForge"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Monitor className="h-3 w-3" />
              Panel
            </Label>
            <Select value={panelId} onValueChange={setPanelId}>
              <SelectTrigger className="h-7 w-52 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HMI_UNIFIED_PANELS.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label} ({p.screenWidth}×{p.screenHeight})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-0.5">
            <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Palette className="h-3 w-3" />
              Theme
            </Label>
            <div className="flex gap-1">
              {(Object.values(HMI_UNIFIED_THEMES) as HmiUnifiedTheme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={cn(
                    "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    theme === t
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                      : "border-neutral-700 text-neutral-500 hover:text-neutral-300",
                  )}
                >
                  {HMI_UNIFIED_THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {items.length} item{items.length === 1 ? "" : "s"}
              {selectedIndexes.size > 0 && ` · ${selectedIndexes.size} sel`}
            </span>
            <Button
              onClick={() => setWizardOpen(true)}
              size="sm"
              variant="outline"
              className="gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
            >
              <Wand2 className="h-3 w-3" />
              AI Wizard
            </Button>
            <Button
              onClick={pushToTia}
              disabled={pushing || items.length === 0}
              size="sm"
              className="gap-1.5"
            >
              <Send className="h-3 w-3" />
              {pushing ? "Pushing..." : "Push to TIA"}
            </Button>
          </div>
        </div>

        {(pushResult || pushError) && (
          <div
            className={cn(
              "rounded border px-2 py-1 font-mono text-[11px]",
              pushError
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : pushResult?.success
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-red-500/40 bg-red-500/10 text-red-400",
            )}
          >
            {pushError ?? pushResult?.message}
            {(pushResult?.warnings?.length ?? 0) > 0 && (
              <details className="mt-0.5 text-amber-400">
                <summary className="cursor-pointer">
                  {pushResult!.warnings!.length} warning(s)
                </summary>
                <ul className="ml-3 mt-0.5 space-y-0.5">
                  {pushResult!.warnings!.slice(0, 8).map((w, i) => (
                    <li key={i} className="break-all">· {w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Body: toolbar + canvas + right pane */}
        <div className="flex min-h-0 flex-1 gap-2">
          {/* Left icon toolbar */}
          <div className="flex w-11 flex-shrink-0 flex-col items-center gap-1 rounded-md border border-border/50 bg-card py-2">
            <ScrollArea className="w-full flex-1">
              <div className="flex flex-col items-center gap-1 px-1">
                {PALETTE.map((spec) => (
                  <Tooltip key={spec.type}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => addItem(spec)}
                      >
                        <spec.icon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{spec.label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </ScrollArea>

            <Separator className="my-1 w-6" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-8 w-8", snapToGrid && "bg-accent text-primary")}
                  onClick={() => setSnapToGrid((s) => !s)}
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

            <Separator className="my-1 w-6" />

            {selectedIndexes.size > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-400"
                    onClick={deleteSelected}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Delete selected (Del)</TooltipContent>
              </Tooltip>
            )}

            {items.length > 0 && selectedIndexes.size === 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={clearCanvas}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Clear screen</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Canvas */}
          <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border/50">
            <HmiUnifiedCanvas
              items={items}
              screenWidth={panelConfig.screenWidth}
              screenHeight={panelConfig.screenHeight}
              backColor={payload.backColor}
              zoom={zoom}
              snapToGrid={snapToGrid}
              gridSize={GRID_SIZE}
              selectedIndexes={selectedIndexes}
              onSelectionChange={setSelectedIndexes}
              onUpdateItem={updateItem}
              onMoveSelected={moveSelected}
            />
          </div>

          {/* Right pane: Properties | Graphics tabs */}
          <div className="flex w-80 flex-shrink-0 flex-col overflow-hidden rounded-md border border-border/50 bg-card">
            <div className="flex items-center border-b border-border/50">
              <button
                type="button"
                onClick={() => setRightTab("properties")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  rightTab === "properties"
                    ? "border-b-2 border-amber-500 bg-amber-500/5 text-amber-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <PropsIcon className="h-3 w-3" />
                Properties
              </button>
              <button
                type="button"
                onClick={() => setRightTab("graphics")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                  rightTab === "graphics"
                    ? "border-b-2 border-amber-500 bg-amber-500/5 text-amber-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Library className="h-3 w-3" />
                Graphics
              </button>
            </div>

            {rightTab === "properties" ? (
              selectedItem === null ? (
                <div className="flex flex-1 items-center justify-center px-3 text-center font-mono text-[11px] text-muted-foreground">
                  {selectedIndexes.size > 1
                    ? `${selectedIndexes.size} items selected — pick one to edit properties`
                    : "Click an item on the canvas to edit its properties"}
                </div>
              ) : (
                <PropertyEditor item={selectedItem} onUpdate={updateSelected} />
              )
            ) : (
              <HmiGraphicsPanel onAdd={addGraphicItem} />
            )}
          </div>
        </div>

        <HmiWizardDialog
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          panel={panelConfig}
          theme={theme}
          onApply={applyWizardItems}
        />
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Property editor
// ---------------------------------------------------------------------------

function PropertyEditor({
  item,
  onUpdate,
}: {
  item: HmiUnifiedItemPayload;
  onUpdate: (updater: (item: HmiUnifiedItemPayload) => HmiUnifiedItemPayload) => void;
}) {
  const isTextBearing = TEXT_BEARING_TYPES.has(item.type);

  function setName(name: string) {
    onUpdate((it) => ({ ...it, name }));
  }

  function setAttr(key: string, value: HmiAttributeValue) {
    onUpdate((it) => ({ ...it, attributes: { ...it.attributes, [key]: value } }));
  }

  function removeAttr(key: string) {
    onUpdate((it) => {
      const next = { ...it.attributes };
      delete next[key];
      return { ...it, attributes: next };
    });
  }

  function setText(value: string) {
    onUpdate((it) => ({ ...it, text: value || undefined }));
  }

  function setFont(patch: Partial<HmiFontConfig>) {
    onUpdate((it) => ({ ...it, font: { ...(it.font ?? {}), ...patch } }));
  }

  const attrKeys = Object.keys(item.attributes);
  const geometryKeys = ["Left", "Top", "Width", "Height"];
  const otherAttrKeys = attrKeys.filter((k) => !geometryKeys.includes(k));

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-3 p-3">
        {/* Identity */}
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Identity</Label>
          <div className="mt-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-14 font-mono text-[10px] text-muted-foreground">Type</span>
              <div className="flex-1 truncate rounded border border-neutral-700/50 bg-neutral-900/30 px-2 py-1 font-mono text-xs text-neutral-300">
                {item.type}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 font-mono text-[10px] text-muted-foreground">Name</span>
              <Input
                value={item.name}
                onChange={(e) => setName(e.target.value)}
                className="h-7 flex-1 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        {/* Geometry */}
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Geometry</Label>
          <div className="mt-1 grid grid-cols-4 gap-2">
            {geometryKeys.map((k) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="font-mono text-[9px] text-muted-foreground">{k}</span>
                <Input
                  type="number"
                  value={String(item.attributes[k] ?? 0)}
                  onChange={(e) => setAttr(k, Number(e.target.value))}
                  className="h-7 font-mono text-xs"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Text */}
        {isTextBearing && (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Text</Label>
            <Input
              value={typeof item.text === "string" ? item.text : ""}
              onChange={(e) => setText(e.target.value)}
              placeholder="Text content"
              className="mt-1 h-7 font-mono text-xs"
            />
          </div>
        )}

        {/* Font */}
        {isTextBearing && (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Font</Label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[9px] text-muted-foreground">Size</span>
                <Input
                  type="number"
                  value={item.font?.size ?? ""}
                  onChange={(e) => setFont({ size: e.target.value ? Number(e.target.value) : undefined })}
                  className="h-7 font-mono text-xs"
                  placeholder="14"
                />
              </div>
              <label className="flex items-center gap-1 font-mono text-[10px]">
                <input
                  type="checkbox"
                  checked={item.font?.bold ?? false}
                  onChange={(e) => setFont({ bold: e.target.checked })}
                />
                Bold
              </label>
              <label className="flex items-center gap-1 font-mono text-[10px]">
                <input
                  type="checkbox"
                  checked={item.font?.italic ?? false}
                  onChange={(e) => setFont({ italic: e.target.checked })}
                />
                Italic
              </label>
            </div>
          </div>
        )}

        {/* Attributes */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Attributes ({otherAttrKeys.length})
            </Label>
            <AttributePicker item={item} onPick={(key) => setAttr(key, "")} />
          </div>
          <div className="mt-1 space-y-1">
            {otherAttrKeys.length === 0 && (
              <div className="rounded border border-dashed border-neutral-700/50 p-2 text-center font-mono text-[10px] text-muted-foreground">
                None. Use + to add one.
              </div>
            )}
            {otherAttrKeys.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-24 truncate font-mono text-[10px] text-muted-foreground" title={k}>
                  {k}
                </span>
                <Input
                  value={String(item.attributes[k] ?? "")}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed: HmiAttributeValue =
                      raw === "true"
                        ? true
                        : raw === "false"
                          ? false
                          : raw !== "" && !isNaN(Number(raw))
                            ? Number(raw)
                            : raw;
                    setAttr(k, parsed);
                  }}
                  className="h-7 flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeAttr(k)}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function AttributePicker({
  item,
  onPick,
}: {
  item: HmiUnifiedItemPayload;
  onPick: (key: string) => void;
}) {
  const spec = HMI_ITEM_TYPES[item.type];
  const existingKeys = new Set(Object.keys(item.attributes));
  const available = spec?.properties
    .filter((p) => !existingKeys.has(p.name))
    .map((p) => p.name) ?? [];

  if (available.length === 0) return null;

  return (
    <Select onValueChange={onPick}>
      <SelectTrigger className="h-5 w-24 text-[10px]">
        <SelectValue placeholder="+ add" />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {available.map((name) => (
          <SelectItem key={name} value={name} className="text-xs">
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
