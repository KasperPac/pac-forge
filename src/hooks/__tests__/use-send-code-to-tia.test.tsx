// src/hooks/__tests__/use-send-code-to-tia.test.tsx
//
// Send-to-TIA assembly: full-program sources in import order with Code
// Builder edits overlaid, pushed through /tia/reimport-compile.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSendCodeToTia } from "../use-send-code-to-tia";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const contract: SpecContractV2 = {
  schema_version: 3,
  project: {},
  hierarchy: {
    units: [
      {
        unit_id: "u1", unit_name: "Infeed", equipment_type: "cell", description: "", excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "em1", equipment_module_name: "Belt", description: "",
            control_modules: [
              {
                control_module_id: "cm1", control_module_name: "M01", control_module_class: "motor",
                is_safety: false, description: "",
                io_signals: [
                  { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "", source: "wired" },
                  { tag: "M01_FB", signal_type: "DI", io_address: "I0.0", description: "", source: "wired" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  equipment_modules: {
    em1: {
      equipment_module_id: "em1", unit_id: "u1",
      states: [
        { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "execute", name: "Execute", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
      transitions: [
        { transition_id: "t1", from_state_id: "idle", to_state_id: "execute",
          trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } }, guard: [] },
      ],
      static_states: { idle: [{ tag: "M01_Run", description: "", state: "STOP" }] },
      sequential_states: {},
    },
  },
  alarm_tiers: [], safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
  confirmation_status: "confirmed",
} as unknown as SpecContractV2;

vi.mock("@/lib/spec-builder/contract", () => ({
  loadSpecContract: vi.fn(async () => contract),
}));
vi.mock("@/hooks/use-fb-templates", () => ({
  useFbTemplates: () => ({ data: [] }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: [{ artifact_name: "EM_Belt", edited_content: "FUNCTION_BLOCK \"EM_Belt\"\n// hand-tuned\nEND_FUNCTION_BLOCK\n" }],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => fetchMock.mockReset());

describe("useSendCodeToTia", () => {
  it("assembles all layers in import order with Code Builder edits overlaid", async () => {
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => {
      plan = await result.current.buildPlan();
    });
    const names = Object.keys(plan.sources);
    // import order: UDTs first, OB last
    expect(names[0].endsWith("_State")).toBe(true); // the EM state UDT
    expect(names[names.length - 1]).toBe("Main");
    // spans layers: EM bundle + unit stub + OB
    expect(names).toContain("EM_Belt");
    expect(names).toContain("MAP_Belt");
    expect(names).toContain("UC_Infeed");
    // the Code Builder edit wins over raw generation
    expect(plan.sources.EM_Belt).toContain("hand-tuned");
    expect(plan.editedBlocks).toEqual(["EM_Belt"]);
    // G9-W4: the plan derives the physical IO tags the writers reference
    expect(plan.ioTags).toEqual([
      { name: "M01_Run", dataType: "Bool", address: "%Q0.0" },
      { name: "M01_FB", dataType: "Bool", address: "%I0.0" },
    ]);
  });

  it("creates IO tags first, then POSTs the sources to /tia/reimport-compile", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: "", created: ["M01_Run", "M01_FB"], skipped: [], errors: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, errors: [], warnings: [], compiled_at: "", sources: {} }),
      });
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => {
      plan = await result.current.buildPlan();
    });
    await act(async () => {
      await result.current.send(plan);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:5102/tia/migration/create-tags",
      expect.objectContaining({ method: "POST" }),
    );
    const tagsBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(tagsBody.tableName).toBe("PacForge IO Tags");
    expect(tagsBody.tags.map((t: { name: string }) => t.name)).toEqual(["M01_Run", "M01_FB"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:5102/tia/reimport-compile",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(Object.keys(body.sources)).toContain("EM_Belt");
  });

  it("aborts the send when tag creation fails, surfacing the error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => {
      plan = await result.current.buildPlan();
    });
    await act(async () => {
      await result.current.send(plan);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no reimport call
    expect(result.current.error).toContain("IO tag creation failed");
  });
});
