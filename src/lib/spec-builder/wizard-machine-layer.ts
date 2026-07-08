/**
 * Pure helpers for the skeleton wizard's machine-layer steps:
 * Machine Modes (seed Auto/Maintenance/Manual) and Safety Gates
 * (auto-suggested from is_safety register tags).
 */
import type { OperatorMode, SafetyGateV2 } from "@/types/spec-contract-v2";

export function seedDefaultModes(): OperatorMode[] {
  return [
    { mode_id: "auto", name: "Auto", description: "Automatic production mode", is_default: true, kind: "production" },
    { mode_id: "maintenance", name: "Maintenance", description: "Service / maintenance mode", is_default: false, kind: "maintenance" },
    { mode_id: "manual", name: "Manual", description: "Manual / jog mode", is_default: false, kind: "manual" },
  ];
}

export interface SafetyTagLike {
  tag: string;
  is_safety: boolean;
}

/**
 * One machine-wide gate per distinct safety tag. The gate is violated when
 * the tag's "healthy" signal reads false (OR-of-faults). The engineer edits
 * scope/condition afterwards.
 */
export function suggestSafetyGates(tags: SafetyTagLike[]): SafetyGateV2[] {
  const seen = new Set<string>();
  const out: SafetyGateV2[] = [];
  for (const t of tags) {
    if (!t.is_safety || seen.has(t.tag)) continue;
    seen.add(t.tag);
    out.push({
      gate_id: `gate_${t.tag.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: t.tag,
      condition: [{ tag: t.tag, operator: "=", value: false }],
      scope: "all",
    });
  }
  return out;
}
