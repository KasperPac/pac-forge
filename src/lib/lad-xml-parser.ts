/**
 * SimaticML XML → LadProgram parser
 *
 * Parses TIA Portal V18 block XML exports (FlgNet v4 format) into the
 * LadProgram data model used by the LAD canvas renderer.
 *
 * Supports: Contact, Coil, SCoil, RCoil, O (OR gate), Call (FB),
 * Move, Eq/Ne/Gt/Lt/Ge/Le (compare), Add/Sub/Mul/Div (math),
 * TON/TOF, CTU/CTD, PContact/NContact (edge contacts).
 */

import type {
  LadProgram,
  LadRung,
  LadElement,
  LadSeriesChain,
  LadNode,
  LadVariable,
  LadElementType,
  LadCmpOperator,
  LadMathOperator,
  FbCallParam,
} from "@/types/lad";

// ---------------------------------------------------------------------------
// XML helpers (browser DOMParser)
// ---------------------------------------------------------------------------

function parseXmlDoc(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`XML parse error: ${err.textContent}`);
  return doc;
}

/** Get direct children matching a tag (namespace-agnostic) */
function childrenByTag(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter(
    (c) => c.localName === tag || c.tagName === tag,
  );
}

function firstChild(el: Element, tag: string): Element | null {
  return childrenByTag(el, tag)[0] ?? null;
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? "";
}

// ---------------------------------------------------------------------------
// Internal types for graph reconstruction
// ---------------------------------------------------------------------------

interface AccessNode {
  uid: string;
  scope: string;
  /** Resolved symbolic name e.g. "DB_SENSORS.SENSOR_FB[97]._SensorDlyOnOff" */
  symbol: string;
  /** Data type from ConstantType or inferred */
  dataType?: string;
  /** For LiteralConstant access nodes */
  constantValue?: string;
}

interface PartNode {
  uid: string;
  name: string; // "Contact", "Coil", "SCoil", "O", "Call", "Move", "Eq", etc.
  negated: Set<string>; // pin names that are negated
  templateValues: Map<string, string>; // e.g. Card → "4", SrcType → "Int"
  callInfo?: {
    blockName: string;
    blockType: string;
    instanceDb?: string;
    parameters: FbCallParam[];
  };
  disabledENO: boolean;
}

interface WireConnection {
  type: "powerrail" | "nameCon" | "identCon";
  uid?: string;
  pin?: string;
}

interface Wire {
  uid: string;
  connections: WireConnection[];
}

// Adjacency: partUid.pinName → what feeds it
type PinSource =
  | { kind: "powerrail" }
  | { kind: "part"; uid: string; pin: string }
  | { kind: "access"; uid: string };

// ---------------------------------------------------------------------------
// Parse XML into graph
// ---------------------------------------------------------------------------

function resolveSymbol(accessEl: Element): { symbol: string; dataType?: string; constantValue?: string } {
  const scope = attr(accessEl, "Scope");

  if (scope === "LiteralConstant") {
    const constant = firstChild(accessEl, "Constant");
    if (constant) {
      const cType = firstChild(constant, "ConstantType")?.textContent ?? "";
      const cVal = firstChild(constant, "ConstantValue")?.textContent ?? "";
      return { symbol: cVal, dataType: cType, constantValue: cVal };
    }
    return { symbol: "", constantValue: "" };
  }

  if (scope === "TypedConstant") {
    const constant = firstChild(accessEl, "Constant");
    if (constant) {
      const cType = firstChild(constant, "ConstantType")?.textContent ?? "";
      const cVal = firstChild(constant, "ConstantValue")?.textContent ?? "";
      return { symbol: cVal, dataType: cType, constantValue: cVal };
    }
  }

  // GlobalVariable or LocalVariable — resolve from Symbol > Component chain
  const symbolEl = firstChild(accessEl, "Symbol");
  if (!symbolEl) return { symbol: `[uid:${attr(accessEl, "UId")}]` };

  const components = childrenByTag(symbolEl, "Component");
  const parts: string[] = [];

  for (const comp of components) {
    const name = attr(comp, "Name");
    const modifier = attr(comp, "AccessModifier");

    if (modifier === "Array") {
      // Array index is nested Access child
      const indexAccess = firstChild(comp, "Access");
      if (indexAccess) {
        const idx = resolveSymbol(indexAccess);
        parts.push(`${name}[${idx.symbol}]`);
      } else {
        parts.push(name);
      }
    } else {
      parts.push(name);
    }
  }

  // Use # prefix for local scope
  const prefix = scope === "LocalVariable" ? "#" : "";
  return { symbol: `${prefix}${parts.join(".")}` };
}

