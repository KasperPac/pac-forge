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
    case "FB_CALL":
      return el.fbName ?? el.operand;
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
  /** Additional elements that need powerrail connection (e.g. NC Contacts for negated FB params) */
  extraPowerrailTargets?: Array<{ uid: number; pin: string }>;
}

// ---------------------------------------------------------------------------
// Access node builders
// ---------------------------------------------------------------------------

function buildAccessNode(uid: number, operand: string, scope?: string): string {
  // Strip leading # (local var marker)
  const noHash = operand.replace(/^#/, "");
  // Determine scope: explicit override → #-prefixed → GlobalVariable (IO tags, global DBs)
  const resolvedScope = scope ?? (operand.startsWith("#") ? "LocalVariable" : "GlobalVariable");
  // Strip ALL quote characters
  const stripped = noHash.replace(/"/g, "");
  const parts = stripped.split(".");
  const components = parts.map((p) => {
    // Handle array access: S[90] → <Component Name="S" AccessModifier="Array"><Access>...</Access></Component>
    // Matches TIA Portal's export format exactly
    const arrMatch = p.match(/^(\w+)\[(\d+)\]$/);
    if (arrMatch) {
      return `              <Component Name="${esc(arrMatch[1])}" AccessModifier="Array">
                <Access Scope="LiteralConstant">
                  <Constant>
                    <ConstantType>DInt</ConstantType>
                    <ConstantValue>${arrMatch[2]}</ConstantValue>
                  </Constant>
                </Access>
              </Component>`;
    }
    // Skip empty component names (from leading dots or double dots)
    if (!p.trim()) return null;
    return `              <Component Name="${esc(p)}" />`;
  }).filter(Boolean).join("\n");
  return `          <Access Scope="${resolvedScope}" UId="${uid}">
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
    const instName = el.operand;

    // Determine scope: if instanceDb is set AND differs from operand, the timer
    // lives in a global DB (FC calling pattern). Otherwise it's a local static
    // variable in an FB.
    const isGlobalDb = el.instanceDb && el.instanceDb !== el.operand;

    let instanceXml: string;
    if (isGlobalDb) {
      // Global DB instance: "DbName".instTimerName — split into DB + member components
      // The operand is the full path like "DB_Name".instStepTimer_30
      const dbName = el.instanceDb!;
      // Extract just the timer instance name (strip DB prefix if present)
      const memberName = instName.startsWith(`"${dbName}".`)
        ? instName.slice(dbName.length + 3)
        : instName.replace(/^"[^"]+"\./,"");

      instanceXml = `          <Part Name="${partName}" Version="1.0" UId="${partUid}">
            <Instance Scope="GlobalVariable" UId="${instUid}">
              <Component Name="${esc(dbName)}" />
              <Component Name="${esc(memberName)}" />
            </Instance>
            <TemplateValue Name="time_type" Type="Type">Time</TemplateValue>
          </Part>`;
    } else {
      // Local static variable (FB context)
      instanceXml = `          <Part Name="${partName}" Version="1.0" UId="${partUid}">
            <Instance Scope="LocalVariable" UId="${instUid}">
              <Component Name="${esc(instName)}" />
            </Instance>
            <TemplateValue Name="time_type" Type="Type">Time</TemplateValue>
          </Part>`;
    }
    parts.push({ uid: partUid, isAccess: false, xml: instanceXml });

    // PT (preset time) — TypedConstant for time literals
    // AI may use "pt" instead of "presetTime"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ptValue = el.presetTime ?? (el as any).pt ?? "T#1s";
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

    // ET output — TIA requires this pin to be connected.
    // Wire to an open connection if no target is specified.
    const etWireUid = counter.next();
    if (el.operand2) {
      const etUid = counter.next();
      parts.push({ uid: etUid, isAccess: true, xml: buildAccessNode(etUid, el.operand2) });
      wires.push({
        uid: etWireUid,
        xml: `          <Wire UId="${etWireUid}">
            <NameCon UId="${partUid}" Name="ET" />
            <IdentCon UId="${etUid}" />
          </Wire>`,
      });
    } else {
      // Open connection — ET not used but must be wired
      wires.push({
        uid: etWireUid,
        xml: `          <Wire UId="${etWireUid}">
            <NameCon UId="${partUid}" Name="ET" />
            <OpenCon UId="${counter.next()}" />
          </Wire>`,
      });
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

  // ── FB Call ───────────────────────────────────────────────────────────────
  // Generates a Call block with CallInfo + Instance + Parameter declarations.
  // Confirmed from TIA V18 export — FB calls use <Call> + <CallInfo>, NOT <Part>.
  //
  // SimaticML structure (from real TIA export):
  //   <Call UId="X">
  //     <CallInfo Name="FBName" BlockType="FB">
  //       <Instance Scope="GlobalVariable" UId="Y">
  //         <Component Name="InstanceDbName" />
  //       </Instance>
  //       <Parameter Name="paramName" Section="Input" Type="Bool" />
  //       ...
  //     </CallInfo>
  //   </Call>
  //   + Access nodes for connected param values
  //   + Wires: connected params use IdentCon, unconnected use OpenCon
  if (el.type === "FB_CALL") {
    const fbName = el.fbName ?? el.operand;
    const instDbName = el.fbInstanceDb ?? el.instanceDb ?? fbName;
    const params = el.callParams ?? [];

    // Map direction to SimaticML Section name
    const sectionName = (dir: string) => {
      if (dir === "in") return "Input";
      if (dir === "out") return "Output";
      return "InOut";
    };

    // Build Parameter declarations
    const paramDecls = params
      .map(p => `            <Parameter Name="${esc(p.name)}" Section="${sectionName(p.direction)}" Type="${esc(p.dataType ?? "Variant")}" />`)
      .join("\n");

    // Instance + CallInfo
    const instUid = counter.next();
    const callXml = `          <Call UId="${partUid}">
            <CallInfo Name="${esc(fbName)}" BlockType="FB">
              <Instance Scope="GlobalVariable" UId="${instUid}">
                <Component Name="${esc(instDbName)}" />
              </Instance>
${paramDecls}
            </CallInfo>
          </Call>`;
    parts.push({ uid: partUid, isAccess: false, xml: callXml });

    // Track NC Contact UIDs for negated params — they need powerrail fan connections
    const ncContactUids: number[] = [];

    // Wire each parameter — connected params get Access + IdentCon, unconnected get OpenCon
    for (const param of params) {
      const value = param.value?.trim();
      const hasValue = value && value !== "" && value !== "-";

      if (hasValue) {
        // Connected parameter — create Access node + wire with IdentCon
        const accessUid = counter.next();

        // Detect literals vs tag references
        const isTimeLiteral = /^T#/i.test(value);
        const isNumLiteral = /^-?\d+(\.\d+)?$/.test(value);
        const isBoolLiteral = /^(true|false)$/i.test(value);

        if (isTimeLiteral) {
          parts.push({ uid: accessUid, isAccess: true, xml: buildTypedConstantAccess(accessUid, value) });
        } else if (isNumLiteral) {
          parts.push({ uid: accessUid, isAccess: true, xml: buildLiteralAccess(accessUid, value, param.dataType ?? "Int") });
        } else if (isBoolLiteral) {
          parts.push({ uid: accessUid, isAccess: true, xml: buildLiteralAccess(accessUid, value.toLowerCase(), "Bool") });
        } else {
          parts.push({ uid: accessUid, isAccess: true, xml: buildAccessNode(accessUid, value) });
        }

        if (param.negated && (param.direction === "in" || param.direction === "inout")) {
          // Negated input: NC (normally closed) Contact wired inline.
          // Pattern from TIA V18 export:
          //   Powerrail → Contact.in (added to powerrail fan)
          //   Access → Contact.operand
          //   Contact.out → FB.paramName
          const ncPartUid = counter.next();
          parts.push({
            uid: ncPartUid,
            isAccess: false,
            xml: `          <Part Name="Contact" UId="${ncPartUid}">
            <Negated Name="operand" />
          </Part>`,
          });
          // Track this NC Contact for powerrail fan (collected after loop)
          ncContactUids.push(ncPartUid);
          // Wire: Access → NC Contact operand
          const wire1Uid = counter.next();
          wires.push({
            uid: wire1Uid,
            xml: `          <Wire UId="${wire1Uid}">
            <IdentCon UId="${accessUid}" />
            <NameCon UId="${ncPartUid}" Name="operand" />
          </Wire>`,
          });
          // Wire: NC Contact out → FB.param
          const wire2Uid = counter.next();
          wires.push({
            uid: wire2Uid,
            xml: `          <Wire UId="${wire2Uid}">
            <NameCon UId="${ncPartUid}" Name="out" />
            <NameCon UId="${partUid}" Name="${esc(param.name)}" />
          </Wire>`,
          });
        } else if (param.direction === "in" || param.direction === "inout") {
          const wireUid = counter.next();
          wires.push({
            uid: wireUid,
            xml: `          <Wire UId="${wireUid}">
            <IdentCon UId="${accessUid}" />
            <NameCon UId="${partUid}" Name="${esc(param.name)}" />
          </Wire>`,
          });
        } else {
          const wireUid = counter.next();
          wires.push({
            uid: wireUid,
            xml: `          <Wire UId="${wireUid}">
            <NameCon UId="${partUid}" Name="${esc(param.name)}" />
            <IdentCon UId="${accessUid}" />
          </Wire>`,
          });
        }
      } else {
        // Unconnected parameter — wire with OpenCon
        const openUid = counter.next();
        const wireUid = counter.next();
        if (param.direction === "in" || param.direction === "inout") {
          wires.push({
            uid: wireUid,
            xml: `          <Wire UId="${wireUid}">
            <OpenCon UId="${openUid}" />
            <NameCon UId="${partUid}" Name="${esc(param.name)}" />
          </Wire>`,
          });
        } else {
          wires.push({
            uid: wireUid,
            xml: `          <Wire UId="${wireUid}">
            <NameCon UId="${partUid}" Name="${esc(param.name)}" />
            <OpenCon UId="${openUid}" />
          </Wire>`,
          });
        }
      }
    }

    return {
      inUid: partUid, inPin: "en", outUid: partUid, outPin: "eno",
      // NC Contact UIDs need powerrail connection (their "in" pin)
      extraPowerrailTargets: ncContactUids.map(uid => ({ uid, pin: "in" })),
    };
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
// NEW ARCHITECTURE: Two-pass wiring
//
// TIA Portal wires the Powerrail to EVERY first contact across ALL nesting
// levels in a single flat <Wire>. It does NOT route through O-Parts or
// intermediate elements. Our old approach used "extraIns" propagation which
// broke for nested parallels.
//
// New approach:
// Pass 1 (processChain/processParallel/processNode): Generate Parts, wire
//   branch outputs → O-Part inputs, wire series element-to-element. Collect
//   ALL leaf-level powerrail targets in a flat array.
// Pass 2 (buildRungPartsAndWires): Create a single Powerrail wire that fans
//   to every collected entry point.
// ---------------------------------------------------------------------------

/** Extended result that collects ALL powerrail targets recursively */
interface ChainResult2 {
  /** UID of the first element (for upstream wiring in series) */
  inUid: number;
  /** Pin name of first element's input */
  inPin: string;
  /** UID of the last element (for downstream wiring in series) */
  outUid: number;
  /** Pin name of last element's output */
  outPin: string;
  /** ALL entry contacts that need powerrail connection — flat across all nesting */
  powerrailTargets: Array<{ uid: number; pin: string }>;
}

function processParallel2(
  node: LadNode & { type: "parallel" },
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult2 {
  const branches = node.branches ?? [];
  const N = branches.length;
  if (N === 0) return { inUid: -1, inPin: "in", outUid: -1, outPin: "out", powerrailTargets: [] };
  if (N === 1) return processChain2(branches[0], counter, parts, wires);

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
  // Collect ALL powerrail targets from all branches (flat)
  const allPowerrailTargets: Array<{ uid: number; pin: string }> = [];

  for (let i = 0; i < branches.length; i++) {
    const br = processChain2(branches[i], counter, parts, wires);

    // Collect powerrail targets from this branch (recursive — includes nested parallels)
    allPowerrailTargets.push(...br.powerrailTargets);

    // Wire branch output → O-Part input
    if (br.outUid >= 0) {
      const w = counter.next();
      wires.push({
        uid: w,
        xml: `          <Wire UId="${w}">
            <NameCon UId="${br.outUid}" Name="${br.outPin}" />
            <NameCon UId="${oUid}" Name="in${i + 1}" />
          </Wire>`,
      });
    }
  }

  return {
    inUid: allPowerrailTargets[0]?.uid ?? -1,
    inPin: allPowerrailTargets[0]?.pin ?? "in",
    outUid: oUid,
    outPin: "out",
    powerrailTargets: allPowerrailTargets,
  };
}

function processNode2(
  node: LadNode,
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult2 {
  if (node.type === "element") {
    const r = processElement(node.element, counter, parts, wires);
    // Include any extra powerrail targets from NC Contacts in FB calls
    const extraTargets = (r as { extraPowerrailTargets?: Array<{ uid: number; pin: string }> }).extraPowerrailTargets ?? [];
    return {
      ...r,
      powerrailTargets: [{ uid: r.inUid, pin: r.inPin }, ...extraTargets],
    };
  }
  return processParallel2(node, counter, parts, wires);
}

function processChain2(
  chain: LadSeriesChain,
  counter: UidCounter,
  parts: PartEntry[],
  wires: WireEntry[],
): ChainResult2 {
  // Guard: bare element or parallel passed as a "branch"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = chain as any;
  if (raw.type === "element") {
    const r = processElement(raw.element, counter, parts, wires);
    return { ...r, powerrailTargets: [{ uid: r.inUid, pin: r.inPin }] };
  }
  if (raw.type === "parallel") {
    return processParallel2(raw, counter, parts, wires);
  }

  const nodes = chain.nodes ?? [];
  if (nodes.length === 0) {
    return { inUid: -1, inPin: "in", outUid: -1, outPin: "out", powerrailTargets: [] };
  }

  let prevOutUid = -1;
  let prevOutPin = "";
  let firstPowerrailTargets: Array<{ uid: number; pin: string }> = [];

  for (let i = 0; i < nodes.length; i++) {
    const nodeResult = processNode2(nodes[i], counter, parts, wires);

    if (i === 0) {
      // First node: its powerrail targets become the chain's powerrail targets
      firstPowerrailTargets = nodeResult.powerrailTargets;
    } else {
      // Subsequent nodes: wire previous output → this node's powerrail targets
      // This handles the case where a parallel is not the first element in a chain —
      // the upstream contact's output fans to ALL branch entry contacts.
      const targets = nodeResult.powerrailTargets;
      if (targets.length > 0 && prevOutUid >= 0) {
        const targetsXml = targets
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
    }

    prevOutUid = nodeResult.outUid;
    prevOutPin = nodeResult.outPin;
  }

  return {
    inUid: firstPowerrailTargets[0]?.uid ?? -1,
    inPin: firstPowerrailTargets[0]?.pin ?? "in",
    outUid: prevOutUid,
    outPin: prevOutPin,
    powerrailTargets: firstPowerrailTargets,
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

  // Normalize: if rung.logic is a parallel (not a series chain), wrap it
  const logic: LadSeriesChain = rung.logic?.type === "series"
    ? rung.logic
    : { type: "series", nodes: [rung.logic as unknown as LadNode] };
  const result = processChain2(logic, counter, parts, wires);

  // Single Powerrail wire fans to ALL entry contacts — flat across all nesting levels
  // This matches TIA Portal's export format exactly.
  const targets = result.powerrailTargets.filter(t => t.uid >= 0);
  if (targets.length > 0) {
    const targetsXml = targets
      .map((t) => `\n            <NameCon UId="${t.uid}" Name="${t.pin}" />`)
      .join("");
    const railWireUid = counter.next();
    wires.push({
      uid: railWireUid,
      xml: `          <Wire UId="${railWireUid}">
            <Powerrail />${targetsXml}
          </Wire>`,
    });
  }

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
export function buildLadXml(program: LadProgram, tiaVersion: string = "V20"): string {
  const counter = new UidCounter();

  // Auto-upgrade FC → FB if the program has static variables (timers, step bits, latches).
  // FCs cannot have static state — they lose data every scan cycle.
  let effectiveBlockType = program.blockType;
  if (effectiveBlockType === "FC" && program.variables.some(v => v.section === "Static")) {
    effectiveBlockType = "FB";
  }

  const blockElement =
    effectiveBlockType === "FC"
      ? "SW.Blocks.FC"
      : effectiveBlockType === "OB"
        ? "SW.Blocks.OB"
        : "SW.Blocks.FB";

  const interfaceXml = buildInterface(program.variables, effectiveBlockType);

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
