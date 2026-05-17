import { aggregateByCategory, computeLineSubtotal, grandTotal } from "@/lib/quote-totals";
import type {
  Customer,
  Quote,
  QuoteRevision,
  Project,
  DocScopeItem,
  DocAssumption,
  DocLineItem,
  DocCommercialTerms,
  TncTemplate,
  TncClause,
  DocTncSelection,
  DocTncOverride,
  QuoteSnapshotV1,
  SnapshotClause,
  SnapshotLineItem,
  SnapshotPricingPresentation,
  SnapshotTnc,
} from "@/types";

export type BuildSnapshotTnc =
  | { template: TncTemplate; clauses: TncClause[]; selection: DocTncSelection }
  | { override: DocTncOverride }
  | null;

export interface BuildSnapshotInput {
  rev: QuoteRevision;
  quote: Quote;
  project: Project;
  customer: Customer;
  issued_by_email: string | null;
  issued_at: string;
  scope: DocScopeItem[];
  inclusions: DocScopeItem[];
  exclusions: DocScopeItem[];
  assumptions: DocAssumption[];
  line_items: DocLineItem[];
  commercial: DocCommercialTerms | null;
  tnc: BuildSnapshotTnc;
  pricing_presentation?: SnapshotPricingPresentation;
}

function toNum(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function sortByOrdering<T extends { ordering: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.ordering - b.ordering);
}

function buildClauses(
  clauses: TncClause[],
  selection: DocTncSelection
): SnapshotClause[] {
  const omit = new Set(selection.omitted_clause_ids);
  const kept = sortByOrdering(clauses.filter((c) => !omit.has(c.id))).map(
    (c, i) => ({
      clause_number: c.clause_number || String(i + 1),
      title: c.title,
      body_markdown: c.body_markdown,
      ordering: i,
      origin: "template" as const,
    })
  );
  const customs = [...selection.added_custom_clauses].map((c, j) => ({
    clause_number: c.clause_number || String(kept.length + j + 1),
    title: c.title,
    body_markdown: c.body_markdown,
    ordering: kept.length + j,
    origin: "custom" as const,
  }));
  return [...kept, ...customs];
}

function buildLineItem(li: DocLineItem): SnapshotLineItem {
  return {
    category: li.category,
    description: li.description,
    qty: toNum(li.qty),
    unit: li.unit,
    unit_price: toNum(li.unit_price),
    hours: toNum(li.hours),
    hour_rate: toNum(li.hour_rate),
    hour_rate_multiplier: toNum(li.hour_rate_multiplier) ?? 1,
    subtotal: computeLineSubtotal(li),
    show_in_customer_doc: li.show_in_customer_doc,
    customer_doc_label: li.customer_doc_label,
    ordering: li.ordering,
  };
}

function buildTnc(tnc: BuildSnapshotTnc): SnapshotTnc {
  if (!tnc) return null;
  if ("override" in tnc) {
    return { kind: "override", body_markdown: tnc.override.body_markdown };
  }
  return {
    kind: "structured",
    template_name: tnc.template.name,
    template_version: tnc.template.version,
    clauses: buildClauses(tnc.clauses, tnc.selection),
  };
}

export function buildSnapshot(input: BuildSnapshotInput): QuoteSnapshotV1 {
  const scope = sortByOrdering(input.scope).map(({ title, body, ordering }) => ({
    title,
    body,
    ordering,
  }));
  const inclusions = sortByOrdering(input.inclusions).map(
    ({ title, body, ordering }) => ({ title, body, ordering })
  );
  const exclusions = sortByOrdering(input.exclusions).map(
    ({ title, body, ordering }) => ({ title, body, ordering })
  );
  const assumptions = sortByOrdering(input.assumptions).map(
    ({ title, value, notes, ordering, assumption_key }) => ({
      title,
      value,
      notes,
      ordering,
      assumption_key,
    })
  );

  const line_items = sortByOrdering(input.line_items).map(buildLineItem);

  return {
    schema_version: 1,
    quote_number: input.quote.number,
    rev_number: input.rev.rev_number,
    issued_at: input.issued_at,
    issued_by_email: input.issued_by_email,
    project: {
      job_code: input.project.job_code ?? "",
      project_name: input.project.project_name ?? "",
      customer: {
        id: input.customer.id,
        name: input.customer.name,
        display_code: input.customer.display_code,
      },
    },
    pricing_presentation: input.pricing_presentation ?? {
      show_pricing_breakdown_detail: "subtotal_only",
      show_executive_summary: false,
    },
    summary: input.rev.summary,
    scope,
    inclusions,
    exclusions,
    assumptions,
    line_items,
    totals: {
      grand_total: grandTotal(input.line_items),
      by_category: aggregateByCategory(input.line_items, {
        onlyCustomerVisible: false,
      }),
      by_category_customer_visible: aggregateByCategory(input.line_items, {
        onlyCustomerVisible: true,
      }),
    },
    commercial_terms: input.commercial
      ? {
          payment_schedule: input.commercial.payment_schedule,
          validity_period: input.commercial.validity,
          gst_treatment: input.commercial.gst_treatment,
          currency: input.commercial.currency,
          notes: input.commercial.notes,
        }
      : null,
    tnc: buildTnc(input.tnc),
  };
}
