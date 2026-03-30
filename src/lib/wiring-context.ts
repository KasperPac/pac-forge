/**
 * wiring-context.ts
 *
 * Derives a human-readable "Wiring Context Map" from the ProcessLinkageMatrix
 * and IO list. This text is injected into code generation prompts so the agent
 * understands the full signal path from physical IO through FBs to outputs.
 *
 * The map shows:
 * - For each device: FB name, instance DB, all parameter wiring with traced paths
 * - Cross-device references (which device's output feeds which device's input)
 * - Physical IO addresses and descriptions for IO-connected wires
 * - Interlocks and dependencies between devices
 */

import type { ProcessLinkageMatrix, LinkageDevice, FbWire, LinkageInterlock } from "@/types/forge-matrix";
import type { ForgeIoEntry } from "@/types/forge";

// ---------------------------------------------------------------------------
// IO lookup helpers
// ---------------------------------------------------------------------------

interface IoLookup {
  /** Map: tag_name (lowercase) → ForgeIoEntry */
  byTag: Map<string, ForgeIoEntry>;
  /** Map: address → ForgeIoEntry */
  byAddress: Map<string, ForgeIoEntry>;
}

function buildIoLookup(ioList: ForgeIoEntry[]): IoLookup {
  const byTag = new Map<string, ForgeIoEntry>();
  const byAddress = new Map<string, ForgeIoEntry>();
  for (const io of ioList) {
    if (io.tag_name) byTag.set(io.tag_name.toLowerCase(), io);
    if (io.address) byAddress.set(io.address, io);
  }
  return { byTag, byAddress };
}

