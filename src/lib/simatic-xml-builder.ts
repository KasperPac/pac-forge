import type { Artifact, ArtifactType } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SclMember {
  name: string;
  datatype: string;
  startValue?: string;
  comment?: string;
}

interface SclSection {
  kind: SectionKind;
  members: SclMember[];
}

type SectionKind =
  | "Input"
  | "Output"
  | "InOut"
  | "Static"
  | "Temp"
  | "Constant"
  | "Return"
  | "None";

// Mapping from SCL VAR keywords to SimaticML section names
const VAR_SECTION_MAP: Record<string, SectionKind> = {
  VAR_INPUT: "Input",
  VAR_OUTPUT: "Output",
  VAR_IN_OUT: "InOut",
  VAR: "Static",
  VAR_TEMP: "Temp",
  "VAR CONSTANT": "Constant",
};

// TIA Portal engineering version strings per TIA version
const TIA_ENGINEERING_VERSION: Record<string, string> = {
  V15: "V15",
  "V15.1": "V15.1",
  V16: "V16",
  V17: "V17",
  V18: "V18",
  V19: "V19",
  V20: "V20",
};

// ---------------------------------------------------------------------------
// XML Escaping
// ---------------------------------------------------------------------------

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// SCL Interface Parser
// ---------------------------------------------------------------------------

/**
 * Parse VAR sections from SCL source to extract interface member definitions.
 *
 * Handles:
 *   VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR / VAR_TEMP / VAR CONSTANT
 *   member : DataType := startValue; // comment
 */
export function parseSclInterface(sclContent: string): SclSection[] {
  const sections: SclSection[] = [];
  const lines = sclContent.split("\n");

  let currentSection: SclSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Check for section start (order matters — check "VAR CONSTANT" before "VAR")
    if (!currentSection) {
      // Check "VAR CONSTANT" first (two-word keyword)
      if (/^VAR\s+CONSTANT\b/i.test(trimmed)) {
        currentSection = { kind: "Constant", members: [] };
        continue;
      }

      for (const [keyword, sectionKind] of Object.entries(VAR_SECTION_MAP)) {
        if (keyword === "VAR CONSTANT") continue; // handled above
        // Match keyword at start of line, possibly followed by whitespace or nothing
        const pattern = new RegExp(`^${keyword}\\b`, "i");
        if (pattern.test(trimmed)) {
          currentSection = { kind: sectionKind, members: [] };
          break;
        }
      }
      continue;
    }

    // Check for section end
    if (/^END_VAR\b/i.test(trimmed)) {
      if (currentSection.members.length > 0) {
        sections.push(currentSection);
      }
      currentSection = null;
      continue;
    }

    // Parse member line: name : DataType [:= defaultValue] ; [// comment]
    const memberMatch = trimmed.match(
      /^(\w+)\s*:\s*([^;:]+?)(?:\s*:=\s*([^;]+?))?\s*;(?:\s*\/\/\s*(.*))?$/
    );
    if (memberMatch) {
      currentSection.members.push({
        name: memberMatch[1],
        datatype: memberMatch[2].trim(),
        startValue: memberMatch[3]?.trim(),
        comment: memberMatch[4]?.trim(),
      });
    }
  }

  return sections;
}

/**
 * Parse STRUCT members from a UDT body.
 * UDTs have the form:
 *   TYPE "UDT_Name"
 *   STRUCT
 *     member : DataType;
 *   END_STRUCT;
 *   END_TYPE
 */
function parseUdtMembers(sclContent: string): SclMember[] {
  const members: SclMember[] = [];
  const lines = sclContent.split("\n");
  let inStruct = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^STRUCT\b/i.test(trimmed)) {
      inStruct = true;
      continue;
    }
    if (/^END_STRUCT\b/i.test(trimmed)) {
      break;
    }

    if (inStruct) {
      const memberMatch = trimmed.match(
        /^(\w+)\s*:\s*([^;:]+?)(?:\s*:=\s*([^;]+?))?\s*;(?:\s*\/\/\s*(.*))?$/
      );
      if (memberMatch) {
        members.push({
          name: memberMatch[1],
          datatype: memberMatch[2].trim(),
          startValue: memberMatch[3]?.trim(),
          comment: memberMatch[4]?.trim(),
        });
      }
    }
  }

  return members;
}

/**
 * Parse DB members from a DATA_BLOCK body.
 * Global DBs have:
 *   DATA_BLOCK "DB_Name"
 *   VAR / STRUCT
 *     member : DataType;
 *   END_VAR / END_STRUCT
 *   BEGIN
 *     ...initial values...
 *   END_DATA_BLOCK
 */
