// src/lib/spec-builder/__tests__/docx-controls-data.test.ts
//
// G0-16 W4 — Section 9 renders exactly the controls models the contract
// carries. Structural assertions: docx object internals aren't a public API,
// so we assert block presence/absence and extract text from the XML tree.
import { describe, expect, it } from "vitest";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { buildControlsDataSections } from "../docx-controls-data";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

function bareContract(): SpecContractV2 {
  return {
    schema_version: 3,
    project: {},
    hierarchy: {
      units: [
        {
          unit_id: "u1", unit_name: "Infeed", equipment_type: "cell", description: "", excluded: false,
          equipment_modules: [
            {
              equipment_module_id: "em1", equipment_module_name: "Belt", description: "",
              control_modules: [
                {
                  control_module_id: "cm1", control_module_name: "CV1", control_module_class: "conveyor",
                  is_safety: false, description: "", io_signals: [],
                },
              ],
            },
          ],
        },
      ],
    },
    alarm_tiers: [], equipment_modules: {}, safety_gates: [], alarms: [], io_list: [], faults: [],
    sections: {}, confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

async function renderText(blocks: ReturnType<typeof buildControlsDataSections>): Promise<string> {
  const doc = new Document({ sections: [{ children: blocks }] });
  const b64 = await Packer.toBase64String(doc);
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  return zip.file("word/document.xml")!.async("string");
}

describe("buildControlsDataSections", () => {
  it("returns nothing when the contract carries no controls models", () => {
    expect(buildControlsDataSections(bareContract())).toEqual([]);
  });

  it("renders the drive table joined with tier-2 values and commissioning placeholders", async () => {
    const c = bareContract();
    c.hierarchy.units[0].equipment_modules[0].control_modules[0].drive = {
      family: "sinamics_g120", telegram: 1,
      speed_ref: { unit: "percent_ref_speed", signed: false },
      enable_policy: "enable_on_nonzero_ref",
    };
    c.engineering = {
      drives: [{ control_module_id: "cm1", ref_speed_rpm: 1500, config_axis: 63 }],
      axis_constants: [], encoder_presets: [], fb_assignments: [], upstream_endpoints: [],
    } as SpecContractV2["engineering"];
    const blocks = buildControlsDataSections(c);
    expect(blocks.length).toBeGreaterThan(0);
    const text = await renderText(blocks);
    expect(text).toContain("Controls Engineering Data");
    expect(text).toContain("Drive / VSD Integration");
    expect(text).toContain("sinamics_g120");
    expect(text).toContain("1500 rpm");
    expect(text).toContain("commissioning"); // HW ids unrecorded
  });

  it("renders IO treatment rows only for signals carrying a model", async () => {
    const c = bareContract();
    c.hierarchy.units[0].equipment_modules[0].control_modules[0].io_signals = [
      { tag: "CV1_FAULT", signal_type: "DI", io_address: "I0.0", description: "", source: "wired", polarity: "nc" },
      { tag: "CV1_FB", signal_type: "DI", io_address: "I0.1", description: "", source: "wired" },
    ] as SpecContractV2["hierarchy"]["units"][0]["equipment_modules"][0]["control_modules"][0]["io_signals"];
    const text = await renderText(buildControlsDataSections(c));
    expect(text).toContain("IO Signal Treatment");
    expect(text).toContain("CV1_FAULT");
    expect(text).toContain("N/C fail-safe");
    expect(text).not.toContain("CV1_FB<"); // untreated signal not tabled
  });

  it("renders unit coordination with transitions, safety prose, and axes", async () => {
    const c = bareContract();
    c.safety_gates = [
      { gate_id: "estop", name: "E-Stop Chain", condition: [{ tag: "ES_OK", operator: "=", value: true }], scope: "all" },
    ] as SpecContractV2["safety_gates"];
    c.unit_coordination = {
      u1: {
        unit_id: "u1",
        states: [
          { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
          { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
        ],
        transitions: [
          { transition_id: "t1", from_state_id: "idle", to_state_id: "execute",
            trigger: { type: "command", command: "start" }, guard: [], allowed_modes: [] },
        ],
        signal_routing: {
          safety_healthy: { gate_ids: ["estop"], exclude_maintenance: true },
          routing_rows: [
            { row_id: "r1", target: { equipment_module_id: "em1", pin: "ilk_Run" },
              source: { kind: "io_tag", tag: "Run_PB" }, gates: [{ kind: "named_gate", gate_id: "g_fwd" }] },
          ],
          two_detent: [],
          command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
        },
        axes: [
          { axis_id: "travel", kind: "linear", encoder_tag: "Enc", eu_unit: "mm",
            scale: { db_member: "s", retain: true, operator_settable: false },
            length: { db_member: "l", retain: true, operator_settable: true },
            end_margin: { db_member: "m", retain: true, operator_settable: false },
            ramp_zone: { db_member: "r", retain: true, operator_settable: false },
            gates: { fwd_ok: "g_fwd" }, unconfigured_open: true },
        ],
      },
    } as SpecContractV2["unit_coordination"];
    const text = await renderText(buildControlsDataSections(c));
    expect(text).toContain("Unit Coordination");
    expect(text).toContain("command START");
    expect(text).toContain("E-Stop Chain");
    expect(text).toContain("Belt.ilk_Run");
    expect(text).toContain("gate:g_fwd");
    expect(text).toContain("open while unconfigured");
  });

  it("renders the maintenance layer tables", async () => {
    const c = bareContract();
    c.maintenance = { overridable_outputs: [{ tag: "CV1_CMD", wire_check_only: false }] } as SpecContractV2["maintenance"];
    c.engineering = {
      drives: [], axis_constants: [], fb_assignments: [], upstream_endpoints: [],
      encoder_presets: [{ unit_id: "u1", axis_id: "travel", ctrl_address: "%QB70", value_address: "%QD71", status_address: "%IB78" }],
    } as SpecContractV2["engineering"];
    const text = await renderText(buildControlsDataSections(c));
    expect(text).toContain("Maintenance");
    expect(text).toContain("CV1_CMD");
    expect(text).toContain("%QB70");
  });
});
