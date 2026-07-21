/**
 * Controls Data Panel — G0-16 authoring surface for the tier-1 controls
 * models the deterministic writers consume. This slice: per-unit
 * coordination (G0-3/G0-9 states, safety-healthy, command routing,
 * PackML transitions). Routing rows / two-detent / axes land in the next
 * slice; drives + IO polarity are authored inline in the hierarchy table.
 *
 * All persistence goes through writeSpecContract so the patch gate's
 * cross-checks apply to human edits (see use-controls-data.ts).
 */
import { useState } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSaveUnitCoordination } from "@/hooks/use-controls-data";
import { ContractValidationError } from "@/lib/spec-builder/contract";
import { freshAuthoredId, seedCoordination } from "@/lib/spec-builder/unit-coordination-seed";
import { RoutingCard } from "./controls-data/routing-card";
import { AxesCard } from "./controls-data/axes-card";
import {
  UNIT_PACKML_STATES,
  type PermissiveCondition,
  type UnitCoordinationV1,
  type UnitPackMLState,
  type UnitTransitionV1,
} from "@/types/spec-contract-v2";
import type { SpecProject } from "@/types/spec-builder";
import { cn } from "@/lib/utils";

const PACKML_COMMANDS = [
  "start", "stop", "hold", "unhold", "suspend", "unsuspend", "reset", "clear", "abort",
] as const;

/** Parse a permissive value input: booleans and numbers become typed, edge
 *  sentinels pass through. Anything else is not a legal value — returns null
 *  and the keystroke is ignored (the schema has no free-string values). */
function parsePermissiveValue(raw: string): PermissiveCondition["value"] | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "P_TRIG" || raw === "N_TRIG") return raw;
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

