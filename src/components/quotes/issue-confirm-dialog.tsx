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
import { useIssueVariation } from "@/hooks/use-issue-variation";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  total: number;
}

interface RevProps extends BaseProps {
  mode?: "rev";
  revId: string;
  quoteNumber: string;
  revNumber: number;
}

interface VariationProps extends BaseProps {
  mode: "variation";
  variationId: string;
  projectId: string;
  jobCode: string;
  variationNumber: number;
}

type IssueConfirmDialogProps = RevProps | VariationProps;

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function IssueConfirmDialog(props: IssueConfirmDialogProps) {
  const navigate = useNavigate();
  const issueRev = useIssueRevision();
  const issueVar = useIssueVariation();
  const [issueError, setIssueError] = useState<IssueError | null>(null);

  const isVariation = props.mode === "variation";
  const pending = isVariation ? issueVar.isPending : issueRev.isPending;

  function reset() {
    setIssueError(null);
    if (isVariation) issueVar.reset();
    else issueRev.reset();
  }

  function confirm() {
    setIssueError(null);

    const onSuccess = () => {
      props.onOpenChange(false);
      if (isVariation) {
        navigate(`/variations/${props.variationId}/view`);
      } else {
        navigate(`/quotes/${props.revId}/view`);
      }
    };

    const onError = (err: unknown) => {
      if (isIssueError(err)) {
        setIssueError(err);
        return;
      }
      setIssueError({
        kind: "db",
        message: err instanceof Error ? err.message : String(err),
      });
    };

    if (isVariation) {
      issueVar.mutate(
        { variationId: props.variationId },
        { onSuccess, onError },
      );
    } else {
      issueRev.mutate({ revId: props.revId }, { onSuccess, onError });
    }
  }

  const title = isVariation
    ? `Issue Variation V${props.variationNumber}`
    : `Issue ${props.quoteNumber} Rev ${props.revNumber}`;
  const description = isVariation
    ? "Once issued, this variation is read-only. A snapshot of the current content is stored and a PDF rendered to Storage."
    : "Once issued, this revision is read-only. A snapshot of the current content is stored and a PDF rendered to Storage. Any prior issued revision on this quote will be marked superseded.";
  const docLabel = isVariation
    ? `${props.jobCode} · V${props.variationNumber}`
    : `${props.quoteNumber} · Rev ${props.revNumber}`;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) reset();
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{title}</DialogTitle>
          <DialogDescription className="font-mono text-xs text-zinc-400">
            {description}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs font-mono">
          <dt className="text-zinc-500 uppercase tracking-wider">Customer</dt>
          <dd className="text-zinc-100">{props.customerName}</dd>
          <dt className="text-zinc-500 uppercase tracking-wider">
            {isVariation ? "Variation" : "Quote"}
          </dt>
          <dd className="text-zinc-100">{docLabel}</dd>
          <dt className="text-zinc-500 uppercase tracking-wider">Total</dt>
          <dd className="text-zinc-100">{aud.format(props.total)}</dd>
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
            onClick={() => props.onOpenChange(false)}
            disabled={pending}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
          >
            {pending ? "Issuing…" : "Issue"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
