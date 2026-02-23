import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { RollbackDialog } from "./rollback-dialog";
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

  function handleSelectVersion(snapshot: Snapshot) {
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
            className="h-6 px-2 font-mono text-[10px]"
            disabled={!hasSnapshots}
            title="Version history"
          >
            <History className="mr-1 h-3 w-3" />
            Versions
            {hasSnapshots && (
              <Badge variant="secondary" className="ml-1 px-1 py-0 font-mono text-[8px]">
                {snapshots.length}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {snapshots?.map((snapshot) => (
            <DropdownMenuItem
              key={snapshot.id}
              className="flex items-center justify-between gap-2"
              onClick={() => handleSelectVersion(snapshot)}
            >
              <div className="flex items-center gap-1.5">
                <RotateCcw className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px]">
                  v{snapshot.version_number}
                </span>
                <Badge variant="outline" className="px-1 py-0 font-mono text-[8px]">
                  {snapshot.trigger}
                </Badge>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">
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
    </>
  );
}
