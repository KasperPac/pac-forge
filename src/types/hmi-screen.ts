/** Element types matching WinCC Unified screen objects */
export const HMI_ELEMENT_TYPES = {
  RECTANGLE: "RECTANGLE",
  BUTTON: "BUTTON",
  TEXT: "TEXT",
  IO_FIELD: "IO_FIELD",
  GRAPHIC_VIEW: "GRAPHIC_VIEW",
  GRAPHIC_IO_FIELD: "GRAPHIC_IO_FIELD",
  SYMBOLIC_IO_FIELD: "SYMBOLIC_IO_FIELD",
  LINE: "LINE",
  CIRCLE: "CIRCLE",
  ELLIPSE: "ELLIPSE",
  POLYGON: "POLYGON",
  GAUGE: "GAUGE",
  BAR: "BAR",
  SLIDER: "SLIDER",
  SWITCH: "SWITCH",
  TREND_VIEW: "TREND_VIEW",
  ALARM_VIEW: "ALARM_VIEW",
  DATE_TIME: "DATE_TIME",
  GROUP: "GROUP",
  FACEPLATE: "FACEPLATE",
  POLYLINE: "POLYLINE",
  CLOCK: "CLOCK",
  PIPE: "PIPE",
  SCREEN_WINDOW: "SCREEN_WINDOW",
} as const;

export type HmiElementType =
  (typeof HMI_ELEMENT_TYPES)[keyof typeof HMI_ELEMENT_TYPES];

export const HMI_ELEMENT_LABELS: Record<HmiElementType, string> = {
  RECTANGLE: "Rectangle",
  BUTTON: "Button",
  TEXT: "Text Field",
  IO_FIELD: "IO Field",
  GRAPHIC_VIEW: "Graphic View",
  GRAPHIC_IO_FIELD: "Graphic IO Field",
  SYMBOLIC_IO_FIELD: "Symbolic IO Field",
  LINE: "Line",
  CIRCLE: "Circle",
  ELLIPSE: "Ellipse",
  POLYGON: "Polygon",
  GAUGE: "Gauge",
  BAR: "Bar Graph",
  SLIDER: "Slider",
  SWITCH: "Switch",
  TREND_VIEW: "Trend View",
  ALARM_VIEW: "Alarm View",
  DATE_TIME: "Date/Time",
  GROUP: "Group",
  FACEPLATE: "Faceplate",
  POLYLINE: "Polyline",
  CLOCK: "Clock",
  PIPE: "Pipe",
  SCREEN_WINDOW: "Screen Window",
};

/** Animation types matching WinCC Unified dynamic animations */
export const HMI_ANIMATION_TYPES = {
  VISIBILITY_BIT: "VISIBILITY_BIT",
  VISIBILITY_RANGE: "VISIBILITY_RANGE",
  APPEARANCE: "APPEARANCE",
  FLASHING: "FLASHING",
  HORIZONTAL_MOVEMENT: "HORIZONTAL_MOVEMENT",
  VERTICAL_MOVEMENT: "VERTICAL_MOVEMENT",
  DIRECT_MOVEMENT: "DIRECT_MOVEMENT",
  ROTATION: "ROTATION",
  OBJECT_ENABLING: "OBJECT_ENABLING",
  TAG_CONNECTION: "TAG_CONNECTION",
  FILL_LEVEL: "FILL_LEVEL",
  SIZE: "SIZE",
} as const;

export type HmiAnimationType =
  (typeof HMI_ANIMATION_TYPES)[keyof typeof HMI_ANIMATION_TYPES];

/** An animation applied to an HMI element */
export interface HmiAnimation {
  type: HmiAnimationType;
  /** Tag that drives this animation */
  tagName?: string;
  /** For visibility: show when tag value matches */
  triggerValue?: string | number | boolean;
  /** For range-based: min/max range */
  rangeMin?: number;
  rangeMax?: number;
  /** For appearance: color mapping */
  colorMap?: Array<{ value: number; color: string }>;
  /** For movement: pixel range */
  movementRange?: number;
  /** For rotation: degree range */
  rotationRange?: number;
  /** For fill level: direction */
  fillDirection?: "bottom-to-top" | "top-to-bottom" | "left-to-right" | "right-to-left";
  /** For fill level: fill color */
  fillColor?: string;
  /** For size: which axis scales */
  sizeAxis?: "horizontal" | "vertical" | "both";
  /** For size: minimum size in pixels */
  sizeMin?: number;
  /** For size: maximum size in pixels */
  sizeMax?: number;
}

