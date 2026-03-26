/**
 * Ladder logic layout engine.
 * Computes SVG coordinates for rungs, elements, and parallel branches.
 */

import type {
  LadNode,
  LadSeriesChain,
  LadProgram,
  LadLayoutNode,
  LadLayoutBranch,
  LadLayoutRung,
} from "@/types/lad";
import { isBoxElement } from "@/types/lad";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Width of a simple contact/coil cell */
export const CELL_W = 120;
/** Height of a single rung row */
export const CELL_H = 60;
/** Width of a box element (timer, counter, math, etc.) */
export const BOX_W = 200;
/** Height of a box element */
export const BOX_H = 100;
/** Vertical gap between parallel branches */
export const BRANCH_GAP = 10;
/** Gap between rungs */
export const RUNG_GAP = 24;
/** Height of the rung title bar */
export const TITLE_H = 28;
/** Left margin (power rail) */
export const RAIL_LEFT = 16;
/** Right margin (power rail) */
export const RAIL_RIGHT = 16;

// ---------------------------------------------------------------------------
// Layout a single node
// ---------------------------------------------------------------------------

/** FB_CALL boxes are wider and taller to fit all parameters */
function fbCallHeight(node: LadNode): number {
  if (node.type !== "element" || node.element.type !== "FB_CALL") return BOX_H;
  const paramCount = node.element.callParams?.length ?? 0;
  // Base height (title + EN/ENO row) + 14px per param line + padding
  return Math.max(BOX_H, 50 + (paramCount + 1) * 14 + 10);
}

function elementWidth(node: LadNode): number {
  if (node.type !== "element") return BOX_W;
  if (node.element.type === "FB_CALL") return 340;
  return isBoxElement(node.element.type) ? BOX_W : CELL_W;
}

function elementHeight(node: LadNode): number {
  if (node.type !== "element") return BOX_H;
  if (node.element.type === "FB_CALL") return fbCallHeight(node);
  return isBoxElement(node.element.type) ? BOX_H : CELL_H;
}

function nodeWidth(node: LadNode): number {
  if (node.type === "element") {
    return elementWidth(node);
  }
  // Parallel: width is the max width across all branches
  const branches = node.branches ?? [];
  if (branches.length === 0) return CELL_W;
  return Math.max(
    ...branches.map((branch) =>
      (branch.nodes ?? []).reduce((sum, n) => sum + nodeWidth(n), 0),
    ),
  );
}

function nodeHeight(node: LadNode): number {
  if (node.type === "element") {
    return elementHeight(node);
  }
  // Parallel: sum of all branch heights + gaps
  const branches = node.branches ?? [];
  if (branches.length === 0) return CELL_H;
  const branchHeights = branches.map((b) => chainHeight(b));
  return branchHeights.reduce((sum, h) => sum + h, 0) + (branchHeights.length - 1) * BRANCH_GAP;
}

function chainHeight(chain: LadSeriesChain): number {
  if (!chain.nodes?.length) return CELL_H;
  return Math.max(...chain.nodes.map((n) => nodeHeight(n)));
}

// ---------------------------------------------------------------------------
// Layout a series chain
// ---------------------------------------------------------------------------

function layoutChain(
  chain: LadSeriesChain,
  startX: number,
  startY: number,
): { nodes: LadLayoutNode[]; width: number; height: number } {
  // Guard: bare element or parallel passed as a "branch" — wrap as single-node chain
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = chain as any;
  if (raw.type === "element") {
    return layoutChain({ type: "series", nodes: [raw as unknown as LadNode] }, startX, startY);
  }
  if (raw.type === "parallel") {
    return layoutChain({ type: "series", nodes: [raw as unknown as LadNode] }, startX, startY);
  }

  const layoutNodes: LadLayoutNode[] = [];
  let x = startX;
  let maxH = CELL_H;

  for (const node of (chain.nodes ?? [])) {
    if (node.type === "element") {
      const w = elementWidth(node);
      const h = elementHeight(node);
      layoutNodes.push({
        element: node.element,
        x,
        y: startY,
        width: w,
        height: h,
      });
      x += w;
      maxH = Math.max(maxH, h);
    } else {
      // Parallel branch
      const totalW = nodeWidth(node);
      const branches: LadLayoutBranch[] = [];
      let branchY = startY;

      for (const branch of (node.branches ?? [])) {
        const result = layoutChain(branch, x, branchY);
        const bh = Math.max(chainHeight(branch), result.height);
        branches.push({
          nodes: result.nodes,
          y: branchY,
          height: bh,
        });
        branchY += bh + BRANCH_GAP;
      }

      const totalH = branchY - startY - BRANCH_GAP;
      layoutNodes.push({
        parallelId: node.id,
        x,
        y: startY,
        width: totalW,
        height: totalH,
        branches,
      });
      x += totalW;
      maxH = Math.max(maxH, totalH);
    }
  }

  return { nodes: layoutNodes, width: x - startX, height: maxH };
}

// ---------------------------------------------------------------------------
// Layout a full program
// ---------------------------------------------------------------------------

export function layoutProgram(program: LadProgram): {
  rungs: LadLayoutRung[];
  totalWidth: number;
  totalHeight: number;
} {
  const rungs: LadLayoutRung[] = [];
  let y = 0;
  let maxWidth = 0;

  for (const rung of (program.rungs ?? [])) {
    const rungY = y + TITLE_H;
    // Guard: if logic is a parallel (not series), wrap it; if missing, use empty series
    const rawLogic = rung.logic ?? { type: "series", nodes: [] };
    const logic: LadSeriesChain = rawLogic.type === "series"
      ? rawLogic
      : { type: "series", nodes: [rawLogic as unknown as LadNode] };
    const result = layoutChain(logic, RAIL_LEFT, rungY);
    const totalW = RAIL_LEFT + result.width + RAIL_RIGHT;
    const rungH = TITLE_H + result.height;

    rungs.push({
      rungId: rung.id,
      title: rung.title,
      y,
      height: rungH,
      totalWidth: totalW,
      nodes: result.nodes,
    });

    maxWidth = Math.max(maxWidth, totalW);
    y += rungH + RUNG_GAP;
  }

  return {
    rungs,
    totalWidth: Math.max(maxWidth, 600),
    totalHeight: y,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the renderer
// ---------------------------------------------------------------------------

/** Flatten all layout nodes (including nested parallel branches) */
export function flattenNodes(nodes: LadLayoutNode[]): LadLayoutNode[] {
  const result: LadLayoutNode[] = [];
  for (const node of nodes) {
    if (node.element) {
      result.push(node);
    }
    if (node.branches) {
      result.push(node); // The parallel group itself
      for (const branch of (node.branches ?? [])) {
        result.push(...flattenNodes(branch.nodes));
      }
    }
  }
  return result;
}

/** Get the rightmost X coordinate of a layout */
export function getRightEdge(nodes: LadLayoutNode[]): number {
  let max = 0;
  for (const node of nodes) {
    max = Math.max(max, node.x + node.width);
    if (node.branches) {
      for (const branch of (node.branches ?? [])) {
        max = Math.max(max, getRightEdge(branch.nodes));
      }
    }
  }
  return max;
}
