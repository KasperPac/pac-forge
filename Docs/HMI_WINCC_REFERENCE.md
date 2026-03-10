# WinCC Comfort / Advanced HMI Reference

Comprehensive reference for WinCC RT Advanced (Comfort-based) screen objects, properties, animations, events, and TIA Portal Openness API access. Targets TIA Portal V18/V19 with WinCC Comfort Panels and WinCC RT Advanced on IPCs.

> **Sources:** WinCC Engineering V19 Programming Reference, HMI Toolbox for WinCC Comfort/Advanced V19, TIA Portal Openness System Manual, HMI Template Library LTemplateKMT, and real TIA Portal V18 screen exports from the Freezer project (CVL-2129-5001002).

---

## 1. Complete Screen Object Types

### 1.1 Basic Objects

These are the fundamental drawing primitives available in the WinCC Toolbox.

| Object | XML Element | Description |
|--------|------------|-------------|
| Line | `Hmi.Screen.Line` | Straight line between two points |
| Polyline | `Hmi.Screen.Polyline` | Connected line segments (open path) |
| Polygon | `Hmi.Screen.Polygon` | Closed polygon shape (filled) |
| Ellipse | `Hmi.Screen.Ellipse` | Ellipse/circle shape |
| Circle | `Hmi.Screen.Circle` | Perfect circle (constrained ellipse) |
| Rectangle | `Hmi.Screen.Rectangle` | Rectangle with optional rounded corners |
| TextField | `Hmi.Screen.TextField` | Static text label (non-editable at runtime) |
| GraphicView | `Hmi.Screen.GraphicView` | Static image display (PNG, BMP, SVG, EMF) |

### 1.2 Elements (Dynamic Objects)

These objects connect to HMI tags for runtime data display and input.

| Object | XML Element | Description |
|--------|------------|-------------|
| IOField | `Hmi.Screen.IOField` | Numeric/string input-output field bound to a tag |
| SymbolicIOField | `Hmi.Screen.SymbolicIOField` | Text list-driven display (maps integer tag values to text strings) |
| GraphicIOField | `Hmi.Screen.GraphicIOField` | Image list-driven display (maps integer tag values to graphics) |
| DateTimeField | `Hmi.Screen.DateTimeField` | Date/time display and input |
| Bar | `Hmi.Screen.Bar` | Horizontal or vertical bar graph (single value) |
| Gauge | `Hmi.Screen.Gauge` | Analog gauge/dial indicator |
| Slider | `Hmi.Screen.Slider` | Slider control for value input |
| Switch | `Hmi.Screen.Switch` | Toggle switch (two-state) |
| SymbolLibrary | `Hmi.Screen.SymbolLibrary` | Symbol from the global symbol library |

### 1.3 Controls (Complex Objects)

Advanced interactive controls with built-in functionality.

| Object | XML Element | Description |
|--------|------------|-------------|
| Button | `Hmi.Screen.Button` | Push button with text/graphic, events, and states |
| RoundButton | `Hmi.Screen.RoundButton` | Circular push button |
| AlarmView | `Hmi.Screen.AlarmView` | Alarm/message display table (filterable, sortable) |
| TrendView | `Hmi.Screen.TrendView` | Trend chart (real-time and historical data logging) |
| FunctionTrendView | `Hmi.Screen.FunctionTrendView` | XY function trend (plots Y vs X, not vs time) |
| RecipeView | `Hmi.Screen.RecipeView` | Recipe data display and editing |
| StatusForce | `Hmi.Screen.StatusForce` | PLC tag status/force display (diagnostics) |
| SmartClientView | `Hmi.Screen.SmartClientView` | Remote VNC/Sm@rt client embedded view |
| MediaPlayer | `Hmi.Screen.MediaPlayer` | Video/audio playback |
| PDFView | `Hmi.Screen.PDFView` | Embedded PDF document viewer |
| WebBrowserView | `Hmi.Screen.WebBrowserView` | Embedded web browser |
| UserView | `Hmi.Screen.UserView` | Custom user-defined control container |

### 1.4 Enhanced Objects

Higher-level compound objects with built-in behavior.

| Object | XML Element | Description |
|--------|------------|-------------|
| Clock | `Hmi.Screen.Clock` | Analog or digital clock |
| BatteryView | `Hmi.Screen.BatteryView` | Battery level indicator |
| HandPointer | `Hmi.Screen.HandPointer` | Hand/pointer indicator |
| Pipe | `Hmi.Screen.Pipe` | Process pipe with flow direction |
| TConnector | `Hmi.Screen.TConnector` | T-shaped pipe connector |
| CrossConnector | `Hmi.Screen.CrossConnector` | Cross-shaped pipe connector |
| DoubleTPiece | `Hmi.Screen.DoubleTPiece` | Double T-piece connector |

### 1.5 Container/Structural Objects

| Object | XML Element | Description |
|--------|------------|-------------|
| Group | `Hmi.Screen.Group` | Container grouping multiple objects |
| FaceplateContainer | `Hmi.Screen.FaceplateContainer` | Faceplate type definition container |
| FaceplateInstance | `Hmi.Screen.FaceplateInstance` | Instance of a faceplate type on a screen |
| ScreenWindow | `Hmi.Screen.ScreenWindow` | Embedded screen-in-screen (popup or embedded) |
| TabControl | `Hmi.Screen.TabControl` | Tabbed container with multiple tab pages |

### 1.6 Screen-Level Objects

| Object | XML Element | Description |
|--------|------------|-------------|
| Screen | `Hmi.Screen.Screen` | The screen itself (root container) |
| ScreenLayer | `Hmi.Screen.ScreenLayer` | Layer within a screen (z-ordering) |
| ScreenTemplate | `Hmi.Screen.ScreenTemplate` | Template applied to multiple screens (header/footer/nav) |
| GlobalScreen | `Hmi.Screen.GlobalScreen` | Permanent screen overlay (always visible) |
| PopupScreen | `Hmi.Screen.PopupScreen` | Modal/modeless popup screen |
| SlideinScreen | `Hmi.Screen.SlideinScreen` | Slide-in panel from screen edge |
| SoftKey | `Hmi.Screen.SoftKey` | Function key assignment (panel softkeys) |

### 1.7 Toolbox Extended Objects (V19)

From the WinCC Comfort/Advanced V19 Toolbox library:

