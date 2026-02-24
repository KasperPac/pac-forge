import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  Wrench,
  Bot,
  User,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Square,
  GraduationCap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompileFix } from "@/hooks/use-compile-fix";
import { useReimportCompile } from "@/hooks/use-reimport-compile";
import { useActivePatterns, useCreateApprovedPattern } from "@/hooks/use-patterns";
import { computeDiff, getChangedContent } from "@/lib/diff-engine";
import { CORRECTION_TYPES } from "@/types";
import type { CompileErrorInfo } from "@/lib/compile-fix-prompt";
import type { FixedSource } from "@/lib/compile-fix-parser";
import type { DesignProfile, AgentKnowledgeDoc } from "@/types";

const DEFAULT_MAX_ROUNDS = 5;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  fixes?: FixedSource[];
  appliedFixes?: boolean;
}

interface StuckInfo {
  errors: CompileErrorInfo[];
  sources: Record<string, string>;
  rounds: number;
  reason: string;
}

interface CompileFixChatProps {
  compileErrors: CompileErrorInfo[];
  compileWarnings: CompileErrorInfo[];
  sources: Record<string, string>;
  isConnected: boolean;
  onCompileResultUpdate?: (result: {
    success: boolean;
    errors: CompileErrorInfo[];
    warnings: CompileErrorInfo[];
    sources: Record<string, string>;
  }) => void;
  /** Called when the fix session is fully done (user dismissed remember prompt or cleared chat) */
  onFixSessionEnd?: () => void;
  /** Optional design profile for customer-specific code rules */
  designProfile?: DesignProfile;
  /** Agent knowledge docs for the Code Architect (injected into compile-fix prompts) */
  agentKnowledgeDocs?: AgentKnowledgeDoc[];
}

/** Fingerprint errors for stuck detection */
function errorFingerprint(errors: CompileErrorInfo[]): string {
  return errors
    .map((e) => `${e.artifact_name}:${e.line ?? ""}:${e.error_text}`)
    .sort()
    .join("|");
}

