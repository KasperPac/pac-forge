import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Supabase to capture writes without hitting a real database.
const writeCalls: Array<{ table: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => ({
        eq: () => {
          writeCalls.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  },
}));

import {
  writeSpecContract,
  validateSpecContractPatch,
  SpecContractPatchSchema,
} from "../contract";

describe("writeSpecContract patch routing — new keys", () => {
  beforeEach(() => {
    writeCalls.length = 0;
  });

  it("routes modes patch to spec_projects.confirmed_modes", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite).toBeDefined();
    expect(projectsWrite?.payload).toMatchObject({ confirmed_modes: expect.any(Array) });
  });

  it("routes configuration_parameters patch to spec_projects.configuration_parameters", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      configuration_parameters: [
        { parameter_id: "x", name: "X", allowed_values: ["A"], default: "A" },
      ],
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      configuration_parameters: expect.any(Array),
    });
  });

  it("routes unit_coordination patch to spec_projects.unit_coordination", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      unit_coordination: {
        "00000000-0000-0000-0000-000000000bbb": {
          unit_id: "00000000-0000-0000-0000-000000000bbb",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
        },
      },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      unit_coordination: expect.any(Object),
    });
  });

  it("routes section_overrides patch to spec_projects.section_overrides", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      section_overrides: {
        system_overview: { content_markdown: "Hello" },
      },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      section_overrides: expect.any(Object),
    });
  });
});

describe("validateSpecContractPatch — mode existence", () => {
  it("rejects a patch where confirmed_modes lacks an is_default=true entry", () => {
    const issues = validateSpecContractPatch({
      modes: [{ mode_id: "auto", name: "Auto", is_default: false }],
    });
    expect(issues.some((i) => /default mode/i.test(i))).toBe(true);
  });

  it("rejects a patch with two is_default=true modes", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "auto", name: "Auto", is_default: true },
        { mode_id: "manual", name: "Manual", is_default: true },
      ],
    });
    expect(issues.some((i) => /exactly one/i.test(i))).toBe(true);
  });

  it("rejects duplicate mode_ids", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "auto", name: "Auto", is_default: true },
        { mode_id: "auto", name: "Auto 2", is_default: false },
      ],
    });
    expect(issues.some((i) => /duplicate/i.test(i))).toBe(true);
  });

  it("accepts a valid modes patch", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "auto", name: "Auto", is_default: true },
        { mode_id: "manual", name: "Manual", is_default: false },
      ],
    });
    expect(issues).toEqual([]);
  });
});

describe("validateSpecContractPatch — override_kind content rules", () => {
  function makeEquipmentModule(seqOverride: Record<string, unknown>) {
    return {
      "00000000-0000-0000-0000-000000000aaa": {
        equipment_module_id: "00000000-0000-0000-0000-000000000aaa",
        unit_id: "00000000-0000-0000-0000-000000000bbb",
        static_states: {},
        sequential_states: {
          "auto::execute": {
            override_kind: "inherit",
            permissives: [],
            steps: [],
            notes: null,
            ...seqOverride,
          },
        },
      },
    };
  }

  it("rejects an inherit row with steps", () => {
    const issues = validateSpecContractPatch({
      equipment_modules: makeEquipmentModule({
        steps: [
          {
            step: 10,
            action: "x",
            completion_criteria: [],
            completion_criteria_text: "",
          },
        ],
      } as never) as never,
    });
    expect(issues.some((i) => /inherit.*empty/i.test(i))).toBe(true);
  });

  it("rejects a suppressed row with permissives", () => {
    const issues = validateSpecContractPatch({
      equipment_modules: makeEquipmentModule({
        override_kind: "suppressed",
        permissives: [{ tag: "X", operator: "=", value: true }],
      } as never) as never,
    });
    expect(issues.some((i) => /suppressed.*empty/i.test(i))).toBe(true);
  });

  it("accepts an inherit row with empty content", () => {
    const issues = validateSpecContractPatch({
      equipment_modules: makeEquipmentModule({}) as never,
    });
    expect(issues.filter((i) => /inherit|suppressed/i.test(i))).toEqual([]);
  });

  it("accepts an override row with content", () => {
    const issues = validateSpecContractPatch({
      equipment_modules: makeEquipmentModule({
        override_kind: "override",
        permissives: [{ tag: "X", operator: "=", value: true }],
      } as never) as never,
    });
    expect(issues.filter((i) => /inherit|suppressed/i.test(i))).toEqual([]);
  });
});

