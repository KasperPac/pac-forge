import { useQuery } from "@tanstack/react-query";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type SupabaseHealth = "healthy" | "degraded" | "offline";

export function useSupabaseStatus() {
  return useQuery<SupabaseHealth>({
    queryKey: ["supabase-health"],
    queryFn: async (): Promise<SupabaseHealth> => {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: SUPABASE_ANON_KEY },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const body = await res.json() as { status?: string };
          return body?.status === "healthy" ? "healthy" : "degraded";
        }
        return "degraded";
      } catch {
        return "offline";
      }
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    staleTime: 25_000,
    retry: false,
  });
}
