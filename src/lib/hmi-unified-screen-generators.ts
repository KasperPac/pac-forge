/**
 * hmi-unified-screen-generators.ts
 *
 * Deterministic screen generators for WinCC Unified (V20+).
 *
 * Produces HmiUnifiedScreenPayload objects that the bridge consumes via
 * POST /tia/hmi/create-screen. No AI involvement — pure layout math driven by
 * the panel configuration, device list, and Open Library faceplate catalog.
 *
 * Unlike the Comfort generators (hmi-screen-generators.ts) which emit full
 * chrome (title bar, nav, status bar), these Unified generators assume the
 * HMI Template Suite wizard has already provided the chrome via 1001_ScreenLayout.
 * Pac-Forge-generated screens populate the MainWindow content area only and
 * are loaded into it via the swSubNavContent screen window.
 */

import type { HmiPanelConfig } from "@/types/hmi-panel";
import type { FaceplateCatalogEntry } from "@/types/hmi-panel";
import type { ForgeDeviceEntry, SpecAnalysis } from "@/types/forge";
import {
  makeText,
  makeFaceplateContainer,
  buildUnifiedScreenPayload,
} from "./hmi-unified-payload-builder";
import type {
  HmiUnifiedScreenPayload,
  HmiUnifiedItemPayload,
} from "./hmi-unified-payload-builder";
import { getContentRect, HMI_NAV_LEVELS, HMI_TEMPLATE_DESIGN } from "./hmi-unified-structure";
import type { HmiNavLevel } from "./hmi-unified-structure";
import { buildDeviceFaceplateBinding } from "./hmi-tag-mapper";
import type { FaceplateTagBinding } from "./hmi-tag-mapper";

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pack items into a fixed-size grid within a bounding rect. */
function layoutGrid(
  count: number,
  area: Rect,
  itemWidth: number,
  itemHeight: number,
  spacing: number,
): Array<{ x: number; y: number }> {
  const cols = Math.max(1, Math.floor((area.width + spacing) / (itemWidth + spacing)));
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: area.x + col * (itemWidth + spacing),
      y: area.y + row * (itemHeight + spacing),
    });
  }
  return positions;
}

/** Snap a value to the 8-pixel Template Suite grid. */
function snap(value: number): number {
  const grid = HMI_TEMPLATE_DESIGN.GRID_PX;
  return Math.round(value / grid) * grid;
}

// ---------------------------------------------------------------------------
// Shared screen-level options
// ---------------------------------------------------------------------------

export interface UnifiedScreenGeneratorOptions {
  /** Target panel config (drives screen dimensions and theme) */
  panel: HmiPanelConfig;
  /** Which navigation levels are visible — affects the MainWindow content rect */
  visibleNavLevels?: Set<HmiNavLevel>;
  /** Optional folder path in the Unified project's Screens tree */
  folderPath?: string;
  /** Spacing in pixels between faceplate tiles */
  tileSpacing?: number;
  /** Default faceplate width when no catalog width provided */
  defaultFaceplateWidth?: number;
  /** Default faceplate height when no catalog width provided */
  defaultFaceplateHeight?: number;
}

const DEFAULT_OPTIONS: Required<Omit<UnifiedScreenGeneratorOptions, "panel" | "folderPath">> = {
  visibleNavLevels: new Set<HmiNavLevel>([HMI_NAV_LEVELS.MAIN, HMI_NAV_LEVELS.SUB]),
  tileSpacing: 16,
  defaultFaceplateWidth: 240,
  defaultFaceplateHeight: 160,
};

function resolveOpts(opts: UnifiedScreenGeneratorOptions): Required<Omit<UnifiedScreenGeneratorOptions, "panel" | "folderPath">> & { panel: HmiPanelConfig; folderPath?: string } {
  return {
    panel: opts.panel,
    folderPath: opts.folderPath,
    visibleNavLevels: opts.visibleNavLevels ?? DEFAULT_OPTIONS.visibleNavLevels,
    tileSpacing: opts.tileSpacing ?? DEFAULT_OPTIONS.tileSpacing,
    defaultFaceplateWidth: opts.defaultFaceplateWidth ?? DEFAULT_OPTIONS.defaultFaceplateWidth,
    defaultFaceplateHeight: opts.defaultFaceplateHeight ?? DEFAULT_OPTIONS.defaultFaceplateHeight,
  };
}

// ---------------------------------------------------------------------------
// 1. Overview screen — grid of all device faceplates
// ---------------------------------------------------------------------------

export interface OverviewScreenInput extends UnifiedScreenGeneratorOptions {
  /** Screen name in TIA. Will be used as-is in the project tree. */
  screenName: string;
  /** Screen title shown in the header text of the generated content */
  title: string;
  /** Devices to render */
  devices: ForgeDeviceEntry[];
  /** Faceplate catalog (produced by buildFaceplateCatalog) */
  catalog: FaceplateCatalogEntry[];
  /** Optional screen number for ActivateScreen() navigation */
  screenNumber?: number;
}

