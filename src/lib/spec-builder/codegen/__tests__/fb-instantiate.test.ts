// src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts
import { describe, it, expect } from "vitest";
import { pickTemplate, instantiateControlModule } from "../fb-instantiate";
import type { ControlModuleV2, IoSignalV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { FbInterfaceContract } from "@/types/fb-interface";

const tmpl = (over: Partial<FbTemplate>): FbTemplate => ({
  id: "t1", name: "Motor_Std", device_category: "motor", plc_brand: "SIEMENS_TIA",
  description: null, ai_summary: null, diagram_chart: null, diagram_generated_at: null,
  flow_diagram_json: null, flow_diagram_generated_at: null, version: 1, tags: [],
  source: "library", library_name: null, is_enabled: true, is_equipment_module: false,
  documentation: null, hmi_faceplate_type: null, created_by: null,
  updated_at: "", created_at: "",
  blocks: [{ id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB", scl_code: "", block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" }],
  ...over,
});

const motorCm: ControlModuleV2 = {
  control_module_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", control_module_name: "M01", control_module_class: "motor",
  is_safety: false, description: "drive motor",
  io_signals: [
    { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "run", source: "wired" },
    { tag: "M01_Fault", signal_type: "DI", io_address: "I0.0", description: "fault", source: "wired" },
  ],
};

describe("pickTemplate", () => {
  it("matches by device_category against the device class", () => {
    const t = pickTemplate("M01", "motor", false, [tmpl({}), tmpl({ id: "t2", device_category: "valve" })]);
    expect(t?.id).toBe("t1");
  });
  it("respects the equipment-module flag", () => {
    expect(pickTemplate("Conv", "conveyor", true, [tmpl({})])).toBeNull(); // t1 is CM-level
  });
  it("returns null when nothing scores", () => {
    expect(pickTemplate("Widget", "gizmo", false, [tmpl({ device_category: "valve", name: "Valve", tags: [] })])).toBeNull();
  });
});

describe("instantiateControlModule", () => {
  it("emits an instance DB + call when matched", () => {
    const r = instantiateControlModule(motorCm, [tmpl({})]);
    expect(r.stub).toBeNull();
    expect(r.artifacts.some((a) => a.type === "DB")).toBe(true);
    expect(r.callLines.join("\n")).toContain("(");
    expect(r.callLines.join("\n")).toContain('M01_Fault := "I0.0"');
    expect(r.callLines.join("\n")).toContain('"Q0.0" := "CM_Motor_M01_DB".M01_Run');
    const db = r.artifacts.find((a) => a.type === "DB");
    expect(db?.layer).toBe("device");
    expect(db?.ownerId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(db?.ownerName).toBe("M01");
  });
  it("emits a stub FB with typed interface when unmatched", () => {
    const r = instantiateControlModule(motorCm, []);
    expect(r.stub).not.toBeNull();
    const fb = r.artifacts.find((a) => a.type === "FB");
    expect(fb?.name).toBe("CM_M01");
    expect(fb?.content).toContain("M01_Fault : Bool;");   // DI input
    expect(fb?.content).toContain("M01_Run : Bool;");     // DO output
    // C2: stub must also emit its instance DB
    const db = r.artifacts.find((a) => a.type === "DB");
    expect(db?.name).toBe("CM_M01_DB");
    expect(db?.content).toContain('"CM_M01"');             // instantiates the stub FB
    expect(db?.dependencies).toContain("CM_M01");
    expect(r.callLines.join("\n")).toContain('"CM_M01_DB"('); // call targets the real DB
    expect(fb?.layer).toBe("device");
    expect(fb?.ownerName).toBe("M01");
    expect(db?.layer).toBe("device");
  });
});

// --- C1 Task 5: role-based interface_contract wiring -----------------------

const contractIo: IoSignalV2[] = [
  { tag: "open_fb", signal_type: "DI", io_address: "I0.0", description: "open fb", source: "wired" },
  { tag: "run_cmd", signal_type: "DO", io_address: "Q0.0", description: "run cmd", source: "wired" },
];

function contractCm(io: IoSignalV2[] = contractIo): ControlModuleV2 {
  return {
    control_module_id: "cm1", control_module_name: "M01", control_module_class: "motor",
    is_safety: false, description: "",
    io_signals: io,
  } as ControlModuleV2;
}

const reviewedContract: FbInterfaceContract = {
  block_name: "CM_Motor", reviewed: true, generated_at: "", states: [],
  pins: [
    { name: "open_fb", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "io_input", exposed: true, description: "" },
    { name: "run_cmd", scl_type: "Bool", direction: "output", role: "actuator_out", default_binding: "io_output", exposed: true, description: "" },
  ],
};

describe("instantiate contract wiring", () => {
  it("wires by role when the contract is reviewed", () => {
    const r = instantiateControlModule(contractCm(), [tmpl({ interface_contract: reviewedContract })]);
    expect(r.callLines.join("\n")).toContain(`open_fb := "I0.0"`);
    expect(r.callLines.join("\n")).toContain(`"Q0.0" := "CM_Motor_M01_DB".run_cmd;`);
    expect(r.warnings).toHaveLength(0);
  });

  it("falls back to tag wiring with a warning when the contract is unreviewed", () => {
    const r = instantiateControlModule(contractCm(), [tmpl({ interface_contract: { ...reviewedContract, reviewed: false } })]);
    expect(r.callLines.join("\n")).toContain(`open_fb := "I0.0"`); // tag wiring (tag === pin name here)
    expect(r.warnings[0]).toContain("not reviewed");
  });

  it("falls back silently when there is no contract", () => {
    const r = instantiateControlModule(contractCm(), [tmpl({ interface_contract: null })]);
    expect(r.callLines.join("\n")).toContain(`open_fb := "I0.0"`);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns on surplus signals not covered by contract pins", () => {
    const extra: IoSignalV2[] = [
      ...contractIo,
      { tag: "stop_fb", signal_type: "DI", io_address: "I0.1", description: "stop fb", source: "wired" },
    ];
    const r = instantiateControlModule(contractCm(extra), [tmpl({ interface_contract: reviewedContract })]);
    expect(r.warnings.some((w) => w.includes("input signal(s) unmapped"))).toBe(true);
  });
});
