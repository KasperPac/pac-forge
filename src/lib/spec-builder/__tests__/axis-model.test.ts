import { describe, expect, it } from "vitest";
import { collectGateIds, validateAxes } from "@/lib/spec-builder/axis-model";
import type { AxisV1 } from "@/types/spec-contract-v2";

const rail: AxisV1 = {
  axis_id: "rail",
  kind: "linear",
  encoder_tag: "Enc1",
  eu_unit: "mm",
  scale: { db_member: "scale", retain: true, operator_settable: false },
  length: { db_member: "length", retain: true, operator_settable: true },
  end_margin: { db_member: "end_margin", retain: true, operator_settable: false },
  ramp_zone: { db_member: "ramp_zone", retain: true, operator_settable: false },
  gates: { fwd_ok: "fwd_ok", rev_ok: "rev_ok" },
  unconfigured_open: true,
};
const rotator: AxisV1 = {
  axis_id: "rot",
  kind: "rotary",
  encoder_tag: "Enc2",
  counts_per_rev: { db_member: "k", retain: true, operator_settable: false },
  preset_offset: 0,
  home_windows: [{ center_deg10: 0, band_deg10: 20 }],
  gates: { at_home: "at_home" },
};

describe("validateAxes", () => {
  it("clean pass + collectGateIds", () => {
    expect(validateAxes({ unit_id: "u1", axes: [rail, rotator] })).toEqual([]);
    expect(collectGateIds([rail, rotator])).toEqual(
      new Set(["fwd_ok", "rev_ok", "at_home"]),
    );
  });

  it("errors on duplicate axis_id", () => {
    const issues = validateAxes({ unit_id: "u1", axes: [rail, { ...rail }] });
    expect(issues.some((i) => i.includes("duplicate axis_id"))).toBe(true);
  });

  it("errors on duplicate gate id across axes", () => {
    const rot2: AxisV1 = { ...rotator, gates: { at_home: "fwd_ok" } };
    const issues = validateAxes({ unit_id: "u1", axes: [rail, rot2] });
    expect(issues.some((i) => i.includes("gate"))).toBe(true);
  });

  it("errors on duplicate db_member within an axis", () => {
    const bad: AxisV1 = {
      ...rail,
      length: { db_member: "scale", retain: true, operator_settable: false },
    };
    expect(
      validateAxes({ unit_id: "u1", axes: [bad] }).some((i) =>
        i.includes("db_member"),
      ),
    ).toBe(true);
  });

  it("errors on band_deg10 > 1800", () => {
    const wide: AxisV1 = {
      ...rotator,
      home_windows: [{ center_deg10: 0, band_deg10: 1801 }],
    };
    expect(
      validateAxes({ unit_id: "u1", axes: [wide] }).some((i) => i.includes("band")),
    ).toBe(true);
  });

  it("no axes → no issues", () => {
    expect(validateAxes({ unit_id: "u1" })).toEqual([]);
  });
});
