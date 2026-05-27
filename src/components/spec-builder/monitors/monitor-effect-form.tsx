// src/components/spec-builder/monitors/monitor-effect-form.tsx
/**
 * Effect picker for a single monitor. Effect radio (alarm/fault/hold/
 * branch_to) + per-effect extras (fault_ref / target_step_id) +
 * auto_clear + priority. Parent owns state.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FaultRef, MonitorV2 } from "@/types/spec-contract-v2";

interface Props {
  monitor: MonitorV2;
  availableStepIds: string[];
  onChange: (next: MonitorV2) => void;
}

type Effect = MonitorV2["effect"];

const SEVERITY_OPTIONS = ["warning", "fault", "critical"] as const;

function nextFaultRefForEffect(effect: Effect, prev: FaultRef | undefined): FaultRef | undefined {
  if (effect === "alarm" || effect === "fault") {
    return prev ?? { fault_code: "F_NEW", severity: "fault" };
  }
  return undefined;
}

function nextTargetForEffect(effect: Effect, prev: string | undefined): string | undefined {
  return effect === "branch_to" ? (prev ?? "") : undefined;
}

export function MonitorEffectForm({ monitor, availableStepIds, onChange }: Props) {
  const updateEffect = (e: Effect) => {
    onChange({
      ...monitor,
      effect: e,
      fault_ref: nextFaultRefForEffect(e, monitor.fault_ref),
      target_step_id: nextTargetForEffect(e, monitor.target_step_id),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[120px_1fr] items-start gap-2">
        <Label className="text-xs pt-1">Effect</Label>
        <RadioGroup
          value={monitor.effect}
          onValueChange={(v) => updateEffect(v as Effect)}
          className="grid grid-cols-2 gap-1"
        >
          {(["alarm", "fault", "hold", "branch_to"] as const).map((e) => (
            <div key={e} className="flex items-center gap-2">
              <RadioGroupItem id={`effect-${e}`} value={e} />
              <Label htmlFor={`effect-${e}`} className="text-xs capitalize cursor-pointer">
                {e === "branch_to" ? "Branch to step" : e}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {(monitor.effect === "alarm" || monitor.effect === "fault") && monitor.fault_ref && (
        <>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Fault code</Label>
            <Input
              value={monitor.fault_ref.fault_code}
              onChange={(e) => {
                const fault_code = e.target.value.toUpperCase();
                onChange({
                  ...monitor,
                  fault_ref: { ...monitor.fault_ref!, fault_code },
                });
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Severity</Label>
            <Select
              value={monitor.fault_ref.severity}
              onValueChange={(v) =>
                onChange({
                  ...monitor,
                  fault_ref: { ...monitor.fault_ref!, severity: v as (typeof SEVERITY_OPTIONS)[number] },
                })
              }
            >
              <SelectTrigger aria-label="Severity" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {monitor.effect === "branch_to" && (
        <div className="grid grid-cols-[120px_1fr] items-center gap-2">
          <Label className="text-xs">Target step</Label>
          <Select
            value={monitor.target_step_id ?? ""}
            onValueChange={(v) => onChange({ ...monitor, target_step_id: v })}
          >
            <SelectTrigger aria-label="Target step" className="h-8 text-xs">
              <SelectValue placeholder="(pick step)" />
            </SelectTrigger>
            <SelectContent>
              {availableStepIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-[120px_1fr] items-center gap-2">
        <Label className="text-xs">Auto-clear</Label>
        <div className="flex items-center gap-2">
          <Checkbox
            id="monitor-auto-clear"
            checked={monitor.auto_clear}
            onCheckedChange={(v) => onChange({ ...monitor, auto_clear: v === true })}
            aria-label="Auto-clear when condition clears"
          />
          <Label htmlFor="monitor-auto-clear" className="text-xs text-muted-foreground cursor-pointer">
            Automatically reset when condition clears
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-[120px_1fr] items-center gap-2">
        <Label className="text-xs" htmlFor="monitor-priority">
          Priority
        </Label>
        <Input
          id="monitor-priority"
          type="number"
          value={monitor.priority}
          onChange={(e) => onChange({ ...monitor, priority: Number(e.target.value) || 0 })}
          className="h-8 text-xs font-mono w-32"
        />
      </div>
    </div>
  );
}