| Category | Objects |
|----------|---------|
| Time Functions | Calendar, TimeOfDayAlarm, Stopwatch, Timer, TimeSwitch, WorldClock |
| Data Transfer | Chat, BarcodeReader, QRCode, EmailSend, FileBackup |
| Math Functions | Calculator, UnitConverter |
| Simplified Operation | OnScreenKeyboard, HomeButton, Screensaver, Checkbox, RadioButton, MovingPopup, SegmentedControl, Notes |
| Clarity Enhancement | GaugeBasicPanel, GaugeComfortAdvanced, FileExplorer, TableView, BackgroundPopup, WaitingView, PercentageView, BitMonitor |
| Engineering Tools | RotationTool, SiemensIconFont |

---

## 2. Properties Per Object Type

### 2.1 Common Properties (All Objects)

These properties exist on every screen object:

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| ObjectName | `ObjectName` | String | Unique name within screen |
| Left | `Left` | Int | X position in pixels |
| Top | `Top` | Int | Y position in pixels |
| Width | `Width` | Int | Width in pixels |
| Height | `Height` | Int | Height in pixels |
| Visible | `Visible` | Bool | Static visibility |
| Enabled | `Enabled` | Bool | Whether user can interact |
| TabIndex | `TabIndex` | Int | Tab order index |
| ToolTipText | `ToolTipText` | String | Tooltip on hover |
| Authorization | `Authorization` | String | Required user authorization level |
| Layer | (composition) | - | Which ScreenLayer the object belongs to |
| Flashing | `Flashing` | Bool | Enable flashing animation |
| FlashRate | `FlashRate` | Enum | Slow, Medium, Fast |

### 2.2 Appearance Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| BackColor | `BackColor` | RGB (R,G,B) | Background/fill color |
| ForeColor | `ForeColor` | RGB | Foreground/text color |
| BorderColor | `BorderColor` | RGB | Border/outline color |
| BorderWidth | `BorderWidth` | Int | Border thickness in pixels |
| BackFillStyle | `BackFillStyle` | Enum | Solid, Transparent, Gradient |
| FillPattern | `FillPattern` | Enum | None, Horizontal, Vertical, Cross, DiagonalLeft, DiagonalRight, DiagonalCross |
| FillPatternColor | `FillPatternColor` | RGB | Pattern overlay color |
| CornerRadius | `CornerRadius` | Int | Rounded corner radius |
| RoundCornerWidth | `RoundCornerWidth` | Int | Alternate corner rounding |
| RoundCornerHeight | `RoundCornerHeight` | Int | Corner height rounding |
| FlatStyle | `FlatStyle` | Enum | Flat3D, Flat, Raised3D, Sunken3D |
| ShowBorder | `ShowBorder` | Bool | Toggle border display |

### 2.3 Text/Font Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| Text | (MultilingualText) | String | Display text (multilingual) |
| HorizontalAlignment | `HorizontalAlignment` | Enum | Left, Center, Right |
| VerticalAlignment | `VerticalAlignment` | Enum | Top, Center, Bottom |
| AutoSize | `AutoSize` | Bool | Auto-resize to fit text |
| WordWrap | `WordWrap` | Bool | Wrap text at boundaries |

Font properties are nested in `Hmi.Globalization.FontItem`:

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| Font.Name | `Name` (FontItem) | String | Font family (e.g., "Siemens Sans", "Tahoma") |
| Font.Size | `Size` (FontItem) | Int | Font size in points |
| Font.Bold | `Bold` (FontItem) | Bool | Bold style |
| Font.Italic | `Italic` (FontItem) | Bool | Italic style |
| Font.Underline | `Underline` (FontItem) | Bool | Underline style |
| Font.Strikeout | `Strikeout` (FontItem) | Bool | Strikethrough |
| Font.CharSet | `CharSet` (FontItem) | Int | Character set code |

### 2.4 IOField-Specific Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| Mode | `Mode` | Enum | Input, Output, InputOutput |
| DataFormat | `DataFormat` | Enum | Decimal, Hexadecimal, Binary, Octal, String, Date, Time, DateTime |
| LimitUpperValue | `LimitUpperValue` | Number | Upper input limit |
| LimitLowerValue | `LimitLowerValue` | Number | Lower input limit |
| LimitUpperWarning | `LimitUpperWarning` | Number | Upper warning threshold |
| LimitLowerWarning | `LimitLowerWarning` | Number | Lower warning threshold |
| InputValueInvalid | `InputValueInvalid` | Enum | Reject, Correct, UseOldValue |
| NumberDecimalPlaces | `NumberDecimalPlaces` | Int | Decimal places for display |
| OutputFormat | `OutputFormat` | String | Printf-style format string |
| ClearOnNewInput | `ClearOnNewInput` | Bool | Clear field on first keystroke |
| ShowLeadingZeros | `ShowLeadingZeros` | Bool | Show leading zeros |
| UseExponentialFormat | `UseExponentialFormat` | Bool | Scientific notation display |

### 2.5 Button-Specific Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| Mode | `Mode` | Enum | Press, Toggle, Latching |
| HotKey | `HotKey` | String | Keyboard shortcut |
| Pressed | `Pressed` | Bool | Current press state |
| PressedBackColor | `PressedBackColor` | RGB | Color when pressed |
| PressedForeColor | `PressedForeColor` | RGB | Text color when pressed |
| PressedBorderColor | `PressedBorderColor` | RGB | Border when pressed |
| Picture | (LinkList) | Ref | Graphic to display on button |
| PicturePressed | (LinkList) | Ref | Graphic when pressed |

### 2.6 Bar Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| Orientation | `Orientation` | Enum | Horizontal, Vertical |
| BarBackColor | `BarBackColor` | RGB | Bar background |
| BarColor | `BarColor` | RGB | Bar fill color |
| BarScaleMin | `BarScaleMin` | Number | Minimum scale value |
| BarScaleMax | `BarScaleMax` | Number | Maximum scale value |
| ShowScale | `ShowScale` | Bool | Show scale markings |
| ShowValue | `ShowValue` | Bool | Show numeric value |
| SegmentCount | `SegmentCount` | Int | Number of bar segments |
| LimitUpperColor | `LimitUpperColor` | RGB | Color above upper limit |
| LimitLowerColor | `LimitLowerColor` | RGB | Color below lower limit |

### 2.7 Gauge Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| StartAngle | `StartAngle` | Int | Gauge arc start angle (degrees) |
| EndAngle | `EndAngle` | Int | Gauge arc end angle |
| ScaleMin | `ScaleMin` | Number | Minimum value |
| ScaleMax | `ScaleMax` | Number | Maximum value |
| NeedleColor | `NeedleColor` | RGB | Needle/pointer color |
| ShowScale | `ShowScale` | Bool | Show scale markings |
| ShowValue | `ShowValue` | Bool | Show numeric readout |
| MajorTickCount | `MajorTickCount` | Int | Number of major ticks |
| MinorTickCount | `MinorTickCount` | Int | Minor ticks between major |

