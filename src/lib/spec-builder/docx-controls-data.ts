/**
 * Section 9 — Controls Engineering Data (G0-16 W4).
 *
 * Renders the signable controls models the G1–G5 deterministic writers
 * consume: drive/VSD integration (tier 1 joined with tier-2 commissioning
 * values), per-signal IO treatment (polarity / conditioning / scaling),
 * per-unit PackML coordination (states, transitions, safety-healthy,
 * routing, two-detent, axes), and the maintenance layer. Every block is
 * render-if-present — specs without a model simply omit its subsection.
 */
import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  BorderStyle,
} from "docx";
import type {
  AxisV1,
  RoutingRow,
  SignalSourceRef,
  SpecContractV2,
  UnitCoordinationV1,
  UnitTransitionV1,
} from "@/types/spec-contract-v2";

const FONT = "Calibri";
const MONO = "Consolas";
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const TABLE_BORDERS = {
  top: BORDER, bottom: BORDER, left: BORDER, right: BORDER,
  insideHorizontal: BORDER, insideVertical: BORDER,
};

type Block = Paragraph | Table;

function h2(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT })], spacing: { before: 240, after: 120 } });
}
function h3(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, font: FONT })], spacing: { before: 180, after: 80 } });
}
function note(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, italics: true, size: 18, font: FONT })], spacing: { after: 80 } });
}
function cell(text: string, mono = false): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, size: mono ? 16 : 18, font: mono ? MONO : FONT })] })],
  });
}
function headerRow(labels: string[]): TableRow {
  return new TableRow({
    children: labels.map(
      (l) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: l, bold: true, size: 18, font: FONT })] })],
        }),
    ),
  });
}
function table(labels: string[], rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [headerRow(labels), ...rows],
  });
}

// ---------------------------------------------------------------------------
// 9.1 Drive & device integration
// ---------------------------------------------------------------------------

function buildDriveSection(contract: SpecContractV2): Block[] {
  const rows: TableRow[] = [];
  for (const u of contract.hierarchy.units) {
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        if (!cm.drive) continue;
        const eng = contract.engineering?.drives.find(
          (d) => d.control_module_id === cm.control_module_id,
        );
        rows.push(
          new TableRow({
            children: [
              cell(cm.control_module_name, true),
              cell(cm.drive.family, true),
              cell(cm.drive.telegram !== undefined ? `Std ${cm.drive.telegram}` : "—", true),
              cell(`${cm.drive.speed_ref.unit}${cm.drive.speed_ref.signed ? " (signed)" : ""}`),
              cell(cm.drive.enable_policy),
              cell(eng?.ref_speed_rpm !== undefined ? `${eng.ref_speed_rpm} rpm` : "commissioning", true),
              cell(
                eng?.hw_id_stw !== undefined || eng?.hw_id_zsw !== undefined
                  ? `${eng?.hw_id_stw ?? "—"} / ${eng?.hw_id_zsw ?? "—"}`
                  : "commissioning",
                true,
              ),
            ],
          }),
        );
      }
    }
  }
  if (!rows.length) return [];
  return [
    h3("9.1 Drive / VSD Integration"),
    note("Setpoint scaling and telegram wiring are generated from these parameters. RefSpeed must equal the drive's reference-speed parameter (p2000); values marked 'commissioning' are recorded during commissioning and emitted as TODOs until then."),
    table(["Control module", "Family", "Telegram", "Speed reference", "Enable policy", "Ref speed", "HW ID STW/ZSW"], rows),
  ];
}

// ---------------------------------------------------------------------------
// 9.2 IO signal treatment
// ---------------------------------------------------------------------------

