export interface DocOverride {
  id: string;
  project_id: string;
  rel_path: string;
  classification: "customer_supplied";
  note: string | null;
  resolved_by: string | null;
  resolved_at: string;
}
