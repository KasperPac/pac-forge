// Builds the Segment Wagon operator manual (DOCX) to the Pac Technologies
// operator-manual standard (structure mirrors CVL-2314 Amazon Brisbane manual).
// Run from the repo root so `docx` resolves:
//   node exports/SRL-1427-500802-PACKML/docs/build-operator-manual.mjs
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer,
  PageBreak, Paragraph, Table, TableCell, TableOfContents, TableRow, TextRun,
  WidthType,
} from "docx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(here, "..", "commissioning-hmi", "docs", "screenshots");
const OUT = path.join(here, "SRL-1427-500802 SEGMENT WAGON OPERATOR MANUAL V1.docx");

// ---------- helpers ----------
let figN = 0;
const figures = [];
const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } });
const H1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } });
const H2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 140 } });
const H3 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 120 } });
const BULLET = (label, text) => new Paragraph({
  children: [new TextRun({ text: label, bold: true }), new TextRun({ text: text ? " " + text : "" })],
  bullet: { level: 0 }, spacing: { after: 80 },
});
const STATE = (text) => new Paragraph({ children: [new TextRun({ text })], bullet: { level: 1 }, spacing: { after: 60 } });
const PAGEBREAK = () => new Paragraph({ children: [new PageBreak()] });

function FIG(file, caption, w, h) {
  figN += 1;
  const cap = `Figure ${figN}. ${caption}`;
  figures.push(cap);
  const data = fs.readFileSync(path.join(SHOTS, file));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ data, type: "png", transformation: { width: w, height: h } })],
      spacing: { before: 120, after: 60 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: cap, italics: true, size: 20 })],
      spacing: { after: 200 },
    }),
  ];
}
const FIG_PANEL = (file, caption) => FIG(file, caption, 560, 336);      // 800x480 native
const FIG_DASH = (file, caption) => FIG(file, caption, 580, 320);       // 1560x860-ish

const cell = (text, opts = {}) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text, ...opts })] })],
  width: { size: 100 / (opts.cols ?? 4), type: WidthType.PERCENTAGE },
});
const row = (...cells) => new TableRow({ children: cells });

// ---------- title block ----------
const titleBlock = [
  new Paragraph({ spacing: { before: 2400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "OPERATOR MANUAL", bold: true, size: 72 })],
    spacing: { after: 480 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "SEGMENT WAGON CONTROL SYSTEM", bold: true, size: 40 })],
    spacing: { after: 2400 },
  }),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      row(cell("PROJECT NO", { bold: true }), cell("SRL-1427-500802"), cell("REV.", { bold: true }), cell("V1")),
      row(cell("CLIENT", { bold: true }), cell("HRE"), cell("DATE", { bold: true }), cell("8/07/2026")),
      row(cell("SYSTEM", { bold: true }), cell("Segment Wagon (rail carriage + segment rotator)"), cell("DRAWN", { bold: true }), cell("Pac Technologies")),
      row(cell("LOCATION", { bold: true }), cell("Segment storage tunnel"), cell("CHECKED", { bold: true }), cell("")),
    ],
  }),
  new Paragraph({ spacing: { before: 2400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "THIS PAGE IS INTENTIONALLY LEFT BLANK", size: 20, color: "888888" })],
    pageBreakBefore: true,
  }),
];

// ---------- 3. Introduction ----------
const intro = [
  PAGEBREAK(),
  H1("Introduction"),
  P("This document refers to the information displayed on the plant HMI and the web dashboard delivered by Pac Technologies, in accordance with the equipment supplied and the specifications provided by the customer and all those involved in the development of the system."),
  P("It describes the operator controls of the Segment Wagon Control System: the physical pendant and pushbuttons, the MTP700 operator panel mounted at the control cabinet, and the browser-based dashboard. The dashboard provides everything the panel provides plus additional maintenance functions (input forcing, simulated pendant, commissioning routines) and can be reached from any computer on the machine network."),
];

