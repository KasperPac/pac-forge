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
// Two distinct query chains share `supabase.from("code_builder_artifacts")`:
// the current-revision edits lookup (`.select().eq().eq()`) and the
// custom-region carry-over loader (`.select().eq().lt().in().not().order()`).
// Both hang off the same first `.eq()` call, so it must offer both branches.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: [{ artifact_name: "EM_Belt", edited_content: "FUNCTION_BLOCK \"EM_Belt\"\n// hand-tuned\nEND_FUNCTION_BLOCK\n" }],
            error: null,
          }),
          lt: () => ({
            in: () => ({
              not: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor() {
    // Open on the next microtask so `await connectProvisionWs(...)` resolves.
    queueMicrotask(() => this.onopen?.());
  }
}
vi.stubGlobal("WebSocket", FakeWebSocket);

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
    // spans layers: EM bundle + unit stub + system layer FCs + OB
    expect(names).toContain("EM_Belt");
    expect(names).toContain("FC_Inputs");
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

  it("sends a folders map alongside the sources", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, message: "", created: [], skipped: [], errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, errors: [], warnings: [], compiled_at: "", sources: {} }) });
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    await act(async () => { await result.current.send(plan); });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.folders["EM_Belt"]).toMatch(/\/FB$/);
    expect(body.folders["Main"]).toBeUndefined(); // root stays unmapped
  });

  it("derives provision inputs from contract.hardware", async () => {
    const { loadSpecContract } = await import("@/lib/spec-builder/contract");
    vi.mocked(loadSpecContract).mockResolvedValueOnce({
      ...contract,
      hardware: {
        platform: "SIEMENS_TIA",
        cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0", firmware: "V2.9" },
        racks: [
          {
            rack: 0,
            modules: [
              { slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 521-1BH50-0AA0" },
              { slot: 2, module_type: "DQ 16x24VDC" },
            ],
          },
        ],
      },
    } as unknown as SpecContractV2);

    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });

    expect(plan.provision.cpuOrderNumber).toBe("6ES7 516-3AN02-0AB0/V2.9");
    expect(plan.provision.ioModules).toEqual([
      { mlfb: "6ES7 521-1BH50-0AA0", rack: 0, slot: 1, description: "DI 16x24VDC" },
    ]);
    expect(plan.provision.missingOrderNumbers).toEqual(["DQ 16x24VDC"]);
    // The un-pluggable module is surfaced to the operator, not swallowed.
    expect(plan.warnings.some((w) => w.includes("DQ 16x24VDC"))).toBe(true);
  });

  it("leaves cpuOrderNumber undefined when no hardware is authored", async () => {
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    expect(plan.provision.cpuOrderNumber).toBeUndefined();
    expect(plan.provision.ioModules).toEqual([]);
  });

  it("POSTs the plan's sources and tags to /tia/provision-project", async () => {
    const { loadSpecContract } = await import("@/lib/spec-builder/contract");
    vi.mocked(loadSpecContract).mockResolvedValueOnce({
      ...contract,
      hardware: {
        platform: "SIEMENS_TIA",
        cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0/V2.9" },
        racks: [{ rack: 0, modules: [{ slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 521-1BH50-0AA0" }] }],
      },
    } as unknown as SpecContractV2);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true, created: true, project_file_path: "C:\\TIA\\M1\\M1.ap20",
        message: "Created project 'M1' with PLC_1", warnings: [],
        compile_result: { success: true, errors: [], warnings: [], compiled_at: "" },
      }),
    });

    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    await act(async () => {
      await result.current.provisionFresh(plan, { projectPath: "C:\\TIA", projectName: "M1" });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5102/tia/provision-project",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tia_project_path).toBe("C:\\TIA");
    expect(body.project_name).toBe("M1");
    expect(body.cpu_order_number).toBe("6ES7 516-3AN02-0AB0/V2.9");
    expect(body.io_modules).toEqual([
      { mlfb: "6ES7 521-1BH50-0AA0", rack: 0, slot: 1, description: "DI 16x24VDC" },
    ]);
    // MigrationTagDto → IoTagDto
    expect(body.io_tags[0]).toEqual({ name: "M01_Run", data_type: "Bool", logical_address: "%Q0.0" });
    // The whole program rides along, in dependency order.
    expect(Object.keys(body.sources)).toContain("EM_Belt");
    expect(body.import_order).toEqual(Object.keys(body.sources));
    expect(body.import_order[body.import_order.length - 1]).toBe("Main");
    expect(typeof body.provision_id).toBe("string");
    // Folder map rides along, else a fresh project is flat in "Program blocks"
    // while the reimport path produces a foldered tree (G0-18).
    expect(body.folders["EM_Belt"]).toMatch(/\/FB$/);
    expect(result.current.provisionResult?.created).toBe(true);
  });

  it("surfaces a bridge failure without throwing", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "TIA offline" });
    const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
    let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
    await act(async () => { plan = await result.current.buildPlan(); });
    let resp: unknown;
    await act(async () => {
      resp = await result.current.provisionFresh(plan, { projectPath: "C:\\TIA", projectName: "M1" });
    });
    expect(resp).toBeNull();
    expect(result.current.error).toContain("Fresh project build failed");
    expect(result.current.provisioning).toBe(false);
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
