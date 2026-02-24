import { Plus, Minus, Equal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { computeDiff } from "@/lib/diff-engine";
import type { DiffResult, DiffHunk } from "@/lib/diff-engine";
import type { Snapshot } from "@/types";

const HUNK_COLORS: Record<string, string> = {
  added: "bg-green-500/10 text-green-400",
  removed: "bg-red-500/10 text-red-400",
  unchanged: "text-muted-foreground",
};

const HUNK_ICONS = {
  added: Plus,
  removed: Minus,
  unchanged: Equal,
};

function DiffView({ diff }: { diff: DiffResult }) {
  return (
    <ScrollArea className="h-72 rounded-md border">
      <div className="p-2">
        {diff.hunks.map((hunk: DiffHunk, hi: number) => (
          <div key={hi}>
            {hunk.lines.map((line, li) => {
              const Icon = HUNK_ICONS[hunk.type];
              return (
                <div
                  key={`${hi}-${li}`}
                  className={cn(
                    "flex items-start gap-1 px-1 font-mono text-xs leading-5",
                    HUNK_COLORS[hunk.type],
                  )}
                >
                  <Icon className="mt-1 h-3 w-3 shrink-0 opacity-50" />
                  <span className="whitespace-pre-wrap break-all">{line}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

interface SnapshotDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshotA: Snapshot;
  snapshotB: Snapshot;
  onRollback?: (snapshot: Snapshot) => void;
}

export function SnapshotDiffDialog({
  open,
  onOpenChange,
  snapshotA,
  snapshotB,
  onRollback,
}: SnapshotDiffDialogProps) {
  // Always show older version on left (A) and newer on right (B)
  const [older, newer] =
    snapshotA.version_number < snapshotB.version_number
      ? [snapshotA, snapshotB]
      : [snapshotB, snapshotA];

  const diff = computeDiff(older.content, newer.content);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Compare Versions
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                v{older.version_number}
              </Badge>
              <span className="text-muted-foreground">{older.trigger}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(older.created_at).toLocaleString()}
              </span>
              <span className="text-muted-foreground">vs</span>
              <Badge variant="outline" className="font-mono text-xs">
                v{newer.version_number}
              </Badge>
              <span className="text-muted-foreground">{newer.trigger}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(newer.created_at).toLocaleString()}
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              +{diff.addedCount} / -{diff.removedCount} lines
            </span>
          </div>
          {diff.hasChanges ? (
            <DiffView diff={diff} />
          ) : (
            <div className="rounded-md border px-4 py-6 text-center font-mono text-xs text-muted-foreground">
              No differences — versions are identical.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {onRollback && (
            <Button
              className="font-mono text-xs"
              onClick={() => {
                onRollback(older);
                onOpenChange(false);
              }}
            >
              Rollback to v{older.version_number}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
