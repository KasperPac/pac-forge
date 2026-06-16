/**
 * Section 1.7 — Network Device Configuration table renderer.
 *
 * Emits one row per device that carries a `network_config`. Returns null when
 * no control_modules have network config — caller should skip Section 1.7 entirely in
 * that case. Caption includes `pac-forge:network-v2` sentinel for ingest.
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
import type { Hierarchy, NetworkConfig } from "@/types/spec-contract-v2";

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

function plainCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "", size: 20, font: FONT })],
      }),
    ],
  });
}

function idCell(name: string, uuid: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: name, size: 20, font: FONT }),
          new TextRun({
            text: ` [${uuid}]`,
            size: 14,
            font: "Consolas",
            color: "808080",
          }),
        ],
      }),
    ],
  });
}

function renderTelegramOrAssembly(cfg: NetworkConfig): string {
  if (cfg.telegram) {
    const extra = cfg.telegram.custom_words
      ? ` (+${cfg.telegram.custom_words} custom words)`
      : "";
    return `Telegram ${cfg.telegram.standard}${extra}`;
  }
  if (cfg.assembly) {
    const a = cfg.assembly;
    return `In: ${a.input_instance} / Out: ${a.output_instance} / Cfg: ${a.config_instance}`;
  }
  return "";
}

function renderGsdmlRef(cfg: NetworkConfig): string {
  if (cfg.gsdml_ref) {
    return `${cfg.gsdml_ref.filename} (${cfg.gsdml_ref.sha256.slice(0, 8)})`;
  }
  if (cfg.eds_ref) {
    return `${cfg.eds_ref.filename} (${cfg.eds_ref.sha256.slice(0, 8)})`;
  }
  return "";
}

function renderFamily(cfg: NetworkConfig): string {
  if (cfg.vfd_family) return cfg.vfd_family;
  return "—";
}

/**
 * Build the Section 1.7 network device table, or return null if no control_modules
 * carry a `network_config`.
 */
export function buildNetworkDeviceTable(hierarchy: Hierarchy): Table | null {
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("Device", 18),
        headerCell("Family", 10),
        headerCell("Protocol", 10),
        headerCell("IP Address", 12),
        headerCell("Station Name", 14),
        headerCell("Telegram/Assembly", 14),
        headerCell("Update Cycle", 10),
        headerCell("GSDML Ref", 12),
      ],
    }),
  ];

  let networkedCount = 0;
  for (const sub of hierarchy.units) {
    if (sub.excluded) continue;
    for (const asm of sub.equipment_modules) {
      for (const dev of asm.control_modules) {
        if (!dev.network_config) continue;
        networkedCount++;
        const cfg = dev.network_config;
        rows.push(
          new TableRow({
            children: [
              idCell(dev.control_module_name, dev.control_module_id, 18),
              plainCell(renderFamily(cfg), 10),
              plainCell(cfg.protocol, 10),
              plainCell(cfg.ip_address, 12),
              plainCell(cfg.station_name, 14),
              plainCell(renderTelegramOrAssembly(cfg), 14),
              plainCell(`${cfg.update_cycle_ms} ms`, 10),
              plainCell(renderGsdmlRef(cfg), 12),
            ],
          }),
        );
      }
    }
  }

  if (networkedCount === 0) return null;

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
  });
}

/** Caption paragraph for the network table (includes the ingest sentinel). */
export function buildNetworkTableCaption(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: "Table 1.7 — Network Device Configuration (pac-forge:network-v2)",
        italics: true,
        size: 18,
        font: FONT,
        color: "606060",
      }),
    ],
    spacing: { before: 120, after: 80 },
  });
}