function parseDbMembers(sclContent: string): SclMember[] {
  const members: SclMember[] = [];
  const lines = sclContent.split("\n");
  let inVar = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(?:VAR|STRUCT)\b/i.test(trimmed) && !/^VAR_/i.test(trimmed)) {
      inVar = true;
      continue;
    }
    if (/^(?:END_VAR|END_STRUCT|BEGIN)\b/i.test(trimmed)) {
      if (inVar) break;
      continue;
    }

    if (inVar) {
      const memberMatch = trimmed.match(
        /^(\w+)\s*:\s*([^;:]+?)(?:\s*:=\s*([^;]+?))?\s*;(?:\s*\/\/\s*(.*))?$/
      );
      if (memberMatch) {
        members.push({
          name: memberMatch[1],
          datatype: memberMatch[2].trim(),
          startValue: memberMatch[3]?.trim(),
          comment: memberMatch[4]?.trim(),
        });
      }
    }
  }

  return members;
}

/**
 * Extract the code body from an FB/FC/OB (everything between BEGIN and END_*).
 */
function extractCodeBody(sclContent: string): string {
  const lines = sclContent.split("\n");
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^BEGIN\b/i.test(trimmed)) {
      startIdx = i + 1;
    }
    if (
      startIdx >= 0 &&
      /^END_(?:FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK)\b/i.test(trimmed)
    ) {
      endIdx = i;
      break;
    }
  }

  if (startIdx < 0) return "";
  return lines.slice(startIdx, endIdx).join("\n");
}

// ---------------------------------------------------------------------------
// Datatype Mapping
// ---------------------------------------------------------------------------

/**
 * Map SCL datatype strings to SimaticML datatype names.
 * Complex types like "UDT_Name" or Array types are handled specially.
 */
function mapDatatype(sclType: string): string {
  const upper = sclType.toUpperCase().trim();

  const simpleMap: Record<string, string> = {
    BOOL: "Bool",
    BYTE: "Byte",
    WORD: "Word",
    DWORD: "DWord",
    LWORD: "LWord",
    SINT: "SInt",
    INT: "Int",
    DINT: "DInt",
    LINT: "LInt",
    USINT: "USInt",
    UINT: "UInt",
    UDINT: "UDInt",
    ULINT: "ULInt",
    REAL: "Real",
    LREAL: "LReal",
    TIME: "Time",
    LTIME: "LTime",
    DATE: "Date",
    TOD: "Time_Of_Day",
    TIME_OF_DAY: "Time_Of_Day",
    LTOD: "LTime_Of_Day",
    DT: "Date_And_Time",
    DATE_AND_TIME: "Date_And_Time",
    LDT: "LDate_And_Time",
    DTL: "DTL",
    STRING: "String",
    WSTRING: "WString",
    CHAR: "Char",
    WCHAR: "WChar",
  };

  if (simpleMap[upper]) return simpleMap[upper];

  // String with length: STRING[80]
  const stringMatch = sclType.match(/^(W?STRING)\s*\[(\d+)\]/i);
  if (stringMatch) {
    const base = stringMatch[1].toUpperCase() === "WSTRING" ? "WString" : "String";
    return `${base} [${stringMatch[2]}]`;
  }

  // Array type: ARRAY[lo..hi] OF Type
  const arrayMatch = sclType.match(/^ARRAY\s*\[(.+?)\]\s+OF\s+(.+)/i);
  if (arrayMatch) {
    const bounds = arrayMatch[1].trim();
    const elementType = mapDatatype(arrayMatch[2].trim());
    return `Array [${bounds}] of ${elementType}`;
  }

  // Quoted UDT reference: "UDT_Name"
  if (sclType.startsWith('"') && sclType.endsWith('"')) {
    return sclType;
  }

  // Unquoted UDT reference — wrap in quotes
  if (/^[A-Za-z_]\w*$/.test(sclType) && !simpleMap[upper]) {
    return `"${sclType}"`;
  }

  return sclType;
}

// ---------------------------------------------------------------------------
// XML Fragment Builders
// ---------------------------------------------------------------------------

