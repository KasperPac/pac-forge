import type { LineItemCategory } from "./doc-content";

export type SnapshotKind = "quote_revision" | "variation";

export interface SnapshotCitation {
  target_section: "scope" | "inclusion" | "exclusion" | "assumption" | "line_item";
  target_doc_id: string;
  original_text_verbatim: string;
  revised_text: string;
  source_label: string;
}

export interface SnapshotScopeItem {
  title: string;
  body: string | null;
  ordering: number;
}

export interface SnapshotAssumption {
  title: string | null;
  value: string | null;
  notes: string | null;
  ordering: number;
  assumption_key: string | null;
}

export interface SnapshotLineItem {
  category: LineItemCategory;
  description: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  hours: number | null;
  hour_rate: number | null;
  hour_rate_multiplier: number;
  subtotal: number | null;
  show_in_customer_doc: boolean;
  customer_doc_label: string | null;
  ordering: number;
}

export interface SnapshotClause {
  clause_number: string;
  title: string;
  body_markdown: string;
  ordering: number;
  origin: "template" | "custom";
}

export interface SnapshotCommercialTerms {
  payment_schedule: string | null;
  validity_period: string | null;
  gst_treatment: string | null;
  currency: string | null;
  notes: string | null;
}

export interface SnapshotCategoryAggregate {
  category: LineItemCategory;
  subtotal: number;
  count: number;
}

export interface SnapshotPricingPresentation {
  show_pricing_breakdown_detail: "subtotal_only" | "per_line_no_rates" | "full";
  show_executive_summary: boolean;
}

export type SnapshotTnc =
  | {
      kind: "structured";
      template_name: string;
      template_version: number;
      clauses: SnapshotClause[];
    }
  | { kind: "override"; body_markdown: string }
  | null;

export interface QuoteSnapshotV1 {
  schema_version: 1;
  quote_number: string;
  rev_number: number;
  issued_at: string;
  issued_by_email: string | null;
  project: {
    job_code: string;
    project_name: string;
    customer: {
      id: string;
      name: string;
      display_code: string;
    };
  };
  pricing_presentation: SnapshotPricingPresentation;
  summary: string | null;
  scope: SnapshotScopeItem[];
  inclusions: SnapshotScopeItem[];
  exclusions: SnapshotScopeItem[];
  assumptions: SnapshotAssumption[];
  line_items: SnapshotLineItem[];
  totals: {
    grand_total: number;
    by_category: SnapshotCategoryAggregate[];
    by_category_customer_visible: SnapshotCategoryAggregate[];
  };
  commercial_terms: SnapshotCommercialTerms | null;
  tnc: SnapshotTnc;
  kind?: SnapshotKind;
  citations?: SnapshotCitation[];
}
