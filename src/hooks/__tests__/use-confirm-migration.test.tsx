import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SpecContractV2, EquipmentModuleContract } from "@/types/spec-contract-v2";
import type { MigrationDraft } from "@/lib/spec-builder/migrate/types";

const writeMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/spec-builder/contract", () => ({
  writeSpecContract: (...args: unknown[]) => writeMock(...args),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "fds_migration_events") {
        return { insert: (rows: unknown) => Promise.resolve(insertMock(rows) ?? { data: null, error: null }) };
      }
      return {
        update: (payload: unknown) => ({
          eq: () => Promise.resolve(updateMock(payload) ?? { data: null, error: null }),
        }),
      };
    },
  },
}));

import { useConfirmMigration } from "../use-confirm-migration";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const SPEC_ID = "00000000-0000-0000-0000-000000000000";

function makeContract(): SpecContractV2 {
  return {
    schema_version: 2,
    project: {
      id: SPEC_ID,
      doc_code: "X",
      title: "T",
      client_name: "C",
      project_number: null,
      plc_model: null,
      hmi_type: null,
      comms_protocol: null,
      safety_classification: null,
      fault_philosophy: null,
      design_principles: [],
      scope_exclusions: [],
    },
    hierarchy: { units: [] },
    states: [],
    alarm_tiers: [],
    equipment_modules: {
      "00000000-0000-0000-0000-000000000aaa": {
        equipment_module_id: "00000000-0000-0000-0000-000000000aaa",
        unit_id: "00000000-0000-0000-0000-000000000bbb",
        static_states: {},
        sequential_states: { execute: { permissives: [], steps: [], notes: null } } as never,
      } as EquipmentModuleContract,
    },
    unit_procedures: {},
    system_orchestration: null,
    alarms: [],
    io_list: [],
    faults: [],
    sections: {},
    confirmation_status: "unconfirmed",
  } as never;
}

const draft: MigrationDraft = {
  modes: { rows: [{ mode_id: "auto", name: "Auto", is_default: true }], tabComplete: true },
  states: { rows: [], tabComplete: true },
  interlocks: { rows: [], classifiedAt: new Date().toISOString(), tabComplete: true },
};

describe("useConfirmMigration", () => {
  beforeEach(() => {
    writeMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    writeMock.mockResolvedValue(undefined);
  });

  it("calls writeSpecContract with the assembled patch on confirm", async () => {
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await result.current.confirm({ contract: makeContract(), draft });
    });
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [calledSpecId, patch] = writeMock.mock.calls[0];
    expect(calledSpecId).toBe(SPEC_ID);
    expect(patch.confirmation_status).toBe("confirmed");
    expect(patch.modes).toHaveLength(1);
  });

  it("inserts a fds_migration_events row on success", async () => {
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await result.current.confirm({ contract: makeContract(), draft });
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      spec_project_id: SPEC_ID,
      modes_count: 1,
    });
  });

  it("clears the migration_draft on success", async () => {
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await act(async () => {
      await result.current.confirm({ contract: makeContract(), draft });
    });
    expect(updateMock).toHaveBeenCalledWith({ migration_draft: null });
  });

  it("throws and does NOT clear the draft when writeSpecContract fails", async () => {
    writeMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useConfirmMigration(SPEC_ID), { wrapper: ({ children }) => wrap(children) });
    await expect(
      act(async () => {
        await result.current.confirm({ contract: makeContract(), draft });
      }),
    ).rejects.toThrow(/boom/);
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
