import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Terminal,
  Trash2,
  Loader2,
  Maximize2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PipelineStepResult } from "@/lib/pipeline";

const ROLE_LABELS: Record<string, string> = {
  plan: "Plan",
  generate: "Generate",
  review: "Review",
  rewrite: "Rewrite",
  patterns: "Patterns",
  summary: "Summary",
  compile_fix: "Compile Fix",
};

const ROLE_COLORS: Record<string, string> = {
  plan: "bg-violet-500/20 text-violet-400",
  generate: "bg-blue-500/20 text-blue-400",
  review: "bg-amber-500/20 text-amber-400",
  rewrite: "bg-cyan-500/20 text-cyan-400",
  patterns: "bg-emerald-500/20 text-emerald-400",
  summary: "bg-violet-500/20 text-violet-400",
  compile_fix: "bg-orange-500/20 text-orange-400",
};

function StatusDot({ status }: { status: string }) {
  if (status === "completed") return <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" role="img" aria-label="Completed" />;
  if (status === "failed") return <span className="inline-block h-2 w-2 rounded-full bg-red-500" role="img" aria-label="Failed" />;
  if (status === "running") return <Loader2 className="h-3 w-3 animate-spin text-blue-400" role="img" aria-label="Running" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" role="img" aria-label="Pending" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(usage: { input: number; output: number } | null): string {
  if (!usage) return "";
  return `${(usage.input + usage.output).toLocaleString()} tk`;
}

interface CollapsibleSectionProps {
  label: string;
  content: string;
  defaultOpen?: boolean;
  /** When true, removes the max-height constraint on the content area */
  expanded?: boolean;
}

function CollapsibleSection({ label, content, defaultOpen = false, expanded = false }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!content) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        {label}
        <span className="text-muted-foreground/70">
          ({content.length.toLocaleString()} chars)
        </span>
      </button>
      {open && (
        <pre className={`mt-1 overflow-auto rounded bg-muted/30 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words ${expanded ? "" : "max-h-60"}`}>
          {content}
        </pre>
      )}
    </div>
  );
}

interface AgentUsage {
  agentName: string;
  role: string;
  input: number;
  output: number;
  total: number;
  durationMs: number;
}