### 2.8 Trend View Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| TimeRange | `TimeRange` | TimeSpan | Visible time window |
| AutoScroll | `AutoScroll` | Bool | Auto-scroll with new data |
| ShowRuler | `ShowRuler` | Bool | Show crosshair ruler |
| ShowLegend | `ShowLegend` | Bool | Show trend legend |
| ShowToolbar | `ShowToolbar` | Bool | Show zoom/scroll toolbar |
| GridColor | `GridColor` | RGB | Background grid color |
| GridLineStyle | `GridLineStyle` | Enum | Solid, Dash, Dot, DashDot |
| Trends (collection) | ObjectList | - | List of trend curves (each with tag, color, line width, axis) |

Per-trend properties:
| Property | Type | Description |
|----------|------|-------------|
| Tag | Ref | HMI tag to plot |
| LineColor | RGB | Curve color |
| LineWidth | Int | Curve thickness |
| LineStyle | Enum | Solid, Dash, Dot |
| AxisMin | Number | Y-axis minimum |
| AxisMax | Number | Y-axis maximum |
| AxisPosition | Enum | Left, Right |

### 2.9 Alarm View Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| ShowDate | `ShowDate` | Bool | Show date column |
| ShowTime | `ShowTime` | Bool | Show time column |
| ShowStatus | `ShowStatus` | Bool | Show alarm status |
| ShowAcknowledge | `ShowAcknowledge` | Bool | Show acknowledge button |
| ShowAlarmNumber | `ShowAlarmNumber` | Bool | Show alarm number |
| ShowAlarmText | `ShowAlarmText` | Bool | Show alarm text |
| ShowPLC | `ShowPLC` | Bool | Show PLC source |
| AlarmClasses | Collection | Filter by alarm class |
| SortColumn | String | Column to sort by |
| SortOrder | Enum | Ascending, Descending |

### 2.10 Screen Window Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| ScreenName | `ScreenName` | String | Name of screen to embed |
| Scrollable | `Scrollable` | Bool | Allow scrolling |
| ShowBorder | `ShowBorder` | Bool | Show window border |
| Movable | `Movable` | Bool | Allow user to drag at runtime |
| Modal | `Modal` | Bool | Modal (blocks parent interaction) |
| CloseOnDeactivate | `CloseOnDeactivate` | Bool | Close when losing focus |
| Zoom | `Zoom` | Int | Zoom factor (percent) |

### 2.11 GraphicView / GraphicIOField Properties

| Property | XML Attribute | Type | Description |
|----------|--------------|------|-------------|
| Picture | (LinkList) | Ref | Reference to graphic resource |
| SizeMode | `SizeMode` | Enum | Stretch, Zoom, Original, Fill |
| TransparentColor | `TransparentColor` | RGB | Color to render as transparent |
| UseTransparentColor | `UseTransparentColor` | Bool | Enable transparency |
| GraphicList | (LinkList) | Ref | Image list reference (GraphicIOField) |
| GraphicIndex | (tag) | Int | Index into graphic list, driven by tag |

---

## 3. Animation / Dynamization Types

### 3.1 Tag-Based Dynamizations

Every dynamizable property can be connected to an HMI tag. The XML structure uses a `Dynamization` composition on the property element.

| Animation Type | XML Element | Description |
|---------------|------------|-------------|
| Tag Connection | `Hmi.Dynamic.TagConnectionDynamic` | Directly bind a property value to a tag |
| Single-Bit Visibility | `Hmi.Dynamic.SingleBitVisibilityAnimation` | Show/hide based on a Bool tag |
| Range Visibility | `Hmi.Dynamic.VisibilityAnimation` | Show/hide based on value ranges |
| Range Appearance | `Hmi.Dynamic.RangeAppearanceAnimation` | Change colors based on value ranges |
| Horizontal Movement | `Hmi.Dynamic.HorizontalMovementAnimation` | Move object left/right proportional to tag value |
| Vertical Movement | `Hmi.Dynamic.VerticalMovementAnimation` | Move object up/down proportional to tag value |
| Direct Movement | `Hmi.Dynamic.DirectMovementAnimation` | Move to absolute X,Y from tags |
| Rotation | `Hmi.Dynamic.RotationAnimation` | Rotate object around center based on tag |
| Object Enabling | `Hmi.Dynamic.ObjectEnablingAnimation` | Enable/disable object based on tag |
| Flashing | `Hmi.Dynamic.FlashAnimation` | Flash foreground/background based on tag |
| Fill Level | `Hmi.Dynamic.FillLevelAnimation` | Fill object (like a tank) based on tag value |
| Size | `Hmi.Dynamic.SizeAnimation` | Scale width/height proportional to tag |

### 3.2 Range Appearance Animation Detail

```xml
<Hmi.Dynamic.RangeAppearanceAnimation CompositionName="Dynamizations">
  <AttributeList>
    <AnimatedProperty>BackColor</AnimatedProperty>
    <DefaultValue>192, 192, 192</DefaultValue>
  </AttributeList>
  <ObjectList>
    <Hmi.Dynamic.RangeAppearanceEntry>
      <AttributeList>
        <RangeType>Equal</RangeType>  <!-- Equal, NotEqual, Greater, Less, GreaterEqual, LessEqual, Range -->
        <From>0</From>
        <To>0</To>
        <Value>0, 128, 0</Value>      <!-- Green when value = 0 -->
      </AttributeList>
    </Hmi.Dynamic.RangeAppearanceEntry>
    <Hmi.Dynamic.RangeAppearanceEntry>
      <AttributeList>
        <RangeType>Equal</RangeType>
        <From>1</From>
        <To>1</To>
        <Value>255, 0, 0</Value>       <!-- Red when value = 1 -->
      </AttributeList>
    </Hmi.Dynamic.RangeAppearanceEntry>
  </ObjectList>
  <LinkList>
    <Tag TargetID="@OpenLink"><Name>Status_Tag</Name></Tag>
  </LinkList>
</Hmi.Dynamic.RangeAppearanceAnimation>
```

### 3.3 Visibility Animation Detail

```xml
<Hmi.Dynamic.SingleBitVisibilityAnimation CompositionName="Dynamizations">
  <AttributeList>
    <AnimatedProperty>Visible</AnimatedProperty>
    <NegateResult>false</NegateResult>     <!-- true = invert (hide when tag is true) -->
  </AttributeList>
  <LinkList>
    <Tag TargetID="@OpenLink"><Name>Bool_Tag</Name></Tag>
  </LinkList>
</Hmi.Dynamic.SingleBitVisibilityAnimation>
```

