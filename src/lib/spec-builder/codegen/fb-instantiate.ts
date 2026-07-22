// src/lib/spec-builder/codegen/fb-instantiate.ts
import type {
  ControlModuleV2,
  EquipmentModuleV2,
  FbAssignment,
  IoSignalV2,
} from "@/types/spec-contract-v2";
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
  /** TRUE when an explicit fb_assignment forced this template (G6-2: such a
   *  match never silently falls back — its failures surface as hard blocks). */
  forcedByAssignment: boolean;
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

/** Case-insensitive alphanumeric name tokens ("fb_Running" → [fb, running]). */
function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * G6-3: wire an instance call by NAME, never position. Explicit
 * `fb_assignments` pin bindings are authoritative; remaining pins match
 * signals of the correct direction by name-token overlap. A pin with no
 * match — or an ambiguous tie — stays unbound with a warning (an unbound
 * input keeps its FB default; a mis-wired one moves the wrong device).
 */
function contractWiringLines(
  instance: string,
  pins: FbInterfacePin[],
  io: IoSignalV2[],
  bindings: FbAssignment["pin_bindings"] = [],
): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const sigByTag = new Map(io.map((s) => [s.tag, s]));
  const used = new Set<string>();
  const bound = new Map<string, IoSignalV2>();

  // 1) explicit bindings (G0-8) win
  const bindingByPin = new Map(bindings.map((b) => [b.pin, b.tag]));
  for (const p of pins) {
    const tag = bindingByPin.get(p.name);
    if (tag === undefined) continue;
    const sig = sigByTag.get(tag);
    if (!sig) {
      warnings.push(`${instance}: pin "${p.name}" bound to unknown tag "${tag}" — left unbound`);
      continue;
    }
    bound.set(p.name, sig);
    used.add(sig.tag);
  }

  // 2) directional name-token matching for the rest
  const roleDir = (p: FbInterfacePin): ((s: IoSignalV2) => boolean) =>
    p.role === "sensor_in"
      ? (s) => INPUTS.has(s.signal_type)
      : (s) => !INPUTS.has(s.signal_type);
  for (const p of pins) {
    if (p.role !== "sensor_in" && p.role !== "actuator_out") continue;
    if (bound.has(p.name)) continue;
    const pinTokens = new Set(nameTokens(p.name));
    const candidates = io
      .filter((s) => !used.has(s.tag) && roleDir(p)(s))
      .map((s) => ({
        sig: s,
        score: nameTokens(s.tag).filter((t) => pinTokens.has(t)).length,
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) {
      warnings.push(`${instance}: pin "${p.name}" has no name-matching signal — left unbound`);
      continue;
    }
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      warnings.push(
        `${instance}: pin "${p.name}" is ambiguous between ${candidates
          .filter((c) => c.score === candidates[0].score)
          .map((c) => `"${c.sig.tag}"`)
          .join(", ")} — left unbound (bind explicitly via fb_assignments)`,
      );
      continue;
    }
    bound.set(p.name, candidates[0].sig);
    used.add(candidates[0].sig.tag);
  }

  // 3) emit call + output copies
  const params = pins
    .filter((p) => p.role === "sensor_in" && bound.has(p.name))
    .map((p) => `      ${p.name} := "${bound.get(p.name)!.io_address}"`);
  const lines = [`   "${instance}"(`, params.join(",\n"), `   );`];
  for (const p of pins) {
    if (p.role !== "actuator_out") continue;
    const sig = bound.get(p.name);
    if (sig) lines.push(`   "${sig.io_address}" := "${instance}".${p.name};`);
  }

  // 4) leftover signals
  const leftIn = io.filter((s) => INPUTS.has(s.signal_type) && !used.has(s.tag)).length;
  const leftOut = io.filter((s) => !INPUTS.has(s.signal_type) && !used.has(s.tag)).length;
  if (leftIn) warnings.push(`${instance}: ${leftIn} input signal(s) unmapped by contract`);
  if (leftOut) warnings.push(`${instance}: ${leftOut} output signal(s) unmapped by contract`);
  return { lines, warnings };
}

