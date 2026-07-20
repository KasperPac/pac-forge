import { describe, expect, it } from "vitest";
import {
  validateDriveModels,
  type DriveModelSpecView,
} from "@/lib/spec-builder/drive-model";
import type { DriveModelV1 } from "@/types/spec-contract-v2";

const CM_ID = "00000000-0000-4000-8000-000000000001";

const g120: DriveModelV1 = {
  family: "sinamics_g120",
  telegram: 1,
  speed_ref: { unit: "percent_ref_speed", signed: true },
  enable_policy: "enable_on_nonzero_ref",
};

function view(overrides: Partial<DriveModelSpecView> = {}): DriveModelSpecView {
  return {
    control_modules: [
      { control_module_id: CM_ID, control_module_name: "VSD1", drive: g120 },
    ],
    engineering: { drives: [{ control_module_id: CM_ID, config_axis: 0x003f }] },
    ...overrides,
  };
}

describe("validateDriveModels — telegram/family table", () => {
  it("accepts the golden-master G120 + Tg1 pairing", () => {
    expect(validateDriveModels(view()).errors).toEqual([]);
  });

  it("errors on a telegram outside the family's supported set", () => {
    const v = view();
    v.control_modules[0].drive = { ...g120, telegram: 105 };
    expect(validateDriveModels(v).errors).toHaveLength(1);
  });

  it("errors when a non-telegram family carries a telegram", () => {
    const v = view();
    v.control_modules[0].drive = { ...g120, family: "abb_acs880" };
    expect(validateDriveModels(v).errors).toHaveLength(1);
  });

  it("warns (not errors) on a Siemens family with telegram absent", () => {
    const v = view();
    const { telegram: _telegram, ...rest } = g120;
    v.control_modules[0].drive = rest;
    const out = validateDriveModels(v);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w) => w.includes("no telegram"))).toBe(true);
  });

  it("family 'other' is unconstrained", () => {
    const v = view();
    v.control_modules[0].drive = { ...g120, family: "other", telegram: 350 };
    expect(validateDriveModels(v).errors).toEqual([]);
  });
});

describe("validateDriveModels — engineering cross-refs", () => {
  it("errors on an entry referencing an unknown control module", () => {
    const v = view({
      engineering: {
        drives: [
          {
            control_module_id: "00000000-0000-4000-8000-00000000dead",
            config_axis: 0x003f,
          },
        ],
      },
    });
    expect(validateDriveModels(v).errors.some((e) => e.includes("unknown"))).toBe(true);
  });

  it("errors on an entry for a CM without a drive model", () => {
    const v = view();
    v.control_modules[0].drive = undefined;
    expect(validateDriveModels(v).errors.some((e) => e.includes("no drive"))).toBe(true);
  });

  it("errors on duplicate entries for one CM", () => {
    const v = view();
    v.engineering = {
      drives: [
        { control_module_id: CM_ID, config_axis: 0x003f },
        { control_module_id: CM_ID, config_axis: 0x003f },
      ],
    };
    expect(validateDriveModels(v).errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("warns when a drive CM has no engineering entry (pre-commissioning)", () => {
    const v = view({ engineering: { drives: [] } });
    expect(validateDriveModels(v).errors).toEqual([]);
    expect(validateDriveModels(v).warnings.some((w) => w.includes("engineering"))).toBe(
      true,
    );
  });

  it("no engineering context at all → warnings only, no errors", () => {
    const v = view({ engineering: undefined });
    expect(validateDriveModels(v).errors).toEqual([]);
  });
});
