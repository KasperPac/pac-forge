import { describe, it, expect } from "vitest";
import { hardwareBomData } from "@/lib/spec-builder/docx-exporter";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

const hw: HardwareModelV1 = {
  platform: "SIEMENS_TIA",
  tia_version: "V20",
  cpu: { cpu_type: "CPU 1515-2 PN", cpu_order_number: "6ES7 515-2AM03-0AB0", firmware: "V3.1" },
  racks: [{ rack: 0, modules: [
    { slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 …", channel_count: 16, signal_type: "DI" },
  ] }],
};

describe("hardwareBomData", () => {
  it("summarizes the CPU and one row per module", () => {
    const { cpuLine, moduleRows } = hardwareBomData(hw);
    expect(cpuLine).toContain("CPU 1515-2 PN");
    expect(cpuLine).toContain("V3.1");
    expect(moduleRows).toHaveLength(1);
    expect(moduleRows[0]).toEqual(["0", "1", "DI 16x24VDC", "DI", "16", "6ES7 …"]);
  });
});