describe("validateSpecContractPatch — parameter_ref existence", () => {
  it("rejects parameter_ref expression to an unknown parameter_id", () => {
    const issues = validateSpecContractPatch({
      configuration_parameters: [
        { parameter_id: "battery_chemistry", name: "X", allowed_values: ["LFP"], default: "LFP" },
      ],
      equipment_modules: {
        "00000000-0000-0000-0000-000000000aaa": {
          equipment_module_id: "00000000-0000-0000-0000-000000000aaa",
          unit_id: "00000000-0000-0000-0000-000000000bbb",
          static_states: {},
          sequential_states: {
            "auto::execute": {
              override_kind: "override",
              permissives: [],
              steps: [
                {
                  step_id: "s1",
                  branch_id: "main",
                  actions: [
                    {
                      kind: "assign",
                      action_id: "a1",
                      target_tag: "X",
                      source: { kind: "parameter_ref", parameter_id: "MISSING" },
                      prose: "x",
                    },
                  ],
                  transitions: [],
                  // legacy fields
                  step: 10,
                  action: "x",
                  completion_criteria: [],
                  completion_criteria_text: "",
                } as never,
              ],
              notes: null,
            },
          },
        },
      } as never,
    });
    expect(issues.some((i) => /parameter_ref.*MISSING/i.test(i))).toBe(true);
  });

  it("accepts parameter_ref to a known parameter_id", () => {
    const issues = validateSpecContractPatch({
      configuration_parameters: [
        { parameter_id: "battery_chemistry", name: "X", allowed_values: ["LFP"], default: "LFP" },
      ],
      equipment_modules: {
        "00000000-0000-0000-0000-000000000aaa": {
          equipment_module_id: "00000000-0000-0000-0000-000000000aaa",
          unit_id: "00000000-0000-0000-0000-000000000bbb",
          static_states: {},
          sequential_states: {
            "auto::execute": {
              override_kind: "override",
              permissives: [],
              steps: [
                {
                  step_id: "s1",
                  branch_id: "main",
                  actions: [
                    {
                      kind: "assign",
                      action_id: "a1",
                      target_tag: "X",
                      source: { kind: "parameter_ref", parameter_id: "battery_chemistry" },
                      prose: "x",
                    },
                  ],
                  transitions: [],
                  step: 10,
                  action: "x",
                  completion_criteria: [],
                  completion_criteria_text: "",
                } as never,
              ],
              notes: null,
            },
          },
        },
      } as never,
    });
    expect(issues.filter((i) => /parameter_ref/i.test(i))).toEqual([]);
  });
});

describe("loadSpecContract — confirmation_status branching (smoke)", () => {
  // The reader needs more elaborate mocking (multiple table queries) to
  // exercise the branching itself; that lands in Phase 2 where the read
  // path actually changes user-visible behaviour. For Phase 1, the minimum
  // acceptance is: loadSpecContract is exported and importable.
  it("imports without throwing", async () => {
    const { loadSpecContract } = await import("../contract");
    expect(typeof loadSpecContract).toBe("function");
  });
});

describe("validateSpecContractPatch — drive models (G0-1)", () => {
  const CM_ID = "00000000-0000-4000-8000-000000000001";
  const hierarchyWithDrive = (drive: object | undefined) => ({
    units: [
      {
        unit_id: "00000000-0000-4000-8000-000000000aaa",
        unit_name: "Unit",
        equipment_type: "cell",
        description: "",
        excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "00000000-0000-4000-8000-000000000bbb",
            equipment_module_name: "Drive EM",
            description: "",
            control_modules: [
              {
                control_module_id: CM_ID,
                control_module_name: "VSD1",
                control_module_class: "drive",
                is_safety: false,
                description: "",
                io_signals: [],
                ...(drive ? { drive } : {}),
              },
            ],
          },
        ],
      },
    ],
  });

  it("rejects a hierarchy patch whose drive telegram mismatches its family", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: hierarchyWithDrive({
        family: "sinamics_g120",
        telegram: 105,
        speed_ref: { unit: "percent_ref_speed", signed: true },
        enable_policy: "enable_on_nonzero_ref",
      }),
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("telegram 105")),
    ).toBe(true);
  });

  it("rejects engineering entries referencing unknown CMs when hierarchy present", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: hierarchyWithDrive(undefined),
      engineering: {
        drives: [{ control_module_id: "00000000-0000-4000-8000-00000000dead" }],
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) =>
        i.includes("unknown control module"),
      ),
    ).toBe(true);
  });

  it("engineering-only patch skips referential checks (context absent)", () => {
    const patch = SpecContractPatchSchema.parse({
      engineering: {
        drives: [{ control_module_id: "00000000-0000-4000-8000-00000000dead" }],
      },
    });
    expect(validateSpecContractPatch(patch)).toEqual([]);
  });
});
