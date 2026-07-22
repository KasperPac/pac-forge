import { describe, expect, it } from "vitest";
import { mapSpecContractToFdsView } from "../fds-viewmodel.js";
import { renderFdsToHtml } from "../render-fds.js";

/** Minimal generic Spec Contract V2 shape — machine-agnostic fixture. */
const contract = {
  project: {
    doc_code: "FDS-TEST-001",
    title: "Widget Assembly Cell",
    client_name: "Acme Manufacturing",
    plc_model: "Test PLC 5000",
    system_description: "A cell that assembles widgets.",
    design_principles: ["Keep it simple"],
    scope_exclusions: ["Robot .src programs"],
    fault_philosophy: "Latch until reset.",
    safety_classification: "E-stop category 1",
  },
  hierarchy: {
    units: [
      {
        unit_id: "u1",
        unit_name: "Assembly Unit",
        equipment_modules: [
          {
            equipment_module_id: "em1",
            equipment_module_name: "Feeder",
            description: "Feeds widgets.",
            control_modules: [
              {
                control_module_name: "Feed Motor",
                control_module_class: "motor",
                is_safety: false,
                description: "Drives the feed belt.",
                network_config: {
                  protocol: "ethernet_ip",
                  ip_address: "192.168.0.10",
                  station_name: "FEED01",
                  update_cycle_ms: 20,
                },
              },
            ],
          },
        ],
      },
    ],
  },
  equipment_modules: {
    em1: {
      states: [
        { state_id: "idle", name: "Idle", kind: "static", is_safe_state: false },
        { state_id: "execute", name: "Execute", kind: "sequential", is_safe_state: false },
        { state_id: "aborted", name: "Aborted", kind: "static", is_safe_state: true },
      ],
      sequential_states: {
        execute: {
          permissives: [{ tag: "SYS.Run", operator: "=", value: true }],
          steps: [
            {
              step: 1,
              action: "Start the feed belt.",
              completion_criteria: [],
              completion_criteria_text: "Widget at pick position",
            },
          ],
          notes: "Test note.",
        },
      },
    },
  },
  modes: [
    { mode_id: "auto", name: "Automatic", kind: "production", is_default: true, description: "Normal." },
  ],
  io_list: [
    {
      tag: "SEN01",
      device_type: "photoelectric",
      signal_type: "DI",
      io_address: "Local:1:I.0",
      description: "Widget present",
    },
  ],
  faults: [
    {
      fault_code: "F1",
      description: "E-stop pressed",
      triggered_by_tag: "ESTOP_1",
      severity: "critical",
      affected_control_modules: [],
      action_text: "All EMs to safe state.",
    },
  ],
  alarms: [],
};

describe("FDS view-model mapping + template render", () => {
  it("maps a contract and renders the full document HTML", async () => {
    const fds = mapSpecContractToFdsView(contract, {
      revision: "01",
      date_display: "20 July 2026",
      subtitle: "Assembly Unit",
      author: "Test Author",
    });

    expect(fds.functional).toHaveLength(1);
    expect(fds.functional[0].sequences[0].state_name).toBe("Execute");
    expect(fds.architecture.devices[0].ip).toBe("192.168.0.10");
    expect(fds.alarms[0].sev).toBe("critical");

    const html = await renderFdsToHtml(fds);
    // Cover + doc card
    expect(html).toContain("Widget Assembly Cell");
    expect(html).toContain("FDS-TEST-001");
    expect(html).toContain("Acme Manufacturing");
    // Section anatomy per the design system
    expect(html).toContain('class="fds-kicker"');
    expect(html).toContain("Functional descriptions");
    // Functional content
    expect(html).toContain("Feeder");
    expect(html).toContain("Widget at pick position");
    // `=` is HTML-escaped by Handlebars; renders as "SYS.Run = true".
    expect(html).toContain("SYS.Run &#x3D; true");
    // Severity styling hook
    expect(html).toContain("fds-sev--critical");
    // I/O row
    expect(html).toContain("SEN01");
  });
});
