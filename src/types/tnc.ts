import type { ParentType } from "./doc-content";

export const TNC_STATUSES = ["active", "archived"] as const;
export type TncStatus = (typeof TNC_STATUSES)[number];

export interface TncTemplate {
  id: string;
  name: string;
  version: number;
  status: TncStatus;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface TncClause {
  id: string;
  template_id: string;
  clause_number: string;
  title: string;
  body_markdown: string;
  ordering: number;
  created_at: string;
  updated_at: string;
}

export interface CustomClauseDraft {
  clause_number: string;
  title: string;
  body_markdown: string;
}

export interface DocTncSelection {
  id: string;
  parent_type: ParentType;
  parent_id: string;
  template_id: string | null;
  omitted_clause_ids: string[];
  added_custom_clauses: CustomClauseDraft[];
  created_at: string;
  updated_at: string;
}

export interface DocTncOverride {
  id: string;
  parent_type: ParentType;
  parent_id: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
}

export type TncTemplateCreate = Pick<TncTemplate, "name"> & {
  version?: number;
  status?: TncStatus;
  is_default?: boolean;
};
export type TncTemplateUpdate = Partial<Pick<TncTemplate, "name" | "version" | "status" | "is_default">>;

export type TncClauseCreate = Pick<TncClause, "template_id" | "clause_number" | "title"> & {
  body_markdown?: string;
  ordering?: number;
};
export type TncClauseUpdate = Partial<
  Pick<TncClause, "clause_number" | "title" | "body_markdown" | "ordering">
>;

export type DocTncSelectionUpsert = Pick<DocTncSelection, "parent_type" | "parent_id"> & {
  template_id?: string | null;
  omitted_clause_ids?: string[];
  added_custom_clauses?: CustomClauseDraft[];
};

export type DocTncOverrideUpsert = Pick<DocTncOverride, "parent_type" | "parent_id" | "body_markdown">;