export function CompileFixChat({
  compileErrors,
  compileWarnings,
  sources,
  isConnected,
  onCompileResultUpdate,
  onFixSessionEnd,
  designProfile,
  agentKnowledgeDocs,
}: CompileFixChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [maxRounds, setMaxRounds] = useState(DEFAULT_MAX_ROUNDS);
  const maxRoundsRef = useRef(DEFAULT_MAX_ROUNDS);
  const [currentSources, setCurrentSources] = useState<Record<string, string>>(sources);
  const [currentErrors, setCurrentErrors] = useState<CompileErrorInfo[]>(compileErrors);
  const [currentWarnings, setCurrentWarnings] = useState<CompileErrorInfo[]>(compileWarnings);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRunningRef = useRef(false);
  const [round, setRound] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [stuck, setStuck] = useState<StuckInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevFingerprintRef = useRef<string>("");
  const messagesRef = useRef<ChatMessage[]>([]);

  const compileFix = useCompileFix();
  const reimportCompile = useReimportCompile();
  const { data: approvedPatterns } = useActivePatterns("SIEMENS_TIA");
  const createApprovedPattern = useCreateApprovedPattern();

  // Sync props into state on mount / when parent changes
  useEffect(() => {
    setCurrentSources(sources);
  }, [sources]);

  useEffect(() => {
    setCurrentErrors(compileErrors);
    setCurrentWarnings(compileWarnings);
  }, [compileErrors, compileWarnings]);

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    maxRoundsRef.current = maxRounds;
  }, [maxRounds]);

  // Auto-learn: save pattern when fix resolves successfully
  useEffect(() => {
    if (!resolved) return;

    // Find last assistant message for explanation
    const lastAssistant = [...messagesRef.current].reverse().find(
      (m) => m.role === "assistant" && m.content,
    );
    if (!lastAssistant) return;

    // Build before/after snippets from diff
    let originalSnippet = "";
    let correctedSnippet = "";
    const changedArtifacts: string[] = [];
    for (const name of Object.keys(currentSources)) {
      const original = sources[name];
      const current = currentSources[name];
      if (original && current && original !== current) {
        changedArtifacts.push(name);
        if (!originalSnippet) {
          const diff = computeDiff(original, current);
          const { removedLines, addedLines } = getChangedContent(diff);
          originalSnippet = removedLines.join("\n").slice(0, 2000);
          correctedSnippet = addedLines.join("\n").slice(0, 2000);
        }
      }
    }

    if (!originalSnippet && !correctedSnippet) return;

    createApprovedPattern.mutate(
      {
        plc_brand: "SIEMENS_TIA",
        device_type: "General",
        context: `compile-fix: ${changedArtifacts.join(", ")}`,
        original_snippet: originalSnippet,
        corrected_snippet: correctedSnippet,
        correction_type: "STATE_LOGIC",
        explanation_tag: lastAssistant.content.slice(0, 2000),
      },
      {
        onSuccess: () => {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: "Pattern learned and saved for future generations." },
          ]);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // Auto-scroll on new messages or state changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, resolved, stuck]);

  // Helper: synchronously set autoRunning flag + ref
  const setAutoRunningSync = useCallback((value: boolean) => {
    autoRunningRef.current = value;
    setAutoRunning(value);
  }, []);

  // --- Core auto-loop: ask AI → apply fixes → recompile → repeat ---

  const askAI = useCallback(
    (
      errors: CompileErrorInfo[],
      warnings: CompileErrorInfo[],
      srcs: Record<string, string>,
      roundNum: number,
      userMsg?: string,
    ) => {
      const isFirst = roundNum === 1;
      const displayMessage = isFirst
        ? `Fix ${errors.length} compile error(s)${userMsg ? `: ${userMsg}` : ""}`
        : `Round ${roundNum}: Fix remaining ${errors.length} error(s)`;

      // Build conversation history from prior messages so the AI doesn't repeat mistakes
      const conversationHistory = messagesRef.current
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      setMessages((prev) => [...prev, { role: "user", content: displayMessage }]);

      compileFix.mutate(
        {
          errors,
          warnings,
          sources: srcs,
          userMessage: userMsg,
          approvedPatterns,
          conversationHistory,
          designProfile,
          agentKnowledgeDocs,
        },
        {
          onSuccess: (result) => {
            // Check ref — user may have cancelled while waiting
            if (!autoRunningRef.current) return;

            const msg: ChatMessage = {
              role: "assistant",
              content: result.explanation || result.rawResponse,
              fixes: result.fixes.length > 0 ? result.fixes : undefined,
            };
            setMessages((prev) => [...prev, msg]);

            // If AI returned fixes and we're auto-running, apply them immediately
            if (result.fixes.length > 0 && autoRunningRef.current) {
              applyAndRecompile(result.fixes, srcs, errors, roundNum);
            }
          },
          onError: (error) => {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Error: ${error.message}` },
            ]);
            setAutoRunningSync(false);
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compileFix, setAutoRunningSync, approvedPatterns, agentKnowledgeDocs],
  );

  const applyAndRecompile = useCallback(
    (
      fixes: FixedSource[],
      srcs: Record<string, string>,
      prevErrors: CompileErrorInfo[],
      roundNum: number,
    ) => {
      // Merge fixes
      const updated = { ...srcs };
      for (const fix of fixes) {
        updated[fix.artifactName] = fix.content;
      }
      setCurrentSources(updated);

      // Mark latest assistant message as applied
      setMessages((prev) => {
        const last = [...prev];
        for (let i = last.length - 1; i >= 0; i--) {
          if (last[i].role === "assistant" && last[i].fixes && !last[i].appliedFixes) {
            last[i] = { ...last[i], appliedFixes: true };
            break;
          }
        }
        return last;
      });

      setMessages((prev) => [
        ...prev,
        { role: "system", content: `Recompiling ${fixes.length} corrected source(s)...` },
      ]);

      reimportCompile.mutate(
        { sources: updated },
        {
          onSuccess: (result) => {
            // Check ref — user may have cancelled while waiting
            if (!autoRunningRef.current) {
              // Still update sources/errors even when cancelled, so state is current
              setCurrentSources(result.sources);
              setCurrentErrors(result.errors ?? []);
              setCurrentWarnings(result.warnings ?? []);
              onCompileResultUpdate?.({
                success: result.success,
                errors: result.errors ?? [],
                warnings: result.warnings ?? [],
                sources: result.sources,
              });
              return;
            }

            const newSources = result.sources;
            const newErrors = result.errors ?? [];
            const newWarnings = result.warnings ?? [];

            setCurrentSources(newSources);
            setCurrentErrors(newErrors);
            setCurrentWarnings(newWarnings);

            // Notify parent
            onCompileResultUpdate?.({
              success: result.success,
              errors: newErrors,
              warnings: newWarnings,
              sources: newSources,
            });

            if (result.success) {
              // Resolved!
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Compile successful! All errors resolved in ${roundNum} round(s). ${newWarnings.length} warning(s).`,
                },
              ]);
              setAutoRunningSync(false);
              setResolved(true);
              return;
            }

            // Still errors — check if stuck
            const newFingerprint = errorFingerprint(newErrors);
            const sameErrors = newFingerprint === prevFingerprintRef.current;
            const noImprovement = newErrors.length >= prevErrors.length;
            const maxReached = roundNum >= maxRoundsRef.current;

            if (sameErrors || maxReached) {
              const reason = sameErrors
                ? "Same errors after applying fixes — the AI could not resolve them."
                : `Reached maximum of ${maxRoundsRef.current} fix rounds.`;

              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Compile failed: ${newErrors.length} error(s). ${reason}`,
                },
              ]);
              setAutoRunningSync(false);
              setStuck({
                errors: newErrors,
                sources: newSources,
                rounds: roundNum,
                reason,
              });
              return;
            }

            // Progress made — continue loop
            prevFingerprintRef.current = newFingerprint;
            const nextRound = roundNum + 1;
            setRound(nextRound);

            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Compile failed: ${newErrors.length} error(s) remaining (was ${prevErrors.length}). Continuing...`,
              },
            ]);

            // If auto-running and there's no improvement, warn but still try if error text differs
            if (noImprovement && !sameErrors) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Warning: error count didn't decrease. Trying different approach...`,
                },
              ]);
            }

            // Next round
            askAI(newErrors, newWarnings, newSources, nextRound);
          },
          onError: (error) => {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Reimport failed: ${error.message}` },
            ]);
            setAutoRunningSync(false);
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reimportCompile, onCompileResultUpdate, askAI, setAutoRunningSync],
  );

  function handleAutoFix(userMsg?: string) {
    prevFingerprintRef.current = errorFingerprint(currentErrors);
    setAutoRunningSync(true);
    setResolved(false);
    setStuck(null);
    setRound(1);
    askAI(currentErrors, currentWarnings, currentSources, 1, userMsg);
  }

  function handleCancel() {
    setAutoRunningSync(false);
    setMessages((prev) => [
      ...prev,
      { role: "system", content: "Auto-fix cancelled by user." },
    ]);
  }

  function handleManualApply(fixes: FixedSource[], messageIndex: number) {
    // Mark this message as applied
    setMessages((prev) =>
      prev.map((m, i) => (i === messageIndex ? { ...m, appliedFixes: true } : m)),
    );

    // Apply without auto-loop
    const updated = { ...currentSources };
    for (const fix of fixes) {
      updated[fix.artifactName] = fix.content;
    }
    setCurrentSources(updated);

    setMessages((prev) => [
      ...prev,
      { role: "system", content: `Recompiling ${fixes.length} corrected source(s)...` },
    ]);

    reimportCompile.mutate(
      { sources: updated },
      {
        onSuccess: (result) => {
          setCurrentSources(result.sources);
          setCurrentErrors(result.errors ?? []);
          setCurrentWarnings(result.warnings ?? []);

          onCompileResultUpdate?.({
            success: result.success,
            errors: result.errors ?? [],
            warnings: result.warnings ?? [],
            sources: result.sources,
          });

          if (result.success) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `Compile successful! ${(result.warnings ?? []).length} warning(s).` },
            ]);
            setResolved(true);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Compile failed: ${(result.errors ?? []).length} error(s). Click "Continue Fixing" or type instructions below.`,
              },
            ]);
          }
        },
        onError: (error) => {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: `Reimport failed: ${error.message}` },
          ]);
        },
      },
    );
  }

  function handleSend() {
    const msg = input.trim();
    if (!msg && messages.length === 0) {
      handleAutoFix();
      return;
    }
    if (!msg) return;
    setInput("");

    if (messages.length === 0) {
      handleAutoFix(msg);
    } else {
      // Manual follow-up — restart auto-loop with instructions
      prevFingerprintRef.current = errorFingerprint(currentErrors);
      setAutoRunningSync(true);
      setStuck(null);
      setRound((r) => r + 1);
      askAI(currentErrors, currentWarnings, currentSources, round + 1, msg);
    }
  }

  function handleContinueFixing() {
    setStuck(null);
    prevFingerprintRef.current = "";
    setAutoRunningSync(true);
    const nextRound = round + 1;
    setRound(nextRound);
    askAI(currentErrors, currentWarnings, currentSources, nextRound);
  }

  function handleClear() {
    setMessages([]);
    setCurrentSources(sources);
    setCurrentErrors(compileErrors);
    setCurrentWarnings(compileWarnings);
    setAutoRunningSync(false);
    setResolved(false);
    setStuck(null);
    setRound(0);
    onFixSessionEnd?.();
    prevFingerprintRef.current = "";
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  const isLoading = compileFix.isPending || reimportCompile.isPending;

  return (
    <Card className="flex max-h-[600px] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-mono text-sm font-medium">Compile Fix</span>
          {resolved ? (
            <Badge variant="outline" className="font-mono text-xs border-green-500/30 bg-green-500/10 text-green-400">
              Resolved
            </Badge>
          ) : (
            <Badge variant="outline" className="font-mono text-xs">
              {currentErrors.length} error{currentErrors.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {autoRunning && (
            <Badge variant="outline" className="font-mono text-xs border-blue-500/30 bg-blue-500/10 text-blue-400">
              Round {round}/{maxRounds}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length === 0 && (
            <>
              <select
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value))}
                className="h-5 rounded border bg-background px-1 font-mono text-xs"
                title="Max auto-fix rounds"
              >
                {[1, 2, 3, 5, 7, 10].map((n) => (
                  <option key={n} value={n}>{n}x</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="h-5 gap-1 px-2 font-mono text-xs"
                onClick={() => handleAutoFix()}
                disabled={isLoading || !isConnected}
              >
                <Bot className="h-2.5 w-2.5" />
                Auto-Fix
              </Button>
            </>
          )}
          {autoRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-5 gap-1 px-2 font-mono text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={handleCancel}
            >
              <Square className="h-2 w-2" />
              Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5"
            onClick={handleClear}
            disabled={messages.length === 0 || isLoading}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="space-y-2 p-3">
          {messages.length === 0 && (
            <div className="py-4 text-center font-mono text-sm text-muted-foreground">
              Click "Auto-Fix" to automatically fix compile errors with AI.
              <br />
              It will loop until all errors are resolved or it gets stuck.
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              index={i}
              isLoading={isLoading}
              isConnected={isConnected}
              autoRunning={autoRunning}
              onApplyFixes={handleManualApply}
            />
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 py-2 font-mono text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {compileFix.isPending ? "AI analyzing errors..." : "Reimporting & recompiling..."}
            </div>
          )}

          {/* Stuck panel */}
          {stuck && <StuckPanel stuck={stuck} />}

          {/* Post-recompile actions (when not auto-running and not resolved) */}
          {!autoRunning && !resolved && !stuck && messages.length > 0 && !isLoading && currentErrors.length > 0 && (
            <div className="flex gap-1.5 pt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 flex-1 gap-1 font-mono text-xs"
                onClick={handleContinueFixing}
                disabled={isLoading || !isConnected}
              >
                <Play className="h-2.5 w-2.5" />
                Continue Fixing ({currentErrors.length} errors)
              </Button>
            </div>
          )}

          {/* Resolved — auto-learned, offer to end session */}
          {resolved && !autoRunning && !isLoading && (
            <div className="space-y-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                <span className="font-mono text-sm font-medium text-green-400">
                  Fix complete
                </span>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                Correction pattern auto-saved for future generations.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-3 font-mono text-xs"
                onClick={() => onFixSessionEnd?.()}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Teach panel — when stuck or errors remain */}
          {!resolved && !autoRunning && !isLoading && (stuck || currentErrors.length > 0) && messages.length > 0 && (
            <TeachPanel
              sources={currentSources}
              originalSources={sources}
            />
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex gap-1.5">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              messages.length === 0
                ? "Optional: Add context before auto-fix..."
                : stuck
                  ? "Give the AI additional instructions to try again..."
                  : "Add instructions for the next fix round..."
            }
            className="min-h-[36px] resize-none font-mono text-sm"
            rows={1}
            disabled={isLoading || autoRunning}
          />
          <Button
            size="sm"
            className="h-9 shrink-0 px-2"
            onClick={handleSend}
            disabled={isLoading || autoRunning || (!input.trim() && messages.length > 0)}
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          Ctrl+Enter to send
        </div>
      </div>
    </Card>
  );
}

// --- Teach panel: lets the user save a correction pattern ---

function TeachPanel({
  sources,
  originalSources,
}: {
  sources: Record<string, string>;
  originalSources: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [correctionType, setCorrectionType] = useState<string>("STATE_LOGIC");
  const [originalSnippet, setOriginalSnippet] = useState("");
  const [correctedSnippet, setCorrectedSnippet] = useState("");
  const [saved, setSaved] = useState(false);
  const createPattern = useCreateApprovedPattern();

  // Pre-fill snippets from first artifact that changed
  useEffect(() => {
    if (!expanded || originalSnippet || correctedSnippet) return;

    for (const name of Object.keys(sources)) {
      const original = originalSources[name];
      const current = sources[name];
      if (original && current && original !== current) {
        const diff = computeDiff(original, current);
        const { removedLines, addedLines } = getChangedContent(diff);
        setOriginalSnippet(removedLines.join("\n").slice(0, 2000));
        setCorrectedSnippet(addedLines.join("\n").slice(0, 2000));
        break;
      }
    }
  }, [expanded, sources, originalSources, originalSnippet, correctedSnippet]);

  function handleSave() {
    if (!explanation.trim()) return;
    createPattern.mutate(
      {
        plc_brand: "SIEMENS_TIA",
        device_type: "General",
        context: "compile-fix",
        original_snippet: originalSnippet.trim(),
        corrected_snippet: correctedSnippet.trim(),
        correction_type: correctionType,
        explanation_tag: explanation.trim(),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setExplanation("");
          setOriginalSnippet("");
          setCorrectedSnippet("");
        },
      },
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => { setExpanded(!expanded); setSaved(false); }}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-amber-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-amber-400" />
        )}
        <GraduationCap className="h-3 w-3 text-amber-400" />
        <span className="font-mono text-xs font-medium text-amber-400">
          Teach the AI
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Save a correction so it learns for next time
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 pt-1">
          {/* Explanation */}
          <div className="space-y-0.5">
            <label className="font-mono text-xs text-muted-foreground">
              What was wrong? (required)
            </label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder='e.g. "TON timers must have both IN and PT parameters, even when resetting"'
              className="min-h-[48px] resize-none font-mono text-xs"
              rows={2}
            />
          </div>

          {/* Correction type */}
          <div className="space-y-0.5">
            <label className="font-mono text-xs text-muted-foreground">
              Category
            </label>
            <Select value={correctionType} onValueChange={setCorrectionType}>
              <SelectTrigger className="h-7 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(CORRECTION_TYPES).map((type) => (
                  <SelectItem key={type} value={type} className="font-mono text-xs">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Before/after snippets */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <label className="font-mono text-xs text-muted-foreground">
                Wrong code (optional)
              </label>
              <Textarea
                value={originalSnippet}
                onChange={(e) => setOriginalSnippet(e.target.value)}
                placeholder="Paste the incorrect SCL..."
                className="min-h-[48px] resize-none font-mono text-xs"
                rows={3}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-xs text-muted-foreground">
                Correct code (optional)
              </label>
              <Textarea
                value={correctedSnippet}
                onChange={(e) => setCorrectedSnippet(e.target.value)}
                placeholder="Paste the corrected SCL..."
                className="min-h-[48px] resize-none font-mono text-xs"
                rows={3}
              />
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-6 gap-1 px-3 font-mono text-xs"
              onClick={handleSave}
              disabled={!explanation.trim() || createPattern.isPending}
            >
              {createPattern.isPending ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <GraduationCap className="h-2.5 w-2.5" />
              )}
              Save Correction
            </Button>
            {saved && (
              <span className="flex items-center gap-1 font-mono text-xs text-green-400">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Saved! Will be used in future fix rounds.
              </span>
            )}
            {createPattern.isError && (
              <span className="font-mono text-xs text-red-400">
                Error saving: {createPattern.error?.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Stuck panel: shows remaining errors with code context ---

function StuckPanel({ stuck }: { stuck: StuckInfo }) {
  // Group errors by artifact
  const grouped: Record<string, CompileErrorInfo[]> = {};
  for (const err of stuck.errors) {
    const key = err.artifact_name ?? "Unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(err);
  }

  return (
    <div className="space-y-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        <span className="font-mono text-sm font-medium text-red-400">
          Unable to resolve — {stuck.errors.length} error(s) after {stuck.rounds} round(s)
        </span>
      </div>
      <div className="font-mono text-xs text-muted-foreground">
        {stuck.reason}
      </div>

      {Object.entries(grouped).map(([artifact, errors]) => {
        const source = stuck.sources[artifact];
        const sourceLines = source?.split("\n");

        return (
          <div key={artifact} className="space-y-1">
            <div className="font-mono text-xs font-medium text-red-300">
              {artifact}
            </div>
            {errors.map((err, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex items-start gap-1.5">
                  <XCircle className="mt-0.5 h-2.5 w-2.5 shrink-0 text-red-400" />
                  <span className="font-mono text-xs text-red-300">
                    {err.line != null && <span className="text-red-400">Line {err.line}: </span>}
                    {err.error_text}
                  </span>
                </div>
                {/* Show code context around the error line */}
                {err.line != null && sourceLines && (
                  <CodeContext lines={sourceLines} errorLine={err.line} />
                )}
              </div>
            ))}
          </div>
        );
      })}

      <div className="pt-1 font-mono text-xs text-muted-foreground">
        Type additional instructions below to try a different approach, or clear to start over.
      </div>
    </div>
  );
}

// --- Code context: shows ~3 lines around the error with the error line highlighted ---

function CodeContext({ lines, errorLine }: { lines: string[]; errorLine: number }) {
  const start = Math.max(0, errorLine - 3);
  const end = Math.min(lines.length, errorLine + 2);
  const contextLines = lines.slice(start, end);

  return (
    <div className="ml-4 overflow-x-auto rounded border border-red-500/10 bg-black/30">
      <pre className="whitespace-pre-wrap break-all px-2 py-1 font-mono text-xs leading-relaxed">
        {contextLines.map((line, i) => {
          const lineNum = start + i + 1;
          const isError = lineNum === errorLine;
          return (
            <div
              key={lineNum}
              className={isError ? "bg-red-500/20 text-red-300" : "text-muted-foreground"}
            >
              <span className="mr-2 inline-block w-4 text-right opacity-50">{lineNum}</span>
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

// --- Message bubble component ---

function MessageBubble({
  message,
  index,
  isLoading,
  isConnected,
  autoRunning,
  onApplyFixes,
}: {
  message: ChatMessage;
  index: number;
  isLoading: boolean;
  isConnected: boolean;
  autoRunning: boolean;
  onApplyFixes: (fixes: FixedSource[], index: number) => void;
}) {
  const [expandedFixes, setExpandedFixes] = useState<Set<number>>(new Set());

  function toggleFix(fixIndex: number) {
    setExpandedFixes((prev) => {
      const next = new Set(prev);
      if (next.has(fixIndex)) next.delete(fixIndex);
      else next.add(fixIndex);
      return next;
    });
  }

  if (message.role === "system") {
    const isSuccess = message.content.includes("successful");
    const isFail = message.content.includes("failed") || message.content.includes("Error:");
    return (
      <div className="flex items-center justify-center gap-1.5 py-1">
        {isSuccess && <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />}
        {isFail && <XCircle className="h-2.5 w-2.5 text-red-400" />}
        {!isSuccess && !isFail && <Loader2 className="h-2.5 w-2.5 text-muted-foreground" />}
        <span
          className={`font-mono text-xs ${
            isSuccess ? "text-green-400" : isFail ? "text-red-400" : "text-muted-foreground"
          }`}
        >
          {message.content}
        </span>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-1.5">
          <div className="min-w-0 rounded-lg bg-primary/10 px-2.5 py-1.5">
            <p className="break-words whitespace-pre-wrap font-mono text-sm">{message.content}</p>
          </div>
          <User className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[90%] items-start gap-1.5">
        <Bot className="mt-1 h-3 w-3 shrink-0 text-amber-400" />
        <div className="min-w-0 space-y-2">
          {/* Explanation text */}
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
            <p className="break-words whitespace-pre-wrap font-mono text-sm">{message.content}</p>
          </div>

          {/* Fixed code blocks */}
          {message.fixes && message.fixes.length > 0 && (
            <div className="space-y-1">
              <div className="font-mono text-xs font-medium text-muted-foreground">
                CORRECTED FILES ({message.fixes.length})
              </div>
              {message.fixes.map((fix, fi) => (
                <div key={fi} className="rounded border border-border/50 bg-muted/30">
                  <button
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50"
                    onClick={() => toggleFix(fi)}
                  >
                    {expandedFixes.has(fi) ? (
                      <ChevronDown className="h-2.5 w-2.5" />
                    ) : (
                      <ChevronRight className="h-2.5 w-2.5" />
                    )}
                    <span className="font-mono text-xs font-medium">{fix.artifactName}</span>
                    <Badge variant="outline" className="ml-auto font-mono text-xs">
                      {fix.content.split("\n").length} lines
                    </Badge>
                  </button>
                  {expandedFixes.has(fi) && (
                    <div className="max-h-48 overflow-auto border-t px-2 py-1">
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                        {fix.content}
                      </pre>
                    </div>
                  )}
                </div>
              ))}

              {/* Manual apply button — only when not auto-running */}
              {!message.appliedFixes && !autoRunning && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-full gap-1 font-mono text-xs"
                  onClick={() => onApplyFixes(message.fixes!, index)}
                  disabled={isLoading || !isConnected}
                >
                  <Play className="h-2.5 w-2.5" />
                  Apply & Recompile
                </Button>
              )}
              {message.appliedFixes && (
                <div className="py-0.5 text-center font-mono text-xs text-green-400">
                  Applied
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
