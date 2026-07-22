import { describe, expect, it } from "vitest";
import { SpecContractPatchSchema, validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { validateEmStateMachine } from "@/lib/spec-builder/em-state-machine";
import { assembleRandomFds } from "../assemble";
import type { RandomFdsTheme } from "../theme-schema";

function makeTheme(units: number, equipment_modules: number, control_modules: number): RandomFdsTheme {
  const subs = Array.from({ length: units }, (_, si) => {
    const asmsForSub = Math.max(1, Math.floor(equipment_modules / units) + (si === 0 ? equipment_modules % units : 0));
    return {
      unit_name: `SS${si + 1}`,
      equipment_type: "Conveyor",
      description: "",
      equipment_modules: Array.from({ length: asmsForSub }, (_, ai) => ({
        equipment_module_name: `ASM${si + 1}-${ai + 1}`,
        description: "",
        control_modules: Array.from({ length: Math.max(1, Math.floor(control_modules / equipment_modules)) }, (_, di) => ({
          control_module_name: `M${di + 1}`,
          control_module_class: "motor" as const,
          description: "",
          is_safety: false,
        })),
      })),
    };
  });
  return {
    title: "Test Random Spec",
    system_description: "x",
    plc_model: "S7-1500",
    hmi_type: "TP1200",
    fault_philosophy: "x",
    design_principles: ["x"],
    machine_theme: "x",
    safety_classification: null,
    units: subs,
  };
}

describe("assembleRandomFds — patch passes validator", () => {
  const cases = [
    { units: 1, equipment_modules: 1, control_modules: 3, label: "min" },
    { units: 3, equipment_modules: 6, control_modules: 18, label: "mid" },
    { units: 8, equipment_modules: 20, control_modules: 60, label: "max" },
  ];

  for (const c of cases) {
    it(`${c.label} (${c.units}×${c.equipment_modules}×${c.control_modules}) produces a validator-passing patch`, () => {
      const theme = makeTheme(c.units, c.equipment_modules, c.control_modules);
      const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });

      const parsed = SpecContractPatchSchema.safeParse(result.patch);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format(), null, 2)).toBe(true);

      if (parsed.success) {
        const issues = validateSpecContractPatch(parsed.data);
        expect(issues, issues.join("\n")).toEqual([]);
      }
    });
  }

  it("populates instrument register with one tag per IO signal", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    // motor has 3 IO slots → 12 control_modules × 3 = 36 tags
    expect(result.instrumentRegister.tags).toHaveLength(36);
    const addrs = new Set(result.instrumentRegister.tags.map((t) => t.io_address));
    expect(addrs.size).toBe(result.instrumentRegister.tags.length);
  });

  it("emits one 'fault' alarm per motor (control_modules with a FAULT IO slot)", () => {
    const theme = makeTheme(2, 4, 12); // 12 motors, each has FAULT slot
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.patch.alarms).toBeDefined();
    expect(result.patch.alarms).toHaveLength(12);
    for (const a of result.patch.alarms!) {
      expect(a.tier_id).toBe("critical");
      expect(a.tag).toMatch(/_FAULT$/);
    }
  });

  it("produces one equipment_module session row per equipment_module", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.equipment_moduleSessions).toHaveLength(4);
    for (const row of result.equipment_moduleSessions) {
      expect(row.status).toBe("complete");
      expect(row.static_confirmed).toBe(true);
    }
  });

  it("emits no global states array or unit_procedures on the patch (hybrid model)", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.patch.states).toBeUndefined();
    // unit_procedures was removed from the contract entirely (hybrid model).
    expect("unit_procedures" in result.patch).toBe(false);
    expect("unit_procedures" in result).toBe(false);
  });

  it("emits machine-level safety_gates on the patch", () => {
    // Theme with a safety control_module → its IO tags become safety gates.
    const theme: RandomFdsTheme = {
      title: "Safety Theme",
      system_description: "x",
      plc_model: "S7-1500",
      hmi_type: "TP1200",
      fault_philosophy: "x",
      design_principles: ["x"],
      machine_theme: "x",
      safety_classification: null,
      units: [
        {
          unit_name: "SS1",
          equipment_type: "Conveyor",
          description: "",
          equipment_modules: [
            {
              equipment_module_name: "ASM1",
              description: "",
              control_modules: [
                { control_module_name: "M1", control_module_class: "motor", description: "", is_safety: false },
                { control_module_name: "ES1", control_module_class: "emergency_stop", description: "", is_safety: true },
              ],
            },
          ],
        },
      ],
    };
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.patch.safety_gates).toBeDefined();
    expect(result.patch.safety_gates!.length).toBeGreaterThan(0);
    for (const g of result.patch.safety_gates!) {
      expect(g.scope).toBe("all");
      expect(g.condition.length).toBeGreaterThan(0);
    }
  });

  it("attaches a per-EM state machine to every equipment module contract", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    const ems = Object.values(result.patch.equipment_modules ?? {});
    expect(ems).toHaveLength(4);
    for (const ctr of ems) {
      expect(ctr.states.length).toBeGreaterThan(0);
      expect(ctr.transitions.length).toBeGreaterThan(0);
      expect(validateEmStateMachine(ctr)).toEqual([]);
    }
  });

  it("produces functional_description section rows for every (equipment_module, state) pair", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    // 4 equipment_modules × 6 states = 24
    expect(result.functionalDescriptionRows).toHaveLength(24);
  });

  it("disambiguates control_modules whose names collapse onto the same 12-char prefix", () => {
    // Regression: tokenisePrefix slices to 12 chars, so two control_modules with
    // long shared prefixes ("Dehumidifier Process Air 1" / "...2") produced
    // identical tag prefixes and tripped validateSpecContractPatch's global
    // IO-tag uniqueness check.
    const theme: RandomFdsTheme = {
      title: "Collision Theme",
      system_description: "x",
      plc_model: "S7-1500",
      hmi_type: "TP1200",
      fault_philosophy: "x",
      design_principles: ["x"],
      machine_theme: "x",
      safety_classification: null,
      units: [
        {
          unit_name: "Dehumidification",
          equipment_type: "Other",
          description: "",
          equipment_modules: [
            {
              equipment_module_name: "Process Air Loop",
              description: "",
              control_modules: [
                { control_module_name: "Dehumidifier Process Air Sensor 1", control_module_class: "sensor_temperature", description: "", is_safety: false },
                { control_module_name: "Dehumidifier Process Air Sensor 2", control_module_class: "sensor_temperature", description: "", is_safety: false },
                { control_module_name: "Dehumidifier Process Air Sensor 3", control_module_class: "sensor_temperature", description: "", is_safety: false },
              ],
            },
          ],
        },
      ],
    };
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });

    // Patch must pass the validator (zero issues).
    const parsed = SpecContractPatchSchema.safeParse(result.patch);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const issues = validateSpecContractPatch(parsed.data);
      expect(issues, issues.join("\n")).toEqual([]);
    }

    // All tags across the produced register must be globally unique.
    const tags = result.instrumentRegister.tags.map((t) => t.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("assembleRandomFds — controls-data seeding (G0-16 W3)", () => {
  function controlsTheme(): RandomFdsTheme {
    return {
      title: "Seeded", system_description: "x", plc_model: "S7-1500", hmi_type: "TP1200",
      fault_philosophy: "x", design_principles: ["x"], machine_theme: "x", safety_classification: null,
      units: [
        {
          unit_name: "Infeed", equipment_type: "Conveyor", description: "",
          equipment_modules: [
            {
              equipment_module_name: "Belt", description: "",
              control_modules: [
                { control_module_name: "CV1", control_module_class: "conveyor", description: "", is_safety: false },
                { control_module_name: "ES1", control_module_class: "emergency_stop", description: "", is_safety: true },
                { control_module_name: "PT1", control_module_class: "transmitter", description: "", is_safety: false },
              ],
            },
          ],
        },
      ],
    };
  }

  const result = assembleRandomFds(controlsTheme(), { projectId: "00000000-0000-0000-0000-000000000002" });
  const patch = result.patch;
  const cm = (cls: string) =>
    patch.hierarchy!.units[0].equipment_modules[0].control_modules.find(
      (c) => c.control_module_class === cls,
    )!;

  it("still passes the full patch gate with every seed path active", () => {
    const parsed = SpecContractPatchSchema.safeParse(patch);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format(), null, 2)).toBe(true);
    if (parsed.success) {
      const issues = validateSpecContractPatch(parsed.data);
      expect(issues, issues.join("\n")).toEqual([]);
    }
  });

  it("models conveyor CMs as VSDs with a tier-2 commissioning entry (HW ids left as TODOs)", () => {
    const conveyor = cm("conveyor");
    expect(conveyor.drive?.family).toBe("sinamics_g120");
    expect(conveyor.io_signals.some((s) => s.signal_type === "AO")).toBe(true);
    const entry = patch.engineering?.drives.find((d) => d.control_module_id === conveyor.control_module_id);
    expect(entry?.ref_speed_rpm).toBe(1500);
    expect(entry?.hw_id_stw).toBeUndefined();
  });

  it("wires safety DIs N/C fail-safe and scales every AI to the S7 ADC default", () => {
    const estop = cm("emergency_stop");
    expect(estop.io_signals.filter((s) => s.signal_type === "DI").every((s) => s.polarity === "nc")).toBe(true);
    const ai = cm("transmitter").io_signals.find((s) => s.signal_type === "AI")!;
    expect(ai.scaling?.raw).toEqual({ min: 5530, max: 27648, unit: "counts" });
  });

  it("seeds per-unit coordination: canonical states, EM-aggregate transitions, safety-healthy, axis from the transmitter", () => {
    const unitId = patch.hierarchy!.units[0].unit_id;
    const coord = patch.unit_coordination![unitId];
    expect(coord.states.map((s) => s.state_id)).toContain("aborting");
    expect(coord.transitions.some((t) => t.trigger.type === "em_aggregate" && t.trigger.em_state === "execute")).toBe(true);
    expect(coord.signal_routing?.safety_healthy?.gate_ids.length).toBeGreaterThan(0);
    expect(coord.axes?.[0].kind).toBe("linear");
    expect(coord.axes?.[0].encoder_tag).toContain("PT1");
  });

  it("marks the first DO tags overridable for the maintenance layer", () => {
    expect(patch.maintenance?.overridable_outputs.length).toBeGreaterThan(0);
    const doTags = patch.hierarchy!.units.flatMap((u) =>
      u.equipment_modules.flatMap((em) =>
        em.control_modules.flatMap((c) => c.io_signals.filter((s) => s.signal_type === "DO").map((s) => s.tag)),
      ),
    );
    for (const o of patch.maintenance!.overridable_outputs) {
      expect(doTags).toContain(o.tag);
    }
  });
});

