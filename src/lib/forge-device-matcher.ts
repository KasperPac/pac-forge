/**
 * forge-device-matcher.ts
 * Matches devices to FB library templates based on:
 *   1. Interface coverage — does the FB have the right Bool/analog params for this device's IO?
 *   2. Name affinity — secondary tiebreaker (category, tags, synonyms)
 *
 * "exact" = interface fits well AND name is related → template is copied as-is, no AI
 * "probable" = interface fits OR name matches → AI uses template as reference/hint
 * "none" = no meaningful match → AI generates from scratch
 */

import type { ForgeDeviceEntry, ForgeAssemblyEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface DeviceFbMatch {
  device: ForgeDeviceEntry;
  template: FbTemplate | null;
  confidence: "exact" | "probable" | "none";
  reason: string;
}

export interface AssemblyFbMatch {
  assembly: ForgeAssemblyEntry;
  template: FbTemplate | null;
  confidence: "exact" | "probable" | "none";
  reason: string;
}

// ---------------------------------------------------------------------------
// Interface analysis — parse Bool and analog param counts from SCL
// ---------------------------------------------------------------------------

interface FbInterface {
  boolInputs: number;   // VAR_INPUT Bool params
  boolOutputs: number;  // VAR_OUTPUT Bool params
  analogInputs: number; // VAR_INPUT Int/Word/Real/DInt params
  analogOutputs: number;// VAR_OUTPUT Int/Word/Real/DInt params
}

const ANALOG_TYPES = /\b(int|dint|word|dword|real|lreal|uint|udint)\b/i;

function parseInterface(scl: string): FbInterface {
  let boolInputs = 0, boolOutputs = 0, analogInputs = 0, analogOutputs = 0;

  // Match each VAR_INPUT / VAR_OUTPUT block
  const blockRe = /VAR_(INPUT|OUTPUT)\b([\s\S]*?)END_VAR/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(scl)) !== null) {
    const section = block[1].toUpperCase(); // INPUT or OUTPUT
    const body = block[2];
    // Each declaration line: "  name : Type := default; // comment"
    const declRe = /^\s+\w+\s*:\s*(\w+)/gm;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(body)) !== null) {
      const type = decl[1].toLowerCase();
      if (type === "bool") {
        if (section === "INPUT") boolInputs++;
        else boolOutputs++;
      } else if (ANALOG_TYPES.test(type)) {
        if (section === "INPUT") analogInputs++;
        else analogOutputs++;
      }
    }
  }
  return { boolInputs, boolOutputs, analogInputs, analogOutputs };
}

/** Get interface from the primary FB block of a template */
function templateInterface(template: FbTemplate): FbInterface {
  const mainBlock = template.blocks?.find(b => b.block_type === "FB") ?? template.blocks?.[0];
  if (!mainBlock?.scl_code) return { boolInputs: 0, boolOutputs: 0, analogInputs: 0, analogOutputs: 0 };
  return parseInterface(mainBlock.scl_code);
}

/** Count the device's IO signals by type */
function deviceIoCounts(device: ForgeDeviceEntry): { boolCount: number; analogCount: number } {
  const signals = device.io_signals ?? [];
  const boolCount = signals.filter(s => s.signal_type === "DI" || s.signal_type === "DQ").length;
  const analogCount = signals.filter(s => s.signal_type === "AI" || s.signal_type === "AQ").length;
  return { boolCount, analogCount };
}

/**
 * Score how well a template's interface covers a device's IO needs.
 * Returns 0–1: 1 = perfect fit, 0 = completely wrong.
 */
