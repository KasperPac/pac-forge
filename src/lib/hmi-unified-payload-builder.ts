/**
 * WinCC Unified HMI payload builder — Phase 3.2.
 *
 * V20 Openness does NOT expose SimaticML export/import for Unified HMI screens
 * (only PlcType and HmiScriptModule support it). So Pac-Forge does NOT generate
 * XML — it generates a structured JSON payload that the bridge consumes to call
 * Openness API methods directly:
 *
 *   hmiSoftware.Screens.Create(name)
 *     -> set attributes (Width, Height, BackColor, ...)
 *     -> screen.ScreenItems.CreateCompositeItem<T>(name)  // T resolved from item.type via reflection
 *     -> set item attributes from item.attributes dict
 *
 * Supports all 39 Openness HmiScreenItemBase subclasses via a generic payload shape.
 * The type name and attribute catalog lives in hmi-unified-item-types.ts (generated
 * from reflection on the V20 DLL). Pac-Forge can emit ANY item type as long as the
 * caller supplies a known type name + valid PascalCase attribute names.
 *
 * Ergonomic typed factories (makeRectangle, makeText, makeButton, etc.) exist for
 * the common 15 item types. The generic path (makeItem) handles everything else.
 */

import type { HmiPanelConfig, HmiUnifiedTheme } from "@/types/hmi-panel";
import type { FaceplateTagBinding } from "./hmi-tag-mapper";
import { getItemTypeSpec, isValidAttribute } from "./hmi-unified-item-types";

// ---------------------------------------------------------------------------
// Generic item payload — supports all 39 HmiScreenItemBase subclasses
// ---------------------------------------------------------------------------

/** Attribute values the bridge can pass to SetAttribute(name, value). */
export type HmiAttributeValue = string | number | boolean;

/** Multilingual text: either a plain string (applies to all cultures) or a culture map. */
export type HmiMultilingualText = string | Record<string, string>;

/** Font sub-properties applied to an HmiFontPart (Font property on text-bearing items). */
export interface HmiFontConfig {
  /** Point size */
  size?: number;
  /** Font family name (HmiFontName enum — e.g. "Siemens Sans") */
  family?: string;
  /** Shorthand for Weight: true -> "Bold", false -> "Normal" */
  bold?: boolean;
  /** HmiFontWeight enum value: "Normal" | "Bold" | "Light" | "ExtraBold" | ... */
  weight?: string;
  italic?: boolean;
  underline?: boolean;
  strikeOut?: boolean;
}

export interface HmiPaddingConfig {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface HmiCornersConfig {
  topLeft?: number;
  topRight?: number;
  bottomLeft?: number;
  bottomRight?: number;
  /** Shorthand: sets all four radii to the same value */
  radius?: number;
}

export interface HmiUnifiedItemPayload {
  /** Short type name from hmi-unified-item-types (e.g. "HmiRectangle", "HmiSlider"). */
  type: string;
  /** Item name as it will appear in the Unified project tree. */
  name: string;
  /** PascalCase Openness attribute name -> value. Bridge applies each via item.SetAttribute(). */
  attributes: Record<string, HmiAttributeValue>;
  /** Optional: FaceplateContainer specific — paired tag binding for bridge to wire up. */
  faceplateTagBinding?: FaceplateTagBinding;