/** Event types for interactive elements */
export const HMI_EVENT_TYPES = {
  CLICK: "CLICK",
  PRESS: "PRESS",
  RELEASE: "RELEASE",
  ACTIVATE: "ACTIVATE",
  DEACTIVATE: "DEACTIVATE",
  CHANGE: "CHANGE",
  DOUBLE_CLICK: "DOUBLE_CLICK",
  MOUSE_ENTER: "MOUSE_ENTER",
  MOUSE_LEAVE: "MOUSE_LEAVE",
  KEY_PRESS: "KEY_PRESS",
  KEY_RELEASE: "KEY_RELEASE",
} as const;

/** Screen-level event types */
export const HMI_SCREEN_EVENT_TYPES = {
  LOADED: "LOADED",
  CLEARED: "CLEARED",
} as const;

export type HmiEventType =
  (typeof HMI_EVENT_TYPES)[keyof typeof HMI_EVENT_TYPES];

export type HmiScreenEventType =
  (typeof HMI_SCREEN_EVENT_TYPES)[keyof typeof HMI_SCREEN_EVENT_TYPES];

/** System function categories for WinCC events */
export const HMI_SYSTEM_FUNCTION_CATEGORIES = {
  NAVIGATION: "Navigation",
  TAG: "Tag Operations",
  ALARM: "Alarm",
  SYSTEM: "System",
} as const;

/** Parameter type definition for system functions */
export interface HmiSysFuncParam {
  name: string;
  type: "string" | "number" | "boolean" | "tag";
  description: string;
  required?: boolean;
}

/** System function definition */
export interface HmiSystemFunctionDef {
  name: string;
  category: keyof typeof HMI_SYSTEM_FUNCTION_CATEGORIES;
  description: string;
  params: HmiSysFuncParam[];
}

