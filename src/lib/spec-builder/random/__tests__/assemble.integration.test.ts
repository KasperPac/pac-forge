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
