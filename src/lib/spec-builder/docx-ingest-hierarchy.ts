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
  AssemblyV2,
  DeviceV2,
  Hierarchy,
  IoSignalV2,
  SubsystemV2,
} from "@/types/spec-contract-v2";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";
import type { ParsedDocxTable } from "@/lib/spec-builder/docx-ingest";
// (type-only — avoids runtime cycle with docx-ingest.ts dispatcher)

export class DocxIngestError extends Error {
  constructor(message: string, public readonly diagnostics: string[] = []) {
    super(message);
    this.name = "DocxIngestError";
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
  assemblyIdByName: Map<string, string>;
  subsystemIdByName: Map<string, string>;
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

  // Accumulate by subsystem → assembly → device using the parsed ids so that
  // repeated cells (merged visually) still resolve to the same entity.
  const subsystemMap = new Map<string, SubsystemV2>();
  const assemblyMap = new Map<string, AssemblyV2>();
  const deviceMap = new Map<string, DeviceV2>();

  const deviceIdByTag = new Map<string, string>();
  const assemblyIdByName = new Map<string, string>();
  const subsystemIdByName = new Map<string, string>();

  hierarchyTable.rows.forEach((row, rowIdx) => {
    if (row.length < REQUIRED_HEADERS.length) {
      throw new DocxIngestError(
        `Hierarchy row ${rowIdx + 1} has ${row.length} cells, expected ${REQUIRED_HEADERS.length}`,
        [`Row: ${row.join(" | ")}`],
      );
    }
    const [subsystemCell, assemblyCell, deviceCell, classCell, safetyCell, ioCell] = row;

    const sub = extractUuid(subsystemCell, `row ${rowIdx + 1} subsystem`);
    const asy = extractUuid(assemblyCell, `row ${rowIdx + 1} assembly`);
    const dev = extractUuid(deviceCell, `row ${rowIdx + 1} device`);

    let subsystem = subsystemMap.get(sub.uuid);
    if (!subsystem) {
      subsystem = {
        subsystem_id: sub.uuid,
        subsystem_name: sub.text,
        equipment_type: "Other",
        description: "",
        excluded: false,
        assemblies: [],
      };
      subsystemMap.set(sub.uuid, subsystem);
      subsystemIdByName.set(sub.text, sub.uuid);
    }

    let assembly = assemblyMap.get(asy.uuid);
    if (!assembly) {
      assembly = {
        assembly_id: asy.uuid,
        assembly_name: asy.text,
        description: "",
        devices: [],
      };
      assemblyMap.set(asy.uuid, assembly);
      subsystem.assemblies.push(assembly);
      assemblyIdByName.set(asy.text, asy.uuid);
    }

    let device = deviceMap.get(dev.uuid);
    if (!device) {
      device = {
        device_id: dev.uuid,
        device_name: dev.text,
        device_class: classCell.trim() || "other",
        is_safety: /^(yes|true|1|safety)$/i.test(safetyCell.trim()),
        description: "",
        io_signals: parseIoCell(ioCell),
      };
      deviceMap.set(dev.uuid, device);
      assembly.devices.push(device);
      deviceIdByTag.set(dev.text, dev.uuid);
    }
  });

  return {
    hierarchy: { subsystems: Array.from(subsystemMap.values()) },
    deviceIdByTag,
    assemblyIdByName,
    subsystemIdByName,
  };
}
