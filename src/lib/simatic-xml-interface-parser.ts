/**
 * simatic-xml-interface-parser.ts
 *
 * Parses SimaticML XML exports from TIA Portal library types to extract
 * the FB/FC/UDT interface (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, etc.)
 * as a pseudo-SCL declaration block. The actual LAD/FBD logic is ignored.
 */

export interface ParsedLibraryBlock {
  /** Block name from XML */
  name: string;
  /** Block type: FB, FC, UDT, DB, OB */
  type: "FB" | "FC" | "UDT" | "DB" | "OB" | "Unknown";
  /** Pseudo-SCL interface declaration (no implementation body) */
  interfaceScl: string;
  /** Raw SimaticML XML (for storing with the template) */
  rawXml: string;
  /** Programming language detected from XML (LAD, SCL, FBD, STL, GRAPH) */
  programmingLanguage: string;
}

/**
 * Extract block name and type from SimaticML XML.
 */
function detectBlockType(xml: string): { name: string; type: ParsedLibraryBlock["type"] } {
  // Try SW.Blocks.FB
  let match = xml.match(/<SW\.Blocks\.FB[^>]*>[\s\S]*?<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/);
  if (match) return { name: match[1], type: "FB" };

  // Try SW.Blocks.FC
  match = xml.match(/<SW\.Blocks\.FC[^>]*>[\s\S]*?<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/);
  if (match) return { name: match[1], type: "FC" };

  // Try SW.Blocks.GlobalDB
  match = xml.match(/<SW\.Blocks\.GlobalDB[^>]*>[\s\S]*?<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/);
  if (match) return { name: match[1], type: "DB" };

  // Try SW.Types.PlcStruct (UDT)
  match = xml.match(/<SW\.Types\.PlcStruct[^>]*>[\s\S]*?<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/);
  if (match) return { name: match[1], type: "UDT" };

  // Try SW.Blocks.OB
  match = xml.match(/<SW\.Blocks\.OB[^>]*>[\s\S]*?<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/);
  if (match) return { name: match[1], type: "OB" };

  // Fallback: any Name in AttributeList
  match = xml.match(/<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/);
  return { name: match?.[1] ?? "Unknown", type: "Unknown" };
}

/**
 * Parse a <Member> element into an SCL variable declaration line.
 */
function parseMember(memberXml: string): string {
  const nameMatch = memberXml.match(/Name="([^"]+)"/);
  const datatypeMatch = memberXml.match(/Datatype="([^"]+)"/);
  if (!nameMatch || !datatypeMatch) return "";

  const name = nameMatch[1];
  let datatype = datatypeMatch[1];

  // Clean up datatype: remove quotes around UDT references
  datatype = datatype.replace(/^"(.*)"$/, '"$1"');

  // Check for comment
  const commentMatch = memberXml.match(/<Comment[\s\S]*?<MultiLanguageText[^>]*>(.*?)<\/MultiLanguageText>/);
  const comment = commentMatch ? ` // ${commentMatch[1]}` : "";

  // Check for start value
  const startValMatch = memberXml.match(/<StartValue>(.*?)<\/StartValue>/);
  const startVal = startValMatch ? ` := ${startValMatch[1]}` : "";

  return `    ${name} : ${datatype}${startVal};${comment}`;
}

/**
 * Parse a <Section> element (Input, Output, InOut, Static, Temp, Return, Constant)
 * into SCL VAR declarations.
 */
function parseSection(sectionXml: string, sectionName: string): string {
  const varKeyword: Record<string, string> = {
    Input: "VAR_INPUT",
    Output: "VAR_OUTPUT",
    InOut: "VAR_IN_OUT",
    Static: "VAR",
    Temp: "VAR_TEMP",
    Return: "VAR_OUTPUT",
    Constant: "VAR CONSTANT",
  };

  const keyword = varKeyword[sectionName] ?? `VAR // ${sectionName}`;

  // Extract all <Member> elements (non-greedy, top-level only)
  const memberRegex = /<Member\b[^>]*(?:\/>|>[\s\S]*?<\/Member>)/g;
  const members: string[] = [];
  let memberMatch: RegExpExecArray | null;

  while ((memberMatch = memberRegex.exec(sectionXml)) !== null) {
    const line = parseMember(memberMatch[0]);
    if (line) members.push(line);
  }

  if (members.length === 0) return "";

  return `  ${keyword}\n${members.join("\n")}\n  END_VAR`;
}

