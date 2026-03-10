/**
 * Parses WinCC Comfort screen XML exports into HmiScreenSpec format
 * for rendering in the visual HMI editor.
 */
import type {
  HmiElement,
  HmiElementType,
  HmiScreenSpec,
  HmiElementStyle,
  HmiEventAction,
  HmiAnimation,
  HmiMultilingualText,
  HmiAccessLevel,
} from "@/types/hmi-screen";

// ---- Public API ----

/** Parse a single screen XML string into an HmiScreenSpec */
export function parseScreenXml(xml: string): HmiScreenSpec {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const screenEl = doc.querySelector("Hmi\\.Screen\\.Screen");
  if (!screenEl) throw new Error("No Hmi.Screen.Screen element found");

  const name = getAttr(screenEl, "Name") ?? "Untitled";
  const width = intAttr(screenEl, "Width") ?? 1920;
  const height = intAttr(screenEl, "Height") ?? 1080;
  const bgColor = parseRgb(getAttr(screenEl, "BackColor")) ?? "#0f172a";

  // Collect all screen items from all layers
  const elements: HmiElement[] = [];
  let zIndex = 1;

  const layers = screenEl.querySelectorAll(
    'Hmi\\.Screen\\.ScreenLayer[CompositionName="Layers"]',
  );

  for (const layer of layers) {
    const items = layer.querySelectorAll(
      '[CompositionName="ScreenItems"]',
    );
    for (const item of items) {
      const el = parseScreenItem(item, zIndex++);
      if (el) elements.push(el);

      // If it's a Group, also parse children
      if (item.nodeName === "Hmi.Screen.Group") {
        const children = item.querySelectorAll(
          ':scope > ObjectList > [CompositionName="ScreenItems"]',
        );
        for (const child of children) {
          const childEl = parseScreenItem(child, zIndex++);
          if (childEl) {
            // Offset by group position
            childEl.x += el?.x ?? 0;
            childEl.y += el?.y ?? 0;
            elements.push(childEl);
          }
        }
      }
    }
  }

  return {
    id: `screen_${name.toLowerCase()}`,
    name,
    width,
    height,
    backgroundColor: bgColor,
    elements,
  };
}

/** Parse all screens from the hmi_export.json format */
export function parseHmiExport(exportData: {
  screens: Record<string, string>;
}): HmiScreenSpec[] {
  return Object.entries(exportData.screens).map(([_name, xml]) =>
    parseScreenXml(xml),
  );
}

// ---- Element parsing ----

const ELEMENT_TYPE_MAP: Record<string, HmiElementType> = {
  "Hmi.Screen.Rectangle": "RECTANGLE",
  "Hmi.Screen.Button": "BUTTON",
  "Hmi.Screen.TextField": "TEXT",
  "Hmi.Screen.IOField": "IO_FIELD",
  "Hmi.Screen.SymbolicIOField": "SYMBOLIC_IO_FIELD",
  "Hmi.Screen.GraphicView": "GRAPHIC_VIEW",
  "Hmi.Screen.GraphicIOField": "GRAPHIC_IO_FIELD",
  "Hmi.Screen.Line": "LINE",
  "Hmi.Screen.Circle": "CIRCLE",
  "Hmi.Screen.Ellipse": "ELLIPSE",
  "Hmi.Screen.Polygon": "POLYGON",
  "Hmi.Screen.Gauge": "GAUGE",
  "Hmi.Screen.Bar": "BAR",
  "Hmi.Screen.Slider": "SLIDER",
  "Hmi.Screen.Switch": "SWITCH",
  "Hmi.Screen.TrendView": "TREND_VIEW",
  "Hmi.Screen.AlarmView": "ALARM_VIEW",
  "Hmi.Screen.DateTimeField": "DATE_TIME",
  "Hmi.Screen.Group": "GROUP",
  "Hmi.Screen.FaceplateInstance": "FACEPLATE",
  "Hmi.Screen.Polyline": "POLYLINE",
  "Hmi.Screen.Clock": "CLOCK",
  "Hmi.Screen.Pipe": "PIPE",
  "Hmi.Screen.ScreenWindow": "SCREEN_WINDOW",
};

