import type {
  EquipmentModuleContract, ControlModuleStateEntry, StaticStateV2,
} from "@/types/spec-contract-v2";
import { orderStates } from "./step-order";
import { serializeAdvance } from "./serialize-condition";
import type { SaSequence, SaStep } from "./types";

/** Tokens that mean "drive this output" when found in a static-state command. */
const ACTIVE_TOKENS = new Set([
  "run", "on", "open", "extend", "extended", "raise", "raised", "forward",
  "energize", "energized", "active", "true", "start", "advance", "advanced",
]);

/** True if a static-state command string means the device is driven active. */
export function isActiveCommand(state: string): boolean {
  return ACTIVE_TOKENS.has(state.trim().toLowerCase());
}

/** Sanitise an arbitrary name into a legal SCL identifier (letters/digits/_,
 *  leading digit prefixed with `_`). */
export function sclIdent(name: string): string {
  let s = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "X";
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s;
}

/** Static-state rows are either a bare entry array (legacy) or a StaticStateV2. */
function staticEntries(
  value: ControlModuleStateEntry[] | StaticStateV2 | undefined,
): ControlModuleStateEntry[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.control_modules;
}

/**
 * Compile one Unit's EM contracts into a flat S/A sequence. Each EM contributes
 * its ordered states as steps; the EM's first (home) state is flagged. A
 * transition becomes an incoming edge on its target and a leave-condition on its
 * source. Active-commanded static outputs become the step's wires. Transitions
 * whose target is outside the EM are skipped and reported via the returned
 * warnings list.
 */
export function buildUnitSequence(
  unitId: string,
  unitName: string,
  ems: EquipmentModuleContract[],
  warnings: string[] = [],
): SaSequence {
  const steps: SaStep[] = [];
  // First pass: lay out steps and remember each EM-local state_id → flat index.
  const indexOf = new Map<string, number>(); // key: `${emId}:${stateId}`
  for (const em of ems) {
    const ordered = orderStates(em.states, em.transitions);
    ordered.forEach((s, i) => {
      const index = steps.length;
      indexOf.set(`${em.equipment_module_id}:${s.state_id}`, index);
      steps.push({
        index,
        emId: em.equipment_module_id,
        stateId: s.state_id,
        name: s.name,
        isHome: i === 0,
        incoming: [],
        leave: [],
        wires: staticEntries(em.static_states[s.state_id])
          .filter((e) => isActiveCommand(e.state))
          .map((e) => ({ tag: e.tag })),
      });
    });
  }
  // Second pass: wire transitions into incoming/leave conditions.
  for (const em of ems) {
    for (const t of em.transitions) {
      const fromIndex = indexOf.get(`${em.equipment_module_id}:${t.from_state_id}`);
      const toIndex = indexOf.get(`${em.equipment_module_id}:${t.to_state_id}`);
      if (fromIndex === undefined || toIndex === undefined) {
        warnings.push(
          `Unit ${unitName}: transition ${t.transition_id} targets a state outside EM ${em.equipment_module_id} — skipped`,
        );
        continue;
      }
      const condition = serializeAdvance(t.trigger, t.guard);
      steps[toIndex].incoming.push({ fromIndex, condition });
      steps[fromIndex].leave.push(condition);
    }
  }
  return { unitId, unitName, sclName: sclIdent(unitName), steps };
}
