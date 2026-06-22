/**
 * DOCX exporter — deterministic rendering of spec sections to a Word document.
 * Uses the `docx` package. All content comes from content_json — no AI here.
 *
 * Supports both V2 (industry-standard FDS, Sections 0–8) and legacy V1 section types.
 */
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
} from "docx";
import type { SpecProject, SpecSection } from "@/types/spec-builder";
import type { Hierarchy, SpecContractV2 } from "@/types/spec-contract-v2";
import {
  buildHierarchyTable,
  buildHierarchyTableCaption,
} from "./docx-hierarchy-table";
import {
  buildNetworkDeviceTable,
  buildNetworkTableCaption,
} from "./docx-network-table";
import {
  buildMachineDataAppendix,
  type RevisionMeta,
} from "./docx-machine-data-appendix";
import type {
  DocControlContent,
  SystemOverviewContent,
  ControlPhilosophyContent,
  FunctionalDescriptionContent,
  EquipmentDescriptionContent,
  IoListContent,
  AlarmSpecificationContent,
  HmiSpecificationContent,
  TestingFatContent,
  IoSummaryRow,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FONT = "Calibri";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const TABLE_BORDERS = {
  top: BORDER,
  bottom: BORDER,
  left: BORDER,
  right: BORDER,
  insideHorizontal: BORDER,
  insideVertical: BORDER,
};

function p(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 22, font: FONT, color: opts.color })],
    spacing: { after: 120 },
  });
}

/** Multi-paragraph: splits on \n\n and renders each as a separate paragraph */
function prose(text: string): Paragraph[] {
  if (!text) return [p("")];
  return text.split(/\n\n+/).map((chunk) => p(chunk.trim()));
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 240, after: 120 },
  });
}

function tableCell(text: string, opts: { bold?: boolean; width?: number; color?: string } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text: text ?? "", bold: opts.bold, size: 20, font: FONT, color: opts.color })],
      }),
    ],
  });
}

function headerRow(cells: string[]): TableRow {
  return new TableRow({
    tableHeader: true,
    children: cells.map((c) => tableCell(c, { bold: true })),
  });
}

function spacer(): Paragraph {
  return new Paragraph({ text: "", spacing: { after: 120 } });
}

// ---------------------------------------------------------------------------
// V2 Section Renderers
// ---------------------------------------------------------------------------

function renderTitleBlock(spec: SpecProject): Paragraph[] {
  const parts: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: "FUNCTIONAL SPECIFICATION", bold: true, size: 36, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: spec.title, size: 32, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [
        new TextRun({ text: spec.doc_code, size: 22, font: FONT, color: "666666" }),
        new TextRun({ text: `   •   Rev ${spec.revision}`, size: 22, font: FONT, color: "666666" }),
      ],
    }),
  ];

  const metaFields: Array<[string, string | null]> = [
    ["Client", spec.client_name],
    ["Project Number", spec.project_number],
    ["PLC Model", spec.plc_model],
    ["HMI Type", spec.hmi_type],
    ["Issued By", spec.issued_by],
    ["Verified By", spec.verified_by],
    ["Approved By", spec.approved_by],
    ["Date", spec.doc_date],
  ];

  for (const [label, value] of metaFields) {
    if (value) {
      parts.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 22, font: FONT }),
          new TextRun({ text: value, size: 22, font: FONT }),
        ],
      }));
    }
  }

  parts.push(spacer());
  return parts;
}

