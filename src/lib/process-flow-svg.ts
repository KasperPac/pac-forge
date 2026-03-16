/**
 * Custom SVG renderer for process flow diagrams.
 * Replaces Mermaid — deterministic layout, text wraps, no truncation.
 *
 * Node 3-line format:
 *   LINE 1 (12px bold, white)  — condition signal  "30a: PE01_DET = TRUE"
 *   LINE 2 (10px, muted)       — prose context      "Product at End A"
 *   LINE 3 (11px bold, teal)   — output signal      "InstM01.cmdFwd = TRUE"
 */
import type { ProcessSequence, SequenceRow } from "@/types/process-builder";

// ── Layout constants ──────────────────────────────────────────────────────────
const W       = 920;
const CX      = 400;   // center column X
const LX      = 130;   // left branch column X
const RX      = 670;   // right branch column X
const FAULT_X = 840;   // fault rail + node X

const CW = 280;   // center node width
const BW = 240;   // branch node width
const FW = 104;   // FAULT node width
const FH = 36;    // FAULT node height (fixed)

const VGAP  = 26;  // vertical gap between nodes
const DR    = 14;  // diamond half-size

// ── Text layout constants ─────────────────────────────────────────────────────
const COND_FS = 12; const COND_CW = 7.2; const COND_LH = 17;  // condition signal
const CTX_FS  = 10; const CTX_CW  = 6.0; const CTX_LH  = 14;  // prose context
const OUT_FS  = 11; const OUT_CW  = 6.6; const OUT_LH  = 15;  // output signal
const PAD_T   = 11; // top padding inside node
const PAD_B   = 11; // bottom padding inside node
const SECT_GAP = 5; // gap between text sections within a node

// ── Color palette ─────────────────────────────────────────────────────────────
const STYLE = {
  action:  { bg: "#0a3d35", bd: "#1D9E75" },
  monitor: { bg: "#1e1840", bd: "#7F77DD" },
  branch:  { bg: "#0a3d35", bd: "#1D9E75" },
  fault:   { bg: "#601818", bd: "#e05555" },
  idle:    { bg: "#1c1c1a", bd: "#666460" },
  safety:  { bg: "#2a1f50", bd: "#8070cc" },
};
type SK = keyof typeof STYLE;

const COL_COND   = "#e8e8e8";
const COL_CTX    = "#6b6b6b";
const COL_OUT_A  = "#5DCAA5";   // teal for action/branch
const COL_OUT_M  = "#9D94EE";   // purple for monitor
const COL_IDLE   = "#aaa8a0";
const ARROW_COL  = "#555";
const FAULT_COL  = "#E24B4A";

// ── String helpers ────────────────────────────────────────────────────────────
function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Strip parenthetical prose from a condition signal.
 * "PE01_DET = TRUE (product at End A)" → "PE01_DET = TRUE"
 */
