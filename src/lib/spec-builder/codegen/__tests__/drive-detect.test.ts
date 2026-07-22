import { describe, expect, it } from "vitest";
import { detectDrives } from "@/lib/spec-builder/codegen/drive-detect";
import type {
  DriveModelV1,
  EngineeringDataV1,
  EquipmentModuleV2,
} from "@/types/spec-contract-v2";

const CM_ID = "00000000-0000-4000-8000-000000000c01";

const g120: DriveModelV1 = {
  family: "sinamics_g120",
  telegram: 1,
  speed_ref: { unit: "percent_ref_speed", signed: true },
  enable_policy: "enable_on_nonzero_ref",
};

function em(drive?: DriveModelV1): EquipmentModuleV2 {
  return {
    equipment_module_id: "00000000-0000-4000-8000-000000000bbb",
    equipment_module_name: "Carriage Drive",
    description: "",
    control_modules: [
      {
        control_module_id: CM_ID,
        control_module_name: "Rail Motors VSD",
        control_module_class: "drive",
        is_safety: false,
        description: "",
        io_signals: [],
        ...(drive ? { drive } : {}),
      },
    ],
  };
}

const engineering: EngineeringDataV1 = {
  drives: [
    {
      control_module_id: CM_ID,
      hw_id_stw: 322,
      hw_id_zsw: 322,
      ref_speed_rpm: 1500.0,
      config_axis: 0x003f,
    },
  ],
  axis_constants: [],
  encoder_presets: [],
  fb_assignments: [],
  upstream_endpoints: [],
};

describe("detectDrives (G1-1)", () => {
  it("detects a G120 drive CM, selects SINA_SPEED, joins engineering", () => {
    const drives = detectDrives(em(g120), engineering);
    expect(drives).toHaveLength(1);
    expect(drives[0].fb_name).toBe("SINA_SPEED");
    expect(drives[0].sclName).toBe("Rail_Motors_VSD");
    expect(drives[0].engineering?.ref_speed_rpm).toBe(1500.0);
    expect(drives[0].warnings).toEqual([]);
  });

  it("selects SINA_POS for S210 and warns on missing engineering", () => {
    const drives = detectDrives(
      em({ ...g120, family: "sinamics_s210", telegram: 105 }),
      undefined,
    );
    expect(drives[0].fb_name).toBe("SINA_POS");
    expect(drives[0].warnings.some((w) => w.includes("engineering"))).toBe(true);
  });

  it("warns with no deterministic FB for non-Siemens families", () => {
    const abb: DriveModelV1 = {
      family: "abb_acs880",
      speed_ref: { unit: "percent_ref_speed", signed: true },
      enable_policy: "explicit_enable",
    };
    const drives = detectDrives(em(abb), engineering);
    expect(drives[0].fb_name).toBeUndefined();
    expect(
      drives[0].warnings.some((w) => w.includes("no deterministic driver FB")),
    ).toBe(true);
  });

  it("returns [] for EMs without drive CMs", () => {
    expect(detectDrives(em(undefined), engineering)).toEqual([]);
  });
});

describe("family registry (G1-6)", () => {
  it("consumes the shared vfd-fb-family registry as the single FB source", async () => {
    const { deterministicDriveFb } = await import("@/lib/spec-builder/vfd-fb-family");
    expect(deterministicDriveFb("sinamics_g120")).toBe("SINA_SPEED");
    expect(deterministicDriveFb("sinamics_s210")).toBe("SINA_POS");
    expect(deterministicDriveFb("abb_acs880")).toBeUndefined(); // library territory
    expect(deterministicDriveFb("other")).toBeUndefined();
  });
});