// ---------- 4. Brief system description ----------
const sysDesc = [
  H1("Brief system description"),
  P("The Segment Wagon is a rail-mounted carriage that transports tunnel segments along a rail inside the segment storage tunnel. The wagon carries a rotator that turns the segment about its long axis so it can be presented at the correct orientation. All motion is operator-paced from a two-detent pendant: the first detent commands jog speed, the second detent commands fast speed. The control system enforces the speed rules from the functional design specification: fast speed is only available while the segment is straight (0° or 180°) and the wagon is clear of the 2 m ramp-down zones at either end of the rail."),
  P("The system is controlled by a Siemens S7-1200 G2 PLC. The carriage is driven by a group of four motors on a single variable speed drive (VSD1) and the rotator by a fifth motor on its own drive (VSD2); both drives are SINAMICS G120 units controlled over PROFINET. Both axes carry spring-applied brakes released by the drives, and both axes have absolute encoders that measure the rail position and segment angle. A hardwired safety circuit (emergency stops and safety relay with Safe Torque Off) removes power from the drives independently of the PLC."),
];

// ---------- 5. General distribution ----------
const distribution = [
  H1("General distribution of the system"),
  P("The system is composed of the following equipment groups (equipment modules):"),
  BULLET("Carriage Drive.", "Four 24 V-controlled motor starters replaced during design by a single VSD group: four motors driven together by VSD1 (rail_motors). Moves the wagon forward (deeper into the tunnel) and reverse (toward the tunnel entrance). Overload and thermistor protection per motor is monitored by the PLC."),
  BULLET("Carriage Brake.", "Spring-applied brake on the carriage axis. The brake is controlled by VSD1 and monitored by the PLC (brake-open feedback and contactor fault)."),
  BULLET("Carriage Limits.", "Longitudinal end-of-travel limit switch. Motion toward a tripped limit is refused; motion away remains available."),
  BULLET("Carriage Pendant.", "The four carriage motion buttons on the operator pendant (forward, forward fast, reverse, reverse fast)."),
  BULLET("Rotator Drive.", "Rotator motor on VSD2 (horizontal_drive). Turns the segment left/right; the segment angle is measured by the rotator encoder."),
  BULLET("Rotator Brake.", "Spring-applied brake on the rotator axis, controlled by VSD2 and monitored by the PLC."),
  BULLET("Rotator Pendant.", "The four rotate buttons on the operator pendant (left, left fast, right, right fast)."),
  BULLET("Travel Indicators.", "Horn and strobe. The strobe runs while the carriage travels. The horn sounds while the reset pushbutton is held and, when the pre-travel horn option is enabled, for 2 seconds before carriage motion is permitted."),
  BULLET("E-Stop Circuit.", "Hardwired emergency-stop chain, safety relay (SR1) and earth circuit breaker monitoring. Safe Torque Off to both drives is hardwired; the PLC monitors the chain and sequences the reset."),
  BULLET("Encoders.", "Rail encoder (multiturn, on a measuring wheel; preset to 0 at the tunnel entrance) and rotator encoder (on the rotator gearbox; preset to 0 with the segment straight)."),
];

