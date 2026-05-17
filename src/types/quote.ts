export const QUOTE_STATUSES = ["draft", "issued", "superseded", "awarded", "lost"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const REV_STATUSES = ["draft", "issued", "superseded"] as const;
export type RevStatus = (typeof REV_STATUSES)[number];

export const VARIATION_STATUSES = ["draft", "issued"] as const;
export type VariationStatus = (typeof VARIATION_STATUSES)[number];

export const PROJECT_STAGES = ["quoting", "awarded", "in_progress", "closed"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export interface Quote {
  id: string;
  project_id: string;
  number: string;
  status: QuoteStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface QuoteRevision {
  id: string;
  quote_id: string;
  rev_number: number;
  status: RevStatus;
  summary: string | null;
  issued_at: string | null;
  issued_by: string | null;
  snapshot_json: unknown | null;
  pdf_storage_key: string | null;
  dropbox_content_hash: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface Variation {
  id: string;
  project_id: string;
  variation_number: number;
  status: VariationStatus;
  summary: string | null;
  issued_at: string | null;
  issued_by: string | null;
  snapshot_json: unknown | null;
  pdf_storage_key: string | null;
  dropbox_content_hash: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type QuoteCreate = Pick<Quote, "project_id" | "number">;
export type QuoteUpdate = Partial<Pick<Quote, "status">>;

export type QuoteRevisionCreate = Pick<QuoteRevision, "quote_id" | "rev_number"> & {
  summary?: string | null;
};
export type QuoteRevisionUpdate = Partial<Pick<QuoteRevision, "summary">>;

export type VariationCreate = Pick<Variation, "project_id" | "variation_number"> & {
  summary?: string | null;
};
export type VariationUpdate = Partial<Pick<Variation, "summary">>;
