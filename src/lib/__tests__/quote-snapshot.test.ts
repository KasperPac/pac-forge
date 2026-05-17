import { describe, it, expect } from "vitest";
import { buildSnapshot, type BuildSnapshotInput } from "@/lib/quote-snapshot";
import type { Project } from "@/types";

function baseInput(): BuildSnapshotInput {
  return {
    rev: {
      id: "r1",
      quote_id: "q1",
      rev_number: 2,
      status: "draft",
      summary: "Lead engineer + commissioning",
      issued_at: null,
      issued_by: null,
      snapshot_json: null,
      pdf_storage_key: null,
      dropbox_content_hash: null,
      created_at: "",
      updated_at: "",
      created_by: null,
    },
    quote: {
      id: "q1",
      project_id: "p1",
      number: "CVL-2129-Q01",
      status: "draft",
      created_at: "",
      updated_at: "",
      created_by: null,
    },
    project: {
      id: "p1",
      customer_id: "c1",
      job_code: "CVL-2129",
      project_name: "AMG Cootamundra",
      stage: "quoting",
      awarded_quote_id: null,
    } as unknown as Project,
    customer: {
      id: "c1",
      name: "Conveyor Logistics",
      display_code: "CVL",
      dropbox_root_path: null,
      created_at: "",
      updated_at: "",
      created_by: null,
    },
    issued_by_email: "kasper@pac-technologies.com.au",
    issued_at: "2026-05-14T10:00:00.000Z",
    scope: [
      {
        id: "s1",
        parent_type: "quote_revision",
        parent_id: "r1",
        title: "Migrate Citect",
        body: null,
        ordering: 1,
        created_at: "",
        updated_at: "",
      },
    ],
    inclusions: [],
    exclusions: [],
    assumptions: [],
    line_items: [
      {
        id: "l1",
        parent_type: "quote_revision",
        parent_id: "r1",
        category: "labour",
        description: "Lead eng",
        qty: null,
        unit: null,
        unit_price: null,
        hours: "40",
        hour_rate: "185",
        hour_rate_multiplier: "1",
        subtotal: null,
        show_in_customer_doc: false,
        customer_doc_label: null,
        ordering: 1,
        created_at: "",
        updated_at: "",
      },
    ],
    commercial: null,
    tnc: null,
  };
}

describe("buildSnapshot — header fields", () => {
  it("has schema_version 1", () => {
    expect(buildSnapshot(baseInput()).schema_version).toBe(1);
  });

  it("captures quote_number, rev_number, issued_at, issued_by_email", () => {
    const snap = buildSnapshot(baseInput());
    expect(snap.quote_number).toBe("CVL-2129-Q01");
    expect(snap.rev_number).toBe(2);
    expect(snap.issued_at).toBe("2026-05-14T10:00:00.000Z");
    expect(snap.issued_by_email).toBe("kasper@pac-technologies.com.au");
  });

  it("inlines project metadata with customer record", () => {
    const snap = buildSnapshot(baseInput());
    expect(snap.project).toEqual({
      job_code: "CVL-2129",
      project_name: "AMG Cootamundra",
      customer: {
        id: "c1",
        name: "Conveyor Logistics",
        display_code: "CVL",
      },
    });
  });

  it("defaults pricing_presentation to subtotal_only without exec summary", () => {
    const snap = buildSnapshot(baseInput());
    expect(snap.pricing_presentation).toEqual({
      show_pricing_breakdown_detail: "subtotal_only",
      show_executive_summary: false,
    });
  });
});

