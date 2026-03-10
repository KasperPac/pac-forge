/**
 * Generates SimaticML XML for LAD (Ladder Logic) blocks.
 * Produces FlgNet v4 with Parts and Wires that TIA Portal V18 can import.
 *
 * Key rules confirmed from TIA V18 reference exports:
 * - All Access nodes BEFORE Part nodes inside <Parts>
 * - Parallel (OR) branches use <Part Name="O"> with in1/in2/... and out
 * - Powerrail wire fans to ALL branch starts in a single <Wire>
 * - Timer instances use Scope="LocalVariable" for FB static vars
 * - Timer pins: IN, PT, Q, ET (capitals)
 * - TypedConstant scope for time literals (T#5s)
 * - Compare boxes: "pre" is rung-flow input pin, "out" is output
 */

import type {
  LadProgram,
  LadRung,
  LadNode,
  LadSeriesChain,
  LadElement,
  LadVariable,
} from "@/types/lad";

// ---------------------------------------------------------------------------
// XML Escaping
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// UID Counter
// ---------------------------------------------------------------------------

class UidCounter {
  private n = 20;
  next(): number {
    return ++this.n;
  }
}

// ---------------------------------------------------------------------------
// Part Name Mapping
// ---------------------------------------------------------------------------

function getPartName(el: LadElement): string {
  switch (el.type) {
    case "NO_CONTACT":
    case "NC_CONTACT":
      return "Contact";
    case "OUTPUT_COIL":
      return "Coil";
    case "SET_COIL":
      return "SCoil";
    case "RESET_COIL":
      return "RCoil";
    case "TON":
      return "TON";
    case "TOF":
      return "TOF";
    case "CTU":
      return "CTU";
    case "CTD":
      return "CTD";
    case "CMP":
      return cmpPartName(el.cmpOperator ?? "==");
    case "MATH":
      return el.mathOperator ?? "Add";
    case "MOVE":
      return "Move";
    default:
      return "Contact";
  }
}

function cmpPartName(op: string): string {
  const map: Record<string, string> = {
    "==": "Eq",
    "!=": "Ne",
    ">": "Gt",
    "<": "Lt",
    ">=": "Ge",
    "<=": "Le",
  };
  return map[op] ?? "Eq";
}

// ---------------------------------------------------------------------------
// Accumulator for Access + Part entries (Access must come before Parts)
// ---------------------------------------------------------------------------

interface PartEntry {
  uid: number;
  isAccess: boolean; // Access nodes must be emitted before Part nodes
  xml: string;
}

interface WireEntry {
  uid: number;
  xml: string;
}

interface ChainResult {
  /** UID of the first element's rung-flow "in" pin */
  inUid: number;
  inPin: string;
  /** UID of the last element's rung-flow "out" pin */
  outUid: number;
  outPin: string;
  /**
   * Additional rung-flow entry points (parallel branch starts beyond the first).
   * The upstream wire must fan out to ALL of these in addition to inUid/inPin.
   */
  extraIns?: Array<{ uid: number; pin: string }>;
}

// ---------------------------------------------------------------------------
// Access node builders
// ---------------------------------------------------------------------------

function buildAccessNode(uid: number, operand: string, scope: string = "LocalVariable"): string {
  const parts = operand.replace(/^"/, "").replace(/"$/, "").split(".");
  const components = parts.map((p) => `              <Component Name="${esc(p)}" />`).join("\n");
  return `          <Access Scope="${scope}" UId="${uid}">
            <Symbol>
${components}
            </Symbol>
          </Access>`;
}

function buildLiteralAccess(uid: number, value: string, dataType: string): string {
  return `          <Access Scope="LiteralConstant" UId="${uid}">
            <Constant>
              <ConstantType>${esc(dataType)}</ConstantType>
              <ConstantValue>${esc(value)}</ConstantValue>
            </Constant>
          </Access>`;
}

function buildTypedConstantAccess(uid: number, value: string): string {
  // Used for Time literals like "T#5s", "T#0s"
  return `          <Access Scope="TypedConstant" UId="${uid}">
            <Constant>
              <ConstantValue>${esc(value)}</ConstantValue>
            </Constant>
          </Access>`;
}

// ---------------------------------------------------------------------------
// Element processors
// ---------------------------------------------------------------------------

