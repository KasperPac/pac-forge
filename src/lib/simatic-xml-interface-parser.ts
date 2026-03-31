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
 * Extract the block name from an <AttributeList> section, skipping any
 * nested <Prefix><Name>...</Name></Prefix> which contains the namespace
 * prefix (e.g. "p"), not the actual block name.
 */
function extractNameFromAttributeList(attrListXml: string): string | null {
  // Strip <Prefix>...</Prefix> so its <Name> child doesn't match
  const stripped = attrListXml.replace(/<Prefix>[\s\S]*?<\/Prefix>/g, "");
  const m = stripped.match(/<Name>(.*?)<\/Name>/);
  return m ? m[1] : null;
}

/**
 * Extract block name and type from SimaticML XML.
 * Two strategies: (1) extract full <AttributeList> content and strip <Prefix>,
 * (2) fallback to old regex skipping past <Prefix> inline if (1) fails.
 */
function detectBlockType(xml: string): { name: string; type: ParsedLibraryBlock["type"] } {
  const blockPatterns: Array<{ tag: string; type: ParsedLibraryBlock["type"] }> = [
    { tag: "SW\\.Blocks\\.FB", type: "FB" },
    { tag: "SW\\.Blocks\\.FC", type: "FC" },
    { tag: "SW\\.Blocks\\.GlobalDB", type: "DB" },
    { tag: "SW\\.Types\\.PlcStruct", type: "UDT" },
    { tag: "SW\\.Blocks\\.OB", type: "OB" },
  ];

  // Strategy 1: Find a known block type tag and extract Name from its AttributeList
  for (const { tag, type } of blockPatterns) {
    // Check if this block type exists in the XML at all
    const tagPresent = xml.match(new RegExp(`<${tag}[^>]*>`));
    if (!tagPresent) continue;

    // Try to find Name in the block's AttributeList (strip Prefix first)
    const fullAttrMatch = xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<AttributeList>([\\s\\S]*?)</AttributeList>`));
    if (fullAttrMatch) {
      const name = extractNameFromAttributeList(fullAttrMatch[1]);
      if (name) return { name, type };
    }

    // Try Name directly after AttributeList (skip Prefix)
    const directMatch = xml.match(new RegExp(
      `<${tag}[^>]*>[\\s\\S]*?<AttributeList>` +
      `(?:[\\s\\S]*?<Prefix>[\\s\\S]*?</Prefix>)?` +
      `[\\s\\S]*?<Name>(.*?)</Name>`
    ));
    if (directMatch) return { name: directMatch[1], type };

    // Block type found but no Name in its section — return type with Unknown name.
    // The caller (parseLibraryExport) will use the library path as the name.
    return { name: "Unknown", type };
  }

  // Strategy 2: check for CodeBlockLibraryTypeVersion wrapper (library exports)
  // The actual block type is nested inside — detect it and return
  if (xml.includes("CodeBlockLibraryTypeVersion") || xml.includes("LibraryTypeVersion")) {
    for (const { tag, type } of blockPatterns) {
      if (xml.match(new RegExp(`<${tag}[^>]*>`))) {
        // Name may be anywhere — try all AttributeList sections
        const allAttrs = [...xml.matchAll(/<AttributeList>([\s\S]*?)<\/AttributeList>/g)];
        for (const attr of allAttrs) {
          const name = extractNameFromAttributeList(attr[1]);
          if (name && name.length > 1) return { name, type };
        }
        return { name: "Unknown", type };
      }
    }
    // UDT library versions use SW.Types
    if (xml.includes("SW.Types.PlcStruct")) return { name: "Unknown", type: "UDT" };
  }

  // Final fallback: any AttributeList with a Name
  const fallback = xml.match(/<AttributeList>([\s\S]*?)<\/AttributeList>/);
  if (fallback) {
    const name = extractNameFromAttributeList(fallback[1]);
    if (name) return { name, type: "Unknown" };
  }

  return { name: "Unknown", type: "Unknown" };
}

/**
 * Parse a <Member> element into an SCL variable declaration line.
 * Extracts name and datatype from the opening <Member> tag attributes,
 * comment from nested MultiLanguageText, and start value from StartValue.
 */
function parseMember(memberXml: string): string {
  // Match attributes from the opening <Member ...> tag only (not nested elements)
  const openTagMatch = memberXml.match(/<Member\s+([^>]*?)(?:\/>|>)/);
  if (!openTagMatch) return "";

  const attrs = openTagMatch[1];
  const nameMatch = attrs.match(/Name="([^"]+)"/);
  const datatypeMatch = attrs.match(/Datatype="([^"]+)"/);
  if (!nameMatch) return "";

  const name = nameMatch[1];
  let datatype = datatypeMatch?.[1] ?? "Variant";

  // Clean up datatype: remove quotes around UDT references
  datatype = datatype.replace(/^"(.*)"$/, '"$1"');

  // Check for comment (prefer en-US, fall back to first MultiLanguageText)
  let comment = "";
  const enComment = memberXml.match(/<MultiLanguageText\s+Lang="en-US">(.*?)<\/MultiLanguageText>/);
  if (enComment) {
    comment = ` // ${enComment[1]}`;
  } else {
    const anyComment = memberXml.match(/<MultiLanguageText[^>]*>(.*?)<\/MultiLanguageText>/);
    if (anyComment?.[1]) comment = ` // ${anyComment[1]}`;
  }

  // Check for start value
  const startValMatch = memberXml.match(/<StartValue>(.*?)<\/StartValue>/);
  const startVal = startValMatch ? ` := ${startValMatch[1]}` : "";

  return `    ${name} : ${datatype}${startVal};${comment}`;
}

