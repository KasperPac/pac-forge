import type {
  FbFlowDiagram,
  FbFlowColumn,
  FbFlowNode,
  FbFlowConnection,
} from "@/lib/fb-flow-diagram";

// ---------------------------------------------------------------------------
// Truth table renderer
// ---------------------------------------------------------------------------

const TBL_CELL_W  = 70;   // width per column in truth table
const TBL_ROW_H   = 20;   // height per data row
const TBL_HDR_H   = 26;   // header row height
const TBL_BORDER  = "#2d3748";
const TBL_HDR_BG  = "#1a2030";
const TBL_ROW_BG  = ["#111827", "#0f1117"];
const TBL_TEXT    = "#9ca3af";
const TBL_HDR_TEXT = "#60a5fa";
const TBL_RESULT_TEXT = "#86efac";

function renderTruthTableColumn(
  col: FbFlowColumn,
  offsetX: number,
): { svg: React.ReactNode; width: number; height: number } {
  const tt = col.truthTable!;
  const numCols = tt.headers.length + 1; // +1 for result column
  const tableW = numCols * TBL_CELL_W;
  const tableH = TBL_HDR_H + tt.rows.length * TBL_ROW_H;
  const colW   = tableW + 2 * COL_PAD_X;

  const tableX = offsetX + COL_PAD_X;
  const tableY = TOP_PAD;

  const outputH = OUTPUT_H;
  const totalH  = TOP_PAD + tableH + ROW_V_GAP + outputH + BOTTOM_PAD;
  const outputX = offsetX + (colW - NODE_W) / 2;
  const outputY = TOP_PAD + tableH + ROW_V_GAP;
  const outColors = NODE_COLORS["output"];

  const svg = (
    <g key={col.outputName}>
      {/* column header */}
      <text
        x={offsetX + colW / 2} y={TOP_PAD - 10}
        textAnchor="middle" fontSize="9"
        fontFamily="JetBrains Mono, Consolas, monospace" fill={COL_HDR_COLOR}
      >
        {col.outputName}
      </text>

      {/* table border */}
      <rect
        x={tableX} y={tableY} width={tableW} height={tableH}
        fill="none" stroke={TBL_BORDER} strokeWidth="1" rx={3}
      />

      {/* header row */}
      <rect x={tableX} y={tableY} width={tableW} height={TBL_HDR_H}
        fill={TBL_HDR_BG} rx={3}
      />
      {/* flatten top corners only (overlay bottom half to square them off) */}
      <rect x={tableX} y={tableY + TBL_HDR_H / 2} width={tableW} height={TBL_HDR_H / 2}
        fill={TBL_HDR_BG}
      />
      {tt.headers.map((h, i) => (
        <text key={`hdr-${i}`}
          x={tableX + i * TBL_CELL_W + TBL_CELL_W / 2}
          y={tableY + TBL_HDR_H / 2 + 1}
          textAnchor="middle" dominantBaseline="central"
          fontSize="8" fontFamily="JetBrains Mono, Consolas, monospace"
          fill={TBL_HDR_TEXT}
        >
          {h.length > 9 ? h.slice(0, 8) + "…" : h}
        </text>
      ))}
      <text
        x={tableX + tt.headers.length * TBL_CELL_W + TBL_CELL_W / 2}
        y={tableY + TBL_HDR_H / 2 + 1}
        textAnchor="middle" dominantBaseline="central"
        fontSize="8" fontFamily="sans-serif" fill={TBL_RESULT_TEXT}
      >
        Result
      </text>

      {/* vertical column dividers */}
      {Array.from({ length: numCols - 1 }, (_, i) => (
        <line key={`vdiv-${i}`}
          x1={tableX + (i + 1) * TBL_CELL_W} y1={tableY}
          x2={tableX + (i + 1) * TBL_CELL_W} y2={tableY + tableH}
          stroke={TBL_BORDER} strokeWidth="1"
        />
      ))}

      {/* data rows */}
      {tt.rows.map((row, ri) => {
        const ry = tableY + TBL_HDR_H + ri * TBL_ROW_H;
        return (
          <g key={`row-${ri}`}>
            <rect x={tableX} y={ry} width={tableW} height={TBL_ROW_H}
              fill={TBL_ROW_BG[ri % 2]}
            />
            {row.values.map((v, ci) => (
              <text key={`cell-${ci}`}
                x={tableX + ci * TBL_CELL_W + TBL_CELL_W / 2}
                y={ry + TBL_ROW_H / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize="8" fontFamily="JetBrains Mono, Consolas, monospace"
                fill={TBL_TEXT}
              >
                {v}
              </text>
            ))}
            <text
              x={tableX + tt.headers.length * TBL_CELL_W + TBL_CELL_W / 2}
              y={ry + TBL_ROW_H / 2}
              textAnchor="middle" dominantBaseline="central"
              fontSize="8" fontFamily="JetBrains Mono, Consolas, monospace"
              fill={TBL_RESULT_TEXT}
            >
              {row.result}
            </text>
            {/* horizontal row divider */}
            <line
              x1={tableX} y1={ry + TBL_ROW_H}
              x2={tableX + tableW} y2={ry + TBL_ROW_H}
              stroke={TBL_BORDER} strokeWidth="0.5" strokeOpacity="0.5"
            />
          </g>
        );
      })}

      {/* connector line: table → output */}
      <line
        x1={offsetX + colW / 2} y1={tableY + tableH}
        x2={offsetX + colW / 2} y2={outputY}
        stroke={CONN_COLORS["normal"]} strokeWidth="1.5"
        markerEnd="url(#arrowhead)"
      />

      {/* output hexagon */}
      <polygon
        points={hexagonPoints(outputX, outputY, NODE_W, outputH)}
        fill={outColors.fill} stroke={outColors.stroke} strokeWidth="1.5"
      />
      <text
        x={outputX + NODE_W / 2} y={outputY + outputH / 2}
        textAnchor="middle" dominantBaseline="central"
        fontSize="10" fontFamily="JetBrains Mono, Consolas, monospace"
        fill={outColors.text}
      >
        {col.outputName.length > 22 ? col.outputName.slice(0, 21) + "…" : col.outputName}
      </text>
    </g>
  );

  return { svg, width: colW, height: totalH };
}

// ---------------------------------------------------------------------------
// Color tokens
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<
  FbFlowNode["type"],
  { fill: string; stroke: string; text: string }
> = {
  input:        { fill: "#0d2a4a", stroke: "#2563eb", text: "#93c5fd" },
  condition:    { fill: "#1a1035", stroke: "#7c3aed", text: "#c4b5fd" },
  timer:        { fill: "#0a2a2a", stroke: "#0d9488", text: "#5eead4" },
  intermediate: { fill: "#1e1e2e", stroke: "#4b5563", text: "#9ca3af" },
  output:       { fill: "#0a2a15", stroke: "#16a34a", text: "#86efac" },
  fault:        { fill: "#2a0a0a", stroke: "#dc2626", text: "#fca5a5" },
};

const CONN_COLORS: Record<FbFlowConnection["type"], string> = {
  normal:   "#4b5563",
  fault:    "#dc2626",
  selfhold: "#6b7280",
  reset:    "#d97706",
};

const TITLE_COLOR  = "#e2e8f0";
const LABEL_COLOR  = "#6b7280";
const COL_HDR_COLOR = "#64748b";
const COL_DIVIDER  = "#1e2330";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_W      = 160;  // fixed node width
const NODE_H      = 38;   // normal node height
const OUTPUT_H    = 44;   // output hexagon height
const OR_H_GAP    = 10;   // horizontal gap between sibling nodes in an OR row
const ROW_V_GAP   = 22;   // vertical gap between rows
const COL_PAD_X   = 20;   // horizontal padding inside each column (each side)
const COL_GAP     = 16;   // gap between adjacent columns
const TOP_PAD     = 42;   // top padding (space for column header label)
const BOTTOM_PAD  = 12;   // extra padding below output node

// ---------------------------------------------------------------------------
// Per-column independent layout engine
//
// Rule: each column is a standalone top-to-bottom trace. Nodes are NEVER
// shared between columns. Positions are computed purely from the connection
// graph — the AI-provided x,y are ignored entirely.
//
// Algorithm:
//   1. BFS backwards from the output node to assign a "depth" to each node
//      (depth 0 = output, depth N = leaf inputs).
//   2. Invert depth → render level (level 0 = top, level N = output at bottom).
//   3. Within each level, nodes are placed side by side (OR branches).
//   4. Column width = widest row + 2×COL_PAD_X.
// ---------------------------------------------------------------------------

interface LayedOutColumn {
  outputName: string;
  nodes: FbFlowNode[];          // with computed x, y, width, height
  connections: FbFlowConnection[];
  width: number;
  height: number;
}

function layoutColumn(
  col: FbFlowColumn,
  offsetX: number,
): LayedOutColumn {
  if (col.nodes.length === 0) {
    return { ...col, width: NODE_W + 2 * COL_PAD_X, height: 0 };
  }

  // Clone nodes so we can mutate x/y/width/height without affecting the source
  const nodeMap = new Map<string, FbFlowNode>(
    col.nodes.map((n) => [n.id, { ...n }]),
  );

  // Build parent map: toId → [fromId] (who feeds into this node?)
  const parents = new Map<string, string[]>();
  for (const n of col.nodes) parents.set(n.id, []);
  for (const c of col.connections) {
    if (c.type === "selfhold") continue;   // skip back-edges
    const list = parents.get(c.toId);
    if (list) list.push(c.fromId);
  }

  // Find the output node (type "output" or "fault"); fall back to last node
  const outputNode =
    [...nodeMap.values()].find(
      (n) => n.type === "output" || n.type === "fault",
    ) ?? [...nodeMap.values()][nodeMap.size - 1];

  // BFS backwards from output: depth 0 = output, depth N = leaf inputs
  const depth = new Map<string, number>();
  const queue: string[] = [outputNode.id];
  depth.set(outputNode.id, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const pid of parents.get(id) ?? []) {
      if (!depth.has(pid)) {
        depth.set(pid, d + 1);
        queue.push(pid);
      }
    }
  }

  // Assign any unreachable nodes (disconnected) to maxDepth + 1
  const maxDepth = Math.max(0, ...[...depth.values()]);
  for (const n of col.nodes) {
    if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
  }

  // Group nodes by depth
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  // Render order: highest depth first (inputs at top), depth 0 last (output)
  const sortedDepths = [...byDepth.keys()].sort((a, b) => b - a);

  // Compute column width to fit the widest row
  const maxNodesInRow = Math.max(...[...byDepth.values()].map((ids) => ids.length));
  const maxRowW = maxNodesInRow * NODE_W + (maxNodesInRow - 1) * OR_H_GAP;
  const colWidth = maxRowW + 2 * COL_PAD_X;

  // Assign x, y, width, height for each node
  let y = TOP_PAD;
  for (const d of sortedDepths) {
    const ids = byDepth.get(d)!;
    const rowW = ids.length * NODE_W + (ids.length - 1) * OR_H_GAP;
    const rowStartX = offsetX + (colWidth - rowW) / 2;

    for (let i = 0; i < ids.length; i++) {
      const n = nodeMap.get(ids[i])!;
      n.width  = NODE_W;
      n.height = n.type === "output" || n.type === "fault" ? OUTPUT_H : NODE_H;
      n.x = rowStartX + i * (NODE_W + OR_H_GAP);
      n.y = y;
    }

    const rowH = d === 0 ? OUTPUT_H : NODE_H;
    y += rowH + ROW_V_GAP;
  }

  const totalH = y - ROW_V_GAP + BOTTOM_PAD;

  return {
    outputName:  col.outputName,
    nodes:       [...nodeMap.values()],
    connections: col.connections,
    width:       colWidth,
    height:      totalH,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function cx(n: FbFlowNode) { return n.x + n.width / 2; }
function cy(n: FbFlowNode) { return n.y + n.height / 2; }
function bottom(n: FbFlowNode) { return n.y + n.height; }
function top(n: FbFlowNode)    { return n.y; }

function rightAnglePath(x1: number, y1: number, x2: number, y2: number) {
  const midY = (y1 + y2) / 2;
  return `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
}

function hexagonPoints(x: number, y: number, w: number, h: number) {
  const notch = 12;
  return [
    [x + notch,     y      ],
    [x + w - notch, y      ],
    [x + w,         y + h/2],
    [x + w - notch, y + h  ],
    [x + notch,     y + h  ],
    [x,             y + h/2],
  ].map((p) => p.join(",")).join(" ");
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

function renderNode(node: FbFlowNode): React.ReactNode {
  const colors = NODE_COLORS[node.type];
  const ncx = cx(node);
  const ncy = cy(node);
  const MAX_LEN = 22;
  const label =
    node.label.length > MAX_LEN
      ? node.label.slice(0, MAX_LEN - 1) + "…"
      : node.label;

  let shape: React.ReactNode;
  if (node.shape === "hexagon") {
    shape = (
      <polygon
        points={hexagonPoints(node.x, node.y, node.width, node.height)}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth="1.5"
      />
    );
  } else if (node.shape === "pill") {
    const rx = node.height / 2;
    shape = (
      <rect
        x={node.x} y={node.y} width={node.width} height={node.height}
        rx={rx} ry={rx}
        fill={colors.fill} stroke={colors.stroke} strokeWidth="1.5"
      />
    );
  } else {
    shape = (
      <rect
        x={node.x} y={node.y} width={node.width} height={node.height}
        rx={6} ry={6}
        fill={colors.fill} stroke={colors.stroke} strokeWidth="1.5"
      />
    );
  }

  return (
    <g key={node.id}>
      {shape}
      <text
        x={ncx}
        y={ncy + (node.sublabel ? -5 : 1)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontFamily="JetBrains Mono, Consolas, monospace"
        fill={colors.text}
      >
        {label}
      </text>
      {node.sublabel && (
        <text
          x={ncx} y={ncy + 9}
          textAnchor="middle" dominantBaseline="central"
          fontSize="8" fontFamily="sans-serif" fill={LABEL_COLOR}
        >
          {node.sublabel}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Connection renderer
// ---------------------------------------------------------------------------

function renderConnection(
  conn: FbFlowConnection,
  nodeMap: Map<string, FbFlowNode>,
): React.ReactNode {
  const from = nodeMap.get(conn.fromId);
  const to   = nodeMap.get(conn.toId);
  if (!from || !to) return null;

  const x1 = cx(from), y1 = bottom(from);
  const x2 = cx(to),   y2 = top(to);
  const color = CONN_COLORS[conn.type];
  const dash  = conn.type === "selfhold" ? "4 3" : undefined;
  const d     = rightAnglePath(x1, y1, x2, y2);

  return (
    <g key={`${conn.fromId}->${conn.toId}`}>
      <path
        d={d} stroke={color} strokeWidth="1.5" fill="none"
        strokeDasharray={dash} markerEnd="url(#arrowhead)"
      />
      {conn.label && (
        <text
          x={(x1 + x2) / 2 + 4}
          y={(y1 + y2) / 2}
          fontSize="8" fill={LABEL_COLOR} fontFamily="sans-serif"
        >
          {conn.label}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Single laid-out column renderer
// ---------------------------------------------------------------------------

function renderColumn(col: LayedOutColumn): React.ReactNode {
  const nodeMap = new Map<string, FbFlowNode>(col.nodes.map((n) => [n.id, n]));
  const colX = col.nodes.length > 0 ? Math.min(...col.nodes.map((n) => n.x)) - COL_PAD_X : 0;

  return (
    <g key={col.outputName}>
      {/* column header — output name above the column */}
      <text
        x={colX + col.width / 2}
        y={TOP_PAD - 10}
        textAnchor="middle"
        fontSize="9"
        fontFamily="JetBrains Mono, Consolas, monospace"
        fill={COL_HDR_COLOR}
      >
        {col.outputName}
      </text>
      {/* connections drawn first so nodes appear on top */}
      {col.connections.map((c) => renderConnection(c, nodeMap))}
      {col.nodes.map((n) => renderNode(n))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function renderLegend(x: number, y: number): React.ReactNode {
  const items: Array<{ type: FbFlowNode["type"]; label: string }> = [
    { type: "input",        label: "VAR_INPUT"  },
    { type: "condition",    label: "Condition"  },
    { type: "timer",        label: "Timer/Edge" },
    { type: "intermediate", label: "Static var" },
    { type: "output",       label: "VAR_OUTPUT" },
    { type: "fault",        label: "Fault"      },
  ];
  const itemW = 92;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <text fontSize="8" fill={LABEL_COLOR} fontFamily="sans-serif" y={0}>
        Legend:
      </text>
      {items.map((item, i) => {
        const colors = NODE_COLORS[item.type];
        const ix = (i % 3) * itemW;
        const iy = Math.floor(i / 3) * 18 + 10;
        return (
          <g key={item.type} transform={`translate(${ix}, ${iy})`}>
            <rect width={10} height={10} rx={2}
              fill={colors.fill} stroke={colors.stroke} strokeWidth="1" />
            <text x={14} y={8} fontSize="8" fill={LABEL_COLOR} fontFamily="sans-serif">
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Full diagram SVG — computes layout then renders
// ---------------------------------------------------------------------------

// Represents either a laid-out signal-flow column or a truth-table column
interface RenderedCol {
  outputName: string;
  svg: React.ReactNode;
  width: number;
  height: number;
}

function DiagramSvg({ diagram }: { diagram: FbFlowDiagram }) {
  let xCursor = 0;
  const rendered: RenderedCol[] = diagram.columns.map((col, i) => {
    if (i > 0) xCursor += COL_GAP;
    const offsetX = xCursor;

    if (col.truthTable && col.truthTable.rows.length > 0) {
      const { svg, width, height } = renderTruthTableColumn(col, offsetX);
      xCursor += width;
      return { outputName: col.outputName, svg, width, height };
    }

    const laidOut = layoutColumn(col, offsetX);
    xCursor += laidOut.width;
    return {
      outputName: col.outputName,
      svg: renderColumn(laidOut),
      width: laidOut.width,
      height: laidOut.height,
    };
  });

  const totalW  = Math.max(400, xCursor);
  const maxColH = Math.max(200, ...rendered.map((c) => c.height));
  const titleH  = 28;
  const legendH = 52;
  const totalH  = titleH + maxColH + legendH + 16;

  // Column divider lines
  const dividers: React.ReactNode[] = [];
  let divX = 0;
  for (let i = 0; i < rendered.length - 1; i++) {
    divX += rendered[i].width + COL_GAP / 2;
    dividers.push(
      <line
        key={`div-${i}`}
        x1={divX} y1={titleH + TOP_PAD - 20}
        x2={divX} y2={titleH + maxColH}
        stroke={COL_DIVIDER} strokeWidth="1"
      />,
    );
    divX += COL_GAP / 2;
  }

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      width={totalW}
      height={totalH}
      style={{ maxWidth: "100%" }}
    >
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#4b5563" />
        </marker>
      </defs>

      <rect width={totalW} height={totalH} fill="#0f1117" rx={8} />

      <text
        x={totalW / 2} y={18}
        textAnchor="middle" fontSize="12" fontWeight="600"
        fontFamily="sans-serif" fill={TITLE_COLOR}
      >
        {diagram.title}
      </text>

      {dividers}

      <g transform={`translate(0, ${titleH})`}>
        {rendered.map((c) => c.svg)}
      </g>

      {renderLegend(8, titleH + maxColH + 8)}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function FbFlowRenderer({
  diagrams,
  className,
}: {
  diagrams: FbFlowDiagram[];
  className?: string;
}) {
  if (diagrams.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No signal flow detected
      </div>
    );
  }

  return (
    <div className={className}>
      {diagrams.map((diagram, i) => (
        <div key={i} className="mb-6">
          <DiagramSvg diagram={diagram} />
        </div>
      ))}
    </div>
  );
}
