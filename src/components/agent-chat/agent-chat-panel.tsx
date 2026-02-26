import { useState, useRef, useEffect } from "react";
import {
  X,
  Send,
  Loader2,
  Code2,
  Lightbulb,
  Check,
  BookOpen,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getAgentProfile,
  COLOR_CLASSES,
  type ProfileColor,
} from "@/lib/agent-profiles";
import { useAgentChatStore } from "@/stores/agent-chat-store";
import { usePacStStore } from "@/stores/pac-st-store";
import { useTiaConsoleStore } from "@/stores/tia-console-store";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { ChatMessage } from "@/types";

export function AgentChatPanel() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [savedMessages, setSavedMessages] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const {
    selectedAgent,
    messages,
    streamingContent,
    isStreaming,
    showSavePrompt,
    learningProposal,
    isClassifying,
    requestClose,
    setShowSavePrompt,
    confirmDiscard,
    setLearningProposal,
  } = useAgentChatStore();
  const {
    sendMessage,
    cancelStream,
    saveChat,
    classifyCorrection,
    confirmLearning,
  } = useAgentChat();

  const profile = selectedAgent ? getAgentProfile(selectedAgent) : null;
  const colors = profile
    ? COLOR_CLASSES[profile.color as ProfileColor]
    : null;
  const hasPacStContext = usePacStStore(
    (s) =>
      s.generatedArtifacts.length > 0 ||
      (s.pipelineExecution?.steps.length ?? 0) > 0,
  );
  const hasTiaContext = useTiaConsoleStore(
    (s) =>
      s.localCompileResult != null ||
      (s.compileFixSession?.messages.length ?? 0) > 0 ||
      s.pipelineSteps.length > 0,
  );
  const hasSessionContext = hasPacStContext || hasTiaContext;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent, learningProposal]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSave() {
    try {
      await saveChat();
    } catch {
      // Save failed — still close
    }
    confirmDiscard();
  }

  async function handleLightbulb(msgIndex: number) {
    setError(null);
    try {
      await classifyCorrection(msgIndex);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Classification failed";
      setError(msg);
      setTimeout(() => setError(null), 4000);
    }
  }

  async function handleConfirmLearning() {
    if (!learningProposal) return;
    setError(null);
    try {
      await confirmLearning(learningProposal);
      setSavedMessages((prev) =>
        new Set(prev).add(learningProposal.messageId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      setTimeout(() => setError(null), 4000);
    }
  }

  if (!selectedAgent || !profile || !colors) return null;

  const Icon = profile.icon;

  return (
    <>
      <Card className="flex h-[500px] w-96 flex-col overflow-hidden shadow-lg">
        {/* Header */}
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-3 py-2.5">
          <div className={`rounded p-1.5 ${colors.bg}`}>
            <Icon className={`h-4 w-4 ${colors.text}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">{selectedAgent}</span>
              {hasSessionContext && (
                <Badge
                  variant="secondary"
                  className="gap-0.5 px-1 py-0 text-[9px]"
                >
                  <Code2 className="h-2.5 w-2.5" />
                  Session
                </Badge>
              )}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {profile.tagline}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground"
            onClick={isStreaming ? cancelStream : requestClose}
            title={isStreaming ? "Stop generation" : "Close"}
          >
            {isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </Button>
        </CardHeader>

        <Separator />

        {/* Messages */}
        <ScrollArea className="flex-1 px-3">
          <div ref={scrollRef} className="space-y-2 py-3">
            {messages.length === 0 && !streamingContent && (
              <div className="space-y-1 text-center text-xs text-muted-foreground">
                <p>
                  Ask {selectedAgent} anything about{" "}
                  {profile.skills[0]?.toLowerCase() ?? "their specialty"}.
                </p>
                {hasSessionContext && (
                  <p className="text-[10px]">
                    Has context from current session — ask about generated code.
                  </p>
                )}
              </div>
            )}
            {error && (
              <div className="rounded-md bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
                {error}
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                index={i}
                agentName={selectedAgent}
                isClassifying={isClassifying}
                isSaved={savedMessages.has(msg.id)}
                onLightbulb={handleLightbulb}
              />
            ))}
            {streamingContent && (
              <div className="mr-6 rounded-md border bg-card px-3 py-2">
                <div className="mb-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                  {selectedAgent}
                </div>
                <div className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">
                  {streamingContent}
                  <span className="inline-block h-3 w-1 animate-pulse bg-foreground/70" />
                </div>
              </div>
            )}

            {/* Learning proposal card */}
            {learningProposal && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5">
                  {learningProposal.type === "agent_knowledge" ? (
                    <BookOpen className="h-3.5 w-3.5 text-amber-500" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span className="text-xs font-medium">
                    {learningProposal.type === "agent_knowledge"
                      ? "Agent Learning"
                      : "Correction Pattern"}
                  </span>
                </div>
                <p className="mb-1 text-[10px] text-muted-foreground">
                  {learningProposal.reasoning}
                </p>
                <div className="mb-1.5 rounded bg-accent/50 px-2 py-1">
                  <div className="font-mono text-[10px] font-medium">
                    {learningProposal.title}
                  </div>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {learningProposal.targetAgents.map((name) => (
                    <Badge
                      key={name}
                      variant="secondary"
                      className="px-1 py-0 text-[9px]"
                    >
                      {name}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={handleConfirmLearning}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setLearningProposal(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Input */}
        <CardContent className="px-3 py-2.5">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="min-h-[36px] max-h-[80px] resize-none text-xs"
              rows={1}
              disabled={isStreaming}
            />
            <Button
              size="sm"
              className="h-9 w-9 shrink-0 p-0"
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Ctrl+Enter to send
          </div>
        </CardContent>
      </Card>

      {/* Save prompt */}
      <AlertDialog open={showSavePrompt} onOpenChange={setShowSavePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {messages.length} message
              {messages.length !== 1 ? "s" : ""} with {selectedAgent}. Would you
              like to save this conversation before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={confirmDiscard}>
              Discard
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSave}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Individual message bubble with lightbulb for saving corrections. */
function MessageBubble({
  msg,
  index,
  agentName,
  isClassifying,
  isSaved,
  onLightbulb,
}: {
  msg: ChatMessage;
  index: number;
  agentName: string;
  isClassifying: boolean;
  isSaved: boolean;
  onLightbulb: (index: number) => void;
}) {
  const isUser = msg.role === "user";

  return (
    <div
      className={`group relative rounded-md px-3 py-2 ${
        isUser ? "ml-6 bg-accent" : "mr-6 border bg-card"
      }`}
    >
      <div className="mb-0.5 flex items-center justify-between">
        <span className="font-mono text-[10px] font-medium text-muted-foreground">
          {isUser ? "You" : agentName}
        </span>
        {isUser && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onLightbulb(index)}
                  disabled={isSaved || isClassifying}
                  className={`${
                    isSaved
                      ? "cursor-default text-green-500"
                      : isClassifying
                        ? "cursor-wait text-amber-500/50"
                        : "text-muted-foreground/50 hover:text-amber-500"
                  }`}
                >
                  {isSaved ? (
                    <Check className="h-3 w-3" />
                  ) : isClassifying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Lightbulb className="h-3 w-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {isSaved
                  ? "Saved as learning"
                  : isClassifying
                    ? "Classifying..."
                    : "Save as learning"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">
        {msg.content}
      </div>
    </div>
  );
}
