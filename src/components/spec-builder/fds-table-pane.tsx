/**
 * FDS Co-Author — SFC v2 step table pane.
 *
 * Operates on SequentialStateV2 (spec-contract-v2.ts). Each step row is
 * expandable: collapsed shows step#, name, and first-action prose summary;
 * expanded shows the full ActionBuilder list + transition guard (ExpressionBuilder
 * per CompletionCriterion on the first outgoing transition).
 *
 * Permissives are still string[] (SequentialStateV2.permissives), shown as
 * plain text inputs — these represent entry conditions, not structured expressions.
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { ActionBuilder } from "./pickers/action-builder";
import { ExpressionBuilder } from "./pickers/expression-builder";
import type {
  SequentialStateV2,
  StepV2,
  ActionV2,
  TransitionV2,
  CompletionCriterion,
} from "@/types/spec-contract-v2";
import type { OperatingState } from "@/types/spec-builder";
import { cn } from "@/lib/utils";

interface Props {
  sequentialStates: OperatingState[];
  stateData: Record<string, SequentialStateV2>;
  onUpdateState: (stateId: string, data: SequentialStateV2) => void;
  specProjectId?: string;
}

const EMPTY_STATE: SequentialStateV2 = {
  permissives: [],
  steps: [],
  notes: null,
};

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function newStep(stepNumber: number): StepV2 {
  return {
    step_id: uuid(),
    branch_id: "main",
    name: `Step ${stepNumber}`,
    step: stepNumber,
    action: "",
    completion_criteria: [],
    completion_criteria_text: "",
    actions: [
      {
        kind: "manual_prose",
        action_id: uuid(),
        text: "",
        referenced_tags: [],
        prose: "",
      },
    ],
    monitors: [],
    transitions: [],
  };
}

/** Prose summary of the first action in a step. */
function stepSummary(step: StepV2): string {
  const first = step.actions?.[0];
  if (!first) return step.action || "(no action)";
  return first.prose || first.text || step.action || "(no action)";
}

/** Get the guard of the first transition, or empty array. */
function firstGuard(step: StepV2): CompletionCriterion[] {
  return step.transitions?.[0]?.guard ?? [];
}

/** Replace the guard on the first transition (or create one if none). */
function setFirstGuard(step: StepV2, guard: CompletionCriterion[], nextStepId?: string): StepV2 {
  if (!step.transitions || step.transitions.length === 0) {
    if (guard.length === 0) return step;
    const t: TransitionV2 = {
      transition_id: uuid(),
      kind: "single",
      target_step_id: nextStepId ?? "",
      guard,
      priority: 0,
      is_default: false,
      notes: null,
    };
    return { ...step, transitions: [t] };
  }
  const updated = step.transitions.map((t, i) =>
    i === 0 ? { ...t, guard } : t,
  );
  return { ...step, transitions: updated };
}

