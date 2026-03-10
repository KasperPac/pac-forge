import {
  Gauge as GaugeIcon,
  Image,
  Library,
  BarChart3,
  SlidersHorizontal,
  ToggleRight,
  TrendingUp,
  AlertTriangle,
  Clock,
  Component,
  List,
  Zap,
  Minus,
  Monitor,
} from "lucide-react";
import type { HmiElement } from "@/types/hmi-screen";

interface HmiElementRendererProps {
  element: HmiElement;
  isSelected: boolean;
  /** Map of graphic name → blob URL for loaded images */
  graphicUrls?: Map<string, string>;
}

export function HmiElementRenderer({
  element,
  graphicUrls,
}: HmiElementRendererProps) {
  const { type, style, text, width, height } = element;
  const hasEvents = element.events && element.events.length > 0;
  const hasFillLevel = element.animations?.some((a) => a.type === "FILL_LEVEL");

  const base: React.CSSProperties = {
    width: "100%",
    height: "100%",
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth ? `${style.borderWidth}px` : undefined,
    borderStyle: style.borderWidth ? "solid" : undefined,
    borderRadius: style.borderRadius ? `${style.borderRadius}px` : undefined,
    color: style.textColor,
    fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
    fontWeight: style.fontWeight,
    textAlign: style.textAlign as React.CSSProperties["textAlign"],
    opacity: style.opacity ?? 1,
    transform: style.rotation ? `rotate(${style.rotation}deg)` : undefined,
  };

  switch (type) {
    case "RECTANGLE":
      if (element.libraryPath) {
        return (
          <div
            style={base}
            className="pointer-events-none flex flex-col items-center justify-center gap-1 overflow-hidden"
          >
            <Library className="h-5 w-5 text-blue-400/60" />
            <span className="max-w-full truncate px-1.5 text-center text-[10px] font-medium leading-tight">
              {text || element.name}
            </span>
            <span className="max-w-full truncate px-1 text-[8px] text-muted-foreground/50">
              {element.libraryPath.split("/").slice(-2).join("/")}
            </span>
          </div>
        );
      }
      if (text) {
        return (
          <div
            style={base}
            className="pointer-events-none flex items-center justify-center px-2"
          >
            <span className="truncate">{text}</span>
            {hasFillLevel && <FillLevelIndicator element={element} />}
          </div>
        );
      }
      return (
        <div style={base} className="pointer-events-none">
          {hasFillLevel && <FillLevelIndicator element={element} />}
        </div>
      );

    case "BUTTON":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center justify-center px-3"
        >
          <span className="truncate">{text || "Button"}</span>
          {hasEvents && (
            <div className="absolute -right-0.5 -top-0.5 rounded bg-amber-500/80 p-0.5">
              <Zap className="h-2 w-2 text-white" />
            </div>
          )}
        </div>
      );

    case "TEXT":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center px-1"
        >
          <span className="truncate">{text || "Label"}</span>
        </div>
      );

    case "IO_FIELD":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center justify-end px-2 font-mono"
        >
          <span className="truncate text-xs text-muted-foreground/60">
            {element.tagBinding || "---.-"}
          </span>
        </div>
      );

    case "SYMBOLIC_IO_FIELD":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center justify-center px-2"
        >
          <List className="mr-1 h-3 w-3 text-muted-foreground/40" />
          <span className="truncate text-xs text-muted-foreground/60">
            {element.tagBinding || "Symbol"}
          </span>
        </div>
      );

    case "GRAPHIC_VIEW":
    case "GRAPHIC_IO_FIELD": {
      const imgUrl = element.graphicName
        ? graphicUrls?.get(element.graphicName)
        : undefined;
      const stateCount = element.imageList?.length ?? 0;
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center gap-1 overflow-hidden"
        >
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={element.graphicName}
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <>
              <Image className="h-6 w-6 text-muted-foreground/40" />
              <span className="max-w-full truncate px-1 text-[10px] text-muted-foreground/40">
                {element.graphicName ?? (type === "GRAPHIC_IO_FIELD" ? "GfxIO" : "Graphic")}
              </span>
            </>
          )}
          {type === "GRAPHIC_IO_FIELD" && stateCount > 0 && (
            <div className="absolute bottom-0.5 right-0.5 rounded bg-primary/80 px-1 text-[8px] font-medium text-primary-foreground">
              {stateCount}
            </div>
          )}
        </div>
      );
    }

    case "LINE":
      return (
        <div className="pointer-events-none flex h-full w-full items-center">
          <div
            className="w-full"
            style={{
              height: Math.max(2, style.borderWidth ?? 2),
              backgroundColor: style.backgroundColor ?? "#475569",
            }}
          />
        </div>
      );

    case "CIRCLE":
      return (
        <div
          style={{ ...base, borderRadius: "50%" }}
          className="pointer-events-none"
        />
      );

    case "ELLIPSE":
      return (
        <div
          style={{ ...base, borderRadius: "50%" }}
          className="pointer-events-none"
        />
      );

    case "POLYGON":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center justify-center"
        >
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <polygon
              points={
                element.points
                  ? element.points.map((p) => `${(p.x / width) * 100},${(p.y / height) * 100}`).join(" ")
                  : "50,5 95,35 80,95 20,95 5,35"
              }
              fill={style.backgroundColor ?? "#1e293b"}
              stroke={style.borderColor ?? "#334155"}
              strokeWidth={style.borderWidth ?? 2}
            />
          </svg>
        </div>
      );

    case "GAUGE":
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center"
        >
          <GaugeIcon
            className="text-muted-foreground/40"
            style={{
              width: Math.min(width, height) * 0.5,
              height: Math.min(width, height) * 0.5,
            }}
          />
          <span className="mt-1 font-mono text-[10px] text-muted-foreground/40">
            {element.tagBinding || "0.0"}
          </span>
        </div>
      );

    case "BAR":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-end justify-center overflow-hidden"
        >
          <div className="flex h-full w-full flex-col items-center justify-end p-1">
            <BarChart3
              className="text-muted-foreground/40"
              style={{ width: Math.min(width, height) * 0.4, height: Math.min(width, height) * 0.4 }}
            />
            <span className="mt-0.5 font-mono text-[8px] text-muted-foreground/40">
              {element.tagBinding || "0%"}
            </span>
          </div>
        </div>
      );

    case "SLIDER":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center px-2"
        >
          <SlidersHorizontal className="mr-1 h-4 w-4 text-muted-foreground/40" />
          <div className="flex-1 rounded-full bg-muted/20" style={{ height: 4 }}>
            <div className="h-full w-1/2 rounded-full" style={{ backgroundColor: style.textColor ?? "#3b82f6" }} />
          </div>
          <span className="ml-1 font-mono text-[9px] text-muted-foreground/40">
            {element.tagBinding || "50"}
          </span>
        </div>
      );

    case "SWITCH":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center justify-center"
        >
          <ToggleRight className="text-muted-foreground/40" style={{ width: Math.min(width, height) * 0.6, height: Math.min(width, height) * 0.6 }} />
        </div>
      );

    case "TREND_VIEW":
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center gap-1 overflow-hidden"
        >
          <TrendingUp
            className="text-muted-foreground/40"
            style={{ width: Math.min(width, height) * 0.4, height: Math.min(width, height) * 0.4 }}
          />
          <span className="text-[10px] text-muted-foreground/40">
            {element.trendTags?.length ? `${element.trendTags.length} tag(s)` : "Trend View"}
          </span>
        </div>
      );

    case "ALARM_VIEW":
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center gap-1 overflow-hidden"
        >
          <AlertTriangle className="h-6 w-6 text-amber-500/40" />
          <span className="text-[10px] text-muted-foreground/40">Alarm View</span>
        </div>
      );

    case "DATE_TIME":
      return (
        <div
          style={base}
          className="pointer-events-none flex items-center px-1 font-mono"
        >
          <Clock className="mr-1 h-3 w-3 text-muted-foreground/40" />
          <span className="truncate text-xs text-muted-foreground/60">
            {element.dateTimeFormat || "yyyy-MM-dd HH:mm:ss"}
          </span>
        </div>
      );

    case "GROUP":
      return (
        <div
          style={{
            ...base,
            borderStyle: "dashed",
            backgroundColor: "transparent",
          }}
          className="pointer-events-none"
        />
      );

    case "FACEPLATE":
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center gap-1 overflow-hidden"
        >
          <Component className="h-5 w-5 text-blue-400/60" />
          <span className="max-w-full truncate px-1.5 text-center text-[10px] font-medium leading-tight">
            {text || element.name}
          </span>
          <span className="text-[8px] text-muted-foreground/50">
            {element.faceplateTypeName || "Faceplate"}
          </span>
          {element.faceplateProperties && element.faceplateProperties.length > 0 && (
            <div className="absolute bottom-0.5 right-0.5 rounded bg-blue-500/80 px-1 text-[8px] font-medium text-white">
              {element.faceplateProperties.length}
            </div>
          )}
        </div>
      );

    case "POLYLINE":
      return (
        <div className="pointer-events-none flex h-full w-full items-center">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
            <polyline
              points={
                element.points
                  ? element.points.map((p) => `${p.x},${p.y}`).join(" ")
                  : `0,${height / 2} ${width},${height / 2}`
              }
              fill="none"
              stroke={style.backgroundColor ?? "#475569"}
              strokeWidth={Math.max(2, style.borderWidth ?? 2)}
            />
          </svg>
        </div>
      );

    case "CLOCK":
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center"
        >
          <Clock
            className="text-muted-foreground/60"
            style={{
              width: Math.min(width, height) * 0.5,
              height: Math.min(width, height) * 0.5,
            }}
          />
          <span className="mt-0.5 text-[9px] text-muted-foreground/40">
            {element.clockType === "digital" ? "Digital" : "Analog"}
          </span>
        </div>
      );

    case "PIPE":
      return (
        <div
          style={{
            ...base,
            borderRadius: element.pipeDiameter ? `${element.pipeDiameter / 2}px` : base.borderRadius,
          }}
          className="pointer-events-none"
        >
          <Minus className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/30" />
        </div>
      );

    case "SCREEN_WINDOW":
      return (
        <div
          style={base}
          className="pointer-events-none flex flex-col items-center justify-center gap-1 overflow-hidden"
        >
          <Monitor className="h-5 w-5 text-blue-400/60" />
          <span className="max-w-full truncate px-1.5 text-center text-[10px] font-medium leading-tight">
            {element.screenWindowName || element.name}
          </span>
          <span className="text-[8px] text-muted-foreground/50">
            {element.screenWindowModal ? "Modal" : "Window"}
          </span>
        </div>
      );

    default:
      return <div style={base} className="pointer-events-none" />;
  }
}

/** Visual preview indicator for fill level animation */
function FillLevelIndicator({ element }: { element: HmiElement }) {
  const fillAnim = element.animations?.find((a) => a.type === "FILL_LEVEL");
  if (!fillAnim) return null;
  const dir = fillAnim.fillDirection ?? "bottom-to-top";
  const color = fillAnim.fillColor ?? "#22c55e";
  const style: React.CSSProperties = {
    position: "absolute",
    backgroundColor: color,
    opacity: 0.3,
  };
  if (dir === "bottom-to-top") {
    Object.assign(style, { bottom: 0, left: 0, right: 0, height: "40%" });
  } else if (dir === "top-to-bottom") {
    Object.assign(style, { top: 0, left: 0, right: 0, height: "40%" });
  } else if (dir === "left-to-right") {
    Object.assign(style, { top: 0, bottom: 0, left: 0, width: "40%" });
  } else {
    Object.assign(style, { top: 0, bottom: 0, right: 0, width: "40%" });
  }
  return <div style={style} />;
}
