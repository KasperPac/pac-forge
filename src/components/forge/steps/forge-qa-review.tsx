import { useEffect, useRef, useState } from "react";
import { Send, SkipForward, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useForgeQaReview } from "@/hooks/use-forge-qa-review";
import type { SpecAnalysis, QaMessage } from "@/types/forge";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ForgeQaReviewProps {
  specAnalysis: SpecAnalysis;
  onComplete: (updatedAnalysis: SpecAnalysis, messages: QaMessage[]) => void;
  onSkip: () => void;
}

// ── Spec summary helpers ──────────────────────────────────────────────────────

function fieldMissing(val: string | null | undefined) {
  return !val || val.trim() === "";
}

function SpecSummaryCard({ analysis }: { analysis: SpecAnalysis }) {
  const missingFields: string[] = [];
  if (fieldMissing(analysis.plc_type)) missingFields.push("PLC type");
  if (fieldMissing(analysis.hmi_type)) missingFields.push("HMI type");
  if (analysis.devices.length === 0) missingFields.push("Devices");
  if (analysis.process_sequences.length === 0) missingFields.push("Process sequences");
  const devicesWithoutIo = analysis.devices.filter((d) => !d.io_signals?.length);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Project</div>
        <div className="mt-0.5 text-sm font-medium">{analysis.project_name || "(unnamed)"}</div>
        {analysis.project_description && (
          <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{analysis.project_description}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">PLC</div>
          <div className={cn("mt-0.5 text-sm", fieldMissing(analysis.plc_type) && "text-amber-500")}>
            {analysis.plc_type || "Not specified"}
          </div>
        </div>
        <div className="rounded border border-border/50 bg-background/50 px-2.5 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">HMI</div>
          <div className={cn("mt-0.5 text-sm", fieldMissing(analysis.hmi_type) && "text-amber-500")}>
            {analysis.hmi_type || "Not specified"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Devices", count: analysis.devices.length },
          { label: "Sequences", count: analysis.process_sequences.length },
          { label: "Alarms", count: analysis.alarms.length },
          { label: "Interlocks", count: analysis.interlocks.length },
        ].map(({ label, count }) => (
          <div key={label} className="rounded border border-border/50 bg-background/50 px-2.5 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 text-lg font-mono font-semibold", count === 0 && "text-amber-500")}>
              {count}
            </div>
          </div>
        ))}
      </div>

      {analysis.subsystems.length > 0 && (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Subsystems</div>
          <div className="flex flex-wrap gap-1">
            {analysis.subsystems.map((s) => (
              <Badge key={s.name} variant="outline" className="font-mono text-[10px]">{s.name}</Badge>
            ))}
          </div>
        </div>
      )}

      {(missingFields.length > 0 || devicesWithoutIo.length > 0) && (
        <div className="rounded border border-amber-600/30 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-500">
            <AlertCircle className="h-3 w-3" />
            Gaps detected
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {missingFields.map((f) => (
              <li key={f} className="text-xs text-amber-400/90">• {f} not specified</li>
            ))}
            {devicesWithoutIo.length > 0 && (
              <li className="text-xs text-amber-400/90">
                • {devicesWithoutIo.length} device{devicesWithoutIo.length > 1 ? "s" : ""} without IO signals
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: QaMessage }) {
  const isPm = message.role === "assistant";
  return (
    <div className={cn("flex gap-2.5", isPm ? "justify-start" : "justify-end")}>
      {isPm && (
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-[10px] font-bold text-primary">
          PM
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isPm
            ? "bg-muted/40 text-foreground"
            : "bg-primary/15 text-foreground",
        )}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        <div className="mt-1 font-mono text-[9px] text-muted-foreground/60">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForgeQaReview({ specAnalysis, onComplete, onSkip }: ForgeQaReviewProps) {
  const { messages, loading, error, isComplete, startReview, sendMessage, finalizeAnalysis } =
    useForgeQaReview();

  const [input, setInput] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [started, setStarted] = useState(false);

  // Start review on mount
  useEffect(() => {
    if (!started) {
      setStarted(true);
      startReview(specAnalysis).catch(() => {/* error shown in UI */});
    }
  }, [started, startReview, specAnalysis]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    await sendMessage(text).catch(() => {/* error shown in UI */});
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleConfirmAndContinue() {
    setFinalizing(true);
    try {
      const updated = await finalizeAnalysis(specAnalysis);
      onComplete(updated, messages);
    } catch {
      // error shown in UI
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left panel — spec summary */}
      <div className="w-[38%] shrink-0">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Spec Analysis
        </div>
        <ScrollArea className="h-[480px] pr-1">
          <SpecSummaryCard analysis={specAnalysis} />
        </ScrollArea>
      </div>

      {/* Right panel — chat */}
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            PM Gap Analysis
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider"
            onClick={onSkip}
            disabled={loading || finalizing}
          >
            <SkipForward className="h-3 w-3" />
            Skip Q&A
          </Button>
        </div>

        {/* Message list */}
        <ScrollArea className="flex-1 h-[360px] rounded-md border border-border/60 bg-background/40 p-3" ref={scrollRef}>
          <div className="flex flex-col gap-3">
            {messages.length === 0 && loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>PM is reviewing the spec…</span>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {loading && messages.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>PM is typing…</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Complete banner */}
        {isComplete && (
          <div className="flex items-center justify-between rounded border border-green-600/30 bg-green-500/5 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Analysis is complete — ready to proceed
            </div>
            <Button
              size="sm"
              className="h-7 gap-1.5 font-mono text-xs"
              onClick={handleConfirmAndContinue}
              disabled={finalizing}
            >
              {finalizing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finalizing…</>
                : <>Confirm & Continue</>
              }
            </Button>
          </div>
        )}

        {/* Input area */}
        {!isComplete && (
          <div className="flex gap-2">
            <Textarea
              ref={inputRef}
              className="min-h-[60px] resize-none text-sm"
              placeholder="Answer the PM's questions… (Enter to send, Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || messages.length === 0}
            />
            <Button
              size="sm"
              className="h-auto self-stretch px-3"
              onClick={handleSend}
              disabled={!input.trim() || loading || messages.length === 0}
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />
              }
            </Button>
          </div>
        )}

        {/* Manual continue even when not flagged complete */}
        {messages.length > 0 && !isComplete && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 font-mono text-xs"
              onClick={handleConfirmAndContinue}
              disabled={finalizing || loading}
            >
              {finalizing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Finalizing…</>
                : <>Apply Answers & Continue</>
              }
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
