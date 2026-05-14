-- ============================================================
-- 075_pac_quote_customers.sql
-- Pac-Quote: customers table. One row per company we quote to.
-- ============================================================

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_code text NOT NULL UNIQUE,
  dropbox_root_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select_authenticated" ON customers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_insert_authenticated" ON customers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "customers_update_authenticated" ON customers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "customers_delete_authenticated" ON customers
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