/** WinCC system functions catalog */
export const HMI_SYSTEM_FUNCTIONS: HmiSystemFunctionDef[] = [
  // Navigation
  {
    name: "ActivateScreen",
    category: "NAVIGATION",
    description: "Navigate to a screen by name",
    params: [
      { name: "screenName", type: "string", description: "Target screen name", required: true },
      { name: "screenNumber", type: "number", description: "Screen number (0 = default)" },
    ],
  },
  {
    name: "ActivatePreviousScreen",
    category: "NAVIGATION",
    description: "Navigate back to the previously displayed screen",
    params: [],
  },
  {
    name: "OpenScreenWindow",
    category: "NAVIGATION",
    description: "Open a screen in a popup window",
    params: [
      { name: "screenName", type: "string", description: "Screen to open", required: true },
      { name: "windowName", type: "string", description: "Popup window name", required: true },
      { name: "x", type: "number", description: "Window X position" },
      { name: "y", type: "number", description: "Window Y position" },
      { name: "width", type: "number", description: "Window width" },
      { name: "height", type: "number", description: "Window height" },
      { name: "modal", type: "boolean", description: "Modal window (blocks background)" },
    ],
  },
  {
    name: "CloseScreenWindow",
    category: "NAVIGATION",
    description: "Close a popup screen window",
    params: [
      { name: "windowName", type: "string", description: "Window name to close", required: true },
    ],
  },
  // Tag operations
  {
    name: "SetTag",
    category: "TAG",
    description: "Set a tag to a specific value",
    params: [
      { name: "tagName", type: "tag", description: "Tag to set", required: true },
      { name: "value", type: "number", description: "Value to set", required: true },
    ],
  },
  {
    name: "SetTagBool",
    category: "TAG",
    description: "Set a boolean tag",
    params: [
      { name: "tagName", type: "tag", description: "Tag to set", required: true },
      { name: "value", type: "boolean", description: "True/False value", required: true },
    ],
  },
  {
    name: "InvertBit",
    category: "TAG",
    description: "Toggle a boolean tag value",
    params: [
      { name: "tagName", type: "tag", description: "Tag to toggle", required: true },
    ],
  },
  {
    name: "IncreaseTag",
    category: "TAG",
    description: "Increment a tag by a value",
    params: [
      { name: "tagName", type: "tag", description: "Tag to increment", required: true },
      { name: "value", type: "number", description: "Amount to add", required: true },
    ],
  },
  {
    name: "DecreaseTag",
    category: "TAG",
    description: "Decrement a tag by a value",
    params: [
      { name: "tagName", type: "tag", description: "Tag to decrement", required: true },
      { name: "value", type: "number", description: "Amount to subtract", required: true },
    ],
  },
  {
    name: "SetTagWhileKeyPressed",
    category: "TAG",
    description: "Set a tag value while button is held, revert on release",
    params: [
      { name: "tagName", type: "tag", description: "Tag to set", required: true },
      { name: "pressValue", type: "number", description: "Value while pressed", required: true },
      { name: "releaseValue", type: "number", description: "Value on release", required: true },
    ],
  },
  // Alarm
  {
    name: "AlarmViewAcknowledgeAll",
    category: "ALARM",
    description: "Acknowledge all visible alarms",
    params: [],
  },
  {
    name: "AlarmViewShowOperatorNotes",
    category: "ALARM",
    description: "Show operator notes for selected alarm",
    params: [],
  },
  // System
  {
    name: "StopRuntime",
    category: "SYSTEM",
    description: "Stop the HMI runtime",
    params: [
      { name: "mode", type: "number", description: "0=stop, 1=stop+close" },
    ],
  },
  {
    name: "SetLanguage",
    category: "SYSTEM",
    description: "Change HMI runtime language",
    params: [
      { name: "languageId", type: "number", description: "Language LCID (1033=English, 1031=German)", required: true },
    ],
  },
  {
    name: "SimulateKeyPress",
    category: "SYSTEM",
    description: "Simulate a key press event",
    params: [
      { name: "keyCode", type: "number", description: "Virtual key code", required: true },
    ],
  },
  {
    name: "SetBrightness",
    category: "SYSTEM",
    description: "Set display brightness",
    params: [
      { name: "brightness", type: "number", description: "Brightness level (0-100)", required: true },
    ],
  },
  // Navigation (additional)
  {
    name: "ActivateScreenByNumber",
    category: "NAVIGATION",
    description: "Navigate to a screen by its number",
    params: [
      { name: "screenNumber", type: "number", description: "Target screen number", required: true },
    ],
  },
  {
    name: "CloseAllScreenWindows",
    category: "NAVIGATION",
    description: "Close all open popup screen windows",
    params: [],
  },
  // Tag operations (additional)
  {
    name: "SetBit",
    category: "TAG",
    description: "Set a boolean tag to TRUE",
    params: [
      { name: "tagName", type: "tag", description: "Tag to set", required: true },
    ],
  },
  {
    name: "ResetBit",
    category: "TAG",
    description: "Set a boolean tag to FALSE",
    params: [
      { name: "tagName", type: "tag", description: "Tag to reset", required: true },
    ],
  },
  {
    name: "SetBitInTag",
    category: "TAG",
    description: "Set a specific bit in an integer tag",
    params: [
      { name: "tagName", type: "tag", description: "Integer tag", required: true },
      { name: "bitNumber", type: "number", description: "Bit position (0-31)", required: true },
    ],
  },
  {
    name: "ResetBitInTag",
    category: "TAG",
    description: "Reset a specific bit in an integer tag",
    params: [
      { name: "tagName", type: "tag", description: "Integer tag", required: true },
      { name: "bitNumber", type: "number", description: "Bit position (0-31)", required: true },
    ],
  },
  // Alarm (additional)
  {
    name: "AcknowledgeAlarm",
    category: "ALARM",
    description: "Acknowledge a specific alarm by number",
    params: [
      { name: "alarmNumber", type: "number", description: "Alarm number", required: true },
    ],
  },
  {
    name: "ShowAlarmWindow",
    category: "ALARM",
    description: "Display the alarm popup window",
    params: [],
  },
  {
    name: "HideAlarmWindow",
    category: "ALARM",
    description: "Hide the alarm popup window",
    params: [],
  },
  // System (additional)
  {
    name: "ShowLoginDialog",
    category: "SYSTEM",
    description: "Show the user login dialog",
    params: [],
  },
  {
    name: "Logout",
    category: "SYSTEM",
    description: "Log out the current user",
    params: [],
  },
  {
    name: "PrintScreen",
    category: "SYSTEM",
    description: "Print the current screen",
    params: [],
  },
  {
    name: "StartLogging",
    category: "SYSTEM",
    description: "Start data logging by name",
    params: [
      { name: "logName", type: "string", description: "Log definition name", required: true },
    ],
  },
  {
    name: "StopLogging",
    category: "SYSTEM",
    description: "Stop data logging by name",
    params: [
      { name: "logName", type: "string", description: "Log definition name", required: true },
    ],
  },
  {
    name: "ShowSystemAlarm",
    category: "SYSTEM",
    description: "Display a system notification text",
    params: [
      { name: "message", type: "string", description: "Notification text", required: true },
    ],
  },
] as const;

