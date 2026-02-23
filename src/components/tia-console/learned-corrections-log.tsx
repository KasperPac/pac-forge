import { useState } from "react";
import {
  GraduationCap,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActivePatterns, useDeletePattern } from "@/hooks/use-patterns";
import type { PatternCandidate } from "@/types";

const TYPE_COLORS: Record<string, string> = {
  NAMING: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  IO_MAPPING: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  STATE_LOGIC: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  ALARM: "bg-red-500/10 text-red-400 border-red-500/30",
  SAFETY: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  TIMING: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
};

export function LearnedCorrectionsLog() {
  const { data: patterns, isLoading } = useActivePatterns("SIEMENS_TIA");
  const [expanded, setExpanded] = useState(true);

  const count = patterns?.length ?? 0;

  return (
    <div style={{ maxWidth: "100%", overflow: "hidden" }}>
      <button
        className="mb-2 flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <GraduationCap className="h-3.5 w-3.5 text-amber-400" />
        <span className="font-mono text-sm text-muted-foreground">
          LEARNED CORRECTIONS
        </span>
        <Badge variant="outline" className="font-mono text-xs">
          {count}
        </Badge>
      </button>

      {expanded && (
        <Card style={{ maxWidth: "100%", overflow: "hidden" }}>
          {isLoading && (
            <div className="flex items-center gap-2 p-3 font-mono text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          )}

          {!isLoading && count === 0 && (
            <div className="p-3 font-mono text-xs text-muted-foreground">
              No corrections learned yet. Use &quot;Teach the AI&quot; or
              &quot;Remember this fix&quot; after a compile fix.
            </div>
          )}

          {!isLoading && count > 0 && (
            <div className="divide-y" style={{ overflow: "hidden" }}>
              {patterns!.map((pattern) => (
                <CorrectionRow key={pattern.id} pattern={pattern} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function CorrectionRow({ pattern }: { pattern: PatternCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const deletePattern = useDeletePattern();
  const typeClass = TYPE_COLORS[pattern.correction_type] ?? "";
  const hasSnippets = pattern.original_snippet || pattern.corrected_snippet;
  const date = new Date(pattern.created_at);
  const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const isAutoFix = pattern.context?.startsWith("compile-fix");

  return (
    <div style={{ overflow: "hidden" }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ overflow: "hidden" }}>
        {/* Expand toggle */}
        {hasSnippets ? (
          <button
            className="shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="w-2.5" />
        )}

        {/* Type badge */}
        <Badge variant="outline" className={`shrink-0 font-mono text-xs ${typeClass}`}>
          {pattern.correction_type}
        </Badge>

        {/* Source badge */}
        <Badge
          variant="outline"
          className={`shrink-0 font-mono text-xs ${
            isAutoFix
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}
        >
          {isAutoFix ? "auto" : "manual"}
        </Badge>

        {/* Explanation — w-0 forces flex to compute width from available space */}
        <span
          className="w-0 flex-1 truncate text-left font-mono text-xs text-foreground/80"
          title={pattern.explanation_tag}
          onClick={() => hasSnippets && setExpanded(!expanded)}
          role="button"
          tabIndex={0}
        >
          {pattern.explanation_tag}
        </span>

        {/* Date */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {dateStr}
        </span>

        {/* Delete */}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-red-400"
          onClick={() => deletePattern.mutate(pattern.id)}
          disabled={deletePattern.isPending}
        >
          {deletePattern.isPending ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <X className="h-2.5 w-2.5" />
          )}
        </Button>
      </div>

      {/* Expanded detail: before/after snippets */}
      {expanded && hasSnippets && (
        <div className="grid grid-cols-2 gap-px border-t bg-border" style={{ overflow: "hidden" }}>
          <div className="overflow-hidden bg-background p-2">
            <div className="mb-1 font-mono text-xs text-muted-foreground">BEFORE</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-red-500/5 p-1.5 font-mono text-xs text-red-300">
              {pattern.original_snippet || "(none)"}
            </pre>
          </div>
          <div className="overflow-hidden bg-background p-2">
            <div className="mb-1 font-mono text-xs text-muted-foreground">AFTER</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-green-500/5 p-1.5 font-mono text-xs text-green-300">
              {pattern.corrected_snippet || "(none)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
