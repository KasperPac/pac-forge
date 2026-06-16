import type { HmiFaceplateProperty } from "./hmi-screen";
import type { OpenLibraryFaceplate } from "@/lib/open-library-catalog";

// ---------------------------------------------------------------------------
// Panel family — Comfort (legacy / V18 projects) + Unified (V20 pivot)
// ---------------------------------------------------------------------------

export const HMI_PANEL_FAMILIES = {
  COMFORT: "comfort",
  UNIFIED: "unified",
} as const;

export type HmiPanelFamily =
  (typeof HMI_PANEL_FAMILIES)[keyof typeof HMI_PANEL_FAMILIES];

// ---------------------------------------------------------------------------
// HMI Template Suite themes (Unified only, V20+)
// ---------------------------------------------------------------------------

export const HMI_UNIFIED_THEMES = {
  SIEMENS_LIGHT: "SiemensLight",
  SIEMENS_DARK: "SiemensDark",
  DEEP_BLUE: "DeepBlue",
} as const;

export type HmiUnifiedTheme =
  (typeof HMI_UNIFIED_THEMES)[keyof typeof HMI_UNIFIED_THEMES];

export const HMI_UNIFIED_THEME_LABELS: Record<HmiUnifiedTheme, string> = {
  SiemensLight: "Siemens Light",
  SiemensDark: "Siemens Dark",
  DeepBlue: "Deep Blue",
};

export const DEFAULT_UNIFIED_THEME: HmiUnifiedTheme = "SiemensLight";

// ---------------------------------------------------------------------------
// Panel models with native resolutions
// ---------------------------------------------------------------------------

export interface HmiPanelModel {
  id: string;
  label: string;
  family: HmiPanelFamily;
  screenWidth: number;
  screenHeight: number;
  supportsScreenWindows: boolean;
  supportsFaceplates: boolean;
}

export const HMI_COMFORT_PANELS: HmiPanelModel[] = [
  { id: "TP700",  label: "TP700 Comfort",  family: "comfort", screenWidth: 800,  screenHeight: 480,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "TP900",  label: "TP900 Comfort",  family: "comfort", screenWidth: 1024, screenHeight: 600,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "TP1200", label: "TP1200 Comfort", family: "comfort", screenWidth: 1280, screenHeight: 800,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "TP1500", label: "TP1500 Comfort", family: "comfort", screenWidth: 1920, screenHeight: 1080, supportsScreenWindows: true, supportsFaceplates: true },
  { id: "TP2200", label: "TP2200 Comfort", family: "comfort", screenWidth: 1920, screenHeight: 1080, supportsScreenWindows: true, supportsFaceplates: true },
];

/**
 * WinCC Unified panel models supported by the HMI Template Suite V6.0 (V20).
 * Covers the two targets chosen for Pac-Forge: Unified Comfort Panel hardware
 * (MTP700–MTP2200) and PC Station running WinCC Unified PC Runtime.
 * Resolutions match Template Suite's pre-configured panel folders:
 * 800×480, 1280×800, 1366×768, 1920×1080.
 */
export const HMI_UNIFIED_PANELS: HmiPanelModel[] = [
  // Unified Comfort Panels (physical hardware)
  { id: "MTP700_UNIFIED",  label: "MTP700 Unified Comfort",  family: "unified", screenWidth: 800,  screenHeight: 480,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "MTP1000_UNIFIED", label: "MTP1000 Unified Comfort", family: "unified", screenWidth: 1280, screenHeight: 800,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "MTP1200_UNIFIED", label: "MTP1200 Unified Comfort", family: "unified", screenWidth: 1280, screenHeight: 800,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "MTP1500_UNIFIED", label: "MTP1500 Unified Comfort", family: "unified", screenWidth: 1366, screenHeight: 768,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "MTP1900_UNIFIED", label: "MTP1900 Unified Comfort", family: "unified", screenWidth: 1920, screenHeight: 1080, supportsScreenWindows: true, supportsFaceplates: true },
  { id: "MTP2200_UNIFIED", label: "MTP2200 Unified Comfort", family: "unified", screenWidth: 1920, screenHeight: 1080, supportsScreenWindows: true, supportsFaceplates: true },
  // PC Station running WinCC Unified PC Runtime
  { id: "PC_STATION_800",  label: "PC Station (800×480)",   family: "unified", screenWidth: 800,  screenHeight: 480,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "PC_STATION_1280", label: "PC Station (1280×800)",  family: "unified", screenWidth: 1280, screenHeight: 800,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "PC_STATION_1366", label: "PC Station (1366×768)",  family: "unified", screenWidth: 1366, screenHeight: 768,  supportsScreenWindows: true, supportsFaceplates: true },
  { id: "PC_STATION_1920", label: "PC Station (1920×1080)", family: "unified", screenWidth: 1920, screenHeight: 1080, supportsScreenWindows: true, supportsFaceplates: true },
];

