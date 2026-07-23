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
  blocks: [{ id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB", scl_code: 'FUNCTION_BLOCK "CM_Motor"\nEND_FUNCTION_BLOCK\n', block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" }],
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

  it("exposes the instance DB name and contract for a matched CM", () => {
    const r = instantiateControlModule(contractCm(), [tmpl({ interface_contract: reviewedContract })]);
    expect(r.instanceDb).toBe("CM_Motor_M01_DB");
    expect(r.contract).not.toBeNull();
    expect(r.contract?.block_name).toBe("CM_Motor");
  });

  it("exposes a stub instance DB name and null contract when nothing matched", () => {
    const r = instantiateControlModule(contractCm(), []);
    expect(r.instanceDb).toMatch(/_DB$/);
    expect(r.contract).toBeNull();
  });
});

describe("instantiateControlModule — template body emission (G6-1)", () => {
  const bodied = (over: Partial<FbTemplate> = {}) =>
    tmpl({
      blocks: [
        { id: "b0", template_id: "t1", block_name: "UDT_Motor", block_type: "UDT", scl_code: 'TYPE "UDT_Motor"\nEND_TYPE\n', block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" },
        { id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB", scl_code: 'FUNCTION_BLOCK "CM_Motor"\nEND_FUNCTION_BLOCK\n', block_xml: null, programming_language: "SCL", sort_order: 1, created_at: "" },
      ],
      ...over,
    });

  it("emits every template block's SCL body ahead of the instance DB, in sort order with chained deps", () => {
    const r = instantiateControlModule(motorCm, [bodied()]);
    const names = r.artifacts.map((a) => a.name);
    expect(names).toEqual(["UDT_Motor", "CM_Motor", "CM_Motor_M01_DB"]);
    const fb = r.artifacts.find((a) => a.name === "CM_Motor")!;
    expect(fb.type).toBe("FB");
    expect(fb.filename).toBe("CM_Motor.scl");
    expect(fb.content).toContain('FUNCTION_BLOCK "CM_Motor"');
    expect(fb.dependencies).toEqual(["UDT_Motor"]);
    const udt = r.artifacts.find((a) => a.name === "UDT_Motor")!;
    expect(udt.filename).toBe("UDT_Motor.udt");
  });

  it("stamps a UDT block's folder as 'PLC data types', keeping other blocks in 'Library' (G5-4 final-review finding 3)", () => {
    const r = instantiateControlModule(motorCm, [bodied()]);
    const udt = r.artifacts.find((a) => a.name === "UDT_Motor")!;
    const fb = r.artifacts.find((a) => a.name === "CM_Motor")!;
    expect(udt.folder).toBe("PLC data types");
    expect(fb.folder).toBe("Library");
  });

  it("skips standard-instruction templates' bodies (they ship with TIA)", () => {
    const r = instantiateControlModule(motorCm, [bodied({ source: "standard" })]);
    expect(r.artifacts.map((a) => a.name)).toEqual(["CM_Motor_M01_DB"]);
  });

  it("skips non-SCL blocks with a warning (XML import path not wired)", () => {
    const t = tmpl({
      blocks: [
        { id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB", scl_code: "", block_xml: "<FlgNet/>", programming_language: "LAD", sort_order: 0, created_at: "" },
      ],
    });
    const r = instantiateControlModule(motorCm, [t]);
    expect(r.artifacts.map((a) => a.name)).toEqual(["CM_Motor_M01_DB"]);
    expect(r.warnings.some((w) => w.includes("LAD") && w.includes("CM_Motor"))).toBe(true);
  });
});

describe("contract wiring — name-based roles (G6-3)", () => {
  const contract: FbInterfaceContract = {
    block_name: "CM_Motor",
    pins: [
      { name: "fb_running", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
      { name: "fb_fault", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
      { name: "act_run", scl_type: "Bool", direction: "output", role: "actuator_out", default_binding: "io_output", exposed: true, description: "" },
    ],
    states: [], reviewed: true, generated_at: "2026-06-30T00:00:00Z",
  };

  // signals deliberately ordered so POSITIONAL pairing would mis-wire:
  // fault first, running second
  const cm: ControlModuleV2 = {
    control_module_id: "cm-uuid-1", control_module_name: "M01", control_module_class: "motor",
    is_safety: false, description: "",
    io_signals: [
      { tag: "M01_Fault", signal_type: "DI", io_address: "I0.1", description: "", source: "wired" },
      { tag: "M01_Running", signal_type: "DI", io_address: "I0.0", description: "", source: "wired" },
      { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "", source: "wired" },
    ],
  };

  it("wires pins to signals by name tokens, not position", () => {
    const r = instantiateControlModule(cm, [tmpl({ interface_contract: contract })]);
    const call = r.callLines.join("\n");
    expect(call).toContain('fb_running := "I0.0"'); // M01_Running, NOT the positional I0.1
    expect(call).toContain('fb_fault := "I0.1"');
    expect(call).toContain('"Q0.0" := "CM_Motor_M01_DB".act_run;');
    expect(r.warnings).toEqual([]);
  });

  it("explicit fb_assignment pin bindings override name matching and its template_id forces the template", () => {
    const weirdContract: FbInterfaceContract = {
      ...contract,
      pins: [
        { name: "in_a", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
        { name: "out_b", scl_type: "Bool", direction: "output", role: "actuator_out", default_binding: "io_output", exposed: true, description: "" },
      ],
    };
    const templates = [
      tmpl({ id: "t-wrong", device_category: "motor" }),
      tmpl({ id: "t-assigned", name: "Special", device_category: "pump", interface_contract: weirdContract }),
    ];
    const r = instantiateControlModule(cm, templates, [
      {
        target_kind: "control_module", target_id: "cm-uuid-1", template_id: "t-assigned",
        pin_bindings: [
          { pin: "in_a", tag: "M01_Fault" },
          { pin: "out_b", tag: "M01_Run" },
        ],
      },
    ]);
    const call = r.callLines.join("\n");
    expect(call).toContain('in_a := "I0.1"');
    expect(call).toContain('"Q0.0" := "CM_Motor_M01_DB".out_b;');
    // M01_Running is deliberately left unbound — only the leftover warning fires
    expect(r.warnings).toEqual(["CM_Motor_M01_DB: 1 input signal(s) unmapped by contract"]);
  });

  it("warns and leaves a pin unbound instead of guessing when no name matches", () => {
    const noMatch: FbInterfaceContract = {
      ...contract,
      pins: [
        { name: "fb_pressure", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
      ],
    };
    const r = instantiateControlModule(cm, [tmpl({ interface_contract: noMatch })]);
    expect(r.callLines.join("\n")).not.toContain("fb_pressure :=");
    expect(r.warnings.some((w) => w.includes("fb_pressure") && w.includes("unbound"))).toBe(true);
  });

  it("warns on ambiguous candidates instead of picking one", () => {
    const ambiguous: ControlModuleV2 = {
      ...cm,
      io_signals: [
        { tag: "M01_Run_A", signal_type: "DI", io_address: "I0.0", description: "", source: "wired" },
        { tag: "M01_Run_B", signal_type: "DI", io_address: "I0.1", description: "", source: "wired" },
      ],
    };
    const oneRunPin: FbInterfaceContract = {
      ...contract,
      pins: [
        { name: "fb_run", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
      ],
    };
    const r = instantiateControlModule(ambiguous, [tmpl({ interface_contract: oneRunPin })]);
    expect(r.callLines.join("\n")).not.toContain("fb_run :=");
    expect(r.warnings.some((w) => w.includes("fb_run") && w.includes("ambiguous"))).toBe(true);
  });
});

describe("stub FB — functional direct control (G6-5)", () => {
  it("drives each output from a cmd_ input gated on enable, safe when disabled", () => {
    const r = instantiateControlModule(motorCm, []);
    const fb = r.artifacts.find((a) => a.type === "FB")!;
    expect(fb.content).toContain("enable : Bool;");
    expect(fb.content).toContain("cmd_M01_Run : Bool;");
    expect(fb.content).toContain("IF #enable THEN");
    expect(fb.content).toContain("#M01_Run := #cmd_M01_Run;");
    expect(fb.content).toContain("#M01_Run := FALSE;");
    expect(fb.content).not.toContain("Stub - body to be implemented");
  });
});
