/**
 * Process Model Panel — ISA-88 §4.3 product-centric process view.
 * Displays and allows AI-driven authoring of the Process Model hierarchy:
 * Process → Process Stage → Process Operation → Process Action.
 */
import { useState, useCallback } from "react";
import {
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Layers,
  Save,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  useProcessModelGenerate,
  useSaveProcessModel,
} from "@/hooks/use-process-model";
import type {
  SpecProject,
  ProcessModel,
  ProcessStage,
  UnitConfig,
} from "@/types/spec-builder";
import { cn } from "@/lib/utils";

interface Props {
  spec: SpecProject;
}

export function ProcessModelPanel({ spec }: Props) {
  const { generate, loading, error } = useProcessModelGenerate();
  const saveModel = useSaveProcessModel();

  const [model, setModel] = useState<ProcessModel | null>(
    spec.process_model ?? null,
  );
  const [userPrompt, setUserPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const units = spec.confirmed_units ?? [];

  const handleGenerate = useCallback(async () => {
    const result = await generate(
      units,
      spec.system_description,
      model,
      userPrompt.trim() || undefined,
    );
    setModel(result);
    setDirty(true);
    setUserPrompt("");
  }, [generate, units, spec.system_description, model, userPrompt]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveModel(spec.id, model);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [saveModel, spec.id, model]);

  const handleClear = useCallback(async () => {
    setModel(null);
    setDirty(true);
  }, []);

  // Build unit lookup for display
  const unitMap = new Map(units.map((u) => [u.unit_id, u]));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Process Model</span>
        <Badge variant="outline" className="text-[10px]">ISA-88 §4.3</Badge>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>
          )}
          {model && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleClear}
                disabled={loading || saving}
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleSave}
                disabled={saving || !dirty}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Error */}
          {error && (
            <Card className="border-destructive/50 bg-destructive/10 p-3">
              <p className="text-xs text-destructive">{error}</p>
            </Card>
          )}

          {/* Empty state */}
          {!model && !loading && (
            <Card className="p-6 text-center space-y-3">
              <Layers className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium">No Process Model yet</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                The Process Model describes what happens to the product (ISA-88
                §4.3). It maps Process Stages to Units and Process Operations to
                Equipment Modules.
              </p>
            </Card>
          )}

          {/* Model tree */}
          {model && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold font-mono">
                  {model.process_name}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {model.process_description}
                </p>
              </div>

              <div className="space-y-2">
                {model.stages
                  .sort((a, b) => a.order - b.order)
                  .map((stage) => (
                    <StageCard
                      key={stage.stage_id}
                      stage={stage}
                      unit={unitMap.get(stage.unit_id)}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">
                Generating Process Model…
              </span>
            </div>
          )}

          {/* Generate / refine input */}
          <Card className="p-3 space-y-2">
            <Textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder={
                model
                  ? "Describe changes to the Process Model…"
                  : "Optional: describe what the product goes through…"
              }
              className="min-h-[60px] text-xs resize-none"
              disabled={loading}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleGenerate}
                disabled={loading || units.length === 0}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {model ? "Refine" : "Generate"} Process Model
              </Button>
            </div>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StageCard({
  stage,
  unit,
}: {
  stage: ProcessStage;
  unit?: UnitConfig;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
          Stage {stage.order}
        </Badge>
        <span className="text-sm font-medium truncate">
          {stage.stage_name}
        </span>
        {unit && (
          <Badge
            variant="secondary"
            className="text-[10px] ml-auto shrink-0"
          >
            {unit.unit_name}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            {stage.description}
          </p>

          {stage.operations.map((op) => (
            <div
              key={op.operation_id}
              className={cn(
                "ml-4 pl-3 border-l-2 border-muted space-y-1",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  {op.operation_name}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono"
                >
                  {op.equipment_module_id}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {op.description}
              </p>

              {op.actions.length > 0 && (
                <div className="ml-3 space-y-0.5">
                  {op.actions.map((action) => (
                    <div
                      key={action.action_id}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="text-muted-foreground">›</span>
                      <span>{action.action_name}</span>
                      {action.control_module_tag && (
                        <Badge
                          variant="outline"
                          className="text-[9px] font-mono"
                        >
                          {action.control_module_tag}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
