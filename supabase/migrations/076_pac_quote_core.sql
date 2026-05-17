-- ============================================================
-- 076_pac_quote_core.sql
-- Pac-Quote: core lifecycle tables (quotes, quote_revisions, variations)
-- plus projects extension (customer_id, job_code, project_name, stage,
-- awarded_quote_id). Variations is schema-only in v1 (consumer in v3).
-- ============================================================

-- ------------------------------------------------------------
-- projects extension
-- awarded_quote_id is added later (after quote_revisions exists)
-- ------------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_code text,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'quoting'
    CHECK (stage IN ('quoting', 'awarded', 'in_progress', 'closed'));

-- ------------------------------------------------------------
-- quotes
-- ------------------------------------------------------------
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'superseded', 'awarded', 'lost')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, number)
);

CREATE INDEX quotes_project_idx ON quotes(project_id);

-- ------------------------------------------------------------
-- quote_revisions
-- ------------------------------------------------------------
CREATE TABLE quote_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  rev_number int NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'superseded')),
  summary text,
  issued_at timestamptz,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  snapshot_json jsonb,
  pdf_storage_key text,
  dropbox_content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (quote_id, rev_number)
);

CREATE INDEX quote_revisions_quote_idx ON quote_revisions(quote_id);

-- Now the projects.awarded_quote_id FK can be added
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS awarded_quote_id uuid
    REFERENCES quote_revisions(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- variations (schema only — consumer ships in v3)
-- ------------------------------------------------------------
CREATE TABLE variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variation_number int NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued')),
  summary text,
  issued_at timestamptz,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  snapshot_json jsonb,
  pdf_storage_key text,
  dropbox_content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, variation_number)
);

CREATE INDEX variations_project_idx ON variations(project_id);

-- ------------------------------------------------------------
-- RLS + moddatetime triggers (uniform 4-policy authenticated)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'quote_revisions', 'variations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_select_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
      t || '_insert_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
      t || '_update_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)',
      t || '_delete_authenticated', t
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at)',
      t || '_updated_at', t
    );
  END LOOP;
END $$;