/** An event action on an HMI element */
export interface HmiEventAction {
  eventType: HmiEventType | HmiScreenEventType;
  /** System function to call */
  functionName: string;
  /** Typed function parameters */
  parameters?: Record<string, string | number | boolean>;
}

/** Tag acquisition modes for WinCC tag binding */
export const HMI_TAG_ACQUISITION_MODES = {
  CYCLIC_IN_OPERATION: "Cyclic in operation",
  CYCLIC_CONTINUOUS: "Cyclic continuous",
  ON_DEMAND: "On demand",
} as const;

export type HmiTagAcquisitionMode =
  (typeof HMI_TAG_ACQUISITION_MODES)[keyof typeof HMI_TAG_ACQUISITION_MODES];

/** Tag update modes */
export const HMI_TAG_UPDATE_MODES = {
  READ: "Read",
  WRITE: "Write",
  READ_WRITE: "Read/Write",
} as const;

export type HmiTagUpdateMode =
  (typeof HMI_TAG_UPDATE_MODES)[keyof typeof HMI_TAG_UPDATE_MODES];

/** Tag data types matching WinCC */
export const HMI_TAG_DATA_TYPES = {
  BOOL: "Bool",
  INT: "Int",
  DINT: "DInt",
  REAL: "Real",
  LREAL: "LReal",
  WORD: "Word",
  DWORD: "DWord",
  STRING: "String",
  WSTRING: "WString",
  UINT: "UInt",
  UDINT: "UDInt",
  SINT: "SInt",
  USINT: "USInt",
  BYTE: "Byte",
  TIME: "Time",
  DATE_AND_TIME: "Date_And_Time",
} as const;

export type HmiTagDataType =
  (typeof HMI_TAG_DATA_TYPES)[keyof typeof HMI_TAG_DATA_TYPES];

/** Tag acquisition cycle presets */
export const HMI_TAG_ACQUISITION_CYCLES = [
  "100ms",
  "250ms",
  "500ms",
  "1s",
  "2s",
  "5s",
  "10s",
] as const;

export type HmiTagAcquisitionCycle = (typeof HMI_TAG_ACQUISITION_CYCLES)[number];

/** Full tag binding specification */
export interface HmiTagBinding {
  /** Display tag name (HMI tag table) */
  tagName: string;
  /** PLC tag address (e.g. "DB_Motor".runFeedback) */
  plcTag?: string;
  /** PLC connection name */
  connection?: string;
  /** Data type */
  dataType?: HmiTagDataType;
  /** Acquisition mode */
  acquisitionMode?: HmiTagAcquisitionMode;
  /** Acquisition cycle */
  acquisitionCycle?: HmiTagAcquisitionCycle;
  /** Read/Write mode */
  updateMode?: HmiTagUpdateMode;
}

/** Reference to a global text list */
export interface HmiTextListRef {
  /** Text list name as defined in TIA project */
  listName: string;
  /** Tag that selects the displayed text entry */
  tagName?: string;
}

/** Reference to a global graphic list */
export interface HmiGraphicListRef {
  /** Graphic list name as defined in TIA project */
  listName: string;
  /** Tag that selects the displayed graphic entry */
  tagName?: string;
}

/** Faceplate interface property direction */
export const HMI_FACEPLATE_DIRECTIONS = {
  IN: "In",
  OUT: "Out",
  IN_OUT: "InOut",
} as const;

export type HmiFaceplateDirection =
  (typeof HMI_FACEPLATE_DIRECTIONS)[keyof typeof HMI_FACEPLATE_DIRECTIONS];

/** A single faceplate interface property */
export interface HmiFaceplateProperty {
  name: string;
  direction: HmiFaceplateDirection;
  dataType: HmiTagDataType;
  /** Tag bound to this property */
  binding?: string;
  /** Default value when no binding */
  defaultValue?: string | number | boolean;
  /** Description for documentation */
  description?: string;
}

