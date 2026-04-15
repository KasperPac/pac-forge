/**
 * Lightweight feature flag system.
 *
 * Flags are read from `import.meta.env.VITE_FLAG_<NAME>` with typed defaults.
 * A runtime override path (from a `feature_flags` Supabase table) is plumbed
 * behind `USE_DB_OVERRIDES` but disabled by default — the table is not yet
 * created. Enable in a later wave if/when the table lands.
 */
import { useFlagsStore } from "@/stores/flags-store";

export type FlagKey =
  | "revision_system_enabled"
  | "strict_contract_reads"
  | "ingest_ai_path"
  | "legacy_shim_enabled"
  | "forge_require_revision_binding";

export type FlagSet = Record<FlagKey, boolean>;

export const FLAG_DEFAULTS: FlagSet = {
  revision_system_enabled: false,
  strict_contract_reads: false,
  ingest_ai_path: false,
  legacy_shim_enabled: true,
  forge_require_revision_binding: false,
};

/**
 * DB override path toggle. When false, flags come from env + overrides only.
 * When true (future), the flag store hydrator will also pull from
 * `feature_flags` in Supabase. Kept behind a constant so the table can be
 * added without touching call sites.
 */
export const USE_DB_OVERRIDES = false;

const ENV_PREFIX = "VITE_FLAG_";

function parseEnvBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

/** Resolve the flag set from `import.meta.env`, falling back to defaults. */
export function readFlagsFromEnv(): FlagSet {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
  const out: FlagSet = { ...FLAG_DEFAULTS };
  (Object.keys(FLAG_DEFAULTS) as FlagKey[]).forEach((key) => {
    const envKey = `${ENV_PREFIX}${key.toUpperCase()}`;
    out[key] = parseEnvBool(env[envKey], FLAG_DEFAULTS[key]);
  });
  return out;
}

/**
 * Snapshot the current flags (non-reactive). Prefer `useFlags()` in components.
 */
export function getFlags(): FlagSet {
  return useFlagsStore.getState().flags;
}

/** React hook — returns the live flag object. */
export function useFlags(): FlagSet {
  return useFlagsStore((s) => s.flags);
}

/** The exported constant — resolved once at module load for non-reactive reads. */
export const FLAGS: FlagSet = readFlagsFromEnv();
