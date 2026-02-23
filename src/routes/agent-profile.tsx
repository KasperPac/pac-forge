import { useParams, useNavigate } from "react-router";
import { ArrowLeft, CalendarDays, Cpu, Power, Zap, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentAvatar } from "@/components/agent-avatar";
import {
  getAgentProfile,
  COLOR_CLASSES,
  type ProfileColor,
} from "@/lib/agent-profiles";
import { useAgents } from "@/hooks/use-agents";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  AVAILABLE: { dot: "bg-green-500", label: "Available" },
  RESERVED: { dot: "bg-amber-500", label: "Reserved" },
  OFFLINE: { dot: "bg-neutral-500", label: "Offline" },
  DISABLED: { dot: "bg-neutral-600", label: "Disabled" },
};

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agents, isLoading, error } = useAgents();

  const agent = agents?.find((a) => a.id === id);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">
        Loading agent...
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ? `Failed to load agent: ${error.message}` : "Agent not found"}
        </div>
        <Button variant="ghost" onClick={() => navigate("/agents")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Agents
        </Button>
      </div>
    );
  }

  const profile = getAgentProfile(agent.display_name);
  const status = STATUS_STYLES[agent.status] ?? STATUS_STYLES.OFFLINE;
  const colors =
    COLOR_CLASSES[profile.color as ProfileColor] ?? COLOR_CLASSES.neutral;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button
        variant="ghost"
        className="-ml-2"
        onClick={() => navigate("/agents")}
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Agents
      </Button>

      {/* Hero section */}
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-8">
        <AgentAvatar
          displayName={agent.display_name}
          size="xl"
          status={agent.status}
        />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1 className="text-3xl font-semibold tracking-tight">
            {agent.display_name}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {profile.tagline}
          </p>

          {/* Catchphrase */}
          <div className="mt-4 flex items-start gap-2">
            <Quote className={`mt-0.5 h-5 w-5 shrink-0 ${colors.text} opacity-60`} />
            <p className={`text-lg italic ${colors.text}`}>
              &ldquo;{profile.catchphrase}&rdquo;
            </p>
          </div>

          {/* Status + specialties */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <div className="flex items-center gap-1.5">
              <div className={`h-2.5 w-2.5 rounded-full ${status.dot}`} />
              <span className="text-sm text-muted-foreground">
                {status.label}
              </span>
            </div>
            {agent.specialties.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="px-2 py-0.5 text-xs"
              >
                {s}
              </Badge>
            ))}
            {!agent.is_enabled && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                Disabled
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Content grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Personality */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Personality
          </h2>
          <p className="mt-3 text-base leading-relaxed">{profile.personality}</p>
        </Card>

        {/* About */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            About
          </h2>
          <p className="mt-3 text-base leading-relaxed">{profile.description}</p>
        </Card>

        {/* Skills */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Skills
          </h2>
          <ul className="mt-3 space-y-2">
            {profile.skills.map((skill) => (
              <li key={skill} className="flex items-start gap-2.5">
                <Zap className={`mt-0.5 h-4 w-4 shrink-0 ${colors.text} opacity-70`} />
                <span className="text-base">{skill}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* When to Use */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            When to Use
          </h2>
          <ul className="mt-3 space-y-2">
            {profile.whenToUse.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span
                  className={`mt-2 h-2 w-2 shrink-0 rounded-full ${colors.text} opacity-50`}
                  style={{ backgroundColor: "currentColor" }}
                />
                <span className="text-base">{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Why Useful */}
        <Card className="col-span-full p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Why Useful
          </h2>
          <p className="mt-3 text-base leading-relaxed">{profile.whyUseful}</p>
        </Card>
      </div>

      {/* Configuration */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Configuration
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">
                Max Concurrency
              </div>
              <div className="text-base font-medium">{agent.max_concurrency}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Power className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">
                Enabled
              </div>
              <div className="text-base font-medium">
                {agent.is_enabled ? "Yes" : "No"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`h-3.5 w-3.5 rounded-full ${status.dot}`} />
            <div>
              <div className="text-xs text-muted-foreground">
                Status
              </div>
              <div className="text-base font-medium">{status.label}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">
                Created
              </div>
              <div className="text-base font-medium">
                {new Date(agent.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* System Prompt */}
      {agent.system_prompt && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            System Prompt
          </h2>
          <div className="mt-3 max-h-72 overflow-y-auto rounded-md bg-muted/50 p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
              {agent.system_prompt}
            </pre>
          </div>
        </Card>
      )}
    </div>
  );
}
