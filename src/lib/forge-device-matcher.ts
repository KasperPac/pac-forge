/**
 * forge-device-matcher.ts
 * Deterministic matching of devices from spec analysis to FB library templates.
 * No AI involved — rule-based matching with confidence scoring.
 */

import type { ForgeDeviceEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface DeviceFbMatch {
  device: ForgeDeviceEntry;
  template: FbTemplate | null;
  confidence: "exact" | "probable" | "none";
  reason: string;
}

// Normalise a string for comparison: lowercase, strip punctuation/spaces.
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Word-order-independent normalisation: sort words alphabetically.
function normaliseWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

// Canonical form for a device type: normalise + look up synonym map.
const DEVICE_TYPE_SYNONYMS: Record<string, string[]> = {
  "motor dol": ["dol motor", "direct on line motor", "direct online motor"],
  "motor vfd": [
    "vfd motor",
    "variable frequency drive motor",
    "variable speed motor",
    "inverter motor",
  ],
  "photoelectric sensor": [
    "photoelectric",
    "photo sensor",
    "pe sensor",
    "photo eye",
    "photoeye",
    "optical sensor",
  ],
  "proximity sensor": [
    "proximity",
    "prox sensor",
    "inductive sensor",
    "inductive proximity sensor",
  ],
  "push button station": [
    "push button",
    "pushbutton",
    "pushbutton station",
    "control station",
    "operator station",
  ],
  "solenoid 2-pos": ["2 position solenoid", "solenoid valve 2 pos", "solenoid valve"],
  "e-stop circuit": [
    "emergency stop",
    "e-stop",
    "estop",
    "e stop circuit",
    "emergency stop circuit",
  ],
  "stack light": [
    "signal tower",
    "indicator light",
    "tower light",
    "signal light",
    "beacon",
  ],
  conveyor: ["conveyor dol", "belt conveyor", "conveyor belt"],
};

/** Resolve a device type string to its canonical synonym key, or null if no match. */
function toCanonical(s: string): string | null {
  const words = normaliseWords(s);
  for (const [canonical, synonyms] of Object.entries(DEVICE_TYPE_SYNONYMS)) {
    if (normaliseWords(canonical) === words) return canonical;
    if (synonyms.some((syn) => normaliseWords(syn) === words)) return canonical;
  }
  return null;
}

/**
 * Attempt exact match:
 * 1. Direct normalised string equality
 * 2. Word-order-independent equality
 * 3. Synonym resolution → canonical match
 */
function exactMatch(
  deviceType: string,
  templates: FbTemplate[],
): FbTemplate | null {
  const normD = normalise(deviceType);
  const wordsD = normaliseWords(deviceType);
  const canonicalD = toCanonical(deviceType);

  return (
    templates.find((t) => {
      const normT = normalise(t.device_category);
      if (normT === normD) return true;
      if (normaliseWords(t.device_category) === wordsD) return true;
      const canonicalT = toCanonical(t.device_category);
      if (canonicalD && canonicalT && canonicalD === canonicalT) return true;
      return false;
    }) ?? null
  );
}

/**
 * Attempt probable match: device_type is a substring of category, or vice-versa.
 * Also checks template tags for partial matches.
 */
function probableMatch(
  deviceType: string,
  templates: FbTemplate[],
): FbTemplate | null {
  const norm = normalise(deviceType);

  // Substring containment
  const bySubstring = templates.find((t) => {
    const cat = normalise(t.device_category);
    return cat.includes(norm) || norm.includes(cat);
  });
  if (bySubstring) return bySubstring;

  // Tag match — any template tag matches the device type
  const byTag = templates.find((t) =>
    t.tags.some((tag) => {
      const tagNorm = normalise(tag);
      return tagNorm.includes(norm) || norm.includes(tagNorm);
    }),
  );
  return byTag ?? null;
}

/**
 * Match a list of devices to FB templates.
 * Results include confidence level and human-readable reason.
 */
export function matchDevicesToTemplates(
  devices: ForgeDeviceEntry[],
  templates: FbTemplate[],
): DeviceFbMatch[] {
  return devices.map((device): DeviceFbMatch => {
    // 1. Try exact match (direct, word-order, or synonym)
    const exact = exactMatch(device.device_type, templates);
    if (exact) {
      return {
        device,
        template: exact,
        confidence: "exact",
        reason: `Device type "${device.device_type}" matches template category "${exact.device_category}" exactly.`,
      };
    }

    // 2. Try probable match
    const probable = probableMatch(device.device_type, templates);
    if (probable) {
      return {
        device,
        template: probable,
        confidence: "probable",
        reason: `Device type "${device.device_type}" partially matches template "${probable.name}" (category: "${probable.device_category}"). Review before generating.`,
      };
    }

    // 3. No match
    return {
      device,
      template: null,
      confidence: "none",
      reason: `No FB template found for device type "${device.device_type}". AI will generate a new FB.`,
    };
  });
}

/**
 * Apply match results back to a device list — sets fb_template_id and fb_match_confidence.
 * Returns new device entries (does not mutate input).
 */
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
// Missing device suggestions
// ---------------------------------------------------------------------------

export interface MissingDeviceSuggestion {
  suggestedType: string;
  suggestedName: string;
  suggestedTag: string;
  reason: string;
}

/**
 * Identify device types that are likely missing from the device list based on
 * what IS present. Returns non-blocking suggestions for the engineer to review.
 */
export function suggestMissingDevices(
  devices: ForgeDeviceEntry[],
): MissingDeviceSuggestion[] {
  const suggestions: MissingDeviceSuggestion[] = [];
  const typesLower = new Set(devices.map((d) => d.device_type.toLowerCase()));

  const hasConveyor = [...typesLower].some(
    (t) => t.includes("conveyor") || t.includes("belt"),
  );

  // Motors described as driving conveyors → suggest Conveyor devices
  if (!hasConveyor) {
    const conveyorMotors = devices.filter(
      (d) =>
        d.device_type.toLowerCase().includes("motor") &&
        (d.description.toLowerCase().includes("conveyor") ||
          d.description.toLowerCase().includes("belt") ||
          d.name.toLowerCase().startsWith("cv") ||
          d.tag.toLowerCase().startsWith("cv")),
    );

    for (const motor of conveyorMotors) {
      const num = motor.tag.match(/\d+/)?.[0] ?? "";
      suggestions.push({
        suggestedType: "Conveyor",
        suggestedName: `CV${num}`,
        suggestedTag: `CV${num}`,
        reason: `Motor "${motor.tag}" drives a conveyor. Add a Conveyor device for direction control, sensor monitoring, and jam detection. Conveyor FB and Motor FB are separate peers — the Matrix defines how they connect.`,
      });
    }
  }

  return suggestions;
}
