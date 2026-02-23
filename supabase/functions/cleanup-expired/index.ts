// Supabase Edge Function: Clean up expired agent leases
// POST /cleanup-expired (no body required)
// Can be called on a cron schedule (e.g. every 5 minutes) or on-demand

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const now = new Date().toISOString();

    // Find expired reservations that haven't been released
    const { data: expired, error: fetchError } = await supabase
      .from("agent_reservations")
      .select("id, agent_id, session_id")
      .is("released_at", null)
      .lt("lease_expires_at", now);

    if (fetchError) throw fetchError;

    if (!expired || expired.length === 0) {
      return new Response(
        JSON.stringify({ released: 0, sessions_closed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Release expired reservations
    const expiredIds = expired.map((r) => r.id);
    const { error: releaseError } = await supabase
      .from("agent_reservations")
      .update({
        released_at: now,
        release_reason: "LEASE_TIMEOUT",
      })
      .in("id", expiredIds);

    if (releaseError) throw releaseError;

    // Update agent statuses back to AVAILABLE
    const agentIds = [...new Set(expired.map((r) => r.agent_id))];
    // Only set AVAILABLE if no other active reservation exists
    for (const agentId of agentIds) {
      const { data: activeReservations } = await supabase
        .from("agent_reservations")
        .select("id")
        .eq("agent_id", agentId)
        .is("released_at", null)
        .limit(1);

      if (!activeReservations || activeReservations.length === 0) {
        await supabase
          .from("agents")
          .update({ status: "AVAILABLE" })
          .eq("id", agentId);
      }
    }

    // Find sessions where ALL reservations are now released → close them
    const sessionIds = [...new Set(expired.map((r) => r.session_id))];
    let sessionsClosed = 0;

    for (const sessionId of sessionIds) {
      const { data: remaining } = await supabase
        .from("agent_reservations")
        .select("id")
        .eq("session_id", sessionId)
        .is("released_at", null)
        .limit(1);

      if (!remaining || remaining.length === 0) {
        await supabase
          .from("sessions")
          .update({ status: "EXPIRED" })
          .eq("id", sessionId)
          .eq("status", "ACTIVE");
        sessionsClosed++;
      }
    }

    return new Response(
      JSON.stringify({
        released: expired.length,
        agents_freed: agentIds.length,
        sessions_closed: sessionsClosed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
