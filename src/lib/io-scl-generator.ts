/**
 * Programmatic SCL generator for IO-related artifacts.
 * Generates UDTs and a Global DB from an approved IoEntry[] list.
 * No AI call needed — deterministic, instant, zero token cost.
 */

import type { IoEntry } from "@/types";
import type { ParsedArtifact } from "@/lib/artifact-parser";

/** Sanitize a tag name for use as an SCL identifier. */
function toSclIdentifier(name: string): string {
  // Replace non-alphanumeric chars with underscore, ensure starts with letter
  let id = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(id)) id = `tag_${id}`;
  if (!id) id = "unnamed";
  return id;
}

interface IoGroup {
  label: string;
  udtName: string;
  entries: IoEntry[];
}

/**
 * Group IO entries into logical categories for UDT generation.
 * Groups by: Digital Inputs, Digital Outputs, Analog Inputs, Analog Outputs.
 */
function groupIoEntries(entries: IoEntry[]): IoGroup[] {
  const digitalInputs: IoEntry[] = [];
  const digitalOutputs: IoEntry[] = [];
  const analogInputs: IoEntry[] = [];
  const analogOutputs: IoEntry[] = [];

  for (const e of entries) {
    const addr = e.address.toUpperCase();
    if (addr.startsWith("%IW") || addr.startsWith("%ID")) {
      analogInputs.push(e);
    } else if (addr.startsWith("%QW") || addr.startsWith("%QD")) {
      analogOutputs.push(e);
    } else if (addr.startsWith("%I")) {
      digitalInputs.push(e);
    } else if (addr.startsWith("%Q")) {
      digitalOutputs.push(e);
    }
  }

  const groups: IoGroup[] = [];
  if (digitalInputs.length > 0) {
    groups.push({ label: "Digital Inputs", udtName: "typeDigitalInputs", entries: digitalInputs });
  }
  if (digitalOutputs.length > 0) {
    groups.push({ label: "Digital Outputs", udtName: "typeDigitalOutputs", entries: digitalOutputs });
  }
  if (analogInputs.length > 0) {
    groups.push({ label: "Analog Inputs", udtName: "typeAnalogInputs", entries: analogInputs });
  }
  if (analogOutputs.length > 0) {
    groups.push({ label: "Analog Outputs", udtName: "typeAnalogOutputs", entries: analogOutputs });
  }

  return groups;
}

/** Map an IoEntry data_type to a valid SCL type. */
function toSclType(dataType: string): string {
  const upper = dataType.toUpperCase();
  const map: Record<string, string> = {
    BOOL: "Bool",
    BYTE: "Byte",
    WORD: "Word",
    DWORD: "DWord",
    INT: "Int",
    DINT: "DInt",
    REAL: "Real",
    LREAL: "LReal",
    TIME: "Time",
    STRING: "String",
  };
  return map[upper] ?? "Bool";
}

/** Generate a UDT block from a group of IO entries. */
function generateUdt(group: IoGroup): string {
  const lines: string[] = [];
  lines.push(`TYPE "${group.udtName}"`);
  lines.push("VERSION : 0.1");
  lines.push("  STRUCT");

  // Track used names to avoid duplicates
  const usedNames = new Set<string>();

  for (const entry of group.entries) {
    let name = toSclIdentifier(entry.tag_name || `tag_${entry.address.replace(/[%.]/g, "_")}`);
    // Deduplicate
    const baseName = name;
    let counter = 1;
    while (usedNames.has(name)) {
      name = `${baseName}_${counter++}`;
    }
    usedNames.add(name);

    const sclType = toSclType(entry.data_type);
    const comment = entry.description
      ? ` // ${entry.description} (${entry.address})`
      : ` // ${entry.address}`;
    lines.push(`    ${name} : ${sclType};${comment}`);
  }

  lines.push("  END_STRUCT;");
  lines.push(`END_TYPE`);
  return lines.join("\n");
}

/** Generate the IO Mapping Global DB referencing the UDTs. */
function generateIoMappingDb(groups: IoGroup[]): string {
  const lines: string[] = [];
  lines.push(`DATA_BLOCK "IoMapping"`);
  lines.push(`{ S7_Optimized_Access := 'TRUE' }`);
  lines.push("VERSION : 0.1");
  lines.push("NON_RETAIN");
  lines.push("VAR");

  for (const group of groups) {
    const varName = group.udtName.replace(/^type/, "");
    // lowerCamelCase the var name
    const lcName = varName.charAt(0).toLowerCase() + varName.slice(1);
    lines.push(`    ${lcName} : "${group.udtName}";`);
  }

  lines.push("END_VAR");
  lines.push("BEGIN");
  lines.push("END_DATA_BLOCK");
  return lines.join("\n");
}

/**
 * Generate SCL artifacts from an approved IO list.
 * Returns ParsedArtifact[] ready to be saved and imported into TIA Portal.
 */
export function generateIoArtifacts(ioList: IoEntry[]): ParsedArtifact[] {
  if (ioList.length === 0) return [];

  const groups = groupIoEntries(ioList);
  if (groups.length === 0) return [];

  const artifacts: ParsedArtifact[] = [];

  // Generate UDTs
  const udtNames: string[] = [];
  for (const group of groups) {
    artifacts.push({
      name: group.udtName,
      type: "UDT",
      filename: `${group.udtName}.scl`,
      content: generateUdt(group),
      dependencies: [],
    });
    udtNames.push(group.udtName);
  }

  // Generate IO Mapping Global DB
  artifacts.push({
    name: "IoMapping",
    type: "DB",
    filename: "IoMapping.scl",
    content: generateIoMappingDb(groups),
    dependencies: udtNames,
  });

  return artifacts;
}
