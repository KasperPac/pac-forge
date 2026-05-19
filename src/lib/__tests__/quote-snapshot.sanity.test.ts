import { describe, it, expect } from "vitest";
import { buildSnapshot } from "@/lib/quote-snapshot";
import type {
  Customer,
  DocAssumption,
  DocCommercialTerms,
  DocLineItem,
  DocScopeItem,
  Project,
  Quote,
  QuoteRevision,
} from "@/types";

const customer: Customer = {
  id: "c-1",
  name: "Conveyor Logistics",
  display_code: "CVL",
  dropbox_root_path: null,
  created_at: "2026-05-17T00:00:00Z",
  updated_at: "2026-05-17T00:00:00Z",
  created_by: null,
};

const project: Project = {
  id: "p-1",
  client_name: "Conveyor Logistics",
  project_number: "CVL-2129",
  plc_brand: "Siemens",
  tia_version: "V18",
  status: null,
  description: null,
  documents: null,
  hardware_config: null,
  io_lists: null,
  tag_dbs: null,
  io_signal_overview: null,
  revision_log: null,
  created_at: "2026-05-17T00:00:00Z",
  updated_at: "2026-05-17T00:00:00Z",
  customer_id: customer.id,
  project_number: "CVL-2129",
  project_name: "Infeed Conveyor Replacement",
  stage: "quoting",
  awarded_quote_id: null,
} as unknown as Project;

const quote: Quote = {
  id: "q-1",
  project_id: project.id,
  number: "CVL-2129-Q01",
  status: "draft",
  created_at: "2026-05-17T00:00:00Z",
  updated_at: "2026-05-17T00:00:00Z",
  created_by: null,
};

const rev: QuoteRevision = {
  id: "r-1",
  quote_id: quote.id,
  rev_number: 1,
  status: "draft",
  summary: null,
  issued_at: null,
  issued_by: null,
  snapshot_json: null,
  pdf_storage_key: null,
  dropbox_content_hash: null,
  created_at: "2026-05-17T00:00:00Z",
  updated_at: "2026-05-17T00:00:00Z",
  created_by: null,
};

const scope: DocScopeItem[] = [
  {
    id: "s-1",
    parent_type: "quote_revision",
    parent_id: rev.id,
    title: "Cabinet build",
    body: null,
    ordering: 0,
    created_at: "2026-05-17T00:00:00Z",
    updated_at: "2026-05-17T00:00:00Z",
  },
];

const assumptions: DocAssumption[] = [
  {
    id: "a-1",
    parent_type: "quote_revision",
    parent_id: rev.id,
    assumption_key: "POWER_3PH_415V",
    title: "Power available",
    value: "415V 3-phase",
    notes: null,
    ordering: 0,
    created_at: "2026-05-17T00:00:00Z",
    updated_at: "2026-05-17T00:00:00Z",
  },
];

const lineItems: DocLineItem[] = [
  {
    id: "li-1",
    parent_type: "quote_revision",
    parent_id: rev.id,
    category: "hardware_materials",
    description: "Cabinet kit",
    qty: "2",
    unit: "ea",
    unit_price: "600",
    hours: null,
    hour_rate: null,
    hour_rate_multiplier: "1",
    subtotal: null,
    show_in_customer_doc: true,
    customer_doc_label: null,
    ordering: 0,
    created_at: "2026-05-17T00:00:00Z",
    updated_at: "2026-05-17T00:00:00Z",
  },
  {
    id: "li-2",
    parent_type: "quote_revision",
    parent_id: rev.id,
    category: "labour",
    description: "Senior engineer time",
    qty: null,
    unit: null,
    unit_price: null,
    hours: "10",
    hour_rate: "180",
    hour_rate_multiplier: "1",
    subtotal: null,
    show_in_customer_doc: true,
    customer_doc_label: null,
    ordering: 1,
    created_at: "2026-05-17T00:00:00Z",
    updated_at: "2026-05-17T00:00:00Z",
  },
];

const commercial: DocCommercialTerms = {
  id: "ct-1",
  parent_type: "quote_revision",
  parent_id: rev.id,
  payment_schedule: "30/60/10",
  validity: "30 days",
  gst_treatment: "Excludes GST",
  currency: "AUD",
  notes: null,
  created_at: "2026-05-17T00:00:00Z",
  updated_at: "2026-05-17T00:00:00Z",
};

describe("snapshot sanity thread", () => {
  const snapshot = buildSnapshot({
    rev,
    quote,
    project,
    customer,
    issued_by_email: "kasper@pac.test",
    issued_at: "2026-05-17T00:00:00.000Z",
    scope,
    inclusions: [],
    exclusions: [],
    assumptions,
    line_items: lineItems,
    commercial,
    tnc: null,
  });

  it("schema_version is 1 and identifiers are inlined", () => {
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.quote_number).toBe("CVL-2129-Q01");
    expect(snapshot.rev_number).toBe(1);
    expect(snapshot.project.customer.name).toBe("Conveyor Logistics");
    expect(snapshot.project.project_number).toBe("CVL-2129");
  });

  it("first line item subtotal equals qty × unit_price", () => {
    expect(snapshot.line_items[0].subtotal).toBe(1200);
  });

  it("hours × rate × multiplier line item produces 1800", () => {
    expect(snapshot.line_items[1].subtotal).toBe(1800);
  });

  it("grand_total sums every line item that has a subtotal", () => {
    expect(snapshot.totals.grand_total).toBe(3000);
    expect(snapshot.totals.grand_total).toBeGreaterThan(0);
  });

  it("by_category and by_category_customer_visible match when all rows are visible", () => {
    expect(snapshot.totals.by_category).toEqual(
      snapshot.totals.by_category_customer_visible,
    );
  });

  it("commercial terms are inlined from the source row", () => {
    expect(snapshot.commercial_terms?.payment_schedule).toBe("30/60/10");
    expect(snapshot.commercial_terms?.validity_period).toBe("30 days");
  });

  it("two calls with the same input produce identical snapshots (determinism)", () => {
    const second = buildSnapshot({
      rev,
      quote,
      project,
      customer,
      issued_by_email: "kasper@pac.test",
      issued_at: "2026-05-17T00:00:00.000Z",
      scope,
      inclusions: [],
      exclusions: [],
      assumptions,
      line_items: lineItems,
      commercial,
      tnc: null,
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(snapshot));
  });
});