### 3.4 Movement Animation Detail

```xml
<Hmi.Dynamic.HorizontalMovementAnimation CompositionName="Dynamizations">
  <AttributeList>
    <AnimatedProperty>Left</AnimatedProperty>
    <StartValue>0</StartValue>         <!-- Tag value for leftmost position -->
    <EndValue>100</EndValue>           <!-- Tag value for rightmost position -->
    <StartPosition>50</StartPosition>  <!-- Pixel position at StartValue -->
    <EndPosition>500</EndPosition>     <!-- Pixel position at EndValue -->
  </AttributeList>
  <LinkList>
    <Tag TargetID="@OpenLink"><Name>Position_Tag</Name></Tag>
  </LinkList>
</Hmi.Dynamic.HorizontalMovementAnimation>
```

### 3.5 Fill Level Animation Detail

```xml
<Hmi.Dynamic.FillLevelAnimation CompositionName="Dynamizations">
  <AttributeList>
    <AnimatedProperty>FillLevel</AnimatedProperty>
    <Direction>BottomToTop</Direction>   <!-- BottomToTop, TopToBottom, LeftToRight, RightToLeft -->
    <MinValue>0</MinValue>
    <MaxValue>100</MaxValue>
  </AttributeList>
  <LinkList>
    <Tag TargetID="@OpenLink"><Name>Level_Tag</Name></Tag>
  </LinkList>
</Hmi.Dynamic.FillLevelAnimation>
```

### 3.6 Animatable Properties

The following properties can have dynamizations attached:

| Property | Applicable Animation Types |
|----------|---------------------------|
| Visible | SingleBitVisibility, RangeVisibility |
| Enabled | ObjectEnabling |
| BackColor | RangeAppearance, TagConnection |
| ForeColor | RangeAppearance, TagConnection |
| BorderColor | RangeAppearance, TagConnection |
| Left | HorizontalMovement, DirectMovement, TagConnection |
| Top | VerticalMovement, DirectMovement, TagConnection |
| Width | Size, TagConnection |
| Height | Size, TagConnection |
| Rotation | Rotation |
| FillLevel | FillLevel |
| Text | TagConnection |
| FlashRate | Flash |
| Opacity | TagConnection |

---

## 4. Events and Scripting

### 4.1 Available Events

Events are defined per object type. The XML structure is:

```xml
<Hmi.Event.Event CompositionName="Events">
  <AttributeList><Name>EVENT_NAME</Name></AttributeList>
  <ObjectList>
    <Hmi.Event.FunctionListEventHandler>
      <ObjectList>
        <!-- Function list entries -->
      </ObjectList>
    </Hmi.Event.FunctionListEventHandler>
    <!-- OR -->
    <Hmi.Event.ScriptEventHandler>
      <AttributeList>
        <ScriptCode>... VBScript code ...</ScriptCode>
      </AttributeList>
    </Hmi.Event.ScriptEventHandler>
  </ObjectList>
</Hmi.Event.Event>
```

| Event | Applicable Objects | Description |
|-------|-------------------|-------------|
| Click | All interactive | User clicks/taps the object |
| Press | All interactive | Mouse/finger down on object |
| Release | All interactive | Mouse/finger up on object |
| Activate | Screen, ScreenWindow | Screen becomes active/visible |
| Deactivate | Screen, ScreenWindow | Screen becomes inactive/hidden |
| Change | IOField, SymbolicIOField | Tag value changes |
| LimitViolation | IOField | Input exceeds configured limits |
| Loaded | Screen | Screen finishes loading |
| KeyPress | Screen | Keyboard key pressed |
| KeyRelease | Screen | Keyboard key released |
| DoubleClick | All interactive | Double-click/double-tap |
| MouseEnter | All interactive | Cursor enters object bounds |
| MouseLeave | All interactive | Cursor leaves object bounds |
| DragStart | All interactive | Drag operation begins |
| DragEnd | All interactive | Drag operation ends |
| Drop | All interactive | Object dropped on this element |
| ScrollUp | AlarmView, TrendView | Scroll up in list/trend |
| ScrollDown | AlarmView, TrendView | Scroll down |
| TimeOut | Timer objects | Timer expires |
| AlarmIncoming | AlarmView | New alarm arrives |
| AlarmsCleared | AlarmView | All alarms acknowledged |

### 4.2 System Functions

System functions are pre-built actions assignable to events without scripting.

```xml
<Hmi.Event.FunctionListEntry>
  <AttributeList>
    <Name>FUNCTION_NAME</Name>
    <Type>SystemFunction</Type>
  </AttributeList>
  <ObjectList>
    <Hmi.Event.FunctionListEntryParameter>
      <AttributeList>
        <Name>PARAM_NAME</Name>
      </AttributeList>
      <ObjectList>
        <Value>PARAM_VALUE</Value>
      </ObjectList>
    </Hmi.Event.FunctionListEntryParameter>
  </ObjectList>
</Hmi.Event.FunctionListEntry>
```

**Navigation Functions:**
| Function | Parameters | Description |
|----------|-----------|-------------|
| ActivateScreen | ScreenName, ScreenNumber | Navigate to another screen |
| ActivatePreviousScreen | - | Go back to previous screen |
| ActivateScreenByNumber | ScreenNumber | Navigate by screen number |
| OpenScreenWindow | ScreenName, X, Y, Width, Height | Open popup/embedded screen |
| CloseScreenWindow | WindowName | Close a screen window |
| CloseAllScreenWindows | - | Close all open popups |

**Tag Manipulation Functions:**
| Function | Parameters | Description |
|----------|-----------|-------------|
| SetTag | TagName, Value | Write a value to an HMI tag |
| SetTagIndirect | TagPrefix, Index, Value | Write via computed tag name |
| IncreaseTag | TagName, Value | Add to current tag value |
| DecreaseTag | TagName, Value | Subtract from current tag value |
| InvertBit | TagName | Toggle a Bool tag |
| SetBit | TagName | Set Bool tag to TRUE |
| ResetBit | TagName | Set Bool tag to FALSE |
| SetBitInTag | TagName, BitNumber | Set specific bit in integer tag |
| ResetBitInTag | TagName, BitNumber | Reset specific bit |

**Alarm Functions:**
| Function | Parameters | Description |
|----------|-----------|-------------|
| AcknowledgeAlarm | AlarmNumber | Acknowledge a specific alarm |
| AcknowledgeAllAlarms | - | Acknowledge all active alarms |
| ShowAlarmWindow | - | Display alarm popup |
| HideAlarmWindow | - | Hide alarm popup |

