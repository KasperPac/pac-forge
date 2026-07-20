import { describe, expect, it } from "vitest";
import {
  backfillModeKinds,
  defaultRoleLadder,
  seedDefaultModes,
  suggestSafetyGates,
} from "@/lib/spec-builder/wizard-machine-layer";

describe("defaultRoleLadder (G0-10)", () => {
  it("seeds the boundary-§D five-level ladder", () => {
    const ladder = defaultRoleLadder();
    expect(ladder.roles.map((r) => [r.level, r.name])).toEqual([
      [0, "View"],
      [1, "Operator"],
      [2, "Supervisor"],
      [3, "Maintenance"],
      [4, "Engineer"],
    ]);
  });
});
import type { OperatorMode } from "@/types/spec-contract-v2";

describe("backfillModeKinds (G0-9-F1)", () => {
  const mode = (
    mode_id: string,
    name: string,
    kind: OperatorMode["kind"] = "custom",
  ): OperatorMode => ({ mode_id, name, is_default: mode_id === "auto", kind });

  it("infers kinds for an all-custom pre-G0-9 set", () => {
    const out = backfillModeKinds([
      mode("auto", "Auto"),
      mode("maintenance", "Maintenance"),
      mode("manual", "Manual / Jog"),
      mode("comm", "Commissioning"),
      mode("special", "Special Wash"),
    ]);
    expect(out.map((m) => m.kind)).toEqual([
      "production",
      "maintenance",
      "manual",
      "engineering",
      "custom",
    ]);
  });

  it("never touches a set with any authored kind", () => {
    const authored = [
      mode("auto", "Auto", "production"),
      mode("maintenance", "Maintenance"),
    ];
    expect(backfillModeKinds(authored)).toBe(authored);
  });

  it("returns the same reference when nothing would change", () => {
    const noMatch = [mode("x", "Special A"), mode("y", "Special B")];
    expect(backfillModeKinds(noMatch)).toBe(noMatch);
  });

  it("matches on mode_id as well as name, case-insensitive", () => {
    const out = backfillModeKinds([mode("service_mode", "Mode 2")]);
    expect(out[0].kind).toBe("maintenance");
  });
});

describe("seedDefaultModes", () => {
  it("seeds Production (default) + Maintenance with semantic kinds (G0-9)", () => {
    const modes = seedDefaultModes();
    expect(modes).toEqual([
      {
        mode_id: "production",
        name: "Production",
        description: "Normal production mode",
        is_default: true,
        kind: "production",
      },
      {
        mode_id: "maintenance",
        name: "Maintenance",
        description: "Service / maintenance mode",
        is_default: false,
        kind: "maintenance",
      },
    ]);
  });

  it("seeds exactly one default mode", () => {
    expect(seedDefaultModes().filter((m) => m.is_default)).toHaveLength(1);
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
