import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Play, Trash2, ChevronDown, ChevronRight, Code2, Hammer } from "lucide-react";
import { usePacStStore } from "@/stores/pac-st-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { PipelineActivity } from "./pipeline-activity";
import type { FbBuilderMessage } from "@/hooks/use-fb-builder";

interface FbBuilderPaneProps {
  messages: FbBuilderMessage[];
  onSend: (message: string) => void;
  onGenerate: () => void;
  onClear: () => void;
  sending: boolean;
  generating: boolean;
  streamingContent: string | null;
  error: Error | null;
}

export function FbBuilderPane({
  messages,
  onSend,
  onGenerate,
  onClear,
  sending,
  generating,
  streamingContent,
  error,
}: FbBuilderPaneProps) {
  const [input, setInput] = useState("");
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveOutputRef = useRef<HTMLPreElement>(null);
  const pipelineStreamingContent = usePacStStore((s) => s.streamingContent);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending, streamingContent]);

  // Auto-scroll live output during generation
  useEffect(() => {
    if (liveOutputRef.current) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
    }
  }, [pipelineStreamingContent]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending || generating) return;
    onSend(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasConversation = messages.length > 0;
  const busy = sending || generating;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hammer className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">FB Builder</div>
              <div className="font-mono text-xs text-muted-foreground">
                Design a Function Block with the Project Manager
              </div>
            </div>
          </div>
          {hasConversation && !busy && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onClear}
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-3 p-3">
          {/* Empty state */}
          {messages.length === 0 && !generating && (
            <div className="space-y-3 py-8 text-center">
              <Hammer className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <div className="font-mono text-sm text-muted-foreground">
                Describe the Function Block you want to create
              </div>
              <div className="mx-auto max-w-xs font-mono text-xs text-muted-foreground/60">
                The PM will ask clarifying questions to ensure accuracy, then the Code Architect will generate the code.
              </div>
              <div className="mx-auto max-w-sm space-y-1 pt-2 text-left">
                <div className="font-mono text-[10px] font-medium text-muted-foreground/60">Examples:</div>
                {[
                  "Create a motor control FB with start/stop, feedback monitoring, and fault handling",
                  "Build an analog scaling FB that converts raw 0-27648 to engineering units",
                  "Design a conveyor FB with forward/reverse, speed control, and jam detection",
                ].map((example) => (
                  <button
                    key={example}
                    className="w-full rounded-md bg-accent/30 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                    onClick={() => {
                      setInput(example);
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{example}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-md px-3 py-2 ${
                msg.role === "user"
                  ? "ml-4 bg-accent"
                  : "mr-4 border bg-card"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-xs font-medium text-muted-foreground">
                  {msg.role === "user" ? "You" : "Project Manager"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
            </div>
          ))}

          {/* Streaming PM response */}
          {sending && streamingContent && (
            <div className="mr-4 rounded-md border bg-card px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="font-mono text-xs font-medium text-muted-foreground">
                  Project Manager
                </span>
              </div>
              <div className="whitespace-pre-wrap text-sm">{streamingContent}</div>
            </div>
          )}

          {/* Sending indicator (no content yet) */}
          {sending && !streamingContent && (
            <div className="mr-4 flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">PM is thinking...</span>
            </div>
          )}

          {/* Pipeline activity during generation */}
          {generating && (
            <div className="mr-4 space-y-1">
              <div className="rounded-md border bg-card">
                <PipelineActivity />
              </div>
              {pipelineStreamingContent && (
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
                      Live Output ({pipelineStreamingContent.split("\n").length} lines)
                    </span>
                  </button>
                  {showLiveOutput && (
                    <pre
                      ref={liveOutputRef}
                      className="max-h-40 overflow-auto border-t bg-muted/50 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                    >
                      {pipelineStreamingContent.split("\n").slice(-20).join("\n")}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pipeline activity (collapsed when not generating) */}
          {!generating && hasConversation && (
            <div className="mr-4 rounded-md border bg-card">
              <PipelineActivity defaultCollapsed />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {error.message}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-3">
        {/* Generate button (visible when conversation has started) */}
        {hasConversation && !generating && (
          <Button
            className="mb-2 w-full gap-2"
            onClick={onGenerate}
            disabled={busy}
          >
            <Play className="h-4 w-4" />
            Generate FB
          </Button>
        )}

        {generating && (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-md bg-accent/30 px-3 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="font-mono text-xs">Pipeline running...</span>
          </div>
        )}

        {/* Text input */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasConversation
                ? "Answer the PM's questions..."
                : "Describe the Function Block you want to create..."
            }
            className="min-h-[60px] resize-none font-mono text-sm"
            rows={3}
            disabled={busy}
          />
          <Button
            size="sm"
            className="h-auto self-end"
            onClick={handleSend}
            disabled={!input.trim() || busy}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          Ctrl+Enter to send
        </div>
      </div>
    </div>
  );
}
