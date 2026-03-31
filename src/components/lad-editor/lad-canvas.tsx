/**
 * SVG canvas that renders a ladder logic program.
 * Handles zoom/pan and element selection.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import type { LadProgram } from "@/types/lad";
import { layoutProgram, RAIL_LEFT, RAIL_RIGHT, TITLE_H, RUNG_GAP } from "@/lib/lad-layout";
import { LadElementRenderer } from "./lad-element-renderer";
import type { LadLayoutNode } from "@/types/lad";

interface LadCanvasProps {
  program: LadProgram;
  selectedId: string | null;
  onSelectElement: (id: string | null) => void;
}

export function LadCanvas({ program, selectedId, onSelectElement }: LadCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const layout = layoutProgram(program);
  const totalW = layout.totalWidth;
  const totalH = layout.totalHeight + 40;

  // Ctrl+wheel zooms; plain wheel scrolls normally
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z + delta)));
  }, []);

  // Pan via middle-click or space+drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }, [pan]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    };
    const handleMouseUp = () => setDragging(false);
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging]);

  // Click on background deselects
  const handleBgClick = useCallback(() => {
    onSelectElement(null);
  }, [onSelectElement]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-auto bg-neutral-950"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      style={{ cursor: dragging ? "grabbing" : "default" }}
    >
      {/* Zoom indicator */}
      <div className="absolute right-3 top-3 z-10 rounded bg-card/80 px-2 py-1 font-mono text-[10px] text-muted-foreground">
        {Math.round(zoom * 100)}%
      </div>

      <svg
        ref={svgRef}
        width={totalW * zoom + Math.max(0, pan.x) + 200}
        height={totalH * zoom + Math.max(0, pan.y) + 200}
        className="min-h-full min-w-full"
        onClick={handleBgClick}
      >
        <g transform={`translate(${Math.max(20, pan.x + 20)}, ${Math.max(20, pan.y + 20)}) scale(${zoom})`}>
          {layout.rungs.map((rung) => {
            const rungBottom = rung.y + rung.height;
            const rightEdge = totalW - RAIL_RIGHT;

            return (
              <g key={rung.rungId}>
                {/* Rung title background */}
                <rect
                  x={0}
                  y={rung.y}
                  width={totalW}
                  height={TITLE_H}
                  fill="#1e293b"
                  rx={2}
                />
                {/* Rung title text */}
                <text
                  x={8}
                  y={rung.y + 18}
                  fill="#94a3b8"
                  fontSize={12}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {rung.title}
                </text>

                {/* Left power rail */}
                <line
                  x1={RAIL_LEFT}
                  y1={rung.y + TITLE_H}
                  x2={RAIL_LEFT}
                  y2={rungBottom}
                  stroke="#4ade80"
                  strokeWidth={3}
                />

                {/* Right power rail — spans from main line Y to rung bottom */}
                {(() => {
                  const first = rung.nodes[0];
                  const mainY = first && first.branches && first.branches.length > 0
                    ? first.branches[0].y + first.branches[0].height / 2
                    : rung.y + TITLE_H + (rung.height - TITLE_H) / 2;
                  return (
                    <line
                      x1={rightEdge}
                      y1={mainY}
                      x2={rightEdge}
                      y2={rungBottom}
                      stroke="#4ade80"
                      strokeWidth={3}
                    />
                  );
                })()}

                {/* Horizontal bus line from left rail to first element */}
                {rung.nodes.length > 0 && (() => {
                  const first = rung.nodes[0];
                  // Main line Y = midpoint of first node's main row.
                  // For a parallel node, use the first branch's mid; otherwise the element mid.
                  const mainY = first.branches && first.branches.length > 0
                    ? first.branches[0].y + first.branches[0].height / 2
                    : first.y + first.height / 2;
                  return (
                    <line
                      x1={RAIL_LEFT}
                      y1={mainY}
                      x2={first.x}
                      y2={mainY}
                      stroke="#6b7280"
                      strokeWidth={1.5}
                    />
                  );
                })()}

                {/* Elements */}
                {renderNodes(rung.nodes, selectedId, onSelectElement)}

                {/* Horizontal bus line from last element to right rail */}
                {rung.nodes.length > 0 && (() => {
                  const last = rung.nodes[rung.nodes.length - 1];
                  const lastRight = last.x + last.width;
                  // Last element is always a coil or function box on the main line
                  const lastY = last.branches && last.branches.length > 0
                    ? last.branches[0].y + last.branches[0].height / 2
                    : last.y + last.height / 2;
                  return (
                    <line
                      x1={lastRight}
                      y1={lastY}
                      x2={rightEdge}
                      y2={lastY}
                      stroke="#6b7280"
                      strokeWidth={1.5}
                    />
                  );
                })()}

                {/* Rung separator */}
                <line
                  x1={0}
                  y1={rungBottom + RUNG_GAP / 2}
                  x2={totalW}
                  y2={rungBottom + RUNG_GAP / 2}
                  stroke="#334155"
                  strokeWidth={0.5}
                  strokeDasharray="4 4"
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function renderNodes(
  nodes: LadLayoutNode[],
  selectedId: string | null,
  onSelect: (id: string | null) => void,
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];

  for (const node of nodes) {
    if (node.element) {
      elements.push(
        <LadElementRenderer
          key={node.element.id}
          element={node.element}
          x={node.x}
          y={node.y}
          isSelected={selectedId === node.element.id}
          onClick={onSelect}
        />,
      );
    }
    if (node.branches && node.branches.length > 0) {
      // Draw vertical fork/join lines
      const forkX = node.x;
      const joinX = node.x + node.width;
      const firstBranchMidY = node.branches[0].y + node.branches[0].height / 2;
      const lastBranchMidY =
        node.branches[node.branches.length - 1].y +
        node.branches[node.branches.length - 1].height / 2;

      // Left vertical (fork)
      elements.push(
        <line
          key={`fork-${node.parallelId}`}
          x1={forkX}
          y1={firstBranchMidY}
          x2={forkX}
          y2={lastBranchMidY}
          stroke="#6b7280"
          strokeWidth={1.5}
        />,
      );

      // Right vertical (join)
      elements.push(
        <line
          key={`join-${node.parallelId}`}
          x1={joinX}
          y1={firstBranchMidY}
          x2={joinX}
          y2={lastBranchMidY}
          stroke="#6b7280"
          strokeWidth={1.5}
        />,
      );

      // Render each branch
      for (const branch of node.branches) {
        // Horizontal connector from fork to branch
        if (branch.nodes.length > 0) {
          const branchMidY = branch.y + branch.height / 2;
          elements.push(
            <line
              key={`hfork-${node.parallelId}-${branch.y}`}
              x1={forkX}
              y1={branchMidY}
              x2={branch.nodes[0].x}
              y2={branchMidY}
              stroke="#6b7280"
              strokeWidth={1.5}
            />,
          );

          // Elements in branch
          elements.push(...renderNodes(branch.nodes, selectedId, onSelect));

          // Horizontal connector from branch end to join
          const lastNode = branch.nodes[branch.nodes.length - 1];
          elements.push(
            <line
              key={`hjoin-${node.parallelId}-${branch.y}`}
              x1={lastNode.x + lastNode.width}
              y1={branchMidY}
              x2={joinX}
              y2={branchMidY}
              stroke="#6b7280"
              strokeWidth={1.5}
            />,
          );
        }
      }
    }
  }

  return elements;
}
