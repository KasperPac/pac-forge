/**
 * Renders individual ladder logic elements as SVG groups.
 */

import type { LadElement } from "@/types/lad";
import { CELL_W, CELL_H, BOX_W, BOX_H } from "@/lib/lad-layout";
import { isBoxElement } from "@/types/lad";

interface LadElementRendererProps {
  element: LadElement;
  x: number;
  y: number;
  isSelected: boolean;
  onClick: (id: string) => void;
}

export function LadElementRenderer({
  element,
  x,
  y,
  isSelected,
  onClick,
}: LadElementRendererProps) {
  const w = isBoxElement(element.type) ? BOX_W : CELL_W;
  const h = isBoxElement(element.type) ? BOX_H : CELL_H;
  const cy = y + h / 2;

  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClick(element.id);
      }}
    >
      {/* Selection highlight */}
      {isSelected && (
        <rect
          x={x - 2}
          y={y - 2}
          width={w + 4}
          height={h + 4}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          rx={3}
        />
      )}

      {/* Horizontal wire through element */}
      <line x1={x} y1={cy} x2={x + w} y2={cy} stroke="#6b7280" strokeWidth={1.5} />

      {/* Element-specific rendering */}
      {renderElement(element, x, y, w, h, cy)}
    </g>
  );
}

