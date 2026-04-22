/**
 * Deterministic data-flow extractor. Groups `audit_cross_references`
 * rows owned by a single block into the `data_flow` shape used by the
 * Analyze step (called_blocks, reads_from, writes_to). Uses the
 * Openness `Access` enum — post-migration 073 — as the grouping key.
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §7.1 + §12.0.
 */

import type { AuditCrossReference, DataFlowAnalysis } from "@/types/audit";

type CalledBlock = NonNullable<DataFlowAnalysis["called_blocks"]>[number];
type ReadEntry = NonNullable<DataFlowAnalysis["reads_from"]>[number];
type WriteEntry = NonNullable<DataFlowAnalysis["writes_to"]>[number];

/**
 * Access enum buckets:
 *   Call                                       → static_call
 *   InstanceDB / Multiinstance                 → instance_db
 *   Read / ReadAndSymbol                       → reads_from
 *   Write / WriteAndSymbol                     → writes_to
 *   RW / Modify                                → emitted in BOTH reads_from
 *                                                 and writes_to (conservative
 *                                                 — Openness doesn't split
 *                                                 these occurrences)
 *   Everything else (Interface/Definition/Jump/
 *   Monitor/Force/Interlock/…)                 → ignored for data flow
 */
const CALL_ACCESS = new Set(["Call"]);
const INSTANCE_ACCESS = new Set(["InstanceDB", "Multiinstance"]);
const READ_ACCESS = new Set(["Read", "ReadAndSymbol"]);
const WRITE_ACCESS = new Set(["Write", "WriteAndSymbol"]);
const READ_WRITE_ACCESS = new Set(["RW", "Modify"]);

export interface ExtractDataFlowInput {
  /** All cross-refs whose `source_block_id` is this block. */
  crossReferences: AuditCrossReference[];
  /** Names of every block in the project — used to classify called_blocks.kind. */
  projectBlockNames: Set<string>;
}

export function extractDataFlow(input: ExtractDataFlowInput): DataFlowAnalysis {
  const { crossReferences: refs, projectBlockNames } = input;

  // Dedupe via Map keyed on the reference fingerprint. Openness often
  // returns the same call / read / write across multiple rungs; the audit
  // view should show one entry per (target, kind).
  const calledByKey = new Map<string, CalledBlock>();
  const readsByKey = new Map<string, ReadEntry>();
  const writesByKey = new Map<string, WriteEntry>();

  for (const xr of refs) {
    const access = xr.access ?? "";

    // Calls + instance DB references.
    if (CALL_ACCESS.has(access) || INSTANCE_ACCESS.has(access)) {
      const name = xr.target_name ?? xr.referenced_as_name ?? null;
      if (!name) continue;
      const key = `${name}|${INSTANCE_ACCESS.has(access) ? "inst" : "call"}`;
      if (!calledByKey.has(key)) {
        calledByKey.set(key, {
          name,
          kind: projectBlockNames.has(name) ? "project" : "library",
          call_context: INSTANCE_ACCESS.has(access) ? "instance_db" : "static_call",
        });
      }
      continue;
    }

    // Reads / writes.
    const reference = pickReferenceString(xr);
    if (!reference) continue;
    const kindRead = inferReadKind(xr);
    const kindWrite = inferWriteKind(xr);

    if (READ_ACCESS.has(access) || READ_WRITE_ACCESS.has(access)) {
      const key = `${reference}|r`;
      if (!readsByKey.has(key)) {
        readsByKey.set(key, { reference, kind: kindRead });
      }
    }
    if (WRITE_ACCESS.has(access) || READ_WRITE_ACCESS.has(access)) {
      const key = `${reference}|w`;
      if (!writesByKey.has(key)) {
        writesByKey.set(key, { reference, kind: kindWrite });
      }
    }
  }

  const dataFlow: DataFlowAnalysis = {};
  if (calledByKey.size) dataFlow.called_blocks = [...calledByKey.values()];
  if (readsByKey.size) dataFlow.reads_from = [...readsByKey.values()];
  if (writesByKey.size) dataFlow.writes_to = [...writesByKey.values()];
  return dataFlow;
}

// ---------------------------------------------------------------------------
// Reference string + kind classification
// ---------------------------------------------------------------------------

/**
 * Prefer the symbolic location path (`"DB".Field` or `#Var.Member`) since
 * that's what an auditor cares about. Fall back to `target_name` (pure DB
 * name) and finally to absolute address.
 */
function pickReferenceString(xr: AuditCrossReference): string | null {
  return (
    xr.location_name ??
    xr.target_name ??
    xr.location_address ??
    xr.target_address ??
    null
  );
}

const ABS_INPUT_RE = /^%I[BWDX]?\d/i;
const ABS_OUTPUT_RE = /^%Q[BWDX]?\d/i;
const ABS_MEMORY_RE = /^%M[BWDX]?\d/i;

function inferReadKind(xr: AuditCrossReference): ReadEntry["kind"] {
  const addr = xr.location_address ?? xr.target_address ?? "";
  if (ABS_INPUT_RE.test(addr)) return "io_input";
  if (ABS_MEMORY_RE.test(addr)) return "global_memory";

  return inferDbKind(xr);
}

function inferWriteKind(xr: AuditCrossReference): WriteEntry["kind"] {
  const addr = xr.location_address ?? xr.target_address ?? "";
  if (ABS_OUTPUT_RE.test(addr)) return "io_output";
  if (ABS_MEMORY_RE.test(addr)) return "global_memory";

  return inferDbKind(xr);
}

/**
 * DB targets come in two flavours — global / shared DBs and instance DBs
 * belonging to other FBs. Openness `TypeName` distinguishes them on the
 * source side (`"Global DB"` / `"Instance DB"`) and the `target_type_name`
 * column carries the label verbatim. Returns one of the three DB kinds
 * shared between read and write entry types — never `io_input` / `io_output`
 * (those are address-driven and handled by the callers).
 */
function inferDbKind(
  xr: AuditCrossReference,
): "project_db" | "other_instance_db" | "global_memory" {
  const typeName = (xr.target_type_name ?? xr.location_type_name ?? "").toLowerCase();
  if (typeName.includes("instance")) return "other_instance_db";
  // Plain data blocks, UDT-typed globals, and symbolic tag references all
  // default to project_db — auditor can refine if needed.
  return "project_db";
}
