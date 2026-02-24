import { useState } from "react";
import { History, RotateCcw, GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { RollbackDialog } from "./rollback-dialog";
import { SnapshotDiffDialog } from "./snapshot-diff-dialog";
import { useSnapshots, useRollback } from "@/hooks/use-snapshots";
import type { Snapshot } from "@/types";

interface VersionSelectorProps {
  artifactId: string | null;
  projectId: string;
  onRollback: (content: string) => void;
}

export function VersionSelector({ artifactId, projectId, onRollback }: VersionSelectorProps) {
  const { data: snapshots } = useSnapshots(artifactId);
  const rollback = useRollback();
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [showRollback, setShowRollback] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<Snapshot | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  function handleSelectVersion(snapshot: Snapshot) {
    if (compareMode) {
      if (!compareA) {
        setCompareA(snapshot);
      } else {
        // Second selection — show diff
        setSelectedSnapshot(snapshot);
        setShowDiff(true);
        setCompareMode(false);
      }
      return;
    }
    setSelectedSnapshot(snapshot);
    setShowRollback(true);
  }

  function handleConfirmRollback() {
    if (!selectedSnapshot || !artifactId) return;

    rollback.mutate(
      {
        snapshotId: selectedSnapshot.id,
        artifactId,
        projectId,
      },
      {
        onSuccess: (content) => {
          onRollback(content);
          setShowRollback(false);
          setSelectedSnapshot(null);
        },
      }
    );
  }

  const hasSnapshots = snapshots && snapshots.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 font-mono text-xs"
            disabled={!hasSnapshots}
            title="Version history"
          >
            <History className="mr-1 h-3 w-3" />
            Versions
            {hasSnapshots && (
              <Badge variant="secondary" className="ml-1 px-1 py-0 font-mono text-xs">
                {snapshots.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {(snapshots?.length ?? 0) >= 2 && (
            <>
              <DropdownMenuItem
                className="flex items-center gap-1.5 font-mono text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  setCompareMode(!compareMode);
                  setCompareA(null);
                }}
              >
                <GitCompareArrows className="h-3 w-3" />
                {compareMode ? "Cancel Compare" : "Compare Two Versions"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {compareMode && (
            <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {compareA ? `Select second version (base: v${compareA.version_number})` : "Select first version to compare"}
            </div>
          )}
          {snapshots?.map((snapshot) => (
            <DropdownMenuItem
              key={snapshot.id}
              className="flex items-center justify-between gap-2"
              onClick={() => handleSelectVersion(snapshot)}
            >
              <div className="flex items-center gap-1.5">
                <RotateCcw className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-xs">
                  v{snapshot.version_number}
                </span>
                <Badge variant="outline" className="px-1 py-0 font-mono text-xs">
                  {snapshot.trigger}
                </Badge>
                {compareA?.id === snapshot.id && (
                  <Badge variant="secondary" className="px-1 py-0 font-mono text-xs">
                    base
                  </Badge>
                )}
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(snapshot.created_at).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedSnapshot && (
        <RollbackDialog
          open={showRollback}
          onOpenChange={setShowRollback}
          snapshot={selectedSnapshot}
          onConfirm={handleConfirmRollback}
          isPending={rollback.isPending}
        />
      )}

      {compareA && selectedSnapshot && (
        <SnapshotDiffDialog
          open={showDiff}
          onOpenChange={(open) => {
            setShowDiff(open);
            if (!open) {
              setCompareA(null);
              setSelectedSnapshot(null);
            }
          }}
          snapshotA={compareA}
          snapshotB={selectedSnapshot}
          onRollback={(snapshot) => {
            setShowDiff(false);
            setSelectedSnapshot(snapshot);
            setShowRollback(true);
            setCompareA(null);
          }}
        />
      )}
    </>
  );
}
