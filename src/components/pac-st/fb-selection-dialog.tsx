import { useEffect, useState } from "react";
import { Loader2, Layers, Check, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useAiFbSelection } from "@/hooks/use-fb-selection";
import type { FbTemplate, IoEntry } from "@/types";

interface Props {
  open: boolean;
  userMessage: string;
  ioList: IoEntry[];
  availableTemplates: FbTemplate[];
  onConfirm: (selectedIds: string[]) => void;
  onSkip: () => void;
}

export function FbSelectionDialog({
  open,
  userMessage,
  ioList,
  availableTemplates,
  onConfirm,
  onSkip,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [aiDone, setAiDone] = useState(false);

  const aiSelection = useAiFbSelection();

  // Run AI selection when dialog opens
  useEffect(() => {
    if (!open || availableTemplates.length === 0) return;

    setAiDone(false);
    setSelectedIds(new Set());

    aiSelection.mutate(
      { userMessage, ioList, templates: availableTemplates },
      {
        onSuccess: (result) => {
          setSelectedIds(new Set(result.selected));
          setAiDone(true);
        },
        onError: () => {
          setAiDone(true);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleTemplate(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectRecommended() {
    if (aiSelection.data) {
      setSelectedIds(new Set(aiSelection.data.selected));
    }
  }

  function selectAll() {
    setSelectedIds(new Set(availableTemplates.map((t) => t.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  // Group templates by category
  const byCategory = new Map<string, FbTemplate[]>();
  for (const t of availableTemplates) {
    const cat = t.device_category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t);
  }

  const isLoading = aiSelection.isPending;
  const aiRecommendedIds = new Set(aiSelection.data?.selected ?? []);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono">
            <Layers className="h-4 w-4" />
            Select FB Templates
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Choose which company-standard templates to include in this generation.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="font-mono text-xs text-muted-foreground">
              AI is analyzing which templates match your request...
            </p>
          </div>
        ) : (
          <>
            {/* AI reasoning */}
            {aiDone && aiSelection.data?.reasoning && (
              <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                <div className="flex items-center gap-1.5 font-mono text-xs text-blue-400">
                  <Sparkles className="h-3 w-3" />
                  AI Recommendation
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {aiSelection.data.reasoning}
                </p>
              </div>
            )}

            {/* Quick actions */}
            <div className="flex gap-1.5">
              {aiSelection.data && aiSelection.data.selected.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 font-mono text-xs"
                  onClick={selectRecommended}
                >
                  Use Recommended
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 font-mono text-xs"
                onClick={selectAll}
              >
                Use All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 font-mono text-xs"
                onClick={selectNone}
              >
                Use None
              </Button>
            </div>

            {/* Template list */}
            <ScrollArea className="max-h-[320px]">
              <div className="space-y-3 pr-3">
                {Array.from(byCategory.entries()).map(([category, templates]) => (
                  <div key={category}>
                    <div className="mb-1 font-mono text-xs font-semibold text-muted-foreground uppercase">
                      {category}
                    </div>
                    <div className="space-y-1">
                      {templates.map((t) => {
                        const isSelected = selectedIds.has(t.id);
                        const isRecommended = aiRecommendedIds.has(t.id);
                        const blockCount = t.blocks?.length ?? 0;

                        return (
                          <label
                            key={t.id}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2 transition-colors ${
                              isSelected
                                ? "border-accent bg-accent/20"
                                : "border-transparent hover:bg-accent/10"
                            }`}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleTemplate(t.id)}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-mono text-sm font-medium">
                                  {t.name}
                                </span>
                                {isRecommended && (
                                  <Badge
                                    variant="secondary"
                                    className="h-4 gap-0.5 px-1 font-mono text-[10px] text-blue-400"
                                  >
                                    <Sparkles className="h-2 w-2" />
                                    AI
                                  </Badge>
                                )}
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 font-mono text-[10px]"
                                >
                                  {blockCount} block{blockCount !== 1 ? "s" : ""}
                                </Badge>
                              </div>
                              {t.description && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                  {t.description}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs"
            onClick={onSkip}
            disabled={isLoading}
          >
            Skip (no templates)
          </Button>
          <Button
            size="sm"
            className="gap-1 font-mono text-xs"
            onClick={() => onConfirm(Array.from(selectedIds))}
            disabled={isLoading}
          >
            <Check className="h-3 w-3" />
            Confirm ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
