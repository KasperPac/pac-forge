/**
 * FDS Builder Manual Generator
 * Run: node generate-fds-manual.mjs
 * Output: FDS-Builder-Manual.docx (in project root)
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, NumberFormat, convertInchesToTwip,
  PageBreak, ExternalHyperlink, UnderlineType,
} from "docx";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const SS = "C:/Users/kaspe/Documents/VSCode Apps/.playwright-mcp";

function img(filename, widthPx = 1200, caption) {
  const p = `${SS}/${filename}`;
  if (!existsSync(p)) return null;
  const data = readFileSync(p);
  const paras = [
    new Paragraph({
      children: [
        new ImageRun({
          data,
          transformation: { width: 600, height: Math.round(600 * 768 / widthPx) },
          type: "png",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 60 },
    }),
  ];
  if (caption) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: caption, italics: true, size: 18, color: "666666" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }));
  }
  return paras;
}

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160 },
  });
}

function h2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
  });
}

function h3(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, ...opts })],
    spacing: { after: 100 },
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level },
    spacing: { after: 60 },
  });
}

function note(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: "NOTE  ", bold: true, size: 20, color: "1D6FA5" }),
      new TextRun({ text, size: 20, color: "444444" }),
    ],
    spacing: { before: 80, after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
    border: { left: { style: BorderStyle.SINGLE, size: 4, color: "1D6FA5", space: 8 } },
  });
}

function tip(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: "TIP  ", bold: true, size: 20, color: "1A7A4A" }),
      new TextRun({ text, size: 20, color: "444444" }),
    ],
    spacing: { before: 80, after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
    border: { left: { style: BorderStyle.SINGLE, size: 4, color: "1A7A4A", space: 8 } },
  });
}

function csvTable() {
  const header = ["Tag", "Description", "Device Type", "Signal Type", "IO Address", "Subsystem"];
  const rows = [
    ["IC_CV01_M01_CMD", "Entry Belt Motor Run Command", "Motor Contactor", "DO", "Q0.0", "IC"],
    ["IC_CV01_M01_RUN", "Entry Belt Motor Run Feedback", "Motor Feedback", "DI", "I0.0", "IC"],
    ["IC_CV01_M01_OL", "Entry Belt Motor Overload", "Overload Relay", "DI", "I0.1", "IC"],
    ["IC_CV01_PE01", "Entry Belt Infeed Photoelectric", "Photoelectric Sensor", "DI", "I0.2", "IC"],
    ["IC_ES01", "Inbound Zone Emergency Stop", "Emergency Stop", "DI", "I1.5", "IC"],
    ["OC_CV01_M01_CMD", "Dispatch Belt Motor Run Command", "Motor Contactor", "DO", "Q1.0", "OC"],
  ];

  const makeCell = (text, isHeader = false) => new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: isHeader, size: 18 })],
    })],
    shading: isHeader ? { fill: "2C3E50", type: ShadingType.CLEAR, color: "FFFFFF" } : undefined,
  });

  return new Table({
    rows: [
      new TableRow({ children: header.map(h => makeCell(h, true)), tableHeader: true }),
      ...rows.map(row => new TableRow({ children: row.map(c => makeCell(c)) })),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ─── Collect all children ───────────────────────────────────────────────────

const children = [];

// ── Cover / Title ──────────────────────────────────────────────────────────
children.push(
  new Paragraph({
    children: [new TextRun({ text: "PAC FORGE", bold: true, size: 48, color: "1D6FA5" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "FDS Builder", bold: true, size: 64, color: "1A1A2E" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "User Manual", size: 36, color: "555555" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Version 1.0  ·  April 2026", size: 24, color: "888888" })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 800 },
  }),
);

// Add cover screenshot
const coverImg = img("page-2026-04-15T10-14-37-089Z.png", 1512, "FDS Builder — complete workflow view");
if (coverImg) children.push(...coverImg);

children.push(pageBreak());

// ── 1. Introduction ─────────────────────────────────────────────────────────
children.push(
  h1("1. Introduction"),
  p("The FDS Builder is the specification authoring module of PAC Forge. It guides engineers through the creation of a complete Functional Design Specification (FDS) — the industry-standard document that defines how an automated machine behaves in every operating state."),
  p("The FDS Builder follows the PAC-EFD standard, producing a 9-section structured specification that feeds directly into the PAC Forge code generation pipeline (Forge Wizard) for SCL PLC code output."),

  h2("1.1 What is an FDS?"),
  p("A Functional Design Specification captures:"),
  bullet("The machine hierarchy — subsystems, assemblies, and devices"),
  bullet("Operating states (Idle, Starting, Execute, Completing, E-Stop, etc.)"),
  bullet("Per-assembly behaviour in each state — static output tables and sequential step sequences"),
  bullet("Permissives, interlocks, fault responses, and timeouts"),
  bullet("Alarm tiers and cross-subsystem coordination"),

  h2("1.2 Workflow Overview"),
  p("The FDS Builder consists of six sequential phases. Each phase unlocks the next:"),
  bullet("Phase 1  — Upload Instrument Register (IO list CSV/Excel)"),
  bullet("Phase 2  — Spec Skeleton Wizard (machine hierarchy + operating states)"),
  bullet("Phase 3  — FDS Authoring / Co-Author (AI-assisted assembly behaviour)"),
  bullet("Phase 4  — System Orchestration (cross-subsystem startup order)"),
  bullet("Phase 5  — Structured Spec Editor (review and approve sections)"),
  bullet("Phase 6  — DOCX Export (render to Word document)"),

  note("Phases 1–4 must be completed in order. Phase 5 becomes available after clicking 'Generate Spec Sections' at the end of Phase 4."),
);

children.push(pageBreak());

// ── 2. Phase 1 — Instrument Register ───────────────────────────────────────
children.push(
  h1("2. Phase 1 — Instrument Register"),
  p("The Instrument Register is the foundation of the FDS. Uploading it extracts all IO tags, automatically classifies devices, and seeds the machine hierarchy for Phase 2."),

  h2("2.1 Supported File Formats"),
  bullet("CSV (.csv)"),
  bullet("Excel (.xlsx, .xls)"),
  p("The parser scans the first 10 rows for headers and auto-detects column positions — the columns do not need to be in a specific order."),

  h2("2.2 Required CSV Format"),
  p("At minimum, the file must have a Tag column and at least one other recognised column. The following is the recommended structure:"),
);

children.push(
  new Paragraph({ spacing: { before: 120, after: 120 } }),
  csvTable(),
  new Paragraph({ spacing: { after: 120 } }),
);

children.push(
  h3("Column Descriptions"),
  bullet("Tag — The PLC tag name (e.g. IC_CV01_M01_CMD). Required."),
  bullet("Description — Human-readable description of the signal."),
  bullet("Device Type — Descriptive device type (e.g. 'Motor Contactor', 'Photoelectric Sensor')."),
  bullet("Signal Type — IO direction: DI, DO, AI, AO."),
  bullet("IO Address — PLC IO address (e.g. Q0.0, I1.2, IW64)."),
  bullet("Subsystem — Subsystem group identifier (e.g. IC, OC). Tags with the same value are grouped under one subsystem."),

  note("Tag naming convention IC_CV01_M01_CMD encodes: Subsystem (IC) → Assembly (CV01) → Device (M01) → Signal (CMD). The parser uses this pattern to auto-build the machine hierarchy."),

  h2("2.3 Device Classification"),
  p("The parser classifies each tag deterministically from the Device Type column, then falls back to tag name patterns. Recognised device classes:"),
  bullet("motor — Motor contactors, VFDs, overload relays, run feedback"),
  bullet("sensor_position — Photoelectric sensors, proximity switches, limit switches, encoders"),
  bullet("emergency_stop — E-stop buttons (is_safety = true)"),
  bullet("valve — Solenoids, valves"),
  bullet("sensor_temperature / sensor_pressure / sensor_level / sensor_flow / sensor_weight"),
  bullet("push_button, indicator, transmitter, conveyor, hopper, filter"),
  bullet("other — Unrecognised devices (generates a warning)"),

  tip("Use exact device type names for best results: 'Motor Contactor', 'Overload Relay', 'Photoelectric Sensor', 'Emergency Stop'. The classifier is case-insensitive."),

  h2("2.4 Uploading the Register"),
);

const regUpload = img("page-2026-04-15T08-35-09-686Z.png", 1512, "Parsed instrument register showing 30 tags, 2 subsystems and 9 warnings");
if (regUpload) children.push(...regUpload);

children.push(
  p("After upload, the register section shows:"),
  bullet("Tag count and subsystem count"),
  bullet("Token usage (AI classification cost)"),
  bullet("Parse Warnings — tags that could not be classified are flagged as warnings"),
  bullet("Parsed Tags table — full list with class, signal direction, description, and safety flag"),

  h2("2.5 Collapse / Expand"),
  p("Once uploaded, the register section automatically collapses to a compact summary showing the tag count. Click the tag count button to expand it again. This keeps the page clean while working through later phases."),

  tip("To re-upload a corrected register, expand the section and use the Re-upload button."),
);

children.push(pageBreak());

// ── 3. Phase 2 — Spec Skeleton Wizard ──────────────────────────────────────
children.push(
  h1("3. Phase 2 — Spec Skeleton Wizard"),
  p("The Skeleton Wizard builds the spec's structure: document metadata, control system, machine hierarchy, operating states, and alarm tiers. It has six steps."),

  h2("Step 1 — Document Metadata"),
  bullet("Document Code — Auto-generated from project number (e.g. PAC-2617-500801). Editable."),
  bullet("Title — Descriptive name for the specification."),
  bullet("Client Name, Project Number — Pre-filled from the project."),
  bullet("Date — Defaults to today."),
  bullet("Issued By / Verified By / Approved By — Free-text approver names."),

  h2("Step 2 — Control System"),
);

const ctrlImg = img("page-2026-04-15T08-36-43-073Z.png", 1512, "Step 2: Control System configuration");
if (ctrlImg) children.push(...ctrlImg);

children.push(
  bullet("PLC Model — Free text (e.g. 'Siemens S7-1500 CPU 1515F'). Required."),
  bullet("HMI Type — Dropdown: WinCC Unified, WinCC Comfort, None, Other."),
  bullet("Communications Protocol — Dropdown: OPC UA, PROFINET, Ethernet/IP, None."),

  h2("Step 3 — Machine Hierarchy"),
);

const hierarchyImg = img("page-2026-04-15T08-39-07-190Z.png", 1512, "Step 3: Machine Hierarchy auto-built from instrument register tags");
if (hierarchyImg) children.push(...hierarchyImg);

children.push(
  p("The hierarchy is automatically built from the instrument register using tag naming conventions. Each subsystem contains assemblies, which contain devices (IO signals)."),
  p("The table is fully editable:"),
  bullet("Subsystem Name — Edit the short code to a descriptive name (e.g. 'IC' → 'Inbound Conveyor')."),
  bullet("Type — Select the equipment type from the dropdown: Conveyor, Hopper, Fan/Blower, Dryer, etc."),
  bullet("Description — Optional subsystem description."),
  bullet("Assembly Names — Auto-suggested from device descriptions (e.g. 'Entry Belt', 'Transfer Belt'). Always review and correct."),
  bullet("Assembly Description — Optional description for each assembly."),
  bullet("Add Assembly / Remove Assembly — Add or delete assemblies within a subsystem."),
  bullet("Add Device — Add extra devices to an assembly."),
  bullet("Exclude — Remove a subsystem from the spec scope entirely."),

  new Paragraph({
    children: [new TextRun({ text: "IO Allocation panel (right side)", bold: true, size: 22 })],
    spacing: { before: 120, after: 60 },
  }),
  p("The IO Allocation panel on the right shows every tag and which assembly it is assigned to. Tags with a ✓ are allocated; use this to verify no tags are orphaned."),

  tip("Click 'Suggest with AI' to run Claude over the current tag list and re-infer better assembly names and groupings if the deterministic result is poor."),

  h2("Step 4 — Operating Modes"),
);

const modesImg = img("page-2026-04-15T08-40-29-517Z.png", 1512, "Step 4: Operating Modes inferred by AI — Idle, Starting, Execute, Completing, Completed, E-Stop");
if (modesImg) children.push(...modesImg);

children.push(
  p("Operating modes (states) define the machine's top-level behaviour model. Two patterns are supported:"),
  bullet("Static — All outputs held in a fixed state (e.g. Idle, E-Stop, Completed). No sequence steps."),
  bullet("Sequential — A timed sequence of steps with permissives and completion criteria (e.g. Starting, Execute, Completing)."),

  p("Options:"),
  bullet("Infer with AI — Claude analyses the subsystem list and suggests ISA-88 standard states."),
  bullet("+ Add — Manually add a custom state."),
  bullet("Delete (bin icon) — Remove a state."),
  bullet("Pattern dropdown — Change a state between Static and Sequential."),

  note("The AI inference uses ISA-88 conventions and typically produces: Idle (static), Starting (sequential), Execute (sequential), Completing (sequential), Completed (static), E-Stop (static). Review and adjust to match your machine's actual states."),

  h2("Step 5 — Alarm Configuration"),
);

const alarmImg = img("page-2026-04-15T08-40-52-810Z.png", 1512, "Step 5: Alarm Configuration — four default tiers");
if (alarmImg) children.push(...alarmImg);

children.push(
  p("Alarm tiers define the severity levels used throughout the spec. Four default tiers are pre-populated:"),
  bullet("Tier 1 — Immediate Shutdown: Causes immediate de-energisation of all outputs."),
  bullet("Tier 2 — Controlled Shutdown: Initiates a controlled stop sequence."),
  bullet("Tier 3 — Warning: Alerts operator, no automatic action."),
  bullet("Tier 4 — Interlock: Prevents start or specific action."),
  p("Click '+ Add Tier' to add custom tiers. Click the delete icon to remove a tier."),

  h2("Step 6 — Review & Confirm"),
);

const reviewImg = img("page-2026-04-15T08-41-31-125Z.png", 1512, "Step 6: Review & Confirm summary before saving");
if (reviewImg) children.push(...reviewImg);

children.push(
  p("The review screen shows a summary of everything entered across the previous 5 steps:"),
  bullet("Document code, title, revision, client"),
  bullet("PLC model, HMI type, communications protocol"),
  bullet("Machine hierarchy: subsystem count, assembly count, device count, with subsystem summaries"),
  bullet("Operating states with pattern badges"),
  bullet("Alarm tiers"),
  bullet("Generation scope estimate"),
  p("Click 'Confirm & Save' to save the skeleton and unlock Phase 3."),
);

children.push(pageBreak());

// ── 4. Phase 3 — FDS Authoring ──────────────────────────────────────────────
children.push(
  h1("4. Phase 3 — FDS Authoring (Co-Author)"),
  p("The Co-Author is the core of the FDS Builder. For each assembly, you work with Claude AI to define the exact behaviour in every sequential state: what outputs are commanded, in what order, with what permissives, completion criteria, and fault responses."),
);

const coauthorImg = img("page-2026-04-15T08-43-51-980Z.png", 1512, "Co-Author interface: assembly sidebar (left), conversation (centre), live tables (right)");
if (coauthorImg) children.push(...coauthorImg);

children.push(
  h2("4.1 Layout"),
  bullet("Left sidebar — Assembly tree showing all subsystems and their assemblies with status icons."),
  bullet("Centre — Conversation chat with the AI."),
  bullet("Right pane — Live tables showing permissives and step sequences for each sequential state."),

  h2("4.2 Assembly Sidebar"),
  p("The sidebar lists every assembly under each subsystem. Status is shown by an icon next to the assembly name:"),
  bullet("○ Circle — Not started"),
  bullet("⊕ Shield check — Static states confirmed"),
  bullet("💬 Message — In progress (conversation active)"),
  bullet("✓ Check — Complete"),
  p("A progress bar at the top shows overall completion (e.g. 7/7)."),
  p("Click any assembly to begin authoring it. Clicking 'Orchestration' at the bottom of each subsystem section opens the subsystem-level orchestration view."),

  h2("4.3 Stage 1 — Static State Review"),
);

const staticImg = img("page-2026-04-15T08-44-14-860Z.png", 1512, "Static State Review: confirm output states for Idle, Completed, E-Stop");
if (staticImg) children.push(...staticImg);

children.push(
  p("When you first select an assembly, the Static State Review is shown. For each static operating state (e.g. Idle, Completed, E-Stop), a table lists every output tag in the assembly and its expected state."),
  p("The table is auto-filled based on device class conventions (motors → STOP, valves → CLOSED). Review and correct each row."),
  bullet("Tab — Switch between static states."),
  bullet("Reset to Auto Fill — Discard manual edits and restore auto-filled values."),
  bullet("Confirm Static States — Lock the table and proceed to Stage 2 (conversation)."),

  note("Once confirmed, static states cannot be re-edited without backing out of the conversation. Always review carefully before confirming."),

  h2("4.4 Stage 2 — AI Conversation"),
);

const interviewImg = img("page-2026-04-15T08-45-51-284Z.png", 1512, "AI Interview: opening question referencing actual device tags");
if (interviewImg) children.push(...interviewImg);

children.push(
  p("After confirming static states, the conversation pane becomes active. Two options are available:"),
  bullet("Start AI Interview — Claude generates an opening question about the assembly's behaviour, referencing the actual IO tags by name."),
  bullet("Type directly — Describe the assembly's behaviour in your own words and send."),

  h3("Best Practice: Single comprehensive message"),
  p("The most efficient approach is to send one message covering all three sequential states at once:"),
);

children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: '"Starting permissives: OL clear (IC_CV01_M01_OL = FALSE), jam switch clear, no E-stop. Motor run feedback timeout 5s, fault to Idle (Tier 2). Execute: belt runs continuously, fault on RUN drop (Tier 1). Completing: triggered when PE02 clears, run 3s then stop. Draft all three states."',
        italics: true,
        size: 20,
        color: "1A3A5C",
      }),
    ],
    spacing: { before: 80, after: 80, left: convertInchesToTwip(0.4) },
    border: {
      left: { style: BorderStyle.SINGLE, size: 6, color: "1D6FA5", space: 10 },
    },
  }),
);

children.push(
  p("The AI will draft all three states in a single response and populate the live tables simultaneously."),

  h3("What to include in your brief"),
  bullet("Permissives — conditions that must be TRUE before the sequence can start (tag = value)"),
  bullet("Motor run feedback timeout — how long to wait before faulting, and which fault tier"),
  bullet("Execute behaviour — what keeps the assembly running and what triggers a fault"),
  bullet("Completing trigger — what event triggers the completing state (e.g. PE02 clears)"),
  bullet("Completing duration — how long to run after the trigger before stopping"),
  bullet("Fault transitions — which state to transition to on fault (typically Idle)"),

  h2("4.5 Live Tables"),
);

const tablesImg = img("page-2026-04-15T09-22-48-567Z.png", 1512, "Live tables populated across all three states after one AI response");
if (tablesImg) children.push(...tablesImg);

children.push(
  p("The right pane shows the live tables with tabs for each sequential state. Badge numbers show how many steps are defined (e.g. 'Starting 4')."),

  h3("Permissives"),
  p("String conditions that must be satisfied before the sequence can enter this state. Example: 'IC_CV01_M01_OL = FALSE (No active overload)'."),
  bullet("+ Add — Add a permissive manually."),
  bullet("Delete icon — Remove a permissive."),

  h3("Steps"),
  p("Each step represents one discrete output command with a completion criterion. Steps are numbered sequentially."),
  bullet("Step number — Sequential order of execution."),
  bullet("Action — The output command (e.g. 'Energise IC_CV01_M01_CMD')."),
  bullet("Completion Criteria — The condition that must be met to advance to the next step, plus timeout and fault action."),
  bullet("Expand chevron — Click to edit the structured criteria (tag equals, tag compare, expression, manual ack)."),
  bullet("↑↓ arrows — Reorder steps."),
  bullet("Delete icon — Remove a step."),
  bullet("+ Add Step — Add a manual step."),

  h2("4.6 Mark Complete"),
);

const completeImg = img("page-2026-04-15T09-23-37-812Z.png", 1512, "Assembly marked complete: 1/7 progress, validation drawer at bottom");
if (completeImg) children.push(...completeImg);

children.push(
  p("Once all states are defined to your satisfaction, click 'Mark Complete' in the top-right header."),
  p("The system runs a validation check:"),
  bullet("If validation PASSES — The assembly status updates to Complete (✓) and the progress count increments."),
  bullet("If validation FAILS — A toast notification appears describing the errors, and the validation drawer at the bottom of the screen expands showing each issue with severity (error/warning)."),
  p("Common validation issues:"),
  bullet("Steps with no completion criteria"),
  bullet("Permissives that do not reference a specific tag"),
  bullet("Empty sequential states"),

  note("Warnings do not block completion. Only errors (severity = 'error') prevent an assembly from being marked complete."),

  h2("4.7 Duplicate Assembly"),
  p("Once an assembly is complete, a 'Duplicate' button appears in the header. This copies the assembly's step sequences to one or more other assemblies of the same type, with automatic tag remapping."),
  p("For example, a completed Entry Belt (IC_CV01) can be duplicated to Transfer Belt (IC_CV02) — all tag references (IC_CV01_...) are automatically replaced with (IC_CV02_...)."),

  tip("Duplication is the fastest way to author parallel assemblies (e.g. multiple identical conveyor belts). Complete one thoroughly, then duplicate to all others."),

  h2("4.8 Subsystem Orchestration"),
  p("After all assemblies in a subsystem are complete, the 'Orchestration' button becomes available in the sidebar under that subsystem. Click it to define how assemblies coordinate within the subsystem."),
  p("The orchestration view has the same chat + right-pane layout. Brief the AI with:"),
  bullet("Assembly startup order (e.g. 'CV03 first, then CV02, then CV01 — downstream-first')"),
  bullet("Shared permissives (conditions that gate the entire subsystem)"),
  bullet("Inter-assembly interlocks (e.g. CV03 must be Running before CV02 can start)"),
  bullet("Completing order (often the reverse of starting order)"),
);

const orchICImg = img("page-2026-04-15T09-48-14-137Z.png", 1512, "IC Subsystem Orchestration: assembly order and shared permissives for all three states");
if (orchICImg) children.push(...orchICImg);

children.push(pageBreak());

// ── 5. Phase 4 — System Orchestration ──────────────────────────────────────
children.push(
  h1("5. Phase 4 — System Orchestration"),
  p("System Orchestration defines how the entire machine's subsystems coordinate at the system level — above the per-subsystem orchestration defined in Phase 3."),
);

const sysOrchImg = img("page-2026-04-15T10-08-43-070Z.png", 1512, "System Orchestration: subsystem dependency graph with IC and OC nodes");
if (sysOrchImg) children.push(...sysOrchImg);

children.push(
  h2("5.1 What It Defines"),
  bullet("Cross-subsystem startup order — Does IC need to be Running before OC starts?"),
  bullet("Cross-subsystem interlocks — If IC faults, does OC complete its cycle or also fault immediately?"),
  bullet("System-level shared permissives — Conditions that must be met before any subsystem can start."),
  bullet("Visual dependency graph — Shows subsystems as nodes; arrows represent dependencies."),

  h2("5.2 Layout"),
  bullet("Left: Conversation chat with 'Start AI Interview' or direct text input."),
  bullet("Top-right tabs: Overview (graph), Starting, Execute, Completing."),
  bullet("Graph: Each subsystem is a node showing assembly count and status."),
  bullet("Filter bar: View interlocks for All states, Starting, Execute, or Completing only."),

  h2("5.3 Briefing the AI"),
  p("Example brief for a two-subsystem conveyor:"),
);

children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: '"OC (Outbound Conveyor) starts first — downstream must be clear before inbound feeds product. IC starts second. Execute: both run simultaneously. Completing: IC stops first (no new product), then OC clears remaining product. No cross-system interlocks beyond startup order."',
        italics: true,
        size: 20,
        color: "1A3A5C",
      }),
    ],
    spacing: { before: 80, after: 80, left: convertInchesToTwip(0.4) },
    border: {
      left: { style: BorderStyle.SINGLE, size: 6, color: "1D6FA5", space: 10 },
    },
  }),
);

children.push(
  note("System Orchestration must be done BEFORE generating spec sections (Phase 5). The compose step uses this data to correctly order assemblies in the output document."),
);

children.push(pageBreak());

// ── 6. Generate Spec Sections ───────────────────────────────────────────────
children.push(
  h1("6. Generating Spec Sections"),
  p("After completing all assemblies (Phase 3) and System Orchestration (Phase 4), the 'Generate Spec Sections' button appears below the FDS Authoring card on the spec builder hub page."),
);

const generateImg = img("page-2026-04-15T10-00-41-086Z.png", 1512, "Generate Spec Sections button appears once all assemblies are complete");
if (generateImg) children.push(...generateImg);

children.push(
  p("Click 'Generate Spec Sections' to compose all co-authored assembly sessions and orchestration data into structured spec_sections rows. This:"),
  bullet("Applies assembly ordering from subsystem orchestration"),
  bullet("Merges shared permissives and inter-assembly interlocks into each assembly's section"),
  bullet("Creates one functional_description section per assembly × state combination"),
  bullet("Unlocks the Structured Spec Editor (Phase 5) and DOCX Export (Phase 6)"),

  note("This step is irreversible in the sense that existing sections are deleted and recreated. You can re-run it at any time if you update assembly sessions or orchestration — sections will be regenerated from scratch."),
);

children.push(pageBreak());

// ── 7. Phase 5 — Structured Spec Editor ────────────────────────────────────
children.push(
  h1("7. Phase 5 — Structured Spec Editor"),
  p("The Structured Spec Editor provides a tree-navigation interface to review and edit each section of the full 9-section FDS document. Sections can be approved individually before export."),

  h2("7.1 Section Types"),
  bullet("Section 0 — Document Control (revision history, references, acronyms)"),
  bullet("Section 1 — System Overview (hardware description, IO summary, scope, safety)"),
  bullet("Section 2 — Control Philosophy (operating states, mode transitions, fault philosophy)"),
  bullet("Section 3 — Functional Descriptions (per assembly × state — generated from Phase 3)"),
  bullet("Section 4 — IO List (instrument register, extracted from Phase 1)"),
  bullet("Section 5 — Alarm Specification"),
  bullet("Section 6 — HMI Specification"),
  bullet("Section 7 — Interfaces"),
  bullet("Section 8 — Testing / FAT"),

  h2("7.2 Reviewing and Approving"),
  p("Click a section in the left tree to view and edit it. Use the 'Approve' toggle to mark a section as reviewed. The status indicator shows the approval count (e.g. '0 of 34 sections approved')."),

  h2("7.3 Export Readiness"),
  p("The DOCX Export phase shows a warning if not all sections are approved. All sections must be approved before the spec is considered final."),
);

children.push(pageBreak());

// ── 8. Phase 6 — DOCX Export ────────────────────────────────────────────────
children.push(
  h1("8. Phase 6 — DOCX Export"),
  p("The DOCX Export phase renders the full FDS to a Microsoft Word document, formatted to PAC Technologies standards with proper section numbering, tables, and diagrams."),

  h2("8.1 Export Options"),
  bullet("Download — Download the DOCX directly to your browser."),
  bullet("Upload to Dropbox — Optionally push the generated file directly to the project's Dropbox folder."),

  h2("8.2 Re-Export"),
  p("You can re-export at any time. Each export is stored and listed with a timestamp. Previous exports are not deleted."),
);

children.push(pageBreak());

// ── 9. Tips & Best Practices ─────────────────────────────────────────────────
children.push(
  h1("9. Tips & Best Practices"),

  h2("9.1 Instrument Register"),
  bullet("Use consistent tag naming: SUBSYSTEM_ASSEMBLY_DEVICE_SIGNAL (e.g. IC_CV01_M01_CMD)."),
  bullet("Use the Subsystem column to control grouping — tags with the same value are in the same subsystem."),
  bullet("Include Device Type column for reliable auto-classification. Without it, the AI classifier is used at extra token cost."),
  bullet("Emergency stops with tag names starting with ES (e.g. IC_ES01) are auto-classified as emergency_stop with is_safety = TRUE."),

  h2("9.2 Machine Hierarchy"),
  bullet("Always review assembly names after auto-build — the deterministic parser uses tag prefixes which may not be descriptive."),
  bullet("Use 'Suggest with AI' if the auto-built hierarchy is poor — Claude will infer better groupings from descriptions."),
  bullet("Exclude safety-only subsystems or non-controlled equipment to keep the spec focused."),

  h2("9.3 FDS Co-Authoring"),
  bullet("Give the AI all the information it needs in ONE message — cover all three sequential states at once. This produces a complete draft from a single response."),
  bullet("Always specify: permissives (with exact tag names), fault timeouts, fault tier, and completing trigger."),
  bullet("Downstream-first startup order: for conveyors, start the downstream belt first so product never backs up."),
  bullet("Use the Duplicate feature for parallel assemblies — it saves significant time for machines with many similar belts, hoppers, or lifts."),
  bullet("E-stop assemblies with no outputs (DI only) need minimal authoring — just note they are safety inputs."),

  h2("9.4 Orchestration"),
  bullet("Subsystem orchestration: brief the AI with a single message covering Starting, Execute, and Completing order simultaneously."),
  bullet("System orchestration: always use downstream-first ordering. The subsystem that receives product last should start first."),
  bullet("Complete System Orchestration BEFORE generating spec sections — orchestration data is baked into the output."),

  h2("9.5 Common Issues"),
);

children.push(
  new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Problem", bold: true, size: 20 })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Solution", bold: true, size: 20 })] })] }),
        ],
        tableHeader: true,
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "PE tags classified as 'other'", size: 20 })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Use 'Photoelectric Sensor' in the Device Type column or prefix tags with PE (e.g. IC_CV01_PE01).", size: 20 })] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Subsystem shows 'Other' equipment type", size: 20 })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Manually select the equipment type in the Step 3 hierarchy dropdown.", size: 20 })] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "AI only populates Starting state", size: 20 })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "End your message with 'Draft all three states' to ensure Execute and Completing are included.", size: 20 })] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Mark Complete gives no feedback", size: 20 })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Check the Logic Check panel at the bottom of the screen. Red items are blocking errors. Fix them and retry.", size: 20 })] })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Structured Spec Editor still locked", size: 20 })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Click 'Generate Spec Sections' below the FDS Authoring card after all assemblies are complete.", size: 20 })] })] }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  }),
  new Paragraph({ spacing: { after: 200 } }),
);

children.push(pageBreak());

// ── 10. Glossary ─────────────────────────────────────────────────────────────
children.push(
  h1("10. Glossary"),
  bullet("Assembly — A coordinated group of devices that operate together (e.g. Entry Belt CV01). Orchestrated by process sequence logic."),
  bullet("Co-Author — The AI-assisted conversation interface for authoring assembly step sequences."),
  bullet("Completing — The state in which an assembly winds down its current cycle (after the run trigger clears)."),
  bullet("Device — A single physical component with IO signals (motor, sensor, valve). Gets a Function Block."),
  bullet("E-Stop — Emergency Stop. A safety input that triggers immediate de-energisation."),
  bullet("Execute — The state in which an assembly is actively running its normal operation."),
  bullet("FDS — Functional Design Specification. The complete machine behaviour document."),
  bullet("Instrument Register — The IO list CSV/Excel file listing all PLC tags and their properties."),
  bullet("Interlock — A condition from one assembly or subsystem that blocks or affects another."),
  bullet("Operating State — A top-level machine mode (e.g. Idle, Starting, Execute, E-Stop)."),
  bullet("Orchestration — The definition of how assemblies within a subsystem (or subsystems within a system) coordinate their startup, running, and completing sequences."),
  bullet("Permissive — A condition that must be TRUE before a sequence can proceed."),
  bullet("Spec Section — A structured row in the database representing one section of the FDS document."),
  bullet("Static State — An operating state where all outputs are held in fixed positions (no steps)."),
  bullet("Sequential State — An operating state that executes a timed sequence of output commands."),
  bullet("Subsystem — A functional station grouping related assemblies (e.g. Inbound Conveyor, Hydraulic Lift Station)."),
  bullet("Tier 1/2/3/4 — Alarm severity levels. Tier 1 = Immediate Shutdown, Tier 4 = Interlock."),
);

// ─── Build & Write ───────────────────────────────────────────────────────────
const doc = new Document({
  title: "FDS Builder Manual",
  description: "User manual for the PAC Forge FDS Builder module",
  styles: {
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        run: { color: "1D6FA5", bold: true, size: 32 },
        paragraph: { spacing: { before: 400, after: 160 } },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        run: { color: "2C3E50", bold: true, size: 26 },
        paragraph: { spacing: { before: 280, after: 100 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        run: { color: "444444", bold: true, size: 23 },
        paragraph: { spacing: { before: 200, after: 80 } },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
const outPath = resolve("FDS-Builder-Manual.docx");
writeFileSync(outPath, buffer);
console.log(`✓ Written to ${outPath}`);
