/**
 * Boundary types describing how the subsystem SFC editor (Phase 6) will
 * invoke an assembly via its interface contract. Phase 5 produces the
 * assembly + contract; Phase 6 produces the orchestration that calls them.
 * This file is the pre-flight sketch from the design doc:
 *
 *   Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §4.1
 *
 * No implementation here — these are the contracts Phase 6 will consume.
 * Adding them now ensures the Phase 5 contract editor surfaces the right
 * fields. If Phase 6 needs more, the contract editor needs reworking; if
 * Phase 5 over-exposes, Phase 6 will only use what it needs.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";

/**
 * What an SFC step needs to know about an assembly to call it.
 *
 * `inputs` becomes the universe of assignable action targets (Step actions:
 * "set CV01.AutoRun = TRUE", "trigger LFT01.CmdRaise"). `outputs` becomes
 * the universe of guard sources for transitions ("wait until LFT01.AtUpper",
 * "branch on LFT01.Faulted").
 */
export interface AssemblySfcCallSpec {
  assembly_id: string;
  assembly_tag: string;
  /**
   * Names of inputs the SFC may write to, with their data types so the
   * SFC editor can render the right action UI (boolean toggle, numeric
   * setpoint, enum picker for command_mode, etc.).
   */
  writable_inputs: Array<{
    tia_name: string;
    data_type: FbInterfaceContract["inputs"][number]["data_type"];
    role: string;
    description: string;
  }>;
  /**
   * Names of outputs the SFC may read for guard expressions and transitions.
   */
  readable_outputs: Array<{
    tia_name: string;
    data_type: FbInterfaceContract["outputs"][number]["data_type"];
    role: string;
    description: string;
  }>;
  /**
   * UDT members this assembly writes — the SFC editor highlights these
   * when authoring guard expressions so the engineer prefers
   * assembly-owned bits over raw IO reads.
   */
  process_state_writes: string[];
}

/**
 * A single SFC step's reference to an assembly call.
 * Phase 6 will materialise these inside Step / Transition AST nodes.
 */
export interface AssemblyCallSite {
  step_id: string;
  call: AssemblySfcCallSpec;
  /**
   * Action assignments — assembly input → expression evaluated at step entry.
   */
  action_assignments: Array<{
    target_input: string;
    expression: string;
  }>;
}

/**
 * Derive the call spec from a bound assembly's contract.
 * Pure projection — Phase 6 will use this at editor mount.
 */
export type DeriveSfcCallSpec = (
  assemblyId: string,
  assemblyTag: string,
  contract: FbInterfaceContract,
) => AssemblySfcCallSpec;