function aggregateUsage(steps: PipelineStepResult[]): AgentUsage[] {
  const map = new Map<string, AgentUsage>();

  for (const step of steps) {
    if (!step.tokenUsage && step.durationMs === 0) continue;

    const key = step.agentName;
    const existing = map.get(key);
    const input = step.tokenUsage?.input ?? 0;
    const output = step.tokenUsage?.output ?? 0;

    if (existing) {
      existing.input += input;
      existing.output += output;
      existing.total += input + output;
      existing.durationMs += step.durationMs;
      // Keep the most "important" role for display
      if (step.role === "generate" || step.role === "rewrite") {
        existing.role = step.role;
      }
    } else {
      map.set(key, {
        agentName: key,
        role: step.role,
        input,
        output,
        total: input + output,
        durationMs: step.durationMs,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function UsageSummary({ steps }: { steps: PipelineStepResult[] }) {
  const [open, setOpen] = useState(false);
  const agents = aggregateUsage(steps);
  const grandTotal = agents.reduce((s, a) => s + a.total, 0);
  const totalDuration = steps.reduce((s, st) => s + st.durationMs, 0);

  if (grandTotal === 0 && totalDuration === 0) return null;

  return (
    <div className="border-t border-border/50">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-accent/20"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" /> : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
          <span className="font-mono text-[10px] font-semibold text-muted-foreground">
            Usage Summary
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>{grandTotal.toLocaleString()} tokens</span>
          <span>{formatDuration(totalDuration)}</span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-2">
          <table className="w-full font-mono text-[10px]">
            <thead>
              <tr className="text-muted-foreground/60">
                <th className="pb-1 text-left font-medium" scope="col">Agent</th>
                <th className="pb-1 text-right font-medium" scope="col">Input</th>
                <th className="pb-1 text-right font-medium" scope="col">Output</th>
                <th className="pb-1 text-right font-medium" scope="col">Total</th>
                <th className="pb-1 text-right font-medium" scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.agentName} className="text-muted-foreground">
                  <td className="py-0.5 pr-2">
                    <span className="text-foreground">{a.agentName}</span>
                    <Badge
                      variant="outline"
                      className={`ml-1.5 px-1 py-0 text-[10px] ${ROLE_COLORS[a.role] ?? ""}`}
                    >
                      {ROLE_LABELS[a.role] ?? a.role}
                    </Badge>
                  </td>
                  <td className="py-0.5 text-right">{a.input.toLocaleString()}</td>
                  <td className="py-0.5 text-right">{a.output.toLocaleString()}</td>
                  <td className="py-0.5 text-right font-semibold text-foreground">{a.total.toLocaleString()}</td>
                  <td className="py-0.5 text-right">{formatDuration(a.durationMs)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/30 font-semibold text-foreground">
                <td className="pt-1">Total</td>
                <td className="pt-1 text-right">{agents.reduce((s, a) => s + a.input, 0).toLocaleString()}</td>
                <td className="pt-1 text-right">{agents.reduce((s, a) => s + a.output, 0).toLocaleString()}</td>
                <td className="pt-1 text-right">{grandTotal.toLocaleString()}</td>
                <td className="pt-1 text-right">{formatDuration(totalDuration)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function StepEntry({ step, expanded = false }: { step: PipelineStepResult; expanded?: boolean }) {
  return (
    <div className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
      {/* Step header */}
      <div className="flex items-center gap-2">
        <StatusDot status={step.status} />
        <span className="text-xs font-semibold">{step.agentName}</span>
        <Badge
          variant="outline"
          className={`px-1.5 py-0 text-[10px] font-medium ${ROLE_COLORS[step.role] ?? ""}`}
        >
          {ROLE_LABELS[step.role] ?? step.role}
        </Badge>
        {step.durationMs > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {step.tokenUsage && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatTokens(step.tokenUsage)}
          </span>
        )}
        {step.status === "failed" && step.error && (
          <span className="truncate font-mono text-[10px] text-red-400">
            {step.error.slice(0, 80)}
          </span>
        )}
      </div>

      {/* Step summary */}
      {step.summary && step.status !== "running" && (
        <p className="mt-0.5 pl-4 font-mono text-[10px] italic text-muted-foreground/70">
          {step.summary.length > 200 ? `${step.summary.slice(0, 200)}\u2026` : step.summary}
        </p>
      )}

      {/* Collapsible sections */}
      <div className="pl-4">
        <CollapsibleSection label="System Prompt" content={step.systemPrompt} expanded={expanded} />
        <CollapsibleSection label="User Message" content={step.userMessage} expanded={expanded} />
        <CollapsibleSection
          label="Response"
          content={step.rawResponse}
          defaultOpen={step.role === "summary"}
          expanded={expanded}
        />
      </div>
    </div>
  );
}

interface PipelineConsoleProps {
  steps: PipelineStepResult[];
  isRunning: boolean;
  onClear: () => void;
}

export function PipelineConsole({ steps, isRunning, onClear }: PipelineConsoleProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new steps appear
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [steps.length]);

  if (steps.length === 0 && !isRunning) return null;

  const headerBadge = isRunning ? (
    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      Running
    </Badge>
  ) : steps.length > 0 ? (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
      {steps.filter((s) => s.status === "completed").length}/{steps.length} steps
    </Badge>
  ) : null;

  const stepsContent = steps.length === 0 && isRunning ? (
    <div className="flex items-center justify-center py-8 font-mono text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Starting pipeline...
    </div>
  ) : (
    steps.map((step, i) => (
      <StepEntry key={`${step.agentId}-${i}`} step={step} expanded={fullscreen} />
    ))
  );

  return (
    <>
      <Card className="overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b bg-accent/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pipeline Console
            </span>
            {headerBadge}
          </div>
          <div className="flex items-center gap-1">
            {steps.length > 0 && !isRunning && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
                onClick={onClear}
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground"
              onClick={() => setFullscreen(true)}
              aria-label="Expand pipeline console"
            >
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand pipeline console" : "Collapse pipeline console"}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {/* Content */}
        {!collapsed && (
          <>
            <div ref={scrollRef}>
              <ScrollArea className="h-[300px]">
                {stepsContent}
              </ScrollArea>
            </div>
            {!isRunning && steps.length > 0 && <UsageSummary steps={steps} />}
          </>
        )}
      </Card>

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b bg-accent/30 px-4 py-3">
            <div className="flex items-center gap-2 pr-8">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <DialogTitle className="text-sm font-semibold uppercase tracking-wide">
                Pipeline Console
              </DialogTitle>
              {headerBadge}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {stepsContent}
          </div>
          {!isRunning && steps.length > 0 && <UsageSummary steps={steps} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
