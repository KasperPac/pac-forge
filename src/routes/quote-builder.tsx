import { useMemo, type ComponentType } from "react";
import { useParams, Link } from "react-router";
import { useQuoteRevision, useQuote } from "@/hooks/use-quotes";
import { useProject } from "@/hooks/use-projects";
import { useCustomer } from "@/hooks/use-customers";
import {
  scopeItems,
  inclusions,
  exclusions,
  assumptions,
  lineItems,
  useCommercialTerms,
  type ParentRef,
} from "@/hooks/use-doc-content";
import { useQuoteBuilderStore } from "@/stores/quote-builder-store";
import { buildSnapshot } from "@/lib/quote-snapshot";
import { grandTotal } from "@/lib/quote-totals";
import { BuilderLayout } from "@/components/quotes/builder/builder-layout";
import { SectionScope } from "@/components/quotes/builder/section-scope";
import { SectionInclusions } from "@/components/quotes/builder/section-inclusions";
import { SectionExclusions } from "@/components/quotes/builder/section-exclusions";
import { SectionAssumptions } from "@/components/quotes/builder/section-assumptions";
import { SectionLineItems } from "@/components/quotes/builder/section-line-items";
import { SectionCommercial } from "@/components/quotes/builder/section-commercial";
import { SectionTnc } from "@/components/quotes/builder/section-tnc";
import type { BuilderSection } from "@/stores/quote-builder-store";

const SECTION_EDITORS: Record<BuilderSection, ComponentType> = {
  scope: SectionScope,
  inclusions: SectionInclusions,
  exclusions: SectionExclusions,
  assumptions: SectionAssumptions,
  "line-items": SectionLineItems,
  commercial: SectionCommercial,
  tnc: SectionTnc,
};

export default function QuoteBuilderRoute() {
  const { revId } = useParams<{ revId: string }>();
  const ref: ParentRef | undefined = revId
    ? { parent_type: "quote_revision", parent_id: revId }
    : undefined;

  const { data: rev, isLoading: revLoading, error: revError } =
    useQuoteRevision(revId);
  const { data: quote } = useQuote(rev?.quote_id);
  const { data: project } = useProject(quote?.project_id);
  const { data: customer } = useCustomer(project?.customer_id ?? undefined);

  const { data: scope = [] } = scopeItems.useList(ref);
  const { data: incs = [] } = inclusions.useList(ref);
  const { data: excs = [] } = exclusions.useList(ref);
  const { data: asms = [] } = assumptions.useList(ref);
  const { data: lis = [] } = lineItems.useList(ref);
  const { data: commercial = null } = useCommercialTerms(ref);

  const activeSection = useQuoteBuilderStore((s) => s.activeSection);
  const Editor = SECTION_EDITORS[activeSection];

  const snapshot = useMemo(() => {
    if (!rev || !quote || !project || !customer) return null;
    return buildSnapshot({
      rev,
      quote,
      project,
      customer,
      issued_by_email: null,
      issued_at: new Date().toISOString(),
      scope,
      inclusions: incs,
      exclusions: excs,
      assumptions: asms,
      line_items: lis,
      commercial,
      tnc: null,
    });
  }, [
    rev,
    quote,
    project,
    customer,
    scope,
    incs,
    excs,
    asms,
    lis,
    commercial,
  ]);

  const total = grandTotal(lis);

  const header =
    quote && project ? (
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-xs font-mono text-zinc-500 uppercase tracking-wide">
            Quote
          </div>
          <div className="font-mono text-sm text-zinc-100">
            {quote.number} · Rev {rev?.rev_number ?? "—"}
          </div>
        </div>
        <div className="text-xs font-mono text-zinc-400">
          {project.project_name ?? project.job_code ?? "Project"}
          {customer ? ` · ${customer.name}` : ""}
        </div>
      </div>
    ) : null;

  if (!revId) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Missing revision id.
      </div>
    );
  }

  if (revError) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Failed to load revision: {String(revError)}
      </div>
    );
  }

  if (revLoading || !rev) {
    return (
      <div className="p-6 text-sm font-mono text-zinc-500">
        Loading revision…
      </div>
    );
  }

  if (rev.status !== "draft") {
    return (
      <div className="p-6 text-sm font-mono text-zinc-400 space-y-3">
        <p>This revision is {rev.status} and cannot be edited.</p>
        <p className="text-xs">
          <Link
            to={`/quotes/${revId}`}
            className="text-[#3050A0] hover:underline"
          >
            Open read-only view →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <BuilderLayout
      editor={<Editor />}
      snapshot={snapshot}
      total={total}
      header={header}
      status={`Draft · last edited ${
        rev.updated_at ? new Date(rev.updated_at).toLocaleString() : "—"
      }`}
    />
  );
}
