// Supabase Edge Function: Renew agent leases for a session
// POST /renew-lease { session_id: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEASE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const newExpiry = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

    const { data, error } = await supabase
      .from("agent_reservations")
      .update({ lease_expires_at: newExpiry })
      .eq("session_id", session_id)
      .is("released_at", null)
      .select();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ renewed: data.length, lease_expires_at: newExpiry }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
