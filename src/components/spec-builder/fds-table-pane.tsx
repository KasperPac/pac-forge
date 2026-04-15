/**
 * FDS Co-Author — Live-updating table pane for sequential states.
 * Shows permissives + step table, editable inline.
 * Tabs across the top for each sequential state.
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, GripVertical } from "lucide-react";
import type { OperatingState, SequentialStateData, StepEntry } from "@/types/spec-builder";
import { cn } from "@/lib/utils";

interface Props {
  sequentialStates: OperatingState[];
  stateData: Record<string, SequentialStateData>;
  onUpdateState: (stateId: string, data: SequentialStateData) => void;
}

const EMPTY_STATE: SequentialStateData = {
  permissives: [],
  steps: [],
  notes: null,
};

export function FdsTablePane({ sequentialStates, stateData, onUpdateState }: Props) {
  const [activeTab, setActiveTab] = useState(sequentialStates[0]?.state_id ?? "");

  const currentData = stateData[activeTab] ?? EMPTY_STATE;

  const update = useCallback(
    (patch: Partial<SequentialStateData>) => {
      onUpdateState(activeTab, { ...currentData, ...patch });
    },
    [activeTab, currentData, onUpdateState],
  );

  // --- Permissive handlers ---
  const addPermissive = () => update({ permissives: [...currentData.permissives, ""] });

  const updatePermissive = (idx: number, value: string) => {
    const next = [...currentData.permissives];
    next[idx] = value;
    update({ permissives: next });
  };

  const removePermissive = (idx: number) => {
    update({ permissives: currentData.permissives.filter((_, i) => i !== idx) });
  };

  // --- Step handlers ---
  const addStep = () => {
    update({
      steps: [
        ...currentData.steps,
        { step: currentData.steps.length + 1, action: "", completion_criteria: "" },
      ],
    });
  };

  const updateStep = (idx: number, patch: Partial<StepEntry>) => {
    const next = currentData.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    update({ steps: next });
  };

  const removeStep = (idx: number) => {
    const next = currentData.steps
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, step: i + 1 })); // renumber
    update({ steps: next });
  };

  return (
    <div className="flex flex-col h-full">
      {/* State tabs */}
      <div className="flex gap-1 border-b px-2 shrink-0">
        {sequentialStates.map((state) => {
          const data = stateData[state.state_id];
          const stepCount = data?.steps?.length ?? 0;
          return (
            <button
              key={state.state_id}
              onClick={() => setActiveTab(state.state_id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium border-b-2 transition-colors",
                activeTab === state.state_id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {state.state_name}
              {stepCount > 0 && (
                <Badge variant="outline" className="ml-1.5 text-[9px] h-3.5 px-1">
                  {stepCount}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Permissives */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold">Permissives</label>
            <Button size="sm" variant="outline" onClick={addPermissive} className="h-6 text-[10px]">
              <Plus className="h-3 w-3 mr-0.5" /> Add
            </Button>
          </div>
          {currentData.permissives.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic px-1">
              No permissives defined. Add conditions that must be TRUE before this sequence can begin.
            </p>
          ) : (
            <div className="space-y-1">
              {currentData.permissives.map((perm, i) => (
                <div key={i} className="flex gap-1">
                  <Input
                    className="h-7 text-xs font-mono"
                    value={perm}
                    onChange={(e) => updatePermissive(i, e.target.value)}
                    placeholder="e.g. ESTOP_01 = TRUE (E-Stop not active)"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removePermissive(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step table */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold">Steps</label>
            <Button size="sm" variant="outline" onClick={addStep} className="h-6 text-[10px]">
              <Plus className="h-3 w-3 mr-0.5" /> Add Step
            </Button>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-mono font-normal w-10">#</th>
                  <th className="p-2 text-left font-mono font-normal">Action</th>
                  <th className="p-2 text-left font-mono font-normal">Completion Criteria</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {currentData.steps.map((step, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-1 text-center">
                      <span className="font-mono font-bold text-muted-foreground">{step.step}</span>
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs"
                        value={step.action}
                        onChange={(e) => updateStep(i, { action: e.target.value })}
                        placeholder="e.g. Energise motor LFT01_M01_CMD"
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        className="h-7 text-xs"
                        value={step.completion_criteria}
                        onChange={(e) => updateStep(i, { completion_criteria: e.target.value })}
                        placeholder="e.g. LFT01_M01_FB = TRUE within 3s, else fault"
                      />
                    </td>
                    <td className="p-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeStep(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {currentData.steps.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-muted-foreground">
                      No steps defined. Use the chat to describe the sequence, or add steps manually.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Notes */}
        {currentData.notes && (
          <div className="text-[11px] text-muted-foreground italic px-1">
            Note: {currentData.notes}
          </div>
        )}
      </div>
    </div>
  );
}