/** AlarmView column definition */
export interface HmiAlarmColumn {
  /** Column identifier (e.g. "Number", "Time", "Date", "State", "Text", "Class", "AcknowledgeState") */
  columnId: string;
  /** Column display width in pixels */
  width?: number;
  /** Whether column is visible */
  visible?: boolean;
}

/** Standard alarm columns available in WinCC */
export const HMI_ALARM_COLUMNS = [
  "Number",
  "Time",
  "Date",
  "State",
  "Text",
  "Class",
  "AcknowledgeState",
  "Priority",
  "InfoText",
  "EventText",
  "Group",
] as const;

/** A single HMI screen element */
export interface HmiElement {
  id: string;
  type: HmiElementType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Layer order (higher = on top) */
  zIndex: number;
  /** Visual properties */
  style: HmiElementStyle;
  /** Simple tag name binding (legacy, shorthand) */
  tagBinding?: string;
  /** Full tag binding specification */
  tagBindingSpec?: HmiTagBinding;
  /** Navigation target screen (for buttons) */
  navigateTo?: string;
  /** Label text (for buttons, text fields) */
  text?: string;
  /** Graphic/image name (for GraphicView elements) */
  graphicName?: string;
  /** TIA Portal library path (for library component placeholders) */
  libraryPath?: string;
  /** Whether element is locked from editing */
  locked?: boolean;
  /** Whether element is visible on canvas (layer management) */
  visible?: boolean;
  /** Animations applied to this element */
  animations?: HmiAnimation[];
  /** Event actions (click, press, etc.) */
  events?: HmiEventAction[];
  /** For Bar/Slider: min/max value range */
  valueMin?: number;
  valueMax?: number;
  /** For Bar: orientation */
  orientation?: "horizontal" | "vertical";
  /** For Trend: time range in seconds */
  trendTimeRange?: number;
  /** For Trend: multiple tag bindings */
  trendTags?: Array<{ tagName: string; color: string; label?: string }>;
  /** For Alarm View: filter expression */
  alarmFilter?: string;
  /** For Circle/Ellipse: radius values */
  radiusX?: number;
  radiusY?: number;
  /** For Polygon: point coordinates relative to element x,y */
  points?: Array<{ x: number; y: number }>;
  /** For Symbolic IO Field: text list entries */
  textList?: Array<{ value: number; text: string }>;
  /** For Graphic IO Field: image list entries */
  imageList?: Array<{ value: number; graphicName: string }>;
  /** For Switch: on/off tag values */
  switchOnValue?: number | boolean;
  switchOffValue?: number | boolean;
  /** For Date/Time: format string */
  dateTimeFormat?: string;
  /** For Faceplate: instance interface parameters (legacy simple) */
  faceplateParams?: Record<string, string>;
  /** For Faceplate: typed interface properties */
  faceplateProperties?: HmiFaceplateProperty[];
  /** For Faceplate: source faceplate type name */
  faceplateTypeName?: string;
  /** Reference to a global text list */
  textListRef?: HmiTextListRef;
  /** Reference to a global graphic list */
  graphicListRef?: HmiGraphicListRef;
  /** Tooltip text */
  tooltip?: string;
  /** Layer name for multi-layer support */
  layerName?: string;
  /** For Pipe: flow direction */
  pipeDirection?: "horizontal" | "vertical";
  /** For Pipe: pipe diameter in pixels */
  pipeDiameter?: number;
  /** For Screen Window: embedded screen name */
  screenWindowName?: string;
  /** For Screen Window: modal */
  screenWindowModal?: boolean;
  /** For Clock: analog or digital */
  clockType?: "analog" | "digital";
  /** For IOField: input mode */
  ioFieldMode?: "input" | "output" | "input_output";
  /** For IOField: data format */
  ioFieldFormat?: "decimal" | "hexadecimal" | "binary" | "string" | "date" | "time";
  /** For IOField: decimal places */
  ioFieldDecimalPlaces?: number;
  /** For Button: mode */
  buttonMode?: "press" | "toggle" | "latching";
  /** For GraphicView: size mode */
  graphicSizeMode?: "stretch" | "zoom" | "original";
  /** For Bar: show scale labels */
  barShowScale?: boolean;
  /** For Bar: number of scale divisions */
  barScaleDivisions?: number;
  /** For Bar: fill color */
  barFillColor?: string;
  /** For Gauge: start angle in degrees */
  gaugeStartAngle?: number;
  /** For Gauge: end angle in degrees */
  gaugeEndAngle?: number;
  /** For Gauge: number of tick marks */
  gaugeTicks?: number;
  /** For Gauge: show labels on scale */
  gaugeShowLabels?: boolean;
  /** For Gauge: needle color */
  gaugeNeedleColor?: string;
  /** For TrendView: show toolbar */
  trendShowToolbar?: boolean;
  /** For TrendView: show legend */
  trendShowLegend?: boolean;
  /** For TrendView: Y-axis auto scale */
  trendAutoScale?: boolean;
  /** For TrendView: Y-axis min */
  trendYMin?: number;
  /** For TrendView: Y-axis max */
  trendYMax?: number;
  /** For TrendView: grid visible */
  trendShowGrid?: boolean;
  /** For AlarmView: visible columns */
  alarmColumns?: HmiAlarmColumn[];
  /** For AlarmView: sort column */
  alarmSortColumn?: string;
  /** For AlarmView: sort direction */
  alarmSortDirection?: "ascending" | "descending";
  /** For AlarmView: show acknowledged alarms */
  alarmShowAcknowledged?: boolean;
  /** For AlarmView: max rows displayed */
  alarmMaxRows?: number;
  /** Multilingual text entries (overrides text property when present) */
  multilingualText?: HmiMultilingualText[];
  /** Minimum access level required to view/operate this element */
  accessLevel?: HmiAccessLevel;
}

