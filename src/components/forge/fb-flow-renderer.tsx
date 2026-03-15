import type {
  FbFlowDiagram,
  FbFlowColumn,
  FbFlowNode,
  FbFlowConnection,
} from "@/lib/fb-flow-diagram";

// ---------------------------------------------------------------------------
// Color tokens (hard-coded dark-mode values matching the spec)
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<
  FbFlowNode["type"],
  { fill: string; stroke: string; text: string }
> = {
  input: { fill: "#0d2a4a", stroke: "#2563eb", text: "#93c5fd" },
  condition: { fill: "#1a1035", stroke: "#7c3aed", text: "#c4b5fd" },
  timer: { fill: "#0a2a2a", stroke: "#0d9488", text: "#5eead4" },
  intermediate: { fill: "#1e1e2e", stroke: "#4b5563", text: "#9ca3af" },
  output: { fill: "#0a2a15", stroke: "#16a34a", text: "#86efac" },
  fault: { fill: "#2a0a0a", stroke: "#dc2626", text: "#fca5a5" },
};

const CONN_COLORS: Record<FbFlowConnection["type"], string> = {
  normal: "#4b5563",
  fault: "#dc2626",
  selfhold: "#6b7280",
  reset: "#d97706",
};

const TITLE_COLOR = "#e2e8f0";
const LABEL_COLOR = "#6b7280";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Right-angle path: vertical down from (x1,y1) to midY, horizontal to x2, vertical to y2 */
function rightAnglePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const midY = (y1 + y2) / 2;
  return `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
}

/** Hexagon polygon points from bounding box */
function hexagonPoints(
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const notch = 12;
  const points = [
    [x + notch, y],
    [x + w - notch, y],
    [x + w, y + h / 2],
    [x + w - notch, y + h],
    [x + notch, y + h],
    [x, y + h / 2],
  ];
  return points.map((p) => p.join(",")).join(" ");
}

/** Centre of a node */
function nodeCX(node: FbFlowNode): number {
  return node.x + node.width / 2;
}
function nodeCY(node: FbFlowNode): number {
  return node.y + node.height / 2;
}
function nodeBottom(node: FbFlowNode): number {
  return node.y + node.height;
}
function nodeTop(node: FbFlowNode): number {
  return node.y;
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

function renderNode(node: FbFlowNode): React.ReactNode {
  const colors = NODE_COLORS[node.type];
  const cx = nodeCX(node);
  const cy = nodeCY(node);

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
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={rx}
        ry={rx}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth="1.5"
      />
    );
  } else {
    // rect
    shape = (
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={6}
        ry={6}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth="1.5"
      />
    );
  }

  // Label — truncate if needed
  const maxLabelLen = 22;
  const displayLabel =
    node.label.length > maxLabelLen
      ? node.label.slice(0, maxLabelLen - 1) + "…"
      : node.label;

  return (
    <g key={node.id}>
      {shape}
      <text
        x={cx}
        y={cy + (node.sublabel ? -5 : 1)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontFamily="JetBrains Mono, Consolas, monospace"
        fill={colors.text}
      >
        {displayLabel}
      </text>
      {node.sublabel && (
        <text
          x={cx}
          y={cy + 9}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="8"
          fontFamily="sans-serif"
          fill={LABEL_COLOR}
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
  const to = nodeMap.get(conn.toId);
  if (!from || !to) return null;

  const x1 = nodeCX(from);
  const y1 = nodeBottom(from);
  const x2 = nodeCX(to);
  const y2 = nodeTop(to);

  const color = CONN_COLORS[conn.type];
  const dashArray = conn.type === "selfhold" ? "4 3" : undefined;

  const d = rightAnglePath(x1, y1, x2, y2);

  return (
    <g key={`${conn.fromId}-${conn.toId}`}>
      <path
        d={d}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray={dashArray}
        markerEnd="url(#arrowhead)"
      />
      {conn.label && (
        <text
          x={(x1 + x2) / 2 + 4}
          y={(y1 + y2) / 2}
          fontSize="8"
          fill={LABEL_COLOR}
          fontFamily="sans-serif"
        >
          {conn.label}
        </text>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Column renderer
// ---------------------------------------------------------------------------

function renderColumn(col: FbFlowColumn): React.ReactNode {
  const nodeMap = new Map<string, FbFlowNode>(
    col.nodes.map((n) => [n.id, n]),
  );

  return (
    <g key={col.outputName}>
      {col.connections.map((c) => renderConnection(c, nodeMap))}
      {col.nodes.map((n) => renderNode(n))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Diagram bounds calculation
// ---------------------------------------------------------------------------

function diagramBounds(diagram: FbFlowDiagram): {
  width: number;
  height: number;
} {
  let maxX = 400;
  let maxY = 300;

  for (const col of diagram.columns) {
    for (const node of col.nodes) {
      maxX = Math.max(maxX, node.x + node.width + 32);
      maxY = Math.max(maxY, node.y + node.height + 32);
    }
  }

  return { width: maxX, height: maxY };
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function renderLegend(y: number): React.ReactNode {
  const items: Array<{ type: FbFlowNode["type"]; label: string }> = [
    { type: "input", label: "VAR_INPUT" },
    { type: "condition", label: "Condition" },
    { type: "timer", label: "Timer/Edge" },
    { type: "intermediate", label: "Static var" },
    { type: "output", label: "VAR_OUTPUT" },
    { type: "fault", label: "Fault" },
  ];

  const itemW = 95;

  return (
    <g transform={`translate(8, ${y})`}>
      <text
        fontSize="8"
        fill={LABEL_COLOR}
        fontFamily="sans-serif"
        y={0}
      >
        Legend:
      </text>
      {items.map((item, i) => {
        const colors = NODE_COLORS[item.type];
        const x = (i % 3) * itemW;
        const iy = Math.floor(i / 3) * 18 + 10;
        return (
          <g key={item.type} transform={`translate(${x}, ${iy})`}>
            <rect
              width={10}
              height={10}
              rx={2}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth="1"
            />
            <text
              x={14}
              y={8}
              fontSize="8"
              fill={LABEL_COLOR}
              fontFamily="sans-serif"
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Single diagram SVG
// ---------------------------------------------------------------------------

function DiagramSvg({ diagram }: { diagram: FbFlowDiagram }) {
  const { width, height } = diagramBounds(diagram);
  const titleH = 28;
  const legendH = 56;
  const totalH = titleH + height + legendH + 16;

  return (
    <svg
      viewBox={`0 0 ${width} ${totalH}`}
      width={width}
      height={totalH}
      style={{ maxWidth: "100%" }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L6,3 z" fill="#4b5563" />
        </marker>
      </defs>

      {/* Background */}
      <rect width={width} height={totalH} fill="#0f1117" rx={8} />

      {/* Title */}
      <text
        x={width / 2}
        y={18}
        textAnchor="middle"
        fontSize="12"
        fontFamily="sans-serif"
        fontWeight="600"
        fill={TITLE_COLOR}
      >
        {diagram.title}
      </text>

      {/* Columns */}
      <g transform={`translate(0, ${titleH})`}>
        {diagram.columns.map((col) => renderColumn(col))}
      </g>

      {/* Legend */}
      <g transform={`translate(8, ${titleH + height + 8})`}>
        {renderLegend(0)}
      </g>
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
