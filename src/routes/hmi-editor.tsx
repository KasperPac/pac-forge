import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import {
  Monitor,
  ChevronDown,
  BookOpen,
  Check,
  Download,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HmiScreenEditor } from "@/components/hmi-editor/hmi-screen-editor";
import { TiaImportDialog } from "@/components/hmi-editor/tia-import-dialog";
import { WinccGraphicsLibrary } from "@/components/hmi-editor/wincc-graphics-library";
import { parseScreenXml } from "@/lib/hmi-xml-parser";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import { useReferenceLibraryDocs, useReferenceLibrarySections } from "@/hooks/use-reference-library";
import { assignStateGroups } from "@/lib/hmi-graphic-states";
import { loadGraphics, saveGraphics, loadTemplates, saveTemplate, deleteTemplate as deleteTemplateDb, loadTiaCatalog, saveTiaCatalog } from "@/lib/hmi-graphics-db";
import { SaveTemplateDialog } from "@/components/hmi-editor/save-template-dialog";
import { TiaLibraryDialog } from "@/components/hmi-editor/tia-library-dialog";
import type { HmiLibraryCatalog } from "@/components/hmi-editor/tia-library-dialog";
import { SvgGeneratorDialog } from "@/components/hmi-editor/svg-generator-dialog";
import { svgToDataUri } from "@/lib/hmi-svg-generator";
import type { GeneratedSvgGraphic } from "@/lib/hmi-svg-generator";
import { loadGeneratedGraphics } from "@/lib/hmi-generated-graphics-db";
import { buildScreenXml, buildTagTableXml, extractTagBindings, buildAlarmXml, buildFaceplateTypeXml } from "@/lib/hmi-xml-builder";
import type { HmiScreenSpec, HmiGraphic, HmiTemplate, HmiTemplateCategory, HmiElement, HmiElementType, HmiElementStyle } from "@/types/hmi-screen";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";
import { resolveSection } from "@/lib/prompt-defaults";

const EMPTY_SCREEN: HmiScreenSpec = {
  id: "screen_new",
  name: "NEW_SCREEN",
  width: 1920,
  height: 1080,
  backgroundColor: "#0f172a",
  elements: [],
};

