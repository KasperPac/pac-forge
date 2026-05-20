import { describe, it, expect } from "vitest";
import { renderSnapshotToHtml, renderSnapshotToPdf } from "../render.js";

const baseFixture = {
  schema_version: 1 as const,
  quote_number: "CVL-2129-Q01",
  rev_number: 1,
  issued_at: "2026-05-14T00:00:00.000Z",
  issued_by_email: "kasper@pac-technologies.com.au",
  project: {
    project_number: "CVL-2129",
    project_name: "Infeed Conveyor Replacement",
    client: {
      id: "c-1",
      name: "Conveyor Logistics Pty Ltd",
    },
  },
  pricing_presentation: {
    show_pricing_breakdown_detail: "subtotal_only" as const,
    show_executive_summary: false,
  },
  summary: null,
  scope: [
    { title: "Mechanical install", body: "Strip out the old infeed.", ordering: 0 },
    { title: "Electrical wiring", body: null, ordering: 1 },
  ],
  inclusions: [{ title: "Commissioning support", body: null, ordering: 0 }],
  exclusions: [{ title: "After-hours work", body: null, ordering: 0 }],
  assumptions: [
    {
      title: "Power available",
      value: "415V 3-phase to the cabinet",
      notes: null,
      ordering: 0,
      assumption_key: "POWER_3PH_415V",
    },
  ],
  line_items: [
    {
      category: "Materials" as const,
      description: "Cabinet components",
      qty: 1,
      unit: "ea",
      unit_price: 1200,
      hours: null,
      hour_rate: null,
      hour_rate_multiplier: 1,
      subtotal: 1200,
      show_in_customer_doc: true,
      customer_doc_label: null,
      ordering: 0,
    },
    {
      category: "Labour" as const,
      description: "Senior engineer time",
      qty: null,
      unit: null,
      unit_price: null,
      hours: 40,
      hour_rate: 180,
      hour_rate_multiplier: 1,
      subtotal: 7200,
      show_in_customer_doc: true,
      customer_doc_label: null,
      ordering: 1,
    },
  ],
  totals: {
    grand_total: 8400,
    by_category: [
      { category: "Materials" as const, subtotal: 1200, count: 1 },
      { category: "Labour" as const, subtotal: 7200, count: 1 },
    ],
    by_category_customer_visible: [
      { category: "Materials" as const, subtotal: 1200, count: 1 },
      { category: "Labour" as const, subtotal: 7200, count: 1 },
    ],
  },
  commercial_terms: {
    payment_schedule: "30% deposit, 60% on delivery, 10% on commissioning",
    validity_period: "30 days",
    gst_treatment: "Excludes GST",
    currency: "AUD",
    notes: null,
  },
  tnc: {
    kind: "structured" as const,
    template_name: "Pac Standard T&Cs",
    template_version: 1,
    clauses: [
      {
        clause_number: "1",
        title: "Validity",
        body_markdown: "This quotation is valid for 30 days from the date issued.",
        ordering: 0,
        origin: "template" as const,
      },
      {
        clause_number: "2",
        title: "Payment",
        body_markdown: "Payment terms are 30 days from invoice.",
        ordering: 1,
        origin: "template" as const,
      },
    ],
  },
};