**System Functions:**
| Function | Parameters | Description |
|----------|-----------|-------------|
| SimulateKeyPress | VirtualKey | Simulate keyboard input |
| ShowSystemDiagnostics | - | Open system diagnostics |
| ShowSystemAlarm | AlarmText | Display system notification |
| StartLogging | LogName | Start data logging |
| StopLogging | LogName | Stop data logging |
| PrintScreen | - | Print current screen |
| ExportCSV | FileName, LogName | Export log data to CSV |
| SetLanguage | LanguageID | Switch display language |
| Logout | - | Log out current user |
| ShowLoginDialog | - | Show login screen |
| StopRuntime | - | Stop WinCC runtime |

### 4.3 VBScript Scripting (WinCC Comfort/Advanced)

WinCC Comfort and WinCC RT Advanced use **VBScript** for custom scripting. Scripts can be:
- **Inline** (attached directly to an event on a screen object)
- **Scheduled** (triggered by tag change, cyclic timer, or system event)
- **Global modules** (reusable script library functions)

Key scripting objects:

```vbs
' Reading/writing tags
Dim tagValue
tagValue = SmartTags("HMI_Tag_Name")       ' Read tag
SmartTags("HMI_Tag_Name") = 42              ' Write tag

' Screen navigation
HmiRuntime.Screens("ScreenName").Show       ' Navigate to screen

' Alarm access
HmiRuntime.Alarms.AcknowledgeAll            ' Acknowledge all alarms

' User management
HmiRuntime.UserAdmin.ShowLogonDialog        ' Show login

' Screen object manipulation
Dim screenObj
Set screenObj = HmiRuntime.Screens("Main").ScreenItems("Button_1")
screenObj.BackColor = RGB(255, 0, 0)        ' Set background color
screenObj.Visible = True                     ' Show/hide

' Logging
HmiRuntime.Logging("DataLog_1").Start       ' Start logging
HmiRuntime.Logging("DataLog_1").Stop        ' Stop logging
```

### 4.4 VBScript vs Function List Choice

| Use Case | Recommended |
|----------|-------------|
| Simple tag set/toggle | Function List (SystemFunction) |
| Screen navigation | Function List (ActivateScreen) |
| Conditional logic | VBScript |
| Loop/iteration | VBScript |
| Complex calculations | VBScript |
| Multi-step operations | VBScript |
| Simple alarm acknowledge | Function List |
| Tag-dependent branching | VBScript |

> **Note:** WinCC Unified uses JavaScript instead of VBScript. WinCC Comfort/Advanced supports VBScript only.

---

## 5. TIA Portal Openness API for HMI

### 5.1 Key Namespaces

```csharp
using Siemens.Engineering.Hmi;             // HmiTarget, ScreenFolder, etc.
using Siemens.Engineering.Hmi.Screen;       // Screen, ScreenItem (objects)
using Siemens.Engineering.Hmi.Tag;          // TagTable, Tag
using Siemens.Engineering.Hmi.Globalization; // TextList, GraphicList
using Siemens.Engineering.Hmi.RuntimeScripting; // VBScript management
using Siemens.Engineering.Hmi.Communication; // Connections to PLC
using Siemens.Engineering.Library;          // Project library access
using Siemens.Engineering.Library.Types;    // Library type management
```

### 5.2 Getting the HMI Target

```csharp
// From TIA project — find HMI device
HmiTarget hmiTarget = null;
foreach (var device in project.Devices)
{
    foreach (var item in device.DeviceItems)
    {
        var sw = item.GetService<SoftwareContainer>();
        if (sw?.Software is HmiTarget hmi)
        {
            hmiTarget = hmi;
            break;
        }
    }
}
```

### 5.3 Screen Management

```csharp
// Access screen folders
ScreenFolder rootFolder = hmiTarget.ScreenFolder;
ScreenComposition screens = rootFolder.Screens;

// Iterate screens
foreach (Screen screen in screens)
{
    Console.WriteLine($"Screen: {screen.Name}, Size: {screen.Width}x{screen.Height}");
}

// Create a new screen
Screen newScreen = screens.Create("MyNewScreen");
newScreen.Width = 1920;
newScreen.Height = 1080;
newScreen.BackColor = Color.FromArgb(15, 23, 42); // Dark blue

// Delete a screen
screen.Delete();

// Access screen subfolders
ScreenUserFolderComposition subFolders = rootFolder.Folders;
ScreenUserFolder subFolder = subFolders.Create("ProcessScreens");
```

### 5.4 Screen Object Manipulation via Openness

Direct screen object creation and modification is **limited** in TIA Portal Openness V18. The primary method is **XML import/export**.

#### XML Export (Read Screen Objects)

```csharp
// Export screen to XML file
string exportPath = @"C:\temp\screen_export.xml";
screen.Export(new FileInfo(exportPath), ExportOptions.WithDefaults);
// Parses to the XML format shown in Section 7
```

#### XML Import (Create/Modify Screens)

```csharp
// Import screen from XML
string importPath = @"C:\temp\screen_definition.xml";
screens.Import(new FileInfo(importPath), ImportOptions.Override);
// Override replaces existing screen with same name
// None creates new (fails if name exists)
```

#### Reading Screen Items (Limited API)

```csharp
// Access screen items collection
ScreenItemComposition items = screen.ScreenItems;

foreach (ScreenItem item in items)
{
    Console.WriteLine($"  Item: {item.Name} (Type: {item.GetType().Name})");

    // Common properties accessible:
    // item.Name - object name
    // item.Left, item.Top - position
    // item.Width, item.Height - size
}
```

> **Important Limitation:** In TIA Portal V18, direct programmatic creation of screen objects (e.g., `items.CreateRectangle()`) is NOT available. Screen objects must be created via XML import. Properties can be read but many cannot be set directly via the API — XML import/export is the reliable method.

### 5.5 Tag Table Management

```csharp
// Access HMI tag tables
TagSystemFolder tagFolder = hmiTarget.TagFolder;
TagTableComposition tagTables = tagFolder.TagTables;

// Iterate tag tables
foreach (TagTable table in tagTables)
{
    Console.WriteLine($"Tag Table: {table.Name}");
    foreach (Tag tag in table.Tags)
    {
        Console.WriteLine($"  Tag: {tag.Name}, Type: {tag.DataType}");
        // tag.PlcTag — linked PLC tag name
        // tag.AcquisitionCycle — read cycle
        // tag.Comment — tag description
    }
}

// Export tag table to XML
tagTable.Export(new FileInfo(@"C:\temp\tags.xml"), ExportOptions.WithDefaults);

// Import tag table from XML
tagTables.Import(new FileInfo(@"C:\temp\tags.xml"), ImportOptions.Override);
```