export default function HmiEditorPage() {
  const [screens, setScreens] = useState<HmiScreenSpec[]>([EMPTY_SCREEN]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [graphics, setGraphics] = useState<Map<string, HmiGraphic>>(new Map());
  const [templates, setTemplates] = useState<HmiTemplate[]>([]);
  const [tiaDialogOpen, setTiaDialogOpen] = useState(false);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [tiaLibraryOpen, setTiaLibraryOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedRefDocId, setSelectedRefDocId] = useState<string | null>(null);
  const [libraryCatalog, setLibraryCatalog] = useState<HmiLibraryCatalog | null>(null);
  const [svgGeneratorOpen, setSvgGeneratorOpen] = useState(false);
  const [generatedGraphicsRefreshKey, setGeneratedGraphicsRefreshKey] = useState(0);
  const [variantOfGraphic, setVariantOfGraphic] = useState<GeneratedSvgGraphic | null>(null);

  // Reference library — for selecting a design guide doc
  const { data: refDocs } = useReferenceLibraryDocs();
  const { data: refSections } = useReferenceLibrarySections(selectedRefDocId ?? undefined);

  // Editable prompt sections (from Prompt Editor page)
  const { data: promptSections } = useActivePromptSections();

  const screen = screens[activeIdx] ?? EMPTY_SCREEN;

  // Load persisted graphics and templates from IndexedDB on mount
  useEffect(() => {
    loadGraphics().then((saved) => {
      if (saved.size > 0) {
        assignStateGroups(saved);
        setGraphics(saved);
      }
    }).catch((err) => console.error("Failed to load graphics from IndexedDB:", err));
    loadTemplates().then((saved) => {
      if (saved.length > 0) setTemplates(saved);
    }).catch((err) => console.error("Failed to load templates from IndexedDB:", err));
    loadTiaCatalog().then((saved) => {
      if (saved) setLibraryCatalog(saved);
    }).catch((err) => console.error("Failed to load TIA catalog from IndexedDB:", err));
  }, []);

  // Load screen from forge wizard (via sessionStorage)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== "forge") return;
    const json = sessionStorage.getItem("forge-hmi-preview");
    if (!json) return;
    try {
      const spec = JSON.parse(json) as HmiScreenSpec;
      setScreens([spec]);
      setActiveIdx(0);
      sessionStorage.removeItem("forge-hmi-preview");
      // Clean up URL param
      window.history.replaceState({}, "", "/hmi-editor");
    } catch {
      console.warn("[hmi-editor] Failed to parse forge preview screen");
    }
  }, []);

  // Persist graphics to IndexedDB when they change
  const graphicsSaveRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (graphics.size === 0) return;
    // Debounce to avoid hammering IndexedDB during bulk imports
    clearTimeout(graphicsSaveRef.current);
    graphicsSaveRef.current = setTimeout(() => {
      saveGraphics(graphics).catch((err) =>
        console.error("Failed to save graphics to IndexedDB:", err),
      );
    }, 1000);
    return () => clearTimeout(graphicsSaveRef.current);
  }, [graphics]);

  // Build URL map for the renderer
  const graphicUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, g] of graphics) {
      map.set(name, g.url);
    }
    return map;
  }, [graphics]);


  /** AI-scan a graphic image to generate description, tags, and visual analysis */
  const scanGraphic = useCallback(
    async (name: string, dataUri: string): Promise<Partial<HmiGraphic>> => {
      try {
        // SVGs need to be rasterized — Claude vision only accepts raster images
        let rasterUri = dataUri;
        if (dataUri.startsWith("data:image/svg")) {
          rasterUri = await rasterizeSvg(dataUri);
        }

        // Extract media type and base64 data
        const mimeMatch = rasterUri.match(/data:(image\/[^;]+)/);
        const mediaType = (mimeMatch?.[1] ?? "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
        const base64Data = rasterUri.replace(/^data:[^;]+;base64,/, "");

        const userMessage = `Analyze this industrial HMI graphic for use in WinCC Comfort screen design.

Respond with EXACTLY this JSON format (no markdown, no wrapping):
{
  "description": "<one concise sentence: what equipment/object it depicts>",
  "tags": ["tag1", "tag2", "tag3"],
  "visual": {
    "shape": "<rectangular|circular|irregular|icon>",
    "orientation": "<landscape|portrait|square>",
    "background": "<transparent|dark|light|colored>",
    "style": "<flat|3d|schematic|photorealistic|outline>",
    "dominantColors": ["#hex1", "#hex2"],
    "suggestedUse": "<equipment-symbol|indicator|button-icon|background|label|decoration|diagram>",
    "suggestedSize": "<small|medium|large|full-width>",
    "pairsWith": ["type1", "type2"],
    "placementHint": "<brief placement guidance for screen layout>",
    "connectionPoints": [
      {"label": "<name>", "side": "<top|bottom|left|right>", "position": 0.5, "type": "<flow|electrical|mechanical|generic>"}
    ]
  }
}

Rules:
- tags: 3-6 specific searchable terms (e.g. "roller conveyor", "motor", "valve", not generic words)
- dominantColors: 2-4 most prominent hex colors in the image
- pairsWith: what other graphic types work visually with this (e.g. "pipes", "sensors", "conveyors")
- placementHint: where/how to position on a 1920x1080 HMI screen (e.g. "inline in process flow diagram", "small icon next to IO field")
- suggestedSize: small=under 64px, medium=64-200px, large=200-600px, full-width=600px+
- connectionPoints: identify where this graphic connects to other equipment/graphics. For conveyors: left-end, right-end. For valves: inlet, outlet. For motors: shaft, power. For pipes: each open end. For tanks: inlet, outlet, drain. "position" is 0.0-1.0 along that side (0.5=center). "type" is flow (material/fluid), electrical, mechanical, or generic. Omit if the graphic has no logical connection points (e.g. labels, backgrounds, indicators).`;

        // Call Edge Function via Supabase client (handles auth automatically)
        const { data: result, error: fnError } = await supabase.functions.invoke("generate", {
          body: {
            system_prompt:
              "You are an industrial HMI graphic analyzer. You classify visual properties of SCADA/HMI graphics for automated screen layout. Be precise about colors, shapes, and placement.",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mediaType,
                      data: base64Data,
                    },
                  },
                  {
                    type: "text",
                    text: userMessage,
                  },
                ],
              },
            ],
            max_tokens: 512,
          },
        });

        if (fnError) {
          console.error("[HMI Scan] Edge function error:", fnError);
          throw fnError;
        }

        const text = result?.content ?? "";
        console.log("[HMI Scan] Response for", name, ":", text.slice(0, 200));

        try {
          const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const parsed = JSON.parse(cleaned);
          return {
            description: parsed.description,
            tags: parsed.tags,
            visual: parsed.visual,
          };
        } catch {
          const descMatch = text.match(/description["\s:]+([^"]+)/i);
          const tagsMatch = text.match(/tags["\s:]+(\[.*?\])/is);
          return {
            description: descMatch?.[1]?.trim(),
            tags: tagsMatch ? JSON.parse(tagsMatch[1]) : undefined,
          };
        }
      } catch (err) {
        console.error(`[HMI Scan] Failed to scan graphic ${name}:`, err);
        return {};
      }
    },
    [],
  );

  /** Handle screens imported from TIA dialog */
  const handleTiaImportScreens = useCallback(
    (data: { screens: Record<string, string> }) => {
      const parsed = Object.entries(data.screens).map(([, xml]) =>
        parseScreenXml(xml),
      );
      if (parsed.length > 0) {
        setScreens(parsed);
        setActiveIdx(0);
      }
    },
    [],
  );

  /** Add a graphic from the WinCC library */
  const handleAddLibraryGraphic = useCallback(
    (graphic: HmiGraphic) => {
      setGraphics((prev) => {
        const next = new Map(prev);
        next.set(graphic.name, graphic);
        assignStateGroups(next);
        return next;
      });
    },
    [],
  );

  /** Update a graphic with scan results */
  const handleUpdateGraphic = useCallback(
    (name: string, patch: Partial<HmiGraphic>) => {
      setGraphics((prev) => {
        const next = new Map(prev);
        const existing = next.get(name);
        if (existing) next.set(name, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  /** Bulk-add all graphics from WinCC library */
  const handleAddAllLibraryGraphics = useCallback(
    (all: HmiGraphic[]) => {
      setGraphics((prev) => {
        const next = new Map(prev);
        for (const g of all) next.set(g.name, g);
        assignStateGroups(next);
        return next;
      });
    },
    [],
  );

  const updateScreen = (updated: HmiScreenSpec) => {
    setScreens((prev) =>
      prev.map((s, i) => (i === activeIdx ? updated : s)),
    );
  };

  /** Apply a template to the current screen */
  const handleApplyTemplate = useCallback(
    (template: HmiTemplate) => {
      const newScreen: HmiScreenSpec = {
        ...template.screen,
        id: screen.id,
        name: screen.name,
      };
      updateScreen(newScreen);
    },
    [screen.id, screen.name],
  );

  /** Save current screen as a template */
  const handleSaveTemplate = useCallback(
    async (meta: { name: string; category: HmiTemplateCategory; description: string; referenceDocIds: string[] }) => {
      const template: HmiTemplate = {
        id: `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: meta.name,
        category: meta.category,
        description: meta.description,
        screen: { ...screen },
        referenceDocIds: meta.referenceDocIds.length > 0 ? meta.referenceDocIds : undefined,
        createdAt: new Date().toISOString(),
      };
      await saveTemplate(template);
      setTemplates((prev) => [...prev, template]);
      setSaveTemplateOpen(false);
    },
    [screen],
  );

  /** Delete a template */
  const handleDeleteTemplate = useCallback(async (id: string) => {
    await deleteTemplateDb(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /** Import TIA screens as templates */
  const handleImportAsTemplates = useCallback(
    (imported: HmiScreenSpec[]) => {
      const newTemplates: HmiTemplate[] = imported.map((s) => ({
        id: `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: s.name,
        category: "custom" as const,
        description: `Imported from TIA Portal: ${s.name} (${s.width}x${s.height})`,
        screen: s,
        createdAt: new Date().toISOString(),
      }));
      for (const t of newTemplates) {
        saveTemplate(t).catch((err) => console.error("Failed to save template:", err));
      }
      setTemplates((prev) => [...prev, ...newTemplates]);
    },
    [],
  );

  /** Handle AI prompt for screen design */
  const handleAiPrompt = useCallback(
    async (prompt: string) => {
      setAiLoading(true);
      try {
        // Build context about available graphics (WinCC library)
        const libraryGraphicLines = [...graphics.values()]
          .slice(0, 200)
          .map((g) => {
            let info = g.name;
            if (g.category) info += ` (${g.category})`;
            if (g.description) info += ` — ${g.description}`;
            return info;
          });

        // Load AI-generated custom graphics from IndexedDB
        let generatedGraphicLines: string[] = [];
        try {
          const generated = await loadGeneratedGraphics();
          generatedGraphicLines = generated.flatMap((g) => {
            const lines: string[] = [];
            // Base graphic
            lines.push(`${g.name} (Generated/${g.category}) — ${g.description}`);
            // State variants — each is a separate usable graphic
            for (const state of Object.keys(g.stateVariants)) {
              lines.push(`${g.name}_${state} (Generated/${g.category}) — ${g.description} [state: ${state}]`);
            }
            return lines;
          });
        } catch {
          // IndexedDB may not be available
        }

        const graphicList = [...libraryGraphicLines, ...generatedGraphicLines].join("\n");
        console.log("[HMI AI] Graphics available:", libraryGraphicLines.length, "library +", generatedGraphicLines.length, "generated");
        if (generatedGraphicLines.length > 0) {
          console.log("[HMI AI] Generated graphics:", generatedGraphicLines);
        }

        // Build reference doc context if a design guide is selected
        // Cap at ~60K chars to leave room for the rest of the system prompt
        const GUIDE_CHAR_LIMIT = 60_000;
        let designGuideSection = "";
        if (refSections && refSections.length > 0) {
          const parts: string[] = [];
          let total = 0;
          for (const s of refSections) {
            const chunk = `### ${s.heading}\n${s.content}`;
            if (total + chunk.length > GUIDE_CHAR_LIMIT) break;
            parts.push(chunk);
            total += chunk.length;
          }
          if (parts.length > 0) {
            designGuideSection = `
## HMI Design Guide (from Reference Library)

Follow these design guidelines as your PRIMARY source for screen layout, colors, navigation, controls, and styling.
When the design guide specifies a pattern, use it. Only fall back to generic ISA-101 rules for aspects not covered by the guide.

${parts.join("\n\n---\n\n")}

---
`;
          }
        }

        const hmiIdentity = resolveSection(promptSections, "hmi_designer", "identity");
        const hmiInstructions = resolveSection(promptSections, "hmi_designer", "instructions");

        // Build graphics section — put it prominently before instructions
        let graphicsSection: string;
        if (graphicList) {
          graphicsSection = `## AVAILABLE GRAPHICS — YOU MUST USE THESE

The following graphics are available in the library. When the user mentions ANY equipment (conveyor, motor, valve, pump, tank, sensor, etc.), you MUST use a GRAPHIC_VIEW element with the EXACT graphicName from this list. Do NOT draw equipment using rectangles, circles, or text — use the graphic.

If a graphic has state variants (e.g., RollerConveyor_stopped, RollerConveyor_running), use GRAPHIC_IO_FIELD with an imageList mapping integer values to each variant.

${graphicList}`;
        } else {
          graphicsSection = "No graphics loaded in library. Draw equipment using shapes.";
        }

        const systemPrompt = `${hmiIdentity}

${graphicsSection}

${hmiInstructions}

Current screen: ${screen.width}x${screen.height}, background: ${screen.backgroundColor}
Existing elements: ${screen.elements.length}

${designGuideSection}

${libraryCatalog ? `## Available HMI Components (from TIA Library: ${libraryCatalog.libraryName})

The following pre-built components are available in the TIA Portal library. Use these as building blocks when designing screens.
Reference them by name in your design. When a suitable component exists, use it instead of building from scratch.
If no suitable component exists for a needed element, design a custom one following the same style patterns as the library components.

${libraryCatalog.items.map((item) => {
  let line = `- **${item.name}** (${item.kind})`;
  if (item.description) line += ` — ${item.description}`;
  return line;
}).join("\n")}
` : ""}`;

        const response = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: prompt }],
          AbortSignal.timeout(180_000),
          16384,
        );

        const text = response.content;

        const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          // Try to repair truncated JSON — find last complete element object
          const lastComplete = cleaned.lastIndexOf("}");
          if (lastComplete > 0) {
            // Close any open arrays/objects
            let repaired = cleaned.slice(0, lastComplete + 1);
            // Count unclosed brackets
            let openBrackets = 0;
            let openBraces = 0;
            for (const ch of repaired) {
              if (ch === "[") openBrackets++;
              else if (ch === "]") openBrackets--;
              else if (ch === "{") openBraces++;
              else if (ch === "}") openBraces--;
            }
            repaired += "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));
            parsed = JSON.parse(repaired);
            console.warn("[HMI AI] Repaired truncated JSON, some elements may be missing");
          } else {
            throw new Error("AI response was not valid JSON");
          }
        }

        if (parsed.elements && Array.isArray(parsed.elements)) {
          // Auto-register any generated graphics referenced by the AI
          try {
            const generated = await loadGeneratedGraphics();
            const referencedNames = new Set(
              parsed.elements
                .map((el: Record<string, unknown>) => el.graphicName)
                .filter((n: unknown): n is string => typeof n === "string"),
            );

            if (referencedNames.size > 0 && generated.length > 0) {
              setGraphics((prev) => {
                const next = new Map(prev);
                for (const g of generated) {
                  // Register base graphic if referenced
                  if (referencedNames.has(g.name) && !next.has(g.name)) {
                    next.set(g.name, {
                      name: g.name,
                      url: svgToDataUri(g.baseSvg),
                      category: `Generated/${g.category}`,
                      description: g.description,
                      tags: g.tags,
                    });
                  }
                  // Register state variants if referenced
                  for (const [state, svg] of Object.entries(g.stateVariants)) {
                    const variantName = `${g.name}_${state}`;
                    if (referencedNames.has(variantName) && !next.has(variantName)) {
                      next.set(variantName, {
                        name: variantName,
                        url: svgToDataUri(svg),
                        category: `Generated/${g.category}`,
                        description: `${g.description} (${state})`,
                        tags: [...g.tags, state],
                      });
                    }
                  }
                }
                return next;
              });
            }
          } catch {
            // IndexedDB may not be available
          }

          const maxZ = screen.elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
          const newElements: HmiElement[] = parsed.elements.map((el: Record<string, unknown>, i: number) => ({
            id: `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            type: (typeof el.type === "string" ? el.type : "RECTANGLE") as HmiElementType,
            name: (typeof el.name === "string" ? el.name : `Element_${i + 1}`),
            x: Number(el.x) || 0,
            y: Number(el.y) || 0,
            width: Number(el.width) || 100,
            height: Number(el.height) || 50,
            zIndex: maxZ + i + 1,
            style: (el.style ?? {}) as HmiElementStyle,
            text: el.text as string | undefined,
            graphicName: el.graphicName as string | undefined,
            tagBinding: el.tagBinding as string | undefined,
            tagBindingSpec: el.tagBindingSpec as HmiElement["tagBindingSpec"],
            navigateTo: el.navigateTo as string | undefined,
            imageList: Array.isArray(el.imageList) ? el.imageList as Array<{ value: number; graphicName: string }> : undefined,
            events: Array.isArray(el.events) ? el.events as HmiElement["events"] : undefined,
            animations: Array.isArray(el.animations) ? el.animations as HmiElement["animations"] : undefined,
            textListRef: el.textListRef as HmiElement["textListRef"],
            graphicListRef: el.graphicListRef as HmiElement["graphicListRef"],
            faceplateTypeName: el.faceplateTypeName as string | undefined,
            faceplateProperties: Array.isArray(el.faceplateProperties) ? el.faceplateProperties as HmiElement["faceplateProperties"] : undefined,
            tooltip: el.tooltip as string | undefined,
            valueMin: typeof el.valueMin === "number" ? el.valueMin : undefined,
            valueMax: typeof el.valueMax === "number" ? el.valueMax : undefined,
            trendTags: Array.isArray(el.trendTags) ? el.trendTags as HmiElement["trendTags"] : undefined,
            dateTimeFormat: el.dateTimeFormat as string | undefined,
            // Extended properties (Tier 2)
            orientation: el.orientation as HmiElement["orientation"],
            ioFieldMode: el.ioFieldMode as HmiElement["ioFieldMode"],
            ioFieldFormat: el.ioFieldFormat as HmiElement["ioFieldFormat"],
            ioFieldDecimalPlaces: typeof el.ioFieldDecimalPlaces === "number" ? el.ioFieldDecimalPlaces : undefined,
            buttonMode: el.buttonMode as HmiElement["buttonMode"],
            pipeDirection: el.pipeDirection as HmiElement["pipeDirection"],
            pipeDiameter: typeof el.pipeDiameter === "number" ? el.pipeDiameter : undefined,
            screenWindowName: el.screenWindowName as string | undefined,
            screenWindowModal: typeof el.screenWindowModal === "boolean" ? el.screenWindowModal : undefined,
            clockType: el.clockType as HmiElement["clockType"],
            graphicSizeMode: el.graphicSizeMode as HmiElement["graphicSizeMode"],
            barShowScale: typeof el.barShowScale === "boolean" ? el.barShowScale : undefined,
            barScaleDivisions: typeof el.barScaleDivisions === "number" ? el.barScaleDivisions : undefined,
            barFillColor: el.barFillColor as string | undefined,
            gaugeStartAngle: typeof el.gaugeStartAngle === "number" ? el.gaugeStartAngle : undefined,
            gaugeEndAngle: typeof el.gaugeEndAngle === "number" ? el.gaugeEndAngle : undefined,
            gaugeTicks: typeof el.gaugeTicks === "number" ? el.gaugeTicks : undefined,
            gaugeShowLabels: typeof el.gaugeShowLabels === "boolean" ? el.gaugeShowLabels : undefined,
            gaugeNeedleColor: el.gaugeNeedleColor as string | undefined,
            trendShowToolbar: typeof el.trendShowToolbar === "boolean" ? el.trendShowToolbar : undefined,
            trendShowLegend: typeof el.trendShowLegend === "boolean" ? el.trendShowLegend : undefined,
            trendAutoScale: typeof el.trendAutoScale === "boolean" ? el.trendAutoScale : undefined,
            trendYMin: typeof el.trendYMin === "number" ? el.trendYMin : undefined,
            trendYMax: typeof el.trendYMax === "number" ? el.trendYMax : undefined,
            trendShowGrid: typeof el.trendShowGrid === "boolean" ? el.trendShowGrid : undefined,
            alarmFilter: el.alarmFilter as string | undefined,
            alarmColumns: Array.isArray(el.alarmColumns) ? el.alarmColumns as HmiElement["alarmColumns"] : undefined,
            alarmSortColumn: el.alarmSortColumn as string | undefined,
            alarmSortDirection: el.alarmSortDirection as HmiElement["alarmSortDirection"],
            alarmShowAcknowledged: typeof el.alarmShowAcknowledged === "boolean" ? el.alarmShowAcknowledged : undefined,
            alarmMaxRows: typeof el.alarmMaxRows === "number" ? el.alarmMaxRows : undefined,
            multilingualText: Array.isArray(el.multilingualText) ? el.multilingualText as HmiElement["multilingualText"] : undefined,
            accessLevel: el.accessLevel as HmiElement["accessLevel"],
          }));
          updateScreen({
            ...screen,
            elements: [...screen.elements, ...newElements],
          });
        }
      } catch (err) {
        console.error("[HMI AI] Design failed:", err);
      } finally {
        setAiLoading(false);
      }
    },
    [screen, graphics, refSections, libraryCatalog, promptSections],
  );

  /** Handle a generated SVG graphic being saved */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleGeneratedGraphicSaved = useCallback(
    (_graphic: GeneratedSvgGraphic) => {
      setGeneratedGraphicsRefreshKey((k) => k + 1);
    },
    [],
  );

  /** Add a generated SVG graphic to the canvas */
  const handleAddGeneratedToCanvas = useCallback(
    (graphic: GeneratedSvgGraphic, stateName?: string) => {
      const stateEntries = Object.entries(graphic.stateVariants);
      const hasStates = stateEntries.length > 0;

      // If a specific state was clicked, add as a single static GRAPHIC_VIEW
      if (stateName) {
        const svg = graphic.stateVariants[stateName] ?? graphic.baseSvg;
        const dataUri = svgToDataUri(svg);
        const graphicName = `${graphic.name}_${stateName}`;

        setGraphics((prev) => {
          const next = new Map(prev);
          next.set(graphicName, {
            name: graphicName,
            url: dataUri,
            category: `Generated/${graphic.category}`,
            description: graphic.description,
            tags: graphic.tags,
          });
          return next;
        });

        const maxZ = screen.elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
        const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newElement: HmiElement = {
          id,
          type: "GRAPHIC_VIEW" as HmiElementType,
          name: graphicName,
          x: Math.round(screen.width / 2 - 40),
          y: Math.round(screen.height / 2 - 40),
          width: 80,
          height: 80,
          zIndex: maxZ + 1,
          style: {},
          graphicName,
        };
        updateScreen({ ...screen, elements: [...screen.elements, newElement] });
        return;
      }

      // Add base as "Add to canvas" — if states exist, create a GRAPHIC_IO_FIELD
      // Register all state variant SVGs as graphics in the library
      const imageList: Array<{ value: number; graphicName: string }> = [];

      setGraphics((prev) => {
        const next = new Map(prev);
        // Register base graphic
        next.set(graphic.name, {
          name: graphic.name,
          url: svgToDataUri(graphic.baseSvg),
          category: `Generated/${graphic.category}`,
          description: graphic.description,
          tags: graphic.tags,
        });

        if (hasStates) {
          // Register each state variant and build image list
          stateEntries.forEach(([state, svg], idx) => {
            const variantName = `${graphic.name}_${state}`;
            next.set(variantName, {
              name: variantName,
              url: svgToDataUri(svg),
              category: `Generated/${graphic.category}`,
              description: `${graphic.description} (${state})`,
              tags: [...graphic.tags, state],
            });
            imageList.push({ value: idx, graphicName: variantName });
          });
        }
        return next;
      });

      const maxZ = screen.elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
      const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      if (hasStates) {
        // Place as GRAPHIC_IO_FIELD with image list for state switching
        const newElement: HmiElement = {
          id,
          type: "GRAPHIC_IO_FIELD" as HmiElementType,
          name: graphic.name,
          x: Math.round(screen.width / 2 - 40),
          y: Math.round(screen.height / 2 - 40),
          width: 80,
          height: 80,
          zIndex: maxZ + 1,
          style: {},
          graphicName: imageList[0]?.graphicName ?? graphic.name,
          imageList,
          tagBinding: "",
        };
        updateScreen({ ...screen, elements: [...screen.elements, newElement] });
      } else {
        // No states — simple GRAPHIC_VIEW
        const newElement: HmiElement = {
          id,
          type: "GRAPHIC_VIEW" as HmiElementType,
          name: graphic.name,
          x: Math.round(screen.width / 2 - 40),
          y: Math.round(screen.height / 2 - 40),
          width: 80,
          height: 80,
          zIndex: maxZ + 1,
          style: {},
          graphicName: graphic.name,
        };
        updateScreen({ ...screen, elements: [...screen.elements, newElement] });
      }
    },
    [screen],
  );

  /** Export screen as SimaticML XML + tag table */
  const handleExportXml = useCallback(() => {
    const downloadXml = (content: string, filename: string) => {
      const blob = new Blob([content], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };

    // Download screen XML
    downloadXml(buildScreenXml(screen), `${screen.name}.xml`);

    // Download tag table XML if there are tags
    const tags = extractTagBindings(screen);
    if (tags.length > 0) {
      downloadXml(buildTagTableXml(`${screen.name}_Tags`, tags), `${screen.name}_Tags.xml`);
    }

    // Download alarm definitions XML if present
    if (screen.alarmDefinitions && screen.alarmDefinitions.length > 0) {
      downloadXml(buildAlarmXml(screen.alarmDefinitions), `${screen.name}_Alarms.xml`);
    }
  }, [screen]);

  /** Export current screen as a faceplate type definition */
  const handleExportFaceplate = useCallback(() => {
    // Collect faceplate interface properties from all faceplate elements
    const allProps = screen.elements
      .filter((el) => el.faceplateProperties && el.faceplateProperties.length > 0)
      .flatMap((el) => el.faceplateProperties!);

    const xml = buildFaceplateTypeXml(
      `FP_${screen.name}`,
      screen,
      allProps,
    );

    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FP_${screen.name}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [screen]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex shrink-0 items-end justify-between px-4 pt-3 pb-2">
        <div>
          <div className="text-sm text-muted-foreground">HMI</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Monitor className="h-6 w-6" />
            Screen Editor
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Screen selector */}
          {screens.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 font-mono"
                >
                  {screen.name}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-80 overflow-y-auto"
              >
                {screens.map((s, i) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setActiveIdx(i)}
                    className={i === activeIdx ? "bg-accent" : ""}
                  >
                    <span className="font-mono text-xs">{s.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {s.elements.length} el
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Export XML */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={screen.elements.length === 0}
              >
                <Download className="h-3.5 w-3.5" />
                Export
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportXml}>
                Screen XML + Tag Table
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportFaceplate}>
                Faceplate Type XML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Design Guide selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={selectedRefDocId ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {selectedRefDocId
                  ? refDocs?.find((d) => d.id === selectedRefDocId)?.title ?? "Design Guide"
                  : "Design Guide"}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              <DropdownMenuItem
                onClick={() => setSelectedRefDocId(null)}
                className={!selectedRefDocId ? "bg-accent" : ""}
              >
                <span className="text-xs text-muted-foreground">None (generic rules)</span>
              </DropdownMenuItem>
              {refDocs?.map((doc) => (
                <DropdownMenuItem
                  key={doc.id}
                  onClick={() => setSelectedRefDocId(doc.id)}
                  className={doc.id === selectedRefDocId ? "bg-accent" : ""}
                >
                  <span className="flex items-center gap-2 text-xs">
                    {doc.id === selectedRefDocId && <Check className="h-3 w-3" />}
                    {doc.title}
                  </span>
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {doc.section_count}s
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Separator />
      <div className="min-h-0 flex-1">
        <HmiScreenEditor
          screen={screen}
          onChange={updateScreen}
          graphicUrls={graphicUrls}
          graphics={graphics}
          templates={templates}
          onApplyTemplate={handleApplyTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onAiPrompt={handleAiPrompt}
          aiLoading={aiLoading}
          scanGraphic={scanGraphic}
          onUpdateGraphic={handleUpdateGraphic}
          onOpenWinccLibrary={() => setLibraryDialogOpen(true)}
          onOpenTiaLibrary={() => setTiaLibraryOpen(true)}
          onOpenTiaImport={() => setTiaDialogOpen(true)}
          onSaveTemplate={() => setSaveTemplateOpen(true)}
          canSaveTemplate={screen.elements.length > 0}
          libraryCatalog={libraryCatalog}
          onOpenSvgGenerator={() => { setVariantOfGraphic(null); setSvgGeneratorOpen(true); }}
          onAddGeneratedToCanvas={handleAddGeneratedToCanvas}
          generatedGraphicsRefreshKey={generatedGraphicsRefreshKey}
          onCreateVariant={(g: GeneratedSvgGraphic) => { setVariantOfGraphic(g); setSvgGeneratorOpen(true); }}
        />
      </div>

      <TiaImportDialog
        open={tiaDialogOpen}
        onOpenChange={setTiaDialogOpen}
        onImportScreens={handleTiaImportScreens}
        onImportAsTemplates={handleImportAsTemplates}
      />

      <WinccGraphicsLibrary
        open={libraryDialogOpen}
        onOpenChange={setLibraryDialogOpen}
        onAddGraphic={handleAddLibraryGraphic}
        onAddAll={handleAddAllLibraryGraphics}
        scanGraphic={scanGraphic}
      />

      <SaveTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        onSave={handleSaveTemplate}
        screenName={screen.name}
      />

      <TiaLibraryDialog
        open={tiaLibraryOpen}
        onOpenChange={setTiaLibraryOpen}
        onSaveCatalog={(catalog) => {
          setLibraryCatalog(catalog);
          saveTiaCatalog(catalog).catch((err) =>
            console.error("Failed to save TIA catalog to IndexedDB:", err),
          );
        }}
        currentCatalog={libraryCatalog}
      />

      <SvgGeneratorDialog
        open={svgGeneratorOpen}
        onOpenChange={setSvgGeneratorOpen}
        onGraphicSaved={handleGeneratedGraphicSaved}
        variantOf={variantOfGraphic}
        promptSections={promptSections}
      />
    </div>
  );
}

/** Rasterize an SVG data URI to PNG for Claude vision API */
function rasterizeSvg(svgDataUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Use a reasonable size for AI analysis
      const size = 256;
      const scale = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size), 1);
      canvas.width = Math.max(1, Math.round((img.naturalWidth || size) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || size) * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No canvas context")); return; }
      // White background so transparency is visible
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load SVG for rasterization"));
    img.src = svgDataUri;
  });
}