function parseScreenItem(
  node: Element,
  zIndex: number,
): HmiElement | null {
  const nodeName = node.nodeName;
  const type = ELEMENT_TYPE_MAP[nodeName];

  // Skip unsupported types (SoftKey, Property, FaceplateInstance, etc.)
  if (!type) return null;

  const name = getAttr(node, "ObjectName") ?? `element_${zIndex}`;
  const x = intAttr(node, "Left") ?? 0;
  const y = intAttr(node, "Top") ?? 0;
  const width = intAttr(node, "Width") ?? 100;
  const height = intAttr(node, "Height") ?? 50;

  const style = parseStyle(node, type);
  const text = parseText(node);
  const tagBinding = parseTagBinding(node);
  const navigateTo = parseNavigation(node);
  const graphicName = parseGraphicName(node);
  const events = parseEvents(node);
  const animations = parseAnimations(node);
  const multilingualText = parseMultilingualText(node);
  const accessLevel = parseAccessLevel(node);

  return {
    id: `el_${name.replace(/\s+/g, "_")}_${zIndex}`,
    type,
    name,
    x,
    y,
    width,
    height,
    zIndex,
    style,
    text: text ?? undefined,
    tagBinding: tagBinding ?? undefined,
    navigateTo: navigateTo ?? undefined,
    graphicName: graphicName ?? undefined,
    events: events.length > 0 ? events : undefined,
    animations: animations.length > 0 ? animations : undefined,
    multilingualText: multilingualText.length > 0 ? multilingualText : undefined,
    accessLevel: accessLevel ?? undefined,
  };
}

function parseStyle(node: Element, type: HmiElementType): HmiElementStyle {
  const bgRaw = getAttr(node, "BackColor");
  const fgRaw = getAttr(node, "ForeColor");
  const borderRaw = getAttr(node, "BorderColor");
  const borderWidth = intAttr(node, "BorderWidth");
  const cornerRadius =
    intAttr(node, "CornerRadius") ??
    intAttr(node, "RoundCornerWidth") ??
    0;

  const fillStyle = getAttr(node, "BackFillStyle");
  const isTransparent = fillStyle === "Transparent";

  // Font properties from nested font item
  const fontItem = node.querySelector(
    'Hmi\\.Globalization\\.FontItem[CompositionName="Items"]',
  );
  const fontSize = fontItem
    ? intAttr(fontItem, "Size") ?? undefined
    : undefined;
  const fontBold = fontItem
    ? getAttr(fontItem, "Bold") === "true"
    : false;
  const fontItalic = fontItem
    ? getAttr(fontItem, "Italic") === "true"
    : false;
  const fontUnderline = fontItem
    ? getAttr(fontItem, "Underline") === "true"
    : false;
  const fontFamily = fontItem
    ? getAttr(fontItem, "FaceName") ?? undefined
    : undefined;

  const hAlign = getAttr(node, "HorizontalAlignment");
  const textAlign =
    hAlign === "Center"
      ? ("center" as const)
      : hAlign === "Right"
        ? ("right" as const)
        : ("left" as const);

  return {
    backgroundColor: isTransparent ? "transparent" : (parseRgb(bgRaw) ?? undefined),
    borderColor: parseRgb(borderRaw) ?? undefined,
    borderWidth: borderWidth ?? (type === "LINE" ? 0 : 1),
    textColor: parseRgb(fgRaw) ?? undefined,
    fontSize: fontSize ?? (type === "TEXT" || type === "BUTTON" ? 14 : undefined),
    fontWeight: fontBold ? "bold" : "normal",
    fontFamily,
    fontItalic: fontItalic || undefined,
    fontUnderline: fontUnderline || undefined,
    textAlign,
    borderRadius: cornerRadius,
    opacity: 1,
  };
}