/** Choose contract wiring when the template carries a reviewed contract, else
 *  fall back to tag wiring (warning if a contract exists but is unreviewed). */
function buildWiring(
  instance: string, t: FbTemplate, io: IoSignalV2[],
  bindings: FbAssignment["pin_bindings"] = [],
): { lines: string[]; warnings: string[] } {
  const contract = t.interface_contract;
  if (contract && contract.reviewed && contract.pins.length) {
    return contractWiringLines(instance, contract.pins, io, bindings);
  }
  const warnings = contract && !contract.reviewed
    ? [`${instance}: interface_contract not reviewed; wired by tag name.`]
    : [];
  return { lines: wiringLines(instance, io), warnings };
}

const BLOCK_EXT: Record<string, string> = { FB: "scl", FC: "scl", OB: "ob", UDT: "udt", DB: "db" };

/** G6-1: lower a matched template's blocks into real artifacts (sort order =
 *  dependency order; each block depends on the ones before it). Standard
 *  Siemens instructions ship with TIA — reference-only, no bodies. Non-SCL
 *  blocks (LAD/FBD XML) have no SCL emission path yet → skipped + warning. */
function templateBodyArtifacts(
  t: FbTemplate,
): { artifacts: CodegenArtifact[]; warnings: string[] } {
  if (t.source === "standard") return { artifacts: [], warnings: [] };
  const artifacts: CodegenArtifact[] = [];
  const warnings: string[] = [];
  const emitted: string[] = [];
  for (const b of [...(t.blocks ?? [])].sort((x, y) => x.sort_order - y.sort_order)) {
    if (!b.scl_code.trim()) {
      warnings.push(
        `template "${t.name}": block ${b.block_name} is ${b.programming_language} without SCL source — import it manually (XML import path not wired)`,
      );
      continue;
    }
    artifacts.push({
      name: b.block_name,
      type: b.block_type,
      filename: `${b.block_name}.${BLOCK_EXT[b.block_type] ?? "scl"}`,
      content: b.scl_code.endsWith("\n") ? b.scl_code : `${b.scl_code}\n`,
      dependencies: [...emitted],
      folder: FOLDER,
      layer: "device",
    });
    emitted.push(b.block_name);
  }
  return { artifacts, warnings };
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

/** G6-5: an unmatched device emits a functional direct-control FB, not an
 *  empty shell — each output follows its `cmd_` input while `enable` is TRUE
 *  and forces the zero/safe state otherwise. Unwired cmd/enable inputs
 *  default FALSE, so an untouched instance is safe by construction; the block
 *  is hand-drivable during commissioning and replaceable by a library FB
 *  (fb_assignments) without changing callers. */
function stubFb(prefix: string, name: string, io: IoSignalV2[]): CodegenArtifact {
  const fbName = `${prefix}_${sclIdent(name)}`;
  const outSigs = io.filter((s) => !INPUTS.has(s.signal_type));
  const inputs = [
    `      enable : Bool;`,
    ...outSigs.map((s) => `      cmd_${sclIdent(s.tag)} : ${sclType(s)};`),
    ...io.filter((s) => INPUTS.has(s.signal_type)).map((s) => `      ${s.tag} : ${sclType(s)};`),
  ];
  const outputs = outSigs.map((s) => `      ${s.tag} : ${sclType(s)};`);
  const body = outSigs.length
    ? [
        `   IF #enable THEN`,
        ...outSigs.map((s) => `      #${s.tag} := #cmd_${sclIdent(s.tag)};`),
        `   ELSE`,
        ...outSigs.map((s) => `      #${s.tag} := ${sclType(s) === "Int" ? "0" : "FALSE"};`),
        `   END_IF;`,
      ]
    : [`   ;   // sensor-only device — no outputs to drive`];
  const content = [
    `FUNCTION_BLOCK "${fbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `   VAR_INPUT`, ...inputs, `   END_VAR`,
    `   VAR_OUTPUT`, ...outputs, `   END_VAR`,
    `BEGIN`,
    `   // Generated direct control (no library FB matched this device):`,
    `   // outputs follow their cmd_ inputs while enabled; disable forces the`,
    `   // safe (zero) state. Assign a library template via fb_assignments to`,
    `   // replace this block.`,
    ...body,
    `END_FUNCTION_BLOCK`,
    ``,
  ].join("\n");
  return { name: fbName, type: "FB", filename: `${fbName}.scl`, content, dependencies: [], folder: FOLDER, layer: "device" };
}

/** Shared instantiation for CM and EM. */
function instantiate(
  prefix: string, id: string, name: string, deviceClass: string, isEm: boolean,
  io: IoSignalV2[], templates: FbTemplate[], layer: CodegenLayer,
  assignments: FbAssignment[] = [],
): InstantiateResult {
  const tag = (a: CodegenArtifact): CodegenArtifact => ({ ...a, layer, ownerId: id, ownerName: name });
  // G6-3/G0-8: an explicit assignment forces the template choice.
  const assignment = assignments.find(
    (a) => a.target_kind === (isEm ? "equipment_module" : "control_module") && a.target_id === id,
  );
  const assignmentWarnings: string[] = [];
  let t: FbTemplate | null = null;
  if (assignment) {
    t = templates.find((x) => x.id === assignment.template_id && x.is_enabled) ?? null;
    if (!t) {
      assignmentWarnings.push(
        `${name}: fb_assignment references template "${assignment.template_id}" (missing or disabled) — falling back to score matching`,
      );
    }
  }
  t = t ?? pickTemplate(name, deviceClass, isEm, templates);
  if (!t) {
    const fb = stubFb(prefix, name, io);
    const instanceName = `${fb.name}_DB`;
    return {
      artifacts: [fb, instanceDb(instanceName, fb.name)].map(tag),
      callLines: wiringLines(instanceName, io),
      stub: { id, name, reason: `no ${isEm ? "EM" : "CM"} template matched "${deviceClass}"` },
      warnings: assignmentWarnings,
      instanceDb: instanceName,
      contract: null,
      forcedByAssignment: false,
    };
  }
  const block = templateBlockName(t);
  const instance = `${block}_${sclIdent(name)}_DB`;
  const db = instanceDb(instance, block);
  const w = buildWiring(instance, t, io, assignment?.pin_bindings ?? []);
  // G6-1: the template's SCL bodies enter the artifact set ahead of the
  // instance DB (compile-contract's name de-dup collapses repeat instances).
  const body = templateBodyArtifacts(t);
  return {
    artifacts: [...body.artifacts, db].map(tag),
    callLines: w.lines,
    stub: null,
    warnings: [...assignmentWarnings, ...body.warnings, ...w.warnings],
    instanceDb: instance,
    contract: t.interface_contract,
    forcedByAssignment: !!assignment && t.id === assignment.template_id,
  };
}

/** Instantiate one Control Module (basic-control FB). */
export function instantiateControlModule(
  cm: ControlModuleV2, templates: FbTemplate[], assignments: FbAssignment[] = [],
): InstantiateResult {
  return instantiate("CM", cm.control_module_id, cm.control_module_name, cm.control_module_class, false, cm.io_signals, templates, "device", assignments);
}

/** Instantiate one Equipment Module (procedural-control FB). EM-level IO is the
 *  union of its control modules' signals. */
export function instantiateEquipmentModule(
  em: EquipmentModuleV2, templates: FbTemplate[], assignments: FbAssignment[] = [],
): InstantiateResult {
  const io = em.control_modules.flatMap((c) => c.io_signals);
  return instantiate("EM", em.equipment_module_id, em.equipment_module_name, em.equipment_module_name, true, io, templates, "em", assignments);
}
