import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgents } from "@/hooks/use-agents";
import { useCreateSession } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";

interface SessionStartDialogProps {
  projectId: string;
  open: boolean;
  onSessionCreated: (sessionId: string) => void;
  onCancel?: () => void;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  AVAILABLE: { label: "Available", className: "bg-green-500" },
  RESERVED: { label: "In use", className: "bg-amber-500" },
  OFFLINE: { label: "Offline", className: "bg-neutral-500" },
  DISABLED: { label: "Disabled", className: "bg-neutral-600" },
};

export function SessionStartDialog({
  projectId,
  open,
  onSessionCreated,
  onCancel,
}: SessionStartDialogProps) {
  const { data: agents, isLoading } = useAgents();
  const createSession = useCreateSession();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggleAgent(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleStart() {
    if (selectedIds.size === 0) return;
    setError(null);
    try {
      const session = await createSession.mutateAsync({
        projectId,
        agentIds: Array.from(selectedIds),
      });
      onSessionCreated(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Start Pac-ST Session
          </DialogTitle>
          <DialogDescription>
            Select agents for this session. Reserved agents are locked exclusively.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center font-mono text-sm text-muted-foreground">
            Loading agents...
          </div>
        )}

        {agents && (
          <ScrollArea className="max-h-64">
            <div className="space-y-1.5 pr-3">
              {agents.map((agent) => {
                const isAvailable = agent.is_enabled && agent.status === "AVAILABLE";
                const isSelected = selectedIds.has(agent.id);
                const statusInfo = STATUS_LABELS[agent.status] ?? STATUS_LABELS.OFFLINE;

                return (
                  <button
                    key={agent.id}
                    onClick={() => isAvailable && toggleAgent(agent.id)}
                    disabled={!isAvailable}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                      isAvailable
                        ? isSelected
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-accent/50"
                        : "cursor-not-allowed border-border/50 opacity-50"
                    )}
                  >
                    {/* Checkbox indicator */}
                    <div
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground"
                      )}
                    >
                      {isSelected && (
                        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{agent.display_name}</span>
                        <div className="flex items-center gap-1">
                          <div className={cn("h-1.5 w-1.5 rounded-full", statusInfo.className)} />
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {statusInfo.label}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {agent.specialties.map((s) => (
                          <Badge key={s} variant="outline" className="px-1 py-0 text-[9px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
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
            disabled={selectedIds.size === 0 || createSession.isPending}
          >
            {createSession.isPending
              ? "Starting..."
              : `Start Session (${selectedIds.size} agent${selectedIds.size !== 1 ? "s" : ""})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