function PermissiveRows({
  value,
  onChange,
  minRows = 0,
}: {
  value: PermissiveCondition[];
  onChange: (next: PermissiveCondition[]) => void;
  minRows?: number;
}) {
  return (
    <div className="space-y-1">
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            aria-label={`Condition ${i + 1} tag`}
            value={c.tag}
            placeholder="Tag"
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...c, tag: e.target.value };
              onChange(next);
            }}
            className="h-6 w-36 text-xs font-mono"
          />
          <Select
            value={c.operator}
            onValueChange={(v) => {
              const next = [...value];
              next[i] = { ...c, operator: v as PermissiveCondition["operator"] };
              onChange(next);
            }}
          >
            <SelectTrigger className="h-6 w-14 text-xs font-mono" aria-label={`Condition ${i + 1} operator`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["=", "!=", ">", "<", ">=", "<="] as const).map((op) => (
                <SelectItem key={op} value={op} className="text-xs font-mono">
                  {op}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={`Condition ${i + 1} value`}
            value={String(c.value)}
            placeholder="true / 42 / P_TRIG"
            onChange={(e) => {
              const parsed = parsePermissiveValue(e.target.value);
              if (parsed === null) return; // not a legal value — ignore keystroke
              const next = [...value];
              next[i] = { ...c, value: parsed };
              onChange(next);
            }}
            className="h-6 w-28 text-xs font-mono"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove condition ${i + 1}`}
            className="h-5 w-5"
            disabled={value.length <= minRows}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[10px] text-muted-foreground"
        onClick={() => onChange([...value, { tag: "", operator: "=", value: true }])}
      >
        <Plus className="h-3 w-3 mr-0.5" />
        condition
      </Button>
    </div>
  );
}

interface Props {
  spec: SpecProject;
}

export function ControlsDataPanel({ spec }: Props) {
  const units = (spec.confirmed_units ?? []).filter((u) => !u.excluded);
  const modes = spec.confirmed_modes ?? [];
  const gates = spec.safety_gates ?? [];
  const save = useSaveUnitCoordination();

  const [coordMap, setCoordMap] = useState<Record<string, UnitCoordinationV1>>(
    () => spec.unit_coordination ?? {},
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(units[0]?.unit_id);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  const coord = selectedUnitId ? coordMap[selectedUnitId] : undefined;

  const patchCoord = (patch: Partial<UnitCoordinationV1>) => {
    if (!selectedUnitId) return;
    setCoordMap((prev) => ({
      ...prev,
      [selectedUnitId]: { ...prev[selectedUnitId], ...patch },
    }));
    setDirty(true);
  };

  const declaredStates = new Map((coord?.states ?? []).map((s) => [s.state_id, s]));

  const selectedUnit = units.find((u) => u.unit_id === selectedUnitId);
  const ems = (selectedUnit?.equipment_modules ?? []).map((em) => ({
    id: em.equipment_module_id,
    name: em.equipment_module_name,
  }));
  // the named-gate registry: every gate id this unit's axes declare
  const declaredGateIds = (coord?.axes ?? []).flatMap((a) =>
    Object.values(a.gates).filter((g): g is string => typeof g === "string"),
  );

  const handleSave = async () => {
    setIssues([]);
    try {
      await save.mutateAsync({
        specId: spec.id,
        unitCoordination: coordMap,
        modes,
      });
      setDirty(false);
    } catch (e) {
      if (e instanceof ContractValidationError) setIssues(e.issues);
      else setIssues([e instanceof Error ? e.message : String(e)]);
    }
  };

  if (!units.length) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md p-6">
          <p className="text-xs text-muted-foreground">
            Confirm the machine hierarchy first — unit coordination attaches to units.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 h-10 shrink-0">
        <span className="text-xs font-semibold">Unit Coordination</span>
        <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
          <SelectTrigger className="h-6 w-56 text-xs" aria-label="Unit">
            <SelectValue placeholder="Select unit..." />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u.unit_id} value={u.unit_id} className="text-xs">
                {u.unit_name}
                {coordMap[u.unit_id] ? "" : "  (not coordinated)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dirty && (
          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-400/40">
            unsaved
          </Badge>
        )}
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 ml-auto"
          onClick={handleSave}
          disabled={!dirty || save.isPending}
        >
          <Save className="h-3.5 w-3.5" />
          {save.isPending ? "Saving…" : "Save coordination"}
        </Button>
      </div>

      {issues.length > 0 && (
        <div className="border-b bg-destructive/10 px-4 py-2 space-y-0.5">
          {issues.map((iss, i) => (
            <p key={i} className="text-[11px] text-destructive flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              {iss}
            </p>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4 max-w-3xl">
          {!coord ? (
            <Card className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                This unit has no coordination authored — the compiler emits a
                placeholder stub. Seed the canonical PackML skeleton and edit
                from there.
              </p>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  if (!selectedUnitId) return;
                  setCoordMap((prev) => ({
                    ...prev,
                    [selectedUnitId]: seedCoordination(selectedUnitId, gates),
                  }));
                  setDirty(true);
                }}
              >
                Enable coordination for this unit
              </Button>
            </Card>
          ) : (
            <>
              {/* --- States --- */}
              <Card className="p-3 space-y-2">
                <p className="text-xs font-semibold">PackML states</p>
                <p className="text-[10px] text-muted-foreground">
                  Declared states form the unit state machine (canonical order).
                  Mode chips restrict a state to specific modes — none selected
                  = all modes.
                </p>
                <div className="space-y-1">
                  {UNIT_PACKML_STATES.map((stateId) => {
                    const declared = declaredStates.get(stateId);
                    return (
                      <div key={stateId} className="flex items-center gap-2 min-h-6">
                        <label className="flex items-center gap-1.5 w-32 text-xs font-mono">
                          <input
                            type="checkbox"
                            aria-label={`Declare state ${stateId}`}
                            checked={!!declared}
                            onChange={(e) => {
                              const states = e.target.checked
                                ? [
                                    ...(coord.states ?? []),
                                    {
                                      state_id: stateId,
                                      allowed_modes: [],
                                      mode_change_allowed: ["idle", "stopped", "aborted"].includes(stateId),
                                    },
                                  ]
                                : coord.states.filter((s) => s.state_id !== stateId);
                              patchCoord({ states });
                            }}
                          />
                          {stateId}
                        </label>
                        {declared && (
                          <>
                            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <input
                                type="checkbox"
                                aria-label={`Mode change allowed in ${stateId}`}
                                checked={declared.mode_change_allowed}
                                onChange={(e) =>
                                  patchCoord({
                                    states: coord.states.map((s) =>
                                      s.state_id === stateId
                                        ? { ...s, mode_change_allowed: e.target.checked }
                                        : s,
                                    ),
                                  })
                                }
                              />
                              mode change
                            </label>
                            <div className="flex items-center gap-1">
                              {modes.map((m) => {
                                const active = declared.allowed_modes.includes(m.mode_id);
                                return (
                                  <button
                                    key={m.mode_id}
                                    title={`Allow ${stateId} in ${m.name}`}
                                    onClick={() =>
                                      patchCoord({
                                        states: coord.states.map((s) =>
                                          s.state_id === stateId
                                            ? {
                                                ...s,
                                                allowed_modes: active
                                                  ? s.allowed_modes.filter((id) => id !== m.mode_id)
                                                  : [...s.allowed_modes, m.mode_id],
                                              }
                                            : s,
                                        ),
                                      })
                                    }
                                    className={cn(
                                      "px-1.5 h-4 rounded-sm border text-[9px]",
                                      active
                                        ? "bg-primary/10 border-primary/40 text-primary"
                                        : "border-muted-foreground/20 text-muted-foreground",
                                    )}
                                  >
                                    {m.name}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* --- Safety & command routing --- */}
              <Card className="p-3 space-y-2">
                <p className="text-xs font-semibold">Safety-healthy & command routing</p>
                {gates.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    No machine safety gates declared — the coordinator emits no #ok term.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {gates.map((g) => {
                      const sh = coord.signal_routing?.safety_healthy;
                      const active = sh?.gate_ids.includes(g.gate_id) ?? false;
                      return (
                        <label key={g.gate_id} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            aria-label={`Gate ${g.name}`}
                            checked={active}
                            onChange={(e) => {
                              const ids = new Set(sh?.gate_ids ?? []);
                              if (e.target.checked) ids.add(g.gate_id);
                              else ids.delete(g.gate_id);
                              patchCoord({
                                signal_routing: {
                                  routing_rows: [],
                                  two_detent: [],
                                  ...coord.signal_routing,
                                  safety_healthy: ids.size
                                    ? {
                                        exclude_maintenance: sh?.exclude_maintenance ?? true,
                                        gate_ids: [...ids],
                                      }
                                    : undefined,
                                },
                              });
                            }}
                          />
                          <span className="font-mono">{g.name}</span>
                          <span className="text-muted-foreground text-[10px]">({g.gate_id})</span>
                        </label>
                      );
                    })}
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label="Exclude maintenance mode from ok"
                        checked={coord.signal_routing?.safety_healthy?.exclude_maintenance ?? true}
                        disabled={!coord.signal_routing?.safety_healthy}
                        onChange={(e) =>
                          patchCoord({
                            signal_routing: {
                              routing_rows: [],
                              two_detent: [],
                              ...coord.signal_routing,
                              safety_healthy: coord.signal_routing?.safety_healthy
                                ? {
                                    ...coord.signal_routing.safety_healthy,
                                    exclude_maintenance: e.target.checked,
                                  }
                                : undefined,
                            },
                          })
                        }
                      />
                      exclude maintenance mode from #ok
                    </label>
                  </div>
                )}
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    aria-label="Seq-test release"
                    checked={coord.signal_routing?.command_routing?.seq_test_release ?? false}
                    onChange={(e) =>
                      patchCoord({
                        signal_routing: {
                          routing_rows: [],
                          two_detent: [],
                          ...coord.signal_routing,
                          command_routing: {
                            policy: "walk_to_execute_stop_on_unhealthy",
                            seq_test_release: e.target.checked,
                          },
                        },
                      })
                    }
                  />
                  seq-test release (dashboard drives the command pins in engineering mode)
                </label>
              </Card>

              {/* --- Transitions --- */}
              <Card className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Transitions</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px]"
                    disabled={coord.states.length < 2}
                    onClick={() =>
                      patchCoord({
                        transitions: [
                          ...coord.transitions,
                          {
                            transition_id: freshAuthoredId("t"),
                            from_state_id: coord.states[0].state_id,
                            to_state_id: coord.states[1].state_id,
                            trigger: { type: "command", command: "start" },
                            guard: [],
                            allowed_modes: [],
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="h-3 w-3 mr-0.5" />
                    Add transition
                  </Button>
                </div>
                {coord.transitions.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    No transitions — Cur_St never changes at runtime.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {coord.transitions.map((t, i) => (
                      <TransitionRow
                        key={t.transition_id}
                        transition={t}
                        states={coord.states.map((s) => s.state_id)}
                        onChange={(next) =>
                          patchCoord({
                            transitions: coord.transitions.map((x, j) => (j === i ? next : x)),
                          })
                        }
                        onRemove={() =>
                          patchCoord({
                            transitions: coord.transitions.filter((_, j) => j !== i),
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </Card>

              {/* --- Signal routing + two-detent (G0-3) --- */}
              <RoutingCard
                coord={coord}
                ems={ems}
                declaredGateIds={declaredGateIds}
                patchCoord={patchCoord}
              />

              {/* --- Axes / envelope geometry (G0-4) --- */}
              <AxesCard coord={coord} ems={ems} patchCoord={patchCoord} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TransitionRow({
  transition: t,
  states,
  onChange,
  onRemove,
}: {
  transition: UnitTransitionV1;
  states: UnitPackMLState[];
  onChange: (t: UnitTransitionV1) => void;
  onRemove: () => void;
}) {
  const stateSelect = (
    value: UnitPackMLState,
    label: string,
    set: (v: UnitPackMLState) => void,
  ) => (
    <Select value={value} onValueChange={(v) => set(v as UnitPackMLState)}>
      <SelectTrigger className="h-6 w-28 text-xs font-mono" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {states.map((s) => (
          <SelectItem key={s} value={s} className="text-xs font-mono">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="border rounded-md p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {stateSelect(t.from_state_id, "From state", (v) => onChange({ ...t, from_state_id: v }))}
        <span className="text-muted-foreground text-xs">→</span>
        {stateSelect(t.to_state_id, "To state", (v) => onChange({ ...t, to_state_id: v }))}
        <Select
          value={t.trigger.type}
          onValueChange={(v) => {
            if (v === "command") onChange({ ...t, trigger: { type: "command", command: "start" } });
            else if (v === "em_aggregate")
              onChange({ ...t, trigger: { type: "em_aggregate", em_scope: "all", em_state: "idle" } });
            else
              onChange({
                ...t,
                trigger: { type: "condition", expr: [{ tag: "", operator: "=", value: true }] },
              });
          }}
        >
          <SelectTrigger className="h-6 w-32 text-xs" aria-label="Trigger type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="command" className="text-xs">PackML command</SelectItem>
            <SelectItem value="em_aggregate" className="text-xs">All EMs in state</SelectItem>
            <SelectItem value="condition" className="text-xs">Condition</SelectItem>
          </SelectContent>
        </Select>
        {t.trigger.type === "command" && (
          <Select
            value={t.trigger.command}
            onValueChange={(v) =>
              onChange({ ...t, trigger: { type: "command", command: v as (typeof PACKML_COMMANDS)[number] } })
            }
          >
            <SelectTrigger className="h-6 w-28 text-xs font-mono" aria-label="Command">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PACKML_COMMANDS.map((c) => (
                <SelectItem key={c} value={c} className="text-xs font-mono">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {t.trigger.type === "em_aggregate" && (
          <Input
            aria-label="EM state slug"
            value={t.trigger.em_state}
            placeholder="EM state slug"
            onChange={(e) =>
              onChange({ ...t, trigger: { type: "em_aggregate", em_scope: "all", em_state: e.target.value } })
            }
            className="h-6 w-28 text-xs font-mono"
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Remove transition"
          className="h-5 w-5 ml-auto"
          onClick={onRemove}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {t.trigger.type === "condition" && (
        <PermissiveRows
          value={t.trigger.expr}
          minRows={1}
          onChange={(expr) => onChange({ ...t, trigger: { type: "condition", expr } })}
        />
      )}
      <div className="flex items-start gap-2">
        <span className="text-[10px] text-muted-foreground w-10 pt-1">guard</span>
        <PermissiveRows value={t.guard} onChange={(guard) => onChange({ ...t, guard })} />
      </div>
    </div>
  );
}