function parseAccesses(partsEl: Element): Map<string, AccessNode> {
  const map = new Map<string, AccessNode>();

  for (const el of childrenByTag(partsEl, "Access")) {
    const uid = attr(el, "UId");
    const scope = attr(el, "Scope");
    const { symbol, dataType, constantValue } = resolveSymbol(el);
    map.set(uid, { uid, scope, symbol, dataType, constantValue });
  }

  return map;
}

function parseParts(partsEl: Element): Map<string, PartNode> {
  const map = new Map<string, PartNode>();

  // Regular Part elements
  for (const el of childrenByTag(partsEl, "Part")) {
    const uid = attr(el, "UId");
    const name = attr(el, "Name");

    const negated = new Set<string>();
    for (const neg of childrenByTag(el, "Negated")) {
      negated.add(attr(neg, "Name"));
    }

    const templateValues = new Map<string, string>();
    for (const tv of childrenByTag(el, "TemplateValue")) {
      templateValues.set(attr(tv, "Name"), tv.textContent ?? "");
    }

    map.set(uid, {
      uid,
      name,
      negated,
      templateValues,
      disabledENO: attr(el, "DisabledENO") === "true",
    });
  }

  // Call elements (FB/FC calls)
  for (const el of childrenByTag(partsEl, "Call")) {
    const uid = attr(el, "UId");
    const callInfoEl = firstChild(el, "CallInfo");
    if (!callInfoEl) continue;

    const blockName = attr(callInfoEl, "Name");
    const blockType = attr(callInfoEl, "BlockType");

    // Instance DB
    let instanceDb: string | undefined;
    const instanceEl = firstChild(callInfoEl, "Instance");
    if (instanceEl) {
      const { symbol } = resolveSymbol(instanceEl);
      instanceDb = symbol;
    }

    // Parameters
    const parameters: FbCallParam[] = [];
    for (const paramEl of childrenByTag(callInfoEl, "Parameter")) {
      const pName = attr(paramEl, "Name");
      const section = attr(paramEl, "Section").toLowerCase();
      const pType = attr(paramEl, "Type");
      const direction: "in" | "out" | "inout" =
        section === "output" ? "out" : section === "inout" ? "inout" : "in";
      parameters.push({ name: pName, direction, value: "", dataType: pType });
    }

    map.set(uid, {
      uid,
      name: "Call",
      negated: new Set(),
      templateValues: new Map(),
      callInfo: { blockName, blockType, instanceDb, parameters },
      disabledENO: false,
    });
  }

  return map;
}

function parseWires(wiresEl: Element): Wire[] {
  const wires: Wire[] = [];

  for (const w of childrenByTag(wiresEl, "Wire")) {
    const uid = attr(w, "UId");
    const connections: WireConnection[] = [];

    for (const child of Array.from(w.children)) {
      const tag = child.localName;
      if (tag === "Powerrail") {
        connections.push({ type: "powerrail" });
      } else if (tag === "NameCon") {
        connections.push({
          type: "nameCon",
          uid: attr(child, "UId"),
          pin: attr(child, "Name"),
        });
      } else if (tag === "IdentCon") {
        connections.push({
          type: "identCon",
          uid: attr(child, "UId"),
        });
      }
    }

    wires.push({ uid, connections });
  }

  return wires;
}

// ---------------------------------------------------------------------------
// Build adjacency (pin → source mapping)
// ---------------------------------------------------------------------------