/**
 * Plant overview screen — one faceplate tile per device, packed into a grid
 * that fits the Template Suite MainWindow content rect.
 *
 * Devices without an Open Library faceplate match are skipped (Phase 5-lite warning
 * from getUnmatchedDeviceTypes handles the warning elsewhere in the UI).
 */
export function generateUnifiedOverviewScreen(input: OverviewScreenInput): HmiUnifiedScreenPayload {
  const opts = resolveOpts(input);
  const contentRect = getContentRect(opts.panel, opts.visibleNavLevels);

  // Reserve a header strip for the title
  const headerHeight = 48;
  const titleBand: Rect = {
    x: contentRect.x + 16,
    y: contentRect.y + 16,
    width: contentRect.width - 32,
    height: headerHeight,
  };
  const grid: Rect = {
    x: contentRect.x + 16,
    y: titleBand.y + titleBand.height + 16,
    width: contentRect.width - 32,
    height: contentRect.height - (titleBand.height + 48),
  };

  const items: HmiUnifiedItemPayload[] = [];

  // Title text
  items.push(
    makeText({
      name: "txtScreenTitle",
      left: titleBand.x,
      top: titleBand.y,
      width: titleBand.width,
      height: titleBand.height,
      text: input.title,
      font: { size: 24, bold: true },
      foreColor: "Black",
    }),
  );

  // Build device bindings (skip devices without Open Library match)
  const catalogByType = new Map(input.catalog.map((c) => [c.deviceType, c]));
  const deviceBindings: Array<{ device: ForgeDeviceEntry; binding: FaceplateTagBinding }> = [];
  for (const device of input.devices) {
    const entry = catalogByType.get(device.device_type);
    if (!entry) continue;
    const binding = buildDeviceFaceplateBinding(device, entry);
    if (!binding) continue;
    deviceBindings.push({ device, binding });
  }

  // Layout grid
  const positions = layoutGrid(
    deviceBindings.length,
    grid,
    opts.defaultFaceplateWidth,
    opts.defaultFaceplateHeight,
    opts.tileSpacing,
  );

  // Place faceplate containers
  for (let i = 0; i < deviceBindings.length; i++) {
    const { device, binding } = deviceBindings[i];
    const pos = positions[i];
    items.push(
      makeFaceplateContainer({
        name: `fp${sanitizeName(device.name)}`,
        left: snap(pos.x),
        top: snap(pos.y),
        width: opts.defaultFaceplateWidth,
        height: opts.defaultFaceplateHeight,
        faceplateType: binding.faceplateType,
        tagBinding: binding,
      }),
    );
  }

  return buildUnifiedScreenPayload({
    name: input.screenName,
    panel: opts.panel,
    screenNumber: input.screenNumber,
    folderPath: opts.folderPath,
    items,
  });
}

// ---------------------------------------------------------------------------
// 2. Subsystem screen — one screen per subsystem with its devices
// ---------------------------------------------------------------------------

export interface SubsystemScreenInput extends UnifiedScreenGeneratorOptions {
  screenName: string;
  subsystemName: string;
  devices: ForgeDeviceEntry[];
  catalog: FaceplateCatalogEntry[];
  screenNumber?: number;
}

export function generateUnifiedSubsystemScreen(input: SubsystemScreenInput): HmiUnifiedScreenPayload {
  return generateUnifiedOverviewScreen({
    ...input,
    title: input.subsystemName,
  });
}

// ---------------------------------------------------------------------------
// 3. Device detail screen — single-device popup-style content
// ---------------------------------------------------------------------------

export interface DeviceDetailScreenInput extends UnifiedScreenGeneratorOptions {
  screenName: string;
  device: ForgeDeviceEntry;
  catalogEntry: FaceplateCatalogEntry;
  screenNumber?: number;
}

/**
 * Single-device detail screen. Places a large faceplate instance centered
 * in the MainWindow content area. Uses the device's popup faceplate variant
 * when one is registered in the Open Library catalog.
 */