### 5.6 Text Lists and Graphic Lists

```csharp
// Access text lists (for SymbolicIOField)
TextListComposition textLists = hmiTarget.TextLists;
foreach (TextList list in textLists)
{
    Console.WriteLine($"Text List: {list.Name}");
}

// Access graphic lists (for GraphicIOField)
GraphicListComposition graphicLists = hmiTarget.GraphicLists;
foreach (GraphicList list in graphicLists)
{
    Console.WriteLine($"Graphic List: {list.Name}");
}

// Export/import lists via XML
textList.Export(new FileInfo(path), ExportOptions.WithDefaults);
graphicList.Export(new FileInfo(path), ExportOptions.WithDefaults);
```

### 5.7 Connections (HMI-PLC Communication)

```csharp
// Access HMI connections to PLCs
ConnectionComposition connections = hmiTarget.Connections;
foreach (Connection conn in connections)
{
    Console.WriteLine($"Connection: {conn.Name}, Partner: {conn.Partner}");
}
```

### 5.8 HMI Compilation via Openness

```csharp
// Compile HMI configuration
ICompilable compileService = hmiTarget.GetService<ICompilable>();
CompilerResult result = compileService.Compile();

// Check results
Console.WriteLine($"State: {result.State}"); // Success, Warning, Error
foreach (CompilerResultMessage msg in result.Messages)
{
    Console.WriteLine($"  [{msg.State}] {msg.Description}");
}
```

### 5.9 Library Access (Faceplates, Types)

```csharp
// Access project library
ProjectLibrary projectLib = project.ProjectLibrary;
LibraryTypeFolder typeFolder = projectLib.TypeFolder;

// Iterate library types (includes faceplates)
foreach (LibraryType libType in typeFolder.Types)
{
    Console.WriteLine($"Library Type: {libType.Name}");
    // Can export to XML for inspection
}

// Access global library
GlobalLibrary globalLib; // must be opened separately
```

### 5.10 Key Openness Limitations for HMI

| Capability | V18 Support | Notes |
|-----------|-------------|-------|
| Screen create/delete | Yes | Via API or XML import |
| Screen item create (API) | No | Must use XML import |
| Screen item read | Partial | Name, position, size; limited property access |
| Screen item modify (API) | Very limited | Most properties require XML export → modify → reimport |
| Screen XML export | Yes | Full fidelity |
| Screen XML import | Yes | Primary method for screen generation |
| Tag table CRUD | Yes | Full support via API and XML |
| Text/Graphic list CRUD | Yes | Via XML import/export |
| Compile HMI | Yes | Full compile with result messages |
| Download to panel | Yes | Via Openness download API |
| Faceplate access | Partial | Via library type export |
| VBScript access | No | Scripts embedded in screen XML only |
| Animation/dynami­zation create (API) | No | Must be in imported XML |

---

## 6. XML Schema Reference

### 6.1 Screen Document Root

```xml
<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="V18" />
  <Hmi.Screen.Screen ID="0" CompositionName="Screens">
    <AttributeList>
      <Name>SCREEN_NAME</Name>
      <Height>1080</Height>
      <Width>1920</Width>
      <BackColor>15, 23, 42</BackColor>
      <GridColor>30, 41, 59</GridColor>
      <Number>1</Number>
    </AttributeList>
    <ObjectList>
      <!-- Screen Events -->
      <Hmi.Event.Event CompositionName="Events">...</Hmi.Event.Event>

      <!-- Screen Layers -->
      <Hmi.Screen.ScreenLayer CompositionName="Layers">
        <AttributeList><Name>Default Layer</Name></AttributeList>
        <ObjectList>
          <!-- Screen Items go here -->
        </ObjectList>
      </Hmi.Screen.ScreenLayer>
    </ObjectList>
  </Hmi.Screen.Screen>
</Document>
```

### 6.2 Screen Item XML Pattern

Every screen item follows this structure:

```xml
<Hmi.Screen.Rectangle CompositionName="ScreenItems" ID="N">
  <AttributeList>
    <ObjectName>Rect_Header</ObjectName>
    <Left>0</Left>
    <Top>0</Top>
    <Width>1920</Width>
    <Height>80</Height>
    <BackColor>30, 41, 59</BackColor>
    <ForeColor>226, 232, 240</ForeColor>
    <BorderColor>51, 65, 85</BorderColor>
    <BorderWidth>1</BorderWidth>
    <BackFillStyle>Solid</BackFillStyle>
    <CornerRadius>0</CornerRadius>
    <Visible>true</Visible>
    <Enabled>true</Enabled>
  </AttributeList>
  <ObjectList>
    <!-- Events -->
    <!-- Dynamizations (animations) -->
    <!-- Font items (for text-bearing objects) -->
  </ObjectList>
  <LinkList>
    <!-- Tag bindings, picture references -->
  </LinkList>
</Hmi.Screen.Rectangle>
```

### 6.3 Tag Binding (LinkList)

```xml
<LinkList>
  <Tag TargetID="@OpenLink">
    <Name>HMI_Tag_Name</Name>
  </Tag>
</LinkList>
```

For process tags (direct PLC connection):
```xml
<LinkList>
  <ProcessTag TargetID="@OpenLink">
    <Name>PLC_DB.variable</Name>
  </ProcessTag>
</LinkList>
```

### 6.4 Text with Multilingual Support

```xml
<Hmi.Screen.TextField CompositionName="ScreenItems" ID="N">
  <AttributeList>
    <ObjectName>Label_Title</ObjectName>
    <!-- position/size attributes -->
  </AttributeList>
  <ObjectList>
    <MultilingualText CompositionName="Text" ID="N">
      <ObjectList>
        <MultilingualTextItem CompositionName="Items" ID="N">
          <AttributeList>
            <Culture>en-US</Culture>
            <Text>
              <body><p>Screen Title</p></body>
            </Text>
          </AttributeList>
        </MultilingualTextItem>
      </ObjectList>
    </MultilingualText>
    <Hmi.Globalization.Font CompositionName="Font" ID="N">
      <ObjectList>
        <Hmi.Globalization.FontItem CompositionName="Items" ID="N">
          <AttributeList>
            <Culture>en-US</Culture>
            <Name>Siemens Sans</Name>
            <Size>24</Size>
            <Bold>true</Bold>
          </AttributeList>
        </Hmi.Globalization.FontItem>
      </ObjectList>
    </Hmi.Globalization.Font>
  </ObjectList>
</Hmi.Screen.TextField>
```

