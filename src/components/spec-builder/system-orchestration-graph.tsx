/**
 * Read-only React Flow graph for system orchestration.
 *
 * One node per subsystem. One directed edge per inter-subsystem interlock,
 * coloured by effect. A chip row above the canvas filters edges to a
 * single state (or "All" to show everything).
 *
 * Layout: `dagre` is not installed in this worktree; we fall back to a
 * simple grid. The table pane remains the source of truth for edits.
 */
import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SubsystemConfig, OperatingState } from "@/types/spec-builder";
import type {
  SystemOrchestration,
  InterSubsystemInterlock,
} from "@/types/spec-contract-v2";

const EFFECT_COLORS: Record<InterSubsystemInterlock["effect"], string> = {
  hold: "#d97706", // amber
  block_transition: "#dc2626", // red
  trigger: "#2563eb", // blue
  enable: "#16a34a", // green
  disable: "#6b7280", // gray
};

const EFFECT_LABEL: Record<InterSubsystemInterlock["effect"], string> = {
  hold: "Hold",
  block_transition: "Block",
  trigger: "Trigger",
  enable: "Enable",
  disable: "Disable",
};

interface Props {
  subsystems: SubsystemConfig[];
  states: OperatingState[];
  orchestration: SystemOrchestration | null;
}

export function SystemOrchestrationGraph({
  subsystems,
  states,
  orchestration,
}: Props) {
  const sequentialStates = states.filter((s) => s.state_pattern === "sequential");
  const [activeStateId, setActiveStateId] = useState<string | "ALL">("ALL");

  const active = subsystems.filter((s) => !s.excluded);

  const nodes: Node[] = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(active.length)));
    const GAP_X = 240;
    const GAP_Y = 140;
    return active.map((sub, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      // Count states where this subsystem appears in subsystem_order
      const stateCount = orchestration
        ? Object.values(orchestration.state_sequences).filter((seq) =>
            seq.subsystem_order.includes(sub.subsystem_id),
          ).length
        : 0;
      return {
        id: sub.subsystem_id,
        position: { x: col * GAP_X, y: row * GAP_Y },
        data: {
          label: (
            <div className="text-xs space-y-1">
              <div className="font-mono font-semibold">{sub.subsystem_name}</div>
              <div className="text-[10px] text-muted-foreground">
                {sub.equipment_type}
              </div>
              <div className="text-[10px]">
                <Badge variant="outline" className="text-[9px]">
                  {stateCount} states
                </Badge>
              </div>
            </div>
          ),
        },
        style: {
          border: "1px solid hsl(var(--border))",
          borderRadius: 6,
          padding: 6,
          background: "hsl(var(--card))",
          width: 200,
        },
      };
    });
  }, [active, orchestration]);

  const edges: Edge[] = useMemo(() => {
    if (!orchestration) return [];
    const collected: Edge[] = [];
    for (const [stateId, seq] of Object.entries(orchestration.state_sequences)) {
      if (activeStateId !== "ALL" && activeStateId !== stateId) continue;
      for (const il of seq.inter_subsystem_interlocks) {
        const color = EFFECT_COLORS[il.effect];
        collected.push({
          id: `${stateId}_${il.interlock_id}`,
          source: il.source_subsystem_id,
          target: il.target_subsystem_id,
          label: `${EFFECT_LABEL[il.effect]}`,
          labelStyle: { fontSize: 10, fontFamily: "monospace", fill: color },
          style: { stroke: color, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          animated: il.effect === "trigger",
          data: { prose: il.prose, stateId },
        });
      }
    }
    return collected;
  }, [orchestration, activeStateId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-2 border-b overflow-x-auto shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          Filter:
        </span>
        <Button
          size="sm"
          variant={activeStateId === "ALL" ? "default" : "outline"}
          className="h-6 text-[10px]"
          onClick={() => setActiveStateId("ALL")}
        >
          All states
        </Button>
        {sequentialStates.map((s) => (
          <Button
            key={s.state_id}
            size="sm"
            variant={activeStateId === s.state_id ? "default" : "outline"}
            className="h-6 text-[10px]"
            onClick={() => setActiveStateId(s.state_id)}
          >
            {s.state_name}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {(Object.keys(EFFECT_COLORS) as InterSubsystemInterlock["effect"][]).map(
            (k) => (
              <span
                key={k}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-mono",
                )}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: EFFECT_COLORS[k] }}
                />
                {EFFECT_LABEL[k]}
              </span>
            ),
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