export interface HmiElementStyle {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  textAlign?: "left" | "center" | "right";
  borderRadius?: number;
  opacity?: number;
  /** Fill pattern (for rectangles/shapes) */
  fillPattern?: "solid" | "transparent" | "hatched";
  /** Rotation angle in degrees */
  rotation?: number;
  /** Flashing frequency (0 = none, 1 = slow, 2 = medium, 3 = fast) */
  flashRate?: 0 | 1 | 2 | 3;
}

/** A complete HMI screen specification */
export interface HmiScreenSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  elements: HmiElement[];
  /** Target runtime family for the generated screen suite */
  targetPlatform?: "wincc_unified_comfort";
  /** Navigation/template framework name */
  templateSuite?: string;
  /** High-level role in the generated HMI suite */
  screenRole?: "template_shell" | "overview" | "device_faceplate" | "unit_checklist" | "device_checklist" | "alarm_summary" | "trend" | "popup" | "custom";
  /** Optional unit association for checklist / overview screens */
  unit?: string;
  /** Optional device type association for faceplate/detail screens */
  deviceType?: string;
  /** Named equipment shown or controlled on this screen */
  deviceNames?: string[];
  /** Optional operator checklist items shown on checklist screens */
  checklistItems?: Array<{ id: string; label: string; binding?: string; checkedByDefault?: boolean }>;
  /** Screen number for navigation (WinCC screen numbering) */
  screenNumber?: number;
  /** Template/layout name this screen is based on */
  templateName?: string;
  /** Screen-level events (e.g., on-load scripts) */
  screenEvents?: HmiEventAction[];
  /** Layers for element organization */
  layers?: Array<{ name: string; visible: boolean }>;
  /** Discrete alarm definitions for this screen/project */
  alarmDefinitions?: HmiAlarmDefinition[];
}

/** WinCC discrete alarm definition */
export interface HmiAlarmDefinition {
  /** Unique alarm number */
  alarmNumber: number;
  /** Alarm display text */
  alarmText: string;
  /** Alarm class (Errors, Warnings, System, Custom) */
  alarmClass?: string;
  /** Priority (0 = highest) */
  priority?: number;
  /** PLC tag or HMI tag that triggers this alarm */
  triggerTag: string;
  /** Trigger bit number (for DWORD/WORD tags) */
  triggerBit?: number;
  /** Info text for operators */
  infoText?: string;
  /** Acknowledgement required */
  acknowledgeable?: boolean;
}

/** Standard WinCC alarm classes */
export const HMI_ALARM_CLASSES = [
  "Errors",
  "Warnings",
  "System",
  "Diagnostic",
  "Process",
] as const;

/** Multilingual text entry for WinCC internationalization */
export interface HmiMultilingualText {
  /** Language ID (LCID): 1033=English, 1031=German, 1040=Italian, 1036=French, 1034=Spanish */
  languageId: number;
  /** Text content */
  text: string;
}

