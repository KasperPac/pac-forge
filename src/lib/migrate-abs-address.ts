/**
 * Absolute address → symbolic tag conversion for S7-300 → S7-1500 migration.
 *
 * S7-1500 optimized blocks don't support absolute addressing. All absolute
 * references (M10.0, MW10, I0.1, QW4 etc.) must become symbolic tag names.
 *
 * Strategy: convert to a stable ABS_ placeholder name with the type inferred
 * from the address format. The engineer creates these tags in TIA Portal's
 * tag table once — they can be renamed to proper symbolic names later.
 *
 * Examples:
 *   M10.0  → ABS_M10_0  : Bool    @ %M10.0
 *   MW10   → ABS_MW10   : Word    @ %MW10
 *   MD20   → ABS_MD20   : DWord   @ %MD20
 *   MB4    → ABS_MB4    : Byte    @ %MB4
 *   I0.1   → ABS_I0_1   : Bool    @ %I0.1
 *   IW0    → ABS_IW0    : Word    @ %IW0
 *   Q1.0   → ABS_Q1_0   : Bool    @ %Q1.0
 *   QW0    → ABS_QW0    : Word    @ %QW0
 */

export interface AbsTag {
  /** Generated symbolic name, e.g. ABS_M10_0 */
  symbolicName: string;
  /** S7-1500 data type, e.g. Bool, Word, DWord, Byte */
  dataType: string;
  /** TIA Portal absolute address notation, e.g. %M10.0 */
  address: string;
  /** Original text as it appeared in the source */
  original: string;
}

// ─── Type inference ───────────────────────────────────────────────────────────

function inferType(prefix: string, suffix: string, hasBit: boolean): string {
  if (hasBit) return "Bool";
  const s = suffix.toUpperCase();
  if (s === "B") return "Byte";
  if (s === "W") return "Word";
  if (s === "D") return "DWord";
  if (s === "X") return "Bool";
  // No suffix — default based on area
  const p = prefix.toUpperCase();
  if (p === "M" || p === "I" || p === "Q" || p === "E" || p === "A") return "Bool";
  return "Word";
}

/**
 * Convert a single absolute address string to an ABS_ symbolic tag.
 * Returns null if the input doesn't match a known absolute address pattern.
 */
export function absoluteToSymbolic(addr: string): AbsTag | null {
  const a = addr.trim();

  // Bit address: M10.0, I0.1, Q1.0, E0.0, A0.0
  // Pattern: single letter + digits + dot + digit
  const bitMatch = a.match(/^([MIQEAiqmea])(\d+)\.(\d+)$/);
  if (bitMatch) {
    const p = bitMatch[1].toUpperCase();
    const byte_ = bitMatch[2];
    const bit   = bitMatch[3];
    return {
      symbolicName: `ABS_${p}${byte_}_${bit}`,
      dataType: "Bool",
      address: `%${p}${byte_}.${bit}`,
      original: a,
    };
  }

  // Byte/Word/DWord/X-bit with type suffix: MB10, MW10, MD20, IB0, IW0, QB0, QW0, QD0
  // Pattern: single letter + type letter + digits
  const suffixMatch = a.match(/^([MIQEAiqmea])([BWDXbwdx])(\d+)$/);
  if (suffixMatch) {
    const p   = suffixMatch[1].toUpperCase();
    const suf = suffixMatch[2].toUpperCase();
    const num = suffixMatch[3];
    return {
      symbolicName: `ABS_${p}${suf}${num}`,
      dataType: inferType(p, suf, false),
      address: `%${p}${suf}${num}`,
      original: a,
    };
  }

  // DB absolute: DB10.DBX0.0, DB10.DBW4, DB10.DBD8
  const dbMatch = a.match(/^DB(\d+)\.(DB[XBWD])(\d+)(?:\.(\d+))?$/i);
  if (dbMatch) {
    const dbNum  = dbMatch[1];
    const dbType = dbMatch[2].toUpperCase();
    const offset = dbMatch[3];
    const bit    = dbMatch[4];
    const hasBit = bit !== undefined;
    const suf = dbType.slice(2); // X, B, W, D
    const name = hasBit
      ? `ABS_DB${dbNum}_${suf}${offset}_${bit}`
      : `ABS_DB${dbNum}_${suf}${offset}`;
    return {
      symbolicName: name,
      dataType: inferType("M", suf, hasBit),
      address: hasBit ? `%DB${dbNum}.DB${suf}${offset}.${bit}` : `%DB${dbNum}.DB${suf}${offset}`,
      original: a,
    };
  }

  return null;
}

// ─── Bulk replacement in source text ─────────────────────────────────────────

const ABS_ADDR_TEXT_RE =
  /\b(?:DB\d+\.DB[XBWD]\d+(?:\.\d+)?|[MIQEAiqmea][BWDXbwdx]?\d+(?:\.\d+)?)\b/g;

/**
 * Replace all absolute address references in a block of text (SCL, GRAPH action
 * statements, or GRAPH transition conditions) with ABS_ symbolic names.
 *
 * Returns the rewritten text and a map of original → AbsTag for all conversions.
 */
export function replaceAbsoluteAddresses(
  text: string,
): { text: string; tags: Map<string, AbsTag> } {
  const tags = new Map<string, AbsTag>();

  const result = text.replace(ABS_ADDR_TEXT_RE, (match) => {
    // Avoid replacing things that look like addresses but aren't
    // (e.g. "I" alone, variable names starting with M/I/Q etc.)
    const tag = absoluteToSymbolic(match);
    if (!tag) return match;

    if (!tags.has(match)) tags.set(match, tag);
    return tag.symbolicName;
  });

  return { text: result, tags };
}

/**
 * Replace absolute address Component Name attributes in SimaticML XML text.
 * Targets: <Component Name="M10.0"/> and similar.
 *
 * Returns the rewritten XML and a map of conversions.
 */
export function replaceAbsoluteAddressesInXml(
  xml: string,
): { xml: string; tags: Map<string, AbsTag> } {
  const tags = new Map<string, AbsTag>();

  // Match Name="<addr>" where addr looks like an absolute address
  const result = xml.replace(/\bName="([^"]+)"/g, (fullMatch, nameVal) => {
    const tag = absoluteToSymbolic(nameVal);
    if (!tag) return fullMatch;

    if (!tags.has(nameVal)) tags.set(nameVal, tag);
    return `Name="${tag.symbolicName}"`;
  });

  // Also handle S5TIME# in Constant Value attributes: Value="S5TIME#5s"
  // (not absolute addresses, but same pre-pass opportunity)
  return { xml: result, tags };
}

/**
 * Format a tag list as a human-readable block for advisory output.
 */
export function formatTagList(tags: Map<string, AbsTag>): string {
  if (tags.size === 0) return "";

  const lines = [
    `   TAG TABLE — create these in TIA Portal (PLC tags → Default tag table):`,
    `   ${"Name".padEnd(22)} ${"Type".padEnd(8)} Address`,
    `   ${"─".repeat(48)}`,
  ];

  for (const tag of tags.values()) {
    lines.push(
      `   ${tag.symbolicName.padEnd(22)} ${tag.dataType.padEnd(8)} ${tag.address}`,
    );
  }

  return lines.join("\n");
}
