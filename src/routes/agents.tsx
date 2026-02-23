import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAgents } from "@/hooks/use-agents";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  AVAILABLE: { dot: "bg-green-500", label: "Available" },
  RESERVED: { dot: "bg-amber-500", label: "Reserved" },
  OFFLINE: { dot: "bg-neutral-500", label: "Offline" },
  DISABLED: { dot: "bg-neutral-600", label: "Disabled" },
};

export default function AgentsPage() {
  const { data: agents, isLoading } = useAgents();

  return (
    <div className="space-y-4">
      <div>
        <div className="font-mono text-xs text-muted-foreground">SYSTEM</div>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Bot className="h-5 w-5" />
          Agent Pool
        </h1>
      </div>

      <Separator />

      {isLoading && (
        <div className="py-8 text-center font-mono text-sm text-muted-foreground">
          Loading agents...
        </div>
      )}

      {agents && agents.length === 0 && (
        <Card className="p-6">
          <p className="font-mono text-sm text-muted-foreground">
            No agents configured. Run the database migration to seed default agents.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents?.map((agent) => {
          const status = STATUS_STYLES[agent.status] ?? STATUS_STYLES.OFFLINE;

          return (
            <Card key={agent.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${status.dot}`} />
                    <span className="text-sm font-medium">{agent.display_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {status.label}
                    </span>
                    {!agent.is_enabled && (
                      <Badge variant="outline" className="font-mono text-[8px] text-muted-foreground">
                        Disabled
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[9px]">
                  max {agent.max_concurrency}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {agent.specialties.map((s) => (
                  <Badge key={s} variant="secondary" className="px-1.5 py-0 font-mono text-[9px]">
                    {s}
                  </Badge>
                ))}
              </div>

              {agent.system_prompt && (
                <p className="mt-2 line-clamp-2 font-mono text-[10px] text-muted-foreground">
                  {agent.system_prompt}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
