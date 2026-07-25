// src/lib/spec-builder/__tests__/io-addressing-roundtrip.test.ts
//
// The property G0-18 exists to guarantee: after re-addressing, the tag table
// sent to TIA carries exactly the addresses the rack layout planned. Plan and
// tag derivation walk the hierarchy independently — this pins them together.
import { describe, expect, it } from "vitest";
import { planIoAddressing } from "../io-addressing";
import { collectAddressableSignals, applyIoAddresses } from "../io-addressing-apply";
import { buildHierarchyFromLegacy } from "../contract";
import { deriveIoTags } from "../codegen/io-tag-table";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

const hardware: HardwareModelV1 = {
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1511-1 PN" },
  racks: [
    {
      rack: 0,
      modules: [
        { slot: 2, module_type: "DQ 16", channel_count: 16, signal_type: "DO" },
        { slot: 3, module_type: "AI 8", channel_count: 8, signal_type: "AI" },
        { slot: 4, module_type: "DI 16", channel_count: 16, signal_type: "DI" },
      ],
    },
  ],
};

/** Two EMs of mixed classes, plus an excluded unit and a telegram signal. */
const legacyUnits = [
  {
    unit_id: "U1",
    unit_name: "Unit 1",
    equipment_type: "Other",
    description: "",
    excluded: false,
    equipment_modules: [
      {
        equipment_module_id: "EM1",
        equipment_module_name: "EM 1",
        description: "",
        control_modules: [
          {
            control_module_id: "CM1",
            control_module_name: "CM 1",
            control_module_class: "motor",
            description: "",
            is_safety: false,
            io_signals: [
              { tag: "T_DO_1", signal_type: "DO", io_address: "%Q16.0", description: "" },
              { tag: "T_DI_1", signal_type: "DI", io_address: "%I0.0", description: "" },
              { tag: "T_AI_1", signal_type: "AI", io_address: "%IW128", description: "" },
              {
                tag: "T_TEL_1",
                signal_type: "DI",
                io_address: "",
                description: "",
                source: "network_telegram",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    unit_id: "U2",
    unit_name: "Unit 2",
    equipment_type: "Other",
    description: "",
    excluded: true,
    equipment_modules: [
      {
        equipment_module_id: "EM2",
        equipment_module_name: "EM 2",
        description: "",
        control_modules: [
          {
            control_module_id: "CM2",
            control_module_name: "CM 2",
            control_module_class: "other",
            description: "",
            is_safety: false,
            io_signals: [{ tag: "T_DI_X", signal_type: "DI", io_address: "%I5.5", description: "" }],
          },
        ],
      },
    ],
  },
] as unknown as UnitConfig[];

describe("IO re-addressing round trip", () => {
  it("makes the derived TIA tag table match the planned layout", () => {
    const plan = planIoAddressing(hardware, collectAddressableSignals(legacyUnits));
    const applied = applyIoAddresses(legacyUnits, plan.assignments);

    const hierarchy = buildHierarchyFromLegacy({ confirmed_units: applied });
    const { tags } = deriveIoTags({ hierarchy });

    const derived = new Map(tags.map((t) => [t.name, t.address]));
    for (const a of plan.assignments) {
      expect(derived.get(a.tag)).toBe(a.to);
    }
    // The excluded unit and the telegram signal never reach the tag table.
    expect(derived.has("T_DI_X")).toBe(false);
    expect(derived.has("T_TEL_1")).toBe(false);
  });

  it("computes the layout across the shared input space", () => {
    const plan = planIoAddressing(hardware, collectAddressableSignals(legacyUnits));
    const to = new Map(plan.assignments.map((a) => [a.tag, a.to]));
    // AI card sits at input byte 0 (16 bytes), so the DI card starts at 16.
    expect(to.get("T_AI_1")).toBe("%IW0");
    expect(to.get("T_DI_1")).toBe("%I16.0");
    expect(to.get("T_DO_1")).toBe("%Q0.0");
  });

  it("is idempotent — re-planning applied units yields no further moves", () => {
    const first = planIoAddressing(hardware, collectAddressableSignals(legacyUnits));
    const applied = applyIoAddresses(legacyUnits, first.assignments);
    const second = planIoAddressing(hardware, collectAddressableSignals(applied));
    expect(second.assignments.filter((a) => a.changed)).toEqual([]);
  });
});
