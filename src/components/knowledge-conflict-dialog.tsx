import { useState } from "react";
import { AlertTriangle, CheckCircle2, Shield, Lightbulb } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_SOURCES } from "@/lib/knowledge-priority";
import type { KnowledgeConflict } from "@/lib/conflict-detector";
import type { KnowledgeSource } from "@/lib/knowledge-priority";

interface KnowledgeConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: KnowledgeConflict[];
  onResolve: (conflictId: string, winner: KnowledgeSource, scope: "instance" | "permanent", reason?: string) => void;
  onDismiss: (conflictId: string, reason: string) => void;
  onConfirm?: (conflictId: string, reason: string) => void;
  getResolution: (conflictId: string) => KnowledgeSource | null;
}

export function KnowledgeConflictDialog({
  open,
  onOpenChange,
  conflicts,
  onResolve,
  onDismiss,
  onConfirm,
  getResolution,
}: KnowledgeConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Knowledge Conflicts
          </DialogTitle>
          <DialogDescription>
            Contradictory guidance detected. Resolve, dismiss, or confirm each conflict.
            Your feedback teaches the Pattern Librarian.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-3">
            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                resolution={getResolution(conflict.id)}
                onResolve={onResolve}
                onDismiss={onDismiss}
                onConfirm={onConfirm}
              />
            ))}
            {conflicts.length === 0 && (
              <div className="flex items-center gap-2 py-8 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-green-400" />
                <span className="font-mono text-sm text-muted-foreground">
                  No conflicts detected.
                </span>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ConflictCard({
  conflict,
  resolution,
  onResolve,
  onDismiss,
  onConfirm,
}: {
  conflict: KnowledgeConflict;
  resolution: KnowledgeSource | null;
  onResolve: (conflictId: string, winner: KnowledgeSource, scope: "instance" | "permanent") => void;
  onDismiss: (conflictId: string, reason: string) => void;
  onConfirm?: (conflictId: string, reason: string) => void;
}) {
  const [scope, setScope] = useState<"instance" | "permanent">("instance");
  const [feedbackMode, setFeedbackMode] = useState<"none" | "dismiss" | "confirm">("none");
  const [feedbackReason, setFeedbackReason] = useState("");
  const isResolved = resolution !== null;

  const severityColor = conflict.severity === "error"
    ? "border-red-500/30 bg-red-500/5"
    : "border-amber-500/30 bg-amber-500/5";

  const severityBadge = conflict.severity === "error"
    ? <Badge variant="outline" className="border-red-500/30 font-mono text-xs text-red-400">Contradiction</Badge>
    : <Badge variant="outline" className="border-amber-500/30 font-mono text-xs text-amber-400">Potential Conflict</Badge>;

  // Confidence color
  const confidencePct = Math.round(conflict.confidence * 100);
  const confidenceBarColor = conflict.confidence >= 0.8
    ? "bg-red-500"
    : conflict.confidence >= 0.65
      ? "bg-amber-500"
      : "bg-yellow-500/50";

  function handleDismissSubmit() {
    if (!feedbackReason.trim()) return;
    onDismiss(conflict.id, feedbackReason.trim());
    setFeedbackMode("none");
    setFeedbackReason("");
  }

  function handleConfirmSubmit() {
    if (!feedbackReason.trim() || !onConfirm) return;
    onConfirm(conflict.id, feedbackReason.trim());
    setFeedbackMode("none");
    setFeedbackReason("");
  }

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${isResolved ? "border-border/50 bg-muted/10 opacity-60" : severityColor}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        {isResolved ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <AlertTriangle className={`h-3.5 w-3.5 ${conflict.severity === "error" ? "text-red-400" : "text-amber-400"}`} />
        )}
        <Badge variant="outline" className="font-mono text-xs">
          {conflict.category}
        </Badge>
        {severityBadge}
        <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
          {confidencePct}%
        </Badge>
        {isResolved && (
          <Badge variant="outline" className="border-green-500/30 font-mono text-xs text-green-400">
            Resolved
          </Badge>
        )}
      </div>

      {/* Confidence bar */}
      <div className="h-1 rounded-full bg-muted">
        <div
          className={`h-1 rounded-full transition-all ${confidenceBarColor}`}
          style={{ width: `${confidencePct}%` }}
        />
      </div>

      {/* Description */}
      <p className="font-mono text-xs text-muted-foreground">{conflict.description}</p>

      {/* Source comparison */}
      <div className="grid grid-cols-2 gap-2">
        <SourceCard
          source={conflict.sourceA}
          isWinner={resolution === conflict.sourceA.type}
        />
        <SourceCard
          source={conflict.sourceB}
          isWinner={resolution === conflict.sourceB.type}
        />
      </div>

      {/* Resolution controls */}
      {!isResolved && feedbackMode === "none" && (
        <div className="space-y-2 rounded border border-border/50 bg-muted/20 p-2">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">Resolution scope</span>
          </div>

          <RadioGroup value={scope} onValueChange={(v) => setScope(v as "instance" | "permanent")}>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="instance" id={`${conflict.id}-instance`} className="h-3 w-3" />
              <Label htmlFor={`${conflict.id}-instance`} className="font-mono text-xs">
                This generation only
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="permanent" id={`${conflict.id}-permanent`} className="h-3 w-3" />
              <Label htmlFor={`${conflict.id}-permanent`} className="font-mono text-xs">
                Always (permanent rule)
              </Label>
            </div>
          </RadioGroup>

          <div className="flex gap-1.5 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 flex-1 font-mono text-xs"
              onClick={() => onResolve(conflict.id, conflict.sourceA.type, scope)}
            >
              Use {KNOWLEDGE_SOURCES[conflict.sourceA.type].label}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 flex-1 font-mono text-xs"
              onClick={() => onResolve(conflict.id, conflict.sourceB.type, scope)}
            >
              Use {KNOWLEDGE_SOURCES[conflict.sourceB.type].label}
            </Button>
          </div>

          <div className="flex items-center gap-3 border-t border-border/50 pt-2">
            <button
              className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setFeedbackMode("dismiss")}
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              Not a conflict
            </button>
            {onConfirm && (
              <button
                className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setFeedbackMode("confirm")}
              >
                <Lightbulb className="h-2.5 w-2.5" />
                Confirm with feedback
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dismiss feedback form */}
      {!isResolved && feedbackMode === "dismiss" && (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="flex items-center gap-1.5">
            <Lightbulb className="h-3 w-3 text-amber-400" />
            <span className="font-mono text-xs text-amber-300">
              Why is this not a conflict? (Teaches Pattern Librarian)
            </span>
          </div>
          <Textarea
            className="min-h-[60px] font-mono text-xs"
            placeholder="e.g., These rules apply to different contexts — one is for motors, the other is for valves..."
            value={feedbackReason}
            onChange={(e) => setFeedbackReason(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 font-mono text-xs"
              disabled={!feedbackReason.trim()}
              onClick={handleDismissSubmit}
            >
              Dismiss & Teach
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 font-mono text-xs"
              onClick={() => { setFeedbackMode("none"); setFeedbackReason(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Confirm feedback form */}
      {!isResolved && feedbackMode === "confirm" && onConfirm && (
        <div className="space-y-2 rounded border border-green-500/30 bg-green-500/5 p-2">
          <div className="flex items-center gap-1.5">
            <Lightbulb className="h-3 w-3 text-green-400" />
            <span className="font-mono text-xs text-green-300">
              Why is this a real conflict? (Teaches Pattern Librarian)
            </span>
          </div>
          <Textarea
            className="min-h-[60px] font-mono text-xs"
            placeholder="e.g., Both rules apply to the same block type and they contradict each other on naming..."
            value={feedbackReason}
            onChange={(e) => setFeedbackReason(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 font-mono text-xs"
              disabled={!feedbackReason.trim()}
              onClick={handleConfirmSubmit}
            >
              Confirm & Teach
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 font-mono text-xs"
              onClick={() => { setFeedbackMode("none"); setFeedbackReason(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  isWinner,
}: {
  source: KnowledgeConflict["sourceA"];
  isWinner: boolean;
}) {
  return (
    <div className={`rounded border p-2 ${isWinner ? "border-green-500/30 bg-green-500/5" : "border-border/50 bg-muted/20"}`}>
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="px-1 py-0 font-mono text-[10px]">
          {KNOWLEDGE_SOURCES[source.type].label}
        </Badge>
        {isWinner && <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />}
      </div>
      <p className="mt-1 font-mono text-xs font-medium">{source.label}</p>
      <p className="mt-0.5 line-clamp-3 font-mono text-xs text-muted-foreground">
        {source.excerpt}
      </p>
    </div>
  );
}
