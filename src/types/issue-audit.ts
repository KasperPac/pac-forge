export const AUDIT_EVENT_TYPES = [
  "draft_created",
  "issued",
  "superseded",
  "awarded",
  "marked_lost",
  "variation_issued",
  "legacy_imported",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_TARGET_TYPES = ["quote", "quote_revision", "variation", "project"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface IssueAuditLogEntry {
  id: string;
  actor_id: string | null;
  occurred_at: string;
  event_type: AuditEventType;
  target_type: AuditTargetType;
  target_id: string;
  details_json: Record<string, unknown>;
}

export type IssueAuditLogEntryCreate = Pick<
  IssueAuditLogEntry,
  "event_type" | "target_type" | "target_id"
> & {
  actor_id?: string | null;
  details_json?: Record<string, unknown>;
};

export const LEGACY_ATTACHED_AS = ["quote_revision", "variation", "reference_only"] as const;
export type LegacyAttachedAs = (typeof LEGACY_ATTACHED_AS)[number];

export interface LegacyDocImport {
  id: string;
  dropbox_path: string | null;
  storage_key: string | null;
  extracted_json: Record<string, unknown> | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  attached_to_project_id: string | null;
  attached_as: LegacyAttachedAs | null;
  created_at: string;
}

export interface CompanyBranding {
  id: string;
  company_name: string;
  address_lines: string[];
  contact_email: string | null;
  contact_phone: string | null;
  abn: string | null;
  logo_storage_key: string | null;
  updated_at: string;
}

export type CompanyBrandingUpdate = Partial<
  Pick<
    CompanyBranding,
    "company_name" | "address_lines" | "contact_email" | "contact_phone" | "abn" | "logo_storage_key"
  >
>;
