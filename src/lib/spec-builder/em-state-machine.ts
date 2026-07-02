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
import {
  EmStateV2Schema,
  EmTransitionV2Schema,
} from "@/types/spec-contract-v2";
import type {
  EquipmentModuleContract,
  EmStateV2,
  EmTransitionV2,
  SafetyGateV2,
} from "@/types/spec-contract-v2";
import { z } from "zod";
import { isPackmlSlug } from "@/lib/spec-builder/packml-states";

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

/**
 * PackML conformance for one EM's state machine — SEPARATE from the structural
 * validateEmStateMachine so it can be adopted incrementally. SP-3b wired this
 * into the co-author Stage-A persist path (via validateEmStateMachineAndPackml
 * below); it is deliberately NOT wired into validateSpecContractPatch (the
 * global patch validator), so pre-SP-3b free-slug specs keep working in Stage B.
 * Soft issues; never blocks Zod parsing. Empty machine → [].
 */
export function validateEmPackmlConformance(em: EquipmentModuleContract): string[] {
  const issues: string[] = [];
  const where = `equipment_module ${em.equipment_module_id}`;
  if (em.states.length === 0) return issues;

  for (const s of em.states) {
    if (!isPackmlSlug(s.state_id)) {
      issues.push(`${where}: non-PackML state_id "${s.state_id}" (expected a PackML slug)`);
    }
  }

  const safe = em.states.filter((s) => s.is_safe_state);
  if (safe.length === 1 && safe[0].state_id !== "aborted") {
    issues.push(`${where}: safe state must be "aborted", found "${safe[0].state_id}"`);
  }

  const byId = new Map(em.states.map((s) => [s.state_id, s]));
  for (const key of Object.keys(em.command_behavior ?? {})) {
    const st = byId.get(key);
    if (!st) {
      issues.push(`${where}: command_behavior for unknown state "${key}"`);
    } else if (st.kind !== "sequential") {
      issues.push(`${where}: command_behavior on non-acting state "${key}" (must be a sequential state)`);
    }
  }

  return issues;
}

/**
 * Full Stage-A gate for one EM's authored machine: structural invariants
 * (validateEmStateMachine) followed by PackML conformance
 * (validateEmPackmlConformance). Structural issues are listed first so the
 * co-author surfaces shape problems before vocabulary problems. This is the
 * single function the Stage-A persist path (use-fds-conversation.ts) calls;
 * both component validators remain independently exported and tested.
 *
 * SP-3b: this composition is wired into the CO-AUTHOR Stage-A path only, NOT
 * into validateSpecContractPatch — wiring conformance into the global patch
 * validator would re-check already-persisted free-slug states and break the
 * Stage-B path for pre-SP-3b specs (reconciled per-spec in SP-3d).
 */
export function validateEmStateMachineAndPackml(em: EquipmentModuleContract): string[] {
  return [...validateEmStateMachine(em), ...validateEmPackmlConformance(em)];
}

/**
 * Structural checks for one EM's command_behavior (SP-3c) — the command-
 * conditional device holds authored by Stage B. Runs inside
 * validateSpecContractPatch, safely for pre-SP-3c specs: absent/empty
 * command_behavior → []. The key-must-be-a-sequential-state rule mirrors
 * validateEmPackmlConformance's check but is re-applied here because the two
 * validators fire on different gates (Stage A persist vs Stage B patch); it is
 * skipped when the EM's states are absent from the patch. No PackML slug
 * enforcement here — the SP-3b Stage-A-only boundary stands.
 */
export function validateCommandBehavior(em: EquipmentModuleContract): string[] {
  const issues: string[] = [];
  const where = `equipment_module ${em.equipment_module_id}`;
  const byId = new Map(em.states.map((s) => [s.state_id, s]));

  for (const [stateId, behavior] of Object.entries(em.command_behavior ?? {})) {
    const seen = new Set<string>();
    for (const b of behavior.branches) {
      if (seen.has(b.branch_id)) {
        issues.push(`${where}: duplicate branch_id "${b.branch_id}" in command_behavior["${stateId}"]`);
      }
      seen.add(b.branch_id);
    }
    if (em.states.length > 0) {
      const st = byId.get(stateId);
      if (!st) {
        issues.push(`${where}: command_behavior for unknown state "${stateId}"`);
      } else if (st.kind !== "sequential") {
        issues.push(`${where}: command_behavior on non-acting state "${stateId}" (must be a sequential state)`);
      }
    }
  }
  return issues;
}

