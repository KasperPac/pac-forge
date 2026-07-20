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
  deriveIoList,
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

  it("routes engineering patch to spec_projects.engineering", async () => {
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      engineering: {
        drives: [
          {
            control_module_id: "00000000-0000-4000-8000-000000000001",
            ref_speed_rpm: 1500.0,
            config_axis: 0x003f,
          },
        ],
      },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({
      engineering: expect.any(Object),
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

describe("validateSpecContractPatch + deriveIoList — per-IO model (G0-2)", () => {
  const hierarchyWithSignal = (signal: object) => ({
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
            equipment_module_name: "EM",
            description: "",
            control_modules: [
              {
                control_module_id: "00000000-0000-4000-8000-000000000001",
                control_module_name: "VSD1",
                control_module_class: "drive",
                is_safety: false,
                description: "",
                io_signals: [signal],
              },
            ],
          },
        ],
      },
    ],
  });

  it("rejects a hierarchy patch with polarity on an analog signal", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: hierarchyWithSignal({
        tag: "PT01",
        signal_type: "AI",
        io_address: "%IW96",
        description: "",
        source: "wired",
        polarity: "nc",
      }),
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("polarity")),
    ).toBe(true);
  });

  it("rejects a unit_coordination patch with a duplicate routing target pin (G0-3)", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          signal_routing: {
            routing_rows: [
              {
                row_id: "r1",
                target: { equipment_module_id: "em1", pin: "ilk_X" },
                source: { kind: "io_tag", tag: "A" },
              },
              {
                row_id: "r2",
                target: { equipment_module_id: "em1", pin: "ilk_X" },
                source: { kind: "io_tag", tag: "B" },
              },
            ],
          },
        },
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("duplicate target")),
    ).toBe(true);
  });

  it("cross-checks signal_routing safety gates when the patch carries them (G0-3)", () => {
    const patch = SpecContractPatchSchema.parse({
      safety_gates: [
        {
          gate_id: "estop",
          name: "E-Stop",
          condition: [{ tag: "EStop_Healthy", operator: "=", value: true }],
          scope: "all",
        },
      ],
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          signal_routing: { safety_healthy: { gate_ids: ["ghost"] } },
        },
      },
    });
    expect(validateSpecContractPatch(patch).some((i) => i.includes("ghost"))).toBe(
      true,
    );
  });

  it("requires co-sent modes when coordination references mode ids (G0-9-F1)", () => {
    const coordWithModeRefs = {
      unit_id: "u1",
      states: [
        { state_id: "idle", allowed_modes: ["production"], mode_change_allowed: true },
      ],
      transitions: [],
    };
    const withoutModes = SpecContractPatchSchema.parse({
      unit_coordination: { u1: coordWithModeRefs },
    });
    expect(
      validateSpecContractPatch(withoutModes).some((i) => i.includes("co-send")),
    ).toBe(true);

    const withModes = SpecContractPatchSchema.parse({
      modes: [
        { mode_id: "production", name: "Production", is_default: true, kind: "production" },
      ],
      unit_coordination: { u1: coordWithModeRefs },
    });
    expect(
      validateSpecContractPatch(withModes).some((i) => i.includes("co-send")),
    ).toBe(false);

    const modeAgnostic = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
        },
      },
    });
    expect(
      validateSpecContractPatch(modeAgnostic).some((i) => i.includes("co-send")),
    ).toBe(false);
  });

  it("rejects a named_gate ref not defined by the unit's axes (G0-4)", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          axes: [
            {
              axis_id: "rail",
              kind: "linear",
              encoder_tag: "Enc1",
              eu_unit: "mm",
              scale: { db_member: "scale" },
              length: { db_member: "length" },
              end_margin: { db_member: "end_margin" },
              ramp_zone: { db_member: "ramp_zone" },
              gates: { fwd_ok: "fwd_ok" },
            },
          ],
          signal_routing: {
            routing_rows: [
              {
                row_id: "r1",
                target: { equipment_module_id: "em1", pin: "ilk_X" },
                source: { kind: "io_tag", tag: "A" },
                gates: [{ kind: "named_gate", gate_id: "ghost_gate" }],
              },
            ],
          },
        },
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("ghost_gate")),
    ).toBe(true);
  });

  it("rejects axis_constants for unknown axis or undeclared member (G0-4)", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          axes: [
            {
              axis_id: "rail",
              kind: "linear",
              encoder_tag: "Enc1",
              eu_unit: "mm",
              scale: { db_member: "scale" },
              length: { db_member: "length" },
              end_margin: { db_member: "end_margin" },
              ramp_zone: { db_member: "ramp_zone" },
            },
          ],
        },
      },
      engineering: {
        axis_constants: [
          { unit_id: "u1", axis_id: "ghost_axis", values: { scale: 1 } },
          { unit_id: "u1", axis_id: "rail", values: { not_a_member: 5 } },
        ],
      },
    });
    const issues = validateSpecContractPatch(patch);
    expect(issues.some((i) => i.includes("ghost_axis"))).toBe(true);
    expect(issues.some((i) => i.includes("not_a_member"))).toBe(true);
  });

  it("routes maintenance patch to spec_projects.maintenance (G0-5)", async () => {
    writeCalls.length = 0;
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      maintenance: { overridable_outputs: [{ tag: "Horn", wire_check_only: false }] },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({ maintenance: expect.any(Object) });
  });

  it("rejects an overridable output that is not a DO in the hierarchy (G0-5)", () => {
    const patch = SpecContractPatchSchema.parse({
      hierarchy: {
        units: [
          {
            unit_id: "00000000-0000-4000-8000-000000000aaa",
            unit_name: "U",
            equipment_type: "cell",
            description: "",
            excluded: false,
            equipment_modules: [
              {
                equipment_module_id: "00000000-0000-4000-8000-000000000bbb",
                equipment_module_name: "EM",
                description: "",
                control_modules: [
                  {
                    control_module_id: "00000000-0000-4000-8000-000000000001",
                    control_module_name: "CM",
                    control_module_class: "io",
                    is_safety: false,
                    description: "",
                    io_signals: [
                      {
                        tag: "Horn",
                        signal_type: "DO",
                        io_address: "%Q0.2",
                        description: "",
                        source: "wired",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      maintenance: {
        overridable_outputs: [{ tag: "Horn" }, { tag: "Ghost_Output" }],
      },
    });
    const issues = validateSpecContractPatch(patch);
    expect(issues.some((i) => i.includes("Ghost_Output"))).toBe(true);
    expect(issues.some((i) => i.includes('"Horn"'))).toBe(false);
  });

  it("rejects encoder_presets for an axis without preset capability (G0-5)", () => {
    const patch = SpecContractPatchSchema.parse({
      unit_coordination: {
        u1: {
          unit_id: "u1",
          states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
          axes: [
            {
              axis_id: "rail",
              kind: "linear",
              encoder_tag: "Enc1",
              eu_unit: "mm",
              scale: { db_member: "scale" },
              length: { db_member: "length" },
              end_margin: { db_member: "end_margin" },
              ramp_zone: { db_member: "ramp_zone" },
            },
          ],
        },
      },
      engineering: {
        encoder_presets: [
          {
            unit_id: "u1",
            axis_id: "rail",
            ctrl_address: "%QB64",
            value_address: "%QD65",
            status_address: "%IB68",
          },
        ],
      },
    });
    expect(
      validateSpecContractPatch(patch).some((i) => i.includes("preset")),
    ).toBe(true);
  });

  it("cross-checks required_level against a co-sent ladder (G0-10)", async () => {
    const withLadder = SpecContractPatchSchema.parse({
      authorization: { roles: [{ level: 0, name: "View" }, { level: 4, name: "Engineer" }] },
      configuration_parameters: [
        {
          parameter_id: "speed_class",
          name: "Speed class",
          allowed_values: ["low"],
          default: "low",
          access: { required_level: 7 },
        },
      ],
    });
    expect(
      validateSpecContractPatch(withLadder).some((i) => i.includes("required_level 7")),
    ).toBe(true);

    // no ladder in the patch → skip (context absent)
    const noLadder = SpecContractPatchSchema.parse({
      configuration_parameters: [
        {
          parameter_id: "speed_class",
          name: "Speed class",
          allowed_values: ["low"],
          default: "low",
          access: { required_level: 7 },
        },
      ],
    });
    expect(
      validateSpecContractPatch(noLadder).some((i) => i.includes("required_level")),
    ).toBe(false);

    // routing to spec_projects.authorization
    writeCalls.length = 0;
    await writeSpecContract("00000000-0000-0000-0000-000000000000", {
      authorization: { roles: [{ level: 0, name: "View" }] },
    });
    const projectsWrite = writeCalls.find((c) => c.table === "spec_projects");
    expect(projectsWrite?.payload).toMatchObject({ authorization: expect.any(Object) });
  });

  it("validates fb_assignments — duplicates and unknown targets (G0-8)", () => {
    const hierarchy = {
      units: [
        {
          unit_id: "00000000-0000-4000-8000-000000000aaa",
          unit_name: "U",
          equipment_type: "cell",
          description: "",
          excluded: false,
          equipment_modules: [
            {
              equipment_module_id: "00000000-0000-4000-8000-000000000bbb",
              equipment_module_name: "EM",
              description: "",
              control_modules: [
                {
                  control_module_id: "00000000-0000-4000-8000-000000000001",
                  control_module_name: "CM",
                  control_module_class: "io",
                  is_safety: false,
                  description: "",
                  io_signals: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const patch = SpecContractPatchSchema.parse({
      hierarchy,
      engineering: {
        fb_assignments: [
          {
            target_kind: "control_module",
            target_id: "00000000-0000-4000-8000-000000000001",
            template_id: "tpl-1",
            pin_bindings: [
              { pin: "cmd_Run", tag: "A" },
              { pin: "cmd_Run", tag: "B" },
            ],
          },
          {
            target_kind: "control_module",
            target_id: "00000000-0000-4000-8000-000000000001",
            template_id: "tpl-2",
          },
          {
            target_kind: "equipment_module",
            target_id: "00000000-0000-4000-8000-00000000dead",
            template_id: "tpl-3",
          },
        ],
      },
    });
    const issues = validateSpecContractPatch(patch);
    expect(issues.some((i) => i.includes("duplicate pin"))).toBe(true);
    expect(issues.some((i) => i.includes("duplicate assignment"))).toBe(true);
    expect(issues.some((i) => i.includes("dead"))).toBe(true);

    // engineering-only patch skips the target check
    const engOnly = SpecContractPatchSchema.parse({
      engineering: {
        fb_assignments: [
          {
            target_kind: "equipment_module",
            target_id: "00000000-0000-4000-8000-00000000dead",
            template_id: "tpl-3",
          },
        ],
      },
    });
    expect(
      validateSpecContractPatch(engOnly).some((i) => i.includes("dead")),
    ).toBe(false);
  });

  it("deriveIoList renders N/C polarity into normal_state/failsafe_state", () => {
    const hierarchy = {
      units: [
        {
          unit_id: "u1",
          unit_name: "U",
          equipment_type: "cell",
          description: "",
          excluded: false,
          equipment_modules: [
            {
              equipment_module_id: "em1",
              equipment_module_name: "EM",
              description: "",
              control_modules: [
                {
                  control_module_id: "cm1",
                  control_module_name: "VSD1",
                  control_module_class: "drive",
                  is_safety: false,
                  description: "",
                  io_signals: [
                    {
                      tag: "CM1_Therm",
                      signal_type: "DI",
                      io_address: "%I1.1",
                      description: "",
                      source: "wired",
                      polarity: "nc",
                    },
                    {
                      tag: "Start_PB",
                      signal_type: "DI",
                      io_address: "%I0.0",
                      description: "",
                      source: "wired",
                      polarity: "no",
                    },
                    {
                      tag: "Spare",
                      signal_type: "DI",
                      io_address: "%I0.1",
                      description: "",
                      source: "wired",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as never;
    const rows = deriveIoList(hierarchy);
    expect(rows[0].normal_state).toBe("N/C");
    expect(rows[0].failsafe_state).toBe("fail-safe (healthy = TRUE)");
    expect(rows[1].normal_state).toBe("N/O");
    expect(rows[1].failsafe_state).toBe("");
    expect(rows[2].normal_state).toBe("");
  });
});
