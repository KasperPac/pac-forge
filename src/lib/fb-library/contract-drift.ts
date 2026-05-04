/**
 * Compare a contract's declared interface to what an AI-generated SCL
 * actually declared. Returns a structured DriftReport that drives the
 * regenerate-with-feedback loop in use-forge-assembly-generate.ts.
 *
 * Design ref: Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §5.2.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { isContractPopulated } from "@/types/fb-interface-contract";

/**
 * Raw declared interface extracted from AI-generated SCL by parseDeclaredInterface().
 * Thinner than PrefillResult — no role inference, no description extraction.
 */
export interface ParsedDeclaredInterface {
  inputs: Array<{ tia_name: string; data_type: string; udt_name?: string }>;
  outputs: Array<{ tia_name: string; data_type: string; udt_name?: string }>;
  /** Names declared in VAR / VAR_TEMP / VAR_CONSTANT blocks */
  internal_names?: string[];
  /** "ProcessState_X.Y" references found as write targets in the body */
  detected_process_state_writes?: string[];
}

export type HardDriftKind =
  | "missing_required_input"
  | "missing_required_output"
  | "input_type_mismatch"
  | "output_type_mismatch"
  | "undeclared_input"
  | "undeclared_output"
  | "missing_process_state_write";

export type SoftDriftKind =
  | "extra_internal_name"
  | "extra_fault_constant";

export interface HardDrift {
  kind: HardDriftKind;
  message: string;
}

export interface SoftDrift {
  kind: SoftDriftKind;
  message: string;
}

export interface DriftReport {
  hardDrifts: HardDrift[];
  softDrifts: SoftDrift[];
  hasHardDrift: boolean;
}

function normaliseType(t: string): string {
  return t.toUpperCase().trim();
}

export function compareToContract(
  parsed: ParsedDeclaredInterface,
  contract: FbInterfaceContract,
): DriftReport {
  const hardDrifts: HardDrift[] = [];
  const softDrifts: SoftDrift[] = [];

  if (!isContractPopulated(contract)) {
    return { hardDrifts, softDrifts, hasHardDrift: false };
  }

  const parsedInputByName = new Map(parsed.inputs.map((i) => [i.tia_name.toLowerCase(), i]));
  const parsedOutputByName = new Map(parsed.outputs.map((o) => [o.tia_name.toLowerCase(), o]));
  const contractInputNames = new Set(contract.inputs.map((i) => i.tia_name.toLowerCase()));
  const contractOutputNames = new Set(contract.outputs.map((o) => o.tia_name.toLowerCase()));

  for (const ci of contract.inputs) {
    const found = parsedInputByName.get(ci.tia_name.toLowerCase());
    if (!found) {
      if (ci.required) {
        hardDrifts.push({
          kind: "missing_required_input",
          message: `Required input "${ci.tia_name} : ${ci.data_type}" is missing from VAR_INPUT.`,
        });
      }
      continue;
    }
    if (normaliseType(found.data_type) !== normaliseType(ci.data_type)) {
      hardDrifts.push({
        kind: "input_type_mismatch",
        message: `Input "${ci.tia_name}" was declared as ${found.data_type} but contract requires ${ci.data_type}.`,
      });
    }
  }

  for (const co of contract.outputs) {
    const found = parsedOutputByName.get(co.tia_name.toLowerCase());
    if (!found) {
      hardDrifts.push({
        kind: "missing_required_output",
        message: `Output "${co.tia_name} : ${co.data_type}" is missing from VAR_OUTPUT.`,
      });
      continue;
    }
    if (normaliseType(found.data_type) !== normaliseType(co.data_type)) {
      hardDrifts.push({
        kind: "output_type_mismatch",
        message: `Output "${co.tia_name}" was declared as ${found.data_type} but contract requires ${co.data_type}.`,
      });
    }
  }

  for (const pi of parsed.inputs) {
    if (!contractInputNames.has(pi.tia_name.toLowerCase())) {
      hardDrifts.push({
        kind: "undeclared_input",
        message: `Input "${pi.tia_name}" is declared in VAR_INPUT but not in the contract — remove it.`,
      });
    }
  }
  for (const po of parsed.outputs) {
    if (!contractOutputNames.has(po.tia_name.toLowerCase())) {
      hardDrifts.push({
        kind: "undeclared_output",
        message: `Output "${po.tia_name}" is declared in VAR_OUTPUT but not in the contract — remove it.`,
      });
    }
  }

  if (contract.process_state_writes.length > 0 && parsed.detected_process_state_writes) {
    const detected = new Set(parsed.detected_process_state_writes.map((s) => s.toLowerCase()));
    for (const required of contract.process_state_writes) {
      if (!detected.has(required.toLowerCase())) {
        hardDrifts.push({
          kind: "missing_process_state_write",
          message: `Contract requires writing "${required}" but no assignment to it was found in the body.`,
        });
      }
    }
  }

  return { hardDrifts, softDrifts, hasHardDrift: hardDrifts.length > 0 };
}

export function formatDriftFeedback(report: DriftReport): string {
  if (!report.hasHardDrift) return "";
  const lines: string[] = [];
  lines.push("## PREVIOUS GENERATION HAD DRIFT — FIX THESE");
  lines.push("");
  lines.push("Your previous attempt did not match the interface contract. Fix:");
  for (const d of report.hardDrifts) {
    lines.push(`- ${d.message}`);
  }
  lines.push("");
  lines.push("Regenerate the FUNCTION_BLOCK to match the contract exactly.");
  return lines.join("\n");
}
