import { useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AgentReservation, ReleaseReason } from "@/types";

const RESERVATIONS_KEY = ["agent-reservations"] as const;
const LEASE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const RENEW_INTERVAL_MS = 10 * 60 * 1000; // Renew every 10 minutes

export function useSessionReservations(sessionId: string | null) {
  return useQuery({
    queryKey: [...RESERVATIONS_KEY, sessionId],
    queryFn: async (): Promise<AgentReservation[]> => {
      const { data, error } = await supabase
        .from("agent_reservations")
        .select("*")
        .eq("session_id", sessionId!)
        .is("released_at", null);
      if (error) throw error;
      return data as AgentReservation[];
    },
    enabled: !!sessionId,
    refetchInterval: 60_000, // Poll every minute for lease status
  });
}

export function useReleaseAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      reservationId,
      agentId,
      reason,
    }: {
      reservationId: string;
      agentId: string;
      reason: ReleaseReason;
    }) => {
      const { error: releaseError } = await supabase
        .from("agent_reservations")
        .update({
          released_at: new Date().toISOString(),
          release_reason: reason,
        })
        .eq("id", reservationId);
      if (releaseError) throw releaseError;

      // Check if any other active reservation holds this agent
      const { data: otherReservations } = await supabase
        .from("agent_reservations")
        .select("id")
        .eq("agent_id", agentId)
        .is("released_at", null)
        .limit(1);

      if (!otherReservations || otherReservations.length === 0) {
        await supabase
          .from("agents")
          .update({ status: "AVAILABLE" })
          .eq("id", agentId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESERVATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useRenewLeases() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const newExpiry = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

      const { data, error } = await supabase
        .from("agent_reservations")
        .update({ lease_expires_at: newExpiry })
        .eq("session_id", sessionId)
        .is("released_at", null)
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESERVATIONS_KEY });
    },
  });
}

/**
 * Auto-renews leases at a fixed interval while the session is active.
 * Also exposes a `renewNow` callback to trigger immediate renewal on user activity.
 */
export function useAutoRenewLeases(sessionId: string | null) {
  const renewLeases = useRenewLeases();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const renewNow = useCallback(() => {
    if (sessionId && !renewLeases.isPending) {
      renewLeases.mutate(sessionId);
    }
  }, [sessionId, renewLeases]);

  useEffect(() => {
    if (!sessionId) return;

    // Renew immediately on mount
    renewLeases.mutate(sessionId);

    // Set up periodic renewal
    intervalRef.current = setInterval(() => {
      renewLeases.mutate(sessionId);
    }, RENEW_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // Only re-run when sessionId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return { renewNow };
}
