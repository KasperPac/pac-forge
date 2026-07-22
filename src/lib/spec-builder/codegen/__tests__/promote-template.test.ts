// G6-7 — promote generated blocks into the FB library.
// deriveFbTemplate turns a Code Builder artifact bundle into an fb_template
// payload with a role-tagged interface contract + PackML states, so the
// coverage gate passes with zero hand-authoring.
import { describe, expect, it } from "vitest";
import { deriveFbTemplate } from "../promote-template";
import { instantiateControlModule } from "../fb-instantiate";
import type { FbTemplate } from "@/types/fb-template";
import type { ControlModuleV2 } from "@/types/spec-contract-v2";

const EM_FB_SCL = `FUNCTION_BLOCK "EM_Wash_Chamber"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      enable : Bool;
      mode : Int;
      cmd_start : Bool;
      cmd_stop : Bool;
      sp_wash_time : Int;
      ilk_door_ok : Bool;
      fb_door_closed : Bool;
      LS1_Level : Bool;
   END_VAR
   VAR_OUTPUT
      state : Int;
      step : Int;
      done : Bool;
      fault : Bool;
      SOL1_Cmd : Bool;
      P1_Run : Bool;
   END_VAR

BEGIN
   CASE #state OF
      0:   // Aborted (safe)
         ;
   END_CASE;
END_FUNCTION_BLOCK`;

const CM_FB_SCL = `FUNCTION_BLOCK "CM_P1_Pump"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      enable : Bool;
      cmd_P1_Run : Bool;
      P1_FB : Bool;
      P1_OL : Bool;
   END_VAR
   VAR_OUTPUT
      P1_Run : Bool;
   END_VAR
BEGIN
   IF #enable THEN
      #P1_Run := #cmd_P1_Run;
   ELSE
      #P1_Run := FALSE;
   END_IF;
END_FUNCTION_BLOCK`;

const emBundle = [
  { artifact_name: "EM_Wash_Chamber", type: "FB", content: EM_FB_SCL },
  { artifact_name: "Wash_Chamber_State", type: "UDT", content: `TYPE "Wash_Chamber_State"\nEND_TYPE` },
  { artifact_name: "EM_Wash_Chamber_DB", type: "DB", content: `DATA_BLOCK "EM_Wash_Chamber_DB"` },
  { artifact_name: "Wash_Chamber_CMD", type: "DB", content: `DATA_BLOCK "Wash_Chamber_CMD"` },
  { artifact_name: "MAP_Wash_Chamber", type: "FC", content: `FUNCTION "MAP_Wash_Chamber" : Void` },
];

const emStates = [
  { state_id: "aborted", name: "Aborted", is_safe_state: true },
  { state_id: "execute", name: "Execute", is_safe_state: false },
];

const GEN_AT = "2026-07-22T00:00:00.000Z";

describe("deriveFbTemplate (EM grain)", () => {
  const res = deriveFbTemplate({
    grain: "em",
    name: "Wash Chamber",
    deviceCategory: "equipment_module",
    blocks: emBundle,
    states: emStates,
    generatedAt: GEN_AT,
  });

  it("keeps only the reusable body blocks (UDT + FB), UDT first", () => {
    expect(res.template.blocks.map((b) => b.block_name)).toEqual([
      "Wash_Chamber_State",
      "EM_Wash_Chamber",
    ]);
    expect(res.template.blocks.map((b) => b.sort_order)).toEqual([0, 1]);
    expect(res.template.blocks.every((b) => b.programming_language === "SCL")).toBe(true);
  });

  it("skips per-project blocks (instance DBs, CMD DB, MAP FC) silently — by design, not a warning", () => {
    expect(res.warnings).toEqual([]);
  });

  it("marks the template as an equipment module with source 'custom'", () => {
    expect(res.template.is_equipment_module).toBe(true);
    expect(res.template.source).toBe("custom");
    expect(res.template.name).toBe("Wash Chamber");
    expect(res.template.device_category).toBe("equipment_module");
  });

  it("derives role-tagged pins deterministically from the FB interface", () => {
    const pin = (n: string) => res.contract.pins.find((p) => p.name === n)!;
    expect(pin("enable")).toMatchObject({ direction: "input", role: "cmd", default_binding: "em" });
    expect(pin("mode")).toMatchObject({ direction: "input", role: "mode", default_binding: "em", scl_type: "Int" });
    expect(pin("cmd_start")).toMatchObject({ role: "cmd", default_binding: "em" });
    expect(pin("sp_wash_time")).toMatchObject({ role: "param", default_binding: "hmi" });
    expect(pin("ilk_door_ok")).toMatchObject({ role: "interlock", default_binding: "em" });
    expect(pin("fb_door_closed")).toMatchObject({ role: "sensor_in", default_binding: "io_input" });
    expect(pin("LS1_Level")).toMatchObject({ role: "sensor_in", default_binding: "io_input" });
    expect(pin("state")).toMatchObject({ direction: "output", role: "status", exposed: true });
    expect(pin("done")).toMatchObject({ role: "status" });
    expect(pin("fault")).toMatchObject({ role: "fault" });
    expect(pin("SOL1_Cmd")).toMatchObject({ role: "actuator_out", default_binding: "io_output" });
    expect(pin("P1_Run")).toMatchObject({ role: "actuator_out", default_binding: "io_output" });
  });

  it("declares the FDS states (slug + safe flag) so the coverage gate passes", () => {
    expect(res.contract.states).toEqual([
      { slug: "aborted", name: "Aborted", is_safe: true },
      { slug: "execute", name: "Execute", is_safe: false },
    ]);
    expect(res.contract.block_name).toBe("EM_Wash_Chamber");
    // deterministic derivation from our own writers' conventions — born
    // reviewed, else buildWiring falls back to tag wiring and the promoted
    // contract never actually drives instantiation
    expect(res.contract.reviewed).toBe(true);
    expect(res.contract.generated_at).toBe(GEN_AT);
  });
});

