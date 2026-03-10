import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import {
  HMI_ELEMENT_LABELS,
  HMI_EVENT_TYPES,
  HMI_SYSTEM_FUNCTIONS,
  HMI_SYSTEM_FUNCTION_CATEGORIES,
  HMI_TAG_ACQUISITION_MODES,
  HMI_TAG_UPDATE_MODES,
  HMI_TAG_DATA_TYPES,
  HMI_TAG_ACQUISITION_CYCLES,
  HMI_FACEPLATE_DIRECTIONS,
  HMI_ALARM_COLUMNS,
  HMI_ACCESS_LEVELS,
  HMI_LANGUAGES,
} from "@/types/hmi-screen";
import type {
  HmiElement,
  HmiElementStyle,
  HmiEventAction,
  HmiTagBinding,
  HmiFaceplateProperty,
  HmiAlarmColumn,
  HmiMultilingualText,
  HmiEventType,
} from "@/types/hmi-screen";

interface HmiPropertiesPanelProps {
  element: HmiElement;
  onChange: (patch: Partial<HmiElement>) => void;
}

export function HmiPropertiesPanel({
  element,
  onChange,
}: HmiPropertiesPanelProps) {
  const updateStyle = (patch: Partial<HmiElementStyle>) => {
    onChange({ style: { ...element.style, ...patch } });
  };

  return (
    <div className="space-y-3">
      {/* Identity */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {HMI_ELEMENT_LABELS[element.type]}
        </div>
        <FieldRow label="Name">
          <Input
            value={element.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-7 text-xs"
          />
        </FieldRow>
      </div>

      <Separator />

      {/* Position & Size */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Layout
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="X">
            <NumInput
              value={element.x}
              onChange={(x) => onChange({ x })}
            />
          </FieldRow>
          <FieldRow label="Y">
            <NumInput
              value={element.y}
              onChange={(y) => onChange({ y })}
            />
          </FieldRow>
          <FieldRow label="W">
            <NumInput
              value={element.width}
              onChange={(width) => onChange({ width })}
              min={10}
            />
          </FieldRow>
          <FieldRow label="H">
            <NumInput
              value={element.height}
              onChange={(height) => onChange({ height })}
              min={2}
            />
          </FieldRow>
        </div>
      </div>

      <Separator />

      {/* Text (for applicable types) */}
      {(element.type === "BUTTON" ||
        element.type === "TEXT" ||
        element.type === "FACEPLATE") && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Text
            </div>
            <FieldRow label="Content">
              <Input
                value={element.text ?? ""}
                onChange={(e) => onChange({ text: e.target.value })}
                className="h-7 text-xs"
              />
            </FieldRow>
            <FieldRow label="Size">
              <NumInput
                value={element.style.fontSize ?? 14}
                onChange={(fontSize) => updateStyle({ fontSize })}
                min={8}
                max={72}
              />
            </FieldRow>
            <FieldRow label="Weight">
              <Select
                value={element.style.fontWeight ?? "normal"}
                onValueChange={(v) =>
                  updateStyle({ fontWeight: v as "normal" | "bold" })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="bold">Bold</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Align">
              <Select
                value={element.style.textAlign ?? "left"}
                onValueChange={(v) =>
                  updateStyle({ textAlign: v as "left" | "center" | "right" })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Font">
              <Input
                value={element.style.fontFamily ?? ""}
                onChange={(e) => updateStyle({ fontFamily: e.target.value || undefined })}
                placeholder="Default"
                className="h-7 text-xs"
              />
            </FieldRow>
            <div className="flex items-center gap-3 pl-14">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.style.fontItalic ?? false}
                  onChange={(e) => updateStyle({ fontItalic: e.target.checked || undefined })}
                  className="h-3 w-3"
                />
                Italic
              </label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.style.fontUnderline ?? false}
                  onChange={(e) => updateStyle({ fontUnderline: e.target.checked || undefined })}
                  className="h-3 w-3"
                />
                Underline
              </label>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Tag binding (for IO fields, gauges, graphic views, bars, sliders, switches, trends) */}
      {(element.type === "IO_FIELD" ||
        element.type === "SYMBOLIC_IO_FIELD" ||
        element.type === "GRAPHIC_IO_FIELD" ||
        element.type === "GAUGE" ||
        element.type === "BAR" ||
        element.type === "SLIDER" ||
        element.type === "SWITCH" ||
        element.type === "GRAPHIC_VIEW") && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tag Binding
            </div>
            <FieldRow label="Tag">
              <Input
                value={element.tagBinding ?? ""}
                onChange={(e) => onChange({ tagBinding: e.target.value })}
                placeholder="HMI_Tag_Name"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Image List (for Graphic IO Fields) */}
      {element.type === "GRAPHIC_IO_FIELD" &&
        element.imageList &&
        element.imageList.length > 0 && (
          <>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Image List (State → Graphic)
              </div>
              <div className="space-y-1">
                {element.imageList.map((entry) => (
                  <div
                    key={entry.value}
                    className="flex items-center gap-2 rounded border border-border/50 px-2 py-1"
                  >
                    <span className="w-5 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
                      {entry.value}
                    </span>
                    <span className="flex-1 truncate font-mono text-[10px]">
                      {entry.graphicName}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Tag integer value selects which graphic to display
              </p>
            </div>
            <Separator />
          </>
        )}

      {/* Navigation (for buttons) */}
      {element.type === "BUTTON" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Navigation
            </div>
            <FieldRow label="Screen">
              <Input
                value={element.navigateTo ?? ""}
                onChange={(e) => onChange({ navigateTo: e.target.value })}
                placeholder="TARGET_SCREEN"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Full Tag Binding (expandable) */}
      {element.tagBindingSpec && (
        <>
          <TagBindingSection
            spec={element.tagBindingSpec}
            onChange={(tagBindingSpec) => onChange({ tagBindingSpec })}
          />
          <Separator />
        </>
      )}

      {/* Events */}
      <EventsSection
        events={element.events ?? []}
        onChange={(events) => onChange({ events })}
      />
      <Separator />

      {/* Faceplate Properties */}
      {element.type === "FACEPLATE" && (
        <>
          <FaceplatePropertiesSection
            properties={element.faceplateProperties ?? []}
            typeName={element.faceplateTypeName ?? ""}
            onChange={(faceplateProperties) => onChange({ faceplateProperties })}
            onTypeNameChange={(faceplateTypeName) => onChange({ faceplateTypeName })}
          />
          <Separator />
        </>
      )}

      {/* Text List Reference */}
      {(element.type === "SYMBOLIC_IO_FIELD" || element.type === "IO_FIELD") && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Text List
            </div>
            <FieldRow label="List">
              <Input
                value={element.textListRef?.listName ?? ""}
                onChange={(e) =>
                  onChange({
                    textListRef: e.target.value
                      ? { listName: e.target.value, tagName: element.textListRef?.tagName }
                      : undefined,
                  })
                }
                placeholder="GlobalTextList1"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
            {element.textListRef?.listName && (
              <FieldRow label="Tag">
                <Input
                  value={element.textListRef.tagName ?? ""}
                  onChange={(e) =>
                    onChange({
                      textListRef: {
                        ...element.textListRef!,
                        tagName: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="Selection tag"
                  className="h-7 font-mono text-xs"
                />
              </FieldRow>
            )}
          </div>
          <Separator />
        </>
      )}

      {/* Graphic List Reference */}
      {(element.type === "GRAPHIC_VIEW" || element.type === "GRAPHIC_IO_FIELD") && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Graphic List
            </div>
            <FieldRow label="List">
              <Input
                value={element.graphicListRef?.listName ?? ""}
                onChange={(e) =>
                  onChange({
                    graphicListRef: e.target.value
                      ? { listName: e.target.value, tagName: element.graphicListRef?.tagName }
                      : undefined,
                  })
                }
                placeholder="GlobalGraphicList1"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
            {element.graphicListRef?.listName && (
              <FieldRow label="Tag">
                <Input
                  value={element.graphicListRef.tagName ?? ""}
                  onChange={(e) =>
                    onChange({
                      graphicListRef: {
                        ...element.graphicListRef!,
                        tagName: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="Selection tag"
                  className="h-7 font-mono text-xs"
                />
              </FieldRow>
            )}
          </div>
          <Separator />
        </>
      )}

      {/* IO Field Properties */}
      {element.type === "IO_FIELD" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              IO Field
            </div>
            <FieldRow label="Mode">
              <Select
                value={element.ioFieldMode ?? "output"}
                onValueChange={(v) => onChange({ ioFieldMode: v as HmiElement["ioFieldMode"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="input">Input</SelectItem>
                  <SelectItem value="output">Output</SelectItem>
                  <SelectItem value="input_output">Input/Output</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Format">
              <Select
                value={element.ioFieldFormat ?? "decimal"}
                onValueChange={(v) => onChange({ ioFieldFormat: v as HmiElement["ioFieldFormat"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="decimal">Decimal</SelectItem>
                  <SelectItem value="hexadecimal">Hexadecimal</SelectItem>
                  <SelectItem value="binary">Binary</SelectItem>
                  <SelectItem value="string">String</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="time">Time</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Dec.">
              <NumInput
                value={element.ioFieldDecimalPlaces ?? 0}
                onChange={(ioFieldDecimalPlaces) => onChange({ ioFieldDecimalPlaces })}
                min={0}
                max={10}
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Button Mode */}
      {element.type === "BUTTON" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Button
            </div>
            <FieldRow label="Mode">
              <Select
                value={element.buttonMode ?? "press"}
                onValueChange={(v) => onChange({ buttonMode: v as HmiElement["buttonMode"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="press">Press</SelectItem>
                  <SelectItem value="toggle">Toggle</SelectItem>
                  <SelectItem value="latching">Latching</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Screen Window Properties */}
      {element.type === "SCREEN_WINDOW" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Screen Window
            </div>
            <FieldRow label="Screen">
              <Input
                value={element.screenWindowName ?? ""}
                onChange={(e) => onChange({ screenWindowName: e.target.value })}
                placeholder="SCREEN_NAME"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
            <FieldRow label="Modal">
              <Select
                value={element.screenWindowModal ? "true" : "false"}
                onValueChange={(v) => onChange({ screenWindowModal: v === "true" })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">No</SelectItem>
                  <SelectItem value="true">Yes</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Pipe Properties */}
      {element.type === "PIPE" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pipe
            </div>
            <FieldRow label="Dir.">
              <Select
                value={element.pipeDirection ?? "horizontal"}
                onValueChange={(v) => onChange({ pipeDirection: v as HmiElement["pipeDirection"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                  <SelectItem value="vertical">Vertical</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Dia.">
              <NumInput
                value={element.pipeDiameter ?? 20}
                onChange={(pipeDiameter) => onChange({ pipeDiameter })}
                min={4}
                max={60}
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Value Range (for bars, sliders, gauges) */}
      {(element.type === "BAR" ||
        element.type === "SLIDER" ||
        element.type === "GAUGE") && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Value Range
            </div>
            <FieldRow label="Min">
              <NumInput
                value={element.valueMin ?? 0}
                onChange={(valueMin) => onChange({ valueMin })}
              />
            </FieldRow>
            <FieldRow label="Max">
              <NumInput
                value={element.valueMax ?? 100}
                onChange={(valueMax) => onChange({ valueMax })}
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* GraphicView SizeMode */}
      {element.type === "GRAPHIC_VIEW" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Graphic View
            </div>
            <FieldRow label="Size">
              <Select
                value={element.graphicSizeMode ?? "stretch"}
                onValueChange={(v) => onChange({ graphicSizeMode: v as HmiElement["graphicSizeMode"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stretch">Stretch</SelectItem>
                  <SelectItem value="zoom">Zoom</SelectItem>
                  <SelectItem value="original">Original</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Bar Extended Properties */}
      {element.type === "BAR" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Bar Graph
            </div>
            <FieldRow label="Orient.">
              <Select
                value={element.orientation ?? "vertical"}
                onValueChange={(v) => onChange({ orientation: v as "horizontal" | "vertical" })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical">Vertical</SelectItem>
                  <SelectItem value="horizontal">Horizontal</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <div className="flex items-center gap-3 pl-14">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.barShowScale ?? false}
                  onChange={(e) => onChange({ barShowScale: e.target.checked || undefined })}
                  className="h-3 w-3"
                />
                Scale
              </label>
            </div>
            {element.barShowScale && (
              <FieldRow label="Divs.">
                <NumInput
                  value={element.barScaleDivisions ?? 5}
                  onChange={(barScaleDivisions) => onChange({ barScaleDivisions })}
                  min={2}
                  max={20}
                />
              </FieldRow>
            )}
            <FieldRow label="Fill">
              <ColorInput
                value={element.barFillColor ?? "#22c55e"}
                onChange={(barFillColor) => onChange({ barFillColor })}
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Gauge Extended Properties */}
      {element.type === "GAUGE" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Gauge
            </div>
            <FieldRow label="Start">
              <NumInput
                value={element.gaugeStartAngle ?? 225}
                onChange={(gaugeStartAngle) => onChange({ gaugeStartAngle })}
                min={0}
                max={360}
              />
            </FieldRow>
            <FieldRow label="End">
              <NumInput
                value={element.gaugeEndAngle ?? 315}
                onChange={(gaugeEndAngle) => onChange({ gaugeEndAngle })}
                min={0}
                max={360}
              />
            </FieldRow>
            <FieldRow label="Ticks">
              <NumInput
                value={element.gaugeTicks ?? 10}
                onChange={(gaugeTicks) => onChange({ gaugeTicks })}
                min={2}
                max={50}
              />
            </FieldRow>
            <div className="flex items-center gap-3 pl-14">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.gaugeShowLabels ?? true}
                  onChange={(e) => onChange({ gaugeShowLabels: e.target.checked })}
                  className="h-3 w-3"
                />
                Labels
              </label>
            </div>
            <FieldRow label="Needle">
              <ColorInput
                value={element.gaugeNeedleColor ?? "#ef4444"}
                onChange={(gaugeNeedleColor) => onChange({ gaugeNeedleColor })}
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* TrendView Extended Properties */}
      {element.type === "TREND_VIEW" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Trend View
            </div>
            <div className="flex flex-wrap items-center gap-3 pl-14">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.trendShowToolbar ?? true}
                  onChange={(e) => onChange({ trendShowToolbar: e.target.checked })}
                  className="h-3 w-3"
                />
                Toolbar
              </label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.trendShowLegend ?? true}
                  onChange={(e) => onChange({ trendShowLegend: e.target.checked })}
                  className="h-3 w-3"
                />
                Legend
              </label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.trendShowGrid ?? true}
                  onChange={(e) => onChange({ trendShowGrid: e.target.checked })}
                  className="h-3 w-3"
                />
                Grid
              </label>
            </div>
            <div className="flex items-center gap-3 pl-14">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.trendAutoScale ?? true}
                  onChange={(e) => onChange({ trendAutoScale: e.target.checked })}
                  className="h-3 w-3"
                />
                Auto Scale Y
              </label>
            </div>
            {!element.trendAutoScale && (
              <>
                <FieldRow label="Y Min">
                  <NumInput
                    value={element.trendYMin ?? 0}
                    onChange={(trendYMin) => onChange({ trendYMin })}
                  />
                </FieldRow>
                <FieldRow label="Y Max">
                  <NumInput
                    value={element.trendYMax ?? 100}
                    onChange={(trendYMax) => onChange({ trendYMax })}
                  />
                </FieldRow>
              </>
            )}
            <FieldRow label="Time">
              <NumInput
                value={element.trendTimeRange ?? 60}
                onChange={(trendTimeRange) => onChange({ trendTimeRange })}
                min={1}
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* AlarmView Extended Properties */}
      {element.type === "ALARM_VIEW" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Alarm View
            </div>
            <FieldRow label="Filter">
              <Input
                value={element.alarmFilter ?? ""}
                onChange={(e) => onChange({ alarmFilter: e.target.value || undefined })}
                placeholder="Filter expression"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
            <FieldRow label="Sort">
              <Select
                value={element.alarmSortColumn ?? "Time"}
                onValueChange={(v) => onChange({ alarmSortColumn: v })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HMI_ALARM_COLUMNS.map((col) => (
                    <SelectItem key={col} value={col}>{col}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Dir.">
              <Select
                value={element.alarmSortDirection ?? "descending"}
                onValueChange={(v) => onChange({ alarmSortDirection: v as "ascending" | "descending" })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ascending">Ascending</SelectItem>
                  <SelectItem value="descending">Descending</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Rows">
              <NumInput
                value={element.alarmMaxRows ?? 100}
                onChange={(alarmMaxRows) => onChange({ alarmMaxRows })}
                min={10}
                max={1000}
              />
            </FieldRow>
            <div className="flex items-center gap-3 pl-14">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={element.alarmShowAcknowledged ?? true}
                  onChange={(e) => onChange({ alarmShowAcknowledged: e.target.checked })}
                  className="h-3 w-3"
                />
                Show Ack'd
              </label>
            </div>
            <AlarmColumnsSection
              columns={element.alarmColumns ?? []}
              onChange={(alarmColumns) => onChange({ alarmColumns })}
            />
          </div>
          <Separator />
        </>
      )}

      {/* Date/Time Format */}
      {element.type === "DATE_TIME" && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Format
            </div>
            <FieldRow label="Format">
              <Input
                value={element.dateTimeFormat ?? "yyyy-MM-dd HH:mm:ss"}
                onChange={(e) => onChange({ dateTimeFormat: e.target.value })}
                placeholder="yyyy-MM-dd HH:mm:ss"
                className="h-7 font-mono text-xs"
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Tooltip */}
      {element.tooltip !== undefined && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tooltip
            </div>
            <FieldRow label="Text">
              <Input
                value={element.tooltip ?? ""}
                onChange={(e) => onChange({ tooltip: e.target.value })}
                className="h-7 text-xs"
              />
            </FieldRow>
          </div>
          <Separator />
        </>
      )}

      {/* Multilingual Text */}
      {(element.type === "BUTTON" || element.type === "TEXT" || element.type === "FACEPLATE") && (
        <>
          <MultilingualTextSection
            entries={element.multilingualText ?? []}
            onChange={(multilingualText) => onChange({ multilingualText: multilingualText.length > 0 ? multilingualText : undefined })}
          />
          <Separator />
        </>
      )}

      {/* Access Level */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Access
        </div>
        <FieldRow label="Level">
          <Select
            value={element.accessLevel ?? "None"}
            onValueChange={(v) => onChange({ accessLevel: v === "None" ? undefined : v as HmiElement["accessLevel"] })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HMI_ACCESS_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>{level}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </div>
      <Separator />

      {/* Appearance */}
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Appearance
        </div>
        {element.type !== "LINE" && element.type !== "GROUP" && (
          <FieldRow label="Fill">
            <ColorInput
              value={element.style.backgroundColor ?? "#1e293b"}
              onChange={(backgroundColor) => updateStyle({ backgroundColor })}
            />
          </FieldRow>
        )}
        <FieldRow label="Border">
          <ColorInput
            value={element.style.borderColor ?? "#334155"}
            onChange={(borderColor) => updateStyle({ borderColor })}
          />
        </FieldRow>
        <FieldRow label="Border W">
          <NumInput
            value={element.style.borderWidth ?? 1}
            onChange={(borderWidth) => updateStyle({ borderWidth })}
            min={0}
            max={10}
          />
        </FieldRow>
        {element.style.textColor !== undefined && (
          <FieldRow label="Text">
            <ColorInput
              value={element.style.textColor}
              onChange={(textColor) => updateStyle({ textColor })}
            />
          </FieldRow>
        )}
        <FieldRow label="Radius">
          <NumInput
            value={element.style.borderRadius ?? 0}
            onChange={(borderRadius) => updateStyle({ borderRadius })}
            min={0}
            max={999}
          />
        </FieldRow>
      </div>
    </div>
  );
}

// ---- Helpers ----

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">
        {label}
      </Label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseInt(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className="h-7 font-mono text-xs"
    />
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 font-mono text-xs"
      />
    </div>
  );
}

// ---- Events Section ----

function EventsSection({
  events,
  onChange,
}: {
  events: HmiEventAction[];
  onChange: (events: HmiEventAction[]) => void;
}) {
  const addEvent = () => {
    onChange([
      ...events,
      { eventType: "CLICK" as HmiEventType, functionName: "SetTag", parameters: {} },
    ]);
  };

  const removeEvent = (idx: number) => {
    onChange(events.filter((_, i) => i !== idx));
  };

  const updateEvent = (idx: number, patch: Partial<HmiEventAction>) => {
    onChange(events.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const sysFuncDef = (name: string) =>
    HMI_SYSTEM_FUNCTIONS.find((f) => f.name === name);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Events
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={addEvent}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {events.map((evt, idx) => {
        const funcDef = sysFuncDef(evt.functionName);
        return (
          <div key={idx} className="space-y-1.5 rounded border border-border/50 p-1.5">
            <div className="flex items-center gap-1">
              <Select
                value={evt.eventType}
                onValueChange={(v) => updateEvent(idx, { eventType: v as HmiEventType })}
              >
                <SelectTrigger className="h-6 flex-1 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(HMI_EVENT_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-destructive"
                onClick={() => removeEvent(idx)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Select
              value={evt.functionName}
              onValueChange={(v) => updateEvent(idx, { functionName: v, parameters: {} })}
            >
              <SelectTrigger className="h-6 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HMI_SYSTEM_FUNCTION_CATEGORIES).map(([catKey, catLabel]) => {
                  const funcs = HMI_SYSTEM_FUNCTIONS.filter((f) => f.category === catKey);
                  if (!funcs.length) return null;
                  return (
                    <div key={catKey}>
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        {catLabel}
                      </div>
                      {funcs.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </div>
                  );
                })}
              </SelectContent>
            </Select>
            {funcDef?.params
              .filter((p) => p.required)
              .map((p) => (
                <FieldRow key={p.name} label={p.name}>
                  <Input
                    value={String(evt.parameters?.[p.name] ?? "")}
                    onChange={(e) =>
                      updateEvent(idx, {
                        parameters: {
                          ...evt.parameters,
                          [p.name]: p.type === "number" ? Number(e.target.value) || 0 : p.type === "boolean" ? e.target.value === "true" : e.target.value,
                        },
                      })
                    }
                    placeholder={p.description}
                    className="h-6 font-mono text-[10px]"
                  />
                </FieldRow>
              ))}
          </div>
        );
      })}
      {events.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No events configured</p>
      )}
    </div>
  );
}

// ---- Full Tag Binding Section ----

function TagBindingSection({
  spec,
  onChange,
}: {
  spec: HmiTagBinding;
  onChange: (spec: HmiTagBinding) => void;
}) {
  const update = (patch: Partial<HmiTagBinding>) => onChange({ ...spec, ...patch });

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Tag Binding (Advanced)
      </div>
      <FieldRow label="Tag">
        <Input
          value={spec.tagName}
          onChange={(e) => update({ tagName: e.target.value })}
          className="h-7 font-mono text-xs"
          placeholder="HMI_Tag"
        />
      </FieldRow>
      <FieldRow label="PLC Tag">
        <Input
          value={spec.plcTag ?? ""}
          onChange={(e) => update({ plcTag: e.target.value || undefined })}
          className="h-7 font-mono text-xs"
          placeholder='"DB".variable'
        />
      </FieldRow>
      <FieldRow label="Type">
        <Select
          value={spec.dataType ?? ""}
          onValueChange={(v) => update({ dataType: v as HmiTagBinding["dataType"] })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Auto" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(HMI_TAG_DATA_TYPES).map(([k, v]) => (
              <SelectItem key={k} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Acquire">
        <Select
          value={spec.acquisitionMode ?? ""}
          onValueChange={(v) => update({ acquisitionMode: v as HmiTagBinding["acquisitionMode"] })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(HMI_TAG_ACQUISITION_MODES).map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Cycle">
        <Select
          value={spec.acquisitionCycle ?? ""}
          onValueChange={(v) => update({ acquisitionCycle: v as HmiTagBinding["acquisitionCycle"] })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {HMI_TAG_ACQUISITION_CYCLES.map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Mode">
        <Select
          value={spec.updateMode ?? ""}
          onValueChange={(v) => update({ updateMode: v as HmiTagBinding["updateMode"] })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(HMI_TAG_UPDATE_MODES).map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <FieldRow label="Conn.">
        <Input
          value={spec.connection ?? ""}
          onChange={(e) => update({ connection: e.target.value || undefined })}
          className="h-7 font-mono text-xs"
          placeholder="HMI_Connection_1"
        />
      </FieldRow>
    </div>
  );
}

// ---- Faceplate Properties Section ----

function FaceplatePropertiesSection({
  properties,
  typeName,
  onChange,
  onTypeNameChange,
}: {
  properties: HmiFaceplateProperty[];
  typeName: string;
  onChange: (props: HmiFaceplateProperty[]) => void;
  onTypeNameChange: (name: string) => void;
}) {
  const addProperty = () => {
    onChange([
      ...properties,
      { name: "NewProp", direction: "In", dataType: "Bool" },
    ]);
  };

  const removeProperty = (idx: number) => {
    onChange(properties.filter((_, i) => i !== idx));
  };

  const updateProperty = (idx: number, patch: Partial<HmiFaceplateProperty>) => {
    onChange(properties.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Faceplate Interface
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={addProperty}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <FieldRow label="Type">
        <Input
          value={typeName}
          onChange={(e) => onTypeNameChange(e.target.value)}
          placeholder="FP_Motor"
          className="h-7 font-mono text-xs"
        />
      </FieldRow>
      {properties.map((prop, idx) => (
        <div key={idx} className="space-y-1 rounded border border-border/50 p-1.5">
          <div className="flex items-center gap-1">
            <Input
              value={prop.name}
              onChange={(e) => updateProperty(idx, { name: e.target.value })}
              className="h-6 flex-1 font-mono text-[10px]"
              placeholder="PropName"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-destructive"
              onClick={() => removeProperty(idx)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-1">
            <Select
              value={prop.direction}
              onValueChange={(v) => updateProperty(idx, { direction: v as HmiFaceplateProperty["direction"] })}
            >
              <SelectTrigger className="h-6 w-16 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(HMI_FACEPLATE_DIRECTIONS).map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={prop.dataType}
              onValueChange={(v) => updateProperty(idx, { dataType: v as HmiFaceplateProperty["dataType"] })}
            >
              <SelectTrigger className="h-6 flex-1 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HMI_TAG_DATA_TYPES).map(([k, v]) => (
                  <SelectItem key={k} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FieldRow label="Bind">
            <Input
              value={prop.binding ?? ""}
              onChange={(e) => updateProperty(idx, { binding: e.target.value || undefined })}
              className="h-6 font-mono text-[10px]"
              placeholder="Tag binding"
            />
          </FieldRow>
        </div>
      ))}
      {properties.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No interface properties</p>
      )}
    </div>
  );
}

// ---- Multilingual Text Section ----

function MultilingualTextSection({
  entries,
  onChange,
}: {
  entries: HmiMultilingualText[];
  onChange: (entries: HmiMultilingualText[]) => void;
}) {
  const availableLangs = Object.values(HMI_LANGUAGES);
  const usedLangIds = new Set(entries.map((e) => e.languageId));

  const addLanguage = () => {
    const nextLang = availableLangs.find((l) => !usedLangIds.has(l.id));
    if (nextLang) {
      onChange([...entries, { languageId: nextLang.id, text: "" }]);
    }
  };

  const removeEntry = (langId: number) => {
    onChange(entries.filter((e) => e.languageId !== langId));
  };

  const updateEntry = (langId: number, text: string) => {
    onChange(entries.map((e) => (e.languageId === langId ? { ...e, text } : e)));
  };

  const langLabel = (id: number) =>
    availableLangs.find((l) => l.id === id)?.label ?? `LCID ${id}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Multilingual
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={addLanguage}
          disabled={usedLangIds.size >= availableLangs.length}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {entries.map((entry) => (
        <div key={entry.languageId} className="flex items-center gap-1">
          <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">
            {langLabel(entry.languageId).slice(0, 4)}
          </span>
          <Input
            value={entry.text}
            onChange={(e) => updateEntry(entry.languageId, e.target.value)}
            className="h-6 flex-1 text-[10px]"
            placeholder={langLabel(entry.languageId)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-destructive"
            onClick={() => removeEntry(entry.languageId)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {entries.length === 0 && (
        <p className="text-[10px] text-muted-foreground">Single language (default)</p>
      )}
    </div>
  );
}

// ---- Alarm Columns Section ----

function AlarmColumnsSection({
  columns,
  onChange,
}: {
  columns: HmiAlarmColumn[];
  onChange: (cols: HmiAlarmColumn[]) => void;
}) {
  const initColumns = () => {
    onChange(
      HMI_ALARM_COLUMNS.map((id) => ({
        columnId: id,
        visible: true,
        width: id === "Text" ? 200 : id === "Time" || id === "Date" ? 120 : 80,
      }))
    );
  };

  const toggleColumn = (colId: string) => {
    const existing = columns.find((c) => c.columnId === colId);
    if (existing) {
      onChange(
        columns.map((c) =>
          c.columnId === colId ? { ...c, visible: !c.visible } : c
        )
      );
    } else {
      onChange([...columns, { columnId: colId, visible: true, width: 80 }]);
    }
  };

  if (columns.length === 0) {
    return (
      <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={initColumns}>
        Configure Columns
      </Button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-muted-foreground">Columns</div>
      {HMI_ALARM_COLUMNS.map((colId) => {
        const col = columns.find((c) => c.columnId === colId);
        const isVisible = col?.visible ?? false;
        return (
          <label
            key={colId}
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
          >
            <input
              type="checkbox"
              checked={isVisible}
              onChange={() => toggleColumn(colId)}
              className="h-3 w-3"
            />
            {colId}
          </label>
        );
      })}
    </div>
  );
}