export function generateUnifiedDeviceDetailScreen(
  input: DeviceDetailScreenInput,
): HmiUnifiedScreenPayload {
  const opts = resolveOpts(input);
  const contentRect = getContentRect(opts.panel, opts.visibleNavLevels);

  const binding = buildDeviceFaceplateBinding(input.device, input.catalogEntry);
  if (!binding) {
    // No library match — return an empty screen with a warning text
    return buildUnifiedScreenPayload({
      name: input.screenName,
      panel: opts.panel,
      screenNumber: input.screenNumber,
      folderPath: opts.folderPath,
      items: [
        makeText({
          name: "txtNoMatch",
          left: contentRect.x + 32,
          top: contentRect.y + 32,
          width: contentRect.width - 64,
          height: 48,
          text: `No Open Library faceplate for device type: ${input.device.device_type}`,
          font: { size: 18 },
          foreColor: "Red",
        }),
      ],
    });
  }

  // Prefer popup variant when available
  const openLib = input.catalogEntry.openLibraryFaceplate;
  const faceplateType = openLib?.companionPopup ?? binding.faceplateType;

  const fpWidth = snap(Math.min(contentRect.width - 64, 800));
  const fpHeight = snap(Math.min(contentRect.height - 64, 600));
  const fpLeft = snap(contentRect.x + (contentRect.width - fpWidth) / 2);
  const fpTop = snap(contentRect.y + (contentRect.height - fpHeight) / 2);

  return buildUnifiedScreenPayload({
    name: input.screenName,
    panel: opts.panel,
    screenNumber: input.screenNumber,
    folderPath: opts.folderPath,
    items: [
      makeText({
        name: "txtDeviceName",
        left: contentRect.x + 16,
        top: contentRect.y + 16,
        width: contentRect.width - 32,
        height: 40,
        text: `${input.device.name} — ${input.device.device_type}`,
        font: { size: 20, bold: true },
        foreColor: "Black",
      }),
      makeFaceplateContainer({
        name: `fp${sanitizeName(input.device.name)}`,
        left: fpLeft,
        top: fpTop,
        width: fpWidth,
        height: fpHeight,
        faceplateType,
        tagBinding: binding,
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// 4. Orchestrator — generate a full screen suite for a session
// ---------------------------------------------------------------------------

export interface GenerateScreenSuiteInput extends UnifiedScreenGeneratorOptions {
  /** Forge spec analysis for subsystem grouping */
  specAnalysis: SpecAnalysis | null;
  /** Full device list */
  devices: ForgeDeviceEntry[];
  /** Faceplate catalog from buildFaceplateCatalog */
  catalog: FaceplateCatalogEntry[];
  /** Project display name used for the top-level overview screen */
  projectName: string;
  /** Generate one detail screen per device (can be expensive for large plants) */
  includeDeviceDetails?: boolean;
}

export interface GeneratedScreenSuite {
  screens: HmiUnifiedScreenPayload[];
  /** Devices that had no Open Library match — Phase 5-lite warning surface */
  unmatchedDeviceTypes: string[];
}

/**
 * Produce a full deterministic Unified screen suite from session data.
 * Assigns screen numbers starting at 10 to avoid clashing with Template Suite's
 * reserved 1000–4000 range (layouts, nav, popups, other templates).
 */
export function generateUnifiedScreenSuite(input: GenerateScreenSuiteInput): GeneratedScreenSuite {
  const screens: HmiUnifiedScreenPayload[] = [];
  const catalogByType = new Map(input.catalog.map((c) => [c.deviceType, c]));
  let nextScreenNumber = 10;

  // 1. Plant overview (all devices)
  screens.push(
    generateUnifiedOverviewScreen({
      ...input,
      screenName: "pfOverview",
      title: `${input.projectName} — Overview`,
      screenNumber: nextScreenNumber++,
    }),
  );

  // 2. Per-subsystem screens
  const subsystems = input.specAnalysis?.subsystems ?? [];
  for (const subsystem of subsystems) {
    const subsystemDevices = input.devices.filter(
      (d) => d.subsystem === subsystem.name,
    );
    if (subsystemDevices.length === 0) continue;
    screens.push(
      generateUnifiedSubsystemScreen({
        ...input,
        screenName: `pfSubsystem_${sanitizeName(subsystem.name)}`,
        subsystemName: subsystem.name,
        devices: subsystemDevices,
        screenNumber: nextScreenNumber++,
      }),
    );
  }

  // 3. Per-device detail screens (optional — large plants may skip)
  if (input.includeDeviceDetails) {
    for (const device of input.devices) {
      const entry = catalogByType.get(device.device_type);
      if (!entry) continue;
      screens.push(
        generateUnifiedDeviceDetailScreen({
          ...input,
          screenName: `pfDevice_${sanitizeName(device.name)}`,
          device,
          catalogEntry: entry,
          screenNumber: nextScreenNumber++,
        }),
      );
    }
  }

  // 4. Collect unmatched device types for Phase 5-lite warnings
  const unmatchedSet = new Set<string>();
  for (const device of input.devices) {
    const entry = catalogByType.get(device.device_type);
    if (!entry || entry.source === "algorithmic") {
      unmatchedSet.add(device.device_type);
    }
  }

  return {
    screens,
    unmatchedDeviceTypes: [...unmatchedSet],
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
