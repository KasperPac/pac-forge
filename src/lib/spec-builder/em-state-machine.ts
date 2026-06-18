/**
 * Pure logic for the hybrid per-Equipment-Module state model.
 *
 *  - resolveAllowedStates: given a machine mode, which of an EM's states
 *    are valid (allowed_modes empty = all modes).
 *  - resolveForcedSafeStates: given violated safety gates, which EMs are
 *    forced to their is_safe_state, respecting each gate's scope.
 *  - validateEmStateMachine: structural invariants on one EM's machine.
 *
 * No React, no IO. Deterministic and auditable (rules > AI).
 */
import type {
  EquipmentModuleContract,
  EmStateV2,
  SafetyGateV2,
} from "@/types/spec-contract-v2";

/** States valid in the given machine mode. Empty allowed_modes = all modes. */
export function resolveAllowedStates(
  em: EquipmentModuleContract,
  modeId: string,
): EmStateV2[] {
  return em.states.filter(
    (s) => s.allowed_modes.length === 0 || s.allowed_modes.includes(modeId),
  );
}

function gateAppliesToEm(gate: SafetyGateV2, emId: string): boolean {
  return gate.scope === "all" || gate.scope.includes(emId);
}

/**
 * For each EM in scope of a *violated* gate, resolve the EM-local state_id
 * it is forced into (its is_safe_state). Returns Map<emId, safeStateId>.
 * EMs with no marked safe state are skipped (validate separately).
 */
export function resolveForcedSafeStates(
  ems: EquipmentModuleContract[],
  gates: SafetyGateV2[],
  violatedGateIds: string[],
): Map<string, string> {
  const violated = new Set(violatedGateIds);
  const activeGates = gates.filter((g) => violated.has(g.gate_id));
  const out = new Map<string, string>();
  for (const em of ems) {
    const inScope = activeGates.some((g) => gateAppliesToEm(g, em.equipment_module_id));
    if (!inScope) continue;
    const safe = em.states.find((s) => s.is_safe_state);
    if (safe) out.set(em.equipment_module_id, safe.state_id);
  }
  return out;
}

/**
 * Structural invariants for one EM's state machine. Returns human-readable
 * issues (empty = valid). An EM with zero states is treated as
 * "skeleton not authored yet" and passes silently.
 */
export function validateEmStateMachine(em: EquipmentModuleContract): string[] {
  const issues: string[] = [];
  const where = `equipment_module ${em.equipment_module_id}`;
  if (em.states.length === 0) return issues;

  const safeCount = em.states.filter((s) => s.is_safe_state).length;
  if (safeCount !== 1) {
    issues.push(`${where}: exactly one is_safe_state required, found ${safeCount}`);
  }

  const stateIds = new Set(em.states.map((s) => s.state_id));
  const dupStateIds = em.states
    .map((s) => s.state_id)
    .filter((id, i, a) => a.indexOf(id) !== i);
  for (const id of new Set(dupStateIds)) {
    issues.push(`${where}: duplicate state_id "${id}"`);
  }

  const seenTransitionIds = new Set<string>();
  for (const t of em.transitions) {
    if (seenTransitionIds.has(t.transition_id)) {
      issues.push(`${where}: duplicate transition_id "${t.transition_id}"`);
    }
    seenTransitionIds.add(t.transition_id);
    if (!stateIds.has(t.from_state_id)) {
      issues.push(`${where}: transition ${t.transition_id} from unknown state "${t.from_state_id}"`);
    }
    if (!stateIds.has(t.to_state_id)) {
      issues.push(`${where}: transition ${t.transition_id} targets unknown state "${t.to_state_id}"`);
    }
  }

  return issues;
}
