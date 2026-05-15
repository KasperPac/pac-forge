-- ============================================================
-- 078_pac_quote_tnc.sql
-- Pac-Quote: T&Cs library — templates, clauses, per-doc selections,
-- and an optional override blob that replaces standard T&Cs entirely.
-- ============================================================

-- ------------------------------------------------------------
-- tnc_templates  (e.g. "Pac Standard 2026")
-- Partial unique index enforces at most one default at a time.
-- ------------------------------------------------------------
CREATE TABLE tnc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX tnc_templates_one_default
  ON tnc_templates(is_default)
  WHERE is_default = true;

-- ------------------------------------------------------------
-- tnc_clauses (numbered, structured)
-- ------------------------------------------------------------
CREATE TABLE tnc_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES tnc_templates(id) ON DELETE CASCADE,
  clause_number text NOT NULL,
  title text NOT NULL,
  body_markdown text NOT NULL DEFAULT '',
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tnc_clauses_template_idx
  ON tnc_clauses(template_id, ordering);

-- ------------------------------------------------------------
-- doc_tnc_selections — per-document T&Cs choice
-- One row per (parent_type, parent_id). The selected template plus the
-- omit list plus inline custom clauses fully define what renders.
-- ------------------------------------------------------------
CREATE TABLE doc_tnc_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('quote_revision', 'variation')),
  parent_id uuid NOT NULL,
  template_id uuid REFERENCES tnc_templates(id) ON DELETE SET NULL,
  omitted_clause_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  added_custom_clauses jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX doc_tnc_selections_parent_uq
  ON doc_tnc_selections(parent_type, parent_id);

-- ------------------------------------------------------------
-- doc_tnc_override — optional free-form replacement
-- When a row exists for a doc, it overrides the structured selection.
-- ------------------------------------------------------------
CREATE TABLE doc_tnc_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('quote_revision', 'variation')),
  parent_id uuid NOT NULL,
  body_markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX doc_tnc_override_parent_uq
  ON doc_tnc_override(parent_type, parent_id);

-- ------------------------------------------------------------
-- RLS + moddatetime triggers (uniform 4-policy authenticated)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tnc_templates',
    'tnc_clauses',
    'doc_tnc_selections',
    'doc_tnc_override'
  ] LOOP
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
