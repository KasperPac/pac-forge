// src/lib/spec-builder/__tests__/tia-provision-inputs.test.ts
//
// contract.hardware → bridge provision inputs (G9-W9). Pure mapping only.
import { describe, expect, it } from "vitest";
import {
  cpuOrderNumberFromHardware,
  ioModulesFromHardware,
  ioTagsFromMigrationTags,
} from "../tia-provision-inputs";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

function hw(over: Partial<HardwareModelV1> = {}): HardwareModelV1 {
  return {
    platform: "SIEMENS_TIA",
    cpu: { cpu_type: "S7-1516" },
    racks: [],
    ...over,
  } as HardwareModelV1;
}

describe("cpuOrderNumberFromHardware", () => {
  it("prefers an explicitly authored order number", () => {
    const result = cpuOrderNumberFromHardware(
      hw({ cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0/V2.9" } }),
    );
    expect(result).toBe("6ES7 516-3AN02-0AB0/V2.9");
  });

  it("appends firmware to an unsuffixed order number", () => {
    const result = cpuOrderNumberFromHardware(
      hw({ cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0", firmware: "V2.9" } }),
    );
    expect(result).toBe("6ES7 516-3AN02-0AB0/V2.9");
  });

  it("leaves an already-suffixed order number alone", () => {
    const result = cpuOrderNumberFromHardware(
      hw({ cpu: { cpu_type: "S7-1516", cpu_order_number: "6ES7 516-3AN02-0AB0/V2.8", firmware: "V2.9" } }),
    );
    expect(result).toBe("6ES7 516-3AN02-0AB0/V2.8");
  });

  it("falls back to the catalogue lookup by CPU type", () => {
    expect(cpuOrderNumberFromHardware(hw({ cpu: { cpu_type: "S7-1513" } })))
      .toBe("6ES7 513-1AL02-0AB0/V2.9");
    // A descriptive type string still resolves by family substring.
    expect(cpuOrderNumberFromHardware(hw({ cpu: { cpu_type: "CPU S7-1511-1 PN" } })))
      .toBe("6ES7 511-1AK02-0AB0/V2.9");
  });

  it("returns undefined when no hardware is authored or the type is unknown", () => {
    expect(cpuOrderNumberFromHardware(undefined)).toBeUndefined();
    expect(cpuOrderNumberFromHardware(null)).toBeUndefined();
    expect(cpuOrderNumberFromHardware(hw({ cpu: { cpu_type: "Allen-Bradley 5069" } }))).toBeUndefined();
  });
});

describe("ioModulesFromHardware", () => {
  it("flattens racks into IoModuleDto[] and collects modules that cannot be plugged", () => {
    const result = ioModulesFromHardware(
      hw({
        racks: [
          {
            rack: 0,
            modules: [
              { slot: 1, module_type: "DI 16x24VDC", order_number: "6ES7 521-1BH50-0AA0" },
              { slot: 2, module_type: "DQ 16x24VDC" }, // no order number
            ],
          },
          {
            rack: 1,
            modules: [{ slot: 1, module_type: "AI 8xU/I", order_number: "6ES7 531-7KF00-0AB0" }],
          },
        ],
      }),
    );
    expect(result.modules).toEqual([
      { mlfb: "6ES7 521-1BH50-0AA0", rack: 0, slot: 1, description: "DI 16x24VDC" },
      { mlfb: "6ES7 531-7KF00-0AB0", rack: 1, slot: 1, description: "AI 8xU/I" },
    ]);
    expect(result.missingOrderNumbers).toEqual(["DQ 16x24VDC"]);
  });

  it("returns empty results for absent hardware", () => {
    expect(ioModulesFromHardware(undefined)).toEqual({ modules: [], missingOrderNumbers: [] });
  });

  it("attaches the deterministic start address so TIA cannot auto-assign elsewhere", () => {
    const result = ioModulesFromHardware(
      hw({
        racks: [
          {
            rack: 0,
            modules: [
              { slot: 2, module_type: "DQ 16", order_number: "6ES7 522-1BH00-0AB0", channel_count: 16, signal_type: "DO" },
              { slot: 3, module_type: "AI 8", order_number: "6ES7 531-7QF00-0AB0", channel_count: 8, signal_type: "AI" },
              { slot: 4, module_type: "DI 16", order_number: "6ES7 521-1BH00-0AB0", channel_count: 16, signal_type: "DI" },
            ],
          },
        ],
      }),
    );
    // Output space starts fresh; the AI card eats input bytes 0-15, so the DI
    // card must follow it at byte 16 — %I and %IW share one space.
    expect(result.modules.map((m) => [m.slot, m.start_address])).toEqual([
      [2, 0],
      [3, 0],
      [4, 16],
    ]);
  });
});

describe("ioTagsFromMigrationTags", () => {
  it("maps the send plan's tag shape onto the provision tag shape", () => {
    expect(
      ioTagsFromMigrationTags([
        { name: "M01_Run", dataType: "Bool", address: "%Q0.0" },
        { name: "LT_Level", dataType: "Word", address: "%IW64" },
      ]),
    ).toEqual([
      { name: "M01_Run", data_type: "Bool", logical_address: "%Q0.0" },
      { name: "LT_Level", data_type: "Word", logical_address: "%IW64" },
    ]);
  });
});
