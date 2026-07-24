import type { SpecContractV2 } from "@/types/spec-contract-v2";

// A filling station with a fault. The valve CM has only a DO (Open) — no
// run/running feedback DI — so buildSimRules must emit zero sim rules for it
// (there is nothing genuine to correlate). The fault is the only alarm
// source. Deliberately shares NO device names with conveyor-contract.ts.
export const fillerContract = {
  hierarchy: {
    units: [
      {
        unit_id: "u1",
        unit_name: "Fill Station",
        excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "em1",
            equipment_module_name: "Filler",
            control_modules: [
              {
                control_module_id: "f1",
                control_module_name: "Fill Valve",
                control_module_class: "valve",
                is_safety: false,
                description: "",
                io_signals: [
                  { tag: "VLV01_Open", signal_type: "DO", io_address: "Q1.0", description: "Open", source: "wired" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  equipment_modules: {},
  alarms: [],
  io_list: [],
  faults: [
    {
      fault_code: "F10",
      description: "Overpressure trip",
      triggered_by_tag: "VLV01_Ovl",
      severity: "fault",
      affected_control_modules: ["f1"],
      action_text: "close",
    },
  ],
} as unknown as SpecContractV2;
