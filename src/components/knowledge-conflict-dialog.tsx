import { useState } from "react";
import { AlertTriangle, CheckCircle2, Shield } from "lucide-react";
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
import { KNOWLEDGE_SOURCES } from "@/lib/knowledge-priority";
import type { KnowledgeConflict } from "@/lib/conflict-detector";
import type { KnowledgeSource } from "@/lib/knowledge-priority";

interface KnowledgeConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: KnowledgeConflict[];
  onResolve: (conflictId: string, winner: KnowledgeSource, scope: "instance" | "permanent", reason?: string) => void;
  getResolution: (conflictId: string) => KnowledgeSource | null;
}

export function KnowledgeConflictDialog({
  open,
  onOpenChange,
  conflicts,
  onResolve,
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
            These knowledge sources contain contradictory guidance. Choose which should take priority.
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
}: {
  conflict: KnowledgeConflict;
  resolution: KnowledgeSource | null;
  onResolve: (conflictId: string, winner: KnowledgeSource, scope: "instance" | "permanent") => void;
}) {
  const [scope, setScope] = useState<"instance" | "permanent">("instance");
  const isResolved = resolution !== null;

  const severityColor = conflict.severity === "error"
    ? "border-red-500/30 bg-red-500/5"
    : "border-amber-500/30 bg-amber-500/5";

  const severityBadge = conflict.severity === "error"
    ? <Badge variant="outline" className="border-red-500/30 font-mono text-xs text-red-400">Contradiction</Badge>
    : <Badge variant="outline" className="border-amber-500/30 font-mono text-xs text-amber-400">Potential Conflict</Badge>;

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
        {isResolved && (
          <Badge variant="outline" className="border-green-500/30 font-mono text-xs text-green-400">
            Resolved
          </Badge>
        )}
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
      {!isResolved && (
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
