// src/hooks/__tests__/use-hmi-build.test.tsx
//
// G8-1 — the HMI build hook: contract → G7 compiler → bridge POST.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHmiBuild } from "../use-hmi-build";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const contract: SpecContractV2 = {
  schema_version: 3,
  project: {},
  hierarchy: {
    units: [
      {
        unit_id: "u1", unit_name: "Infeed", equipment_type: "cell", description: "", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em1", equipment_module_name: "Belt", description: "", control_modules: [] },
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
      transitions: [],
      static_states: {}, sequential_states: {},
    },
  },
  alarm_tiers: [{ tier_id: "critical", tier_name: "Critical", description: "" }],
  alarms: [
    { id: "a1", tier_id: "critical", control_module_id: null, equipment_module_id: null, unit_id: null,
      tag: "Belt_FAULT", description: "Belt fault", action: "stop" },
  ],
  safety_gates: [], io_list: [], faults: [], sections: {},
  confirmation_status: "confirmed",
} as unknown as SpecContractV2;

vi.mock("@/lib/spec-builder/contract", () => ({
  loadSpecContract: vi.fn(async () => contract),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useHmiBuild", () => {
  it("generates the IR, bridge spec (with connection), manual steps, and build-pack markdown", async () => {
    const { result } = renderHook(() => useHmiBuild());
    await act(async () => {
      await result.current.generate("spec-1", { connection: "HMI_PLC_1", projectName: "Test" });
    });
    const run = result.current.run!;
    expect(run.spec.connection).toBe("HMI_PLC_1");
    expect(run.ir.textLists[0].name).toBe("Belt_States");
    expect(run.buildPackMarkdown).toContain("# Test — HMI Build Pack");
    expect(run.manualSteps.length).toBeGreaterThan(0);
  });

  it("POSTs the lowered spec to /tia/hmi/build and surfaces the bridge result", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tagsCreated: 3, alarmsCreated: 1 }),
    });
    const { result } = renderHook(() => useHmiBuild());
    await act(async () => {
      await result.current.generate("spec-1");
    });
    await act(async () => {
      await result.current.buildInTia(result.current.run!.spec);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5102/tia/hmi/build",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.bridgeResult).toEqual({
      ok: true,
      detail: { tagsCreated: 3, alarmsCreated: 1 },
    });
  });

  it("reports a bridge connection failure without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("bridge offline"));
    const { result } = renderHook(() => useHmiBuild());
    await act(async () => {
      await result.current.generate("spec-1");
    });
    await act(async () => {
      await result.current.buildInTia(result.current.run!.spec);
    });
    expect(result.current.bridgeResult?.ok).toBe(false);
    expect(result.current.bridgeResult?.detail).toContain("bridge offline");
  });
});