/** Map: "partUid:pinName" → source */
function buildPinSources(wires: Wire[]): Map<string, PinSource> {
  const pinMap = new Map<string, PinSource>();

  for (const wire of wires) {
    // A wire has a source (first connection) and targets (remaining connections).
    // Source can be: Powerrail, IdentCon (access), NameCon (part output pin)
    // Targets are NameCon entries pointing to input pins

    const conns = wire.connections;
    if (conns.length < 2) continue;

    // Find the source — it's the powerrail, identCon, or the "out" nameCon
    let source: PinSource | null = null;
    const targets: WireConnection[] = [];

    for (const conn of conns) {
      if (conn.type === "powerrail") {
        source = { kind: "powerrail" };
      } else if (conn.type === "identCon") {
        if (!source) {
          source = { kind: "access", uid: conn.uid! };
        } else {
          // identCon as target — write output to access node
          targets.push(conn);
        }
      } else if (conn.type === "nameCon") {
        // Determine if this is source (output pin) or target (input pin)
        const pin = conn.pin!;
        if (
          pin === "out" ||
          pin.startsWith("out") ||
          pin === "eno"
        ) {
          if (!source) {
            source = { kind: "part", uid: conn.uid!, pin };
          } else {
            targets.push(conn);
          }
        } else {
          targets.push(conn);
        }
      }
    }

    if (!source) continue;

    for (const target of targets) {
      if (target.type === "nameCon") {
        pinMap.set(`${target.uid}:${target.pin}`, source);
      } else if (target.type === "identCon") {
        // Output writing to an access node — store as "accessUid:write"
        pinMap.set(`${target.uid}:write`, source);
      }
    }
  }

  return pinMap;
}

/** Reverse map: what does a part's output pin feed into? */
function buildOutputTargets(wires: Wire[]): Map<string, Array<{ uid: string; pin: string }>> {
  const outMap = new Map<string, Array<{ uid: string; pin: string }>>();

  for (const wire of wires) {
    // Find the source output
    let sourceKey: string | null = null;
    const targets: Array<{ uid: string; pin: string }> = [];

    for (const conn of wire.connections) {
      if (conn.type === "powerrail") {
        sourceKey = "powerrail";
      } else if (conn.type === "nameCon") {
        const pin = conn.pin!;
        if (pin === "out" || pin.startsWith("out") || pin === "eno") {
          sourceKey = `${conn.uid}:${pin}`;
        } else {
          targets.push({ uid: conn.uid!, pin });
        }
      }
    }

    if (sourceKey) {
      const existing = outMap.get(sourceKey) ?? [];
      existing.push(...targets);
      outMap.set(sourceKey, existing);
    }
  }

  return outMap;
}

// ---------------------------------------------------------------------------
// Resolve operands for parts from wire connections
// ---------------------------------------------------------------------------

function resolvePartOperand(
  partUid: string,
  pinName: string,
  pinSources: Map<string, PinSource>,
  accesses: Map<string, AccessNode>,
): string {
  const source = pinSources.get(`${partUid}:${pinName}`);
  if (!source) return "";
  if (source.kind === "access") {
    return accesses.get(source.uid)?.symbol ?? "";
  }
  return "";
}

