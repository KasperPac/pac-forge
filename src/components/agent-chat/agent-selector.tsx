import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAgentProfile,
  COLOR_CLASSES,
  type ProfileColor,
} from "@/lib/agent-profiles";
import { useAgentChatStore } from "@/stores/agent-chat-store";
import { usePacStStore } from "@/stores/pac-st-store";
import { useTiaConsoleStore } from "@/stores/tia-console-store";

const CHAT_AGENTS = [
  "Code Architect",
  "PLC Standards Enforcer",
  "IO Validator",
  "Safety Auditor",
  "Pattern Librarian",
  "Project Manager",
] as const;

/**
 * Maps session state to contextual hints per agent, so the user knows
 * which agent is most relevant to their current situation.
 */
function useAgentHints(): Record<string, string | null> {
  const hasArtifacts = usePacStStore((s) => s.generatedArtifacts.length > 0);
  const hasCompileErrors = useTiaConsoleStore(
    (s) =>
      s.localCompileResult != null &&
      !s.localCompileResult.success &&
      s.localCompileResult.errors.length > 0,
  );
  const hasCompileFix = useTiaConsoleStore(
    (s) => (s.compileFixSession?.messages.length ?? 0) > 0,
  );
  const hasPipelineSteps = usePacStStore(
    (s) => (s.pipelineExecution?.steps.length ?? 0) > 0,
  );
  const hasUnresolvedFindings = usePacStStore(
    (s) => s.unresolvedFindings.length > 0,
  );

  const hints: Record<string, string | null> = {};

  for (const name of CHAT_AGENTS) {
    hints[name] = null;
  }

  if (hasCompileErrors) {
    hints["Code Architect"] = "Ask about compile errors";
    hints["PLC Standards Enforcer"] = "Ask why errors weren't caught";
  } else if (hasArtifacts) {
    hints["Code Architect"] = "Ask about generated code";
  }

  if (hasCompileFix) {
    hints["Pattern Librarian"] = "Discuss learned fixes";
  }

  if (hasUnresolvedFindings) {
    hints["PLC Standards Enforcer"] = "Unresolved review findings";
  }

  if (hasPipelineSteps) {
    hints["Project Manager"] = "Ask about pipeline decisions";
  }

  return hints;
}

export function AgentSelector() {
  const { selectAgent, reset } = useAgentChatStore();
  const hints = useAgentHints();

  return (
    <Card className="w-80 shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-medium">
          Chat with an Agent
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground"
          onClick={reset}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 px-3 pb-3">
        {CHAT_AGENTS.map((name) => {
          const profile = getAgentProfile(name);
          const colors = COLOR_CLASSES[profile.color as ProfileColor];
          const Icon = profile.icon;
          const hint = hints[name];

          return (
            <button
              key={name}
              onClick={() => selectAgent(name)}
              className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
            >
              <div className={`mt-0.5 rounded p-1 ${colors.bg}`}>
                <Icon className={`h-3.5 w-3.5 ${colors.text}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{name}</div>
                {hint ? (
                  <Badge
                    variant="secondary"
                    className="mt-0.5 max-w-full truncate px-1 py-0 text-[9px] font-normal"
                  >
                    {hint}
                  </Badge>
                ) : (
                  <div className="truncate text-[10px] text-muted-foreground">
                    {profile.tagline}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