/** Try to find the IO entry for a wire's connectedTo reference */
function resolveIoEntry(connectedTo: string, lookup: IoLookup): ForgeIoEntry | null {
  // connectedTo formats: "Inputs".tagName, "Outputs".tagName, or just tagName
  const dbFieldMatch = connectedTo.match(/^"(?:Inputs|Outputs)"\.(.+)$/);
  const fieldName = dbFieldMatch ? dbFieldMatch[1] : connectedTo;

  return lookup.byTag.get(fieldName.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Cross-device reference resolver
// ---------------------------------------------------------------------------

/** Build a map: "instanceDbName.paramName" → { deviceName, wire } for all output wires */
function buildOutputMap(
  devices: LinkageDevice[],
): Map<string, { deviceName: string; deviceType: string; wire: FbWire }> {
  const map = new Map<string, { deviceName: string; deviceType: string; wire: FbWire }>();
  for (const dev of devices) {
    for (const wire of dev.wiring) {
      if (wire.direction === "out") {
        const key = `${dev.instanceDbName}.${wire.paramName}`.toLowerCase();
        map.set(key, { deviceName: dev.name, deviceType: dev.deviceType, wire });
      }
    }
  }
  return map;
}

/** Build a map: "instanceDbName.paramName" → deviceName for all input wires (to find output destinations) */
function buildInputConsumerMap(
  devices: LinkageDevice[],
): Map<string, Array<{ deviceName: string; paramName: string }>> {
  const map = new Map<string, Array<{ deviceName: string; paramName: string }>>();
  for (const dev of devices) {
    for (const wire of dev.wiring) {
      if (wire.direction === "in" && wire.wireType === "fb") {
        // wire.connectedTo is like "InstSensor1.detected"
        const key = wire.connectedTo.replace(/^"/, "").replace(/"/, "").toLowerCase();
        const list = map.get(key) ?? [];
        list.push({ deviceName: dev.name, paramName: wire.paramName });
        map.set(key, list);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Format wires
// ---------------------------------------------------------------------------

/** Format signal behaviour metadata for an IO entry */
function formatIoBehaviour(io: ForgeIoEntry): string {
  const parts: string[] = [];
  if (io.signal_behaviour) parts.push(io.signal_behaviour.toUpperCase());
  if (io.contact_type) parts.push(io.contact_type);
  if (io.edge_trigger) parts.push(`edge:${io.edge_trigger}`);
  return parts.length > 0 ? ` {${parts.join(", ")}}` : "";
}

function formatInputWire(
  wire: FbWire,
  lookup: IoLookup,
  outputMap: Map<string, { deviceName: string; deviceType: string; wire: FbWire }>,
): string {
  const param = wire.paramName;
  const dtype = wire.dataType ? ` [${wire.dataType}]` : "";

  switch (wire.wireType) {
    case "io": {
      const io = resolveIoEntry(wire.connectedTo, lookup);
      if (io) {
        const behaviour = formatIoBehaviour(io);
        return `    ${param} ← ${wire.connectedTo} ← ${io.address} (${io.tag_name})${dtype}${behaviour} — ${io.description}`;
      }
      return `    ${param} ← ${wire.connectedTo}${dtype}`;
    }

    case "fb": {
      // Trace to source device
      const key = wire.connectedTo.replace(/^"/, "").replace(/"/, "").toLowerCase();
      const source = outputMap.get(key);
      if (source) {
        return `    ${param} ← ${wire.connectedTo}${dtype} — from ${source.deviceName} (${source.deviceType})`;
      }
      return `    ${param} ← ${wire.connectedTo}${dtype}`;
    }

    case "global":
      return `    ${param} ← ${wire.connectedTo}${dtype}`;

    case "constant":
      return `    ${param} ← ${wire.connectedTo}${dtype} (constant)`;

    default:
      return `    ${param} ← ${wire.connectedTo}${dtype}`;
  }
}

function formatOutputWire(
  wire: FbWire,
  instanceDbName: string,
  lookup: IoLookup,
  inputConsumerMap: Map<string, Array<{ deviceName: string; paramName: string }>>,
): string {
  const param = wire.paramName;
  const dtype = wire.dataType ? ` [${wire.dataType}]` : "";

  // Check if this output drives a physical IO
  if (wire.wireType === "io") {
    const io = resolveIoEntry(wire.connectedTo, lookup);
    if (io) {
      const behaviour = formatIoBehaviour(io);
      return `    ${param} → ${wire.connectedTo} → ${io.address} (${io.tag_name})${dtype}${behaviour} — ${io.description}`;
    }
  }

  // Check if other devices consume this output
  const outKey = `${instanceDbName}.${param}`.toLowerCase();
  const consumers = inputConsumerMap.get(outKey);
  if (consumers && consumers.length > 0) {
    const consumerList = consumers.map((c) => `${c.deviceName}.${c.paramName}`).join(", ");
    return `    ${param} → ${wire.connectedTo}${dtype} — drives ${consumerList}`;
  }

  return `    ${param} → ${wire.connectedTo}${dtype}`;
}

function formatInterlocks(interlocks: LinkageInterlock[]): string {
  if (interlocks.length === 0) return "";
  const lines = interlocks.map((il) => {
    const prefix = il.direction === "requires" ? "Requires" : il.direction === "blocks" ? "Blocks" : "Follows";
    return `    ${prefix}: ${il.targetDeviceName} — ${il.condition}`;
  });
  return `  INTERLOCKS:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Build a human-readable wiring context map from the linkage matrix and IO list.
 * Shows full signal paths with physical addresses, cross-device references, and interlocks.
 *
 * Returns empty string if no matrix or no devices.
 */
export function buildWiringContext(
  matrix: ProcessLinkageMatrix | null | undefined,
  ioList: ForgeIoEntry[],
): string {
  if (!matrix || matrix.deviceLinkage.length === 0) return "";

  const lookup = buildIoLookup(ioList);
  const outputMap = buildOutputMap(matrix.deviceLinkage);
  const inputConsumerMap = buildInputConsumerMap(matrix.deviceLinkage);

  const deviceSections: string[] = [];

  for (const device of matrix.deviceLinkage) {
    const header = `### ${device.name} (${device.deviceType})`;
    const fbLine = `  FB: ${device.fbName} | Instance: ${device.instanceDbName}${device.fbTemplateName ? ` | Template: ${device.fbTemplateName}` : ""}`;

    const inputs = device.wiring
      .filter((w) => w.direction === "in")
      .map((w) => formatInputWire(w, lookup, outputMap));

    const outputs = device.wiring
      .filter((w) => w.direction === "out")
      .map((w) => formatOutputWire(w, device.instanceDbName, lookup, inputConsumerMap));

    const interlocksBlock = formatInterlocks(device.interlocks);

    const parts = [header, fbLine];
    if (inputs.length > 0) parts.push(`  INPUTS:\n${inputs.join("\n")}`);
    if (outputs.length > 0) parts.push(`  OUTPUTS:\n${outputs.join("\n")}`);
    if (interlocksBlock) parts.push(interlocksBlock);

    deviceSections.push(parts.join("\n"));
  }

  // Global data summary
  const globalSections: string[] = [];
  for (const gd of matrix.globalData) {
    if (gd.fields.length === 0) continue;
    const fields = gd.fields.map((f) => `    ${f.fieldName}: ${f.dataType} — ${f.description}`);
    globalSections.push(`### ${gd.dbName} (${gd.purpose})\n${fields.join("\n")}`);
  }

  const sections = [
    "## Project Wiring Map",
    "",
    "This map shows the full signal path for every device parameter.",
    "Use this to understand exactly which physical IO, DB fields, and inter-device signals",
    "connect to each FB parameter. When modifying signal routing (adding timers, interlocks,",
    "conditions), reference this map to identify the correct insertion point.",
    "",
    "Signal behaviour annotations (when present):",
    "- {MOMENTARY} = push button / spring-return — signal is TRUE only while pressed. Requires LATCH (seal-in) before timers or sustained commands.",
    "- {MAINTAINED} = selector switch / toggle — signal stays in last position. Can drive commands directly.",
    "- {CONTINUOUS} = sensor / transmitter — signal reflects real-time process state. No latching needed.",
    "- {PULSED} = encoder / flow meter — signal pulses on each event. Use edge detection or counting.",
    "- {NO} = normally open contact. {NC} = normally closed contact (invert logic or use NC_CONTACT in LAD).",
    "",
    ...deviceSections,
  ];

  if (globalSections.length > 0) {
    sections.push("", "### Global Data Blocks", ...globalSections);
  }

  return sections.join("\n");
}
