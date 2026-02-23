import { useState, useEffect } from "react";
import { Bot, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Agent, AgentReservation } from "@/types";

interface AgentStatusBarProps {
  agents: Agent[];
  reservations?: AgentReservation[];
  onReleaseAgent?: (reservationId: string, agentId: string) => void;
}

function LeaseCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("expired");
        return;
      }
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isLow = remaining !== "expired" && parseInt(remaining) < 5;

  return (
    <span className={`font-mono text-xs ${isLow ? "text-amber-400" : "text-muted-foreground"}`}>
      {remaining}
    </span>
  );
}

export function AgentStatusBar({ agents, reservations, onReleaseAgent }: AgentStatusBarProps) {
  if (agents.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 font-mono text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        No agents selected
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {agents.map((agent) => {
          const reservation = reservations?.find((r) => r.agent_id === agent.id);

          return (
            <div
              key={agent.id}
              className="flex items-center gap-1 rounded-md border px-2 py-1"
            >
              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              <span className="font-mono text-xs">{agent.display_name}</span>
              {agent.specialties.slice(0, 2).map((s) => (
                <Badge key={s} variant="outline" className="px-1 py-0 text-xs">
                  {s}
                </Badge>
              ))}
              {reservation && (
                <LeaseCountdown expiresAt={reservation.lease_expires_at} />
              )}
              {reservation && onReleaseAgent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0"
                  onClick={() => onReleaseAgent(reservation.id, agent.id)}
                  title="Release agent"
                >
                  <X className="h-2.5 w-2.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { LeaseCountdown };