function parseText(node: Element): string | null {
  // Text lives in <MultilingualTextItem><Text><body><p>...</p></body></Text>
  const textEls = node.querySelectorAll("Text");
  for (const t of textEls) {
    const raw = t.textContent?.trim();
    if (!raw) continue;
    // Strip HTML body/p tags
    const cleaned = raw
      .replace(/<\/?body>/g, "")
      .replace(/<\/?p>/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .trim();
    if (cleaned) return cleaned;
  }
  return null;
}

function parseTagBinding(node: Element): string | null {
  // Tag bindings in LinkList > Tag or ProcessTag
  const linkList = node.querySelector(":scope > LinkList");
  if (!linkList) return null;

  const tagLink =
    linkList.querySelector('Tag[TargetID="@OpenLink"]') ??
    linkList.querySelector('ProcessTag[TargetID="@OpenLink"]');
  if (!tagLink) return null;

  const tagName = tagLink.querySelector("Name");
  return tagName?.textContent?.trim() ?? null;
}

function parseGraphicName(node: Element): string | null {
  // Picture reference in LinkList
  const linkList = node.querySelector(":scope > LinkList");
  if (!linkList) return null;
  const pic = linkList.querySelector('Picture[TargetID="@OpenLink"]');
  if (!pic) return null;
  const name = pic.querySelector("Name");
  return name?.textContent?.trim() ?? null;
}

function parseNavigation(node: Element): string | null {
  // Look for ActivateScreen system function in events
  const events = node.querySelectorAll("Hmi\\.Event\\.FunctionListEntry");
  for (const evt of events) {
    const fnName = getAttr(evt, "Name");
    if (fnName === "ActivateScreen") {
      // Screen name is in the parameter value
      const params = evt.querySelectorAll(
        "Hmi\\.Event\\.FunctionListEntryParameter",
      );
      for (const p of params) {
        const pName = getAttr(p, "Name");
        if (pName === "ScreenName" || pName === "Screen number") {
          const val = p.querySelector("Value");
          return val?.textContent?.trim() ?? null;
        }
      }
    }
  }
  return null;
}

function parseEvents(node: Element): HmiEventAction[] {
  const events: HmiEventAction[] = [];
  const eventTypeMap: Record<string, string> = {
    Click: "CLICK",
    Press: "PRESS",
    Release: "RELEASE",
    Activate: "ACTIVATE",
    Deactivate: "DEACTIVATE",
    Change: "CHANGE",
  };

  // WinCC events are in EventHandlerList > EventHandler entries
  const handlers = node.querySelectorAll("Hmi\\.Event\\.FunctionListEntry");
  for (const handler of handlers) {
    // Determine event type from parent composition name
    const parentComp = handler.closest("[CompositionName]");
    const compName = parentComp?.getAttribute("CompositionName") ?? "";
    const eventType = eventTypeMap[compName] ?? "CLICK";
    const fnName = getAttr(handler, "Name") ?? "";
    if (!fnName) continue;

    // Parse parameters
    const parameters: Record<string, string | number | boolean> = {};
    const params = handler.querySelectorAll("Hmi\\.Event\\.FunctionListEntryParameter");
    for (const p of params) {
      const pName = getAttr(p, "Name");
      const pValue = p.querySelector("Value")?.textContent?.trim();
      if (pName && pValue) {
        // Try to parse as number or boolean
        if (pValue === "true") parameters[pName] = true;
        else if (pValue === "false") parameters[pName] = false;
        else if (!isNaN(Number(pValue))) parameters[pName] = Number(pValue);
        else parameters[pName] = pValue;
      }
    }

    events.push({
      eventType: eventType as HmiEventAction["eventType"],
      functionName: fnName,
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    });
  }
  return events;
}

function parseAnimations(node: Element): HmiAnimation[] {
  const animations: HmiAnimation[] = [];

  // Map WinCC XML animation node names to our types
  const animNodeMap: Record<string, HmiAnimation["type"]> = {
    "Hmi.Dynamic.SingleBitVisibilityAnimation": "VISIBILITY_BIT",
    "Hmi.Dynamic.VisibilityAnimation": "VISIBILITY_RANGE",
    "Hmi.Dynamic.RangeAppearanceAnimation": "APPEARANCE",
    "Hmi.Dynamic.FlashingAnimation": "FLASHING",
    "Hmi.Dynamic.HorizontalMovementAnimation": "HORIZONTAL_MOVEMENT",
    "Hmi.Dynamic.VerticalMovementAnimation": "VERTICAL_MOVEMENT",
    "Hmi.Dynamic.DirectMovementAnimation": "DIRECT_MOVEMENT",
    "Hmi.Dynamic.RotationAnimation": "ROTATION",
    "Hmi.Dynamic.ObjectEnablingAnimation": "OBJECT_ENABLING",
    "Hmi.Dynamic.TagConnectionDynamic": "TAG_CONNECTION",
    "Hmi.Dynamic.FillLevelAnimation": "FILL_LEVEL",
    "Hmi.Dynamic.SizeAnimation": "SIZE",
  };

  // Search for typed animation nodes
  for (const [xmlName, animType] of Object.entries(animNodeMap)) {
    const nodes = node.querySelectorAll(xmlName.replace(/\./g, "\\."));
    for (const animNode of nodes) {
      const tagEl = animNode.querySelector("Tag Name, LinkList Tag Name");
      const tagName = tagEl?.textContent?.trim();

      const anim: HmiAnimation = { type: animType, tagName };

      // Common range attributes
      const rangeMin = intAttr(animNode, "RangeMin");
      const rangeMax = intAttr(animNode, "RangeMax");
      if (rangeMin != null) anim.rangeMin = rangeMin;
      if (rangeMax != null) anim.rangeMax = rangeMax;

      // Movement/rotation range
      const range = intAttr(animNode, "Range");
      if (range != null) {
        if (animType === "ROTATION") anim.rotationRange = range;
        else anim.movementRange = range;
      }

      // Type-specific parsing
      switch (animType) {
        case "VISIBILITY_BIT": {
          const bitNum = intAttr(animNode, "BitNumber");
          if (bitNum != null) anim.triggerValue = bitNum;
          break;
        }
        case "FILL_LEVEL": {
          const dir = getAttr(animNode, "FillDirection");
          if (dir === "BottomToTop") anim.fillDirection = "bottom-to-top";
          else if (dir === "TopToBottom") anim.fillDirection = "top-to-bottom";
          else if (dir === "LeftToRight") anim.fillDirection = "left-to-right";
          else if (dir === "RightToLeft") anim.fillDirection = "right-to-left";
          const fillColor = getAttr(animNode, "FillColor");
          if (fillColor) anim.fillColor = parseRgb(fillColor) ?? undefined;
          break;
        }
        case "SIZE": {
          const axis = getAttr(animNode, "SizeAxis");
          if (axis === "Horizontal") anim.sizeAxis = "horizontal";
          else if (axis === "Vertical") anim.sizeAxis = "vertical";
          else if (axis === "Both") anim.sizeAxis = "both";
          const sizeMin = intAttr(animNode, "SizeMin");
          const sizeMax = intAttr(animNode, "SizeMax");
          if (sizeMin != null) anim.sizeMin = sizeMin;
          if (sizeMax != null) anim.sizeMax = sizeMax;
          break;
        }
        case "APPEARANCE": {
          const entries = animNode.querySelectorAll(
            "Hmi\\.Dynamic\\.RangeAppearanceEntry"
          );
          if (entries.length > 0) {
            anim.colorMap = [];
            for (const entry of entries) {
              const from = intAttr(entry, "RangeFrom");
              const bgColor = getAttr(entry, "BackColor");
              if (from != null && bgColor) {
                const hex = parseRgb(bgColor);
                if (hex) anim.colorMap.push({ value: from, color: hex });
              }
            }
          }
          break;
        }
      }

      animations.push(anim);
    }
  }

  // Also check DynamicProperties (older format / fill level as dynamic property)
  const dynProps = node.querySelectorAll("Hmi\\.Screen\\.DynamicProperty");
  for (const dp of dynProps) {
    const propName = getAttr(dp, "Name") ?? "";
    const tagEl = dp.querySelector("Tag Name");
    const tagName = tagEl?.textContent?.trim();

    if (propName === "FillLevel" || propName === "FillPattern") {
      // Skip if we already found a FillLevelAnimation node
      if (animations.some((a) => a.type === "FILL_LEVEL")) continue;
      const anim: HmiAnimation = { type: "FILL_LEVEL", tagName };
      const dir = getAttr(dp, "FillDirection");
      if (dir === "BottomToTop") anim.fillDirection = "bottom-to-top";
      else if (dir === "TopToBottom") anim.fillDirection = "top-to-bottom";
      else if (dir === "LeftToRight") anim.fillDirection = "left-to-right";
      else if (dir === "RightToLeft") anim.fillDirection = "right-to-left";
      animations.push(anim);
    }
  }

  return animations;
}

function parseMultilingualText(node: Element): HmiMultilingualText[] {
  const items: HmiMultilingualText[] = [];
  const textItems = node.querySelectorAll(
    "MultilingualTextItem[CompositionName=\"Items\"]"
  );
  for (const item of textItems) {
    const culture = getAttr(item, "Culture");
    const text = getAttr(item, "Text");
    if (culture && text) {
      const langId = cultureToLangId(culture);
      if (langId) items.push({ languageId: langId, text });
    }
  }
  return items;
}

function cultureToLangId(culture: string): number | null {
  const map: Record<string, number> = {
    "en-US": 1033, "en-GB": 1033,
    "de-DE": 1031,
    "it-IT": 1040,
    "fr-FR": 1036,
    "es-ES": 1034,
    "pt-PT": 2070,
    "zh-CN": 2052,
  };
  return map[culture] ?? null;
}

function parseAccessLevel(node: Element): HmiAccessLevel | null {
  const auth = getAttr(node, "Authorization");
  if (!auth) return null;
  const valid = ["None", "View", "Operate", "Maintain", "Administer"];
  return valid.includes(auth) ? auth as HmiAccessLevel : null;
}

// ---- Helpers ----

function getAttr(el: Element, name: string): string | null {
  const attr = el.querySelector(`:scope > AttributeList > ${name}`);
  return attr?.textContent?.trim() ?? null;
}

function intAttr(el: Element, name: string): number | null {
  const val = getAttr(el, name);
  if (val === null) return null;
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

/**
 * Parse a TIA library type XML export and extract visual elements.
 * Library type XML can have various root structures — we try all known patterns.
 */
export function parseLibraryTypeXml(xml: string): HmiScreenSpec | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // Try standard screen format first
  const screenEl = doc.querySelector("Hmi\\.Screen\\.Screen");
  if (screenEl) {
    try {
      return parseScreenXml(xml);
    } catch {
      // fall through
    }
  }

  // Try faceplate/type container — collect all screen items from anywhere in the doc
  const elements: HmiElement[] = [];
  let zIndex = 1;

  // Find all known screen item types anywhere in the document
  for (const typeName of Object.keys(ELEMENT_TYPE_MAP)) {
    const items = doc.querySelectorAll(typeName.replace(/\./g, "\\."));
    for (const item of items) {
      const el = parseScreenItem(item, zIndex++);
      if (el) elements.push(el);
    }
  }

  if (elements.length === 0) return null;

  // Determine bounding box from elements
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }

  // Normalize positions to start at 0,0
  if (minX > 0 || minY > 0) {
    for (const el of elements) {
      el.x -= minX;
      el.y -= minY;
    }
  }

  const width = Math.max(maxX - minX, 100);
  const height = Math.max(maxY - minY, 60);

  return {
    id: "lib_preview",
    name: "LibraryType",
    width,
    height,
    backgroundColor: "#1e293b",
    elements,
  };
}