export function getPanelModels(family: HmiPanelFamily): HmiPanelModel[] {
  return family === "comfort" ? HMI_COMFORT_PANELS : HMI_UNIFIED_PANELS;
}

export function findPanelModel(
  family: HmiPanelFamily,
  id: string,
): HmiPanelModel | undefined {
  return getPanelModels(family).find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Panel config — stored on the forge session
// ---------------------------------------------------------------------------

export interface HmiPanelConfig {
  family: HmiPanelFamily;
  panelModel: string;
  screenWidth: number;
  screenHeight: number;
  supportsScreenWindows: boolean;
  supportsFaceplates: boolean;
  /** Template Suite theme — meaningful only when family === "unified". */
  theme?: HmiUnifiedTheme;
}

export function buildPanelConfig(
  model: HmiPanelModel,
  theme?: HmiUnifiedTheme,
): HmiPanelConfig {
  return {
    family: model.family,
    panelModel: model.id,
    screenWidth: model.screenWidth,
    screenHeight: model.screenHeight,
    supportsScreenWindows: model.supportsScreenWindows,
    supportsFaceplates: model.supportsFaceplates,
    theme: model.family === "unified" ? (theme ?? DEFAULT_UNIFIED_THEME) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Screen categories — what the wizard can generate
// ---------------------------------------------------------------------------

export const HMI_SCREEN_CATEGORIES = {
  FRAMEWORK: "framework",
  OVERVIEW: "overview",
  SUBSYSTEM_CHECKLIST: "unit_checklist",
  DEVICE_CHECKLIST: "device_checklist",
  DEVICE_FACEPLATE: "device_faceplate",
  ALARM_SUMMARY: "alarm_summary",
  TREND: "trend",
  CUSTOM: "custom",
} as const;

export type HmiScreenCategory =
  (typeof HMI_SCREEN_CATEGORIES)[keyof typeof HMI_SCREEN_CATEGORIES];

export const HMI_SCREEN_CATEGORY_LABELS: Record<HmiScreenCategory, string> = {
  framework: "Framework / Navigation",
  overview: "Plant Overview",
  unit_checklist: "Unit Checklists",
  device_checklist: "Device Checklists",
  device_faceplate: "Device Faceplates",
  alarm_summary: "Alarm Summary",
  trend: "Trends",
  custom: "Custom Screens",
};

/** Categories that are always generated (cannot be deselected) */
export const REQUIRED_SCREEN_CATEGORIES: HmiScreenCategory[] = [
  "framework",
  "overview",
];

/** Categories generated deterministically (no AI) */
export const DETERMINISTIC_CATEGORIES: HmiScreenCategory[] = [
  "framework",
  "overview",
  "unit_checklist",
  "device_checklist",
];

/** Categories that require AI generation */
export const AI_CATEGORIES: HmiScreenCategory[] = [
  "device_faceplate",
  "alarm_summary",
  "trend",
  "custom",
];

// ---------------------------------------------------------------------------
// Faceplate catalog — maps device types to faceplate type names
// ---------------------------------------------------------------------------

export interface FaceplateCatalogEntry {
  /** Device type string, e.g. "Motor DOL" */
  deviceType: string;
  /** Faceplate type name used in the generated HMI — from library if matched, else algorithmic */
  faceplateTypeName: string;
  /** FB template this was derived from (null if no match) */
  fbTemplateId: string | null;
  /** Library name if from an imported library, e.g. "Open Library V19 Unified" */
  libraryName: string | null;
  /** Interface properties derived from the FB's VAR_INPUT/OUTPUT/IN_OUT */
  interfaceProperties: HmiFaceplateProperty[];
  /** Default faceplate width in pixels */
  defaultWidth: number;
  /** Default faceplate height in pixels */
  defaultHeight: number;
  /** Where the faceplate type name came from. Phase 5-lite flags "algorithmic" entries. */
  source: "open-library" | "fb-template" | "algorithmic";
  /** Full Open Library metadata when source is "open-library" — includes paired FB, UDT, popup companion. */
  openLibraryFaceplate: OpenLibraryFaceplate | null;
}