// ---------- 6. Control system: pushbuttons ----------
const pushbuttons = [
  PAGEBREAK(),
  H1("Control system — pendant and pushbuttons"),
  P("All motion is hold-to-run from the pendant. Releasing a button stops the motion (the drive ramps to standstill and the brake re-applies). The pendant buttons are two-detent: pressing to the first detent commands jog speed, pressing through to the second detent commands fast speed. If fast speed is not permitted (segment not straight, or inside a ramp zone) the second detent automatically falls back to jog speed — the wagon keeps moving, just slower."),
  BULLET("Forward / Forward Fast.", "Drives the wagon deeper into the tunnel. Refused inside the forward end margin; fast limited as described above."),
  BULLET("Reverse / Reverse Fast.", "Drives the wagon toward the tunnel entrance. Refused inside the entrance end margin; fast limited as described above."),
  BULLET("Rotate Left / Right (+ fast detents).", "Turns the segment. Left and right run opposite directions; there are no position limits on rotation."),
  BULLET("Reset pushbutton.", "Three functions: resets the safety relay after the emergency-stop chain is restored; acknowledges drive faults on both VSDs; and sounds the horn while held (audible feedback that a reset is being commanded)."),
  BULLET("Emergency stops.", "Any emergency stop drops the hardwired safety chain: both drives are stopped via Safe Torque Off and all motion commands are removed. See section “Alarm handling and recovery”."),
  H2("Machine states"),
  P("Each equipment group runs a PackML state machine. In normal operation the coordinators walk every group to the Execute state automatically whenever the safety chain is healthy (the machine “arms” itself); no start button is required. The states the operator will commonly see:"),
  STATE("Execute — armed; pendant motion available (drives only move while a button is held)."),
  STATE("Stopped / Idle — healthy but not armed (e.g. maintenance mode active)."),
  STATE("Aborted — the group tripped on a fault or safety event and is waiting for the condition to clear."),
  STATE("Clearing / Resetting / Starting — transient states while the machine re-arms."),
  H2("Operating modes"),
  BULLET("Production (normal).", "The machine auto-arms and the pendant drives the wagon. All protections active."),
  BULLET("Maintenance mode.", "Selected from the panel or dashboard. Both drives are commanded to Stopped. Encoder presets, output overrides and input forcing become available. Leaving maintenance mode clears all forces and re-arms the machine."),
  BULLET("Sequence-test mode.", "Engineering mode used from the dashboard Testing page only. The coordinators release their automatic commands so each equipment group can be stepped through its states manually."),
];