### 6.5 Event with System Function

```xml
<Hmi.Event.Event CompositionName="Events" ID="N">
  <AttributeList><Name>Click</Name></AttributeList>
  <ObjectList>
    <Hmi.Event.FunctionListEventHandler CompositionName="EventHandler" ID="N">
      <ObjectList>
        <Hmi.Event.FunctionListEntry CompositionName="FunctionListEntries" ID="N">
          <AttributeList>
            <Name>ActivateScreen</Name>
            <Type>SystemFunction</Type>
          </AttributeList>
          <ObjectList>
            <Hmi.Event.FunctionListEntryParameter CompositionName="Parameters" ID="N">
              <AttributeList><Name>ScreenName</Name></AttributeList>
              <ObjectList>
                <Value>TARGET_SCREEN</Value>
              </ObjectList>
            </Hmi.Event.FunctionListEntryParameter>
          </ObjectList>
        </Hmi.Event.FunctionListEntry>
      </ObjectList>
    </Hmi.Event.FunctionListEventHandler>
  </ObjectList>
</Hmi.Event.Event>
```

### 6.6 HMI Tag Table XML

```xml
<?xml version="1.0" encoding="utf-8"?>
<Document>
  <Engineering version="V18" />
  <Hmi.Tag.TagTable ID="0" CompositionName="TagTables">
    <AttributeList>
      <Name>Process_Tags</Name>
    </AttributeList>
    <ObjectList>
      <Hmi.Tag.Tag CompositionName="Tags" ID="N">
        <AttributeList>
          <Name>Motor_Speed</Name>
          <AcquisitionCycle>500 ms</AcquisitionCycle>
          <AcquisitionMode>Cyclic continuous</AcquisitionMode>
          <AcquisitionTriggerMode>Default</AcquisitionTriggerMode>
          <Coding>Binary</Coding>
          <Length>4</Length>
          <LoggingTag>false</LoggingTag>
          <PersistentTag>false</PersistentTag>
          <UpdateMode>Read/Write</UpdateMode>
        </AttributeList>
        <LinkList>
          <DataType TargetID="@OpenLink"><Name>Real</Name></DataType>
          <PlcTag TargetID="@OpenLink"><Name>"DB_Motors".Motor1.Speed</Name></PlcTag>
          <Connection TargetID="@OpenLink"><Name>HMI_Connection_1</Name></Connection>
        </LinkList>
      </Hmi.Tag.Tag>
    </ObjectList>
  </Hmi.Tag.TagTable>
</Document>
```

### 6.7 Supported HMI Tag Data Types

| Type | Length (bytes) | Description |
|------|---------------|-------------|
| Bool | 1 | Boolean (true/false) |
| Byte | 1 | Unsigned 8-bit |
| Char | 1 | ASCII character |
| Word | 2 | Unsigned 16-bit |
| Int | 2 | Signed 16-bit integer |
| DWord | 4 | Unsigned 32-bit |
| DInt | 4 | Signed 32-bit integer |
| Real | 4 | 32-bit float |
| LReal | 8 | 64-bit double |
| String | variable | Character string (max 254) |
| WString | variable | Unicode string |
| Date | 2 | Date value |
| Time | 4 | Time duration |
| DateTime | 8 | Date and time combined |
| DTL | 12 | Date/time long format |

---

## 7. Template Library Patterns

### 7.1 Standard Screen Layout Pattern (ISA-101 High-Performance)

Based on the reference Freezer project and ISA-101 guidelines:

```
+-------------------------------------------------------+
| HEADER BAR (h:60-80px)                                |
| Logo | Screen Title | Status Icons | Clock | User     |
+-------------------------------------------------------+
| NAV   |                                        | SIDE  |
| BAR   |     MAIN CONTENT AREA                  | BAR   |
| (w:60 |     (process graphics, data,           | (opt) |
|  -80) |      controls)                         |       |
|       |                                        |       |
| Home  |                                        |       |
| Area1 |                                        |       |
| Area2 |                                        |       |
| Diag  |                                        |       |
| Alarm |                                        |       |
+-------------------------------------------------------+
| FOOTER / ALARM LINE (h:40-60px)                       |
| Active alarm ticker | System status | Page indicators |
+-------------------------------------------------------+
```

### 7.2 Screen Template (ScreenTemplate)

Templates define persistent elements (header, footer, navigation) shared across screens:

```xml
<Hmi.Screen.ScreenTemplate ID="0" CompositionName="ScreenTemplates">
  <AttributeList>
    <Name>GENERAL_BG</Name>
    <Width>1920</Width>
    <Height>1080</Height>
  </AttributeList>
  <ObjectList>
    <!-- Persistent header, footer, navigation buttons -->
  </ObjectList>
</Hmi.Screen.ScreenTemplate>
```

Screens reference the template:
```xml
<Hmi.Screen.Screen>
  <AttributeList>
    <Template>GENERAL_BG</Template>
    <!-- Screen-specific content -->
  </AttributeList>
</Hmi.Screen.Screen>
```

### 7.3 Common Template Categories

| Category | Purpose | Typical Contents |
|----------|---------|-----------------|
| Overview | Plant/area overview | Process mimic, key KPIs, navigation to detail screens |
| Detail | Equipment/area detail | Individual equipment control, parameters, status |
| Faceplate | Reusable equipment popup | Motor/valve/drive control popup with standard interface |
| Alarm | Alarm display | AlarmView control, filters, acknowledge buttons |
| Trend | Historical data | TrendView with multiple curves, time range controls |
| Diagnostic | System diagnostics | PLC status, communication health, CPU load |
| Navigation | Main menu | Grid of navigation buttons to all areas |
| Login | User authentication | Login dialog with authorization levels |

### 7.4 Faceplate Design Pattern

Faceplates are reusable compound objects. They are defined as library types and instantiated on screens.

Structure:
- **FaceplateContainer** — defines the template (width, height, interface properties)
- **FaceplateInstance** — placed on a screen, bound to specific tags
- **Interface properties** — exposed parameters that screen-level bindings connect to

Typical motor faceplate interface:
| Interface Property | Direction | Type | Description |
|-------------------|-----------|------|-------------|
| TagPrefix | In | String | Base tag path for the motor |
| Running | In | Bool | Motor running feedback |
| Fault | In | Bool | Motor fault status |
| StartCmd | Out | Bool | Start command |
| StopCmd | Out | Bool | Stop command |
| Speed | In | Real | Current speed |
| SpeedSetpoint | InOut | Real | Speed setpoint |

### 7.5 HMI Template Library (LTemplateKMT) Patterns