function interfaceScore(device: ForgeDeviceEntry, iface: FbInterface): number {
  const { boolCount, analogCount } = deviceIoCounts(device);
  const templateBool = iface.boolInputs + iface.boolOutputs;
  const templateAnalog = iface.analogInputs + iface.analogOutputs;

  // If device has no IO signals yet, we can't score by interface — fall through to name
  if (boolCount === 0 && analogCount === 0) return 0.5;

  // Bool coverage: how well does the template's Bool param count match device Bool IO?
  // A template usually has MORE params than IO signals (HMI, enable, status etc.) so
  // we reward templates where device IO is within the template's capacity.
  let boolScore = 0;
  if (boolCount > 0 && templateBool > 0) {
    // Industrial FBs typically have many more Bool params than physical IO (HMI, status, enable,
    // feedback, error flags etc.). Allow up to 8× before penalising — tighter thresholds cause
    // feature-rich templates (E-Stop, motor) to score worse than simpler sensor templates for
    // identical 1-DI devices, which produces wrong matches.
    const ratio = templateBool / boolCount;
    if (ratio >= 1 && ratio <= 8) boolScore = 1.0;
    else if (ratio > 8) boolScore = Math.max(0.3, 1 - (ratio - 8) * 0.1); // soft penalty; floor at 0.3
    else boolScore = ratio; // template has fewer params than device IO — probably wrong FB type
  } else if (boolCount === 0 && templateBool === 0) {
    boolScore = 1.0; // both have no Bool — fine
  }

  // Analog coverage
  let analogScore = 1.0;
  if (analogCount > 0 && templateAnalog === 0) {
    analogScore = 0.2; // device needs analog, template has none — bad fit
  } else if (analogCount === 0 && templateAnalog > 2) {
    analogScore = 0.6; // template is much more analog than device needs — slight mismatch
  }

  // Weight: Bool IO is more diagnostic than analog for device type identification
  const totalIo = boolCount + analogCount;
  const boolWeight = boolCount / totalIo;
  const analogWeight = analogCount / totalIo;
  return boolWeight * boolScore + analogWeight * analogScore;
}

// ---------------------------------------------------------------------------
// Name affinity — existing synonym-based logic (secondary signal)
// ---------------------------------------------------------------------------

function normalise(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normaliseWords(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
}

const DEVICE_TYPE_SYNONYMS: Record<string, string[]> = {
  "motor dol":            ["dol motor", "direct on line motor", "direct online motor", "motor", "motordol"],
  "motor vfd":            ["vfd motor", "variable frequency drive motor", "variable speed motor", "inverter motor"],
  "photoelectric sensor": ["photoelectric", "photo sensor", "pe sensor", "photo eye", "photoeye", "optical sensor"],
  "proximity sensor":     ["proximity", "prox sensor", "inductive sensor", "inductive proximity sensor"],
  "push button station":  ["push button", "pushbutton", "pushbutton station", "control station", "operator station",
                           "start stop station", "start/stop station", "start button", "stop button",
                           "momentary pushbutton", "latching pushbutton"],
  "solenoid 2-pos":       ["2 position solenoid", "solenoid valve 2 pos", "solenoid valve", "solenoid"],
  "e-stop circuit":       ["emergency stop", "e-stop", "estop", "e stop circuit", "emergency stop circuit",
                           "emergency stop button", "estop button", "e-stop button", "safety stop",
                           "estop device", "emergency stop device", "mushroom head stop", "mushroom stop"],
  "stack light":          ["signal tower", "indicator light", "tower light", "signal light", "beacon"],
  "conveyor":             ["conveyor dol", "belt conveyor", "conveyor belt"],
  "digital input":        ["di", "digital input", "digital sensor", "limit switch", "level switch",
                           "float switch", "pressure switch", "flow switch"],
  "digital output":       ["do", "dq", "digital output", "solenoid", "pilot light", "indicator",
                           "horn", "siren", "relay output", "contactor"],
  "analog input":         ["ai", "analog input", "analog sensor", "transmitter", "4-20ma input",
                           "rtd", "thermocouple", "pressure transmitter", "level transmitter",
                           "flow transmitter", "temperature sensor", "load cell"],
  "analog output":        ["ao", "aq", "analog output", "4-20ma output", "control valve",
                           "proportional valve", "variable speed", "dimmer"],
};

function toCanonical(s: string): string | null {
  const words = normaliseWords(s);
  for (const [canonical, synonyms] of Object.entries(DEVICE_TYPE_SYNONYMS)) {
    if (normaliseWords(canonical) === words) return canonical;
    if (synonyms.some(syn => normaliseWords(syn) === words)) return canonical;
  }
  return null;
}

/**
 * Tokenise a template name by stripping fb/fc/udt prefix and splitting on
 * underscores and CamelCase boundaries.
 * "fbMotor_Reversing" → ["motor", "reversing"]
 * "fbVFD_GSeries" → ["vfd", "g", "series"]
 */
function tokeniseTemplateName(name: string): string[] {
  const stripped = name.replace(/^(fb|fc|udt)/i, "");
  return stripped
    .split("_")
    .flatMap(part => part.split(/(?<=[a-z])(?=[A-Z])/))
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2);
}

