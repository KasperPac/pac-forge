/**
 * Parses SimaticML LAD/FBD XML exports to extract Part Names and their pin definitions.
 * Used to verify instruction pin names against actual TIA Portal exports.
 */

export interface XmlInstructionDef {
  partName: string;
  pins: Map<string, XmlPinInfo>;
}

export interface XmlPinInfo {
  name: string;
  /** Inferred direction based on wire position */
  direction: "in" | "out" | "unknown";
  /** True if connected to Powerrail or carries rung flow */
  isRungFlow: boolean;
}

/**
 * Parse a SimaticML XML string and extract all Part Names with their pin connections.
 * Builds a map of Part Name → set of pin names from NameCon elements in Wires.
 */
export function parseInstructionXml(xmlString: string): Map<string, XmlInstructionDef> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  // Collect all Part elements: <Part Name="Contact" UId="35" />
  const partElements = doc.querySelectorAll("Part");
  const partMap = new Map<number, string>(); // UId → Part Name
  for (const part of partElements) {
    const name = part.getAttribute("Name");
    const uid = part.getAttribute("UId");
    if (name && uid) {
      partMap.set(parseInt(uid, 10), name);
    }
  }

  // Collect all Call elements (FB calls): <Call UId="X"><CallInfo Name="FBName" .../>
  // These use Part Name "Call" conceptually
  const callElements = doc.querySelectorAll("Call");
  for (const call of callElements) {
    const uid = call.getAttribute("UId");
    if (uid) {
      partMap.set(parseInt(uid, 10), "Call");
    }
  }

  // Build instruction definitions from Wires
  // Each Wire has child NameCon elements: <NameCon UId="X" Name="pin"/>
  // The UId references a Part, and Name is the pin name
  const instructions = new Map<string, XmlInstructionDef>();

  const wireElements = doc.querySelectorAll("Wire");
  for (const wire of wireElements) {
    const children = Array.from(wire.children);
    const hasPowerrail = children.some((c) => c.tagName === "Powerrail");

    const nameCons = children.filter((c) => c.tagName === "NameCon");

    for (let i = 0; i < nameCons.length; i++) {
      const nc = nameCons[i];
      const uid = parseInt(nc.getAttribute("UId") ?? "0", 10);
      const pinName = nc.getAttribute("Name");
      if (!pinName || !uid) continue;

      const partName = partMap.get(uid);
      if (!partName) continue;

      // Skip OR gates — internal structural element, not an instruction
      if (partName === "O") continue;

      if (!instructions.has(partName)) {
        instructions.set(partName, { partName, pins: new Map() });
      }
      const def = instructions.get(partName)!;

      // Determine direction:
      // - If this NameCon is the FIRST element in the wire (or after Powerrail), it's a source → output pin
      // - If it's a subsequent element, it's a target → input pin
      const indexInWire = children.indexOf(nc);
      const isSource = indexInWire === 0 || (hasPowerrail && indexInWire === 1);

      // Determine rung flow:
      // - Connected to Powerrail → rung flow input
      // - Connects to/from another Part's rung flow pin → likely rung flow
      const isRungFlow = hasPowerrail && !isSource
        ? true  // Powerrail feeds into this pin → rung flow input
        : false; // Conservative — we'll refine below

      const existing = def.pins.get(pinName);
      if (!existing) {
        def.pins.set(pinName, {
          name: pinName,
          direction: isSource ? "out" : "in",
          isRungFlow,
        });
      } else {
        // If we see it as both source and target, it might be inout
        // But more commonly, the same pin appears in different wires with consistent direction
        if (isSource && existing.direction === "in") {
          existing.direction = "out"; // Prefer output if seen as source
        }
        if (isRungFlow) {
          existing.isRungFlow = true;
        }
      }
    }
  }

  // Post-process: mark common rung flow pins
  for (const def of instructions.values()) {
    for (const pin of def.pins.values()) {
      const n = pin.name.toLowerCase();
      // Known rung flow pin names
      if (
        n === "in" || n === "out" || n === "en" || n === "eno" ||
        n === "pre" || n === "q"
      ) {
        // Only mark as rung flow if it's BOOL-typed (we don't have type info from XML,
        // but these names are reliably rung flow)
        pin.isRungFlow = true;
      }
    }
  }

  return instructions;
}

/**
 * Summary of what an XML upload would update.
 */
export interface XmlVerifyResult {
  /** Part Names found in the XML */
  found: Array<{
    partName: string;
    pins: string[];
    matchedInstructionId?: string;
    matchedInstructionName?: string;
    currentPins?: string[];
    pinsChanged: boolean;
  }>;
  /** Part Names not matched to any existing instruction */
  unmatched: Array<{ partName: string; pins: string[] }>;
}