describe("renderSnapshotToHtml", () => {
  it("produces an HTML document containing the brand, quote number and customer", async () => {
    const html = await renderSnapshotToHtml(baseFixture);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Pac Technologies");
    expect(html).toContain("CVL-2129-Q01");
    expect(html).toContain("Rev 1");
    expect(html).toContain("Conveyor Logistics Pty Ltd");
    expect(html).toContain("Infeed Conveyor Replacement");
  });

  it("renders subtotal-only pricing when show_pricing_breakdown_detail = subtotal_only", async () => {
    const html = await renderSnapshotToHtml(baseFixture);
    expect(html).toContain("Materials");
    expect(html).toContain("Labour");
    expect(html).toContain("$1,200.00");
    expect(html).toContain("$7,200.00");
    expect(html).toContain("$8,400.00");
    expect(html).not.toContain("Senior engineer time");
    expect(html).not.toContain("Cabinet components");
  });

  it("renders per-line items (no rates) when show_pricing_breakdown_detail = per_line_no_rates", async () => {
    const html = await renderSnapshotToHtml({
      ...baseFixture,
      pricing_presentation: {
        show_pricing_breakdown_detail: "per_line_no_rates",
        show_executive_summary: false,
      },
    });
    expect(html).toContain("Cabinet components");
    expect(html).toContain("Senior engineer time");
    expect(html).not.toContain("$180.00");
  });

  it("renders full rates when show_pricing_breakdown_detail = full", async () => {
    const html = await renderSnapshotToHtml({
      ...baseFixture,
      pricing_presentation: {
        show_pricing_breakdown_detail: "full",
        show_executive_summary: false,
      },
    });
    expect(html).toContain("Cabinet components");
    expect(html).toContain("$180.00");
  });

  it("omits sections with no entries", async () => {
    const html = await renderSnapshotToHtml({
      ...baseFixture,
      scope: [],
      inclusions: [],
      exclusions: [],
      assumptions: [],
    });
    expect(html).not.toContain("Scope of Work");
    expect(html).not.toContain("Inclusions");
    expect(html).not.toContain("Exclusions");
    expect(html).not.toContain("Assumptions");
  });

  it("renders override T&C body when tnc.kind = override", async () => {
    const html = await renderSnapshotToHtml({
      ...baseFixture,
      tnc: { kind: "override", body_markdown: "All other terms superseded." },
    });
    expect(html).toContain("All other terms superseded.");
    // Structured clause markers must be absent — there is no clause-number
    // span in override mode (commercial_terms can still mention "Validity").
    expect(html).not.toContain('class="clause-number"');
    expect(html).not.toContain('<div class="tnc-clause">');
  });

  it("renders numbered structured clauses", async () => {
    const html = await renderSnapshotToHtml(baseFixture);
    expect(html).toContain('class="clause-number">1</span>');
    expect(html).toContain("Validity");
    expect(html).toContain('class="clause-number">2</span>');
  });

  it("renders an Amends callout above a cited scope row for a variation snapshot", async () => {
    const variationSnapshot = {
      schema_version: 1 as const,
      kind: "variation" as const,
      quote_number: "CVL-2129-V01",
      rev_number: 1,
      issued_at: "2026-05-18T00:00:00.000Z",
      issued_by_email: null,
      project: {
        project_number: "CVL-2129",
        project_name: "Infeed Conveyor Replacement",
        client: {
          id: "c-1",
          name: "Conveyor Logistics Pty Ltd",
        },
      },
      pricing_presentation: {
        show_pricing_breakdown_detail: "subtotal_only" as const,
        show_executive_summary: false,
      },
      summary: null,
      scope: [
        {
          id: "s-1",
          title: "Revised cabinet build",
          body: null,
          ordering: 0,
        },
      ],
      inclusions: [],
      exclusions: [],
      assumptions: [],
      line_items: [],
      totals: {
        grand_total: 0,
        by_category: [],
        by_category_customer_visible: [],
      },
      commercial_terms: null,
      tnc: null,
      citations: [
        {
          target_section: "scope",
          target_doc_id: "s-1",
          original_text_verbatim: "Original cabinet build",
          revised_text: "Revised cabinet build",
          source_label: "CVL-2129-Q01 Rev 1, item 1",
        },
      ],
    };
    const html = await renderSnapshotToHtml(variationSnapshot);
    expect(html).toContain('class="amends"');
    expect(html).toContain("Amends CVL-2129-Q01 Rev 1, item 1");
    expect(html).toContain("Original cabinet build");
    expect(html).toContain("Variation V1 to CVL-2129");
    expect(html).toContain("Variation V1</div>");
  });

  it("does not render Amends or variation header for a quote_revision snapshot", async () => {
    const html = await renderSnapshotToHtml(baseFixture);
    expect(html).not.toContain('class="amends"');
    expect(html).not.toContain("Variation V");
    expect(html).toContain(">Quotation<");
  });
});

const hasChromium = !!process.env.CHROMIUM_PATH;
describe.skipIf(!hasChromium)("renderSnapshotToPdf (requires CHROMIUM_PATH)", () => {
  it(
    "produces a non-empty PDF buffer with %PDF header",
    async () => {
      const buf = await renderSnapshotToPdf(baseFixture);
      expect(buf.length).toBeGreaterThan(1000);
      expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    },
    60_000,
  );
});
