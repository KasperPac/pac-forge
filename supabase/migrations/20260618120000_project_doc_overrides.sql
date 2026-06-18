-- ============================================================
-- project_doc_overrides — customer-supplied document exemptions
-- for the project Documents tab doc-control. Only stores files a
-- user has explicitly marked exempt from the Pac numbering convention.
-- ============================================================

CREATE TABLE project_doc_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path text NOT NULL,
  classification text NOT NULL DEFAULT 'customer_supplied'
    CHECK (classification IN ('customer_supplied')),
  note text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, rel_path)
);

CREATE INDEX project_doc_overrides_project_idx
  ON project_doc_overrides(project_id);

ALTER TABLE project_doc_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_doc_overrides_select ON project_doc_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY project_doc_overrides_insert ON project_doc_overrides
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY project_doc_overrides_update ON project_doc_overrides
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY project_doc_overrides_delete ON project_doc_overrides
  FOR DELETE TO authenticated USING (true);
