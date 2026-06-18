import { describe, expect, it } from "vitest";
import {
  seedDefaultModes,
  suggestSafetyGates,
} from "@/lib/spec-builder/wizard-machine-layer";
import type { OperatorMode } from "@/types/spec-contract-v2";

describe("seedDefaultModes", () => {
  it("seeds Auto/Maintenance/Manual with exactly one default", () => {
    const modes = seedDefaultModes();
    expect(modes.map((m) => m.mode_id)).toEqual(["auto", "maintenance", "manual"]);
    expect(modes.filter((m: OperatorMode) => m.is_default)).toHaveLength(1);
    expect(modes.find((m) => m.is_default)?.mode_id).toBe("auto");
  });
});

describe("suggestSafetyGates", () => {
  it("proposes one 'all'-scope gate per distinct safety tag, condition = tag is false", () => {
    const gates = suggestSafetyGates([
      { tag: "EStop_Healthy", is_safety: true },
      { tag: "SR1_Healthy", is_safety: true },
      { tag: "Motor_Run", is_safety: false },
    ]);
    expect(gates).toHaveLength(2);
    expect(gates[0]).toMatchObject({
      scope: "all",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
    });
    expect(gates.every((g) => g.gate_id.length > 0)).toBe(true);
  });

  it("returns no gates when there are no safety tags", () => {
    expect(suggestSafetyGates([{ tag: "x", is_safety: false }])).toEqual([]);
  });
});
