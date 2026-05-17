-- ============================================================
-- 079_pac_quote_audit_and_legacy_stubs.sql
-- Pac-Quote: cross-cutting tables that close out v1 schema.
--   issue_audit_log   — defensibility trail; every state transition
--   legacy_doc_imports — schema-only stub for v1; populated in v2
--   company_branding   — singleton; feeds PDF header/footer
-- ============================================================

-- ------------------------------------------------------------
-- issue_audit_log
-- ------------------------------------------------------------
CREATE TABLE issue_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX issue_audit_log_target_idx
  ON issue_audit_log(target_type, target_id, occurred_at DESC);
CREATE INDEX issue_audit_log_occurred_at_idx
  ON issue_audit_log(occurred_at DESC);

-- ------------------------------------------------------------
-- legacy_doc_imports (stub — v2)
-- ------------------------------------------------------------
CREATE TABLE legacy_doc_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dropbox_path text,
  storage_key text,
  extracted_json jsonb,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  attached_to_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  attached_as text CHECK (attached_as IN ('quote_revision', 'variation', 'reference_only')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- company_branding (singleton — partial unique index)
-- ------------------------------------------------------------
CREATE TABLE company_branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  company_name text NOT NULL DEFAULT 'Pac Technologies',
  address_lines text[] NOT NULL DEFAULT ARRAY[]::text[],
  contact_email text,
  contact_phone text,
  abn text,
  logo_storage_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX company_branding_singleton_uq
  ON company_branding(singleton)
  WHERE singleton = true;

INSERT INTO company_branding (singleton) VALUES (true);

CREATE TRIGGER company_branding_updated_at
  BEFORE UPDATE ON company_branding
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ------------------------------------------------------------
-- RLS — issue_audit_log and legacy_doc_imports get select/insert only
-- (no update/delete on audit history); company_branding gets the full
-- four-policy set so the branding singleton can be edited.
-- ------------------------------------------------------------
ALTER TABLE issue_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_audit_log_select_authenticated ON issue_audit_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY issue_audit_log_insert_authenticated ON issue_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

ALTER TABLE legacy_doc_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_doc_imports_select_authenticated ON legacy_doc_imports
  FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_doc_imports_insert_authenticated ON legacy_doc_imports
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY legacy_doc_imports_update_authenticated ON legacy_doc_imports
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE company_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_branding_select_authenticated ON company_branding
  FOR SELECT TO authenticated USING (true);
CREATE POLICY company_branding_insert_authenticated ON company_branding
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY company_branding_update_authenticated ON company_branding
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