/**
 * Parse a <Section> element (Input, Output, InOut, Static, Temp, Return, Constant)
 * into SCL VAR declarations.
 */
function parseSection(sectionContent: string, sectionName: string): string {
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

  // Use DOMParser to reliably extract top-level <Member> elements
  // (nested Members inside UDT struct defs would otherwise confuse regex)
  try {
    const doc = new DOMParser().parseFromString(`<root>${sectionContent}</root>`, "application/xml");
    const memberEls = Array.from(doc.documentElement.children).filter(
      (el) => el.tagName === "Member",
    );
    if (memberEls.length === 0) return "";

    const members: string[] = [];
    for (const el of memberEls) {
      // Serialize back to string for parseMember (which extracts attrs + comments)
      const serializer = new XMLSerializer();
      const memberXml = serializer.serializeToString(el);
      const line = parseMember(memberXml);
      if (line) members.push(line);
    }

    if (members.length === 0) return "";
    return `  ${keyword}\n${members.join("\n")}\n  END_VAR`;
  } catch {
    // Fallback to regex if DOMParser fails
    const memberRegex = /<Member\b[^>]*(?:\/>|>[\s\S]*?<\/Member>)/g;
    const members: string[] = [];
    let memberMatch: RegExpExecArray | null;
    while ((memberMatch = memberRegex.exec(sectionContent)) !== null) {
      const line = parseMember(memberMatch[0]);
      if (line) members.push(line);
    }
    if (members.length === 0) return "";
    return `  ${keyword}\n${members.join("\n")}\n  END_VAR`;
  }
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

  // Extract <Interface> element — Sections tag may have xmlns attribute, Interface may have attributes
  const interfaceMatch = xml.match(/<Interface[^>]*>[\s\S]*?<Sections[^>]*>([\s\S]*)<\/Sections>/);
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

  // Parse each section using DOMParser for reliable nested XML handling
  const sectionParser = new DOMParser();
  const sectionsDoc = sectionParser.parseFromString(
    `<root>${sectionsXml}</root>`,
    "application/xml",
  );
  const sections: string[] = [];

  for (const sectionEl of Array.from(sectionsDoc.documentElement.children)) {
    if (sectionEl.tagName !== "Section") continue;
    const sectionName = sectionEl.getAttribute("Name") ?? "";
    // Re-serialize section content back to string for the regex-based parseMember
    const sectionContent = sectionEl.innerHTML;
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

  for (const [path, content] of Object.entries(items)) {
    // Skip master copy listings
    if (content.startsWith("[MasterCopy]")) continue;
    // Skip empty/tiny content
    if (!content || content.length < 50) continue;
    // Must be XML
    if (!content.includes("<")) continue;

    const parsed = parseSimaticXmlInterface(content);
    if (parsed) {
      // Library exports may not have <Name> in the XML — the block name comes
      // from the library path (e.g., "Open Library V18/Devices/fbMotor_Reversing").
      // Use the path-derived name if the XML parser returned "Unknown".
      if (parsed.name === "Unknown" && path) {
        const pathName = path.split("/").pop();
        if (pathName) parsed.name = pathName;
      }
      blocks.push(parsed);
    }
  }

  return blocks;
}
