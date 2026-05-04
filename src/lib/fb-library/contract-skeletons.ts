/**
 * Hardcoded starter contract shapes — pre-fills the contract editor when
 * the engineer picks a skeleton in the spec wizard's custom-assembly path.
 *
 * Per Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §4.1 step 4.
 *
 * Generic across machine types — no project-specific names.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { EMPTY_INTERFACE_CONTRACT } from "@/types/fb-interface-contract";

export interface ContractSkeleton {
  id: string;
  label: string;
  description: string;
  contract: FbInterfaceContract;
}

const COMMON_INPUTS: FbInterfaceContract["inputs"] = [
  { name: "AutoRun", tia_name: "AutoRun", data_type: "BOOL", role: "auto_run", description: "Master enable from orchestration", required: true },
  { name: "Reset", tia_name: "Reset", data_type: "BOOL", role: "reset_cmd", description: "Edge-triggered fault reset", required: true },
];

const COMMON_OUTPUTS: FbInterfaceContract["outputs"] = [
  { name: "Running", tia_name: "Running", data_type: "BOOL", role: "running", description: "TRUE while the assembly is in any active motion state" },
  { name: "Faulted", tia_name: "Faulted", data_type: "BOOL", role: "faulted", description: "TRUE while a latched fault is present" },
  { name: "FaultCode", tia_name: "FaultCode", data_type: "WORD", role: "fault_code", description: "Active fault code (0 = no fault)" },
];

export const CONTRACT_SKELETONS: ContractSkeleton[] = [
  {
    id: "from_scratch",
    label: "From scratch",
    description: "Empty contract — author every field manually",
    contract: { ...EMPTY_INTERFACE_CONTRACT },
  },
  {
    id: "single_actuator",
    label: "Single actuator",
    description: "One DO command, one DI feedback. Pneumatic cylinder, solenoid valve, simple latch.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdActuate", tia_name: "CmdActuate", data_type: "BOOL", role: "start_cmd", description: "Pulse-or-level command from orchestration", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "AtTarget", tia_name: "AtTarget", data_type: "BOOL", role: "at_target", description: "TRUE when actuator is at commanded position" },
      ],
      io_slots: [
        { slot_name: "actuator_command", signal_type: "DO", role: "actuator_command", description: "Solenoid energise output", cardinality: "one" },
        { slot_name: "position_sensor", signal_type: "DI", role: "position_sensor", description: "End-of-stroke prox", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: ["ProcessState_{subsystem}.{assembly}_AtTarget"],
    },
  },
  {
    id: "two_actuator",
    label: "Two actuators",
    description: "Pusher / extend-retract cylinder / dual-solenoid actuator. Two DOs, two DIs.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdExtend", tia_name: "CmdExtend", data_type: "BOOL", role: "command_extend", description: "TRUE to extend, FALSE to retract", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "Extended", tia_name: "Extended", data_type: "BOOL", role: "extended", description: "TRUE at extend prox" },
        { name: "Retracted", tia_name: "Retracted", data_type: "BOOL", role: "retracted", description: "TRUE at retract prox" },
      ],
      io_slots: [
        { slot_name: "extend_command", signal_type: "DO", role: "extend_command", description: "Extend solenoid", cardinality: "one" },
        { slot_name: "retract_command", signal_type: "DO", role: "retract_command", description: "Retract solenoid (optional for spring-return)", cardinality: "zero_or_one" },
        { slot_name: "extend_sensor", signal_type: "DI", role: "position_sensor", description: "Extend prox", cardinality: "one" },
        { slot_name: "retract_sensor", signal_type: "DI", role: "position_sensor", description: "Retract prox", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_Extended",
        "ProcessState_{subsystem}.{assembly}_Retracted",
      ],
    },
  },
  {
    id: "rotary",
    label: "Rotary station",
    description: "Two-position rotary index — turntable, swing gate, diverter.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdPosition", tia_name: "CmdPosition", data_type: "BOOL", role: "command_position", description: "FALSE = home, TRUE = rotated", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "AtHome", tia_name: "AtHome", data_type: "BOOL", role: "at_home", description: "" },
        { name: "AtRotated", tia_name: "AtRotated", data_type: "BOOL", role: "at_position", description: "" },
      ],
      io_slots: [
        { slot_name: "rotate_fwd_command", signal_type: "DO", role: "rotate_command", description: "Rotate-forward contactor / valve", cardinality: "one" },
        { slot_name: "rotate_rev_command", signal_type: "DO", role: "rotate_command", description: "Rotate-reverse (omit for spring-return)", cardinality: "zero_or_one" },
        { slot_name: "home_sensor", signal_type: "DI", role: "home_sensor", description: "", cardinality: "one" },
        { slot_name: "rotated_sensor", signal_type: "DI", role: "position_sensor", description: "", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_AtHome",
        "ProcessState_{subsystem}.{assembly}_AtRotated",
      ],
    },
  },
  {
    id: "lift",
    label: "Lift station",
    description: "Vertical lift between fixed levels — N proxes, up/down commands, optional permissive.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdLevel", tia_name: "CmdLevel", data_type: "INT", role: "command_level", description: "Target level (0 = bottom, 1 = next, …)", required: true },
        { name: "Permissive_LoadClear", tia_name: "Permissive_LoadClear", data_type: "BOOL", role: "permissive", description: "External permissive — block lift while load is in transit", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "AtLevel", tia_name: "AtLevel", data_type: "INT", role: "at_level", description: "Current level (-1 = between)" },
        { name: "Moving", tia_name: "Moving", data_type: "BOOL", role: "moving", description: "" },
      ],
      io_slots: [
        { slot_name: "up_command", signal_type: "DO", role: "lift_command", description: "", cardinality: "one" },
        { slot_name: "down_command", signal_type: "DO", role: "lower_command", description: "", cardinality: "one" },
        { slot_name: "level_sensors", signal_type: "DI", role: "level_sensor", description: "One DI per fixed level", cardinality: "one_or_more" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_AtLevel",
        "ProcessState_{subsystem}.{assembly}_Moving",
      ],
    },
  },
  {
    id: "accumulator",
    label: "Accumulator buffer",
    description: "Conveyor with upstream/downstream handshake holding a queue between stations.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "UpstreamReady", tia_name: "UpstreamReady", data_type: "BOOL", role: "upstream_ready", description: "Feeder asserts ready-to-deliver", required: true },
        { name: "DownstreamReady", tia_name: "DownstreamReady", data_type: "BOOL", role: "downstream_ready", description: "Discharger asserts ready-to-receive", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "Full", tia_name: "Full", data_type: "BOOL", role: "full", description: "" },
        { name: "Empty", tia_name: "Empty", data_type: "BOOL", role: "empty", description: "" },
      ],
      io_slots: [
        { slot_name: "infeed_photoeye", signal_type: "DI", role: "infeed_sensor", description: "", cardinality: "one" },
        { slot_name: "discharge_photoeye", signal_type: "DI", role: "discharge_sensor", description: "", cardinality: "one" },
        { slot_name: "motor_command", signal_type: "DO", role: "motor_contactor", description: "", cardinality: "one" },
        { slot_name: "motor_running_feedback", signal_type: "DI", role: "running_feedback", description: "", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_Full",
        "ProcessState_{subsystem}.{assembly}_Empty",
      ],
    },
  },
];

export function getSkeleton(id: string): FbInterfaceContract | null {
  const found = CONTRACT_SKELETONS.find(s => s.id === id);
  return found ? { ...found.contract } : null;
}
