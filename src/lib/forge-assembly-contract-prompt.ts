/**
 * Renders an FbInterfaceContract as a structural-constraint prompt fragment
 * for injection into the assembly Code Architect system prompt.
 *
 * Design ref: Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §5.1.
 *
 * Pure function — no React, no hooks, no IO. Suitable for both client-side
 * prompt assembly and Edge Function prompt assembly.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { isContractPopulated, isCustomRole } from "@/types/fb-interface-contract";

export interface ContractPromptOptions {
  /** Used to substitute {subsystem} tokens in process_state_reads/writes */
  subsystem?: string;
  /** Used to substitute {assembly} tokens in process_state_reads/writes */
  assemblyTag?: string;
}

function roleLabel(role: string): string {
  if (isCustomRole(role)) return `(custom:${role.slice("custom:".length)})`;
  return `(${role})`;
}

function substituteTokens(s: string, opts: ContractPromptOptions): string {
  let out = s;
  if (opts.subsystem !== undefined) out = out.replace(/\{subsystem\}/g, opts.subsystem);
  if (opts.assemblyTag !== undefined) out = out.replace(/\{assembly\}/g, opts.assemblyTag);
  return out;
}

export function buildContractConstraintBlock(
  contract: FbInterfaceContract,
  opts: ContractPromptOptions = {},
): string {
  if (!isContractPopulated(contract)) return "";

  const parts: string[] = [];

  parts.push("## INTERFACE CONTRACT — STRUCTURAL, MUST MATCH EXACTLY");
  parts.push("");
  parts.push(
    "You MUST declare the FUNCTION_BLOCK with exactly these inputs, outputs,",
  );
  parts.push(
    "and references. You may NOT add, remove, or rename them. Internal",
  );
  parts.push("variables (timers, intermediate flags, fault-code constants) are");
  parts.push("allowed and encouraged where they make the body cleaner.");

  if (contract.inputs.length > 0) {
    parts.push("");
    parts.push("VAR_INPUT (declare with these exact names and types):");
    for (const i of contract.inputs) {
      const typeStr = i.data_type === "UDT"
        ? (i.udt_name ? `"${i.udt_name}"` : "UDT (UDT name not specified)")
        : i.data_type;
      const requiredStr = i.required ? " // REQUIRED" : "";
      parts.push(`  ${i.tia_name} : ${typeStr}    ${roleLabel(i.role)} — ${i.description}${requiredStr}`);
    }
  }

  if (contract.outputs.length > 0) {
    parts.push("");
    parts.push("VAR_OUTPUT (declare with these exact names and types):");
    for (const o of contract.outputs) {
      const typeStr = o.data_type === "UDT"
        ? (o.udt_name ? `"${o.udt_name}"` : "UDT (UDT name not specified)")
        : o.data_type;
      parts.push(`  ${o.tia_name} : ${typeStr}    ${roleLabel(o.role)} — ${o.description}`);
    }
  }

  if (contract.io_slots.length > 0) {
    parts.push("");
    parts.push("IO BINDINGS (must be referenced via instance params, not hardcoded):");
    for (const s of contract.io_slots) {
      parts.push(`  ${s.slot_name} : ${s.signal_type}    ${roleLabel(s.role)} — ${s.description}`);
    }
  }

  if (contract.process_state_writes.length > 0) {
    parts.push("");
    parts.push("PROCESS STATE WRITES (must write to these exact UDT members):");
    for (const w of contract.process_state_writes) {
      parts.push(`  ${substituteTokens(w, opts)}`);
    }
  }

  if (contract.process_state_reads.length > 0) {
    parts.push("");
    parts.push("PROCESS STATE READS (the SFC will populate these — do not invent reads):");
    for (const r of contract.process_state_reads) {
      parts.push(`  ${substituteTokens(r, opts)}`);
    }
  }

  return parts.join("\n");
}
