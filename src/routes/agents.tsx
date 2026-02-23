import { useNavigate } from "react-router";
import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentAvatar } from "@/components/agent-avatar";
import { getAgentProfile } from "@/lib/agent-profiles";
import { useAgents } from "@/hooks/use-agents";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  AVAILABLE: { dot: "bg-green-500", label: "Available" },
  RESERVED: { dot: "bg-amber-500", label: "Reserved" },
  OFFLINE: { dot: "bg-neutral-500", label: "Offline" },
  DISABLED: { dot: "bg-neutral-600", label: "Disabled" },
};

export default function AgentsPage() {
  const { data: agents, isLoading } = useAgents();
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm text-muted-foreground">SYSTEM</div>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Bot className="h-6 w-6" />
          Agent Pool
        </h1>
      </div>

      <Separator />

      {isLoading && (
        <div className="py-8 text-center text-base text-muted-foreground">
          Loading agents...
        </div>
      )}

      {agents && agents.length === 0 && (
        <Card className="p-6">
          <p className="text-base text-muted-foreground">
            No agents configured. Run the database migration to seed default agents.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents?.map((agent) => {
          const status = STATUS_STYLES[agent.status] ?? STATUS_STYLES.OFFLINE;
          const profile = getAgentProfile(agent.display_name);

          return (
            <Card
              key={agent.id}
              className="cursor-pointer p-5 transition-colors hover:border-accent"
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <div className="flex items-start gap-4">
                <AgentAvatar
                  displayName={agent.display_name}
                  size="md"
                  status={agent.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium">{agent.display_name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${status.dot}`} />
                    <span className="text-sm text-muted-foreground">
                      {status.label}
                    </span>
                    {!agent.is_enabled && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Disabled
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">
                {profile.tagline}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {agent.specialties.map((s) => (
                  <Badge key={s} variant="secondary" className="px-2 py-0.5 text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