The Siemens HMI Template Library provides ready-made faceplates and screen templates:

| Template | Description |
|----------|-------------|
| Motor faceplate | Standard motor control with run/stop/fault/speed |
| Valve faceplate | Open/close valve with position feedback |
| Analog value faceplate | Sensor display with limits and unit |
| PID controller faceplate | PID loop with setpoint/actual/output |
| Drive faceplate | VFD control with speed/torque/status |
| Alarm banner | Scrolling alarm text bar |
| Navigation header | Standard navigation with breadcrumb |
| Login dialog | User authentication popup |
| Trend popup | Quick trend view for any tag |
| Parameter table | Editable parameter list |

### 7.6 Color Standards (ISA-101 / High-Performance)

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| Background | Dark gray/navy | #0f172a | Screen background |
| Panels | Slate | #1e293b | Content panels |
| Borders | Gray | #334155 | Subtle separators |
| Normal text | Light gray | #e2e8f0 | Primary labels |
| Secondary text | Medium gray | #94a3b8 | Secondary info |
| Active/Running | Green | #22c55e | Running equipment |
| Stopped/Off | Gray | #6b7280 | Idle equipment |
| Alarm/Fault | Red | #ef4444 | Fault conditions |
| Warning | Amber | #f59e0b | Warning conditions |
| Setpoint/Input | Cyan | #22d3ee | Editable values |
| Process value | White | #ffffff | Key measurements |

---

## 8. Naming Conventions

### 8.1 Screen Names

| Pattern | Example | Usage |
|---------|---------|-------|
| AREA_OVERVIEW | `CONV_OVERVIEW` | Area overview screens |
| AREA_DETAIL_N | `CONV_DETAIL_1` | Detail screens |
| AREA_DIAG | `CONV_DIAG` | Diagnostic screens |
| FAULTS | `FAULTS` | Global fault display |
| MAIN | `MAIN` | Main/home screen |
| LOGIN | `LOGIN` | Login screen |
| SETTINGS | `SETTINGS` | Settings/config |

### 8.2 Object Names

| Object Type | Prefix | Example |
|-------------|--------|---------|
| Rectangle | `Rect_` | `Rect_Header`, `Rect_Panel_1` |
| Button | `Btn_` | `Btn_Start`, `Btn_Nav_Main` |
| TextField | `Lbl_` | `Lbl_Title`, `Lbl_Speed` |
| IOField | `IO_` | `IO_Speed_SP`, `IO_Temp_PV` |
| GraphicView | `Gfx_` | `Gfx_Motor_1`, `Gfx_Logo` |
| GraphicIOField | `GfxIO_` | `GfxIO_Valve_State` |
| SymbolicIOField | `SymIO_` | `SymIO_Mode_Display` |
| Bar | `Bar_` | `Bar_Level`, `Bar_Pressure` |
| Gauge | `Gauge_` | `Gauge_Speed`, `Gauge_Temp` |
| TrendView | `Trend_` | `Trend_Process_Data` |
| AlarmView | `Alarm_` | `Alarm_Active` |
| Line | `Line_` | `Line_Separator` |
| Group | `Grp_` | `Grp_Motor_Panel` |
| ScreenWindow | `Win_` | `Win_Faceplate_Motor1` |

### 8.3 HMI Tag Names

| Pattern | Example | Description |
|---------|---------|-------------|
| `Area_Equipment_Signal` | `Conv1_Motor1_Running` | Standard signal tag |
| `Area_Equipment_SP` | `Conv1_Motor1_Speed_SP` | Setpoint |
| `Area_Equipment_PV` | `Conv1_Motor1_Speed_PV` | Process value |
| `Area_Equipment_Cmd` | `Conv1_Motor1_StartCmd` | Command output |
| `Area_Equipment_Fault` | `Conv1_Motor1_Fault` | Fault status |
| `Sys_` prefix | `Sys_DateTime` | System-level tags |
| `Nav_` prefix | `Nav_CurrentScreen` | Navigation state |

---

## 9. Acquisition Modes and Cycles

### 9.1 Tag Acquisition Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| Cyclic continuous | Read at fixed interval, always | Real-time values (speed, temp) |
| Cyclic in use | Read at fixed interval, only when tag is on-screen | Most process values |
| On change | Read when PLC value changes | Digital states, alarms |
| On demand | Read only when explicitly requested | Rarely-used parameters |

### 9.2 Standard Acquisition Cycles

| Cycle | Use Case |
|-------|----------|
| 100 ms | Fast-changing analog values (vibration, position) |
| 250 ms | Standard analog values (speed, pressure) |
| 500 ms | Normal process values (temperature, level) |
| 1 s | Slow-changing values (recipe parameters) |
| 2 s | Status displays, configuration values |
| 5 s | Diagnostic data, counters |
| 10 s | System status, non-critical data |

---

## 10. Design Best Practices

### 10.1 ISA-101 High-Performance HMI Guidelines

1. **Gray background** — dark neutral background reduces eye strain
2. **Color by exception** — equipment is gray when normal, color only for abnormal states
3. **Analog values prominent** — key process values in large, readable font
4. **Trend sparklines** — embedded mini-trends near critical values
5. **Consistent navigation** — same header/footer on every screen, max 3 clicks to any screen
6. **Alarm integration** — persistent alarm bar at bottom of every screen
7. **Minimal decoration** — no 3D effects, gradients, or unnecessary graphics
8. **Font hierarchy** — clear size/weight hierarchy (title > section > label > value)

### 10.2 Resolution and Sizing

| Panel Type | Resolution | Aspect Ratio |
|-----------|------------|--------------|
| TP700 Comfort | 800 x 480 | 5:3 |
| TP900 Comfort | 800 x 480 | 5:3 |
| TP1200 Comfort | 1280 x 800 | 16:10 |
| TP1500 Comfort | 1280 x 800 | 16:10 |
| TP1900 Comfort | 1280 x 800 | 16:10 |
| TP2200 Comfort | 1920 x 1080 | 16:9 |
| WinCC RT Advanced (IPC) | 1920 x 1080 | 16:9 |
| WinCC RT Advanced (4K) | 3840 x 2160 | 16:9 |

### 10.3 Touch Target Sizing

| Element | Minimum Size | Recommended |
|---------|-------------|-------------|
| Button (touch) | 40 x 40 px | 60 x 50 px |
| Button gap | 6 px | 10 px |
| IOField (input) | 100 x 36 px | 150 x 40 px |
| Text (readable) | 12 pt min | 14-16 pt |
| Title text | 18 pt min | 24 pt |
| Navigation button | 60 x 50 px | 80 x 60 px |