export function FdsTablePane({
  sequentialStates,
  stateData,
  onUpdateState,
  specProjectId,
}: Props) {
  const [activeTab, setActiveTab] = useState(sequentialStates[0]?.state_id ?? "");
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const currentData = stateData[activeTab] ?? EMPTY_STATE;

  const update = useCallback(
    (patch: Partial<SequentialStateV2>) => {
      onUpdateState(activeTab, { ...currentData, ...patch });
    },
    [activeTab, currentData, onUpdateState],
  );

  const toggleExpand = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

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
    const n = currentData.steps.length + 1;
    update({ steps: [...currentData.steps, newStep(n)] });
  };

  const removeStep = (idx: number) => {
    const next = currentData.steps
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, step: i + 1 }));
    update({ steps: next });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const next = [...currentData.steps];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    update({ steps: next.map((s, i) => ({ ...s, step: i + 1 })) });
  };

  const updateStep = (idx: number, patch: Partial<StepV2>) => {
    const next = currentData.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    update({ steps: next });
  };

  const updateStepActions = (idx: number, actions: ActionV2[]) => {
    const step = currentData.steps[idx];
    if (!step) return;
    // Keep prose in sync with the first action
    const prose = actions[0]?.prose ?? "";
    updateStep(idx, { actions, action: prose });
  };

  const updateStepGuard = (idx: number, guard: CompletionCriterion[]) => {
    const step = currentData.steps[idx];
    if (!step) return;
    const nextStepId = currentData.steps[idx + 1]?.step_id;
    updateStep(idx, setFirstGuard(step, guard, nextStepId));
  };

  return (
    <div className="flex flex-col h-full">
      {/* State tabs */}
      <div className="flex gap-1 border-b px-2 shrink-0 overflow-x-auto">
        {sequentialStates.map((state) => {
          const data = stateData[state.state_id];
          const stepCount = data?.steps?.length ?? 0;
          return (
            <button
              key={state.state_id}
              onClick={() => setActiveTab(state.state_id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium border-b-2 transition-colors shrink-0",
                activeTab === state.state_id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
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

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4">
          {/* Permissives */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold">Permissives</label>
              <Button
                size="sm"
                variant="outline"
                onClick={addPermissive}
                className="h-6 text-[10px]"
              >
                <Plus className="h-3 w-3 mr-0.5" /> Add
              </Button>
            </div>
            {currentData.permissives.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic px-1">
                No permissives. Add conditions that must be TRUE before this sequence starts.
              </p>
            ) : (
              <div className="space-y-1">
                {currentData.permissives.map((perm, i) => (
                  <div key={i} className="flex gap-1">
                    <Input
                      className="h-7 text-xs font-mono"
                      value={perm}
                      onChange={(e) => updatePermissive(i, e.target.value)}
                      placeholder="e.g. ESTOP_01 = TRUE"
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

          {/* Step list */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold">Steps</label>
              <Button
                size="sm"
                variant="outline"
                onClick={addStep}
                className="h-6 text-[10px]"
              >
                <Plus className="h-3 w-3 mr-0.5" /> Add Step
              </Button>
            </div>

            {currentData.steps.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic px-1">
                No steps yet. Use the chat to describe the sequence, or add manually.
              </p>
            ) : (
              <div className="space-y-1.5">
                {currentData.steps.map((step, idx) => {
                  const stepId = step.step_id ?? `step-${idx}`;
                  const expanded = expandedSteps.has(stepId);
                  const guard = firstGuard(step);
                  const isLast = idx === currentData.steps.length - 1;

                  return (
                    <Card
                      key={stepId}
                      className={cn(
                        "overflow-hidden border transition-colors",
                        expanded ? "border-primary/40" : "border-border",
                      )}
                    >
                      {/* Collapsed header */}
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent/30 select-none"
                        onClick={() => toggleExpand(stepId)}
                      >
                        <span className="font-mono text-[10px] text-muted-foreground w-5 shrink-0 text-center">
                          {step.step}
                        </span>
                        {expanded ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        {/* Name input — stop propagation so typing doesn't toggle expand */}
                        <Input
                          className="h-6 text-xs flex-1 font-mono"
                          value={step.name ?? step.action}
                          placeholder="Step name"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            updateStep(idx, { name: e.target.value, action: e.target.value })
                          }
                        />
                        {!expanded && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[160px] shrink-0">
                            {stepSummary(step)}
                          </span>
                        )}
                        <div
                          className="flex items-center gap-0.5 ml-auto shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => moveStep(idx, -1)}
                            disabled={idx === 0}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => moveStep(idx, 1)}
                            disabled={isLast}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => removeStep(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Expanded body */}
                      {expanded && (
                        <div className="px-3 pb-3 pt-2 space-y-3 border-t border-border/50">
                          {/* Actions */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide">
                                Actions
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 text-[10px]"
                                onClick={() =>
                                  updateStepActions(idx, [
                                    ...(step.actions ?? []),
                                    {
                                      kind: "manual_prose",
                                      action_id: uuid(),
                                      text: "",
                                      referenced_tags: [],
                                      prose: "",
                                    },
                                  ])
                                }
                              >
                                <Plus className="h-3 w-3 mr-0.5" /> Add
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {(step.actions ?? []).map((action, ai) => (
                                <div key={action.action_id} className="flex gap-1 items-start">
                                  <div className="flex-1">
                                    <ActionBuilder
                                      value={action}
                                      specProjectId={specProjectId}
                                      onChange={(next) => {
                                        const next_actions = (step.actions ?? []).map((a, j) =>
                                          j === ai ? next : a,
                                        );
                                        updateStepActions(idx, next_actions);
                                      }}
                                    />
                                  </div>
                                  {(step.actions ?? []).length > 1 && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0 mt-0.5"
                                      onClick={() =>
                                        updateStepActions(
                                          idx,
                                          (step.actions ?? []).filter((_, j) => j !== ai),
                                        )
                                      }
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                              {(!step.actions || step.actions.length === 0) && (
                                <p className="text-[11px] text-muted-foreground italic">
                                  No actions. Add one above.
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Transition guard (only for non-terminal steps) */}
                          {!isLast && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wide">
                                  Transition guard
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 text-[10px]"
                                  onClick={() =>
                                    updateStepGuard(idx, [
                                      ...guard,
                                      { kind: "tag_equals", tag: "", value: true },
                                    ])
                                  }
                                >
                                  <Plus className="h-3 w-3 mr-0.5" /> Add criterion
                                </Button>
                              </div>
                              {guard.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground italic">
                                  No guard — step advances immediately.
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  {guard.map((criterion, ci) => (
                                    <div key={ci} className="flex gap-1 items-start">
                                      <div className="flex-1">
                                        <ExpressionBuilder
                                          value={criterion}
                                          specProjectId={specProjectId}
                                          onChange={(next) => {
                                            const next_guard = guard.map((c, j) =>
                                              j === ci ? (next ?? c) : c,
                                            );
                                            updateStepGuard(idx, next_guard);
                                          }}
                                        />
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 shrink-0 mt-0.5"
                                        onClick={() =>
                                          updateStepGuard(
                                            idx,
                                            guard.filter((_, j) => j !== ci),
                                          )
                                        }
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {isLast && (
                            <p className="text-[10px] text-muted-foreground font-mono italic">
                              Terminal step — sequence ends here.
                            </p>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          {currentData.notes && (
            <p className="text-[11px] text-muted-foreground italic px-1">
              Note: {currentData.notes}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
