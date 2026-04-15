/**
 * FDS Co-Author — Static state review and confirmation.
 * Shows auto-filled device state tables for all static states.
 * Engineer can edit values before confirming.
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { autoFillStaticStates } from "@/lib/spec-builder/fds-auto-fill";
import type {
  AssemblyConfig,
  OperatingState,
  InstrumentTag,
  DeviceStateEntry,
} from "@/types/spec-builder";
import { cn } from "@/lib/utils";

interface Props {
  assembly: AssemblyConfig;
  staticStates: OperatingState[];
  allTags: InstrumentTag[];
  currentStaticStates: Record<string, DeviceStateEntry[]>;
  onConfirm: (states: Record<string, DeviceStateEntry[]>) => void;
  confirming?: boolean;
  alreadyConfirmed?: boolean;
}

export function FdsStaticReview({
  assembly,
  staticStates,
  allTags,
  currentStaticStates,
  onConfirm,
  confirming,
  alreadyConfirmed,
}: Props) {
  // Auto-fill as starting point, merge with any existing data
  const autoFilled = useMemo(
    () => autoFillStaticStates(assembly, staticStates, allTags),
    [assembly, staticStates, allTags],
  );

  const [editableStates, setEditableStates] = useState<Record<string, DeviceStateEntry[]>>(() => {
    // Use existing data if available, otherwise auto-fill
    const result: Record<string, DeviceStateEntry[]> = {};
    for (const state of staticStates) {
      result[state.state_id] = currentStaticStates[state.state_id]?.length
        ? currentStaticStates[state.state_id]
        : autoFilled[state.state_id] ?? [];
    }
    return result;
  });

  const [activeTab, setActiveTab] = useState(staticStates[0]?.state_id ?? "");

  const updateEntry = (stateId: string, idx: number, patch: Partial<DeviceStateEntry>) => {
    setEditableStates((prev) => ({
      ...prev,
      [stateId]: prev[stateId].map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }));
  };

  const resetToAutoFill = () => {
    setEditableStates(autoFilled);
  };

  const entries = editableStates[activeTab] ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Static State Review</h3>
          <p className="text-xs text-muted-foreground">
            Confirm output states for {assembly.assembly_name}. Every DO/AO tag must have an explicit state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetToAutoFill}>
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset to Auto-fill
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(editableStates)}
            disabled={confirming || alreadyConfirmed}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            {alreadyConfirmed ? "Confirmed" : confirming ? "Saving..." : "Confirm Static States"}
          </Button>
        </div>
      </div>

      {/* State tabs */}
      <div className="flex gap-1 border-b">
        {staticStates.map((state) => (
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
            <Badge variant="outline" className="ml-1.5 text-[9px] h-3.5 px-1">
              {(editableStates[state.state_id] ?? []).length}
            </Badge>
          </button>
        ))}
      </div>

      {/* Device state table */}
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2 text-left font-mono font-normal w-1/4">Tag</th>
              <th className="p-2 text-left font-mono font-normal">Description</th>
              <th className="p-2 text-left font-mono font-normal w-1/5">State</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const isOff = /stop|de-energi|off|false|closed|0/i.test(entry.state);
              return (
                <tr key={i} className="border-t">
                  <td className="p-1.5">
                    <span className="font-mono text-xs font-medium">{entry.tag}</span>
                  </td>
                  <td className="p-1.5 text-muted-foreground">{entry.description}</td>
                  <td className="p-1">
                    <Input
                      className={cn(
                        "h-7 text-xs font-mono font-bold",
                        isOff ? "text-red-400" : "text-green-400"
                      )}
                      value={entry.state}
                      onChange={(e) => updateEntry(activeTab, i, { state: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-muted-foreground">
                  No output tags for this assembly.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
