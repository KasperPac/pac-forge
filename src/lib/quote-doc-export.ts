import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { QuoteSnapshotV1 } from "@/types";

// ─── utilities ───────────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function md(text: string | null | undefined): string {
  if (!text) return "";
  return esc(text)
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function plain(s: string | null | undefined): string {
  return (s ?? "").replace(/\n/g, " ").trim();
}

interface ImageAsset {
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

async function loadImage(url: string, maxWidth: number): Promise<ImageAsset | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(new Blob([buffer]));
    });
    const w = maxWidth;
    const h = dims ? Math.round(maxWidth * (dims.h / dims.w)) : Math.round(maxWidth * 0.3);
    return { buffer, width: w, height: h };
  } catch {
    return null;
  }
}

async function bufferToBase64(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer]);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result); // already data: URI
    };
    reader.readAsDataURL(blob);
  });
}

// ─── section registry (shared between HTML + DOCX) ───────────────────────────

interface TocEntry { id: string; num: number; title: string }

function buildToc(snapshot: QuoteSnapshotV1): TocEntry[] {
  const entries: TocEntry[] = [];
  let n = 1;
  entries.push({ id: "summary", num: n++, title: "Summary" });
  if (snapshot.scope.length || snapshot.assumptions.length)
    entries.push({ id: "scope", num: n++, title: "Scope of Work" });
  if (snapshot.inclusions.length)
    entries.push({ id: "inclusions", num: n++, title: "Inclusions" });
  if (snapshot.exclusions.length)
    entries.push({ id: "exclusions", num: n++, title: "Exclusions" });
  entries.push({ id: "pricing", num: n++, title: "Pricing" });
  if (snapshot.commercial_terms)
    entries.push({ id: "terms", num: n++, title: "Commercial Terms" });
  if (snapshot.tnc)
    entries.push({ id: "tnc", num: n++, title: "Terms & Conditions" });
  return entries;
}

// ─── HTML export ─────────────────────────────────────────────────────────────

