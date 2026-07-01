// src/lib/spec-builder/packml-states.ts
// Canonical PackML state model — the fixed vocabulary every Equipment Module FB
// implements. This is the PackML "Base State Model" (ISA-TR88.00.02), which
// ISA-88 Part 1 Annex D.1 defines as a sanctioned COLLAPSE of its full Reference
// Procedural State Model. PackML renames Annex D's RUNNING -> EXECUTE and omits
// PAUSING/PAUSED. IDs are the OMAC/PLCopen packml_id (1..17). Recovered from the
// project's deleted migrate/packml-canonical.ts (git a9942fb). Generic across all
// machine types — never device-specific. Pure: no React/IO.
import type { FbInterfaceState } from "@/types/fb-interface";

export type PackmlStatePattern = "static" | "sequential";

export interface PackmlState {
  /** OMAC/PLCopen state number, 1..17. */
  packml_id: number;
  /** Lowercase canonical id — matches EmStateV2.state_id and FbInterfaceState.slug. */
  slug: string;
  /** Canonical display name. */
  name: string;
  /** static = waiting state; sequential = acting state. */
  state_pattern: PackmlStatePattern;
  /** The single safe / fault-landing state (Aborted). Exactly one is true. */
  is_safe: boolean;
}

export const PACKML_STATES: readonly PackmlState[] = [
  { packml_id: 1,  slug: "clearing",     name: "Clearing",     state_pattern: "sequential", is_safe: false },
  { packml_id: 2,  slug: "stopped",      name: "Stopped",      state_pattern: "static",     is_safe: false },
  { packml_id: 3,  slug: "starting",     name: "Starting",     state_pattern: "sequential", is_safe: false },
  { packml_id: 4,  slug: "idle",         name: "Idle",         state_pattern: "static",     is_safe: false },
  { packml_id: 5,  slug: "suspended",    name: "Suspended",    state_pattern: "static",     is_safe: false },
  { packml_id: 6,  slug: "execute",      name: "Execute",      state_pattern: "sequential", is_safe: false },
  { packml_id: 7,  slug: "stopping",     name: "Stopping",     state_pattern: "sequential", is_safe: false },
  { packml_id: 8,  slug: "aborting",     name: "Aborting",     state_pattern: "sequential", is_safe: false },
  { packml_id: 9,  slug: "aborted",      name: "Aborted",      state_pattern: "static",     is_safe: true  },
  { packml_id: 10, slug: "holding",      name: "Holding",      state_pattern: "sequential", is_safe: false },
  { packml_id: 11, slug: "held",         name: "Held",         state_pattern: "static",     is_safe: false },
  { packml_id: 12, slug: "unholding",    name: "Unholding",    state_pattern: "sequential", is_safe: false },
  { packml_id: 13, slug: "suspending",   name: "Suspending",   state_pattern: "sequential", is_safe: false },
  { packml_id: 14, slug: "unsuspending", name: "Unsuspending", state_pattern: "sequential", is_safe: false },
  { packml_id: 15, slug: "resetting",    name: "Resetting",    state_pattern: "sequential", is_safe: false },
  { packml_id: 16, slug: "completing",   name: "Completing",   state_pattern: "sequential", is_safe: false },
  { packml_id: 17, slug: "complete",     name: "Complete",     state_pattern: "static",     is_safe: false },
] as const;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export const PACKML_STATE_SLUGS: ReadonlySet<string> = new Set(PACKML_STATES.map((s) => s.slug));

const BY_SLUG = new Map<string, PackmlState>(PACKML_STATES.map((s) => [s.slug, s]));
const BY_ID = new Map<number, PackmlState>(PACKML_STATES.map((s) => [s.packml_id, s]));

export function packmlStateBySlug(slug: string): PackmlState | undefined {
  return BY_SLUG.get(norm(slug));
}

export function packmlStateById(id: number): PackmlState | undefined {
  return BY_ID.get(id);
}

export function isPackmlSlug(slug: string): boolean {
  return PACKML_STATE_SLUGS.has(norm(slug));
}

/** The full canonical set an EM FB declares by default, as FbInterfaceState. */
export function defaultFbStates(): FbInterfaceState[] {
  return PACKML_STATES.map((s) => ({ slug: s.slug, name: s.name, is_safe: s.is_safe }));
}
