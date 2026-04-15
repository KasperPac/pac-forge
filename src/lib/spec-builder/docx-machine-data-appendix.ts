/**
 * Appendix Z — Machine-Readable Data.
 *
 * Emits two tables used exclusively by the Pac-Forge ingest parser to
 * re-hydrate the spec deterministically:
 *
 * 1. Criteria table — one row per step's completion criterion with the
 *    full `CompletionCriterion` serialised as JSON in the final cell.
 * 2. Revision marker — a single-row identification table carrying the
 *    revision id, revision number, and status for the rendered snapshot.
 *
 * Caption sentinel: `pac-forge:appendix-v2`.
 *
 * NOTE: this appendix is informational for humans ("Do not edit") but
 * authoritative for the ingest path. Builder UI must regenerate the DOCX
 * after any edit — manual edits to these tables will be overwritten.
 */
import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  BorderStyle,
} from "docx";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const FONT = "Calibri";
const MONO = "Consolas";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const TABLE_BORDERS = {
  top: BORDER,
  bottom: BORDER,
  left: BORDER,
  right: BORDER,
  insideHorizontal: BORDER,
  insideVertical: BORDER,
};

export interface RevisionMeta {
  revision_id: string;
  revision_number: number | string;
  status: string;
}

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

function monoCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 16, font: MONO })],
      }),
    ],
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
 * Build the appendix content (header + caption + both tables, in order).
 * Returns an array of Paragraph|Table so the caller can push it directly
 * into the document children list at the very end.
 */
export function buildMachineDataAppendix(
  contract: SpecContractV2,
  revisionMeta?: RevisionMeta,
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];

  out.push(
    new Paragraph({
      text: "Appendix Z — Machine-Readable Data (pac-forge:appendix-v2)",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 480, after: 120 },
      pageBreakBefore: true,
    }),
  );
  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Do not edit — this appendix is used by the Pac-Forge builder to re-ingest this document.",
          bold: true,
          size: 20,
          font: FONT,
          color: "A04000",
        }),
      ],
      spacing: { after: 200 },
    }),
  );

  // ---- Criteria table ----
  out.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Z.1 Completion Criteria", bold: true, size: 22, font: FONT }),
      ],
      spacing: { before: 160, after: 80 },
    }),
  );

  const criteriaRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("Assembly ID", 20),
        headerCell("State ID", 12),
        headerCell("Step", 8),
        headerCell("Criterion JSON", 60),
      ],
    }),
  ];

  for (const [assemblyId, assembly] of Object.entries(contract.assemblies)) {
    for (const [stateId, seq] of Object.entries(assembly.sequential_states)) {
      for (const step of seq.steps) {
        for (const criterion of step.completion_criteria) {
          criteriaRows.push(
            new TableRow({
              children: [
                monoCell(assemblyId, 20),
                monoCell(stateId, 12),
                plainCell(String(step.step), 8),
                monoCell(JSON.stringify(criterion), 60),
              ],
            }),
          );
        }
      }
    }
  }

  out.push(
    new Table({
      rows: criteriaRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
    }),
  );

  // ---- Revision marker table ----
  out.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Z.2 Revision Marker", bold: true, size: 22, font: FONT }),
      ],
      spacing: { before: 240, after: 80 },
    }),
  );

  const rev: RevisionMeta = revisionMeta ?? {
    revision_id: contract.project.id,
    revision_number: "draft",
    status: "draft",
  };

  out.push(
    new Table({
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell("Revision ID", 50),
            headerCell("Revision Number", 25),
            headerCell("Status", 25),
          ],
        }),
        new TableRow({
          children: [
            monoCell(rev.revision_id, 50),
            plainCell(String(rev.revision_number), 25),
            plainCell(rev.status, 25),
          ],
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
    }),
  );

  return out;
}