describe("deriveFbTemplate (CM grain)", () => {
  const res = deriveFbTemplate({
    grain: "cm",
    name: "P1 Pump",
    deviceCategory: "pump",
    blocks: [{ artifact_name: "CM_P1_Pump", type: "FB", content: CM_FB_SCL }],
    generatedAt: GEN_AT,
  });

  it("is a device-level template with no declared states", () => {
    expect(res.template.is_equipment_module).toBe(false);
    expect(res.contract.states).toEqual([]);
  });

  it("maps the direct-control interface: cmd_ inputs, sensor inputs, actuator outputs", () => {
    const pin = (n: string) => res.contract.pins.find((p) => p.name === n)!;
    expect(pin("cmd_P1_Run")).toMatchObject({ role: "cmd", default_binding: "em" });
    expect(pin("P1_FB")).toMatchObject({ role: "sensor_in", default_binding: "io_input" });
    expect(pin("P1_OL")).toMatchObject({ role: "sensor_in" });
    expect(pin("P1_Run")).toMatchObject({ direction: "output", role: "actuator_out", exposed: true });
  });
});

describe("promote → instantiate round-trip", () => {
  it("a promoted CM template is matched by the G6 picker and wired by its contract in a new project", () => {
    const derivation = deriveFbTemplate({
      grain: "cm",
      name: "DOL Pump",
      deviceCategory: "pump",
      blocks: [{ artifact_name: "CM_P1_Pump", type: "FB", content: CM_FB_SCL }],
      generatedAt: GEN_AT,
    });

    // shape the persisted row the consumption path reads back
    const promoted = {
      id: "tpl-promoted",
      ...derivation.template,
      version: 1,
      interface_contract: derivation.contract,
      is_enabled: true,
      blocks: derivation.template.blocks.map((b, i) => ({
        id: `b${i}`,
        template_id: "tpl-promoted",
        block_xml: null,
        created_at: "",
        ...b,
      })),
    } as unknown as FbTemplate;

    // a DIFFERENT project's pump — same class, different tags/addresses
    const cm = {
      control_module_id: "cm-x",
      control_module_name: "P7 Rinse Pump",
      control_module_class: "pump",
      is_safety: false,
      description: "",
      io_signals: [
        { tag: "P7_P1_Run", signal_type: "DO", io_address: "Q4.0", description: "", source: "wired" },
        { tag: "P7_P1_FB", signal_type: "DI", io_address: "I4.0", description: "", source: "wired" },
      ],
    } as unknown as ControlModuleV2;

    const res = instantiateControlModule(cm, [promoted]);
    expect(res.stub).toBeNull();
    expect(res.artifacts.some((a) => a.name === "CM_P1_Pump")).toBe(true);
    const all = res.callLines.join("\n");
    // contract wiring (pin := address), not tag fallback — proves the born-
    // reviewed contract drives instantiation with zero hand-authoring
    expect(all).toContain(`P1_FB := "I4.0"`);
    expect(all).toContain(`"Q4.0" := "${res.instanceDb}".P1_Run;`);
  });
});

describe("deriveFbTemplate (edge cases)", () => {
  it("throws when the bundle has no FB block to promote", () => {
    expect(() =>
      deriveFbTemplate({
        grain: "cm",
        name: "X",
        deviceCategory: "misc",
        blocks: [{ artifact_name: "Some_DB", type: "DB", content: "DATA_BLOCK" }],
        generatedAt: GEN_AT,
      }),
    ).toThrow(/no FB/i);
  });

  it("warns and skips non-SCL artifacts instead of promoting unparseable bodies", () => {
    const res = deriveFbTemplate({
      grain: "em",
      name: "Wash Chamber",
      deviceCategory: "equipment_module",
      blocks: [...emBundle, { artifact_name: "OB_Main", type: "OB", content: "ORGANIZATION_BLOCK" }],
      states: emStates,
      generatedAt: GEN_AT,
    });
    expect(res.template.blocks.map((b) => b.block_name)).not.toContain("OB_Main");
    expect(res.warnings.some((w) => w.includes("OB_Main"))).toBe(true);
  });
});