function membersToXml(
  members: SclMember[],
  sectionName: SectionKind
): string {
  if (members.length === 0) return "";

  const memberLines = members.map((m) => {
    const dt = mapDatatype(m.datatype);
    let xml = `        <Member Name="${escXml(m.name)}" Datatype="${escXml(dt)}" Remanence="NonRetain" Accessibility="Public">`;
    xml += `\n          <AttributeList>`;
    xml += `\n            <BooleanAttribute Name="ExternalAccessible" SystemDefined="true">true</BooleanAttribute>`;
    xml += `\n            <BooleanAttribute Name="ExternalVisible" SystemDefined="true">true</BooleanAttribute>`;
    xml += `\n            <BooleanAttribute Name="ExternalWritable" SystemDefined="true">true</BooleanAttribute>`;
    xml += `\n            <BooleanAttribute Name="SetPoint" SystemDefined="true">false</BooleanAttribute>`;
    xml += `\n          </AttributeList>`;
    if (m.startValue) {
      xml += `\n          <StartValue>${escXml(m.startValue)}</StartValue>`;
    }
    if (m.comment) {
      xml += `\n          <Comment><MultiLanguageText Lang="en-US">${escXml(m.comment)}</MultiLanguageText></Comment>`;
    }
    xml += `\n        </Member>`;
    return xml;
  });

  return `      <Section Name="${sectionName}">\n${memberLines.join("\n")}\n      </Section>`;
}

function buildInterface(sections: SclSection[]): string {
  const sectionXmls = sections
    .map((s) => membersToXml(s.members, s.kind))
    .filter((s) => s.length > 0);

  return `    <Interface>\n      <Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">\n${sectionXmls.join("\n")}\n      </Sections>\n    </Interface>`;
}

/**
 * Build a CompileUnit with StructuredText containing the code body.
 * We embed the SCL code as text tokens in a NetworkSource element.
 */
function buildCompileUnit(
  codeBody: string,
  networkId: string,
  progLang: string
): string {
  // Tokenize the code body into lines, emitting NewLine + Token elements
  const codeLines = codeBody.split("\n");
  const tokenLines: string[] = [];

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i];
    if (i > 0) {
      tokenLines.push(`              <NewLine Num="${i}" />`);
    }
    if (line.trim().length > 0) {
      // Emit leading whitespace as a Blank if present
      const leadingMatch = line.match(/^(\s+)/);
      if (leadingMatch) {
        tokenLines.push(
          `              <Blank Num="${leadingMatch[1].length}" />`
        );
      }
      tokenLines.push(
        `              <Token Text="${escXml(line.trim())}" />`
      );
    }
  }

  const tokenContent = tokenLines.join("\n");

  return `    <ObjectList>
      <SW.Blocks.CompileUnit ID="${networkId}" CompositionName="CompileUnits">
        <AttributeList>
          <NetworkSource>
            <FlgNet xmlns="http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v4">
              <Parts>
                <Access Scope="LiteralConstant" UId="0">
                  <Constant>
                    <ConstantType>STL</ConstantType>
                    <ConstantValue />
                  </Constant>
                </Access>
              </Parts>
              <Wires />
            </FlgNet>
          </NetworkSource>
          <ProgrammingLanguage>${progLang}</ProgrammingLanguage>
        </AttributeList>
        <ObjectList>
          <MultilingualText ID="${networkId}_title" CompositionName="Title">
            <ObjectList>
              <MultilingualTextItem ID="${networkId}_title_item" CompositionName="Items">
                <AttributeList>
                  <Culture>en-US</Culture>
                  <Text />
                </AttributeList>
              </MultilingualTextItem>
            </ObjectList>
          </MultilingualText>
        </ObjectList>
      </SW.Blocks.CompileUnit>
    </ObjectList>
    <ProgramCode>
      <STSource>
${tokenContent}
      </STSource>
    </ProgramCode>`;
}

// ---------------------------------------------------------------------------
// Document Wrapper
// ---------------------------------------------------------------------------

function wrapDocument(innerXml: string, tiaVersion: string): string {
  const engVersion =
    TIA_ENGINEERING_VERSION[tiaVersion] ?? tiaVersion.replace(/^V/i, "V");

  return `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="${escXml(engVersion)}" />
${innerXml}
</Document>`;
}

// ---------------------------------------------------------------------------
// Per-Block Type Builders
// ---------------------------------------------------------------------------

export function buildUdtXml(artifact: Artifact, tiaVersion: string): string {
  const members = parseUdtMembers(artifact.approved_content ?? artifact.content);

  const sectionXml = membersToXml(members, "None");

  const inner = `  <SW.Types.PlcStruct ID="0">
    <AttributeList>
      <Name>${escXml(artifact.name)}</Name>
    </AttributeList>
    <Interface>
      <Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">
${sectionXml}
      </Sections>
    </Interface>
  </SW.Types.PlcStruct>`;

  return wrapDocument(inner, tiaVersion);
}

