import { useState, useMemo, useEffect } from "react";
import { Monitor, Info, Download, Loader2, CheckCircle2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildFaceplateCatalog } from "@/lib/hmi-faceplate-catalog";
import { useForgeHmiImport } from "@/hooks/use-forge-hmi-import";
import {
  HMI_SCREEN_CATEGORY_LABELS,
  REQUIRED_SCREEN_CATEGORIES,
  DETERMINISTIC_CATEGORIES,
  HMI_UNIFIED_THEMES,
  HMI_UNIFIED_THEME_LABELS,
  DEFAULT_UNIFIED_THEME,
  getPanelModels,
  findPanelModel,
  buildPanelConfig,
} from "@/types/hmi-panel";
import type {
  HmiPanelFamily,
  HmiPanelConfig,
  HmiScreenCategory,
  FaceplateCatalogEntry,
  HmiUnifiedTheme,
} from "@/types/hmi-panel";
import type { HmiScreenSpec } from "@/types/hmi-screen";
import type { ForgeSession } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { FbTemplate } from "@/types/fb-template";

export interface HmiConfiguratorProps {
  session: ForgeSession;
  profile: DesignProfile;
  fbTemplates: FbTemplate[];
  onConfigured: (
    config: HmiPanelConfig,
    catalog: FaceplateCatalogEntry[],
    categories: HmiScreenCategory[],
    importedFramework: HmiScreenSpec[] | null,
  ) => void;
}

const ALL_CATEGORIES: HmiScreenCategory[] = [
  "framework",
  "overview",
  "subsystem_checklist",
  "device_checklist",
  "device_faceplate",
  "alarm_summary",
  "trend",
  "custom",
];