function buildIoTreatmentSection(contract: SpecContractV2): Block[] {
  const rows: TableRow[] = [];
  for (const u of contract.hierarchy.units) {
    for (const em of u.equipment_modules) {
      for (const cm of em.control_modules) {
        for (const s of cm.io_signals) {
          if (!s.polarity && !s.conditioning && !s.scaling) continue;
          const conditioning = s.conditioning
            ? [
                s.conditioning.on_delay_ms !== undefined ? `on ${s.conditioning.on_delay_ms} ms` : undefined,
                s.conditioning.off_delay_ms !== undefined ? `off ${s.conditioning.off_delay_ms} ms` : undefined,
              ]
                .filter(Boolean)
                .join(", ")
            : "—";
          const scaling = s.scaling
            ? `${s.scaling.raw.min}–${s.scaling.raw.max} ${s.scaling.raw.unit} → ${s.scaling.eu.min}–${s.scaling.eu.max} ${s.scaling.eu.unit}`
            : "—";
          rows.push(
            new TableRow({
              children: [
                cell(s.tag, true),
                cell(s.signal_type, true),
                cell(s.polarity === "nc" ? "N/C fail-safe (inverted in code)" : s.polarity === "no" ? "N/O" : "—"),
                cell(conditioning),
                cell(scaling, true),
              ],
            }),
          );
        }
      }
    }
  }
  if (!rows.length) return [];
  return [
    h3("9.2 IO Signal Treatment"),
    note("Wiring polarity, functionally significant conditioning delays, and analog scaling. N/C fail-safe inputs read TRUE when healthy; generated code inverts them so control logic sees TRUE = abnormal."),
    table(["Tag", "Type", "Wiring", "Conditioning", "Scaling"], rows),
  ];
}

// ---------------------------------------------------------------------------
// 9.3 Unit coordination
// ---------------------------------------------------------------------------

function refText(r: SignalSourceRef, emName: (id: string) => string): string {
  switch (r.kind) {
    case "io_tag":
      return r.tag;
    case "em_status":
      return `${emName(r.equipment_module_id)}.${r.member}`;
    case "named_gate":
      return `gate:${r.gate_id}`;
  }
}

function triggerText(t: UnitTransitionV1["trigger"]): string {
  switch (t.type) {
    case "command":
      return `command ${t.command.toUpperCase()}`;
    case "em_aggregate":
      return `all EMs in "${t.em_state}"`;
    case "condition":
      return t.expr.map((c) => `${c.tag} ${c.operator} ${String(c.value)}`).join(" AND ");
  }
}

function axisText(a: AxisV1): string {
  if (a.kind === "linear") {
    const gates = Object.entries(a.gates)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    return `linear · encoder ${a.encoder_tag} · ${a.eu_unit} · ${gates || "no gates"}${a.unconfigured_open ? " · open while unconfigured" : ""}`;
  }
  const windows = a.home_windows.map((w) => `${w.center_deg10 / 10}°±${w.band_deg10 / 10}°`).join(", ");
  return `rotary · encoder ${a.encoder_tag} · preset offset ${a.preset_offset} · home ${windows}${a.gates.at_home ? ` · at_home=${a.gates.at_home}` : ""}${a.preset ? " · presettable" : ""}`;
}