/** Common WinCC language IDs */
export const HMI_LANGUAGES = {
  ENGLISH: { id: 1033, label: "English" },
  GERMAN: { id: 1031, label: "German" },
  ITALIAN: { id: 1040, label: "Italian" },
  FRENCH: { id: 1036, label: "French" },
  SPANISH: { id: 1034, label: "Spanish" },
  PORTUGUESE: { id: 2070, label: "Portuguese" },
  CHINESE: { id: 2052, label: "Chinese" },
} as const;

/** WinCC user access levels for element visibility */
export const HMI_ACCESS_LEVELS = [
  "None",
  "View",
  "Operate",
  "Maintain",
  "Administer",
] as const;

export type HmiAccessLevel = (typeof HMI_ACCESS_LEVELS)[number];

/** A graphic in the HMI graphic library */
export interface HmiGraphic {
  name: string;
  /** Data URI (data:image/png;base64,...) or blob URL */
  url: string;
  /** AI-generated description of what the graphic depicts */
  description?: string;
  /** Searchable tags derived from the description */
  tags?: string[];
  /** Category from folder structure (e.g. "Valves", "Motors/AC") */
  category?: string;
  /** Rich visual analysis from AI scan */
  visual?: HmiGraphicVisual;
  /** Base name for state grouping (e.g. "Motor" for "Motor_OFF", "Motor_RUN") */
  stateGroup?: string;
  /** State label within the group (e.g. "OFF", "RUN", "FAULT") */
  stateName?: string;
}

/** A connection/joining point on a graphic where it can connect to other graphics */
export interface ConnectionPoint {
  /** Human-readable label (e.g. "inlet", "outlet", "left-end", "shaft") */
  label: string;
  /** Which side of the bounding box this point is on */
  side: "top" | "bottom" | "left" | "right";
  /** Position along that side, 0.0 = start, 1.0 = end (e.g. 0.5 = center) */
  position: number;
  /** What type of connection this is */
  type: "flow" | "electrical" | "mechanical" | "generic";
}

/** AI-analyzed visual properties of a graphic */
export interface HmiGraphicVisual {
  /** Shape outline: rectangular, circular, irregular, icon */
  shape: "rectangular" | "circular" | "irregular" | "icon";
  /** Dominant orientation */
  orientation: "landscape" | "portrait" | "square";
  /** Background type */
  background: "transparent" | "dark" | "light" | "colored";
  /** Visual style */
  style: "flat" | "3d" | "schematic" | "photorealistic" | "outline";
  /** Dominant colors as hex values */
  dominantColors: string[];
  /** How this graphic is typically used on an HMI screen */
  suggestedUse: "equipment-symbol" | "indicator" | "button-icon" | "background" | "label" | "decoration" | "diagram";
  /** Suggested pixel size range on a 1920x1080 screen */
  suggestedSize: "small" | "medium" | "large" | "full-width";
  /** What other graphic types pair well with this one */
  pairsWith?: string[];
  /** Placement notes (e.g. "typically centered in process flow", "inline next to tag value") */
  placementHint?: string;
  /** Connection/joining points where this graphic connects to others */
  connectionPoints?: ConnectionPoint[];
}

/** HMI screen template for AI-guided screen generation */
export interface HmiTemplate {
  id: string;
  name: string;
  /** What kind of screen this template is for */
  category: "overview" | "detail" | "faceplate" | "alarm" | "navigation" | "diagnostic" | "trend" | "custom";
  /** Description for the AI agent to understand when to use this template */
  description: string;
  /** The screen spec that serves as the template */
  screen: HmiScreenSpec;
  /** Thumbnail data URI for preview */
  thumbnail?: string;
  /** Linked reference library doc IDs — sections pulled into prompt when template is used */
  referenceDocIds?: string[];
  /** When the template was created */
  createdAt?: string;
}

export type HmiTemplateCategory = HmiTemplate["category"];

export const HMI_TEMPLATE_CATEGORIES = {
  overview: "Overview",
  detail: "Detail / Process",
  faceplate: "Faceplate",
  alarm: "Alarm",
  navigation: "Navigation",
  diagnostic: "Diagnostic",
  trend: "Trend",
  custom: "Custom",
} as const;

/** Default element sizes per type */
export const DEFAULT_ELEMENT_SIZES: Record<
  HmiElementType,
  { width: number; height: number }
