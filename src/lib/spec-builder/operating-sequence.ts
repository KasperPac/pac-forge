/**
 * Operating-sequence ("Steps & Actions") view helpers, shared by the DOCX
 * exporter and the structured editor so both present an EM's operation the same
 * way. Each EM state is a step: its Action is the outputs it holds (static) or a
 * pointer to its sub-sequence (sequential); its "Advance when" is the outgoing
 * transitions with their permissive guards.
 */
import type { FunctionalDescriptionContent, SpecSection, UnitConfig } from "@/types/spec-builder";

/** The Action column for a step: device outputs held, or a sequence pointer. */
export function summarizeAction(fd: FunctionalDescriptionContent): string[] {
  if (fd.pattern === "sequential") return ["Sequenced — see steps below"];
  const ds = fd.control_module_states ?? [];
  if (!ds.length) return ["—"];
  return ds.map((d) => `${d.tag}: ${d.state}`);
}

/** The "Advance when" column: each transition as "<trigger> → <target> (if <permissives>)". */
export function summarizeAdvance(fd: FunctionalDescriptionContent): string[] {
  const trs = fd.transitions ?? [];
  if (!trs.length) return ["—"];
  return trs.map(
    (t) => `${t.trigger} → ${t.to_state}${t.permissives.length ? `  (if ${t.permissives.join("; ")})` : ""}`,
  );
}

export interface EmStepGroup {
  emId: string;
  emName: string;
  states: SpecSection[];
}

/**
 * Group a unit's functional_description rows by equipment module, preserving
 * first-appearance order, and resolve each EM's display name from the unit
 * config. The EM id is read from content_json (compose writes it there) with a
 * fallback to the column.
 */
export function groupUnitStatesByEm(
  funcDescs: SpecSection[],
  unitCfg: UnitConfig | undefined,
): EmStepGroup[] {
  const emNameById: Record<string, string> = {};
  for (const e of unitCfg?.equipment_modules ?? []) emNameById[e.equipment_module_id] = e.equipment_module_name;

  const order: string[] = [];
  const byEm: Record<string, SpecSection[]> = {};
  for (const fd of funcDescs) {
    const emId =
      (fd.content_json as { equipment_module_id?: string })?.equipment_module_id ??
      (fd as { equipment_module_id?: string }).equipment_module_id ??
      "_";
    if (!byEm[emId]) { byEm[emId] = []; order.push(emId); }
    byEm[emId].push(fd);
  }
  return order.map((emId) => ({ emId, emName: emNameById[emId] ?? "Equipment Module", states: byEm[emId] }));
}
