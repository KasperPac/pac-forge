/**
 * Pure helpers for the skeleton wizard's machine-layer steps:
 * Machine Modes (seed Production/Maintenance) and Safety Gates
 * (auto-suggested from is_safety register tags).
 */
import type {
  AuthorizationV1,
  OperatorMode,
  SafetyGateV2,
} from "@/types/spec-contract-v2";

/**
 * G0-9 seed: Production (default) + Maintenance. Manual/engineering/custom
 * modes are added per-project by the engineer. Only applies to projects
 * with no stored modes — existing projects keep theirs.
 */
export function seedDefaultModes(): OperatorMode[] {
  return [
    {
      mode_id: "production",
      name: "Production",
      description: "Normal production mode",
      is_default: true,
      kind: "production",
    },
    {
      mode_id: "maintenance",
      name: "Maintenance",
      description: "Service / maintenance mode",
      is_default: false,
      kind: "maintenance",
    },
  ];
}

// G0-10: the boundary-§D default ladder — project-configurable seed.
export function defaultRoleLadder(): AuthorizationV1 {
  return {
    roles: [
      { level: 0, name: "View", description: "Read-only" },
      { level: 1, name: "Operator" },
      { level: 2, name: "Supervisor" },
      { level: 3, name: "Maintenance" },
      { level: 4, name: "Engineer" },
    ],
  };
}

// G0-9-F1: name/id → semantic kind inference for pre-G0-9 mode sets.
// Order matters: first match wins (e.g. "Manual / Jog" is manual).
const KIND_PATTERNS: ReadonlyArray<[RegExp, OperatorMode["kind"]]> = [
  [/production|auto/i, "production"],
  [/maintenance|service/i, "maintenance"],
  [/manual|jog/i, "manual"],
  [/engineering|commissioning/i, "engineering"],
];

/**
 * Backfill semantic kinds onto a pre-G0-9 mode set (G0-9-F1). Applies ONLY
 * when every mode is kind "custom" — the whole set predates kind authoring;
 * any authored kind means the author has been here and we never touch it.
 * Pure; returns the same reference when nothing changes (loader no-op
 * discipline, same as seedDrivesFromNetworkConfig).
 */
export function backfillModeKinds(modes: OperatorMode[]): OperatorMode[] {
  if (modes.some((m) => m.kind !== "custom")) return modes;
  let changed = false;
  const out = modes.map((m) => {
    const haystack = `${m.mode_id} ${m.name}`;
    const match = KIND_PATTERNS.find(([re]) => re.test(haystack));
    if (!match || match[1] === m.kind) return m;
    changed = true;
    return { ...m, kind: match[1] };
  });
  return changed ? out : modes;
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