export function buildGlobalDbXml(
  artifact: Artifact,
  tiaVersion: string
): string {
  const members = parseDbMembers(artifact.approved_content ?? artifact.content);

  const sectionXml = membersToXml(members, "Static");

  const inner = `  <SW.Blocks.GlobalDB ID="0">
    <AttributeList>
      <Name>${escXml(artifact.name)}</Name>
      <ProgrammingLanguage>DB</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
    </AttributeList>
    <Interface>
      <Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">
${sectionXml}
      </Sections>
    </Interface>
  </SW.Blocks.GlobalDB>`;

  return wrapDocument(inner, tiaVersion);
}

function buildCodeBlockXml(
  artifact: Artifact,
  tiaVersion: string,
  elementName: string,
  blockNumber?: string
): string {
  const content = artifact.approved_content ?? artifact.content;
  const sections = parseSclInterface(content);
  const codeBody = extractCodeBody(content);

  // For FCs, add a Return section if not already present
  if (
    elementName === "SW.Blocks.FC" &&
    !sections.some((s) => s.kind === "Return")
  ) {
    // Check if the SCL declares a return type on the FUNCTION line
    const funcMatch = content.match(
      /^FUNCTION\s+"[^"]+"\s*:\s*(.+)/im
    );
    if (funcMatch) {
      sections.push({
        kind: "Return",
        members: [
          {
            name: "Ret_Val",
            datatype: funcMatch[1].trim(),
          },
        ],
      });
    }
  }

  // Ensure all standard sections exist (TIA expects them even if empty)
  const requiredSections: SectionKind[] =
    elementName === "SW.Blocks.FC"
      ? ["Input", "Output", "InOut", "Temp", "Constant", "Return"]
      : ["Input", "Output", "InOut", "Static", "Temp", "Constant"];

  for (const kind of requiredSections) {
    if (!sections.some((s) => s.kind === kind)) {
      sections.push({ kind, members: [] });
    }
  }

  // Sort sections in standard order
  const sectionOrder: SectionKind[] = [
    "Input",
    "Output",
    "InOut",
    "Static",
    "Temp",
    "Constant",
    "Return",
    "None",
  ];
  sections.sort(
    (a, b) => sectionOrder.indexOf(a.kind) - sectionOrder.indexOf(b.kind)
  );

  const interfaceXml = buildInterface(sections);
  const compileUnit = buildCompileUnit(codeBody, "CU_1", "SCL");

  const blockNumAttr = blockNumber
    ? `\n      <Number>${escXml(blockNumber)}</Number>`
    : "";

  const inner = `  <${elementName} ID="0">
    <AttributeList>
      <Name>${escXml(artifact.name)}</Name>${blockNumAttr}
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
    </AttributeList>
${interfaceXml}
${compileUnit}
  </${elementName}>`;

  return wrapDocument(inner, tiaVersion);
}

export function buildFbXml(artifact: Artifact, tiaVersion: string): string {
  return buildCodeBlockXml(artifact, tiaVersion, "SW.Blocks.FB");
}

export function buildFcXml(artifact: Artifact, tiaVersion: string): string {
  return buildCodeBlockXml(artifact, tiaVersion, "SW.Blocks.FC");
}

export function buildObXml(artifact: Artifact, tiaVersion: string): string {
  // OBs typically have a number (e.g., OB1); try to extract from name
  const obNumMatch = artifact.name.match(/\bOB\s*(\d+)/i);
  const blockNumber = obNumMatch ? obNumMatch[1] : undefined;
  return buildCodeBlockXml(
    artifact,
    tiaVersion,
    "SW.Blocks.OB",
    blockNumber
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const BUILDER_MAP: Partial<
  Record<ArtifactType, (artifact: Artifact, tiaVersion: string) => string>
> = {
  UDT: buildUdtXml,
  DB: buildGlobalDbXml,
  FB: buildFbXml,
  FC: buildFcXml,
  OB: buildObXml,
};

/**
 * Build SimaticML XML for a single artifact.
 * Returns null for types that don't have an XML representation (SCL_SOURCE, TAG_TABLE).
 */
export function buildArtifactXml(
  artifact: Artifact,
  tiaVersion: string
): string | null {
  const builder = BUILDER_MAP[artifact.type];
  if (!builder) return null;
  return builder(artifact, tiaVersion);
}

/**
 * Derive an XML filename from an SCL filename.
 * e.g. "fb/FB_Conveyor.scl" → "fb/FB_Conveyor.xml"
 */
export function toXmlFilename(sclFilename: string): string {
  return sclFilename.replace(/\.scl$/i, ".xml");
}
