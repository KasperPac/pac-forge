import type {
  EmStateV2, EmTransitionV2, PermissiveCondition, PermissiveValue,
} from "@/types/spec-contract-v2";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";

// --- label formatting (pure, exported for tests) ---------------------------

function formatValue(v: PermissiveValue): string {
  if (v === true) return "TRUE";
  if (v === false) return "FALSE";
  return String(v); // numbers, "P_TRIG", "N_TRIG"
}

function formatCondition(c: PermissiveCondition): string {
  return `${c.tag} ${c.operator} ${formatValue(c.value)}`;
}

/** Machine-boolean label for a transition: trigger first, then AND-ed guards.
 *  Empty string when fully unconditional. Generic — no device names. */
export function formatTransition(t: EmTransitionV2): string {
  const parts: string[] = [];
  if (t.trigger.kind === "command") parts.push(formatCondition(t.trigger.expr));
  else parts.push("done"); // completion
  for (const g of t.guard) parts.push(formatCondition(g));
  return parts.join(" AND ");
}

// --- layout constants ------------------------------------------------------

const BOX_W = 200;
const BOX_H = 46;
const V_GAP = 54;          // vertical gap between stacked state boxes
const PAD = 16;
const GUTTER_STEP = 26;    // horizontal stagger per transition in the right gutter
const LABEL_MAX = 40;

const SAFE = { fill: "#dcfce7", stroke: "#16a34a", text: "#166534" };
const NORMAL = { fill: "#eef2ff", stroke: "#3050A0", text: "#1e293b" };
const EDGE = "#64748b";

function truncate(s: string): string {
  return s.length > LABEL_MAX ? s.slice(0, LABEL_MAX - 1) + "…" : s;
}

export function EmStateDiagram({
  states, transitions,
}: {
  states: EmStateV2[];
  transitions: EmTransitionV2[];
}) {
  if (states.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="font-mono text-xs text-muted-foreground/60">No state machine</span>
      </div>
    );
  }

  const ordered = orderStates(states, transitions);
  const indexOf = new Map(ordered.map((s, i) => [s.state_id, i]));
  const boxX = PAD;
  const yOf = (i: number) => PAD + i * (BOX_H + V_GAP);
  const midY = (i: number) => yOf(i) + BOX_H / 2;

  const gutterX = boxX + BOX_W + 8;
  const maxGutter = gutterX + (transitions.length + 1) * GUTTER_STEP;
  const totalW = Math.max(maxGutter + 8, boxX + BOX_W + 40);
  const totalH = yOf(ordered.length - 1) + BOX_H + PAD;

  return (
    <div className="h-full overflow-auto p-2" data-testid="em-state-diagram">
      <svg viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} style={{ maxWidth: "100%" }}>
        <defs>
          <marker id="em-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={EDGE} />
          </marker>
        </defs>

        {/* transitions first so boxes sit on top */}
        {transitions.map((t, i) => {
          const fi = indexOf.get(t.from_state_id);
          const ti = indexOf.get(t.to_state_id);
          if (fi === undefined || ti === undefined) return null;
          const gx = gutterX + i * GUTTER_STEP;
          const y1 = midY(fi);
          const y2 = midY(ti);
          const startX = boxX + BOX_W;
          const d = `M${startX} ${y1} L${gx} ${y1} L${gx} ${y2} L${startX} ${y2}`;
          const label = truncate(formatTransition(t));
          return (
            <g key={t.transition_id}>
              <path d={d} fill="none" stroke={EDGE} strokeWidth="1.5" markerEnd="url(#em-arrow)" />
              {label && (
                <text
                  x={gx + 4} y={(y1 + y2) / 2}
                  fontSize="9" fontFamily="JetBrains Mono, Consolas, monospace"
                  fill={EDGE} dominantBaseline="central"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* state boxes */}
        {ordered.map((s, i) => {
          const c = s.is_safe_state ? SAFE : NORMAL;
          const y = yOf(i);
          return (
            <g key={s.state_id}>
              <rect
                x={boxX} y={y} width={BOX_W} height={BOX_H} rx={8}
                fill={c.fill} stroke={c.stroke} strokeWidth="1.5"
              />
              <text
                x={boxX + BOX_W / 2} y={y + BOX_H / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize="12" fontFamily="Inter, sans-serif" fontWeight={600} fill={c.text}
              >
                <tspan>{s.name}</tspan>
                {s.is_safe_state ? <tspan> (safe)</tspan> : null}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
