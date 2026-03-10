import { useState, useEffect, useCallback } from "react";
import {
  Trash2,
  Search,
  ChevronRight,
  ChevronDown,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SVG_GRAPHIC_CATEGORIES } from "@/lib/hmi-svg-generator";
import type {
  GeneratedSvgGraphic,
  SvgGraphicCategory,
} from "@/lib/hmi-svg-generator";
import {
  loadGeneratedGraphics,
  deleteGeneratedGraphic,
} from "@/lib/hmi-generated-graphics-db";

interface GeneratedGraphicsPanelProps {
  onAddToCanvas: (graphic: GeneratedSvgGraphic, stateName?: string) => void;
  /** Incremented externally when a new graphic is saved to trigger reload */
  refreshKey?: number;
  /** Callback to create a variant of an existing graphic */
  onCreateVariant?: (graphic: GeneratedSvgGraphic) => void;
}

export function GeneratedGraphicsPanel({
  onAddToCanvas,
  refreshKey,
  onCreateVariant,
}: GeneratedGraphicsPanelProps) {
  const [graphics, setGraphics] = useState<GeneratedSvgGraphic[]>([]);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadGeneratedGraphics().then(setGraphics).catch(console.error);
  }, [refreshKey]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteGeneratedGraphic(id);
    setGraphics((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const filtered = search.trim()
    ? graphics.filter(
        (g) =>
          g.name.toLowerCase().includes(search.toLowerCase()) ||
          g.description.toLowerCase().includes(search.toLowerCase()) ||
          g.tags.some((t) => t.includes(search.toLowerCase())),
      )
    : graphics;

  // Group by category
  const byCategory = new Map<SvgGraphicCategory, GeneratedSvgGraphic[]>();
  for (const g of filtered) {
    const list = byCategory.get(g.category) ?? [];
    list.push(g);
    byCategory.set(g.category, list);
  }

  if (graphics.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground">
        <p>No generated graphics yet.</p>
        <p>Use the Generate button to create custom SVG graphics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search generated graphics..."
          className="h-7 pl-7 text-xs"
        />
      </div>

      <ScrollArea className="h-[300px]">
        <div className="space-y-1 pr-2">
          {[...byCategory.entries()].map(([cat, items]) => (
            <div key={cat}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {SVG_GRAPHIC_CATEGORIES[cat]} ({items.length})
              </div>
              {items.map((g) => {
                const isExpanded = expandedId === g.id;
                return (
                  <div
                    key={g.id}
                    className="mb-1 rounded-md border border-border/50"
                  >
                    <div
                      className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-accent/50"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : g.id)
                      }
                    >
                      <div
                        className="h-8 w-8 shrink-0 rounded border bg-slate-900 p-0.5"
                        dangerouslySetInnerHTML={{ __html: g.baseSvg }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {g.name}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {Object.keys(g.stateVariants).length} states
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="space-y-2 border-t px-2 py-2">
                        <p className="text-[10px] text-muted-foreground">
                          {g.description}
                        </p>

                        {/* State previews */}
                        <div className="grid grid-cols-4 gap-1">
                          {Object.entries(g.stateVariants).map(
                            ([state, svg]) => (
                              <Tooltip key={state}>
                                <TooltipTrigger asChild>
                                  <button
                                    className="flex flex-col items-center gap-0.5 rounded border bg-slate-900 p-1 hover:border-primary/50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAddToCanvas(g, state);
                                    }}
                                  >
                                    <div
                                      className="h-6 w-6"
                                      dangerouslySetInnerHTML={{
                                        __html: svg,
                                      }}
                                    />
                                    <span className="text-[8px] text-muted-foreground">
                                      {state}
                                    </span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  className="text-xs"
                                >
                                  Add {g.name} ({state}) to canvas
                                </TooltipContent>
                              </Tooltip>
                            ),
                          )}
                        </div>

                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 flex-1 text-[10px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToCanvas(g);
                            }}
                          >
                            Add Base to Canvas
                          </Button>
                          {onCreateVariant && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCreateVariant(g);
                                  }}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">
                                Create variant
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(g.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
