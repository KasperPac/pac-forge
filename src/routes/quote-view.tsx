import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, ExternalLink, FilePlus, XCircle } from "lucide-react";
import { useQuoteRevision, useQuote, useCloneRevisionAsDraft } from "@/hooks/use-quotes";
import { useProject } from "@/hooks/use-projects";
import { useClient } from "@/hooks/use-clients";
import {
  useAwardQuoteRevision,
  useMarkRevisionLost,
} from "@/hooks/use-award-quote";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type {
  QuoteSnapshotV1,
  SnapshotCategoryAggregate,
  SnapshotClause,
  SnapshotScopeItem,
} from "@/types";

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

function isSnapshotV1(v: unknown): v is QuoteSnapshotV1 {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { schema_version?: unknown }).schema_version === 1
  );
}

export default function QuoteViewRoute() {
  const { revId } = useParams<{ revId: string }>();
  const navigate = useNavigate();

  const { data: rev, isLoading, error } = useQuoteRevision(revId);
  const { data: quote } = useQuote(rev?.quote_id);
  const { data: project } = useProject(quote?.project_id);
  const { data: client } = useClient(project?.client_id ?? undefined);
  const clone = useCloneRevisionAsDraft();
  const award = useAwardQuoteRevision();
  const markLost = useMarkRevisionLost();

  type ConfirmKind = "award" | "lost" | null;
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runConfirm() {
    if (!revId || !confirm) return;
    setActionError(null);
    try {
      if (confirm === "award") {
        await award.mutateAsync(revId);
      } else {
        await markLost.mutateAsync(revId);
      }
      setConfirm(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  // Sign the PDF URL fresh each time the storage key changes; 5-minute TTL.
  // Re-fetch every 4 minutes to keep the iframe alive on long sessions.
  const pdfKey = rev?.pdf_storage_key ?? null;
  const {
    data: pdfUrl,
    error: pdfQueryError,
  } = useQuery({
    queryKey: ["quote-pdf-signed-url", pdfKey],
    enabled: !!pdfKey,
    staleTime: 4 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      if (!pdfKey) return null;
      const { data, error: e } = await supabase.storage
        .from("quote-pdfs")
        .createSignedUrl(pdfKey, 60 * 5);
      if (e) throw e;
      return data?.signedUrl ?? null;
    },
  });
  const pdfErr =
    pdfQueryError instanceof Error ? pdfQueryError.message : null;

  if (!revId) {
    return <div className="p-6 text-sm text-red-400 font-mono">Missing revision id.</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Failed to load revision: {String(error)}
      </div>
    );
  }
  if (isLoading || !rev) {
    return <div className="p-6 text-sm font-mono text-zinc-500">Loading revision…</div>;
  }

  const snapshot = isSnapshotV1(rev.snapshot_json) ? rev.snapshot_json : null;
  const issuedAt = rev.issued_at ? new Date(rev.issued_at) : null;

  async function startNewRevision() {
    if (!revId || !rev) return;
    const newRev = await clone.mutateAsync(revId);
    navigate(`/quotes/${newRev.id}/edit`);
  }

  return (
    <div className="grid grid-rows-[auto_1fr] h-full min-h-0">
      <div className="border-b border-zinc-800 bg-zinc-950 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-200"
              aria-label="Back"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
            <div>
              <div className="text-xs font-mono text-zinc-500 uppercase tracking-wide">
                Quote
              </div>
              <div className="font-mono text-sm text-zinc-100">
                {quote?.number ?? "—"} · Rev {rev.rev_number}
              </div>
            </div>
            <span
              className={cn(
                "ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
                rev.status === "issued"
                  ? "bg-[#3050A0]/30 text-[#94AEDF] border border-[#3050A0]"
                  : rev.status === "superseded"
                    ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700",
              )}
            >
              {rev.status}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs font-mono text-zinc-400">
              {project?.project_name ?? project?.project_number ?? "Project"}
              {client ? ` · ${client.name}` : ""}
            </div>
            {rev.status === "issued" && quote?.status === "issued" && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirm("award")}
                  disabled={award.isPending}
                  className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  <Award className="h-3 w-3" />
                  Mark as Awarded
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm("lost")}
                  disabled={markLost.isPending}
                  className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  <XCircle className="h-3 w-3" />
                  Mark as Lost
                </button>
              </>
            )}
            <button
              type="button"
              onClick={startNewRevision}
              disabled={
                clone.isPending ||
                rev.status !== "issued" ||
                quote?.status === "awarded"
              }
              className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-[#3050A0] text-white hover:bg-[#3F61B0] disabled:opacity-50"
            >
              <FilePlus className="h-3 w-3" />
              {clone.isPending ? "Starting…" : "Start new revision"}
            </button>
          </div>
        </div>
        <div className="mt-2 text-[11px] font-mono text-zinc-500">
          {rev.status === "issued"
            ? `Issued${issuedAt ? ` on ${issuedAt.toLocaleString()}` : ""}. Read-only.`
            : `This revision is ${rev.status}. Read-only.`}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_520px] min-h-0">
        <main className="overflow-y-auto p-6 bg-zinc-950">
          {snapshot ? (
            <SnapshotProjection snapshot={snapshot} />
          ) : (
            <div className="p-4 text-sm font-mono text-amber-400">
              No snapshot recorded — this revision was issued before the
              snapshot field was populated.
            </div>
          )}
        </main>
        <aside className="border-l border-zinc-800 bg-zinc-900 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs font-mono text-zinc-400">PDF</span>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-zinc-300 hover:text-white"
              >
                Open in new tab
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {pdfErr ? (
            <div className="p-4 text-xs font-mono text-red-400" role="alert">
              {pdfErr}
            </div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="Issued quote PDF"
              className="flex-1 w-full bg-white"
            />
          ) : rev.pdf_storage_key ? (
            <div className="flex-1 flex items-center justify-center text-xs font-mono text-zinc-500">
              Loading PDF…
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs font-mono text-zinc-500">
              No PDF on file.
            </div>
          )}
        </aside>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent className="bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">
              {confirm === "award"
                ? "Mark this revision as awarded?"
                : "Mark this revision as lost?"}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-zinc-400">
              {confirm === "award"
                ? "This locks the project to this revision. Other quotes on the project will no longer be issuable."
                : "This marks the parent quote as lost. The revision itself stays issued for the record."}
            </DialogDescription>
          </DialogHeader>

          {actionError && (
            <div
              role="alert"
              className="rounded border border-red-900 bg-red-950/40 p-3 text-xs font-mono text-red-300 whitespace-pre-wrap"
            >
              {actionError}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setConfirm(null);
                setActionError(null);
              }}
              disabled={award.isPending || markLost.isPending}
              className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runConfirm}
              disabled={award.isPending || markLost.isPending}
              className={cn(
                "text-xs font-mono px-3 py-1.5 rounded text-white disabled:opacity-50",
                confirm === "award"
                  ? "bg-emerald-700 hover:bg-emerald-600"
                  : "bg-zinc-700 hover:bg-zinc-600",
              )}
            >
              {confirm === "award"
                ? award.isPending
                  ? "Awarding…"
                  : "Confirm award"
                : markLost.isPending
                  ? "Marking…"
                  : "Confirm lost"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SnapshotProjection({ snapshot }: { snapshot: QuoteSnapshotV1 }) {
  return (
    <div className="space-y-6 max-w-3xl text-sm">
      <header>
        <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
          Quotation
        </div>
        <h1 className="text-2xl font-semibold text-zinc-100 mt-1">
          {snapshot.project.project_name}
        </h1>
        <div className="font-mono text-xs text-zinc-400 mt-1">
          {snapshot.project.project_number ?? snapshot.project.job_code ?? ""} · {snapshot.project.client?.name ?? snapshot.project.customer?.name ?? ""}
        </div>
      </header>

      <RoSection title="Scope of Work" items={snapshot.scope} />
      <RoSection title="Inclusions" items={snapshot.inclusions} />
      <RoSection title="Exclusions" items={snapshot.exclusions} />

      {snapshot.assumptions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">Assumptions</h2>
          <ul className="space-y-1.5">
            {snapshot.assumptions.map((a, i) => (
              <li key={`${a.assumption_key ?? "free"}-${i}`} className="text-zinc-300">
                <span className="font-semibold text-zinc-100">
                  {a.title ?? "Assumption"}
                </span>
                {a.value ? <span className="text-zinc-400"> — {a.value}</span> : null}
                {a.notes ? (
                  <div className="text-xs text-zinc-500 mt-0.5">{a.notes}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">Pricing</h2>
        {snapshot.totals.by_category_customer_visible.length > 0 ? (
          <table className="w-full text-xs font-mono">
            <thead className="text-zinc-500 uppercase tracking-wider">
              <tr>
                <th className="text-left py-1.5">Category</th>
                <th className="text-right py-1.5">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.totals.by_category_customer_visible.map(
                (c: SnapshotCategoryAggregate) => (
                  <tr key={c.category} className="border-t border-zinc-800">
                    <td className="py-1.5 text-zinc-200">{c.category}</td>
                    <td className="py-1.5 text-right text-zinc-100">
                      {aud.format(c.subtotal)}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#3050A0]">
                <td className="py-2 text-zinc-400 uppercase tracking-wider text-[10px]">
                  Grand total (excl. GST)
                </td>
                <td className="py-2 text-right text-zinc-100 font-semibold">
                  {aud.format(snapshot.totals.grand_total)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="font-mono text-xs text-zinc-500">
            Total {aud.format(snapshot.totals.grand_total)}
          </div>
        )}
      </section>

      {snapshot.commercial_terms && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">Commercial Terms</h2>
          <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs font-mono">
            {snapshot.commercial_terms.payment_schedule && (
              <>
                <dt className="text-zinc-500">Payment schedule</dt>
                <dd className="text-zinc-200 whitespace-pre-wrap">
                  {snapshot.commercial_terms.payment_schedule}
                </dd>
              </>
            )}
            {snapshot.commercial_terms.validity_period && (
              <>
                <dt className="text-zinc-500">Validity</dt>
                <dd className="text-zinc-200">
                  {snapshot.commercial_terms.validity_period}
                </dd>
              </>
            )}
            {snapshot.commercial_terms.gst_treatment && (
              <>
                <dt className="text-zinc-500">GST</dt>
                <dd className="text-zinc-200">
                  {snapshot.commercial_terms.gst_treatment}
                </dd>
              </>
            )}
            {snapshot.commercial_terms.currency && (
              <>
                <dt className="text-zinc-500">Currency</dt>
                <dd className="text-zinc-200">
                  {snapshot.commercial_terms.currency}
                </dd>
              </>
            )}
            {snapshot.commercial_terms.notes && (
              <>
                <dt className="text-zinc-500">Notes</dt>
                <dd className="text-zinc-200 whitespace-pre-wrap">
                  {snapshot.commercial_terms.notes}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {snapshot.tnc && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">Terms &amp; Conditions</h2>
          {snapshot.tnc.kind === "structured" ? (
            <ul className="space-y-2">
              {snapshot.tnc.clauses.map((c: SnapshotClause, i) => (
                <li
                  key={`${c.clause_number}-${i}`}
                  className="text-xs font-mono"
                >
                  <div className="font-semibold text-zinc-100">
                    <span className="text-[#3050A0] mr-2">{c.clause_number}</span>
                    {c.title}
                  </div>
                  <p className="text-zinc-400 mt-0.5 whitespace-pre-wrap">
                    {c.body_markdown}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs font-mono text-zinc-300 whitespace-pre-wrap">
              {snapshot.tnc.body_markdown}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function RoSection({
  title,
  items,
}: {
  title: string;
  items: SnapshotScopeItem[];
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">{title}</h2>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={`${title}-${i}`} className="text-zinc-300">
            <div className="font-semibold text-zinc-100">{s.title}</div>
            {s.body ? (
              <div className="text-xs text-zinc-500 mt-0.5 whitespace-pre-wrap">
                {s.body}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
