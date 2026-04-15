/**
 * Zustand store backing the feature-flag system.
 *
 * The store is hydrated from `import.meta.env` on app boot. A future
 * `feature_flags` Supabase table can be layered on top by extending
 * `hydrateFromEnv()` (gated by `USE_DB_OVERRIDES` in feature-flags.ts).
 */
import { create } from "zustand";
import type { FlagKey, FlagSet } from "@/lib/flag-defaults";
import { FLAG_DEFAULTS, readFlagsFromEnv } from "@/lib/flag-defaults";

interface FlagsState {
  flags: FlagSet;
  setFlag: (key: FlagKey, value: boolean) => void;
  hydrateFromEnv: () => void;
}

export const useFlagsStore = create<FlagsState>((set) => ({
  flags: { ...FLAG_DEFAULTS, ...readFlagsFromEnv() },
  setFlag: (key, value) =>
    set((s) => ({ flags: { ...s.flags, [key]: value } })),
  hydrateFromEnv: () => set({ flags: readFlagsFromEnv() }),
}));
