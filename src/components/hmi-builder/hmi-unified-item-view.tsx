import type { HmiUnifiedItemPayload } from "@/lib/hmi-unified-payload-builder";
import { DEFAULT_BRIDGE_CONFIG } from "@/lib/tia-bridge-contract";

/**
 * Visual preview of one HmiUnifiedItemPayload. Rendered inside an Rnd wrapper
 * on the HMI Builder canvas. Tries to mimic TIA Portal's on-screen look for
 * the 39 HmiScreenItemBase subclasses using plain divs + CSS.
 *
 * For HmiGraphicView items with a Graphic attribute that looks like a bridge
 * path, renders the actual image from the WinCC graphics library.
 */

function extractText(item: HmiUnifiedItemPayload): string {
  if (typeof item.text === "string") return item.text;
  if (item.text && typeof item.text === "object") {
    const first = Object.values(item.text)[0];
    if (first) return first;
  }
  return "";
}

function fontStyle(item: HmiUnifiedItemPayload): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (item.font?.size) style.fontSize = `${item.font.size}px`;
  if (item.font?.bold || item.font?.weight === "Bold") style.fontWeight = "bold";
  if (item.font?.italic) style.fontStyle = "italic";
  if (item.font?.underline) style.textDecoration = "underline";
  if (item.font?.family) style.fontFamily = item.font.family;
  return style;
}

function attrString(item: HmiUnifiedItemPayload, key: string): string | undefined {
  const v = item.attributes[key];
  return typeof v === "string" ? v : undefined;
}

function attrNumber(item: HmiUnifiedItemPayload, key: string): number | undefined {
  const v = item.attributes[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "" && !isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Attempt to coerce an Openness-style color attribute to CSS. */
function toCssColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("#")) return raw;
  // "Color [A=255, R=72, G=73, B=78]"
  const m = raw.match(/R=(\d+),\s*G=(\d+),\s*B=(\d+)/);
  if (m) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
  // Known theme tokens -> approximate
  const tokens: Record<string, string> = {
    "Basic 80": "#1a1a1a",
    "Basic 40": "#c8c8c8",
    "DeepBlue Base": "#0b1d3d",
    "Transparent": "transparent",
    "White": "#ffffff",
    "Black": "#000000",
  };
  if (tokens[raw]) return tokens[raw];
  return raw;
}

function cornerRadius(item: HmiUnifiedItemPayload): string | undefined {
  if (item.corners?.radius !== undefined) return `${item.corners.radius}px`;
  const tl = item.corners?.topLeft ?? 0;
  const tr = item.corners?.topRight ?? 0;
  const br = item.corners?.bottomRight ?? 0;
  const bl = item.corners?.bottomLeft ?? 0;
  if (tl || tr || br || bl) return `${tl}px ${tr}px ${br}px ${bl}px`;
  const cr = attrNumber(item, "CornerRadius");
  if (cr !== undefined) return `${cr}px`;
  return undefined;
}

