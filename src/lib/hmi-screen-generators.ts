/**
 * hmi-screen-generators.ts
 *
 * Deterministic screen generators for WinCC Comfort HMI.
 * Each function produces an HmiScreenSpec from session data — no AI involved.
 * All position/size calculations use HmiPanelConfig dimensions.
 *
 * When Unified support is added, generators can branch on config.family.
 */

import type { HmiScreenSpec, HmiElement, HmiElementStyle } from "@/types/hmi-screen";
import type { HmiPanelConfig } from "@/types/hmi-panel";
import type { FaceplateCatalogEntry } from "@/types/hmi-panel";
import type { ForgeControlModuleEntry, ForgeIoEntry, SpecAnalysis } from "@/types/forge";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++_idCounter}`;
}

/** Reset ID counter (call before generating a full suite) */
export function resetIdCounter(): void {
  _idCounter = 0;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pack items into a grid within a bounding rect. */
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

function makeText(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<HmiElementStyle> = {},
): HmiElement {
  return {
    id,
    type: "TEXT",
    name: id,
    x, y, width, height,
    zIndex: 1,
    text,
    style: {
      backgroundColor: "transparent",
      textColor: "#FFFFFF",
      fontSize: 14,
      fontWeight: "normal",
      textAlign: "left",
      ...style,
    },
  };
}

function makeButton(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  navigateTo?: string,
): HmiElement {
  return {
    id,
    type: "BUTTON",
    name: id,
    x, y, width, height,
    zIndex: 2,
    text,
    navigateTo,
    style: {
      backgroundColor: "#3A3A3A",
      borderColor: "#555555",
      borderWidth: 1,
      textColor: "#FFFFFF",
      fontSize: 12,
      fontWeight: "normal",
      textAlign: "center",
    },
  };
}

function makeRect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: string,
): HmiElement {
  return {
    id,
    type: "RECTANGLE",
    name: id,
    x, y, width, height,
    zIndex: 0,
    style: {
      backgroundColor: bgColor,
      borderColor: "#444444",
      borderWidth: 1,
    },
  };
}

function makeIoField(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  tagBinding: string,
  mode: "input" | "output" | "input_output" = "output",
): HmiElement {
  return {
    id,
    type: "IO_FIELD",
    name: id,
    x, y, width, height,
    zIndex: 2,
    tagBinding,
    ioFieldMode: mode,
    style: {
      backgroundColor: "#2A2A2A",
      borderColor: "#555555",
      borderWidth: 1,
      textColor: "#00FF00",
      fontSize: 12,
      textAlign: "center",
    },
  };
}

function makeCircleIndicator(
  id: string,
  x: number,
  y: number,
  size: number,
  tagBinding?: string,
): HmiElement {
  return {
    id,
    type: "CIRCLE",
    name: id,
    x, y,
    width: size,
    height: size,
    zIndex: 2,
    tagBinding,
    style: {
      backgroundColor: "#444444",
      borderColor: "#666666",
      borderWidth: 1,
    },
    animations: tagBinding
      ? [{
          type: "APPEARANCE",
          tagName: tagBinding,
          colorMap: [
            { value: 0, color: "#444444" },
            { value: 1, color: "#00CC00" },
          ],
        }]
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Screen layout constants (Comfort panels)
// ---------------------------------------------------------------------------

const HEADER_HEIGHT = 50;
const FOOTER_HEIGHT = 40;
const NAV_BUTTON_HEIGHT = 36;
const NAV_BUTTON_WIDTH = 140;
const NAV_BUTTON_SPACING = 4;
const SECTION_HEADER_HEIGHT = 28;
const ROW_HEIGHT = 30;
const PADDING = 10;

function contentArea(config: HmiPanelConfig): Rect {
  return {
    x: PADDING,
    y: HEADER_HEIGHT + PADDING,
    width: config.screenWidth - PADDING * 2,
    height: config.screenHeight - HEADER_HEIGHT - FOOTER_HEIGHT - PADDING * 2,
  };
}

// ---------------------------------------------------------------------------
// 1. Framework / Navigation Screen
// ---------------------------------------------------------------------------

/**
 * Generate the template shell screen with header, navigation bar,
 * content window, and status footer.
 */
export function generateFrameworkScreen(
  config: HmiPanelConfig,
  projectName: string,
  screenNames: string[],
): HmiScreenSpec {
  const elements: HmiElement[] = [];

  // Header background
  elements.push(makeRect(
    nextId("hdr_bg"), 0, 0, config.screenWidth, HEADER_HEIGHT, "#1A1A2E",
  ));

  // Project name
  elements.push(makeText(
    nextId("hdr_title"), projectName,
    PADDING, 8, 400, 30,
    { fontSize: 18, fontWeight: "bold", textColor: "#E0E0E0" },
  ));

  // Date/Time display
  elements.push({
    id: nextId("hdr_dt"),
    type: "DATE_TIME",
    name: "DateTime",
    x: config.screenWidth - 200,
    y: 10,
    width: 180,
    height: 28,
    zIndex: 2,
    dateTimeFormat: "yyyy-MM-dd HH:mm:ss",
    style: {
      backgroundColor: "transparent",
      textColor: "#AAAAAA",
      fontSize: 12,
      textAlign: "right",
    },
  });

  // Navigation button bar
  const navY = HEADER_HEIGHT + 4;
  const maxButtons = Math.floor(
    (config.screenWidth - PADDING * 2) / (NAV_BUTTON_WIDTH + NAV_BUTTON_SPACING),
  );

  screenNames.slice(0, maxButtons).forEach((screenName, i) => {
    elements.push(makeButton(
      nextId("nav_btn"),
      screenName,
      PADDING + i * (NAV_BUTTON_WIDTH + NAV_BUTTON_SPACING),
      navY,
      NAV_BUTTON_WIDTH,
      NAV_BUTTON_HEIGHT,
      screenName,
    ));
  });

  // Content area — screen window for embedded screens
  const contentY = navY + NAV_BUTTON_HEIGHT + 6;
  const contentH = config.screenHeight - contentY - FOOTER_HEIGHT - 4;

  elements.push({
    id: nextId("content_win"),
    type: "SCREEN_WINDOW",
    name: "ContentWindow",
    x: 0,
    y: contentY,
    width: config.screenWidth,
    height: contentH,
    zIndex: 1,
    screenWindowName: screenNames[0] ?? "",
    style: {
      backgroundColor: "#1E1E1E",
      borderColor: "#333333",
      borderWidth: 1,
    },
  });

  // Footer background
  const footerY = config.screenHeight - FOOTER_HEIGHT;
  elements.push(makeRect(
    nextId("ftr_bg"), 0, footerY, config.screenWidth, FOOTER_HEIGHT, "#1A1A2E",
  ));

  // Footer: connection status placeholder
  elements.push(makeText(
    nextId("ftr_status"), "PLC: Online",
    PADDING, footerY + 10, 150, 20,
    { fontSize: 11, textColor: "#00CC00" },
  ));

  // Footer: alarm banner area
  elements.push(makeText(
    nextId("ftr_alarm"), "No active alarms",
    200, footerY + 10, config.screenWidth - 400, 20,
    { fontSize: 11, textColor: "#888888", textAlign: "center" },
  ));

  return {
    id: nextId("screen"),
    name: "Framework",
    width: config.screenWidth,
    height: config.screenHeight,
    backgroundColor: "#1E1E1E",
    elements,
    screenRole: "template_shell",
    screenNumber: 1,
  };
}

// ---------------------------------------------------------------------------
// 2. Plant Overview Screen
// ---------------------------------------------------------------------------

/**
 * Generate the plant overview screen showing all units
 * with device faceplate placeholders.
 */
export function generateOverviewScreen(
  config: HmiPanelConfig,
  specAnalysis: SpecAnalysis,
  control_modules: ForgeControlModuleEntry[],
  catalog: FaceplateCatalogEntry[],
): HmiScreenSpec {
  const elements: HmiElement[] = [];
  const area = contentArea(config);
  const catalogMap = new Map(catalog.map((c) => [c.deviceType, c]));
  const units = specAnalysis.units;

  // Screen title
  elements.push(makeText(
    nextId("ov_title"), "Plant Overview",
    area.x, area.y, area.width, 30,
    { fontSize: 16, fontWeight: "bold", textColor: "#E0E0E0", textAlign: "center" },
  ));

  // Divide area into unit zones
  const zoneHeight = units.length > 0
    ? Math.floor((area.height - 40) / Math.min(units.length, 4))
    : area.height - 40;
  const zoneWidth = area.width;

  units.forEach((sub, si) => {
    const zoneY = area.y + 36 + si * zoneHeight;
    if (zoneY + 40 > area.y + area.height) return; // overflow guard

    // Subsystem header bar
    elements.push(makeRect(
      nextId("ov_zone_bg"), area.x, zoneY, zoneWidth, SECTION_HEADER_HEIGHT, "#252540",
    ));
    elements.push(makeText(
      nextId("ov_zone_hdr"), sub.name,
      area.x + 8, zoneY + 4, zoneWidth - 16, 20,
      { fontSize: 13, fontWeight: "bold", textColor: "#CCCCFF" },
    ));

    // Devices in this unit
    const subDevices = control_modules.filter((d) => d.unit === sub.name);
    const fpY = zoneY + SECTION_HEADER_HEIGHT + 4;
    const fpAreaHeight = zoneHeight - SECTION_HEADER_HEIGHT - 12;
    const fpWidth = 160;
    const fpHeight = Math.min(fpAreaHeight, 120);

    const positions = layoutGrid(
      subDevices.length, { x: area.x + 8, y: fpY, width: zoneWidth - 16, height: fpAreaHeight },
      fpWidth, fpHeight, 8,
    );

    subDevices.forEach((dev, di) => {
      if (di >= positions.length) return;
      const pos = positions[di];
      const entry = catalogMap.get(dev.device_type);

      if (entry && config.supportsFaceplates) {
        // Faceplate instance
        elements.push({
          id: nextId("ov_fp"),
          type: "FACEPLATE",
          name: `FP_${dev.tag}`,
          x: pos.x,
          y: pos.y,
          width: fpWidth,
          height: fpHeight,
          zIndex: 3,
          faceplateTypeName: entry.faceplateTypeName,
          faceplateProperties: entry.interfaceProperties.map((prop) => ({
            ...prop,
            binding: `"Inst_${dev.tag}".${prop.name}`,
          })),
          style: {
            backgroundColor: "#2A2A3A",
            borderColor: "#555577",
            borderWidth: 1,
          },
        });
      } else {
        // Fallback: simple device status box
        elements.push(makeRect(
          nextId("ov_dev_bg"), pos.x, pos.y, fpWidth, fpHeight, "#2A2A3A",
        ));
        elements.push(makeText(
          nextId("ov_dev_name"), dev.tag,
          pos.x + 4, pos.y + 4, fpWidth - 8, 20,
          { fontSize: 11, fontWeight: "bold" },
        ));
        elements.push(makeCircleIndicator(
          nextId("ov_dev_ind"), pos.x + fpWidth - 24, pos.y + 4, 16,
        ));
      }
    });

    // Navigation button to unit checklist
    elements.push(makeButton(
      nextId("ov_nav"),
      `${sub.name} Details`,
      area.x + zoneWidth - 140,
      zoneY + 2,
      130,
      24,
      `CL_${sanitizeName(sub.name)}`,
    ));
  });

  return {
    id: nextId("screen"),
    name: "Overview",
    width: config.screenWidth,
    height: config.screenHeight,
    backgroundColor: "#1E1E1E",
    elements,
    screenRole: "overview",
    screenNumber: 2,
  };
}

// ---------------------------------------------------------------------------
// 3. Subsystem Checklist Screen
// ---------------------------------------------------------------------------

/**
 * Generate a checklist screen for a single unit.
 * Shows IO status, device run/fault indicators, and operator buttons.
 */
export function generateSubsystemChecklist(
  config: HmiPanelConfig,
  unit: { name: string; description: string },
  control_modules: ForgeControlModuleEntry[],
  ioList: ForgeIoEntry[],
): HmiScreenSpec {
  const elements: HmiElement[] = [];
  const area = contentArea(config);
  let curY = area.y;

  // Title
  elements.push(makeText(
    nextId("cl_title"), `${unit.name} — Checklist`,
    area.x, curY, area.width, 28,
    { fontSize: 15, fontWeight: "bold", textColor: "#E0E0E0" },
  ));
  curY += 34;

  // IO Status section
  const subIo = ioList.filter((io) =>
    control_modules.some((d) => d.io_signals.some((s) => s.tag_name === io.tag_name)),
  );

  if (subIo.length > 0) {
    elements.push(makeRect(
      nextId("cl_io_bg"), area.x, curY, area.width, SECTION_HEADER_HEIGHT, "#252540",
    ));
    elements.push(makeText(
      nextId("cl_io_hdr"), "IO Status",
      area.x + 8, curY + 4, 200, 20,
      { fontSize: 12, fontWeight: "bold", textColor: "#AACCFF" },
    ));
    curY += SECTION_HEADER_HEIGHT + 2;

    const colTag = area.x + 8;
    const colInd = area.x + 250;
    const colVal = area.x + 280;
    const colDesc = area.x + 400;

    const maxIo = Math.min(subIo.length, Math.floor((area.height * 0.4) / ROW_HEIGHT));

    for (let i = 0; i < maxIo; i++) {
      const io = subIo[i];
      const rowY = curY + i * ROW_HEIGHT;

      // Tag name
      elements.push(makeText(
        nextId("cl_io_tag"), io.tag_name,
        colTag, rowY + 4, 240, 22,
        { fontSize: 11, fontFamily: "monospace" },
      ));

      // Status indicator
      elements.push(makeCircleIndicator(
        nextId("cl_io_ind"), colInd, rowY + 6, 14, io.tag_name,
      ));

      // Value field
      elements.push(makeIoField(
        nextId("cl_io_val"), colVal, rowY + 2, 110, 24, io.tag_name,
      ));

      // Description
      elements.push(makeText(
        nextId("cl_io_desc"), io.description,
        colDesc, rowY + 4, area.width - colDesc + area.x - 8, 22,
        { fontSize: 10, textColor: "#888888" },
      ));
    }

    curY += maxIo * ROW_HEIGHT + 8;
  }

  // Device Status section
  if (control_modules.length > 0) {
    elements.push(makeRect(
      nextId("cl_dev_bg"), area.x, curY, area.width, SECTION_HEADER_HEIGHT, "#253025",
    ));
    elements.push(makeText(
      nextId("cl_dev_hdr"), "Device Status",
      area.x + 8, curY + 4, 200, 20,
      { fontSize: 12, fontWeight: "bold", textColor: "#AAFFAA" },
    ));
    curY += SECTION_HEADER_HEIGHT + 2;

    const maxDevices = Math.min(control_modules.length, Math.floor((area.height - (curY - area.y) - 60) / ROW_HEIGHT));

    for (let i = 0; i < maxDevices; i++) {
      const dev = control_modules[i];
      const rowY = curY + i * ROW_HEIGHT;

      elements.push(makeText(
        nextId("cl_dev_tag"), `${dev.tag} — ${dev.device_type}`,
        area.x + 8, rowY + 4, 300, 22,
        { fontSize: 11 },
      ));

      // Run indicator
      elements.push(makeCircleIndicator(
        nextId("cl_dev_run"), area.x + 320, rowY + 6, 14,
      ));
      elements.push(makeText(
        nextId("cl_dev_run_lbl"), "RUN",
        area.x + 340, rowY + 4, 40, 22,
        { fontSize: 9, textColor: "#888888" },
      ));

      // Fault indicator
      elements.push(makeCircleIndicator(
        nextId("cl_dev_flt"), area.x + 390, rowY + 6, 14,
      ));
      elements.push(makeText(
        nextId("cl_dev_flt_lbl"), "FLT",
        area.x + 410, rowY + 4, 40, 22,
        { fontSize: 9, textColor: "#888888" },
      ));
    }

    curY += maxDevices * ROW_HEIGHT + 8;
  }

  // Operator buttons at bottom
  const btnY = Math.max(curY, config.screenHeight - FOOTER_HEIGHT - 60);
  elements.push(makeButton(
    nextId("cl_btn_start"), "START",
    area.x, btnY, 100, 36,
  ));
  elements.push(makeButton(
    nextId("cl_btn_stop"), "STOP",
    area.x + 110, btnY, 100, 36,
  ));
  elements.push(makeButton(
    nextId("cl_btn_reset"), "RESET",
    area.x + 220, btnY, 100, 36,
  ));

  return {
    id: nextId("screen"),
    name: `CL_${sanitizeName(unit.name)}`,
    width: config.screenWidth,
    height: config.screenHeight,
    backgroundColor: "#1E1E1E",
    elements,
    screenRole: "unit_checklist",
    unit: unit.name,
    screenNumber: 0, // assigned by caller
  };
}

// ---------------------------------------------------------------------------
// 4. Device Checklist Screen
// ---------------------------------------------------------------------------

/**
 * Generate a checklist screen for all instances of a device type.
 * Lists every instance with key status fields.
 */
export function generateDeviceChecklist(
  config: HmiPanelConfig,
  deviceType: string,
  control_modules: ForgeControlModuleEntry[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _catalogEntry: FaceplateCatalogEntry | undefined,
): HmiScreenSpec {
  const elements: HmiElement[] = [];
  const area = contentArea(config);
  let curY = area.y;

  // Title
  elements.push(makeText(
    nextId("dc_title"), `${deviceType} — All Instances`,
    area.x, curY, area.width, 28,
    { fontSize: 15, fontWeight: "bold", textColor: "#E0E0E0" },
  ));
  curY += 34;

  // Column headers
  const colTag = area.x + 8;
  const colSub = area.x + 200;
  const colStatus = area.x + 380;
  const colFault = area.x + 500;

  elements.push(makeRect(
    nextId("dc_hdr_bg"), area.x, curY, area.width, SECTION_HEADER_HEIGHT, "#252540",
  ));
  elements.push(makeText(
    nextId("dc_hdr_tag"), "Device Tag",
    colTag, curY + 4, 180, 20,
    { fontSize: 11, fontWeight: "bold", textColor: "#AACCFF" },
  ));
  elements.push(makeText(
    nextId("dc_hdr_sub"), "Subsystem",
    colSub, curY + 4, 170, 20,
    { fontSize: 11, fontWeight: "bold", textColor: "#AACCFF" },
  ));
  elements.push(makeText(
    nextId("dc_hdr_status"), "Status",
    colStatus, curY + 4, 110, 20,
    { fontSize: 11, fontWeight: "bold", textColor: "#AACCFF" },
  ));
  elements.push(makeText(
    nextId("dc_hdr_fault"), "Fault",
    colFault, curY + 4, 110, 20,
    { fontSize: 11, fontWeight: "bold", textColor: "#AACCFF" },
  ));
  curY += SECTION_HEADER_HEIGHT + 2;

  // Device rows
  const maxRows = Math.min(
    control_modules.length,
    Math.floor((area.height - (curY - area.y) - 20) / ROW_HEIGHT),
  );

  for (let i = 0; i < maxRows; i++) {
    const dev = control_modules[i];
    const rowY = curY + i * ROW_HEIGHT;

    // Alternating row background
    if (i % 2 === 0) {
      elements.push(makeRect(
        nextId("dc_row_bg"), area.x, rowY, area.width, ROW_HEIGHT, "#222230",
      ));
    }

    elements.push(makeText(
      nextId("dc_tag"), dev.tag,
      colTag, rowY + 4, 180, 22,
      { fontSize: 11, fontFamily: "monospace" },
    ));

    elements.push(makeText(
      nextId("dc_sub"), dev.unit,
      colSub, rowY + 4, 170, 22,
      { fontSize: 11, textColor: "#AAAAAA" },
    ));

    // Status indicator
    elements.push(makeCircleIndicator(
      nextId("dc_status_ind"), colStatus, rowY + 6, 14,
    ));

    // Fault indicator
    elements.push(makeCircleIndicator(
      nextId("dc_fault_ind"), colFault, rowY + 6, 14,
    ));
  }

  return {
    id: nextId("screen"),
    name: `DC_${sanitizeName(deviceType)}`,
    width: config.screenWidth,
    height: config.screenHeight,
    backgroundColor: "#1E1E1E",
    elements,
    screenRole: "device_checklist",
    deviceType,
    deviceNames: control_modules.map((d) => d.tag),
    screenNumber: 0, // assigned by caller
  };
}

// ---------------------------------------------------------------------------
// Suite generator — orchestrates all screens
// ---------------------------------------------------------------------------

export interface ScreenGeneratorInput {
  config: HmiPanelConfig;
  specAnalysis: SpecAnalysis;
  control_modules: ForgeControlModuleEntry[];
  ioList: ForgeIoEntry[];
  catalog: FaceplateCatalogEntry[];
  selectedCategories: string[];
}

/**
 * Generate the full deterministic screen suite.
 * Returns HmiScreenSpec[] with screen numbers assigned sequentially.
 */
export function generateDeterministicScreens(
  input: ScreenGeneratorInput,
): HmiScreenSpec[] {
  const { config, specAnalysis, control_modules, ioList, catalog, selectedCategories } = input;
  resetIdCounter();

  const screens: HmiScreenSpec[] = [];
  let screenNum = 1;

  // Collect screen names for navigation (framework needs to know them upfront)
  const screenNames: string[] = ["Overview"];

  if (selectedCategories.includes("unit_checklist")) {
    for (const sub of specAnalysis.units) {
      screenNames.push(`CL_${sanitizeName(sub.name)}`);
    }
  }

  if (selectedCategories.includes("device_checklist")) {
    const deviceTypes = [...new Set(control_modules.map((d) => d.device_type))];
    for (const dt of deviceTypes) {
      screenNames.push(`DC_${sanitizeName(dt)}`);
    }
  }

  // 1. Framework screen (always)
  const framework = generateFrameworkScreen(config, specAnalysis.project_name, screenNames);
  framework.screenNumber = screenNum++;
  screens.push(framework);

  // 2. Overview screen (always)
  const overview = generateOverviewScreen(config, specAnalysis, control_modules, catalog);
  overview.screenNumber = screenNum++;
  screens.push(overview);

  // 3. Subsystem checklists
  if (selectedCategories.includes("unit_checklist")) {
    for (const sub of specAnalysis.units) {
      const subDevices = control_modules.filter((d) => d.unit === sub.name);
      const screen = generateSubsystemChecklist(config, sub, subDevices, ioList);
      screen.screenNumber = screenNum++;
      screens.push(screen);
    }
  }

  // 4. Device checklists
  if (selectedCategories.includes("device_checklist")) {
    const deviceTypes = [...new Set(control_modules.map((d) => d.device_type))];
    for (const dt of deviceTypes) {
      const typeDevices = control_modules.filter((d) => d.device_type === dt);
      const entry = catalog.find((c) => c.deviceType === dt);
      const screen = generateDeviceChecklist(config, dt, typeDevices, entry);
      screen.screenNumber = screenNum++;
      screens.push(screen);
    }
  }

  return screens;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Sanitize a name for use as a screen name (alphanumeric + underscore). */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
