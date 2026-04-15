/**
 * Core flag types and defaults — no imports, no circular risk.
 * Both feature-flags.ts and flags-store.ts import from here.
 */

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
