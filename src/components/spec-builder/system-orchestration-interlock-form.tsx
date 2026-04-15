/**
 * Inline form for creating/editing an InterSubsystemInterlock.
 *
 * Wave B will replace the inline <Select> + <Textarea> combo with proper
 * SubsystemPicker + ExpressionBuilder picker components. Until then this
 * form is self-contained.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SubsystemConfig, OperatingState } from "@/types/spec-builder";
import type { InterSubsystemInterlock } from "@/types/spec-contract-v2";

const EFFECT_OPTIONS = [
  { value: "hold", label: "hold — pause target" },
  { value: "block_transition", label: "block_transition — forbid leaving a state" },
  { value: "trigger", label: "trigger — force target into a state" },
  { value: "enable", label: "enable — allow target to run" },
  { value: "disable", label: "disable — forbid target from running" },
] as const;

type Effect = (typeof EFFECT_OPTIONS)[number]["value"];

interface Props {
  subsystems: SubsystemConfig[];
  states: OperatingState[];
  initial?: InterSubsystemInterlock;
  onSubmit: (value: InterSubsystemInterlock) => void;
  onCancel: () => void;
}

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function SystemOrchestrationInterlockForm({
  subsystems,
  states,
  initial,
  onSubmit,
  onCancel,
}: Props) {
  const [interlockId, setInterlockId] = useState(
    initial?.interlock_id ?? genId("IL"),
  );
  const [sourceId, setSourceId] = useState(initial?.source_subsystem_id ?? "");
  const [targetId, setTargetId] = useState(initial?.target_subsystem_id ?? "");
  const [effect, setEffect] = useState<Effect>(
    (initial?.effect as Effect) ?? "hold",
  );
  const [effectTargetState, setEffectTargetState] = useState(
    initial?.effect_target?.state_id ?? "",
  );
  const [prose, setProse] = useState(initial?.prose ?? "");
  const [condText, setCondText] = useState(() => {
    if (!initial) return "";
    const c = initial.source_condition;
    if (c.kind === "expression") return c.text;
    if (c.kind === "tag_equals") return `${c.tag} = ${String(c.value)}`;
    if (c.kind === "tag_compare") return `${c.tag} ${c.op} ${c.value}`;
    if (c.kind === "manual_ack") return c.prompt;
    return "";
  });

  const requiresTargetState = effect === "block_transition" || effect === "trigger";
  const canSave =
    interlockId.trim() &&
    sourceId &&
    targetId &&
    sourceId !== targetId &&
    condText.trim() &&
    prose.trim() &&
    (!requiresTargetState || effectTargetState);

  const handleSubmit = () => {
    if (!canSave) return;
    const referenced_tags = Array.from(
      condText.match(/[A-Z_][A-Z0-9_]{1,}/g) ?? [],
    );
    const value: InterSubsystemInterlock = {
      interlock_id: interlockId,
      source_subsystem_id: sourceId,
      source_condition: {
        kind: "expression",
        text: condText.trim(),
        referenced_tags,
      },
      target_subsystem_id: targetId,
      effect,
      effect_target: requiresTargetState
        ? { subsystem: targetId, state_id: effectTargetState }
        : undefined,
      prose: prose.trim(),
    };
    onSubmit(value);
  };

  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/30">
      <div className="grid gap-1">
        <Label className="text-xs">Interlock ID</Label>
        <Input
          value={interlockId}
          onChange={(e) => setInterlockId(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Source subsystem</Label>
          {/* FALLBACK: Wave B → SubsystemPicker */}
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {subsystems.map((s) => (
                <SelectItem key={s.subsystem_id} value={s.subsystem_id}>
                  {s.subsystem_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Target subsystem</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {subsystems.map((s) => (
                <SelectItem key={s.subsystem_id} value={s.subsystem_id}>
                  {s.subsystem_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Source condition</Label>
        {/* FALLBACK: Wave B → ExpressionBuilder */}
        <Textarea
          value={condText}
          onChange={(e) => setCondText(e.target.value)}
          className="font-mono text-xs"
          rows={2}
          placeholder="e.g. DRYER_RUNNING = TRUE"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Effect</Label>
          <Select value={effect} onValueChange={(v) => setEffect(v as Effect)}>
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFECT_OPTIONS.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {requiresTargetState && (
          <div className="grid gap-1">
            <Label className="text-xs">Effect target state</Label>
            <Select
              value={effectTargetState}
              onValueChange={setEffectTargetState}
            >
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Select state..." />
              </SelectTrigger>
              <SelectContent>
                {states
                  .filter((s) => s.state_pattern === "sequential")
                  .map((s) => (
                    <SelectItem key={s.state_id} value={s.state_id}>
                      {s.state_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Prose (one-line)</Label>
        <Input
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          className="text-xs"
          placeholder="Dryer holds while infeed is starved"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSave}>
          {initial ? "Update" : "Add"} interlock
        </Button>
      </div>
    </div>
  );
}
