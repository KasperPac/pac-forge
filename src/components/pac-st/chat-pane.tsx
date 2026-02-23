import { useState, useRef, useEffect } from "react";
import { Send, Cpu, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AgentStatusBar } from "./agent-status-bar";
import { SafetyBanner } from "./safety-banner";
import { ModeSelector } from "./mode-selector";
import { PromptBuilder } from "./prompt-builder";
import type {
  Project,
  Agent,
  AgentReservation,
  ConversationTurn,
  SafetyWarning,
  InteractionMode,
} from "@/types";

interface ChatPaneProps {
  project: Project | null;
  agents: Agent[];
  reservations?: AgentReservation[];
  messages: ConversationTurn[];
  warnings: SafetyWarning[];
  onSend: (message: string) => void;
  onAcknowledgeWarning: (id: string) => void;
  onReleaseAgent?: (reservationId: string, agentId: string) => void;
  sending?: boolean;
}

export function ChatPane({
  project,
  agents,
  reservations,
  messages,
  warnings,
  onSend,
  onAcknowledgeWarning,
  onReleaseAgent,
  sending,
}: ChatPaneProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<InteractionMode>("FREEFORM");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setInput("");
  }

  function handleGuidedSubmit(prompt: string) {
    if (sending) return;
    onSend(prompt);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  // Resolve agent display names for messages
  const agentMap = new Map(agents.map((a) => [a.id, a.display_name]));

  return (
    <div className="flex h-full flex-col">
      {/* Project summary */}
      {project && (
        <div className="space-y-1 p-3">
          <div className="font-mono text-[10px] text-muted-foreground">PROJECT</div>
          <div className="text-sm font-medium">{project.client_name}</div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[9px]">
              <Cpu className="mr-0.5 h-2.5 w-2.5" />
              {project.cpu_type}
            </Badge>
            <Badge variant="outline" className="font-mono text-[9px]">
              {project.tia_version}
            </Badge>
          </div>
        </div>
      )}

      <Separator />

      {/* Agent status */}
      <div className="p-3">
        <AgentStatusBar
          agents={agents}
          reservations={reservations}
          onReleaseAgent={onReleaseAgent}
        />
      </div>

      {/* Safety warnings */}
      {warnings.length > 0 && (
        <div className="px-3 pb-2">
          <SafetyBanner warnings={warnings} onAcknowledge={onAcknowledgeWarning} />
        </div>
      )}

      <Separator />

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-3 p-3">
          {messages.length === 0 && (
            <div className="py-8 text-center font-mono text-xs text-muted-foreground">
              Start a conversation to generate PLC code.
              <br />
              <span className="text-[10px]">Ctrl+Enter to send</span>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-md px-3 py-2 ${
                msg.role === "USER"
                  ? "ml-4 bg-accent"
                  : "mr-4 border bg-card"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[10px] font-medium text-muted-foreground">
                  {msg.role === "USER"
                    ? "You"
                    : msg.agent_id
                      ? agentMap.get(msg.agent_id) ?? "Agent"
                      : "Agent"}
                </span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {new Date(msg.created_at).toLocaleTimeString()}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-xs">{msg.content}</div>
              {msg.artifacts_generated.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {msg.artifacts_generated.map((name) => (
                    <Badge key={name} variant="secondary" className="font-mono text-[9px]">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {/* Inline safety warnings per message */}
              {msg.safety_warnings.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {msg.safety_warnings.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-start gap-1 rounded bg-destructive/10 px-2 py-1"
                    >
                      <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-destructive" />
                      <span className="font-mono text-[9px] text-destructive">
                        [{w.type}] {w.artifact_name}: {w.description}
                        {w.line ? ` (line ${w.line})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="mr-4 rounded-md border bg-card px-3 py-2">
              <div className="font-mono text-xs text-muted-foreground">
                <span className="inline-block animate-pulse">Generating...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t">
        {/* Mode selector */}
        <div className="flex items-center justify-between px-3 pt-2">
          <ModeSelector mode={mode} onModeChange={setMode} />
        </div>

        {/* Guided mode prompt builder */}
        {(mode === "GUIDED" || mode === "HYBRID") && (
          <>
            <PromptBuilder onSubmit={handleGuidedSubmit} disabled={sending} />
            {mode === "GUIDED" && <div className="h-2" />}
          </>
        )}

        {/* Free-form text input */}
        {(mode === "FREEFORM" || mode === "HYBRID") && (
          <div className="p-3 pt-2">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  mode === "HYBRID"
                    ? "Additional instructions..."
                    : "Describe what to generate..."
                }
                className="min-h-[60px] resize-none font-mono text-xs"
                rows={3}
              />
              <Button
                size="sm"
                className="h-auto self-end"
                onClick={handleSend}
                disabled={!input.trim() || sending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