> = {
  RECTANGLE: { width: 200, height: 120 },
  BUTTON: { width: 160, height: 50 },
  TEXT: { width: 200, height: 30 },
  IO_FIELD: { width: 150, height: 36 },
  GRAPHIC_VIEW: { width: 120, height: 120 },
  GRAPHIC_IO_FIELD: { width: 120, height: 120 },
  SYMBOLIC_IO_FIELD: { width: 150, height: 36 },
  LINE: { width: 200, height: 2 },
  CIRCLE: { width: 80, height: 80 },
  ELLIPSE: { width: 120, height: 80 },
  POLYGON: { width: 120, height: 100 },
  GAUGE: { width: 150, height: 150 },
  BAR: { width: 40, height: 200 },
  SLIDER: { width: 200, height: 30 },
  SWITCH: { width: 80, height: 40 },
  TREND_VIEW: { width: 400, height: 200 },
  ALARM_VIEW: { width: 600, height: 300 },
  DATE_TIME: { width: 180, height: 30 },
  GROUP: { width: 300, height: 200 },
  FACEPLATE: { width: 250, height: 180 },
  POLYLINE: { width: 200, height: 2 },
  CLOCK: { width: 120, height: 120 },
  PIPE: { width: 200, height: 20 },
  SCREEN_WINDOW: { width: 400, height: 300 },
};

/** Default styles per element type */
export const DEFAULT_ELEMENT_STYLES: Record<HmiElementType, HmiElementStyle> = {
  RECTANGLE: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 4,
  },
  BUTTON: {
    backgroundColor: "#1d4ed8",
    borderColor: "#3b82f6",
    borderWidth: 1,
    textColor: "#ffffff",
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
    borderRadius: 6,
  },
  TEXT: {
    textColor: "#e2e8f0",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "left",
  },
  IO_FIELD: {
    backgroundColor: "#0f172a",
    borderColor: "#475569",
    borderWidth: 1,
    textColor: "#22d3ee",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "right",
    borderRadius: 2,
  },
  GRAPHIC_VIEW: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 4,
  },
  GRAPHIC_IO_FIELD: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 4,
  },
  SYMBOLIC_IO_FIELD: {
    backgroundColor: "#0f172a",
    borderColor: "#475569",
    borderWidth: 1,
    textColor: "#a5f3fc",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
    borderRadius: 2,
  },
  LINE: {
    backgroundColor: "#475569",
  },
  CIRCLE: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 2,
    borderRadius: 999,
  },
  ELLIPSE: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 2,
    borderRadius: 999,
  },
  POLYGON: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 2,
  },
  GAUGE: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 2,
    borderRadius: 999,
  },
  BAR: {
    backgroundColor: "#0f172a",
    borderColor: "#475569",
    borderWidth: 1,
    textColor: "#22c55e",
    borderRadius: 2,
  },
  SLIDER: {
    backgroundColor: "#1e293b",
    borderColor: "#475569",
    borderWidth: 1,
    textColor: "#3b82f6",
    borderRadius: 4,
  },
  SWITCH: {
    backgroundColor: "#374151",
    borderColor: "#4b5563",
    borderWidth: 1,
    textColor: "#22c55e",
    borderRadius: 999,
  },
  TREND_VIEW: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    textColor: "#94a3b8",
    fontSize: 10,
    borderRadius: 4,
  },
  ALARM_VIEW: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    textColor: "#e2e8f0",
    fontSize: 11,
    borderRadius: 4,
  },
  DATE_TIME: {
    textColor: "#94a3b8",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "right",
  },
  GROUP: {
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 4,
  },
  FACEPLATE: {
    backgroundColor: "#1e293b",
    borderColor: "#3b82f6",
    borderWidth: 2,
    textColor: "#e2e8f0",
    fontSize: 12,
    fontWeight: "bold",
    textAlign: "center",
    borderRadius: 6,
  },
  POLYLINE: {
    backgroundColor: "#475569",
  },
  CLOCK: {
    backgroundColor: "#1e293b",
    borderColor: "#334155",
    borderWidth: 1,
    textColor: "#e2e8f0",
    fontSize: 14,
    borderRadius: 999,
  },
  PIPE: {
    backgroundColor: "#334155",
    borderColor: "#475569",
    borderWidth: 1,
    borderRadius: 999,
  },
  SCREEN_WINDOW: {
    backgroundColor: "#0f172a",
    borderColor: "#3b82f6",
    borderWidth: 2,
    textColor: "#e2e8f0",
    fontSize: 11,
    borderRadius: 4,
  },
};
