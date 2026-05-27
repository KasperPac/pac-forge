// src/components/spec-builder/monitors/monitor-picker.tsx
/**
 * Dialog for authoring a MonitorV2[] slice. Used both for step-level
 * monitors (StepV2.monitors) and state-level monitors
 * (SequentialStateV2.state_monitors) — same shape, two entry points.
 *
 * Holds a local copy of the array so Cancel is a real cancel; Save
 * calls onChange with the mutated array. Per-monitor validation gates
 * Save (errors listed inline above the footer).
 */
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MonitorV2 } from "@/types/spec-contract-v2";
import { MonitorConditionForm } from "./monitor-condition-form";
import { MonitorEffectForm } from "./monitor-effect-form";
import { createDefaultMonitor, summariseMonitor, validateMonitor } from "./monitor-helpers";

interface Props {
  open: boolean;
  title: string;
  monitors: MonitorV2[];
  availableStepIds: string[];
  availableTags: string[];
  onChange: (next: MonitorV2[]) => void;
  onClose: () => void;
}

const EFFECT_CHIP: Record<MonitorV2["effect"], string> = {
  alarm: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  fault: "bg-red-500/10 text-red-300 border-red-500/30",
  hold: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  branch_to: "bg-purple-500/10 text-purple-300 border-purple-500/30",
};

export function MonitorPicker({
  open,
  title,
  monitors,
  availableStepIds,
  availableTags,
  onChange,
  onClose,
}: Props) {
  const [local, setLocal] = useState<MonitorV2[]>(monitors);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(monitors.length > 0 ? 0 : null);

  // Re-seed when the dialog transitions from closed → open.
  // Tracks previous open value in state to avoid setState-in-effect and
  // read-ref-during-render lint violations (React "derived state" pattern).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLocal(monitors);
      setSelectedIdx(monitors.length > 0 ? 0 : null);
    }
  }

  const selected = selectedIdx != null ? local[selectedIdx] : null;
  const validationOfSelected = useMemo(
    () => (selected ? validateMonitor(selected) : { ok: true as const }),
    [selected],
  );
  const allValid = useMemo(() => local.every((m) => validateMonitor(m).ok), [local]);

  const update = (next: MonitorV2) => {
    if (selectedIdx == null) return;
    setLocal((prev) => prev.map((m, i) => (i === selectedIdx ? next : m)));
  };

  const add = () => {
    const next = createDefaultMonitor();
    const newIdx = local.length;
    setLocal((prev) => [...prev, next]);
    setSelectedIdx(newIdx);
  };

  const remove = (idx: number) => {
    setLocal((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIdx((cur) => {
      if (cur == null) return null;
      if (cur === idx) return null;
      if (cur > idx) return cur - 1;
      return cur;
    });
  };

  const handleSave = () => {
    if (!allValid) return;
    onChange(local);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[260px_1fr] gap-4 min-h-[360px]">
          {/* Left — list */}
          <div className="border rounded-md p-2 space-y-1 overflow-y-auto max-h-[400px]">
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={add}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
            {local.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">No monitors yet.</p>
            )}
            {local.map((m, i) => {
              const summary = summariseMonitor(m);
              const isSelected = i === selectedIdx;
              return (
                <button
                  key={m.monitor_id}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`w-full text-left p-2 rounded text-xs border ${
                    isSelected ? "bg-accent border-accent-foreground/20" : "border-transparent hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <Badge variant="outline" className={`text-[10px] ${EFFECT_CHIP[m.effect]}`}>
                      {m.effect}
                    </Badge>
                  </div>
                  <span className="font-mono leading-tight">{summary}</span>
                </button>
              );
            })}
          </div>

          {/* Right — form */}
          <div className="space-y-3">
            {selected ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Condition</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => selectedIdx != null && remove(selectedIdx)}
                    aria-label="Delete monitor"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <MonitorConditionForm
                  condition={selected.condition}
                  availableTags={availableTags}
                  onChange={(c) => update({ ...selected, condition: c })}
                />
                <p className="text-xs font-semibold uppercase text-muted-foreground mt-3">Effect</p>
                <MonitorEffectForm
                  monitor={selected}
                  availableStepIds={availableStepIds}
                  onChange={update}
                />
                {!validationOfSelected.ok && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {validationOfSelected.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground py-8 text-center">
                Select a monitor from the list, or click Add.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!allValid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