// ---------- 7. Panel HMI ----------
const hmi = [
  PAGEBREAK(),
  H1("Operator panel (MTP700)"),
  P("The MTP700 Unified panel at the control cabinet is the primary operator interface. The same screens can be opened from a browser: navigate to https://192.168.0.9 (accept the certificate warning), choose “WinCC Unified RT” and sign in with your operator user."),
  H2("HMI navigation"),
  P("Every screen carries the same navigation row along the bottom: OVERVIEW, DRIVES, STATUS, MOTORS, I/O, PERM CAR and PERM ROT, plus the GLOBAL RESET bar. The sidebar on the right has three buttons: home (Overview), alarms and settings."),
  H2("HMI Overview screen"),
  ...FIG_PANEL("panel-01-overview.png", "HMI Overview screen."),
  P("The Overview screen is composed of:"),
  BULLET("CARRIAGE panel.", "The carriage state number, live rail position (mm), configured rail length (mm) and the current speed reference (%)."),
  BULLET("ROTATOR panel.", "The rotator state number, segment angle (degrees), speed reference (%), the straight lamp (green when the segment is at 0°/180° and fast speed is available) and the Straighten up switch."),
  BULLET("Straighten up.", "One-shot function: the rotator turns back to 0° the shortest way and stops. Cancelled automatically by any pendant rotate button, by a safety event, or when the segment is straight."),
  BULLET("Safety status row.", "E-STOP, SAFETY RELAY and SEGMENT STRAIGHT lamps (green = healthy/true)."),
  BULLET("GLOBAL RESET.", "Hold, then release. Issues a reset to all equipment groups (equivalent to pressing the pendant reset)."),
  H2("HMI Drives screen"),
  ...FIG_PANEL("panel-02-drives.png", "HMI Drives screen."),
  P("The Drives screen is composed of:"),
  BULLET("CARRIAGE (VSD1) / ROTATOR (VSD2) panels.", "Command (%) and actual speed (rpm), enabled / fault / lockout lamps and the drive diagnostic code for each drive."),
  BULLET("TRAVEL panel.", "Rail position and length, remaining distance to the forward end and to the entrance, the ramp-zone lamp and the Fwd/Rev FAST ok lamps (green when fast speed is currently permitted in that direction)."),
  H2("HMI Status screen"),
  ...FIG_PANEL("panel-03-status.png", "HMI Status screen."),
  P("Shows the PackML state of every equipment group. In normal operation all drive-related groups show Execute. A group stuck in Aborted points at the device with the active fault — check the Alarms screen."),
  H2("HMI Motors screen"),
  ...FIG_PANEL("panel-04-motors.png", "HMI Motors screen."),
  P("The Motors screen is composed of:"),
  BULLET("CARRIAGE MOTORS panel.", "Run, overload-fault and thermistor status per carriage motor, plus the VSD1 circuit-breaker, braking-resistor and brake-open lamps."),
  BULLET("PENDANT BUTTONS panel.", "A live lamp per pendant button — useful to verify the pendant wiring and to see what the PLC receives while a button is held."),
  H2("HMI I/O screen"),
  ...FIG_PANEL("panel-05-io.png", "HMI I/O screen."),
  P("Raw digital input states as seen by the PLC. Note that fail-safe (normally-closed) inputs read 1 when healthy — thermistors, circuit-breaker and braking-resistor inputs, the safety chain and the earth circuit breaker all fall in this class."),
  H2("HMI Permissive screens"),
  ...FIG_PANEL("panel-06-perm-carriage.png", "HMI carriage permissives screen."),
  ...FIG_PANEL("panel-07-perm-rotator.png", "HMI rotator permissives screen."),
  P("The permissive screens answer “why won’t it move?”. Each motion (forward jog, forward fast, reverse jog, reverse fast; rotate left/right) lists its gate conditions with a lamp per condition: green = satisfied, red = currently blocking that motion. All lamps green means the motion will run as soon as its pendant button is held. A red “fast” condition with green jog conditions means the fast detent will fall back to jog."),
  H2("HMI Settings screen"),
  ...FIG_PANEL("panel-08-settings.png", "HMI Settings screen (gear button in the sidebar)."),
  P("The Settings screen is composed of:"),
  BULLET("SPEEDS panel.", "Jog and fast speed setpoints for carriage and rotator, entered as % of the drive reference speed (1500 rpm). Sign convention: forward/right positive, reverse/left negative. Straighten % sets the speed of the straighten-up function."),
  BULLET("Pre-travel horn switch.", "When enabled, the horn sounds for 2 seconds before carriage motion is permitted after a travel request."),
  BULLET("RAIL — END OF TRAVEL panel.", "The configured rail length, the +1 SECTION (1.7 m) button (press once each time a rail section is added), the ramp-zone and end-margin distances and the live position. These values drive the speed limiting and end protection."),
  H2("HMI Alarms screen"),
  ...FIG_PANEL("panel-09-alarms.png", "HMI Alarms screen (triangle button in the sidebar)."),
  P("Active and unacknowledged alarms with time stamps. Motor, drive, brake and braking-resistor faults are class Fault (red, acknowledgement required); the end-of-travel warning does not require acknowledgement. Select an alarm and use the acknowledge button on the control bar; the pendant reset also acknowledges drive faults."),
];

