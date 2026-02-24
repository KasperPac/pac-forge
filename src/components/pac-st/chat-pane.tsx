import { useState, useRef, useEffect } from "react";
import { Send, Cpu, AlertTriangle, Trash2, LogOut, ChevronDown, ChevronRight, Code2 } from "lucide-react";
import { usePacStStore } from "@/stores/pac-st-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AgentStatusBar } from "./agent-status-bar";
import { SafetyBanner } from "./safety-banner";
import { ModeSelector } from "./mode-selector";
import { PromptBuilder } from "./prompt-builder";
import { PipelineActivity } from "./pipeline-activity";
import { SUGGESTED_PROMPTS } from "@/lib/suggested-prompts";
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
  onClearChat?: () => void;
  onEndSession?: () => void;
  profileName?: string;
  expiringSoon?: boolean;
  sending?: boolean;
  clearing?: boolean;
  endingSession?: boolean;
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
  onClearChat,
  onEndSession,
  profileName,
  expiringSoon,
  sending,
  clearing,
  endingSession,
}: ChatPaneProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<InteractionMode>("FREEFORM");
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveOutputRef = useRef<HTMLPreElement>(null);
  const streamingContent = usePacStStore((s) => s.streamingContent);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  // Auto-scroll live output
  useEffect(() => {
    if (liveOutputRef.current) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
    }
  }, [streamingContent]);

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
      {/* Compact session header */}
      {project && (
        <div className="space-y-2 border-b px-3 py-2.5">
          {/* Project info + actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{project.client_name}</span>
              {project.project_number && (
                <span className="font-mono text-xs text-muted-foreground">
                  {project.project_number}
                </span>
              )}
              <Badge variant="outline" className="font-mono text-xs">
                <Cpu className="mr-0.5 h-2.5 w-2.5" />
                {project.cpu_type}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                {project.tia_version}
              </Badge>
              {profileName && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {profileName}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {onClearChat && messages.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      disabled={clearing}
                      title="Clear workspace"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear workspace?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all messages, generated code,
                        and approved code in the current session.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={onClearChat}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Clear All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {onEndSession && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={onEndSession}
                  disabled={endingSession}
                  title="End session"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Agents */}
          <AgentStatusBar
            agents={agents}
            reservations={reservations}
            onReleaseAgent={onReleaseAgent}
          />
        </div>
      )}

      {/* Safety warnings */}
      {warnings.length > 0 && (
        <div className="border-b px-3 py-2">
          <SafetyBanner warnings={warnings} onAcknowledge={onAcknowledgeWarning} />
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-3 p-3">
          {messages.length === 0 && (
            <div className="space-y-3 py-4">
              <div className="text-center font-mono text-xs text-muted-foreground">
                Quick Start — click a template or type your own prompt
              </div>
              <div className="grid grid-cols-2 gap-2 px-1">
                {SUGGESTED_PROMPTS.map((sp) => (
                  <button
                    key={sp.label}
                    className="rounded-md bg-accent/30 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                    onClick={() => onSend(sp.prompt)}
                  >
                    <div className="font-mono text-xs font-medium">{sp.label}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {sp.category}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {sp.prompt.slice(0, 100)}...
                    </div>
                  </button>
                ))}
              </div>
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
                <span className="font-mono text-xs font-medium text-muted-foreground">
                  {msg.role === "USER"
                    ? "You"
                    : msg.agent_id
                      ? agentMap.get(msg.agent_id) ?? "Agent"
                      : "Agent"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(msg.created_at).toLocaleTimeString()}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              {msg.artifacts_generated.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {msg.artifacts_generated.map((name) => (
                    <Badge key={name} variant="secondary" className="font-mono text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {msg.safety_warnings.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {msg.safety_warnings.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-start gap-1 rounded bg-destructive/10 px-2 py-1"
                    >
                      <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-destructive" />
                      <span className="font-mono text-xs text-destructive">
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
            <div className="mr-4 space-y-1">
              <div className="rounded-md border bg-card">
                <PipelineActivity />
              </div>
              {streamingContent && (
                <div className="rounded-md border bg-card">
                  <button
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
                    onClick={() => setShowLiveOutput((v) => !v)}
                  >
                    {showLiveOutput ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                    <Code2 className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Live Output ({streamingContent.split("\n").length} lines)
                    </span>
                  </button>
                  {showLiveOutput && (
                    <pre
                      ref={liveOutputRef}
                      className="max-h-40 overflow-auto border-t bg-black/30 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                    >
                      {streamingContent.split("\n").slice(-20).join("\n")}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
          {!sending && (
            <div className="mr-4 rounded-md border bg-card">
              <PipelineActivity defaultCollapsed />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Lease expiry warning */}
      {expiringSoon && (
        <div className="border-t bg-amber-500/10 px-3 py-1.5">
          <span className="font-mono text-xs text-amber-500">
            Agent lease expiring soon — save your work
          </span>
        </div>
      )}

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
                className="min-h-[60px] resize-none font-mono text-sm"
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
