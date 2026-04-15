/**
 * hmi-faceplate-catalog.ts
 *
 * Derives a faceplate catalog from the device list and FB template library.
 * Each device type gets a deterministic faceplate type name and interface
 * properties extracted from the matched FB's VAR sections.
 *
 * Pure functions — no side effects, no React hooks.
 */

import type { HmiFaceplateProperty } from "@/types/hmi-screen";
import type { FaceplateCatalogEntry } from "@/types/hmi-panel";
import type { ForgeDeviceEntry } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import { findOpenLibraryFaceplate } from "@/lib/open-library-catalog";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a faceplate catalog from the device list and available FB templates.
 * Returns one entry per unique device_type.
 *
 * Resolution order for each device type (highest priority first):
 *   1. Open Library V19 Unified match (52 curated faceplates)
 *   2. FB template's `hmi_faceplate_type` field (if a project-specific library FB matched)
 *   3. Algorithmic name ("FP_" + pascalCase device type) — Phase 5-lite fallback
 *
 * When Phase 5-lite kicks in (no library match), the UI should surface a warning
 * so the engineer can supply a manual override.
 */
export function buildFaceplateCatalog(
  devices: ForgeDeviceEntry[],
  templates: FbTemplate[],
): FaceplateCatalogEntry[] {
  const templateMap = new Map(templates.map((t) => [t.id, t]));
  const seen = new Map<string, FaceplateCatalogEntry>();

  for (const device of devices) {
    if (seen.has(device.device_type)) continue;

    const template = device.fb_template_id
      ? templateMap.get(device.fb_template_id)
      : undefined;

    const openLibraryMatch = findOpenLibraryFaceplate(device.device_type);

    const interfaceProperties = template
      ? extractInterfaceProperties(template)
      : defaultPropertiesForDevice(device);

    const propertyCount = interfaceProperties.length;

    // Resolve faceplate name in priority order
    const faceplateTypeName =
      openLibraryMatch?.name ??
      template?.hmi_faceplate_type ??
      buildFaceplateTypeName(device.device_type);

    const libraryName =
      openLibraryMatch ? "Open Library V19 Unified" :
      template?.library_name ?? null;

    seen.set(device.device_type, {
      deviceType: device.device_type,
      faceplateTypeName,
      fbTemplateId: template?.id ?? null,
      libraryName,
      interfaceProperties,
      defaultWidth: Math.max(200, Math.min(400, 120 + propertyCount * 28)),
      defaultHeight: Math.max(150, Math.min(350, 80 + propertyCount * 24)),
      source: openLibraryMatch ? "open-library" : template ? "fb-template" : "algorithmic",
      openLibraryFaceplate: openLibraryMatch,
    });
  }

  return [...seen.values()];
}

/**
 * Return the device types in the list that have NO library match and NO FB template.
 * Phase 5-lite: the UI surfaces these as warnings so the engineer supplies a manual override.
 */
export function getUnmatchedDeviceTypes(
  catalog: FaceplateCatalogEntry[],
): FaceplateCatalogEntry[] {
  return catalog.filter((e) => e.source === "algorithmic");
}

/**
 * Generate a deterministic faceplate type name from a device type string.
 * e.g. "Motor DOL" → "FP_MotorDOL", "Solenoid Valve 2-pos" → "FP_SolenoidValve2pos"
 */
export function buildFaceplateTypeName(deviceType: string): string {
  const cleaned = deviceType
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  return `FP_${cleaned}`;
}

// ---------------------------------------------------------------------------
// Interface extraction from FB template SCL
// ---------------------------------------------------------------------------

interface VarEntry {
  name: string;
  dataType: string;
  direction: "In" | "Out" | "InOut";
  description: string;
}

const VAR_SECTION_PATTERN =
  /VAR_(INPUT|OUTPUT|IN_OUT)\b([\s\S]*?)END_VAR/gi;

const VAR_LINE_PATTERN =
  /^\s*(\w+)\s*:\s*([^;/]+)/;