function resolveOutputOperand(
  partUid: string,
  pinName: string,
  wires: Wire[],
  accesses: Map<string, AccessNode>,
): string {
  // Find the wire where this part:pin is the source, and an identCon is the target
  for (const wire of wires) {
    const hasSource = wire.connections.some(
      (c) => c.type === "nameCon" && c.uid === partUid && c.pin === pinName,
    );
    if (!hasSource) continue;

    for (const conn of wire.connections) {
      if (conn.type === "identCon") {
        return accesses.get(conn.uid!)?.symbol ?? "";
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// CMP operator mapping
// ---------------------------------------------------------------------------

const CMP_OP_MAP: Record<string, LadCmpOperator> = {
  Eq: "==",
  Ne: "!=",
  Gt: ">",
  Lt: "<",
  Ge: ">=",
  Le: "<=",
};

const MATH_OP_MAP: Record<string, LadMathOperator> = {
  Add: "ADD",
  Sub: "SUB",
  Mul: "MUL",
  Div: "DIV",
};

// ---------------------------------------------------------------------------
// Convert Part → LadElement
// ---------------------------------------------------------------------------

function partToElement(
  part: PartNode,
  pinSources: Map<string, PinSource>,
  accesses: Map<string, AccessNode>,
  wires: Wire[],
): LadElement | null {
  const id = `part-${part.uid}`;

  const operand = resolvePartOperand(part.uid, "operand", pinSources, accesses);

  switch (part.name) {
    case "Contact":
    case "PContact":
    case "NContact": {
      const isNegated = part.negated.has("operand");
      const type: LadElementType = isNegated ? "NC_CONTACT" : "NO_CONTACT";
      return { id, type, operand };
    }

    case "Coil":
      return { id, type: "OUTPUT_COIL", operand };

    case "SCoil":
      return { id, type: "SET_COIL", operand };

    case "RCoil":
      return { id, type: "RESET_COIL", operand };

    case "Move": {
      const inVal = resolvePartOperand(part.uid, "in", pinSources, accesses);
      const outVal = resolveOutputOperand(part.uid, "out1", wires, accesses);
      return {
        id,
        type: "MOVE",
        operand: inVal,
        outputOperand: outVal,
      };
    }

    case "Eq":
    case "Ne":
    case "Gt":
    case "Lt":
    case "Ge":
    case "Le": {
      const in1 = resolvePartOperand(part.uid, "in1", pinSources, accesses);
      const in2 = resolvePartOperand(part.uid, "in2", pinSources, accesses);
      const srcType = part.templateValues.get("SrcType") ?? "Int";
      return {
        id,
        type: "CMP",
        operand: in1,
        operand2: in2,
        cmpOperator: CMP_OP_MAP[part.name],
        dataType: srcType,
      };
    }

    case "Add":
    case "Sub":
    case "Mul":
    case "Div": {
      const in1 = resolvePartOperand(part.uid, "in1", pinSources, accesses);
      const in2 = resolvePartOperand(part.uid, "in2", pinSources, accesses);
      const outVal = resolveOutputOperand(part.uid, "out", wires, accesses);
      return {
        id,
        type: "MATH",
        operand: in1,
        operand2: in2,
        outputOperand: outVal,
        mathOperator: MATH_OP_MAP[part.name],
      };
    }

    case "TON":
    case "TOF": {
      const ptVal = resolvePartOperand(part.uid, "PT", pinSources, accesses)
        || resolvePartOperand(part.uid, "pt", pinSources, accesses);
      return {
        id,
        type: part.name as "TON" | "TOF",
        operand: operand || resolvePartOperand(part.uid, "IN", pinSources, accesses),
        presetTime: ptVal,
      };
    }

    case "CTU":
    case "CTD": {
      const pvVal = resolvePartOperand(part.uid, "PV", pinSources, accesses)
        || resolvePartOperand(part.uid, "pv", pinSources, accesses);
      return {
        id,
        type: part.name as "CTU" | "CTD",
        operand: operand || resolvePartOperand(part.uid, "CU", pinSources, accesses)
          || resolvePartOperand(part.uid, "CD", pinSources, accesses),
        presetCount: pvVal ? parseInt(pvVal, 10) : undefined,
      };
    }

    case "Call": {
      if (!part.callInfo) return null;
      const { blockName, blockType, instanceDb, parameters } = part.callInfo;

      // Resolve parameter values from wires
      const resolvedParams = parameters.map((p) => {
        let value: string;
        if (p.direction === "out") {
          value = resolveOutputOperand(part.uid, p.name, wires, accesses);
        } else {
          value = resolvePartOperand(part.uid, p.name, pinSources, accesses);
        }
        return { ...p, value };
      });

      return {
        id,
        type: "FB_CALL",
        operand: blockName,
        fbName: blockName,
        fbInstanceDb: instanceDb,
        callParams: resolvedParams,
        comment: blockType === "FC" ? "FC call" : undefined,
      };
    }

    default:
      // Unknown part — represent as a contact with the part name as comment
      return { id, type: "NO_CONTACT", operand: `[${part.name}]`, comment: `Unsupported: ${part.name}` };
  }
}

// ---------------------------------------------------------------------------
// Reconstruct logic tree from wire graph
// ---------------------------------------------------------------------------

/** Find all part UIDs that receive power directly from the powerrail */
function findPowerrailTargets(wires: Wire[]): Array<{ uid: string; pin: string }> {
  const targets: Array<{ uid: string; pin: string }> = [];
  for (const wire of wires) {
    const hasPowerrail = wire.connections.some((c) => c.type === "powerrail");
    if (!hasPowerrail) continue;
    for (const conn of wire.connections) {
      if (conn.type === "nameCon") {
        targets.push({ uid: conn.uid!, pin: conn.pin! });
      }
    }
  }
  return targets;
}

/** Trace a chain from a starting part through series connections */
function traceChain(
  startUid: string,
  parts: Map<string, PartNode>,
  accesses: Map<string, AccessNode>,
  pinSources: Map<string, PinSource>,
  outputTargets: Map<string, Array<{ uid: string; pin: string }>>,
  wires: Wire[],
  visited: Set<string>,
): LadNode[] {
  const nodes: LadNode[] = [];
  let currentUid: string | null = startUid;

  while (currentUid && !visited.has(currentUid)) {
    visited.add(currentUid);
    const part = parts.get(currentUid);
    if (!part) break;

    // Handle OR gate — this creates a parallel branch
    if (part.name === "O") {
      const card = parseInt(part.templateValues.get("Card") ?? "2", 10);
      const branches: LadSeriesChain[] = [];

      for (let i = 1; i <= card; i++) {
        const pinKey = `${part.uid}:in${i}`;
        const source = pinSources.get(pinKey);
        if (!source) continue;

        if (source.kind === "part") {
          // Trace back from this source part
          const branchNodes = traceBackChain(
            source.uid,
            parts,
            accesses,
            pinSources,
            outputTargets,
            wires,
            new Set(visited),
          );
          branches.push({ type: "series", nodes: branchNodes });
        }
      }

      if (branches.length > 0) {
        nodes.push({
          type: "parallel",
          id: `par-${part.uid}`,
          branches,
        });
      }

      // Continue from O's output
      const outTargets = outputTargets.get(`${part.uid}:out`);
      currentUid = outTargets?.[0]?.uid ?? null;
      continue;
    }

    // Regular element — convert part to LadElement
    const element = partToElement(part, pinSources, accesses, wires);
    if (element) {
      nodes.push({ type: "element", element });
    }

    // Follow the "out" pin to the next part
    const outTargets = outputTargets.get(`${part.uid}:out`);
    if (outTargets && outTargets.length === 1) {
      currentUid = outTargets[0].uid;
    } else if (outTargets && outTargets.length > 1) {
      // Multiple targets from one output — this means the output fans out
      // (e.g., contact output goes to both a coil and another branch)
      // Take the first target that's a non-coil first, then coils
      const nextParts = outTargets
        .map((t) => ({ ...t, part: parts.get(t.uid) }))
        .filter((t) => t.part);

      // If all targets receive on "in" pin, follow the chain normally
      // (multiple outputs like coil + coil handled as separate branches from upstream)
      currentUid = nextParts[0]?.uid ?? null;
    } else {
      currentUid = null;
    }
  }

  return nodes;
}

/** Trace backwards from a part to find its series chain up to the powerrail */
function traceBackChain(
  endUid: string,
  parts: Map<string, PartNode>,
  accesses: Map<string, AccessNode>,
  pinSources: Map<string, PinSource>,
  _outputTargets: Map<string, Array<{ uid: string; pin: string }>>,
  wires: Wire[],
  visited: Set<string>,
): LadNode[] {
  // Walk backwards from endUid collecting the series chain
  const chain: LadNode[] = [];
  let currentUid: string | null = endUid;

  while (currentUid) {
    if (visited.has(currentUid)) break;
    visited.add(currentUid);

    const part = parts.get(currentUid);
    if (!part) break;

    const element = partToElement(part, pinSources, accesses, wires);
    if (element) {
      chain.unshift({ type: "element", element });
    }

    // Find what feeds this part's "in" pin
    const source = pinSources.get(`${currentUid}:in`);
    if (!source || source.kind === "powerrail") break;
    if (source.kind === "part") {
      currentUid = source.uid;
    } else {
      break;
    }
  }

  return chain;
}

/** Build rung logic from a single network's FlgNet */
function buildRungLogic(
  parts: Map<string, PartNode>,
  accesses: Map<string, AccessNode>,
  wires: Wire[],
): LadSeriesChain {
  const pinSources = buildPinSources(wires);
  const outputTargets = buildOutputTargets(wires);

  // Find powerrail targets — these are the entry points
  const prTargets = findPowerrailTargets(wires);
  if (prTargets.length === 0) {
    return { type: "series", nodes: [] };
  }

  // Group powerrail targets by their "in" pin targets
  // All targets receiving on "in" pin are parallel entry points that converge later
  const inTargets = prTargets.filter((t) => t.pin === "in" || t.pin === "en" || t.pin === "pre");

  if (inTargets.length === 0) {
    return { type: "series", nodes: [] };
  }

  // If there's only one entry, trace forward
  if (inTargets.length === 1) {
    const visited = new Set<string>();
    const nodes = traceChain(
      inTargets[0].uid,
      parts,
      accesses,
      pinSources,
      outputTargets,
      wires,
      visited,
    );
    return { type: "series", nodes };
  }

  // Multiple powerrail targets — these form independent sub-rungs within the network
  // Each is traced as a separate series chain
  // If they converge (via O gate), the traceChain handles that
  // Otherwise, they're effectively separate rungs packed into one network
  const allNodes: LadNode[] = [];
  const visited = new Set<string>();

  for (const target of inTargets) {
    if (visited.has(target.uid)) continue;
    const nodes = traceChain(
      target.uid,
      parts,
      accesses,
      pinSources,
      outputTargets,
      wires,
      visited,
    );
    allNodes.push(...nodes);
  }

  return { type: "series", nodes: allNodes };
}

// ---------------------------------------------------------------------------
// Parse interface variables
// ---------------------------------------------------------------------------

function parseInterface(interfaceEl: Element): LadVariable[] {
  const vars: LadVariable[] = [];

  // The Sections element may have a namespace
  const sectionsEl =
    interfaceEl.querySelector("Sections") ??
    interfaceEl.getElementsByTagNameNS(
      "http://www.siemens.com/automation/Openness/SW/Interface/v5",
      "Sections",
    )[0];

  if (!sectionsEl) return vars;

  const sectionMap: Record<string, LadVariable["section"]> = {
    Input: "Input",
    Output: "Output",
    InOut: "InOut",
    Static: "Static",
    Temp: "Temp",
  };

  for (const section of Array.from(sectionsEl.children)) {
    const sectionName = attr(section, "Name");
    const mappedSection = sectionMap[sectionName];
    if (!mappedSection) continue;

    for (const member of childrenByTag(section, "Member")) {
      const name = attr(member, "Name");
      const dataType = attr(member, "Datatype") || attr(member, "Remanence") || "Void";
      if (name === "Ret_Val" && dataType === "Void") continue; // Skip FC return
      vars.push({ name, dataType, section: mappedSection });
    }
  }

  return vars;
}

// ---------------------------------------------------------------------------
// Parse network title from CompileUnit
// ---------------------------------------------------------------------------

function parseNetworkTitle(compileUnit: Element): string {
  const titles = compileUnit.querySelectorAll(
    'MultilingualText[CompositionName="Title"] MultilingualTextItem',
  );
  for (const item of Array.from(titles)) {
    const culture = item.querySelector("Culture")?.textContent ?? "";
    if (culture === "en-US" || culture.startsWith("en")) {
      return item.querySelector("Text")?.textContent ?? "";
    }
  }
  // Fallback to first title
  if (titles.length > 0) {
    return titles[0].querySelector("Text")?.textContent ?? "";
  }
  return "";
}

function parseNetworkComment(compileUnit: Element): string | undefined {
  const comments = compileUnit.querySelectorAll(
    'MultilingualText[CompositionName="Comment"] MultilingualTextItem',
  );
  for (const item of Array.from(comments)) {
    const culture = item.querySelector("Culture")?.textContent ?? "";
    if (culture === "en-US" || culture.startsWith("en")) {
      const text = item.querySelector("Text")?.textContent ?? "";
      return text || undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a SimaticML block XML export into a LadProgram.
 * Accepts the full XML document as exported by TIA Portal Openness.
 */
export function parseLadXml(xml: string): LadProgram {
  const doc = parseXmlDoc(xml);

  // Find the block element (SW.Blocks.FB, SW.Blocks.FC, SW.Blocks.OB)
  const blockEl =
    doc.querySelector("SW\\.Blocks\\.FB") ??
    doc.querySelector("SW\\.Blocks\\.FC") ??
    doc.querySelector("SW\\.Blocks\\.OB");

  if (!blockEl) {
    throw new Error("No SW.Blocks.FB/FC/OB element found in XML");
  }

  const blockTag = blockEl.tagName;
  const blockType: "FB" | "FC" | "OB" = blockTag.includes("FB")
    ? "FB"
    : blockTag.includes("OB")
      ? "OB"
      : "FC";

  // Block metadata
  const attrList = firstChild(blockEl, "AttributeList");
  const name = attrList?.querySelector("Name")?.textContent ?? "Unknown";
  const numberStr = attrList?.querySelector("Number")?.textContent;
  const blockNumber = numberStr ? parseInt(numberStr, 10) : undefined;

  // Parse interface
  const interfaceEl = attrList?.querySelector("Interface");
  const variables = interfaceEl ? parseInterface(interfaceEl) : [];

  // Parse networks (CompileUnits)
  const objectList = firstChild(blockEl, "ObjectList");
  const compileUnits = objectList
    ? Array.from(objectList.children).filter(
        (el) =>
          el.tagName === "SW.Blocks.CompileUnit" &&
          attr(el, "CompositionName") === "CompileUnits",
      )
    : [];

  const rungs: LadRung[] = [];

  for (let i = 0; i < compileUnits.length; i++) {
    const cu = compileUnits[i];
    const cuAttrList = firstChild(cu, "AttributeList");
    if (!cuAttrList) continue;

    // Check if this network is LAD
    const lang = cuAttrList.querySelector("ProgrammingLanguage")?.textContent;
    if (lang && lang !== "LAD") continue;

    // Parse FlgNet
    const networkSourceEl = cuAttrList.querySelector("NetworkSource");
    if (!networkSourceEl) continue;

    const flgNet =
      networkSourceEl.querySelector("FlgNet") ??
      networkSourceEl.getElementsByTagNameNS(
        "http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v4",
        "FlgNet",
      )[0];

    if (!flgNet) continue;

    const partsEl = firstChild(flgNet, "Parts");
    const wiresEl = firstChild(flgNet, "Wires");
    if (!partsEl || !wiresEl) continue;

    const accesses = parseAccesses(partsEl);
    const partNodes = parseParts(partsEl);
    const wires = parseWires(wiresEl);

    const title = parseNetworkTitle(cu) || `Network ${i + 1}`;
    const comment = parseNetworkComment(cu);

    const logic = buildRungLogic(partNodes, accesses, wires);

    rungs.push({
      id: `rung-${i + 1}`,
      title,
      comment,
      logic,
    });
  }

  return {
    id: `parsed-${name}`,
    name,
    blockType,
    blockNumber,
    variables,
    rungs,
  };
}

/**
 * Quick check: does this XML contain LAD networks?
 */
export function isLadXml(xml: string): boolean {
  return xml.includes("ProgrammingLanguage>LAD<") || xml.includes('ProgrammingLanguage="LAD"');
}

/**
 * Extract block metadata without full parse (fast).
 */
export function extractBlockInfo(xml: string): {
  name: string;
  blockType: string;
  language: string;
  networkCount: number;
} {
  const doc = parseXmlDoc(xml);

  const blockEl =
    doc.querySelector("SW\\.Blocks\\.FB") ??
    doc.querySelector("SW\\.Blocks\\.FC") ??
    doc.querySelector("SW\\.Blocks\\.OB") ??
    doc.querySelector("SW\\.Blocks\\.DB");

  const attrList = blockEl ? firstChild(blockEl, "AttributeList") : null;
  const name = attrList?.querySelector("Name")?.textContent ?? "Unknown";
  const language =
    attrList?.querySelector("ProgrammingLanguage")?.textContent ?? "Unknown";

  const blockTag = blockEl?.tagName ?? "";
  const blockType = blockTag.includes("FB")
    ? "FB"
    : blockTag.includes("OB")
      ? "OB"
      : blockTag.includes("DB")
        ? "DB"
        : "FC";

  const compileUnits = doc.querySelectorAll("SW\\.Blocks\\.CompileUnit");
  const networkCount = compileUnits.length;

  return { name, blockType, language, networkCount };
}
