import { useNavigate } from "react-router";
import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentAvatar } from "@/components/agent-avatar";
import { getAgentProfile } from "@/lib/agent-profiles";
import { useAgents } from "@/hooks/use-agents";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  AVAILABLE: { dot: "bg-green-500", label: "Available" },
  RESERVED: { dot: "bg-amber-500", label: "Reserved" },
  OFFLINE: { dot: "bg-neutral-500", label: "Offline" },
  DISABLED: { dot: "bg-neutral-600", label: "Disabled" },
};

/** Pipeline flow tiers. */
const FLOW_TIERS = [
  {
    label: "1. Plan",
    description: "Receives request and creates an execution plan",
    agents: ["Project Manager"],
    layout: "single" as const,
  },
  {
    label: "2. Generate",
    description: "Translates the plan into SCL source code",
    agents: ["Code Architect"],
    layout: "single" as const,
  },
  {
    label: "3. Review",
    description: "Parallel review — each specialist inspects the generated code",
    agents: ["PLC Standards Enforcer", "IO Validator", "Safety Auditor"],
    layout: "parallel" as const,
  },
  {
    label: "4. Learn",
    description: "Compares original vs corrected code and saves patterns",
    agents: ["Pattern Librarian"],
    layout: "single" as const,
  },
  {
    label: "5. Summarize",
    description: "Synthesizes all results and presents final output to user",
    agents: ["Project Manager"],
    layout: "single" as const,
  },
];

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
        <p className="mt-1 text-sm text-muted-foreground">
          Each Pac-ST session follows this pipeline. Click any agent to view its profile and learnings.
        </p>
      </div>

      <Separator />

      {isLoading && (
        <div className="py-12 text-center text-base text-muted-foreground">
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

      {agents && agents.length > 0 && (
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-0 py-4">
          {FLOW_TIERS.map((tier, tierIdx) => {
            const tierAgents = tier.agents
              .map((name) => agents.find((a) => a.display_name === name))
              .filter(Boolean) as Agent[];

            return (
              <div key={tierIdx} className="flex w-full flex-col items-center">
                {/* Connector line from previous tier */}
                {tierIdx > 0 && (
                  <Connector
                    fromParallel={FLOW_TIERS[tierIdx - 1].layout === "parallel"}
                    toParallel={tier.layout === "parallel"}
                  />
                )}

                {/* Tier header */}
                <div className="mb-3 flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className="border-primary/30 px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider text-primary"
                  >
                    {tier.label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {tier.description}
                  </span>
                </div>

                {/* Agent node(s) */}
                <div
                  className={cn(
                    "flex items-stretch justify-center",
                    tier.layout === "parallel" ? "w-full gap-4" : "gap-0",
                  )}
                >
                  {tierAgents.map((agent) => (
                    <AgentNode
                      key={agent.id}
                      agent={agent}
                      wide={tier.layout === "parallel"}
                      onClick={() => navigate(`/agents/${agent.id}`)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Agent node card ----

function AgentNode({
  agent,
  wide,
  onClick,
}: {
  agent: Agent;
  wide: boolean;
  onClick: () => void;
}) {
  const status = STATUS_STYLES[agent.status] ?? STATUS_STYLES.OFFLINE;
  const profile = getAgentProfile(agent.display_name);

  return (
    <button
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/30",
        wide && "flex-1",
      )}
      onClick={onClick}
    >
      <AgentAvatar displayName={agent.display_name} size="md" status={agent.status} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{agent.display_name}</div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {profile.tagline}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${status.dot}`} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {status.label}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---- Connector between tiers ----

function Connector({
  fromParallel,
  toParallel,
}: {
  fromParallel: boolean;
  toParallel: boolean;
}) {
  // Vertical line with optional fan-out / fan-in markers
  return (
    <div className="flex w-full flex-col items-center py-1">
      {/* Fan-in from parallel */}
      {fromParallel && (
        <div className="relative mb-1 h-3 w-full max-w-lg">
          {/* Horizontal line spanning the parallel nodes */}
          <div className="absolute left-[15%] right-[15%] top-0 border-t border-muted-foreground/25" />
          {/* Left hook */}
          <div className="absolute left-[15%] top-0 h-3 border-l border-muted-foreground/25" />
          {/* Center hook */}
          <div className="absolute left-1/2 top-0 h-3 -translate-x-px border-l border-muted-foreground/25" />
          {/* Right hook */}
          <div className="absolute right-[15%] top-0 h-3 border-l border-muted-foreground/25" />
        </div>
      )}

      {/* Vertical stem */}
      <div className="flex flex-col items-center">
        <div className="h-5 border-l border-muted-foreground/25" />
        <svg className="h-2.5 w-2.5 text-muted-foreground/40" viewBox="0 0 10 6" fill="currentColor">
          <polygon points="5,6 0,0 10,0" />
        </svg>
      </div>

      {/* Fan-out to parallel */}
      {toParallel && (
        <div className="relative mt-1 h-3 w-full max-w-lg">
          {/* Center hook */}
          <div className="absolute left-1/2 bottom-0 h-3 -translate-x-px border-l border-muted-foreground/25" />
          {/* Horizontal line */}
          <div className="absolute left-[15%] right-[15%] bottom-0 border-t border-muted-foreground/25" />
          {/* Left drop */}
          <div className="absolute left-[15%] bottom-0 h-3 border-l border-muted-foreground/25" />
          {/* Right drop */}
          <div className="absolute right-[15%] bottom-0 h-3 border-l border-muted-foreground/25" />
        </div>
      )}
    </div>
  );
}
