/**
 * G0-3 signal-routing semantics — pure helpers, no React/IO.
 * Context-dependent checks skip when their context is absent (same
 * convention as validateUnitCoordination). named_gate existence is
 * intentionally unchecked until G0-4 ships the gate registry.
 * Design: Docs/superpowers/specs/2026-07-20-g0-3-signal-routing-design.md
 */
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";

export function validateSignalRouting(
  coord: Pick<UnitCoordinationV1, "unit_id" | "signal_routing">,
  ctx: {
    memberEmIds?: Set<string>;
    safetyGateIds?: Set<string>;
    /** The unit's axis gate registry (G0-4). Absent = check skipped. */
    namedGateIds?: Set<string>;
  },
): string[] {
  const sr = coord.signal_routing;
  if (!sr) return [];
  const issues: string[] = [];
  const where = `unit_coordination[${coord.unit_id}].signal_routing`;

  const rowIds = new Set<string>();
  const targets = new Set<string>();
  for (const row of sr.routing_rows) {
    if (rowIds.has(row.row_id)) {
      issues.push(`${where}: duplicate row_id "${row.row_id}"`);
    }
    rowIds.add(row.row_id);

    const targetKey = `${row.target.equipment_module_id}::${row.target.pin}`;
    if (targets.has(targetKey)) {
      issues.push(
        `${where}: duplicate target ${row.target.pin} on EM ${row.target.equipment_module_id} — one row per pin`,
      );
    }
    targets.add(targetKey);

    if (ctx.memberEmIds && !ctx.memberEmIds.has(row.target.equipment_module_id)) {
      issues.push(
        `${where}[${row.row_id}]: target EM ${row.target.equipment_module_id} is not a member of this unit`,
      );
    }
    for (const ref of [row.source, ...row.gates]) {
      if (
        ctx.memberEmIds &&
        ref.kind === "em_status" &&
        !ctx.memberEmIds.has(ref.equipment_module_id)
      ) {
        issues.push(
          `${where}[${row.row_id}]: em_status source ${ref.equipment_module_id} is not a member of this unit (cross-unit reads are v2)`,
        );
      }
      // G0-4 activation: check refs against the unit's axis gate registry.
      if (
        ctx.namedGateIds &&
        ref.kind === "named_gate" &&
        !ctx.namedGateIds.has(ref.gate_id)
      ) {
        issues.push(
          `${where}[${row.row_id}]: named_gate "${ref.gate_id}" is not defined by this unit's axes`,
        );
      }
    }
  }

  for (const td of sr.two_detent) {
    if (td.jog_row_id === td.fast_row_id) {
      issues.push(
        `${where}: two_detent references the same row for jog and fast ("${td.jog_row_id}")`,
      );
    }
    for (const id of [td.jog_row_id, td.fast_row_id]) {
      if (!rowIds.has(id)) {
        issues.push(`${where}: two_detent references unknown row "${id}"`);
      }
    }
  }

  if (sr.safety_healthy && ctx.safetyGateIds) {
    for (const gid of sr.safety_healthy.gate_ids) {
      if (!ctx.safetyGateIds.has(gid)) {
        issues.push(
          `${where}: safety_healthy references unknown safety gate "${gid}"`,
        );
      }
    }
  }

  return issues;
}
