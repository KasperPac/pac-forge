import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router";
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
import { useTncSelection, useTncOverride } from "@/hooks/use-doc-tnc";
import { useTncTemplate } from "@/hooks/use-tnc-templates";
import { useTncClauses } from "@/hooks/use-tnc-clauses";
import { useQuoteBuilderStore } from "@/stores/quote-builder-store";
import { buildSnapshot, type BuildSnapshotTnc } from "@/lib/quote-snapshot";
import { grandTotal } from "@/lib/quote-totals";
import { validateForIssue } from "@/lib/quote-validation";
import { BuilderLayout } from "@/components/quotes/builder/builder-layout";
import { IssueConfirmDialog } from "@/components/quotes/issue-confirm-dialog";
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
  const navigate = useNavigate();
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
  const { data: tncSelection = null } = useTncSelection(ref);
  const { data: tncOverride = null } = useTncOverride(ref);
  const { data: tncTemplate } = useTncTemplate(
    tncSelection?.template_id ?? undefined,
  );
  const { data: tncClauses = [] } = useTncClauses(
    tncSelection?.template_id ?? undefined,
  );

  const tncForSnap = useMemo<BuildSnapshotTnc>(() => {
    if (tncOverride) return { override: tncOverride };
    if (tncSelection && tncTemplate) {
      return {
        template: tncTemplate,
        clauses: tncClauses,
        selection: tncSelection,
      };
    }
    return null;
  }, [tncOverride, tncSelection, tncTemplate, tncClauses]);

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
      tnc: tncForSnap,
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
    tncForSnap,
  ]);

  const total = grandTotal(lis);

  // Cheap client-side gate for the Issue button. The real authority is the
  // re-validation inside useIssueRevision against fresh DB rows.
  const canIssue = useMemo(() => {
    if (!project) return false;
    return validateForIssue({
      project: {
        customer_id: project.customer_id,
        job_code: project.job_code,
        project_name: project.project_name,
      },
      scope,
      lineItems: lis,
      tncSelection: tncSelection
        ? { template_id: tncSelection.template_id }
        : null,
      tncOverride: tncOverride
        ? { body_markdown: tncOverride.body_markdown }
        : null,
      commercial: commercial
        ? { payment_schedule: commercial.payment_schedule }
        : null,
    }).ok;
  }, [project, scope, lis, tncSelection, tncOverride, commercial]);

  const [issueOpen, setIssueOpen] = useState(false);

  useEffect(() => {
    if (rev && rev.status !== "draft" && revId) {
      navigate(`/quotes/${revId}/view`, { replace: true });
    }
  }, [rev, revId, navigate]);

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
    // Effect above handles the redirect; render a brief placeholder so we
    // don't flash the editor while react-router transitions.
    return (
      <div className="p-6 text-sm font-mono text-zinc-500">
        Redirecting to read-only view…
      </div>
    );
  }

  return (
    <>
      <BuilderLayout
        editor={<Editor />}
        snapshot={snapshot}
        total={total}
        header={header}
        status={`Draft · last edited ${
          rev.updated_at ? new Date(rev.updated_at).toLocaleString() : "—"
        }`}
        canIssue={canIssue}
        onIssue={() => setIssueOpen(true)}
      />
      {quote && customer && (
        <IssueConfirmDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          revId={revId}
          quoteNumber={quote.number}
          revNumber={rev.rev_number}
          customerName={customer.name}
          total={total}
        />
      )}
    </>
  );
}