/**
 * Render an HmiScreenSpec to a small PNG thumbnail data URI using Canvas 2D.
 * This is a simplified renderer — just draws rectangles, text, and basic shapes.
 */
export function renderThumbnail(
  spec: HmiScreenSpec,
  thumbWidth = 128,
  thumbHeight = 80,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const scaleX = thumbWidth / spec.width;
  const scaleY = thumbHeight / spec.height;
  const scale = Math.min(scaleX, scaleY);

  // Center the content
  const offsetX = (thumbWidth - spec.width * scale) / 2;
  const offsetY = (thumbHeight - spec.height * scale) / 2;

  // Background
  ctx.fillStyle = spec.backgroundColor;
  ctx.fillRect(0, 0, thumbWidth, thumbHeight);

  for (const el of spec.elements) {
    const x = offsetX + el.x * scale;
    const y = offsetY + el.y * scale;
    const w = el.width * scale;
    const h = el.height * scale;

    // Fill
    if (el.style.backgroundColor && el.style.backgroundColor !== "transparent") {
      ctx.fillStyle = el.style.backgroundColor;
      ctx.fillRect(x, y, w, h);
    }

    // Border
    if (el.style.borderWidth && el.style.borderColor) {
      ctx.strokeStyle = el.style.borderColor;
      ctx.lineWidth = Math.max(1, (el.style.borderWidth ?? 1) * scale);
      ctx.strokeRect(x, y, w, h);
    }

    // Text (only if large enough to read)
    if (el.text && h * scale > 4) {
      const fontSize = Math.max(6, Math.min(12, (el.style.fontSize ?? 12) * scale));
      ctx.fillStyle = el.style.textColor ?? "#e2e8f0";
      ctx.font = `${el.style.fontWeight === "bold" ? "bold " : ""}${fontSize}px sans-serif`;
      ctx.textAlign = (el.style.textAlign as CanvasTextAlign) ?? "center";
      ctx.textBaseline = "middle";
      const tx = el.style.textAlign === "left" ? x + 2 : el.style.textAlign === "right" ? x + w - 2 : x + w / 2;
      ctx.fillText(el.text, tx, y + h / 2, w - 4);
    }

    // Line element
    if (el.type === "LINE") {
      ctx.strokeStyle = el.style.backgroundColor ?? "#475569";
      ctx.lineWidth = Math.max(1, (el.style.borderWidth ?? 2) * scale);
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
    }
  }

  return canvas.toDataURL("image/png");
}

/** Convert "R, G, B" to "#rrggbb" */
function parseRgb(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(",").map((s) => parseInt(s.trim()));
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return (
    "#" +
    parts
      .slice(0, 3)
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
