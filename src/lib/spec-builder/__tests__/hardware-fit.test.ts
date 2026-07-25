import { describe, it, expect } from "vitest";
import { validateHardwareFit } from "@/lib/spec-builder/hardware-fit";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

const hw = (modules: HardwareModelV1["racks"][number]["modules"]): HardwareModelV1 => ({
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1515-2 PN" },
  racks: [{ rack: 0, modules }],
});

describe("validateHardwareFit", () => {
  it("returns no warnings when nothing is declared", () => {
    expect(validateHardwareFit(null, [{ signal_type: "DI" }])).toEqual([]);
    expect(validateHardwareFit(undefined, [{ signal_type: "DI" }])).toEqual([]);
  });

  it("returns no warnings when capacity is sufficient", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI 16", channel_count: 16, signal_type: "DI" }]),
      [{ signal_type: "DI" }, { signal_type: "DI" }],
    );
    expect(w).toEqual([]);
  });

  it("warns when a class is short on channels", () => {
    const signals = Array.from({ length: 12 }, () => ({ signal_type: "DI" }));
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI 8", channel_count: 8, signal_type: "DI" }]),
      signals,
    );
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("capacity");
    expect(w[0].signal_class).toBe("DI");
    expect(w[0].message).toContain("12");
    expect(w[0].message).toContain("8");
  });

  it("warns type_incompatibility when a class has zero modules", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI 16", channel_count: 16, signal_type: "DI" }]),
      [{ signal_type: "AI" }],
    );
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("type_incompatibility");
    expect(w[0].signal_class).toBe("AI");
  });

  it("normalizes dialect + case: 'DQ'/'do' demand buckets to DO", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DO 8", channel_count: 8, signal_type: "DO" }]),
      [{ signal_type: "DQ" }, { signal_type: "do" }],
    );
    expect(w).toEqual([]); // both demand DO, 8 channels cover 2
  });

  it("ignores 'internal' signals (no physical channel needed)", () => {
    const w = validateHardwareFit(hw([]), [{ signal_type: "internal" }]);
    expect(w).toEqual([]);
  });

  it("treats a module with no channel_count as providing 0 channels", () => {
    const w = validateHardwareFit(
      hw([{ slot: 1, module_type: "DI ?", signal_type: "DI" }]),
      [{ signal_type: "DI" }],
    );
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe("capacity");
  });
});

describe("validateHardwareFit — slot conflicts (G0-17)", () => {
  it("flags two modules sharing a slot, since only one gets plugged", () => {
    // Capacity is satisfied on every class, so nothing else would catch this.
    const warnings = validateHardwareFit(
      hw([
        { slot: 2, module_type: "DQ 16x24VDC", channel_count: 16, signal_type: "DO" },
        { slot: 3, module_type: "AI 8xU/I", channel_count: 8, signal_type: "AI" },
        { slot: 3, module_type: "DI 16x24VDC", channel_count: 16, signal_type: "DI" },
      ]),
      [{ signal_type: "DI" }, { signal_type: "DO" }, { signal_type: "AI" }],
    );
    const conflict = warnings.find((w) => w.kind === "slot_conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.message).toContain("slot 3");
    expect(conflict!.message).toContain("AI 8xU/I");
    expect(conflict!.message).toContain("DI 16x24VDC");
    // and it is reported ahead of capacity warnings — it invalidates them
    expect(warnings[0].kind).toBe("slot_conflict");
  });

  it("stays quiet when every module has its own slot", () => {
    const warnings = validateHardwareFit(
      hw([
        { slot: 1, module_type: "DI 16x24VDC", channel_count: 16, signal_type: "DI" },
        { slot: 2, module_type: "DQ 16x24VDC", channel_count: 16, signal_type: "DO" },
      ]),
      [],
    );
    expect(warnings.filter((w) => w.kind === "slot_conflict")).toEqual([]);
  });
});
