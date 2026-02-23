import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import type { Snapshot } from "@/types";

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
  onConfirm: () => void;
  isPending: boolean;
}

export function RollbackDialog({
  open,
  onOpenChange,
  snapshot,
  onConfirm,
  isPending,
}: RollbackDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-mono text-sm">
            Rollback to Version {snapshot.version_number}?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <div className="text-xs">
              This will restore the approved code to the content from this snapshot.
              A new snapshot will be created to record the rollback.
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Badge variant="outline" className="font-mono text-xs">
                {snapshot.trigger}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(snapshot.created_at).toLocaleString()}
              </span>
            </div>
            <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-2 font-mono text-xs">
              {snapshot.content.slice(0, 500)}
              {snapshot.content.length > 500 ? "\n..." : ""}
            </pre>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="font-mono text-xs"
          >
            {isPending ? "Rolling back..." : "Rollback"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
