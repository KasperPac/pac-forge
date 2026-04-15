/**
 * Lightweight feature flag system.
 *
 * Flags are read from `import.meta.env.VITE_FLAG_<NAME>` with typed defaults.
 * A runtime override path (from a `feature_flags` Supabase table) is plumbed
 * behind `USE_DB_OVERRIDES` but disabled by default — the table is not yet
 * created. Enable in a later wave if/when the table lands.
 */
import { useFlagsStore } from "@/stores/flags-store";

// Re-export everything from the dependency-free defaults module so callers
// only need one import path.
export type { FlagKey, FlagSet } from "@/lib/flag-defaults";
export { FLAG_DEFAULTS, readFlagsFromEnv } from "@/lib/flag-defaults";

/**
 * DB override path toggle. When false, flags come from env + overrides only.
 * When true (future), the flag store hydrator will also pull from
 * `feature_flags` in Supabase. Kept behind a constant so the table can be
 * added without touching call sites.
 */
export const USE_DB_OVERRIDES = false;

/**
 * Snapshot the current flags (non-reactive). Prefer `useFlags()` in components.
 */
export function getFlags() {
  return useFlagsStore.getState().flags;
}

/** React hook — returns the live flag object. */
export function useFlags() {
  return useFlagsStore((s) => s.flags);
}

/** The exported constant — resolved once at module load for non-reactive reads. */
import { readFlagsFromEnv as _readFlagsFromEnv } from "@/lib/flag-defaults";
export const FLAGS = _readFlagsFromEnv();