function processElement(
  el: LadElement,
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult {
  const partName = getPartName(el);
  const partUid = counter.next();

  // ── Contacts (NO / NC) ──────────────────────────────────────────────────
  if (el.type === "NO_CONTACT" || el.type === "NC_CONTACT") {
    const accessUid = counter.next();
    parts.push({ uid: accessUid, isAccess: true, xml: buildAccessNode(accessUid, el.operand) });

    let xml = `          <Part Name="Contact" UId="${partUid}"`;
    if (el.type === "NC_CONTACT") {
      xml += `>\n            <Negated Name="operand" />\n          </Part>`;
    } else {
      xml += ` />`;
    }
    parts.push({ uid: partUid, isAccess: false, xml });

    const w = counter.next();
    wires.push({
      uid: w,
      xml: `          <Wire UId="${w}">
            <IdentCon UId="${accessUid}" />
            <NameCon UId="${partUid}" Name="operand" />
          </Wire>`,
    });

    return { inUid: partUid, inPin: "in", outUid: partUid, outPin: "out" };
  }

  // ── Coils (normal / Set / Reset) ─────────────────────────────────────────
  if (el.type === "OUTPUT_COIL" || el.type === "SET_COIL" || el.type === "RESET_COIL") {
    const accessUid = counter.next();
    parts.push({ uid: accessUid, isAccess: true, xml: buildAccessNode(accessUid, el.operand) });
    parts.push({ uid: partUid, isAccess: false, xml: `          <Part Name="${partName}" UId="${partUid}" />` });

    const w = counter.next();
    wires.push({
      uid: w,
      xml: `          <Wire UId="${w}">
            <IdentCon UId="${accessUid}" />
            <NameCon UId="${partUid}" Name="operand" />
          </Wire>`,
    });

    return { inUid: partUid, inPin: "in", outUid: partUid, outPin: "out" };
  }

  // ── Timers (TON / TOF) ───────────────────────────────────────────────────
  if (el.type === "TON" || el.type === "TOF") {
    const instUid = counter.next();
    const instName = el.instanceDb ?? el.operand;
    // Instance scope: LocalVariable for static members in an FB
    const instXml = `          <Part Name="${partName}" Version="1.0" UId="${partUid}">
            <Instance Scope="LocalVariable" UId="${instUid}">
              <Component Name="${esc(instName)}" />
            </Instance>
            <TemplateValue Name="time_type" Type="Type">Time</TemplateValue>
          </Part>`;
    parts.push({ uid: partUid, isAccess: false, xml: instXml });

    // PT (preset time) — TypedConstant for time literals
    const ptValue = el.presetTime ?? "T#1s";
    const ptUid = counter.next();
    parts.push({ uid: ptUid, isAccess: true, xml: buildTypedConstantAccess(ptUid, ptValue) });

    const ptWire = counter.next();
    wires.push({
      uid: ptWire,
      xml: `          <Wire UId="${ptWire}">
            <IdentCon UId="${ptUid}" />
            <NameCon UId="${partUid}" Name="PT" />
          </Wire>`,
    });

    // ET output (elapsed time) → variable if operand2 given
    if (el.operand2) {
      const etUid = counter.next();
      parts.push({ uid: etUid, isAccess: true, xml: buildAccessNode(etUid, el.operand2) });
      const etWire = counter.next();
      wires.push({
        uid: etWire,
        xml: `          <Wire UId="${etWire}">
            <NameCon UId="${partUid}" Name="ET" />
            <IdentCon UId="${etUid}" />
          </Wire>`,
      });
    }

    // Q output → rung continues (or drives a coil access via operand)
    if (el.operand && !el.instanceDb) {
      // operand used as instance name above; no Q output variable
    }

    // Q output drives the downstream rung flow via pin "Q"
    return { inUid: partUid, inPin: "IN", outUid: partUid, outPin: "Q" };
  }

  // ── Counters (CTU / CTD) ─────────────────────────────────────────────────
  if (el.type === "CTU" || el.type === "CTD") {
    const instUid = counter.next();
    const instName = el.instanceDb ?? el.operand;
    const instXml = `          <Part Name="${partName}" Version="1.0" UId="${partUid}">
            <Instance Scope="LocalVariable" UId="${instUid}">
              <Component Name="${esc(instName)}" />
            </Instance>
          </Part>`;
    parts.push({ uid: partUid, isAccess: false, xml: instXml });

    // PV (preset value)
    const pvValue = String(el.presetCount ?? 10);
    const pvUid = counter.next();
    parts.push({ uid: pvUid, isAccess: true, xml: buildLiteralAccess(pvUid, pvValue, "Int") });
    const pvWire = counter.next();
    wires.push({
      uid: pvWire,
      xml: `          <Wire UId="${pvWire}">
            <IdentCon UId="${pvUid}" />
            <NameCon UId="${partUid}" Name="PV" />
          </Wire>`,
    });

    const inPin = el.type === "CTU" ? "CU" : "CD";
    return { inUid: partUid, inPin, outUid: partUid, outPin: "Q" };
  }

  // ── Compare boxes (Eq/Ne/Gt/Lt/Ge/Le) ───────────────────────────────────
  // Rung flow: upstream → Part.pre (enable), Part.out → downstream
  // Data: in1 = operand (variable), in2 = operand2 (variable or literal)
  if (el.type === "CMP") {
    const srcType = el.dataType ?? "Int";
    const cmpXml = `          <Part Name="${partName}" UId="${partUid}">
            <TemplateValue Name="SrcType" Type="Type">${esc(srcType)}</TemplateValue>
          </Part>`;
    parts.push({ uid: partUid, isAccess: false, xml: cmpXml });

    // in1
    const in1Uid = counter.next();
    parts.push({ uid: in1Uid, isAccess: true, xml: buildAccessNode(in1Uid, el.operand) });
    const in1Wire = counter.next();
    wires.push({
      uid: in1Wire,
      xml: `          <Wire UId="${in1Wire}">
            <IdentCon UId="${in1Uid}" />
            <NameCon UId="${partUid}" Name="in1" />
          </Wire>`,
    });

    // in2
    if (el.operand2) {
      const in2Uid = counter.next();
      const isTimeLiteral = /^T#/i.test(el.operand2);
      const isNumLiteral = /^\d+(\.\d+)?$/.test(el.operand2);
      if (isTimeLiteral) {
        parts.push({ uid: in2Uid, isAccess: true, xml: buildTypedConstantAccess(in2Uid, el.operand2) });
      } else if (isNumLiteral) {
        parts.push({ uid: in2Uid, isAccess: true, xml: buildLiteralAccess(in2Uid, el.operand2, srcType) });
      } else {
        parts.push({ uid: in2Uid, isAccess: true, xml: buildAccessNode(in2Uid, el.operand2) });
      }
      const in2Wire = counter.next();
      wires.push({
        uid: in2Wire,
        xml: `          <Wire UId="${in2Wire}">
            <IdentCon UId="${in2Uid}" />
            <NameCon UId="${partUid}" Name="in2" />
          </Wire>`,
      });
    }

    // Rung flow: "pre" in, "out" out
    return { inUid: partUid, inPin: "pre", outUid: partUid, outPin: "out" };
  }

  // ── Math boxes (Add/Sub/Mul/Div) ─────────────────────────────────────────
  if (el.type === "MATH") {
    const mathType = el.dataType ?? "Int";
    const mathXml = `          <Part Name="${partName}" UId="${partUid}">
            <TemplateValue Name="SrcType" Type="Type">${esc(mathType)}</TemplateValue>
          </Part>`;
    parts.push({ uid: partUid, isAccess: false, xml: mathXml });

    // in1
    const in1Uid = counter.next();
    parts.push({ uid: in1Uid, isAccess: true, xml: buildAccessNode(in1Uid, el.operand) });
    const in1Wire = counter.next();
    wires.push({
      uid: in1Wire,
      xml: `          <Wire UId="${in1Wire}">
            <IdentCon UId="${in1Uid}" />
            <NameCon UId="${partUid}" Name="in1" />
          </Wire>`,
    });

    // in2
    if (el.operand2) {
      const in2Uid = counter.next();
      const isNumLiteral = /^\d+(\.\d+)?$/.test(el.operand2);
      if (isNumLiteral) {
        parts.push({ uid: in2Uid, isAccess: true, xml: buildLiteralAccess(in2Uid, el.operand2, mathType) });
      } else {
        parts.push({ uid: in2Uid, isAccess: true, xml: buildAccessNode(in2Uid, el.operand2) });
      }
      const in2Wire = counter.next();
      wires.push({
        uid: in2Wire,
        xml: `          <Wire UId="${in2Wire}">
            <IdentCon UId="${in2Uid}" />
            <NameCon UId="${partUid}" Name="in2" />
          </Wire>`,
      });
    }

    // out → output variable
    if (el.outputOperand) {
      const outUid = counter.next();
      parts.push({ uid: outUid, isAccess: true, xml: buildAccessNode(outUid, el.outputOperand) });
      const outWire = counter.next();
      wires.push({
        uid: outWire,
        xml: `          <Wire UId="${outWire}">
            <NameCon UId="${partUid}" Name="out" />
            <IdentCon UId="${outUid}" />
          </Wire>`,
      });
    }

    return { inUid: partUid, inPin: "en", outUid: partUid, outPin: "eno" };
  }

  // ── Move ─────────────────────────────────────────────────────────────────
  if (el.type === "MOVE") {
    const moveXml = `          <Part Name="Move" UId="${partUid}" DisabledENO="true">
            <TemplateValue Name="Card" Type="Cardinality">1</TemplateValue>
          </Part>`;
    parts.push({ uid: partUid, isAccess: false, xml: moveXml });

    // in (source)
    const inUid = counter.next();
    const isLiteral = /^\d+(\.\d+)?$/.test(el.operand);
    if (isLiteral) {
      parts.push({ uid: inUid, isAccess: true, xml: buildLiteralAccess(inUid, el.operand, el.dataType ?? "Int") });
    } else {
      parts.push({ uid: inUid, isAccess: true, xml: buildAccessNode(inUid, el.operand) });
    }
    const inWire = counter.next();
    wires.push({
      uid: inWire,
      xml: `          <Wire UId="${inWire}">
            <IdentCon UId="${inUid}" />
            <NameCon UId="${partUid}" Name="in" />
          </Wire>`,
    });

    // out1 (destination)
    if (el.outputOperand) {
      const outUid = counter.next();
      parts.push({ uid: outUid, isAccess: true, xml: buildAccessNode(outUid, el.outputOperand) });
      const outWire = counter.next();
      wires.push({
        uid: outWire,
        xml: `          <Wire UId="${outWire}">
            <NameCon UId="${partUid}" Name="out1" />
            <IdentCon UId="${outUid}" />
          </Wire>`,
      });
    }

    // Move with DisabledENO doesn't participate in rung flow through en/eno —
    // the en is driven from powerrail directly. We return en/eno as flow pins
    // so the caller wires the powerrail (or upstream contact chain) to "en".
    return { inUid: partUid, inPin: "en", outUid: partUid, outPin: "eno" };
  }

  // Fallback
  const accessUid = counter.next();
  parts.push({ uid: accessUid, isAccess: true, xml: buildAccessNode(accessUid, el.operand ?? "?") });
  parts.push({ uid: partUid, isAccess: false, xml: `          <Part Name="Contact" UId="${partUid}" />` });
  const w = counter.next();
  wires.push({
    uid: w,
    xml: `          <Wire UId="${w}">
            <IdentCon UId="${accessUid}" />
            <NameCon UId="${partUid}" Name="operand" />
          </Wire>`,
  });
  return { inUid: partUid, inPin: "in", outUid: partUid, outPin: "out" };
}

// ---------------------------------------------------------------------------
// Parallel (OR) branch processor
// ---------------------------------------------------------------------------

function processParallel(
  node: LadNode & { type: "parallel" },
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult {
  const N = node.branches.length;
  if (N === 0) return { inUid: -1, inPin: "in", outUid: -1, outPin: "out" };
  if (N === 1) return processChain(node.branches[0], counter, parts, wires);

  // Create O Part (OR gate) with N inputs
  const oUid = counter.next();
  parts.push({
    uid: oUid,
    isAccess: false,
    xml: `          <Part Name="O" UId="${oUid}">
            <TemplateValue Name="Card" Type="Cardinality">${N}</TemplateValue>
          </Part>`,
  });

  // Process each branch, wire branch.out → O.inN
  const branchInUids: Array<{ uid: number; pin: string }> = [];

  for (let i = 0; i < node.branches.length; i++) {
    const br = processChain(node.branches[i], counter, parts, wires);
    branchInUids.push({ uid: br.inUid, pin: br.inPin });

    const w = counter.next();
    wires.push({
      uid: w,
      xml: `          <Wire UId="${w}">
            <NameCon UId="${br.outUid}" Name="${br.outPin}" />
            <NameCon UId="${oUid}" Name="in${i + 1}" />
          </Wire>`,
    });
  }

  // Return: inUid = first branch, extraIns = remaining branches
  // The caller will fan the upstream wire to ALL branch starts.
  return {
    inUid: branchInUids[0].uid,
    inPin: branchInUids[0].pin,
    extraIns: branchInUids.slice(1),
    outUid: oUid,
    outPin: "out",
  };
}

// ---------------------------------------------------------------------------
// Node dispatcher
// ---------------------------------------------------------------------------

function processNode(
  node: LadNode,
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult {
  if (node.type === "element") {
    return processElement(node.element, counter, parts, wires);
  }
  return processParallel(node, counter, parts, wires);
}

// ---------------------------------------------------------------------------
// Series chain processor
// ---------------------------------------------------------------------------

function processChain(
  chain: LadSeriesChain,
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult {
  let prevOutUid = -1;
  let prevOutPin = "";
  let firstInUid = -1;
  let firstInPin = "";
  let firstExtraIns: Array<{ uid: number; pin: string }> = [];

  for (let i = 0; i < chain.nodes.length; i++) {
    const node = chain.nodes[i];
    const nodeResult = processNode(node, counter, parts, wires);

    if (i === 0) {
      firstInUid = nodeResult.inUid;
      firstInPin = nodeResult.inPin;
      firstExtraIns = nodeResult.extraIns ?? [];
    } else {
      // Wire from previous output to ALL inputs of this node.
      // Parallel branches expose multiple entry points (extraIns).
      const allTargets = [
        { uid: nodeResult.inUid, pin: nodeResult.inPin },
        ...(nodeResult.extraIns ?? []),
      ];
      const targetsXml = allTargets
        .map((t) => `\n            <NameCon UId="${t.uid}" Name="${t.pin}" />`)
        .join("");
      const wireUid = counter.next();
      wires.push({
        uid: wireUid,
        xml: `          <Wire UId="${wireUid}">
            <NameCon UId="${prevOutUid}" Name="${prevOutPin}" />${targetsXml}
          </Wire>`,
      });
    }

    prevOutUid = nodeResult.outUid;
    prevOutPin = nodeResult.outPin;
  }

  return {
    inUid: firstInUid,
    inPin: firstInPin,
    outUid: prevOutUid,
    outPin: prevOutPin,
    extraIns: firstExtraIns,
  };
}

// ---------------------------------------------------------------------------
// Rung → Parts + Wires
// ---------------------------------------------------------------------------

function buildRungPartsAndWires(
  rung: LadRung,
  counter: UidCounter,
): { parts: PartEntry[]; wires: WireEntry[] } {
  const parts: PartEntry[] = [];
  const wires: WireEntry[] = [];

  const result = processChain(rung.logic, counter, parts, wires);

  // Powerrail wire fans to ALL first-node inputs (handles parallel branches at start)
  const allFirstIns = [
    { uid: result.inUid, pin: result.inPin },
    ...(result.extraIns ?? []),
  ];
  const targetsXml = allFirstIns
    .map((t) => `\n            <NameCon UId="${t.uid}" Name="${t.pin}" />`)
    .join("");
  const railWireUid = counter.next();
  wires.push({
    uid: railWireUid,
    xml: `          <Wire UId="${railWireUid}">
            <Powerrail />${targetsXml}
          </Wire>`,
  });

  return { parts, wires };
}

// ---------------------------------------------------------------------------
// Interface (variables) XML
// ---------------------------------------------------------------------------

function buildVariableSection(variables: LadVariable[], sectionName: string): string {
  const members = variables.filter((v) => v.section === sectionName);
  if (members.length === 0) return `          <Section Name="${sectionName}" />`;

  const memberXml = members
    .map((m) => {
      let xml = `            <Member Name="${esc(m.name)}" Datatype="${esc(m.dataType)}" Remanence="NonRetain" Accessibility="Public">`;
      xml += `\n              <AttributeList>`;
      xml += `\n                <BooleanAttribute Name="ExternalAccessible" SystemDefined="true">true</BooleanAttribute>`;
      xml += `\n                <BooleanAttribute Name="ExternalVisible" SystemDefined="true">true</BooleanAttribute>`;
      xml += `\n                <BooleanAttribute Name="ExternalWritable" SystemDefined="true">true</BooleanAttribute>`;
      xml += `\n                <BooleanAttribute Name="SetPoint" SystemDefined="true">false</BooleanAttribute>`;
      xml += `\n              </AttributeList>`;
      if (m.initialValue) {
        xml += `\n              <StartValue>${esc(m.initialValue)}</StartValue>`;
      }
      if (m.comment) {
        xml += `\n              <Comment><MultiLanguageText Lang="en-US">${esc(m.comment)}</MultiLanguageText></Comment>`;
      }
      xml += `\n            </Member>`;
      return xml;
    })
    .join("\n");

  return `          <Section Name="${sectionName}">\n${memberXml}\n          </Section>`;
}

function buildInterface(variables: LadVariable[], blockType: string): string {
  const sections =
    blockType === "FC"
      ? ["Input", "Output", "InOut", "Temp", "Constant", "Return"]
      : ["Input", "Output", "InOut", "Static", "Temp", "Constant"];

  const sectionXmls = sections.map((s) => buildVariableSection(variables, s));

  // <Interface> must be inline with <Sections> — no newline between them
  return `      <Interface><Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5">
${sectionXmls.join("\n")}
        </Sections></Interface>`;
}

// ---------------------------------------------------------------------------
// Compile Unit (one per rung / network)
// ---------------------------------------------------------------------------

function buildCompileUnit(rung: LadRung, index: number, counter: UidCounter): string {
  const { parts, wires } = buildRungPartsAndWires(rung, counter);
  const cuId = `CU_${index + 1}`;

  // Access nodes must come before Part nodes
  const accessParts = parts.filter((p) => p.isAccess).map((p) => p.xml);
  const partParts = parts.filter((p) => !p.isAccess).map((p) => p.xml);
  const partsXml = [...accessParts, ...partParts].join("\n");
  const wiresXml = wires.map((w) => w.xml).join("\n");

  return `      <SW.Blocks.CompileUnit ID="${cuId}" CompositionName="CompileUnits">
        <AttributeList>
          <NetworkSource><FlgNet xmlns="http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v4">
              <Parts>
${partsXml}
              </Parts>
              <Wires>
${wiresXml}
              </Wires>
            </FlgNet></NetworkSource>
          <ProgrammingLanguage>LAD</ProgrammingLanguage>
        </AttributeList>
        <ObjectList>
          <MultilingualText ID="${cuId}_title" CompositionName="Title">
            <ObjectList>
              <MultilingualTextItem ID="${cuId}_title_item" CompositionName="Items">
                <AttributeList>
                  <Culture>en-US</Culture>
                  <Text>${esc(rung.title ?? "")}</Text>
                </AttributeList>
              </MultilingualTextItem>
            </ObjectList>
          </MultilingualText>${rung.comment ? `
          <MultilingualText ID="${cuId}_comment" CompositionName="Comment">
            <ObjectList>
              <MultilingualTextItem ID="${cuId}_comment_item" CompositionName="Items">
                <AttributeList>
                  <Culture>en-US</Culture>
                  <Text>${esc(rung.comment)}</Text>
                </AttributeList>
              </MultilingualTextItem>
            </ObjectList>
          </MultilingualText>` : ""}
        </ObjectList>
      </SW.Blocks.CompileUnit>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build SimaticML LAD XML for a LadProgram.
 * The resulting XML can be imported into TIA Portal V18 via Openness.
 */
export function buildLadXml(program: LadProgram, tiaVersion: string = "V18"): string {
  const counter = new UidCounter();

  const blockElement =
    program.blockType === "FC"
      ? "SW.Blocks.FC"
      : program.blockType === "OB"
        ? "SW.Blocks.OB"
        : "SW.Blocks.FB";

  const interfaceXml = buildInterface(program.variables, program.blockType);

  const compileUnits = program.rungs
    .map((rung, i) => buildCompileUnit(rung, i, counter))
    .join("\n");

  const blockNumAttr = program.blockNumber
    ? `\n      <Number>${program.blockNumber}</Number>`
    : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="${esc(tiaVersion)}" />
  <${blockElement} ID="0">
    <AttributeList>
      <AutoNumber>false</AutoNumber>
      <HeaderAuthor />
      <HeaderFamily />
      <HeaderName />
      <HeaderVersion>0.1</HeaderVersion>
      <IsIECCheckEnabled>false</IsIECCheckEnabled>
      <Name>${esc(program.name)}</Name>${blockNumAttr}
      <Namespace />
      <ProgrammingLanguage>LAD</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
${interfaceXml}
    </AttributeList>
    <ObjectList>
${compileUnits}
    </ObjectList>
  </${blockElement}>
</Document>`;
}