/**
 * Name affinity score 0–1:
 *   1.0 = direct/synonym exact match
 *   0.6 = substring containment
 *   0.3 = tag partial match
 *   0.0 = no relation
 */
function nameAffinity(deviceType: string, template: FbTemplate): number {
  const normD = normalise(deviceType);
  const wordsD = normaliseWords(deviceType);
  const canonD = toCanonical(deviceType);

  // Check category
  const normCat = normalise(template.device_category);
  const wordsCat = normaliseWords(template.device_category);
  const canonCat = toCanonical(template.device_category);

  if (normCat === normD) return 1.0;
  if (wordsCat === wordsD) return 1.0;
  if (canonD && canonCat && canonD === canonCat) return 1.0;

  // Substring in category
  if (normCat.includes(normD) || normD.includes(normCat)) return 0.6;

  // Check template name
  const normName = normalise(template.name);
  if (normName.includes(normD) || normD.includes(normName)) return 0.5;

  // Tags
  const tagMatch = template.tags?.some(tag => {
    const t = normalise(tag);
    return t.includes(normD) || normD.includes(t);
  });
  if (tagMatch) return 0.3;

  // Token overlap — handles library FB naming conventions (fb prefix, CamelCase, underscores)
  const templateTokens = tokeniseTemplateName(template.name);
  const deviceTokens = deviceType.toLowerCase().split(/[\s_\-/]+/).filter(w => w.length >= 2);
  if (templateTokens.length > 0 && deviceTokens.length > 0) {
    const overlap = deviceTokens.filter(w => templateTokens.includes(w));
    if (overlap.length > 0) {
      const ratio = overlap.length / deviceTokens.length;
      return Math.min(0.8, 0.4 + ratio * 0.4);
    }
  }

  return 0.0;
}

// ---------------------------------------------------------------------------
// Combined scoring and matching
// ---------------------------------------------------------------------------

export interface TemplateScore {
  template: FbTemplate;
  iScore: number;   // interface coverage 0–1
  nScore: number;   // name affinity 0–1
  sScore: number;   // summary keyword match 0–1
  combined: number; // weighted combination
}

/**
 * Check if the AI summary mentions keywords related to this device type.
 */
function summaryAffinity(deviceType: string, template: FbTemplate): number {
  // Fall back to first 500 chars of documentation when ai_summary is missing
  const summary = (template.ai_summary
    ?? template.documentation?.slice(0, 500)
    ?? "").toLowerCase();
  if (!summary) return 0;

  const deviceWords = deviceType.toLowerCase().split(/[\s_\-/]+/).filter((w) => w.length >= 3);
  if (deviceWords.length === 0) return 0;

  const matches = deviceWords.filter((w) => summary.includes(w));
  return matches.length / deviceWords.length;
}

export function scoreTemplate(device: ForgeDeviceEntry, template: FbTemplate): TemplateScore {
  const iface = templateInterface(template);
  const iScore = interfaceScore(device, iface);
  const nScore = nameAffinity(device.device_type, template);
  const sScore = summaryAffinity(device.device_type, template);

  // Name is primary (40%), interface (30%), summary (30%)
  // Name affinity is the strongest signal — a template called "fbValveSolenoid" should
  // always beat "fbIO_DigitalOutput" for a solenoid device, even if interface scores tie.
  const hasScl = (template.blocks?.length ?? 0) > 0;
  // Library templates have tested code + matched HMI faceplates — prefer them
  const sourceBoost = template.source === "library" ? 0.08 : 0;
  // Penalize generic templates (fbIO_*, Pushbutton used as catch-all) when name affinity is zero —
  // a generic FB with perfect interface fit shouldn't beat a specific FB with a real name match
  const normName = template.name.toLowerCase();
  const isGeneric = normName.startsWith("fbio") || normName === "pushbutton";
  const genericPenalty = (isGeneric && nScore === 0) ? -0.15 : 0;
  const combined = hasScl
    ? Math.max(0, Math.min(1.0, 0.3 * iScore + 0.4 * nScore + 0.3 * sScore + sourceBoost + genericPenalty))
    : Math.max(0, Math.min(1.0, 0.5 * nScore + 0.5 * sScore + sourceBoost + genericPenalty));

  return { template, iScore, nScore, sScore, combined };
}

