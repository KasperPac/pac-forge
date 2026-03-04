import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Increase lock timeout to prevent "timed out waiting 10000ms" errors
    // when multiple operations compete for the auth token lock (e.g. after
    // external OAuth redirects or concurrent edge function calls).
    // The type isn't exposed by supabase-js wrapper but auth-js supports it.
    lockAcquireTimeout: 30000,
  } as Record<string, unknown>,
});
