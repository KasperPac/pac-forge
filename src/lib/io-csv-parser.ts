import type { IoEntry } from "@/types";

const VALID_DATA_TYPES = new Set([
  "BOOL", "BYTE", "WORD", "DWORD", "INT", "DINT", "REAL", "LREAL", "TIME", "STRING",
]);

/** Column name aliases (lowercase) → IoEntry field */
const COLUMN_MAP: Record<string, keyof IoEntry> = {
  address: "address",
  addr: "address",
  tag_name: "tag_name",
  tagname: "tag_name",
  tag: "tag_name",
  name: "tag_name",
  data_type: "data_type",
  datatype: "data_type",
  type: "data_type",
  description: "description",
  desc: "description",
  comment: "description",
  module: "module",
  slot: "slot",
};

function detectDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { "\t": 0, ";": 0, ",": 0 };
  for (const ch of firstLine) {
    if (ch in counts) counts[ch]++;
  }
  // Prefer tab > semicolon > comma (common in EU engineering)
  if (counts["\t"] >= 2) return "\t";
  if (counts[";"] >= 2) return ";";
  return ",";
}

function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseCsvToIoEntries(csvText: string): {
  entries: IoEntry[];
  warnings: string[];
} {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { entries: [], warnings: ["File is empty"] };

  const delimiter = detectDelimiter(lines[0]);
  const headerFields = parseLine(lines[0], delimiter).map((h) => h.toLowerCase().replace(/[^a-z_]/g, ""));

  // Map header columns to IoEntry fields
  const columnMapping: (keyof IoEntry | null)[] = headerFields.map(
    (h) => COLUMN_MAP[h] ?? null
  );

  const hasHeaders = columnMapping.some((m) => m !== null);
  const warnings: string[] = [];
  const entries: IoEntry[] = [];

  // If no recognizable headers, treat first line as data with positional mapping
  const dataStart = hasHeaders ? 1 : 0;
  const fieldOrder: (keyof IoEntry)[] = hasHeaders
    ? columnMapping.map((m) => m!)
    : ["address", "tag_name", "data_type", "description", "module", "slot"];

  if (!hasHeaders) {
    warnings.push("No recognized header row — using positional mapping: address, tag_name, data_type, description, module, slot");
  }

  for (let i = dataStart; i < lines.length; i++) {
    const fields = parseLine(lines[i], delimiter);
    const entry: IoEntry = {
      address: "",
      tag_name: "",
      data_type: "BOOL",
      description: "",
      module: "",
      slot: 0,
    };

    let hasValue = false;
    for (let j = 0; j < fields.length && j < fieldOrder.length; j++) {
      const key = fieldOrder[j];
      if (!key) continue;
      const val = fields[j];
      if (!val) continue;

      if (key === "slot") {
        entry.slot = parseInt(val) || 0;
      } else {
        (entry as unknown as Record<string, unknown>)[key] = val;
      }
      hasValue = true;
    }

    if (!hasValue) {
      warnings.push(`Row ${i + 1}: empty, skipped`);
      continue;
    }

    // Validate/normalize data_type
    const upperType = entry.data_type.toUpperCase();
    if (VALID_DATA_TYPES.has(upperType)) {
      entry.data_type = upperType;
    } else {
      warnings.push(`Row ${i + 1}: unknown data type "${entry.data_type}", defaulting to BOOL`);
      entry.data_type = "BOOL";
    }

    entries.push(entry);
  }

  return { entries, warnings };
}
