import { useState, useEffect } from "react";
import type { AgentReservation } from "@/types";

const CHECK_INTERVAL = 30_000; // 30 seconds
const EXPIRY_WARNING_MS = 5 * 60_000; // 5 minutes

export function useLeaseCheck(reservations: AgentReservation[] | undefined) {
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!reservations || reservations.length === 0) {
      setExpiringSoon(false);
      setExpired(false);
      return;
    }

    function check() {
      const now = Date.now();
      let anySoon = false;
      let anyExpired = false;

      for (const r of reservations!) {
        if (r.released_at) continue;
        const expiresAt = new Date(r.lease_expires_at).getTime();
        if (expiresAt <= now) {
          anyExpired = true;
        } else if (expiresAt - now <= EXPIRY_WARNING_MS) {
          anySoon = true;
        }
      }

      setExpiringSoon(anySoon);
      setExpired(anyExpired);
    }

    check();
    const id = setInterval(check, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [reservations]);

  return { expiringSoon, expired };
}