function confidenceFromScore(score: TemplateScore): "exact" | "probable" | "none" {
  // Exact: good combined fit AND name is clearly related (safe to copy template as-is)
  if (score.combined >= 0.7 && score.nScore >= 0.3) return "exact";
  // Probable: decent combined score BUT must have some name relevance — pure interface
  // matches without any name/category relation produce wrong results (e.g. fbPulser for a lift table)
  if (score.combined >= 0.55 && score.nScore >= 0.2) return "probable";
  if (score.nScore >= 0.6) return "probable";
  return "none";
}

function reasonFor(score: TemplateScore, device: ForgeDeviceEntry, confidence: string): string {
  const { boolCount } = deviceIoCounts(device);
  const iface = templateInterface(score.template);
  const templateBool = iface.boolInputs + iface.boolOutputs;

  if (confidence === "exact") {
    return `"${device.device_type}" matches "${score.template.name}" — interface fit ${Math.round(score.iScore * 100)}% (device: ${boolCount} Bool IO, template: ${templateBool} Bool params), name affinity ${Math.round(score.nScore * 100)}%.`;
  }
  if (confidence === "probable") {
    return `"${device.device_type}" partially matches "${score.template.name}" — combined score ${Math.round(score.combined * 100)}%. AI will adapt template to device needs.`;
  }
  return `No suitable template for "${device.device_type}" (best score: ${Math.round(score.combined * 100)}%). AI will generate from scratch.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score and rank ALL templates for a given device, sorted by combined score descending.
 * Used by the FB template selector to show compatible options.
 */
export function rankTemplatesForDevice(
  device: ForgeDeviceEntry,
  templates: FbTemplate[],
  favourites: Record<string, string> = {},
): TemplateScore[] {
  const scored = templates
    .map((t) => scoreTemplate(device, t))
    .sort((a, b) => b.combined - a.combined);

  // Move the favourite to the top if one exists
  const favId = favourites[device.device_type];
  if (favId) {
    const favIdx = scored.findIndex((s) => s.template.id === favId);
    if (favIdx > 0) {
      const [fav] = scored.splice(favIdx, 1);
      scored.unshift(fav);
    }
  }
  return scored;
}

export function matchDevicesToTemplates(
  devices: ForgeDeviceEntry[],
  templates: FbTemplate[],
  favourites: Record<string, string> = {},
): DeviceFbMatch[] {
  return devices.map((device): DeviceFbMatch => {
    // --- Favourite check (highest priority — skip scoring entirely) ---
    const favouriteId = favourites[device.device_type];
    if (favouriteId) {
      const template = templates.find((t) => t.id === favouriteId) ?? null;
      if (template) {
        return {
          device,
          template,
          confidence: "exact",
          reason: `"${device.device_type}" matched via profile favourite: "${template.name}".`,
        };
      }
      // Favourite ID set but template not found (deleted?) — fall through to scoring
    }

    if (templates.length === 0) {
      return { device, template: null, confidence: "none", reason: "No templates in library." };
    }

    // --- Existing scoring path ---
    const scores: TemplateScore[] = templates.map((t) => scoreTemplate(device, t));
    scores.sort((a, b) => b.combined - a.combined);

    const best = scores[0];
    const confidence = confidenceFromScore(best);

    if (confidence === "none") {
      return { device, template: null, confidence: "none", reason: reasonFor(best, device, "none") };
    }

    return {
      device,
      template: best.template,
      confidence,
      reason: reasonFor(best, device, confidence),
    };
  });
}

export function applyMatchesToDevices(
  devices: ForgeDeviceEntry[],
  matches: DeviceFbMatch[],
): ForgeDeviceEntry[] {
  return devices.map((device) => {
    const match = matches.find((m) => m.device.id === device.id);
    if (!match) return device;
    return {
      ...device,
      fb_template_id: match.template?.id ?? null,
      fb_match_confidence: match.confidence,
    };
  });
}

// ---------------------------------------------------------------------------
// Missing device suggestions (unchanged)
// ---------------------------------------------------------------------------

export interface MissingDeviceSuggestion {
  suggestedType: string;
  suggestedName: string;
  suggestedTag: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Assembly matching — matches assemblies to is_assembly templates
// ---------------------------------------------------------------------------

export function matchAssembliesToTemplates(
  assemblies: ForgeAssemblyEntry[],
  templates: FbTemplate[],
  favourites: Record<string, string> = {},
): AssemblyFbMatch[] {
  return assemblies.map((assembly): AssemblyFbMatch => {
    const favouriteId = favourites[assembly.assembly_type];
    if (favouriteId) {
      const template = templates.find((t) => t.id === favouriteId) ?? null;
      if (template) {
        return {
          assembly,
          template,
          confidence: "exact",
          reason: `"${assembly.assembly_type}" matched via profile favourite: "${template.name}".`,
        };
      }
    }

    if (templates.length === 0) {
      return { assembly, template: null, confidence: "none", reason: "No assembly templates in library." };
    }

    const scores = templates.map((t) => {
      const nScore = nameAffinity(assembly.assembly_type, t);
      const sScore = summaryAffinity(assembly.assembly_type, t);
      const sourceBoost = t.source === "library" ? 0.08 : 0;
      const combined = Math.max(0, Math.min(1.0, 0.5 * nScore + 0.5 * sScore + sourceBoost));
      return { template: t, nScore, sScore, combined };
    });

    scores.sort((a, b) => b.combined - a.combined);
    const best = scores[0];

    if (best.combined >= 0.7 && best.nScore >= 0.3) {
      return {
        assembly,
        template: best.template,
        confidence: "exact",
        reason: `"${assembly.assembly_type}" matches "${best.template.name}" — name ${Math.round(best.nScore * 100)}%, summary ${Math.round(best.sScore * 100)}%.`,
      };
    }
    if (best.combined >= 0.5 && best.nScore >= 0.2) {
      return {
        assembly,
        template: best.template,
        confidence: "probable",
        reason: `"${assembly.assembly_type}" partially matches "${best.template.name}" — score ${Math.round(best.combined * 100)}%.`,
      };
    }

    return { assembly, template: null, confidence: "none", reason: `No suitable template for "${assembly.assembly_type}". AI will generate from scratch.` };
  });
}

export function applyMatchesToAssemblies(
  assemblies: ForgeAssemblyEntry[],
  matches: AssemblyFbMatch[],
): ForgeAssemblyEntry[] {
  return assemblies.map((assembly) => {
    const match = matches.find((m) => m.assembly.id === assembly.id);
    if (!match) return assembly;
    return {
      ...assembly,
      fb_template_id: match.template?.id ?? null,
      fb_match_confidence: match.confidence,
    };
  });
}

// ---------------------------------------------------------------------------
// Missing device suggestions (unchanged)
// ---------------------------------------------------------------------------

export function suggestMissingDevices(
  devices: ForgeDeviceEntry[],
  assemblies?: Array<{ device_ids: string[] }>,
): MissingDeviceSuggestion[] {
  const suggestions: MissingDeviceSuggestion[] = [];
  const typesLower = new Set(devices.map(d => (d.device_type ?? "").toLowerCase()));

  // Skip conveyor suggestions if assemblies already cover coordination
  const assemblyDeviceIds = new Set((assemblies ?? []).flatMap(a => a.device_ids));
  const hasConveyor = [...typesLower].some(t => t.includes("conveyor") || t.includes("belt"));

  if (!hasConveyor) {
    const conveyorMotors = devices.filter(
      d =>
        !assemblyDeviceIds.has(d.id) && // Skip devices already in an assembly
        (d.device_type ?? "").toLowerCase().includes("motor") &&
        ((d.description ?? "").toLowerCase().includes("conveyor") ||
          (d.description ?? "").toLowerCase().includes("belt") ||
          (d.name ?? "").toLowerCase().startsWith("cv") ||
          (d.tag ?? "").toLowerCase().startsWith("cv")),
    );

    for (const motor of conveyorMotors) {
      const num = motor.tag.match(/\d+/)?.[0] ?? "";
      suggestions.push({
        suggestedType: "Conveyor",
        suggestedName: `CV${num}`,
        suggestedTag: `CV${num}`,
        reason: `Motor "${motor.tag}" drives a conveyor. Add a Conveyor device for direction control, sensor monitoring, and jam detection.`,
      });
    }
  }

  return suggestions;
}