function buildUnitCoordinationSection(contract: SpecContractV2): Block[] {
  const coordMap = contract.unit_coordination;
  if (!coordMap || Object.keys(coordMap).length === 0) return [];
  const out: Block[] = [
    h3("9.3 Unit Coordination"),
    note("PackML unit state machines, safety-healthy aggregation, command routing, and envelope geometry. Generated unit coordinators implement exactly this table."),
  ];
  for (const u of contract.hierarchy.units) {
    const coord: UnitCoordinationV1 | undefined = coordMap[u.unit_id];
    if (!coord) continue;
    const emName = (id: string) =>
      u.equipment_modules.find((em) => em.equipment_module_id === id)?.equipment_module_name ?? id;
    const modeName = (id: string) => contract.modes?.find((m) => m.mode_id === id)?.name ?? id;

    out.push(h3(`Unit: ${u.unit_name}`));
    out.push(
      table(
        ["State", "Allowed modes", "Mode change"],
        coord.states.map(
          (s) =>
            new TableRow({
              children: [
                cell(s.state_id, true),
                cell(s.allowed_modes.length ? s.allowed_modes.map(modeName).join(", ") : "all"),
                cell(s.mode_change_allowed ? "yes" : "no"),
              ],
            }),
        ),
      ),
    );
    if (coord.transitions.length) {
      out.push(
        table(
          ["From", "To", "Trigger", "Guard"],
          coord.transitions.map(
            (t) =>
              new TableRow({
                children: [
                  cell(t.from_state_id, true),
                  cell(t.to_state_id, true),
                  cell(triggerText(t.trigger)),
                  cell(
                    t.guard.length
                      ? t.guard.map((c) => `${c.tag} ${c.operator} ${String(c.value)}`).join(" AND ")
                      : "—",
                    true,
                  ),
                ],
              }),
          ),
        ),
      );
    }
    const sr = coord.signal_routing;
    if (sr?.safety_healthy) {
      const gateName = (id: string) =>
        contract.safety_gates.find((g) => g.gate_id === id)?.name ?? id;
      out.push(
        note(
          `Safety-healthy = ${sr.safety_healthy.gate_ids.map(gateName).join(" AND ")}${sr.safety_healthy.exclude_maintenance ? " AND NOT maintenance mode" : ""}. On unhealthy: all equipment modules commanded to STOP and the unit is driven to its abort state.${sr.command_routing?.seq_test_release ? " Sequence-test mode releases command routing to the commissioning dashboard." : ""}`,
        ),
      );
    }
    if (sr?.routing_rows.length) {
      const detentRole = (row: RoutingRow): string => {
        for (const d of sr.two_detent) {
          if (d.jog_row_id === row.row_id) return d.fallback ? "jog (fast falls back here)" : "jog (suppressed by fast)";
          if (d.fast_row_id === row.row_id) return "fast (wins over jog)";
        }
        return "—";
      };
      out.push(
        table(
          ["Target", "Source", "Gates", "Two-detent"],
          sr.routing_rows.map(
            (row) =>
              new TableRow({
                children: [
                  cell(`${emName(row.target.equipment_module_id)}.${row.target.pin}`, true),
                  cell(refText(row.source, emName), true),
                  cell(row.gates.length ? row.gates.map((g) => refText(g, emName)).join(" AND ") : "—", true),
                  cell(detentRole(row)),
                ],
              }),
          ),
        ),
      );
    }
    if (coord.axes?.length) {
      out.push(
        table(
          ["Axis", "Definition"],
          coord.axes.map(
            (a) => new TableRow({ children: [cell(a.axis_id, true), cell(axisText(a))] }),
          ),
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 9.4 Maintenance layer
// ---------------------------------------------------------------------------

function buildMaintenanceSection(contract: SpecContractV2): Block[] {
  const outputs = contract.maintenance?.overridable_outputs ?? [];
  const presets = contract.engineering?.encoder_presets ?? [];
  if (!outputs.length && !presets.length) return [];
  const out: Block[] = [h3("9.4 Maintenance & Commissioning Layer")];
  if (outputs.length) {
    out.push(
      note("Outputs the commissioning override block may drive while maintenance mode is active (override runs last in the PLC cycle so its writes win)."),
      table(
        ["Output tag", "Wire check only", "Description"],
        outputs.map(
          (o) =>
            new TableRow({
              children: [cell(o.tag, true), cell(o.wire_check_only ? "yes" : "no"), cell(o.description ?? "—")],
            }),
        ),
      ),
    );
  }
  if (presets.length) {
    out.push(
      note("Encoder-preset channels (TR profile: control byte + value word out, status byte in). Presets are one-shot pulses, only in maintenance mode."),
      table(
        ["Unit / axis", "Control", "Value", "Status"],
        presets.map(
          (p) =>
            new TableRow({
              children: [cell(`${p.unit_id} / ${p.axis_id}`, true), cell(p.ctrl_address, true), cell(p.value_address, true), cell(p.status_address, true)],
            }),
        ),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Section 9 — Controls Engineering Data. Empty array when the contract
 *  carries none of the models (section omitted entirely). */
export function buildControlsDataSections(contract: SpecContractV2): Block[] {
  const body = [
    ...buildDriveSection(contract),
    ...buildIoTreatmentSection(contract),
    ...buildUnitCoordinationSection(contract),
    ...buildMaintenanceSection(contract),
  ];
  if (!body.length) return [];
  return [h2("9. Controls Engineering Data"), ...body];
}