// ============================================================
// Stage-A proposal parsing (co-author state-machine interview)
// ============================================================

const StateMachineProposalSchema = z.object({
  states: z.array(EmStateV2Schema),
  transitions: z.array(EmTransitionV2Schema).default([]),
});

export interface StateMachineProposal {
  states: EmStateV2[];
  transitions: EmTransitionV2[];
}

/**
 * Deterministic safety net for the per-EM trigger model.
 *
 * A command trigger's `expr` is, by contract, a SINGLE condition
 * (`EmTriggerSchema`). But the universal "any of N faults → Faulted" pattern is
 * an OR of many tags, which AI authors naturally emit as
 * `expr: [c1..cN], trigger_logic: "OR"`. That array fails schema validation, so
 * historically the ENTIRE proposal was rejected and NO states persisted (silent
 * Stage-A data loss for any non-trivial machine).
 *
 * To make persistence robust for EVERY machine, expand any transition whose
 * command `expr` is an array into one single-condition transition per term —
 * sharing from/to/guard, with unique transition_ids derived from the original.
 * The OR is preserved as parallel transitions (each a valid single condition).
 * Single-condition transitions and non-command triggers pass through untouched.
 *
 * Operates on the raw JSON BEFORE schema validation, because the array shape is
 * itself schema-invalid.
 */
function expandOrTriggers(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.transitions)) return raw;

  const expanded: unknown[] = [];
  for (const t of obj.transitions) {
    if (!t || typeof t !== "object") {
      expanded.push(t);
      continue;
    }
    const tr = t as Record<string, unknown>;
    const trigger = tr.trigger as Record<string, unknown> | undefined;
    const expr = trigger?.expr;

    if (trigger && trigger.kind === "command" && Array.isArray(expr)) {
      const baseId =
        typeof tr.transition_id === "string" ? tr.transition_id : "transition";
      expr.forEach((cond, i) => {
        expanded.push({
          ...tr,
          transition_id: expr.length === 1 ? baseId : `${baseId}_or${i}`,
          trigger: { kind: "command", expr: cond },
        });
      });
    } else {
      expanded.push(t);
    }
  }

  return { ...obj, transitions: expanded };
}

/**
 * Extract the Stage-A `{ states, transitions }` proposal from an AI response.
 * Reads the first fenced ```json block, parses it, and validates the shape
 * with the Zod schemas (applying defaults like allowed_modes=[],
 * is_safe_state=false, guard=[]). Returns null when there is no parseable,
 * schema-valid proposal block — callers treat that as "still gathering info".
 *
 * Pure + deterministic; no React, no IO.
 */
export function parseStateMachineProposal(
  text: string,
): StateMachineProposal | null {
  const match = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (!match) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }

  raw = expandOrTriggers(raw);

  const parsed = StateMachineProposalSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.states.length === 0) return null;

  return { states: parsed.data.states, transitions: parsed.data.transitions };
}

/**
 * Distinguish a FAILED state-machine proposal from a legitimate prose-only
 * refine turn. A complete machine for a complex EM can exceed the streaming
 * token budget and arrive TRUNCATED: the AI opened a ```json fence but the
 * closing fence (and JSON tail) never streamed, so `parseStateMachineProposal`
 * returns null. The persist path otherwise treats null as "still gathering" and
 * silently drops the whole machine with no error shown.
 *
 * Returns true when the text shows an opened ```json fence yet yields no
 * parseable, schema-valid proposal (truncated OR malformed OR schema-invalid) —
 * the caller should surface that loudly instead of persisting prose silently.
 * Returns false for a turn with no json fence at all (the AI is genuinely still
 * interviewing) and for a complete, parseable proposal.
 *
 * Pure + deterministic; no React, no IO.
 */
export function isLikelyTruncatedProposal(text: string): boolean {
  const hasJsonFence = /```json/.test(text);
  if (!hasJsonFence) return false;
  return parseStateMachineProposal(text) === null;
}
