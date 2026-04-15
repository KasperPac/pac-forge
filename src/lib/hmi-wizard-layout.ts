/**
 * Deterministic plan → HmiUnifiedItemPayload[] translator.
 *
 * Given an HmiWizardPlan, the Template Suite frame config, and a graphic resolution
 * map (device id -> selected graphic path or SVG data URI), produce a layout that
 * fits inside the Template Suite mainWindow rect, snapped to the 8px grid.
 *
 * This is PURE: no AI calls, no side effects. Makes the wizard's final step fully
 * predictable and reproducible given the same plan + graphics.
 */

import type { HmiPanelConfig } from "@/types/hmi-panel";
import type {
  HmiUnifiedItemPayload,
  HmiAttributeValue,
} from "./hmi-unified-payload-builder";
import { makeItem } from "./hmi-unified-payload-builder";
import {
  getZoneRect,
  getContentRect,
  HMI_LAYOUT_ZONES,
  HMI_TEMPLATE_DESIGN,
} from "./hmi-unified-structure";
import type { HmiNavLevel } from "./hmi-unified-structure";
import type {
  HmiWizardPlan,
  HmiWizardPlanControl,
  HmiWizardPlanDevice,
  HmiWizardPlanStatusField,
} from "./hmi-wizard-prompts";

/** How a device icon should be sourced. */
export type DeviceGraphicSource =
  | { kind: "library"; path: string; name: string; category: string }
  | { kind: "svg"; svg: string; name: string }
  | { kind: "none" };

/** Per-device graphic mapping keyed by plan device id. */
export type DeviceGraphicMap = Record<string, DeviceGraphicSource>;

export interface BuildLayoutInput {
  plan: HmiWizardPlan;
  panel: HmiPanelConfig;
  graphics: DeviceGraphicMap;
}

const GRID = HMI_TEMPLATE_DESIGN.GRID_PX;

function snap(n: number): number {
  return Math.round(n / GRID) * GRID;
}

