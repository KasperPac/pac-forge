/**
 * Section 1.6 — Canonical Machine Hierarchy table renderer.
 *
 * Emits a single structured table (one row per device) with Unit,
 * Equipment Module, Device, Device Class, Safety, and IO Tags columns. Unit and
 * Equipment Module cells repeat verbatim (no cell merging — Word cell merges break
 * downstream ingest parsers).
 *
 * Every identifier cell carries its UUID in a trailing `[<uuid>]` bracket so
 * a deterministic parser can extract hierarchy ids without AI. The literal
 * `pac-forge:hierarchy-v2` in the caption is the ingest sentinel.
 */
import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  BorderStyle,
} from "docx";
import type { Hierarchy } from "@/types/spec-contract-v2";

const FONT = "Calibri";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const TABLE_BORDERS = {
  top: BORDER,
  bottom: BORDER,
  left: BORDER,
  right: BORDER,
  insideHorizontal: BORDER,
  insideVertical: BORDER,
};

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 20, font: FONT })],
      }),
    ],
  });
}

function bodyCell(mainText: string, idTag: string | null, widthPct: number): TableCell {
  const runs: TextRun[] = [new TextRun({ text: mainText, size: 20, font: FONT })];
  if (idTag) {
    runs.push(
      new TextRun({
        text: ` [${idTag}]`,
        size: 14,
        font: "Consolas",
        color: "808080",
      }),
    );
  }
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: runs })],
  });
}

function plainCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 20, font: FONT })],
      }),
    ],
  });
}

/**
 * Build the Section 1.6 hierarchy table. One row per device; unit and
 * equipment_module names/UUIDs repeat verbatim per row (never merged). No equipment_modules
 * or no control_modules for a unit → the unit contributes no rows.
 */
export function buildHierarchyTable(hierarchy: Hierarchy): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      headerCell("Unit", 18),
      headerCell("Equipment Module", 18),
      headerCell("Device", 18),
      headerCell("Device Class", 14),
      headerCell("Safety", 8),
      headerCell("IO Tags", 24),
    ],
  });

  const rows: TableRow[] = [header];

  for (const sub of hierarchy.units) {
    if (sub.excluded) continue;
    for (const asm of sub.equipment_modules) {
      for (const dev of asm.control_modules) {
        const ioList = dev.io_signals
          .map((s) => `${s.tag}:${s.signal_type}`)
          .join(", ");
        rows.push(
          new TableRow({
            children: [
              bodyCell(sub.unit_name, sub.unit_id, 18),
              bodyCell(asm.equipment_module_name, asm.equipment_module_id, 18),
              bodyCell(dev.control_module_name, dev.control_module_id, 18),
              plainCell(dev.control_module_class, 14),
              plainCell(dev.is_safety ? "Y" : "N", 8),
              plainCell(ioList, 24),
            ],
          }),
        );
      }
    }
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
  });
}

/** Caption paragraph for the hierarchy table (includes the ingest sentinel). */
export function buildHierarchyTableCaption(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: "Table 1.6 — Canonical Machine Hierarchy (pac-forge:hierarchy-v2)",
        italics: true,
        size: 18,
        font: FONT,
        color: "606060",
      }),
    ],
    spacing: { before: 120, after: 80 },
  });
}