const HTML_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 11px; color: #0F0E0C; line-height: 1.55; background: #fff; }
a { color: #3050A0; text-decoration: none; }

@page { size: A4; margin: 25mm; }
.doc-page {
  max-width: 210mm; margin: 0 auto; padding: 25mm;
  min-height: 247mm; position: relative;
  page-break-before: always;
}
.doc-page:first-child { page-break-before: auto; }
@media print {
  .doc-page { padding: 0; page-break-before: always; }
  .doc-page:first-child { page-break-before: auto; }
  .no-print { display: none; }
}

/* Cover */
.cover { display: flex; flex-direction: column; justify-content: space-between; height: 100%; min-height: 220mm; }
.cover-logo { max-width: 240px; height: auto; display: block; }
.cover-rule { height: 2px; background: #3050A0; margin: 16px 0 14px; }
.cover-kicker { font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: #3050A0; font-weight: 700; margin-bottom: 6px; }
.cover-title { font-size: 38px; font-weight: 800; color: #0F0E0C; line-height: 1.1; letter-spacing: -.025em; }
.cover-subtitle { font-size: 13px; color: #45443F; margin-top: 8px; }
.cover-watermark { position: absolute; right: 0; bottom: 40mm; width: 260px; opacity: .05; pointer-events: none; }
.cover-divider { height: 1px; background: #DEDED9; margin-bottom: 10px; }
.cover-grid { display: grid; grid-template-columns: 120px 1fr; gap: 5px 0; }
.cover-key { font-size: 10px; color: #5F5E5A; text-transform: uppercase; letter-spacing: .08em; padding-top: 1px; }
.cover-val { font-size: 11px; color: #0F0E0C; font-weight: 600; }

/* TOC */
.toc-list { margin-top: 24px; }
.toc-entry { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #F1F1EF; font-size: 12px; }
.toc-num { color: #3050A0; font-weight: 700; min-width: 28px; }
.toc-title { flex: 1; }

/* Section pages */
.section-page h1 {
  font-size: 24px; font-weight: 700; color: #122044;
  border-bottom: 2px solid #3050A0; padding-bottom: 8px; margin-bottom: 20px;
}
.section-page h2 { font-size: 14px; font-weight: 600; color: #243F80; margin: 16px 0 8px; }

/* Scope */
.scope-item { display: flex; gap: 10px; margin: 10px 0; align-items: flex-start; }
.scope-dot { color: #3050A0; font-size: 7px; margin-top: 4px; flex-shrink: 0; }
.scope-title { font-weight: 600; }
.scope-body { margin-top: 3px; color: #2F2E2A; font-size: 11px; }
.scope-body p { margin-bottom: 3px; }

/* Lists */
ul.dl { list-style: none; padding: 0; margin: 0; }
ul.dl li { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid #F1F1EF; font-size: 11px; align-items: flex-start; }
ul.dl li::before { content: "–"; color: #3050A0; font-weight: 700; flex-shrink: 0; }
ul.dl li strong { color: #0F0E0C; }
ul.dl .sub { color: #45443F; font-size: 10px; margin-top: 2px; }
ul.dl .sub p { margin-bottom: 2px; }

/* Pricing */
table.li { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
table.li th { text-align: left; font-size: 10px; font-weight: 600; color: #45443F; text-transform: uppercase; letter-spacing: .04em; padding: 8px 10px; border-bottom: 2px solid #3050A0; }
table.li td { padding: 7px 10px; border-bottom: 1px solid #EFEFEC; vertical-align: top; }
table.li .r { text-align: right; font-variant-numeric: tabular-nums; }
table.li tr:nth-child(even) td { background: #FAFAF9; }
.grand { display: flex; justify-content: flex-end; align-items: baseline; gap: 24px; padding: 10px 10px; border-top: 2px solid #3050A0; margin-top: 0; }
.grand .lbl { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #45443F; }
.grand .amt { font-size: 20px; font-weight: 800; color: #122044; }

/* Commercial */
.ct-grid { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; margin-top: 8px; }
.ct-grid .k { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #5F5E5A; padding-top: 2px; }
.ct-grid .v { font-size: 11px; }
.ct-grid .v p { margin-bottom: 4px; }

/* T&C */
.clause { margin: 14px 0; page-break-inside: avoid; }
.clause .hd { font-weight: 700; font-size: 12px; color: #122044; margin-bottom: 4px; }
.clause .hd .cn { color: #3050A0; margin-right: 6px; }
.clause .bd { font-size: 11px; color: #2F2E2A; }
.clause .bd p { margin-bottom: 4px; }
.tnc-free { font-size: 11px; color: #2F2E2A; }
.tnc-free p { margin-bottom: 6px; }

/* Signature */
.sig { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 56px; }
.sig-block { border-top: 1px solid #2F2E2A; padding-top: 6px; }
.sig-label { font-size: 10px; color: #5F5E5A; margin-top: 40px; }

/* Running footer */
.run-footer { position: fixed; bottom: 12mm; left: 25mm; right: 25mm; display: flex; justify-content: space-between; font-size: 9px; color: #8C8B86; border-top: 1px solid #EFEFEC; padding-top: 4px; }
`;

export async function generateQuoteHtml(snapshot: QuoteSnapshotV1): Promise<string> {
  const clientName = snapshot.project.client?.name ?? snapshot.project.customer?.name ?? "";
  const { quote_number, rev_number, issued_at, contact_name, summary, project, scope,
    inclusions, exclusions, assumptions, line_items, totals, tnc } = snapshot;
  const ct = snapshot.commercial_terms;
  const pp = snapshot.pricing_presentation;
  const isVar = snapshot.kind === "variation";

  // Load logos for inline embedding
  const logoAsset = await loadImage("/PacTechnologies.jpg", 240);
  const markAsset = await loadImage("/PacTechnologiesEdit_Blue_NoText._Transparent.png", 280);
  const logoSrc = logoAsset ? await bufferToBase64(logoAsset.buffer) : null;
  const markSrc = markAsset ? await bufferToBase64(markAsset.buffer) : null;

  const toc = buildToc(snapshot);
  const sec = (id: string) => toc.find((t) => t.id === id);

  // ── Cover ──
  const coverHtml = `<div class="doc-page">
  <div class="cover">
    <div>
      ${logoSrc ? `<img class="cover-logo" src="${logoSrc}" alt="Pac Technologies">` : `<span style="font-size:22px;font-weight:800;color:#3050A0;">PAC TECHNOLOGIES</span>`}
      <div class="cover-rule"></div>
      <div class="cover-kicker">${isVar ? `Variation V${rev_number}` : "Quotation"}</div>
      <h1 class="cover-title">${esc(project.project_name || clientName)}</h1>
      ${isVar ? `<p class="cover-subtitle">Variation V${rev_number} to ${esc(project.project_number)}</p>` : ""}
    </div>
    ${markSrc ? `<img class="cover-watermark" src="${markSrc}" alt="">` : ""}
    <div>
      <div class="cover-divider"></div>
      <div class="cover-grid">
        <div class="cover-key">Client</div><div class="cover-val">${esc(clientName)}</div>
        <div class="cover-key">Project No.</div><div class="cover-val">${esc(project.project_number)}</div>
        <div class="cover-key">Quote No.</div><div class="cover-val">${esc(quote_number)} · Rev ${rev_number}</div>
        ${contact_name ? `<div class="cover-key">Attention</div><div class="cover-val">${esc(contact_name)}</div>` : ""}
        <div class="cover-key">Date</div><div class="cover-val">${fmtDate(issued_at)}</div>
      </div>
    </div>
  </div>
</div>`;

  // ── TOC ──
  const tocHtml = `<div class="doc-page">
  <h1 style="font-size:24px;font-weight:700;color:#122044;border-bottom:2px solid #3050A0;padding-bottom:8px;margin-bottom:0;">Table of Contents</h1>
  <div class="toc-list">
    ${toc.map((t) => `<div class="toc-entry"><span class="toc-num">${t.num}.</span><a class="toc-title" href="#${t.id}">${esc(t.title)}</a></div>`).join("\n    ")}
  </div>
</div>`;

  // ── Summary ──
  const summaryHtml = `<div class="doc-page section-page" id="summary">
  <h1>${sec("summary")!.num}. Summary</h1>
  ${contact_name ? `<p style="margin-bottom:10px;">Dear ${esc(contact_name)},</p>` : ""}
  <p style="margin-bottom:10px;">Pac Technologies is pleased to present the following ${isVar ? `variation V${rev_number}` : `quote ${esc(quote_number)}`}.</p>
  ${summary ? md(summary) : ""}
</div>`;

  // ── Scope ──
  const scopeHtml =
    scope.length || assumptions.length
      ? `<div class="doc-page section-page" id="scope">
  <h1>${sec("scope")!.num}. Scope of Work</h1>
  ${scope.map((s) => `<div class="scope-item"><span class="scope-dot">●</span><div><div class="scope-title">${esc(s.title)}</div>${s.body ? `<div class="scope-body">${md(s.body)}</div>` : ""}</div></div>`).join("\n  ")}
  ${assumptions.length ? `<h2>Assumptions</h2><ul class="dl">${assumptions.map((a) => `<li><div>${a.title ? `<strong>${esc(a.title)}</strong>` : ""}${a.value ? ` — ${esc(a.value)}` : ""}${a.notes ? `<div class="sub">${md(a.notes)}</div>` : ""}</div></li>`).join("")}</ul>` : ""}
</div>`
      : "";

  // ── Inclusions ──
  const incHtml = inclusions.length
    ? `<div class="doc-page section-page" id="inclusions">
  <h1>${sec("inclusions")!.num}. Inclusions</h1>
  <ul class="dl">${inclusions.map((i) => `<li><div><strong>${esc(i.title)}</strong>${i.body ? `<div class="sub">${md(i.body)}</div>` : ""}</div></li>`).join("")}</ul>
</div>`
    : "";

  // ── Exclusions ──
  const excHtml = exclusions.length
    ? `<div class="doc-page section-page" id="exclusions">
  <h1>${sec("exclusions")!.num}. Exclusions</h1>
  <ul class="dl">${exclusions.map((e) => `<li><div><strong>${esc(e.title)}</strong>${e.body ? `<div class="sub">${md(e.body)}</div>` : ""}</div></li>`).join("")}</ul>
</div>`
    : "";

  // ── Pricing ──
  let pricingTable = "";
  if (pp.show_pricing_breakdown_detail === "subtotal_only") {
    const rows = totals.by_category_customer_visible;
    if (rows.length) {
      pricingTable = `<table class="li"><thead><tr><th>Category</th><th class="r">Subtotal</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.category)}</td><td class="r">${money(r.subtotal)}</td></tr>`).join("")}</tbody></table>`;
    }
  } else {
    const visible = line_items.filter((li) => li.show_in_customer_doc);
    const full = pp.show_pricing_breakdown_detail === "full";
    if (visible.length) {
      pricingTable = `<table class="li"><thead><tr><th>Category</th><th>Description</th><th class="r">Qty</th>${full ? `<th class="r">Unit Price</th><th class="r">Hours</th><th class="r">Rate</th>` : ""}<th class="r">Subtotal</th></tr></thead>
    <tbody>${visible.map((li) => `<tr><td>${esc(li.category)}</td><td>${esc(li.customer_doc_label ?? li.description)}</td><td class="r">${li.qty != null ? li.qty : ""}</td>${full ? `<td class="r">${money(li.unit_price)}</td><td class="r">${li.hours ?? ""}</td><td class="r">${money(li.hour_rate)}</td>` : ""}<td class="r">${money(li.subtotal)}</td></tr>`).join("")}</tbody></table>`;
    }
  }

  const pricingHtml = `<div class="doc-page section-page" id="pricing">
  <h1>${sec("pricing")!.num}. Pricing</h1>
  ${pricingTable}
  <div class="grand">
    <span class="lbl">Grand Total (excl. GST)</span>
    <span class="amt">${money(totals.grand_total)}</span>
  </div>
  <div class="sig">
    <div class="sig-block"><div class="sig-label">Authorised by — Pac Technologies</div></div>
    <div class="sig-block"><div class="sig-label">Accepted by — ${esc(clientName)}</div></div>
  </div>
</div>`;

  // ── Commercial Terms ──
  const termsHtml = ct
    ? `<div class="doc-page section-page" id="terms">
  <h1>${sec("terms")!.num}. Commercial Terms</h1>
  <div class="ct-grid">
    ${ct.payment_schedule ? `<div class="k">Payment Schedule</div><div class="v">${md(ct.payment_schedule)}</div>` : ""}
    ${ct.validity_period ? `<div class="k">Validity Period</div><div class="v">${esc(ct.validity_period)}</div>` : ""}
    ${ct.gst_treatment ? `<div class="k">GST Treatment</div><div class="v">${esc(ct.gst_treatment)}</div>` : ""}
    ${ct.currency ? `<div class="k">Currency</div><div class="v">${esc(ct.currency)}</div>` : ""}
    ${ct.notes ? `<div class="k">Notes</div><div class="v">${md(ct.notes)}</div>` : ""}
  </div>
</div>`
    : "";

  // ── T&C ──
  let tncHtml = "";
  if (tnc) {
    const num = sec("tnc")!.num;
    const body =
      tnc.kind === "structured"
        ? tnc.clauses
            .map(
              (c) =>
                `<div class="clause"><div class="hd"><span class="cn">${esc(c.clause_number)}</span>${esc(c.title)}</div><div class="bd">${md(c.body_markdown)}</div></div>`,
            )
            .join("\n")
        : `<div class="tnc-free">${md(tnc.body_markdown)}</div>`;
    tncHtml = `<div class="doc-page section-page" id="tnc">
  <h1>${num}. Terms &amp; Conditions</h1>
  ${body}
</div>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(quote_number)} Rev ${rev_number} — ${esc(clientName)}</title>
  <style>${HTML_CSS}</style>
</head>
<body>
${coverHtml}
${tocHtml}
${summaryHtml}
${scopeHtml}
${incHtml}
${excHtml}
${pricingHtml}
${termsHtml}
${tncHtml}
<div class="run-footer no-print">
  <span>Pac Technologies Pty Ltd &nbsp;·&nbsp; 5/53 Riverview Place, Morningside QLD 4170 &nbsp;·&nbsp; www.pac-technologies.com.au</span>
  <span>${esc(quote_number)} Rev ${rev_number} &nbsp;·&nbsp; ${esc(clientName)}</span>
</div>
</body>
</html>`;
}

// ─── DOCX export ─────────────────────────────────────────────────────────────

type DocChild = Paragraph | Table;

function run(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    color?: string;
    font?: string;
    italic?: boolean;
  } = {},
) {
  return new TextRun({
    text,
    bold: opts.bold,
    size: opts.size ?? 22,
    color: opts.color,
    font: opts.font ?? "Calibri",
    italics: opts.italic,
  });
}

function para(
  children: TextRun[],
  opts: {
    pageBreakBefore?: boolean;
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spaceBefore?: number;
    spaceAfter?: number;
    indent?: number;
    borderBottom?: boolean;
    borderTop?: boolean;
    bullet?: boolean;
  } = {},
): Paragraph {
  return new Paragraph({
    children,
    heading: opts.heading,
    pageBreakBefore: opts.pageBreakBefore,
    alignment: opts.alignment,
    bullet: opts.bullet ? { level: 0 } : undefined,
    indent: opts.indent != null ? { left: opts.indent } : undefined,
    spacing: {
      before: opts.spaceBefore ?? 0,
      after: opts.spaceAfter ?? 120,
    },
    border: {
      ...(opts.borderBottom
        ? { bottom: { style: "single", size: 8, color: "3050A0", space: 4 } }
        : {}),
      ...(opts.borderTop
        ? { top: { style: "single", size: 8, color: "3050A0", space: 4 } }
        : {}),
    },
  });
}

function sectionHeading(title: string, pageBreak = true): Paragraph {
  return para([run(title, { bold: true, size: 44, color: "122044" })], {
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: pageBreak,
    borderBottom: true,
    spaceAfter: 240,
  });
}

function noLine(k: string, v: string): TableRow {
  const noBorder = { style: "none" as const, size: 0, color: "FFFFFF" };
  const borders = {
    top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
    insideH: noBorder, insideV: noBorder,
  };
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: 28, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [run(k, { size: 20, color: "5F5E5A", bold: true })], spacing: { after: 60 } })],
      }),
      new TableCell({
        borders,
        width: { size: 72, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [run(v, { size: 20 })], spacing: { after: 60 } })],
      }),
    ],
  });
}

function noLineTable(rows: [string, string][]): Table {
  const noBorder = { style: "none" as const, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
      insideH: noBorder, insideV: noBorder,
    },
    rows: rows.map(([k, v]) => noLine(k, v)),
  });
}

export async function generateQuoteDocx(snapshot: QuoteSnapshotV1): Promise<Blob> {
  const clientName = snapshot.project.client?.name ?? snapshot.project.customer?.name ?? "";
  const { quote_number, rev_number, issued_at, contact_name, summary, project, scope,
    inclusions, exclusions, assumptions, line_items, totals, tnc } = snapshot;
  const ct = snapshot.commercial_terms;
  const pp = snapshot.pricing_presentation;
  const isVar = snapshot.kind === "variation";

  const logoAsset = await loadImage("/PacTechnologies.jpg", 240);
  const toc = buildToc(snapshot);

  const ch: DocChild[] = [];

  // ── COVER PAGE ──────────────────────────────────────────────────────────────

  if (logoAsset) {
    ch.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: logoAsset.buffer,
            transformation: { width: logoAsset.width, height: logoAsset.height },
            type: "jpg",
          }),
        ],
        spacing: { after: 320 },
      }),
    );
  } else {
    ch.push(para([run("PAC TECHNOLOGIES", { bold: true, size: 56, color: "3050A0" })], { spaceAfter: 320 }));
  }

  // Rule
  ch.push(para([], { borderBottom: true, spaceAfter: 200, spaceBefore: 0 }));

  // Kicker + title
  ch.push(para([run(isVar ? `VARIATION V${rev_number}` : "QUOTATION", { bold: true, size: 18, color: "3050A0" })], { spaceAfter: 80 }));
  ch.push(para([run(project.project_name || clientName, { bold: true, size: 72, color: "0F0E0C" })], { spaceAfter: 80 }));
  if (isVar) {
    ch.push(para([run(`Variation V${rev_number} to ${project.project_number ?? ""}`, { size: 24, color: "45443F" })], { spaceAfter: 0 }));
  }

  // Push metadata to lower half
  ch.push(para([], { spaceBefore: 3600, spaceAfter: 0 }));
  ch.push(para([], { borderBottom: false, spaceAfter: 200 }));

  // Cover metadata table
  ch.push(
    noLineTable([
      ["Client", clientName],
      ["Project No.", project.project_number ?? ""],
      ["Quote No.", `${quote_number} · Rev ${rev_number}`],
      ...(contact_name ? [["Attention", contact_name] as [string, string]] : []),
      ["Date", fmtDate(issued_at)],
    ]),
  );

  // ── TABLE OF CONTENTS ────────────────────────────────────────────────────────

  ch.push(new Paragraph({ children: [new PageBreak()] }));

  ch.push(
    para([run("Table of Contents", { bold: true, size: 44, color: "122044" })], {
      borderBottom: true,
      spaceAfter: 240,
    }),
  );

  for (const t of toc) {
    ch.push(
      para(
        [
          run(`${t.num}.  `, { bold: true, size: 26, color: "3050A0" }),
          run(t.title, { size: 26 }),
        ],
        { spaceAfter: 80 },
      ),
    );
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────

  ch.push(sectionHeading("Summary"));

  if (contact_name) {
    ch.push(para([run(`Dear ${contact_name},`, { size: 22 })], { spaceAfter: 100 }));
  }
  ch.push(
    para(
      [run(`Pac Technologies is pleased to present the following ${isVar ? `variation V${rev_number}` : `quote ${quote_number}`}.`, { size: 22 })],
      { spaceAfter: 100 },
    ),
  );
  if (summary) {
    for (const block of summary.split(/\n\s*\n/)) {
      ch.push(para([run(plain(block), { size: 22 })], { spaceAfter: 100 }));
    }
  }

  // ── SCOPE ───────────────────────────────────────────────────────────────────

  if (scope.length || assumptions.length) {
    ch.push(sectionHeading("Scope of Work"));

    for (const s of scope) {
      ch.push(para([run(s.title, { bold: true, size: 22 })], { bullet: true, spaceAfter: 60 }));
      if (s.body) {
        for (const block of s.body.split(/\n\s*\n/)) {
          ch.push(para([run(plain(block), { size: 20, color: "2F2E2A" })], { indent: 360, spaceAfter: 80 }));
        }
      }
    }

    if (assumptions.length) {
      ch.push(
        para([run("Assumptions", { bold: true, size: 28, color: "243F80" })], {
          heading: HeadingLevel.HEADING_2,
          spaceBefore: 240,
          spaceAfter: 120,
        }),
      );
      for (const a of assumptions) {
        const text = [a.title, a.value && `— ${a.value}`].filter(Boolean).join(" ");
        ch.push(para([run(text, { size: 22 })], { bullet: true, spaceAfter: 80 }));
      }
    }
  }

  // ── INCLUSIONS ──────────────────────────────────────────────────────────────

  if (inclusions.length) {
    ch.push(sectionHeading("Inclusions"));
    for (const inc of inclusions) {
      ch.push(para([run(inc.title, { bold: true, size: 22 })], { bullet: true, spaceAfter: 60 }));
      if (inc.body) {
        ch.push(para([run(plain(inc.body), { size: 20, color: "2F2E2A" })], { indent: 360, spaceAfter: 80 }));
      }
    }
  }

  // ── EXCLUSIONS ──────────────────────────────────────────────────────────────

  if (exclusions.length) {
    ch.push(sectionHeading("Exclusions"));
    for (const exc of exclusions) {
      ch.push(para([run(exc.title, { bold: true, size: 22 })], { bullet: true, spaceAfter: 60 }));
      if (exc.body) {
        ch.push(para([run(plain(exc.body), { size: 20, color: "2F2E2A" })], { indent: 360, spaceAfter: 80 }));
      }
    }
  }

  // ── PRICING ─────────────────────────────────────────────────────────────────

  ch.push(sectionHeading("Pricing"));

  const hdrBorder = { style: "single" as const, size: 8, color: "3050A0" };
  const rowBorder = { style: "single" as const, size: 4, color: "EFEFEC" };
  const noBorder = { style: "none" as const, size: 0, color: "FFFFFF" };

  function pricingCell(text: string, header = false, right = false): TableCell {
    return new TableCell({
      borders: {
        top: header ? noBorder : rowBorder,
        bottom: header ? hdrBorder : rowBorder,
        left: noBorder,
        right: noBorder,
      },
      children: [
        new Paragraph({
          children: [run(text, { bold: header, size: header ? 18 : 20, color: header ? "45443F" : undefined })],
          alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        }),
      ],
    });
  }

  if (pp.show_pricing_breakdown_detail === "subtotal_only") {
    const rows = totals.by_category_customer_visible;
    if (rows.length) {
      ch.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [pricingCell("CATEGORY", true), pricingCell("SUBTOTAL", true, true)], tableHeader: true }),
            ...rows.map((r) => new TableRow({ children: [pricingCell(r.category), pricingCell(money(r.subtotal), false, true)] })),
          ],
        }) as unknown as DocChild,
      );
    }
  } else {
    const visible = line_items.filter((li) => li.show_in_customer_doc);
    if (visible.length) {
      ch.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [pricingCell("CATEGORY", true), pricingCell("DESCRIPTION", true), pricingCell("SUBTOTAL", true, true)],
              tableHeader: true,
            }),
            ...visible.map((li) =>
              new TableRow({
                children: [
                  pricingCell(li.category),
                  pricingCell(li.customer_doc_label ?? li.description),
                  pricingCell(money(li.subtotal), false, true),
                ],
              }),
            ),
          ],
        }) as unknown as DocChild,
      );
    }
  }

  // Grand total
  ch.push(
    para(
      [
        run("Grand Total (excl. GST)", { size: 20, color: "45443F" }),
        run("          "),
        run(money(totals.grand_total), { bold: true, size: 32, color: "122044" }),
      ],
      { alignment: AlignmentType.RIGHT, borderTop: true, spaceBefore: 0, spaceAfter: 400 },
    ),
  );

  // Signature block on pricing page
  ch.push(
    para([run("Authorised by — Pac Technologies", { size: 18, color: "5F5E5A" })], {
      spaceBefore: 1440,
      borderBottom: false,
    }),
  );

  // ── COMMERCIAL TERMS ────────────────────────────────────────────────────────

  if (ct) {
    ch.push(sectionHeading("Commercial Terms"));

    const entries: [string, string][] = [
      ct.payment_schedule ? ["Payment Schedule", ct.payment_schedule] : null,
      ct.validity_period ? ["Validity Period", ct.validity_period] : null,
      ct.gst_treatment ? ["GST Treatment", ct.gst_treatment] : null,
      ct.currency ? ["Currency", ct.currency] : null,
      ct.notes ? ["Notes", ct.notes] : null,
    ].filter((e): e is [string, string] => e !== null);

    ch.push(
      noLineTable(
        entries.map(([k, v]) => [k, plain(v)] as [string, string]),
      ),
    );
  }

  // ── T&C ────────────────────────────────────────────────────────────────────

  if (tnc) {
    ch.push(sectionHeading("Terms & Conditions"));

    if (tnc.kind === "structured") {
      for (const c of tnc.clauses) {
        ch.push(
          para(
            [
              run(`${c.clause_number}  `, { bold: true, color: "3050A0", size: 22 }),
              run(c.title, { bold: true, size: 22 }),
            ],
            { spaceBefore: 160, spaceAfter: 80 },
          ),
        );
        ch.push(para([run(plain(c.body_markdown), { size: 20, color: "2F2E2A" })], { spaceAfter: 120 }));
      }
    } else {
      for (const block of (tnc.body_markdown ?? "").split(/\n\s*\n/)) {
        ch.push(para([run(plain(block), { size: 20 })], { spaceAfter: 120 }));
      }
    }
  }

  // ── Document ────────────────────────────────────────────────────────────────

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
        heading1: {
          run: { font: "Calibri", bold: true, size: 44, color: "122044" },
          paragraph: { spacing: { before: 0, after: 240 } },
        },
        heading2: {
          run: { font: "Calibri", bold: true, size: 28, color: "243F80" },
          paragraph: { spacing: { before: 200, after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: {
          titlePage: true,
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
        },
        headers: {
          first: new Header({ children: [] }),
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  run(`${quote_number} · Rev ${rev_number}`, { size: 18, color: "8C8B86" }),
                  run("   ·   ", { size: 18, color: "8C8B86" }),
                  run(clientName, { size: 18, color: "8C8B86" }),
                ],
                alignment: AlignmentType.RIGHT,
                border: { bottom: { style: "single", size: 4, color: "EFEFEC", space: 4 } },
              }),
            ],
          }),
        },
        footers: {
          first: new Footer({ children: [] }),
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  run(
                    "Pac Technologies Pty Ltd  ·  5/53 Riverview Place, Morningside QLD 4170  ·  www.pac-technologies.com.au",
                    { size: 16, color: "8C8B86" },
                  ),
                ],
                alignment: AlignmentType.CENTER,
                border: { top: { style: "single", size: 4, color: "EFEFEC", space: 4 } },
              }),
            ],
          }),
        },
        children: ch,
      },
    ],
  });

  return Packer.toBlob(doc);
}
