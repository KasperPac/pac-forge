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

/**
 * Attempt exact match: device_type normalised === template device_category normalised.
 */
function exactMatch(
  deviceType: string,
  templates: FbTemplate[],
): FbTemplate | null {
  const norm = normalise(deviceType);
  return (
    templates.find((t) => normalise(t.device_category) === norm) ?? null
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
    // 1. Try exact match on device_type vs device_category
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
