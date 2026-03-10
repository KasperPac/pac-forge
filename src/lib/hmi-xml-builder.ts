/**
 * Generates WinCC Comfort SimaticML XML from HmiScreenSpec for TIA Portal Openness import.
 * This is the reverse of hmi-xml-parser.ts — takes our internal spec and produces valid XML.
 */
import type {
  HmiElement,
  HmiScreenSpec,
  HmiEventAction,
  HmiAnimation,
  HmiTagBinding,
  HmiFaceplateProperty,
  HmiAlarmDefinition,
} from "@/types/hmi-screen";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate a complete SimaticML screen XML document from an HmiScreenSpec */
export function buildScreenXml(
  screen: HmiScreenSpec,
  tiaVersion = "V18",
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<Document>`);
  lines.push(`  <Engineering version="${esc(tiaVersion)}" />`);
  lines.push(`  <Hmi.Screen.Screen ID="0" CompositionName="Screens">`);
  lines.push(`    <AttributeList>`);
  lines.push(`      <BackColor>${hexToTiaColor(screen.backgroundColor)}</BackColor>`);
  lines.push(`      <Height>${screen.height}</Height>`);
  lines.push(`      <Name>${esc(screen.name)}</Name>`);
  if (screen.screenNumber != null) {
    lines.push(`      <Number>${screen.screenNumber}</Number>`);
  }
  lines.push(`      <Width>${screen.width}</Width>`);
  lines.push(`    </AttributeList>`);
  lines.push(`    <ObjectList>`);

  // Screen-level events
  if (screen.screenEvents && screen.screenEvents.length > 0) {
    for (const evt of screen.screenEvents) {
      lines.push(...indent(6, buildEventXml(evt)));
    }
  }

  // Layer containing all elements
  lines.push(`      <Hmi.Screen.ScreenLayer CompositionName="Layers">`);
  lines.push(`        <AttributeList>`);
  lines.push(`          <Name>Default Layer</Name>`);
  lines.push(`        </AttributeList>`);
  lines.push(`        <ObjectList>`);

  for (const el of screen.elements) {
    lines.push(...indent(10, buildElementXml(el)));
  }

  lines.push(`        </ObjectList>`);
  lines.push(`      </Hmi.Screen.ScreenLayer>`);
  lines.push(`    </ObjectList>`);
  lines.push(`  </Hmi.Screen.Screen>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}

/** Generate a SimaticML HMI tag table XML from tag binding specs */
export function buildTagTableXml(
  tableName: string,
  tags: HmiTagBinding[],
  tiaVersion = "V18",
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<Document>`);
  lines.push(`  <Engineering version="${esc(tiaVersion)}" />`);
  lines.push(`  <Hmi.Tag.TagTable ID="0" CompositionName="TagTables">`);
  lines.push(`    <AttributeList>`);
  lines.push(`      <Name>${esc(tableName)}</Name>`);
  lines.push(`    </AttributeList>`);
  lines.push(`    <ObjectList>`);

  for (const tag of tags) {
    lines.push(`      <Hmi.Tag.Tag CompositionName="Tags">`);
    lines.push(`        <AttributeList>`);
    if (tag.acquisitionCycle) {
      lines.push(`          <AcquisitionCycle>${esc(tag.acquisitionCycle)}</AcquisitionCycle>`);
    }
    if (tag.acquisitionMode) {
      const modeMap: Record<string, string> = {
        "Cyclic in operation": "CyclicInOperation",
        "Cyclic continuous": "CyclicContinuous",
        "On demand": "OnDemand",
      };
      lines.push(`          <AcquisitionMode>${modeMap[tag.acquisitionMode] ?? "CyclicInOperation"}</AcquisitionMode>`);
    }
    lines.push(`          <Name>${esc(tag.tagName)}</Name>`);
    if (tag.updateMode) {
      lines.push(`          <UpdateMode>${tag.updateMode === "Read/Write" ? "ReadWrite" : tag.updateMode}</UpdateMode>`);
    }
    lines.push(`        </AttributeList>`);
    lines.push(`        <LinkList>`);
    if (tag.dataType) {
      lines.push(`          <DataType TargetID="@OpenLink">`);
      lines.push(`            <Name>${esc(tag.dataType)}</Name>`);
      lines.push(`          </DataType>`);
    }
    if (tag.plcTag) {
      lines.push(`          <PlcTag TargetID="@OpenLink">`);
      lines.push(`            <Name>${esc(tag.plcTag)}</Name>`);
      lines.push(`          </PlcTag>`);
    }
    if (tag.connection) {
      lines.push(`          <Connection TargetID="@OpenLink">`);
      lines.push(`            <Name>${esc(tag.connection)}</Name>`);
      lines.push(`          </Connection>`);
    }
    lines.push(`        </LinkList>`);
    lines.push(`      </Hmi.Tag.Tag>`);
  }

  lines.push(`    </ObjectList>`);
  lines.push(`  </Hmi.Tag.TagTable>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}