// ---------- 8. Dashboard ----------
const dash = [
  PAGEBREAK(),
  H1("Web dashboard"),
  P("The dashboard is a browser application that mirrors the panel and adds maintenance and commissioning functions: input forcing, a simulated pendant, per-condition permissive views, drive diagnostics and guided test routines. It reads and writes the PLC through the PLC web server."),
  H2("Accessing the dashboard"),
  P("The dashboard is hosted on the PLC web server. From any computer on the machine network:"),
  BULLET("1.", "Open a browser and navigate to https://192.168.0.10/~dashboard/ (the PLC address). Accept the certificate warning the first time on each computer."),
  BULLET("2.", "Sign in with the web user configured for the machine (ask your administrator). The user needs read/write process-data rights."),
  BULLET("3.", "The dashboard opens on the Overview page. The header shows PLC ONLINE when connected and the current operating mode at all times."),
  P("If the dashboard is instead being run from a service laptop (commissioning arrangement), it is started with “node server.mjs 192.168.0.10 <user> <password>” from the commissioning-hmi folder and reached at http://localhost:8080."),
  H2("Dashboard Overview page"),
  ...FIG_DASH("01-overview.png", "Dashboard Overview page."),
  P("The Overview page is composed of:"),
  BULLET("Status tiles.", "Mode, safety chain, machine armed, active alarm count, active force count and simulated-pendant state. Tiles are grey when normal; red indicates a fault condition, amber not-armed, blue an active manual intervention (maintenance mode, forces, simulated pendant)."),
  BULLET("Rotator mimic.", "The disc turns live with the segment. Marks at 0° and 180° show the straight windows; the readout shows the angle and STRAIGHT flag."),
  BULLET("Rail mimic.", "The carriage moves along the rail live. The tunnel entrance (0 m) is at the right; the shaded bands at each end are the ramp-down zones (amber) and end margins (red). Distance readouts to each end sit below."),
  BULLET("Drive tiles and equipment chips.", "Compact drive status (setpoint, actual, state, fault) and the PackML state of every equipment group."),
  BULLET("FORCES ACTIVE banner.", "Whenever any input force is active, a blue banner listing the forced inputs appears at the top of every page."),
  H2("Dashboard Pendant page (simulated pendant)"),
  ...FIG_DASH("02-pendant.png", "Dashboard Pendant page."),
  P("The Pendant page drives the machine from the browser exactly as the physical pendant does — all interlocks, speed limits and the pre-travel horn apply identically. It must be armed first with the ARM SIMULATED PENDANT button."),
  BULLET("Hold-to-run.", "Buttons act only while held (mouse or touch). Releasing the button, switching tabs, closing the browser or losing the network all stop motion within 1.5 seconds — the PLC runs a dead-man watchdog on the dashboard connection."),
  BULLET("Safety chain is never simulated.", "The emergency-stop chain and safety relay cannot be operated or bypassed from the dashboard by design."),
  BULLET("RESET button.", "Identical to the physical reset pushbutton (safety reset, drive fault acknowledge, horn)."),
  H2("Dashboard IO page (with input forcing)"),
  ...FIG_DASH("03-io-inputs.png", "Dashboard IO page — digital inputs with force controls."),
  ...FIG_DASH("04-io-outputs.png", "Dashboard IO page — digital outputs with maintenance overrides."),
  P("The IO page lists every input and output with a live lamp (green = signal on). In maintenance mode two extra capabilities appear:"),
  BULLET("Input forcing.", "Each non-safety input has LIVE / F=0 / F=1 selectors. F=0/F=1 forces the input as seen by the control logic — used to test fault reactions and interlocks without touching field wiring. Forced rows highlight blue with an F badge, the forces are listed in the banner on every page, and ALL forces clear automatically when maintenance mode is switched off. The safety-chain inputs cannot be forced."),
  BULLET("Output overrides.", "Each output has an override toggle that drives the physical output directly (wire checking). Overrides act only while maintenance mode is active."),
  H2("Dashboard Permissives page"),
  ...FIG_DASH("05-permissives.png", "Dashboard Permissives page."),
  P("One card per machine action (machine arm, each carriage motion, rotation, straighten-up). Every gate condition is shown as a live lamp with the first blocking condition highlighted in red — the fastest way to answer “why won’t it move?”. The REQUESTED chip on a card shows the operator is currently commanding that action."),
  H2("Dashboard VFD page"),
  ...FIG_DASH("06-vfd.png", "Dashboard VFD page."),
  P("Full drive diagnostics for both VSDs: command and actual speed, enable/lockout state, the decoded ZSW1 status word (bit by bit), the drive function-block status and diagnostic code, and the speed setpoint entries. The reference card lists the drive-side settings that are configured in the drives themselves (reference speed 1500 rpm, scaling, control mode)."),
  H2("Dashboard Settings page"),
  ...FIG_DASH("07-settings.png", "Dashboard Settings page."),
  P("The Settings page is composed of:"),
  BULLET("Modes.", "Maintenance mode and sequence-test mode switches."),
  BULLET("Rail envelope.", "Rail length with the +1 SECTION (1.7 m) button, encoder scale, ramp-zone and end-margin distances."),
  BULLET("Encoder presets.", "Rail preset (wagon at the tunnel-entrance reference, maintenance mode) and rotator preset with the gear calibration (counts per 360°, with a CAPTURE helper)."),
  BULLET("Speed setpoints.", "The same jog/fast setpoints as the panel Settings screen."),
  BULLET("Travel indicators.", "The pre-travel horn enable."),
  H2("Dashboard Alarms page"),
  ...FIG_DASH("08-alarms.png", "Dashboard Alarms page."),
  P("The same alarm list as the panel (red Fault / amber Warning) plus a session history of raise/clear events with time stamps — useful to see a fault that appeared and cleared while nobody was watching."),
  H2("Dashboard Testing page"),
  ...FIG_DASH("09-testing.png", "Dashboard Testing page."),
  P("Guided commissioning routines (power-up, pendant checks, drive checks, encoders, speed limiting, fault walk, safety) where each step ticks automatically when the PLC observes the condition, plus per-equipment-group sequence tests used in sequence-test mode. This page is used at commissioning and after maintenance work; it is not needed for normal operation."),
];