function renderElement(
  el: LadElement,
  x: number,
  y: number,
  w: number,
  h: number,
  cy: number,
) {
  switch (el.type) {
    case "NO_CONTACT":
      return <NoContact x={x} cy={cy} w={w} operand={el.operand} />;
    case "NC_CONTACT":
      return <NcContact x={x} cy={cy} w={w} operand={el.operand} />;
    case "OUTPUT_COIL":
      return <Coil x={x} cy={cy} w={w} operand={el.operand} />;
    case "SET_COIL":
      return <Coil x={x} cy={cy} w={w} operand={el.operand} label="S" />;
    case "RESET_COIL":
      return <Coil x={x} cy={cy} w={w} operand={el.operand} label="R" />;
    case "TON":
    case "TOF":
      return <TimerBox x={x} y={y} w={w} h={h} el={el} />;
    case "CTU":
    case "CTD":
      return <CounterBox x={x} y={y} w={w} h={h} el={el} />;
    case "CMP":
      return <CompareBox x={x} y={y} w={w} h={h} el={el} />;
    case "MATH":
      return <MathBox x={x} y={y} w={w} h={h} el={el} />;
    case "MOVE":
      return <MoveBox x={x} y={y} w={w} h={h} el={el} />;
    case "FB_CALL":
      return <FbCallBox x={x} y={y} w={w} h={h} el={el} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Contact symbols
// ---------------------------------------------------------------------------

/** Truncate operand for display — show last component (after last dot) with DB prefix hint */
function truncateOperand(operand: string, maxChars = 18): string {
  if (operand.length <= maxChars) return operand;
  // For DB.field style: show abbreviated DB + field
  const dotIdx = operand.lastIndexOf(".");
  if (dotIdx > 0) {
    const db = operand.slice(0, dotIdx).replace(/"/g, "");
    const field = operand.slice(dotIdx + 1);
    // Abbreviate DB name: take first 6 chars + ".." + field
    const abbrevDb = db.length > 8 ? db.slice(0, 6) + ".." : db;
    const result = `${abbrevDb}.${field}`;
    return result.length <= maxChars ? result : field;
  }
  return operand.slice(0, maxChars - 2) + "..";
}

/** Adaptive font size — shrink for long operands */
function operandFontSize(operand: string): number {
  if (operand.length > 18) return 9;
  if (operand.length > 12) return 10;
  return 11;
}

function NoContact({ x, cy, w, operand }: { x: number; cy: number; w: number; operand: string }) {
  const cx = x + w / 2;
  const gap = 8;
  const display = truncateOperand(operand);
  return (
    <>
      {/* Left bracket */}
      <line x1={cx - gap} y1={cy - 12} x2={cx - gap} y2={cy + 12} stroke="#e2e8f0" strokeWidth={2} />
      {/* Right bracket */}
      <line x1={cx + gap} y1={cy - 12} x2={cx + gap} y2={cy + 12} stroke="#e2e8f0" strokeWidth={2} />
      {/* Operand label */}
      <text x={cx} y={cy - 18} textAnchor="middle" fill="#93c5fd" fontSize={operandFontSize(display)} fontFamily="monospace">
        <title>{operand}</title>
        {display}
      </text>
    </>
  );
}

function NcContact({ x, cy, w, operand }: { x: number; cy: number; w: number; operand: string }) {
  const cx = x + w / 2;
  const gap = 8;
  const display = truncateOperand(operand);
  return (
    <>
      {/* Left bracket */}
      <line x1={cx - gap} y1={cy - 12} x2={cx - gap} y2={cy + 12} stroke="#e2e8f0" strokeWidth={2} />
      {/* Right bracket */}
      <line x1={cx + gap} y1={cy - 12} x2={cx + gap} y2={cy + 12} stroke="#e2e8f0" strokeWidth={2} />
      {/* Diagonal slash (negation) */}
      <line x1={cx - 6} y1={cy + 10} x2={cx + 6} y2={cy - 10} stroke="#e2e8f0" strokeWidth={2} />
      {/* Operand label */}
      <text x={cx} y={cy - 18} textAnchor="middle" fill="#93c5fd" fontSize={operandFontSize(display)} fontFamily="monospace">
        <title>{operand}</title>
        {display}
      </text>
    </>
  );
}

// ---------------------------------------------------------------------------
// Coil symbols
// ---------------------------------------------------------------------------

function Coil({ x, cy, w, operand, label }: { x: number; cy: number; w: number; operand: string; label?: string }) {
  const cx = x + w / 2;
  return (
    <>
      {/* Coil parentheses */}
      <path
        d={`M ${cx - 10} ${cy - 12} A 10 12 0 0 0 ${cx - 10} ${cy + 12}`}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={2}
      />
      <path
        d={`M ${cx + 10} ${cy - 12} A 10 12 0 0 1 ${cx + 10} ${cy + 12}`}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={2}
      />
      {/* S/R label inside */}
      {label && (
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#fbbf24" fontSize={12} fontWeight="bold" fontFamily="monospace">
          {label}
        </text>
      )}
      {/* Operand label */}
      <text x={cx} y={cy - 18} textAnchor="middle" fill="#86efac" fontSize={operandFontSize(truncateOperand(operand))} fontFamily="monospace">
        <title>{operand}</title>
        {truncateOperand(operand)}
      </text>
    </>
  );
}

// ---------------------------------------------------------------------------
// Box elements (timer, counter, compare, math, move)
// ---------------------------------------------------------------------------

function BoxFrame({ x, y, w, h, title }: { x: number; y: number; w: number; h: number; title: string }) {
  const pad = 16;
  return (
    <>
      <rect
        x={x + pad}
        y={y + 4}
        width={w - pad * 2}
        height={h - 8}
        fill="#1e293b"
        stroke="#475569"
        strokeWidth={1.5}
        rx={3}
      />
      {/* Title bar */}
      <rect
        x={x + pad}
        y={y + 4}
        width={w - pad * 2}
        height={18}
        fill="#334155"
        rx={3}
      />
      <rect
        x={x + pad}
        y={y + 16}
        width={w - pad * 2}
        height={6}
        fill="#334155"
      />
      <text
        x={x + w / 2}
        y={y + 17}
        textAnchor="middle"
        fill="#e2e8f0"
        fontSize={11}
        fontWeight="bold"
        fontFamily="monospace"
      >
        {title}
      </text>
    </>
  );
}

function PinLabel({ x, y, text, align }: { x: number; y: number; text: string; align: "left" | "right" }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={align === "left" ? "start" : "end"}
      fill="#94a3b8"
      fontSize={9}
      fontFamily="monospace"
    >
      {text}
    </text>
  );
}

function ValueLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="end"
      fill="#93c5fd"
      fontSize={10}
      fontFamily="monospace"
    >
      {text}
    </text>
  );
}

