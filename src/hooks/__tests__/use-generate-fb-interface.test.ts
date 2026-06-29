// src/hooks/__tests__/use-generate-fb-interface.test.ts
import { describe, it, expect } from "vitest";
import { buildContractFromAi } from "../use-generate-fb-interface";
import type { ParsedSclVar } from "@/lib/spec-builder/fb-interface";

const parsed: ParsedSclVar[] = [
  { name: "Run", scl_type: "Bool", section: "input", description: "start" },
  { name: "Fault", scl_type: "Bool", section: "output", description: "" },
  { name: "iState", scl_type: "Int", section: "static", description: "" }, // not a pin
];

describe("buildContractFromAi", () => {
  it("uses SCL pins as authoritative and applies AI annotations", () => {
    const c = buildContractFromAi(
      parsed,
      [
        { name: "Run", role: "cmd", default_binding: "hmi", exposed: false },
        { name: "Fault", role: "fault", default_binding: "io_output", exposed: true },
        { name: "Ghost", role: "status", default_binding: "hmi", exposed: true }, // AI-invented → ignored
      ],
      "CM_Motor",
    );
    expect(c.block_name).toBe("CM_Motor");
    expect(c.reviewed).toBe(false);
    expect(c.pins.map((p) => p.name)).toEqual(["Run", "Fault"]); // no static, no Ghost
    expect(c.pins[0]).toMatchObject({ role: "cmd", default_binding: "hmi", direction: "input" });
    expect(c.pins[1]).toMatchObject({ role: "fault", default_binding: "io_output", exposed: true });
  });

  it("defaults annotations when AI omits a pin", () => {
    const c = buildContractFromAi(parsed, [], "CM_Motor");
    // input defaults to sensor_in/io_input, output to status/io_output
    expect(c.pins[0]).toMatchObject({ name: "Run", role: "sensor_in", default_binding: "io_input", exposed: false });
    expect(c.pins[1]).toMatchObject({ name: "Fault", role: "status", default_binding: "io_output", exposed: false });
  });
});
