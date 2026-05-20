import { computeLineSubtotal } from "@/lib/quote-totals";
import type { DocLineItem, LineItemCategory } from "@/types";

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export interface ValidationInput {
  project: {
    client_id: string | null;
    project_number: string | null;
  };
  scope: Array<{ title: string }>;
  lineItems: Array<{
    qty: string | null;
    unit_price: string | null;
    hours: string | null;
    hour_rate: string | null;
    hour_rate_multiplier: string;
    show_in_customer_doc: boolean;
    category: LineItemCategory;
  }>;
  tncSelection: { template_id: string | null } | null;
  tncOverride: { body_markdown: string } | null;
  commercial: { payment_schedule: string | null } | null;
}

export function validateForIssue(input: ValidationInput): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input.project.client_id) {
    errors.push({
      field: "project.client_id",
      message: "Client is required.",
    });
  }
  if (!input.project.project_number) {
    errors.push({
      field: "project.project_number",
      message: "Project number is required.",
    });
  }

  if (!input.scope.length) {
    errors.push({
      field: "scope",
      message: "At least one scope item is required.",
    });
  }

  const total = input.lineItems.reduce(
    (sum, li) => sum + (computeLineSubtotal(li as DocLineItem) ?? 0),
    0
  );
  if (total <= 0) {
    errors.push({
      field: "lineItems",
      message: "Pricing total must be greater than zero.",
    });
  }

  const hasSelection = !!(input.tncSelection && input.tncSelection.template_id);
  const hasOverride = !!(
    input.tncOverride && input.tncOverride.body_markdown.trim()
  );
  if (!hasSelection && !hasOverride) {
    errors.push({
      field: "tnc",
      message: "Select a T&Cs template or provide an override.",
    });
  }

  if (!input.commercial) {
    errors.push({
      field: "commercial",
      message: "Commercial terms are required.",
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