function TimerBox({ x, y, w, h, el }: { x: number; y: number; w: number; h: number; el: LadElement }) {
  const pad = 16;
  const rx = x + pad + 4;
  const ry = x + w - pad - 4;
  return (
    <>
      <BoxFrame x={x} y={y} w={w} h={h} title={el.type} />
      <PinLabel x={rx} y={y + 38} text="IN" align="left" />
      <PinLabel x={rx} y={y + 54} text="PT" align="left" />
      <ValueLabel x={ry} y={y + 54} text={el.presetTime ?? "T#1s"} />
      <PinLabel x={ry} y={y + 38} text="Q" align="right" />
      <ValueLabel x={ry} y={y + 46} text={el.operand} />
      <PinLabel x={ry} y={y + 70} text="ET" align="right" />
    </>
  );
}

function CounterBox({ x, y, w, h, el }: { x: number; y: number; w: number; h: number; el: LadElement }) {
  const pad = 16;
  const rx = x + pad + 4;
  const ry = x + w - pad - 4;
  const cuLabel = el.type === "CTU" ? "CU" : "CD";
  return (
    <>
      <BoxFrame x={x} y={y} w={w} h={h} title={el.type} />
      <PinLabel x={rx} y={y + 38} text={cuLabel} align="left" />
      <PinLabel x={rx} y={y + 54} text={el.type === "CTU" ? "R" : "LD"} align="left" />
      <PinLabel x={rx} y={y + 70} text="PV" align="left" />
      <ValueLabel x={ry} y={y + 70} text={String(el.presetCount ?? 10)} />
      <PinLabel x={ry} y={y + 38} text="Q" align="right" />
      <ValueLabel x={ry} y={y + 46} text={el.operand} />
      <PinLabel x={ry} y={y + 62} text="CV" align="right" />
    </>
  );
}

function CompareBox({ x, y, w, h, el }: { x: number; y: number; w: number; h: number; el: LadElement }) {
  const pad = 16;
  const rx = x + pad + 4;
  const ry = x + w - pad - 4;
  const title = `CMP ${el.cmpOperator ?? "=="}`;
  return (
    <>
      <BoxFrame x={x} y={y} w={w} h={h} title={title} />
      <PinLabel x={rx} y={y + 42} text="IN1" align="left" />
      <ValueLabel x={ry} y={y + 42} text={el.operand} />
      <PinLabel x={rx} y={y + 58} text="IN2" align="left" />
      <ValueLabel x={ry} y={y + 58} text={el.operand2 ?? ""} />
    </>
  );
}

function MathBox({ x, y, w, h, el }: { x: number; y: number; w: number; h: number; el: LadElement }) {
  const pad = 16;
  const rx = x + pad + 4;
  const ry = x + w - pad - 4;
  return (
    <>
      <BoxFrame x={x} y={y} w={w} h={h} title={el.mathOperator ?? "ADD"} />
      <PinLabel x={rx} y={y + 38} text="EN" align="left" />
      <PinLabel x={rx} y={y + 52} text="IN1" align="left" />
      <ValueLabel x={ry} y={y + 52} text={el.operand} />
      <PinLabel x={rx} y={y + 66} text="IN2" align="left" />
      <ValueLabel x={ry} y={y + 66} text={el.operand2 ?? ""} />
      <PinLabel x={ry} y={y + 38} text="ENO" align="right" />
      <PinLabel x={ry} y={y + 80} text="OUT" align="right" />
      <ValueLabel x={ry} y={y + 88} text={el.outputOperand ?? ""} />
    </>
  );
}

