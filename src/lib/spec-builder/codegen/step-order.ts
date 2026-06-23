import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

/**
 * Order an EM's states for the S/A sequencer: start at the safe/home state
 * (fallback: first declared), walk transitions breadth-first, then append any
 * states the walk never reached so the sequence covers every state. A visited
 * set makes cycles terminate.
 */
export function orderStates(
  states: EmStateV2[],
  transitions: EmTransitionV2[],
): EmStateV2[] {
  if (!states.length) return [];
  const byId = new Map(states.map((s) => [s.state_id, s]));
  const home = states.find((s) => s.is_safe_state) ?? states[0];

  const out: EmStateV2[] = [];
  const visited = new Set<string>();
  const queue: string[] = [home.state_id];
  while (queue.length) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    const state = byId.get(id);
    if (!state) continue;
    visited.add(id);
    out.push(state);
    for (const t of transitions) {
      if (t.from_state_id === id && !visited.has(t.to_state_id)) queue.push(t.to_state_id);
    }
  }
  for (const s of states) if (!visited.has(s.state_id)) out.push(s);
  return out;
}