// ---------- 9. Operating procedures ----------
const procedures = [
  PAGEBREAK(),
  H1("Operating procedures"),
  H2("Power-up and arming"),
  BULLET("1.", "Close the main isolator and let the PLC and drives boot (about 30 seconds)."),
  BULLET("2.", "Ensure all emergency stops are released, then press and hold the reset pushbutton until the safety relay closes (the horn sounds while the button is held)."),
  BULLET("3.", "The machine arms itself: the equipment groups walk to Execute automatically. The Overview shows MACHINE ARMED (dashboard) / state 6 (panel)."),
  BULLET("4.", "If the machine does not arm, open the Permissives page — the blocking condition is highlighted."),
  H2("Driving the wagon"),
  BULLET("1.", "Check the speed setpoints are entered (Settings). The drives will not move with a 0 % setpoint."),
  BULLET("2.", "Hold a pendant motion button. First detent = jog; second detent = fast. If the pre-travel horn is enabled, the horn sounds for 2 seconds before the wagon moves."),
  BULLET("3.", "Fast speed requires the segment straight (0°/180°) and the wagon clear of the 2 m ramp zones; otherwise the fast detent runs at jog speed."),
  BULLET("4.", "Motion into an end margin or against the travel limit is refused. Motion in the opposite direction remains available."),
  H2("Rotating and straightening the segment"),
  BULLET("1.", "Hold a rotate button (jog or fast detent). Release to stop."),
  BULLET("2.", "To return the segment to straight automatically, use the Straighten up switch on the Overview screen. The rotator turns back to 0° the shortest way and stops. Any pendant rotate button cancels it."),
  H2("Adding a rail section"),
  BULLET("1.", "After a new 1.7 m rail section is installed, press +1 SECTION on the Settings screen (panel or dashboard). This extends the configured rail length so the end protection and ramp zones follow the new end of travel."),
  H2("Encoder presets (maintenance)"),
  BULLET("Rail.", "Drive the wagon to the tunnel-entrance reference mark, enable maintenance mode, enter 0 and press PRESET on the rail encoder. Done shows true when the preset is accepted."),
  BULLET("Rotator.", "With the segment physically straight, preset 500000. For first-time gear calibration: preset 500000 at straight, rotate exactly one full turn, press CAPTURE and SET (counts per 360°)."),
  H2("Alarm handling and recovery"),
  BULLET("1.", "Open the Alarms page/screen and read the active alarms. The alarm text names the device."),
  BULLET("2.", "Remove the cause (reset the tripped device, close the breaker, let the motor cool)."),
  BULLET("3.", "Press the reset pushbutton (or GLOBAL RESET / dashboard RESET). Drive faults acknowledge on the same button."),
  BULLET("4.", "The affected equipment groups clear and re-arm automatically once the condition is gone."),
  H2("Emergency-stop recovery"),
  BULLET("1.", "Release the emergency stop that was struck."),
  BULLET("2.", "Press and hold the reset pushbutton until the safety relay closes."),
  BULLET("3.", "The machine re-arms automatically; confirm MACHINE ARMED before resuming operation."),
  H2("Maintenance mode"),
  BULLET("1.", "Enable maintenance mode (Settings). Both drives are commanded to Stopped; no pendant motion is possible."),
  BULLET("2.", "Output overrides, input forcing and encoder presets are now available (IO/Settings pages)."),
  BULLET("3.", "Disable maintenance mode when finished. All input forces clear automatically and the machine re-arms."),
];