function MoveBox({ x, y, w, h, el }: { x: number; y: number; w: number; h: number; el: LadElement }) {
  const pad = 16;
  const rx = x + pad + 4;
  const ry = x + w - pad - 4;
  return (
    <>
      <BoxFrame x={x} y={y} w={w} h={h} title="MOVE" />
      <PinLabel x={rx} y={y + 38} text="EN" align="left" />
      <PinLabel x={rx} y={y + 56} text="IN" align="left" />
      <ValueLabel x={ry} y={y + 56} text={el.operand} />
      <PinLabel x={ry} y={y + 38} text="ENO" align="right" />
      <PinLabel x={ry} y={y + 56} text="OUT1" align="right" />
      <ValueLabel x={ry} y={y + 64} text={el.outputOperand ?? ""} />
    </>
  );
}

function FbCallBox({ x, y, w, h, el }: { x: number; y: number; w: number; h: number; el: LadElement }) {
  const pad = 16;
  const boxLeft = x + pad;
  const boxRight = x + w - pad;
  const boxMid = x + w / 2;
  const params = el.callParams ?? [];
  const inputs = params.filter(p => p.direction === "in" || p.direction === "inout");
  const outputs = params.filter(p => p.direction === "out");
  const title = el.fbName ?? el.operand;
  const instDb = el.fbInstanceDb ?? el.instanceDb ?? "";
  const lineH = 14;
  // Rows: EN/ENO row, then max(inputs, outputs) param rows
  const maxRows = Math.max(inputs.length, outputs.length);
  const firstParamY = y + 40; // after title bar

  return (
    <>
      <BoxFrame x={x} y={y} w={w} h={h} title={title} />
      {/* Instance DB name above the box */}
      <text x={boxMid} y={y - 2} textAnchor="middle" fontSize={9} fill="#8b8fa3" fontFamily="monospace">
        {instDb}
      </text>
      {/* EN / ENO row */}
      <text x={boxLeft + 4} y={firstParamY} textAnchor="start" fill="#94a3b8" fontSize={9} fontFamily="monospace">EN</text>
      <text x={boxRight - 4} y={firstParamY} textAnchor="end" fill="#94a3b8" fontSize={9} fontFamily="monospace">ENO</text>
      {/* Input params — pin name inside box left, value outside box left */}
      {inputs.map((p, i) => {
        const py = firstParamY + (i + 1) * lineH;
        return (
          <g key={`in-${p.name}`}>
            {/* Value label outside left edge */}
            <text x={boxLeft - 4} y={py} textAnchor="end" fill="#93c5fd" fontSize={9} fontFamily="monospace">
              {p.value}
            </text>
            {/* Pin name inside left edge */}
            <text x={boxLeft + 4} y={py} textAnchor="start" fill="#94a3b8" fontSize={9} fontFamily="monospace">
              {p.name}
            </text>
            {/* Connection dash */}
            <line x1={boxLeft - 2} y1={py - 3} x2={boxLeft} y2={py - 3} stroke="#475569" strokeWidth={1} />
          </g>
        );
      })}
      {/* Output params — pin name inside box right, value outside box right */}
      {outputs.map((p, i) => {
        const py = firstParamY + (i + 1) * lineH;
        return (
          <g key={`out-${p.name}`}>
            {/* Pin name inside right edge */}
            <text x={boxRight - 4} y={py} textAnchor="end" fill="#94a3b8" fontSize={9} fontFamily="monospace">
              {p.name}
            </text>
            {/* Value label outside right edge */}
            <text x={boxRight + 4} y={py} textAnchor="start" fill="#93c5fd" fontSize={9} fontFamily="monospace">
              {p.value}
            </text>
            {/* Connection dash */}
            <line x1={boxRight} y1={py - 3} x2={boxRight + 2} y2={py - 3} stroke="#475569" strokeWidth={1} />
          </g>
        );
      })}
      {/* If outputs are fewer than inputs, pad the box visually */}
      {maxRows > 0 && null}
    </>
  );
}
