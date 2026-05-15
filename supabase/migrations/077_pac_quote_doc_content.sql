-- ============================================================
-- 077_pac_quote_doc_content.sql
-- Pac-Quote: polymorphic document content tables
-- (scope, inclusions, exclusions, assumptions, line items,
-- commercial terms) shared between quote_revisions and variations,
-- plus the assumption_library seed.
--
-- Polymorphic pattern: each content row carries parent_type +
-- parent_id; composite index on (parent_type, parent_id, ordering).
-- ============================================================

-- ------------------------------------------------------------
-- assumption_library (selectable assumption types)
-- ------------------------------------------------------------
CREATE TABLE assumption_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assumption_key text NOT NULL UNIQUE,
  title text NOT NULL,
  default_value text,
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO assumption_library (assumption_key, title, default_value, ordering) VALUES
  ('working_hours',           'Working hours',                    'Business hours only (Mon–Fri 7am–4pm)', 10),
  ('travel_accom_paid_by',    'Travel & accommodation paid by',   'Pac',                                   20),
  ('customer_supplied_items', 'Customer-supplied items',          NULL,                                    30),
  ('software_licences',       'Software licences',                NULL,                                    40),
  ('lead_times',              'Lead times',                       NULL,                                    50),
  ('witness_testing',         'Witness testing',                  NULL,                                    60),
  ('validity_period',         'Quote validity period',            '30 days',                               70),
  ('currency',                'Currency',                         'AUD',                                   80);

-- ------------------------------------------------------------
-- doc_scope_items  (parent_type IN ('quote_revision','variation'))
-- ------------------------------------------------------------
CREATE TABLE doc_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('quote_revision', 'variation')),
  parent_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_scope_items_parent_idx
  ON doc_scope_items(parent_type, parent_id, ordering);

-- ------------------------------------------------------------
-- doc_inclusions and doc_exclusions — identical shape to scope_items
-- (LIKE doc_scope_items INCLUDING ALL copies columns, defaults, indexes,
-- and constraints; we add the composite index explicitly because it was
-- created on a base table that doesn't carry the table_name pattern to
-- the copied indexes.)
-- ------------------------------------------------------------
CREATE TABLE doc_inclusions (LIKE doc_scope_items INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE doc_inclusions ADD PRIMARY KEY (id);
CREATE INDEX doc_inclusions_parent_idx
  ON doc_inclusions(parent_type, parent_id, ordering);

CREATE TABLE doc_exclusions (LIKE doc_scope_items INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE doc_exclusions ADD PRIMARY KEY (id);
CREATE INDEX doc_exclusions_parent_idx
  ON doc_exclusions(parent_type, parent_id, ordering);

-- ------------------------------------------------------------
-- doc_assumptions
-- assumption_key is a soft FK to assumption_library; NULL means an
-- inline custom assumption (title field carries it). At least one of
-- assumption_key or title must be set.
-- ------------------------------------------------------------
CREATE TABLE doc_assumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('quote_revision', 'variation')),
  parent_id uuid NOT NULL,
  assumption_key text REFERENCES assumption_library(assumption_key) ON DELETE SET NULL,
  title text,
  value text,
  notes text,
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (assumption_key IS NOT NULL OR title IS NOT NULL)
);
CREATE INDEX doc_assumptions_parent_idx
  ON doc_assumptions(parent_type, parent_id, ordering);

-- ------------------------------------------------------------
-- doc_line_items
-- ------------------------------------------------------------
CREATE TABLE doc_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('quote_revision', 'variation')),
  parent_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'labour',
    'hardware_materials',
    'software_licences',
    'software_development',
    'commissioning',
    'travel_accom',
    'subcontract',
    'other'
  )),
  description text NOT NULL,
  qty numeric(18, 4),
  unit text,
  unit_price numeric(18, 4),
  hours numeric(18, 4),
  hour_rate numeric(18, 4),
  hour_rate_multiplier numeric(6, 3) NOT NULL DEFAULT 1.0,
  subtotal numeric(18, 4),
  show_in_customer_doc boolean NOT NULL DEFAULT true,
  customer_doc_label text,
  ordering int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_line_items_parent_idx
  ON doc_line_items(parent_type, parent_id, ordering);

-- ------------------------------------------------------------
-- doc_commercial_terms (one row per doc — unique parent)
-- ------------------------------------------------------------
CREATE TABLE doc_commercial_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_type text NOT NULL CHECK (parent_type IN ('quote_revision', 'variation')),
  parent_id uuid NOT NULL,
  payment_schedule text,
  validity text,
  gst_treatment text,
  currency text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_type, parent_id)
);
-- Composite ordering index isn't meaningful here (one row per parent)
-- but we keep the parent index for parity with other content tables.
CREATE INDEX doc_commercial_terms_parent_idx
  ON doc_commercial_terms(parent_type, parent_id);

-- ------------------------------------------------------------
-- RLS + moddatetime triggers (uniform 4-policy authenticated)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'assumption_library',
    'doc_scope_items',
    'doc_inclusions',
    'doc_exclusions',
    'doc_assumptions',
    'doc_line_items',
    'doc_commercial_terms'
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
