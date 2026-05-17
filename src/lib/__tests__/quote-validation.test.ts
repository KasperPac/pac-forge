import { describe, it, expect } from "vitest";
import { validateForIssue } from "@/lib/quote-validation";
import type { LineItemCategory } from "@/types";

function lineItem(
  overrides: Partial<{
    qty: string | null;
    unit_price: string | null;
    hours: string | null;
    hour_rate: string | null;
    hour_rate_multiplier: string;
    show_in_customer_doc: boolean;
    category: LineItemCategory;
  }> = {}
) {
  return {
    qty: null,
    unit_price: null,
    hours: null,
    hour_rate: null,
    hour_rate_multiplier: "1",
    show_in_customer_doc: true,
    category: "labour" as LineItemCategory,
    ...overrides,
  };
}

const valid = {
  project: {
    customer_id: "cust-1",
    job_code: "CVL-2129",
    project_name: "Lift Cell A",
  },
  scope: [{ title: "Scope item 1" }],
  lineItems: [lineItem({ qty: "1", unit_price: "100" })],
  tncSelection: {
    template_id: "tmpl-1",
    omitted_clause_ids: [] as string[],
    added_custom_clauses: [] as unknown[],
  },
  tncOverride: null,
  commercial: { payment_schedule: "30 days" },
};

describe("validateForIssue", () => {
  it("accepts a complete quote", () => {
    expect(validateForIssue(valid).ok).toBe(true);
  });

  it("fails missing customer_id", () => {
    const r = validateForIssue({
      ...valid,
      project: { ...valid.project, customer_id: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "project.customer_id")).toBe(true);
    }
  });

  it("fails missing job_code", () => {
    const r = validateForIssue({
      ...valid,
      project: { ...valid.project, job_code: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "project.job_code")).toBe(true);
    }
  });

  it("fails missing project_name", () => {
    const r = validateForIssue({
      ...valid,
      project: { ...valid.project, project_name: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "project.project_name")).toBe(
        true
      );
    }
  });

  it("fails on zero scope items", () => {
    const r = validateForIssue({ ...valid, scope: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "scope")).toBe(true);
    }
  });

  it("fails on zero grand total", () => {
    const r = validateForIssue({
      ...valid,
      lineItems: [lineItem({ qty: "1", unit_price: "0" })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "lineItems")).toBe(true);
    }
  });

  it("fails when no line items present", () => {
    const r = validateForIssue({ ...valid, lineItems: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "lineItems")).toBe(true);
    }
  });

  it("fails when neither T&Cs selection nor override is present", () => {
    const r = validateForIssue({
      ...valid,
      tncSelection: null,
      tncOverride: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "tnc")).toBe(true);
    }
  });

  it("passes T&Cs check when only override blob present", () => {
    const r = validateForIssue({
      ...valid,
      tncSelection: null,
      tncOverride: { body_markdown: "Custom override clause" },
    });
    expect(r.ok).toBe(true);
  });

  it("fails when override blob is whitespace-only", () => {
    const r = validateForIssue({
      ...valid,
      tncSelection: null,
      tncOverride: { body_markdown: "   \n   " },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "tnc")).toBe(true);
    }
  });

  it("fails when commercial terms are missing", () => {
    const r = validateForIssue({ ...valid, commercial: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.field === "commercial")).toBe(true);
    }
  });

  it("collects multiple errors at once", () => {
    const r = validateForIssue({
      ...valid,
      project: { customer_id: null, job_code: null, project_name: null },
      scope: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});
