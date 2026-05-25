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

import { writeSpecContract, validateSpecContractPatch } from "../contract";

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
