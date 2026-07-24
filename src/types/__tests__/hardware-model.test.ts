import { describe, it, expect } from "vitest";
import { HardwareModelV1Schema } from "@/types/spec-contract-v2";

describe("HardwareModelV1Schema", () => {
  it("accepts a minimal CPU-only model", () => {
    const parsed = HardwareModelV1Schema.parse({
      platform: "SIEMENS_TIA",
      cpu: { cpu_type: "CPU 1515-2 PN" },
    });
    expect(parsed.cpu.cpu_type).toBe("CPU 1515-2 PN");
    expect(parsed.racks).toEqual([]); // default
  });

  it("accepts a full multi-module model", () => {
    const parsed = HardwareModelV1Schema.parse({
      platform: "SIEMENS_TIA",
      tia_version: "V20",
      cpu: { cpu_type: "CPU 1515-2 PN", cpu_order_number: "6ES7 515-2AM03-0AB0", firmware: "V3.1" },
      racks: [
        { rack: 0, modules: [
          { slot: 1, module_type: "DI 16x24VDC", channel_count: 16, signal_type: "DI" },
          { slot: 2, module_type: "AI 8xU/I/RTD", channel_count: 8, signal_type: "AI" },
        ] },
      ],
      render_in_docx: true,
    });
    expect(parsed.racks[0].modules).toHaveLength(2);
    expect(parsed.render_in_docx).toBe(true);
  });

  it("rejects an unknown platform", () => {
    expect(() =>
      HardwareModelV1Schema.parse({ platform: "ROCKWELL", cpu: { cpu_type: "x" } }),
    ).toThrow();
  });

  it("rejects a Siemens-dialect module signal_type (data stays IEC)", () => {
    expect(() =>
      HardwareModelV1Schema.parse({
        platform: "SIEMENS_TIA",
        cpu: { cpu_type: "x" },
        racks: [{ rack: 0, modules: [{ slot: 1, module_type: "DQ 16", signal_type: "DQ" }] }],
      }),
    ).toThrow();
  });
});