/**
 * Extract the interface from SimaticML XML and format as pseudo-SCL.
 * Returns the block declaration with VAR sections but no implementation.
 */
export function parseSimaticXmlInterface(xml: string): ParsedLibraryBlock | null {
  const { name, type } = detectBlockType(xml);
  if (type === "Unknown" && !xml.includes("<Interface>")) return null;

  // Detect programming language — check both block-level and compile-unit-level tags.
  // Also check for FlgNet (LAD/FBD network source) as a fallback indicator.
  const langMatch = xml.match(/<ProgrammingLanguage>(.*?)<\/ProgrammingLanguage>/);
  let programmingLanguage = langMatch?.[1] ?? "SCL";
  // If no explicit language tag but has FlgNet (network source), it's LAD or FBD
  if (!langMatch && xml.includes("<FlgNet")) {
    programmingLanguage = "LAD";
  }
  // If language says "LAD" or "FBD" anywhere in the compile units, trust that
  if (programmingLanguage === "SCL" && xml.includes(">LAD<")) {
    programmingLanguage = "LAD";
  } else if (programmingLanguage === "SCL" && xml.includes(">FBD<")) {
    programmingLanguage = "FBD";
  }

  // Extract <Interface> element
  const interfaceMatch = xml.match(/<Interface>[\s\S]*?<Sections>([\s\S]*?)<\/Sections>[\s\S]*?<\/Interface>/);
  if (!interfaceMatch) {
    // For UDTs, the structure might be directly in the XML
    // Return a minimal declaration
    return {
      name,
      type,
      interfaceScl: `// ${type} "${name}" — interface could not be extracted from XML\n// Refer to documentation for parameter details.`,
      rawXml: xml,
      programmingLanguage,
    };
  }

  const sectionsXml = interfaceMatch[1];

  // Parse each section
  const sectionRegex = /<Section\s+Name="(\w+)">([\s\S]*?)<\/Section>/g;
  const sections: string[] = [];
  let sectionMatch: RegExpExecArray | null;

  while ((sectionMatch = sectionRegex.exec(sectionsXml)) !== null) {
    const [, sectionName, sectionContent] = sectionMatch;
    const parsed = parseSection(sectionContent, sectionName);
    if (parsed) sections.push(parsed);
  }

  // Build pseudo-SCL declaration
  const blockKeyword = type === "UDT" ? "TYPE" : type === "DB" ? "DATA_BLOCK" : `FUNCTION_BLOCK`;
  const endKeyword = type === "UDT" ? "END_TYPE" : type === "DB" ? "END_DATA_BLOCK" : "END_FUNCTION_BLOCK";

  const interfaceScl = [
    `// ${type} "${name}" — interface extracted from TIA Library (LAD implementation)`,
    `// The actual logic is in LAD — this declaration shows the interface only.`,
    `${blockKeyword} "${name}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ``,
    ...sections,
    ``,
    `BEGIN`,
    `  // LAD implementation — not shown (use library block directly)`,
    `${endKeyword}`,
  ].join("\n");

  return { name, type, interfaceScl, rawXml: xml, programmingLanguage };
}

/**
 * Parse multiple library export items (XML strings) into parsed blocks.
 */
export function parseLibraryExport(
  items: Record<string, string>,
): ParsedLibraryBlock[] {
  const blocks: ParsedLibraryBlock[] = [];

  for (const [, content] of Object.entries(items)) {
    // Skip master copy listings
    if (content.startsWith("[MasterCopy]")) continue;
    // Skip empty/tiny content
    if (!content || content.length < 50) continue;
    // Must be XML
    if (!content.includes("<")) continue;

    const parsed = parseSimaticXmlInterface(content);
    if (parsed) {
      blocks.push(parsed);
    }
  }

  return blocks;
}
