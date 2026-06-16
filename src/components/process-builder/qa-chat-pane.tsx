import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Loader2, Workflow, Trash2, TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { getQuickReplies } from "@/lib/process-qa-suggestions";

interface QaChatPaneProps {
  onSend: (message: string) => void;
  sending: boolean;
  onClear: () => void;
  onProceed: () => void;
  canProceed: boolean;
}

export function QaChatPane({ onSend, sending, onClear, onProceed, canProceed }: QaChatPaneProps) {
  const hasMatrix = useProcessBuilderStore((s) => !!s.linkageMatrix);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = useProcessBuilderStore((s) => s.qaMessages);
  const streamingContent = useProcessBuilderStore((s) => s.streamingContent);

  // Compute quick reply chips from last assistant message
  const lastAssistantMsg = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant")?.content,
    [messages],
  );
  const quickReplies = useMemo(() => getQuickReplies(lastAssistantMsg), [lastAssistantMsg]);
  const showChips = !sending && !input && messages.some((m) => m.role === "assistant");

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sending, streamingContent]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Process Builder</div>
              <div className="font-mono text-xs text-muted-foreground">
                Discuss your process with the PM before generation
              </div>
            </div>
          </div>
          {hasConversation && !sending && (
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
          {messages.length === 0 && (
            <div className="space-y-3 py-8 text-center">
              <Workflow className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <div className="font-mono text-sm text-muted-foreground">
                Describe your process control system
              </div>
              <div className="mx-auto max-w-xs font-mono text-xs text-muted-foreground/60">
                The PM will ask questions to understand your control_modules, IO needs, and control logic before generating code in stages.
              </div>
              <div className="mx-auto max-w-sm space-y-1 pt-2 text-left">
                <div className="font-mono text-[10px] font-medium text-muted-foreground/60">Examples:</div>
                {[
                  "I need a water treatment process with 3 pumps, 2 valves, level sensors, and a chemical dosing system",
                  "Build a packaging line with conveyor, pick-and-place robot, labeler, and box sealer",
                  "Create a batch mixing process with 4 ingredient valves, agitator motor, temperature control, and discharge",
                ].map((example) => (
                  <button
                    key={example}
                    className="w-full rounded-md bg-accent/30 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                    onClick={() => setInput(example)}
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
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-3">
        {/* Quick reply chips */}
        {showChips && quickReplies.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quickReplies.map((chip) => (
              <button
                key={chip.label}
                className="rounded-full bg-accent/40 px-3 py-1.5 font-mono text-xs transition-colors hover:bg-accent/60"
                onClick={() => {
                  if (chip.sendDirect) {
                    onSend(chip.text);
                  } else {
                    setInput(chip.text);
                    textareaRef.current?.focus();
                  }
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Proceed button — only shown when matrix exists */}
        {canProceed && !sending && hasMatrix && (
          <Button
            className="mb-2 w-full gap-2"
            variant="default"
            onClick={onProceed}
          >
            <TableProperties className="h-4 w-4" />
            Review Linkage Matrix
          </Button>
        )}
        {/* Hint when PM hasn't produced a matrix yet */}
        {canProceed && !sending && !hasMatrix && (
          <div className="mb-2 rounded-md border border-dashed px-3 py-2 text-center font-mono text-xs text-muted-foreground">
            Continue the Q&A until the PM produces a Linkage Matrix
          </div>
        )}

        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasConversation
                ? "Answer the PM's questions..."
                : "Describe your process control system..."
            }
            className="min-h-[60px] resize-none font-mono text-sm"
            rows={3}
            disabled={sending}
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
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          Ctrl+Enter to send
        </div>
      </div>
    </div>
  );
}
