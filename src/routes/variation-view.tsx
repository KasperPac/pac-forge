import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useVariation } from "@/hooks/use-variations";
import { useProject } from "@/hooks/use-projects";
import { useCustomer } from "@/hooks/use-customers";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type {
  QuoteSnapshotV1,
  SnapshotAssumption,
  SnapshotCategoryAggregate,
  SnapshotCitation,
  SnapshotClause,
  SnapshotLineItem,
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

type CitationSection = SnapshotCitation["target_section"];

function citationFor(
  citations: SnapshotCitation[] | undefined,
  section: CitationSection,
  id: string | undefined,
): SnapshotCitation | undefined {
  if (!citations || !id) return undefined;
  return citations.find(
    (c) => c.target_section === section && c.target_doc_id === id,
  );
}

export default function VariationViewRoute() {
  const { variationId } = useParams<{ variationId: string }>();
  const navigate = useNavigate();

  const { data: variation, isLoading, error } = useVariation(variationId);
  const { data: project } = useProject(variation?.project_id);
  const { data: customer } = useCustomer(project?.customer_id ?? undefined);

  const pdfKey = variation?.pdf_storage_key ?? null;
  const { data: pdfUrl, error: pdfQueryError } = useQuery({
    queryKey: ["variation-pdf-signed-url", pdfKey],
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

  if (!variationId) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Missing variation id.
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Failed to load variation: {String(error)}
      </div>
    );
  }
  if (isLoading || !variation) {
    return (
      <div className="p-6 text-sm font-mono text-zinc-500">
        Loading variation…
      </div>
    );
  }

  const snapshot = isSnapshotV1(variation.snapshot_json)
    ? variation.snapshot_json
    : null;
  const issuedAt = variation.issued_at ? new Date(variation.issued_at) : null;

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
                Variation
              </div>
              <div className="font-mono text-sm text-zinc-100">
                V{variation.variation_number}
                {project?.project_number ? ` · ${project.project_number}` : ""}
              </div>
            </div>
            <span
              className={cn(
                "ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
                variation.status === "issued"
                  ? "bg-[#3050A0]/30 text-[#94AEDF] border border-[#3050A0]"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700",
              )}
            >
              {variation.status}
            </span>
          </div>
          <div className="text-xs font-mono text-zinc-400">
            {project?.project_name ?? project?.project_number ?? "Project"}
            {customer ? ` · ${customer.name}` : ""}
          </div>
        </div>
        <div className="mt-2 text-[11px] font-mono text-zinc-500">
          {variation.status === "issued"
            ? `Issued V${variation.variation_number}${
                issuedAt ? ` on ${issuedAt.toLocaleString()}` : ""
              }. Read-only.`
            : `This variation is ${variation.status}. Read-only.`}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_520px] min-h-0">
        <main className="overflow-y-auto p-6 bg-zinc-950">
          {snapshot ? (
            <VariationSnapshotProjection snapshot={snapshot} />
          ) : (
            <div className="p-4 text-sm font-mono text-amber-400">
              No snapshot recorded — this variation was issued before the
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
              title="Issued variation PDF"
              className="flex-1 w-full bg-white"
            />
          ) : variation.pdf_storage_key ? (
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
    </div>
  );
}

function AmendsCallout({ c }: { c: SnapshotCitation }) {
  return (
    <div className="rounded border-l-4 border-[#3050A0] bg-[#3050A0]/10 p-3 mb-2 space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#94AEDF]">
        Amends {c.source_label}
      </div>
      <div className="text-xs font-mono text-zinc-400 whitespace-pre-wrap">
        <span className="text-zinc-500 mr-2 uppercase tracking-wider text-[10px]">
          Original
        </span>
        {c.original_text_verbatim}
      </div>
    </div>
  );
}

function VariationSnapshotProjection({
  snapshot,
}: {
  snapshot: QuoteSnapshotV1;
}) {
  const citations = snapshot.citations ?? [];
  return (
    <div className="space-y-6 max-w-3xl text-sm">
      <header>
        <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
          Variation V{snapshot.rev_number}
        </div>
        <h1 className="text-2xl font-semibold text-zinc-100 mt-1">
          {snapshot.project.project_name}
        </h1>
        <div className="font-mono text-xs text-zinc-400 mt-1">
          {snapshot.project.project_number ?? snapshot.project.job_code ?? ""} · {snapshot.project.customer.name}
        </div>
      </header>

      <ScopeRoSection
        title="Scope of Work"
        section="scope"
        items={snapshot.scope}
        citations={citations}
      />
      <ScopeRoSection
        title="Inclusions"
        section="inclusion"
        items={snapshot.inclusions}
        citations={citations}
      />
      <ScopeRoSection
        title="Exclusions"
        section="exclusion"
        items={snapshot.exclusions}
        citations={citations}
      />

      {snapshot.assumptions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">
            Assumptions
          </h2>
          <ul className="space-y-1.5">
            {snapshot.assumptions.map((a: SnapshotAssumption, i) => {
              const c = citationFor(citations, "assumption", a.id);
              return (
                <li
                  key={`${a.assumption_key ?? "free"}-${i}`}
                  className="text-zinc-300"
                >
                  {c && <AmendsCallout c={c} />}
                  <span className="font-semibold text-zinc-100">
                    {a.title ?? "Assumption"}
                  </span>
                  {a.value ? (
                    <span className="text-zinc-400"> — {a.value}</span>
                  ) : null}
                  {a.notes ? (
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {a.notes}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {snapshot.line_items.some((li) => li.show_in_customer_doc) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">
            Pricing — Line items
          </h2>
          <ul className="space-y-1.5">
            {snapshot.line_items
              .filter((li: SnapshotLineItem) => li.show_in_customer_doc)
              .map((li, i) => {
                const c = citationFor(citations, "line_item", li.id);
                return (
                  <li
                    key={`li-${i}`}
                    className="text-zinc-300 text-xs font-mono"
                  >
                    {c && <AmendsCallout c={c} />}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-zinc-100">
                        {li.customer_doc_label ?? li.description}
                      </span>
                      <span className="text-zinc-100">
                        {li.subtotal != null
                          ? aud.format(li.subtotal)
                          : "—"}
                      </span>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">
          Totals
        </h2>
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
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">
            Commercial Terms
          </h2>
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
          <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">
            Terms &amp; Conditions
          </h2>
          {snapshot.tnc.kind === "structured" ? (
            <ul className="space-y-2">
              {snapshot.tnc.clauses.map((c: SnapshotClause, i) => (
                <li
                  key={`${c.clause_number}-${i}`}
                  className="text-xs font-mono"
                >
                  <div className="font-semibold text-zinc-100">
                    <span className="text-[#3050A0] mr-2">
                      {c.clause_number}
                    </span>
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

function ScopeRoSection({
  title,
  section,
  items,
  citations,
}: {
  title: string;
  section: CitationSection;
  items: SnapshotScopeItem[];
  citations: SnapshotCitation[];
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-100 border-b border-zinc-800 pb-1">
        {title}
      </h2>
      <ul className="space-y-1.5">
        {items.map((s, i) => {
          const c = citationFor(citations, section, s.id);
          return (
            <li key={`${title}-${i}`} className="text-zinc-300">
              {c && <AmendsCallout c={c} />}
              <div className="font-semibold text-zinc-100">{s.title}</div>
              {s.body ? (
                <div className="text-xs text-zinc-500 mt-0.5 whitespace-pre-wrap">
                  {s.body}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