// ---------- 10/11 references + glossary ----------
const refs = [
  PAGEBREAK(),
  H1("References"),
  BULLET("Functional Design Specification.", "SRL-1427-500802 Segment Wagon Control System (Pac Technologies)."),
  BULLET("Drive documentation.", "Siemens SINAMICS G120 / CU250S-2 operating instructions."),
  BULLET("Panel documentation.", "Siemens SIMATIC HMI MTP700 Unified Basic operating instructions."),
  BULLET("PLC.", "Siemens S7-1200 G2 system manual."),
  H1("Glossary"),
  BULLET("Jog / Fast.", "The two pendant speed levels (first / second detent)."),
  BULLET("Ramp zone.", "The 2 m band before each end of travel where fast speed is automatically limited to jog."),
  BULLET("End margin.", "The final band at each end of travel where motion toward the end is refused."),
  BULLET("Straight window.", "Segment angle within ±2° of 0° or 180°; required for fast travel."),
  BULLET("Arm / Armed.", "The equipment groups have reached the Execute state and pendant motion is available."),
  BULLET("PackML states.", "The standard machine states used by each equipment group (Aborted, Clearing, Stopped, Resetting, Idle, Execute, Stopping, Holding…)."),
  BULLET("VSD.", "Variable speed drive (SINAMICS G120)."),
  BULLET("STO.", "Safe Torque Off — the hardwired drive safety function operated by the safety relay."),
  BULLET("N/C (fail-safe) input.", "An input wired so the healthy state reads 1; a broken wire reads as a fault."),
  BULLET("Force.", "A maintenance-mode override of an input as seen by the control logic (dashboard IO page)."),
  BULLET("Simulated pendant.", "The dashboard's hold-to-run motion buttons; equivalent to the physical pendant with all protections applied."),
  BULLET("Dead-man watchdog.", "The PLC-side supervision that drops all simulated-pendant commands within 1.5 s if the dashboard stops responding."),
];

// ---------- assemble ----------
const summary = [
  PAGEBREAK(),
  H1("Summary"),
  new TableOfContents("Summary", { hyperlink: true, headingStyleRange: "1-2" }),
  P("(In Word: right-click the table and choose Update Field to fill in page numbers.)", { italics: true, size: 18 }),
];

const doc = new Document({
  creator: "Pac Technologies",
  title: "SRL-1427-500802 Segment Wagon Operator Manual",
  description: "Operator manual for the HRE Segment Wagon Control System",
  features: { updateFields: true },
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
      heading1: { run: { size: 32, bold: true, color: "1F3864" } },
      heading2: { run: { size: 26, bold: true, color: "2E5496" } },
      heading3: { run: { size: 24, bold: true } },
    },
  },
  sections: [{
    properties: {},
    children: [
      ...titleBlock,
      ...summary,
      ...intro,
      ...sysDesc,
      ...distribution,
      ...pushbuttons,
      ...hmi,
      ...dash,
      ...procedures,
      ...refs,
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log("written:", OUT, Math.round(buf.length / 1024), "KB,", figN, "figures");
