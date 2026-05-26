import { describe, expect, it } from "vitest";
import { SpecContractPatchSchema, validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { assembleRandomFds } from "../assemble";
import type { RandomFdsTheme } from "../theme-schema";

function makeTheme(subsystems: number, assemblies: number, devices: number): RandomFdsTheme {
  const subs = Array.from({ length: subsystems }, (_, si) => {
    const asmsForSub = Math.max(1, Math.floor(assemblies / subsystems) + (si === 0 ? assemblies % subsystems : 0));
    return {
      subsystem_name: `SS${si + 1}`,
      equipment_type: "Conveyor",
      description: "",
      assemblies: Array.from({ length: asmsForSub }, (_, ai) => ({
        assembly_name: `ASM${si + 1}-${ai + 1}`,
        description: "",
        devices: Array.from({ length: Math.max(1, Math.floor(devices / assemblies)) }, (_, di) => ({
          device_name: `M${di + 1}`,
          device_class: "motor" as const,
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
    subsystems: subs,
  };
}

describe("assembleRandomFds — patch passes validator", () => {
  const cases = [
    { subsystems: 1, assemblies: 1, devices: 3, label: "min" },
    { subsystems: 3, assemblies: 6, devices: 18, label: "mid" },
    { subsystems: 8, assemblies: 20, devices: 60, label: "max" },
  ];

  for (const c of cases) {
    it(`${c.label} (${c.subsystems}×${c.assemblies}×${c.devices}) produces a validator-passing patch`, () => {
      const theme = makeTheme(c.subsystems, c.assemblies, c.devices);
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
    // motor has 3 IO slots → 12 devices × 3 = 36 tags
    expect(result.instrumentRegister.tags).toHaveLength(36);
    const addrs = new Set(result.instrumentRegister.tags.map((t) => t.io_address));
    expect(addrs.size).toBe(result.instrumentRegister.tags.length);
  });

  it("emits one 'fault' alarm per motor (devices with a FAULT IO slot)", () => {
    const theme = makeTheme(2, 4, 12); // 12 motors, each has FAULT slot
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.patch.alarms).toBeDefined();
    expect(result.patch.alarms).toHaveLength(12);
    for (const a of result.patch.alarms!) {
      expect(a.tier_id).toBe("critical");
      expect(a.tag).toMatch(/_FAULT$/);
    }
  });

  it("produces one assembly session row per assembly", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.assemblySessions).toHaveLength(4);
    for (const row of result.assemblySessions) {
      expect(row.status).toBe("complete");
      expect(row.static_confirmed).toBe(true);
    }
  });

  it("produces one orchestration row per multi-assembly subsystem", () => {
    const theme = makeTheme(2, 4, 12); // 2 assemblies per subsystem ⇒ both eligible
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.orchestrations).toHaveLength(2);
  });

  it("produces functional_description section rows for every (assembly, state) pair", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    // 4 assemblies × 6 states = 24
    expect(result.functionalDescriptionRows).toHaveLength(24);
  });

  it("disambiguates devices whose names collapse onto the same 12-char prefix", () => {
    // Regression: tokenisePrefix slices to 12 chars, so two devices with
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
      subsystems: [
        {
          subsystem_name: "Dehumidification",
          equipment_type: "Other",
          description: "",
          assemblies: [
            {
              assembly_name: "Process Air Loop",
              description: "",
              devices: [
                { device_name: "Dehumidifier Process Air Sensor 1", device_class: "sensor_temperature", description: "", is_safety: false },
                { device_name: "Dehumidifier Process Air Sensor 2", device_class: "sensor_temperature", description: "", is_safety: false },
                { device_name: "Dehumidifier Process Air Sensor 3", device_class: "sensor_temperature", description: "", is_safety: false },
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
