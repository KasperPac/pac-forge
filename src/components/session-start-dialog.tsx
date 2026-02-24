import { useState, useEffect, useMemo } from "react";
import { ClipboardList, Lock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAgents } from "@/hooks/use-agents";
import { useCreateSession } from "@/hooks/use-sessions";
import { PIPELINE_STEP_CONFIG } from "@/lib/pipeline";
import type { PipelineStepKey } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

interface SessionStartDialogProps {
  projectId: string;
  open: boolean;
  onSessionCreated: (sessionId: string) => void;
  onCancel?: () => void;
}

export function SessionStartDialog({
  projectId,
  open,
  onSessionCreated,
  onCancel,
}: SessionStartDialogProps) {
  const { data: agents, isLoading } = useAgents();
  const createSession = useCreateSession();
  const [error, setError] = useState<string | null>(null);

  // Track which pipeline steps are enabled (all on by default)
  const [enabledSteps, setEnabledSteps] = useState<Set<PipelineStepKey>>(
    () => new Set(PIPELINE_STEP_CONFIG.map((s) => s.key)),
  );

  // Reset steps when dialog opens
  useEffect(() => {
    if (open) {
      setEnabledSteps(new Set(PIPELINE_STEP_CONFIG.map((s) => s.key)));
      setError(null);
    }
  }, [open]);

  // Find the PM agent
  const pmAgent = useMemo(
    () => agents?.find((a) => a.specialties.includes("ORCHESTRATE")),
    [agents],
  );

  function toggleStep(key: PipelineStepKey) {
    const config = PIPELINE_STEP_CONFIG.find((s) => s.key === key);
    if (!config || config.locked) return;

    setEnabledSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleStart() {
    if (!agents) return;
    setError(null);

    // Resolve enabled steps → agent IDs
    const selectedAgentIds: string[] = [];

    // PM is always included
    if (pmAgent) selectedAgentIds.push(pmAgent.id);

    for (const step of PIPELINE_STEP_CONFIG) {
      if (!enabledSteps.has(step.key)) continue;
      const agent = agents.find((a) => a.display_name === step.agentName);
      if (agent && agent.is_enabled && agent.status === "AVAILABLE") {
        selectedAgentIds.push(agent.id);
      }
    }

    if (selectedAgentIds.length === 0) {
      setError("No agents available");
      return;
    }

    try {
      const session = await createSession.mutateAsync({
        projectId,
        agentIds: selectedAgentIds,
      });
      onSessionCreated(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    }
  }

  const enabledCount = enabledSteps.size;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Start Pac-ST Session
          </DialogTitle>
          <DialogDescription>
            The Project Manager orchestrates your session, delegating tasks to specialist agents based on your requests.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center font-mono text-sm text-muted-foreground">
            Loading agents...
          </div>
        )}

        {agents && (
          <div className="space-y-4">
            {/* PM agent header */}
            {pmAgent && (
              <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-accent/50 px-3 py-2.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {pmAgent.display_name}
                    </span>
                    <span className="font-mono text-[9px] text-primary">
                      Always active
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    Plans the pipeline, delegates to specialists, and summarizes results.
                  </p>
                </div>
              </div>
            )}

            {/* Pipeline step toggles */}
            <div className="space-y-1">
              <div className="font-mono text-xs font-medium text-muted-foreground">
                Pipeline Steps
              </div>
              <div className="space-y-1">
                {PIPELINE_STEP_CONFIG.map((step) => {
                  const isEnabled = enabledSteps.has(step.key);
                  const agent = agents.find(
                    (a) => a.display_name === step.agentName,
                  );
                  const isAvailable =
                    agent?.is_enabled && agent.status === "AVAILABLE";

                  return (
                    <div
                      key={step.key}
                      className={cn(
                        "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                        step.locked
                          ? "border-primary/20 bg-accent/30"
                          : isEnabled
                            ? "border-border"
                            : "border-border/50 opacity-60",
                        !isAvailable && !step.locked && "opacity-40",
                      )}
                    >
                      {step.locked ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => toggleStep(step.key)}
                          disabled={!isAvailable}
                          className="shrink-0 scale-75"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {step.label}
                          </span>
                          {step.locked && (
                            <span className="font-mono text-[9px] text-primary">
                              Required
                            </span>
                          )}
                          {!isAvailable && !step.locked && (
                            <span className="font-mono text-[9px] text-destructive">
                              Unavailable
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            onClick={handleStart}
            disabled={createSession.isPending}
          >
            {createSession.isPending
              ? "Starting..."
              : `Start Session (${enabledCount} step${enabledCount !== 1 ? "s" : ""})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
