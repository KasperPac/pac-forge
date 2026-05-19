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
  SnapshotCitation,
  SnapshotKind,
  CitationTargetSection,
  VariationCitation,
} from "@/types";

export type BuildSnapshotTnc =
  | { template: TncTemplate; clauses: TncClause[]; selection: DocTncSelection }
  | { override: DocTncOverride }
  | null;

export interface BuildSnapshotCitation {
  row: VariationCitation;
  source_label: string;
}

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
  kind?: SnapshotKind;
  citations?: BuildSnapshotCitation[];
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

function buildLineItem(li: DocLineItem, includeId = false): SnapshotLineItem {
  return {
    ...(includeId ? { id: li.id } : {}),
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

function pickRowText(
  section: CitationTargetSection,
  doc_id: string,
  input: BuildSnapshotInput,
): string {
  const join = (title: string, body: string | null | undefined) =>
    body ? `${title}\n\n${body}` : title;
  switch (section) {
    case "scope": {
      const r = input.scope.find((x) => x.id === doc_id);
      return r ? join(r.title, r.body) : "";
    }
    case "inclusion": {
      const r = input.inclusions.find((x) => x.id === doc_id);
      return r ? join(r.title, r.body) : "";
    }
    case "exclusion": {
      const r = input.exclusions.find((x) => x.id === doc_id);
      return r ? join(r.title, r.body) : "";
    }
    case "assumption": {
      const r = input.assumptions.find((x) => x.id === doc_id);
      if (!r) return "";
      const parts = [r.title, r.value, r.notes].filter(Boolean) as string[];
      return parts.join(" — ");
    }
    case "line_item": {
      const r = input.line_items.find((x) => x.id === doc_id);
      return r ? r.customer_doc_label ?? r.description : "";
    }
  }
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
  const isVariation = input.kind === "variation";

  const scope = sortByOrdering(input.scope).map(({ id, title, body, ordering }) => ({
    ...(isVariation ? { id } : {}),
    title,
    body,
    ordering,
  }));
  const inclusions = sortByOrdering(input.inclusions).map(
    ({ id, title, body, ordering }) => ({
      ...(isVariation ? { id } : {}),
      title,
      body,
      ordering,
    })
  );
  const exclusions = sortByOrdering(input.exclusions).map(
    ({ id, title, body, ordering }) => ({
      ...(isVariation ? { id } : {}),
      title,
      body,
      ordering,
    })
  );
  const assumptions = sortByOrdering(input.assumptions).map(
    ({ id, title, value, notes, ordering, assumption_key }) => ({
      ...(isVariation ? { id } : {}),
      title,
      value,
      notes,
      ordering,
      assumption_key,
    })
  );

  const line_items = sortByOrdering(input.line_items).map((li) =>
    buildLineItem(li, isVariation)
  );

  const base: QuoteSnapshotV1 = {
    schema_version: 1,
    quote_number: input.quote.number,
    rev_number: input.rev.rev_number,
    issued_at: input.issued_at,
    issued_by_email: input.issued_by_email,
    project: {
      project_number: input.project.project_number ?? "",
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

  if (isVariation) {
    const snapshotCitations: SnapshotCitation[] = (input.citations ?? []).map(
      ({ row, source_label }) => ({
        target_section: row.target_section,
        target_doc_id: row.target_doc_id,
        original_text_verbatim: row.original_text_verbatim ?? "",
        revised_text: pickRowText(row.target_section, row.target_doc_id, input),
        source_label,
      })
    );
    return { ...base, kind: "variation", citations: snapshotCitations };
  }

  return base;
}
