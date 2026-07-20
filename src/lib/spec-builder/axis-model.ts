/**
 * G0-4 axis-geometry semantics — pure helpers, no React/IO.
 * Gate ids collected here form the named_gate registry consumed by
 * validateSignalRouting (G0-3 seam activation).
 * Design: Docs/superpowers/specs/2026-07-20-g0-4-axis-geometry-design.md
 */
import type {
  AxisV1,
  GeometryParamDef,
  UnitCoordinationV1,
} from "@/types/spec-contract-v2";

function paramDefs(axis: AxisV1): GeometryParamDef[] {
  return axis.kind === "linear"
    ? [axis.scale, axis.length, axis.end_margin, axis.ramp_zone]
    : [axis.counts_per_rev];
}

function gateIds(axis: AxisV1): string[] {
  return Object.values(axis.gates).filter(
    (g): g is string => typeof g === "string",
  );
}

/** All gate ids a unit's axes define — the unit's named_gate registry. */
export function collectGateIds(axes: AxisV1[]): Set<string> {
  return new Set(axes.flatMap(gateIds));
}

export function validateAxes(
  coord: Pick<UnitCoordinationV1, "unit_id" | "axes">,
  ctx: { memberEmIds?: Set<string> } = {},
): string[] {
  const axes = coord.axes;
  if (!axes) return [];
  const issues: string[] = [];
  const where = `unit_coordination[${coord.unit_id}].axes`;

  const axisIds = new Set<string>();
  const seenGates = new Set<string>();
  for (const axis of axes) {
    if (axisIds.has(axis.axis_id)) {
      issues.push(`${where}: duplicate axis_id "${axis.axis_id}"`);
    }
    axisIds.add(axis.axis_id);

    const members = new Set<string>();
    for (const p of paramDefs(axis)) {
      if (members.has(p.db_member)) {
        issues.push(
          `${where}[${axis.axis_id}]: duplicate db_member "${p.db_member}"`,
        );
      }
      members.add(p.db_member);
    }

    for (const gid of gateIds(axis)) {
      if (seenGates.has(gid)) {
        issues.push(`${where}: gate "${gid}" defined by more than one axis`);
      }
      seenGates.add(gid);
    }

    if (axis.kind === "rotary") {
      for (const w of axis.home_windows) {
        if (w.band_deg10 > 1800) {
          issues.push(
            `${where}[${axis.axis_id}]: home window band ${w.band_deg10} exceeds 1800 (±180°)`,
          );
        }
      }
    }

    // G0-5: preset run-interlock EM must belong to the unit (ctx-gated).
    const blockedEm = axis.preset?.blocked_while_em_execute;
    if (blockedEm && ctx.memberEmIds && !ctx.memberEmIds.has(blockedEm)) {
      issues.push(
        `${where}[${axis.axis_id}]: preset blocked_while_em_execute EM ${blockedEm} is not a member of this unit`,
      );
    }
  }

  return issues;
}
