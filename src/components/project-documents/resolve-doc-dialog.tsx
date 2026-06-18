import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ResolveContext {
  filename: string;
  fromPath: string;        // Dropbox API path of the file
  apiFolderPath: string;   // Dropbox API path of the containing folder
  suggestedName: string;   // assign-number suggestion
  relPath: string;         // project-relative path for the override row
}

export function ResolveDocDialog({
  ctx,
  open,
  onOpenChange,
  onAssignNumber,
  onMarkCustomer,
  busy,
}: {
  ctx: ResolveContext | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAssignNumber: (ctx: ResolveContext) => void;
  onMarkCustomer: (ctx: ResolveContext, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  if (!ctx) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Resolve document</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 font-mono text-xs">
          <p className="text-muted-foreground">{ctx.filename}</p>
          <div className="rounded-md border border-border p-2">
            <div className="text-muted-foreground">Assign Pac number →</div>
            <div className="text-foreground">{ctx.suggestedName}</div>
          </div>
          <input
            className="w-full rounded-sm border border-border bg-background px-2 py-1"
            placeholder="Note (optional, for customer-supplied)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onMarkCustomer(ctx, note)}
          >
            Mark customer-supplied
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onAssignNumber(ctx)}>
            Assign Pac number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