describe("assembleRandomFds — end-to-end through the deterministic compiler (G0-16 W3)", () => {
  it("a seeded random spec exercises the G1–G5 writers: drive telegram, real UC, CFG/STAT, maintenance layer", async () => {
    const { compileContract } = await import("@/lib/spec-builder/codegen/compile-contract");
    const theme: RandomFdsTheme = {
      title: "E2E", system_description: "x", plc_model: "S7-1500", hmi_type: "TP1200",
      fault_philosophy: "x", design_principles: ["x"], machine_theme: "x", safety_classification: null,
      units: [
        {
          unit_name: "Infeed", equipment_type: "Conveyor", description: "",
          equipment_modules: [
            {
              equipment_module_name: "Belt", description: "",
              control_modules: [
                { control_module_name: "CV1", control_module_class: "conveyor", description: "", is_safety: false },
                { control_module_name: "ES1", control_module_class: "emergency_stop", description: "", is_safety: true },
                { control_module_name: "PT1", control_module_class: "transmitter", description: "", is_safety: false },
              ],
            },
          ],
        },
      ],
    };
    const { patch } = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000003" });
    const contract = {
      schema_version: 3,
      project: {},
      hierarchy: patch.hierarchy!,
      alarm_tiers: patch.alarm_tiers!,
      equipment_modules: patch.equipment_modules!,
      safety_gates: patch.safety_gates!,
      modes: patch.modes!,
      unit_coordination: patch.unit_coordination!,
      maintenance: patch.maintenance!,
      engineering: patch.engineering!,
      alarms: [], io_list: [], faults: [], sections: {},
      confirmation_status: "confirmed",
    } as unknown as import("@/types/spec-contract-v2").SpecContractV2;

    const res = compileContract(contract, []);
    const names = res.artifacts.map((a) => a.name);
    const all = res.artifacts.map((a) => a.content).join("\n");

    // G1: conveyor drive → SINA_SPEED telegram call + %→rpm scaling from ref_speed 1500
    expect(names.some((n) => n.startsWith("SINA_SPEED_"))).toBe(true);
    expect(all).toContain("* 15.0");
    // G1-3: speed feedback joined back through the inverse scaling
    expect(all).toContain("ActVelocity");
    // G2: real UC FB (not the stub), SM + mode manager + safety aggregation
    expect(names).toContain("UC_Infeed");
    expect(all).toContain('"UN_Infeed".St_Cmd');
    expect(all).toContain("#ok :=");
    // G2-5/G4: envelope geometry DBs from the transmitter-derived axis
    expect(names).toContain("CFG_Infeed");
    expect(names).toContain("STAT_Infeed");
    // G3/G5: maintenance layer present, override FC last in OB1
    expect(names).toContain("Maintenance_CMD");
    expect(names).toContain("MAINT_Output_Override");
    const ob = res.artifacts.find((a) => a.type === "OB")!.content;
    const lastCall = ob.trimEnd().split("\n").filter((l) => l.includes('"')).pop() ?? "";
    expect(lastCall).toContain("MAINT_Output_Override");
  });
});