export function HmiUnifiedItemView({ item }: { item: HmiUnifiedItemPayload }) {
  const text = extractText(item);
  const backColor = toCssColor(attrString(item, "BackColor"));
  const borderColor = toCssColor(attrString(item, "BorderColor"));
  const borderWidth = attrNumber(item, "BorderWidth");
  const foreColor = toCssColor(attrString(item, "ForeColor")) ?? "#e5e5e5";
  const opacity = attrNumber(item, "Opacity");
  const radius = cornerRadius(item);

  const base: React.CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    color: foreColor,
    opacity: opacity !== undefined ? opacity / 100 : undefined,
    ...fontStyle(item),
  };

  if (backColor) base.background = backColor;
  if (borderColor && borderWidth) base.border = `${borderWidth}px solid ${borderColor}`;
  else if (borderColor) base.border = `1px solid ${borderColor}`;
  if (radius) base.borderRadius = radius;

  switch (item.type) {
    case "HmiRectangle":
      return <div style={{ ...base, background: backColor ?? "#3b3b3b" }} />;

    case "HmiCircle":
    case "HmiEllipse":
      return <div style={{ ...base, borderRadius: "50%", background: backColor ?? "#3b3b3b" }} />;

    case "HmiLine": {
      const lw = borderWidth ?? 2;
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            opacity: base.opacity,
          }}
        >
          <div style={{ width: "100%", height: `${lw}px`, background: borderColor ?? "#888" }} />
        </div>
      );
    }

    case "HmiPolyline":
    case "HmiPolygon":
      return (
        <div style={{ ...base, background: backColor ?? "rgba(120,120,120,0.3)" }}>
          <Placeholder label="POLYGON" />
        </div>
      );

    case "HmiPath":
      return (
        <div style={{ ...base, background: "rgba(120,120,120,0.3)" }}>
          <Placeholder label="PATH" />
        </div>
      );

    case "HmiText":
    case "HmiLabel":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            padding: "2px 4px",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ pointerEvents: "none" }}>{text || "Text"}</span>
        </div>
      );

    case "HmiTextBox":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#2a2a2a",
            border: base.border ?? "1px solid #555",
            padding: "2px 6px",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
          }}
        >
          <span style={{ pointerEvents: "none" }}>{text || "TextBox"}</span>
        </div>
      );

    case "HmiButton":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#4a4a4a",
            border: base.border ?? "1px solid #777",
            borderRadius: radius ?? "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ pointerEvents: "none" }}>{text || "Button"}</span>
        </div>
      );

    case "HmiIOField":
    case "HmiSymbolicIOField":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#f4f4f4",
            color: foreColor ?? "#111",
            border: base.border ?? "1px solid #888",
            padding: "2px 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            fontFamily: "monospace",
            overflow: "hidden",
          }}
        >
          <span style={{ pointerEvents: "none" }}>
            {text || (item.type === "HmiSymbolicIOField" ? "Symbol" : "###.##")}
          </span>
        </div>
      );

    case "HmiDateTimeField":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#f4f4f4",
            color: "#111",
            border: base.border ?? "1px solid #888",
            padding: "2px 6px",
            display: "flex",
            alignItems: "center",
            fontFamily: "monospace",
          }}
        >
          <span style={{ pointerEvents: "none" }}>2026-04-11 12:00</span>
        </div>
      );

    case "HmiGraphicView": {
      const graphic = attrString(item, "Graphic");
      const isBridgePath = graphic && (graphic.includes("/") || graphic.includes("\\") || graphic.startsWith("http"));
      if (isBridgePath && graphic) {
        const url = graphic.startsWith("http")
          ? graphic
          : `${DEFAULT_BRIDGE_CONFIG.baseUrl}/tia/wincc-graphic?path=${encodeURIComponent(graphic)}`;
        return (
          <div style={{ ...base, background: "transparent", border: undefined }}>
            <img
              src={url}
              alt={item.name}
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
            />
          </div>
        );
      }
      return (
        <div style={{ ...base, background: backColor ?? "rgba(80,80,80,0.4)" }}>
          <Placeholder label={graphic || "GRAPHIC"} />
        </div>
      );
    }

    case "HmiBar": {
      const min = attrNumber(item, "MinValue") ?? 0;
      const max = attrNumber(item, "MaxValue") ?? 100;
      const val = 0.6 * (max - min) + min; // mock 60% fill
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 50;
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#222",
            border: base.border ?? "1px solid #555",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: `${pct}%`,
              background: toCssColor(attrString(item, "BarColor")) ?? "#4ade80",
            }}
          />
        </div>
      );
    }

    case "HmiGauge":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#222",
            border: base.border ?? "1px solid #555",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 10, opacity: 0.6 }}>GAUGE</div>
        </div>
      );

    case "HmiSlider":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#222",
            border: base.border ?? "1px solid #555",
            display: "flex",
            alignItems: "center",
            padding: "0 4px",
          }}
        >
          <div style={{ position: "relative", height: 3, width: "100%", background: "#555" }}>
            <div
              style={{
                position: "absolute",
                left: "60%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#4ade80",
              }}
            />
          </div>
        </div>
      );

    case "HmiToggleSwitch":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#333",
            border: base.border ?? "1px solid #666",
            borderRadius: "999px",
            display: "flex",
            alignItems: "center",
            padding: "2px",
          }}
        >
          <div
            style={{
              width: "40%",
              height: "100%",
              background: "#4ade80",
              borderRadius: "999px",
              marginLeft: "auto",
            }}
          />
        </div>
      );

    case "HmiCheckBox":
      return (
        <div style={{ ...base, display: "flex", alignItems: "center", gap: 4, background: "transparent" }}>
          <div
            style={{
              width: 14,
              height: 14,
              border: "1.5px solid #aaa",
              background: "#1a1a1a",
              flexShrink: 0,
            }}
          />
          <span>{text || "CheckBox"}</span>
        </div>
      );

    case "HmiRadioButtonGroup":
      return (
        <div style={{ ...base, display: "flex", alignItems: "center", gap: 4, background: "transparent" }}>
          <div
            style={{
              width: 14,
              height: 14,
              border: "1.5px solid #aaa",
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
          <span>{text || "RadioGroup"}</span>
        </div>
      );

    case "HmiComboBox":
    case "HmiListBox":
      return (
        <div
          style={{
            ...base,
            background: "#f4f4f4",
            color: "#111",
            border: base.border ?? "1px solid #888",
            padding: "2px 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>— Select —</span>
          {item.type === "HmiComboBox" && <span>▼</span>}
        </div>
      );

    case "HmiMediaPlayer":
      return (
        <div style={{ ...base, background: "#111", border: "1px solid #333" }}>
          <Placeholder label="▶ MEDIA" />
        </div>
      );

    case "HmiTrendView":
    case "HmiFunctionTrendView":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#0b0b0b",
            border: base.border ?? "1px solid #444",
            display: "flex",
            alignItems: "flex-end",
            padding: 4,
          }}
        >
          <svg width="100%" height="70%" viewBox="0 0 100 40" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke="#4ade80"
              strokeWidth="1"
              points="0,30 10,25 20,28 30,20 40,22 50,15 60,18 70,10 80,14 90,8 100,12"
            />
          </svg>
        </div>
      );

    case "HmiAlarmView":
    case "HmiAlarmIndicator":
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "#1a0a0a",
            border: "1px solid #f87171",
            display: "flex",
            alignItems: "center",
            padding: 4,
            gap: 4,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#f87171" }} />
          <span style={{ fontSize: 10, color: "#f87171" }}>
            {item.type === "HmiAlarmView" ? "ALARMS" : "!"}
          </span>
        </div>
      );

    case "HmiUserView":
      return (
        <div style={{ ...base, background: "#1a1a1a", border: "1px solid #444" }}>
          <Placeholder label="USERS" />
        </div>
      );

    case "HmiScreenWindow":
      return (
        <div
          style={{
            ...base,
            background: "rgba(255,255,255,0.02)",
            border: "1.5px dashed #888",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 10, color: "#aaa" }}>
            Window → {attrString(item, "Screen") || "(none)"}
          </div>
        </div>
      );

    case "HmiFaceplateContainer":
      return (
        <div
          style={{
            ...base,
            background: "rgba(251, 191, 36, 0.05)",
            border: "1.5px solid rgba(251, 191, 36, 0.4)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
          }}
        >
          <div style={{ fontSize: 9, color: "#fbbf24", fontWeight: 600 }}>FACEPLATE</div>
          <div style={{ fontSize: 10, color: "#e5e5e5" }}>
            {attrString(item, "FaceplateType") || item.name}
          </div>
        </div>
      );

    default:
      return (
        <div
          style={{
            ...base,
            background: backColor ?? "rgba(100, 100, 100, 0.25)",
            border: base.border ?? "1px dashed #666",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Placeholder label={item.type.replace(/^Hmi/, "").toUpperCase()} />
        </div>
      );
  }
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontFamily: "monospace",
        color: "#aaa",
        letterSpacing: 0.5,
        pointerEvents: "none",
      }}
    >
      {label}
    </div>
  );
}
