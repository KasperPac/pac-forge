// src/lib/spec-builder/codegen/fb-instantiate.ts
import type { ControlModuleV2, EquipmentModuleV2, IoSignalV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { FbInterfacePin, FbInterfaceContract } from "@/types/fb-interface";
import type { CodegenArtifact, CodegenLayer } from "./types";
import { sclIdent } from "./sa-builder";

const FOLDER = "Program blocks";
const ANALOG = new Set<string>(["AI", "AO"]);
const INPUTS = new Set<string>(["DI", "AI"]);

export interface InstantiateResult {
  artifacts: CodegenArtifact[];
  callLines: string[];
  stub: { id: string; name: string; reason: string } | null;
  warnings: string[];
  /** The instance DB block name (matched or stub). */
  instanceDb: string;
  /** The matched template's interface contract, or null for a stub. */
  contract: FbInterfaceContract | null;
}

/** Score-pick the best library FB for a device. Category/class match dominates,
 *  then name and tag substring hits. Honours the equipment-module + enabled
 *  flags. Deterministic; no AI. */
export function pickTemplate(
  name: string, deviceClass: string, isEm: boolean, templates: FbTemplate[],
): FbTemplate | null {
  const hay = `${name} ${deviceClass}`.toLowerCase();
  let best: FbTemplate | null = null;
  let bestScore = 0;
  for (const t of templates) {
    if (!t.is_enabled || !!t.is_equipment_module !== isEm) continue;
    const cat = (t.device_category ?? "").toLowerCase();
    let score = 0;
    if (cat && deviceClass.toLowerCase() === cat) score += 5;
    else if (cat && hay.includes(cat)) score += 3;
    if (t.name && hay.includes(t.name.toLowerCase())) score += 2;
    for (const tag of t.tags ?? []) if (tag && hay.includes(tag.toLowerCase())) score += 1;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore > 0 ? best : null;
}

/** The FB block name a template imports as (first FB block, else template name). */
function templateBlockName(t: FbTemplate): string {
  const fb = (t.blocks ?? []).find((b) => b.block_type === "FB");
  return fb?.block_name ?? `CM_${sclIdent(t.name)}`;
}

function sclType(sig: IoSignalV2): string {
  return ANALOG.has(sig.signal_type) ? "Int" : "Bool";
}

/** Build the call: a header line, input params read from their address, then
 *  output copies (instance output -> physical address). The instance parameter
 *  is the instance DB name — used to qualify output reads in OB1 context. */
function wiringLines(instance: string, io: IoSignalV2[]): string[] {
  const params = io
    .filter((s) => INPUTS.has(s.signal_type))
    .map((s) => `      ${s.tag} := "${s.io_address}"`);
  const lines = [`   "${instance}"(`, params.join(",\n"), `   );`];
  for (const s of io) {
    if (!INPUTS.has(s.signal_type)) lines.push(`   "${s.io_address}" := "${instance}".${s.tag};`);
  }
  return lines;
}

/** Wire an instance call by interface_contract role: sensor_in pins read input
 *  addresses, actuator_out pins write output addresses. Positional pairing in
 *  signal order; surplus signals or pins each raise a warning. */
function contractWiringLines(
  instance: string, pins: FbInterfacePin[], io: IoSignalV2[],
): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const inputs = io.filter((s) => INPUTS.has(s.signal_type));
  const outputs = io.filter((s) => !INPUTS.has(s.signal_type));
  const sensorPins = pins.filter((p) => p.role === "sensor_in");
  const actuatorPins = pins.filter((p) => p.role === "actuator_out");

  const params: string[] = [];
  sensorPins.forEach((p, i) => {
    const sig = inputs[i];
    if (sig) params.push(`      ${p.name} := "${sig.io_address}"`);
    else warnings.push(`${instance}: no input signal for sensor pin "${p.name}"`);
  });
  const lines = [`   "${instance}"(`, params.join(",\n"), `   );`];
  actuatorPins.forEach((p, i) => {
    const sig = outputs[i];
    if (sig) lines.push(`   "${sig.io_address}" := "${instance}".${p.name};`);
    else warnings.push(`${instance}: no output signal for actuator pin "${p.name}"`);
  });
  if (inputs.length > sensorPins.length)
    warnings.push(`${instance}: ${inputs.length - sensorPins.length} input signal(s) unmapped by contract`);
  if (outputs.length > actuatorPins.length)
    warnings.push(`${instance}: ${outputs.length - actuatorPins.length} output signal(s) unmapped by contract`);
  return { lines, warnings };
}

/** Choose contract wiring when the template carries a reviewed contract, else
 *  fall back to tag wiring (warning if a contract exists but is unreviewed). */
function buildWiring(
  instance: string, t: FbTemplate, io: IoSignalV2[],
): { lines: string[]; warnings: string[] } {
  const contract = t.interface_contract;
  if (contract && contract.reviewed && contract.pins.length) {
    return contractWiringLines(instance, contract.pins, io);
  }
  const warnings = contract && !contract.reviewed
    ? [`${instance}: interface_contract not reviewed; wired by tag name.`]
    : [];
  return { lines: wiringLines(instance, io), warnings };
}

/** Build an instance DB artifact for the given FB block name. */
function instanceDb(instanceName: string, blockName: string): CodegenArtifact {
  return {
    name: instanceName, type: "DB", filename: `${instanceName}.db`,
    content: [
      `DATA_BLOCK "${instanceName}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `"${blockName}"`,
      `BEGIN`,
      `END_DATA_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [blockName], folder: FOLDER, layer: "device",
  };
}

/** Emit a stub FB with the device's IO as a typed interface and an empty body. */
function stubFb(prefix: string, name: string, io: IoSignalV2[]): CodegenArtifact {
  const fbName = `${prefix}_${sclIdent(name)}`;
  const inputs = io.filter((s) => INPUTS.has(s.signal_type)).map((s) => `      ${s.tag} : ${sclType(s)};`);
  const outputs = io.filter((s) => !INPUTS.has(s.signal_type)).map((s) => `      ${s.tag} : ${sclType(s)};`);
  const content = [
    `FUNCTION_BLOCK "${fbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_INPUT`, ...inputs, `   END_VAR`,
    `   VAR_OUTPUT`, ...outputs, `   END_VAR`,
    `BEGIN`,
    `   // Stub - body to be implemented (no library FB matched this device).`,
    `END_FUNCTION_BLOCK`,
    ``,
  ].join("\n");
  return { name: fbName, type: "FB", filename: `${fbName}.scl`, content, dependencies: [], folder: FOLDER, layer: "device" };
}

/** Shared instantiation for CM and EM. */
function instantiate(
  prefix: string, id: string, name: string, deviceClass: string, isEm: boolean,
  io: IoSignalV2[], templates: FbTemplate[], layer: CodegenLayer,
): InstantiateResult {
  const tag = (a: CodegenArtifact): CodegenArtifact => ({ ...a, layer, ownerId: id, ownerName: name });
  const t = pickTemplate(name, deviceClass, isEm, templates);
  if (!t) {
    const fb = stubFb(prefix, name, io);
    const instanceName = `${fb.name}_DB`;
    return {
      artifacts: [fb, instanceDb(instanceName, fb.name)].map(tag),
      callLines: wiringLines(instanceName, io),
      stub: { id, name, reason: `no ${isEm ? "EM" : "CM"} template matched "${deviceClass}"` },
      warnings: [],
      instanceDb: instanceName,
      contract: null,
    };
  }
  const block = templateBlockName(t);
  const instance = `${block}_${sclIdent(name)}_DB`;
  const db = instanceDb(instance, block);
  const w = buildWiring(instance, t, io);
  return { artifacts: [db].map(tag), callLines: w.lines, stub: null, warnings: w.warnings, instanceDb: instance, contract: t.interface_contract };
}

/** Instantiate one Control Module (basic-control FB). */
export function instantiateControlModule(cm: ControlModuleV2, templates: FbTemplate[]): InstantiateResult {
  return instantiate("CM", cm.control_module_id, cm.control_module_name, cm.control_module_class, false, cm.io_signals, templates, "device");
}

/** Instantiate one Equipment Module (procedural-control FB). EM-level IO is the
 *  union of its control modules' signals. */
export function instantiateEquipmentModule(em: EquipmentModuleV2, templates: FbTemplate[]): InstantiateResult {
  const io = em.control_modules.flatMap((c) => c.io_signals);
  return instantiate("EM", em.equipment_module_id, em.equipment_module_name, em.equipment_module_name, true, io, templates, "em");
}
