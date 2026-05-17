import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useIssueRevision,
  isIssueError,
  type IssueError,
} from "@/hooks/use-issue-quote";

interface IssueConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revId: string;
  quoteNumber: string;
  revNumber: number;
  customerName: string;
  total: number;
}

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function IssueConfirmDialog({
  open,
  onOpenChange,
  revId,
  quoteNumber,
  revNumber,
  customerName,
  total,
}: IssueConfirmDialogProps) {
  const issue = useIssueRevision();
  const navigate = useNavigate();
  const [issueError, setIssueError] = useState<IssueError | null>(null);

  function reset() {
    setIssueError(null);
    issue.reset();
  }

  function confirm() {
    setIssueError(null);
    issue.mutate(
      { revId },
      {
        onSuccess: () => {
          onOpenChange(false);
          navigate(`/quotes/${revId}/view`);
        },
        onError: (err: unknown) => {
          if (isIssueError(err)) {
            setIssueError(err);
            return;
          }
          setIssueError({
            kind: "db",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">
            Issue {quoteNumber} Rev {revNumber}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs text-zinc-400">
            Once issued, this revision is read-only. A snapshot of the current
            content is stored and a PDF rendered to Storage. Any prior issued
            revision on this quote will be marked superseded.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs font-mono">
          <dt className="text-zinc-500 uppercase tracking-wider">Customer</dt>
          <dd className="text-zinc-100">{customerName}</dd>
          <dt className="text-zinc-500 uppercase tracking-wider">Quote</dt>
          <dd className="text-zinc-100">
            {quoteNumber} · Rev {revNumber}
          </dd>
          <dt className="text-zinc-500 uppercase tracking-wider">Total</dt>
          <dd className="text-zinc-100">{aud.format(total)}</dd>
        </dl>

        {issueError?.kind === "validation" && (
          <div
            role="alert"
            className="rounded border border-red-900 bg-red-950/40 p-3 text-xs font-mono text-red-300 space-y-1"
          >
            <div className="font-semibold text-red-200">
              Cannot issue — fix these first:
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {issueError.errors.map((e, i) => (
                <li key={`${e.field}-${i}`}>
                  <span className="text-red-400">{e.field}:</span> {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {issueError?.kind === "render" && (
          <div
            role="alert"
            className="rounded border border-red-900 bg-red-950/40 p-3 text-xs font-mono text-red-300 whitespace-pre-wrap"
          >
            PDF render failed: {issueError.message}
          </div>
        )}
        {issueError?.kind === "db" && (
          <div
            role="alert"
            className="rounded border border-red-900 bg-red-950/40 p-3 text-xs font-mono text-red-300 whitespace-pre-wrap"
          >
            Database error: {issueError.message}
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={issue.isPending}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={issue.isPending}
            className="text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
          >
            {issue.isPending ? "Issuing…" : "Issue"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