export function HmiConfigurator({
  session,
  profile,
  fbTemplates,
  onConfigured,
}: HmiConfiguratorProps) {
  const [panelFamily, setPanelFamily] = useState<HmiPanelFamily>(
    session.hmi_panel_config?.family ?? profile.hmi_panel_family,
  );
  const [panelModelId, setPanelModelId] = useState(
    session.hmi_panel_config?.panelModel ?? profile.hmi_panel_model,
  );
  const [theme, setTheme] = useState<HmiUnifiedTheme>(
    session.hmi_panel_config?.theme ?? DEFAULT_UNIFIED_THEME,
  );
  const [selectedCategories, setSelectedCategories] = useState<Set<HmiScreenCategory>>(
    () => new Set<HmiScreenCategory>([
      "framework", "overview", "subsystem_checklist", "device_checklist", "alarm_summary",
    ]),
  );
  const [importedFramework, setImportedFramework] = useState<HmiScreenSpec[] | null>(null);

  const { importFromTia, loading: importLoading, error: importError } = useForgeHmiImport();

  const panelModels = useMemo(() => getPanelModels(panelFamily), [panelFamily]);
  const selectedModel = useMemo(
    () => findPanelModel(panelFamily, panelModelId),
    [panelFamily, panelModelId],
  );

  // Reset panel model when the family changes and the current model isn't in the new family's list
  useEffect(() => {
    if (!findPanelModel(panelFamily, panelModelId) && panelModels.length > 0) {
      setPanelModelId(panelModels[0].id);
    }
  }, [panelFamily, panelModelId, panelModels]);

  const catalog = useMemo(
    () => buildFaceplateCatalog(session.device_list, fbTemplates),
    [session.device_list, fbTemplates],
  );

  async function handleImportFramework() {
    try {
      const result = await importFromTia();
      if (result.screens.length > 0) {
        setImportedFramework(result.screens);
      }
    } catch {
      // error state handled by hook
    }
  }

  const toggleCategory = (cat: HmiScreenCategory) => {
    if (REQUIRED_SCREEN_CATEGORIES.includes(cat)) return;
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleGenerate = () => {
    const config: HmiPanelConfig = selectedModel
      ? buildPanelConfig(selectedModel, theme)
      : {
          family: panelFamily,
          panelModel: panelModelId,
          screenWidth: 1920,
          screenHeight: 1080,
          supportsScreenWindows: true,
          supportsFaceplates: true,
          theme: panelFamily === "unified" ? theme : undefined,
        };
    onConfigured(config, catalog, [...selectedCategories], importedFramework);
  };

  // Count how many screens will be generated per category
  const subsystemCount = session.spec_analysis?.subsystems?.length ?? 0;
  const deviceTypeCount = new Set(session.device_list.map((d) => d.device_type)).size;

  return (
    <div className="space-y-4">
      {/* Panel Configuration */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
          <Monitor className="h-4 w-4" />
          Panel Configuration
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Panel Family */}
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-400">Panel Family</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPanelFamily("comfort")}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  panelFamily === "comfort"
                    ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                    : "border-neutral-700 text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Comfort
              </button>
              <button
                type="button"
                onClick={() => setPanelFamily("unified")}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  panelFamily === "unified"
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                    : "border-neutral-700 text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Unified
              </button>
            </div>
          </div>

          {/* Panel Model */}
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-400">Panel Model</label>
            <Select value={panelModelId} onValueChange={setPanelModelId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {panelModels.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.label} ({m.screenWidth}x{m.screenHeight})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Theme selector — Unified only */}
        {panelFamily === "unified" && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs text-neutral-400">
              <Palette className="h-3 w-3" />
              Template Suite Theme
            </label>
            <div className="flex gap-2">
              {(Object.values(HMI_UNIFIED_THEMES) as HmiUnifiedTheme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    theme === t
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                      : "border-neutral-700 text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {HMI_UNIFIED_THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedModel && (
          <div className="text-xs text-neutral-500">
            Resolution: {selectedModel.screenWidth} x {selectedModel.screenHeight}
            {selectedModel.supportsFaceplates && " | Faceplates supported"}
            {selectedModel.supportsScreenWindows && " | Screen windows supported"}
            {panelFamily === "unified" && ` | Theme: ${HMI_UNIFIED_THEME_LABELS[theme]}`}
          </div>
        )}
      </Card>

      {/* Template Suite Import from TIA */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
          <Download className="h-4 w-4" />
          Framework from TIA Portal
        </div>
        <p className="text-xs text-neutral-400">
          Run the Template Suite Wizard in TIA Portal first, then import the generated framework screens.
          Content screens (checklists, faceplates) will be generated to fit into the framework zones.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleImportFramework}
            disabled={importLoading}
          >
            {importLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Import from TIA
          </Button>
          {importedFramework && (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {importedFramework.length} screen{importedFramework.length !== 1 ? "s" : ""} imported
            </div>
          )}
        </div>
        {importError && (
          <p className="text-xs text-destructive">{importError}</p>
        )}
        {!importedFramework && (
          <p className="text-[10px] text-neutral-500">
            No framework imported — deterministic framework screen will be generated instead.
          </p>
        )}
      </Card>

      {/* Screen Categories */}
      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium text-neutral-300">Screen Categories</div>
        <div className="grid grid-cols-2 gap-2">
          {ALL_CATEGORIES.map((cat) => {
            const isRequired = REQUIRED_SCREEN_CATEGORIES.includes(cat);
            const isDeterministic = DETERMINISTIC_CATEGORIES.includes(cat);
            const isSelected = selectedCategories.has(cat);

            let countLabel = "";
            if (cat === "subsystem_checklist") countLabel = ` (${subsystemCount})`;
            if (cat === "device_checklist") countLabel = ` (${deviceTypeCount})`;
            if (cat === "device_faceplate") countLabel = ` (${deviceTypeCount})`;

            return (
              <label
                key={cat}
                className={`flex items-center gap-2 p-2 rounded text-xs cursor-pointer hover:bg-neutral-800/50 ${
                  isSelected ? "text-neutral-200" : "text-neutral-500"
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={isRequired}
                  onCheckedChange={() => toggleCategory(cat)}
                />
                <span className="flex-1">
                  {HMI_SCREEN_CATEGORY_LABELS[cat]}{countLabel}
                </span>
                {isDeterministic ? (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-500/10 text-green-400 border-green-500/20">
                    DET
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">
                    AI
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      </Card>

      {/* Faceplate Catalog Preview */}
      {catalog.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
            <Info className="h-4 w-4" />
            Faceplate Catalog ({catalog.length} types)
          </div>
          <ScrollArea className="max-h-[200px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-700 text-neutral-400">
                  <th className="text-left py-1 pr-4">Device Type</th>
                  <th className="text-left py-1 pr-4">Faceplate Name</th>
                  <th className="text-left py-1 pr-4">Properties</th>
                  <th className="text-left py-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((entry) => (
                  <tr key={entry.deviceType} className="border-b border-neutral-800">
                    <td className="py-1 pr-4 text-neutral-300">{entry.deviceType}</td>
                    <td className="py-1 pr-4 font-mono text-blue-400">{entry.faceplateTypeName}</td>
                    <td className="py-1 pr-4 text-neutral-400">{entry.interfaceProperties.length}</td>
                    <td className="py-1 text-neutral-500">{entry.libraryName ?? "Custom"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      )}

      {/* Generate Button */}
      <Button
        onClick={handleGenerate}
        className="w-full"
        disabled={!selectedModel}
      >
        Generate HMI Screens ({selectedCategories.size} categories)
      </Button>
    </div>
  );
}