function signalOnly(s: string): string {
  return (s ?? "").split(/[(\-,]/)[0].trim();
}

/**
 * Word-wrap text into lines that fit within maxWidth pixels.
 * Falls back to dot-split or hard-break for words wider than maxWidth.
 */
function wrapText(text: string, maxWidth: number, charWidth: number): string[] {
  const maxChars = Math.floor(maxWidth / charWidth);
  text = (text ?? "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > maxChars) {
      if (current) {
        lines.push(current);
        current = word;
      } else {
        // Single word too long — split at dot separator
        const dotIdx = word.indexOf(".");
        if (dotIdx > 0 && dotIdx < word.length - 1) {
          lines.push(word.slice(0, dotIdx + 1));
          current = word.slice(dotIdx + 1);
        } else {
          // Hard break
          lines.push(word.slice(0, maxChars));
          current = word.slice(maxChars);
        }
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Node measurement ──────────────────────────────────────────────────────────
interface NodeMeasure {
  condLines: string[];
  ctxLines:  string[];
  outLines:  string[];
  totalH:    number;
}

function measureNode(w: number, cond: string, ctx: string | null, out: string | null): NodeMeasure {
  const uw = w - 24;
  const condLines = wrapText(signalOnly(cond), uw, COND_CW);
  const ctxLines  = ctx ? wrapText(ctx, uw, CTX_CW) : [];
  const outLines  = (out && out !== "—" && out !== "-") ? wrapText(out, uw, OUT_CW) : [];

  let h = PAD_T + PAD_B;
  h += condLines.length * COND_LH;
  if (ctxLines.length  > 0) h += SECT_GAP + ctxLines.length  * CTX_LH;
  if (outLines.length  > 0) h += SECT_GAP + outLines.length   * OUT_LH;

  return { condLines, ctxLines, outLines, totalH: Math.max(h, 40) };
}

// ── SVG text block (multi-line with tspan) ────────────────────────────────────
function textBlock(
  cx: number, yTop: number,
  lines: string[], fs: number, fw: string, fill: string, lh: number,
): string {
  if (lines.length === 0) return "";
  const fwAttr = fw !== "normal" ? ` font-weight="${fw}"` : "";
  if (lines.length === 1) {
    const cy = yTop + lh / 2;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fs}"${fwAttr} fill="${fill}" font-family="monospace">${esc(lines[0])}</text>`;
  }
  const tspans = lines.map((l, i) =>
    `<tspan x="${cx}" y="${yTop + i * lh + lh / 2}">${esc(l)}</tspan>`
  ).join("");
  return `<text text-anchor="middle" dominant-baseline="central" font-size="${fs}"${fwAttr} fill="${fill}" font-family="monospace">${tspans}</text>`;
}

// ── SVG element factories ─────────────────────────────────────────────────────
function defs(): string {
  return `<defs>
  <marker id="m" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
    <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill="${ARROW_COL}"/>
  </marker>
  <marker id="mf" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
    <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill="${FAULT_COL}"/>
  </marker>
</defs>`;
}

/**
 * 3-line engineering node. Returns svg string + actual height.
 * yTop = top edge of the node rectangle.
 */
function engineerNode(
  cx: number, yTop: number, w: number, sk: SK,
  cond: string, ctx: string | null, out: string | null,
): { svg: string; height: number } {
  const s = STYLE[sk];
  const m = measureNode(w, cond, ctx, out);
  const x = cx - w / 2;
  const outCol = sk === "monitor" ? COL_OUT_M : COL_OUT_A;

  let svg = `<rect x="${x}" y="${yTop}" width="${w}" height="${m.totalH}" rx="8" fill="${s.bg}" stroke="${s.bd}" stroke-width="1.5"/>`;

  let contentY = yTop + PAD_T;

  svg += textBlock(cx, contentY, m.condLines, COND_FS, "600", COL_COND, COND_LH);
  contentY += m.condLines.length * COND_LH;

  if (m.ctxLines.length > 0) {
    contentY += SECT_GAP;
    svg += textBlock(cx, contentY, m.ctxLines, CTX_FS, "normal", COL_CTX, CTX_LH);
    contentY += m.ctxLines.length * CTX_LH;
  }

  if (m.outLines.length > 0) {
    contentY += SECT_GAP;
    svg += textBlock(cx, contentY, m.outLines, OUT_FS, "500", outCol, OUT_LH);
  }

  return { svg, height: m.totalH };
}

/** IDLE / start / end pill (fixed single-line height) */
function pill(cx: number, yTop: number, label: string): string {
  const s = STYLE.idle;
  const h = 36, w = CW;
  const x = cx - w / 2;
  const cy = yTop + h / 2;
  return `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" rx="18" fill="${s.bg}" stroke="${s.bd}" stroke-width="1.5"/><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${COL_IDLE}" font-family="monospace">${esc(label)}</text>`;
}
const PILL_H = 36;

/** FAULT node (fixed height) */
function faultNode(cx: number, cy: number): string {
  const s = STYLE.fault;
  const x = cx - FW / 2, y = cy - FH / 2;
  return `<rect x="${x}" y="${y}" width="${FW}" height="${FH}" rx="6" fill="${s.bg}" stroke="${s.bd}" stroke-width="1.5"/><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" fill="#fde8e8" font-family="monospace">⚠ FAULT</text>`;
}

/** Permissive/safety gate — dynamic height */
function gateNode(cx: number, yTop: number, title: string, subtitle: string | null): { svg: string; height: number } {
  const s = STYLE.safety;
  const w = CW, uw = w - 24;
  const titleLines = wrapText(title, uw, 7.2);
  const subLines   = subtitle ? wrapText(subtitle, uw, 6.0) : [];

  let h = PAD_T + PAD_B + titleLines.length * COND_LH;
  if (subLines.length > 0) h += SECT_GAP + subLines.length * CTX_LH;
  h = Math.max(h, 40);

  const x = cx - w / 2;
  let svg = `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" rx="6" fill="${s.bg}" stroke="${s.bd}" stroke-width="1.5"/>`;

  let contentY = yTop + PAD_T;
  svg += textBlock(cx, contentY, titleLines, COND_FS, "600", "#c8c4f4", COND_LH);
  contentY += titleLines.length * COND_LH;
  if (subLines.length > 0) {
    contentY += SECT_GAP;
    svg += textBlock(cx, contentY, subLines, CTX_FS, "normal", "#a09ece", CTX_LH);
  }

  return { svg, height: h };
}

/** XOR decision diamond */
function diamond(cx: number, cy: number): string {
  const r = DR;
  return `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="#161614" stroke="#555" stroke-width="1"/><text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central" font-size="7" fill="#777" font-family="monospace">XOR</text>`;
}

function aline(x1: number, y1: number, x2: number, y2: number, fault = false): string {
  const col = fault ? FAULT_COL : ARROW_COL;
  const mk  = fault ? "url(#mf)" : "url(#m)";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.5" marker-end="${mk}"/>`;
}

function pline(x1: number, y1: number, x2: number, y2: number, fault = false): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${fault ? FAULT_COL : "#3d3d3b"}" stroke-width="1.5"/>`;
}

function smallLabel(x: number, y: number, text: string, anchor: "start" | "middle" | "end", color: string): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central" font-size="10" fill="${color}" font-family="monospace">${esc(text)}</text>`;
}

// ── Step grouping ─────────────────────────────────────────────────────────────
interface SG {
  sn: number;
  main:     SequenceRow[];
  faults:   SequenceRow[];
  branched: boolean;
  bkeys:    string[];
}

function buildGroups(rows: SequenceRow[]): SG[] {
  const m = new Map<number, SequenceRow[]>();
  for (const r of rows) {
    if (!m.has(r.step)) m.set(r.step, []);
    m.get(r.step)!.push(r);
  }
  return [...m.keys()].sort((a, b) => a - b).map((sn) => {
    const all    = m.get(sn)!;
    const main   = all.filter((r) => r.type !== "fault_exit");
    const faults = all.filter((r) => r.type === "fault_exit");
    const bkeys  = [...new Set(main.map((r) => r.branch).filter((b): b is string => b !== null))];
    return { sn, main, faults, branched: bkeys.length > 1, bkeys };
  });
}

// ── Fault label rendering (stacked, wrapped) ──────────────────────────────────
function renderFaultLabels(
  faults: SequenceRow[],
  nodeLeftX: number,        // left edge of the originating node's right side (= cx + w/2)
  nodeCenterY: number,      // center Y of originating node
  fg: string[], bg: string[],
  faultYsOut: number[],
): void {
  if (faults.length === 0) return;

  const labelX = nodeLeftX + 4;
  const labelMaxW = FAULT_X - nodeLeftX - 8;
  const labelCW = 6.0; // 10px monospace
  const lh = 14;

  // Pre-measure all labels to compute total stacked height
  const wrappedFaults = faults.map((fe) =>
    wrapText(signalOnly(fe.condition), labelMaxW, labelCW).slice(0, 2) // max 2 lines per label
  );
  const totalLabelH = wrappedFaults.reduce((s, lines) => s + lines.length * lh, 0) +
    (faults.length - 1) * 4; // 4px gap between fault entries

  // Center the stack around nodeCenterY
  let labelY = nodeCenterY - totalLabelH / 2;

  faults.forEach((_fe, i) => {
    const lines = wrappedFaults[i];
    const entryH = lines.length * lh;
    const entryMidY = labelY + entryH / 2;

    faultYsOut.push(entryMidY);
    bg.push(pline(nodeLeftX, entryMidY, FAULT_X, entryMidY, true));

    lines.forEach((line, li) => {
      fg.push(smallLabel(labelX, labelY + li * lh + lh / 2, line, "start", "#e06060"));
    });

    labelY += entryH + 4;
  });
}

// ── Main renderer ─────────────────────────────────────────────────────────────
export function renderProcessFlowSvg(sequence: ProcessSequence): string {
  const rows = sequence.rows;

  if (!rows?.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 80"><rect width="400" height="80" fill="#0f0f0e"/><text x="200" y="40" text-anchor="middle" dominant-baseline="central" font-size="13" fill="#555" font-family="monospace">No sequence rows</text></svg>`;
  }

  const groups        = buildGroups(rows);
  const hasFaults     = rows.some((r) => r.type === "fault_exit" || r.next === "FAULT");
  const hasPermissives = (sequence.permissives?.length ?? 0) > 0;
  const hasSafety      = (sequence.safetyConditions?.length ?? 0) > 0;

  const bg: string[] = [defs()];
  const fg: string[] = [];

  // ── IDLE start pill ───────────────────────────────────────────────────────
  const START_YTOP = 16;
  fg.push(pill(CX, START_YTOP, sequence.name ?? "Sequence"));
  let prevCBot = START_YTOP + PILL_H;
  let y = prevCBot + VGAP;

  let inBranch = false;
  let bLBot = 0, bRBot = 0;
  const faultYs: number[] = [];

  // ── Permissive / safety gate ──────────────────────────────────────────────
  if (hasPermissives || hasSafety) {
    const title  = hasSafety && hasPermissives ? "Safety + Permissive Check"
                 : hasSafety                   ? "Safety Check"
                                               : "Permissive Check";
    const pList  = sequence.permissives ?? [];
    const subStr = pList.slice(0, 3)
      .map((p) => p.description || p.deviceName || "")
      .filter(Boolean)
      .join(", ");

    const { svg: gSvg, height: gH } = gateNode(CX, y, title, subStr || null);
    const gMidY = y + gH / 2;

    bg.push(aline(CX, prevCBot, CX, y));
    fg.push(gSvg);

    // Fail exit to fault rail
    faultYs.push(gMidY);
    bg.push(pline(CX + CW / 2, gMidY, FAULT_X, gMidY, true));
    fg.push(smallLabel(CX + CW / 2 + 4, gMidY - 8, "fail → FAULT", "start", "#9060b0"));

    prevCBot = y + gH;
    y = prevCBot + VGAP;
  }

  // ── Process steps ─────────────────────────────────────────────────────────
  for (const g of groups) {
    const mr = g.main[0];
    if (g.sn === 0) continue;

    // ── Merge: close branch region ──────────────────────────────────────────
    if (inBranch && !g.branched) {
      inBranch = false;
      const mY = Math.max(bLBot, bRBot) + VGAP / 2;
      bg.push(pline(LX, bLBot, LX, mY));
      bg.push(pline(LX, mY, CX, mY));
      bg.push(pline(RX, bRBot, RX, mY));
      bg.push(pline(RX, mY, CX, mY));
      prevCBot = mY;
      y = mY + VGAP;
    }

    // ── Branched step ────────────────────────────────────────────────────────
    if (g.branched) {
      const lKey = g.bkeys[0] ?? "a";
      const rKey = g.bkeys[1] ?? "b";
      const rA   = g.main.find((r) => r.branch === lKey) ?? g.main[0];
      const rB   = g.main.find((r) => r.branch === rKey) ?? g.main[1] ?? g.main[0];

      // Diamond
      const dcy = y + DR;
      bg.push(aline(CX, prevCBot, CX, dcy - DR - 1));
      fg.push(diamond(CX, dcy));

      const splitY  = dcy + DR + 8;
      const bNodeYTop = splitY + 12;

      bg.push(pline(CX, dcy + DR, CX, splitY));
      bg.push(pline(LX, splitY, RX, splitY));
      bg.push(aline(LX, splitY, LX, bNodeYTop));
      bg.push(aline(RX, splitY, RX, bNodeYTop));

      // Branch arm condition labels
      fg.push(smallLabel(LX - 2, splitY - 6, wrapText(signalOnly(rA.condition), 100, 6.0)[0] ?? "", "end", "#666"));
      fg.push(smallLabel(RX + 2, splitY - 6, wrapText(signalOnly(rB.condition), 100, 6.0)[0] ?? "", "start", "#666"));

      // Branch nodes
      const { svg: svgA, height: hA } = engineerNode(LX, bNodeYTop, BW, "branch",
        `${g.sn}${rA.branch ?? ""}: ${rA.condition}`, rA.action, rA.output);
      const { svg: svgB, height: hB } = engineerNode(RX, bNodeYTop, BW, "branch",
        `${g.sn}${rB.branch ?? ""}: ${rB.condition}`, rB.action, rB.output);

      fg.push(svgA);
      fg.push(svgB);

      bLBot = bNodeYTop + hA;
      bRBot = bNodeYTop + hB;
      inBranch = true;
      y = Math.max(bLBot, bRBot);

      // Fault exits — route from right branch right edge
      const bMidY = bNodeYTop + Math.max(hA, hB) / 2;
      renderFaultLabels(g.faults, RX + BW / 2, bMidY, fg, bg, faultYs);

    } else {
      // ── Linear step ──────────────────────────────────────────────────────
      const sk: SK = mr?.type === "monitor" ? "monitor" : "action";
      const cond = `${g.sn}: ${mr?.condition ?? ""}`;
      const ctx  = mr?.action ?? null;
      const out  = mr?.output ?? null;

      const { svg: nSvg, height: nH } = engineerNode(CX, y, CW, sk, cond, ctx, out);
      const nodeMidY = y + nH / 2;

      bg.push(aline(CX, prevCBot, CX, y));
      fg.push(nSvg);

      // Fault exits
      renderFaultLabels(g.faults, CX + CW / 2, nodeMidY, fg, bg, faultYs);

      prevCBot = y + nH;
      y += nH + VGAP;
    }
  }

  // Close any open branch
  if (inBranch) {
    const mY = Math.max(bLBot, bRBot) + VGAP / 2;
    bg.push(pline(LX, bLBot, LX, mY));
    bg.push(pline(LX, mY, CX, mY));
    bg.push(pline(RX, bRBot, RX, mY));
    bg.push(pline(RX, mY, CX, mY));
    prevCBot = mY;
    y = mY + VGAP;
  }

  // ── End IDLE pill ─────────────────────────────────────────────────────────
  bg.push(aline(CX, prevCBot, CX, y));
  fg.push(pill(CX, y, "Return to IDLE"));
  const endBottom = y + PILL_H;

  // ── Fault rail + FAULT node ───────────────────────────────────────────────
  if (hasFaults && faultYs.length > 0) {
    const minFY       = Math.min(...faultYs);
    const maxFY       = Math.max(...faultYs);
    const faultNodeCY = maxFY + VGAP * 1.5;

    bg.push(pline(FAULT_X, minFY, FAULT_X, faultNodeCY - FH / 2, true));
    bg.push(aline(FAULT_X, faultNodeCY - FH / 2, FAULT_X, faultNodeCY - FH / 2 + 1, true));
    fg.push(faultNode(FAULT_X, faultNodeCY));

    for (const fy of faultYs) {
      fg.push(`<circle cx="${FAULT_X}" cy="${fy}" r="3" fill="${FAULT_COL}"/>`);
    }
  }

  const svgH = Math.max(
    endBottom + 20,
    hasFaults && faultYs.length > 0 ? Math.max(...faultYs) + VGAP * 1.5 + FH + 20 : 0,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${svgH}"><rect width="${W}" height="${svgH}" fill="#0f0f0e"/>${[...bg, ...fg].join("")}</svg>`;
}
