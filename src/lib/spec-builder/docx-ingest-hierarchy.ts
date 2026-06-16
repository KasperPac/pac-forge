/**
 * Deterministic parser: hierarchy table → partial SpecContractV2 hierarchy.
 *
 * Input: the list of parsed tables from `word/document.xml`. Each table is a
 * `{ caption: string, rows: string[][] }` — cell text only, headers separated
 * from body rows by the extractor.
 *
 * The hierarchy table is identified by a caption containing
 * `pac-forge:hierarchy-v2`. Column order is strict:
 *   [Subsystem, Assembly, Device, Device Class, Safety, IO Tags]
 * Trailing `[UUID]` markers on each cell carry the entity id; absence is
 * treated as a fatal parse error.
 */
import type {
  EquipmentModuleV2,
  ControlModuleV2,
  Hierarchy,
  IoSignalV2,
  UnitV2,
} from "@/types/spec-contract-v2";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";
import type { ParsedDocxTable } from "@/lib/spec-builder/docx-ingest";
// (type-only — avoids runtime cycle with docx-ingest.ts dispatcher)

export class DocxIngestError extends Error {
  readonly diagnostics: string[];
  constructor(message: string, diagnostics: string[] = []) {
    super(message);
    this.name = "DocxIngestError";
    this.diagnostics = diagnostics;
  }
}

const REQUIRED_HEADERS = [
  "Subsystem",
  "Assembly",
  "Device",
  "Device Class",
  "Safety",
  "IO Tags",
] as const;

const UUID_TAIL_RE = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*$/i;

interface CellValue {
  text: string;
  uuid: string;
}

function extractUuid(cell: string, context: string): CellValue {
  const trimmed = cell.trim();
  const m = UUID_TAIL_RE.exec(trimmed);
  if (!m) {
    throw new DocxIngestError(
      `Hierarchy cell missing UUID suffix: ${context}`,
      [`Cell value: "${trimmed}"`],
    );
  }
  const text = trimmed.slice(0, m.index).trim();
  return { text, uuid: m[1] };
}

function parseIoCell(cell: string): IoSignalV2[] {
  const raw = cell.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token, idx) => {
      const parts = token.split(":");
      if (parts.length < 2) {
        throw new DocxIngestError(
          `Malformed IO tag at position ${idx + 1}: "${token}" (expected TAG:TYPE)`,
        );
      }
      const tag = parts[0].trim();
      const typeRaw = parts.slice(1).join(":").trim();
      return {
        tag,
        signal_type: convertSignalDirection(typeRaw),
        io_address: "",
        description: "",
        source: "wired" as const,
      };
    });
}

export interface HierarchyParseResult {
  hierarchy: Hierarchy;
  /** Flat index for downstream parsers (states, alarms) to look up ids. */
  deviceIdByTag: Map<string, string>;
  equipment_moduleIdByName: Map<string, string>;
  unitIdByName: Map<string, string>;
}

export function parseHierarchyTable(
  tables: ParsedDocxTable[],
): HierarchyParseResult {
  const hierarchyTable = tables.find((t) =>
    /pac-forge:hierarchy-v2/i.test(t.caption),
  );
  if (!hierarchyTable) {
    throw new DocxIngestError("Hierarchy table (pac-forge:hierarchy-v2) not found");
  }

  const headers = hierarchyTable.headers.map((h) => h.trim());
  for (let i = 0; i < REQUIRED_HEADERS.length; i++) {
    if (headers[i] !== REQUIRED_HEADERS[i]) {
      throw new DocxIngestError(
        `Hierarchy table headers do not match expected V2 schema`,
        [`Expected: ${REQUIRED_HEADERS.join(" | ")}`, `Got: ${headers.join(" | ")}`],
      );
    }
  }

  // Accumulate by unit → equipment_module → device using the parsed ids so that
  // repeated cells (merged visually) still resolve to the same entity.
  const unitMap = new Map<string, UnitV2>();
  const equipment_moduleMap = new Map<string, EquipmentModuleV2>();
  const deviceMap = new Map<string, ControlModuleV2>();

  const deviceIdByTag = new Map<string, string>();
  const equipment_moduleIdByName = new Map<string, string>();
  const unitIdByName = new Map<string, string>();

  hierarchyTable.rows.forEach((row, rowIdx) => {
    if (row.length < REQUIRED_HEADERS.length) {
      throw new DocxIngestError(
        `Hierarchy row ${rowIdx + 1} has ${row.length} cells, expected ${REQUIRED_HEADERS.length}`,
        [`Row: ${row.join(" | ")}`],
      );
    }
    const [unitCell, equipment_moduleCell, deviceCell, classCell, safetyCell, ioCell] = row;

    const sub = extractUuid(unitCell, `row ${rowIdx + 1} unit`);
    const asy = extractUuid(equipment_moduleCell, `row ${rowIdx + 1} equipment_module`);
    const dev = extractUuid(deviceCell, `row ${rowIdx + 1} device`);

    let unit = unitMap.get(sub.uuid);
    if (!unit) {
      unit = {
        unit_id: sub.uuid,
        unit_name: sub.text,
        equipment_type: "Other",
        description: "",
        excluded: false,
        equipment_modules: [],
      };
      unitMap.set(sub.uuid, unit);
      unitIdByName.set(sub.text, sub.uuid);
    }

    let equipment_module = equipment_moduleMap.get(asy.uuid);
    if (!equipment_module) {
      equipment_module = {
        equipment_module_id: asy.uuid,
        equipment_module_name: asy.text,
        description: "",
        control_modules: [],
      };
      equipment_moduleMap.set(asy.uuid, equipment_module);
      unit.equipment_modules.push(equipment_module);
      equipment_moduleIdByName.set(asy.text, asy.uuid);
    }

    let device = deviceMap.get(dev.uuid);
    if (!device) {
      device = {
        control_module_id: dev.uuid,
        control_module_name: dev.text,
        control_module_class: classCell.trim() || "other",
        is_safety: /^(yes|true|1|safety)$/i.test(safetyCell.trim()),
        description: "",
        io_signals: parseIoCell(ioCell),
      };
      deviceMap.set(dev.uuid, device);
      equipment_module.control_modules.push(device);
      deviceIdByTag.set(dev.text, dev.uuid);
    }
  });

  return {
    hierarchy: { units: Array.from(unitMap.values()) },
    deviceIdByTag,
    equipment_moduleIdByName,
    unitIdByName,
  };
}