function renderDocumentControl(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as DocControlContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("0. Document Control", HeadingLevel.HEADING_1));

  // Revision history
  children.push(heading("0.1 Revision History", HeadingLevel.HEADING_2));
  if (c.revision_history?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Rev", "Date", "Description", "Author"]),
        ...c.revision_history.map((r) => new TableRow({
          children: [
            tableCell(r.rev, { width: 10 }),
            tableCell(r.date, { width: 15 }),
            tableCell(r.description, { width: 50 }),
            tableCell(r.author, { width: 25 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  // Referenced documents
  children.push(heading("0.2 Referenced Documents", HeadingLevel.HEADING_2));
  if (c.referenced_documents?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Document Code", "Title", "Revision"]),
        ...c.referenced_documents.map((d) => new TableRow({
          children: [
            tableCell(d.doc_code, { width: 25 }),
            tableCell(d.title, { width: 55 }),
            tableCell(d.revision, { width: 20 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  // Acronyms
  children.push(heading("0.3 Acronyms & Definitions", HeadingLevel.HEADING_2));
  if (c.acronyms?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Term", "Definition"]),
        ...c.acronyms.map((a) => new TableRow({
          children: [
            tableCell(a.term, { bold: true, width: 20 }),
            tableCell(a.definition, { width: 80 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  return children;
}

function renderSystemOverview(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as SystemOverviewContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("1. System Overview", HeadingLevel.HEADING_1));

  // Hardware description
  children.push(heading("1.1 Hardware Configuration", HeadingLevel.HEADING_2));
  children.push(...prose(c.hardware_description ?? ""));

  // IO summary table
  children.push(heading("1.2 I/O Summary", HeadingLevel.HEADING_2));
  if (c.io_summary?.length) {
    const totals = c.io_summary.reduce(
      (acc, r) => ({ di: acc.di + r.di_count, do: acc.do + r.do_count, ai: acc.ai + r.ai_count, ao: acc.ao + r.ao_count }),
      { di: 0, do: 0, ai: 0, ao: 0 },
    );
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Unit", "DI", "DO", "AI", "AO", "Total"]),
        ...c.io_summary.map((r: IoSummaryRow) => new TableRow({
          children: [
            tableCell(r.unit_name, { width: 40 }),
            tableCell(String(r.di_count), { width: 12 }),
            tableCell(String(r.do_count), { width: 12 }),
            tableCell(String(r.ai_count), { width: 12 }),
            tableCell(String(r.ao_count), { width: 12 }),
            tableCell(String(r.di_count + r.do_count + r.ai_count + r.ao_count), { width: 12 }),
          ],
        })),
        new TableRow({
          children: [
            tableCell("TOTAL", { bold: true, width: 40 }),
            tableCell(String(totals.di), { bold: true, width: 12 }),
            tableCell(String(totals.do), { bold: true, width: 12 }),
            tableCell(String(totals.ai), { bold: true, width: 12 }),
            tableCell(String(totals.ao), { bold: true, width: 12 }),
            tableCell(String(totals.di + totals.do + totals.ai + totals.ao), { bold: true, width: 12 }),
          ],
        }),
      ],
    }));
    children.push(spacer());
  }

  // Scope exclusions
  children.push(heading("1.3 Scope Exclusions", HeadingLevel.HEADING_2));
  children.push(...prose(c.scope_exclusions ?? ""));

  // Safety classification
  children.push(heading("1.4 Safety Classification", HeadingLevel.HEADING_2));
  children.push(...prose(c.safety_classification ?? ""));

  // Machine Hierarchy — deterministic tree: Unit → Equipment Module → Device
  const hierarchy = (c as unknown as { machine_hierarchy?: Array<{
    unit_id?: string;
    unit_name: string;
    equipment_type: string;
    description?: string;
    excluded?: boolean;
    equipment_modules: Array<{
      equipment_module_id?: string;
      equipment_module_name: string;
      description?: string;
      control_modules: Array<{
        control_module_id?: string;
        control_module_name: string;
        control_module_class: string;
        is_safety: boolean;
        description?: string;
        signal_count: number;
        signals: Array<{ tag: string; signal_type: string; io_address: string }>;
      }>;
    }>;
  }> }).machine_hierarchy;
  if (hierarchy?.length) {
    children.push(heading("1.5 Machine Hierarchy", HeadingLevel.HEADING_2));
    children.push(...prose(
      "The machine is decomposed into units (functional stations), each comprising coordinated equipment_modules of physical control_modules. Every device exposes one or more IO signals to the PLC.",
    ));
    for (const sub of hierarchy) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${sub.unit_name}`, bold: true, size: 22, font: FONT }),
          new TextRun({ text: `  (${sub.equipment_type})`, italics: true, size: 20, font: FONT })],
        spacing: { before: 160, after: 60 },
      }));
      if (sub.description) {
        children.push(new Paragraph({
          children: [new TextRun({ text: sub.description, size: 20, font: FONT })],
          spacing: { after: 80 },
          indent: { left: 360 },
        }));
      }
      for (const asm of sub.equipment_modules) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `• ${asm.equipment_module_name}`, bold: true, size: 21, font: FONT })],
          spacing: { before: 80, after: 40 },
          indent: { left: 360 },
        }));
        if (asm.description) {
          children.push(new Paragraph({
            children: [new TextRun({ text: asm.description, size: 20, font: FONT, italics: true })],
            spacing: { after: 60 },
            indent: { left: 720 },
          }));
        }
        for (const dev of asm.control_modules) {
          const sigList = dev.signals.map((s) => `${s.tag} (${s.signal_type} ${s.io_address})`).join(", ");
          const safetyMark = dev.is_safety ? " [SAFETY]" : "";
          children.push(new Paragraph({
            children: [
              new TextRun({ text: `– ${dev.control_module_name}`, size: 20, font: FONT }),
              new TextRun({ text: `  [${dev.control_module_class}${safetyMark}]`, size: 18, font: FONT, italics: true }),
              new TextRun({ text: `: ${sigList}`, size: 18, font: FONT }),
            ],
            spacing: { after: 40 },
            indent: { left: 720 },
          }));
        }
      }
    }
    children.push(spacer());

    // ---- Section 1.6 — Canonical Machine Hierarchy (structured table) ----
    const canonicalHierarchy = hierarchyToContractShape(hierarchy);
    children.push(heading("1.6 Canonical Machine Hierarchy", HeadingLevel.HEADING_2));
    children.push(buildHierarchyTableCaption());
    children.push(buildHierarchyTable(canonicalHierarchy));
    children.push(spacer());

    // ---- Section 1.7 — Network Device Configuration (conditional) ----
    const networkTable = buildNetworkDeviceTable(canonicalHierarchy);
    if (networkTable) {
      children.push(heading("1.7 Network Device Configuration", HeadingLevel.HEADING_2));
      children.push(buildNetworkTableCaption());
      children.push(networkTable);
      children.push(spacer());
    }
  }

  return children;
}

/**
 * Lift the JSON-shaped machine_hierarchy (from the system_overview section) to
 * the contract `Hierarchy` shape that the table renderers accept. Synthesises
 * missing UUIDs as deterministic placeholders keyed by name so the ingest
 * parser can still extract stable ids even on legacy data that predates the
 * UUID switch.
 */
function hierarchyToContractShape(
  raw: Array<{
    unit_id?: string;
    unit_name: string;
    equipment_type: string;
    description?: string;
    excluded?: boolean;
    equipment_modules: Array<{
      equipment_module_id?: string;
      equipment_module_name: string;
      description?: string;
      control_modules: Array<{
        control_module_id?: string;
        control_module_name: string;
        control_module_class: string;
        is_safety: boolean;
        description?: string;
        signals: Array<{ tag: string; signal_type: string; io_address: string }>;
      }>;
    }>;
  }>,
): Hierarchy {
  return {
    units: raw.map((s) => ({
      unit_id: s.unit_id ?? `00000000-0000-0000-0000-${hashTo12Hex(s.unit_name)}`,
      unit_name: s.unit_name,
      equipment_type: s.equipment_type,
      description: s.description ?? "",
      excluded: Boolean(s.excluded),
      equipment_modules: s.equipment_modules.map((a) => ({
        equipment_module_id: a.equipment_module_id ?? `00000000-0000-0000-0000-${hashTo12Hex(a.equipment_module_name)}`,
        equipment_module_name: a.equipment_module_name,
        description: a.description ?? "",
        control_modules: a.control_modules.map((d) => ({
          control_module_id: d.control_module_id ?? `00000000-0000-0000-0000-${hashTo12Hex(d.control_module_name)}`,
          control_module_name: d.control_module_name,
          control_module_class: d.control_module_class,
          is_safety: d.is_safety,
          description: d.description ?? "",
          io_signals: d.signals.map((sig) => ({
            tag: sig.tag,
            signal_type: (sig.signal_type as "DI" | "DO" | "AI" | "AO" | "internal") ?? "internal",
            io_address: sig.io_address,
            description: "",
            source: "wired" as const,
          })),
        })),
      })),
    })),
  };
}

/**
 * Deterministic 12-hex-char placeholder suffix derived from a name. Not a
 * cryptographic hash — just enough to keep placeholder UUIDs stable across
 * renders of the same legacy spec.
 */
function hashTo12Hex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (toHex(h1) + toHex(h2)).slice(0, 12);
}

function renderControlPhilosophy(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as ControlPhilosophyContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("2. Control Philosophy", HeadingLevel.HEADING_1));

  // State list table
  children.push(heading("2.1 Operating States", HeadingLevel.HEADING_2));
  if (c.state_list?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["State", "Type", "Description"]),
        ...c.state_list.map((s) => new TableRow({
          children: [
            tableCell(s.state_name, { bold: true, width: 20 }),
            tableCell(s.pattern === "static" ? "Static" : "Sequential", { width: 15 }),
            tableCell(s.brief, { width: 65 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  // Mode transitions
  children.push(heading("2.2 Mode Transitions", HeadingLevel.HEADING_2));
  children.push(...prose(c.mode_transitions ?? ""));

  // Fault philosophy
  children.push(heading("2.3 Fault Philosophy", HeadingLevel.HEADING_2));
  children.push(...prose(c.fault_philosophy ?? ""));

  // Design principles
  children.push(heading("2.4 General Design Principles", HeadingLevel.HEADING_2));
  if (c.design_principles?.length) {
    for (const principle of c.design_principles) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `•  ${principle}`, size: 22, font: FONT })],
        spacing: { after: 80 },
        indent: { left: 360 },
      }));
    }
    children.push(spacer());
  }

  return children;
}

function renderFunctionalDescriptions(
  equipmentSections: SpecSection[],
  funcDescSections: SpecSection[],
  spec: SpecProject,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  children.push(heading("3. Functional Descriptions", HeadingLevel.HEADING_1));

  // Group by unit. The per-EM state model emits functional_description rows
  // directly under their unit with NO equipment_description parent, so the unit
  // list is the union of unit_ids from both section lists (ordered by
  // confirmed_units). Iterating equipmentSections alone would drop every per-EM
  // description on a spec that has no equipment_description sections.
  const seenUnits = new Set<string>();
  const unitIds: string[] = [];
  for (const id of spec.confirmed_units.map((u) => u.unit_id)) {
    if (
      equipmentSections.some((e) => e.unit_id === id) ||
      funcDescSections.some((f) => f.unit_id === id)
    ) {
      unitIds.push(id);
      seenUnits.add(id);
    }
  }
  // Defensive: include any unit_ids not present in confirmed_units order.
  for (const s of [...equipmentSections, ...funcDescSections]) {
    if (s.unit_id && !seenUnits.has(s.unit_id)) {
      unitIds.push(s.unit_id);
      seenUnits.add(s.unit_id);
    }
  }

  unitIds.forEach((unitId, idx) => {
    const unitName =
      spec.confirmed_units.find((s) => s.unit_id === unitId)?.unit_name ??
      unitId ?? "Unknown";

    // Unit heading
    children.push(heading(`3.${idx + 1} ${unitName}`, HeadingLevel.HEADING_2));

    // Optional equipment prose + instrumentation table (when present)
    const eq = equipmentSections.find((e) => e.unit_id === unitId);
    if (eq) {
      const eqContent = eq.content_json as unknown as EquipmentDescriptionContent;
      if (eqContent.prose) children.push(...prose(eqContent.prose));
      if (eqContent.control_module_table?.length) {
        children.push(p("Control Device Instrumentation:", { bold: true }));
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: TABLE_BORDERS,
          rows: [
            headerRow(["Device", "Tag", "Description"]),
            ...eqContent.control_module_table.map((row) => new TableRow({
              children: [
                tableCell(row.control_module, { width: 30 }),
                tableCell(row.tag, { width: 20 }),
                tableCell(row.description, { width: 50 }),
              ],
            })),
          ],
        }));
        children.push(spacer());
      }
    }

    // Functional description per state
    const subFuncDescs = funcDescSections.filter((s) => s.unit_id === unitId);
    subFuncDescs.forEach((fd, sIdx) => {
      // Per-(EM, state) rows carry their own human label in `state_name`.
      const stateName = fd.state_name ?? "";
      const fdContent = fd.content_json as unknown as FunctionalDescriptionContent;

      children.push(heading(`3.${idx + 1}.${sIdx + 1} ${stateName}`, HeadingLevel.HEADING_3));

      if (fdContent.pattern === "static") {
        // Pattern A — Device State Table
        if (fdContent.control_module_states?.length) {
          children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: TABLE_BORDERS,
            rows: [
              headerRow(["Tag", "Description", "State"]),
              ...fdContent.control_module_states.map((ds) => {
                // Color-code: STOP/DE-ENERGISED/OFF/FALSE/CLOSED = red, others = green
                const isOff = /stop|de-energi|off|false|closed|0/i.test(ds.state);
                return new TableRow({
                  children: [
                    tableCell(ds.tag, { bold: true, width: 25 }),
                    tableCell(ds.description, { width: 45 }),
                    tableCell(ds.state, { bold: true, width: 30, color: isOff ? "CC0000" : "008800" }),
                  ],
                });
              }),
            ],
          }));
          children.push(spacer());
        }
      } else {
        // Pattern B — Step Table
        if (fdContent.permissives?.length) {
          children.push(p("Permissives:", { bold: true }));
          for (const perm of fdContent.permissives) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `•  ${perm}`, size: 20, font: FONT })],
              spacing: { after: 60 },
              indent: { left: 360 },
            }));
          }
          children.push(spacer());
        }

        if (fdContent.steps?.length) {
          children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: TABLE_BORDERS,
            rows: [
              headerRow(["Step", "Action", "Completion Criteria"]),
              ...fdContent.steps.map((step) => new TableRow({
                children: [
                  tableCell(String(step.step), { bold: true, width: 8 }),
                  tableCell(step.action, { width: 42 }),
                  tableCell(step.completion_criteria, { width: 50 }),
                ],
              })),
            ],
          }));
          children.push(spacer());
        }

        if (fdContent.notes) {
          children.push(p(`Note: ${fdContent.notes}`, { size: 20, color: "666666" }));
        }
      }
    });
  });

  return children;
}

function renderIoList(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as IoListContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("4. I/O List", HeadingLevel.HEADING_1));

  if (c.io_entries?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Tag", "Device Type", "Description", "Signal", "Address", "Normal", "Failsafe"]),
        ...c.io_entries.map((io) => new TableRow({
          children: [
            tableCell(io.tag, { bold: true, width: 14 }),
            tableCell(io.device_type, { width: 14 }),
            tableCell(io.description, { width: 24 }),
            tableCell(io.signal_type, { width: 8 }),
            tableCell(io.io_address, { width: 10 }),
            tableCell(io.normal_state, { width: 15 }),
            tableCell(io.failsafe_state, { width: 15 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  return children;
}

function renderAlarmSpecification(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as AlarmSpecificationContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("5. Alarm Specification", HeadingLevel.HEADING_1));

  // Alarm tiers
  const tiers = c.alarm_tiers ?? [];
  tiers.forEach((tier, tIdx) => {
    children.push(heading(`5.${tIdx + 1} ${tier.tier_name}`, HeadingLevel.HEADING_2));
    if (tier.alarms.length === 0) {
      children.push(p("No alarms in this tier.", { size: 20 }));
      return;
    }
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Tag", "Description", "Action", "Setpoint", "Delay"]),
        ...tier.alarms.map((a) => new TableRow({
          children: [
            tableCell(a.tag, { width: 15 }),
            tableCell(a.description, { width: 30 }),
            tableCell(a.action, { width: 30 }),
            tableCell(a.setpoint, { width: 13 }),
            tableCell(a.delay, { width: 12 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  });

  // Cause & Effect Matrix
  if (c.cause_effect_matrix?.causes?.length) {
    const matrix = c.cause_effect_matrix;
    children.push(heading(`5.${tiers.length + 1} Cause & Effect Matrix`, HeadingLevel.HEADING_2));

    const effectHeaders = matrix.effects ?? [];
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Cause", "Tag", ...effectHeaders]),
        ...matrix.causes.map((c) => new TableRow({
          children: [
            tableCell(c.cause, { width: 30 }),
            tableCell(c.cause_tag, { width: 15 }),
            ...c.effects.map((e) => tableCell(e ? "✓" : "—", { width: Math.floor(55 / effectHeaders.length) })),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  return children;
}

function renderHmiSpecification(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as HmiSpecificationContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("6. HMI Specification", HeadingLevel.HEADING_1));

  // Screen hierarchy
  children.push(heading("6.1 Screen Hierarchy", HeadingLevel.HEADING_2));
  if (c.screen_hierarchy?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Screen", "Parent", "Description"]),
        ...c.screen_hierarchy.map((s) => new TableRow({
          children: [
            tableCell(s.screen_name, { bold: true, width: 25 }),
            tableCell(s.parent ?? "—", { width: 20 }),
            tableCell(s.description, { width: 55 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  // Access levels
  children.push(heading("6.2 Access Levels", HeadingLevel.HEADING_2));
  if (c.access_levels?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Level", "Name", "Capabilities"]),
        ...c.access_levels.map((a) => new TableRow({
          children: [
            tableCell(String(a.level), { width: 10 }),
            tableCell(a.name, { bold: true, width: 20 }),
            tableCell(a.capabilities.join(", "), { width: 70 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  // Trending
  children.push(heading("6.3 Trending Requirements", HeadingLevel.HEADING_2));
  if (c.trending?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Tag", "Description", "Sample Rate"]),
        ...c.trending.map((t) => new TableRow({
          children: [
            tableCell(t.tag, { bold: true, width: 20 }),
            tableCell(t.description, { width: 55 }),
            tableCell(t.sample_rate, { width: 25 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  return children;
}

function renderInterfaces(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as Record<string, unknown>;
  return [
    heading("7. Interfaces", HeadingLevel.HEADING_1),
    p(typeof c.note === "string" ? c.note : "Reserved for future interface specifications."),
  ];
}

function renderTestingFat(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as unknown as TestingFatContent;
  const children: (Paragraph | Table)[] = [];

  children.push(heading("8. Factory Acceptance Test (FAT)", HeadingLevel.HEADING_1));

  children.push(heading("8.1 Test Procedures", HeadingLevel.HEADING_2));
  if (c.test_procedures?.length) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Test ID", "Description", "Section Ref", "Acceptance Criteria", "Result"]),
        ...c.test_procedures.map((t) => new TableRow({
          children: [
            tableCell(t.test_id, { bold: true, width: 8 }),
            tableCell(t.description, { width: 30 }),
            tableCell(t.section_ref, { width: 10 }),
            tableCell(t.acceptance_criteria, { width: 37 }),
            tableCell(t.result, { width: 15 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  }

  return children;
}

// ---------------------------------------------------------------------------
// Legacy V1 renderers (backward compatibility)
// ---------------------------------------------------------------------------

function renderLegacyIntroduction(section: SpecSection): (Paragraph | Table)[] {
  const c = section.content_json as { overview?: string; brief_description?: string };
  return [
    heading("1. Introduction", HeadingLevel.HEADING_1),
    heading("1.1 Overview", HeadingLevel.HEADING_2),
    p(c.overview ?? ""),
    heading("1.2 Brief Description", HeadingLevel.HEADING_2),
    p(c.brief_description ?? ""),
  ];
}

function renderLegacyEquipmentGroup(
  equipmentSections: SpecSection[],
  stateSections: SpecSection[],
  spec: SpecProject,
  startIdx: number,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  children.push(heading(`${startIdx}. Equipment Descriptions`, HeadingLevel.HEADING_1));

  equipmentSections.forEach((eq, idx) => {
    const unitName =
      spec.confirmed_units.find((s) => s.unit_id === eq.unit_id)?.unit_name ??
      eq.unit_id ?? "Unknown";

    const c = eq.content_json as unknown as EquipmentDescriptionContent;
    children.push(heading(`${startIdx}.${idx + 1} ${unitName}`, HeadingLevel.HEADING_2));
    if (c.prose) children.push(p(c.prose));

    if (c.control_module_table?.length) {
      children.push(p("Control Device Instrumentation:", { bold: true }));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TABLE_BORDERS,
        rows: [
          headerRow(["Device", "Tag", "Description"]),
          ...c.control_module_table.map((row) => new TableRow({
            children: [
              tableCell(row.control_module, { width: 30 }),
              tableCell(row.tag, { width: 20 }),
              tableCell(row.description, { width: 50 }),
            ],
          })),
        ],
      }));
      children.push(spacer());
    }

    const subStates = stateSections.filter((s) => s.unit_id === eq.unit_id);
    if (subStates.length > 0) {
      children.push(p("Operating States:", { bold: true }));
      subStates.forEach((state, sIdx) => {
        const stateName = state.state_name ?? "";
        const sc = state.content_json as { state_narrative?: string };
        children.push(heading(`${startIdx}.${idx + 1}.${sIdx + 1} ${stateName}`, HeadingLevel.HEADING_3));
        children.push(p(sc.state_narrative ?? ""));
      });
    }
  });

  return children;
}

function renderLegacyAlarms(section: SpecSection, sectionIdx: number): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  children.push(heading(`${sectionIdx}. Alarms`, HeadingLevel.HEADING_1));

  const c = section.content_json as unknown as AlarmSpecificationContent;
  const tiers = c.alarm_tiers ?? [];

  tiers.forEach((tier, tIdx) => {
    children.push(heading(`${sectionIdx}.${tIdx + 1} ${tier.tier_name}`, HeadingLevel.HEADING_2));
    if (tier.alarms.length === 0) {
      children.push(p("No alarms in this tier.", { size: 20 }));
      return;
    }
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        headerRow(["Tag", "Description", "Action", "Setpoint", "Delay"]),
        ...tier.alarms.map((a) => new TableRow({
          children: [
            tableCell(a.tag, { width: 15 }),
            tableCell(a.description, { width: 35 }),
            tableCell(a.action, { width: 25 }),
            tableCell(a.setpoint, { width: 15 }),
            tableCell(a.delay, { width: 10 }),
          ],
        })),
      ],
    }));
    children.push(spacer());
  });

  return children;
}

function renderLegacySettings(
  section: SpecSection,
  spec: SpecProject,
  sectionIdx: number,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  children.push(heading(`${sectionIdx}. Settings`, HeadingLevel.HEADING_1));

  interface SubsystemSettings {
    unit_id: string;
    process_settings: Array<{ parameter: string; default: string; unit: string; notes: string }>;
    alarm_settings: Array<{ parameter: string; setpoint: string; unit: string; delay: string }>;
  }

  const c = section.content_json as { units?: SubsystemSettings[] };
  const subs = c.units ?? [];

  subs.forEach((sub, sIdx) => {
    const subName =
      spec.confirmed_units.find((s) => s.unit_id === sub.unit_id)?.unit_name ??
      sub.unit_id;
    children.push(heading(`${sectionIdx}.${sIdx + 1} ${subName}`, HeadingLevel.HEADING_2));

    if (sub.process_settings?.length) {
      children.push(p("Process Settings:", { bold: true }));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TABLE_BORDERS,
        rows: [
          headerRow(["Parameter", "Default", "Unit", "Notes"]),
          ...sub.process_settings.map((ps) => new TableRow({
            children: [
              tableCell(ps.parameter, { width: 35 }),
              tableCell(ps.default, { width: 20 }),
              tableCell(ps.unit, { width: 15 }),
              tableCell(ps.notes, { width: 30 }),
            ],
          })),
        ],
      }));
      children.push(spacer());
    }

    if (sub.alarm_settings?.length) {
      children.push(p("Alarm Settings:", { bold: true }));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TABLE_BORDERS,
        rows: [
          headerRow(["Parameter", "Setpoint", "Unit", "Delay"]),
          ...sub.alarm_settings.map((as) => new TableRow({
            children: [
              tableCell(as.parameter, { width: 40 }),
              tableCell(as.setpoint, { width: 25 }),
              tableCell(as.unit, { width: 15 }),
              tableCell(as.delay, { width: 20 }),
            ],
          })),
        ],
      }));
      children.push(spacer());
    }
  });

  return children;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function buildSpecDocx(
  spec: SpecProject,
  sections: SpecSection[],
  opts?: { contract?: SpecContractV2; revisionMeta?: RevisionMeta },
): Promise<Blob> {
  // Determine if this is a V2 or V1 spec based on section types present
  const hasV2 = sections.some((s) =>
    s.section_type === "document_control" ||
    s.section_type === "system_overview" ||
    s.section_type === "control_philosophy" ||
    s.section_type === "functional_description"
  );

  const children: (Paragraph | Table)[] = [];

  // Cover / title
  children.push(...renderTitleBlock(spec));

  if (hasV2) {
    // ===== V2 rendering (industry-standard FDS) =====

    // Section 0 — Document Control
    const docControl = sections.find((s) => s.section_type === "document_control");
    if (docControl) children.push(...renderDocumentControl(docControl));

    // Section 1 — System Overview
    const sysOverview = sections.find((s) => s.section_type === "system_overview");
    if (sysOverview) children.push(...renderSystemOverview(sysOverview));

    // Section 2 — Control Philosophy
    const ctrlPhil = sections.find((s) => s.section_type === "control_philosophy");
    if (ctrlPhil) children.push(...renderControlPhilosophy(ctrlPhil));

    // Section 3 — Functional Descriptions
    const equipment = sections.filter((s) => s.section_type === "equipment_description");
    const funcDescs = sections.filter((s) => s.section_type === "functional_description");
    if (equipment.length > 0 || funcDescs.length > 0) {
      children.push(...renderFunctionalDescriptions(equipment, funcDescs, spec));
    }

    // Section 4 — I/O List
    const ioList = sections.find((s) => s.section_type === "io_list");
    if (ioList) children.push(...renderIoList(ioList));

    // Section 5 — Alarm Specification
    const alarmSpec = sections.find((s) => s.section_type === "alarm_specification");
    if (alarmSpec) children.push(...renderAlarmSpecification(alarmSpec));

    // Section 6 — HMI Specification
    const hmiSpec = sections.find((s) => s.section_type === "hmi_specification");
    if (hmiSpec) children.push(...renderHmiSpecification(hmiSpec));

    // Section 7 — Interfaces
    const interfaces = sections.find((s) => s.section_type === "interfaces");
    if (interfaces) children.push(...renderInterfaces(interfaces));

    // Section 8 — Testing / FAT
    const testingFat = sections.find((s) => s.section_type === "testing_fat");
    if (testingFat) children.push(...renderTestingFat(testingFat));

  } else {
    // ===== V1 legacy rendering =====
    const intro = sections.find((s) => s.section_type === "introduction");
    const equipment = sections.filter((s) => s.section_type === "equipment_description");
    const states = sections.filter((s) => s.section_type === "functional_state");
    const alarms = sections.find((s) => s.section_type === "alarm_table");
    const settings = sections.find((s) => s.section_type === "settings_table");

    let sectionNumber = 1;
    if (intro) {
      children.push(...renderLegacyIntroduction(intro));
      sectionNumber++;
    }
    if (equipment.length > 0) {
      children.push(...renderLegacyEquipmentGroup(equipment, states, spec, sectionNumber));
      sectionNumber++;
    }
    if (alarms) {
      children.push(...renderLegacyAlarms(alarms, sectionNumber));
      sectionNumber++;
    }
    if (settings) {
      children.push(...renderLegacySettings(settings, spec, sectionNumber));
    }
  }

  // Appendix Z — Machine-Readable Data (only when a contract is supplied).
  if (opts?.contract) {
    children.push(...buildMachineDataAppendix(opts.contract, opts.revisionMeta));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return blob;
}

export function buildSpecFilename(spec: SpecProject): string {
  const safeTitle = spec.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  return `${spec.doc_code}_Rev${spec.revision}_${safeTitle}.docx`;
}