describe("buildSnapshot — line items + totals", () => {
  it("inlines line items with numeric subtotal from hours*rate path", () => {
    const snap = buildSnapshot(baseInput());
    expect(snap.line_items[0].subtotal).toBe(40 * 185);
    expect(snap.line_items[0].hours).toBe(40);
    expect(snap.line_items[0].hour_rate).toBe(185);
    expect(snap.line_items[0].hour_rate_multiplier).toBe(1);
  });

  it("inlines line items with subtotal from qty*unit_price path", () => {
    const input = baseInput();
    input.line_items = [
      {
        ...input.line_items[0],
        hours: null,
        hour_rate: null,
        qty: "3",
        unit: "ea",
        unit_price: "200",
        show_in_customer_doc: true,
      },
    ];
    const snap = buildSnapshot(input);
    expect(snap.line_items[0].subtotal).toBe(600);
    expect(snap.line_items[0].qty).toBe(3);
    expect(snap.line_items[0].unit_price).toBe(200);
  });

  it("includes hidden items in grand_total but excludes from customer-visible aggregation", () => {
    const snap = buildSnapshot(baseInput());
    expect(snap.totals.grand_total).toBe(40 * 185);
    expect(snap.totals.by_category).toHaveLength(1);
    expect(snap.totals.by_category[0]).toEqual({
      category: "labour",
      subtotal: 7400,
      count: 1,
    });
    expect(snap.totals.by_category_customer_visible).toHaveLength(0);
  });
});

describe("buildSnapshot — T&Cs", () => {
  it("structured T&Cs: omits selected clauses, appends customs with continued numbering", () => {
    const input = baseInput();
    input.tnc = {
      template: {
        id: "t1",
        name: "Pac Standard 2026",
        version: 3,
        status: "active",
        is_default: true,
        created_at: "",
        updated_at: "",
        created_by: null,
      },
      clauses: [
        {
          id: "cl1",
          template_id: "t1",
          clause_number: "1",
          title: "A",
          body_markdown: "body A",
          ordering: 0,
          created_at: "",
          updated_at: "",
        },
        {
          id: "cl2",
          template_id: "t1",
          clause_number: "2",
          title: "B",
          body_markdown: "body B",
          ordering: 1,
          created_at: "",
          updated_at: "",
        },
      ],
      selection: {
        id: "sel-1",
        parent_type: "quote_revision",
        parent_id: "r1",
        template_id: "t1",
        omitted_clause_ids: ["cl1"],
        added_custom_clauses: [
          { clause_number: "", title: "Custom", body_markdown: "x" },
        ],
        created_at: "",
        updated_at: "",
      },
    };
    const snap = buildSnapshot(input);
    if (snap.tnc?.kind !== "structured") {
      throw new Error("expected structured T&Cs");
    }
    expect(snap.tnc.template_name).toBe("Pac Standard 2026");
    expect(snap.tnc.template_version).toBe(3);
    expect(snap.tnc.clauses.map((c) => c.title)).toEqual(["B", "Custom"]);
    expect(snap.tnc.clauses[0].origin).toBe("template");
    expect(snap.tnc.clauses[1].origin).toBe("custom");
    expect(snap.tnc.clauses[1].clause_number).toBe("2");
  });

  it("override T&Cs: kind override + body_markdown", () => {
    const input = baseInput();
    input.tnc = { override: { body_markdown: "Custom legal blob" } };
    const snap = buildSnapshot(input);
    expect(snap.tnc).toEqual({
      kind: "override",
      body_markdown: "Custom legal blob",
    });
  });

  it("null T&Cs → snapshot.tnc === null", () => {
    const snap = buildSnapshot(baseInput());
    expect(snap.tnc).toBeNull();
  });
});

describe("buildSnapshot — commercial terms", () => {
  it("maps validity → validity_period and copies remaining fields", () => {
    const input = baseInput();
    input.commercial = {
      id: "ct1",
      parent_type: "quote_revision",
      parent_id: "r1",
      payment_schedule: "30 days",
      validity: "90 days",
      gst_treatment: "GST-exclusive",
      currency: "AUD",
      notes: "Subject to site survey",
      created_at: "",
      updated_at: "",
    };
    const snap = buildSnapshot(input);
    expect(snap.commercial_terms).toEqual({
      payment_schedule: "30 days",
      validity_period: "90 days",
      gst_treatment: "GST-exclusive",
      currency: "AUD",
      notes: "Subject to site survey",
    });
  });

  it("null commercial → commercial_terms is null", () => {
    expect(buildSnapshot(baseInput()).commercial_terms).toBeNull();
  });
});

describe("buildSnapshot — determinism", () => {
  it("produces byte-identical JSON across calls with the same input", () => {
    const a = JSON.stringify(buildSnapshot(baseInput()));
    const b = JSON.stringify(buildSnapshot(baseInput()));
    expect(a).toBe(b);
  });
});