const COMMENT_PATTERN = /\/\/\s*(.+)/;

/**
 * Extract faceplate interface properties from the main FB block of a template.
 * Parses VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT sections from SCL source.
 */
function extractInterfaceProperties(template: FbTemplate): HmiFaceplateProperty[] {
  const mainFb = template.blocks?.find((b) => b.block_type === "FB");
  if (!mainFb) return [];

  const scl = mainFb.scl_code;
  const entries: VarEntry[] = [];

  let match: RegExpExecArray | null;
  const re = new RegExp(VAR_SECTION_PATTERN.source, "gi");

  while ((match = re.exec(scl)) !== null) {
    const sectionType = match[1].toUpperCase();
    const direction: VarEntry["direction"] =
      sectionType === "INPUT" ? "In" :
      sectionType === "OUTPUT" ? "Out" : "InOut";

    const body = match[2];
    for (const line of body.split("\n")) {
      const varMatch = line.match(VAR_LINE_PATTERN);
      if (!varMatch) continue;

      const name = varMatch[1].trim();
      const dataType = varMatch[2].trim();
      const commentMatch = line.match(COMMENT_PATTERN);

      // Skip internal/stat-like variables that shouldn't be on faceplate
      if (isInternalVar(name)) continue;

      entries.push({
        name,
        dataType,
        direction,
        description: commentMatch?.[1]?.trim() ?? "",
      });
    }
  }

  return entries.map(varEntryToFaceplateProperty);
}

/**
 * Heuristic: skip variables that are likely internal (timers, counters, state).
 * These shouldn't appear as faceplate interface properties.
 */
function isInternalVar(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith("stat") ||
    lower.startsWith("inst") ||
    lower.startsWith("temp") ||
    lower === "execute" ||
    lower === "enable"
  );
}

function varEntryToFaceplateProperty(entry: VarEntry): HmiFaceplateProperty {
  return {
    name: entry.name,
    direction: entry.direction,
    dataType: mapSclToHmiDataType(entry.dataType),
    description: entry.description || undefined,
  };
}

/**
 * Map SCL data types to HMI tag data types.
 * Defaults to "Word" for unrecognised types (safe WinCC fallback).
 */
function mapSclToHmiDataType(
  sclType: string,
): HmiFaceplateProperty["dataType"] {
  const t = sclType.trim().toUpperCase();
  if (t === "BOOL") return "Bool";
  if (t === "INT") return "Int";
  if (t === "SINT") return "SInt";
  if (t === "USINT") return "USInt";
  if (t === "UINT") return "UInt";
  if (t === "DINT") return "DInt";
  if (t === "UDINT") return "UDInt";
  if (t === "REAL") return "Real";
  if (t === "LREAL") return "LReal";
  if (t === "WORD") return "Word";
  if (t === "DWORD") return "DWord";
  if (t === "STRING" || t.startsWith("STRING[")) return "String";
  if (t === "WSTRING" || t.startsWith("WSTRING[")) return "WString";
  if (t === "TIME") return "Time";
  if (t === "BYTE") return "Byte";
  if (t === "DATE_AND_TIME" || t === "DT") return "Date_And_Time";
  // UDTs and complex types — default to Word (safe WinCC fallback)
  return "Word";
}

// ---------------------------------------------------------------------------
// Fallback: default properties when no FB template is matched
// ---------------------------------------------------------------------------

/**
 * Generate minimal faceplate properties from the device's IO signals.
 * Used when a device has no matched FB template.
 */
function defaultPropertiesForDevice(
  device: ForgeDeviceEntry,
): HmiFaceplateProperty[] {
  return device.io_signals.map((signal) => ({
    name: signal.tag_name,
    direction: signal.signal_type === "DI" || signal.signal_type === "AI"
      ? "In" as const
      : "Out" as const,
    dataType: signal.signal_type === "AI" || signal.signal_type === "AQ"
      ? "Real" as const
      : "Bool" as const,
    description: signal.description || undefined,
  }));
}
