import type { SpecContractV2 } from "@/types/spec-contract-v2";

// A 2-conveyor transfer line: each conveyor CM has one run DO + one running
// feedback DI. Deliberately shares NO device names with filler-contract.ts —
// genericity means the logic must produce correct output from the contract
// shape alone, not from any device-name pattern-matching.
const cm = (id: string, name: string, run: string, fbk: string) => ({
  control_module_id: id,
  control_module_name: name,
  control_module_class: "conveyor",
  is_safety: false,
  description: "",
  io_signals: [
    { tag: run, signal_type: "DO", io_address: "Q0.0", description: "Run", source: "wired" },
    { tag: fbk, signal_type: "DI", io_address: "I0.0", description: "Running feedback", source: "wired" },
  ],
});

export const conveyorContract = {
  hierarchy: {
    units: [
      {
        unit_id: "u1",
        unit_name: "Transfer",
        excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "em1",
            equipment_module_name: "Infeed",
            control_modules: [cm("c1", "Infeed Conveyor", "CV01_Run", "CV01_Fbk")],
          },
          {
            equipment_module_id: "em2",
            equipment_module_name: "Outfeed",
            control_modules: [cm("c2", "Outfeed Conveyor", "CV02_Run", "CV02_Fbk")],
          },
        ],
      },
    ],
  },
  equipment_modules: {},
  alarms: [],
  faults: [],
  io_list: [],
} as unknown as SpecContractV2;