describe("FULL project audit — FDS to code with nothing blocking (codegen-complete gate)", () => {
  it("a seeded 2-unit project compiles with zero stubs/blocks, well-formed artifacts, and only commissioning-pending TODOs", async () => {
    const { compileContract } = await import("@/lib/spec-builder/codegen/compile-contract");
    const theme: RandomFdsTheme = {
      title: "Full Audit", system_description: "x", plc_model: "S7-1500", hmi_type: "TP1200",
      fault_philosophy: "x", design_principles: ["x"], machine_theme: "x", safety_classification: null,
      units: [
        {
          unit_name: "Infeed", equipment_type: "Conveyor", description: "",
          equipment_modules: [
            { equipment_module_name: "Belt", description: "",
              control_modules: [
                { control_module_name: "CV1", control_module_class: "conveyor", description: "", is_safety: false },
                { control_module_name: "ES1", control_module_class: "emergency_stop", description: "", is_safety: true },
                { control_module_name: "PT1", control_module_class: "transmitter", description: "", is_safety: false },
              ] },
            { equipment_module_name: "Gate", description: "",
              control_modules: [
                { control_module_name: "SOL1", control_module_class: "valve", description: "", is_safety: false },
              ] },
          ],
        },
        {
          unit_name: "Process", equipment_type: "Dryer", description: "",
          equipment_modules: [
            { equipment_module_name: "Heater", description: "",
              control_modules: [
                { control_module_name: "HT1", control_module_class: "dryer", description: "", is_safety: false },
                { control_module_name: "M2", control_module_class: "motor", description: "", is_safety: false },
              ] },
          ],
        },
      ],
    };
    const { patch } = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000009" });
    const contract = {
      schema_version: 3, project: {},
      hierarchy: patch.hierarchy!, alarm_tiers: patch.alarm_tiers!,
      equipment_modules: patch.equipment_modules!, safety_gates: patch.safety_gates!,
      modes: patch.modes!, unit_coordination: patch.unit_coordination!,
      maintenance: patch.maintenance!, engineering: patch.engineering!,
      alarms: [], io_list: [], faults: [], sections: {}, confirmation_status: "confirmed",
    } as unknown as import("@/types/spec-contract-v2").SpecContractV2;

    const res = compileContract(contract, []);

    // 1. Nothing stubbed or blocked
    expect(res.stubs.controlModules).toEqual([]);
    expect(res.stubs.equipmentModules).toEqual([]);

    // 2. Every artifact is well-formed SCL of its declared type
    const HEAD: Record<string, string> = {
      FB: "FUNCTION_BLOCK", FC: "FUNCTION ", DB: "DATA_BLOCK", UDT: "TYPE", OB: "ORGANIZATION_BLOCK",
    };
    for (const a of res.artifacts) {
      expect(a.content.trim().length, `${a.name} empty`).toBeGreaterThan(0);
      expect(a.content.startsWith(HEAD[a.type]), `${a.name} malformed head`).toBe(true);
    }

    // 3. TODOs are ONLY the commissioning-pending set (values that can't exist
    //    before TIA HW config / site commissioning) — nothing structural
    const todos = res.artifacts
      .flatMap((a) => a.content.split("\n"))
      .filter((l) => l.includes("TODO"));
    const allowed = [
      /HWIDSTW|HWIDZSW|HW config/, // drive HW ids pend TIA hardware config
      /wire from the maintenance seam/, // absent maintenance layer only
    ];
    for (const t of todos) {
      expect(allowed.some((rx) => rx.test(t)), `unexpected TODO: ${t.trim()}`).toBe(true);
    }

    // 4. The full program shape is present
    const names = res.artifacts.map((a) => a.name);
    for (const expected of [
      "EM_Belt", "MAP_Belt", "Belt_CMD", "EM_Gate", "EM_Heater",
      "UC_Infeed", "UN_Infeed", "CFG_Infeed", "STAT_Infeed",
      "UC_Process", "UN_Process",
      "Maintenance_CMD", "MAINT_Output_Override", "Main",
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
    // drive telegram emitted with fault-ack wired (no TODO on AckError)
    const belt = res.artifacts.find((a) => a.name === "MAP_Belt")!.content;
    expect(belt).toContain('AckError := "EM_Belt_DB".cmd_reset');
  });
});