  // Phase 4.3: composite-property fields. Bridge dispatches specialised helpers
  // when these are present (MultilingualText composition, HmiFontPart, HmiPaddingPart, HmiCornersPart).
  /** Text content — multilingual composition on HmiText/HmiLabel/HmiTextBox/HmiButton/HmiIOField */
  text?: HmiMultilingualText;
  /** Tooltip text — multilingual composition available on all items */
  toolTip?: HmiMultilingualText;
  /** Font sub-properties (Size, Weight, Italic, etc.) */
  font?: HmiFontConfig;
  /** Padding sub-properties (Left/Top/Right/Bottom) */
  padding?: HmiPaddingConfig;
  /** Corner radii */
  corners?: HmiCornersConfig;
}

// ---------------------------------------------------------------------------
// Geometry shorthand — all items have Left/Top/Width/Height, so let callers pass them separately
// ---------------------------------------------------------------------------

export interface HmiItemGeometry {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex?: number;
  visible?: boolean;
  rotationAngle?: number;
}

function geometryAttrs(g: HmiItemGeometry): Record<string, HmiAttributeValue> {
  const attrs: Record<string, HmiAttributeValue> = {
    Left: g.left,
    Top: g.top,
    Width: g.width,
    Height: g.height,
  };
  if (g.zIndex !== undefined) attrs.ZIndex = g.zIndex;
  if (g.visible !== undefined) attrs.Visible = g.visible;
  if (g.rotationAngle !== undefined) attrs.RotationAngle = g.rotationAngle;
  return attrs;
}

// ---------------------------------------------------------------------------
// Generic factory — the escape hatch for any of the 39 item types
// ---------------------------------------------------------------------------

/**
 * Build a payload for any Unified item type. The escape hatch when the typed factories
 * below don't fit. Validates the type name and warns on unknown attributes in dev.
 */
export function makeItem(
  type: string,
  geometry: HmiItemGeometry,
  extraAttributes: Record<string, HmiAttributeValue> = {},
): HmiUnifiedItemPayload {
  if (import.meta.env?.DEV) {
    if (!getItemTypeSpec(type)) {
      console.warn(`[hmi-payload] Unknown item type: ${type}. Known types in hmi-unified-item-types.ts.`);
    } else {
      for (const key of Object.keys(extraAttributes)) {
        if (!isValidAttribute(type, key)) {
          console.warn(`[hmi-payload] Attribute '${key}' not recognised on ${type}.`);
        }
      }
    }
  }

  return {
    type,
    name: geometry.name,
    attributes: {
      ...geometryAttrs(geometry),
      ...extraAttributes,
    },
  };
}

// ---------------------------------------------------------------------------
// Typed ergonomic factories for the common item types
// ---------------------------------------------------------------------------

export interface RectangleOptions extends HmiItemGeometry {
  backColor?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  opacity?: number;
  backFillPattern?: "Solid" | "None" | "Pattern";
}

export function makeRectangle(p: RectangleOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {};
  if (p.backColor !== undefined) extra.BackColor = p.backColor;
  if (p.borderColor !== undefined) extra.BorderColor = p.borderColor;
  if (p.borderWidth !== undefined) extra.BorderWidth = p.borderWidth;
  if (p.cornerRadius !== undefined) extra.CornerRadius = p.cornerRadius;
  if (p.opacity !== undefined) extra.Opacity = p.opacity;
  if (p.backFillPattern !== undefined) extra.BackFillPattern = p.backFillPattern;
  return makeItem("HmiRectangle", p, extra);
}

export interface LineOptions extends HmiItemGeometry {
  borderColor?: string;
  borderWidth?: number;
  dashType?: "Solid" | "Dashed" | "Dotted";
}

export function makeLine(p: LineOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {};
  if (p.borderColor !== undefined) extra.BorderColor = p.borderColor;
  if (p.borderWidth !== undefined) extra.BorderWidth = p.borderWidth;
  if (p.dashType !== undefined) extra.DashType = p.dashType;
  return makeItem("HmiLine", p, extra);
}

export interface CircleOptions extends HmiItemGeometry {
  backColor?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
}

export function makeCircle(p: CircleOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {};
  if (p.backColor !== undefined) extra.BackColor = p.backColor;
  if (p.borderColor !== undefined) extra.BorderColor = p.borderColor;
  if (p.borderWidth !== undefined) extra.BorderWidth = p.borderWidth;
  if (p.opacity !== undefined) extra.Opacity = p.opacity;
  return makeItem("HmiCircle", p, extra);
}

export interface TextOptions extends HmiItemGeometry {
  /** Text content (string or culture map). Goes to the Text composition. */
  text: HmiMultilingualText;
  /** Font sub-properties (Size, Bold, Italic, etc.). Goes to the Font part. */
  font?: HmiFontConfig;
  foreColor?: string;
  horizontalAlignment?: "Left" | "Center" | "Right" | "Stretch";
  verticalAlignment?: "Top" | "Center" | "Bottom" | "Stretch";
}

export function makeText(p: TextOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {};
  if (p.foreColor !== undefined) extra.ForeColor = p.foreColor;
  if (p.horizontalAlignment !== undefined) extra.HorizontalTextAlignment = p.horizontalAlignment;
  if (p.verticalAlignment !== undefined) extra.VerticalTextAlignment = p.verticalAlignment;
  const payload = makeItem("HmiText", p, extra);
  payload.text = p.text;
  if (p.font !== undefined) payload.font = p.font;
  return payload;
}

export interface TextBoxOptions extends HmiItemGeometry {
  text?: HmiMultilingualText;
  font?: HmiFontConfig;
  backColor?: string;
  foreColor?: string;
  /** Tag path for dynamic text (sets ProcessValue attribute) */
  tagBinding?: string;
}

export function makeTextBox(p: TextBoxOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {};
  if (p.backColor !== undefined) extra.BackColor = p.backColor;
  if (p.foreColor !== undefined) extra.ForeColor = p.foreColor;
  if (p.tagBinding !== undefined) extra.ProcessValue = p.tagBinding;
  const payload = makeItem("HmiTextBox", p, extra);
  if (p.text !== undefined) payload.text = p.text;
  if (p.font !== undefined) payload.font = p.font;
  return payload;
}

export interface IOFieldOptions extends HmiItemGeometry {
  mode: "Input" | "Output" | "TwoStates";
  displayFormat: "String" | "Decimal" | "Binary" | "DateTime";
  tagBinding: string;
  formatPattern?: string;
  backColor?: string;
  foreColor?: string;
  fontFamily?: string;
  fontSize?: number;
}

export function makeIOField(p: IOFieldOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {
    Mode: p.mode,
    DisplayFormat: p.displayFormat,
    ProcessValue: p.tagBinding,
  };
  if (p.formatPattern !== undefined) extra.FormatPattern = p.formatPattern;
  if (p.backColor !== undefined) extra.BackColor = p.backColor;
  if (p.foreColor !== undefined) extra.ForeColor = p.foreColor;
  if (p.fontFamily !== undefined) extra.FontFamily = p.fontFamily;
  if (p.fontSize !== undefined) extra.FontSize = p.fontSize;
  return makeItem("HmiIOField", p, extra);
}

export interface ButtonOptions extends HmiItemGeometry {
  text: HmiMultilingualText;
  font?: HmiFontConfig;
  backColor?: string;
  foreColor?: string;
  graphic?: string;
}

export function makeButton(p: ButtonOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = {};
  if (p.backColor !== undefined) extra.BackColor = p.backColor;
  if (p.foreColor !== undefined) extra.ForeColor = p.foreColor;
  if (p.graphic !== undefined) extra.Graphic = p.graphic;
  const payload = makeItem("HmiButton", p, extra);
  payload.text = p.text;
  if (p.font !== undefined) payload.font = p.font;
  return payload;
}

export interface GraphicViewOptions extends HmiItemGeometry {
  graphic: string;
  graphicList?: string;
  tagBinding?: string;
  stretchMode?: "Original" | "Uniform" | "Fill";
}

export function makeGraphicView(p: GraphicViewOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = { Graphic: p.graphic };
  if (p.graphicList !== undefined) extra.GraphicList = p.graphicList;
  if (p.tagBinding !== undefined) extra.ProcessValue = p.tagBinding;
  if (p.stretchMode !== undefined) extra.StretchMode = p.stretchMode;
  return makeItem("HmiGraphicView", p, extra);
}

export interface BarOptions extends HmiItemGeometry {
  tagBinding: string;
  minValue?: number;
  maxValue?: number;
  fillDirection?: "BottomToTop" | "TopToBottom" | "LeftToRight" | "RightToLeft";
  barColor?: string;
  backColor?: string;
}

export function makeBar(p: BarOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = { ProcessValue: p.tagBinding };
  if (p.minValue !== undefined) extra.MinValue = p.minValue;
  if (p.maxValue !== undefined) extra.MaxValue = p.maxValue;
  if (p.fillDirection !== undefined) extra.FillDirection = p.fillDirection;
  if (p.barColor !== undefined) extra.BarColor = p.barColor;
  if (p.backColor !== undefined) extra.BackColor = p.backColor;
  return makeItem("HmiBar", p, extra);
}

export interface GaugeOptions extends HmiItemGeometry {
  tagBinding: string;
  minValue?: number;
  maxValue?: number;
  unit?: string;
}

export function makeGauge(p: GaugeOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = { ProcessValue: p.tagBinding };
  if (p.minValue !== undefined) extra.MinValue = p.minValue;
  if (p.maxValue !== undefined) extra.MaxValue = p.maxValue;
  if (p.unit !== undefined) extra.Unit = p.unit;
  return makeItem("HmiGauge", p, extra);
}

export interface ScreenWindowOptions extends HmiItemGeometry {
  screen: string;
  fitToScreen?: boolean;
}

export function makeScreenWindow(p: ScreenWindowOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = { Screen: p.screen };
  if (p.fitToScreen !== undefined) extra.FitToScreen = p.fitToScreen;
  return makeItem("HmiScreenWindow", p, extra);
}

export interface SliderOptions extends HmiItemGeometry {
  tagBinding: string;
  minValue?: number;
  maxValue?: number;
  stepSize?: number;
  orientation?: "Horizontal" | "Vertical";
}

export function makeSlider(p: SliderOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = { ProcessValue: p.tagBinding };
  if (p.minValue !== undefined) extra.MinValue = p.minValue;
  if (p.maxValue !== undefined) extra.MaxValue = p.maxValue;
  if (p.stepSize !== undefined) extra.StepSize = p.stepSize;
  if (p.orientation !== undefined) extra.Orientation = p.orientation;
  return makeItem("HmiSlider", p, extra);
}

export interface ToggleSwitchOptions extends HmiItemGeometry {
  tagBinding: string;
  onText?: string;
  offText?: string;
}

export function makeToggleSwitch(p: ToggleSwitchOptions): HmiUnifiedItemPayload {
  const extra: Record<string, HmiAttributeValue> = { ProcessValue: p.tagBinding };
  if (p.onText !== undefined) extra.OnText = p.onText;
  if (p.offText !== undefined) extra.OffText = p.offText;
  return makeItem("HmiToggleSwitch", p, extra);
}

export interface FaceplateContainerOptions extends HmiItemGeometry {
  faceplateType: string;
  tagBinding: FaceplateTagBinding;
}

export function makeFaceplateContainer(p: FaceplateContainerOptions): HmiUnifiedItemPayload {
  return {
    type: "HmiFaceplateContainer",
    name: p.name,
    attributes: {
      ...geometryAttrs(p),
      FaceplateType: p.faceplateType,
      TagBinding: p.tagBinding.structTagPath,
    },
    faceplateTagBinding: p.tagBinding,
  };
}

// ---------------------------------------------------------------------------
// Screen payload — top-level container
// ---------------------------------------------------------------------------

export interface HmiUnifiedScreenPayload {
  name: string;
  displayName?: Record<string, string>;
  screenNumber?: number;
  width: number;
  height: number;
  backColor?: string;
  /** Forward-slash separated path into the Screens group tree */
  folderPath?: string;
  items: HmiUnifiedItemPayload[];
}

export interface BuildScreenOptions {
  name: string;
  panel: HmiPanelConfig;
  screenNumber?: number;
  folderPath?: string;
  displayName?: Record<string, string>;
  items?: HmiUnifiedItemPayload[];
}

/**
 * Build a Unified screen payload sized to the panel and themed by the panel's theme.
 * Callers populate items via the make* factories or by direct array construction.
 */
export function buildUnifiedScreenPayload(opts: BuildScreenOptions): HmiUnifiedScreenPayload {
  return {
    name: opts.name,
    displayName: opts.displayName,
    screenNumber: opts.screenNumber,
    width: opts.panel.screenWidth,
    height: opts.panel.screenHeight,
    backColor: resolveThemeBackColor(opts.panel.theme),
    folderPath: opts.folderPath,
    items: opts.items ?? [],
  };
}

function resolveThemeBackColor(theme?: HmiUnifiedTheme): string {
  switch (theme) {
    case "SiemensDark":
      return "Basic 80";
    case "DeepBlue":
      return "DeepBlue Base";
    case "SiemensLight":
    default:
      return "Basic 40";
  }
}

// ---------------------------------------------------------------------------
// Catalog introspection helpers — expose the item type catalog to callers
// ---------------------------------------------------------------------------

/** Re-export type catalog helpers so callers only need to import from this module. */
export { getItemTypeSpec, isValidAttribute, getValidAttributes, getItemTypesByCategory, HMI_ITEM_TYPES } from "./hmi-unified-item-types";
export type { HmiItemTypeSpec, HmiItemPropertySpec, HmiItemCategory } from "./hmi-unified-item-types";

/** Return the list of all supported item type names. Useful for UI enumeration. */
export function getSupportedItemTypeNames(): string[] {
  return Object.keys(HMI_ITEM_TYPES_REF);
}

// Workaround: Node module re-export + local access
import { HMI_ITEM_TYPES as HMI_ITEM_TYPES_REF } from "./hmi-unified-item-types";
