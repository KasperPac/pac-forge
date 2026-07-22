import { describe, it, expect, vi, beforeEach } from "vitest";

const writeCalls: Array<{ table: string; op: string; payload: unknown }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: null }) }) }) }),
      insert: (payload: unknown) => { writeCalls.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
    }),
  },
}));

import { composeFdsToSections } from "../fds-compose";
import type { UnitConfig, OperationSession } from "@/types/spec-builder";

const unit = {
  unit_id: "u1", unit_name: "Carriage Unit", equipment_type: "Other",
  description: "", excluded: false,
  equipment_modules: [{ equipment_module_id: "em1", equipment_module_name: "Carriage Drive", description: "", control_modules: [] }],
} as unknown as UnitConfig;

const session = {
  id: "s1", spec_project_id: "proj", unit_id: "u1", equipment_module_id: "em1",
  status: "complete", static_confirmed: true,
  static_states: { aborted: [] },
  sequential_states: {},
  em_states: [
    { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
    { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
  ],
  em_transitions: [],
  command_behavior: {
    execute: {
      branches: [{
        branch_id: "drive_fwd", label: "Drive Forward",
        when: [{ tag: "CAR_CMD_FWD", operator: "=", value: true }],
        control_modules: [{ tag: "CAR_M01_FWD", description: "", state: "on" }],
      }],
      default_hold: [{ tag: "CAR_M01_FWD", description: "", state: "off" }],
    },
  },
  conversation: [],
} as unknown as OperationSession;

beforeEach(() => { writeCalls.length = 0; });

describe("composeFdsToSections — command-driven state (SP-3c)", () => {
  it("inserts a functional_description row carrying serialized command branches", async () => {
    await composeFdsToSections("proj", unit, [session]);
    const row = writeCalls.find(
      (c) => c.table === "spec_sections" && c.op === "insert" &&
        (c.payload as { state_id?: string }).state_id === "execute",
    );
    expect(row).toBeTruthy();
    const content = (row!.payload as { content_json: Record<string, unknown> }).content_json;
    expect(content.command_branches).toEqual([
      { label: "Drive Forward", when: ["CAR_CMD_FWD = TRUE"], control_modules: [{ tag: "CAR_M01_FWD", description: "", state: "on" }] },
    ]);
    expect(content.default_hold).toEqual([{ tag: "CAR_M01_FWD", description: "", state: "off" }]);
    expect(content.steps).toBeUndefined();
  });

  it("writes only V2 granularity values (the DB CHECK rejects legacy 'subsystem'/'assembly_state')", async () => {
    await composeFdsToSections("proj", unit, [session]);
    const rows = writeCalls.filter((c) => c.table === "spec_sections" && c.op === "insert");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const g = (r.payload as { granularity?: string }).granularity;
      expect(["equipment_module_state", "unit", "project"]).toContain(g);
    }
  });

  it("still skips sequential states with neither steps nor command_behavior", async () => {
    const bare = { ...session, command_behavior: undefined } as unknown as OperationSession;
    await composeFdsToSections("proj", unit, [bare]);
    const row = writeCalls.find(
      (c) => c.table === "spec_sections" && c.op === "insert" &&
        (c.payload as { state_id?: string }).state_id === "execute",
    );
    expect(row).toBeUndefined();
  });
});