function autoName(prefix: string, id: string | number): string {
  return `${prefix}_${id}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Build item payloads for the whole screen.
 * When useTemplateFrame is true, adds a title bar, status bar, and positions
 * content inside the mainWindow rect. Otherwise items span the full screen.
 */
export function buildItemsFromPlan(input: BuildLayoutInput): HmiUnifiedItemPayload[] {
  const { plan, panel, graphics } = input;
  const items: HmiUnifiedItemPayload[] = [];

  // Template Suite frame
  if (plan.useTemplateFrame) {
    const titleRect = getZoneRect(HMI_LAYOUT_ZONES.TITLE_BAR, panel);
    const statusRect = getZoneRect(HMI_LAYOUT_ZONES.STATUS_BAR, panel);

    items.push(
      makeItem(
        "HmiRectangle",
        {
          name: "titleBarBg",
          left: titleRect.x,
          top: titleRect.y,
          width: titleRect.width,
          height: titleRect.height,
        },
        { BackColor: "Basic 80" },
      ),
    );

    const title = makeItem(
      "HmiText",
      {
        name: "titleBarText",
        left: titleRect.x + 2 * GRID,
        top: titleRect.y + snap(titleRect.height / 4),
        width: Math.max(240, titleRect.width - 4 * GRID),
        height: snap(titleRect.height / 2),
      },
      { ForeColor: "White" },
    );
    title.text = plan.screenTitle;
    title.font = { size: HMI_TEMPLATE_DESIGN.TITLE_BAR_FONT_PT, bold: true };
    items.push(title);

    items.push(
      makeItem(
        "HmiRectangle",
        {
          name: "statusBarBg",
          left: statusRect.x,
          top: statusRect.y,
          width: statusRect.width,
          height: statusRect.height,
        },
        { BackColor: "Basic 10" },
      ),
    );

    const machineState = makeItem(
      "HmiText",
      {
        name: "machineStateText",
        left: statusRect.x + 2 * GRID,
        top: statusRect.y + snap((statusRect.height - 16) / 2),
        width: 240,
        height: 16,
      },
      { ForeColor: "Black" },
    );
    machineState.text = "Machine State: Production";
    machineState.font = { size: 11 };
    items.push(machineState);

    // Placeholder nav hints at the bottom-right of the status bar
    if (plan.navItems.length > 0) {
      const navHint = makeItem(
        "HmiText",
        {
          name: "navHint",
          left: statusRect.x + statusRect.width - 420,
          top: statusRect.y + snap((statusRect.height - 16) / 2),
          width: 400,
          height: 16,
        },
        { ForeColor: "Black", HorizontalTextAlignment: "Right" },
      );
      navHint.text = `Nav: ${plan.navItems.join(" · ")}`;
      navHint.font = { size: 10 };
      items.push(navHint);
    }
  }

  // Compute content rect — either mainWindow minus nav levels, or full screen
  const contentRect = plan.useTemplateFrame
    ? getContentRect(panel, new Set(plan.visibleNavLevels as HmiNavLevel[]))
    : { x: 0, y: 0, width: panel.screenWidth, height: panel.screenHeight };

  // Layout within content rect: controls row at top, devices in the middle, status strip at bottom
  const padding = 2 * GRID;
  const controlsHeight = plan.controls.length > 0 ? 6 * GRID : 0;
  const statusStripHeight = plan.statusFields.length > 0 ? 6 * GRID : 0;

  const contentInnerX = contentRect.x + padding;
  const contentInnerY = contentRect.y + padding;
  const contentInnerW = contentRect.width - 2 * padding;
  const contentInnerH = contentRect.height - 2 * padding;

  let cursorY = contentInnerY;

  // Controls
  if (plan.controls.length > 0) {
    placeControls(items, plan.controls, contentInnerX, cursorY, contentInnerW, controlsHeight);
    cursorY += controlsHeight + padding;
  }

  // Devices grid
  const deviceAreaHeight = contentInnerH - (cursorY - contentInnerY) - (statusStripHeight + padding);
  if (plan.devices.length > 0 && deviceAreaHeight > 4 * GRID) {
    placeDevices(
      items,
      plan.devices,
      graphics,
      contentInnerX,
      cursorY,
      contentInnerW,
      deviceAreaHeight,
    );
  }

  // Status strip
  if (plan.statusFields.length > 0) {
    const stripY = contentInnerY + contentInnerH - statusStripHeight;
    placeStatusFields(
      items,
      plan.statusFields,
      contentInnerX,
      stripY,
      contentInnerW,
      statusStripHeight,
    );
  }

  return items;
}

// ---------------------------------------------------------------------------
// Controls row
// ---------------------------------------------------------------------------

const VARIANT_COLORS: Record<string, { bg: string; fg: string }> = {
  primary: { bg: "#3b82f6", fg: "#ffffff" },
  success: { bg: "#16a34a", fg: "#ffffff" },
  danger: { bg: "#dc2626", fg: "#ffffff" },
  warning: { bg: "#d97706", fg: "#ffffff" },
  neutral: { bg: "#4b5563", fg: "#ffffff" },
};

function placeControls(
  items: HmiUnifiedItemPayload[],
  controls: HmiWizardPlanControl[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const btnWidth = Math.max(12 * GRID, Math.floor((width - (controls.length - 1) * GRID) / controls.length / GRID) * GRID);
  const usedBtnWidth = Math.min(btnWidth, 24 * GRID);
  let cursorX = x;

  controls.forEach((ctrl, i) => {
    const name = autoName(ctrl.action ?? ctrl.label, i + 1).toLowerCase();
    const colors = VARIANT_COLORS[ctrl.variant ?? "primary"] ?? VARIANT_COLORS.primary;

    const extra: Record<string, HmiAttributeValue> = {};

    if (ctrl.type === "button") {
      extra.BackColor = colors.bg;
      extra.ForeColor = colors.fg;
      const btn = makeItem(
        "HmiButton",
        { name: `btn_${name}`, left: cursorX, top: y, width: usedBtnWidth, height: snap(height - GRID) },
        extra,
      );
      btn.text = ctrl.label;
      btn.font = { size: 14, bold: true };
      btn.corners = { radius: GRID };
      items.push(btn);
    } else if (ctrl.type === "mode-select") {
      extra.BackColor = "#f4f4f4";
      extra.ForeColor = "#111111";
      const combo = makeItem(
        "HmiComboBox",
        { name: `mode_${name}`, left: cursorX, top: y, width: usedBtnWidth, height: snap(height - GRID) },
        extra,
      );
      items.push(combo);
      // Label above combo
      const lbl = makeItem(
        "HmiText",
        { name: `lbl_${name}`, left: cursorX, top: Math.max(y - 14, 0), width: usedBtnWidth, height: 12 },
        { ForeColor: "#bbbbbb" },
      );
      lbl.text = ctrl.label;
      lbl.font = { size: 10 };
      items.push(lbl);
    } else {
      // indicator — circle + label
      const size = snap(height - 2 * GRID);
      const dot = makeItem(
        "HmiCircle",
        { name: `ind_${name}`, left: cursorX, top: y + snap((height - size) / 2), width: size, height: size },
        { BackColor: colors.bg, BorderColor: "#000000", BorderWidth: 1 },
      );
      items.push(dot);
      const lbl = makeItem(
        "HmiText",
        {
          name: `lbl_${name}`,
          left: cursorX + size + GRID,
          top: y + snap((height - 16) / 2),
          width: usedBtnWidth - size - GRID,
          height: 16,
        },
        { ForeColor: "#e5e5e5" },
      );
      lbl.text = ctrl.label;
      lbl.font = { size: 12 };
      items.push(lbl);
    }

    cursorX += usedBtnWidth + GRID;
  });
}

// ---------------------------------------------------------------------------
// Devices grid
// ---------------------------------------------------------------------------

function placeDevices(
  items: HmiUnifiedItemPayload[],
  devices: HmiWizardPlanDevice[],
  graphics: DeviceGraphicMap,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const n = devices.length;
  const cols = Math.min(n, Math.max(1, Math.floor(width / (24 * GRID))));
  const rows = Math.ceil(n / cols);
  const cellW = snap(width / cols);
  const cellH = snap(height / rows);
  const gfxSize = snap(Math.min(cellW, cellH) - 4 * GRID);

  devices.forEach((dev, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = x + col * cellW;
    const cellY = y + row * cellH;

    const src = graphics[dev.id] ?? { kind: "none" };
    const gfxX = cellX + snap((cellW - gfxSize) / 2);
    const gfxY = cellY + snap((cellH - gfxSize) / 2) - GRID;

    let graphicAttr: string | null = null;
    if (src.kind === "library") graphicAttr = src.path;
    else if (src.kind === "svg") graphicAttr = svgToDataUri(src.svg);

    if (graphicAttr) {
      const gfx = makeItem(
        "HmiGraphicView",
        {
          name: autoName("gfx", dev.id),
          left: gfxX,
          top: gfxY,
          width: gfxSize,
          height: gfxSize,
        },
        { Graphic: graphicAttr, StretchMode: "Uniform" },
      );
      items.push(gfx);
    } else {
      // Placeholder faceplate container
      const fp = makeItem(
        "HmiFaceplateContainer",
        {
          name: autoName("fp", dev.id),
          left: gfxX,
          top: gfxY,
          width: gfxSize,
          height: gfxSize,
        },
        { FaceplateType: dev.faceplateHint || dev.deviceType },
      );
      items.push(fp);
    }

    // Device label below
    const lbl = makeItem(
      "HmiText",
      {
        name: autoName("lbl", dev.id),
        left: cellX + 2 * GRID,
        top: gfxY + gfxSize + GRID,
        width: cellW - 4 * GRID,
        height: 16,
      },
      { ForeColor: "#e5e5e5", HorizontalTextAlignment: "Center" },
    );
    lbl.text = dev.label;
    lbl.font = { size: 11, bold: true };
    items.push(lbl);
  });
}

// ---------------------------------------------------------------------------
// Status strip at bottom
// ---------------------------------------------------------------------------

function placeStatusFields(
  items: HmiUnifiedItemPayload[],
  fields: HmiWizardPlanStatusField[],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const cellW = snap(width / fields.length);
  fields.forEach((f, i) => {
    const cellX = x + i * cellW;
    const labelH = 14;
    const lbl = makeItem(
      "HmiText",
      { name: autoName("stat_lbl", i + 1), left: cellX + GRID, top: y, width: cellW - 2 * GRID, height: labelH },
      { ForeColor: "#aaaaaa" },
    );
    lbl.text = f.label + (f.unit ? ` [${f.unit}]` : "");
    lbl.font = { size: 10 };
    items.push(lbl);

    const field = makeItem(
      "HmiIOField",
      {
        name: autoName("stat_io", i + 1),
        left: cellX + GRID,
        top: y + labelH + 2,
        width: cellW - 2 * GRID,
        height: height - labelH - 4,
      },
      {
        Mode: "Output",
        DisplayFormat: formatToOpennessFormat(f.format),
        BackColor: "#f4f4f4",
        ForeColor: "#111111",
      },
    );
    items.push(field);
  });
}

function formatToOpennessFormat(format: HmiWizardPlanStatusField["format"]): string {
  switch (format) {
    case "decimal":
      return "Decimal";
    case "binary":
      return "Binary";
    case "datetime":
      return "DateTime";
    case "string":
    default:
      return "String";
  }
}

/** Base64-encode a raw SVG string as a data URI that the Graphic attribute can consume. */
function svgToDataUri(svg: string): string {
  // Using unicode-safe base64 encoding
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return `data:image/svg+xml;base64,${b64}`;
}
