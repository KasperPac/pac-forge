import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router";
import { useVariation } from "@/hooks/use-variations";
import { useCitationsForVariation } from "@/hooks/use-variation-citations";
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
import {
  buildSnapshot,
  type BuildSnapshotCitation,
  type BuildSnapshotTnc,
} from "@/lib/quote-snapshot";
import { grandTotal } from "@/lib/quote-totals";
import { validateForIssue } from "@/lib/quote-validation";
import { BuilderLayout } from "@/components/quotes/builder/builder-layout";
import { IssueConfirmDialog } from "@/components/quotes/issue-confirm-dialog";
import { VariationBuilderProvider } from "@/components/quotes/builder/variation-builder-context";
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

export default function VariationBuilderRoute() {
  const { variationId } = useParams<{ variationId: string }>();
  const navigate = useNavigate();
  const ref: ParentRef | undefined = variationId
    ? { parent_type: "variation", parent_id: variationId }
    : undefined;

  const {
    data: variation,
    isLoading: variationLoading,
    error: variationError,
  } = useVariation(variationId);
  const { data: project } = useProject(variation?.project_id);
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
  const { data: citations = [] } = useCitationsForVariation(variationId);

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
    if (!variation || !project || !customer) return null;
    const citationsForBuild: BuildSnapshotCitation[] = citations.map((c) => ({
      row: c,
      source_label: "(source)",
    }));
    return buildSnapshot({
      rev: {
        id: variation.id,
        quote_id: variation.project_id,
        rev_number: variation.variation_number,
        status: "draft",
        summary: variation.summary,
        issued_at: null,
        issued_by: null,
        snapshot_json: null,
        pdf_storage_key: null,
        dropbox_content_hash: null,
        created_at: variation.created_at,
        updated_at: variation.updated_at,
        created_by: null,
      },
      quote: {
        id: variation.project_id,
        project_id: variation.project_id,
        number: `${project.job_code ?? ""}-V${variation.variation_number}`,
        status: "draft",
        created_at: variation.created_at,
        updated_at: variation.updated_at,
        created_by: null,
      },
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
      kind: "variation",
      citations: citationsForBuild,
    });
  }, [
    variation,
    project,
    customer,
    scope,
    incs,
    excs,
    asms,
    lis,
    commercial,
    tncForSnap,
    citations,
  ]);

  const total = grandTotal(lis);

  const canIssue = useMemo(() => {
    if (!project) return false;
    if (!["awarded", "in_progress"].includes(project.stage)) return false;
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
    if (variation && variation.status !== "draft" && variationId) {
      navigate(`/variations/${variationId}/view`, { replace: true });
    }
  }, [variation, variationId, navigate]);

  if (!variationId) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Missing variation id.
      </div>
    );
  }

  if (variationError) {
    return (
      <div className="p-6 text-sm text-red-400 font-mono">
        Failed to load variation: {String(variationError)}
      </div>
    );
  }

  if (variationLoading || !variation) {
    return (
      <div className="p-6 text-sm font-mono text-zinc-500">
        Loading variation…
      </div>
    );
  }

  if (variation.status !== "draft") {
    return (
      <div className="p-6 text-sm font-mono text-zinc-500">
        Redirecting to read-only view…
      </div>
    );
  }

  const header =
    project && customer ? (
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-xs font-mono text-zinc-500 uppercase tracking-wide">
            Variation
          </div>
          <div className="font-mono text-sm text-zinc-100">
            V{variation.variation_number} ·{" "}
            {project.project_name ?? project.job_code ?? "Project"}
          </div>
        </div>
        <div className="text-xs font-mono text-zinc-400">
          {project.job_code ?? ""} · {customer.name}
        </div>
      </div>
    ) : null;

  return (
    <VariationBuilderProvider
      value={{ variationId, projectId: variation.project_id }}
    >
      <BuilderLayout
        editor={<Editor />}
        snapshot={snapshot}
        total={total}
        header={header}
        status={`Draft · last edited ${
          variation.updated_at
            ? new Date(variation.updated_at).toLocaleString()
            : "—"
        }`}
        canIssue={canIssue}
        onIssue={() => setIssueOpen(true)}
      />
      {project && customer && (
        <IssueConfirmDialog
          mode="variation"
          open={issueOpen}
          onOpenChange={setIssueOpen}
          variationId={variationId}
          projectId={variation.project_id}
          jobCode={project.job_code ?? ""}
          variationNumber={variation.variation_number}
          customerName={customer.name}
          total={total}
        />
      )}
    </VariationBuilderProvider>
  );
}