/** Generate a global text list XML */
export function buildTextListXml(
  listName: string,
  entries: Array<{ value: number; text: string; language?: string }>,
  tiaVersion = "V18",
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<Document>`);
  lines.push(`  <Engineering version="${esc(tiaVersion)}" />`);
  lines.push(`  <Hmi.TextGraphicList.TextList ID="0" CompositionName="TextLists">`);
  lines.push(`    <AttributeList>`);
  lines.push(`      <Name>${esc(listName)}</Name>`);
  lines.push(`    </AttributeList>`);
  lines.push(`    <ObjectList>`);

  for (const entry of entries) {
    lines.push(`      <Hmi.TextGraphicList.TextListEntry CompositionName="Entries">`);
    lines.push(`        <AttributeList>`);
    lines.push(`          <RangeFrom>${entry.value}</RangeFrom>`);
    lines.push(`          <RangeTo>${entry.value}</RangeTo>`);
    lines.push(`          <Text>${esc(entry.text)}</Text>`);
    lines.push(`        </AttributeList>`);
    lines.push(`      </Hmi.TextGraphicList.TextListEntry>`);
  }

  lines.push(`    </ObjectList>`);
  lines.push(`  </Hmi.TextGraphicList.TextList>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}

/** Generate a global graphic list XML */
export function buildGraphicListXml(
  listName: string,
  entries: Array<{ value: number; graphicName: string }>,
  tiaVersion = "V18",
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<Document>`);
  lines.push(`  <Engineering version="${esc(tiaVersion)}" />`);
  lines.push(`  <Hmi.TextGraphicList.GraphicList ID="0" CompositionName="GraphicLists">`);
  lines.push(`    <AttributeList>`);
  lines.push(`      <Name>${esc(listName)}</Name>`);
  lines.push(`    </AttributeList>`);
  lines.push(`    <ObjectList>`);

  for (const entry of entries) {
    lines.push(`      <Hmi.TextGraphicList.GraphicListEntry CompositionName="Entries">`);
    lines.push(`        <AttributeList>`);
    lines.push(`          <RangeFrom>${entry.value}</RangeFrom>`);
    lines.push(`          <RangeTo>${entry.value}</RangeTo>`);
    lines.push(`        </AttributeList>`);
    lines.push(`        <LinkList>`);
    lines.push(`          <Graphic TargetID="@OpenLink">`);
    lines.push(`            <Name>${esc(entry.graphicName)}</Name>`);
    lines.push(`          </Graphic>`);
    lines.push(`        </LinkList>`);
    lines.push(`      </Hmi.TextGraphicList.GraphicListEntry>`);
  }

  lines.push(`    </ObjectList>`);
  lines.push(`  </Hmi.TextGraphicList.GraphicList>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}

/** Generate a WinCC discrete alarm configuration XML */
export function buildAlarmXml(
  alarms: HmiAlarmDefinition[],
  tiaVersion = "V18",
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<Document>`);
  lines.push(`  <Engineering version="${esc(tiaVersion)}" />`);
  lines.push(`  <Hmi.Alarm.DiscreteAlarms ID="0" CompositionName="DiscreteAlarms">`);
  lines.push(`    <ObjectList>`);

  for (const alarm of alarms) {
    lines.push(`      <Hmi.Alarm.DiscreteAlarm CompositionName="DiscreteAlarms">`);
    lines.push(`        <AttributeList>`);
    lines.push(`          <AlarmNumber>${alarm.alarmNumber}</AlarmNumber>`);
    if (alarm.alarmClass) {
      lines.push(`          <AlarmClass>${esc(alarm.alarmClass)}</AlarmClass>`);
    }
    if (alarm.priority != null) {
      lines.push(`          <Priority>${alarm.priority}</Priority>`);
    }
    lines.push(`          <AlarmText>${esc(alarm.alarmText)}</AlarmText>`);
    if (alarm.infoText) {
      lines.push(`          <InfoText>${esc(alarm.infoText)}</InfoText>`);
    }
    if (alarm.acknowledgeable != null) {
      lines.push(`          <Acknowledgeable>${alarm.acknowledgeable}</Acknowledgeable>`);
    }
    if (alarm.triggerBit != null) {
      lines.push(`          <TriggerBit>${alarm.triggerBit}</TriggerBit>`);
    }
    lines.push(`        </AttributeList>`);
    lines.push(`        <LinkList>`);
    lines.push(`          <TriggerTag TargetID="@OpenLink">`);
    lines.push(`            <Name>${esc(alarm.triggerTag)}</Name>`);
    lines.push(`          </TriggerTag>`);
    lines.push(`        </LinkList>`);
    lines.push(`      </Hmi.Alarm.DiscreteAlarm>`);
  }

  lines.push(`    </ObjectList>`);
  lines.push(`  </Hmi.Alarm.DiscreteAlarms>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}

