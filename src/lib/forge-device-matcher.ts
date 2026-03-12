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

import type { ForgeDeviceEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface DeviceFbMatch {
  device: ForgeDeviceEntry;
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
    // Score peaks when template has 1–3x the device's Bool IO count (allows for HMI/status params)
    const ratio = templateBool / boolCount;
    if (ratio >= 1 && ratio <= 4) boolScore = 1.0;
    else if (ratio > 4) boolScore = Math.max(0, 1 - (ratio - 4) * 0.15); // penalise over-engineered templates
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

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normaliseWords(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
}

const DEVICE_TYPE_SYNONYMS: Record<string, string[]> = {
  "motor dol":            ["dol motor", "direct on line motor", "direct online motor", "motor", "motordol"],
  "motor vfd":            ["vfd motor", "variable frequency drive motor", "variable speed motor", "inverter motor"],
  "photoelectric sensor": ["photoelectric", "photo sensor", "pe sensor", "photo eye", "photoeye", "optical sensor"],
  "proximity sensor":     ["proximity", "prox sensor", "inductive sensor", "inductive proximity sensor"],
  "push button station":  ["push button", "pushbutton", "pushbutton station", "control station", "operator station"],
  "solenoid 2-pos":       ["2 position solenoid", "solenoid valve 2 pos", "solenoid valve", "solenoid"],
  "e-stop circuit":       ["emergency stop", "e-stop", "estop", "e stop circuit", "emergency stop circuit"],
  "stack light":          ["signal tower", "indicator light", "tower light", "signal light", "beacon"],
  "conveyor":             ["conveyor dol", "belt conveyor", "conveyor belt"],
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

  return 0.0;
}

// ---------------------------------------------------------------------------
// Combined scoring and matching
// ---------------------------------------------------------------------------

interface TemplateScore {
  template: FbTemplate;
  iScore: number;   // interface coverage 0–1
  nScore: number;   // name affinity 0–1
  combined: number; // weighted combination
}

function scoreTemplate(device: ForgeDeviceEntry, template: FbTemplate): TemplateScore {
  const iface = templateInterface(template);
  const iScore = interfaceScore(device, iface);
  const nScore = nameAffinity(device.device_type, template);

  // Interface is primary (60%), name is secondary (40%)
  // But if template has no SCL blocks yet, fall back to name-only
  const hasScl = (template.blocks?.length ?? 0) > 0;
  const combined = hasScl
    ? 0.6 * iScore + 0.4 * nScore
    : nScore;

  return { template, iScore, nScore, combined };
}

function confidenceFromScore(score: TemplateScore): "exact" | "probable" | "none" {
  // Exact: good interface fit AND name is related (safe to copy template as-is)
  if (score.combined >= 0.7 && score.nScore >= 0.3) return "exact";
  // Probable: reasonable fit by either metric
  if (score.combined >= 0.4 || score.nScore >= 0.5) return "probable";
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

export function matchDevicesToTemplates(
  devices: ForgeDeviceEntry[],
  templates: FbTemplate[],
): DeviceFbMatch[] {
  return devices.map((device): DeviceFbMatch => {
    if (templates.length === 0) {
      return { device, template: null, confidence: "none", reason: "No templates in library." };
    }

    // Score all templates for this device
    const scores: TemplateScore[] = templates.map(t => scoreTemplate(device, t));
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

export function suggestMissingDevices(devices: ForgeDeviceEntry[]): MissingDeviceSuggestion[] {
  const suggestions: MissingDeviceSuggestion[] = [];
  const typesLower = new Set(devices.map(d => (d.device_type ?? "").toLowerCase()));

  const hasConveyor = [...typesLower].some(t => t.includes("conveyor") || t.includes("belt"));

  if (!hasConveyor) {
    const conveyorMotors = devices.filter(
      d =>
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
