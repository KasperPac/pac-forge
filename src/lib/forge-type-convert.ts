/**
 * forge-type-convert.ts
 * Deterministic type conversion FC + DB generation.
 * Reads TYPE_CONVERSION notes from matrix wiring, generates:
 *   - DB_Converted: global DB with converted signal fields
 *   - FC_TypeConvert: FC that reads raw signals and writes converted values
 */

import type { FbWire } from "@/types/forge-matrix";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversionEntry {
  /** Source signal path, e.g. "DB_ProcessCommands".cv01Direction */
  source: string;
  sourceType: string;
  targetType: string;
  /** FB param name this feeds, e.g. "direction" or "runForward" */
  fbParam: string;
  /** Device instance DB name, e.g. "InstConveyor01" */
  instanceDb: string;
  /** Device name for comments */
  deviceName: string;
  /** Output field name in DB_Converted */
  convertedField: string;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const TYPE_CONV_RE = /TYPE_CONVERSION:\s*(\w+)\s*→\s*(\w+)/;

/**
 * Extract all TYPE_CONVERSION entries from normalized matrix wiring.
 * Returns structured entries with deterministic output field names.
 */
export function extractConversions(
  matrixWiring: Array<{ deviceName: string; instanceDbName: string; wiring: FbWire[] }>,
): ConversionEntry[] {
  const entries: ConversionEntry[] = [];
  const seenFields = new Set<string>();

  for (const device of matrixWiring) {
    for (const wire of device.wiring) {
      if (!wire.notes) continue;
      const match = wire.notes.match(TYPE_CONV_RE);
      if (!match) continue;

      const sourceType = match[1];
      const targetType = match[2];

      // Build a unique field name: {instanceTag}_{paramName}
      // e.g. "InstConveyor01" + "runForward" → "instConveyor01_runForward"
      const instTag = device.instanceDbName.replace(/[^A-Za-z0-9]/g, "");
      const paramTag = wire.paramName.replace(/[^A-Za-z0-9]/g, "");
      let fieldName = `${lowerFirst(instTag)}_${paramTag}`;

      // Ensure uniqueness
      let suffix = 1;
      while (seenFields.has(fieldName)) {
        fieldName = `${lowerFirst(instTag)}_${paramTag}_${suffix++}`;
      }
      seenFields.add(fieldName);

      entries.push({
        source: wire.connectedTo,
        sourceType,
        targetType,
        fbParam: wire.paramName,
        instanceDb: device.instanceDbName,
        deviceName: device.deviceName,
        convertedField: fieldName,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// DB_Converted generation
// ---------------------------------------------------------------------------

/**
 * Generate the DB_Converted global data block with one field per conversion output.
 * Always returns a valid DB — empty VAR section if no conversions.
 */
export function generateDbConverted(
  conversions: ConversionEntry[],
  dbName = "DB_Converted",
): string {
  const fields = conversions.length > 0
    ? conversions
        .map((c) =>
          `    ${c.convertedField} : ${c.targetType};  // ${c.deviceName}: ${c.fbParam} (from ${c.source}, ${c.sourceType}→${c.targetType})`,
        )
        .join("\n")
    : "    // No type conversions required";

  return [
    `DATA_BLOCK "${dbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `NON_RETAIN`,
    `  VAR`,
    fields,
    `  END_VAR`,
    `BEGIN`,
    `END_DATA_BLOCK`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// FC_TypeConvert generation (SCL)
// ---------------------------------------------------------------------------

/**
 * Generate FC_TypeConvert in SCL.
 * Always returns a valid FC — empty BEGIN/END if no conversions.
 */
export function generateFcTypeConvertScl(
  conversions: ConversionEntry[],
  fcName = "FC_TypeConvert",
  convertedDbName = "DB_Converted",
): string {
  if (conversions.length === 0) {
    return [
      `FUNCTION "${fcName}" : Void`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `BEGIN`,
      `  // No type conversions required`,
      `END_FUNCTION`,
    ].join("\n");
  }

  // Group by device for readable comments
  const byDevice = new Map<string, ConversionEntry[]>();
  for (const c of conversions) {
    const arr = byDevice.get(c.deviceName) ?? [];
    arr.push(c);
    byDevice.set(c.deviceName, arr);
  }

  const lines: string[] = [];
  for (const [deviceName, entries] of byDevice) {
    lines.push(`  // ${deviceName}`);
    for (const c of entries) {
      const src = formatSource(c.source);
      const dst = `"${convertedDbName}".${c.convertedField}`;
      const convLine = buildSclConversion(src, c.sourceType, c.targetType, c.fbParam);
      lines.push(`  ${dst} := ${convLine};`);
    }
    lines.push("");
  }

  return [
    `FUNCTION "${fcName}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    ...lines,
    `END_FUNCTION`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// FC_TypeConvert generation (LAD JSON)
// ---------------------------------------------------------------------------

/**
 * Generate FC_TypeConvert as LadProgram JSON for LAD import.
 * Each conversion becomes one rung with appropriate comparison/move logic.
 */
export function generateFcTypeConvertLad(
  conversions: ConversionEntry[],
  fcName = "FC_TypeConvert",
  convertedDbName = "DB_Converted",
): Record<string, unknown> {
  const variables: Array<Record<string, unknown>> = [];
  const rungs: Array<Record<string, unknown>> = [];
  let elementId = 1;
  let rungId = 1;

  for (const c of conversions) {
    const src = formatSource(c.source);
    const dst = `"${convertedDbName}".${c.convertedField}`;
    const srcLower = c.sourceType.toLowerCase();
    const tgtLower = c.targetType.toLowerCase();

    if (srcLower === "int" && tgtLower === "bool") {
      // Int→Bool: compare box (== value) → output coil
      const value = inferBoolValue(c.fbParam);
      rungs.push({
        id: `rung_${rungId++}`,
        title: `${c.deviceName}: ${c.fbParam} (${c.sourceType}→${c.targetType}, value=${value})`,
        logic: {
          type: "series",
          nodes: [
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "CMP",
                operand: src,
                cmpOperator: "==",
                operand2: String(value),
                dataType: "Int",
              },
            },
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "OUTPUT_COIL",
                operand: dst,
              },
            },
          ],
        },
      });
    } else if (srcLower === "bool" && tgtLower === "int") {
      // Bool→Int: contact → MOVE 1 (and NC contact → MOVE 0 in separate rung)
      rungs.push({
        id: `rung_${rungId++}`,
        title: `${c.deviceName}: ${c.fbParam} (Bool→Int)`,
        logic: {
          type: "series",
          nodes: [
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "NO_CONTACT",
                operand: src,
              },
            },
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "MOVE",
                operand: "1",
                outputOperand: dst,
                dataType: "Int",
              },
            },
          ],
        },
      });
      rungs.push({
        id: `rung_${rungId++}`,
        title: `${c.deviceName}: ${c.fbParam} (Bool→Int, FALSE case)`,
        logic: {
          type: "series",
          nodes: [
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "NC_CONTACT",
                operand: src,
              },
            },
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "MOVE",
                operand: "0",
                outputOperand: dst,
                dataType: "Int",
              },
            },
          ],
        },
      });
    } else {
      // Generic: MOVE (handles Int→Word, Word→Int, etc. via TIA auto-conversion)
      rungs.push({
        id: `rung_${rungId++}`,
        title: `${c.deviceName}: ${c.fbParam} (${c.sourceType}→${c.targetType})`,
        logic: {
          type: "series",
          nodes: [
            {
              type: "element",
              element: {
                id: `el_${elementId++}`,
                type: "MOVE",
                operand: src,
                outputOperand: dst,
                dataType: c.sourceType,
              },
            },
          ],
        },
      });
    }
  }

  return {
    id: "lad_typeconvert",
    name: fcName,
    blockType: "FC",
    variables,
    rungs,
  };
}

// ---------------------------------------------------------------------------
// Rewire helper
// ---------------------------------------------------------------------------

/**
 * Update matrixWiring in-place: set `convertedSource` on wires that have TYPE_CONVERSION notes.
 * Returns the same array (mutated) for convenience.
 */
export function rewireConvertedSources(
  matrixWiring: Array<{ deviceName: string; instanceDbName: string; wiring: FbWire[] }>,
  conversions: ConversionEntry[],
  convertedDbName = "DB_Converted",
): void {
  // Build lookup: instanceDb + paramName → convertedField
  const lookup = new Map<string, string>();
  for (const c of conversions) {
    lookup.set(`${c.instanceDb}|${c.fbParam}`, `"${convertedDbName}".${c.convertedField}`);
  }

  for (const device of matrixWiring) {
    for (const wire of device.wiring) {
      const key = `${device.instanceDbName}|${wire.paramName}`;
      const converted = lookup.get(key);
      if (converted) {
        wire.convertedSource = converted;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Format a connectedTo string as a quoted DB reference.
 * "DB_ProcessCommands.cv01Direction" → "DB_ProcessCommands".cv01Direction
 */
function formatSource(connectedTo: string): string {
  const dotIdx = connectedTo.indexOf(".");
  if (dotIdx === -1) return `"${connectedTo}"`;
  const db = connectedTo.slice(0, dotIdx);
  const field = connectedTo.slice(dotIdx + 1);
  // If db is already quoted, keep it
  if (db.startsWith('"')) return connectedTo;
  return `"${db}".${field}`;
}

/**
 * Build SCL conversion expression based on source/target types.
 */
function buildSclConversion(
  source: string,
  sourceType: string,
  targetType: string,
  paramHint: string,
): string {
  const srcLower = sourceType.toLowerCase();
  const tgtLower = targetType.toLowerCase();

  if (srcLower === "int" && tgtLower === "bool") {
    const value = inferBoolValue(paramHint);
    return `(${source} = ${value})`;
  }
  if (srcLower === "bool" && tgtLower === "int") {
    return `SEL(G := ${source}, IN0 := 0, IN1 := 1)`;
  }
  if (srcLower === "int" && tgtLower === "word") {
    return `INT_TO_WORD(${source})`;
  }
  if (srcLower === "word" && tgtLower === "int") {
    return `WORD_TO_INT(${source})`;
  }
  if (srcLower === "int" && tgtLower === "dint") {
    return `INT_TO_DINT(${source})`;
  }
  if (srcLower === "dint" && tgtLower === "int") {
    return `DINT_TO_INT(${source})`;
  }
  if (srcLower === "int" && tgtLower === "real") {
    return `INT_TO_REAL(${source})`;
  }
  if (srcLower === "real" && tgtLower === "int") {
    return `REAL_TO_INT(${source})`;
  }
  // Fallback: direct assignment (may need manual review)
  return source;
}

/**
 * Infer which integer value maps to TRUE for an Int→Bool conversion.
 * Uses the FB parameter name as a semantic hint.
 */
function inferBoolValue(paramHint: string): number {
  const lower = paramHint.toLowerCase();
  // Direction patterns: forward=1, reverse=2
  if (lower.includes("forward") || lower.includes("fwd")) return 1;
  if (lower.includes("reverse") || lower.includes("rev")) return 2;
  // Start/stop patterns
  if (lower.includes("start") || lower.includes("run") || lower.includes("enable")) return 1;
  if (lower.includes("stop") || lower.includes("disable")) return 0;
  // Generic fallback: non-zero = TRUE
  return 1;
}