/** Generate a faceplate type definition XML from a screen spec */
export function buildFaceplateTypeXml(
  name: string,
  screen: HmiScreenSpec,
  interfaceProps: HmiFaceplateProperty[],
  tiaVersion = "V18",
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="utf-8"?>`);
  lines.push(`<Document>`);
  lines.push(`  <Engineering version="${esc(tiaVersion)}" />`);
  lines.push(`  <Hmi.Screen.FaceplateType ID="0" CompositionName="FaceplateTypes">`);
  lines.push(`    <AttributeList>`);
  lines.push(`      <Height>${screen.height}</Height>`);
  lines.push(`      <Name>${esc(name)}</Name>`);
  lines.push(`      <Width>${screen.width}</Width>`);
  lines.push(`    </AttributeList>`);

  // Interface properties
  if (interfaceProps.length > 0) {
    lines.push(`    <InterfaceList>`);
    for (const prop of interfaceProps) {
      lines.push(...indent(6, buildFaceplatePropertyXml(prop)));
    }
    lines.push(`    </InterfaceList>`);
  }

  // Screen items (same as screen layer)
  lines.push(`    <ObjectList>`);
  lines.push(`      <Hmi.Screen.ScreenLayer CompositionName="Layers">`);
  lines.push(`        <AttributeList>`);
  lines.push(`          <Name>Default Layer</Name>`);
  lines.push(`        </AttributeList>`);
  lines.push(`        <ObjectList>`);

  for (const el of screen.elements) {
    lines.push(...indent(10, buildElementXml(el)));
  }

  lines.push(`        </ObjectList>`);
  lines.push(`      </Hmi.Screen.ScreenLayer>`);
  lines.push(`    </ObjectList>`);
  lines.push(`  </Hmi.Screen.FaceplateType>`);
  lines.push(`</Document>`);

  return lines.join("\n");
}

/** Extract all unique tag bindings from a screen spec for tag table generation */
export function extractTagBindings(screen: HmiScreenSpec): HmiTagBinding[] {
  const tags = new Map<string, HmiTagBinding>();

  for (const el of screen.elements) {
    // Full tag binding spec
    if (el.tagBindingSpec) {
      tags.set(el.tagBindingSpec.tagName, el.tagBindingSpec);
    }
    // Simple tag binding string — create a minimal spec
    else if (el.tagBinding) {
      if (!tags.has(el.tagBinding)) {
        tags.set(el.tagBinding, { tagName: el.tagBinding });
      }
    }

    // Tags from animations
    if (el.animations) {
      for (const anim of el.animations) {
        if (anim.tagName && !tags.has(anim.tagName)) {
          tags.set(anim.tagName, { tagName: anim.tagName });
        }
      }
    }

    // Tags from events
    if (el.events) {
      for (const evt of el.events) {
        if (evt.parameters) {
          for (const [, val] of Object.entries(evt.parameters)) {
            if (typeof val === "string" && val.includes(".") && !tags.has(val)) {
              // Looks like a tag reference (e.g. "DB_Motor".start)
              tags.set(val, { tagName: val });
            }
          }
        }
      }
    }

    // Tags from faceplate properties
    if (el.faceplateProperties) {
      for (const prop of el.faceplateProperties) {
        if (prop.binding && !tags.has(prop.binding)) {
          tags.set(prop.binding, { tagName: prop.binding });
        }
      }
    }

    // Tags from text/graphic list refs
    if (el.textListRef?.tagName && !tags.has(el.textListRef.tagName)) {
      tags.set(el.textListRef.tagName, { tagName: el.textListRef.tagName });
    }
    if (el.graphicListRef?.tagName && !tags.has(el.graphicListRef.tagName)) {
      tags.set(el.graphicListRef.tagName, { tagName: el.graphicListRef.tagName });
    }

    // Tags from trend tags
    if (el.trendTags) {
      for (const tt of el.trendTags) {
        if (!tags.has(tt.tagName)) {
          tags.set(tt.tagName, { tagName: tt.tagName });
        }
      }
    }
  }

  return Array.from(tags.values());
}

// ---------------------------------------------------------------------------
// Element XML builders
// ---------------------------------------------------------------------------

const ELEMENT_XML_MAP: Record<string, string> = {
  RECTANGLE: "Hmi.Screen.Rectangle",
  BUTTON: "Hmi.Screen.Button",
  TEXT: "Hmi.Screen.TextField",
  IO_FIELD: "Hmi.Screen.IOField",
  GRAPHIC_VIEW: "Hmi.Screen.GraphicView",
  GRAPHIC_IO_FIELD: "Hmi.Screen.GraphicIOField",
  SYMBOLIC_IO_FIELD: "Hmi.Screen.SymbolicIOField",
  LINE: "Hmi.Screen.Line",
  CIRCLE: "Hmi.Screen.Circle",
  ELLIPSE: "Hmi.Screen.Ellipse",
  POLYGON: "Hmi.Screen.Polygon",
  GAUGE: "Hmi.Screen.Gauge",
  BAR: "Hmi.Screen.Bar",
  SLIDER: "Hmi.Screen.Slider",
  SWITCH: "Hmi.Screen.Switch",
  TREND_VIEW: "Hmi.Screen.TrendView",
  ALARM_VIEW: "Hmi.Screen.AlarmView",
  DATE_TIME: "Hmi.Screen.DateTimeField",
  GROUP: "Hmi.Screen.Group",
  FACEPLATE: "Hmi.Screen.FaceplateInstance",
  POLYLINE: "Hmi.Screen.Polyline",
  CLOCK: "Hmi.Screen.Clock",
  PIPE: "Hmi.Screen.Pipe",
  SCREEN_WINDOW: "Hmi.Screen.ScreenWindow",
};

function buildElementXml(el: HmiElement): string[] {
  const xmlTag = ELEMENT_XML_MAP[el.type];
  if (!xmlTag) return [];

  const lines: string[] = [];
  lines.push(`<${xmlTag} CompositionName="ScreenItems">`);
  lines.push(`  <AttributeList>`);

  // Common attributes
  if (el.style.backgroundColor && el.style.backgroundColor !== "transparent") {
    lines.push(`    <BackColor>${hexToTiaColor(el.style.backgroundColor)}</BackColor>`);
  }
  if (el.style.borderColor) {
    lines.push(`    <BorderColor>${hexToTiaColor(el.style.borderColor)}</BorderColor>`);
  }
  if (el.style.borderWidth != null) {
    lines.push(`    <BorderWidth>${el.style.borderWidth}</BorderWidth>`);
  }
  if (el.style.borderRadius && el.style.borderRadius > 0) {
    lines.push(`    <CornerRadius>${el.style.borderRadius}</CornerRadius>`);
  }
  if (el.style.textColor) {
    lines.push(`    <ForeColor>${hexToTiaColor(el.style.textColor)}</ForeColor>`);
  }
  lines.push(`    <Height>${el.height}</Height>`);
  if (el.style.textAlign) {
    const alignMap: Record<string, string> = { left: "Left", center: "Center", right: "Right" };
    lines.push(`    <HorizontalAlignment>${alignMap[el.style.textAlign] ?? "Left"}</HorizontalAlignment>`);
  }
  lines.push(`    <Left>${el.x}</Left>`);
  lines.push(`    <Name>${esc(el.name)}</Name>`);
  lines.push(`    <Top>${el.y}</Top>`);
  lines.push(`    <Width>${el.width}</Width>`);

  if (el.style.opacity != null && el.style.opacity < 1) {
    lines.push(`    <Opacity>${Math.round(el.style.opacity * 255)}</Opacity>`);
  }
  if (el.style.rotation) {
    lines.push(`    <Rotation>${el.style.rotation}</Rotation>`);
  }

  // Access level
  if (el.accessLevel && el.accessLevel !== "None") {
    lines.push(`    <Authorization>${esc(el.accessLevel)}</Authorization>`);
  }

  // Type-specific attributes
  if (el.text && (el.type === "BUTTON" || el.type === "TEXT" || el.type === "FACEPLATE")) {
    // Use multilingual text if available, otherwise plain text
    if (el.multilingualText && el.multilingualText.length > 0) {
      lines.push(`    <Text>`);
      lines.push(`      <MultilingualText CompositionName="Items">`);
      for (const entry of el.multilingualText) {
        lines.push(`        <MultilingualTextItem ID="${entry.languageId}" CompositionName="Items">`);
        lines.push(`          <AttributeList>`);
        lines.push(`            <Culture>${langIdToCulture(entry.languageId)}</Culture>`);
        lines.push(`            <Text>${esc(entry.text)}</Text>`);
        lines.push(`          </AttributeList>`);
        lines.push(`        </MultilingualTextItem>`);
      }
      lines.push(`      </MultilingualText>`);
      lines.push(`    </Text>`);
    } else {
      lines.push(`    <Text>${esc(el.text)}</Text>`);
    }
  }
  if (el.navigateTo && el.type === "BUTTON") {
    // Navigation is handled via events, but also store it
  }
  if (el.valueMin != null) {
    lines.push(`    <ProcessValueLowerLimit>${el.valueMin}</ProcessValueLowerLimit>`);
  }
  if (el.valueMax != null) {
    lines.push(`    <ProcessValueUpperLimit>${el.valueMax}</ProcessValueUpperLimit>`);
  }
  if (el.orientation === "horizontal" && el.type === "BAR") {
    lines.push(`    <Orientation>Horizontal</Orientation>`);
  }
  if (el.dateTimeFormat && el.type === "DATE_TIME") {
    lines.push(`    <OutputFormat>${esc(el.dateTimeFormat)}</OutputFormat>`);
  }
  if (el.tooltip) {
    lines.push(`    <ToolTipText>${esc(el.tooltip)}</ToolTipText>`);
  }
  if (el.faceplateTypeName && el.type === "FACEPLATE") {
    lines.push(`    <ContainedType>${esc(el.faceplateTypeName)}</ContainedType>`);
  }

  // Type-specific extended attributes
  if (el.type === "GRAPHIC_VIEW" && el.graphicSizeMode) {
    const modeMap: Record<string, string> = { stretch: "Stretch", zoom: "Zoom", original: "Original" };
    lines.push(`    <SizeMode>${modeMap[el.graphicSizeMode] ?? "Stretch"}</SizeMode>`);
  }
  if (el.type === "BAR") {
    if (el.barShowScale) lines.push(`    <ShowScale>true</ShowScale>`);
    if (el.barScaleDivisions != null) lines.push(`    <ScaleDivisionCount>${el.barScaleDivisions}</ScaleDivisionCount>`);
    if (el.barFillColor) lines.push(`    <FillColor>${hexToTiaColor(el.barFillColor)}</FillColor>`);
  }
  if (el.type === "GAUGE") {
    if (el.gaugeStartAngle != null) lines.push(`    <StartAngle>${el.gaugeStartAngle}</StartAngle>`);
    if (el.gaugeEndAngle != null) lines.push(`    <EndAngle>${el.gaugeEndAngle}</EndAngle>`);
    if (el.gaugeTicks != null) lines.push(`    <ScaleTickCount>${el.gaugeTicks}</ScaleTickCount>`);
    if (el.gaugeShowLabels) lines.push(`    <ShowScaleLabels>true</ShowScaleLabels>`);
    if (el.gaugeNeedleColor) lines.push(`    <NeedleColor>${hexToTiaColor(el.gaugeNeedleColor)}</NeedleColor>`);
  }
  if (el.type === "TREND_VIEW") {
    if (el.trendShowToolbar != null) lines.push(`    <ShowToolbar>${el.trendShowToolbar}</ShowToolbar>`);
    if (el.trendShowLegend != null) lines.push(`    <ShowLegend>${el.trendShowLegend}</ShowLegend>`);
    if (el.trendAutoScale != null) lines.push(`    <AutoScale>${el.trendAutoScale}</AutoScale>`);
    if (el.trendYMin != null) lines.push(`    <YAxisMin>${el.trendYMin}</YAxisMin>`);
    if (el.trendYMax != null) lines.push(`    <YAxisMax>${el.trendYMax}</YAxisMax>`);
    if (el.trendShowGrid != null) lines.push(`    <ShowGrid>${el.trendShowGrid}</ShowGrid>`);
  }
  if (el.type === "ALARM_VIEW") {
    if (el.alarmShowAcknowledged != null) lines.push(`    <ShowAcknowledged>${el.alarmShowAcknowledged}</ShowAcknowledged>`);
    if (el.alarmMaxRows != null) lines.push(`    <MaxRows>${el.alarmMaxRows}</MaxRows>`);
    if (el.alarmSortColumn) lines.push(`    <SortColumn>${esc(el.alarmSortColumn)}</SortColumn>`);
    if (el.alarmSortDirection) {
      lines.push(`    <SortDirection>${el.alarmSortDirection === "ascending" ? "Ascending" : "Descending"}</SortDirection>`);
    }
  }

  // IO Field attributes
  if (el.type === "IO_FIELD") {
    if (el.ioFieldMode) {
      const modeMap: Record<string, string> = { input: "Input", output: "Output", input_output: "InputOutput" };
      lines.push(`    <Mode>${modeMap[el.ioFieldMode] ?? "Output"}</Mode>`);
    }
    if (el.ioFieldFormat) {
      const fmtMap: Record<string, string> = { decimal: "Decimal", hexadecimal: "Hexadecimal", binary: "Binary", string: "String", date: "Date", time: "Time" };
      lines.push(`    <OutputFormat>${fmtMap[el.ioFieldFormat] ?? "Decimal"}</OutputFormat>`);
    }
    if (el.ioFieldDecimalPlaces != null) {
      lines.push(`    <DecimalPlaces>${el.ioFieldDecimalPlaces}</DecimalPlaces>`);
    }
  }

  // Font
  if (el.style.fontSize || el.style.fontWeight === "bold" || el.style.fontFamily || el.style.fontItalic || el.style.fontUnderline) {
    lines.push(`    <Font>`);
    lines.push(`      <Hmi.Globalization.FontItem CompositionName="Items">`);
    lines.push(`        <AttributeList>`);
    if (el.style.fontWeight === "bold") {
      lines.push(`          <Bold>true</Bold>`);
    }
    if (el.style.fontFamily) {
      lines.push(`          <FaceName>${esc(el.style.fontFamily)}</FaceName>`);
    }
    if (el.style.fontItalic) {
      lines.push(`          <Italic>true</Italic>`);
    }
    if (el.style.fontSize) {
      lines.push(`          <Size>${el.style.fontSize}</Size>`);
    }
    if (el.style.fontUnderline) {
      lines.push(`          <Underline>true</Underline>`);
    }
    lines.push(`        </AttributeList>`);
    lines.push(`      </Hmi.Globalization.FontItem>`);
    lines.push(`    </Font>`);
  }

  lines.push(`  </AttributeList>`);

  // ObjectList (events, animations)
  const hasAlarmColumns = el.type === "ALARM_VIEW" && el.alarmColumns && el.alarmColumns.length > 0;
  const hasObjectContent =
    (el.events && el.events.length > 0) ||
    (el.animations && el.animations.length > 0) ||
    el.navigateTo ||
    hasAlarmColumns;
  const hasLinkList =
    el.tagBinding || el.tagBindingSpec || el.graphicName;

  if (hasObjectContent || hasLinkList || (el.faceplateProperties && el.faceplateProperties.length > 0)) {
    // Events
    if ((el.events && el.events.length > 0) || el.navigateTo) {
      lines.push(`  <ObjectList>`);

      // Add navigateTo as a Click event if no explicit Click event exists
      if (el.navigateTo && (!el.events || !el.events.some(e => e.eventType === "CLICK"))) {
        lines.push(...indent(4, buildEventXml({
          eventType: "CLICK",
          functionName: "ActivateScreen",
          parameters: { screenName: el.navigateTo },
        })));
      }

      if (el.events) {
        for (const evt of el.events) {
          lines.push(...indent(4, buildEventXml(evt)));
        }
      }

      // Animations
      if (el.animations) {
        for (const anim of el.animations) {
          lines.push(...indent(4, buildAnimationXml(anim)));
        }
      }

      lines.push(`  </ObjectList>`);
    } else if (el.animations && el.animations.length > 0) {
      lines.push(`  <ObjectList>`);
      for (const anim of el.animations) {
        lines.push(...indent(4, buildAnimationXml(anim)));
      }
      lines.push(`  </ObjectList>`);
    } else if (hasAlarmColumns) {
      lines.push(`  <ObjectList>`);
      for (const col of el.alarmColumns!) {
        lines.push(`    <Hmi.Screen.AlarmViewColumn CompositionName="Columns">`);
        lines.push(`      <AttributeList>`);
        lines.push(`        <Name>${esc(col.columnId)}</Name>`);
        if (col.width != null) lines.push(`        <Width>${col.width}</Width>`);
        if (col.visible != null) lines.push(`        <Visible>${col.visible}</Visible>`);
        lines.push(`      </AttributeList>`);
        lines.push(`    </Hmi.Screen.AlarmViewColumn>`);
      }
      lines.push(`  </ObjectList>`);
    }

    // LinkList (tag binding, graphic reference)
    if (hasLinkList) {
      lines.push(`  <LinkList>`);
      if (el.tagBindingSpec) {
        lines.push(`    <Tag TargetID="@OpenLink">`);
        lines.push(`      <Name>${esc(el.tagBindingSpec.tagName)}</Name>`);
        lines.push(`    </Tag>`);
      } else if (el.tagBinding) {
        lines.push(`    <Tag TargetID="@OpenLink">`);
        lines.push(`      <Name>${esc(el.tagBinding)}</Name>`);
        lines.push(`    </Tag>`);
      }
      if (el.graphicName) {
        lines.push(`    <Picture TargetID="@OpenLink">`);
        lines.push(`      <Name>${esc(el.graphicName)}</Name>`);
        lines.push(`    </Picture>`);
      }
      lines.push(`  </LinkList>`);
    }

    // Faceplate interface properties
    if (el.faceplateProperties && el.faceplateProperties.length > 0) {
      lines.push(`  <InterfaceList>`);
      for (const prop of el.faceplateProperties) {
        lines.push(...indent(4, buildFaceplatePropertyXml(prop)));
      }
      lines.push(`  </InterfaceList>`);
    }
  }

  lines.push(`</${xmlTag}>`);
  return lines;
}

// ---------------------------------------------------------------------------
// Event XML builder
// ---------------------------------------------------------------------------

function buildEventXml(evt: HmiEventAction): string[] {
  const eventName =
    typeof evt.eventType === "string"
      ? evt.eventType.charAt(0).toUpperCase() + evt.eventType.slice(1).toLowerCase()
      : "Click";

  const lines: string[] = [];
  lines.push(`<Hmi.Event.Event CompositionName="Events">`);
  lines.push(`  <AttributeList>`);
  lines.push(`    <Name>${eventName}</Name>`);
  lines.push(`  </AttributeList>`);
  lines.push(`  <ObjectList>`);
  lines.push(`    <Hmi.Event.FunctionListEventHandler CompositionName="EventHandlers">`);
  lines.push(`      <ObjectList>`);
  lines.push(`        <Hmi.Event.FunctionListEntry CompositionName="FunctionListEntries">`);
  lines.push(`          <AttributeList>`);
  lines.push(`            <Name>${esc(evt.functionName)}</Name>`);
  lines.push(`            <Type>SystemFunction</Type>`);
  lines.push(`          </AttributeList>`);

  if (evt.parameters && Object.keys(evt.parameters).length > 0) {
    lines.push(`          <ObjectList>`);
    for (const [key, val] of Object.entries(evt.parameters)) {
      lines.push(`            <Hmi.Event.FunctionListEntryParameter CompositionName="Parameters">`);
      lines.push(`              <AttributeList>`);
      lines.push(`                <Name>${esc(key)}</Name>`);
      lines.push(`                <Value>${esc(String(val))}</Value>`);
      lines.push(`              </AttributeList>`);
      lines.push(`            </Hmi.Event.FunctionListEntryParameter>`);
    }
    lines.push(`          </ObjectList>`);
  }

  lines.push(`        </Hmi.Event.FunctionListEntry>`);
  lines.push(`      </ObjectList>`);
  lines.push(`    </Hmi.Event.FunctionListEventHandler>`);
  lines.push(`  </ObjectList>`);
  lines.push(`</Hmi.Event.Event>`);
  return lines;
}

// ---------------------------------------------------------------------------
// Animation XML builder
// ---------------------------------------------------------------------------

const ANIMATION_XML_MAP: Record<string, string> = {
  VISIBILITY_BIT: "Hmi.Dynamic.SingleBitVisibilityAnimation",
  VISIBILITY_RANGE: "Hmi.Dynamic.VisibilityAnimation",
  APPEARANCE: "Hmi.Dynamic.RangeAppearanceAnimation",
  FLASHING: "Hmi.Dynamic.FlashingAnimation",
  HORIZONTAL_MOVEMENT: "Hmi.Dynamic.HorizontalMovementAnimation",
  VERTICAL_MOVEMENT: "Hmi.Dynamic.VerticalMovementAnimation",
  DIRECT_MOVEMENT: "Hmi.Dynamic.DirectMovementAnimation",
  ROTATION: "Hmi.Dynamic.RotationAnimation",
  OBJECT_ENABLING: "Hmi.Dynamic.ObjectEnablingAnimation",
  TAG_CONNECTION: "Hmi.Dynamic.TagConnectionDynamic",
  FILL_LEVEL: "Hmi.Dynamic.FillLevelAnimation",
  SIZE: "Hmi.Dynamic.SizeAnimation",
};

function buildAnimationXml(anim: HmiAnimation): string[] {
  const xmlTag = ANIMATION_XML_MAP[anim.type];
  if (!xmlTag) return [];

  const lines: string[] = [];
  lines.push(`<${xmlTag} CompositionName="DynamicProperties">`);
  lines.push(`  <AttributeList>`);

  if (anim.rangeMin != null) {
    lines.push(`    <RangeMin>${anim.rangeMin}</RangeMin>`);
  }
  if (anim.rangeMax != null) {
    lines.push(`    <RangeMax>${anim.rangeMax}</RangeMax>`);
  }
  if (anim.movementRange != null) {
    lines.push(`    <Range>${anim.movementRange}</Range>`);
  }
  if (anim.rotationRange != null) {
    lines.push(`    <Range>${anim.rotationRange}</Range>`);
  }

  // Fill level specifics
  if (anim.type === "FILL_LEVEL") {
    if (anim.fillDirection) {
      const dirMap: Record<string, string> = {
        "bottom-to-top": "BottomToTop",
        "top-to-bottom": "TopToBottom",
        "left-to-right": "LeftToRight",
        "right-to-left": "RightToLeft",
      };
      lines.push(`    <FillDirection>${dirMap[anim.fillDirection] ?? "BottomToTop"}</FillDirection>`);
    }
    if (anim.fillColor) {
      lines.push(`    <FillColor>${hexToTiaColor(anim.fillColor)}</FillColor>`);
    }
  }

  // Size animation specifics
  if (anim.type === "SIZE") {
    if (anim.sizeAxis) {
      const axisMap: Record<string, string> = {
        horizontal: "Horizontal",
        vertical: "Vertical",
        both: "Both",
      };
      lines.push(`    <SizeAxis>${axisMap[anim.sizeAxis] ?? "Horizontal"}</SizeAxis>`);
    }
    if (anim.sizeMin != null) {
      lines.push(`    <SizeMin>${anim.sizeMin}</SizeMin>`);
    }
    if (anim.sizeMax != null) {
      lines.push(`    <SizeMax>${anim.sizeMax}</SizeMax>`);
    }
  }

  // Appearance color map
  if (anim.type === "APPEARANCE" && anim.colorMap) {
    lines.push(`    <Entries>`);
    for (const entry of anim.colorMap) {
      lines.push(`      <Hmi.Dynamic.RangeAppearanceEntry>`);
      lines.push(`        <AttributeList>`);
      lines.push(`          <RangeFrom>${entry.value}</RangeFrom>`);
      lines.push(`          <RangeTo>${entry.value}</RangeTo>`);
      lines.push(`          <BackColor>${hexToTiaColor(entry.color)}</BackColor>`);
      lines.push(`        </AttributeList>`);
      lines.push(`      </Hmi.Dynamic.RangeAppearanceEntry>`);
    }
    lines.push(`    </Entries>`);
  }

  // Visibility trigger
  if (anim.type === "VISIBILITY_BIT" && anim.triggerValue != null) {
    lines.push(`    <BitNumber>${anim.triggerValue}</BitNumber>`);
  }

  lines.push(`  </AttributeList>`);

  // Tag link
  if (anim.tagName) {
    lines.push(`  <LinkList>`);
    lines.push(`    <Tag TargetID="@OpenLink">`);
    lines.push(`      <Name>${esc(anim.tagName)}</Name>`);
    lines.push(`    </Tag>`);
    lines.push(`  </LinkList>`);
  }

  lines.push(`</${xmlTag}>`);
  return lines;
}

// ---------------------------------------------------------------------------
// Faceplate property XML builder
// ---------------------------------------------------------------------------

function buildFaceplatePropertyXml(prop: HmiFaceplateProperty): string[] {
  const lines: string[] = [];
  const dirMap: Record<string, string> = { In: "Input", Out: "Output", InOut: "InOut" };
  const sectionName = dirMap[prop.direction] ?? "Input";

  lines.push(`<Hmi.Screen.FaceplateInterfaceProperty CompositionName="${sectionName}">`);
  lines.push(`  <AttributeList>`);
  lines.push(`    <Name>${esc(prop.name)}</Name>`);
  lines.push(`    <DataType>${esc(prop.dataType)}</DataType>`);
  if (prop.defaultValue != null) {
    lines.push(`    <DefaultValue>${esc(String(prop.defaultValue))}</DefaultValue>`);
  }
  if (prop.description) {
    lines.push(`    <Comment>${esc(prop.description)}</Comment>`);
  }
  lines.push(`  </AttributeList>`);

  if (prop.binding) {
    lines.push(`  <LinkList>`);
    lines.push(`    <Tag TargetID="@OpenLink">`);
    lines.push(`      <Name>${esc(prop.binding)}</Name>`);
    lines.push(`    </Tag>`);
    lines.push(`  </LinkList>`);
  }

  lines.push(`</Hmi.Screen.FaceplateInterfaceProperty>`);
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Convert hex color (#rrggbb) to TIA RGB format (R, G, B) */
function hexToTiaColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length < 6) return "0, 0, 0";
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** Map language ID (LCID) to culture string for multilingual text */
function langIdToCulture(lcid: number): string {
  const map: Record<number, string> = {
    1033: "en-US",
    1031: "de-DE",
    1040: "it-IT",
    1036: "fr-FR",
    1034: "es-ES",
    2070: "pt-PT",
    2052: "zh-CN",
  };
  return map[lcid] ?? "en-US";
}

/** Indent each line in an array by n spaces */
function indent(n: number, lines: string[]): string[] {
  const pad = " ".repeat(n);
  return lines.map((l) => pad + l);
}
